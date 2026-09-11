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

import type { GitPanelError, GitRemoteClient, Result } from '../../core/ports.ts'
import type { BranchRef, LogPage, RepoStatus } from '../../core/types.ts'

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
    const body: unknown = await response.json()
    if (typeof body !== 'object' || body === null || !('ok' in body)) {
      return { ok: false, error: { code: 'internal', message: 'the host sent a malformed reply' } }
    }
    const envelope = body as Envelope<T>
    return envelope.ok ? { ok: true, value: envelope.value } : { ok: false, error: envelope.error }
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

    watch(sessionId, onChange) {
      // Polling only: no stream available in this browser.
      if (typeof EventSource === 'undefined') {
        const timer = setInterval(onChange, POLL_FALLBACK_MS)
        return () => clearInterval(timer)
      }

      const url = new URL(`${ROUTE_PREFIX}/events`, window.location.origin)
      url.searchParams.set('session', sessionId)
      const source = new EventSource(url)
      let poll: ReturnType<typeof setInterval> | undefined

      const onChanged = (): void => onChange()
      source.addEventListener('changed', onChanged)

      // The host says "unavailable" when it cannot watch anything yet — most
      // often because the session's directory is not a repository. Closing the
      // stream and polling instead means a `git init` performed afterwards still
      // reaches the panel, instead of leaving a dead stream attached forever.
      source.addEventListener('unavailable', () => {
        source.close()
        source.removeEventListener('changed', onChanged)
        if (poll === undefined) poll = setInterval(onChange, POLL_FALLBACK_MS)
      })

      return () => {
        source.removeEventListener('changed', onChanged)
        source.close()
        if (poll !== undefined) clearInterval(poll)
      }
    },
  }
}
