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
 * - **Hanging off the control that opened it, lined up with that control.** The
 *   anchor is the button, not the row it sits in: a dropdown that started at the
 *   sidebar's edge when its button is 12px in read as a second, unrelated thing
 *   (asked for from the running panel). It is pulled back when its own width would
 *   take it past the panel's right edge — the stash button sits near that edge —
 *   so it stays whole, and it is never narrower than its content.
 * - **As wide as its content, capped at a third of the panel.** A list of branch
 *   names and a stack of two-line rows do not want the sidebar's whole width, and
 *   a layer that took it anyway blanked out the change list it was opened over
 *   (asked for from the running panel). The ceiling, not the content, is what the
 *   panel decides; what does not fit truncates with the ellipsis its row already
 *   carries.
 * - **`max-height` is measured too.** The layer starts under the anchor and is
 *   capped at what is left of the panel, so a long list scrolls inside it instead
 *   of running off the bottom of a 400px sidebar.
 * - **The layer flips above the anchor when below cannot hold it.** The branch
 *   list hangs from the rail, where "below" is the whole panel — but a short
 *   window leaves it capped at the few pixels between the rail and the bottom
 *   edge. {@link placeLayer} decides, and it flips only when above is genuinely
 *   roomier — a long list under the rail stays below, where the user's eye
 *   already is.
 * - **Dismissal is the layer's job, not the content's.** Outside press and Escape
 *   are the two things §4.3 asks of a dropdown, and both are the same for both
 *   layers that use this — the branch list and the stash stack, which is why they
 *   are one module. The anchor owns its own toggle, so a press on it is not
 *   "outside": closing here as well would make the second press close and reopen
 *   in one go. (The right-click toolbar does NOT use this module, and has no
 *   anchor to exempt; see `ui/toolbar.tsx`.)
 *
 * @module dsh-git-panel/client/ui/popover
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

import { cls } from './styles.ts'

/** Which side of its anchor a layer opens on. */
export type LayerPlacement = 'below' | 'above'

/**
 * Whether a fresh measurement says exactly what the last one did.
 *
 * Used to keep a re-measurement that changed nothing from re-rendering: the
 * ResizeObserver in {@link Popover} fires for the box the placement itself just
 * set, so publishing an equal box would be a loop rather than a correction.
 * @param current - The box on screen, or `null` before the first measurement.
 * @param next - The box just measured.
 * @returns True when they are the same placement.
 */
function sameBox(current: LayerBox | null, next: LayerBox): boolean {
  return (
    current !== null &&
    current.placement === next.placement &&
    current.top === next.top &&
    current.bottom === next.bottom &&
    current.left === next.left &&
    current.maxHeight === next.maxHeight
  )
}

/** Where the layer sits, in the panel's own coordinates. */
export interface LayerBox {
  /** Whether the layer hangs under the anchor or stands on top of it. */
  readonly placement: LayerPlacement
  /** Distance from the panel's top edge; `null` when the layer opens above. */
  readonly top: number | null
  /** Distance from the panel's bottom edge; `null` when the layer opens below. */
  readonly bottom: number | null
  /**
   * Distance from the panel's left edge.
   *
   * The layer lines up with the control that opened it rather than with the
   * panel's corner: a dropdown that starts at the sidebar's edge when its button
   * sits 12px in — and further in when the repository picker is on the rail —
   * reads as a second, unrelated thing instead of as that button's menu (asked
   * for from the running panel).
   */
  readonly left: number
  /** Ceiling on the layer's height, or `null` while the panel has no height. */
  readonly maxHeight: number | null
}

/** What {@link placeLayer} measures from. */
export interface LayerPlacementInput {
  /** The anchor's rectangle: the control that opened the layer. */
  readonly anchor: Pick<DOMRect, 'top' | 'bottom' | 'left'>
  /** The panel's rectangle. */
  readonly panel: Pick<DOMRect, 'top' | 'height' | 'left' | 'width'>
  /** Space between the anchor and the layer. */
  readonly gap: number
  /** The layer's own height, as its content wants it. */
  readonly naturalHeight: number
  /** The layer's own width, as its content wants it. */
  readonly layerWidth: number
}

/**
 * Decide where a layer goes: under its anchor, or above it when there is no room,
 * and lined up with the anchor horizontally.
 *
 * Stated as a pure function rather than inline arithmetic because this is the one
 * part of the layer a browser must measure but a test cannot lay out: jsdom has no
 * layout, so the flip and the offsets are checked here on stated rectangles and the
 * DOM half (`Popover`) only feeds it the ones it read.
 *
 * The flip is deliberately conservative — only when the layer does not fit below
 * AND the space above is larger. A long branch list under the rail therefore stays
 * where it was opened even though it overflows, and only a menu on the panel's
 * bottom rows moves up.
 *
 * @param input - The two rectangles, the gap, and the layer's own size.
 * @returns The placement, the anchored edge, the left offset, and the ceiling.
 */
export function placeLayer({
  anchor,
  panel,
  gap,
  naturalHeight,
  layerWidth,
}: LayerPlacementInput): LayerBox {
  const anchorTop = anchor.top - panel.top
  const anchorBottom = anchor.bottom - panel.top
  // The gap is reserved on both sides: one between anchor and layer, one at the
  // far edge, so a layer filling the space still reads as floating rather than
  // welded to the panel's border.
  const top = Math.max(anchorBottom, 0) + gap
  const roomBelow = panel.height - top - gap
  const roomAbove = anchorTop - gap - gap
  // The layer is as wide as its content and never wider than the panel, so an
  // anchor near the right edge (the stash button is one) would push it past that
  // edge, where the sidebar clips it. Pulling it back to the last offset that
  // fits keeps it whole; the ceiling on its width does the rest. A panel with no
  // measurable width (jsdom, or a panel that is not visible) has nothing to pull
  // back to, so the layer takes the anchor's own offset there.
  const left =
    panel.width > 0
      ? Math.min(Math.max(anchor.left - panel.left, 0), Math.max(panel.width - layerWidth, 0))
      : Math.max(anchor.left - panel.left, 0)
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
      left,
      maxHeight: roomAbove > 0 ? roomAbove : null,
    }
  }
  return {
    placement: 'below',
    top,
    bottom: null,
    left,
    // A panel with no measurable height is jsdom rather than a browser: leave the
    // ceiling off instead of pinning the layer to zero and calling it done.
    maxHeight: roomBelow > 0 ? roomBelow : null,
  }
}

/** Everything the layer renders from. */
export interface PopoverProps {
  /**
   * The control the layer hangs from — the button that opened it, not the row that
   * button sits in. Its bottom edge is the layer's top edge (or, when
   * {@link placeLayer} flips the layer, its top edge is the layer's bottom edge),
   * and its left edge is what the layer lines up with.
   *
   * `null` while that element does not exist yet, which is the honest input for
   * "the control has not been rendered" rather than a layer in the corner.
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
export function Popover({
  anchor,
  onClose,
  label,
  id,
  gap = 4,
  children,
}: PopoverProps): ReactNode {
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
      // A detached anchor has no rectangle to hang from: the control that opened
      // the layer can be re-rendered away while the layer is up, and measuring it
      // would put the layer in the panel's corner. Leaving the last box alone
      // keeps it where the user opened it until the caller closes it.
      if (layer === null || panel === null || !anchor.isConnected) return
      const next = placeLayer({
        anchor: anchor.getBoundingClientRect(),
        panel: panel.getBoundingClientRect(),
        gap,
        // `scrollHeight` rather than the element's height: once a ceiling is
        // applied, the box is clamped and only this still says how tall the
        // content wants to be — which is what the flip has to compare against.
        naturalHeight: layer.scrollHeight,
        // The width, though, is the used one: the layer sizes to its own content
        // (`width: max-content` in the stylesheet) and its `left` does not feed
        // back into that, so one measurement is enough. Zero in jsdom, which has
        // no layout — the placement then has no width to pull back for.
        layerWidth: layer.getBoundingClientRect().width,
      })
      // A measurement that changed nothing publishes nothing. The observer below
      // fires for the box this code itself just set, so re-rendering on that would
      // be a loop rather than a correction.
      setBox((current) => (sameBox(current, next) ? current : next))
    }
    measure()
    window.addEventListener('resize', measure)
    document.addEventListener('scroll', measure, true)
    // What the layer measured from can move without any of those events: its OWN
    // box is what changes when its content does — a stash list that arrives after
    // the layer was placed, or the "stash the current changes" form opening under
    // it — and the change may be entirely inside a child's own state, so this
    // component is not re-rendered either. One stale offset is all it takes for the
    // dropdown to open somewhere its button is not (reported from the running
    // panel: the width followed the content and the position did not). jsdom has
    // no ResizeObserver, so the guard is here rather than in a test fixture.
    const observed = [ref.current, anchor, ref.current?.closest<HTMLElement>(`.${cls.root}`) ?? null]
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null
    if (observer !== null) {
      for (const node of observed) {
        if (node !== null) observer.observe(node)
      }
    }
    return () => {
      window.removeEventListener('resize', measure)
      document.removeEventListener('scroll', measure, true)
      observer?.disconnect()
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
              left: `${box.left}px`,
              maxHeight: box.maxHeight === null ? undefined : `${box.maxHeight}px`,
            }
      }
    >
      {children}
    </div>
  )
}
