/**
 * The `git` process seam: argument-array invocation, a per-directory serial
 * queue, a deadline, and an output cap.
 *
 * Three properties matter, and each is a direct answer to a way this can go
 * wrong:
 *
 * - **No shell, ever.** Arguments go to `execFile` as an array, so a branch name
 *   or path containing `;`, backticks, or `$(...)` is one argv element and can
 *   never become a command (§5.3 "禁 shell 插值").
 * - **One git at a time per directory.** Git serialises itself with
 *   `.git/index.lock`, so two concurrent operations on one repository do not
 *   race politely — the loser fails with "Unable to create index.lock". The
 *   queue turns that into waiting.
 * - **A deadline and a cap.** A hung credential prompt or a status on a huge
 *   monorepo must not pin a browser request open forever, so every call is
 *   bounded in both time and bytes (§5.5, §8.4).
 *
 * `GIT_TERMINAL_PROMPT=0` means a missing credential is a fast failure rather
 * than a hang; a credential the user stored in the panel reaches git through
 * `GIT_ASKPASS` instead (see {@link GitAskPass} and `host/askpass.ts`).
 *
 * @module dsh-git-panel/host/git-exec
 */

import { execFile } from 'node:child_process'
import type { ExecFileException } from 'node:child_process'
import type { GitAskPass, GitRunOptions, GitRunResult, GitRunner } from '../core/ports.ts'

/** Default deadline: long enough for a cold `status` on a large monorepo. */
const DEFAULT_TIMEOUT_MS = 15_000

/** Default stdout cap. A status listing far past this is not renderable anyway. */
const DEFAULT_MAX_STDOUT_BYTES = 8 * 1024 * 1024

/**
 * The environment every git call runs with.
 *
 * `GIT_TERMINAL_PROMPT=0` is a security and liveness requirement, not a
 * convenience: without it a missing credential makes git prompt on a terminal
 * that does not exist, and the request hangs until its deadline (§5.5).
 *
 * `LC_ALL=C` forces git's human-readable strings into English. Exactly one
 * parser depends on that — `%(upstream:track)` renders "ahead 1, behind 2" in
 * the user's locale — and a translated string would silently parse as zero
 * ahead and zero behind, which is worse than a visible failure.
 */
function gitEnvironment(optionalLocks: boolean, askpass?: GitAskPass): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    GIT_TERMINAL_PROMPT: '0',
    // Keep git from colouring or paging output that is being captured.
    GIT_PAGER: 'cat',
    LC_ALL: 'C',
    LANG: 'C',
    // See GitRunOptions.optionalLocks: off by default so a read cannot rewrite
    // the index our probe is watching.
    GIT_OPTIONAL_LOCKS: optionalLocks ? '1' : '0',
  }
  // A parent that set GIT_CONFIG_PARAMETERS would inject config into every call
  // we make. The plugin's environment policy is explicit, so drop it rather than
  // inherit it — and drop it by deletion, since an `undefined` env value is
  // serialised to the literal string "undefined" by the child-process layer.
  delete env.GIT_CONFIG_PARAMETERS

  // Askpass is opt-in per call, and the absence is as deliberate as the
  // presence: without a stored credential git must fail with `auth-required`
  // rather than run whatever askpass a launching shell happened to export. The
  // values themselves ride in the environment and never in the helper file.
  delete env.GIT_ASKPASS
  delete env.GIT_ASKPASS_REQUIRE
  delete env.GIT_PANEL_CREDENTIALS
  if (askpass !== undefined) {
    env.GIT_ASKPASS = askpass.helper
    env.GIT_PANEL_CREDENTIALS = askpass.map
    // Ask the helper wherever git would otherwise have prompted on a terminal
    // that does not exist, so behaviour does not depend on how the host started.
    env.GIT_ASKPASS_REQUIRE = 'force'
  }
  return env
}

/**
 * One serial queue per directory.
 *
 * Keyed by working directory rather than by repository root because the queue
 * exists exactly to keep two processes out of one lock file, and the lock lives
 * with the directory git would operate on.
 */
class DirectoryQueues {
  private readonly tails = new Map<string, Promise<void>>()

  /**
   * Run `task` after every previously queued task for `key` has settled.
   * @param key - Directory the task will run in.
   * @param task - The work to run exclusively.
   * @returns The task's result; a previous task's failure does not skip this one.
   */
  run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve()
    // `then(task, task)` deliberately continues after a FAILED predecessor: one
    // request failing must not cancel every request queued behind it.
    const result = previous.then(task, task)
    const settled = result.then(
      () => undefined,
      () => undefined,
    )
    this.tails.set(key, settled)
    void settled.then(() => {
      // Drop the entry only when no later task has already replaced it, so the
      // map cannot grow without bound across a long-lived session.
      if (this.tails.get(key) === settled) this.tails.delete(key)
    })
    return result
  }
}

/** Whether a Node error is the "git is not installed" signal. */
function isMissingBinary(error: NodeJS.ErrnoException): boolean {
  return error.code === 'ENOENT'
}

/** Whether Node cut the output because it exceeded `maxBuffer`. */
function isOutputOverflow(error: NodeJS.ErrnoException): boolean {
  return error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'
}

/**
 * Build the runner.
 * @returns The `GitRunner` the git service depends on.
 */
export function createGitRunner(): GitRunner {
  const queues = new DirectoryQueues()

  return {
    run(args: readonly string[], options: GitRunOptions): Promise<GitRunResult> {
      const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
      const maxStdoutBytes = options.maxStdoutBytes ?? DEFAULT_MAX_STDOUT_BYTES
      const env = gitEnvironment(options.optionalLocks ?? false, options.askpass)

      // The task holds the directory's queue slot for the whole process life,
      // which is what makes the lock guarantee real.
      return queues.run(options.cwd, () =>
        new Promise<GitRunResult>((resolve) => {
          execFile(
            'git',
            [...args],
            {
              cwd: options.cwd,
              env,
              timeout: timeoutMs,
              maxBuffer: maxStdoutBytes,
              encoding: 'utf8',
              windowsHide: true,
              // No `stdio` here: `execFile` always pipes stdout/stderr, and it is
              // not one of its options. Stdin is not left readable by a prompt
              // because GIT_TERMINAL_PROMPT=0 makes git fail instead of asking.
            },
            (error: ExecFileException | null, stdout: string, stderr: string) => {
              const out = typeof stdout === 'string' ? stdout : ''
              const err = typeof stderr === 'string' ? stderr : ''
              if (error === null) {
                resolve({
                  code: 0,
                  stdout: out,
                  stderr: err,
                  timedOut: false,
                  truncated: false,
                  spawnFailed: false,
                })
                return
              }

              const nodeError = error as NodeJS.ErrnoException & {
                killed?: boolean
                signal?: NodeJS.Signals | null
                status?: number | null
                /** The numeric exit code, which is where `execFile` puts it. */
                code?: string | number
              }
              if (isMissingBinary(nodeError)) {
                resolve({
                  code: null,
                  stdout: '',
                  stderr: err,
                  timedOut: false,
                  truncated: false,
                  spawnFailed: true,
                })
                return
              }

              // `execFile` kills the child when `timeout` elapses; a truncated
              // read is reported as truncated output rather than a timeout,
              // because the advice to give the user differs. A killed process is
              // recognised by the signal, since `killed` alone is not set on
              // every Node version's overflow path.
              const truncated = isOutputOverflow(nodeError)
              const killed = nodeError.killed === true || nodeError.signal != null
              resolve({
                // `execFile` reports a non-zero exit on `error.code`, not on
                // `error.status` — probed, and the reason this reads both. Taking
                // `status` alone turned every non-zero exit into `null`, which is
                // also "killed by a signal": a caller could no longer tell git's
                // ordinary "the files differ" (exit 1 from `diff --no-index`)
                // from a crash. `code` is a string only for spawn and buffer
                // failures, and both are handled above.
                code:
                  typeof nodeError.status === 'number'
                    ? nodeError.status
                    : typeof nodeError.code === 'number'
                      ? nodeError.code
                      : null,
                stdout: out,
                stderr: err,
                timedOut: killed && !truncated,
                truncated,
                spawnFailed: false,
              })
            },
          )
        }),
      )
    },
  }
}
