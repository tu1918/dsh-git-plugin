/**
 * The git state probe's tests: real repositories, real filesystem events.
 *
 * What is worth testing here is exactly what the panel used to miss. A commit
 * that changes a file moves `.git/index`, so an mtime poll heard it — but an
 * empty commit, a `git update-ref`, and a `git fetch` move only a ref or the
 * reflog, and a file written by an agent moves nothing inside `.git` at all.
 * Three of these tests are those three cases, stated as the kinds they must
 * produce.
 *
 * The probe is also the one host module whose strategies are injectable, so the
 * fallback and the hand-over are tested with fake strategies rather than by
 * trying to exhaust a real machine's inotify descriptors.
 *
 * @module dsh-git-panel/test/git-probe
 */

import { after, describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  createGitProbe,
  kindsInGitDir,
  kindsInWorkTree,
  pollStrategy,
  type ProbeStrategy,
} from '../src/host/git-probe.ts'
import type { GitChange, GitChangeKind, HostPorts } from '../src/core/ports.ts'
import { cleanupRepos, git, makeRepo, write } from './helpers/repo.ts'

after(cleanupRepos)

/** A silent diagnostic port; a test asserting on logs would be testing noise. */
const SILENT: HostPorts = {
  log: () => undefined,
  generateText: () => Promise.reject(new Error('no model in this test')),
}

/** Every kind seen so far, and a way to wait for the next report. */
interface Collector {
  readonly seen: GitChange[]
  /** Record one report; the probe calls this. */
  readonly push: (change: GitChange) => void
  /** Resolve as soon as one more report arrives. */
  readonly next: (timeoutMs?: number) => Promise<void>
  /** Every kind reported so far. */
  readonly kinds: () => ReadonlySet<GitChangeKind>
}

/** Collect reports from a probe subscription. */
function collector(): Collector {
  const seen: GitChange[] = []
  let waiters: (() => void)[] = []
  return {
    seen,
    push(change) {
      seen.push(change)
      const pending = waiters
      waiters = []
      for (const waiter of pending) waiter()
    },
    next(timeoutMs = 4_000) {
      return new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error(`no report within ${timeoutMs}ms; saw ${JSON.stringify(seen)}`))
        }, timeoutMs)
        waiters.push(() => {
          clearTimeout(timer)
          resolve()
        })
      })
    },
    kinds: () => new Set(seen.flatMap((change) => change.kinds)),
  }
}

/** Wait long enough for a coalescing window plus one more to have elapsed. */
async function quiet(ms = 300): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

describe('classifying what moved', () => {
  it('names a working-tree path as a worktree change', () => {
    assert.deepEqual(kindsInWorkTree('src/client/ui/StatusPanel.tsx'), ['worktree'])
    assert.deepEqual(kindsInWorkTree('notes.md'), ['worktree'])
    // Separators are the platform's; the classifier is not.
    assert.deepEqual(kindsInWorkTree('src\\core\\types.ts'), ['worktree'])
  })

  it('names the index, a ref, and everything else inside .git', () => {
    assert.deepEqual(kindsInWorkTree('.git/index'), ['index'])
    assert.deepEqual(kindsInWorkTree('.git/index.lock'), ['index'])
    assert.deepEqual(kindsInWorkTree('.git/HEAD'), ['refs'])
    assert.deepEqual(kindsInWorkTree('.git/logs/HEAD'), ['refs'])
    assert.deepEqual(kindsInWorkTree('.git/refs/heads/main'), ['refs'])
    assert.deepEqual(kindsInWorkTree('.git/FETCH_HEAD'), ['refs'])
    assert.deepEqual(kindsInWorkTree('.git/MERGE_HEAD'), ['refs'])
    // Objects are written by `git add` too, so calling them a ref move would
    // re-read the commit log on every stage. They are unnamed git state.
    assert.deepEqual(kindsInWorkTree('.git/objects/ab/cdef'), ['index'])
    assert.deepEqual(kindsInGitDir(['HEAD']), ['refs'])
    assert.deepEqual(kindsInGitDir(['logs', 'HEAD']), ['refs'])
    assert.deepEqual(kindsInGitDir(['index']), ['index'])
    assert.deepEqual(kindsInGitDir([]), ['refs', 'index', 'worktree'])
  })

  it('answers "everything" when the event has no name to classify', () => {
    // A recursive watcher on some platforms reports a bare directory event.
    assert.deepEqual(kindsInWorkTree(null), ['refs', 'index', 'worktree'])
  })
})

describe('the git state probe', () => {
  it('reports a file an agent writes, which no .git file moves for', async () => {
    const repo = makeRepo('probe-worktree')
    const probe = createGitProbe(SILENT)
    const seen = collector()
    try {
      await probe.watch(repo, seen.push)
      write(repo, 'brand-new.txt', 'written by the agent\n')
      await seen.next()
      assert.ok(seen.kinds().has('worktree'), `expected a worktree kind, saw ${JSON.stringify(seen.seen)}`)
    } finally {
      probe.dispose()
    }
  })

  it('reports an empty commit, which leaves the index alone (FR-3.6)', async () => {
    const repo = makeRepo('probe-empty-commit')
    write(repo, 'a.txt', 'one\n')
    git(repo, ['add', 'a.txt'])
    git(repo, ['commit', '-m', 'first'])

    const probe = createGitProbe(SILENT)
    const seen = collector()
    try {
      await probe.watch(repo, seen.push)
      // `--allow-empty` writes the reflog and the branch ref and NOT the index:
      // the poll of index/HEAD mtime this probe used to be could not see it at
      // all, and the commit never appeared in the panel's history.
      git(repo, ['commit', '--allow-empty', '-m', 'empty'])
      await seen.next()
      assert.ok(seen.kinds().has('refs'), `expected a refs kind, saw ${JSON.stringify(seen.seen)}`)
    } finally {
      probe.dispose()
    }
  })

  it('reports a ref that moved without a checkout (fetch, push, branch)', async () => {
    const repo = makeRepo('probe-ref')
    write(repo, 'a.txt', 'one\n')
    git(repo, ['add', 'a.txt'])
    git(repo, ['commit', '-m', 'first'])
    const head = git(repo, ['rev-parse', 'HEAD']).trim()

    const probe = createGitProbe(SILENT)
    const seen = collector()
    try {
      await probe.watch(repo, seen.push)
      // A remote-tracking ref moving is what a fetch or a push looks like from
      // here; nothing in the working tree changes.
      git(repo, ['update-ref', 'refs/remotes/origin/main', head])
      await seen.next()
      assert.ok(seen.kinds().has('refs'), `expected a refs kind, saw ${JSON.stringify(seen.seen)}`)
    } finally {
      probe.dispose()
    }
  })

  it('coalesces a burst into one report instead of one per file', async () => {
    const repo = makeRepo('probe-burst')
    const probe = createGitProbe(SILENT)
    const seen = collector()
    try {
      await probe.watch(repo, seen.push)
      for (let index = 0; index < 12; index += 1) write(repo, `burst-${index}.txt`, `${index}\n`)
      await seen.next()
      await quiet()
      assert.ok(seen.seen.length >= 1, 'a burst must be reported')
      assert.ok(
        seen.seen.length < 12,
        `12 files must not be 12 reports, saw ${String(seen.seen.length)}`,
      )
    } finally {
      probe.dispose()
    }
  })

  it('hands over to the next strategy when one cannot watch', async () => {
    const repo = makeRepo('probe-fallback')
    const started: string[] = []
    const failing: ProbeStrategy = {
      name: 'always-fails',
      start() {
        started.push('failing')
        return Promise.reject(new Error('no watch descriptors left'))
      },
    }
    // Held on an object rather than in a `let`: TypeScript narrows a `let`
    // assigned only inside a callback to `never` at the call site.
    const captured: { emit?: (kinds: readonly GitChangeKind[]) => void } = {}
    const second: ProbeStrategy = {
      name: 'stand-in',
      start(_root, emit) {
        started.push('second')
        captured.emit = emit
        return Promise.resolve(() => undefined)
      },
    }

    const probe = createGitProbe(SILENT, { strategies: [failing, second] })
    const seen = collector()
    try {
      await probe.watch(repo, seen.push)
      assert.deepEqual(started, ['failing', 'second'], 'the probe must fall through the list')
      captured.emit?.(['refs'])
      await seen.next()
      assert.ok(seen.kinds().has('refs'))
    } finally {
      probe.dispose()
    }
  })

  it('hands over when a running strategy gives up later', async () => {
    const repo = makeRepo('probe-handover')
    const started: string[] = []
    const captured: { giveUp?: (reason: unknown) => void } = {}
    const flaky: ProbeStrategy = {
      name: 'flaky',
      start(_root, _emit, ctx) {
        started.push('flaky')
        captured.giveUp = ctx.unavailable
        return Promise.resolve(() => undefined)
      },
    }
    const steady: ProbeStrategy = {
      name: 'steady',
      start() {
        started.push('steady')
        return Promise.resolve(() => undefined)
      },
    }

    const probe = createGitProbe(SILENT, { strategies: [flaky, steady] })
    const seen = collector()
    try {
      await probe.watch(repo, seen.push)
      captured.giveUp?.(new Error('the mount went away'))
      await quiet(50)
      assert.deepEqual(started, ['flaky', 'steady'])
    } finally {
      probe.dispose()
    }
  })

  it('stops probing once the last subscriber leaves', async () => {
    const repo = makeRepo('probe-unsubscribe')
    const probe = createGitProbe(SILENT)
    const seen = collector()
    const release = await probe.watch(repo, seen.push)
    release()
    write(repo, 'after-release.txt', 'x\n')
    await quiet()
    assert.deepEqual(seen.seen, [], 'a released probe must not keep reporting')
    probe.dispose()
  })
})

describe('the polling fallback strategy', () => {
  it('reports a ref move, and re-states a worktree change on its own cadence', async () => {
    const repo = makeRepo('probe-poll')
    write(repo, 'a.txt', 'one\n')
    git(repo, ['add', 'a.txt'])
    git(repo, ['commit', '-m', 'first'])

    const probe = createGitProbe(SILENT, {
      // Short cadences: the fallback's job is the same one at a slower rhythm.
      strategies: [pollStrategy(SILENT, { stateMs: 20, worktreeMs: 60 })],
    })
    const seen = collector()
    try {
      await probe.watch(repo, seen.push)
      // The fallback's own floor: no `.git` file moves when a file is written,
      // so it has to say "worktree" itself or an untracked file never appears.
      await seen.next()
      assert.ok(seen.kinds().has('worktree'), `expected the worktree floor, saw ${JSON.stringify(seen.seen)}`)

      const before = seen.seen.length
      git(repo, ['commit', '--allow-empty', '-m', 'empty'])
      await seen.next()
      const after = seen.seen.slice(before)
      assert.ok(
        after.some((change) => change.kinds.includes('refs')),
        `expected a refs report from the poll, saw ${JSON.stringify(after)}`,
      )
    } finally {
      probe.dispose()
    }
  })
})
