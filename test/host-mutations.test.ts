/**
 * M2's gate, tested at the layer that actually performs it: the git service.
 *
 * The doc's acceptance for M2 is "不碰终端完成 改→暂存→提交→推送 全流程", and that
 * sentence is a claim about a repository, not about a component. So every test
 * here drives the real service against a real repository — and, where the story
 * needs a remote, a real bare repository on the file transport. Nothing is
 * stubbed except the session→directory map, which is the browser's opaque id and
 * has no behaviour of its own.
 *
 * @module dsh-git-panel/test/host-mutations
 */

import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { createGitRunner } from '../src/host/git-exec.ts'
import { createGitService } from '../src/host/git-service.ts'
import type { HostPorts, Result, SessionDirResolver } from '../src/core/ports.ts'
import {
  cleanupRepos,
  commit,
  currentBranch,
  git,
  gitTry,
  makeBareRemote,
  makePlainDir,
  makeRepo,
  stageAll,
  write,
} from './helpers/repo.ts'

after(cleanupRepos)

/** A silent diagnostic port; a test asserting on logs would be testing noise. */
const SILENT: HostPorts = {
  log: () => undefined,
  // FR-3.5's generation has its own tests; everywhere else it must not be
  // reachable, so an accidental call is a loud failure rather than a network hit.
  generateText: () => Promise.reject(new Error('no model in this test')),
}

/** A resolver that maps one known session id onto a directory. */
function resolverFor(sessions: Readonly<Record<string, string>>): SessionDirResolver {
  return {
    resolveDir(sessionId: string): Promise<Result<string>> {
      const dir = sessions[sessionId]
      if (dir === undefined) {
        return Promise.resolve({ ok: false, error: { code: 'no-session', message: 'unknown session' } })
      }
      return Promise.resolve({ ok: true, value: dir })
    },
  }
}

/** The service over a real runner and a directory map. */
function serviceFor(sessions: Readonly<Record<string, string>>) {
  return createGitService(createGitRunner(), resolverFor(sessions), SILENT)
}

/** The staged paths of a repository, as a plain list, read by git itself. */
function stagedPaths(repo: string): string[] {
  return git(repo, ['diff', '--cached', '--name-only'])
    .split('\n')
    .filter((line) => line !== '')
}

/** A repository with one commit and a remote, plus the remote itself. */
function repoWithRemote(prefix: string): { repo: string; remote: string; branch: string } {
  const repo = makeRepo(prefix)
  write(repo, 'base.txt', 'base\n')
  stageAll(repo)
  commit(repo, 'first')
  const remote = makeBareRemote(`${prefix}-remote`)
  const branch = currentBranch(repo)
  git(repo, ['remote', 'add', 'origin', remote])
  git(repo, ['push', '-q', '-u', 'origin', branch])
  return { repo, remote, branch }
}

describe('staging and unstaging', () => {
  it('stages exactly the paths it was given, and leaves the worktree alone', async () => {
    const repo = makeRepo('mut-stage')
    write(repo, 'a.txt', 'one\n')
    write(repo, 'b.txt', 'one\n')
    stageAll(repo)
    commit(repo, 'first')
    // Both tracked, so staging one of them leaves the other in `changes`.
    write(repo, 'a.txt', 'two\n')
    write(repo, 'b.txt', 'two\n')

    const service = serviceFor({ s1: repo })
    const result = await service.stage('s1', ['a.txt'])
    assert.ok(result.ok, result.ok ? '' : JSON.stringify(result.error))

    assert.deepEqual(stagedPaths(repo), ['a.txt'])
    // The edit is still in the working tree: staging is not committing.
    assert.equal(git(repo, ['show', ':a.txt']), 'two\n')

    const status = await service.status('s1')
    assert.ok(status.ok)
    assert.deepEqual(status.value.groups.staged.map((entry) => entry.path), ['a.txt'])
    assert.deepEqual(status.value.groups.unstaged.map((entry) => entry.path), ['b.txt'])
  })

  it('unstages a path back to the worktree, on a born branch', async () => {
    const repo = makeRepo('mut-unstage')
    write(repo, 'a.txt', 'one\n')
    stageAll(repo)
    commit(repo, 'first')
    write(repo, 'a.txt', 'two\n')
    git(repo, ['add', 'a.txt'])

    const result = await serviceFor({ s1: repo }).unstage('s1', ['a.txt'])
    assert.ok(result.ok, result.ok ? '' : JSON.stringify(result.error))

    assert.deepEqual(stagedPaths(repo), [])
    const status = await serviceFor({ s1: repo }).status('s1')
    assert.ok(status.ok)
    assert.deepEqual(status.value.groups.unstaged.map((entry) => entry.path), ['a.txt'])
  })

  it('un-stages a first file in an unborn repository', async () => {
    // The one case where the command differs: `git restore --staged` restores
    // FROM HEAD, and there is no HEAD yet (probed: "could not resolve HEAD").
    const repo = makeRepo('mut-unborn')
    write(repo, 'a.txt', 'one\n')
    git(repo, ['add', 'a.txt'])
    assert.deepEqual(stagedPaths(repo), ['a.txt'])

    const result = await serviceFor({ s1: repo }).unstage('s1', ['a.txt'])
    assert.ok(result.ok, result.ok ? '' : JSON.stringify(result.error))

    assert.deepEqual(stagedPaths(repo), [])
    const status = await serviceFor({ s1: repo }).status('s1')
    assert.ok(status.ok)
    assert.deepEqual(status.value.groups.untracked.map((entry) => entry.path), ['a.txt'])
    // The file itself is untouched; only the index forgot it.
    assert.equal(git(repo, ['status', '--porcelain=v2', '--branch', '-z']).includes('a.txt'), true)
  })

  it('refuses an absolute path, a traversal, and a path inside .git', async () => {
    const repo = makeRepo('mut-validate')
    write(repo, 'a.txt', 'one\n')
    const service = serviceFor({ s1: repo })

    for (const paths of [['/etc/passwd'], ['../../etc/passwd'], ['.git/config'], [''], []]) {
      const result = await service.stage('s1', paths)
      assert.equal(result.ok, false, `expected ${JSON.stringify(paths)} to be refused`)
      assert.equal(result.ok ? '' : result.error.code, 'bad-request')
    }
    // Nothing was staged by any of the attempts.
    assert.deepEqual(stagedPaths(repo), [])
  })

  it('stages a deletion, because that is what `add -- <path>` means', async () => {
    const repo = makeRepo('mut-delete')
    write(repo, 'a.txt', 'one\n')
    stageAll(repo)
    commit(repo, 'first')
    // Gone from the worktree but still in HEAD: the row the panel shows as `D`.
    rmSync(join(repo, 'a.txt'))

    const result = await serviceFor({ s1: repo }).stage('s1', ['a.txt'])
    assert.ok(result.ok, result.ok ? '' : JSON.stringify(result.error))
    assert.deepEqual(stagedPaths(repo), ['a.txt'])
  })
})

describe('discarding (FR-6.1)', () => {
  it('restores a tracked file from the index, and keeps the staged half', async () => {
    const repo = makeRepo('mut-discard-tracked')
    write(repo, 'a.txt', 'one\n')
    stageAll(repo)
    commit(repo, 'first')
    // Both halves at once: the index holds "two", the worktree "three". Discard is
    // about the working tree, so "two" is what comes back.
    write(repo, 'a.txt', 'two\n')
    git(repo, ['add', 'a.txt'])
    write(repo, 'a.txt', 'three\n')

    const result = await serviceFor({ s1: repo }).discard('s1', ['a.txt'])
    assert.ok(result.ok, result.ok ? '' : JSON.stringify(result.error))

    assert.equal(git(repo, ['show', ':a.txt']), 'two\n', 'the index is not what discard restores')
    const read = gitTry(repo, ['diff', '--quiet'])
    assert.equal(read.code, 0, 'the worktree matches the index again')
    assert.deepEqual(stagedPaths(repo), ['a.txt'], 'the staged change survives')
  })

  it('works on an unborn branch, where `restore --source=HEAD` could not', async () => {
    // The trap §6 documents for `unstage`, one command over: the default source of
    // `git restore` is the INDEX, and that is what makes this work before the first
    // commit exists (probed: `--source=HEAD` says "could not resolve HEAD").
    const repo = makeRepo('mut-discard-unborn')
    write(repo, 'a.txt', 'one\n')
    git(repo, ['add', 'a.txt'])
    write(repo, 'a.txt', 'two\n')

    const result = await serviceFor({ s1: repo }).discard('s1', ['a.txt'])
    assert.ok(result.ok, result.ok ? '' : JSON.stringify(result.error))
    assert.equal(gitTry(repo, ['diff', '--quiet']).code, 0)
    assert.deepEqual(stagedPaths(repo), ['a.txt'], 'the file is still staged as new')
  })

  it('deletes an untracked file, because the index knows nothing to restore', async () => {
    const repo = makeRepo('mut-discard-untracked')
    write(repo, 'a.txt', 'one\n')
    stageAll(repo)
    commit(repo, 'first')
    write(repo, 'new.txt', 'scratch\n')

    const result = await serviceFor({ s1: repo }).discard('s1', ['new.txt'])
    assert.ok(result.ok, result.ok ? '' : JSON.stringify(result.error))

    // Gone from disk and from the status: an untracked path has no other state to
    // restore, so the file itself is what "discard" removes.
    assert.equal(existsSync(join(repo, 'new.txt')), false)
    const status = await serviceFor({ s1: repo }).status('s1')
    assert.ok(status.ok)
    assert.deepEqual(status.value.groups.untracked, [])
  })

  it('takes both halves of that split in one request', async () => {
    const repo = makeRepo('mut-discard-both')
    write(repo, 'a.txt', 'one\n')
    write(repo, 'b.txt', 'one\n')
    stageAll(repo)
    commit(repo, 'first')
    write(repo, 'a.txt', 'two\n')
    write(repo, 'new.txt', 'scratch\n')

    const result = await serviceFor({ s1: repo }).discard('s1', ['a.txt', 'new.txt'])
    assert.ok(result.ok, result.ok ? '' : JSON.stringify(result.error))
    assert.equal(git(repo, ['show', ':a.txt']), 'one\n')
    assert.throws(() => git(repo, ['ls-files', '--error-unmatch', '--', 'new.txt']))
  })

  it('leaves a staged-only change alone: the index is not discard’s business', async () => {
    const repo = makeRepo('mut-discard-staged-only')
    write(repo, 'a.txt', 'one\n')
    stageAll(repo)
    commit(repo, 'first')
    write(repo, 'a.txt', 'two\n')
    git(repo, ['add', 'a.txt'])

    const result = await serviceFor({ s1: repo }).discard('s1', ['a.txt'])
    assert.ok(result.ok, result.ok ? '' : JSON.stringify(result.error))

    // Nothing to restore — the worktree already matches the index — and the staged
    // change is still there. (The panel does not offer discard on such a row; this
    // is what the host does if something asks anyway.)
    assert.deepEqual(stagedPaths(repo), ['a.txt'])
    assert.equal(git(repo, ['show', ':a.txt']), 'two\n')
  })

  it('restores a file deleted from the worktree, which is the other way to discard', async () => {
    const repo = makeRepo('mut-discard-deletion')
    write(repo, 'a.txt', 'one\n')
    stageAll(repo)
    commit(repo, 'first')
    rmSync(join(repo, 'a.txt'))

    const result = await serviceFor({ s1: repo }).discard('s1', ['a.txt'])
    assert.ok(result.ok, result.ok ? '' : JSON.stringify(result.error))
    assert.equal(git(repo, ['show', ':a.txt']), 'one\n')
  })

  it('refuses a conflicted path rather than choosing a side for the user', async () => {
    // Both commands refuse an unmerged path (probed: `path 'c.txt' is unmerged`),
    // which is the right answer: abandoning a conflict is FR-9's decision, and the
    // panel does not offer this row a discard at all.
    const repo = makeRepo('mut-discard-conflict')
    write(repo, 'c.txt', 'base\n')
    stageAll(repo)
    commit(repo, 'base')
    const branch = currentBranch(repo)
    git(repo, ['checkout', '-q', '-b', 'other'])
    write(repo, 'c.txt', 'theirs\n')
    git(repo, ['commit', '-q', '-a', '--no-gpg-sign', '-m', 'theirs'])
    git(repo, ['checkout', '-q', branch])
    write(repo, 'c.txt', 'ours\n')
    git(repo, ['commit', '-q', '-a', '--no-gpg-sign', '-m', 'ours'])
    const merge = gitTry(repo, ['merge', 'other'])
    assert.notEqual(merge.code, 0, 'the merge must conflict for this test to mean anything')

    const result = await serviceFor({ s1: repo }).discard('s1', ['c.txt'])
    assert.equal(result.ok, false)
    assert.equal(result.ok ? '' : result.error.code, 'git-failed')
    assert.match(result.ok ? '' : (result.error.detail ?? ''), /unmerged/u)
    // The conflicted file is exactly as git left it.
    assert.match(git(repo, ['show', ':1:c.txt']), /base/u)
  })

  it('refuses an absolute path, a traversal, and a path inside .git', async () => {
    const repo = makeRepo('mut-discard-validate')
    write(repo, 'a.txt', 'one\n')
    const service = serviceFor({ s1: repo })

    for (const paths of [['/etc/passwd'], ['../../etc/passwd'], ['.git/config'], [''], []]) {
      const result = await service.discard('s1', paths)
      assert.equal(result.ok, false, `expected ${JSON.stringify(paths)} to be refused`)
      assert.equal(result.ok ? '' : result.error.code, 'bad-request')
    }
    // The refusals ran no git command at all: the file is untouched.
    assert.equal(git(repo, ['status', '--porcelain=v2']).includes('a.txt'), true)
  })
})

describe('committing', () => {
  it('commits the index and reports the commit it created', async () => {
    const repo = makeRepo('mut-commit')
    write(repo, 'a.txt', 'one\n')
    stageAll(repo)
    commit(repo, 'first')
    write(repo, 'a.txt', 'two\n')
    write(repo, 'b.txt', 'untracked\n')
    git(repo, ['add', 'a.txt'])

    const result = await serviceFor({ s1: repo }).commit('s1', 'second')
    assert.ok(result.ok, result.ok ? '' : JSON.stringify(result.error))
    assert.equal(result.value.subject, 'second')
    assert.match(result.value.shortOid, /^[0-9a-f]{7,}$/u)
    assert.equal(result.value.oid, git(repo, ['rev-parse', 'HEAD']).trim())

    // Only the index was committed: the untracked file is still untracked.
    const status = await serviceFor({ s1: repo }).status('s1')
    assert.ok(status.ok)
    assert.deepEqual(status.value.groups.staged, [])
    assert.deepEqual(status.value.groups.untracked.map((entry) => entry.path), ['b.txt'])
  })

  it('answers nothing-to-commit when the index is empty', async () => {
    const repo = makeRepo('mut-nothing')
    write(repo, 'a.txt', 'one\n')
    stageAll(repo)
    commit(repo, 'first')
    write(repo, 'a.txt', 'two\n')

    const result = await serviceFor({ s1: repo }).commit('s1', 'nope')
    assert.equal(result.ok, false)
    assert.equal(result.ok ? '' : result.error.code, 'nothing-to-commit')
  })

  it('refuses an empty message without running git', async () => {
    const repo = makeRepo('mut-emptymsg')
    write(repo, 'a.txt', 'one\n')
    git(repo, ['add', 'a.txt'])

    const result = await serviceFor({ s1: repo }).commit('s1', '   \n')
    assert.equal(result.ok, false)
    assert.equal(result.ok ? '' : result.error.code, 'bad-request')
    // No commit happened, so the index is exactly as it was.
    assert.deepEqual(stagedPaths(repo), ['a.txt'])
  })

  it('commitAll stages tracked changes only, exactly as its label promises', async () => {
    const repo = makeRepo('mut-commitall')
    write(repo, 'tracked.txt', 'one\n')
    stageAll(repo)
    commit(repo, 'first')
    write(repo, 'tracked.txt', 'two\n')
    write(repo, 'untracked.txt', 'new\n')

    const result = await serviceFor({ s1: repo }).commitAll('s1', 'all tracked')
    assert.ok(result.ok, result.ok ? '' : JSON.stringify(result.error))

    // The tracked change is in; the untracked file is NOT — that is the whole
    // difference between `-u` and `-A`, and the reason the button says
    // "tracked" out loud (FR-3.4).
    const status = await serviceFor({ s1: repo }).status('s1')
    assert.ok(status.ok)
    assert.deepEqual(status.value.groups.untracked.map((entry) => entry.path), ['untracked.txt'])
    assert.equal(git(repo, ['show', 'HEAD:tracked.txt']), 'two\n')
  })
})

describe('pushing and pulling', () => {
  it('sets the upstream on the first push (FR-5.2)', async () => {
    const repo = makeRepo('mut-firstpush')
    write(repo, 'a.txt', 'one\n')
    stageAll(repo)
    commit(repo, 'first')
    const remote = makeBareRemote('mut-firstpush-remote')
    const branch = currentBranch(repo)
    git(repo, ['remote', 'add', 'origin', remote])

    const service = serviceFor({ s1: repo })
    const before = await service.status('s1')
    assert.ok(before.ok)
    assert.equal(before.value.branch.upstream, null)

    const result = await service.push('s1')
    assert.ok(result.ok, result.ok ? '' : JSON.stringify(result.error))

    const after = await service.status('s1')
    assert.ok(after.ok)
    assert.equal(after.value.branch.upstream, `origin/${branch}`)
    assert.equal(after.value.branch.ahead, 0)
    // The remote really has the commit.
    assert.equal(git(remote, ['rev-parse', `refs/heads/${branch}`]).trim(), git(repo, ['rev-parse', 'HEAD']).trim())
  })

  it('sends the commits a branch is ahead by', async () => {
    const { repo, remote, branch } = repoWithRemote('mut-push')
    write(repo, 'a.txt', 'two\n')
    stageAll(repo)
    commit(repo, 'second')

    const result = await serviceFor({ s1: repo }).push('s1')
    assert.ok(result.ok, result.ok ? '' : JSON.stringify(result.error))
    assert.equal(git(remote, ['rev-parse', `refs/heads/${branch}`]).trim(), git(repo, ['rev-parse', 'HEAD']).trim())
  })

  it('names a refused push non-fast-forward, and keeps git’s own output (FR-5.4)', async () => {
    const { repo, remote } = repoWithRemote('mut-reject')
    // Somebody else pushes to the same branch: our next push can only be refused.
    const other = makePlainDir('mut-reject-other')
    git(other, ['clone', '-q', remote, '.'])
    write(other, 'theirs.txt', 'theirs\n')
    stageAll(other)
    commit(other, 'theirs')
    git(other, ['push', '-q'])

    write(repo, 'mine.txt', 'mine\n')
    stageAll(repo)
    commit(repo, 'mine')

    const result = await serviceFor({ s1: repo }).push('s1')
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.error.code, 'non-fast-forward')
    // git's refusal survives verbatim, so the panel can show it (§4.3).
    assert.match(result.error.detail ?? '', /rejected|failed to push/u)
  })

  it('pulls a commit the remote gained', async () => {
    const { repo, remote } = repoWithRemote('mut-pull')
    const other = makePlainDir('mut-pull-other')
    git(other, ['clone', '-q', remote, '.'])
    write(other, 'theirs.txt', 'theirs\n')
    stageAll(other)
    commit(other, 'theirs')
    git(other, ['push', '-q'])

    const result = await serviceFor({ s1: repo }).pull('s1')
    assert.ok(result.ok, result.ok ? '' : JSON.stringify(result.error))
    assert.equal(gitTry(repo, ['cat-file', '-e', 'HEAD:theirs.txt']).code, 0)

    const status = await serviceFor({ s1: repo }).status('s1')
    assert.ok(status.ok)
    assert.equal(status.value.branch.behind, 0)
  })

  it('pulls a diverged branch without waiting for an editor', async () => {
    // `--no-rebase` makes this a merge commit, and a merge commit wants a
    // message. Without `--no-edit` git would open an editor and wait until the
    // deadline killed the call, so this test is as much about the flags as about
    // the merge.
    const { repo, remote } = repoWithRemote('mut-diverge')
    const other = makePlainDir('mut-diverge-other')
    git(other, ['clone', '-q', remote, '.'])
    write(other, 'theirs.txt', 'theirs\n')
    stageAll(other)
    commit(other, 'theirs')
    git(other, ['push', '-q'])

    write(repo, 'mine.txt', 'mine\n')
    stageAll(repo)
    commit(repo, 'mine')

    const result = await serviceFor({ s1: repo }).pull('s1')
    assert.ok(result.ok, result.ok ? '' : JSON.stringify(result.error))
    // Both sides are present, and the merge is a commit of its own.
    assert.equal(gitTry(repo, ['cat-file', '-e', 'HEAD:theirs.txt']).code, 0)
    assert.equal(gitTry(repo, ['cat-file', '-e', 'HEAD:mine.txt']).code, 0)
    assert.match(git(repo, ['log', '-1', '--format=%P']), /\S+ \S+/u)
    // The merge is a commit of its own on top of ours, so the branch is two
    // ahead of the upstream: our commit and the merge that tied it back in.
    const status = await serviceFor({ s1: repo }).status('s1')
    assert.ok(status.ok)
    assert.equal(status.value.branch.ahead, 2)
    assert.equal(status.value.branch.behind, 0)
  })

  it('names a conflicting pull as a conflict, and leaves the merge to the user', async () => {
    const { repo, remote } = repoWithRemote('mut-conflict')
    const other = makePlainDir('mut-conflict-other')
    git(other, ['clone', '-q', remote, '.'])
    write(other, 'base.txt', 'theirs\n')
    stageAll(other)
    commit(other, 'theirs')
    git(other, ['push', '-q'])

    write(repo, 'base.txt', 'mine\n')
    stageAll(repo)
    commit(repo, 'mine')

    const result = await serviceFor({ s1: repo }).pull('s1')
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.error.code, 'conflict')

    // The repository is mid-merge, and the panel can already see it: that is the
    // state FR-9's conflict UI will render.
    const status = await serviceFor({ s1: repo }).status('s1')
    assert.ok(status.ok)
    assert.deepEqual(status.value.groups.conflicted.map((entry) => entry.path), ['base.txt'])
  })

  it('refuses a pull with no upstream, and a push with no remote', async () => {
    const local = makeRepo('mut-noupstream')
    write(local, 'a.txt', 'one\n')
    stageAll(local)
    commit(local, 'first')
    const localService = serviceFor({ s1: local })

    const pulled = await localService.pull('s1')
    assert.equal(pulled.ok, false)
    assert.equal(pulled.ok ? '' : pulled.error.code, 'bad-request')

    const pushed = await localService.push('s1')
    assert.equal(pushed.ok, false)
    assert.equal(pushed.ok ? '' : pushed.error.code, 'bad-request')
  })

  it('refuses a push from an unborn branch', async () => {
    const repo = makeRepo('mut-push-unborn')
    const result = await serviceFor({ s1: repo }).push('s1')
    assert.equal(result.ok, false)
    assert.equal(result.ok ? '' : result.error.code, 'bad-request')
  })
})

describe('sync', () => {
  it('pulls, then pushes, in one action (FR-5.1)', async () => {
    const { repo, remote, branch } = repoWithRemote('mut-sync')
    const other = makePlainDir('mut-sync-other')
    git(other, ['clone', '-q', remote, '.'])
    write(other, 'theirs.txt', 'theirs\n')
    stageAll(other)
    commit(other, 'theirs')
    git(other, ['push', '-q'])

    // Behind by one and ahead by one: exactly the state `⇅` is for.
    write(repo, 'mine.txt', 'mine\n')
    stageAll(repo)
    commit(repo, 'mine')

    const result = await serviceFor({ s1: repo }).sync('s1')
    assert.ok(result.ok, result.ok ? '' : JSON.stringify(result.error))

    const status = await serviceFor({ s1: repo }).status('s1')
    assert.ok(status.ok)
    assert.equal(status.value.branch.ahead, 0)
    assert.equal(status.value.branch.behind, 0)
    // Everything is on both sides.
    assert.equal(gitTry(repo, ['cat-file', '-e', 'HEAD:theirs.txt']).code, 0)
    assert.equal(gitTry(remote, ['cat-file', '-e', `refs/heads/${branch}:mine.txt`]).code, 0)
  })
})

describe('fetch (added; the doc lists no standalone fetch)', () => {
  it('updates the remote-tracking ref without touching the branch or the worktree', async () => {
    const { repo, remote, branch } = repoWithRemote('mut-fetch')
    const other = makePlainDir('mut-fetch-other')
    git(other, ['clone', '-q', remote, '.'])
    write(other, 'theirs.txt', 'theirs\n')
    stageAll(other)
    commit(other, 'theirs')
    git(other, ['push', '-q'])
    const theirs = git(other, ['rev-parse', 'HEAD']).trim()

    const before = git(repo, ['rev-parse', 'HEAD']).trim()
    const result = await serviceFor({ s1: repo }).fetch('s1')
    assert.ok(result.ok, result.ok ? '' : JSON.stringify(result.error))

    // The remote-tracking ref moved...
    assert.equal(git(repo, ['rev-parse', `refs/remotes/origin/${branch}`]).trim(), theirs)
    // ...while HEAD, the index and the working tree did not. That absence of a
    // merge is the whole difference between fetch and pull.
    assert.equal(git(repo, ['rev-parse', 'HEAD']).trim(), before)
    const status = await serviceFor({ s1: repo }).status('s1')
    assert.ok(status.ok)
    assert.equal(status.value.branch.behind, 1)
    assert.equal(status.value.changedCount, 0)
  })

  it('fetches every remote, not only the one the branch tracks', async () => {
    const { repo, remote, branch } = repoWithRemote('mut-fetch-all')
    const mirror = makeBareRemote('mut-fetch-all-mirror')
    git(repo, ['remote', 'add', 'mirror', mirror])
    git(repo, ['push', '-q', 'mirror', branch])

    // Advance both remotes from outside this repository.
    const onOrigin = makePlainDir('mut-fetch-all-origin')
    git(onOrigin, ['clone', '-q', remote, '.'])
    write(onOrigin, 'origin.txt', 'x\n')
    stageAll(onOrigin)
    commit(onOrigin, 'origin moves')
    git(onOrigin, ['push', '-q'])
    const originTip = git(onOrigin, ['rev-parse', 'HEAD']).trim()

    const onMirror = makePlainDir('mut-fetch-all-mirror-clone')
    git(onMirror, ['clone', '-q', mirror, '.'])
    write(onMirror, 'mirror.txt', 'y\n')
    stageAll(onMirror)
    commit(onMirror, 'mirror moves')
    git(onMirror, ['push', '-q'])
    const mirrorTip = git(onMirror, ['rev-parse', 'HEAD']).trim()

    const result = await serviceFor({ s1: repo }).fetch('s1')
    assert.ok(result.ok, result.ok ? '' : JSON.stringify(result.error))
    assert.equal(git(repo, ['rev-parse', `refs/remotes/origin/${branch}`]).trim(), originTip)
    assert.equal(git(repo, ['rev-parse', `refs/remotes/mirror/${branch}`]).trim(), mirrorTip)
  })

  it('refuses a repository with no remote rather than reporting a silent success', async () => {
    // `git fetch --all` with no remotes exits 0 and prints nothing, so the check
    // is what keeps the panel from announcing a fetch that never happened.
    const repo = makeRepo('mut-fetch-noremote')
    write(repo, 'a.txt', 'one\n')
    stageAll(repo)
    commit(repo, 'first')
    const result = await serviceFor({ s1: repo }).fetch('s1')
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.error.code, 'bad-request')
    assert.match(result.error.message, /no remote/u)
  })
})

describe('the full M2 flow', () => {
  it('takes a change to the remote without a terminal', async () => {
    // The doc's M2 acceptance criterion, end to end: 改 → 暂存 → 提交 → 推送.
    const repo = makeRepo('mut-flow')
    write(repo, 'a.txt', 'one\n')
    stageAll(repo)
    commit(repo, 'first')
    const remote = makeBareRemote('mut-flow-remote')
    const branch = currentBranch(repo)
    git(repo, ['remote', 'add', 'origin', remote])

    const service = serviceFor({ s1: repo })

    // 改
    write(repo, 'a.txt', 'two\n')
    write(repo, 'new.txt', 'new\n')
    const changed = await service.status('s1')
    assert.ok(changed.ok)
    assert.deepEqual(changed.value.groups.unstaged.map((entry) => entry.path), ['a.txt'])
    assert.deepEqual(changed.value.groups.untracked.map((entry) => entry.path), ['new.txt'])

    // 暂存 — both files, the bulk action's shape
    const staged = await service.stage('s1', ['a.txt', 'new.txt'])
    assert.ok(staged.ok, staged.ok ? '' : JSON.stringify(staged.error))

    // 提交
    const committed = await service.commit('s1', 'change a and add new')
    assert.ok(committed.ok, committed.ok ? '' : JSON.stringify(committed.error))

    // 推送 — first push, so the upstream is set on the way
    const pushed = await service.push('s1')
    assert.ok(pushed.ok, pushed.ok ? '' : JSON.stringify(pushed.error))

    const remoteHead = git(remote, ['rev-parse', `refs/heads/${branch}`]).trim()
    assert.equal(remoteHead, committed.value.oid)
    const settled = await service.status('s1')
    assert.ok(settled.ok)
    assert.equal(settled.value.changedCount, 0)
    assert.equal(settled.value.branch.ahead, 0)
    assert.equal(settled.value.branch.behind, 0)
    // And nothing was left behind in the index that the panel would have to
    // explain later.
    assert.deepEqual(settled.value.groups, {
      staged: [],
      unstaged: [],
      untracked: [],
      conflicted: [],
    })
  })

  it('refuses every operation for a session the host does not know', async () => {
    const service = serviceFor({})
    const results = await Promise.all([
      service.stage('missing', ['a.txt']),
      service.unstage('missing', ['a.txt']),
      service.commit('missing', 'message'),
      service.commitAll('missing', 'message'),
      service.push('missing'),
      service.pull('missing'),
      service.fetch('missing'),
      service.sync('missing'),
      service.undoCommit('missing', 'a'.repeat(40)),
    ])
    for (const result of results) {
      assert.equal(result.ok, false)
      assert.equal(result.ok ? '' : result.error.code, 'no-session')
    }
  })

  it('refuses every operation outside a repository', async () => {
    const outside = makePlainDir('mut-norepo')
    const service = serviceFor({ s1: outside })
    const results = await Promise.all([
      service.stage('s1', ['a.txt']),
      service.commit('s1', 'message'),
      service.push('s1'),
      service.fetch('s1'),
      service.undoCommit('s1', 'a'.repeat(40)),
    ])
    for (const result of results) {
      assert.equal(result.ok, false)
      assert.equal(result.ok ? '' : result.error.code, 'not-a-repo')
    }
  })
})

describe('undoing the newest commit (FR-3.8)', () => {
  /** A repository with two commits, the second rewriting `a.txt` to "two". */
  function repoWithTwoCommits(prefix: string): { repo: string; first: string; second: string } {
    const repo = makeRepo(prefix)
    write(repo, 'a.txt', 'one\n')
    stageAll(repo)
    commit(repo, 'first')
    const first = git(repo, ['rev-parse', 'HEAD']).trim()
    write(repo, 'a.txt', 'two\n')
    stageAll(repo)
    commit(repo, 'second')
    const second = git(repo, ['rev-parse', 'HEAD']).trim()
    return { repo, first, second }
  }

  it('resets an unpublished commit, returning its changes to the working tree', async () => {
    const { repo, first, second } = repoWithTwoCommits('undo-reset')

    const result = await serviceFor({ s1: repo }).undoCommit('s1', second)
    assert.ok(result.ok, result.ok ? '' : JSON.stringify(result.error))
    assert.equal(result.value.mode, 'reset')
    assert.equal(result.value.shortOid, second.slice(0, 7))
    assert.equal(result.value.subject, 'second')

    // The branch moved back to the first commit, and the undone commit's
    // changes are back in the working tree — `--mixed`, not `--hard`.
    assert.equal(git(repo, ['rev-parse', 'HEAD']).trim(), first)
    assert.equal(readFileSync(join(repo, 'a.txt'), 'utf8'), 'two\n')
    const status = await serviceFor({ s1: repo }).status('s1')
    assert.ok(status.ok)
    assert.deepEqual(status.value.groups.unstaged.map((entry) => entry.path), ['a.txt'])
  })

  it('resets an unpublished commit even when the branch has an upstream', async () => {
    // The pushed question is "does the upstream CONTAIN this commit", not "is
    // there an upstream" — an upstream that has never seen the commit leaves it
    // unpushed, and reset is the undo.
    const { repo } = repoWithRemote('undo-tracked')
    write(repo, 'a.txt', 'two\n')
    stageAll(repo)
    commit(repo, 'second')
    const second = git(repo, ['rev-parse', 'HEAD']).trim()

    const result = await serviceFor({ s1: repo }).undoCommit('s1', second)
    assert.ok(result.ok, result.ok ? '' : JSON.stringify(result.error))
    assert.equal(result.value.mode, 'reset')
    // The upstream is untouched, and the branch is simply back on it.
    const status = await serviceFor({ s1: repo }).status('s1')
    assert.ok(status.ok)
    assert.equal(status.value.branch.ahead, 0)
  })

  it('reverts a published commit instead of rewriting history', async () => {
    const { repo, remote, branch } = repoWithRemote('undo-revert')
    write(repo, 'base.txt', 'two\n')
    stageAll(repo)
    commit(repo, 'second')
    git(repo, ['push', '-q'])
    const second = git(repo, ['rev-parse', 'HEAD']).trim()

    const result = await serviceFor({ s1: repo }).undoCommit('s1', second)
    assert.ok(result.ok, result.ok ? '' : JSON.stringify(result.error))
    assert.equal(result.value.mode, 'revert')

    // A NEW commit undoes the old one: the old commit is still there, the
    // remote still points at it, and the file is back to its previous content.
    assert.match(git(repo, ['log', '-1', '--format=%s']), /^Revert "second"/u)
    assert.equal(git(repo, ['rev-parse', 'HEAD~1']).trim(), second)
    assert.equal(readFileSync(join(repo, 'base.txt'), 'utf8'), 'base\n')
    assert.equal(git(remote, ['rev-parse', `refs/heads/${branch}`]).trim(), second)
    const status = await serviceFor({ s1: repo }).status('s1')
    assert.ok(status.ok)
    assert.equal(status.value.branch.ahead, 1, 'the revert commit itself is not pushed yet')
  })

  it('refuses a hash that is no longer the newest, trusting the host’s own HEAD', async () => {
    const { repo, second } = repoWithTwoCommits('undo-stale')
    // A commit lands after the panel's reading: the row that was clicked is
    // stale, and undoing it would undo a commit nobody is pointing at.
    write(repo, 'b.txt', 'new\n')
    stageAll(repo)
    commit(repo, 'third')
    const third = git(repo, ['rev-parse', 'HEAD']).trim()

    const result = await serviceFor({ s1: repo }).undoCommit('s1', second)
    assert.equal(result.ok, false)
    assert.equal(result.ok ? '' : result.error.code, 'bad-request')
    assert.match(result.ok ? '' : result.error.message, /no longer the newest/u)
    // Nothing moved.
    assert.equal(git(repo, ['rev-parse', 'HEAD']).trim(), third)
  })

  it('refuses the first commit of a branch: there is nothing before it to return to', async () => {
    const repo = makeRepo('undo-root')
    write(repo, 'a.txt', 'one\n')
    stageAll(repo)
    commit(repo, 'first')
    const only = git(repo, ['rev-parse', 'HEAD']).trim()

    const result = await serviceFor({ s1: repo }).undoCommit('s1', only)
    assert.equal(result.ok, false)
    assert.match(result.ok ? '' : result.error.message, /first one/u)
    assert.equal(git(repo, ['rev-parse', 'HEAD']).trim(), only)
  })

  it('refuses an unborn branch and a detached HEAD', async () => {
    const unborn = makeRepo('undo-unborn')
    const noCommits = await serviceFor({ s1: unborn }).undoCommit('s1', 'a'.repeat(40))
    assert.equal(noCommits.ok, false)
    assert.match(noCommits.ok ? '' : noCommits.error.message, /no commit to undo/u)

    const { repo, second } = repoWithTwoCommits('undo-detached')
    git(repo, ['checkout', '-q', '--detach'])
    const detached = await serviceFor({ s1: repo }).undoCommit('s1', second)
    assert.equal(detached.ok, false)
    assert.match(detached.ok ? '' : detached.error.message, /detached/u)
  })

  it('refuses to revert a published merge, but resets an unpublished one', async () => {
    // A clean merge: `side` adds a file, and the base moves on a DIFFERENT one
    // so the merge cannot fast-forward (a fast-forward "merge" is no merge
    // commit at all, which is what the first version of this fixture made).
    const makeMerge = (prefix: string): { repo: string; remote: string; branch: string; merge: string; before: string } => {
      const { repo, remote, branch } = repoWithRemote(prefix)
      git(repo, ['checkout', '-q', '-b', 'side'])
      write(repo, 'side.txt', 'side\n')
      stageAll(repo)
      commit(repo, 'side')
      git(repo, ['checkout', '-q', branch])
      write(repo, 'base2.txt', 'base2\n')
      stageAll(repo)
      commit(repo, 'base work')
      const before = git(repo, ['rev-parse', 'HEAD']).trim()
      git(repo, ['merge', '--no-edit', 'side'])
      const merge = git(repo, ['rev-parse', 'HEAD']).trim()
      return { repo, remote, branch, merge, before }
    }

    // Published: reverting a merge needs `-m` and a mainline choice, which is
    // the user's to make — the panel refuses rather than guessing.
    const published = makeMerge('undo-merge-pub')
    git(published.repo, ['push', '-q'])
    const refused = await serviceFor({ s1: published.repo }).undoCommit('s1', published.merge)
    assert.equal(refused.ok, false)
    assert.match(refused.ok ? '' : refused.error.message, /merge/u)
    assert.equal(git(published.repo, ['rev-parse', 'HEAD']).trim(), published.merge)

    // Unpublished: `reset --mixed HEAD~1` needs no mainline — it simply returns
    // to the first parent, and the merge's changes land in the working tree.
    const local = makeMerge('undo-merge-local')
    const undone = await serviceFor({ s1: local.repo }).undoCommit('s1', local.merge)
    assert.ok(undone.ok, undone.ok ? '' : JSON.stringify(undone.error))
    assert.equal(undone.value.mode, 'reset')
    assert.equal(git(local.repo, ['rev-parse', 'HEAD']).trim(), local.before)
  })

  it('refuses a malformed hash without spawning git at all', async () => {
    const { repo, second } = repoWithTwoCommits('undo-badhash')
    for (const hash of ['HEAD~1', 'ZZZZ', '-c', 'a'.repeat(41), 'abc']) {
      const result = await serviceFor({ s1: repo }).undoCommit('s1', hash)
      assert.equal(result.ok, false, `expected ${hash} to be refused`)
      assert.equal(result.ok ? '' : result.error.code, 'bad-request')
    }
    assert.equal(git(repo, ['rev-parse', 'HEAD']).trim(), second)
  })

  it('audits the undo with the commit, the repository, and the mode (§5.5)', async () => {
    const { repo, second } = repoWithTwoCommits('undo-audit')
    const lines: string[] = []
    const service = createGitService(createGitRunner(), resolverFor({ s1: repo }), {
      log: (_level, message) => lines.push(message),
      generateText: () => Promise.reject(new Error('no model in this test')),
    })

    const result = await service.undoCommit('s1', second)
    assert.ok(result.ok, result.ok ? '' : JSON.stringify(result.error))
    const audit = lines.find((line) => line.includes('undid'))
    assert.ok(audit, 'an undo must be audited — the commit is gone afterwards')
    assert.match(audit ?? '', /via reset/u)
    assert.match(audit ?? '', /second/u)
    assert.match(audit ?? '', new RegExp(second.slice(0, 7), 'u'))
  })
})

describe('stashing (FR-6.2)', () => {
  /** A repository with one commit and one unstaged edit to `a.txt`. */
  function repoWithChange(prefix: string): string {
    const repo = makeRepo(prefix)
    write(repo, 'a.txt', 'one\n')
    stageAll(repo)
    commit(repo, 'first')
    write(repo, 'a.txt', 'two\n')
    return repo
  }

  it('saves the worktree under the caller’s label, and lists it by id and selector', async () => {
    const repo = repoWithChange('stash-save')
    const service = serviceFor({ s1: repo })

    const saved = await service.stashSave('s1', 'half-done work', false)
    assert.ok(saved.ok, saved.ok ? '' : JSON.stringify(saved.error))

    // The edit left the worktree and went onto the stack: that is what a stash
    // IS, and the change list is empty afterwards.
    assert.equal(readFileSync(join(repo, 'a.txt'), 'utf8'), 'one\n')
    assert.equal(gitTry(repo, ['diff', '--quiet']).code, 0)

    const listed = await service.stashes('s1')
    assert.ok(listed.ok)
    assert.equal(listed.value.length, 1)
    const entry = listed.value[0]
    assert.equal(entry?.selector, 'stash@{0}')
    assert.match(entry?.subject ?? '', /half-done work/u)
    assert.equal(entry?.oid, git(repo, ['rev-parse', 'stash@{0}']).trim())
    // The full id is what the panel sends back; it is a real commit either way.
    assert.equal(entry?.oid.length, 40)
    assert.equal(entry?.shortOid, entry?.oid.slice(0, 7))
  })

  it('includes untracked files only when the caller asks for them', async () => {
    const repo = makeRepo('stash-untracked')
    write(repo, 'a.txt', 'one\n')
    stageAll(repo)
    commit(repo, 'first')
    write(repo, 'scratch.txt', 'scratch\n')

    // Tracked-only, and there is none of that: `git stash push` would answer
    // "No local changes to save" and exit 0, which is why the host asks the
    // worktree first and refuses with a sentence instead.
    const refused = await serviceFor({ s1: repo }).stashSave('s1', null, false)
    assert.equal(refused.ok, false)
    assert.equal(refused.ok ? '' : refused.error.code, 'bad-request')
    assert.match(refused.ok ? '' : refused.error.message, /untracked/u)
    assert.equal(gitTry(repo, ['stash', 'list']).stdout.trim(), '')

    const saved = await serviceFor({ s1: repo }).stashSave('s1', null, true)
    assert.ok(saved.ok, saved.ok ? '' : JSON.stringify(saved.error))
    // `-u`: the untracked file went with it, so the worktree is clean.
    assert.equal(existsSync(join(repo, 'scratch.txt')), false)
    const status = await serviceFor({ s1: repo }).status('s1')
    assert.ok(status.ok)
    assert.deepEqual(status.value.groups.untracked, [])
  })

  it('takes staged and unstaged changes alike, and leaves both sides clean', async () => {
    const repo = makeRepo('stash-both-halves')
    write(repo, 'a.txt', 'one\n')
    write(repo, 'b.txt', 'one\n')
    stageAll(repo)
    commit(repo, 'first')
    // One half in the index, one in the worktree: `git stash push` takes both and
    // resets the index, which is the behaviour the panel is reporting on.
    write(repo, 'a.txt', 'two\n')
    git(repo, ['add', 'a.txt'])
    write(repo, 'b.txt', 'two\n')

    const saved = await serviceFor({ s1: repo }).stashSave('s1', null, false)
    assert.ok(saved.ok, saved.ok ? '' : JSON.stringify(saved.error))

    const status = await serviceFor({ s1: repo }).status('s1')
    assert.ok(status.ok)
    assert.deepEqual(status.value.groups.staged, [])
    assert.deepEqual(status.value.groups.unstaged, [])
    assert.equal(readFileSync(join(repo, 'a.txt'), 'utf8'), 'one\n')
    assert.equal(readFileSync(join(repo, 'b.txt'), 'utf8'), 'one\n')
  })

  it('refuses an empty worktree rather than announcing a stash that never happened', async () => {
    const repo = makeRepo('stash-clean')
    write(repo, 'a.txt', 'one\n')
    stageAll(repo)
    commit(repo, 'first')

    const result = await serviceFor({ s1: repo }).stashSave('s1', null, false)
    assert.equal(result.ok, false)
    assert.equal(result.ok ? '' : result.error.code, 'bad-request')
    assert.match(result.ok ? '' : result.error.message, /nothing to stash/u)
    assert.equal(gitTry(repo, ['stash', 'list']).stdout.trim(), '')
  })

  it('lets git refuse a stash mid-merge, and leaves the conflict untouched', async () => {
    // Probed: `git stash push` with unmerged paths exits 1 printing "a.txt: needs
    // merge" on STDOUT, and the conflicted index is exactly as it was. The panel
    // forwards git's sentence rather than inventing a resolution for a merge the
    // user is in the middle of.
    const repo = makeRepo('stash-conflicted')
    write(repo, 'a.txt', 'one\n')
    stageAll(repo)
    commit(repo, 'first')
    const base = currentBranch(repo)
    git(repo, ['checkout', '-q', '-b', 'side'])
    write(repo, 'a.txt', 'side\n')
    stageAll(repo)
    commit(repo, 'side')
    git(repo, ['checkout', '-q', base])
    write(repo, 'a.txt', 'base\n')
    stageAll(repo)
    commit(repo, 'base')
    const merged = gitTry(repo, ['merge', 'side'])
    assert.notEqual(merged.code, 0, 'the fixture must conflict for this test to mean anything')

    const result = await serviceFor({ s1: repo }).stashSave('s1', null, false)
    assert.equal(result.ok, false)
    assert.match(result.ok ? '' : result.error.message, /needs merge/u)
    // The conflict is still there, and no entry was created.
    assert.equal(gitTry(repo, ['stash', 'list']).stdout.trim(), '')
    assert.match(readFileSync(join(repo, 'a.txt'), 'utf8'), /<<<<<<< /u)
  })

  it('applies an entry while keeping it, and drops it only on pop', async () => {
    const repo = repoWithChange('stash-apply')
    const service = serviceFor({ s1: repo })
    await service.stashSave('s1', null, false)
    const listed = await service.stashes('s1')
    assert.ok(listed.ok)
    const oid = listed.value[0]?.oid ?? ''

    const applied = await service.stashApply('s1', oid, false)
    assert.ok(applied.ok, applied.ok ? '' : JSON.stringify(applied.error))
    assert.equal(readFileSync(join(repo, 'a.txt'), 'utf8'), 'two\n')
    const afterApply = await service.stashes('s1')
    assert.ok(afterApply.ok)
    assert.equal(afterApply.value.length, 1, 'apply is not pop: the entry stays')

    // Back to a clean worktree, so the pop has something to apply onto.
    git(repo, ['restore', '--', 'a.txt'])
    const popped = await service.stashApply('s1', oid, true)
    assert.ok(popped.ok, popped.ok ? '' : JSON.stringify(popped.error))
    assert.equal(readFileSync(join(repo, 'a.txt'), 'utf8'), 'two\n')
    const afterPop = await service.stashes('s1')
    assert.ok(afterPop.ok)
    assert.deepEqual(afterPop.value, [])
  })

  it('finds the entry by id, so a shifted stack cannot be applied by position', async () => {
    const repo = repoWithChange('stash-shift')
    const service = serviceFor({ s1: repo })
    await service.stashSave('s1', 'first', false)
    const first = await service.stashes('s1')
    assert.ok(first.ok)
    const oid = first.value[0]?.oid ?? ''

    // A second stash lands on top: the entry that was `stash@{0}` is now
    // `stash@{1}`, and its content is the older edit.
    write(repo, 'a.txt', 'three\n')
    await service.stashSave('s1', 'second', false)
    const listed = await service.stashes('s1')
    assert.ok(listed.ok)
    assert.deepEqual(
      listed.value.map((entry) => entry.selector),
      ['stash@{0}', 'stash@{1}'],
    )
    assert.equal(readFileSync(join(repo, 'a.txt'), 'utf8'), 'one\n')

    const applied = await service.stashApply('s1', oid, false)
    assert.ok(applied.ok, applied.ok ? '' : JSON.stringify(applied.error))
    // "two" is the FIRST stash; applying by the number the panel once showed
    // would have put "three" back instead.
    assert.equal(readFileSync(join(repo, 'a.txt'), 'utf8'), 'two\n')
  })

  it('refuses an id that is no longer in the stack, crediting its own listing', async () => {
    const repo = repoWithChange('stash-stale')
    const service = serviceFor({ s1: repo })
    const stale = 'f'.repeat(40)

    const applied = await service.stashApply('s1', stale, false)
    assert.equal(applied.ok, false)
    assert.equal(applied.ok ? '' : applied.error.code, 'bad-request')
    assert.match(applied.ok ? '' : applied.error.message, /no longer in the list/u)

    const dropped = await service.stashDrop('s1', stale)
    assert.equal(dropped.ok, false)
    assert.equal(dropped.ok ? '' : dropped.error.code, 'bad-request')
  })

  it('refuses to apply over local changes, with the code the panel acts on', async () => {
    const repo = repoWithChange('stash-dirty-apply')
    const service = serviceFor({ s1: repo })
    await service.stashSave('s1', null, false)
    const listed = await service.stashes('s1')
    assert.ok(listed.ok)
    const oid = listed.value[0]?.oid ?? ''

    // A different edit to the same file: git refuses rather than merging over it.
    write(repo, 'a.txt', 'three\n')
    const applied = await service.stashApply('s1', oid, false)
    assert.equal(applied.ok, false)
    assert.equal(applied.ok ? '' : applied.error.code, 'dirty-worktree')
    assert.match(applied.ok ? '' : (applied.error.detail ?? ''), /would be overwritten/u)
    // Nothing moved, and the entry is still there to try again later.
    assert.equal(readFileSync(join(repo, 'a.txt'), 'utf8'), 'three\n')
    const after = await service.stashes('s1')
    assert.ok(after.ok)
    assert.equal(after.value.length, 1)
  })

  it('keeps the entry when a pop conflicts, exactly as git does', async () => {
    const repo = makeRepo('stash-conflict')
    write(repo, 'a.txt', 'one\n')
    stageAll(repo)
    commit(repo, 'first')
    const service = serviceFor({ s1: repo })
    write(repo, 'a.txt', 'TWO\n')
    await service.stashSave('s1', 's2', false)
    const listed = await service.stashes('s1')
    assert.ok(listed.ok)
    const oid = listed.value[0]?.oid ?? ''

    // A commit moves the same line, so the pop conflicts.
    write(repo, 'a.txt', 'THREE\n')
    stageAll(repo)
    commit(repo, 'third')

    const popped = await service.stashApply('s1', oid, true)
    assert.equal(popped.ok, false)
    assert.equal(popped.ok ? '' : popped.error.code, 'conflict')
    // The conflict markers are in the file and the stash is KEPT — a pop that
    // did not apply cleanly is not a pop that may drop the entry.
    assert.match(readFileSync(join(repo, 'a.txt'), 'utf8'), /<<<<<<< /u)
    const after = await service.stashes('s1')
    assert.ok(after.ok)
    assert.equal(after.value.length, 1)
  })

  it('drops an entry, and audits which one went (§5.5)', async () => {
    const repo = repoWithChange('stash-drop')
    const lines: string[] = []
    const service = createGitService(createGitRunner(), resolverFor({ s1: repo }), {
      log: (_level, message) => lines.push(message),
      generateText: () => Promise.reject(new Error('no model in this test')),
    })

    await service.stashSave('s1', 'labelled', false)
    const listed = await service.stashes('s1')
    assert.ok(listed.ok)
    const entry = listed.value[0]
    assert.ok(entry)

    const applied = await service.stashApply('s1', entry.oid, false)
    assert.ok(applied.ok, applied.ok ? '' : JSON.stringify(applied.error))
    const dropped = await service.stashDrop('s1', entry.oid)
    assert.ok(dropped.ok, dropped.ok ? '' : JSON.stringify(dropped.error))
    const after = await service.stashes('s1')
    assert.ok(after.ok)
    assert.deepEqual(after.value, [])

    // §7: the log line is the only record once the entry is gone — it names the
    // selector, the id, the repository and the subject.
    const saved = lines.find((line) => line.includes('stashed'))
    assert.match(saved ?? '', /as "labelled"/u)
    const appliedLine = lines.find((line) => line.includes('applied'))
    assert.match(appliedLine ?? '', /applied stash@\{0\}/u)
    assert.match(appliedLine ?? '', new RegExp(entry.oid.slice(0, 7), 'u'))
    const droppedLine = lines.find((line) => line.includes('dropped'))
    assert.match(droppedLine ?? '', /dropped stash@\{0\}/u)
    assert.match(droppedLine ?? '', /labelled/u)
  })

  it('refuses a malformed id without spawning git at all', async () => {
    const repo = repoWithChange('stash-badid')
    for (const oid of ['stash@{0}', 'HEAD', 'ZZZZ', 'abc', 'a'.repeat(41)]) {
      const applied = await serviceFor({ s1: repo }).stashApply('s1', oid, false)
      assert.equal(applied.ok, false, `expected ${oid} to be refused`)
      assert.equal(applied.ok ? '' : applied.error.code, 'bad-request')
      const dropped = await serviceFor({ s1: repo }).stashDrop('s1', oid)
      assert.equal(dropped.ok, false, `expected ${oid} to be refused`)
    }
  })
})
