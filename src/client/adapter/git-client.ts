/**
 * DSH adapter: the HTTP/SSE transport, behind the core's {@link GitRemoteClient}.
 *
 * This file is the only place in the browser half that knows a URL exists, which
 * is the whole point of the port: swapping `webServer` routes for a Typert Remote
 * later means rewriting this file and nothing else — no component, no hook, no
 * dictionary.
 *
 * Two transport details are worth stating outright:
 *
 * - Every response is the host's `{ ok, value } | { ok, error }` envelope, and a
 *   failure is returned as data rather than thrown. A network fault becomes the
 *   same shape, so the UI has exactly one error path.
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
  GeneratedMessage,
  LogPage,
  OperationReport,
  RepoStatus,
  FileDiff,
} from '../../core/types.ts'

/** The host route prefix; must match `host/routes.ts`. */
const ROUTE_PREFIX = '/git-panel'

/** Poll interval used when the stream is unavailable (FR-1.4's fallback). */
const POLL_FALLBACK_MS = 10_000

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
 * Issue one JSON operation.
 * @param path - Route path under the prefix.
 * @param params - Query parameters.
 * @param signal - Caller cancellation.
 * @returns The envelope the host sent, or a transport failure.
 */
async function request<T>(
  path: string,
  params: Readonly<Record<string, string | number>>,
  signal?: AbortSignal,
): Promise<Result<T>> {
  const url = new URL(`${ROUTE_PREFIX}${path}`, window.location.origin)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value))

  try {
    const response = await fetch(url, {
      method: 'GET',
      // Same-origin, so the session cookie rides along; the host's own fence
      // decides whether this client may talk to it at all.
      credentials: 'same-origin',
      headers: { accept: 'application/json' },
      ...(signal === undefined ? {} : { signal }),
    })
    return envelopeOf<T>(await response.json())
  } catch (error) {
    return transportFailure(error, signal?.aborted === true)
  }
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
 * @returns The envelope the host sent, or a transport failure.
 */
async function mutate<T>(
  path: string,
  body: Readonly<Record<string, unknown>>,
  signal?: AbortSignal,
): Promise<Result<T>> {
  const url = new URL(`${ROUTE_PREFIX}${path}`, window.location.origin)
  try {
    const response = await fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify(body),
      ...(signal === undefined ? {} : { signal }),
    })
    return envelopeOf<T>(await response.json())
  } catch (error) {
    return transportFailure(error, signal?.aborted === true)
  }
}

/**
 * Build the browser's git client.
 * @returns The client the panel is handed.
 */
export function createGitRemoteClient(): GitRemoteClient {
  return {
    status: (sessionId, signal) => request<RepoStatus>('/status', { session: sessionId }, signal),
    branches: (sessionId, signal) =>
      request<readonly BranchRef[]>('/branches', { session: sessionId }, signal),
    log: (sessionId, offset, limit, signal) =>
      request<LogPage>('/log', { session: sessionId, offset, limit }, signal),
    // The host's own parameter names, not the panel's: `path`/`area`/`context`
    // are what `host/routes.ts` reads, and the `area` value is the core's
    // `DiffArea` verbatim so no translation table can drift between the halves.
    diff: (sessionId, path, area, contextLines, signal) =>
      request<FileDiff>('/diff', { session: sessionId, path, area, context: contextLines }, signal),

    stage: (sessionId, paths, signal) =>
      mutate<OperationReport>('/stage', { session: sessionId, paths }, signal),
    unstage: (sessionId, paths, signal) =>
      mutate<OperationReport>('/unstage', { session: sessionId, paths }, signal),
    commit: (sessionId, message, signal) =>
      mutate<CommitInfo>('/commit', { session: sessionId, message }, signal),
    // The one argument that separates FR-3.4's two commits, named as the flag the
    // button's copy promises: `add -u` first, then commit.
    commitAll: (sessionId, message, signal) =>
      mutate<CommitInfo>('/commit', { session: sessionId, message, all: true }, signal),
    push: (sessionId, signal) => mutate<OperationReport>('/push', { session: sessionId }, signal),
    pull: (sessionId, signal) => mutate<OperationReport>('/pull', { session: sessionId }, signal),
    sync: (sessionId, signal) => mutate<OperationReport>('/sync', { session: sessionId }, signal),

    checkout: (sessionId, name, signal) =>
      mutate<OperationReport>('/checkout', { session: sessionId, name }, signal),
    // `base: null` is the "from the current HEAD" case, and the host reads an
    // absent base the same way — one argument, two spellings of the same intent.
    createBranch: (sessionId, name, base, signal) =>
      mutate<OperationReport>('/createBranch', { session: sessionId, name, base }, signal),
    deleteBranch: (sessionId, name, force, signal) =>
      mutate<OperationReport>('/deleteBranch', { session: sessionId, name, force }, signal),
    continueMerge: (sessionId, signal) =>
      mutate<OperationReport>('/continueMerge', { session: sessionId }, signal),
    abortMerge: (sessionId, signal) =>
      mutate<OperationReport>('/abortMerge', { session: sessionId }, signal),
    generateCommitMessage: (sessionId, locale, signal) =>
      mutate<GeneratedMessage>(
        '/generateCommitMessage',
        { session: sessionId, locale },
        signal,
      ),
    showCommit: (sessionId, hash, signal) =>
      request<CommitDetail>('/showCommit', { session: sessionId, hash }, signal),

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
