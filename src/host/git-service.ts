/**
 * The git service: the host-side implementation of {@link WorkspaceGitService}.
 *
 * It owns the shape of every `git` invocation and the mapping from a failed
 * process to a code the panel can act on. It owns no parsing — every byte of
 * output goes to `core/git-parse.ts`, which is what keeps the interesting logic
 * testable without a host.
 *
 * @module dsh-git-panel/host/git-service
 */

import {
  changedPathCount,
  groupsOf,
  logPageOf,
  markPushed,
  parseBranches,
  parseLog,
  parseStatusV2,
} from '../core/git-parse.ts'
import type {
  GitPanelError,
  GitRunResult,
  GitRunner,
  HostPorts,
  Result,
  SessionDirResolver,
  WorkspaceGitService,
} from '../core/ports.ts'
import type { BranchRef, FileChange, LogPage, RepoStatus } from '../core/types.ts'

/** The `for-each-ref` format the branch parser expects; the two must agree. */
const BRANCH_FORMAT =
  '%(HEAD)%00%(refname:short)%00%(objectname)%00%(upstream:short)%00%(upstream:track)%00%(committerdate:iso-strict)%00%(subject)'

/** The `log` format the history parser expects; the two must agree. */
const LOG_FORMAT = '%H%x00%h%x00%s%x00%an%x00%aI%x00%cI%x00%P%x1e'

/** Default page size for the history list (FR-3.7). */
const DEFAULT_LOG_LIMIT = 30

/** The hard ceiling on one history page (FR-3.7). */
const MAX_LOG_LIMIT = 500

/** Caps and deadlines one host may tune. */
export interface GitServiceLimits {
  /** Deadline for one git call. */
  readonly timeoutMs?: number
  /** Ceiling on captured stdout for one git call. */
  readonly maxStdoutBytes?: number
}

/** Build one failure result. */
function fail(code: GitPanelError['code'], message: string, detail?: string): Result<never> {
  return { ok: false, error: detail === undefined ? { code, message } : { code, message, detail } }
}

/**
 * Take the first non-empty line of git's stderr as a one-line message.
 *
 * Git's diagnostics are multi-line and its first line is the summary, so this is
 * the summary; the whole text still travels as `detail`, because FR-4.4 requires
 * a blocked branch switch to show git's own multi-line refusal verbatim.
 * @param stderr - Raw stderr.
 * @returns One line, without git's `fatal: `-style prefix.
 */
function firstLine(stderr: string): string {
  for (const line of stderr.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '') continue
    return trimmed.replace(/^(fatal|error|warning):\s*/u, '')
  }
  return 'git failed'
}

/**
 * Build the host's git service.
 * @param runner - The process seam.
 * @param resolver - Session→directory resolution.
 * @param ports - Diagnostic port.
 * @param limits - Optional caps and deadlines.
 * @returns The service the route layer exposes.
 */
export function createGitService(
  runner: GitRunner,
  resolver: SessionDirResolver,
  ports: HostPorts,
  limits: GitServiceLimits = {},
): WorkspaceGitService {
  const timeoutMs = limits.timeoutMs
  const maxStdoutBytes = limits.maxStdoutBytes

  /** Options for one call, omitting keys the host left at their defaults. */
  const options = (cwd: string) => ({
    cwd,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    ...(maxStdoutBytes === undefined ? {} : { maxStdoutBytes }),
  })

  /**
   * Run one git command and classify its outcome.
   *
   * Every read goes through here, so the "git is missing", "git timed out", and
   * "not a repository" mappings exist once rather than at each call site. Calls
   * that tolerate a non-zero exit (asking for a branch's upstream is the common
   * case) check the result themselves instead of relying on this to throw.
   * @param args - Arguments after `git`.
   * @param cwd - Directory to run in.
   * @returns The run, or the panel-level failure it mapped to.
   */
  async function run(args: readonly string[], cwd: string): Promise<Result<GitRunResult>> {
    const outcome = await runner.run(args, options(cwd))

    if (outcome.spawnFailed) {
      return fail('git-missing', 'git is not installed, or not on this process’ PATH')
    }
    if (outcome.timedOut) {
      // §8.4: report the deadline rather than hanging the request, so the panel
      // shows what it has instead of a spinner that never stops.
      ports.log('warn', `git ${args[0] ?? ''} exceeded its deadline in ${cwd}`)
      return fail('timeout', 'git did not finish in time')
    }
    if (outcome.code !== 0) {
      const error: GitPanelError = /not a git repository/iu.test(outcome.stderr)
        ? { code: 'not-a-repo', message: 'this directory is not inside a git repository' }
        : { code: 'git-failed', message: firstLine(outcome.stderr), detail: outcome.stderr }
      ports.log('error', `git ${args.join(' ')} failed: ${error.message}`)
      return { ok: false, error }
    }
    return { ok: true, value: outcome }
  }

  /**
   * Resolve a session to its repository root.
   *
   * The root is discovered by git rather than guessed from the session's
   * directory, so a session opened in a subdirectory still finds its repository,
   * and a session outside any repository is refused by git itself rather than by
   * a rule this plugin would have to keep in step with git's.
   */
  async function repoRoot(sessionId: string): Promise<Result<string>> {
    const directory = await resolver.resolveDir(sessionId)
    if (!directory.ok) return directory
    const outcome = await run(['rev-parse', '--show-toplevel'], directory.value)
    if (!outcome.ok) return outcome
    const root = outcome.value.stdout.trim()
    if (root === '') return fail('not-a-repo', 'git did not report a repository root')
    return { ok: true, value: root }
  }

  /** Read the whole-repository status; shared by `/status` and `stagedPaths`. */
  async function readStatus(sessionId: string): Promise<Result<RepoStatus>> {
    const root = await repoRoot(sessionId)
    if (!root.ok) return root
    const outcome = await run(['status', '--porcelain=v2', '--branch', '-z'], root.value)
    if (!outcome.ok) return outcome

    const parsed = parseStatusV2(outcome.value.stdout)
    return {
      ok: true,
      value: {
        root: root.value,
        branch: parsed.branch,
        groups: groupsOf(parsed.entries),
        // §8.4: a listing cut at the cap is reported as incomplete rather than
        // quietly presented as the whole truth.
        truncated: outcome.value.truncated,
        changedCount: changedPathCount(parsed.entries),
      },
    }
  }

  return {
    status: readStatus,

    async branches(sessionId: string): Promise<Result<readonly BranchRef[]>> {
      const root = await repoRoot(sessionId)
      if (!root.ok) return root
      const outcome = await run(
        ['for-each-ref', `--format=${BRANCH_FORMAT}`, 'refs/heads'],
        root.value,
      )
      if (!outcome.ok) return outcome
      return { ok: true, value: parseBranches(outcome.value.stdout) }
    },

    async log(sessionId: string, offset: number, limit: number): Promise<Result<LogPage>> {
      const root = await repoRoot(sessionId)
      if (!root.ok) return root

      const skip = Number.isSafeInteger(offset) && offset > 0 ? offset : 0
      const take =
        Number.isSafeInteger(limit) && limit > 0 ? Math.min(limit, MAX_LOG_LIMIT) : DEFAULT_LOG_LIMIT

      // One commit MORE than the page answers "is there another page" without a
      // second process and without walking the whole history to count it.
      const outcome = await run(
        [
          'log',
          `--max-count=${take + 1}`,
          `--skip=${skip}`,
          '--date=iso-strict',
          `--format=${LOG_FORMAT}`,
        ],
        root.value,
      )
      // An unborn branch makes `git log` fail with "does not have any commits
      // yet": that is an empty history, not an error the panel should show.
      if (!outcome.ok) {
        if (outcome.error.code === 'git-failed' && /does not have any commits yet|unknown revision/iu.test(outcome.error.detail ?? '')) {
          return { ok: true, value: logPageOf([], 0, false) }
        }
        return outcome
      }

      const parsed = parseLog(outcome.value.stdout)
      const hasMore = parsed.commits.length > take
      const page = hasMore ? parsed.commits.slice(0, take) : parsed.commits

      // Settle the ○/● marker from the same status read the panel already needs.
      const statusRun = await runner.run(['status', '--porcelain=v2', '--branch', '-z'], options(root.value))
      let commits = page
      if (statusRun.code === 0) {
        const branch = parseStatusV2(statusRun.stdout).branch
        if (branch.upstream === null) {
          // Without an upstream the question is unanswerable, so the marker
          // stays absent rather than claiming every commit is unpushed.
          commits = page
        } else if (branch.ahead > 0) {
          // Bounded by the ahead count: usually a handful of commits.
          const unpushedRun = await runner.run(
            ['log', `${branch.upstream}..HEAD`, '--format=%H'],
            options(root.value),
          )
          if (unpushedRun.code === 0) {
            const unpushed = new Set(unpushedRun.stdout.split('\n').filter((line) => line !== ''))
            commits = markPushed(page, unpushed)
          }
        } else {
          commits = page.map((commit) => ({ ...commit, pushed: true }))
        }
      }

      // `total` stays unknown on purpose: the "load more" control needs
      // `hasMore`, and counting the history would cost a full walk (§8.4).
      return { ok: true, value: logPageOf(commits, null, hasMore) }
    },

    async stagedPaths(sessionId: string): Promise<Result<readonly FileChange[]>> {
      const result = await readStatus(sessionId)
      if (!result.ok) return result
      return { ok: true, value: result.value.groups.staged }
    },
  }
}
