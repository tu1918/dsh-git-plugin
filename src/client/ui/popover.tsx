/**
 * A layer that hangs under an element and floats above the panel's own content.
 *
 * The panel's column is a stack of partitions — the rail, the staged drawer, the
 * commit box, the change groups, the bottom pane — and anything inserted between
 * two of them moves everything below it. That is the wrong shape for a control
 * that is opened, used, and dismissed: the branch list used to unfold into the
 * column, so opening it pushed the file list out from under the pointer that was
 * about to click a file. VS Code and GitHub Desktop both anchor a dropdown over
 * the content instead, and this is that layer.
 *
 * Three decisions are worth stating, because each has a cheaper alternative that
 * is wrong here:
 *
 * - **Absolute, inside the panel, measured from the anchor.** Not `fixed`: the
 *   panel's own box is the boundary we want — the layer must cover the panel's
 *   content and never leave the sidebar — and an ancestor with `overflow: hidden`
 *   clips a fixed layer wherever it likes, while a transformed ancestor silently
 *   re-parents one. Not a portal either: the layer belongs to the panel's DOM, so
 *   Tab order stays "rail, then whatever the rail opened".
 * - **`max-height` is measured too.** The layer starts under the anchor and is
 *   capped at what is left of the panel, so a long list scrolls inside it instead
 *   of running off the bottom of a 400px sidebar.
 * - **Dismissal is the layer's job, not the content's.** Outside press and Escape
 *   are the two things §4.3 asks of a dropdown, and both are the same for every
 *   layer that will use this: the branch list today, the row menus that M5a's
 *   work list calls for next (§10.1). The anchor owns its own toggle, so a press
 *   on it is not "outside" — closing here as well would make the second press
 *   close and reopen in one go.
 *
 * @module dsh-git-panel/client/ui/popover
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

import { cls } from './styles.ts'

/** Where the layer sits, in the panel's own coordinates. */
interface Box {
  /** Distance from the panel's top edge to the layer's top edge. */
  readonly top: number
  /** Ceiling on the layer's height, or `null` while the panel has no height. */
  readonly maxHeight: number | null
}

/** Everything the layer renders from. */
export interface PopoverProps {
  /**
   * The element the layer hangs under: its bottom edge is the layer's top edge.
   *
   * `null` while that element does not exist yet, which is the honest input for
   * "the anchor has not been rendered" rather than a layer in the corner.
   */
  readonly anchor: HTMLElement | null
  /** Close the layer: an outside press, Escape, or the caller's own reason. */
  readonly onClose: () => void
  /** Accessible name for the layer, read as its `aria-label`. */
  readonly label: string
  /** Id the anchor points at with `aria-controls`. */
  readonly id?: string
  /** Space between the anchor's bottom edge and the layer. */
  readonly gap?: number
  /** The layer's content. */
  readonly children: ReactNode
}

/**
 * A floating layer under `anchor`, closed by an outside press or Escape.
 * @param props - The anchor, the dismissal, and the content to render.
 */
export function Popover({ anchor, onClose, label, id, gap = 4, children }: PopoverProps): ReactNode {
  const ref = useRef<HTMLDivElement | null>(null)
  const [box, setBox] = useState<Box | null>(null)

  // Measuring in a layout effect keeps the first paint at the right place: the
  // layer is positioned before the browser shows it, so there is nothing to jump.
  // The scroll listener is in the capture phase because the panel's scrolling
  // happens in its own containers, and a scroll event does not bubble.
  useLayoutEffect(() => {
    if (anchor === null) return
    const measure = (): void => {
      const layer = ref.current
      const panel = layer?.closest<HTMLElement>(`.${cls.root}`) ?? null
      if (layer === null || panel === null) return
      const anchorBox = anchor.getBoundingClientRect()
      const panelBox = panel.getBoundingClientRect()
      const top = Math.max(anchorBox.bottom - panelBox.top, 0) + gap
      // A panel with no measurable height is jsdom rather than a browser: leave
      // the ceiling off instead of pinning the layer to zero and calling it done.
      const room = panelBox.height - top - gap
      setBox({ top, maxHeight: room > 0 ? room : null })
    }
    measure()
    window.addEventListener('resize', measure)
    document.addEventListener('scroll', measure, true)
    return () => {
      window.removeEventListener('resize', measure)
      document.removeEventListener('scroll', measure, true)
    }
  }, [anchor, gap])

  useEffect(() => {
    const onPress = (event: Event): void => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (ref.current?.contains(target) === true) return
      if (anchor?.contains(target) === true) return
      onClose()
    }
    document.addEventListener('pointerdown', onPress, true)
    return () => document.removeEventListener('pointerdown', onPress, true)
  }, [anchor, onClose])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      ref={ref}
      id={id}
      className={cls.popover}
      data-popover="true"
      role="dialog"
      aria-label={label}
      style={
        box === null
          ? undefined
          : { top: `${box.top}px`, maxHeight: box.maxHeight === null ? undefined : `${box.maxHeight}px` }
      }
    >
      {children}
    </div>
  )
}
