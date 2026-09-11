/**
 * Host-half tests: the real git service and the real route layer.
 *
 * The doc's M1 gate is "面板能看到当前仓库变更分组与分支". The browser half cannot
 * be reached without a DSH process, but everything that FEEDS it can be: the git
 * service is pure Node over the core ports, and the route layer only ever touches
 * `ctx.webServer.register`. So these tests stand a real HTTP server in front of
 * the real handlers and drive them with real requests over a real socket.
 *
 * What that buys, concretely: the JSON envelope, the session-parameter
 * validation, the 404 path, and the SSE stream's `ready` / `changed` frames are
 * all verified here rather than discovered in a browser.
 *
 * @module dsh-git-panel/test/host-service
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { after, describe, it } from 'node:test'
import assert from 'node:assert/strict'

import type { Context } from '@deepseek-ai/cordis'

import { createGitRunner } from '../src/host/git-exec.ts'
import { createGitService } from '../src/host/git-service.ts'
import { registerGitPanelRoutes } from '../src/host/adapter/routes.ts'
import { createRepoWatcher } from '../src/host/watcher.ts'
import type { HostPorts, Result, SessionDirResolver } from '../src/core/ports.ts'
import {
  cleanupRepos,
  commit,
  git,
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
        return Promise.resolve({
          ok: false,
          error: { code: 'no-session', message: 'unknown session' },
        })
      }
      return Promise.resolve({ ok: true, value: dir })
    },
  }
}

/** The service over a real runner and a directory map. */
function serviceFor(sessions: Readonly<Record<string, string>>) {
  return createGitService(createGitRunner(), resolverFor(sessions), SILENT)
}

describe('git service status', () => {
  it('reports the branch and the three change groups', async () => {
    const repo = makeRepo('svc-status')
    write(repo, 'a.txt', 'one\n')
    write(repo, 'b.txt', 'one\n')
    stageAll(repo)
    commit(repo, 'first')

    write(repo, 'a.txt', 'two\n') // unstaged
    write(repo, 'b.txt', 'two\n') // staged (added below)
    git(repo, ['add', 'b.txt'])
    write(repo, 'c.txt', 'new\n') // untracked

    const result = await serviceFor({ s1: repo }).status('s1')
    assert.ok(result.ok, result.ok ? '' : JSON.stringify(result.error))
    assert.equal(result.value.branch.head, 'branch')
    assert.equal(result.value.branch.name, git(repo, ['symbolic-ref', '--short', 'HEAD']).trim())
    assert.deepEqual(result.value.groups.staged.map((e) => e.path), ['b.txt'])
    assert.deepEqual(result.value.groups.unstaged.map((e) => e.path), ['a.txt'])
    assert.deepEqual(result.value.groups.untracked.map((e) => e.path), ['c.txt'])
    assert.equal(result.value.changedCount, 3)
    assert.equal(result.value.truncated, false)
    // The root comes from git, not from the directory the session points at.
    assert.equal(result.value.root, git(repo, ['rev-parse', '--show-toplevel']).trim())
  })

  it('finds the repository from a SUBDIRECTORY of it', async () => {
    const repo = makeRepo('svc-subdir')
    write(repo, 'nested/deep/a.txt', 'one\n')
    stageAll(repo)
    commit(repo, 'first')

    // A session opened below the root must still describe the whole repository.
    const result = await serviceFor({ s1: `${repo}/nested/deep` }).status('s1')
    assert.ok(result.ok)
    assert.equal(result.value.root, git(repo, ['rev-parse', '--show-toplevel']).trim())
  })

  it('answers not-a-repo for a directory outside any repository', async () => {
    // A fresh temp directory: no `.git` above it, so git resolves no work tree.
    const outside = makePlainDir('svc-norepo')

    const result = await serviceFor({ s1: outside }).status('s1')
    assert.equal(result.ok, false)
    assert.equal(result.ok ? '' : result.error.code, 'not-a-repo')
  })

  it('answers no-session for an id the host does not know', async () => {
    const result = await serviceFor({}).status('missing')
    assert.equal(result.ok, false)
    assert.equal(result.ok ? '' : result.error.code, 'no-session')
  })

  it('reports an unborn repository rather than failing', async () => {
    const repo = makeRepo('svc-unborn')
    const result = await serviceFor({ s1: repo }).status('s1')
    assert.ok(result.ok)
    assert.equal(result.value.branch.head, 'unborn')
    assert.equal(result.value.changedCount, 0)
  })
})

describe('git service branches and history', () => {
  it('lists local branches and marks the current one', async () => {
    const repo = makeRepo('svc-branches')
    write(repo, 'a.txt', 'one\n')
    stageAll(repo)
    commit(repo, 'first')
    const base = git(repo, ['symbolic-ref', '--short', 'HEAD']).trim()
    git(repo, ['branch', 'feature-x'])

    const result = await serviceFor({ s1: repo }).branches('s1')
    assert.ok(result.ok)
    assert.equal(result.value.length, 2)
    assert.deepEqual(
      result.value.filter((branch) => branch.current).map((branch) => branch.name),
      [base],
    )
  })

  it('pages history using a look-ahead commit instead of counting', async () => {
    const repo = makeRepo('svc-log')
    for (const message of ['one', 'two', 'three']) {
      write(repo, 'a.txt', `${message}\n`)
      stageAll(repo)
      commit(repo, message)
    }
    const service = serviceFor({ s1: repo })

    const first = await service.log('s1', 0, 2)
    assert.ok(first.ok)
    assert.deepEqual(first.value.commits.map((c) => c.subject), ['three', 'two'])
    assert.equal(first.value.hasMore, true)
    // No rev-list walk happened, so the total is honestly unknown.
    assert.equal(first.value.total, null)

    const second = await service.log('s1', 2, 2)
    assert.ok(second.ok)
    assert.deepEqual(second.value.commits.map((c) => c.subject), ['one'])
    assert.equal(second.value.hasMore, false)
  })

  it('returns an empty history for an unborn branch instead of an error', async () => {
    const repo = makeRepo('svc-log-unborn')
    const result = await serviceFor({ s1: repo }).log('s1', 0, 30)
    assert.ok(result.ok, result.ok ? '' : JSON.stringify(result.error))
    assert.deepEqual(result.value.commits, [])
    assert.equal(result.value.hasMore, false)
  })

  it('marks commits the upstream does not have', async () => {
    const repo = makeRepo('svc-log-pushed')
    write(repo, 'a.txt', 'one\n')
    stageAll(repo)
    commit(repo, 'first')
    const branch = git(repo, ['symbolic-ref', '--short', 'HEAD']).trim()
    const remote = makeBareRemote('svc-log-remote')
    git(repo, ['remote', 'add', 'origin', remote])
    git(repo, ['push', '-q', '-u', 'origin', branch])

    write(repo, 'a.txt', 'two\n')
    stageAll(repo)
    commit(repo, 'second')

    const result = await serviceFor({ s1: repo }).log('s1', 0, 30)
    assert.ok(result.ok)
    assert.deepEqual(result.value.commits.map((c) => c.subject), ['second', 'first'])
    assert.equal(result.value.commits[0]?.pushed, false)
    assert.equal(result.value.commits[1]?.pushed, true)
  })
})

describe('git service staged paths', () => {
  it('returns exactly the paths a commit would record', async () => {
    const repo = makeRepo('svc-staged')
    write(repo, 'a.txt', 'one\n')
    stageAll(repo)
    commit(repo, 'first')
    write(repo, 'a.txt', 'two\n')
    write(repo, 'b.txt', 'new\n')
    git(repo, ['add', 'b.txt'])

    const result = await serviceFor({ s1: repo }).stagedPaths('s1')
    assert.ok(result.ok)
    assert.deepEqual(result.value.map((entry) => entry.path), ['b.txt'])
  })
})

/** One route registration captured from the stub context. */
interface Registration {
  readonly kind: 'exact' | 'prefix'
  readonly path: string
  readonly handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
}

/**
 * A stub `ctx` exposing only what the route layer uses.
 *
 * The route layer names `ctx.webServer.register` and nothing else, so this is the
 * whole DSH surface it needs — which is itself the point of keeping the transport
 * in the adapter directory.
 */
function stubContext(registrations: Registration[]): Context {
  return {
    webServer: {
      register(route: Registration) {
        registrations.push(route)
        return () => {
          const at = registrations.indexOf(route)
          if (at >= 0) registrations.splice(at, 1)
        }
      },
    },
  } as unknown as Context
}

/** Dispatch a request the way the host router does: longest match wins, exact beats prefix. */
function dispatch(registrations: readonly Registration[], req: IncomingMessage, res: ServerResponse): void {
  const pathname = new URL(req.url ?? '/', 'http://localhost').pathname
  const exact = registrations.find((r) => r.kind === 'exact' && r.path === pathname)
  if (exact !== undefined) {
    void exact.handler(req, res)
    return
  }
  const prefix = registrations
    .filter((r) => r.kind === 'prefix' && (pathname === r.path || pathname.startsWith(`${r.path}/`)))
    .sort((a, b) => b.path.length - a.path.length)[0]
  if (prefix !== undefined) {
    void prefix.handler(req, res)
    return
  }
  res.writeHead(404)
  res.end('no route')
}

/** A running server plus the means to shut it down. */
interface Harness {
  readonly origin: string
  close(): Promise<void>
}

/**
 * Start a real HTTP server over the real route layer.
 * @param sessions - Session→directory map the service resolves against.
 * @returns The harness, already listening on a loopback port.
 */
async function startHarness(sessions: Readonly<Record<string, string>>): Promise<Harness> {
  const registrations: Registration[] = []
  const ctx = stubContext(registrations)
  const service = serviceFor(sessions)
  const watcher = createRepoWatcher(SILENT)
  const dispose = registerGitPanelRoutes(ctx, service, watcher, SILENT)

  const server: Server = createServer((req, res) => dispatch(registrations, req, res))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo

  return {
    origin: `http://127.0.0.1:${port}`,
    async close() {
      dispose()
      watcher.dispose()
      await new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      })
    },
  }
}

/** One parsed SSE frame. */
interface Frame {
  readonly event: string | undefined
  readonly data: string
}

/**
 * Read SSE frames from a response body until `stop` says so or the budget ends.
 * @param response - The streaming response.
 * @param stop - Predicate over the frames seen so far.
 * @param budgetMs - How long to wait before giving up.
 * @returns The frames received.
 */
async function readFrames(
  response: Response,
  stop: (frames: readonly Frame[]) => boolean,
  budgetMs: number,
): Promise<Frame[]> {
  const frames: Frame[] = []
  const reader = response.body?.getReader()
  if (reader === undefined) throw new Error('no response body')
  const decoder = new TextDecoder()
  let buffer = ''

  // Exactly one read may be outstanding. Racing a FRESH read against a timer on
  // every pass leaves the abandoned read registered on the stream, so the next
  // chunk is delivered to a promise nobody is awaiting and is silently lost —
  // which is how a `changed` frame can arrive yet never be seen.
  type Chunk = Awaited<ReturnType<typeof reader.read>>
  let pending: Promise<Chunk> = reader.read()

  const deadline = Date.now() + budgetMs
  while (Date.now() < deadline) {
    const winner = await Promise.race([
      pending.then((chunk) => ({ kind: 'chunk' as const, chunk })),
      new Promise<{ kind: 'tick' }>((resolve) => setTimeout(() => resolve({ kind: 'tick' }), 250)),
    ])

    if (winner.kind === 'tick') {
      // Nothing this pass; `pending` stays armed for the next one.
      if (stop(frames)) break
      continue
    }
    if (winner.chunk.done) break

    // Re-arm only once the previous read has been consumed.
    pending = reader.read()
    buffer += decoder.decode(winner.chunk.value, { stream: true })

    let split = buffer.indexOf('\n\n')
    while (split !== -1) {
      const raw = buffer.slice(0, split)
      buffer = buffer.slice(split + 2)
      let event: string | undefined
      let data = ''
      for (const line of raw.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim()
        else if (line.startsWith('data:')) data += line.slice(5).trim()
      }
      if (event !== undefined || data !== '') frames.push({ event, data })
      split = buffer.indexOf('\n\n')
    }
    if (stop(frames)) break
  }
  await reader.cancel().catch(() => undefined)
  return frames
}

describe('the /git-panel routes over a real socket', () => {
  it('serves status, branches, and log under the ok envelope', async () => {
    const repo = makeRepo('routes-ok')
    write(repo, 'a.txt', 'one\n')
    stageAll(repo)
    commit(repo, 'first')
    write(repo, 'a.txt', 'two\n')

    const harness = await startHarness({ s1: repo })
    try {
      const status = await fetch(`${harness.origin}/git-panel/status?session=s1`)
      assert.equal(status.status, 200)
      const statusBody = (await status.json()) as { ok: boolean; value: { groups: { unstaged: unknown[] } } }
      assert.equal(statusBody.ok, true)
      assert.equal(statusBody.value.groups.unstaged.length, 1)

      const branches = await fetch(`${harness.origin}/git-panel/branches?session=s1`)
      const branchBody = (await branches.json()) as { ok: boolean; value: unknown[] }
      assert.equal(branchBody.ok, true)
      assert.equal(branchBody.value.length, 1)

      const log = await fetch(`${harness.origin}/git-panel/log?session=s1&offset=0&limit=10`)
      const logBody = (await log.json()) as { ok: boolean; value: { commits: { subject: string }[] } }
      assert.equal(logBody.ok, true)
      assert.deepEqual(logBody.value.commits.map((c) => c.subject), ['first'])
    } finally {
      await harness.close()
    }
  })

  it('carries a failure as data, not as an HTTP error', async () => {
    // A non-repository is an ordinary state of the world; the panel renders it,
    // so it travels in the envelope rather than as a status code.
    const harness = await startHarness({ s1: makePlainDir('routes-norepo') })
    try {
      const response = await fetch(`${harness.origin}/git-panel/status?session=s1`)
      assert.equal(response.status, 200)
      const body = (await response.json()) as { ok: boolean; error: { code: string } }
      assert.equal(body.ok, false)
      assert.equal(body.error.code, 'not-a-repo')
    } finally {
      await harness.close()
    }
  })

  it('rejects a request with no session parameter', async () => {
    const harness = await startHarness({})
    try {
      const response = await fetch(`${harness.origin}/git-panel/status`)
      assert.equal(response.status, 400)
      const body = (await response.json()) as { ok: boolean; error: { code: string } }
      assert.equal(body.error.code, 'bad-request')
    } finally {
      await harness.close()
    }
  })

  it('answers an unknown operation with 404', async () => {
    const harness = await startHarness({})
    try {
      const response = await fetch(`${harness.origin}/git-panel/nope?session=s1`)
      assert.equal(response.status, 404)
    } finally {
      await harness.close()
    }
  })

  it('refuses a non-GET operation', async () => {
    const harness = await startHarness({})
    try {
      const response = await fetch(`${harness.origin}/git-panel/status?session=s1`, { method: 'POST' })
      assert.equal(response.status, 405)
    } finally {
      await harness.close()
    }
  })
})

describe('the mutation routes', () => {
  /** A repository with one commit and one unstaged change to `a.txt`. */
  function repoWithChange(prefix: string): string {
    const repo = makeRepo(prefix)
    write(repo, 'a.txt', 'one\n')
    stageAll(repo)
    commit(repo, 'first')
    write(repo, 'a.txt', 'two\n')
    return repo
  }

  /** POST one mutation, with this origin's own headers. */
  async function post(
    harness: Harness,
    path: string,
    body: unknown,
    headers: Record<string, string> = {},
  ): Promise<Response> {
    return await fetch(`${harness.origin}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: harness.origin, ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    })
  }

  it('stages over POST, and refuses the same operation over GET', async () => {
    const repo = repoWithChange('routes-stage')
    const harness = await startHarness({ s1: repo })
    try {
      const response = await post(harness, '/git-panel/stage', { session: 's1', paths: ['a.txt'] })
      assert.equal(response.status, 200)
      const body = (await response.json()) as { ok: boolean }
      assert.equal(body.ok, true)
      // The real index moved: the route is wired to the service, not to a stub.
      assert.deepEqual(git(repo, ['diff', '--cached', '--name-only']).trim(), 'a.txt')

      // A mutation reachable by GET would be reachable by an <img> tag.
      const viaGet = await fetch(`${harness.origin}/git-panel/stage?session=s1`)
      assert.equal(viaGet.status, 405)
    } finally {
      await harness.close()
    }
  })

  it('runs the widening commit only when the body asks for it', async () => {
    const repo = repoWithChange('routes-commit')
    const harness = await startHarness({ s1: repo })
    try {
      const staged = await post(harness, '/git-panel/commit', { session: 's1', message: 'plain' })
      const stagedBody = (await staged.json()) as { ok: boolean; error?: { code: string } }
      // Nothing is staged, and `all` was not set: the index really is empty.
      assert.equal(stagedBody.ok, false)
      assert.equal(stagedBody.error?.code, 'nothing-to-commit')

      const widened = await post(harness, '/git-panel/commit', {
        session: 's1',
        message: 'with add -u',
        all: true,
      })
      const widenedBody = (await widened.json()) as { ok: boolean; value?: { subject: string } }
      assert.equal(widenedBody.ok, true)
      assert.equal(widenedBody.value?.subject, 'with add -u')
      assert.equal(git(repo, ['show', 'HEAD:a.txt']), 'two\n')
    } finally {
      await harness.close()
    }
  })

  it('carries a validation failure as data, not as an HTTP error', async () => {
    const repo = repoWithChange('routes-validate')
    const harness = await startHarness({ s1: repo })
    try {
      // The body is well-formed JSON with an array of strings, so the route
      // accepts it; the path itself is what the pure validator refuses.
      const response = await post(harness, '/git-panel/stage', {
        session: 's1',
        paths: ['../escape.txt'],
      })
      assert.equal(response.status, 200)
      const body = (await response.json()) as { ok: boolean; error: { code: string } }
      assert.equal(body.ok, false)
      assert.equal(body.error.code, 'bad-request')
    } finally {
      await harness.close()
    }
  })

  it('refuses a mutation that claims another origin', async () => {
    const repo = repoWithChange('routes-csrf')
    const harness = await startHarness({ s1: repo })
    try {
      // A page on another site can make the browser send this request, but it
      // cannot make it claim this origin.
      const response = await post(
        harness,
        '/git-panel/stage',
        { session: 's1', paths: ['a.txt'] },
        { origin: 'http://evil.example' },
      )
      assert.equal(response.status, 403)
      // Nothing happened to the repository.
      assert.equal(git(repo, ['diff', '--cached', '--name-only']).trim(), '')
    } finally {
      await harness.close()
    }
  })

  it('refuses a malformed body, and a body with no session', async () => {
    const repo = repoWithChange('routes-body')
    const harness = await startHarness({ s1: repo })
    try {
      // Transport-level problems get an HTTP status: the body is not JSON at all,
      // or it is an array rather than an object, or there is nothing to act on.
      const notJson = await post(harness, '/git-panel/stage', '{oops')
      assert.equal(notJson.status, 400)
      assert.equal(((await notJson.json()) as { error: { code: string } }).error.code, 'bad-request')

      const arrayBody = await post(harness, '/git-panel/stage', '["a.txt"]')
      assert.equal(arrayBody.status, 400)

      const noSession = await post(harness, '/git-panel/stage', { paths: ['a.txt'] })
      assert.equal(noSession.status, 400)

      // A body that parses but names the wrong shapes is an operation failure,
      // and travels the way every other operation failure does — in the envelope,
      // under a 200 — so the panel has one code path for all of them.
      for (const body of [
        { session: 's1', paths: 'a.txt' },
        { session: 's1', paths: [7] },
        { session: 's1', message: 7 },
      ]) {
        const response = await post(harness, body.paths === undefined ? '/git-panel/commit' : '/git-panel/stage', body)
        assert.equal(response.status, 200, `expected an envelope for ${JSON.stringify(body)}`)
        assert.equal(((await response.json()) as { ok: boolean }).ok, false)
      }

      // Nothing was staged by any of the attempts.
      assert.equal(git(repo, ['diff', '--cached', '--name-only']).trim(), '')
    } finally {
      await harness.close()
    }
  })

  it('refuses a body past the size cap', async () => {
    const repo = repoWithChange('routes-toolarge')
    const harness = await startHarness({ s1: repo })
    try {
      // More than the 1 MiB cap, so the handler stops reading rather than
      // buffering whatever it is handed.
      const response = await post(harness, '/git-panel/stage', {
        session: 's1',
        paths: ['a.txt'],
        padding: 'x'.repeat(2 * 1024 * 1024),
      })
      assert.equal(response.status, 413)
      assert.equal(((await response.json()) as { error: { code: string } }).error.code, 'too-large')
    } finally {
      await harness.close()
    }
  })

  it('answers an unknown mutation with 404', async () => {
    const harness = await startHarness({})
    try {
      const response = await post(harness, '/git-panel/nope', { session: 's1' })
      assert.equal(response.status, 404)
    } finally {
      await harness.close()
    }
  })
})

describe('the loopback fence', () => {
  // The DSH frontend's authentication does not cover third-party webServer
  // routes, so the plugin refuses anything that did not arrive over loopback.
  it('refuses a request whose peer is not this machine', async () => {
    const repo = makeRepo('fence')
    write(repo, 'a.txt', 'one\n')
    stageAll(repo)
    commit(repo, 'first')

    const registrations: Registration[] = []
    const service = serviceFor({ s1: repo })
    const watcher = createRepoWatcher(SILENT)
    registerGitPanelRoutes(stubContext(registrations), service, watcher, SILENT)
    const routes = registrations as Registration[]
    const post = routes.find((route) => route.kind === 'prefix')
    assert.ok(post)

    /** Drive one handler with a chosen peer address. */
    const call = async (remoteAddress: string): Promise<{ status: number; body: string }> => {
      let status = 0
      let body = ''
      const res = {
        writeHead(code: number) {
          status = code
          return res
        },
        end(chunk?: string) {
          body = chunk ?? ''
          return res
        },
        on() {
          return res
        },
        writableEnded: false,
        destroyed: false,
        write() {
          return true
        },
      }
      const req = {
        method: 'GET',
        url: '/git-panel/status?session=s1',
        socket: { remoteAddress },
      }
      await post.handler(req as never, res as never)
      return { status, body }
    }

    // Every loopback spelling is accepted, including IPv4-mapped IPv6.
    for (const address of ['127.0.0.1', '::1', '::ffff:127.0.0.1', '127.0.0.9']) {
      const answer = await call(address)
      assert.equal(answer.status, 200, `expected ${address} to be allowed`)
      assert.match(answer.body, /"ok":true/)
    }

    // A real network peer is refused before any git work happens.
    for (const address of ['10.0.0.5', '192.168.1.20', '::ffff:10.0.0.5', '2001:db8::1']) {
      const answer = await call(address)
      assert.equal(answer.status, 403, `expected ${address} to be refused`)
      assert.match(answer.body, /loopback/)
    }

    watcher.dispose()
  })
})

describe('the change stream', () => {
  it('sends ready, then changed when the index moves', async () => {
    const repo = makeRepo('sse-changed')
    write(repo, 'a.txt', 'one\n')
    stageAll(repo)
    commit(repo, 'first')

    const harness = await startHarness({ s1: repo })
    try {
      const response = await fetch(`${harness.origin}/git-panel/events?session=s1`)
      assert.equal(response.status, 200)
      assert.equal(response.headers.get('content-type'), 'text/event-stream; charset=utf-8')

      // Stage a file once the stream is up: that rewrites .git/index, which is
      // exactly the signal FR-1.4 names. The guard lives here rather than inside
      // the predicate so the closure never touches a binding declared later.
      let staged = false
      const frames = await readFrames(
        response,
        (seen) => {
          if (seen.some((f) => f.event === 'ready') && !staged) {
            staged = true
            write(repo, 'b.txt', 'new\n')
            git(repo, ['add', 'b.txt'])
          }
          return seen.some((f) => f.event === 'changed')
        },
        6_000,
      )
      assert.ok(frames.some((f) => f.event === 'ready'), `expected a ready frame, got ${JSON.stringify(frames)}`)
      assert.ok(frames.some((f) => f.event === 'changed'), `expected a changed frame, got ${JSON.stringify(frames)}`)
    } finally {
      await harness.close()
    }
  })

  it('reports unavailable when the session is not in a repository', async () => {
    const harness = await startHarness({ s1: makePlainDir('sse-norepo') })
    try {
      const response = await fetch(`${harness.origin}/git-panel/events?session=s1`)
      const frames = await readFrames(response, (seen) => seen.some((f) => f.event === 'unavailable'), 4_000)
      const unavailable = frames.find((f) => f.event === 'unavailable')
      assert.ok(unavailable, `expected an unavailable frame, got ${JSON.stringify(frames)}`)
      assert.match(unavailable.data, /not-a-repo/)
    } finally {
      await harness.close()
    }
  })

  it('does NOT fire from the panel reading status', async () => {
    // The loop this guards against: with git's optional locks enabled, `status`
    // refreshes and rewrites .git/index, so the watcher would see a change caused
    // by the act of reading and the panel would refresh itself forever.
    const repo = makeRepo('sse-no-loop')
    write(repo, 'a.txt', 'one\n')
    stageAll(repo)
    commit(repo, 'first')

    const harness = await startHarness({ s1: repo })
    try {
      const response = await fetch(`${harness.origin}/git-panel/events?session=s1`)
      const service = serviceFor({ s1: repo })

      // Read status several times, then prove only `ready` ever arrived.
      for (let round = 0; round < 3; round++) {
        const result = await service.status('s1')
        assert.ok(result.ok)
      }

      const frames = await readFrames(response, (seen) => seen.some((f) => f.event === 'changed'), 2_500)
      assert.ok(frames.some((f) => f.event === 'ready'))
      assert.equal(
        frames.filter((f) => f.event === 'changed').length,
        0,
        `reading status must not announce a change: ${JSON.stringify(frames)}`,
      )
    } finally {
      await harness.close()
    }
  })
})
