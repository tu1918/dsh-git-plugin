/**
 * The `git` process seam: argument-array invocation, a per-directory serial
 * queue, a bounded wait, and an output cap.
 *
 * Three properties matter, and each is a direct answer to a way this can go
 * wrong:
 *
 * - **No shell, ever.** Arguments go to `spawn` as an array, so a branch name
 *   or path containing `;`, backticks, or `$(...)` is one argv element and can
 *   never become a command (§5.3 "禁 shell 插值").
 * - **One git at a time per directory.** Git serialises itself with
 *   `.git/index.lock`, so two concurrent operations on one repository do not
 *   race politely — the loser fails with "Unable to create index.lock". The
 *   queue turns that into waiting.
 * - **The wait is bounded, and the promise always settles.** A hung credential
 *   prompt or a status on a huge monorepo must not pin a browser request open
 *   forever (§5.5, §8.4), so a call that outlives its deadline is asked to
 *   leave and then made to; a call whose pipes never close still returns.
 *
 * The last property is why this is `spawn` and not `execFile`: `execFile`'s
 * `timeout` sends SIGTERM and settles on the `close` event, so a git helper that
 * ignores SIGTERM — `git-remote-https` or `ssh` surviving its parent — leaves
 * the promise pending forever, which the panel shows as a spinner with no way
 * out. Here the deadline escalates to SIGKILL, the result is ready once the
 * process has ENDED rather than once its pipes are closed, and a child that
 * cannot even be reaped (uninterruptible sleep) is left behind rather than
 * waited on.
 *
 * `GIT_TERMINAL_PROMPT=0` means a missing credential is a fast failure rather
 * than a hang; a credential the user stored in the panel reaches git through
 * `GIT_ASKPASS` instead (see {@link GitAskPass} and `host/askpass.ts`). An editor
 * is the other way a call could wait forever for a terminal, so this runner
 * never lets one open either (see {@link GitEditorControl}).
 *
 * @module dsh-git-panel/host/git-exec
 */

import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import type { Readable } from 'node:stream'
import { StringDecoder } from 'node:string_decoder'
import type {
  GitAskPass,
  GitEditorControl,
  GitRunOptions,
  GitRunResult,
  GitRunner,
} from '../core/ports.ts'

/** Default deadline: long enough for a cold `status` on a large monorepo. */
const DEFAULT_TIMEOUT_MS = 15_000

/** Default stdout cap. A status listing far past this is not renderable anyway. */
const DEFAULT_MAX_STDOUT_BYTES = 8 * 1024 * 1024

/**
 * How long a child gets to leave after SIGTERM before SIGKILL follows.
 *
 * SIGTERM alone is not a bound: a process that ignores it (`ssh` waiting on a
 * network read, a shell with `trap '' TERM`) would keep the call alive forever.
 * Git itself leaves promptly on SIGTERM, so the grace is short.
 */
const SIGTERM_GRACE_MS = 2_000

/**
 * How long SIGKILL is given to be acted on before the call stops waiting.
 *
 * SIGKILL cannot be ignored, but it cannot always be acted on either: a process
 * in uninterruptible sleep (D state, on a network or FUSE filesystem) is not
 * reaped until the kernel operation it is inside returns. The promise settles
 * anyway — the request gets an answer, and the unreaped child is the kernel's
 * business rather than this request's.
 */
const SIGKILL_GRACE_MS = 1_000

/**
 * How long `close` is waited for after the process itself has exited.
 *
 * `close` is the event that says every pipe is drained. It is also the event
 * that never comes when a git helper outlives its parent holding the write end,
 * so it may inform the result but must not gate it: the process ending is what
 * makes the result available, and this grace only lets the pipes catch up.
 */
const PIPE_DRAIN_GRACE_MS = 1_000

/** The two pipes this runner reads. Stdin is `ignore`, so the child has none. */
interface GitProcess extends ChildProcess {
  readonly stdout: Readable
  readonly stderr: Readable
}

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
function gitEnvironment(
  optionalLocks: boolean,
  askpass?: GitAskPass,
  editor?: GitEditorControl,
): NodeJS.ProcessEnv {
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

  // Editors are the other way a git call can wait for a terminal that is not
  // there. The plugin never needs one: a commit always carries `-m`, a revert
  // `--no-edit`. `editor` present means this call may reach a point where git
  // would open one anyway (`rebase --continue`), so `GIT_EDITOR=true` keeps the
  // prepared message and returns; `sequence` names the helper that rewrites a
  // rebase's todo list. Both are cleared when absent, for the same reason the
  // askpass variables are: a launching shell must not inject one.
  delete env.GIT_SEQUENCE_EDITOR
  delete env.GIT_PANEL_SEQUENCE
  delete env.GIT_EDITOR
  if (editor !== undefined) {
    env.GIT_EDITOR = 'true'
    if (editor.sequence !== undefined) {
      env.GIT_SEQUENCE_EDITOR = editor.sequence
      env.GIT_PANEL_SEQUENCE = editor.spec ?? '{}'
    }
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

/**
 * Build the runner.
 * @returns The `GitRunner` the git service depends on.
 */
export function createGitRunner(): GitRunner {
  const queues = new DirectoryQueues()

  return {
    run(args: readonly string[], options: GitRunOptions): Promise<GitRunResult> {
      // A deadline that is zero, negative, or not a number would fire the timer
      // at once (`execFile` used to read its `timeout: 0` as "no deadline at
      // all", which silently removed the bound). Neither is what a caller asked
      // for, so the default stands in; `host/index.ts` warns about the spelling
      // at the config seam, where the operator can see it.
      const configured = options.timeoutMs
      const timeoutMs =
        configured !== undefined && Number.isFinite(configured) && configured > 0
          ? configured
          : DEFAULT_TIMEOUT_MS
      const maxStdoutBytes = options.maxStdoutBytes ?? DEFAULT_MAX_STDOUT_BYTES
      const env = gitEnvironment(options.optionalLocks ?? false, options.askpass, options.editor)

      // The task holds the directory's queue slot for the whole process life,
      // which is what makes the lock guarantee real. The queue carries no
      // deadline of its own: every task now settles, so a wait behind others is
      // bounded by their deadlines, and the request deadline in `adapter/routes`
      // bounds the whole call from above.
      return queues.run(options.cwd, () =>
        new Promise<GitRunResult>((resolve) => {
          // `stdio` is spelled out so stdin is not a pipe git could wait on;
          // that also makes TypeScript type the result as a plain `ChildProcess`,
          // so this narrows it to the two pipes actually read below.
          const child = spawn('git', [...args], {
            cwd: options.cwd,
            env,
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'pipe'],
          }) as GitProcess

          const outDecoder = new StringDecoder('utf8')
          const errDecoder = new StringDecoder('utf8')
          let stdout = ''
          let stderr = ''
          /** Combined bytes kept so far, against {@link maxStdoutBytes}. */
          let capturedBytes = 0
          let truncated = false
          /** Whether the deadline, rather than the cap, is what cut this call. */
          let deadlineHit = false
          let exitCode: number | null = null
          let exitSignal: NodeJS.Signals | null = null
          let settled = false
          let deadlineTimer: NodeJS.Timeout | undefined
          let killTimer: NodeJS.Timeout | undefined
          let giveUpTimer: NodeJS.Timeout | undefined
          let drainTimer: NodeJS.Timeout | undefined

          /** Ask the process to leave, and put a floor under how long that takes. */
          const terminate = (): void => {
            child.kill('SIGTERM')
            if (killTimer === undefined) {
              killTimer = setTimeout(() => child.kill('SIGKILL'), SIGTERM_GRACE_MS)
            }
            if (giveUpTimer === undefined) {
              giveUpTimer = setTimeout(() => settle(), SIGTERM_GRACE_MS + SIGKILL_GRACE_MS)
            }
          }

          /** Finish the call, whichever of the four ways got here. */
          const settle = (spawnFailed = false): void => {
            if (settled) return
            settled = true
            for (const timer of [deadlineTimer, killTimer, giveUpTimer, drainTimer]) {
              if (timer !== undefined) clearTimeout(timer)
            }
            // The reader stops here: a helper still holding the write end writes
            // into nothing rather than keeping this call alive.
            child.stdout.destroy()
            child.stderr.destroy()
            stdout += outDecoder.end()
            stderr += errDecoder.end()
            // A process that ended on its own (no signal, a real exit code) did
            // the work: a deadline that fired while it was finishing must not
            // turn a completed `git status` into "did not finish in time". A
            // signal is the other case — that one is this runner's own SIGTERM
            // or SIGKILL unless the call outlives even the kill.
            const endedOnItsOwn = exitSignal === null && exitCode !== null
            resolve({
              code: spawnFailed ? null : exitCode,
              stdout,
              stderr,
              // A cut at the cap is reported as truncation rather than as a
              // timeout, because the advice to give the user differs.
              timedOut: deadlineHit && !endedOnItsOwn && !truncated,
              truncated,
              spawnFailed,
            })
          }

          /**
           * Keep one chunk, within the cap.
           *
           * Bytes rather than decoded text: a multi-byte character split across
           * chunks is reassembled by the decoder, so the cap counts what git
           * sent, not what UTF-8 happened to align.
           */
          const keep = (chunk: Buffer, decoder: StringDecoder, append: (text: string) => void): void => {
            if (truncated) return
            capturedBytes += chunk.length
            if (capturedBytes > maxStdoutBytes) {
              const over = capturedBytes - maxStdoutBytes
              const fits = Math.max(0, chunk.length - over)
              truncated = true
              if (fits > 0) append(decoder.write(chunk.subarray(0, fits)))
              terminate()
              return
            }
            append(decoder.write(chunk))
          }

          child.stdout.on('data', (chunk: Buffer) => {
            keep(chunk, outDecoder, (text) => {
              stdout += text
            })
          })
          child.stderr.on('data', (chunk: Buffer) => {
            keep(chunk, errDecoder, (text) => {
              stderr += text
            })
          })

          child.on('error', (error: NodeJS.ErrnoException) => {
            // A process that never started — no `git` on PATH, no permission to
            // run it — is its own outcome rather than an ordinary exit.
            if (child.pid === undefined || isMissingBinary(error)) settle(true)
          })

          child.on('exit', (code, signal) => {
            exitCode = code
            exitSignal = signal
            // The process is gone, so there is nothing left to kill, and its
            // pipes are only a grace period away from being written off.
            if (deadlineTimer !== undefined) {
              clearTimeout(deadlineTimer)
              deadlineTimer = undefined
            }
            if (drainTimer === undefined) drainTimer = setTimeout(() => settle(), PIPE_DRAIN_GRACE_MS)
          })

          child.on('close', () => settle())

          deadlineTimer = setTimeout(() => {
            deadlineHit = true
            terminate()
          }, timeoutMs)
        }),
      )
    },
  }
}
