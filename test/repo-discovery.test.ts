/**
 * Finding a session's repositories (FR-8).
 *
 * The rules being pinned are the doc's own: look at the directory, then ONE level
 * down, skipping dependency and build directories; the default repository is the
 * one whose git state moved most recently. Everything runs over real git and real
 * directories, because the scan's whole job is to interpret what `rev-parse` and
 * the filesystem actually answer.
 *
 * @module dsh-git-panel/test/repo-discovery
 */

import { existsSync, mkdirSync, utimesSync } from 'node:fs'
import { basename, join } from 'node:path'
import { after, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  discoverRepos,
  recencyOf,
  resetDiscoveryCache,
  type RunCapture,
} from '../src/host/repo-discovery.ts'
import { cleanupRepos, git, gitTry, makePlainDir, makeRepo } from './helpers/repo.ts'

after(cleanupRepos)

/** Run git the way the service's discovery capture does. */
const capture: RunCapture = (args, cwd) => {
  const outcome = gitTry(cwd, args)
  return Promise.resolve(outcome.code === 0 ? outcome.stdout : null)
}

beforeEach(() => {
  resetDiscoveryCache()
})

/** Create a repository at `join(container, name)`, making the container if needed. */
function childRepo(container: string, name: string): string {
  mkdirSync(container, { recursive: true })
  git(container, ['init', '-q', name])
  return join(container, name)
}

/** Set a file's mtime when it exists, so "most recently active" is a fact. */
function stamp(path: string, seconds: number): void {
  if (existsSync(path)) utimesSync(path, seconds, seconds)
}

describe('discoverRepos (FR-8.1)', () => {
  it('answers the directory itself when it is a repository', async () => {
    const repo = makeRepo('discover-direct')
    const roots = await discoverRepos(capture, repo)
    assert.equal(roots.length, 1)
    assert.equal(roots[0], repo)
  })

  it('lists the child repositories of a container, skipping dependencies and build output', async () => {
    const container = makePlainDir('discover-container')
    const alpha = childRepo(container, 'alpha')
    const beta = childRepo(container, 'beta')
    // Each of these holds a repository, and each must be invisible to the scan.
    for (const skipped of ['node_modules', 'dist', 'build', '.hidden']) {
      childRepo(join(container, skipped), 'inner')
    }
    // A plain directory with no repository at all contributes nothing.
    mkdirSync(join(container, 'notes'), { recursive: true })

    const roots = await discoverRepos(capture, container)
    assert.deepEqual(new Set(roots.map((root) => basename(root))), new Set(['alpha', 'beta']))
    assert.ok(roots.includes(alpha) || roots.includes(alpha), 'the real paths are what is reported')
  })

  it('puts the most recently used repository first, and breaks ties by name', async () => {
    const container = makePlainDir('discover-recency')
    const older = childRepo(container, 'a-older')
    const newer = childRepo(container, 'b-newer')
    // `older` was touched a minute ago, `newer` a second ago — and the names are
    // arranged the other way round, so this asserts recency, not order.
    const now = Date.now() / 1000
    stamp(join(older, '.git', 'HEAD'), now - 60)
    stamp(join(newer, '.git', 'HEAD'), now - 1)

    const roots = await discoverRepos(capture, container)
    assert.deepEqual(roots.map((root) => basename(root)), ['b-newer', 'a-older'])

    // With both stamped alike, the name decides — a stable answer.
    stamp(join(older, '.git', 'HEAD'), now - 5)
    stamp(join(newer, '.git', 'HEAD'), now - 5)
    resetDiscoveryCache()
    const tied = await discoverRepos(capture, container)
    assert.deepEqual(tied.map((root) => basename(root)), ['a-older', 'b-newer'])
  })

  it('answers nothing for a directory that holds no repository', async () => {
    const empty = makePlainDir('discover-empty')
    mkdirSync(join(empty, 'notes'), { recursive: true })
    assert.deepEqual(await discoverRepos(capture, empty), [])
  })

  it('reuses one scan for a directory, until it is asked to forget', async () => {
    const container = makePlainDir('discover-cache')
    mkdirSync(join(container, 'notes'), { recursive: true })
    childRepo(container, 'one')

    const first = await discoverRepos(capture, container)
    const second = await discoverRepos(capture, container)
    // The same array instance comes back, which is only true of a cache hit.
    assert.equal(first, second)

    // A repository added under the container appears once the cache is dropped —
    // the TTL is short for exactly this reason.
    childRepo(container, 'two')
    resetDiscoveryCache()
    const fresh = await discoverRepos(capture, container)
    assert.equal(fresh.length, 2)
  })

  it('stamps a repository by its git state, and answers 0 when there is none', async () => {
    const repo = makeRepo('discover-recency-zero')
    // A repository git itself created has a HEAD to go by.
    assert.ok((await recencyOf(repo)) > 0)
    // A directory that is not a repository at all has no state to offer.
    assert.equal(await recencyOf(makePlainDir('discover-recency-none')), 0)
  })
})
