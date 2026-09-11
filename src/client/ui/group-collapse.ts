/**
 * Which change groups the user has folded away.
 *
 * Its own module rather than a private helper in the panel, for the same reason
 * `diff-layout` has one: the choice is a preference that outlives a render, and
 * the read is guarded — `localStorage` throws in a private-mode browser and is
 * absent in a bare jsdom document, and a stored string is untrusted input that
 * another tab or another version of this plugin may have written.
 *
 * @module dsh-git-panel/client/ui/group-collapse
 */

import type { ChangeArea } from '../../core/types.ts'

/** The `localStorage` key the folded groups live under. */
export const GROUP_COLLAPSE_KEY = 'dsh-git-panel/collapsed-groups'

/** Every group the panel can fold, in the order it draws them. */
const AREAS: readonly ChangeArea[] = ['conflicted', 'staged', 'unstaged', 'untracked']

/**
 * Read the remembered folds.
 *
 * Anything unrecognised is dropped rather than repaired: a group that no longer
 * exists, or a value from a different plugin version, must not be able to make
 * the panel throw on its first render.
 * @returns The folded groups; empty when nothing valid was stored.
 */
export function readCollapsedGroups(): ReadonlySet<ChangeArea> {
  try {
    const raw = window.localStorage.getItem(GROUP_COLLAPSE_KEY)
    if (raw === null) return new Set()
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return new Set()
    return new Set(
      parsed.filter((entry): entry is ChangeArea => AREAS.includes(entry as ChangeArea)),
    )
  } catch {
    return new Set()
  }
}

/**
 * Remember the folds.
 *
 * A failure here is deliberately swallowed: the choice still applies to this
 * render, and losing a fold is not worth breaking the panel for.
 * @param areas - The groups currently folded.
 */
export function writeCollapsedGroups(areas: ReadonlySet<ChangeArea>): void {
  try {
    window.localStorage.setItem(GROUP_COLLAPSE_KEY, JSON.stringify([...areas]))
  } catch {
    // Storage unavailable or full: the folds still hold for this session.
  }
}
