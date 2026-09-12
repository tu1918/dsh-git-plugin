/**
 * Host mount test: `apply()` from the plugin entry, all the way to the wire.
 *
 * This is the closest thing to a real mount that can run without a DSH process.
 * The host half is written so that the entry point can be called with a stand-in
 * context and then driven with real HTTP requests against a real repository:
 * almost every DSH name it uses is a type, erased at build time.
 *
 * The exception is `host/adapter/llm.ts` (M4), which imports the harness's own
 * `BlockAssembler` and `createUserMessage` as VALUES — so the host bundle now
 * carries one runtime `@deepseek-ai/*` import (`@deepseek-ai/dsh-llm`, declared
 * as a peer dependency) instead of only Node builtins and `vscode-diff`. The
 * stand-in context below simply answers `get('llm')` with `undefined`, which is
 * the composition this file is about: the panel must mount without a model.
 *
 * What it proves: the assembly registers both routes, resolves a session through
 * the context's session store, serves a real status over the socket, and removes
 * its routes when the effect is disposed.
 *
 * @module dsh-git-panel/test/host-mount
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Context } from '@deepseek-ai/cordis'
import { after, describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { apply, inject } from '../src/host/index.ts'
import { cleanupRepos, commit, makeRepo, stageAll, write } from './helpers/repo.ts'

after(cleanupRepos)

/** One route registration captured from the stand-in context. */
interface Registration {
  readonly kind: 'exact' | 'prefix'
  readonly path: string
  readonly handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
}

/** A context carrying only the services the host half actually uses. */
function stubContext(sessions: Record<string, string>) {
  const registrations: Registration[] = []
  const lines: string[] = []
  const disposers: (() => void)[] = []

  const ctx = {
    logger: () => ({
      info: (message: string) => lines.push(`info ${message}`),
      warn: (message: string) => lines.push(`warn ${message}`),
      error: (message: string) => lines.push(`error ${message}`),
    }),
    sessions: {
      get: (id: string) => {
        const cwd = sessions[id]
        return cwd === undefined ? undefined : { header: { cwd } }
      },
    },
    workspaceRegistry: { list: () => [] },
    get: (name: string) => (name === 'workspaceRegistry' ? { list: () => [] } : undefined),
    webServer: {
      register(route: Registration) {
        registrations.push(route)
        return () => {
          const at = registrations.indexOf(route)
          if (at >= 0) registrations.splice(at, 1)
        }
      },
    },
    effect(run: () => unknown) {
      const dispose = run()
      if (typeof dispose === 'function') disposers.push(dispose as () => void)
      return () => undefined
    },
  }

  return { ctx: ctx as unknown as Context, registrations, lines, disposers }
}

/** Dispatch the way the host router does: exact first, then longest prefix. */
function dispatch(
  registrations: readonly Registration[],
  req: IncomingMessage,
  res: ServerResponse,
): void {
  const pathname = new URL(req.url ?? '/', 'http://localhost').pathname
  const exact = registrations.find((route) => route.kind === 'exact' && route.path === pathname)
  const hit =
    exact ??
    registrations
      .filter(
        (route) =>
          route.kind === 'prefix' &&
          (pathname === route.path || pathname.startsWith(`${route.path}/`)),
      )
      .sort((left, right) => right.path.length - left.path.length)[0]
  if (hit === undefined) {
    res.writeHead(404)
    res.end('no route')
    return
  }
  void hit.handler(req, res)
}

/** Serve the captured registrations over a real socket. */
async function serve(registrations: readonly Registration[]): Promise<{
  origin: string
  close: () => Promise<void>
}> {
  const server: Server = createServer((req, res) => dispatch(registrations, req, res))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    origin: `http://127.0.0.1:${port}`,
    close: async () => {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}

describe('the host plugin entry', () => {
  it('declares the services it needs', () => {
    assert.deepEqual([...inject].sort(), ['sessions', 'webServer'])
  })

  it('mounts in a composition with no language model, and says so on request', async () => {
    const repo = makeRepo('mount-no-llm')
    write(repo, 'a.txt', 'one\n')
    stageAll(repo)
    commit(repo, 'first')
    write(repo, 'a.txt', 'two\n')
    // Staged, so the request reaches the model step: with an empty index the
    // service refuses earlier, and for a different reason.
    stageAll(repo)

    const { ctx, registrations } = stubContext({ 'session-1': repo })
    apply(ctx)
    const server = await serve(registrations)
    try {
      // FR-3.5 is the only feature that needs a model, and `llm` is deliberately
      // NOT in `inject`: the panel mounts without one, and the single button that
      // cannot work explains itself instead of the panel failing to load.
      const response = await fetch(`${server.origin}/git-panel/generateCommitMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: server.origin },
        body: JSON.stringify({ session: 'session-1', locale: 'en' }),
      })
      assert.equal(response.status, 200)
      const body = (await response.json()) as { ok: boolean; error?: { code: string } }
      assert.equal(body.ok, false)
      assert.equal(body.error?.code, 'no-llm')

      // The rest of the panel is unaffected.
      const status = await fetch(`${server.origin}/git-panel/status?session=session-1`)
      assert.equal(status.status, 200)
      assert.equal(((await status.json()) as { ok: boolean }).ok, true)
    } finally {
      await server.close()
    }
  })

  it('registers the two routes and serves a real status through them', async () => {
    const repo = makeRepo('mount')
    write(repo, 'a.txt', 'one\n')
    stageAll(repo)
    commit(repo, 'first')
    write(repo, 'a.txt', 'two\n')

    const { ctx, registrations, lines } = stubContext({ 'session-1': repo })
    apply(ctx)

    assert.deepEqual(
      registrations.map((route) => `${route.kind} ${route.path}`).sort(),
      ['exact /git-panel/events', 'prefix /git-panel'],
    )
    assert.ok(
      lines.some((line) => line.includes('git panel host ready')),
      `expected a readiness line, got ${JSON.stringify(lines)}`,
    )

    const harness = await serve(registrations)
    try {
      const response = await fetch(`${harness.origin}/git-panel/status?session=session-1`)
      const body = (await response.json()) as {
        ok: boolean
        value: { branch: { name: string }; groups: { unstaged: { path: string }[] } }
      }
      assert.equal(body.ok, true)
      assert.equal(body.value.groups.unstaged[0]?.path, 'a.txt')
      assert.equal(typeof body.value.branch.name, 'string')

      const log = await fetch(`${harness.origin}/git-panel/log?session=session-1&limit=5`)
      const logBody = (await log.json()) as { ok: boolean; value: { commits: { subject: string }[] } }
      assert.deepEqual(logBody.value.commits.map((entry) => entry.subject), ['first'])
    } finally {
      await harness.close()
    }
  })

  it('answers no-session when the context has no such session', async () => {
    const { ctx, registrations } = stubContext({})
    apply(ctx)
    const harness = await serve(registrations)
    try {
      const response = await fetch(`${harness.origin}/git-panel/status?session=missing`)
      const body = (await response.json()) as { ok: boolean; error: { code: string } }
      assert.equal(body.ok, false)
      assert.equal(body.error.code, 'no-session')
    } finally {
      await harness.close()
    }
  })

  it('refuses an empty path list over the wire, which is the shape the panel once sent', async () => {
    // The panel's "unstage all" on an empty staged drawer posted `paths: []`, and
    // this is what it got back: `bad-request` — whose copy tells the user to
    // reopen a perfectly healthy panel. The client no longer sends it, and this
    // pins the host half of the contract: an empty list is refused before git is
    // asked to `reset` nothing.
    //
    // Note the status. This adapter answers 200 for a *domain* failure — the
    // envelope's `ok: false` is the answer, and the browser's one error path reads
    // it there — and reserves 4xx for a request the transport itself could not
    // accept. Both halves are asserted below, because collapsing them would hide
    // which layer said no.
    const repo = makeRepo('empty-paths')
    write(repo, 'a.txt', 'one\n')
    const { ctx, registrations } = stubContext({ 'session-1': repo })
    apply(ctx)
    const harness = await serve(registrations)
    try {
      for (const operation of ['stage', 'unstage']) {
        const response = await fetch(`${harness.origin}/git-panel/${operation}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', origin: harness.origin },
          body: JSON.stringify({ session: 'session-1', paths: [] }),
        })
        const body = (await response.json()) as {
          ok: boolean
          error: { code: string; message: string }
        }
        assert.equal(response.status, 200, `${operation}: a domain failure rides the envelope`)
        assert.equal(body.ok, false)
        assert.equal(body.error.code, 'bad-request')
        assert.equal(body.error.message, 'at least one path is required')
      }

      // A body the transport cannot accept is the other half. `paths` that is not
      // an array of strings is refused by the route rather than the service — but
      // it is still an *operation* failure, so it also rides the envelope at 200.
      // The status is 400 only for a request that never became an operation at all
      // (no session, an unreadable body, a body that is not an object).
      const malformed = await fetch(`${harness.origin}/git-panel/stage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: harness.origin },
        body: JSON.stringify({ session: 'session-1', paths: 'a.txt' }),
      })
      assert.equal(malformed.status, 200)
      const malformedBody = (await malformed.json()) as {
        ok: boolean
        error: { code: string; message: string }
      }
      assert.equal(malformedBody.error.code, 'bad-request')
      assert.equal(malformedBody.error.message, 'paths must be an array of strings')

      const noSession = await fetch(`${harness.origin}/git-panel/stage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: harness.origin },
        body: JSON.stringify({ paths: ['a.txt'] }),
      })
      assert.equal(noSession.status, 400, 'no operation can be named without a session')
      assert.equal(
        ((await noSession.json()) as { error: { message: string } }).error.message,
        'the session is required',
      )

      // Nothing moved: the file is still untracked, not staged by a no-op.
      const status = await fetch(`${harness.origin}/git-panel/status?session=session-1`)
      const statusBody = (await status.json()) as {
        value: { groups: { staged: { path: string }[]; untracked: { path: string }[] } }
      }
      assert.deepEqual(statusBody.value.groups.staged, [])
      assert.deepEqual(statusBody.value.groups.untracked.map((entry) => entry.path), ['a.txt'])
    } finally {
      await harness.close()
    }
  })

  it('unregisters both routes when its effect is disposed', () => {
    const { ctx, registrations, disposers } = stubContext({})
    apply(ctx)
    assert.equal(registrations.length, 2)
    assert.equal(disposers.length, 1, 'the plugin must own exactly one effect')

    // Disposal is what an unload or a config reload performs; leaving a route
    // behind would keep serving a service nobody owns.
    for (const dispose of disposers) dispose()
    assert.deepEqual(registrations, [])
  })
})
