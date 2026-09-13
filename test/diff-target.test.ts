/**
 * The identity of a diff request (FR-2.2, FR-7.2).
 *
 * The key exists for one question the panes ask: is the diff on screen still the
 * one the user asked for? The two working comparisons of the SAME path are
 * different readings, and so is a commit's; a key that collapsed any of them
 * would let a pane keep showing the wrong one.
 *
 * @module dsh-git-panel/test/diff-target
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { diffTargetFromKey, diffTargetKey } from '../src/core/diff-target.ts'

describe('diff target keys', () => {
  it('names each working comparison', () => {
    assert.equal(diffTargetKey({ area: 'worktree' }), 'worktree')
    assert.equal(diffTargetKey({ area: 'index' }), 'index')
  })

  it('carries the revision a commit diff is read against', () => {
    assert.equal(diffTargetKey({ area: 'commit', hash: 'abc123' }), 'commit:abc123')
  })

  it('separates the same path read three different ways', () => {
    const keys = [
      diffTargetKey({ area: 'worktree' }),
      diffTargetKey({ area: 'index' }),
      diffTargetKey({ area: 'commit', hash: 'abc123' }),
      diffTargetKey({ area: 'commit', hash: 'def456' }),
    ]
    assert.equal(new Set(keys).size, keys.length)
  })
})

describe('reading a key back', () => {
  it('recovers every target the key can name', () => {
    // A right-side diff tab is restored from its address alone, so the key it was
    // opened under has to name the whole target again.
    for (const target of [
      { area: 'worktree' },
      { area: 'index' },
      { area: 'commit', hash: 'abc123' },
    ] as const) {
      assert.deepEqual(diffTargetFromKey(diffTargetKey(target)), target)
    }
  })

  it('refuses a string that is not a key', () => {
    assert.equal(diffTargetFromKey(''), null)
    assert.equal(diffTargetFromKey('staged'), null)
    assert.equal(diffTargetFromKey('commit:'), null)
  })
})
