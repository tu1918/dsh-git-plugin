/**
 * Finding the repositories a session's directory holds (FR-8).
 *
 * A session's directory is usually one repository, but it can also be a
 * container — a folder of separate clones, which is what a multi-repository
 * workspace is. The rule is the doc's: look at the directory itself, and if it
 * is not a repository, look **one level down** and nowhere else. Recursing would
 * make the panel's "which repository" question unbounded, and a deep walk is
 * exactly the scan that costs seconds on a big tree.
 *
 * Two properties are worth keeping:
 *
 * - **The scan is bounded.** Directories that hold no repository are the common
 *   case in a container, and a home-directory session would otherwise spawn a
 *   `git rev-parse` per child. The candidate count and the repository count are
 *   both capped, and hitting a cap is logged rather than silently dropping a
 *   repository from the list.
 * - **Results are cached per directory, briefly.** Opening the panel reads the
 *   listing and the status, and both want the roots; the cache (with in-flight
 *   de-duplication) makes that one scan. The TTL is short because a repository
 *   added under a container should appear without restarting anything.
 *
 * @module dsh-git-panel/host/repo-discovery
 */

import { readdir, realpath, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'

import { gitDirOf } from './git-dir.ts'

/** Runs one git command and answers its stdout, or `null` when it failed. */
export type RunCapture = (args: readonly string[], cwd: string) => Promise<string | null>

/** Directories never descended into: dependency trees and build output. */
const SKIPPED = new Set(['node_modules', 'dist', 'build'])

/** Most child directories one scan will probe. */
const MAX_CANDIDATES = 64

/** Most repositories one scan will report. */
const MAX_REPOS = 32

/** How long a scan's result is reused. */
const CACHE_TTL_MS = 5_000

/**
 * Files whose mtime says a repository was last used.
 *
 * `index` moves on a stage, `HEAD`/`logs/HEAD` on a commit or a checkout,
 * `FETCH_HEAD` on a fetch, `packed-refs` on a repack. None of them is required to
 * exist, and a repository nothing has touched has an older stamp than one that
 * has — which is the whole question the default answer asks.
 */
const ACTIVITY_FILES = ['index', 'HEAD', 'ORIG_HEAD', 'MERGE_HEAD', 'FETCH_HEAD', 'packed-refs', join('logs', 'HEAD')]

/** One cached scan. */
interface CachedScan {
  readonly roots: readonly string[]
  readonly expires: number
}

const cache = new Map<string, CachedScan>()
const inFlight = new Map<string, Promise<readonly string[]>>()

/** Canonicalise a path we were given by git; a path that cannot resolve is used as-is. */
async function canonical(path: string): Promise<string> {
  return await realpath(path).catch(() => path)
}

/** `git rev-parse --show-toplevel` in one directory, or `null` when it is not a work tree. */
async function directRoot(run: RunCapture, directory: string): Promise<string | null> {
  const out = await run(['rev-parse', '--show-toplevel'], directory)
  if (out === null) return null
  const root = out.trim()
  return root === '' ? null : root
}

/**
 * How recently a repository was used, as a millisecond stamp.
 *
 * `0` when nothing in its git directory exists — a freshly `git init`-ed
 * repository with no activity at all.
 * @param root - Absolute work tree root.
 * @returns The newest mtime found, or 0.
 */
export async function recencyOf(root: string): Promise<number> {
  const gitDir = await gitDirOf(root).catch(() => null)
  if (gitDir === null) return 0
  const stamps = await Promise.all(
    ACTIVITY_FILES.map((name) =>
      stat(join(gitDir, name))
        .then((info) => info.mtimeMs)
        .catch(() => 0),
    ),
  )
  return stamps.reduce((newest, stamp) => Math.max(newest, stamp), 0)
}

/**
 * The repositories at or one level below `cwd`, most recently used first.
 *
 * The order is the doc's FR-8.2 default: the repository whose git state moved
 * most recently is the one the user was last working in. Ties (and repositories
 * with no state files at all) fall back to name order, so the answer is stable.
 * @param run - Runs one git command and answers its stdout.
 * @param cwd - The session's directory.
 * @param log - Optional diagnostic sink, for a scan that hit a cap.
 * @returns Absolute work tree roots, deduplicated.
 */
export function discoverRepos(
  run: RunCapture,
  cwd: string,
  log?: (message: string) => void,
): Promise<readonly string[]> {
  const cached = cache.get(cwd)
  if (cached !== undefined && cached.expires > Date.now()) return Promise.resolve(cached.roots)
  const pending = inFlight.get(cwd)
  if (pending !== undefined) return pending

  const scan = (async () => {
    const direct = await directRoot(run, cwd)
    const roots: string[] = []
    if (direct !== null) {
      roots.push(await canonical(direct))
    } else {
      const entries = await readdir(cwd, { withFileTypes: true }).catch(() => [])
      const candidates = entries
        .filter(
          (entry) =>
            entry.isDirectory() &&
            !entry.name.startsWith('.') &&
            !SKIPPED.has(entry.name.toLowerCase()),
        )
        .map((entry) => entry.name)
        .sort()
      if (candidates.length > MAX_CANDIDATES) {
        log?.(
          `git-panel: only the first ${String(MAX_CANDIDATES)} of ${String(candidates.length)} directories under ${cwd} were searched for repositories`,
        )
      }
      for (const name of candidates.slice(0, MAX_CANDIDATES)) {
        const root = await directRoot(run, join(cwd, name))
        if (root === null) continue
        const real = await canonical(root)
        if (roots.includes(real)) continue
        if (roots.length >= MAX_REPOS) {
          log?.(`git-panel: more than ${String(MAX_REPOS)} repositories under ${cwd}; the rest are not listed`)
          break
        }
        roots.push(real)
      }
      // Most recently used first, then name — computed once and cached, because
      // it is a stat per candidate and the order is what the default reads.
      const stamped = await Promise.all(
        roots.map(async (root) => ({ root, at: await recencyOf(root) })),
      )
      stamped.sort((left, right) => {
        if (right.at !== left.at) return right.at - left.at
        return basename(left.root).localeCompare(basename(right.root))
      })
      roots.splice(0, roots.length, ...stamped.map((entry) => entry.root))
    }
    return roots
  })()

  inFlight.set(cwd, scan)
  void scan.then(
    (roots) => {
      inFlight.delete(cwd)
      cache.set(cwd, { roots, expires: Date.now() + CACHE_TTL_MS })
    },
    () => {
      inFlight.delete(cwd)
    },
  )
  return scan
}

/** Drop every cached scan; for tests that must observe a fresh filesystem. */
export function resetDiscoveryCache(): void {
  cache.clear()
  inFlight.clear()
}
