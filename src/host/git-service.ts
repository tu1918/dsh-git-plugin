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

import { realpath, stat } from 'node:fs/promises'
import { basename, isAbsolute, join } from 'node:path'

import { buildCommitMessagePrompt, cleanCommitMessage, truncateDiff } from '../core/commit-message.ts'
import { parseUnifiedDiff } from '../core/diff-parse.ts'
import { originOf } from '../core/remote-origin.ts'
import { buildAskpass } from './askpass.ts'
import { discoverRepos, type RunCapture } from './repo-discovery.ts'
import { buildSequenceEditor } from './sequence-editor.ts'
import {
  changedPathCount,
  groupsOf,
  logPageOf,
  markPushed,
  parseBranches,
  parseLog,
  parseRefs,
  parseRemoteBranches,
  parseNumstat,
  parseStashList,
  parseStatusV2,
  withRefs,
} from '../core/git-parse.ts'
import type {
  GitAskPass,
  GitCredential,
  GitEditorControl,
  GitPanelError,
  GitRunResult,
  GitRunner,
  HostPorts,
  Result,
  SessionDirResolver,
  WorkspaceGitService,
} from '../core/ports.ts'
import type {
  BranchInfo,
  BranchRef,
  CommitDetail,
  CommitInfo,
  ConflictSide,
  DiffTarget,
  FileChange,
  FileDiff,
  GeneratedMessage,
  InProgressOperation,
  LogPage,
  OperationReport,
  RemoteBranchRef,
  RepoListing,
  RepoStatus,
  ResetMode,
  RewriteAction,
  StashEntry,
  UndoResult,
} from '../core/types.ts'
import {
  validateBranchBase,
  validateBranchName,
  validateCredential,
  validateHash,
  validateMessage,
  validateOperationKind,
  validatePaths,
  validateResetMode,
  validateRewriteAction,
  validateStashMessage,
} from '../core/validate.ts'
import { gitDirOf } from './git-dir.ts'

/** The `for-each-ref` format the branch parser expects; the two must agree. */
const BRANCH_FORMAT =
  '%(HEAD)%00%(refname:short)%00%(objectname)%00%(upstream:short)%00%(upstream:track)%00%(committerdate:iso-strict)%00%(subject)'

/** The `for-each-ref` format the remote-branch parser expects; the two must agree. */
const REMOTE_BRANCH_FORMAT =
  '%(objectname)%00%(refname:short)%00%(subject)%00%(committerdate:iso-strict)%00%(symref)'

/**
 * The `for-each-ref` format the decoration parser expects; the two must agree.
 *
 * `%(*objectname)` is the peeled commit of an annotated tag, and `%(symref)` is
 * non-empty only for a symbolic ref (`refs/remotes/origin/HEAD`), which is how
 * that one is told apart from a real branch without guessing at its name.
 */
const REFS_FORMAT = '%(objectname)%00%(*objectname)%00%(refname)%00%(symref)'

/** The `log` format the history parser expects; the two must agree. */
const LOG_FORMAT = '%H%x00%h%x00%s%x00%an%x00%aI%x00%cI%x00%P%x1e'

/** The `stash list` format the stash parser expects; the two must agree. */
const STASH_FORMAT = '%gd%x00%H%x00%h%x00%s%x00%cI%x1e'

/**
 * Most per-session repository choices kept (FR-8).
 *
 * One small string per session; the bound exists so a host that has seen
 * thousands of sessions does not grow a map for none of them.
 */
const MAX_SELECTIONS = 128

/** Default page size for the history list (FR-3.7). */
const DEFAULT_LOG_LIMIT = 30

/** The hard ceiling on one history page (FR-3.7). */
const MAX_LOG_LIMIT = 500

/** Context lines a diff hunk carries when the caller does not say (FR-2.2). */
const DEFAULT_CONTEXT_LINES = 3

/**
 * Ceiling on the context lines one diff may ask for.
 *
 * Context is not a knob the panel exposes — the renderer asks for the ordinary
 * three — so this bound exists to keep a hand-written request from turning one
 * hunk into a whole-file read. Fifty is already past the point where the changed
 * lines stop being the subject of the view.
 */
const MAX_CONTEXT_LINES = 50

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
 * How many paths one audit line names before it says "and more".
 *
 * §7 asks the discard audit to say WHICH paths were thrown away, and one request
 * may legitimately carry a whole group. The line is a log record rather than a
 * manifest, so it stays bounded: a body may hold up to a megabyte of paths, and
 * a single log line that size would be a worse record than a counted one.
 */
const MAX_AUDIT_PATHS = 20

/**
 * Name the paths an audit line carries.
 * @param paths - Every path the operation acted on.
 * @returns Up to {@link MAX_AUDIT_PATHS} paths, and the count of the rest.
 */
function auditPaths(paths: readonly string[]): string {
  const shown = paths.slice(0, MAX_AUDIT_PATHS).join(', ')
  return paths.length <= MAX_AUDIT_PATHS
    ? shown
    : `${shown} … (+${paths.length - MAX_AUDIT_PATHS} more)`
}

/**
 * Deadline for one history-rewriting call.
 *
 * A rewrite replays every commit after its target through a fresh rebase — many
 * git operations inside one process — so the ordinary 15s deadline, sized for a
 * single read, would cut a legitimate rewrite off. It is still a bound: a rebase
 * that has not finished in a minute is reported as a timeout rather than pinning
 * the request open, and a rebase left mid-flight by that is exactly what the
 * panel's operation bar offers to continue or abandon.
 */
const REWRITE_TIMEOUT_MS = 60_000

/**
 * Extra options one {@link run} call may carry.
 *
 * A struct rather than more positional parameters: `run` already takes the
 * argument list, the directory and the lock flag, and two more booleans-in-
 * disguise at the call site would be unreadable.
 */
interface RunExtras {
  /** Credentials to answer this call's HTTPS prompts with. */
  readonly askpass?: GitAskPass
  /** Editor suppression for a call that would otherwise open one. */
  readonly editor?: GitEditorControl
  /** Deadline for this call, when it needs more than the host's default. */
  readonly timeoutMs?: number
}

/** A failure the panel recognises, and the code it earns. */
interface FailurePattern {
  /** Tested against both streams' text. */
  readonly pattern: RegExp
  /** The code the browser receives. */
  readonly code: GitPanelError['code']
  /** The fallback sentence, for a caller that does not translate the code. */
  readonly message: string
}

/**
 * The failures the panel names, in the order they are tested.
 *
 * Each entry exists because the panel does something different with it: a
 * non-fast-forward push points the user at "sync" instead of forwarding git's
 * hint text (FR-5.4), a conflicting pull is the state the merge UI will own
 * (FR-5.3), and `nothing-to-commit` means the FR-3.4 button disagreed with the
 * index — worth distinguishing from a generic failure precisely because it
 * should be unreachable when the button's copy is right.
 */
const FAILURE_PATTERNS: readonly FailurePattern[] = [
  {
    pattern: /not a git repository/iu,
    code: 'not-a-repo',
    message: 'this directory is not inside a git repository',
  },
  {
    pattern: /empty commit message/iu,
    code: 'bad-request',
    message: 'a commit message may not be empty',
  },
  {
    // An HTTPS remote that wanted a credential git had nobody to ask. The
    // panel answers with a form and a retry, which it can only do if this is a
    // code of its own rather than git's prose (see `authRemoteOf` for the
    // origin it names).
    pattern:
      /could not read Username|Authentication failed|terminal prompts disabled|HTTP Basic: Access denied|Invalid username or (password|token)/iu,
    code: 'auth-required',
    message: 'the remote asked for a username and password, and this panel has none stored for it',
  },
  {
    pattern: /\[rejected\]|non-fast-forward|\(fetch first\)|failed to push some refs/iu,
    code: 'non-fast-forward',
    message: 'the remote has commits this branch does not, so the push was refused',
  },
  {
    pattern: /CONFLICT \(|Automatic merge failed|fix conflicts and then commit/iu,
    code: 'conflict',
    message: 'the merge left conflicts that must be resolved before committing',
  },
  {
    // FR-4.4's state, given a code of its own: git refuses a branch switch (and a
    // stash apply) rather than overwriting local work, and the panel offers the
    // "stash, then switch" shortcut exactly here — which it can only do if this
    // refusal is distinguishable from every other one git prints. Four spellings
    // are covered: git names the operation it would have overwritten with
    // ("…by checkout/merge/cherry-pick/revert"), and a rebase refuses in its own
    // words instead ("cannot rebase: You have unstaged changes"). All four are
    // the same answer to the user: commit or stash first.
    pattern:
      /would be overwritten by (checkout|merge|cherry-pick|revert)|cannot rebase: (You have unstaged changes|Your index contains uncommitted changes)/iu,
    code: 'dirty-worktree',
    message: 'local changes would be overwritten, so the operation was refused',
  },
  {
    // FR-4.3: an unmerged branch needs a second, armed confirmation, so the
    // refusal has to be a code the panel can recognise rather than prose.
    pattern: /not fully merged/iu,
    code: 'not-merged',
    message: 'the branch has commits that are not merged anywhere else',
  },
  {
    // A pull whose configured upstream was not in the fetch: the branch that
    // `branch.<name>.merge` names no longer exists on the remote (deleted or
    // renamed), so there is nothing to merge with. git's sentence says what it
    // could not do and stops there; the panel adds the way out (see
    // `error.upstreamGone`), which is why this is a code rather than prose.
    pattern: /no such ref was fetched|specifies to merge with the ref/iu,
    code: 'upstream-gone',
    message: 'the upstream branch this branch tracks no longer exists on the remote',
  },
  {
    // LAST, because its pattern is the loosest thing git prints: a failed
    // `stash apply`/`pop` prints its own status block to stdout, and that block
    // ends with "no changes added to commit" even when the real reason is a
    // conflict or a worktree git refused to overwrite. Put first, it would swallow
    // both of those states (probed, and caught by the tests below). Nothing else
    // ever prints it, so nothing is lost by testing it last.
    pattern: /nothing to commit|no changes added to commit/iu,
    code: 'nothing-to-commit',
    message: 'there is nothing staged to commit',
  },
]

/**
 * Every line a failed git call printed, stderr first.
 *
 * git splits a failure across the two streams: a rejected push writes its
 * `! [rejected]` line to stderr, while a conflicting merge writes
 * `CONFLICT (content): ...` to stdout and its summary to stderr. Keeping both, in
 * that order, is what FR-4.4's "show git's multi-line output" actually asks for.
 * @param outcome - The failed run.
 * @returns Both streams, concatenated.
 */
function fullOutput(outcome: GitRunResult): string {
  return [outcome.stderr, outcome.stdout].filter((part) => part !== '').join('')
}

/**
 * Map a failed git process onto a code the panel can act on.
 * @param outcome - The non-zero run.
 * @returns The failure to hand the browser, with git's own words as detail.
 */
function authRemoteOf(outcome: GitRunResult): string | undefined {
  // git quotes the URL in its own refusal (`could not read Username for
  // 'https://host'`), which is the one place it names what the credential is
  // for. The first quoted URL that parses as HTTP(S) is the origin to address.
  for (const match of `${outcome.stderr}\n${outcome.stdout}`.matchAll(/'([^']+)'/gu)) {
    const url = match[1]
    if (url === undefined) continue
    const origin = originOf(url)
    if (origin !== null) return origin
  }
  return undefined
}

function classifyFailure(outcome: GitRunResult): GitPanelError {
  const text = `${outcome.stderr}\n${outcome.stdout}`
  for (const candidate of FAILURE_PATTERNS) {
    if (candidate.pattern.test(text)) {
      const error: GitPanelError = {
        code: candidate.code,
        message: candidate.message,
        detail: fullOutput(outcome),
      }
      // Only a credential failure carries an origin: the panel uses it to
      // address what it is about to store, and no other refusal has one.
      if (candidate.code === 'auth-required') {
        const remote = authRemoteOf(outcome)
        if (remote !== undefined) return { ...error, remote }
      }
      return error
    }
  }
  // Nothing recognised: git's first line as the summary, everything as detail.
  return {
    code: 'git-failed',
    message: firstLine(outcome.stderr !== '' ? outcome.stderr : outcome.stdout),
    detail: fullOutput(outcome),
  }
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

  /**
   * Which repository each session is reading (FR-8).
   *
   * This is the one piece of per-session state in an otherwise stateless
   * service, and it is deliberate: see {@link repoRoot}. Entries are dropped when
   * a session stops resolving and bounded by {@link MAX_SELECTIONS}, because a
   * long-lived host sees sessions come and go.
   */
  const selections = new Map<string, string>()

  /** Remember one session's repository, keeping the map bounded. */
  function remember(sessionId: string, root: string): void {
    selections.delete(sessionId)
    selections.set(sessionId, root)
    while (selections.size > MAX_SELECTIONS) {
      const oldest = selections.keys().next()
      if (oldest.done === true) break
      selections.delete(oldest.value)
    }
  }

  /**
   * Options for one call, omitting keys the host left at their defaults.
   * @param cwd - Directory to run in.
   * @param optionalLocks - Whether this call may take git's optional locks.
   */
  const options = (cwd: string, optionalLocks: boolean, extras: RunExtras = {}) => ({
    cwd,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    // A call that needs a longer deadline than the host's default says so itself
    // (rewrites do, see REWRITE_TIMEOUT_MS); the spread order lets it win.
    ...(extras.timeoutMs === undefined ? {} : { timeoutMs: extras.timeoutMs }),
    ...(maxStdoutBytes === undefined ? {} : { maxStdoutBytes }),
    // See GitRunOptions.optionalLocks: a read must not rewrite the index the
    // probe watches, and a write must be able to take its lock.
    optionalLocks,
    ...(extras.askpass === undefined ? {} : { askpass: extras.askpass }),
    ...(extras.editor === undefined ? {} : { editor: extras.editor }),
  })

  /**
   * Run a discovery command, answering stdout or `null`.
   *
   * Discovery is a read — `rev-parse` takes no lock — so it must not touch the
   * index the probe watches.
   */
  const capture: RunCapture = async (args, cwd) => {
    const outcome = await runner.run(args, options(cwd, false))
    return outcome.code === 0 ? outcome.stdout : null
  }

  /**
   * Run one git command and classify its outcome.
   *
   * Every call goes through here, so the "git is missing", "git timed out", and
   * "not a repository" mappings exist once rather than at each call site. Calls
   * that tolerate a non-zero exit (asking for a branch's upstream is the common
   * case) check the result themselves instead of relying on this to throw.
   * @param args - Arguments after `git`.
   * @param cwd - Directory to run in.
   * @param optionalLocks - Whether this call may take git's optional locks;
   *   every mutation passes `true`, every read leaves it `false`.
   * @param extras - Credentials, editor suppression, and a longer deadline when
   *   the call needs one.
   * @returns The run, or the panel-level failure it mapped to.
   */
  async function run(
    args: readonly string[],
    cwd: string,
    optionalLocks = false,
    extras: RunExtras = {},
  ): Promise<Result<GitRunResult>> {
    const outcome = await runner.run(args, options(cwd, optionalLocks, extras))

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
      const error = classifyFailure(outcome)
      ports.log('error', `git ${args.join(' ')} failed: ${error.message}`)
      return { ok: false, error }
    }
    return { ok: true, value: outcome }
  }

  /**
   * Resolve a session to its repository root (FR-8).
   *
   * The session's directory is either inside a repository (the common case —
   * including a subdirectory of one, which is why git is asked rather than the
   * path read) or a container holding several, in which case one of them has to
   * be chosen. The choice is remembered **per session**: every entry point in
   * this service takes a session id and nothing else, so a repository parameter
   * would have had to be threaded through all of them, and the wire's whole
   * security argument is that the browser names no path but a session.
   *
   * Until a choice is made, the default is the doc's FR-8.2: the repository whose
   * git state moved most recently. A remembered root that no longer exists (or
   * stopped being a repository) falls back to that default rather than failing,
   * so deleting a repository does not wedge the panel.
   */
  async function repoRoot(sessionId: string): Promise<Result<string>> {
    const directory = await resolver.resolveDir(sessionId)
    if (!directory.ok) {
      selections.delete(sessionId)
      return directory
    }
    const roots = await discoverRepos(capture, directory.value, (message) =>
      ports.log('warn', message),
    )
    if (roots.length === 0) {
      selections.delete(sessionId)
      return fail(
        'not-a-repo',
        'this directory is not inside a git repository, and holds none',
      )
    }
    const chosen = selections.get(sessionId)
    const root = chosen !== undefined && roots.includes(chosen) ? chosen : roots[0]
    if (root === undefined) return fail('not-a-repo', 'git did not report a repository root')
    remember(sessionId, root)
    return { ok: true, value: root }
  }

  /**
   * The repositories this session's directory holds, and the one being read (FR-8).
   * @param sessionId - Session to describe.
   */
  async function listRepos(sessionId: string): Promise<Result<RepoListing>> {
    const directory = await resolver.resolveDir(sessionId)
    if (!directory.ok) {
      selections.delete(sessionId)
      return directory
    }
    const container = directory.value
    const roots = await discoverRepos(capture, container, (message) => ports.log('warn', message))
    const chosen = selections.get(sessionId)
    const selected = chosen !== undefined && roots.includes(chosen) ? chosen : (roots[0] ?? null)
    if (selected !== null) remember(sessionId, selected)
    return {
      ok: true,
      value: {
        container,
        repos: roots.map((root) => ({ root, name: basename(root) })),
        selected,
      },
    }
  }

  /**
   * Point this session's panel at one of the roots {@link listRepos} returned.
   *
   * The root is checked against a fresh discovery rather than trusted, and it
   * must be one of the repositories the host itself found under this session's
   * directory — so the browser can choose, but it cannot name a path of its own
   * (§5.5's rule, kept intact).
   * @param sessionId - Session whose panel is being pointed.
   * @param root - A root from the listing.
   */
  async function selectRepo(sessionId: string, root: string): Promise<Result<void>> {
    if (typeof root !== 'string' || root === '' || !isAbsolute(root)) {
      return fail('bad-request', 'a repository root must be an absolute path')
    }
    const directory = await resolver.resolveDir(sessionId)
    if (!directory.ok) {
      selections.delete(sessionId)
      return directory
    }
    const container = directory.value
    const roots = await discoverRepos(capture, container, (message) =>
      ports.log('warn', message),
    )
    const wanted = await realpath(root).catch(() => '')
    if (wanted === '' || !roots.includes(wanted)) {
      return fail('bad-request', 'that directory is not one of this session’s repositories')
    }
    remember(sessionId, wanted)
    ports.log('info', `git-panel: session reads ${wanted} (container ${container})`)
    return { ok: true, value: undefined }
  }

  /**
   * Read the whole-repository status; shared by `/status` and `stagedPaths`.
   *
   * `-uall` is not decoration: git's own `--untracked-files=normal` default folds
   * a wholly untracked directory into a single `dir/` record, and the panel
   * lists files. A directory path has no diff, no file name in the tree, and one
   * row standing for many files in a stage-all. Every status read passes it so
   * the four callers agree on what "untracked" lists.
   */
  async function readStatus(sessionId: string): Promise<Result<RepoStatus>> {
    const root = await repoRoot(sessionId)
    if (!root.ok) return root
    const outcome = await run(['status', '--porcelain=v2', '--branch', '-z', '-uall'], root.value)
    if (!outcome.ok) return outcome

    const parsed = parseStatusV2(outcome.value.stdout)
    return {
      ok: true,
      value: {
        root: root.value,
        branch: parsed.branch,
        groups: groupsOf(parsed.entries),
        operation: await operationInProgress(root.value),
        // §8.4: a listing cut at the cap is reported as incomplete rather than
        // quietly presented as the whole truth.
        truncated: outcome.value.truncated,
        changedCount: changedPathCount(parsed.entries),
      },
    }
  }

  /**
   * Reduce a successful run to the report the UI shows.
   * @param outcome - The run that succeeded.
   * @returns git's first non-empty line, and everything it printed.
   */
  function reportOf(outcome: GitRunResult): OperationReport {
    const detail = fullOutput(outcome)
    const line = [outcome.stdout, outcome.stderr]
      .flatMap((stream) => stream.split('\n'))
      .map((entry) => entry.trim())
      .find((entry) => entry !== '')
    return { summary: line ?? '', detail }
  }

  /**
   * Read the branch state on its own.
   *
   * The same command {@link readStatus} runs, parsed for one field: the sync
   * operations act on the branch the panel is showing, so asking git again is how
   * they stay in step with it instead of trusting a value from an earlier read.
   * @param cwd - Repository root.
   * @returns The branch, or the failure the command hit.
   */
  async function currentBranch(cwd: string): Promise<Result<BranchInfo>> {
    const outcome = await run(['status', '--porcelain=v2', '--branch', '-z', '-uall'], cwd)
    if (!outcome.ok) return outcome
    return { ok: true, value: parseStatusV2(outcome.value.stdout).branch }
  }

  /**
   * Whether HEAD resolves to a commit.
   *
   * Unstaging is the one operation whose command depends on this: `git restore
   * --staged` restores FROM HEAD, and an unborn branch has none (probed:
   * `fatal: could not resolve HEAD`), so there the index entry is removed
   * instead. The probe runs with a non-zero exit as its "no" answer, which is why
   * it goes to the runner directly rather than through {@link run}.
   * @param cwd - Repository root.
   * @returns Whether a commit exists.
   */
  async function hasHead(cwd: string): Promise<boolean> {
    const outcome = await runner.run(
      ['rev-parse', '--verify', '--quiet', 'HEAD'],
      options(cwd, false),
    )
    return outcome.code === 0
  }

  /**
   * The remote a first push should target.
   *
   * `origin` when it exists — FR-5.2 names it — and otherwise the only remote
   * there is, because a repository cloned from a differently named remote has no
   * obligation to call it `origin` and refusing would make the button useless
   * there. Several remotes with no `origin` is genuinely ambiguous, so that case
   * is refused with a sentence rather than guessed at.
   * @param cwd - Repository root.
   * @returns The remote name, or why there is not one to use.
   */
  async function defaultRemote(cwd: string): Promise<Result<string>> {
    const outcome = await run(['remote'], cwd)
    if (!outcome.ok) return outcome
    const remotes = outcome.value.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '')
    if (remotes.includes('origin')) return { ok: true, value: 'origin' }
    const only = remotes.length === 1 ? remotes[0] : undefined
    if (only === undefined) {
      return fail(
        'bad-request',
        remotes.length === 0
          ? 'this repository has no remote to push to'
          : 'this repository has several remotes and none called origin; set the branch’s upstream first',
      )
    }
    return { ok: true, value: only }
  }

  /**
   * Stage paths (FR-3.1, FR-3.2).
   * @param sessionId - Session whose repository to act on.
   * @param paths - Repo-relative paths from the browser.
   * @returns git's report, or the refusal that kept git from running.
   */
  async function stage(
    sessionId: string,
    paths: readonly string[],
  ): Promise<Result<OperationReport>> {
    const accepted = validatePaths(paths)
    if (!accepted.ok) return accepted
    const root = await repoRoot(sessionId)
    if (!root.ok) return root
    // `--` before the paths: a file named `-f` is a path here, never an option.
    const outcome = await run(['add', '--', ...accepted.value], root.value, true)
    if (!outcome.ok) return outcome
    ports.log('info', `git-panel: staged ${accepted.value.length} path(s) in ${root.value}`)
    return { ok: true, value: reportOf(outcome.value) }
  }

  /**
   * Unstage paths (FR-3.1, FR-3.2).
   * @param sessionId - Session whose repository to act on.
   * @param paths - Repo-relative paths from the browser.
   * @returns git's report, or the refusal that kept git from running.
   */
  async function unstage(
    sessionId: string,
    paths: readonly string[],
  ): Promise<Result<OperationReport>> {
    const accepted = validatePaths(paths)
    if (!accepted.ok) return accepted
    const root = await repoRoot(sessionId)
    if (!root.ok) return root
    const args = (await hasHead(root.value))
      ? ['restore', '--staged', '--', ...accepted.value]
      : // No HEAD to restore from: dropping the entry is the same operation.
        ['rm', '--cached', '-r', '--quiet', '--', ...accepted.value]
    const outcome = await run(args, root.value, true)
    if (!outcome.ok) return outcome
    ports.log('info', `git-panel: unstaged ${accepted.value.length} path(s) in ${root.value}`)
    return { ok: true, value: reportOf(outcome.value) }
  }

  /**
   * Discard the working-tree state of paths (FR-6.1).
   *
   * "Discard" is two commands, and the INDEX decides which path gets which —
   * never the browser's word for it, and never the panel's last read:
   *
   * - **Tracked**: `git restore -- <path>`, which copies the index's version back
   *   over the working tree. Deliberately *not* `--source=HEAD`: an unborn branch
   *   has no HEAD to restore from (probed: `fatal: could not resolve HEAD`), the
   *   same trap §6 documents for `unstage`.
   * - **Untracked**: the index knows nothing about it, so `restore` refuses it
   *   (probed: `pathspec … did not match any file(s) known to git`) and the file
   *   itself is what has to go: `git clean -f -- <path>`. `clean` rather than
   *   `fs.rm`, for the two things it refuses — a path that is in fact tracked
   *   (probed: exit 0, file untouched) and an ignored one (same). A stale request
   *   therefore cannot delete a file the index is still holding on to.
   *
   * A conflicted path is neither case: it is unmerged in the index, and both
   * commands refuse it (`path 'x' is unmerged`) rather than guessing which side
   * the user meant. The panel does not offer discard on a conflicted row —
   * abandoning a conflict is FR-9's decision — so that refusal is the belt to its
   * braces.
   * @param sessionId - Session whose repository to act on.
   * @param paths - Repo-relative paths from the browser.
   * @returns git's report, or the refusal that kept git from running.
   */
  async function discard(
    sessionId: string,
    paths: readonly string[],
  ): Promise<Result<OperationReport>> {
    const accepted = validatePaths(paths)
    if (!accepted.ok) return accepted
    const root = await repoRoot(sessionId)
    if (!root.ok) return root

    // One read of the index answers "which of these does git know?", which is the
    // question the two commands split on. `-z` because a path may hold anything
    // but NUL, and a Set because an unmerged path is listed once per stage.
    const listed = await run(['ls-files', '-z', '--', ...accepted.value], root.value)
    if (!listed.ok) return listed
    const tracked = new Set(listed.value.stdout.split('\0').filter((path) => path !== ''))
    const restore = accepted.value.filter((path) => tracked.has(path))
    const remove = accepted.value.filter((path) => !tracked.has(path))

    const detail: string[] = []
    const lines: string[] = []
    for (const args of [
      restore.length === 0 ? null : ['restore', '--', ...restore],
      remove.length === 0 ? null : ['clean', '-f', '--', ...remove],
    ]) {
      if (args === null) continue
      const outcome = await run(args, root.value, true)
      if (!outcome.ok) return outcome
      detail.push(fullOutput(outcome.value))
      lines.push(...outcome.value.stdout.split('\n'), ...outcome.value.stderr.split('\n'))
    }

    // §7's M5a line: unlike staging, this operation needs an audit that names what
    // was thrown away — the file is gone afterwards, so the log is the only record.
    ports.log(
      'info',
      `git-panel: discarded ${accepted.value.length} path(s) in ${root.value}: ${auditPaths(accepted.value)}`,
    )
    const summary = lines.map((line) => line.trim()).find((line) => line !== '') ?? ''
    return { ok: true, value: { summary, detail: detail.join('') } }
  }

  /**
   * Resolve conflicted paths by accepting one whole side (FR-9.2).
   *
   * Two things make this more than a flag on `restore`:
   *
   * - **Which side "mine" is depends on the operation.** git names the stages
   *   `ours`/`theirs` from the current branch's point of view, but a rebase
   *   replays MY commits onto the other branch, so there `--ours` is the other
   *   side and `--theirs` is mine. The browser sends the user's intent and the
   *   host picks the stage from the operation it re-reads here — the same
   *   execution-time recheck FR-9.4 asks for.
   * - **`restore` alone does not resolve anything.** It writes the chosen stage
   *   over the working tree and leaves the index unmerged; `git add` is what
   *   collapses the three stages. Both run, so one click is one outcome.
   *
   * A path that is not unmerged is refused rather than resolved: `--ours` on a
   * resolved path is not the same command, and a stale click must not overwrite
   * the file with a stage that is no longer the question.
   * @param sessionId - Session whose repository to act on.
   * @param side - Which side the user accepts, in the user's words.
   * @param paths - Repo-relative paths from the browser.
   * @returns git's report, or the refusal that kept git from running.
   */
  async function resolveConflict(
    sessionId: string,
    side: ConflictSide,
    paths: readonly string[],
  ): Promise<Result<OperationReport>> {
    const accepted = validatePaths(paths)
    if (!accepted.ok) return accepted
    const root = await repoRoot(sessionId)
    if (!root.ok) return root

    // Which of these are still unmerged. `git diff --diff-filter=U` answers with
    // raw paths (`-z`), unlike `ls-files -u`, whose records carry a mode/oid/stage
    // prefix and would have to be split on a TAB that a path may itself contain.
    const listed = await run(
      ['diff', '--name-only', '--diff-filter=U', '-z', '--', ...accepted.value],
      root.value,
    )
    if (!listed.ok) return listed
    const unmerged = new Set(listed.value.stdout.split('\0').filter((path) => path !== ''))
    const resolved = accepted.value.filter((path) => !unmerged.has(path))
    if (resolved.length > 0) {
      return fail('bad-request', `not unmerged: ${resolved.join(', ')}`)
    }

    // `--ours` is stage 2 (the current branch) everywhere except a rebase, which
    // replays MY commits onto the other branch and therefore swaps the names.
    const oursIsMine = (await operationInProgress(root.value)) !== 'rebase'
    const flag = (side === 'mine') === oursIsMine ? '--ours' : '--theirs'

    const restored = await run(['restore', flag, '--', ...accepted.value], root.value, true)
    if (!restored.ok) return restored
    const added = await run(['add', '--', ...accepted.value], root.value, true)
    if (!added.ok) return added

    // §7's M5a line: the working-tree content the user had is gone afterwards, so
    // the log is the only record of which side replaced it.
    ports.log(
      'info',
      `git-panel: accepted ${side} for ${accepted.value.length} path(s) in ${root.value}: ${auditPaths(accepted.value)}`,
    )
    const streams = [restored.value, added.value].flatMap((outcome) => [outcome.stdout, outcome.stderr])
    const summary = streams
      .flatMap((stream) => stream.split('\n'))
      .map((line) => line.trim())
      .find((line) => line !== '') ?? ''
    return { ok: true, value: { summary, detail: streams.join('') } }
  }

  /**
   * Commit the index, then read back what git created.
   * @param root - Repository root.
   * @param message - The already-validated message.
   * @returns The commit, so the panel can name it instead of just saying "done".
   */
  async function commitIndex(root: string, message: string): Promise<Result<CommitInfo>> {
    const outcome = await run(['commit', '-m', message], root, true)
    if (!outcome.ok) return outcome
    const head = await run(['log', '-1', '--date=iso-strict', `--format=${LOG_FORMAT}`], root)
    if (!head.ok) return head
    const commit = parseLog(head.value.stdout).commits[0]
    if (commit === undefined) return fail('internal', 'git committed but reported no commit')
    // §5.5's audit trail: which commit, where, and what it says.
    ports.log('info', `git-panel: committed ${commit.shortOid} in ${root}: ${commit.subject}`)
    return { ok: true, value: commit }
  }

  /**
   * Commit what is staged, and only that (FR-3.4's default scope).
   * @param sessionId - Session whose repository to act on.
   * @param message - Raw commit message from the browser.
   */
  async function commit(sessionId: string, message: string): Promise<Result<CommitInfo>> {
    const valid = validateMessage(message)
    if (!valid.ok) return valid
    const root = await repoRoot(sessionId)
    if (!root.ok) return root
    return commitIndex(root.value, valid.value)
  }

  /**
   * Stage every tracked change, then commit (FR-3.4's announced widening).
   * @param sessionId - Session whose repository to act on.
   * @param message - Raw commit message from the browser.
   */
  async function commitAll(sessionId: string, message: string): Promise<Result<CommitInfo>> {
    const valid = validateMessage(message)
    if (!valid.ok) return valid
    const root = await repoRoot(sessionId)
    if (!root.ok) return root
    // `-u` and not `-A`: the button's copy promises tracked changes only, and
    // `-A` would sweep in every untracked file the list shows as excluded — the
    // exact "the list and the commit disagree" failure FR-3.4 exists to prevent.
    const staged = await run(['add', '-u'], root.value, true)
    if (!staged.ok) return staged
    return commitIndex(root.value, valid.value)
  }

  /**
   * The origins of every URL this repository has configured.
   *
   * Read from git's config rather than from an argument the browser sent, so the
   * set of origins a credential may be stored for is the repository's own.
   * `--get-regexp` exits 1 with no output when nothing matches, which is the
   * ordinary "no remote" answer rather than a failure.
   * @param cwd - Repository root.
   * @returns Distinct HTTP(S) origins, in config order.
   */
  async function remoteOrigins(cwd: string): Promise<readonly string[]> {
    const outcome = await runner.run(
      ['config', '--get-regexp', '^remote\\..*\\.(url|pushurl)$'],
      options(cwd, false),
    )
    if (outcome.code !== 0) return []
    const origins = new Set<string>()
    for (const line of outcome.stdout.split('\n')) {
      const url = line.replace(/^\S+\s+/u, '').trim()
      if (url === '') continue
      const origin = originOf(url)
      if (origin !== null) origins.add(origin)
    }
    return [...origins]
  }

  /**
   * Build the askpass payload for one call, from whatever is stored.
   *
   * Resolved per operation, never cached across them: the credential seam's own
   * contract is that a changed value reaches the next operation without a
   * restart, and a cache here would quietly break it. A read that fails is
   * logged and skipped — git then fails with `auth-required`, which is the same
   * place the user would have landed.
   * @param cwd - Repository root.
   * @returns The payload, or `undefined` when no credential applies.
   */
  async function askpassFor(cwd: string): Promise<GitAskPass | undefined> {
    const store = ports.credentials
    if (store === undefined) return undefined
    const found = new Map<string, GitCredential>()
    for (const origin of await remoteOrigins(cwd)) {
      const credential = await store.read(origin)
      if (!credential.ok) {
        ports.log(
          'warn',
          `git-panel: could not read the credential for ${origin}: ${credential.error.message}`,
        )
        continue
      }
      if (credential.value !== null) found.set(origin, credential.value)
    }
    return await buildAskpass(found)
  }

  /**
   * Push the current branch, setting its upstream when it has none (FR-5.2).
   * @param sessionId - Session whose repository to act on.
   */
  async function pushRepo(sessionId: string): Promise<Result<OperationReport>> {
    const root = await repoRoot(sessionId)
    if (!root.ok) return root
    const branch = await currentBranch(root.value)
    if (!branch.ok) return branch
    const info = branch.value
    if (info.head === 'unborn') {
      return fail('bad-request', 'there is nothing to push yet: the branch has no commits')
    }
    if (info.name === null) {
      return fail('bad-request', 'HEAD is detached, so there is no branch to push')
    }
    const args = ['push']
    if (info.upstream === null) {
      const remote = await defaultRemote(root.value)
      if (!remote.ok) return remote
      args.push('--set-upstream', remote.value, info.name)
    }
    const outcome = await run(args, root.value, true, { askpass: await askpassFor(root.value) })
    if (!outcome.ok) return outcome
    ports.log('info', `git-panel: pushed ${info.name} in ${root.value}`)
    return { ok: true, value: reportOf(outcome.value) }
  }

  /**
   * Pull the current branch from its upstream (FR-5.1).
   * @param sessionId - Session whose repository to act on.
   */
  async function pullRepo(sessionId: string): Promise<Result<OperationReport>> {
    const root = await repoRoot(sessionId)
    if (!root.ok) return root
    const branch = await currentBranch(root.value)
    if (!branch.ok) return branch
    const info = branch.value
    if (info.name === null) {
      return fail('bad-request', 'HEAD is detached, so there is no branch to pull into')
    }
    if (info.upstream === null) {
      return fail('bad-request', 'this branch has no upstream to pull from')
    }
    // Two flags, both about not waiting for a terminal that is not there:
    // `--no-rebase` keeps a divergent pull a merge (the doc's own FR-5.1
    // wording), and `--no-edit` stops that merge from asking an editor for its
    // message — without it, `git pull` waits for an editor until the deadline
    // kills it (probed).
    const outcome = await run(
      ['pull', '--no-rebase', '--no-edit'],
      root.value,
      true,
      { askpass: await askpassFor(root.value) },
    )
    if (!outcome.ok) return outcome
    ports.log('info', `git-panel: pulled ${info.name} in ${root.value}`)
    return { ok: true, value: reportOf(outcome.value) }
  }

  /**
   * Fetch every remote, updating the remote-tracking branches.
   *
   * `--all` rather than the default remote: the panel's rail describes one
   * branch, but its ↑/↓ counts, the ○/● markers and the next checkout all read
   * `refs/remotes`, and a repository can track more than one remote. Nothing
   * local is touched, so unlike pull this cannot leave a merge behind.
   *
   * No `--prune`: pruning deletes remote-tracking refs that no longer exist on
   * the remote, which is a change the user did not ask for by pressing fetch.
   * A stale `origin/gone` line is a smaller surprise than a deleted ref.
   * @param sessionId - Session whose repository to act on.
   */
  async function fetchRemotes(sessionId: string): Promise<Result<OperationReport>> {
    const root = await repoRoot(sessionId)
    if (!root.ok) return root
    // `git fetch --all` with no remotes configured exits 0 and prints nothing,
    // so the panel would announce a fetch that never happened. Asking first
    // turns that into the sentence the user needs instead.
    const remotes = await run(['remote'], root.value)
    if (!remotes.ok) return remotes
    if (remotes.value.stdout.trim() === '') {
      return fail('bad-request', 'this repository has no remote to fetch from')
    }
    const outcome = await run(['fetch', '--all'], root.value, true, {
      askpass: await askpassFor(root.value),
    })
    if (!outcome.ok) return outcome
    ports.log('info', `git-panel: fetched every remote in ${root.value}`)
    return { ok: true, value: reportOf(outcome.value) }
  }

  /**
   * Store the credential for one of this repository's remote origins.
   *
   * Two independent checks before anything is written: the shapes (§5.5, via the
   * core validator) and whether the origin is one this repository actually has —
   * the browser sends an origin it read off git's own refusal, but it does not
   * get to decide what this plugin's credential namespace accepts. The audit
   * line names the origin and the repository root, never the value.
   * @param sessionId - Session whose repository the credential is for.
   * @param remote - The origin, as git named it.
   * @param username - The user name to send.
   * @param password - The password or token.
   */
  async function saveCredential(
    sessionId: string,
    remote: string,
    username: string,
    password: string,
  ): Promise<Result<void>> {
    const root = await repoRoot(sessionId)
    if (!root.ok) return root
    const valid = validateCredential(remote, username, password)
    if (!valid.ok) return valid
    const origins = await remoteOrigins(root.value)
    if (!origins.includes(valid.value.origin)) {
      return fail('bad-request', `this repository has no remote at ${valid.value.origin}`)
    }
    const store = ports.credentials
    if (store === undefined) {
      return fail(
        'credentials-unavailable',
        'this deployment has no credential provider, so the credential cannot be saved',
      )
    }
    const saved = await store.save(valid.value.origin, {
      username: valid.value.username,
      password: valid.value.password,
    })
    if (!saved.ok) return saved
    ports.log('info', `git-panel: stored a credential for ${valid.value.origin} in ${root.value}`)
    return { ok: true, value: undefined }
  }

  /**
   * Pull, then push: the doc's `⇅` in one action (FR-5.1).
   * @param sessionId - Session whose repository to act on.
   */
  async function syncRepo(sessionId: string): Promise<Result<OperationReport>> {
    const pulled = await pullRepo(sessionId)
    if (!pulled.ok) return pulled
    const pushed = await pushRepo(sessionId)
    if (!pushed.ok) return pushed
    const summary = [pulled.value.summary, pushed.value.summary]
      .filter((line) => line !== '')
      .join(' · ')
    return {
      ok: true,
      value: { summary, detail: `${pulled.value.detail}${pushed.value.detail}` },
    }
  }

  /**
   * Read one file's diff (FR-2, FR-7.2).
   *
   * Which comparison to make is the caller's decision but the *shape* of the
   * answer is not: `index` diffs the index against HEAD (`--cached`), `worktree`
   * diffs the working tree against the index, and a path git does not track at
   * all is asked for a second time as a diff against nothing, because FR-2.2
   * wants a new file shown as one whole addition rather than as "no changes".
   *
   * A `commit` target is FR-7.2's drill-down and a different kind of question —
   * history, not the working tree — so it takes its own path: `git show <hash> --
   * <path>`, with the commit header suppressed (`--format=`) so the byte budget
   * buys diff rather than a message the view does not draw. `-m --first-parent`
   * is passed for every commit, not only merges: it is inert on a non-merge
   * (git documents `-m` as ignored there) and on a merge it selects the same
   * first-parent diff `showCommit` counts its numstat against, so the file list
   * and the file's diff can never disagree about what the commit did.
   *
   * The command is pinned to a format the parser can read: git's user-level diff
   * configuration is deliberately excluded (`--no-ext-diff`, `--no-textconv`),
   * since an external driver prints a grammar `core/diff-parse.ts` does not know
   * and a textconv would hand the panel the text of a binary file it is supposed
   * to be refusing to render (FR-2.5).
   * @param sessionId - Session whose repository to read from.
   * @param path - Repo-relative path from the browser.
   * @param target - Which comparison to make, and the revision it is against.
   * @param contextLines - Context per hunk; clamped, never rejected.
   * @returns The diff, or the failure that kept git from producing one.
   */
  async function diffPath(
    sessionId: string,
    path: string,
    target: DiffTarget,
    contextLines: number,
  ): Promise<Result<FileDiff>> {
    const accepted = validatePaths([path])
    if (!accepted.ok) return accepted
    const file = accepted.value[0]
    if (file === undefined) return fail('bad-request', 'a path is required')
    const area = target.area
    if (area !== 'worktree' && area !== 'index' && area !== 'commit') {
      return fail('bad-request', `unknown diff area: ${String(area)}`)
    }
    // Validated before any git call and independently of the client's own
    // reading: a hand-written request must not be able to hand git an argument.
    const revision = area === 'commit' ? validateHash(target.hash) : null
    if (revision !== null && !revision.ok) return revision
    const root = await repoRoot(sessionId)
    if (!root.ok) return root

    const context =
      Number.isSafeInteger(contextLines) && contextLines >= 0
        ? Math.min(contextLines, MAX_CONTEXT_LINES)
        : DEFAULT_CONTEXT_LINES
    const format = ['--no-color', '--no-ext-diff', '--no-textconv', `--unified=${context}`]
    const parsed = (text: string, truncated: boolean): Result<FileDiff> => ({
      ok: true,
      value: parseUnifiedDiff(text, { path: file, area, truncated }),
    })

    if (revision !== null) {
      const shown = await run(
        ['show', '--format=', ...format, '-m', '--first-parent', revision.value, '--', file],
        root.value,
      )
      if (!shown.ok) return shown
      return parsed(shown.value.stdout, shown.value.truncated)
    }

    if (area === 'index') {
      const staged = await run(['diff', '--cached', ...format, '--', file], root.value)
      if (!staged.ok) return staged
      return parsed(staged.value.stdout, staged.value.truncated)
    }

    const worktree = await run(['diff', ...format, '--', file], root.value)
    if (!worktree.ok) return worktree
    if (worktree.value.stdout !== '') {
      return parsed(worktree.value.stdout, worktree.value.truncated)
    }

    // Empty output means one of two things `git diff` does not distinguish: the
    // path is unchanged in the working tree, or git does not track it. The index
    // answers that question directly, and costs a call only in the empty case.
    const tracked = await runner.run(
      ['ls-files', '--error-unmatch', '--', file],
      options(root.value, false),
    )
    if (tracked.code === 0) return parsed('', false)

    const fresh = await runner.run(
      ['diff', '--no-index', ...format, '--', '/dev/null', file],
      options(root.value, false),
    )
    if (fresh.spawnFailed) {
      return fail('git-missing', 'git is not installed, or not on this process’ PATH')
    }
    if (fresh.timedOut) {
      ports.log('warn', `git-panel: diff --no-index exceeded its deadline in ${root.value}`)
      return fail('timeout', 'git did not finish in time')
    }
    // `--no-index` exits 1 when the two sides differ, which is the ordinary
    // answer for `/dev/null` against a file with content — not a failure.
    if (fresh.code !== 0 && fresh.code !== 1) {
      const error = classifyFailure(fresh)
      ports.log('error', `git-panel: diff --no-index failed: ${error.message}`)
      return { ok: false, error }
    }
    return parsed(fresh.stdout, fresh.truncated)
  }

  /**
   * Which operation git is part-way through, if any.
   *
   * Each is a marker file (or directory) in the git directory, and none of them
   * is something `git status --porcelain=v2` prints: once every conflicted path
   * has been staged the unmerged list is empty while the operation is still open
   * — which is exactly the state "continue / skip / abort" belongs to. The
   * markers are stat-ed rather than asked about, the same way the git state probe
   * already treats them, and the order below is the order the panel names them.
   * @param root - Repository root.
   * @returns The operation, or `null` when the repository is not part-way through one.
   */
  async function operationInProgress(root: string): Promise<InProgressOperation | null> {
    const dir = await gitDirOf(root)
    const has = async (name: string): Promise<boolean> => {
      try {
        await stat(join(dir, name))
        return true
      } catch {
        return false
      }
    }
    if (await has('MERGE_HEAD')) return 'merge'
    if (await has('REVERT_HEAD')) return 'revert'
    if (await has('CHERRY_PICK_HEAD')) return 'cherry-pick'
    // A rewrite in flight: `rebase-merge` is the interactive backend (what a
    // squash or drop uses), `rebase-apply` the `am` one. Either way it is the
    // rebase the panel must offer to continue, skip or abandon.
    if ((await has('rebase-merge')) || (await has('rebase-apply'))) return 'rebase'
    return null
  }

  /**
   * Whether a local branch of this name exists.
   *
   * Checked before `checkout`, because `git checkout <name>` is also how a
   * branch gets created from a remote-tracking branch — a name the picker does
   * not list must be a refusal, not a new branch.
   * @param root - Repository root.
   * @param name - Already-validated branch name.
   * @returns Whether `refs/heads/<name>` resolves.
   */
  async function localBranchExists(root: string, name: string): Promise<boolean> {
    const outcome = await runner.run(
      ['show-ref', '--verify', '--quiet', `refs/heads/${name}`],
      options(root, false),
    )
    return outcome.code === 0
  }

  /**
   * Switch to an existing local branch (FR-4.1).
   * @param sessionId - Session whose repository to act on.
   * @param name - Local branch name from the browser.
   */
  async function checkout(sessionId: string, name: string): Promise<Result<OperationReport>> {
    const valid = validateBranchName(name)
    if (!valid.ok) return valid
    const root = await repoRoot(sessionId)
    if (!root.ok) return root
    if (!(await localBranchExists(root.value, valid.value))) {
      return fail('bad-request', `there is no local branch called ${valid.value}`)
    }
    // No `--no-guess` (git 2.23+) is needed: the existence check above is what
    // stops `checkout`'s DWIM from creating a branch out of a remote-tracking
    // one, and staying off that flag keeps the plugin's git >= 2.20 promise.
    const outcome = await run(['checkout', valid.value], root.value, true)
    if (!outcome.ok) return outcome
    ports.log('info', `git-panel: checked out ${valid.value} in ${root.value}`)
    return { ok: true, value: reportOf(outcome.value) }
  }

  /**
   * Create a branch and switch to it (FR-4.2).
   * @param sessionId - Session whose repository to act on.
   * @param name - New branch name from the browser.
   * @param base - Branch or commit to start from, or `null` for HEAD.
   */
  async function createBranch(
    sessionId: string,
    name: string,
    base: string | null,
  ): Promise<Result<OperationReport>> {
    const valid = validateBranchName(name)
    if (!valid.ok) return valid
    let start: string | null = null
    if (base !== null && base !== '') {
      const validBase = validateBranchBase(base)
      if (!validBase.ok) return validBase
      start = validBase.value
    }
    const root = await repoRoot(sessionId)
    if (!root.ok) return root
    if (await localBranchExists(root.value, valid.value)) {
      return fail('bad-request', `a branch called ${valid.value} already exists`)
    }
    const args =
      start === null
        ? ['checkout', '-b', valid.value]
        : ['checkout', '-b', valid.value, start]
    const outcome = await run(args, root.value, true)
    if (!outcome.ok) return outcome
    ports.log(
      'info',
      `git-panel: created branch ${valid.value}${start === null ? '' : ` from ${start}`} in ${root.value}`,
    )
    return { ok: true, value: reportOf(outcome.value) }
  }

  /**
   * Delete a local branch (FR-4.3).
   * @param sessionId - Session whose repository to act on.
   * @param name - Local branch name from the browser.
   * @param force - Whether an unmerged branch may be discarded.
   */
  async function deleteBranch(
    sessionId: string,
    name: string,
    force: boolean,
  ): Promise<Result<OperationReport>> {
    const valid = validateBranchName(name)
    if (!valid.ok) return valid
    const root = await repoRoot(sessionId)
    if (!root.ok) return root
    // Checked here rather than left to git: the panel should say which rule was
    // broken, and "the branch you are on" is not the interesting refusal — the
    // unmerged one is, because that is the one that offers to force.
    const current = await currentBranch(root.value)
    if (current.ok && current.value.name === valid.value) {
      return fail('bad-request', 'the branch currently checked out cannot be deleted')
    }
    // `-d` refuses an unmerged branch with `not-merged` (see FAILURE_PATTERNS),
    // and `-D` is the armed second click of FR-4.3.
    const outcome = await run(['branch', force ? '-D' : '-d', valid.value], root.value, true)
    if (!outcome.ok) return outcome
    // §5.5's audit trail: a deletion names the branch and the repository.
    ports.log(
      'info',
      `git-panel: deleted branch ${valid.value}${force ? ' (forced)' : ''} in ${root.value}`,
    )
    return { ok: true, value: reportOf(outcome.value) }
  }

  /**
   * Resolve the operation a continue / skip / abort is meant for.
   *
   * The kind the browser sent is a claim about what it last saw, and the host
   * re-reads its own state and requires the two to agree: running the wrong
   * `--abort` — a `merge --abort` for a stopped cherry-pick, say — is not a
   * refusal the user could recover from, so it must not be reachable.
   * @param root - Repository root.
   * @param kind - The operation the panel believes is in progress.
   * @returns The confirmed kind, or the refusal.
   */
  async function requireOperation(
    root: string,
    kind: InProgressOperation,
  ): Promise<Result<InProgressOperation>> {
    const actual = await operationInProgress(root)
    if (actual === null) {
      return fail('bad-request', 'no operation is in progress')
    }
    if (actual !== kind) {
      return fail('bad-request', `a ${actual} is in progress, not a ${kind}`)
    }
    return { ok: true, value: actual }
  }

  /**
   * Conclude an in-progress operation whose conflicts are all resolved.
   *
   * A merge is concluded with git's own `MERGE_MSG` (`commit --no-edit`), which
   * is what the panel has always done. The other three have a `--continue` of
   * their own — the one that knows how to advance a sequencer — and it may open
   * a message editor, which `editor: {}` is there to keep from waiting for a
   * terminal.
   * @param sessionId - Session whose repository to act on.
   * @param kind - Which operation the panel believes is in progress.
   */
  async function continueOperation(
    sessionId: string,
    kind: InProgressOperation,
  ): Promise<Result<OperationReport>> {
    const valid = validateOperationKind(kind)
    if (!valid.ok) return valid
    const root = await repoRoot(sessionId)
    if (!root.ok) return root
    const current = await requireOperation(root.value, valid.value)
    if (!current.ok) return current
    const outcome =
      valid.value === 'merge'
        ? await run(['commit', '--no-edit'], root.value, true)
        : await run([valid.value, '--continue'], root.value, true, { editor: {} })
    if (!outcome.ok) return outcome
    ports.log('info', `git-panel: continued the ${valid.value} in ${root.value}`)
    return { ok: true, value: reportOf(outcome.value) }
  }

  /**
   * Skip the commit blocking an in-progress rebase.
   *
   * Only a rebase has this move, and it is the one that gets a user out of a
   * pick which became empty — `--continue` would fail on it and `--abort` would
   * throw the whole rewrite away.
   * @param sessionId - Session whose repository to act on.
   * @param kind - Which operation the panel believes is in progress.
   */
  async function skipOperation(
    sessionId: string,
    kind: InProgressOperation,
  ): Promise<Result<OperationReport>> {
    const valid = validateOperationKind(kind)
    if (!valid.ok) return valid
    if (valid.value !== 'rebase') {
      return fail('bad-request', `only a rebase has a commit to skip, not a ${valid.value}`)
    }
    const root = await repoRoot(sessionId)
    if (!root.ok) return root
    const current = await requireOperation(root.value, valid.value)
    if (!current.ok) return current
    const outcome = await run(['rebase', '--skip'], root.value, true, { editor: {} })
    if (!outcome.ok) return outcome
    ports.log('info', `git-panel: skipped a commit in the rebase in ${root.value}`)
    return { ok: true, value: reportOf(outcome.value) }
  }

  /**
   * Abandon an in-progress operation (FR-9.3 and the rewriting operations).
   *
   * Each kind answers to its own `--abort`, and the git subcommand has the same
   * name as the kind here — that is exactly why the kind is re-checked before it
   * is used as one.
   * @param sessionId - Session whose repository to act on.
   * @param kind - Which operation the panel believes is in progress.
   */
  async function abortOperation(
    sessionId: string,
    kind: InProgressOperation,
  ): Promise<Result<OperationReport>> {
    const valid = validateOperationKind(kind)
    if (!valid.ok) return valid
    const root = await repoRoot(sessionId)
    if (!root.ok) return root
    const current = await requireOperation(root.value, valid.value)
    if (!current.ok) return current
    const outcome = await run([valid.value, '--abort'], root.value, true)
    if (!outcome.ok) return outcome
    ports.log('info', `git-panel: aborted the ${valid.value} in ${root.value}`)
    return { ok: true, value: reportOf(outcome.value) }
  }

  /**
   * Write a commit message for the staged diff, with the language model (FR-3.5).
   *
   * The doc's own cost rule (§8.3) is what shapes this: the diff is truncated to
   * a budget, the prompt is built by a pure function, and the answer is cleaned
   * before it reaches the box. Nothing is committed, and a trimmed diff is
   * reported so the panel can say the message was written from part of the change.
   * @param sessionId - Session whose repository to describe.
   * @param locale - BCP-47 tag, so the message is written in the panel's language.
   */
  async function generateCommitMessage(
    sessionId: string,
    locale: string,
  ): Promise<Result<GeneratedMessage>> {
    const root = await repoRoot(sessionId)
    if (!root.ok) return root
    const staged = await run(
      ['diff', '--cached', '--no-color', '--no-ext-diff', '--no-textconv', '--unified=3'],
      root.value,
    )
    if (!staged.ok) return staged
    if (staged.value.stdout.trim() === '') {
      return fail('bad-request', 'there is nothing staged to describe')
    }

    const { text, truncated } = truncateDiff(staged.value.stdout)
    const answer = await ports.generateText(
      buildCommitMessagePrompt(text, typeof locale === 'string' ? locale : '', truncated),
    )
    if (!answer.ok) return answer
    const message = cleanCommitMessage(answer.value)
    if (message === '') {
      return fail('internal', 'the model answered with nothing that can be a commit message')
    }
    ports.log('info', `git-panel: generated a commit message in ${root.value}`)
    return { ok: true, value: { message, truncated } }
  }

  /**
   * Read one commit's metadata by hash.
   *
   * One `log -1` in the same format the history list uses, so a row and the
   * operations acting on it can never describe different commits. An unknown
   * hash is a refusal with a sentence rather than git's exit code, because every
   * rewriting operation starts here and "no such commit" is the user's to fix.
   * @param root - Repository root.
   * @param hash - Already-validated commit hash.
   * @returns The commit, or the refusal.
   */
  async function readCommit(root: string, hash: string): Promise<Result<CommitInfo>> {
    const meta = await run(
      ['log', '-1', '--date=iso-strict', `--format=${LOG_FORMAT}`, hash],
      root,
    )
    if (!meta.ok) return meta
    const commit = parseLog(meta.value.stdout).commits[0]
    if (commit === undefined) {
      return fail('bad-request', `no commit matches ${hash}`)
    }
    return { ok: true, value: commit }
  }

  /**
   * Read one commit's metadata and its file list (FR-3.6).
   *
   * The metadata comes from the same `LOG_FORMAT` the list is parsed with, so a
   * detail row can never disagree with the row it was opened from. The file list
   * is `--numstat`, which carries both counts and git's own "binary" answer.
   * @param sessionId - Session whose repository to read.
   * @param hash - Commit hash from the browser.
   */
  async function showCommit(sessionId: string, hash: string): Promise<Result<CommitDetail>> {
    const valid = validateHash(hash)
    if (!valid.ok) return valid
    const root = await repoRoot(sessionId)
    if (!root.ok) return root

    const commit = await readCommit(root.value, valid.value)
    if (!commit.ok) return commit

    // A merge has two diffs and `git show` prints neither by default; against
    // the first parent is the one every forge shows, so that is the one the
    // detail lists. A normal commit needs no flag at all.
    const stats = await run(
      commit.value.parents.length > 1
        ? ['show', '--numstat', '--format=', '-m', '--first-parent', valid.value]
        : ['show', '--numstat', '--format=', valid.value],
      root.value,
    )
    if (!stats.ok) return stats
    return { ok: true, value: { commit: commit.value, files: parseNumstat(stats.value.stdout) } }
  }

  /**
   * Undo the newest commit (FR-3.8).
   *
   * Everything the decision rests on is re-read HERE, at execution time — the
   * hash the browser sent is only a claim about which row was clicked, and the
   * pushed state in the panel's last reading is exactly as old as that reading:
   *
   * - HEAD is re-resolved and must equal the sent hash. A row that is no longer
   *   the newest (an agent committed in the meantime, or the panel was stale) is
   *   refused rather than silently undoing a commit nobody pointed at.
   * - The pushed question is asked of the repository, not of the client's
   *   marker: the commit is "published" exactly when the branch's upstream
   *   contains it (`merge-base --is-ancestor`). The same basis the ○/● marker
   *   uses, so the two can never disagree about what happened next.
   *
   * The two undo paths are the doc's own: unpublished → `reset --mixed HEAD~1`,
   * which moves the branch back and leaves the commit's changes in the working
   * tree; published → `revert --no-edit`, a NEW commit that undoes the old one,
   * because the published history is not this panel's to rewrite. Erring towards
   * reset is the safe direction (it touches nothing remote), so an upstream ref
   * that cannot be resolved at all — a gone upstream, say — counts as
   * unpublished.
   *
   * Two commits are refused outright: the FIRST commit on the unpublished path
   * (there is no `HEAD~1` to reset to; unmaking the branch is a different
   * decision than undoing a commit), and a MERGE on the published path (a revert
   * needs `-m` and a mainline choice, which is the user's to make in a terminal,
   * not the panel's to guess). A reset of a merge commit is fine and allowed.
   * @param sessionId - Session whose repository to act on.
   * @param hash - The hash of the commit the browser believes is newest.
   */
  async function undoCommit(sessionId: string, hash: string): Promise<Result<UndoResult>> {
    const valid = validateHash(hash)
    if (!valid.ok) return valid
    const root = await repoRoot(sessionId)
    if (!root.ok) return root
    const branch = await currentBranch(root.value)
    if (!branch.ok) return branch
    const info = branch.value
    if (info.head === 'unborn') {
      return fail('bad-request', 'there is no commit to undo yet')
    }
    if (info.head !== 'branch') {
      return fail('bad-request', 'HEAD is detached, so there is no branch whose newest commit to undo')
    }

    // The host, not the browser, says which commit is newest: the row the click
    // came from may predate a commit that landed since.
    const head = await run(['rev-parse', 'HEAD'], root.value)
    if (!head.ok) return head
    const headOid = head.value.stdout.trim()
    if (headOid !== valid.value) {
      return fail('bad-request', 'that commit is no longer the newest one')
    }

    // One read answers both questions the paths below need: the subject the
    // audit names, and the parents that decide the two refusals.
    const meta = await run(['log', '-1', '--date=iso-strict', `--format=${LOG_FORMAT}`], root.value)
    if (!meta.ok) return meta
    const commit = parseLog(meta.value.stdout).commits[0]
    if (commit === undefined) {
      return fail('internal', 'git reported a HEAD it could not describe')
    }

    let published = false
    if (info.upstream !== null) {
      // `--is-ancestor` exits 1 for "not contained" and non-zero at large for an
      // unresolvable upstream; both read as "not published", which is the safe
      // side — reset touches nothing remote.
      const contained = await runner.run(
        ['merge-base', '--is-ancestor', headOid, info.upstream],
        options(root.value, false),
      )
      published = contained.code === 0
    }

    if (!published) {
      if (commit.parents.length === 0) {
        return fail(
          'bad-request',
          'the newest commit is also the first one; undoing it would unmake the branch',
        )
      }
      const outcome = await run(['reset', '--mixed', 'HEAD~1'], root.value, true)
      if (!outcome.ok) return outcome
      // §5.5's audit trail: which commit, where, and which way it went.
      ports.log('info', `git-panel: undid ${commit.shortOid} in ${root.value} via reset: ${commit.subject}`)
      return { ok: true, value: { mode: 'reset', shortOid: commit.shortOid, subject: commit.subject } }
    }

    if (commit.parents.length > 1) {
      return fail(
        'bad-request',
        'the newest commit is a published merge; reverting it needs a mainline choice (git revert -m), which is a terminal’s business',
      )
    }
    const outcome = await run(['revert', '--no-edit', headOid], root.value, true)
    if (!outcome.ok) return outcome
    ports.log('info', `git-panel: undid ${commit.shortOid} in ${root.value} via revert: ${commit.subject}`)
    return { ok: true, value: { mode: 'revert', shortOid: commit.shortOid, subject: commit.subject } }
  }

  /**
   * Create a NEW commit that reverses one existing commit — "还原此提交".
   *
   * Acts on any commit, and never rewrites history: the reversal is a commit of
   * its own, so this is safe on a published branch. A merge commit is refused
   * for the reason {@link undoCommit} refuses one — reversing it needs `-m` and
   * a mainline choice.
   * @param sessionId - Session whose repository to act on.
   * @param hash - The commit to reverse.
   */
  async function revertCommit(sessionId: string, hash: string): Promise<Result<OperationReport>> {
    const valid = validateHash(hash)
    if (!valid.ok) return valid
    const root = await repoRoot(sessionId)
    if (!root.ok) return root
    const commit = await readCommit(root.value, valid.value)
    if (!commit.ok) return commit
    if (commit.value.parents.length > 1) {
      return fail(
        'bad-request',
        'that is a merge commit; reversing one needs a mainline choice (git revert -m), which is a terminal’s business',
      )
    }
    const outcome = await run(['revert', '--no-edit', valid.value], root.value, true)
    if (!outcome.ok) return outcome
    // §5.5's audit trail: which commit, where, and that it was a reversal.
    ports.log(
      'info',
      `git-panel: reverted ${commit.value.shortOid} in ${root.value}: ${commit.value.subject}`,
    )
    return { ok: true, value: reportOf(outcome.value) }
  }

  /**
   * Apply one commit's changes to the current branch — "捡取此提交".
   *
   * A merge commit is refused for the same reason as {@link revertCommit}. When
   * git finds nothing to apply it stops with its sequencer still open — but
   * nothing was applied, so the half-started state is abandoned here rather than
   * handed to the panel as an operation with nothing to do.
   * @param sessionId - Session whose repository to act on.
   * @param hash - The commit to pick.
   */
  async function cherryPick(sessionId: string, hash: string): Promise<Result<OperationReport>> {
    const valid = validateHash(hash)
    if (!valid.ok) return valid
    const root = await repoRoot(sessionId)
    if (!root.ok) return root
    const commit = await readCommit(root.value, valid.value)
    if (!commit.ok) return commit
    if (commit.value.parents.length > 1) {
      return fail(
        'bad-request',
        'that is a merge commit; picking one needs a mainline choice (git cherry-pick -m), which is a terminal’s business',
      )
    }
    const outcome = await run(['cherry-pick', valid.value], root.value, true)
    if (!outcome.ok) {
      // git's own words for "the change is already here" — the only failure that
      // leaves a sequencer with nothing in it.
      if (/cherry-pick is now empty/iu.test(outcome.error.detail ?? '')) {
        await run(['cherry-pick', '--abort'], root.value, true)
        return fail(
          'bad-request',
          'that commit’s changes are already present here, so there was nothing to pick',
        )
      }
      return outcome
    }
    ports.log(
      'info',
      `git-panel: picked ${commit.value.shortOid} in ${root.value}: ${commit.value.subject}`,
    )
    return { ok: true, value: reportOf(outcome.value) }
  }

  /**
   * Move the current branch to a commit — "重置到此提交".
   *
   * git decides what survives: `soft` keeps the index and the working tree,
   * `mixed` keeps the working tree, `hard` keeps neither. The mode is re-checked
   * here rather than trusted (it becomes a flag), and the target is read first so
   * an unknown hash is a sentence instead of a process.
   * @param sessionId - Session whose repository to act on.
   * @param hash - Where the branch should point.
   * @param mode - How much of the current state to keep.
   */
  async function resetTo(
    sessionId: string,
    hash: string,
    mode: ResetMode,
  ): Promise<Result<OperationReport>> {
    const validHash = validateHash(hash)
    if (!validHash.ok) return validHash
    const validMode = validateResetMode(mode)
    if (!validMode.ok) return validMode
    const root = await repoRoot(sessionId)
    if (!root.ok) return root
    const commit = await readCommit(root.value, validHash.value)
    if (!commit.ok) return commit
    const outcome = await run(
      ['reset', `--${validMode.value}`, validHash.value],
      root.value,
      true,
    )
    if (!outcome.ok) return outcome
    // §5.5's audit trail: where the branch moved to, and how much was kept.
    ports.log(
      'info',
      `git-panel: reset to ${commit.value.shortOid} (--${validMode.value}) in ${root.value}: ${commit.value.subject}`,
    )
    return { ok: true, value: reportOf(outcome.value) }
  }

  /**
   * Rewrite one commit away — fold it into its parent, or drop it.
   *
   * Both are a rebase of the current branch, and every refusal below exists
   * because a rebase would otherwise succeed at something the user did not ask
   * for:
   *
   * - a **merge commit** as the target has no single parent to fold into or
   *   rebase onto;
   * - a target that is **not an ancestor of HEAD** is not part of this branch,
   *   so "rewriting" it would mean something else entirely;
   * - a **merge commit after the target** would be flattened, because a plain
   *   `rebase` linearises — the panel does not do that on the user's behalf;
   * - a **detached HEAD** has no branch to move, and an **operation already in
   *   progress** owns the worktree.
   *
   * A fold keeps the PARENT's message: the panel cannot edit messages, and a
   * predictable result beats git's concatenation template (see the plan's D48).
   * @param sessionId - Session whose repository to act on.
   * @param hash - The commit to rewrite away.
   * @param action - Whether to fold it into its parent or drop it.
   */
  async function rewriteCommit(
    sessionId: string,
    hash: string,
    action: RewriteAction,
  ): Promise<Result<OperationReport>> {
    const validHash = validateHash(hash)
    if (!validHash.ok) return validHash
    const validAction = validateRewriteAction(action)
    if (!validAction.ok) return validAction

    const root = await repoRoot(sessionId)
    if (!root.ok) return root
    // Checked before the branch shape: a rebase leaves HEAD detached, so a
    // rewrite attempted during one would otherwise be refused for the wrong
    // reason ("no branch to rewrite") instead of the true one.
    const active = await operationInProgress(root.value)
    if (active !== null) {
      return fail('bad-request', `a ${active} is in progress; finish or abandon it first`)
    }
    const branch = await currentBranch(root.value)
    if (!branch.ok) return branch
    if (branch.value.head === 'unborn') {
      return fail('bad-request', 'this branch has no commits to rewrite yet')
    }
    if (branch.value.head !== 'branch') {
      return fail('bad-request', 'HEAD is detached, so there is no branch to rewrite')
    }

    const target = await readCommit(root.value, validHash.value)
    if (!target.ok) return target
    if (target.value.parents.length > 1) {
      return fail('bad-request', 'that is a merge commit; the panel does not rewrite a merge')
    }
    const ancestor = await runner.run(
      ['merge-base', '--is-ancestor', validHash.value, 'HEAD'],
      options(root.value, false),
    )
    if (ancestor.code !== 0) {
      return fail('bad-request', 'that commit is not in this branch’s history')
    }
    const merges = await run(['rev-list', '--merges', `${validHash.value}..HEAD`], root.value)
    if (!merges.ok) return merges
    if (merges.value.stdout.trim() !== '') {
      return fail(
        'bad-request',
        'there are merge commits after it, and rewriting them would flatten the branch',
      )
    }

    const parent = target.value.parents[0]
    if (parent === undefined) {
      return fail(
        'bad-request',
        validAction.value === 'drop'
          ? 'that is the first commit; there is no parent to rebase it away onto'
          : 'that is the first commit; there is no parent to fold it into',
      )
    }

    if (validAction.value === 'drop') {
      // Replay everything after the target onto its parent: the target itself is
      // the excluded end of the range, so it simply never comes back.
      const outcome = await run(
        ['rebase', '--onto', parent, validHash.value],
        root.value,
        true,
        { timeoutMs: REWRITE_TIMEOUT_MS },
      )
      if (!outcome.ok) return outcome
      ports.log(
        'info',
        `git-panel: dropped ${target.value.shortOid} in ${root.value}: ${target.value.subject}`,
      )
      return { ok: true, value: reportOf(outcome.value) }
    }

    // A fold is `git rebase -i` with the target's line changed to `fixup`. The
    // base is the parent's parent, because a todo's first line has nothing to
    // fold into; when the parent IS the root there is no such base and git's
    // `--root` lists the root commit as the first line instead. The flags pin
    // down everything a user's config could otherwise change: auto-squash could
    // reorder the todo, rebase-merges would add lines the rewrite does not
    // reason about, and auto-stash would quietly accept a dirty worktree.
    const parentCommit = await readCommit(root.value, parent)
    if (!parentCommit.ok) return parentCommit
    const grandparent = parentCommit.value.parents[0]
    const editor = await buildSequenceEditor({
      target: validHash.value,
      previous: parent,
      action: 'fixup',
    })
    const outcome = await run(
      [
        'rebase',
        '--interactive',
        '--no-autosquash',
        '--no-rebase-merges',
        '--no-autostash',
        ...(grandparent === undefined ? ['--root'] : [grandparent]),
      ],
      root.value,
      true,
      { timeoutMs: REWRITE_TIMEOUT_MS, editor },
    )
    if (!outcome.ok) return outcome
    ports.log(
      'info',
      `git-panel: squashed ${target.value.shortOid} into ${parentCommit.value.shortOid} in ${root.value}: ${target.value.subject}`,
    )
    return { ok: true, value: reportOf(outcome.value) }
  }

  /**
   * Read the stash stack, newest first (FR-6.2).
   *
   * `git stash list` walks `refs/stash`'s reflog, so a repository that has never
   * stashed — and an unborn branch, where there is nothing to stash from — answers
   * with an empty list rather than a failure.
   * @param root - Repository root.
   * @returns The entries, or the failure the command hit.
   */
  async function readStashes(root: string): Promise<Result<readonly StashEntry[]>> {
    const outcome = await run(['stash', 'list', `--format=${STASH_FORMAT}`], root)
    if (!outcome.ok) return outcome
    return { ok: true, value: parseStashList(outcome.value.stdout) }
  }

  /**
   * Resolve an object id to the stash entry it names.
   *
   * This is the other half of {@link validateHash}: the browser sends the id of the
   * entry its row stood for, and the host answers from its OWN reading. A selector
   * is a position in a stack that another window can shift — `stash@{0}` is a
   * different stash after one more `git stash push` — so the id is what identifies
   * the entry, and the selector used to act on it is read here rather than taken
   * from the request.
   * @param root - Repository root.
   * @param oid - The full object id the browser sent, already validated.
   * @returns The entry, or the refusal that it is no longer there.
   */
  async function findStash(root: string, oid: string): Promise<Result<StashEntry>> {
    const listed = await readStashes(root)
    if (!listed.ok) return listed
    const found = listed.value.find((entry) => entry.oid === oid)
    if (found === undefined) {
      return fail('bad-request', 'that stash is no longer in the list')
    }
    return { ok: true, value: found }
  }

  /**
   * Push the working tree onto the stash (FR-6.2).
   *
   * Whether there is anything to stash is asked of the REPOSITORY, not of the
   * browser: `git stash push` answers "No local changes to save" on an empty
   * worktree and still exits 0, which would let the panel announce a stash that
   * never happened. One `status` read decides it, by the same rule the two commands
   * split on — and the rule is the flag's: untracked files count only when this
   * call was asked to include them.
   * @param sessionId - Session whose repository to act on.
   * @param message - Optional label, already accepted as a string or `null`.
   * @param untracked - Whether untracked files are stashed too (`-u`).
   */
  async function stashSave(
    sessionId: string,
    message: string | null,
    untracked: boolean,
  ): Promise<Result<OperationReport>> {
    const valid = validateStashMessage(message)
    if (!valid.ok) return valid
    const root = await repoRoot(sessionId)
    if (!root.ok) return root

    const status = await run(['status', '--porcelain=v2', '--branch', '-z', '-uall'], root.value)
    if (!status.ok) return status
    const groups = groupsOf(parseStatusV2(status.value.stdout).entries)
    const tracked = groups.staged.length + groups.unstaged.length + groups.conflicted.length
    if (tracked === 0 && !(untracked && groups.untracked.length > 0)) {
      return fail(
        'bad-request',
        untracked
          ? 'there is nothing to stash'
          : 'there is nothing to stash: only untracked files, which this stash does not include',
      )
    }

    const outcome = await run(
      [
        'stash',
        'push',
        ...(untracked ? ['-u'] : []),
        ...(valid.value === null ? [] : ['-m', valid.value]),
      ],
      root.value,
      true,
    )
    if (!outcome.ok) return outcome
    // §5.5's audit trail: where, with which label, and whether untracked files went
    // with it — the entry itself is in `refs/stash`, but which click put it there
    // is not.
    ports.log(
      'info',
      `git-panel: stashed${untracked ? ' (untracked included)' : ''} in ${root.value}${
        valid.value === null ? '' : ` as "${valid.value}"`
      }`,
    )
    return { ok: true, value: reportOf(outcome.value) }
  }

  /**
   * Apply one stash, optionally dropping it (FR-6.2).
   *
   * The entry is found again at execution time ({@link findStash}), so a row the
   * panel drew before another window stashed something is refused rather than
   * applied by position. `pop` removes the entry only when git did apply it: a
   * conflicting pop leaves the stash in place, which is git's own answer and the
   * reason `pop` is not the same promise as `drop`.
   * @param sessionId - Session whose repository to act on.
   * @param oid - The stash commit the browser believes it is acting on.
   * @param pop - Whether to drop the entry once it applied cleanly.
   */
  async function stashApply(
    sessionId: string,
    oid: string,
    pop: boolean,
  ): Promise<Result<OperationReport>> {
    const valid = validateHash(oid)
    if (!valid.ok) return valid
    const root = await repoRoot(sessionId)
    if (!root.ok) return root
    const entry = await findStash(root.value, valid.value)
    if (!entry.ok) return entry
    const outcome = await run(
      ['stash', pop ? 'pop' : 'apply', entry.value.selector],
      root.value,
      true,
    )
    if (!outcome.ok) return outcome
    // §5.5's audit trail: which entry, by id, and which of the two ways it went.
    ports.log(
      'info',
      `git-panel: ${pop ? 'popped' : 'applied'} ${entry.value.selector} (${entry.value.shortOid}) in ${root.value}`,
    )
    return { ok: true, value: reportOf(outcome.value) }
  }

  /**
   * Drop one stash entry without applying it (FR-6.2).
   *
   * Destructive: the stashed commits lose their only ref and are garbage once the
   * reflog expires, so the panel arms it behind §4.3's two clicks and this records
   * which entry went — by selector, id, and subject, since the row is gone from the
   * list afterwards.
   * @param sessionId - Session whose repository to act on.
   * @param oid - The stash commit the browser believes it is acting on.
   */
  async function stashDrop(sessionId: string, oid: string): Promise<Result<OperationReport>> {
    const valid = validateHash(oid)
    if (!valid.ok) return valid
    const root = await repoRoot(sessionId)
    if (!root.ok) return root
    const entry = await findStash(root.value, valid.value)
    if (!entry.ok) return entry
    const outcome = await run(['stash', 'drop', entry.value.selector], root.value, true)
    if (!outcome.ok) return outcome
    // §5.5's audit trail: the log line is the only record of what was dropped.
    ports.log(
      'info',
      `git-panel: dropped ${entry.value.selector} (${entry.value.shortOid}) in ${root.value}: ${entry.value.subject}`,
    )
    return { ok: true, value: reportOf(outcome.value) }
  }

  return {
    status: readStatus,
    diff: diffPath,
    stage,
    unstage,
    discard,
    resolveConflict,
    commit,
    commitAll,
    push: pushRepo,
    pull: pullRepo,
    fetch: fetchRemotes,
    sync: syncRepo,
    saveCredential,
    checkout,
    createBranch,
    deleteBranch,
    continueOperation,
    skipOperation,
    abortOperation,
    generateCommitMessage,
    showCommit,
    undoCommit,
    revertCommit,
    cherryPick,
    resetTo,
    rewriteCommit,
    stashes: async (sessionId: string): Promise<Result<readonly StashEntry[]>> => {
      const root = await repoRoot(sessionId)
      if (!root.ok) return root
      return readStashes(root.value)
    },
    stashSave,
    stashApply,
    stashDrop,

    repos: listRepos,
    selectRepo,

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

    async remoteBranches(sessionId: string): Promise<Result<readonly RemoteBranchRef[]>> {
      const root = await repoRoot(sessionId)
      if (!root.ok) return root
      // A read: `for-each-ref` never writes the index, so it keeps the default
      // `optionalLocks = false` and leaves the probe's watched files alone.
      const outcome = await run(
        ['for-each-ref', `--format=${REMOTE_BRANCH_FORMAT}`, 'refs/remotes'],
        root.value,
      )
      if (!outcome.ok) return outcome
      return { ok: true, value: parseRemoteBranches(outcome.value.stdout) }
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

      // Decorate the page with the refs pointing at its commits. Read from the
      // ref namespaces rather than from `%d`/`%D`, because a decoration string
      // does not say whether `origin/x` is a remote-tracking branch or a local
      // branch whose name happens to contain a slash (see `parseRefs`). One read
      // covers the whole page; a failure costs the decoration, not the row.
      const refsRun = await runner.run(
        ['for-each-ref', `--format=${REFS_FORMAT}`, 'refs/heads', 'refs/remotes', 'refs/tags'],
        options(root.value, false),
      )
      const refs = refsRun.code === 0 ? parseRefs(refsRun.stdout) : undefined

      // Settle the ○/● marker from the same status read the panel already needs.
      const statusRun = await runner.run(
        ['status', '--porcelain=v2', '--branch', '-z', '-uall'],
        options(root.value, false),
      )
      let commits = refs === undefined ? page : withRefs(page, refs)
      if (statusRun.code === 0) {
        const branch = parseStatusV2(statusRun.stdout).branch
        if (branch.upstream === null) {
          // Without an upstream the question is unanswerable, so the marker
          // stays absent rather than claiming every commit is unpushed.
          // (`commits` already carries the decorations.)
        } else if (branch.ahead > 0) {
          // Bounded by the ahead count: usually a handful of commits.
          const unpushedRun = await runner.run(
            ['log', `${branch.upstream}..HEAD`, '--format=%H'],
            options(root.value, false),
          )
          if (unpushedRun.code === 0) {
            const unpushed = new Set(unpushedRun.stdout.split('\n').filter((line) => line !== ''))
            commits = markPushed(commits, unpushed)
          }
        } else {
          commits = commits.map((commit) => ({ ...commit, pushed: true }))
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
