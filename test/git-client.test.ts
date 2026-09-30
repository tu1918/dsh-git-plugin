/**
 * The browser transport's own tests: its deadlines, and the difference between
 * a closed tab and a host that never answered.
 *
 * `fetch` is stubbed rather than driven over a socket, because the case under
 * test is exactly one a real server cannot produce on demand: a request that
 * never comes back. The adapter's contract is that this becomes an ordinary
 * `timeout` result within a bounded time — the F-1 spinner was this case with
 * no bound at all.
 *
 * @module dsh-git-panel/test/git-client
 */

import { JSDOM } from 'jsdom'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

// The transport reads `window.location.origin` and uses `window.setTimeout`, so
// a document must exist before it is called. jsdom is installed on the globals
// for the same reason the panel tests install it: the module under test reaches
// for `window` directly.
const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://127.0.0.1:3080/',
})
Object.defineProperty(globalThis, 'window', {
  value: dom.window,
  writable: true,
  configurable: true,
})

const { createGitRemoteClient } = await import('../src/client/adapter/git-client.ts')

/** A `fetch` that never answers, rejecting only when its signal aborts. */
function hangingFetch(): (url: URL, init: RequestInit) => Promise<Response> {
  return (_url, init) =>
    new Promise<Response>((_resolve, reject) => {
      const fail = (): void => reject(new DOMException('The operation was aborted.', 'AbortError'))
      if (init.signal?.aborted === true) fail()
      else init.signal?.addEventListener('abort', fail)
    })
}

/**
 * A `fetch` that answers `body` after `delayMs`, unless it is aborted first.
 *
 * The abort half is not decoration: a real `fetch` rejects when its signal
 * aborts, and a stand-in that answered anyway would let the deadline pass
 * unnoticed — which is precisely the behaviour this file exists to pin.
 */
function slowFetch(
  body: unknown,
  delayMs: number,
): (url: URL, init: RequestInit) => Promise<Response> {
  return (_url, init) =>
    new Promise<Response>((resolve, reject) => {
      const timer = setTimeout(() => {
        resolve(
          new Response(JSON.stringify(body), {
            headers: { 'content-type': 'application/json' },
          }),
        )
      }, delayMs)
      init.signal?.addEventListener('abort', () => {
        clearTimeout(timer)
        reject(new DOMException('The operation was aborted.', 'AbortError'))
      })
    })
}

/** Install a stand-in `fetch` for one test; call the result to put it back. */
function stubFetch(
  handler: (url: URL, init: RequestInit) => Promise<Response>,
): () => void {
  const original = globalThis.fetch
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
    handler(new URL(String(input)), init ?? {})) as typeof fetch
  return () => {
    globalThis.fetch = original
  }
}

describe('the browser git client', () => {
  it('stops a request the host never answers, and calls it a timeout', async () => {
    const restore = stubFetch(hangingFetch())
    try {
      const client = createGitRemoteClient({ requestMs: 25 })
      const started = Date.now()
      const result = await client.status('s1')
      assert.deepEqual(result, {
        ok: false,
        error: { code: 'timeout', message: 'the host did not answer in time' },
      })
      assert.ok(Date.now() - started < 2_000, 'the deadline, not the test runner, ended the wait')
    } finally {
      restore()
    }
  })

  it('does not report a closed tab as a timeout', async () => {
    // The tab's signal is the caller cancelling, which is not a failure to show;
    // the deadline is the host failing to answer, which is. The same abort path
    // must tell them apart.
    const restore = stubFetch(hangingFetch())
    try {
      const client = createGitRemoteClient({ requestMs: 10_000 })
      const closed = new AbortController()
      closed.abort()
      const result = await client.status('s1', closed.signal)
      assert.equal(result.ok, false)
      assert.equal(result.error.code, 'internal')
      assert.match(result.error.message, /cancelled/)
    } finally {
      restore()
    }
  })

  it('gives a rewrite the long deadline, and an ordinary read the short one', async () => {
    // The host gives `rewrite` and `generateCommitMessage` a 120s bound because
    // both legitimately take about a minute; this client must not cut them short
    // one layer above that.
    const restore = stubFetch(
      slowFetch({ ok: true, value: { summary: 'rewritten', detail: '' } }, 60),
    )
    try {
      const client = createGitRemoteClient({ requestMs: 20, longRequestMs: 2_000 })
      const rewritten = await client.rewriteCommit('s1', 'a'.repeat(40), 'drop')
      assert.equal(rewritten.ok, true, 'the long deadline applies to a rewrite')

      const read = await client.status('s1')
      assert.equal(read.ok, false, 'the ordinary deadline still applies to a read')
      assert.equal(read.error.code, 'timeout')
    } finally {
      restore()
    }
  })
})
