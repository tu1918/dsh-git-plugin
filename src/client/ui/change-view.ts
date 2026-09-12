/**
 * How the change list is displayed: a flat list or a file tree (FR-1.3), and
 * which directories of that tree are folded away.
 *
 * The two live in one module because they are one view's state: the folded
 * directories only exist when the tree is the mode, and the mode is what decides
 * whether the panel should read them at all. The change GROUPS' own folds stay in
 * `group-collapse.ts`, and the split is deliberate — FR-1.1's groups exist in both
 * modes, while a folded directory is a property of the tree alone.
 *
 * Both reads are guarded, for the reason `group-collapse.ts` states: storage
 * throws in a private-mode browser and is absent in a bare jsdom document, and a
 * stored value is untrusted input that another tab or another version of this
 * plugin may have written. Both writes are best-effort: a preference that cannot
 * be saved still applies to this render.
 *
 * @module dsh-git-panel/client/ui/change-view
 */

/** The two shapes the change list can take (FR-1.3). */
export type ViewMode = 'list' | 'tree'

/** The `localStorage` key the chosen mode lives under. */
export const VIEW_MODE_KEY = 'dsh-git-panel/view-mode'

/** The `localStorage` key the folded tree directories live under. */
export const DIR_COLLAPSE_KEY = 'dsh-git-panel/collapsed-dirs'

/**
 * The mode a first-time panel opens in.
 *
 * The tree: it is the shape a changed-file list is read in when the sidebar is
 * narrow, and the product owner asked for it as the display. The flat list stays
 * one click away, which is what FR-1.3 asks for — both modes, switchable.
 */
const DEFAULT_MODE: ViewMode = 'tree'

/**
 * Ceiling on remembered directories.
 *
 * A fold is a preference, so it is worth keeping; an unbounded set of paths from
 * every branch the user has ever visited is not. Past the cap the oldest entries
 * are dropped, which at worst re-expands a directory the user folded long ago.
 */
const MAX_COLLAPSED_DIRS = 200

/**
 * Read the remembered display mode.
 * @returns The stored mode, or {@link DEFAULT_MODE} when nothing valid was stored.
 */
export function readViewMode(): ViewMode {
  try {
    const raw = window.localStorage.getItem(VIEW_MODE_KEY)
    return raw === 'list' || raw === 'tree' ? raw : DEFAULT_MODE
  } catch {
    return DEFAULT_MODE
  }
}

/**
 * Remember the display mode.
 * @param mode - The mode now in effect.
 */
export function writeViewMode(mode: ViewMode): void {
  try {
    window.localStorage.setItem(VIEW_MODE_KEY, mode)
  } catch {
    // Storage unavailable: the choice still holds for this session.
  }
}

/**
 * Read the remembered directory folds.
 * @returns The folded directories, as `area:path` keys; empty when nothing valid.
 */
export function readCollapsedDirs(): ReadonlySet<string> {
  try {
    const raw = window.localStorage.getItem(DIR_COLLAPSE_KEY)
    if (raw === null) return new Set()
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.filter((entry): entry is string => typeof entry === 'string'))
  } catch {
    return new Set()
  }
}

/**
 * Remember the directory folds.
 * @param dirs - The directories now folded.
 */
export function writeCollapsedDirs(dirs: ReadonlySet<string>): void {
  try {
    const kept = [...dirs].slice(-MAX_COLLAPSED_DIRS)
    window.localStorage.setItem(DIR_COLLAPSE_KEY, JSON.stringify(kept))
  } catch {
    // Storage unavailable: the folds still hold for this session.
  }
}

/** Everything the group rows need in order to draw either shape. */
export interface ChangeView {
  /** Which shape to draw. */
  readonly mode: ViewMode
  /** Folded tree directories, keyed `area:path` so two groups cannot collide. */
  readonly collapsedDirs: ReadonlySet<string>
  /** Fold or unfold one directory of one group. */
  readonly onToggleDir: (key: string) => void
}

/**
 * The storage key for one group's directory.
 *
 * Keyed by area as well as path because each group builds its own tree (FR-1.1):
 * folding `src` in the staged drawer must not fold `src` in Changes.
 * @param area - The group the directory belongs to.
 * @param path - The directory's path from the repository root.
 * @returns The key to store and look up.
 */
export function dirKey(area: string, path: string): string {
  return `${area}:${path}`
}
