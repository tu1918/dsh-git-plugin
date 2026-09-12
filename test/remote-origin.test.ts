/**
 * Credential addressing (the HTTPS credential feature).
 *
 * git names the remote's origin in its prompt and nothing finer, so the origin
 * is the key a credential is stored under. These tests pin the two derivations:
 * the origin itself, and the record id the harness's key grammar will accept.
 *
 * @module dsh-git-panel/test/remote-origin
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { credentialRecordId, originOf } from '../src/core/remote-origin.ts'

describe('originOf', () => {
  it('keeps the scheme, host and port, and drops everything finer', () => {
    assert.equal(originOf('https://codeup.aliyun.com/group/repo.git'), 'https://codeup.aliyun.com')
    assert.equal(originOf('http://127.0.0.1:34567/repo.git'), 'http://127.0.0.1:34567')
    assert.equal(originOf('https://host:8443/a/b/'), 'https://host:8443')
  })

  it('drops user info and a default port, which git’s own prompt also omits', () => {
    assert.equal(originOf('https://user@host/path'), 'https://host')
    assert.equal(originOf('https://host:443/path'), 'https://host')
  })

  it('answers null for a remote that never authenticates with a password', () => {
    // SSH and scp-shaped remotes use a key, `git://` has no auth at all, and a
    // string this parser cannot read is nothing to store against.
    assert.equal(originOf('git@github.com:owner/repo.git'), null)
    assert.equal(originOf('ssh://git@host/repo.git'), null)
    assert.equal(originOf('git://host/repo.git'), null)
    assert.equal(originOf('/local/path/repo'), null)
    assert.equal(originOf(''), null)
  })
})

describe('credentialRecordId', () => {
  it('produces a legal record key segment', () => {
    // The seam's key grammar is `^[a-z][a-z0-9-]*$`, which a URL never satisfies.
    const id = credentialRecordId('https://codeup.aliyun.com')
    assert.match(id, /^[a-z][a-z0-9-]*$/u)
    assert.match(id, /codeup-aliyun-com/u, 'readable, so a stored record can be recognised')
  })

  it('is stable and separates different origins', () => {
    const one = credentialRecordId('https://host')
    assert.equal(one, credentialRecordId('https://host'))
    assert.notEqual(one, credentialRecordId('http://host'))
    assert.notEqual(one, credentialRecordId('https://host:8443'))
  })

  it('caps a long host without losing uniqueness', () => {
    const long = `https://${'a'.repeat(120)}.example`
    const id = credentialRecordId(long)
    assert.ok(id.length <= 48, `id is ${id.length} characters`)
    assert.match(id, /^[a-z][a-z0-9-]*$/u)
    assert.notEqual(id, credentialRecordId(`https://${'a'.repeat(119)}.example`))
  })
})
