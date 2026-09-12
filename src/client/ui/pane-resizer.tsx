/**
 * The draggable edge of one sizable pane.
 *
 * The panel is a column of panes, and one of them — the change list — takes
 * whatever is left over. So "make this pane taller" is really "take the height
 * from the rest of the column", and one grip per sizable pane is enough to make
 * every part adjustable without a general split-pane system.
 *
 * ## Which edge the grip goes on
 *
 * The edge is not a style choice: it is the edge the pane is NOT anchored to.
 *
 * - A pane that is **top-anchored** — the change drawers, which sit in a stack
 *   and whose content flows from their top — grows by moving its BOTTOM edge
 *   down. Its grip therefore belongs at the bottom, and dragging down makes it
 *   taller.
 * - A pane that is **bottom-anchored** — the diff/history dock, whose bottom edge
 *   is pinned to the panel's bottom — grows by moving its TOP edge up. Its grip
 *   belongs at the top, and dragging up makes it taller.
 *
 * Getting this backwards looks like a bug in the panel rather than in the grip:
 * a handle on the top edge of a top-anchored box invites a pull upward, but
 * nothing above it can shrink, so the box grows downward instead and the gesture
 * has lied about what it does. That is what {@link PaneResizerProps.edge} exists
 * to prevent, and why it has no default: the caller has to say which way its pane
 * grows.
 *
 * ## Three more details that are load-bearing
 *
 * - **The listening is on `window`, not on the grip.** A pointer that leaves a
 *   7px strip mid-drag must keep resizing, and `setPointerCapture` would tie the
 *   gesture to the element's own lifetime.
 * - **The ceiling is measured against the pane's own container**, not the window:
 *   these panes share their column with the rail, the commit box, the other
 *   drawers and the dock, and the window can be taller than the sidebar they live
 *   in. {@link PaneResizerProps.reserved} keeps room for everything on the far
 *   side of the grip, so no drag can push another pane out of view.
 * - **A `role="separator"`, and a label.** A drag handle is an operable control;
 *   the panel's copy is where its name comes from, and the tests read it.
 *
 * @module dsh-git-panel/client/ui/pane-resizer
 */

import { useCallback, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react'

import { cls } from './styles.ts'

/** Which edge of its pane a grip sits on, and therefore which way a drag grows. */
export type PaneEdge = 'top' | 'bottom'

/** What one grip needs to know. */
export interface PaneResizerProps {
  /** Accessible name, from the panel's dictionary. */
  readonly label: string
  /**
   * The edge this grip is drawn on.
   *
   * `'top'` for a bottom-anchored pane (drag up to grow), `'bottom'` for a
   * top-anchored one (drag down to grow). Render the grip as the pane's first
   * child when it is `'top'`, and as its last child when it is `'bottom'` — the
   * drag reads the grip's parent box for its starting height, so the grip has to
   * be inside the pane it sizes.
   */
  readonly edge: PaneEdge
  /** Smallest height this pane may be dragged to. */
  readonly minHeight: number
  /**
   * Pixels kept for the rest of the column on the far side of the grip — the
   * panes above a top grip, the panes below a bottom grip — no matter how far
   * the pointer travels.
   */
  readonly reserved: number
  /** Called with the pane's new height while the pointer moves. */
  readonly onResize: (height: number) => void
}

/**
 * One grip.
 * @param props - Label, edge, limits, and where the height goes.
 */
export function PaneResizer({
  label,
  edge,
  minHeight,
  reserved,
  onResize,
}: PaneResizerProps): ReactNode {
  const [dragging, setDragging] = useState(false)

  const startResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>): void => {
      const pane = event.currentTarget.parentElement
      if (pane === null) return
      event.preventDefault()
      const startY = event.clientY
      const startHeight = pane.getBoundingClientRect().height
      setDragging(true)

      const onMove = (move: PointerEvent): void => {
        const measured = pane.parentElement?.getBoundingClientRect().height ?? 0
        const panel = measured > 0 ? measured : window.innerHeight
        const ceiling = Math.max(minHeight, panel - reserved)
        const travel = move.clientY - startY
        // Down grows a bottom grip, up grows a top one: the pointer moves the
        // pane's free edge, which is the grip's edge.
        const wanted = edge === 'bottom' ? startHeight + travel : startHeight - travel
        onResize(Math.min(ceiling, Math.max(minHeight, wanted)))
      }
      const onRelease = (): void => {
        setDragging(false)
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onRelease)
        window.removeEventListener('pointercancel', onRelease)
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onRelease)
      window.addEventListener('pointercancel', onRelease)
    },
    [edge, minHeight, onResize, reserved],
  )

  return (
    <div
      className={cls.paneGrip}
      role="separator"
      aria-orientation="horizontal"
      aria-label={label}
      {...(dragging ? { 'data-dragging': 'true' } : {})}
      onPointerDown={startResize}
    />
  )
}
