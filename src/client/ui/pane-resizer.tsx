/**
 * The draggable edge of the one sizable pane.
 *
 * The panel has exactly one: the diff/history dock at the bottom. Everything
 * above it — the rail, the staged list, the commit box, the change list — is a
 * column of content that scrolls, and the change list takes whatever height the
 * dock leaves. An earlier version gave every change group its own grip, which put
 * two of them back to back wherever a group was empty and read as a strip of dead
 * bars down the panel; the groups now flow into one scroller instead.
 *
 * ## Which edge the grip goes on
 *
 * The edge is not a style choice: it is the edge the pane is NOT anchored to. The
 * dock is **bottom-anchored** — its bottom edge is pinned to the panel's — so it
 * grows by moving its TOP edge up, and its grip belongs at the top.
 *
 * Getting that backwards looks like a bug in the panel rather than in the grip: a
 * handle on the bottom edge of a bottom-anchored box invites a pull downward,
 * but nothing below it can shrink, so the box would grow upward instead and the
 * gesture would have lied about what it does.
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

/** What one grip needs to know. */
export interface PaneResizerProps {
  /** Accessible name, from the panel's dictionary. */
  readonly label: string
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
export function PaneResizer({ label, minHeight, reserved, onResize }: PaneResizerProps): ReactNode {
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
        // The grip is on the pane's free (top) edge, so a pointer that rises
        // moves that edge up and makes the pane taller.
        onResize(Math.min(ceiling, Math.max(minHeight, startHeight - travel)))
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
    [minHeight, onResize, reserved],
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
