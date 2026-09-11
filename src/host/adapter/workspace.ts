/**
 * DSH adapter: `ctx.sessions` + `ctx.workspaceRegistry` → the core's
 * {@link SessionDirResolver}.
 *
 * ## Why the browser never sends a path
 *
 * The panel's whole security posture rests on this file. The browser sends one
 * opaque string — a session id — and this adapter turns it into a real
 * directory using the HOST's own session store. A path is never accepted from
 * the client, not even a relative one, so there is no traversal or confinement
 * check to get wrong: the set of reachable directories is exactly the set of
 * directories the user's own sessions were created in (§5.5).
 *
 * The path is canonicalised through `fs.realpath` before anything runs in it,
 * so a symlinked workspace resolves to its target once, here, rather than
 * differently in each later git call.
 *
 * @module dsh-git-panel/host/adapter/workspace
 */

import { realpath } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-workspace'
import type { GitPanelError, HostPorts, Result, SessionDirResolver } from '../../core/ports.ts'

/**
 * Session ids are opaque, but they arrive from a URL, so their shape is still
 * bounded before a store lookup: a wrong-shaped id is a malformed request, not a
 * session that happens to be missing.
 */
const SESSION_ID = /^[A-Za-z0-9_-]{1,128}$/

/** Build one failure result. */
function fail(code: GitPanelError['code'], message: string): Result<never> {
  return { ok: false, error: { code, message } }
}

/**
 * Build the session→directory port over the host's session store.
 *
 * Workspace membership is checked only to log a diagnostic, never to refuse:
 * the resolved directory came from the host's own session header, so it is
 * already as trusted as the session itself, and a deployment that composes
 * sessions without registering a workspace would otherwise lose the panel
 * entirely. The refusal path is reserved for what the client actually controls —
 * the shape of the id it sent.
 * @param ctx - Host context carrying `sessions` (and `workspaceRegistry` when present).
 * @param ports - Diagnostic port.
 * @returns The resolver the git service uses.
 */
export function createSessionDirResolver(
  ctx: Context,
  ports: HostPorts,
): SessionDirResolver {
  return {
    async resolveDir(sessionId: string): Promise<Result<string>> {
      if (!SESSION_ID.test(sessionId)) {
        return fail('bad-request', `malformed session id: ${JSON.stringify(sessionId)}`)
      }

      const header = ctx.sessions.get(sessionId as SessionId)?.header
      if (header === undefined) {
        return fail('no-session', 'that session is not open in this dsh process')
      }
      const cwd = header.cwd
      if (cwd === undefined || cwd === '') {
        return fail('no-session', 'this session has no working directory')
      }

      let canonical: string
      try {
        canonical = await realpath(cwd)
      } catch {
        // The directory can be gone (a deleted worktree) while the session
        // record survives; that is a missing directory, not a crash.
        return fail('no-session', `this session's directory is gone: ${cwd}`)
      }

      // `ctx.get` rather than a hard inject: the registry is absent from
      // non-workspace compositions, and a diagnostic must not be able to stop
      // the plugin from loading.
      const registry = ctx.get('workspaceRegistry')
      if (registry !== undefined) {
        const known = registry.list().some((workspace) => workspace.path === canonical)
        if (!known) {
          ports.log(
            'warn',
            `session directory is not a registered workspace; serving it anyway: ${canonical}`,
          )
        }
      }

      return { ok: true, value: canonical }
    },
  }
}
