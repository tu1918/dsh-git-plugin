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
  CommitInfo,
  FileChange,
  LogLevel,
  LogPage,
  RepoStatus,
} from './types.ts'

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

/** One commit's metadata plus its file list; the shape FR-3.6 drills into. */
export interface CommitDetail {
  /** The commit itself. */
  readonly commit: CommitInfo
  /** Files the commit touched, with per-file line counts. */
  readonly files: readonly CommitFileStat[]
}

/** One file inside a commit, with its churn (FR-3.6). */
export interface CommitFileStat {
  /** Repo-relative path, `/`-separated. */
  readonly path: string
  /** Lines added. */
  readonly additions: number
  /** Lines removed. */
  readonly deletions: number
  /** True when git reported the path as binary rather than counting lines. */
  readonly binary: boolean
}
