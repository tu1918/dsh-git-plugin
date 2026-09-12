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
import { createGitProbe } from '../src/host/git-probe.ts'
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

/** The same, with a chosen port — for the tests that drive FR-3.5's model call. */
function serviceWith(ports: HostPorts, sessions: Readonly<Record<string, string>>) {
  return createGitService(createGitRunner(), resolverFor(sessions), ports)
}

/** A repository with one commit, and the branch it started on. */
function repoWithBranch(prefix: string): { repo: string; base: string } {
  const repo = makeRepo(prefix)
  write(repo, 'a.txt', 'one\n')
  stageAll(repo)
  commit(repo, 'first')
  return { repo, base: currentBranch(repo) }
}

/**
 * A repository left in the middle of a conflicting merge of `side` into `base`.
 *
 * The conflict is real: `git merge` is what leaves the state the panel's merge
 * bar acts on, and a hand-written `MERGE_HEAD` would not prove FR-9.3 works.
 */
function repoInConflict(prefix: string): { repo: string; base: string } {
  const { repo, base } = repoWithBranch(prefix)
  git(repo, ['checkout', '-q', '-b', 'side'])
  write(repo, 'a.txt', 'side\n')
  stageAll(repo)
  commit(repo, 'side change')
  git(repo, ['checkout', '-q', base])
  write(repo, 'a.txt', 'base\n')
  stageAll(repo)
  commit(repo, 'base change')
  const merged = gitTry(repo, ['merge', 'side'])
  // git exits 1 on a conflicting merge; anything else means the fixture, not the
  // plugin, is wrong.
  if (merged.code !== 1) throw new Error(`expected a conflict, got ${merged.code}: ${merged.stderr}`)
  return { repo, base }
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

describe('git service diff (FR-2)', () => {
  it('diffs the working tree against the index', async () => {
    const repo = makeRepo('diff-worktree')
    write(repo, 'a.txt', 'one\ntwo\nthree\n')
    stageAll(repo)
    commit(repo, 'first')
    // A word appended rather than a line rewritten: a wholly replaced line has
    // no inner marks to find, which the parser tests cover separately.
    write(repo, 'a.txt', 'one\ntwo-x\nthree\n')

    const result = await serviceFor({ s1: repo }).diff('s1', 'a.txt', 'worktree', 3)
    assert.ok(result.ok, result.ok ? '' : JSON.stringify(result.error))
    assert.equal(result.value.area, 'worktree')
    assert.equal(result.value.binary, false)
    assert.equal(result.value.additions, 1)
    assert.equal(result.value.deletions, 1)

    const lines = result.value.hunks.flatMap((hunk) => hunk.lines)
    assert.deepEqual(
      lines.filter((line) => line.kind !== 'context').map((line) => line.text),
      ['two', 'two-x'],
    )
    // The markers come from VS Code's engine, and they are what FR-2.3 asks for.
    const added = lines.find((line) => line.kind === 'added')
    assert.deepEqual(added?.marks.map((mark) => added.text.slice(mark.start, mark.end)), ['-x'])
  })

  it('diffs the index against HEAD for a staged change', async () => {
    const repo = makeRepo('diff-index')
    write(repo, 'a.txt', 'one\n')
    stageAll(repo)
    commit(repo, 'first')
    write(repo, 'a.txt', 'two\n')
    git(repo, ['add', 'a.txt'])

    const service = serviceFor({ s1: repo })
    const staged = await service.diff('s1', 'a.txt', 'index', 3)
    assert.ok(staged.ok)
    assert.equal(staged.value.area, 'index')
    assert.deepEqual(
      staged.value.hunks[0]?.lines.filter((line) => line.kind !== 'context').map((line) => line.text),
      ['one', 'two'],
    )

    // The same path read as a worktree diff is empty: the change is in the index,
    // which is exactly the distinction FR-2.2 makes visible on the two rows.
    const worktree = await service.diff('s1', 'a.txt', 'worktree', 3)
    assert.ok(worktree.ok)
    assert.deepEqual(worktree.value.hunks, [])
  })

  it('renders an untracked file as one whole addition', async () => {
    const repo = makeRepo('diff-untracked')
    write(repo, 'tracked.txt', 'one\n')
    stageAll(repo)
    commit(repo, 'first')
    write(repo, 'fresh.txt', 'hello\nworld\n')

    const result = await serviceFor({ s1: repo }).diff('s1', 'fresh.txt', 'worktree', 3)
    assert.ok(result.ok, result.ok ? '' : JSON.stringify(result.error))
    assert.equal(result.value.additions, 2)
    assert.equal(result.value.deletions, 0)
    assert.deepEqual(
      result.value.hunks[0]?.lines.map((line) => line.text),
      ['hello', 'world'],
    )
  })

  it('renders a staged file in an unborn repository', async () => {
    // `--cached` without a HEAD is the empty tree, not an error — probed.
    const repo = makeRepo('diff-unborn')
    write(repo, 'a.txt', 'first line\n')
    stageAll(repo)

    const result = await serviceFor({ s1: repo }).diff('s1', 'a.txt', 'index', 3)
    assert.ok(result.ok, result.ok ? '' : JSON.stringify(result.error))
    assert.equal(result.value.additions, 1)
  })

  it('reports a binary file rather than its bytes', async () => {
    const repo = makeRepo('diff-binary')
    write(repo, 'img.bin', 'binary\0content\n')
    stageAll(repo)
    commit(repo, 'first')
    write(repo, 'img.bin', 'binary\0changed\n')

    const result = await serviceFor({ s1: repo }).diff('s1', 'img.bin', 'worktree', 3)
    assert.ok(result.ok, result.ok ? '' : JSON.stringify(result.error))
    assert.equal(result.value.binary, true)
    assert.deepEqual(result.value.hunks, [])
    assert.equal(result.value.lines, 0)
  })

  it('answers an empty diff for a path with no changes', async () => {
    const repo = makeRepo('diff-clean')
    write(repo, 'a.txt', 'one\n')
    stageAll(repo)
    commit(repo, 'first')

    const result = await serviceFor({ s1: repo }).diff('s1', 'a.txt', 'worktree', 3)
    assert.ok(result.ok)
    assert.deepEqual(result.value.hunks, [])
    assert.equal(result.value.additions, 0)
  })

  it('refuses a path or an area the panel would never send', async () => {
    const repo = makeRepo('diff-refuse')
    write(repo, 'a.txt', 'one\n')
    stageAll(repo)
    commit(repo, 'first')
    const service = serviceFor({ s1: repo })

    // §5.5: the browser never names an absolute path, so one is a refusal rather
    // than something to resolve.
    const absolute = await service.diff('s1', '/etc/passwd', 'worktree', 3)
    assert.equal(absolute.ok, false)
    assert.equal(absolute.ok ? '' : absolute.error.code, 'bad-request')

    const escaped = await service.diff('s1', '../outside.txt', 'worktree', 3)
    assert.equal(escaped.ok, false)
    assert.equal(escaped.ok ? '' : escaped.error.code, 'bad-request')

    const unknownArea = await service.diff('s1', 'a.txt', 'sideways' as 'worktree', 3)
    assert.equal(unknownArea.ok, false)
    assert.equal(unknownArea.ok ? '' : unknownArea.error.code, 'bad-request')
  })

  it('clamps the context it is asked for', async () => {
    const repo = makeRepo('diff-context')
    write(repo, 'a.txt', Array.from({ length: 40 }, (_, index) => `line ${index}`).join('\n') + '\n')
    stageAll(repo)
    commit(repo, 'first')
    write(repo, 'a.txt', Array.from({ length: 40 }, (_, index) => (index === 20 ? 'CHANGED' : `line ${index}`)).join('\n') + '\n')

    const service = serviceFor({ s1: repo })
    const tight = await service.diff('s1', 'a.txt', 'worktree', 0)
    const wide = await service.diff('s1', 'a.txt', 'worktree', 10)
    assert.ok(tight.ok && wide.ok)
    assert.equal(tight.value.lines, 2)
    assert.equal(wide.value.lines, 22)
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
 * @param ports - Diagnostic and model port; silent by default.
 * @returns The harness, already listening on a loopback port.
 */
async function startHarness(
  sessions: Readonly<Record<string, string>>,
  ports: HostPorts = SILENT,
): Promise<Harness> {
  const registrations: Registration[] = []
  const ctx = stubContext(registrations)
  const service = serviceWith(ports, sessions)
  const probe = createGitProbe(ports)
  const dispose = registerGitPanelRoutes(ctx, service, probe, ports)

  const server: Server = createServer((req, res) => dispatch(registrations, req, res))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo

  return {
    origin: `http://127.0.0.1:${port}`,
    async close() {
      dispose()
      probe.dispose()
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

  it('serves a file diff, and refuses the shapes it cannot serve', async () => {
    const repo = makeRepo('routes-diff')
    write(repo, 'a.txt', 'one\ntwo\n')
    stageAll(repo)
    commit(repo, 'first')
    write(repo, 'a.txt', 'one\ntwo-x\n')

    const harness = await startHarness({ s1: repo })
    try {
      const ok = await fetch(`${harness.origin}/git-panel/diff?session=s1&path=a.txt&area=worktree`)
      assert.equal(ok.status, 200)
      const body = (await ok.json()) as {
        ok: boolean
        value: { path: string; area: string; additions: number; hunks: { lines: unknown[] }[] }
      }
      assert.equal(body.ok, true)
      assert.equal(body.value.path, 'a.txt')
      assert.equal(body.value.area, 'worktree')
      assert.equal(body.value.additions, 1)
      assert.equal(body.value.hunks.length, 1)

      // The three refusals: no path and an area outside the union are failures
      // the panel renders, so — like every other operation's — they travel as a
      // 200 envelope. Asking for a read as a mutation is a transport rule, and
      // that one is an HTTP status.
      const noPath = await fetch(`${harness.origin}/git-panel/diff?session=s1&area=worktree`)
      assert.equal(noPath.status, 200)
      const noPathBody = (await noPath.json()) as { ok: boolean; error: { code: string } }
      assert.equal(noPathBody.ok, false)
      assert.equal(noPathBody.error.code, 'bad-request')

      const noArea = await fetch(`${harness.origin}/git-panel/diff?session=s1&path=a.txt&area=sideways`)
      const noAreaBody = (await noArea.json()) as { ok: boolean; error: { code: string } }
      assert.equal(noAreaBody.ok, false)
      assert.equal(noAreaBody.error.code, 'bad-request')

      const asPost = await fetch(`${harness.origin}/git-panel/diff?session=s1&path=a.txt&area=worktree`, {
        method: 'POST',
      })
      assert.equal(asPost.status, 405)
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

  it('discards over POST, and refuses the same operation over GET', async () => {
    const repo = repoWithChange('routes-discard')
    const harness = await startHarness({ s1: repo })
    try {
      const response = await post(harness, '/git-panel/discard', { session: 's1', paths: ['a.txt'] })
      assert.equal(response.status, 200)
      const body = (await response.json()) as { ok: boolean }
      assert.equal(body.ok, true)
      // The worktree really was put back: the route reaches git, not a stub.
      assert.equal(git(repo, ['diff', '--name-only']).trim(), '')

      // A mutation reachable by GET would be reachable by an <img> tag.
      const viaGet = await fetch(`${harness.origin}/git-panel/discard?session=s1`)
      assert.equal(viaGet.status, 405)
    } finally {
      await harness.close()
    }
  })

  it('undoes the newest commit over POST, and refuses the same operation over GET', async () => {
    const repo = makeRepo('routes-undo')
    write(repo, 'a.txt', 'one\n')
    stageAll(repo)
    commit(repo, 'first')
    const first = git(repo, ['rev-parse', 'HEAD']).trim()
    write(repo, 'a.txt', 'two\n')
    stageAll(repo)
    commit(repo, 'second')
    const second = git(repo, ['rev-parse', 'HEAD']).trim()

    const harness = await startHarness({ s1: repo })
    try {
      const response = await post(harness, '/git-panel/undoCommit', { session: 's1', hash: second })
      assert.equal(response.status, 200)
      const body = (await response.json()) as { ok: boolean; value: { mode: string; subject: string } }
      assert.equal(body.ok, true)
      assert.equal(body.value.mode, 'reset')
      assert.equal(body.value.subject, 'second')
      // The branch really moved back: the route reaches git, not a stub.
      assert.equal(git(repo, ['rev-parse', 'HEAD']).trim(), first)

      // A mutation reachable by GET would be reachable by an <img> tag.
      const viaGet = await fetch(`${harness.origin}/git-panel/undoCommit?session=s1`)
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
    const probe = createGitProbe(SILENT)
    registerGitPanelRoutes(stubContext(registrations), service, probe, SILENT)
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

    probe.dispose()
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
      // The frame carries WHAT moved, which is what lets a pane re-read only what
      // it shows: `git add` rewrites the index, and nothing here is a ref move.
      const changed = frames.find((frame) => frame.event === 'changed')
      const kinds: unknown = changed === undefined ? null : JSON.parse(changed.data).kinds
      assert.ok(Array.isArray(kinds), `expected kinds in the frame, got ${String(changed?.data)}`)
      assert.ok(kinds.includes('index'), `expected an index kind, got ${String(changed?.data)}`)
    } finally {
      await harness.close()
    }
  })

  it('reports a written file, which no git state file moves for', async () => {
    const repo = makeRepo('sse-worktree')
    write(repo, 'a.txt', 'one\n')
    stageAll(repo)
    commit(repo, 'first')

    const harness = await startHarness({ s1: repo })
    try {
      const response = await fetch(`${harness.origin}/git-panel/events?session=s1`)
      assert.equal(response.status, 200)

      // No `git add`, no `git commit`: just a file an agent wrote. Nothing inside
      // `.git` changes, which is why an mtime poll of `.git` never saw it — and
      // this is the report the panel needs to show the new untracked file.
      let wrote = false
      const frames = await readFrames(
        response,
        (seen) => {
          if (seen.some((f) => f.event === 'ready') && !wrote) {
            wrote = true
            write(repo, 'fresh.txt', 'written by the agent\n')
          }
          return seen.some((f) => f.event === 'changed')
        },
        6_000,
      )
      const changed = frames.find((frame) => frame.event === 'changed')
      assert.ok(changed !== undefined, `expected a changed frame, got ${JSON.stringify(frames)}`)
      const kinds = (JSON.parse(changed.data) as { kinds: readonly string[] }).kinds
      assert.ok(kinds.includes('worktree'), `expected a worktree kind, got ${changed.data}`)
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
    // refreshes and rewrites .git/index, so the probe would see a change caused
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

describe('branch management (FR-4)', () => {
  it('switches to an existing local branch', async () => {
    const { repo, base } = repoWithBranch('svc-checkout')
    git(repo, ['branch', 'feature-x'])
    const service = serviceFor({ s1: repo })

    const result = await service.checkout('s1', 'feature-x')
    assert.ok(result.ok, result.ok ? '' : JSON.stringify(result.error))
    assert.equal(currentBranch(repo), 'feature-x')
    // git's own line travels back, so the panel can show what it did.
    assert.match(result.value.detail, /feature-x/u)

    assert.ok((await service.checkout('s1', base)).ok)
    assert.equal(currentBranch(repo), base)
  })

  it('refuses a name that is not a local branch, rather than creating one', async () => {
    const { repo } = repoWithBranch('svc-checkout-missing')
    const service = serviceFor({ s1: repo })

    const result = await service.checkout('s1', 'nope')
    assert.equal(result.ok, false)
    assert.equal(result.ok ? '' : result.error.code, 'bad-request')
    // Nothing was created: `checkout <name>` would have DWIM-ed a new branch if
    // the existence check were not there.
    assert.equal(git(repo, ['branch', '--list', 'nope']).trim(), '')
  })

  it('refuses a malformed branch name before git is asked', async () => {
    const { repo, base } = repoWithBranch('svc-checkout-bad')
    const result = await serviceFor({ s1: repo }).checkout('s1', '../evil')
    assert.equal(result.ok, false)
    assert.equal(result.ok ? '' : result.error.code, 'bad-request')
    assert.equal(currentBranch(repo), base)
  })

  it('shows git’s own multi-line refusal when the working tree is in the way (FR-4.4)', async () => {
    const { repo, base } = repoWithBranch('svc-checkout-dirty')
    git(repo, ['checkout', '-q', '-b', 'other'])
    write(repo, 'a.txt', 'other\n')
    stageAll(repo)
    commit(repo, 'other changes a.txt')
    git(repo, ['checkout', '-q', base])

    // A local edit to the same file the other branch changes.
    write(repo, 'a.txt', 'local edit\n')

    const result = await serviceFor({ s1: repo }).checkout('s1', 'other')
    assert.equal(result.ok, false)
    // A code of its own, because the panel does something specific with it: this
    // is the refusal FR-4.4's "stash, then switch" belongs beside (D30).
    assert.equal(result.ok ? '' : result.error.code, 'dirty-worktree')
    // FR-4.4: the full output survives, not just its first line.
    assert.match(result.ok ? '' : (result.error.detail ?? ''), /would be overwritten/u)
    assert.equal(currentBranch(repo), base)
  })

  it('creates a branch from HEAD and switches to it', async () => {
    const { repo } = repoWithBranch('svc-create')
    const result = await serviceFor({ s1: repo }).createBranch('s1', 'feature/new', null)
    assert.ok(result.ok, result.ok ? '' : JSON.stringify(result.error))
    assert.equal(currentBranch(repo), 'feature/new')
  })

  it('creates a branch from a named base and from a hash', async () => {
    const { repo } = repoWithBranch('svc-create-base')
    const first = git(repo, ['rev-parse', 'HEAD']).trim()
    write(repo, 'a.txt', 'two\n')
    stageAll(repo)
    commit(repo, 'second')
    const head = git(repo, ['rev-parse', 'HEAD']).trim()
    // An anchor branch parked on the older commit, so "from a named base" is
    // genuinely a different start point from HEAD.
    git(repo, ['branch', 'anchor', first])

    const fromBase = await serviceFor({ s1: repo }).createBranch('s1', 'from-branch', 'anchor')
    assert.ok(fromBase.ok, fromBase.ok ? '' : JSON.stringify(fromBase.error))
    // The branch really starts where it was asked to, not at HEAD.
    assert.equal(git(repo, ['rev-parse', 'HEAD']).trim(), first)

    const fromHash = await serviceFor({ s1: repo }).createBranch('s1', 'from-hash', head.slice(0, 8))
    assert.ok(fromHash.ok, fromHash.ok ? '' : JSON.stringify(fromHash.error))
    assert.equal(git(repo, ['rev-parse', 'HEAD']).trim(), head)
  })

  it('refuses a duplicate name, a bad base, and a bad name', async () => {
    const { repo, base } = repoWithBranch('svc-create-bad')
    const service = serviceFor({ s1: repo })

    const duplicate = await service.createBranch('s1', base, null)
    assert.equal(duplicate.ok ? '' : duplicate.error.code, 'bad-request')

    const badBase = await service.createBranch('s1', 'ok-name', 'HEAD~1')
    assert.equal(badBase.ok ? '' : badBase.error.code, 'bad-request')
    assert.equal(git(repo, ['branch', '--list', 'ok-name']).trim(), '')

    const badName = await service.createBranch('s1', 'bad name', null)
    assert.equal(badName.ok ? '' : badName.error.code, 'bad-request')
  })

  it('deletes a merged branch, and refuses the one that is checked out', async () => {
    const { repo, base } = repoWithBranch('svc-delete')
    git(repo, ['branch', 'merged'])
    const service = serviceFor({ s1: repo })

    const deleted = await service.deleteBranch('s1', 'merged', false)
    assert.ok(deleted.ok, deleted.ok ? '' : JSON.stringify(deleted.error))
    assert.equal(git(repo, ['branch', '--list', 'merged']).trim(), '')

    const current = await service.deleteBranch('s1', base, false)
    assert.equal(current.ok ? '' : current.error.code, 'bad-request')
    assert.equal(currentBranch(repo), base)
  })

  it('refuses an unmerged branch with not-merged, then deletes it when forced (FR-4.3)', async () => {
    const { repo, base } = repoWithBranch('svc-delete-unmerged')
    const service = serviceFor({ s1: repo })
    // A branch whose commit is reachable from nothing else.
    assert.ok((await service.createBranch('s1', 'wip', null)).ok)
    write(repo, 'wip.txt', 'work in progress\n')
    stageAll(repo)
    commit(repo, 'unmerged work')
    assert.ok((await service.checkout('s1', base)).ok)

    const refused = await service.deleteBranch('s1', 'wip', false)
    assert.equal(refused.ok, false)
    // The code is what arms the picker's forced click; prose alone could not.
    assert.equal(refused.ok ? '' : refused.error.code, 'not-merged')
    assert.notEqual(git(repo, ['branch', '--list', 'wip']).trim(), '')

    const forced = await service.deleteBranch('s1', 'wip', true)
    assert.ok(forced.ok, forced.ok ? '' : JSON.stringify(forced.error))
    assert.equal(git(repo, ['branch', '--list', 'wip']).trim(), '')
  })

  it('shows the extended state a merge leaves behind', async () => {
    const { repo } = repoInConflict('svc-status-merging')
    const result = await serviceFor({ s1: repo }).status('s1')
    assert.ok(result.ok)
    assert.equal(result.value.merging, true)
    assert.deepEqual(result.value.groups.conflicted.map((e) => e.path), ['a.txt'])
  })

  it('reports merging = false on an ordinary repository', async () => {
    const { repo } = repoWithBranch('svc-status-not-merging')
    const result = await serviceFor({ s1: repo }).status('s1')
    assert.ok(result.ok)
    assert.equal(result.value.merging, false)
  })
})

describe('the merge state (FR-9.3)', () => {
  it('concludes the merge once every conflict is resolved', async () => {
    const { repo } = repoInConflict('svc-merge-continue')
    const service = serviceFor({ s1: repo })

    // git refuses to commit while unmerged paths remain, and the panel's button
    // is disabled in that state; the service says so rather than lying.
    const tooEarly = await service.continueMerge('s1')
    assert.equal(tooEarly.ok, false)

    assert.ok((await service.stage('s1', ['a.txt'])).ok)
    const concluded = await service.continueMerge('s1')
    assert.ok(concluded.ok, concluded.ok ? '' : JSON.stringify(concluded.error))

    const after = await service.status('s1')
    assert.ok(after.ok)
    assert.equal(after.value.merging, false)
    // git's own MERGE_MSG is what the commit carries; the panel invented nothing.
    assert.match(git(repo, ['log', '-1', '--format=%s']).trim(), /^Merge/u)
  })

  it('abandons the merge and restores the pre-merge working tree', async () => {
    const { repo } = repoInConflict('svc-merge-abort')
    const service = serviceFor({ s1: repo })

    const aborted = await service.abortMerge('s1')
    assert.ok(aborted.ok, aborted.ok ? '' : JSON.stringify(aborted.error))
    const after = await service.status('s1')
    assert.ok(after.ok)
    assert.equal(after.value.merging, false)
    assert.deepEqual(after.value.groups.conflicted, [])
    assert.equal(git(repo, ['show', 'HEAD:a.txt']), 'base\n')
  })

  it('refuses both actions when no merge is in progress', async () => {
    const { repo } = repoWithBranch('svc-merge-none')
    const service = serviceFor({ s1: repo })
    for (const result of [await service.continueMerge('s1'), await service.abortMerge('s1')]) {
      assert.equal(result.ok, false)
      assert.equal(result.ok ? '' : result.error.code, 'bad-request')
    }
  })
})

describe('git service showCommit (FR-3.6)', () => {
  it('reports the commit and its per-file churn', async () => {
    const repo = makeRepo('svc-show')
    write(repo, 'a.txt', 'one\n')
    write(repo, 'bin.dat', '\u0000\u0001binary\n')
    stageAll(repo)
    commit(repo, 'first')
    write(repo, 'a.txt', 'one\ntwo\nthree\n')
    write(repo, 'bin.dat', '\u0000\u0001changed\n')
    stageAll(repo)
    commit(repo, 'second')

    const head = git(repo, ['rev-parse', 'HEAD']).trim()
    const result = await serviceFor({ s1: repo }).showCommit('s1', head)
    assert.ok(result.ok, result.ok ? '' : JSON.stringify(result.error))
    assert.equal(result.value.commit.subject, 'second')
    assert.equal(result.value.commit.oid, head)
    const byPath = new Map(result.value.files.map((file) => [file.path, file]))
    assert.deepEqual(byPath.get('a.txt'), {
      path: 'a.txt',
      additions: 2,
      deletions: 0,
      binary: false,
    })
    // git declined to count the binary file, so it is reported as binary rather
    // than as a change of zero lines.
    assert.equal(byPath.get('bin.dat')?.binary, true)
    assert.equal(byPath.get('bin.dat')?.additions, null)
  })

  it('lists a merge against its first parent, which `git show` alone would not', async () => {
    const { repo } = repoInConflict('svc-show-merge')
    const service = serviceFor({ s1: repo })
    assert.ok((await service.stage('s1', ['a.txt'])).ok)
    assert.ok((await service.continueMerge('s1')).ok)

    const head = git(repo, ['rev-parse', 'HEAD']).trim()
    const result = await service.showCommit('s1', head)
    assert.ok(result.ok, result.ok ? '' : JSON.stringify(result.error))
    assert.equal(result.value.commit.parents.length, 2)
    assert.deepEqual(result.value.files.map((file) => file.path), ['a.txt'])
  })

  it('refuses a hash that is not one, and an unknown revision', async () => {
    const { repo } = repoWithBranch('svc-show-bad')
    const service = serviceFor({ s1: repo })

    for (const hash of ['HEAD~1', 'main', 'zzz', 'abc']) {
      const result = await service.showCommit('s1', hash)
      assert.equal(result.ok, false, `expected ${hash} to be refused`)
      assert.equal(result.ok ? '' : result.error.code, 'bad-request')
    }

    const unknown = await service.showCommit('s1', 'deadbeef')
    assert.equal(unknown.ok, false)
    assert.equal(unknown.ok ? '' : unknown.error.code, 'git-failed')
  })
})

describe('git service generateCommitMessage (FR-3.5)', () => {
  /** A port that records what it was asked and answers with a chosen reply. */
  function recordingPorts(reply: () => Promise<Result<string>>): {
    ports: HostPorts
    prompts: string[]
  } {
    const prompts: string[] = []
    return {
      prompts,
      ports: {
        log: () => undefined,
        generateText: (prompt) => {
          prompts.push(prompt)
          return reply()
        },
      },
    }
  }

  it('asks the model about the staged diff and cleans the answer', async () => {
    const { repo } = repoWithBranch('svc-ai')
    write(repo, 'a.txt', 'one\ntwo\n')
    git(repo, ['add', 'a.txt'])
    const { ports, prompts } = recordingPorts(() =>
      Promise.resolve({ ok: true, value: '```\nfeat: from the model\n```' }),
    )

    const result = await serviceWith(ports, { s1: repo }).generateCommitMessage('s1', 'zh-CN')
    assert.ok(result.ok, result.ok ? '' : JSON.stringify(result.error))
    assert.equal(result.value.message, 'feat: from the model')
    assert.equal(result.value.truncated, false)
    assert.equal(prompts.length, 1)
    assert.match(prompts[0] ?? '', /Staged diff/u)
    assert.match(prompts[0] ?? '', /\+two/u)
    // The panel's language decides the message's language.
    assert.match(prompts[0] ?? '', /Simplified Chinese/u)
  })

  it('refuses when nothing is staged, without spending a model call', async () => {
    const { repo } = repoWithBranch('svc-ai-empty')
    write(repo, 'a.txt', 'unstaged only\n')
    const { ports, prompts } = recordingPorts(() =>
      Promise.resolve({ ok: true, value: 'should not be used' }),
    )

    const result = await serviceWith(ports, { s1: repo }).generateCommitMessage('s1', 'en')
    assert.equal(result.ok, false)
    assert.equal(result.ok ? '' : result.error.code, 'bad-request')
    assert.equal(prompts.length, 0)
  })

  it('passes a deployment without a model through as no-llm', async () => {
    const { repo } = repoWithBranch('svc-ai-none')
    write(repo, 'a.txt', 'staged\n')
    git(repo, ['add', 'a.txt'])
    const { ports } = recordingPorts(() =>
      Promise.resolve({
        ok: false,
        error: { code: 'no-llm', message: 'this deployment has no language model configured' },
      }),
    )

    const result = await serviceWith(ports, { s1: repo }).generateCommitMessage('s1', 'en')
    assert.equal(result.ok, false)
    assert.equal(result.ok ? '' : result.error.code, 'no-llm')
  })

  it('cuts the diff at the prompt budget and says that it did (§8.3)', async () => {
    const { repo } = repoWithBranch('svc-ai-big')
    // A staged diff far past the budget: the model must not receive all of it.
    write(repo, 'big.txt', `${Array.from({ length: 2000 }, (_, i) => `line ${i}`).join('\n')}\n`)
    git(repo, ['add', 'big.txt'])
    const { ports, prompts } = recordingPorts(() =>
      Promise.resolve({ ok: true, value: 'chore: add a big file' }),
    )

    const result = await serviceWith(ports, { s1: repo }).generateCommitMessage('s1', 'en')
    assert.ok(result.ok, result.ok ? '' : JSON.stringify(result.error))
    assert.equal(result.value.truncated, true)
    assert.match(prompts[0] ?? '', /truncated before you saw it/u)
  })

  it('reports an answer that cleans to nothing rather than filling the box', async () => {
    const { repo } = repoWithBranch('svc-ai-blank')
    write(repo, 'a.txt', 'staged\n')
    git(repo, ['add', 'a.txt'])
    const { ports } = recordingPorts(() => Promise.resolve({ ok: true, value: '```\n```' }))

    const result = await serviceWith(ports, { s1: repo }).generateCommitMessage('s1', 'en')
    assert.equal(result.ok, false)
    assert.equal(result.ok ? '' : result.error.code, 'internal')
  })
})

describe('the M4 mutation routes', () => {
  /** POST one mutation, with this origin's own headers. */
  async function post(
    harness: Harness,
    path: string,
    body: unknown,
  ): Promise<{ ok: boolean; error?: { code: string }; value?: unknown }> {
    const response = await fetch(`${harness.origin}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: harness.origin },
      body: JSON.stringify(body),
    })
    return (await response.json()) as { ok: boolean; error?: { code: string }; value?: unknown }
  }

  it('creates, switches to, and deletes a branch over the wire', async () => {
    const { repo, base } = repoWithBranch('routes-branch')
    const harness = await startHarness({ s1: repo })
    try {
      const created = await post(harness, '/git-panel/createBranch', {
        session: 's1',
        name: 'from-route',
        base: null,
      })
      assert.equal(created.ok, true, JSON.stringify(created.error))
      assert.equal(currentBranch(repo), 'from-route')

      // Deleting the branch you are on is refused; the rail's own action has to
      // leave first, which is what a user does too.
      const onIt = await post(harness, '/git-panel/deleteBranch', {
        session: 's1',
        name: 'from-route',
      })
      assert.equal(onIt.ok, false)
      assert.equal(onIt.error?.code, 'bad-request')

      const switched = await post(harness, '/git-panel/checkout', { session: 's1', name: base })
      assert.equal(switched.ok, true, JSON.stringify(switched.error))
      const deleted = await post(harness, '/git-panel/deleteBranch', {
        session: 's1',
        name: 'from-route',
      })
      assert.equal(deleted.ok, true, JSON.stringify(deleted.error))
      assert.equal(git(repo, ['branch', '--list', 'from-route']).trim(), '')
    } finally {
      await harness.close()
    }
  })

  it('answers a missing name as the operation-failure envelope, not as a 4xx', async () => {
    const { repo } = repoWithBranch('routes-branch-shape')
    const harness = await startHarness({ s1: repo })
    try {
      // The same convention every other mutation follows (see the plan's D10):
      // the request WAS an operation, so it answers 200 with `ok: false`.
      const response = await fetch(`${harness.origin}/git-panel/deleteBranch`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: harness.origin },
        body: JSON.stringify({ session: 's1' }),
      })
      assert.equal(response.status, 200)
      const body = (await response.json()) as { ok: boolean; error?: { code: string } }
      assert.equal(body.ok, false)
      assert.equal(body.error?.code, 'bad-request')

      const wrongType = await post(harness, '/git-panel/createBranch', {
        session: 's1',
        name: 'x',
        base: 7,
      })
      assert.equal(wrongType.ok, false)
      assert.equal(wrongType.error?.code, 'bad-request')
    } finally {
      await harness.close()
    }
  })

  it('reads a commit detail over GET and refuses a request without a hash', async () => {
    const { repo } = repoWithBranch('routes-show')
    const harness = await startHarness({ s1: repo })
    try {
      const missing = await fetch(`${harness.origin}/git-panel/showCommit?session=s1`)
      // Same convention as the diff route's missing `path`: the request did
      // become an operation, so its failure rides in the envelope on a 200.
      assert.equal(missing.status, 200)
      const missingBody = (await missing.json()) as { ok: boolean; error?: { code: string } }
      assert.equal(missingBody.ok, false)
      assert.equal(missingBody.error?.code, 'bad-request')
      assert.match(missingBody.error === undefined ? '' : JSON.stringify(missingBody.error), /hash/u)

      const head = git(repo, ['rev-parse', 'HEAD']).trim()
      const found = await fetch(`${harness.origin}/git-panel/showCommit?session=s1&hash=${head}`)
      assert.equal(found.status, 200)
      const body = (await found.json()) as { ok: boolean; value?: { files: unknown[] } }
      assert.equal(body.ok, true)
      assert.deepEqual(
        body.value?.files.map((file) => (file as { path: string }).path),
        ['a.txt'],
      )
    } finally {
      await harness.close()
    }
  })

  it('generates a message over POST, and refuses the same over GET', async () => {
    const { repo } = repoWithBranch('routes-ai')
    write(repo, 'a.txt', 'staged for the model\n')
    git(repo, ['add', 'a.txt'])
    const prompts: string[] = []
    const harness = await startHarness({ s1: repo }, {
      log: () => undefined,
      generateText: (prompt) => {
        prompts.push(prompt)
        return Promise.resolve({ ok: true, value: 'feat: generated over the wire' })
      },
    })
    try {
      const generated = await post(harness, '/git-panel/generateCommitMessage', {
        session: 's1',
        locale: 'en',
      })
      assert.equal(generated.ok, true, JSON.stringify(generated.error))
      assert.deepEqual(generated.value, {
        message: 'feat: generated over the wire',
        truncated: false,
      })
      assert.equal(prompts.length, 1)

      // Spending the deployment's model budget must not be reachable by a link.
      const viaGet = await fetch(`${harness.origin}/git-panel/generateCommitMessage?session=s1`)
      assert.equal(viaGet.status, 405)
    } finally {
      await harness.close()
    }
  })
})

describe('the stash routes (FR-6.2)', () => {
  /** POST one mutation and decode the envelope. */
  async function post(
    harness: Harness,
    path: string,
    body: unknown,
  ): Promise<{ ok: boolean; error?: { code: string }; value?: unknown }> {
    const response = await fetch(`${harness.origin}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: harness.origin },
      body: JSON.stringify(body),
    })
    return (await response.json()) as { ok: boolean; error?: { code: string }; value?: unknown }
  }

  it('reads the stack over GET, and refuses a POST to it', async () => {
    const repo = makeRepo('routes-stash-list')
    write(repo, 'a.txt', 'one\n')
    stageAll(repo)
    commit(repo, 'first')

    const harness = await startHarness({ s1: repo })
    try {
      write(repo, 'a.txt', 'two\n')
      git(repo, ['stash', 'push', '-q', '-m', 'over the wire'])

      const response = await fetch(`${harness.origin}/git-panel/stashes?session=s1`)
      assert.equal(response.status, 200)
      const body = (await response.json()) as {
        ok: boolean
        value?: readonly { selector: string; subject: string }[]
      }
      assert.equal(body.ok, true)
      assert.equal(body.value?.length, 1)
      assert.equal(body.value?.[0]?.selector, 'stash@{0}')
      assert.match(body.value?.[0]?.subject ?? '', /over the wire/u)

      // A read answered over POST would be a mutation's shape with a read's
      // effect; the two sets stay disjoint by method.
      const viaPost = await fetch(`${harness.origin}/git-panel/stashes`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: harness.origin },
        body: JSON.stringify({ session: 's1' }),
      })
      assert.equal(viaPost.status, 405)
    } finally {
      await harness.close()
    }
  })

  it('saves, applies and drops over POST, and refuses each over GET', async () => {
    const repo = makeRepo('routes-stash-write')
    write(repo, 'a.txt', 'one\n')
    stageAll(repo)
    commit(repo, 'first')
    write(repo, 'a.txt', 'two\n')

    const harness = await startHarness({ s1: repo })
    try {
      const saved = await post(harness, '/git-panel/stashSave', {
        session: 's1',
        message: 'from the route',
        untracked: false,
      })
      assert.equal(saved.ok, true, JSON.stringify(saved.error))
      // The route reaches git, not a stub: the worktree is clean and the stack
      // holds the edit under the label that came over the wire. (The branch name
      // in git's own subject is the fixture's, so only the label is asserted.)
      assert.match(git(repo, ['stash', 'list', '--format=%s']), /from the route/u)

      const listed = (await (
        await fetch(`${harness.origin}/git-panel/stashes?session=s1`)
      ).json()) as { value?: readonly { oid: string }[] }
      const oid = listed.value?.[0]?.oid ?? ''
      assert.equal(oid.length, 40)

      const applied = await post(harness, '/git-panel/stashApply', { session: 's1', oid, pop: true })
      assert.equal(applied.ok, true, JSON.stringify(applied.error))
      assert.equal(gitTry(repo, ['stash', 'list']).stdout.trim(), '', 'pop dropped the entry')

      // Dropping the now-empty stack is a refusal the caller can read, not a
      // crash: the row the browser sent is stale.
      const dropped = await post(harness, '/git-panel/stashDrop', { session: 's1', oid })
      assert.equal(dropped.ok, false)
      assert.equal(dropped.error?.code, 'bad-request')

      // Every stash mutation is a POST; a GET would make it reachable by a link.
      for (const path of ['/git-panel/stashSave', '/git-panel/stashApply', '/git-panel/stashDrop']) {
        const viaGet = await fetch(`${harness.origin}${path}?session=s1`)
        assert.equal(viaGet.status, 405, `${path} must not answer GET`)
      }

      // A missing id is the operation-failure envelope, the same convention
      // every other mutation follows (D10).
      const missing = await post(harness, '/git-panel/stashDrop', { session: 's1' })
      assert.equal(missing.ok, false)
      assert.equal(missing.error?.code, 'bad-request')
    } finally {
      await harness.close()
    }
  })
})
