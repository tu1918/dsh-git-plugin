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
 * Four decisions are worth stating, because each has a cheaper alternative that
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
 * - **The layer flips above the anchor when below cannot hold it.** The branch
 *   list hangs from the rail, where "below" is the whole panel; a row menu hangs
 *   from a row that can be the panel's last one, and a menu capped at the 4px
 *   between it and the bottom edge is a menu nobody can use. {@link placeLayer}
 *   decides, and it flips only when above is genuinely roomier — a long list
 *   under the rail stays below, where the user's eye already is.
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

/** Which side of its anchor a layer opens on. */
export type LayerPlacement = 'below' | 'above'

/** Where the layer sits, in the panel's own coordinates. */
export interface LayerBox {
  /** Whether the layer hangs under the anchor or stands on top of it. */
  readonly placement: LayerPlacement
  /** Distance from the panel's top edge; `null` when the layer opens above. */
  readonly top: number | null
  /** Distance from the panel's bottom edge; `null` when the layer opens below. */
  readonly bottom: number | null
  /** Ceiling on the layer's height, or `null` while the panel has no height. */
  readonly maxHeight: number | null
}

/** What {@link placeLayer} measures from. */
export interface LayerPlacementInput {
  /** The anchor's rectangle. */
  readonly anchor: Pick<DOMRect, 'top' | 'bottom'>
  /** The panel's rectangle. */
  readonly panel: Pick<DOMRect, 'top' | 'height'>
  /** Space between the anchor and the layer. */
  readonly gap: number
  /** The layer's own height, as its content wants it. */
  readonly naturalHeight: number
}

/**
 * Decide where a layer goes: under its anchor, or above it when there is no room.
 *
 * Stated as a pure function rather than inline arithmetic because this is the one
 * part of the layer a browser must measure but a test cannot lay out: jsdom has no
 * layout, so the flip is checked here on stated rectangles and the DOM half
 * (`Popover`) only feeds it the ones it read.
 *
 * The flip is deliberately conservative — only when the layer does not fit below
 * AND the space above is larger. A long branch list under the rail therefore stays
 * where it was opened even though it overflows, and only a menu on the panel's
 * bottom rows moves up.
 *
 * @param input - The two rectangles, the gap, and the layer's natural height.
 * @returns The placement, the anchored edge, and the height ceiling.
 */
export function placeLayer({ anchor, panel, gap, naturalHeight }: LayerPlacementInput): LayerBox {
  const anchorTop = anchor.top - panel.top
  const anchorBottom = anchor.bottom - panel.top
  // The gap is reserved on both sides: one between anchor and layer, one at the
  // far edge, so a layer filling the space still reads as floating rather than
  // welded to the panel's border.
  const top = Math.max(anchorBottom, 0) + gap
  const roomBelow = panel.height - top - gap
  const roomAbove = anchorTop - gap - gap
  // A panel with no measurable height is jsdom rather than a browser: there is no
  // "room below" for the layer to run out of, so it stays under its anchor.
  const above = panel.height > 0 && naturalHeight > roomBelow && roomAbove > roomBelow
  if (above) {
    return {
      placement: 'above',
      top: null,
      // CSS measures from the panel's bottom edge; the layer's own bottom edge
      // stands one gap above the anchor's top.
      bottom: Math.max(panel.height - anchorTop + gap, 0),
      maxHeight: roomAbove > 0 ? roomAbove : null,
    }
  }
  return {
    placement: 'below',
    top,
    bottom: null,
    // A panel with no measurable height is jsdom rather than a browser: leave the
    // ceiling off instead of pinning the layer to zero and calling it done.
    maxHeight: roomBelow > 0 ? roomBelow : null,
  }
}

/** Everything the layer renders from. */
export interface PopoverProps {
  /**
   * The element the layer hangs from: its bottom edge is the layer's top edge —
   * or, when {@link placeLayer} flips the layer, its top edge is the layer's
   * bottom edge.
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
  const [box, setBox] = useState<LayerBox | null>(null)

  // Measuring in a layout effect keeps the first paint at the right place: the
  // layer is positioned before the browser shows it, so there is nothing to jump.
  // The scroll listener is in the capture phase because the panel's scrolling
  // happens in its own containers, and a scroll event does not bubble.
  useLayoutEffect(() => {
    if (anchor === null) return
    const measure = (): void => {
      const layer = ref.current
      const panel = layer?.closest<HTMLElement>(`.${cls.root}`) ?? null
      // A detached anchor has no rectangle to hang from: the row a menu was opened
      // on can be re-rendered away while the menu is up, and measuring it would
      // put the layer in the panel's corner. Leaving the last box alone keeps it
      // where the user opened it until the panel closes the menu.
      if (layer === null || panel === null || !anchor.isConnected) return
      setBox(
        placeLayer({
          anchor: anchor.getBoundingClientRect(),
          panel: panel.getBoundingClientRect(),
          gap,
          // `scrollHeight` rather than the element's height: once a ceiling is
          // applied, the box is clamped and only this still says how tall the
          // content wants to be — which is what the flip has to compare against.
          naturalHeight: layer.scrollHeight,
        }),
      )
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
      data-placement={box?.placement ?? 'below'}
      role="dialog"
      aria-label={label}
      style={
        box === null
          ? undefined
          : {
              top: box.top === null ? undefined : `${box.top}px`,
              bottom: box.bottom === null ? undefined : `${box.bottom}px`,
              maxHeight: box.maxHeight === null ? undefined : `${box.maxHeight}px`,
            }
      }
    >
      {children}
    </div>
  )
}
