/**
 * The HTTPS credential path, end to end (the fetch/pull/push credential feature).
 *
 * This is the test the feature exists for: a real `git fetch` against a real
 * server that answers 401 until Basic credentials arrive, driven through the
 * service, the askpass injection, and a credential store. Nothing here is
 * stubbed except the store itself — git, the transport, and the helper script
 * are all real, which is the only way to know the injection actually works:
 * `GIT_TERMINAL_PROMPT=0` means every other test's git fails fast, and this one
 * proves that a stored credential turns that failure into a fetch.
 *
 * @module dsh-git-panel/test/host-auth-flow
 */

import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'
import assert from 'node:assert/strict'

import type {
  GitCredential,
  GitCredentialStore,
  HostPorts,
  SessionDirResolver,
} from '../src/core/ports.ts'
import { createGitRunner } from '../src/host/git-exec.ts'
import { createGitService } from '../src/host/git-service.ts'
import {
  cleanupRepos,
  commit,
  currentBranch,
  git,
  gitTry,
  makePlainDir,
  makeRepo,
  stageAll,
  write,
} from './helpers/repo.ts'

after(cleanupRepos)

/**
 * A minimal smart-HTTP git server that demands Basic auth.
 *
 * `git http-backend` does the protocol; this only does the CGI bridge and the
 * 401. That is deliberate: a hand-rolled advertisement would prove the askpass
 * wiring against a mock, and the claim being tested is about what REAL git does
 * when it meets a 401.
 * @param root - Directory the served repository lives under.
 * @returns The server's origin and a closer.
 */
async function startAuthServer(
  root: string,
): Promise<{ origin: string; close: () => Promise<void> }> {
  const expected = `Basic ${Buffer.from('user:pass').toString('base64')}`
  const server = createServer((req, res) => {
    if (req.headers.authorization !== expected) {
      res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="git"' })
      res.end('auth required')
      return
    }
    const url = new URL(req.url ?? '/', 'http://localhost')
    const child = spawn('git', ['http-backend'], {
      env: {
        ...process.env,
        GIT_PROJECT_ROOT: root,
        GIT_HTTP_EXPORT_ALL: '1',
        PATH_INFO: url.pathname,
        QUERY_STRING: url.search.replace(/^\?/u, ''),
        REQUEST_METHOD: req.method ?? 'GET',
        CONTENT_TYPE: String(req.headers['content-type'] ?? ''),
        REMOTE_USER: 'user',
        REMOTE_ADDR: '127.0.0.1',
      },
    })
    const chunks: Buffer[] = []
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk))
    child.on('close', () => {
      const out = Buffer.concat(chunks)
      const split = out.indexOf('\r\n\r\n')
      const head = out.subarray(0, split < 0 ? 0 : split).toString('utf8')
      const body = split < 0 ? Buffer.alloc(0) : out.subarray(split + 4)
      let status = 200
      const headers: Record<string, string> = {}
      for (const line of head.split('\r\n')) {
        const colon = line.indexOf(':')
        if (colon < 0) continue
        const name = line.slice(0, colon).trim()
        const value = line.slice(colon + 1).trim()
        if (name.toLowerCase() === 'status') {
          status = Number(value.split(' ')[0]) || 200
          continue
        }
        headers[name] = value
      }
      res.writeHead(status, headers)
      res.end(body)
    })
    req.pipe(child.stdin)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : 0
  return {
    origin: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve())
      }),
  }
}

/**
 * The service over one session.
 * @param repo - The session's directory.
 * @param credentials - The store to inject, or omitted for a composition without one.
 * @param logs - Collected diagnostic lines, for the audit assertions.
 */
function serviceWith(repo: string, credentials?: GitCredentialStore, logs: string[] = []) {
  const resolver: SessionDirResolver = {
    resolveDir: (sessionId) =>
      Promise.resolve(
        sessionId === 's1'
          ? { ok: true, value: repo }
          : { ok: false, error: { code: 'no-session', message: 'unknown session' } },
      ),
  }
  const ports: HostPorts = {
    log: (_level, message) => {
      logs.push(message)
    },
    generateText: () => Promise.reject(new Error('no model in this test')),
    ...(credentials === undefined ? {} : { credentials }),
  }
  return createGitService(createGitRunner(), resolver, ports)
}

/** A store that keeps credentials in a map, for the tests that need a working one. */
function mapStore(): { credentials: GitCredentialStore; stored: Map<string, GitCredential> } {
  const stored = new Map<string, GitCredential>()
  return {
    stored,
    credentials: {
      read: (origin) => Promise.resolve({ ok: true, value: stored.get(origin) ?? null }),
      save: (origin, credential) => {
        stored.set(origin, credential)
        return Promise.resolve({ ok: true, value: undefined })
      },
    },
  }
}

describe('storing a remote credential', () => {
  const ORIGIN = 'https://codeup.aliyun.com'

  /** A repository whose origin is an HTTPS remote (reachable or not is irrelevant here). */
  function repoWithHttpRemote(prefix: string): string {
    const repo = makeRepo(prefix)
    write(repo, 'a.txt', 'one\n')
    stageAll(repo)
    commit(repo, 'first')
    git(repo, ['remote', 'add', 'origin', `${ORIGIN}/group/repo.git`])
    return repo
  }

  it('stores the pair for an origin the repository has, and audits the origin only', async () => {
    const repo = repoWithHttpRemote('auth-save')
    const logs: string[] = []
    const { credentials, stored } = mapStore()
    const result = await serviceWith(repo, credentials, logs).saveCredential(
      's1',
      ORIGIN,
      'ada',
      'secret-token',
    )
    assert.ok(result.ok, result.ok ? '' : JSON.stringify(result.error))
    assert.deepEqual(stored.get(ORIGIN), { username: 'ada', password: 'secret-token' })
    const audit = logs.filter((line) => line.includes('stored a credential'))
    assert.equal(audit.length, 1)
    assert.match(audit[0] ?? '', /codeup\.aliyun\.com/u)
    assert.ok(!(audit[0] ?? '').includes('secret-token'), 'the value must never reach a log line')
  })

  it('refuses an origin this repository does not have', async () => {
    // The browser sends the origin it read off git's refusal, but it does not
    // get to decide what this plugin's credential namespace accepts.
    const repo = repoWithHttpRemote('auth-save-wrong')
    const { credentials } = mapStore()
    const result = await serviceWith(repo, credentials).saveCredential(
      's1',
      'https://evil.example',
      'ada',
      't',
    )
    assert.equal(result.ok, false)
    assert.equal(result.ok ? '' : result.error.code, 'bad-request')
  })

  it('refuses a remote that is not a bare HTTP(S) origin', async () => {
    const repo = repoWithHttpRemote('auth-save-shape')
    const { credentials } = mapStore()
    for (const remote of [`${ORIGIN}/group/repo.git`, 'git@github.com:o/r.git', '']) {
      const result = await serviceWith(repo, credentials).saveCredential('s1', remote, 'ada', 't')
      assert.equal(result.ok, false, remote)
      assert.equal(result.ok ? '' : result.error.code, 'bad-request')
    }
  })

  it('says the deployment cannot save when it has no credential provider', async () => {
    const repo = repoWithHttpRemote('auth-save-none')
    const result = await serviceWith(repo).saveCredential('s1', ORIGIN, 'ada', 't')
    assert.equal(result.ok, false)
    assert.equal(result.ok ? '' : result.error.code, 'credentials-unavailable')
  })
})

describe('an HTTPS remote that wants a credential', () => {
  it('names the origin when git cannot ask, then fetches once one is stored', async () => {
    const root = makePlainDir('auth-root')
    const bare = join(root, 'repo.git')
    git(root, ['init', '--bare', '-q', 'repo.git'])

    const seed = makeRepo('auth-seed')
    write(seed, 'a.txt', 'one\n')
    stageAll(seed)
    commit(seed, 'first')
    const branch = currentBranch(seed)
    git(seed, ['remote', 'add', 'origin', bare])
    git(seed, ['push', '-q', '-u', 'origin', branch])

    const work = makeRepo('auth-work')
    write(work, 'b.txt', 'two\n')
    stageAll(work)
    commit(work, 'second')

    const server = await startAuthServer(root)
    try {
      git(work, ['remote', 'add', 'origin', `${server.origin}/repo.git`])

      const { credentials, stored } = mapStore()
      const service = serviceWith(work, credentials)

      // Without a credential git has nobody to ask, and the host says so in a
      // way the panel can act on: the code AND the origin to address.
      const refused = await service.fetch('s1')
      assert.equal(refused.ok, false)
      if (refused.ok) return
      assert.equal(refused.error.code, 'auth-required')
      assert.equal(refused.error.remote, server.origin)

      // The pair the server accepts, and the very same operation retried.
      stored.set(server.origin, { username: 'user', password: 'pass' })
      const fetched = await service.fetch('s1')
      assert.ok(fetched.ok, fetched.ok ? '' : JSON.stringify(fetched.error))
      assert.equal(
        gitTry(work, ['rev-parse', `refs/remotes/origin/${branch}`]).code,
        0,
        'the remote-tracking ref is there, so the authenticated fetch really moved it',
      )
    } finally {
      await server.close()
    }
  })
})
