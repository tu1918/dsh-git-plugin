/**
 * Pure-parser tests: fixtures only, no git process, no filesystem.
 *
 * Fixture bytes here were copied from real `git` output (verified with `od -c`),
 * including the details that are easy to get wrong: NUL-terminated header lines,
 * a rename record's original path arriving as a SEPARATE NUL field, spaces
 * preserved inside a pathname, and an unborn branch spelling its oid
 * `(initial)`.
 *
 * @module dsh-git-panel/test/git-parse
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  badgeFor,
  changedPathCount,
  groupsOf,
  logPageOf,
  markPushed,
  parseBranches,
  parseLog,
  parseNumstat,
  parseStashList,
  parseStatusV2,
} from '../src/core/git-parse.ts'
import type { CommitInfo, FileChange } from '../src/core/types.ts'

/** Join status fields the way `-z` does. */
const z = (...fields: string[]): string => `${fields.join('\x00')}\x00`

/** Every header line plus record for a busy working tree. */
const BUSY_STATUS = z(
  '# branch.oid ec16a40f68cdf28927afb787c12bd9acd6dd143',
  '# branch.head master',
  '# branch.upstream origin/master',
  '# branch.ab +2 -3',
  '1 AM N... 000000 100644 100644 0000000000000000000000000000000000000000 4bcfe98e640c8284511312660fb8709b0afa888e del.txt',
  '1 .M N... 100644 100644 100644 814f4a422927b82f5f8a43f8fab6d3839e3983f2 814f4a422927b82f5f8a43f8fab6d3839e3983f2 plain.txt',
  '2 RM N... 100644 100644 100644 587be6b4c3f93f93c489c0111bba5596147a26cb 587be6b4c3f93f93c489c0111bba5596147a26cb R100 renamed file.txt',
  'with space.txt',
  '? untracked.txt',
  '! ignored.log',
)

describe('parseStatusV2', () => {
  it('reads HEAD position and upstream counts from the branch headers', () => {
    const { branch } = parseStatusV2(BUSY_STATUS)
    assert.equal(branch.oid, 'ec16a40f68cdf28927afb787c12bd9acd6dd143')
    assert.equal(branch.name, 'master')
    assert.equal(branch.upstream, 'origin/master')
    assert.equal(branch.ahead, 2)
    assert.equal(branch.behind, 3)
    assert.equal(branch.head, 'branch')
  })

  it('parses every record kind and skips ignored paths', () => {
    const { entries } = parseStatusV2(BUSY_STATUS)
    assert.deepEqual(
      entries.map((entry) => [entry.path, entry.index, entry.worktree]),
      [
        ['del.txt', 'A', 'M'],
        ['plain.txt', '.', 'M'],
        ['renamed file.txt', 'R', 'M'],
        ['untracked.txt', '?', '.'],
      ],
    )
  })

  it('keeps spaces inside a pathname instead of splitting on them', () => {
    const { entries } = parseStatusV2(BUSY_STATUS)
    const renamed = entries.find((entry) => entry.index === 'R')
    assert.ok(renamed)
    assert.equal(renamed.path, 'renamed file.txt')
    // The original path is the NEXT NUL field, not part of the rename record.
    assert.equal(renamed.origPath, 'with space.txt')
  })

  it('keeps a newline inside a pathname intact', () => {
    // Splitting on NUL rather than on newlines is exactly what preserves this.
    const raw = z('# branch.head master', '? odd\nname.txt')
    const { entries } = parseStatusV2(raw)
    assert.equal(entries.length, 1)
    assert.equal(entries[0]?.path, 'odd\nname.txt')
  })

  it('marks an unmerged path conflicted and keeps its own letter pair', () => {
    const raw = z(
      '# branch.head master',
      'u UU N... 100644 100644 100644 100644 aaa bbb ccc conflict.txt',
    )
    const { entries } = parseStatusV2(raw)
    assert.equal(entries.length, 1)
    assert.equal(entries[0]?.conflicted, true)
    assert.equal(entries[0]?.path, 'conflict.txt')
    assert.equal(entries[0]?.index, 'U')
    assert.equal(entries[0]?.worktree, 'U')
  })

  it('reports an unborn repository with its branch name and no oid', () => {
    // Real output for `git init` with no commit yet: `(initial)` and no
    // `branch.ab` line at all, because there is nothing to compare.
    const { branch, entries } = parseStatusV2(
      z('# branch.oid (initial)', '# branch.head master'),
    )
    assert.equal(branch.head, 'unborn')
    assert.equal(branch.oid, null)
    assert.equal(branch.name, 'master')
    assert.equal(branch.upstream, null)
    assert.equal(branch.ahead, 0)
    assert.equal(branch.behind, 0)
    assert.deepEqual(entries, [])
  })

  it('reports a detached HEAD with no branch name', () => {
    const { branch } = parseStatusV2(
      z('# branch.oid ec16a40', '# branch.head (detached)'),
    )
    assert.equal(branch.head, 'detached')
    assert.equal(branch.name, null)
    assert.equal(branch.oid, 'ec16a40')
  })

  it('tolerates unparseable records rather than failing the whole read', () => {
    const raw = z('# branch.head master', '1 M. too-short', '? kept.txt', 'X future record')
    const { entries } = parseStatusV2(raw)
    assert.deepEqual(entries.map((entry) => entry.path), ['kept.txt'])
  })

  it('treats an empty input as an empty, branch-less reading', () => {
    const { branch, entries } = parseStatusV2('')
    assert.equal(branch.oid, null)
    assert.equal(branch.head, 'branch')
    assert.deepEqual(entries, [])
  })
})

describe('groupsOf', () => {
  it('puts a dual-area change in both the staged and unstaged lists', () => {
    const { entries } = parseStatusV2(BUSY_STATUS)
    const groups = groupsOf(entries)
    assert.deepEqual(
      groups.staged.map((entry) => entry.path),
      ['del.txt', 'renamed file.txt'],
    )
    assert.deepEqual(
      groups.unstaged.map((entry) => entry.path),
      ['del.txt', 'plain.txt', 'renamed file.txt'],
    )
    assert.deepEqual(
      groups.untracked.map((entry) => entry.path),
      ['untracked.txt'],
    )
    assert.deepEqual(groups.conflicted, [])
  })

  it('lists a conflicted path only in the conflicts group', () => {
    const conflicted: FileChange = {
      path: 'both.txt',
      index: 'U',
      worktree: 'U',
      staged: true,
      untracked: false,
      conflicted: true,
    }
    const groups = groupsOf([conflicted])
    assert.deepEqual(groups.conflicted.map((entry) => entry.path), ['both.txt'])
    assert.deepEqual(groups.staged, [])
    assert.deepEqual(groups.unstaged, [])
  })
})

describe('changedPathCount', () => {
  it('counts each path once however many groups list it', () => {
    const { entries } = parseStatusV2(BUSY_STATUS)
    assert.equal(changedPathCount(entries), 4)
  })
})

describe('badgeFor', () => {
  it('shows the letter that belongs to the area being drawn', () => {
    const { entries } = parseStatusV2(BUSY_STATUS)
    const added = entries[0] as FileChange
    assert.equal(badgeFor(added, 'staged'), 'A')
    assert.equal(badgeFor(added, 'unstaged'), 'M')
    // The English initial of the state, not git's own `?` for an untracked path.
    assert.equal(badgeFor(entries[3] as FileChange, 'untracked'), 'U')
  })

  it('gives a conflict an exclamation mark, so U means untracked alone', () => {
    // The letters are initials and a conflict has none left to take — C is copied,
    // M modified, U (now) untracked — so it takes `!`, the same letter VS Code's
    // own source-control view uses for every unmerged state. One letter, one
    // state: the badge never needs the row's group to be read correctly.
    assert.equal(
      badgeFor(
        { path: 'c', index: 'U', worktree: 'U', staged: true, untracked: false, conflicted: true },
        'conflicted',
      ),
      '!',
    )
    assert.equal(
      badgeFor(
        { path: 'c', index: 'A', worktree: 'U', staged: true, untracked: false, conflicted: true },
        'conflicted',
      ),
      '!',
      'every unmerged pair spells the same letter',
    )
  })

  it('never lets git’s own `?` reach a badge', () => {
    // `groupsOf` sends an untracked entry to its own group, so the worktree branch
    // never sees one — but the pair's type allows it, and a badge reading `?`
    // would contradict the letter set.
    const untracked: FileChange = {
      path: 'n',
      index: '?',
      worktree: '.',
      staged: false,
      untracked: true,
      conflicted: false,
    }
    assert.equal(badgeFor(untracked, 'unstaged'), 'M')
  })
})

describe('parseBranches', () => {
  it('reads the HEAD marker, upstreams, and git’s track spelling', () => {
    // Field 0 is %(HEAD): '*' for the branch HEAD is on, a space otherwise.
    const raw = [
      '*\x00main\x00aaa\x00origin/main\x00[ahead 1, behind 2]\x002026-09-11T19:00:00+08:00\x00newest',
      ' \x00feature\x00bbb\x00\x00\x002026-09-10T19:00:00+08:00\x00older',
      ' \x00stale\x00ccc\x00origin/stale\x00[gone]\x002026-09-09T19:00:00+08:00\x00gone one',
      '',
    ].join('\n')
    const branches = parseBranches(raw)
    // Most recent commit first, regardless of the input order.
    assert.deepEqual(branches.map((branch) => branch.name), ['main', 'feature', 'stale'])
    const main = branches[0]
    assert.ok(main)
    assert.equal(main.current, true)
    assert.equal(main.upstream, 'origin/main')
    assert.equal(main.ahead, 1)
    assert.equal(main.behind, 2)
    assert.equal(main.upstreamGone, false)
    const feature = branches[1]
    assert.ok(feature)
    assert.equal(feature.current, false)
    assert.equal(feature.upstream, null)
    assert.equal(feature.ahead, 0)
    const stale = branches[2]
    assert.ok(stale)
    assert.equal(stale.upstreamGone, true)
  })

  it('marks no branch current when HEAD is detached', () => {
    // Detached HEAD makes EVERY row a space, which is exactly why the marker is
    // read from git instead of inferred by comparing names.
    const raw = ' \x00main\x00aaa\x00\x00\x002026-09-11T19:00:00+08:00\x00s\n'
    assert.equal(parseBranches(raw)[0]?.current, false)
  })

  it('skips malformed lines instead of throwing', () => {
    assert.deepEqual(parseBranches('not-enough-fields\n'), [])
    assert.deepEqual(parseBranches(''), [])
  })
})

describe('parseLog', () => {
  const raw =
    'aaa\x00a1\x00subject one\x00Ada\x002026-09-11T10:00:00+08:00\x002026-09-11T10:05:00+08:00\x00p1 p2\x1e\n' +
    'bbb\x00b2\x00subject two\x00Bob\x002026-09-10T10:00:00+08:00\x002026-09-10T10:05:00+08:00\x00p1\x1e\n' +
    'ccc\x00c3\x00root\x00Ada\x002026-09-09T10:00:00+08:00\x002026-09-09T10:05:00+08:00\x00\x1e\n'

  it('parses each record and its parents', () => {
    const { commits } = parseLog(raw)
    assert.equal(commits.length, 3)
    assert.deepEqual(commits[0]?.parents, ['p1', 'p2'])
    assert.deepEqual(commits[2]?.parents, [])
    assert.equal(commits[1]?.authorName, 'Bob')
    assert.equal(commits[1]?.shortOid, 'b2')
  })

  it('leaves pushed unknown: it is a fact about a ref, not the commit', () => {
    const { commits } = parseLog(raw)
    assert.equal(commits[0]?.pushed, null)
  })

  it('ignores a trailing separator and empty input', () => {
    assert.equal(parseLog('').commits.length, 0)
    assert.equal(parseLog('\x1e\n').commits.length, 0)
  })
})

describe('markPushed', () => {
  it('marks commits the upstream lacks as unpushed', () => {
    const { commits } = parseLog(
      'aaa\x00a1\x00one\x00Ada\x002026-09-11T10:00:00+08:00\x002026-09-11T10:00:00+08:00\x00\x1e' +
        'bbb\x00b2\x00two\x00Ada\x002026-09-10T10:00:00+08:00\x002026-09-10T10:00:00+08:00\x00\x1e',
    )
    const marked = markPushed(commits, new Set(['aaa']))
    assert.equal(marked[0]?.pushed, false)
    assert.equal(marked[1]?.pushed, true)
  })
})

describe('logPageOf', () => {
  const commits: readonly CommitInfo[] = []

  it('carries the hasMore the read learned, and an optional total', () => {
    // hasMore arrives from the look-ahead commit rather than a rev-list count.
    assert.deepEqual(logPageOf(commits, null, true), { commits, total: null, hasMore: true })
    assert.deepEqual(logPageOf(commits, null, false), { commits, total: null, hasMore: false })
    assert.deepEqual(logPageOf(commits, 1204, true), { commits, total: 1204, hasMore: true })
  })
})

describe('parseNumstat (FR-3.6)', () => {
  it('reads the counts and the path of each changed file', () => {
    // Byte-exact `git show --numstat --format=` output, captured from a real
    // repository (tabs, and no trailing newline expectations).
    const files = parseNumstat('2\t1\trenamed.txt\n12\t0\tsrc/new.ts\n')
    assert.deepEqual(files, [
      { path: 'renamed.txt', additions: 2, deletions: 1, binary: false },
      { path: 'src/new.ts', additions: 12, deletions: 0, binary: false },
    ])
  })

  it('reports a binary file as binary rather than as zero lines', () => {
    // git prints `-` for both counts; `+0 −0` would claim the file changed
    // nothing, which is a different statement.
    const files = parseNumstat('-\t-\tbin.dat\n')
    assert.deepEqual(files, [{ path: 'bin.dat', additions: null, deletions: null, binary: true }])
  })

  it('reduces both of git\u2019s rename spellings to the path the file has now', () => {
    // Both forms come from real `git show --numstat` output.
    assert.deepEqual(parseNumstat('0\t0\ta.txt => renamed.txt\n'), [
      { path: 'renamed.txt', additions: 0, deletions: 0, binary: false },
    ])
    assert.deepEqual(parseNumstat('0\t0\tsrc/deep/{one.ts => two.ts}\n'), [
      { path: 'src/deep/two.ts', additions: 0, deletions: 0, binary: false },
    ])
  })

  it('keeps a path that contains a tab, and ignores lines it cannot read', () => {
    const files = parseNumstat('1\t1\tweird\tname.ts\n\nnot-a-numstat-line\n')
    assert.deepEqual(files, [{ path: 'weird\tname.ts', additions: 1, deletions: 1, binary: false }])
  })

  it('answers an empty list for a commit with no changes of its own', () => {
    // A merge read against `--first-parent` can legitimately be empty.
    assert.deepEqual(parseNumstat(''), [])
  })
})

describe('parseStashList (FR-6.2)', () => {
  /**
   * One record, byte-for-byte as `git stash list
   * --format='%gd%x00%H%x00%h%x00%s%x00%cI%x1e'` prints it: NUL between the
   * fields, a record separator and a newline after each entry.
   */
  const record = (...fields: readonly string[]): string => `${fields.join('\x00')}\x1e\n`

  const LIST =
    record(
      'stash@{0}',
      'c052d9131ac5cfdd081f03154398527de218aa28',
      'c052d91',
      'On main: my stash',
      '2026-09-12T17:44:57+08:00',
    ) +
    record(
      'stash@{1}',
      'aa11bb22cc33dd44ee55ff66aa77bb88cc99dd00',
      'aa11bb2',
      'WIP on main: 3f2a1b0 first',
      '2026-09-12T17:40:03+08:00',
    )

  it('reads git’s selector, both ids, the subject and the date of each entry', () => {
    assert.deepEqual(parseStashList(LIST), [
      {
        selector: 'stash@{0}',
        oid: 'c052d9131ac5cfdd081f03154398527de218aa28',
        shortOid: 'c052d91',
        subject: 'On main: my stash',
        createdAt: '2026-09-12T17:44:57+08:00',
      },
      {
        selector: 'stash@{1}',
        oid: 'aa11bb22cc33dd44ee55ff66aa77bb88cc99dd00',
        shortOid: 'aa11bb2',
        subject: 'WIP on main: 3f2a1b0 first',
        createdAt: '2026-09-12T17:40:03+08:00',
      },
    ])
  })

  it('answers an empty list for a repository that has never stashed', () => {
    // `git stash list` exits 0 and prints nothing there — and on an unborn
    // branch too, where there is nothing to stash from in the first place.
    assert.deepEqual(parseStashList(''), [])
  })

  it('keeps a subject that holds a newline, and skips a record it cannot read', () => {
    // Only the record separator ends a record, so a multi-line message stays one
    // entry; a truncated record is dropped rather than guessed at.
    const raw = `stash@{2}\x00${'a'.repeat(40)}\x00aaaaaaa\x00On main: one\n\n  and more\x002026-09-12T09:00:00+08:00\x1estash@{3}\x00short\x1e`
    assert.deepEqual(parseStashList(raw), [
      {
        selector: 'stash@{2}',
        oid: 'a'.repeat(40),
        shortOid: 'aaaaaaa',
        subject: 'On main: one\n\n  and more',
        createdAt: '2026-09-12T09:00:00+08:00',
      },
    ])
  })
})
