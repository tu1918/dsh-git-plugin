/**
 * Whether the bottom dock is open, and how tall it was dragged (FR-3.6's pane).
 *
 * It is a preference rather than component state for a reason the panel already
 * learned once: a dock that closes itself on every page load is a dock the user
 * has to re-open every time, and one that forgets a dragged height is asking to
 * be dragged again. Both survive a reload here.
 *
 * The default is **open**, on the history tab: the pane's job is to be read, and
 * a strip of tabs with nothing behind it is not a default anyone asked for.
 *
 * The read is guarded and the write is best-effort, for the reason
 * `group-collapse.ts` states: storage throws in a private-mode browser and is
 * absent in a bare jsdom document, and a stored value is untrusted input another
 * tab or another version of this plugin may have written.
 *
 * @module dsh-git-panel/client/ui/bottom-view
 */

/** The `localStorage` key the dock's state lives under. */
export const BOTTOM_PANE_KEY = 'dsh-git-panel/bottom-pane'

/** What the dock remembers between visits. */
export interface BottomPanePrefs {
  /** Whether the body is showing; `false` leaves just the tab strip. */
  readonly expanded: boolean
  /**
   * The dragged height in pixels, or `null` while the pane is still using the
   * stylesheet's per-tab default (half the panel for the diff, content-height for
   * the list).
   */
  readonly height: number | null
}

/** What a first-time panel opens the dock as. */
export const DEFAULT_BOTTOM_PREFS: BottomPanePrefs = { expanded: true, height: null }

/**
 * Read the remembered dock state.
 *
 * Anything unrecognised is dropped rather than repaired, so a value from a
 * different plugin version cannot make the panel throw on its first render — or
 * hand the pane a height that is not a number.
 * @returns The stored state, or {@link DEFAULT_BOTTOM_PREFS}.
 */
export function readBottomPane(): BottomPanePrefs {
  try {
    const raw = window.localStorage.getItem(BOTTOM_PANE_KEY)
    if (raw === null) return DEFAULT_BOTTOM_PREFS
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return DEFAULT_BOTTOM_PREFS
    const record = parsed as Record<string, unknown>
    const expanded =
      typeof record['expanded'] === 'boolean' ? record['expanded'] : DEFAULT_BOTTOM_PREFS.expanded
    const rawHeight = record['height']
    const height =
      typeof rawHeight === 'number' && Number.isFinite(rawHeight) && rawHeight > 0
        ? rawHeight
        : null
    return { expanded, height }
  } catch {
    return DEFAULT_BOTTOM_PREFS
  }
}

/**
 * Remember the dock's state.
 * @param prefs - The state now in effect.
 */
export function writeBottomPane(prefs: BottomPanePrefs): void {
  try {
    window.localStorage.setItem(BOTTOM_PANE_KEY, JSON.stringify(prefs))
  } catch {
    // Storage unavailable: the state still holds for this session.
  }
}
