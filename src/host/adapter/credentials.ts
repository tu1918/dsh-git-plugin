/**
 * DSH adapter: `ctx.credentials` → the core's credential store.
 *
 * This is the only file that names the harness's credential seam, which is the
 * §5.2 arrangement: the git service asks for one origin's username and password
 * and gets them (or a stated absence) back, and no test needs a credential
 * provider to exist.
 *
 * Why the harness's seam rather than a store of this plugin's own: the seam owns
 * only the *reference*; a provider owns the value and its storage. The local
 * provider used by this profile writes `$DSH_HOME/.credentials.yaml` at mode
 * 0600 and refuses to start if that file is readable beyond its owner. A
 * deployment with a keychain-backed provider gets that instead, and this file
 * does not change. What it does NOT buy is encryption today — the local
 * provider's document is plaintext, and that is the provider's business, not
 * something this plugin should pretend to have solved.
 *
 * Absence is a value, not a throw, exactly as with `ctx.llm`: a composition with
 * no credential provider still mounts the panel, and only the save path explains
 * that it cannot store anything. That is why the service is read through
 * `ctx.get` rather than declared in `inject`.
 *
 * The record is a `grant`: the seam's name for "payload written in the owner's
 * own format, opaque to everyone else", which is what a username and password
 * are. `describeRecord`/`listRecords` expose presence without values, so a
 * settings surface could later show that a credential is stored without ever
 * reading it.
 *
 * @module dsh-git-panel/host/adapter/credentials
 */

import { credentialKey } from '@deepseek-ai/dsh-credentials'
import type { Context } from '@deepseek-ai/cordis'

import { credentialRecordId } from '../../core/remote-origin.ts'
import type { GitCredential, GitCredentialStore, GitPanelError, Result } from '../../core/ports.ts'

/**
 * The scope segment of the record key.
 *
 * This plugin's registered id, which is what the seam documents a scope to be —
 * the owner, so that a record left behind by an uninstalled plugin can be told
 * apart from a live one.
 */
const SCOPE = 'ui-git-panel'

/** Turn a thrown provider failure into the panel's own shape. */
function thrown(error: unknown): GitPanelError {
  return {
    code: 'internal',
    message: error instanceof Error ? error.message : String(error),
  }
}

/**
 * Pull a credential out of a stored record, or state that there is none.
 *
 * A record of another kind, or one whose payload is not the shape this plugin
 * wrote, reads as absent rather than as an error: the record is ours, but a
 * hand-edited document or a future version could disagree, and no git operation
 * should fail because of that.
 * @param payload - The record's opaque payload.
 * @returns The credential, or `null`.
 */
function credentialOf(payload: unknown): GitCredential | null {
  if (typeof payload !== 'object' || payload === null) return null
  const fields = payload as { readonly username?: unknown; readonly password?: unknown }
  if (typeof fields.username !== 'string' || typeof fields.password !== 'string') return null
  if (fields.username === '' || fields.password === '') return null
  return { username: fields.username, password: fields.password }
}

/**
 * Build the credential store over this context's credential seam.
 * @param ctx - Host context.
 * @returns A store that answers "nothing stored" when the composition has no provider.
 */
export function createGitCredentials(ctx: Context): GitCredentialStore {
  return {
    async read(origin: string): Promise<Result<GitCredential | null>> {
      const provider = ctx.get('credentials')
      if (provider === undefined) return { ok: true, value: null }
      try {
        const record = await provider.readRecord(credentialKey(SCOPE, credentialRecordId(origin)))
        if (record === undefined || record.kind !== 'grant') return { ok: true, value: null }
        return { ok: true, value: credentialOf(record.payload) }
      } catch (error: unknown) {
        return { ok: false, error: thrown(error) }
      }
    },

    async save(origin: string, credential: GitCredential): Promise<Result<void>> {
      const provider = ctx.get('credentials')
      if (provider === undefined) {
        return {
          ok: false,
          error: {
            code: 'credentials-unavailable',
            message: 'this deployment has no credential provider, so the credential cannot be saved',
          },
        }
      }
      try {
        await provider.modifyRecord(credentialKey(SCOPE, credentialRecordId(origin)), async () => ({
          kind: 'grant',
          payload: { username: credential.username, password: credential.password },
        }))
        return { ok: true, value: undefined }
      } catch (error: unknown) {
        return { ok: false, error: thrown(error) }
      }
    },
  }
}
