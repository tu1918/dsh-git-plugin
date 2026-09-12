/**
 * The client's repo-change bus: the one thing panes listen to.
 *
 * The host's probe reports what moved; the panel turns each report into a
 * notification here, and every pane decides for itself whether that means
 * re-reading. This is the decoupling the panel wants in both directions:
 *
 * - A pane never learns where the notification came from (an SSE frame, a poll
 *   fallback, the panel's own commit) — only that the repository moved.
 * - A pane never receives a prop threaded down for the purpose. The diff pane
 *   and the history pane both used to take a `generation` number from the panel
 *   through the bottom pane; subscribing here means a pane added later does not
 *   touch that chain at all, and a pane whose subject did not move (the history,
 *   when a *file* changed) does not wake up.
 *
 * The counters are monotonic and never reset: a subscriber compares the value it
 * saw last with the value now, which is exactly the question "is my reading
 * stale?" — and it cannot be fooled by a change arriving while a read is in
 * flight.
 *
 * @module dsh-git-panel/client/ui/repo-change
 */

import { createContext, useContext, useMemo, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'

import type { GitChangeKind } from '../../core/ports.ts'

/** Everything a pane can subscribe to; `all` counts every kind. */
export type RepoChangeTopic = GitChangeKind | 'all'

/** What the panel publishes into, and panes subscribe to. */
export interface RepoChangeBus {
  /**
   * Report that the repository moved.
   * @param kinds - What moved, as the host described it.
   */
  publish(kinds: readonly GitChangeKind[]): void
  /** Subscribe to any publication. */
  subscribe(listener: () => void): () => void
  /** How many publications have touched `topic` so far. */
  count(topic: RepoChangeTopic): number
}

/**
 * Build a bus.
 *
 * A bus belongs to ONE panel: two sessions' panels watch two repositories, and
 * a change in one must not wake the other.
 * @returns The bus.
 */
export function createRepoChangeBus(): RepoChangeBus {
  const counters = new Map<RepoChangeTopic, number>()
  const listeners = new Set<() => void>()

  const count = (topic: RepoChangeTopic): number => counters.get(topic) ?? 0
  return {
    publish(kinds) {
      // A report with no kinds would be a notification about nothing; the
      // host never sends one, and treating it as "everything" would make a
      // quiet repository look busy.
      if (kinds.length === 0) return
      for (const topic of [...kinds, 'all'] as const) {
        counters.set(topic, count(topic) + 1)
      }
      for (const listener of [...listeners]) listener()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    count,
  }
}

const BusContext = createContext<RepoChangeBus | null>(null)

/**
 * Hand the bus to the panes below.
 * @param props - The bus and the subtree.
 */
export function RepoChangeProvider({
  bus,
  children,
}: {
  readonly bus: RepoChangeBus
  readonly children: ReactNode
}): ReactNode {
  return <BusContext.Provider value={bus}>{children}</BusContext.Provider>
}

/**
 * How many changes touching `topic` have been published since this pane mounted.
 *
 * A pane uses the returned number as an effect dependency: a value it has not
 * seen before means its reading is stale. Without a provider (a pane rendered on
 * its own in a test) this is a constant zero, which is the honest answer for "no
 * one is publishing".
 * @param topic - Which kind of change this pane cares about.
 * @returns The publication count for that topic.
 */
export function useRepoChange(topic: RepoChangeTopic = 'all'): number {
  const bus = useContext(BusContext)
  const subscribe = useMemo(
    () => (bus === null ? () => () => undefined : (listener: () => void) => bus.subscribe(listener)),
    [bus],
  )
  const snapshot = useMemo(
    () => (bus === null ? () => 0 : () => bus.count(topic)),
    [bus, topic],
  )
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}
