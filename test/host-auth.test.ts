/**
 * The host's credential adapter, driven with a stand-in context.
 *
 * This is the one file in the plugin that names `ctx.credentials`, so it is also
 * the one place a wrong record shape or key would only show up in production:
 * the seam accepts any `(scope, id)` pair and any JSON payload, so nothing but
 * these tests says the pair and the payload are the ones this plugin meant.
 *
 * @module dsh-git-panel/test/host-auth
 */

import { credentialKey } from '@deepseek-ai/dsh-credentials'
import type { Context } from '@deepseek-ai/cordis'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { credentialRecordId } from '../src/core/remote-origin.ts'
import { createGitCredentials } from '../src/host/adapter/credentials.ts'

const ORIGIN = 'https://codeup.aliyun.com'

/** One write the stub provider recorded. */
interface Saved {
  readonly key: string
  readonly record: unknown
}

/**
 * A context offering the credential service, or not.
 * @param options - The stored record, whether the service exists, and whether it throws.
 * @returns The stub context and the writes it recorded.
 */
function stubCtx(options: {
  readonly stored?: unknown
  readonly withProvider?: boolean
  readonly throws?: boolean
}): { ctx: Context; saved: Saved[] } {
  const saved: Saved[] = []
  const ctx = {
    get: (name: string) => {
      if (name !== 'credentials' || options.withProvider === false) return undefined
      return {
        async readRecord(_key: string) {
          if (options.throws === true) throw new Error('provider exploded')
          return options.stored
        },
        async modifyRecord(key: string, mutate: (current: unknown) => Promise<unknown>) {
          if (options.throws === true) throw new Error('provider exploded')
          const record = await mutate(undefined)
          saved.push({ key, record })
          return record
        },
      }
    },
  } as unknown as Context
  return { ctx, saved }
}

describe('the host credential adapter', () => {
  it('reads a stored grant back as a username and password', async () => {
    const { ctx } = stubCtx({
      stored: { kind: 'grant', payload: { username: 'ada', password: 'token-123' } },
    })
    const store = createGitCredentials(ctx)
    const result = await store.read(ORIGIN)
    assert.ok(result.ok)
    assert.deepEqual(result.value, { username: 'ada', password: 'token-123' })
  })

  it('treats another kind, or a payload this plugin did not write, as nothing stored', async () => {
    // The record is ours, but a hand-edited document or a future version could
    // disagree; a git operation must not fail because of that.
    for (const stored of [
      undefined,
      { kind: 'api-key', key: 'sk-123' },
      { kind: 'grant', payload: 'not-an-object' },
      { kind: 'grant', payload: { username: 7, password: 'x' } },
      { kind: 'grant', payload: { username: 'ada', password: '' } },
    ]) {
      const { ctx } = stubCtx({ stored })
      const result = await createGitCredentials(ctx).read(ORIGIN)
      assert.ok(result.ok, JSON.stringify(stored))
      assert.equal(result.value, null, JSON.stringify(stored))
    }
  })

  it('writes a grant under the plugin’s own scope and the origin’s id', async () => {
    const { ctx, saved } = stubCtx({})
    const store = createGitCredentials(ctx)
    const result = await store.save(ORIGIN, { username: 'ada', password: 'token-123' })
    assert.ok(result.ok, result.ok ? '' : JSON.stringify(result.error))
    assert.equal(saved.length, 1)
    assert.equal(saved[0]?.key, credentialKey('ui-git-panel', credentialRecordId(ORIGIN)))
    assert.deepEqual(saved[0]?.record, {
      kind: 'grant',
      payload: { username: 'ada', password: 'token-123' },
    })
  })

  it('answers "nothing stored" for a read without a provider, and refuses to save', async () => {
    const { ctx } = stubCtx({ withProvider: false })
    const store = createGitCredentials(ctx)
    const read = await store.read(ORIGIN)
    assert.ok(read.ok)
    assert.equal(read.value, null)

    const save = await store.save(ORIGIN, { username: 'ada', password: 'token-123' })
    assert.equal(save.ok, false)
    assert.equal(save.ok ? '' : save.error.code, 'credentials-unavailable')
  })

  it('turns a throwing provider into an ordinary failure', async () => {
    const { ctx } = stubCtx({ throws: true })
    const store = createGitCredentials(ctx)
    const read = await store.read(ORIGIN)
    assert.equal(read.ok, false)
    assert.equal(read.ok ? '' : read.error.code, 'internal')
    const save = await store.save(ORIGIN, { username: 'ada', password: 'token-123' })
    assert.equal(save.ok, false)
    assert.equal(save.ok ? '' : save.error.code, 'internal')
  })
})
