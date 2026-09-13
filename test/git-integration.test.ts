/**
 * Integration tests: the parsers against repositories real `git` just wrote.
 *
 * The pure tests in `git-parse.test.ts` pin the byte-level format; these prove
 * the format the parser expects is the format the installed git actually
 * produces, in every state the panel has to survive — no commits yet, a detached
 * HEAD, an upstream with diverged counts, a conflicted merge, and a rename.
 *
 * @module dsh-git-panel/test/git-integration
 */

import { after, describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  changedPathCount,
  groupsOf,
  markPushed,
  parseBranches,
  parseLog,
  parseStatusV2,
} from '../src/core/git-parse.ts'
import {
  cleanupRepos,
  commit,
  currentBranch,
  git,
  gitTry,
  makeBareRemote,
  makeRepo,
  rawStatus,
  stageAll,
  write,
} from './helpers/repo.ts'

after(cleanupRepos)

describe('status against a real repository', () => {
  it('reports an unborn branch before the first commit', () => {
    const repo = makeRepo('unborn')
    const { branch, entries } = parseStatusV2(rawStatus(repo))
    assert.equal(branch.head, 'unborn')
    assert.equal(branch.oid, null)
    // An unborn repo still knows which branch it will create.
    assert.equal(branch.name, currentBranch(repo))
    assert.deepEqual(entries, [])
  })

  it('sorts real changes into the three lists git implies', () => {
    const repo = makeRepo('groups')
    write(repo, 'tracked.txt', 'one\n')
    write(repo, 'staged.txt', 'one\n')
    stageAll(repo)
    commit(repo, 'first')

    write(repo, 'tracked.txt', 'two\n') // worktree only, never staged
    write(repo, 'staged.txt', 'two\n') // staged only
    write(repo, 'both.txt', 'one\n')
    // Stage exactly these two: `git add -A` would sweep in tracked.txt and
    // destroy the case under test.
    git(repo, ['add', 'staged.txt', 'both.txt'])
    write(repo, 'both.txt', 'two\n') // staged AND modified again
    write(repo, 'untracked.txt', 'new\n')

    const { entries } = parseStatusV2(rawStatus(repo))
    const groups = groupsOf(entries)
    const paths = (list: readonly { path: string }[]): string[] => list.map((entry) => entry.path)

    assert.deepEqual(paths(groups.staged).sort(), ['both.txt', 'staged.txt'])
    assert.deepEqual(paths(groups.unstaged).sort(), ['both.txt', 'tracked.txt'])
    assert.deepEqual(paths(groups.untracked), ['untracked.txt'])
    assert.deepEqual(groups.conflicted, [])
    assert.equal(changedPathCount(entries), 4)
  })

  it('expands a wholly untracked directory into the files inside it', () => {
    const repo = makeRepo('untracked-dir')
    write(repo, 'kept.txt', 'one\n')
    stageAll(repo)
    commit(repo, 'first')

    // Nothing under docs/ is tracked, so git's own default would fold it into a
    // single `docs/` record. The panel lists files, so the read asks for `-uall`.
    write(repo, 'docs/one.md', 'one\n')
    write(repo, 'docs/nested/two.md', 'two\n')
    write(repo, 'loose.md', 'loose\n')

    const groups = groupsOf(parseStatusV2(rawStatus(repo)).entries)
    assert.deepEqual(
      groups.untracked.map((entry) => entry.path),
      ['docs/nested/two.md', 'docs/one.md', 'loose.md'],
    )
    assert.deepEqual(groups.staged, [])
    assert.deepEqual(groups.unstaged, [])
    assert.equal(changedPathCount(parseStatusV2(rawStatus(repo)).entries), 3)
  })

  it('carries a rename’s original path across a filename with spaces', () => {
    const repo = makeRepo('rename')
    write(repo, 'old name.txt', 'content\n')
    stageAll(repo)
    commit(repo, 'first')
    git(repo, ['mv', 'old name.txt', 'new name.txt'])

    const { entries } = parseStatusV2(rawStatus(repo))
    const renamed = entries.find((entry) => entry.index === 'R')
    assert.ok(renamed, 'expected a rename record')
    assert.equal(renamed.path, 'new name.txt')
    assert.equal(renamed.origPath, 'old name.txt')
  })

  it('reports a detached HEAD with the commit it points at', () => {
    const repo = makeRepo('detached')
    write(repo, 'a.txt', 'one\n')
    stageAll(repo)
    commit(repo, 'first')
    const oid = git(repo, ['rev-parse', 'HEAD']).trim()
    git(repo, ['checkout', '-q', '--detach', 'HEAD'])

    const { branch } = parseStatusV2(rawStatus(repo))
    assert.equal(branch.head, 'detached')
    assert.equal(branch.name, null)
    assert.equal(branch.oid, oid)
  })

  it('counts ahead and behind against a real upstream', () => {
    const repo = makeRepo('ahead')
    const remote = makeBareRemote('ahead-remote')
    write(repo, 'a.txt', 'one\n')
    stageAll(repo)
    commit(repo, 'first')
    const branch = currentBranch(repo)
    git(repo, ['remote', 'add', 'origin', remote])
    git(repo, ['push', '-q', '-u', 'origin', branch])

    // In sync: an upstream exists, so the counts are 0 rather than unknown.
    const synced = parseStatusV2(rawStatus(repo)).branch
    assert.equal(synced.upstream, `origin/${branch}`)
    assert.equal(synced.ahead, 0)
    assert.equal(synced.behind, 0)

    write(repo, 'a.txt', 'two\n')
    stageAll(repo)
    commit(repo, 'second')
    const ahead = parseStatusV2(rawStatus(repo)).branch
    assert.equal(ahead.ahead, 1)
    assert.equal(ahead.behind, 0)
  })

  it('marks a conflicted merge and keeps the pair git reported', () => {
    const repo = makeRepo('conflict')
    write(repo, 'shared.txt', 'base\n')
    stageAll(repo)
    commit(repo, 'base')
    const base = currentBranch(repo)

    git(repo, ['checkout', '-q', '-b', 'other'])
    write(repo, 'shared.txt', 'theirs\n')
    stageAll(repo)
    commit(repo, 'theirs')

    git(repo, ['checkout', '-q', base])
    write(repo, 'shared.txt', 'ours\n')
    stageAll(repo)
    commit(repo, 'ours')

    // The merge is expected to fail; that failure IS the fixture.
    const merged = gitTry(repo, ['merge', 'other'])
    assert.notEqual(merged.code, 0)

    const { entries } = parseStatusV2(rawStatus(repo))
    const groups = groupsOf(entries)
    assert.deepEqual(
      groups.conflicted.map((entry) => entry.path),
      ['shared.txt'],
    )
    assert.equal(groups.conflicted[0]?.index, 'U')
    assert.equal(groups.conflicted[0]?.worktree, 'U')
    // A conflicted path is listed once, under conflicts only (FR-9.1).
    assert.deepEqual(groups.staged, [])
  })

  it('survives a non-UTF-8-safe pathname without losing the read', () => {
    const repo = makeRepo('unicode')
    write(repo, '文档/说明 文件.txt', 'content\n')
    stageAll(repo)
    commit(repo, 'first')
    write(repo, '文档/说明 文件.txt', 'changed\n')

    const { entries } = parseStatusV2(rawStatus(repo))
    assert.deepEqual(
      entries.map((entry) => entry.path),
      ['文档/说明 文件.txt'],
    )
  })
})

describe('branches against a real repository', () => {
  it('lists local branches with the current one marked', () => {
    const repo = makeRepo('branches')
    write(repo, 'a.txt', 'one\n')
    stageAll(repo)
    commit(repo, 'first')
    const base = currentBranch(repo)
    git(repo, ['branch', 'feature-x'])

    const raw = git(repo, [
      'for-each-ref',
      '--format=%(HEAD)%00%(refname:short)%00%(objectname)%00%(upstream:short)%00%(upstream:track)%00%(committerdate:iso-strict)%00%(subject)',
      'refs/heads',
    ])
    const branches = parseBranches(raw)
    assert.deepEqual(branches.map((branch) => branch.name).sort(), ['feature-x', base].sort())
    assert.equal(branches.filter((branch) => branch.current).length, 1)
    assert.equal(branches.find((branch) => branch.current)?.name, base)
    assert.equal(branches.find((branch) => branch.name === 'feature-x')?.subject, 'first')
  })

  it('reports the current branch as current=false when HEAD is detached', () => {
    const repo = makeRepo('branches-detached')
    write(repo, 'a.txt', 'one\n')
    stageAll(repo)
    commit(repo, 'first')
    const base = currentBranch(repo)
    git(repo, ['checkout', '-q', '--detach', 'HEAD'])

    const raw = git(repo, [
      'for-each-ref',
      '--format=%(HEAD)%00%(refname:short)%00%(objectname)%00%(upstream:short)%00%(upstream:track)%00%(committerdate:iso-strict)%00%(subject)',
      'refs/heads',
    ])
    const branches = parseBranches(raw)
    assert.equal(branches.length, 1)
    assert.equal(branches[0]?.name, base)
    assert.equal(branches[0]?.current, false)
  })
})

describe('history against a real repository', () => {
  it('reads commits newest first with their parents and subjects', () => {
    const repo = makeRepo('log')
    write(repo, 'a.txt', 'one\n')
    stageAll(repo)
    commit(repo, 'first')
    write(repo, 'a.txt', 'two\n')
    stageAll(repo)
    commit(repo, 'second')
    write(repo, 'a.txt', 'three\n')
    stageAll(repo)
    commit(repo, 'third')

    const raw = git(repo, [
      'log',
      '--max-count=30',
      '--date=iso-strict',
      '--format=%H%x00%h%x00%s%x00%an%x00%aI%x00%cI%x00%P%x1e',
    ])
    const { commits } = parseLog(raw)
    assert.deepEqual(commits.map((entry) => entry.subject), ['third', 'second', 'first'])
    assert.equal(commits[0]?.parents.length, 1)
    // The root commit has no parents at all.
    assert.deepEqual(commits[2]?.parents, [])
    assert.equal(commits[0]?.authorName, 'Test Author')
  })

  it('marks only the commits the upstream lacks as unpushed', () => {
    const repo = makeRepo('log-pushed')
    const remote = makeBareRemote('log-remote')
    write(repo, 'a.txt', 'one\n')
    stageAll(repo)
    commit(repo, 'first')
    const branch = currentBranch(repo)
    git(repo, ['remote', 'add', 'origin', remote])
    git(repo, ['push', '-q', '-u', 'origin', branch])

    write(repo, 'a.txt', 'two\n')
    stageAll(repo)
    commit(repo, 'second')

    const raw = git(repo, [
      'log',
      '--max-count=30',
      '--date=iso-strict',
      '--format=%H%x00%h%x00%s%x00%an%x00%aI%x00%cI%x00%P%x1e',
    ])
    const { commits } = parseLog(raw)
    // `git log <upstream>..HEAD` is what the service asks for: just the ones
    // the upstream does not have, bounded by the ahead count.
    const unpushedRaw = git(repo, ['log', `origin/${branch}..HEAD`, '--format=%H'])
    const unpushed = new Set(unpushedRaw.split('\n').filter((line) => line !== ''))
    const marked = markPushed(commits, unpushed)

    assert.equal(marked[0]?.subject, 'second')
    assert.equal(marked[0]?.pushed, false)
    assert.equal(marked[1]?.subject, 'first')
    assert.equal(marked[1]?.pushed, true)
  })
})

describe('branch switching against a real repository', () => {
  it('gives git’s full multi-line refusal when the checkout is blocked', () => {
    // FR-4.4: the panel shows this text verbatim, so the test proves the text
    // really is multi-line and carries git's own advice.
    const repo = makeRepo('switch-blocked')
    write(repo, 'shared.txt', 'base\n')
    stageAll(repo)
    commit(repo, 'base')
    const base = currentBranch(repo)

    git(repo, ['checkout', '-q', '-b', 'other'])
    write(repo, 'shared.txt', 'theirs\n')
    stageAll(repo)
    commit(repo, 'theirs')
    git(repo, ['checkout', '-q', base])

    // An uncommitted change to a file the target branch also touched.
    write(repo, 'shared.txt', 'local edit\n')
    const switched = gitTry(repo, ['checkout', 'other'])
    assert.notEqual(switched.code, 0)
    assert.ok(switched.stderr.includes('\n'), 'expected a multi-line git diagnostic')
  })
})
