/**
 * The git state probe: how the panel hears that a repository moved.
 *
 * This module knows about a path and about `git`'s own state files. It knows
 * nothing about sessions, HTTP, SSE, or the panel — it takes a repository root,
 * calls back with {@link GitChange}, and can be swapped or optimised without a
 * single line changing on either side of it. That boundary is the point: the
 * transport (routes.ts) and the UI (the client's own change bus) both consume
 * events, and neither is wired to *how* the events were noticed.
 *
 * ## Why git cannot answer this question itself
 *
 * There is no `git watch`. `git fsmonitor--daemon` — git's own filesystem
 * monitor — is macOS/Windows only (on Linux it answers `not supported on this
 * platform`), and the `core.fsmonitor` hook needs an external daemon. The hooks
 * that do fire on state changes (`post-index-change`, `reference-transaction`)
 * would have to be installed as executables into the user's `.git/hooks`, and
 * they only cover git's own commands, never a file written by an editor. So
 * what is left is what git writes: `index`, `HEAD`, `logs/HEAD` (appended on
 * every ref move — a commit, a checkout, a reset), `refs/**`, `FETCH_HEAD`,
 * `MERGE_HEAD`, the rebase directories. Watching those *is* the probe.
 *
 * ## Two ways of noticing, in order
 *
 * 1. **Filesystem events** (`fs.watch`, i.e. inotify on Linux): one recursive
 *    watch on the work tree, plus one on the git directory when it lives
 *    somewhere else (a linked worktree, a submodule). Nothing is polled, so an
 *    idle panel costs nothing; a change is reported in tens of milliseconds.
 * 2. **Polling the same state files** — the fallback, and only the fallback.
 *    Filesystem events are unreliable on synchronised and network drives, and
 *    `recursive` watch can simply be unavailable or out of watch descriptors; a
 *    probe that goes quiet in those places is worse than one that costs a `stat`
 *    per second. This strategy also re-states a `worktree` change every few
 *    seconds, because no `.git` file moves when an editor writes a file.
 *
 * The strategies are a list, tried in order, with a failure at any time moving
 * to the next one. A future probe (watchman, a git fsmonitor hook, a platform
 * API) is another entry in that list and nothing else.
 *
 * @module dsh-git-panel/host/git-probe
 */

import { watch as watchFileSystem, type FSWatcher } from 'node:fs'
import { stat } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'

import type { GitChange, GitChangeKind, HostPorts } from '../core/ports.ts'
import { gitDirOf } from './git-dir.ts'

/** Every kind, for the cases where the probe genuinely cannot tell. */
const ALL_KINDS: readonly GitChangeKind[] = ['refs', 'index', 'worktree']

/** How long a burst of events is collected before one report is made. */
const COALESCE_MS = 80

/** Git directory entries that mean "a ref moved" — the `refs` kind. */
const REF_FILES = new Set([
  'HEAD',
  'ORIG_HEAD',
  'FETCH_HEAD',
  'MERGE_HEAD',
  'packed-refs',
  'CHERRY_PICK_HEAD',
  'REVERT_HEAD',
  'BISECT_LOG',
])

/** Git directory *directories* that mean "a ref moved". */
const REF_DIRS = new Set(['refs', 'logs', 'rebase-merge', 'rebase-apply'])

/**
 * Classify one entry name *inside a git directory*.
 *
 * Anything unrecognised is `index` rather than nothing: `objects/`, `config`,
 * `hooks/` — a change there is git state the panel cannot name, and a status
 * re-read is the cheap, always-correct answer. Naming it `refs` instead would
 * re-read the commit log on every `git add` (each of which writes a blob).
 * @param parts - The path split on separators, relative to the git directory.
 * @returns The kinds this entry's movement stands for.
 */
export function kindsInGitDir(parts: readonly string[]): readonly GitChangeKind[] {
  const name = parts[0]
  if (name === undefined) return ALL_KINDS
  if (name === 'index' || name.startsWith('index.')) return ['index']
  if (REF_FILES.has(name) || REF_DIRS.has(name)) return ['refs']
  return ['index']
}

/**
 * Classify one path reported for a work tree root.
 * @param path - A path relative to the work tree, in either separator style.
 * @returns The kinds this path's movement stands for.
 */
export function kindsInWorkTree(path: string | null): readonly GitChangeKind[] {
  // A recursive watcher on Linux sometimes reports a bare directory event with
  // no name; the honest answer is "cannot tell", not "nothing happened".
  if (path === null) return ALL_KINDS
  const parts = path.split(/[\\/]+/u).filter((part) => part !== '')
  if (parts[0] !== '.git') return ['worktree']
  return kindsInGitDir(parts.slice(1))
}

/** What a strategy is handed so it can hand control back. */
export interface ProbeStrategyContext {
  /**
   * Report that this strategy can no longer see changes.
   *
   * The probe stops it and moves to the next strategy in the list. Called at
   * most once per `start`.
   * @param reason - What went wrong, for the log.
   */
  readonly unavailable: (reason: unknown) => void
}

/**
 * One way of noticing that a repository moved.
 *
 * Implementations must not poll unless polling is what they are: `start`
 * resolves once the strategy is *live*, meaning a change made after the resolve
 * is reported.
 */
export interface ProbeStrategy {
  /** Named for the diagnostic log. */
  readonly name: string
  /**
   * Begin watching one repository root.
   * @param root - Absolute work tree root.
   * @param emit - Report the kinds that moved.
   * @param ctx - How to give up and let the next strategy take over.
   * @returns Stop callback; must be safe to call twice.
   */
  start(
    root: string,
    emit: (kinds: readonly GitChangeKind[]) => void,
    ctx: ProbeStrategyContext,
  ): Promise<() => void>
}

/** One subscriber's callback. */
export type GitChangeListener = (change: GitChange) => void

/** The probe's outward face: the only thing the transport sees. */
export interface GitProbe {
  /**
   * Probe one repository root for change.
   *
   * Resolves once the probe is live, so a caller that announces readiness after
   * awaiting this method has missed nothing: a change made after the await is
   * reported. Getting that ordering wrong looks exactly like a probe that never
   * fires.
   * @param root - Absolute repository root.
   * @param listener - Called when the repository moved.
   * @returns Unsubscribe callback; the probe stops when the last one leaves.
   */
  watch(root: string, listener: GitChangeListener): Promise<() => void>
  /** Stop every probe; the plugin is unloading. */
  dispose(): void
}

/** Knobs the tests (and only the tests) turn. */
export interface GitProbeOptions {
  /** Detection strategies, tried in order. Defaults to events, then polling. */
  readonly strategies?: readonly ProbeStrategy[]
  /** Burst window before one report is made. */
  readonly coalesceMs?: number
}

/** One root's subscribers, its live strategy, and the report being collected. */
interface ProbeEntry {
  readonly listeners: Set<GitChangeListener>
  stop: (() => void) | null
  /** The in-flight strategy start, awaited by later subscribers. */
  starting: Promise<void> | null
  /** Kinds collected inside the current burst window. */
  pending: Set<GitChangeKind>
  timer: NodeJS.Timeout | null
  disposed: boolean
}

/**
 * Build the probe over a list of strategies.
 * @param ports - Diagnostic port.
 * @param options - Strategy list and burst window.
 * @returns The probe the route layer subscribes through.
 */
export function createGitProbe(ports: HostPorts, options: GitProbeOptions = {}): GitProbe {
  const strategies = options.strategies ?? [fileSystemStrategy(ports), pollStrategy(ports)]
  const coalesceMs = options.coalesceMs ?? COALESCE_MS
  const entries = new Map<string, ProbeEntry>()

  /** One report per burst window, to every listener of that root. */
  function schedule(root: string, entry: ProbeEntry): void {
    if (entry.timer !== null) return
    entry.timer = setTimeout(() => {
      entry.timer = null
      const kinds = [...entry.pending]
      entry.pending.clear()
      if (kinds.length === 0) return
      // Copy before iterating: a listener may unsubscribe while being notified.
      for (const listener of [...entry.listeners]) {
        try {
          listener({ kinds })
        } catch (error) {
          ports.log('warn', `change listener threw: ${String(error)}`)
        }
      }
    }, coalesceMs)
    // The probe must never be the reason the host process stays alive.
    entry.timer.unref()
  }

  /** Collect one strategy report into the current burst. */
  function collect(root: string, entry: ProbeEntry, kinds: readonly GitChangeKind[]): void {
    if (entry.disposed) return
    for (const kind of kinds) entry.pending.add(kind)
    schedule(root, entry)
  }

  /**
   * Start the first strategy that works, moving down the list on failure —
   * whether the failure is at start or arrives later as an `unavailable`.
   */
  async function startFrom(root: string, entry: ProbeEntry, index: number): Promise<void> {
    const strategy = strategies[index]
    if (strategy === undefined || entry.disposed) {
      if (strategy === undefined) {
        ports.log('warn', `no probe strategy could watch ${root}; changes will not be reported`)
      }
      return
    }
    let handedOver = false
    const handOver = (reason: unknown): void => {
      if (handedOver || entry.disposed) return
      handedOver = true
      ports.log('warn', `probe strategy ${strategy.name} stopped for ${root}: ${String(reason)}`)
      entry.stop?.()
      entry.stop = null
      entry.starting = startFrom(root, entry, index + 1)
    }
    try {
      const stop = await strategy.start(
        root,
        (kinds) => collect(root, entry, kinds),
        { unavailable: handOver },
      )
      if (handedOver || entry.disposed) {
        stop()
        return
      }
      entry.stop = stop
      ports.log('info', `probing ${root} with ${strategy.name}`)
    } catch (error) {
      handOver(error)
    }
  }

  /** Stop one root's strategy and forget it entirely. */
  function stopEntry(root: string, entry: ProbeEntry): void {
    entry.disposed = true
    if (entry.timer !== null) {
      clearTimeout(entry.timer)
      entry.timer = null
    }
    entry.stop?.()
    entry.stop = null
    entry.listeners.clear()
    entries.delete(root)
  }

  return {
    async watch(root, listener) {
      let entry = entries.get(root)
      if (entry === undefined) {
        entry = { listeners: new Set(), stop: null, starting: null, pending: new Set(), timer: null, disposed: false }
        entries.set(root, entry)
        entry.starting = startFrom(root, entry, 0)
      }
      entry.listeners.add(listener)
      // "Watching" means the strategy is live, not merely requested: the caller
      // is told it may announce readiness only after this resolves.
      await entry.starting

      let released = false
      return () => {
        if (released) return
        released = true
        const current = entries.get(root)
        if (current === undefined) return
        current.listeners.delete(listener)
        if (current.listeners.size === 0) stopEntry(root, current)
      }
    },

    dispose() {
      for (const [root, entry] of [...entries]) stopEntry(root, entry)
      entries.clear()
    },
  }
}

/** Whether `path` is inside `parent` (or is it). */
function isInside(parent: string, path: string): boolean {
  const rel = relative(parent, path)
  return rel === '' || (!rel.startsWith('..') && !rel.startsWith(`..${sep}`))
}

/**
 * The preferred strategy: filesystem events, no timers.
 *
 * Two watches, because a repository's state can live outside its work tree: the
 * root (recursive) sees every working-tree write plus `.git` when it is a plain
 * directory, and the git directory is watched separately when that is not true
 * (a linked worktree or a submodule keeps `HEAD` and the index elsewhere).
 * @param ports - Diagnostic port, for the log line when events are unavailable.
 * @returns The strategy.
 */
export function fileSystemStrategy(ports: HostPorts): ProbeStrategy {
  return {
    name: 'filesystem-events',
    async start(root, emit, ctx) {
      const gitDir = await gitDirOf(root)
      const watchers: FSWatcher[] = []
     /** Attach one recursive watcher, reporting through a given classifier. */
      const attach = (path: string, classify: (name: string | null) => readonly GitChangeKind[]): void => {
        const watcher = watchFileSystem(path, { recursive: true, persistent: false }, (_event, filename) => {
          emit(classify(typeof filename === 'string' ? filename : null))
        })
        watcher.on('error', (error) => {
          // A watch can die long after it started (descriptors exhausted, a
          // mount that went away). Handing over is the whole reason the
          // fallback exists.
          ctx.unavailable(error)
        })
        watchers.push(watcher)
      }

      attach(root, kindsInWorkTree)
      // A `.git` directory inside the root is already covered by the recursive
      // watch; a git directory somewhere else is not.
      if (!isInside(root, gitDir)) {
        attach(gitDir, (name) =>
          name === null ? ALL_KINDS : kindsInGitDir(name.split(/[\\/]+/u).filter((part) => part !== '')),
        )
      }
      ports.log('info', `watching ${root} with filesystem events (git dir ${gitDir})`)

      let stopped = false
      return () => {
        if (stopped) return
        stopped = true
        for (const watcher of watchers) watcher.close()
      }
    },
  }
}

/** The `stat` targets the polling strategy compares, with what each one means. */
const POLLED_FILES: readonly (readonly [string, GitChangeKind])[] = [
  ['index', 'index'],
  ['HEAD', 'refs'],
  ['packed-refs', 'refs'],
  ['logs/HEAD', 'refs'],
  ['refs/heads', 'refs'],
  ['refs/remotes', 'refs'],
  ['FETCH_HEAD', 'refs'],
  ['MERGE_HEAD', 'refs'],
  ['ORIG_HEAD', 'refs'],
  ['rebase-merge', 'refs'],
  ['rebase-apply', 'refs'],
]

/**
 * The fallback strategy: poll the state files.
 *
 * This is what the probe used to be, kept for the places filesystem events do
 * not reach — a synchronised or network drive, a platform without recursive
 * watch, an out-of-descriptors error. It also re-states a `worktree` change on
 * its own slower cadence, because a file written by an editor moves no `.git`
 * file at all: without that, a new untracked file would never appear.
 * @param ports - Diagnostic port.
 * @param options - Cadences, for tests.
 * @returns The strategy.
 */
export function pollStrategy(
  ports: HostPorts,
  options: { stateMs?: number; worktreeMs?: number } = {},
): ProbeStrategy {
  const stateMs = options.stateMs ?? 1_000
  const worktreeMs = options.worktreeMs ?? 10_000
  return {
    name: 'state-file-poll',
    async start(root, emit, ctx) {
      const dir = await gitDirOf(root)
      const stamps = new Map<string, string>()
      let primed = false
      let lastWorktree = Date.now()

      /** One pass: re-stat everything and report what moved. */
      const pass = async (): Promise<void> => {
        const moved = new Set<GitChangeKind>()
        for (const [name, kind] of POLLED_FILES) {
          const path = join(dir, name)
          let stamp: string
          try {
            const info = await stat(path)
            stamp = `${info.mtimeMs}:${info.size}`
          } catch {
            // An absent file is a state of its own: MERGE_HEAD disappearing IS
            // the merge finishing.
            stamp = 'absent'
          }
          if (stamps.get(path) !== stamp && primed) moved.add(kind)
          stamps.set(path, stamp)
        }
        primed = true
        if (Date.now() - lastWorktree >= worktreeMs) {
          lastWorktree = Date.now()
          moved.add('worktree')
        }
        if (moved.size > 0) emit([...moved])
      }

      // Establish the baseline before claiming to be live: a caller told
      // "watching" must not be able to make a change this absorbs silently.
      await pass()
      const timer = setInterval(() => {
        void pass().catch((error: unknown) => {
          // A poll that throws (a mount that went away) is not a reason to stop
          // reporting forever, but the next strategy cannot do better either.
          ports.log('warn', `poll for ${root} failed: ${String(error)}`)
        })
      }, stateMs)
      timer.unref()

      let stopped = false
      return () => {
        if (stopped) return
        stopped = true
        clearInterval(timer)
      }
    },
  }
}
