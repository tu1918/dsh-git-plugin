/**
 * Every interface the core exposes to the halves that host it (§5.2, doc v0.2).
 *
 * The dependency rule this file exists to enforce: the git business logic and
 * the React components depend on THESE interfaces, never on cordis, DSH, or
 * `window.__DSH_*`. Only `src/host/adapter/` and `src/client/adapter/` may name
 * a DSH API, and their job is to satisfy the shapes below.
 *
 * @module dsh-git-panel/core/ports
 */

import type {
  BranchRef,
  CommitDetail,
  CommitFileStat,
  CommitInfo,
  ConflictSide,
  DiffTarget,
  FileChange,
  FileDiff,
  GeneratedMessage,
  InProgressOperation,
  LogLevel,
  LogPage,
  OperationReport,
  RemoteBranchRef,
  RepoListing,
  RepoStatus,
  ResetMode,
  RewriteAction,
  StashEntry,
  UndoResult,
} from './types.ts'

// Re-exported so the wire contract stays one import for the halves that
// implement it; the shapes themselves live with the rest of the domain model.
export type { CommitDetail, CommitFileStat }

/**
 * A failure the panel can show, in the panel's own vocabulary.
 *
 * `detail` carries a multi-line `git` diagnostic verbatim (FR-4.4: the switch
 * failure's full output must survive to the screen), so the UI never has to
 * reconstruct what git said.
 */
export interface GitPanelError {
  /** Stable machine code, so the UI can branch without matching on prose. */
  readonly code: GitErrorCode
  /** One-line message for the operation's own row. */
  readonly message: string
  /** Raw multi-line git output, when there is any. */
  readonly detail?: string
  /**
   * The remote origin a credential failure was about, when there is one.
   *
   * git names it in its own refusal (`could not read Username for
   * 'https://host'`); the host parses it out so the panel can address the
   * credential it is about to ask for without re-reading git's prose itself.
   */
  readonly remote?: string
}

/** Every failure the panel recognises. */
export type GitErrorCode =
  /** The session's directory is not inside a git work tree. */
  | 'not-a-repo'
  /** No session (or no cwd) for the id the browser sent. */
  | 'no-session'
  /** `git` is not on PATH. */
  | 'git-missing'
  /** The operation exceeded its deadline and was killed. */
  | 'timeout'
  /** Output would have exceeded the configured cap. */
  | 'too-large'
  /** git exited non-zero for a reason with no more specific code. */
  | 'git-failed'
  /** `git commit` found nothing staged: the FR-3.4 button was right to warn. */
  | 'nothing-to-commit'
  /** The remote has commits this branch does not, so the push was refused (FR-5.4). */
  | 'non-fast-forward'
  /**
   * The remote wanted credentials and git had nobody to ask.
   *
   * The host runs git with `GIT_TERMINAL_PROMPT=0` (a request must not hang on a
   * prompt no one can see), so an HTTPS remote with no stored credential fails
   * here instead. The panel answers with a form and retries; see
   * {@link GitPanelError.remote} for the origin it asks about.
   */
  | 'auth-required'
  /** This composition has no credential provider, so a credential cannot be saved. */
  | 'credentials-unavailable'
  /**
   * The branch is configured to merge with an upstream ref the fetch did not get.
   *
   * git's own words are "Your configuration specifies to merge with the ref
   * 'refs/heads/x' from the remote, but no such ref was fetched" — true, but it
   * never says the branch was deleted on the remote nor what to do about the
   * local config that still points at it. A code of its own is what lets the
   * panel say both.
   */
  | 'upstream-gone'
  /** The operation left the repository mid-merge with unmerged paths (FR-5.3). */
  | 'conflict'
  /**
   * Local changes stand in the way: `git checkout` refused to overwrite them
   * (FR-4.4), or a `git stash apply` refused to merge over them.
   *
   * A code of its own because the panel does something specific with it: the
   * blocked-branch-switch case is exactly where FR-4.4's "stash, then switch"
   * shortcut belongs, and the panel can only offer it if it can tell this refusal
   * apart from every other one git prints.
   */
  | 'dirty-worktree'
  /** `git branch -d` refused because the branch holds commits nothing else reaches (FR-4.3). */
  | 'not-merged'
  /** No language model is available in this composition, so FR-3.5 cannot run. */
  | 'no-llm'
  /**
   * The host refused a clipboard write.
   *
   * Not a git failure at all, and it lives in this union because this is where
   * the panel keeps "a failure it can name": the copying menu entries report
   * through the same action box every other operation does, so a refused write
   * has to be a value that box can carry rather than a thrown exception.
   */
  | 'clipboard'
  /** The request itself was malformed. */
  | 'bad-request'
  /** The host-side handler threw. */
  | 'internal'

/** Outcome of one panel operation: never a thrown exception across the wire. */
export type Result<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: GitPanelError }

/** One `git` invocation's raw outcome, before any domain parsing. */
export interface GitRunResult {
  /** Process exit code; `null` when the process was killed. */
  readonly code: number | null
  /** Standard output, decoded as UTF-8. */
  readonly stdout: string
  /** Standard error, decoded as UTF-8. */
  readonly stderr: string
  /** True when the deadline killed the process. */
  readonly timedOut: boolean
  /** True when output hit the cap and was cut. */
  readonly truncated: boolean
  /** True when the process could not be started at all (no `git` on PATH). */
  readonly spawnFailed: boolean
}

/**
 * Everything needed to answer git's credential prompts for one call.
 *
 * The helper file is static and holds no secret; the values ride in the child
 * process environment, which git's askpass protocol is built around. See
 * `host/askpass.ts` for why the prompt is matched on the origin.
 */
export interface GitAskPass {
  /** Absolute path of the helper executable git should run. */
  readonly helper: string
  /** JSON `origin → {username,password}` the helper reads from its environment. */
  readonly map: string
}

/**
 * How a git call should be kept away from an editor.
 *
 * Present means "no editor may block this call": the child gets `GIT_EDITOR=true`,
 * so a `rebase --continue` that would otherwise open a message editor keeps the
 * prepared message instead of waiting for a terminal that does not exist.
 *
 * `sequence` additionally names a program git should run as its sequence editor,
 * which is how a rewrite changes an interactive rebase's todo list without a
 * human (see `host/sequence-editor.ts`); `spec` is the JSON payload that helper
 * reads from the environment. The helper holds no state of its own — the same
 * discipline the askpass helper follows.
 */
export interface GitEditorControl {
  /** Absolute path of the program to use as `GIT_SEQUENCE_EDITOR`. */
  readonly sequence?: string
  /** JSON the sequence helper reads from `GIT_PANEL_SEQUENCE`. */
  readonly spec?: string
}

/** Options for one `git` invocation. */
export interface GitRunOptions {
  /** Absolute directory to run in. */
  readonly cwd: string
  /**
   * Credentials to inject for this call, when any apply.
   *
   * Absent means git runs exactly as before — no askpass, no environment
   * addition — so a repository with no stored credential is unaffected.
   */
  readonly askpass?: GitAskPass
  /**
   * Editor suppression, and the sequence editor a rewrite drives, when any.
   *
   * Absent means git runs with no editor of this plugin's making; the runner
   * also clears the sequence-editor variables it owns, so a launching shell
   * cannot inject one into a rewrite the panel did not ask for.
   */
  readonly editor?: GitEditorControl
  /** Deadline in milliseconds; the process is killed past it. */
  readonly timeoutMs?: number
  /** Cap on captured stdout bytes. */
  readonly maxStdoutBytes?: number
  /**
   * Whether git may take its optional locks, which for `status` means
   * refreshing the index and rewriting `.git/index`.
   *
   * Defaults to `false`, and the default is load-bearing rather than an
   * optimisation: this plugin's own probe watches the state files, so
   * a read that rewrote the index would announce a change caused by the act of
   * reading, and the panel would refresh itself forever. Mutating commands in
   * later milestones must pass `true`, because they genuinely need the lock.
   */
  readonly optionalLocks?: boolean
}

/**
 * Host-side capability: run one `git` command. Implemented by `host/git-exec.ts`.
 *
 * The implementation owns argument-array invocation (never a shell), the
 * per-repo serial queue that keeps concurrent writes off a locked index, the
 * deadline, and `GIT_TERMINAL_PROMPT=0` so a missing credential fails fast
 * instead of hanging a request forever (§5.5).
 */
export interface GitRunner {
  /**
   * Run `git` with these arguments.
   * @param args - Arguments after `git`, passed as an array to `execFile`; never interpolated into a shell.
   * @param options - Working directory, deadline, and output cap.
   * @returns The process outcome; a non-zero exit is a normal return, not a throw.
   */
  run(args: readonly string[], options: GitRunOptions): Promise<GitRunResult>
}

/**
 * Host-side capability: where git should run for a session.
 *
 * The browser sends only an opaque session id; this port turns it into a real
 * absolute path, so no path from the client ever reaches the filesystem
 * (§5.5). Implemented by `host/adapter/workspace.ts`.
 */
export interface SessionDirResolver {
  /**
   * Resolve a session to the canonical directory git should run in.
   * (The repository root itself is the git service's business: finding it takes a git call.)
   * @param sessionId - Opaque session identity from the browser.
   * @returns The absolute directory, or an error the panel can display.
   */
  resolveDir(sessionId: string): Promise<Result<string>>
}

/** Host-side capability: the panel's own diagnostic output (§5.2 `HostPorts`). */
export interface HostPorts {
  /**
   * Record one diagnostic line.
   * @param level - Severity.
   * @param message - Line to record.
   */
  log(level: LogLevel, message: string): void
  /**
   * Ask the harness's language model for one completion (FR-3.5).
   *
   * The git service builds the prompt and core parses the answer; this port is
   * only "words in, words out", so no component or service learns that
   * `ctx.llm` exists (§5.3's decision row). A composition without a model
   * answers `no-llm` rather than throwing, which is what lets the ✨ button
   * explain itself instead of failing silently.
   * @param prompt - The whole user-message text.
   * @param signal - Cancels the call when the request goes away.
   * @returns The model's text, or why there is none.
   */
  generateText(prompt: string, signal?: AbortSignal): Promise<Result<string>>
  /**
   * Where an HTTPS credential is kept, when the composition has somewhere to put it.
   *
   * Optional for the same reason `generateText`'s model is: the panel mounts and
   * works in a host that has no credential provider, and only the save path has
   * to explain itself. The values never cross this port in a log line — the
   * service audits the origin and nothing else.
   */
  readonly credentials?: GitCredentialStore
}

/** One username/password pair for an HTTP(S) remote. */
export interface GitCredential {
  /** The user name git should send. */
  readonly username: string
  /** The password — in practice a personal access token for most forges. */
  readonly password: string
}

/**
 * Durable storage for remote credentials, addressed by origin.
 *
 * Kept deliberately narrow: read one, write one. There is no enumeration here
 * because nothing in the panel lists stored credentials, and the fewer ways the
 * values can be observed, the better.
 */
export interface GitCredentialStore {
  /**
   * Resolve the credential for one origin.
   * @param origin - `scheme://host[:port]`.
   * @returns The credential, `null` when none is stored, or why the read failed.
   */
  read(origin: string): Promise<Result<GitCredential | null>>
  /**
   * Store (or replace) the credential for one origin.
   * @param origin - `scheme://host[:port]`.
   * @param credential - The pair to store.
   */
  save(origin: string, credential: GitCredential): Promise<Result<void>>
}

/** What the host exposes to the browser over the wire (doc §5.4). */
export interface WorkspaceGitService {
  /**
   * Read the whole-repository status.
   * @param sessionId - Opaque session identity from the browser.
   */
  status(sessionId: string, signal?: AbortSignal): Promise<Result<RepoStatus>>
  /**
   * List local branches.
   * @param sessionId - Opaque session identity from the browser.
   */
  branches(sessionId: string, signal?: AbortSignal): Promise<Result<readonly BranchRef[]>>
  /**
   * List the repositories this session's directory holds, and which one is read (FR-8).
   *
   * A directory that is itself a repository answers one entry; a directory that
   * is only a container answers its child repositories, and the panel then lets
   * the user choose. An empty list is the ordinary "not a repository anywhere
   * here" answer, not an error.
   * @param sessionId - Opaque session identity from the browser.
   */
  repos(sessionId: string, signal?: AbortSignal): Promise<Result<RepoListing>>
  /**
   * Point this session's panel at one of the repositories {@link repos} listed.
   *
   * The root is re-checked against a fresh discovery before it is accepted, so a
   * browser can only choose among roots the host itself found under the
   * session's directory — never name a path of its own (§5.5).
   * @param sessionId - Opaque session identity from the browser.
   * @param root - One of the roots the listing returned.
   */
  selectRepo(sessionId: string, root: string): Promise<Result<void>>
  /**
   * List remote-tracking branches (`refs/remotes`) for reading.
   *
   * Read-only: the panel does not check one out. A repository with no remote,
   * or one that has never been fetched, answers an empty list rather than an
   * error — "nothing to show yet" is the honest reading of both.
   * @param sessionId - Opaque session identity from the browser.
   */
  remoteBranches(sessionId: string, signal?: AbortSignal): Promise<Result<readonly RemoteBranchRef[]>>
  /**
   * Read one page of commit history.
   * @param sessionId - Opaque session identity from the browser.
   * @param offset - Commits to skip.
   * @param limit - Maximum commits to return.
   */
  log(
    sessionId: string,
    offset: number,
    limit: number,
    signal?: AbortSignal,
  ): Promise<Result<LogPage>>
  /**
   * List the paths staged in the index, for the staging-aware operations the
   * later milestones add. Read-only here; it exists so the wire shape is fixed
   * before the mutations land.
   * @param sessionId - Opaque session identity from the browser.
   */
  stagedPaths(sessionId: string, signal?: AbortSignal): Promise<Result<readonly FileChange[]>>
  /**
   * Read one file's diff (FR-2, FR-7.2).
   *
   * The host decides which comparison a path needs: `index` diffs the index
   * against HEAD, `worktree` diffs the working tree against the index, and a
   * path git does not track yet comes back as an all-added diff rather than as
   * "no changes" (FR-2.2). A `commit` target reads one file as that commit
   * changed it (`git show <hash> -- <path>`), which is FR-7.2's drill-down from
   * a commit's file list. The returned hunks carry their word-level marks, so
   * the browser does no diffing of its own.
   * @param sessionId - Opaque session identity from the browser.
   * @param path - Repo-relative path, validated before any git call (§5.5).
   * @param target - Which comparison to make, and the revision it is made against.
   * @param contextLines - Lines of context per hunk; the host clamps it.
   * @param signal - Cancels the request when the tab goes away.
   */
  diff(
    sessionId: string,
    path: string,
    target: DiffTarget,
    contextLines: number,
    signal?: AbortSignal,
  ): Promise<Result<FileDiff>>

  /**
   * Stage paths: what the `+` on a change row does (FR-3.1, FR-3.2).
   * @param sessionId - Opaque session identity from the browser.
   * @param paths - Repo-relative paths, validated before any git call (§5.5).
   * @param signal - Cancels the request when the tab goes away.
   */
  stage(
    sessionId: string,
    paths: readonly string[],
    signal?: AbortSignal,
  ): Promise<Result<OperationReport>>
  /**
   * Unstage paths: what the `−` on a staged row does (FR-3.1, FR-3.2).
   * @param sessionId - Opaque session identity from the browser.
   * @param paths - Repo-relative paths, validated before any git call (§5.5).
   * @param signal - Cancels the request when the tab goes away.
   */
  unstage(
    sessionId: string,
    paths: readonly string[],
    signal?: AbortSignal,
  ): Promise<Result<OperationReport>>
  /**
   * Discard the working-tree state of paths: what FR-6.1's "放弃更改" does.
   *
   * The index decides which of the two commands a path gets, never the browser's
   * word for it: a tracked path is restored from the index, and a path the index
   * does not know at all is removed. The host does not offer it for a staged-only
   * or conflicted path — see `ui/row-actions.ts` for the panel's half of that rule.
   * @param sessionId - Opaque session identity from the browser.
   * @param paths - Repo-relative paths, validated before any git call (§5.5).
   * @param signal - Cancels the request when the tab goes away.
   */
  discard(
    sessionId: string,
    paths: readonly string[],
    signal?: AbortSignal,
  ): Promise<Result<OperationReport>>
  /**
   * Resolve conflicted paths by accepting one whole side (FR-9.2's row actions).
   *
   * Only an unmerged path has sides to accept, so the host re-reads that state
   * before running and refuses the request otherwise rather than letting a stale
   * click overwrite a resolved file. `side` is the user's intent, not git's
   * vocabulary: the host reads the operation in progress and maps it, because
   * `--ours`/`--theirs` swap meaning under `git rebase`.
   * @param sessionId - Opaque session identity from the browser.
   * @param side - Which side the user accepts, in the user's words.
   * @param paths - Repo-relative paths, validated before any git call (§5.5).
   * @param signal - Cancels the request when the tab goes away.
   */
  resolveConflict(
    sessionId: string,
    side: ConflictSide,
    paths: readonly string[],
    signal?: AbortSignal,
  ): Promise<Result<OperationReport>>
  /**
   * Commit the index, and only the index (FR-3.4's default scope).
   * @param sessionId - Opaque session identity from the browser.
   * @param message - Commit message; validated for emptiness before any git call.
   * @param signal - Cancels the request when the tab goes away.
   * @returns The commit git created, so the panel can name it.
   */
  commit(sessionId: string, message: string, signal?: AbortSignal): Promise<Result<CommitInfo>>
  /**
   * Stage every tracked change, then commit — the explicitly announced widening
   * FR-3.4 requires rather than a quiet `add -u` behind a commit button.
   * @param sessionId - Opaque session identity from the browser.
   * @param message - Commit message; validated for emptiness before any git call.
   * @param signal - Cancels the request when the tab goes away.
   * @returns The commit git created.
   */
  commitAll(sessionId: string, message: string, signal?: AbortSignal): Promise<Result<CommitInfo>>
  /**
   * Push the current branch, setting its upstream on the first push (FR-5.2).
   * @param sessionId - Opaque session identity from the browser.
   * @param signal - Cancels the request when the tab goes away.
   */
  push(sessionId: string, signal?: AbortSignal): Promise<Result<OperationReport>>
  /**
   * Pull the current branch from its upstream (FR-5.1).
   * @param sessionId - Opaque session identity from the browser.
   * @param signal - Cancels the request when the tab goes away.
   */
  pull(sessionId: string, signal?: AbortSignal): Promise<Result<OperationReport>>
  /**
   * Fetch every remote, updating the remote-tracking branches.
   *
   * The doc's FR-5.1 lists pull / push / sync and no standalone fetch, so this
   * is an addition. Unlike `pull` it changes nothing local — not the working
   * tree, not the index, not the current branch — which is exactly why it is
   * worth having: it is how the ↑/↓ counts and the ○/● markers learn what the
   * remote holds without a merge ever being a possibility.
   * @param sessionId - Opaque session identity from the browser.
   * @param signal - Cancels the request when the tab goes away.
   */
  fetch(sessionId: string, signal?: AbortSignal): Promise<Result<OperationReport>>
  /**
   * Pull, then push: the doc's `⇅` in one action (FR-5.1).
   * @param sessionId - Opaque session identity from the browser.
   * @param signal - Cancels the request when the tab goes away.
   */
  sync(sessionId: string, signal?: AbortSignal): Promise<Result<OperationReport>>
  /**
   * Store the credential for one of this repository's remote origins.
   *
   * The origin is re-checked against the repository's own configured remotes
   * before anything is written, so a caller cannot use the panel to fill this
   * plugin's credential namespace with arbitrary hosts.
   * @param sessionId - Opaque session identity from the browser.
   * @param remote - The origin git named in its refusal.
   * @param username - The user name to send.
   * @param password - The password or personal access token.
   */
  saveCredential(
    sessionId: string,
    remote: string,
    username: string,
    password: string,
    signal?: AbortSignal,
  ): Promise<Result<void>>
  /**
   * Switch HEAD to an existing local branch (FR-4.1).
   *
   * The branch must already exist: creating one is a separate operation so a
   * typo cannot silently become a new branch (FR-4.2 keeps that as its own,
   * deliberate entry point). A working tree that would be overwritten is refused
   * by git itself, and git's multi-line refusal survives as `error.detail` for
   * FR-4.4's sake.
   * @param sessionId - Opaque session identity from the browser.
   * @param name - Local branch name, validated before any git call (§5.5).
   * @param signal - Cancels the request when the tab goes away.
   */
  checkout(sessionId: string, name: string, signal?: AbortSignal): Promise<Result<OperationReport>>
  /**
   * Create a branch and switch to it (FR-4.2).
   * @param sessionId - Opaque session identity from the browser.
   * @param name - New branch name, validated before any git call.
   * @param base - Branch or commit to start from, or `null` for the current HEAD.
   * @param signal - Cancels the request when the tab goes away.
   */
  createBranch(
    sessionId: string,
    name: string,
    base: string | null,
    signal?: AbortSignal,
  ): Promise<Result<OperationReport>>
  /**
   * Delete a local branch (FR-4.3).
   *
   * `force` maps to `git branch -D`; without it an unmerged branch is refused
   * with the `not-merged` code, which is what lets the panel turn the same
   * click into its "delete anyway" confirmation instead of forwarding git's
   * sentence and stopping there.
   * @param sessionId - Opaque session identity from the browser.
   * @param name - Local branch name, validated before any git call.
   * @param force - Whether an unmerged branch may be discarded.
   * @param signal - Cancels the request when the tab goes away.
   */
  deleteBranch(
    sessionId: string,
    name: string,
    force: boolean,
    signal?: AbortSignal,
  ): Promise<Result<OperationReport>>
  /**
   * Conclude an in-progress operation whose conflicts are all resolved.
   *
   * The kind is the one the panel read from {@link RepoStatus.operation}, and
   * the host re-reads its own state and refuses a mismatch before running
   * anything: `merge --abort` is not the escape hatch for a stopped
   * cherry-pick, so the browser does not get to choose which command runs.
   *
   * A merge concludes with git's own `MERGE_MSG` (the existing behaviour); the
   * other three use git's `--continue`, with the editor suppressed so a message
   * editor cannot wait for a terminal nobody can see.
   * @param sessionId - Opaque session identity from the browser.
   * @param kind - Which operation the panel believes is in progress.
   * @param signal - Cancels the request when the tab goes away.
   */
  continueOperation(
    sessionId: string,
    kind: InProgressOperation,
    signal?: AbortSignal,
  ): Promise<Result<OperationReport>>
  /**
   * Skip the commit that is blocking an in-progress rebase.
   *
   * Only a rebase has this move: a pick that became empty (or that the user
   * decides not to resolve) is abandoned and the replay continues. For any other
   * kind the host refuses rather than guessing.
   * @param sessionId - Opaque session identity from the browser.
   * @param kind - Which operation the panel believes is in progress.
   * @param signal - Cancels the request when the tab goes away.
   */
  skipOperation(
    sessionId: string,
    kind: InProgressOperation,
    signal?: AbortSignal,
  ): Promise<Result<OperationReport>>
  /**
   * Abandon an in-progress operation (FR-9.3 and the rewriting operations).
   *
   * Destructive — the worktree returns to the state before the operation began —
   * so the panel arms it behind the §4.3 two-click confirmation.
   * @param sessionId - Opaque session identity from the browser.
   * @param kind - Which operation the panel believes is in progress.
   * @param signal - Cancels the request when the tab goes away.
   */
  abortOperation(
    sessionId: string,
    kind: InProgressOperation,
    signal?: AbortSignal,
  ): Promise<Result<OperationReport>>
  /**
   * Create a new commit that reverses one existing commit — "还原此提交".
   *
   * Unlike {@link undoCommit} this acts on any commit, and unlike it the result
   * is never a rewritten history: the reversed changes land in a NEW commit, so
   * a published branch is safe. A merge commit is refused (reversing one needs a
   * mainline choice, which is a terminal's business).
   * @param sessionId - Opaque session identity from the browser.
   * @param hash - The commit to reverse, validated before any git call.
   * @param signal - Cancels the request when the tab goes away.
   */
  revertCommit(
    sessionId: string,
    hash: string,
    signal?: AbortSignal,
  ): Promise<Result<OperationReport>>
  /**
   * Apply one commit's changes to the current branch — "捡取此提交".
   *
   * A merge commit is refused for the same reason as {@link revertCommit}. A
   * commit whose changes are already present leaves git with an empty pick; the
   * host abandons that half-started state and answers `bad-request` rather than
   * leaving the panel showing an operation with nothing to do.
   * @param sessionId - Opaque session identity from the browser.
   * @param hash - The commit to pick, validated before any git call.
   * @param signal - Cancels the request when the tab goes away.
   */
  cherryPick(
    sessionId: string,
    hash: string,
    signal?: AbortSignal,
  ): Promise<Result<OperationReport>>
  /**
   * Move the current branch to a commit — "重置到此提交" (FR beyond the doc's list).
   *
   * `soft` keeps index and worktree, `mixed` keeps the worktree and empties the
   * index, `hard` discards both. All three rewrite where the branch points, so
   * the panel arms each entry and the host audits it.
   * @param sessionId - Opaque session identity from the browser.
   * @param hash - Where the branch should point.
   * @param mode - How much of the current state to keep.
   * @param signal - Cancels the request when the tab goes away.
   */
  resetTo(
    sessionId: string,
    hash: string,
    mode: ResetMode,
    signal?: AbortSignal,
  ): Promise<Result<OperationReport>>
  /**
   * Rewrite one commit away — fold it into its parent, or drop it.
   *
   * Both are `git rebase` under the hood and both rewrite everything after the
   * target, so the host refuses the cases where that would change more than the
   * user asked for: a merge commit as the target, a target that is not an
   * ancestor of HEAD, a merge commit anywhere in `target..HEAD` (the panel does
   * not linearise a branch on the user's behalf), a detached HEAD, and any
   * operation already in progress.
   * @param sessionId - Opaque session identity from the browser.
   * @param hash - The commit to rewrite away, validated before any git call.
   * @param action - Whether to fold it into its parent or drop it.
   * @param signal - Cancels the request when the tab goes away.
   */
  rewriteCommit(
    sessionId: string,
    hash: string,
    action: RewriteAction,
    signal?: AbortSignal,
  ): Promise<Result<OperationReport>>
  /**
   * Write a commit message for what is staged, with the language model (FR-3.5).
   *
   * The diff is truncated to a prompt budget and the answer says whether it was
   * (§8.3). Nothing is committed: the text lands in the box, editable, and the
   * user decides.
   * @param sessionId - Opaque session identity from the browser.
   * @param locale - BCP-47 tag, so the message is written in the panel's language.
   * @param signal - Cancels the request when the tab goes away.
   */
  generateCommitMessage(
    sessionId: string,
    locale: string,
    signal?: AbortSignal,
  ): Promise<Result<GeneratedMessage>>
  /**
   * Read one commit's metadata and file list (FR-3.6).
   * @param sessionId - Opaque session identity from the browser.
   * @param hash - Commit hash, validated as `^[0-9a-f]{4,40}$` before any git call.
   * @param signal - Cancels the request when the tab goes away.
   */
  showCommit(
    sessionId: string,
    hash: string,
    signal?: AbortSignal,
  ): Promise<Result<CommitDetail>>
  /**
   * Undo the newest commit (FR-3.8).
   *
   * The hash is the commit the browser believes is newest; the host re-reads
   * HEAD and the pushed state at execution time and refuses when the two
   * disagree, because the row the click came from may be stale. An unpublished
   * commit is undone with `reset --mixed` (its changes return to the working
   * tree); a published one with `revert` — a new commit, never rewritten
   * history. Destructive either way, so the panel arms it behind the §4.3
   * two-click confirmation and the host audits it (§5.5).
   * @param sessionId - Opaque session identity from the browser.
   * @param hash - Newest commit's hash, validated as `^[0-9a-f]{4,40}$` before any git call.
   * @param signal - Cancels the request when the tab goes away.
   */
  undoCommit(
    sessionId: string,
    hash: string,
    signal?: AbortSignal,
  ): Promise<Result<UndoResult>>
  /**
   * List the stash entries, newest first (FR-6.2).
   * @param sessionId - Opaque session identity from the browser.
   * @param signal - Cancels the request when the tab goes away.
   */
  stashes(sessionId: string, signal?: AbortSignal): Promise<Result<readonly StashEntry[]>>
  /**
   * Push the working tree onto the stash (FR-6.2).
   *
   * Which files go is git's decision, not the browser's: tracked changes always
   * do, and untracked ones only when `untracked` asks for them — the same choice
   * `git stash push -u` spells. A worktree with nothing to stash is refused
   * rather than answered with git's "No local changes to save", so the panel's
   * notice can always say that something was stashed.
   * @param sessionId - Opaque session identity from the browser.
   * @param message - Optional label for the entry, or `null` for git's own.
   * @param untracked - Whether untracked files are stashed too (`-u`).
   * @param signal - Cancels the request when the tab goes away.
   */
  stashSave(
    sessionId: string,
    message: string | null,
    untracked: boolean,
    signal?: AbortSignal,
  ): Promise<Result<OperationReport>>
  /**
   * Apply one stash to the working tree, optionally dropping it (FR-6.2).
   *
   * `pop` is `git stash pop` — apply, then remove the entry on success. A conflict
   * leaves the entry in place, which is git's own behaviour and the reason `pop`
   * is not the same promise as `drop`.
   * @param sessionId - Opaque session identity from the browser.
   * @param oid - The stash commit the browser believes it is acting on; the host
   *   re-resolves it against its own listing and refuses a stale one.
   * @param pop - Whether to drop the entry once it applied cleanly.
   * @param signal - Cancels the request when the tab goes away.
   */
  stashApply(
    sessionId: string,
    oid: string,
    pop: boolean,
    signal?: AbortSignal,
  ): Promise<Result<OperationReport>>
  /**
   * Drop one stash entry without applying it (FR-6.2).
   *
   * Destructive — the commits become unreachable — so the panel arms it behind
   * the §4.3 two-click confirmation and the host audits it (§5.5).
   * @param sessionId - Opaque session identity from the browser.
   * @param oid - The stash commit the browser believes it is acting on.
   * @param signal - Cancels the request when the tab goes away.
   */
  stashDrop(
    sessionId: string,
    oid: string,
    signal?: AbortSignal,
  ): Promise<Result<OperationReport>>
}

/**
 * Client-side capability: the panel's only way to reach the host (§5.2).
 *
 * The UI holds this interface, never `fetch`, `EventSource`, or a URL. The
 * adapter behind it is the single place that knows the transport, which is what
 * lets the transport change without touching a component.
 */
export interface GitRemoteClient {
  /**
   * Read the whole-repository status.
   * @param sessionId - Opaque session identity, supplied by the slot.
   * @param signal - Cancels the request when the tab goes away.
   */
  status(sessionId: string, signal?: AbortSignal): Promise<Result<RepoStatus>>
  /**
   * List local branches.
   * @param sessionId - Opaque session identity, supplied by the slot.
   * @param signal - Cancels the request when the tab goes away.
   */
  branches(sessionId: string, signal?: AbortSignal): Promise<Result<readonly BranchRef[]>>
  /**
   * List the repositories this session's directory holds, and which one is read (FR-8).
   * @param sessionId - Opaque session identity, supplied by the slot.
   * @param signal - Cancels the request when the tab goes away.
   */
  repos(sessionId: string, signal?: AbortSignal): Promise<Result<RepoListing>>
  /**
   * Point this session's panel at one of the repositories {@link repos} listed.
   * @param sessionId - Opaque session identity, supplied by the slot.
   * @param root - One of the roots the listing returned.
   * @param signal - Cancels the request when the tab goes away.
   */
  selectRepo(sessionId: string, root: string, signal?: AbortSignal): Promise<Result<void>>
  /**
   * List remote-tracking branches for reading (no checkout is offered).
   * @param sessionId - Opaque session identity, supplied by the slot.
   * @param signal - Cancels the request when the tab goes away.
   */
  remoteBranches(sessionId: string, signal?: AbortSignal): Promise<Result<readonly RemoteBranchRef[]>>
  /**
   * Read one page of commit history.
   * @param sessionId - Opaque session identity, supplied by the slot.
   * @param offset - Commits to skip.
   * @param limit - Maximum commits to return.
   * @param signal - Cancels the request when the tab goes away.
   */
  log(
    sessionId: string,
    offset: number,
    limit: number,
    signal?: AbortSignal,
  ): Promise<Result<LogPage>>
  /**
   * Read one file's diff (FR-2, FR-7.2).
   * @param sessionId - Opaque session identity, supplied by the slot.
   * @param path - Repo-relative path.
   * @param target - Which comparison to make, and the revision it is made against.
   * @param contextLines - Lines of context per hunk.
   * @param signal - Cancels the request when the tab goes away.
   */
  diff(
    sessionId: string,
    path: string,
    target: DiffTarget,
    contextLines: number,
    signal?: AbortSignal,
  ): Promise<Result<FileDiff>>
  /**
   * Stage paths (FR-3.1, FR-3.2).
   * @param sessionId - Opaque session identity, supplied by the slot.
   * @param paths - Repo-relative paths.
   * @param signal - Cancels the request when the tab goes away.
   */
  stage(
    sessionId: string,
    paths: readonly string[],
    signal?: AbortSignal,
  ): Promise<Result<OperationReport>>
  /**
   * Unstage paths (FR-3.1, FR-3.2).
   * @param sessionId - Opaque session identity, supplied by the slot.
   * @param paths - Repo-relative paths.
   * @param signal - Cancels the request when the tab goes away.
   */
  unstage(
    sessionId: string,
    paths: readonly string[],
    signal?: AbortSignal,
  ): Promise<Result<OperationReport>>
  /**
   * Discard the working-tree state of paths (FR-6.1).
   * @param sessionId - Opaque session identity, supplied by the slot.
   * @param paths - Repo-relative paths.
   * @param signal - Cancels the request when the tab goes away.
   */
  discard(
    sessionId: string,
    paths: readonly string[],
    signal?: AbortSignal,
  ): Promise<Result<OperationReport>>
  /**
   * Resolve conflicted paths by accepting one whole side (FR-9.2).
   * @param sessionId - Opaque session identity, supplied by the slot.
   * @param side - Which side the user accepts, in the user's words.
   * @param paths - Repo-relative paths.
   * @param signal - Cancels the request when the tab goes away.
   */
  resolveConflict(
    sessionId: string,
    side: ConflictSide,
    paths: readonly string[],
    signal?: AbortSignal,
  ): Promise<Result<OperationReport>>
  /**
   * Commit the index, and only the index (FR-3.4).
   * @param sessionId - Opaque session identity, supplied by the slot.
   * @param message - Commit message.
   * @param signal - Cancels the request when the tab goes away.
   */
  commit(sessionId: string, message: string, signal?: AbortSignal): Promise<Result<CommitInfo>>
  /**
   * Stage every tracked change, then commit (FR-3.4's announced widening).
   * @param sessionId - Opaque session identity, supplied by the slot.
   * @param message - Commit message.
   * @param signal - Cancels the request when the tab goes away.
   */
  commitAll(
    sessionId: string,
    message: string,
    signal?: AbortSignal,
  ): Promise<Result<CommitInfo>>
  /**
   * Push the current branch, setting its upstream on the first push (FR-5.1, FR-5.2).
   * @param sessionId - Opaque session identity, supplied by the slot.
   * @param signal - Cancels the request when the tab goes away.
   */
  push(sessionId: string, signal?: AbortSignal): Promise<Result<OperationReport>>
  /**
   * Pull the current branch from its upstream (FR-5.1).
   * @param sessionId - Opaque session identity, supplied by the slot.
   * @param signal - Cancels the request when the tab goes away.
   */
  pull(sessionId: string, signal?: AbortSignal): Promise<Result<OperationReport>>
  /**
   * Fetch every remote, updating the remote-tracking branches.
   *
   * Leaves the working tree, the index and the current branch untouched — it
   * only teaches the panel what the remote has.
   * @param sessionId - Opaque session identity, supplied by the slot.
   * @param signal - Cancels the request when the tab goes away.
   */
  fetch(sessionId: string, signal?: AbortSignal): Promise<Result<OperationReport>>
  /**
   * Pull, then push (FR-5.1).
   * @param sessionId - Opaque session identity, supplied by the slot.
   * @param signal - Cancels the request when the tab goes away.
   */
  sync(sessionId: string, signal?: AbortSignal): Promise<Result<OperationReport>>
  /**
   * Store the credential for one of this repository's remote origins.
   * @param sessionId - Opaque session identity, supplied by the slot.
   * @param remote - The origin git named in its refusal.
   * @param username - The user name to send.
   * @param password - The password or personal access token.
   * @param signal - Cancels the request when the tab goes away.
   */
  saveCredential(
    sessionId: string,
    remote: string,
    username: string,
    password: string,
    signal?: AbortSignal,
  ): Promise<Result<void>>
  /**
   * Switch HEAD to an existing local branch (FR-4.1).
   * @param sessionId - Opaque session identity, supplied by the slot.
   * @param name - Local branch name.
   * @param signal - Cancels the request when the tab goes away.
   */
  checkout(sessionId: string, name: string, signal?: AbortSignal): Promise<Result<OperationReport>>
  /**
   * Create a branch and switch to it (FR-4.2).
   * @param sessionId - Opaque session identity, supplied by the slot.
   * @param name - New branch name.
   * @param base - Branch or commit to start from, or `null` for the current HEAD.
   * @param signal - Cancels the request when the tab goes away.
   */
  createBranch(
    sessionId: string,
    name: string,
    base: string | null,
    signal?: AbortSignal,
  ): Promise<Result<OperationReport>>
  /**
   * Delete a local branch (FR-4.3).
   * @param sessionId - Opaque session identity, supplied by the slot.
   * @param name - Local branch name.
   * @param force - Whether an unmerged branch may be discarded.
   * @param signal - Cancels the request when the tab goes away.
   */
  deleteBranch(
    sessionId: string,
    name: string,
    force: boolean,
    signal?: AbortSignal,
  ): Promise<Result<OperationReport>>
  /**
   * Conclude an in-progress operation whose conflicts are all resolved.
   * @param sessionId - Opaque session identity, supplied by the slot.
   * @param kind - Which operation the panel believes is in progress.
   * @param signal - Cancels the request when the tab goes away.
   */
  continueOperation(
    sessionId: string,
    kind: InProgressOperation,
    signal?: AbortSignal,
  ): Promise<Result<OperationReport>>
  /**
   * Skip the commit blocking an in-progress rebase.
   * @param sessionId - Opaque session identity, supplied by the slot.
   * @param kind - Which operation the panel believes is in progress.
   * @param signal - Cancels the request when the tab goes away.
   */
  skipOperation(
    sessionId: string,
    kind: InProgressOperation,
    signal?: AbortSignal,
  ): Promise<Result<OperationReport>>
  /**
   * Abandon an in-progress operation (FR-9.3 and the rewriting operations).
   * @param sessionId - Opaque session identity, supplied by the slot.
   * @param kind - Which operation the panel believes is in progress.
   * @param signal - Cancels the request when the tab goes away.
   */
  abortOperation(
    sessionId: string,
    kind: InProgressOperation,
    signal?: AbortSignal,
  ): Promise<Result<OperationReport>>
  /**
   * Create a new commit reversing one existing commit ("还原此提交").
   * @param sessionId - Opaque session identity, supplied by the slot.
   * @param hash - The commit to reverse.
   * @param signal - Cancels the request when the tab goes away.
   */
  revertCommit(
    sessionId: string,
    hash: string,
    signal?: AbortSignal,
  ): Promise<Result<OperationReport>>
  /**
   * Apply one commit's changes to the current branch ("捡取此提交").
   * @param sessionId - Opaque session identity, supplied by the slot.
   * @param hash - The commit to pick.
   * @param signal - Cancels the request when the tab goes away.
   */
  cherryPick(
    sessionId: string,
    hash: string,
    signal?: AbortSignal,
  ): Promise<Result<OperationReport>>
  /**
   * Move the current branch to a commit ("重置到此提交").
   * @param sessionId - Opaque session identity, supplied by the slot.
   * @param hash - Where the branch should point.
   * @param mode - How much of the current state to keep.
   * @param signal - Cancels the request when the tab goes away.
   */
  resetTo(
    sessionId: string,
    hash: string,
    mode: ResetMode,
    signal?: AbortSignal,
  ): Promise<Result<OperationReport>>
  /**
   * Fold one commit into its parent, or drop it ("压缩 / 丢弃此提交").
   * @param sessionId - Opaque session identity, supplied by the slot.
   * @param hash - The commit to rewrite away.
   * @param action - Whether to fold it into its parent or drop it.
   * @param signal - Cancels the request when the tab goes away.
   */
  rewriteCommit(
    sessionId: string,
    hash: string,
    action: RewriteAction,
    signal?: AbortSignal,
  ): Promise<Result<OperationReport>>
  /**
   * Write a commit message for the staged diff (FR-3.5).
   * @param sessionId - Opaque session identity, supplied by the slot.
   * @param locale - BCP-47 tag for the message's language.
   * @param signal - Cancels the request when the tab goes away.
   */
  generateCommitMessage(
    sessionId: string,
    locale: string,
    signal?: AbortSignal,
  ): Promise<Result<GeneratedMessage>>
  /**
   * Read one commit's metadata and file list (FR-3.6).
   * @param sessionId - Opaque session identity, supplied by the slot.
   * @param hash - Commit hash.
   * @param signal - Cancels the request when the tab goes away.
   */
  showCommit(
    sessionId: string,
    hash: string,
    signal?: AbortSignal,
  ): Promise<Result<CommitDetail>>
  /**
   * Undo the newest commit (FR-3.8): `reset --mixed` when unpublished, `revert`
   * when published; the host decides which at execution time.
   * @param sessionId - Opaque session identity, supplied by the slot.
   * @param hash - The newest commit's hash.
   * @param signal - Cancels the request when the tab goes away.
   */
  undoCommit(
    sessionId: string,
    hash: string,
    signal?: AbortSignal,
  ): Promise<Result<UndoResult>>
  /**
   * List the stash entries, newest first (FR-6.2).
   * @param sessionId - Opaque session identity, supplied by the slot.
   * @param signal - Cancels the request when the tab goes away.
   */
  stashes(sessionId: string, signal?: AbortSignal): Promise<Result<readonly StashEntry[]>>
  /**
   * Push the working tree onto the stash (FR-6.2).
   * @param sessionId - Opaque session identity, supplied by the slot.
   * @param message - Optional label for the entry, or `null` for git's own.
   * @param untracked - Whether untracked files are stashed too (`-u`).
   * @param signal - Cancels the request when the tab goes away.
   */
  stashSave(
    sessionId: string,
    message: string | null,
    untracked: boolean,
    signal?: AbortSignal,
  ): Promise<Result<OperationReport>>
  /**
   * Apply one stash, optionally dropping the entry once it applied (FR-6.2).
   * @param sessionId - Opaque session identity, supplied by the slot.
   * @param oid - The stash commit the row stands for.
   * @param pop - Whether to drop the entry once it applied cleanly.
   * @param signal - Cancels the request when the tab goes away.
   */
  stashApply(
    sessionId: string,
    oid: string,
    pop: boolean,
    signal?: AbortSignal,
  ): Promise<Result<OperationReport>>
  /**
   * Drop one stash entry without applying it (FR-6.2).
   * @param sessionId - Opaque session identity, supplied by the slot.
   * @param oid - The stash commit the row stands for.
   * @param signal - Cancels the request when the tab goes away.
   */
  stashDrop(
    sessionId: string,
    oid: string,
    signal?: AbortSignal,
  ): Promise<Result<OperationReport>>
  /**
   * The deployment's own file-type icons (FR-1.2): extension to SVG document.
   *
   * Deliberately only on this side of the contract. The host's git service is "what
   * the repository says"; this is deployment configuration read from a file, so the
   * route layer serves it from its own registry and no git service grows a method
   * for it. The browser sends nothing but its session id, exactly as for every
   * other operation.
   *
   * Keys are extensions without their dot, lowercased (`ts`, not `.TS`), because
   * that is how the icon map normalizes them and how the panel matches a path.
   * @param sessionId - Opaque session identity, supplied by the slot.
   * @param signal - Cancels the request when the tab goes away.
   */
  fileIcons(sessionId: string, signal?: AbortSignal): Promise<Result<Readonly<Record<string, string>>>>
  /**
   * Subscribe to "the repository changed" notifications.
   *
   * The adapter owns the transport (an SSE stream, or a poll when the stream is
   * unavailable) and collapses however many host-side observations arrive into
   * whatever the UI needs; the UI only learns that re-reading is worthwhile
   * (§5.3, host probe → client subscription).
   *
   * The notification carries {@link GitChange}: *what* moved, coarsely enough
   * that a reader can tell whether its own reading is worth redoing — a pane
   * showing commit history cares about `refs`, one showing a file's diff cares
   * about `worktree`. A subscriber that does not care may ignore the argument;
   * one that cannot tell gets every kind.
   * @param sessionId - Opaque session identity to watch.
   * @param onChange - Called when the repository may have changed.
   * @returns Unsubscribe callback.
   */
  watch(sessionId: string, onChange: (change: GitChange) => void): () => void
}

/**
 * What moved in a repository, at the coarseness a reader can act on.
 *
 * The three are the three things that go stale for different reasons: `refs`
 * (HEAD, a branch, the reflog, a remote-tracking ref — a commit, a checkout, a
 * fetch), `index` (the staging area, or any other git state file), and
 * `worktree` (a file in the working tree). They are deliberately not file names:
 * a consumer decides what to re-read, not where to look.
 */
export type GitChangeKind = 'refs' | 'index' | 'worktree'

/** One coalesced report from the host's git state probe. */
export interface GitChange {
  /** Everything that moved within one coalescing window. */
  readonly kinds: readonly GitChangeKind[]
}

/** Client-side capability: the workspace the panel should follow (§4.4). */
export interface WorkspaceSubscriptionPort {
  /**
   * Watch the active session for the sidebar's session scope.
   * @param listener - Called with the session id currently in view.
   * @returns Unsubscribe callback.
   */
  subscribeSession(listener: (sessionId: string) => void): () => void
}

/** Everything the UI is handed, in one object (§5.2 `ClientPorts`). */
export interface ClientPorts {
  /** The host-facing git client. */
  readonly git: GitRemoteClient
  /**
   * Translate one dictionary key.
   * @param key - Key in the panel's own namespace.
   * @param vars - Values for `{name}` placeholders.
   */
  t(key: string, vars?: Readonly<Record<string, string | number>>): string
}
