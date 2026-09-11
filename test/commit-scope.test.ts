/**
 * FR-3.4's decision table, tested as the pure function it is.
 *
 * This is the doc's sharpest lesson from the comparable plugin (§1.3, point 5):
 * a commit button that quietly widens what it commits makes the list a lie. The
 * table below is the whole rule, so a future change to the button's behaviour has
 * to change a case here first — including the conflict case, which is easy to get
 * wrong in the direction of "some files are staged, so let them commit".
 *
 * @module dsh-git-panel/test/commit-scope
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { commitPlanOf, commitScopeOf } from '../src/core/commit-scope.ts'
import type { FileChange, StatusGroups } from '../src/core/types.ts'

/** One change, with only the fields the fixtures care about set. */
function change(path: string): FileChange {
  return { path, index: 'M', worktree: 'M', staged: false, untracked: false, conflicted: false }
}

/** One conflicted change. */
function conflict(path: string): FileChange {
  return { path, index: 'U', worktree: 'U', staged: true, untracked: false, conflicted: true }
}

/** One untracked change. */
function untracked(path: string): FileChange {
  return { path, index: '?', worktree: '.', staged: false, untracked: true, conflicted: false }
}

/** The four groups, with only the named ones populated. */
function groups(parts: Partial<StatusGroups>): StatusGroups {
  return {
    staged: parts.staged ?? [],
    unstaged: parts.unstaged ?? [],
    untracked: parts.untracked ?? [],
    conflicted: parts.conflicted ?? [],
  }
}

describe('the commit scope', () => {
  it('is `staged` when the index has content, whatever else is around', () => {
    const scope = commitScopeOf(
      groups({
        staged: [change('a.txt')],
        unstaged: [change('b.txt')],
        untracked: [untracked('c.txt')],
      }),
    )
    assert.deepEqual(scope, { kind: 'staged', count: 1 })
  })

  it('is `all-tracked` when only tracked files changed, and says how many', () => {
    const scope = commitScopeOf(
      groups({ unstaged: [change('a.txt'), change('b.txt')], untracked: [untracked('c.txt')] }),
    )
    // The untracked file is deliberately not part of the count: `add -u` will not
    // touch it, so promising it would be the very lie FR-3.4 is about.
    assert.deepEqual(scope, { kind: 'all-tracked', count: 2 })
  })

  it('is `untracked-only` when untracked files are all there is', () => {
    assert.deepEqual(commitScopeOf(groups({ untracked: [untracked('a.txt')] })), {
      kind: 'untracked-only',
      count: 1,
    })
  })

  it('is `clean` for an untouched repository', () => {
    assert.deepEqual(commitScopeOf(groups({})), { kind: 'clean' })
  })

  it('is `conflicted` even when some paths are already resolved', () => {
    // Order matters: `git commit` refuses while any path is unmerged, so a
    // button promising "commit the index" would be a button that cannot work.
    const scope = commitScopeOf(
      groups({
        staged: [change('resolved.txt')],
        conflicted: [conflict('both.txt')],
        unstaged: [change('other.txt')],
      }),
    )
    assert.deepEqual(scope, { kind: 'conflicted', count: 1 })
  })
})

describe('the commit plan', () => {
  it('commits the index without widening for `staged`', () => {
    assert.deepEqual(commitPlanOf({ kind: 'staged', count: 3 }), { enabled: true, all: false })
  })

  it('widens explicitly for `all-tracked`', () => {
    assert.deepEqual(commitPlanOf({ kind: 'all-tracked', count: 2 }), { enabled: true, all: true })
  })

  it('disables the button for every scope that cannot commit', () => {
    for (const scope of [
      { kind: 'conflicted', count: 1 },
      { kind: 'untracked-only', count: 4 },
      { kind: 'clean' },
    ] as const) {
      assert.deepEqual(commitPlanOf(scope), { enabled: false, all: false })
    }
  })
})
