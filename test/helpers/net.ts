/**
 * Waiting for a listener to be reachable, for the harnesses that serve over a
 * real socket.
 *
 * `listen`'s callback fires when the socket is bound, and on most machines the
 * very next connection reaches it. On this machine — WSL2 with mirrored
 * networking — the first connection to a freshly bound port can still be refused
 * for a few milliseconds while the loopback path settles, which would show up as
 * `ECONNREFUSED` in whichever test happened to connect first and as a green
 * suite everywhere else. Waiting once through here keeps that race of the
 * platform from being read as a failure of the plugin.
 *
 * @module dsh-git-panel/test/helpers/net
 */

import net from 'node:net'

/** How long to keep retrying before giving the connection error up. */
const READY_TIMEOUT_MS = 2_000

/** How long to wait between attempts. */
const RETRY_INTERVAL_MS = 20

/**
 * Connect once, retrying until the listener accepts or the deadline passes.
 * @param port - The port to reach.
 * @param host - The address the server is bound to; loopback by default.
 * @returns When a connection has been accepted.
 * @throws The last connection error, when the listener never answers.
 */
export async function waitForListener(port: number, host = '127.0.0.1'): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS
  for (;;) {
    try {
      await new Promise<void>((resolve, reject) => {
        const socket = net.connect({ port, host })
        socket.once('connect', () => {
          // Dropped at once: this connection is a readiness probe, not a
          // request, and the harnesses close what is left over anyway.
          socket.destroy()
          resolve()
        })
        socket.once('error', reject)
      })
      return
    } catch (error) {
      if (Date.now() >= deadline) throw error
      await new Promise((resolve) => setTimeout(resolve, RETRY_INTERVAL_MS))
    }
  }
}
