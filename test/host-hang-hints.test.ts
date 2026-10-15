/**
 * The two hangs a git GUI actually meets, and what the panel calls them.
 *
 * `GIT_TERMINAL_PROMPT=0` keeps git from waiting on a terminal, but two prompts
 * do not belong to git: gpg's pinentry (a signed commit) and SSH's passphrase or
 * host-key question. Both end as a killed child and, before this, as the
 * undifferentiated "git did not finish in time". The point of these tests is that
 * the panel can still name the cause — from what was being run and from the
 * repository's own configuration — and that a hang with neither cause stays an
 * ordinary timeout.
 *
 * Every hang here is a real one: a stand-in program that sleeps (or refuses) is
 * named by `gpg.program` / `core.sshCommand` / `core.fsmonitor`, so git itself
 * waits and the deadline is what ends it. Nothing is mocked but the clock.
 *
 * @module dsh-git-panel/test/host-hang-hints
 */

import { chmodSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'
import assert from 'node:assert/strict'

import type { HostPorts, Result, SessionDirResolver } from '../src/core/ports.ts'
import { createGitRunner } from '../src/host/git-exec.ts'
import { createGitService } from '../src/host/git-service.ts'
import {
  cleanupRepos,
  git,
  makePlainDir,
  makeRepo,
  stageAll,
  write,
} from './helpers/repo.ts'

after(cleanupRepos)

/**
 * A deadline short enough to keep these tests quick, long enough that git gets
 * as far as the prompt it is being killed for.
 */
const DEADLINE_MS = 700

/** A silent diagnostic port; log lines are not what these tests are about. */
const SILENT: HostPorts = {
  log: () => undefined,
  generateText: () => Promise.reject(new Error('no model in this test')),
}

/** A resolver that maps the one session these tests use onto its repository. */
function resolverFor(dir: string): SessionDirResolver {
  return {
    resolveDir(sessionId: string): Promise<Result<string>> {
      if (sessionId !== 's1') {
        return Promise.resolve({
          ok: false,
          error: { code: 'no-session', message: 'unknown session' },
        })
      }
      return Promise.resolve({ ok: true, value: dir })
    },
  }
}

/** The real service over the real runner, with the short deadline above. */
function serviceFor(dir: string) {
  return createGitService(createGitRunner(), resolverFor(dir), SILENT, {
    timeoutMs: DEADLINE_MS,
  })
}

/**
 * Write an executable stand-in program and return its path.
 *
 * It lives in a temp directory of its own, not in the repository: a script
 * inside the work tree would show up as a change in the very status the negative
 * test asks for.
 */
function program(body: string): string {
  const dir = makePlainDir('stand-in')
  const file = join(dir, 'program.sh')
  writeFileSync(file, `#!/bin/sh\n${body}\n`, 'utf8')
  chmodSync(file, 0o755)
  return file
}

/** A repository with one staged file, which is what a commit needs. */
function repoWithStagedFile(prefix: string): string {
  const repo = makeRepo(prefix)
  write(repo, 'a.txt', 'one\n')
  stageAll(repo)
  return repo
}

describe('a git call killed with a signing prompt outstanding', () => {
  it('is reported as a signing prompt, not as an anonymous timeout', async () => {
    const repo = repoWithStagedFile('gpg-hang')
    git(repo, ['config', 'commit.gpgsign', 'true'])
    // Stands in for gpg waiting on pinentry: it never answers, so the commit
    // never finishes and the deadline is the only thing that ends it.
    git(repo, ['config', 'gpg.program', program('sleep 5')])

    const result = await serviceFor(repo).commit('s1', 'signed')

    assert.equal(result.ok, false)
    assert.equal(result.ok === false ? result.error.code : '', 'gpg-prompt')
  })

  it('keeps the code to the verbs that can sign', async () => {
    // The same sleeping gpg, on a verb that never signs: `git status` does not
    // call gpg at all, so nothing here may be blamed on signing.
    const repo = repoWithStagedFile('gpg-idle')
    git(repo, ['config', 'gpg.program', program('sleep 5')])

    const result = await serviceFor(repo).status('s1')

    assert.equal(result.ok, true)
  })
})

describe('a signed commit whose signing agent refuses', () => {
  it('is reported as a signature failure, with gpg’s own words as the detail', async () => {
    const repo = repoWithStagedFile('gpg-refused')
    git(repo, ['config', 'commit.gpgsign', 'true'])
    git(repo, [
      'config',
      'gpg.program',
      program('echo "gpg: skipped \\"ABC\\": No secret key" >&2\nexit 2'),
    ])

    const result = await serviceFor(repo).commit('s1', 'signed')

    assert.equal(result.ok, false)
    assert.equal(result.ok === false ? result.error.code : '', 'gpg-failed')
    assert.match(result.ok === false ? (result.error.detail ?? '') : '', /No secret key/u)
  })
})

describe('a fetch over SSH that never answers', () => {
  it('is reported as an SSH prompt, not as an anonymous timeout', async () => {
    const repo = makeRepo('ssh-hang')
    git(repo, ['remote', 'add', 'origin', 'git@example.invalid:org/repo.git'])
    // The transport git would use: a program that waits for a passphrase nobody
    // can type, so the fetch hangs exactly where a real one would.
    git(repo, ['config', 'core.sshCommand', program('sleep 5')])

    const result = await serviceFor(repo).fetch('s1')

    assert.equal(result.ok, false)
    assert.equal(result.ok === false ? result.error.code : '', 'ssh-prompt')
  })

  it('names a refusal instead when SSH answers', async () => {
    const repo = makeRepo('ssh-refused')
    git(repo, ['remote', 'add', 'origin', 'git@example.invalid:org/repo.git'])
    git(repo, [
      'config',
      'core.sshCommand',
      program('echo "git@example.invalid: Permission denied (publickey)." >&2\nexit 255'),
    ])

    const result = await serviceFor(repo).fetch('s1')

    assert.equal(result.ok, false)
    assert.equal(result.ok === false ? result.error.code : '', 'ssh-failed')
  })
})

describe('a hang with neither cause configured', () => {
  it('stays an ordinary timeout', async () => {
    // `core.fsmonitor` is consulted by `git status` itself, so this hangs a read
    // that is neither a commit nor a remote call — precisely the case that must
    // not be blamed on signing or SSH.
    const repo = makeRepo('fsmonitor-hang')
    git(repo, ['config', 'core.fsmonitor', program('sleep 5')])

    const result = await serviceFor(repo).status('s1')

    assert.equal(result.ok, false)
    assert.equal(result.ok === false ? result.error.code : '', 'timeout')
  })
})
