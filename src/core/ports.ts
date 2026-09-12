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
  DiffArea,
  FileChange,
  FileDiff,
  GeneratedMessage,
  LogLevel,
  LogPage,
  OperationReport,
  RepoStatus,
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
  /** The operation left the repository mid-merge with unmerged paths (FR-5.3). */
  | 'conflict'
  /** `git branch -d` refused because the branch holds commits nothing else reaches (FR-4.3). */
  | 'not-merged'
  /** No language model is available in this composition, so FR-3.5 cannot run. */
  | 'no-llm'
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

/** Options for one `git` invocation. */
export interface GitRunOptions {
  /** Absolute directory to run in. */
  readonly cwd: string
  /** Deadline in milliseconds; the process is killed past it. */
  readonly timeoutMs?: number
  /** Cap on captured stdout bytes. */
  readonly maxStdoutBytes?: number
  /**
   * Whether git may take its optional locks, which for `status` means
   * refreshing the index and rewriting `.git/index`.
   *
   * Defaults to `false`, and the default is load-bearing rather than an
   * optimisation: this plugin's own change watcher polls `.git/index`'s mtime, so
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
   * Read one file's diff (FR-2).
   *
   * The host decides which comparison a path needs: `index` diffs the index
   * against HEAD, `worktree` diffs the working tree against the index, and a
   * path git does not track yet comes back as an all-added diff rather than as
   * "no changes" (FR-2.2). The returned hunks carry their word-level marks, so
   * the browser does no diffing of its own.
   * @param sessionId - Opaque session identity from the browser.
   * @param path - Repo-relative path, validated before any git call (§5.5).
   * @param area - Which comparison to make.
   * @param contextLines - Lines of context per hunk; the host clamps it.
   * @param signal - Cancels the request when the tab goes away.
   */
  diff(
    sessionId: string,
    path: string,
    area: DiffArea,
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
   * Pull, then push: the doc's `⇅` in one action (FR-5.1).
   * @param sessionId - Opaque session identity from the browser.
   * @param signal - Cancels the request when the tab goes away.
   */
  sync(sessionId: string, signal?: AbortSignal): Promise<Result<OperationReport>>
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
   * Finish an in-progress merge whose conflicts are all resolved (FR-9.3).
   *
   * Uses git's own `MERGE_MSG`, so the panel does not have to invent a message
   * for a merge the user started outside it.
   * @param sessionId - Opaque session identity from the browser.
   * @param signal - Cancels the request when the tab goes away.
   */
  continueMerge(sessionId: string, signal?: AbortSignal): Promise<Result<OperationReport>>
  /**
   * Abandon an in-progress merge (FR-9.3).
   *
   * Destructive — the worktree returns to the pre-merge state — so the panel
   * arms it behind the §4.3 two-click confirmation.
   * @param sessionId - Opaque session identity from the browser.
   * @param signal - Cancels the request when the tab goes away.
   */
  abortMerge(sessionId: string, signal?: AbortSignal): Promise<Result<OperationReport>>
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
   * Read one file's diff (FR-2).
   * @param sessionId - Opaque session identity, supplied by the slot.
   * @param path - Repo-relative path.
   * @param area - Which comparison to make: index, or working tree.
   * @param contextLines - Lines of context per hunk.
   * @param signal - Cancels the request when the tab goes away.
   */
  diff(
    sessionId: string,
    path: string,
    area: DiffArea,
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
   * Pull, then push (FR-5.1).
   * @param sessionId - Opaque session identity, supplied by the slot.
   * @param signal - Cancels the request when the tab goes away.
   */
  sync(sessionId: string, signal?: AbortSignal): Promise<Result<OperationReport>>
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
   * Commit a merge whose conflicts are all resolved (FR-9.3).
   * @param sessionId - Opaque session identity, supplied by the slot.
   * @param signal - Cancels the request when the tab goes away.
   */
  continueMerge(sessionId: string, signal?: AbortSignal): Promise<Result<OperationReport>>
  /**
   * Abandon an in-progress merge (FR-9.3).
   * @param sessionId - Opaque session identity, supplied by the slot.
   * @param signal - Cancels the request when the tab goes away.
   */
  abortMerge(sessionId: string, signal?: AbortSignal): Promise<Result<OperationReport>>
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
   * Subscribe to "the repository changed" notifications.
   *
   * The adapter owns the transport (an SSE stream, or a poll when the stream is
   * unavailable) and collapses however many host-side observations arrive into
   * whatever the UI needs; the UI only learns that re-reading is worthwhile
   * (§5.3, host watcher → client subscription).
   * @param sessionId - Opaque session identity to watch.
   * @param onChange - Called when the repository may have changed.
   * @returns Unsubscribe callback.
   */
  watch(sessionId: string, onChange: () => void): () => void
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
