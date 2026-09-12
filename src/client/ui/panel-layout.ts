/**
 * The panel column's height budget: every region's floor, and the ceilings that
 * keep one region from eating another.
 *
 * The column is five regions stacked in a 100%-tall box — the state rail, the
 * staged drawer, the commit box, the change list, and the bottom dock. Only ONE
 * of them is elastic, and that is the whole model:
 *
 * - the **change list** takes whatever is left (`flex: 1 1 auto`) and scrolls, so
 *   a repository with a thousand changed files costs the regions above and below
 *   nothing;
 * - everything else is bounded by a number from this file, in **both**
 *   directions. A region that can grow without a ceiling is a region that
 *   eventually squeezes the list to nothing, and a region with no floor is one
 *   that can disappear behind a drag.
 *
 * Two rules keep the arithmetic honest, and both are checked by
 * `test/client-panel.test.ts` rather than trusted:
 *
 * 1. **`DOCK_RESERVED` is the sum of every other floor.** The dock is the one
 *    region the user drags, and its drag ceiling is `panel − DOCK_RESERVED` — the
 *    same number the stylesheet puts on the dock's own `max-height`, so a drag and
 *    a remembered height from a taller window are limited identically.
 * 2. **The staged drawer's ceiling is measured against the maxima** of what is
 *    below it (see the stylesheet's `calc`), because the commit box is the one
 *    region that legitimately grows with its content: capping the drawer against
 *    the commit box's *floor* would let the two of them together push the change
 *    list under its own floor.
 *
 * These are CSS pixels of the sidebar, not of the window: the panel lives in a
 * tab of a right sidebar whose height the window does not fix, which is why the
 * numbers are floors rather than percentages wherever a floor is what is meant.
 *
 * @module dsh-git-panel/client/ui/panel-layout
 */

/**
 * The state rail (branch, sync actions, refresh).
 *
 * Fixed rather than bounded: it is one row of 26px controls and never grows.
 */
export const RAIL_HEIGHT = 38

/** The staged drawer's floor: its header, its bulk action, and one row. */
export const STAGED_MIN_HEIGHT = 72

/**
 * The staged drawer's absolute ceiling.
 *
 * There is a relative one as well, in the stylesheet: the drawer also never takes
 * more than two fifths of the panel. Whichever is smaller wins — a tall sidebar
 * should not hand 400px to the index just because it can.
 */
export const STAGED_MAX_HEIGHT = 320

/** The commit box's floor: the textarea at its smallest, plus the footer. */
export const COMMIT_MIN_HEIGHT = 104

/**
 * The commit box's ceiling: its textarea at its largest, plus the footer.
 *
 * The box is content-sized, so this is a guard rather than the thing that usually
 * decides its height — {@link COMMIT_INPUT_MAX_HEIGHT} is. It exists so that a
 * scope sentence wrapping in a narrow sidebar can never make the box grow past
 * what the budget above reserved for it.
 */
export const COMMIT_MAX_HEIGHT = 240

/** The textarea's own floor — about three lines of a commit message. */
export const COMMIT_INPUT_MIN_HEIGHT = 52

/**
 * The textarea's own ceiling.
 *
 * This is what makes the commit box's height vary at all: the message is the one
 * thing in the region whose size is the user's, and the manual resize handle
 * cannot drag it past this.
 */
export const COMMIT_INPUT_MAX_HEIGHT = 140

/**
 * The change list's floor: the section header plus three or four rows.
 *
 * This is the floor the whole budget exists for. Reported from the running panel:
 * with the dock dragged open and a full index, the change list was squeezed to a
 * 56px slot — a header and a scrollbar, which reads as "the panel is broken"
 * rather than as "there is more below".
 */
export const CHANGE_MIN_HEIGHT = 140

/** The dock folded to its tab strip. */
export const DOCK_MIN_HEIGHT = 32

/**
 * The hairlines between the regions, rounded up to something the budget can use.
 *
 * Six 0.5px borders cannot be expressed as a useful fraction, and being one pixel
 * generous here costs a pixel of dock and buys the guarantee that no rounding
 * error can push the change list under its floor.
 */
export const COLUMN_SEPARATORS = 4

/**
 * What the dock may never take: every other region at its own floor.
 *
 * Used in two places that must agree, which is why it is one constant: the
 * stylesheet's `max-height` for the dock, and the drag ceiling `PaneResizer`
 * computes from its `reserved` prop.
 */
export const DOCK_RESERVED =
  RAIL_HEIGHT + STAGED_MIN_HEIGHT + COMMIT_MIN_HEIGHT + CHANGE_MIN_HEIGHT + COLUMN_SEPARATORS
