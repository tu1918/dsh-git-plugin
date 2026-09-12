/**
 * The draggable boundary between two stacked panes.
 *
 * The panel is a column of panes, and one of them — the change list — takes
 * whatever is left over. So "make this pane taller" is really "take the height
 * from the list below/above me", and one grip per sizable pane is enough to make
 * every part adjustable without a general split-pane system: each pane that owns
 * a height has a grip at its own top edge, and the list absorbs the difference.
 *
 * Three details are load-bearing:
 *
 * - **The listening is on `window`, not on the grip.** A pointer that leaves a
 *   7px strip mid-drag must keep resizing, and `setPointerCapture` would tie the
 *   gesture to the element's own lifetime.
 * - **The ceiling is measured against the panel**, not the window: these panes
 *   share their column with the rail, the commit box and the list, and the window
 *   can be taller than the sidebar they live in. It leaves {@link reserved}
 *   pixels for everything that is not being dragged, so no drag can push another
 *   pane out of view.
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
   * Pixels kept for everything above the dragged pane — the rail, the commit box
   * and the change list — no matter how far the pointer travels.
   */
  readonly reserved: number
  /** Called with the pane's new height while the pointer moves. */
  readonly onResize: (height: number) => void
}

/**
 * One grip. Render it as the first child of the pane it sizes: the drag reads
 * that parent's box for its starting height, which is what makes the arithmetic
 * independent of what else is in the column.
 * @param props - Label, limits, and where the height goes.
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

      // Dragging up grows the pane: the grip is its top edge, so the movement is
      // subtracted rather than added.
      const onMove = (move: PointerEvent): void => {
        const measured = pane.parentElement?.getBoundingClientRect().height ?? 0
        const panel = measured > 0 ? measured : window.innerHeight
        const ceiling = Math.max(minHeight, panel - reserved)
        const wanted = startHeight - (move.clientY - startY)
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
