/**
 * The change watcher: how the panel learns that the repository moved without
 * being asked (§5.3, FR-1.4).
 *
 * The doc's requirement is that an agent's `git` work shows up in the panel
 * within a second, and its FR-1.4 names the mechanism — the mtime of
 * `.git/index` and `.git/HEAD`. That is a poll, not a filesystem watch, and the
 * choice is deliberate: `fs.watch` on those two paths is unreliable across
 * network and synchronised drives (§8.2), while two `stat` calls per second cost
 * almost nothing and cannot miss an update the way a dropped watch event can.
 *
 * A poller only runs while something is subscribed, so a panel nobody is looking
 * at costs no work at all. That is the host half of FR-1.4's "面板可见时轮询,
 * 不可见时停止": the browser stops holding the stream open, this stops polling.
 *
 * @module dsh-git-panel/host/watcher
 */

import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { HostPorts } from '../core/ports.ts'
import { gitDirOf } from './git-dir.ts'

/** How often the watched files are re-stat-ed while a subscriber exists. */
const POLL_INTERVAL_MS = 1_000

/** One subscriber's callback. */
export type ChangeListener = () => void

/** The watcher's outward face. */
export interface RepoWatcher {
  /**
   * Watch one repository root for change.
   *
   * Resolves only once the baseline has been read, so a caller that announces
   * readiness after awaiting this method has genuinely missed nothing: a change
   * made after the await is reported, and nothing before it can be silently
   * absorbed into the baseline. That ordering is the whole contract, and getting
   * it wrong looks exactly like a watcher that never fires.
   * @param root - Absolute repository root.
   * @param listener - Called when the repository's state files moved.
   * @returns Unsubscribe callback; the poller stops when the last one leaves.
   */
  watch(root: string, listener: ChangeListener): Promise<() => void>
  /** Stop every poller; the plugin is unloading. */
  dispose(): void
}

/** One root's subscribers and the last state its files reported. */
interface WatchEntry {
  readonly listeners: Set<ChangeListener>
  /** Last observed `(mtimeMs, size)` per watched file, keyed by absolute path. */
  readonly stamps: Map<string, string>
  /** False until the first poll, so a first observation is never a "change". */
  primed: boolean
  /** True while a poll is in flight, so the priming pass and the timer cannot overlap. */
  polling: boolean
  /**
   * The baseline-establishing poll, kept so a second subscriber waits for the
   * SAME baseline instead of racing a fresh one of its own.
   */
  priming: Promise<void> | null
}

/**
 * Build the watcher.
 * @param ports - Diagnostic port.
 * @returns The watcher the route layer subscribes through.
 */
export function createRepoWatcher(ports: HostPorts): RepoWatcher {
  const entries = new Map<string, WatchEntry>()
  const timers = new Map<string, NodeJS.Timeout>()

  /** One poll: stat the root's state files and notify when anything moved. */
  async function poll(root: string): Promise<void> {
    const entry = entries.get(root)
    if (entry === undefined) return
    // Two concurrent passes would interleave their stamp updates and could
    // report the same change twice, or miss one entirely.
    if (entry.polling) return
    entry.polling = true
    try {
      await pollOnce(root, entry)
    } finally {
      entry.polling = false
    }
  }

  /** The body of one poll, with the in-flight guard already held. */
  async function pollOnce(root: string, entry: WatchEntry): Promise<void> {
    const dir = await gitDirOf(root)
    const watched = ['HEAD', 'index', 'packed-refs', 'MERGE_HEAD', 'rebase-merge', 'rebase-apply']
    const next = new Map<string, string>()
    for (const name of watched) {
      const path = join(dir, name)
      try {
        const info = await stat(path)
        next.set(path, `${info.mtimeMs}:${info.size}`)
      } catch {
        // An absent file is a state of its own: MERGE_HEAD disappearing IS the
        // merge finishing, so absence is recorded rather than skipped.
        next.set(path, 'absent')
      }
    }

    const changed =
      entry.primed &&
      (next.size !== entry.stamps.size ||
        [...next].some(([path, stamp]) => entry.stamps.get(path) !== stamp))

    entry.stamps.clear()
    for (const [path, stamp] of next) entry.stamps.set(path, stamp)

    const first = !entry.primed
    entry.primed = true
    if (first || !changed) return

    // Copy before iterating: a listener may unsubscribe itself while being
    // notified, which would mutate the set mid-iteration.
    for (const listener of [...entry.listeners]) {
      try {
        listener()
      } catch (error) {
        // One broken stream must not stop the poller for the others.
        ports.log('warn', `change listener threw: ${String(error)}`)
      }
    }
  }

  /** Start the shared poller for one root. */
  function startTimer(root: string): void {
    if (timers.has(root)) return
    const timer = setInterval(() => {
      void poll(root).catch((error: unknown) => {
        ports.log('warn', `watch poll failed for ${root}: ${String(error)}`)
      })
    }, POLL_INTERVAL_MS)
    // The poller must never be the reason the host process stays alive.
    timer.unref()
    timers.set(root, timer)
  }

  /** Stop and forget one root's poller. */
  function stopTimer(root: string): void {
    const timer = timers.get(root)
    if (timer !== undefined) {
      clearInterval(timer)
      timers.delete(root)
    }
  }

  return {
    async watch(root, listener) {
      let entry = entries.get(root)
      if (entry === undefined) {
        entry = {
          listeners: new Set(),
          stamps: new Map(),
          primed: false,
          polling: false,
          priming: null,
        }
        entries.set(root, entry)
        // Prime now, and await it below. Priming is what makes a first
        // observation a baseline rather than a change, so it has to be complete
        // before the caller is told it is being watched.
        entry.priming = poll(root)
      }
      entry.listeners.add(listener)
      await entry.priming
      startTimer(root)

      let released = false
      return () => {
        if (released) return
        released = true
        const current = entries.get(root)
        if (current === undefined) return
        current.listeners.delete(listener)
        if (current.listeners.size === 0) {
          entries.delete(root)
          stopTimer(root)
        }
      }
    },

    dispose() {
      for (const root of [...timers.keys()]) stopTimer(root)
      entries.clear()
    },
  }
}
