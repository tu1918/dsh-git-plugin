/**
 * DSH adapter: the HTTP/SSE transport, behind the core's {@link GitRemoteClient}.
 *
 * This file is the only place in the browser half that knows a URL exists, which
 * is the whole point of the port: swapping `webServer` routes for a Typert Remote
 * later means rewriting this file and nothing else — no component, no hook, no
 * dictionary.
 *
 * Three transport details are worth stating outright:
 *
 * - Every response is the host's `{ ok, value } | { ok, error }` envelope, and a
 *   failure is returned as data rather than thrown. A network fault becomes the
 *   same shape, so the UI has exactly one error path.
 * - Every request carries its own deadline, a little longer than the host's own
 *   (see `adapter/routes.ts`), and answers `timeout` when it fires. The tab's
 *   `AbortSignal` alone is not a bound: it aborts when the tab closes, so a host
 *   that never answers used to leave a spinner turning with no way out (F-1).
 * - `watch` prefers the host's SSE stream and falls back to polling when the
 *   stream cannot help — no `EventSource` in the browser, or a host that answered
 *   "unavailable" because the session is not in a repository yet. That fallback is
 *   what lets `git init` show up on its own (FR-1.4's polling floor).
 *
 * @module dsh-git-panel/client/adapter/git-client
 */

import type {
  GitChange,
  GitChangeKind,
  GitPanelError,
  GitRemoteClient,
  Result,
} from '../../core/ports.ts'
import type {
  BranchRef,
  CommitDetail,
  CommitInfo,
  ConflictSide,
  GeneratedMessage,
  InProgressOperation,
  LogPage,
  RemoteBranchRef,
  RepoListing,
  OperationReport,
  RepoStatus,
  ResetMode,
  RewriteAction,
  FileDiff,
  StashEntry,
  UndoResult,
} from '../../core/types.ts'

/** The host route prefix; must match `host/routes.ts`. */
const ROUTE_PREFIX = '/git-panel'

/** Poll interval used when the stream is unavailable (FR-1.4's fallback). */
const POLL_FALLBACK_MS = 10_000

/**
 * How long one request may wait before this client stops it.
 *
 * Deliberately a little longer than the host's own request deadline: when the
 * host can answer — even to say it waited too long — that answer is the better
 * one, and this bound is only for the host that has gone silent altogether.
 */
const REQUEST_DEADLINE_MS = 75_000

/**
 * The deadline for the two operations the host also gives longer: a rewrite
 * replays history through a 60s rebase, and a generated commit message waits on
 * the deployment's model.
 */
const LONG_REQUEST_DEADLINE_MS = 135_000

/** The deadlines this client enforces; a test may shorten them. */
export interface RequestDeadlines {
  /** Deadline for an ordinary request, in milliseconds. */
  readonly requestMs?: number
  /** Deadline for a rewrite or a generated commit message, in milliseconds. */
  readonly longRequestMs?: number
}

/** The host's response envelope. */
type Envelope<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: GitPanelError }

/**
 * Turn a transport fault into the panel's failure vocabulary.
 * @param error - Whatever `fetch` threw.
 * @param aborted - Whether the caller cancelled, which is not a failure to show.
 */
function transportFailure(error: unknown, aborted: boolean): Result<never> {
  if (aborted) {
    return { ok: false, error: { code: 'internal', message: 'the request was cancelled' } }
  }
  const message = error instanceof Error ? error.message : String(error)
  return { ok: false, error: { code: 'internal', message } }
}

/**
 * Read the host's envelope out of a decoded response body.
 *
 * Both verbs answer in the same shape, so both funnel through here: the UI has
 * exactly one way to learn that something failed, whichever method it called.
 * @param body - The decoded JSON.
 * @returns The envelope as a {@link Result}.
 */
function envelopeOf<T>(body: unknown): Result<T> {
  if (typeof body !== 'object' || body === null || !('ok' in body)) {
    return { ok: false, error: { code: 'internal', message: 'the host sent a malformed reply' } }
  }
  const envelope = body as Envelope<T>
  return envelope.ok ? { ok: true, value: envelope.value } : { ok: false, error: envelope.error }
}

/**
 * Issue one request, bounded in time.
 *
 * The caller's signal (the tab's lifetime) and the deadline abort the same
 * controller, and which one fired decides what the answer says: a closed tab is
 * not a failure to show, while a timeout is one the user has to be told about.
 * `ui/error-copy.ts` writes the sentence, because the same code means "this read
 * was stopped" for a read and "the result is unknown" for a mutation.
 * @param url - The full URL to call.
 * @param init - Method, headers, and body.
 * @param signal - Caller cancellation.
 * @param deadlineMs - How long to wait before giving up on the host.
 * @returns The envelope the host sent, or a failure that fits the panel.
 */
async function send<T>(
  url: URL,
  init: {
    readonly method: 'GET' | 'POST'
    readonly headers: Readonly<Record<string, string>>
    readonly body?: string
  },
  signal: AbortSignal | undefined,
  deadlineMs: number,
): Promise<Result<T>> {
  const controller = new AbortController()
  let timedOut = false
  const timer = window.setTimeout(() => {
    timedOut = true
    controller.abort()
  }, deadlineMs)
  const abort = (): void => controller.abort()
  // An already-aborted caller never fires its event again, so the check comes
  // first: a request made after the tab closed must not wait for the deadline.
  if (signal?.aborted === true) abort()
  else signal?.addEventListener('abort', abort)

  try {
    const response = await fetch(url, {
      method: init.method,
      // Same-origin, so the session cookie rides along; the host's own fence
      // decides whether this client may talk to it at all.
      credentials: 'same-origin',
      headers: init.headers,
      ...(init.body === undefined ? {} : { body: init.body }),
      signal: controller.signal,
    })
    return envelopeOf<T>(await response.json())
  } catch (error) {
    if (timedOut) {
      return { ok: false, error: { code: 'timeout', message: 'the host did not answer in time' } }
    }
    return transportFailure(error, signal?.aborted === true)
  } finally {
    window.clearTimeout(timer)
    signal?.removeEventListener('abort', abort)
  }
}

/**
 * Issue one JSON operation.
 * @param path - Route path under the prefix.
 * @param params - Query parameters.
 * @param signal - Caller cancellation.
 * @param deadlineMs - How long to wait before giving up on the host.
 * @returns The envelope the host sent, or a transport failure.
 */
async function requestWith<T>(
  path: string,
  params: Readonly<Record<string, string | number>>,
  signal: AbortSignal | undefined,
  deadlineMs: number,
): Promise<Result<T>> {
  const url = new URL(`${ROUTE_PREFIX}${path}`, window.location.origin)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value))
  return send<T>(url, { method: 'GET', headers: { accept: 'application/json' } }, signal, deadlineMs)
}

/**
 * Issue one mutating operation.
 *
 * A mutation is a `POST` with a JSON body, which is what lets the host require
 * both of those things and refuse the rest: a state change is never reachable by
 * a link, an image tag, or a form submission from another page.
 * @param path - Route path under the prefix.
 * @param body - The request body, session included.
 * @param signal - Caller cancellation.
 * @param deadlineMs - How long to wait before giving up on the host.
 * @returns The envelope the host sent, or a transport failure.
 */
async function mutateWith<T>(
  path: string,
  body: Readonly<Record<string, unknown>>,
  signal: AbortSignal | undefined,
  deadlineMs: number,
): Promise<Result<T>> {
  const url = new URL(`${ROUTE_PREFIX}${path}`, window.location.origin)
  return send<T>(
    url,
    {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
    signal,
    deadlineMs,
  )
}

/**
 * Build the browser's git client.
 * @param deadlines - Request deadlines; defaults to the two constants above.
 * @returns The client the panel is handed.
 */
export function createGitRemoteClient(deadlines: RequestDeadlines = {}): GitRemoteClient {
  const requestMs = deadlines.requestMs ?? REQUEST_DEADLINE_MS
  const longRequestMs = deadlines.longRequestMs ?? LONG_REQUEST_DEADLINE_MS
  // The two primitives with this client's bounds already applied, so every
  // method below spells only what its request is.
  const request = <T>(
    path: string,
    params: Readonly<Record<string, string | number>>,
    signal?: AbortSignal,
  ): Promise<Result<T>> => requestWith<T>(path, params, signal, requestMs)
  const mutate = <T>(
    path: string,
    body: Readonly<Record<string, unknown>>,
    signal?: AbortSignal,
  ): Promise<Result<T>> => mutateWith<T>(path, body, signal, requestMs)
  /** The same, for the two operations the host also gives longer. */
  const mutateLong = <T>(
    path: string,
    body: Readonly<Record<string, unknown>>,
    signal?: AbortSignal,
  ): Promise<Result<T>> => mutateWith<T>(path, body, signal, longRequestMs)

  return {
    status: (sessionId, signal) => request<RepoStatus>('/status', { session: sessionId }, signal),
    branches: (sessionId, signal) =>
      request<readonly BranchRef[]>('/branches', { session: sessionId }, signal),
    remoteBranches: (sessionId, signal) =>
      request<readonly RemoteBranchRef[]>('/remoteBranches', { session: sessionId }, signal),
    repos: (sessionId, signal) => request<RepoListing>('/repos', { session: sessionId }, signal),
    selectRepo: (sessionId, root, signal) =>
      mutate<void>('/selectRepo', { session: sessionId, root }, signal),
    log: (sessionId, offset, limit, signal) =>
      request<LogPage>('/log', { session: sessionId, offset, limit }, signal),
    // The host's own parameter names, not the panel's: `path`/`area`/`context`
    // are what `host/routes.ts` reads, and the `area` value is the core's
    // `DiffArea` verbatim so no translation table can drift between the halves.
    // A commit target also sends the revision it is read against (FR-7.2).
    diff: (sessionId, path, target, contextLines, signal) =>
      request<FileDiff>(
        '/diff',
        target.area === 'commit'
          ? { session: sessionId, path, area: target.area, hash: target.hash, context: contextLines }
          : { session: sessionId, path, area: target.area, context: contextLines },
        signal,
      ),

    stage: (sessionId, paths, signal) =>
      mutate<OperationReport>('/stage', { session: sessionId, paths }, signal),
    unstage: (sessionId, paths, signal) =>
      mutate<OperationReport>('/unstage', { session: sessionId, paths }, signal),
    discard: (sessionId, paths, signal) =>
      mutate<OperationReport>('/discard', { session: sessionId, paths }, signal),
    resolveConflict: (sessionId, side, paths, signal) =>
      mutate<OperationReport>('/resolveConflict', { session: sessionId, side, paths }, signal),
    commit: (sessionId, message, signal) =>
      mutate<CommitInfo>('/commit', { session: sessionId, message }, signal),
    // The one argument that separates FR-3.4's two commits: `add -u` first, then
    // commit — the widening the button's own words name ("commit all tracked
    // changes"), without the panel spelling out the flag anywhere.
    commitAll: (sessionId, message, signal) =>
      mutate<CommitInfo>('/commit', { session: sessionId, message, all: true }, signal),
    push: (sessionId, signal) => mutate<OperationReport>('/push', { session: sessionId }, signal),
    pull: (sessionId, signal) => mutate<OperationReport>('/pull', { session: sessionId }, signal),
    fetch: (sessionId, signal) => mutate<OperationReport>('/fetch', { session: sessionId }, signal),
    sync: (sessionId, signal) => mutate<OperationReport>('/sync', { session: sessionId }, signal),
    saveCredential: (sessionId, remote, username, password, signal) =>
      mutate<void>('/saveCredential', { session: sessionId, remote, username, password }, signal),

    checkout: (sessionId, name, signal) =>
      mutate<OperationReport>('/checkout', { session: sessionId, name }, signal),
    // `base: null` is the "from the current HEAD" case, and the host reads an
    // absent base the same way — one argument, two spellings of the same intent.
    createBranch: (sessionId, name, base, signal) =>
      mutate<OperationReport>('/createBranch', { session: sessionId, name, base }, signal),
    deleteBranch: (sessionId, name, force, signal) =>
      mutate<OperationReport>('/deleteBranch', { session: sessionId, name, force }, signal),
    continueOperation: (sessionId, kind: InProgressOperation, signal) =>
      mutate<OperationReport>('/continueOperation', { session: sessionId, kind }, signal),
    skipOperation: (sessionId, kind: InProgressOperation, signal) =>
      mutate<OperationReport>('/skipOperation', { session: sessionId, kind }, signal),
    abortOperation: (sessionId, kind: InProgressOperation, signal) =>
      mutate<OperationReport>('/abortOperation', { session: sessionId, kind }, signal),
    generateCommitMessage: (sessionId, locale, signal) =>
      // A generation waits on the deployment's model, which the host bounds at
      // 60s; the ordinary request deadline would cut it short.
      mutateLong<GeneratedMessage>(
        '/generateCommitMessage',
        { session: sessionId, locale },
        signal,
      ),
    showCommit: (sessionId, hash, signal) =>
      request<CommitDetail>('/showCommit', { session: sessionId, hash }, signal),
    undoCommit: (sessionId, hash, signal) =>
      mutate<UndoResult>('/undoCommit', { session: sessionId, hash }, signal),
    revertCommit: (sessionId, hash, signal) =>
      mutate<OperationReport>('/revertCommit', { session: sessionId, hash }, signal),
    cherryPick: (sessionId, hash, signal) =>
      mutate<OperationReport>('/cherryPick', { session: sessionId, hash }, signal),
    resetTo: (sessionId, hash, mode: ResetMode, signal) =>
      mutate<OperationReport>('/reset', { session: sessionId, hash, mode }, signal),
    rewriteCommit: (sessionId, hash, action: RewriteAction, signal) =>
      // A rewrite replays history through a 60s rebase; see the note above.
      mutateLong<OperationReport>('/rewrite', { session: sessionId, hash, action }, signal),

    stashes: (sessionId, signal) =>
      request<readonly StashEntry[]>('/stashes', { session: sessionId }, signal),
    // `untracked` and `pop` are sent as booleans, and the host reads absent as
    // false: one argument, two spellings of the same intent, exactly as `base:
    // null` is for `createBranch`.
    stashSave: (sessionId, message, untracked, signal) =>
      mutate<OperationReport>('/stashSave', { session: sessionId, message, untracked }, signal),
    stashApply: (sessionId, oid, pop, signal) =>
      mutate<OperationReport>('/stashApply', { session: sessionId, oid, pop }, signal),
    // The entry is addressed by commit id, never by `stash@{n}`: a selector is a
    // position another window can shift, and the host resolves the id itself.
    stashDrop: (sessionId, oid, signal) =>
      mutate<OperationReport>('/stashDrop', { session: sessionId, oid }, signal),

    // Deployment configuration rather than repository data — but it travels the
    // same transport, so the UI still knows exactly one way to reach the host.
    fileIcons: (sessionId, signal) =>
      request<Readonly<Record<string, string>>>('/fileIcons', { session: sessionId }, signal),

    watch(sessionId, onChange) {
      /** Every kind: the guesses this transport makes on its own. */
      const ALL: GitChange = { kinds: ['refs', 'index', 'worktree'] }
      // Polling only: no stream available in this browser.
      if (typeof EventSource === 'undefined') {
        const timer = window.setInterval(() => onChange(ALL), POLL_FALLBACK_MS)
        return () => window.clearInterval(timer)
      }

      const url = new URL(`${ROUTE_PREFIX}/events`, window.location.origin)
      url.searchParams.set('session', sessionId)
      const source = new EventSource(url)
      let poll: number | undefined

      const onChanged = (event: Event): void => onChange(readChange((event as MessageEvent).data))
      source.addEventListener('changed', onChanged)
      // The panel reads the repository as it mounts, and the host's probe
      // becomes live a moment later; a change landing in between would otherwise
      // be the one change nobody reports. Re-reading once on `ready` closes that
      // window, and an unchanged repository publishes nothing.
      const onReady = (): void => onChange(ALL)
      source.addEventListener('ready', onReady)

      // The host says "unavailable" when it cannot watch anything yet — most
      // often because the session's directory is not a repository. Closing the
      // stream and polling instead means a `git init` performed afterwards still
      // reaches the panel, instead of leaving a dead stream attached forever.
      source.addEventListener('unavailable', () => {
        source.close()
        source.removeEventListener('changed', onChanged)
        source.removeEventListener('ready', onReady)
        if (poll === undefined) poll = window.setInterval(() => onChange(ALL), POLL_FALLBACK_MS)
      })

      return () => {
        source.removeEventListener('changed', onChanged)
        source.removeEventListener('ready', onReady)
        source.close()
        if (poll !== undefined) window.clearInterval(poll)
      }
    },
  }
}

/**
 * Read one `changed` frame's payload.
 *
 * The frame is the host's {@link GitChange}. Anything unreadable — an older
 * host, a proxy that ate the body — becomes "every kind": re-reading something
 * unchanged is cheap once the panel compares the reading, and missing a change
 * is not.
 * @param data - The frame's data field.
 * @returns What moved, or every kind when the frame cannot be trusted.
 */
function readChange(data: string): GitChange {
  try {
    const kinds = (JSON.parse(data) as { kinds?: unknown }).kinds
    if (Array.isArray(kinds)) {
      const known = kinds.filter(
        (kind): kind is GitChangeKind => kind === 'refs' || kind === 'index' || kind === 'worktree',
      )
      if (known.length > 0) return { kinds: known }
    }
  } catch {
    // Fall through to the conservative answer.
  }
  return { kinds: ['refs', 'index', 'worktree'] }
}
