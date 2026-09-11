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

import { rmSync } from 'node:fs'
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
const SILENT: HostPorts = { log: () => undefined }

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
      service.sync('missing'),
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
    ])
    for (const result of results) {
      assert.equal(result.ok, false)
      assert.equal(result.ok ? '' : result.error.code, 'not-a-repo')
    }
  })
})
