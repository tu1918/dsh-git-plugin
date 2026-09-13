/**
 * The side-by-side diff's shared scrollbar: one bar per axis for two scrollers.
 *
 * The two halves of a side-by-side diff are separate scroll containers — that is
 * forced by "fixed halves" plus "a long line must stay readable" — and a native
 * scrollbar belongs to exactly one container. In the wide dock the resulting pair
 * per half went unnoticed; in the narrow right-side column it showed as four bars,
 * one of them (the left half's vertical) planted in the middle of the code, and
 * each drag had to be mirrored onto the other half by script. So the halves hide
 * their natives and this control stands in for them: it reads the halves' shared
 * position, and writes back to both.
 *
 * Custom rather than a native bar stretched over a spacer, for one reason: the two
 * halves do not have the same scrollable range — each side holds different text —
 * and the bar's logical range is the LARGER of the two. A native bar's own
 * clamping would fight the spacer's arithmetic at the far end; here the range is
 * simply the maximum, and each half stops where it must.
 *
 * @module dsh-git-panel/client/ui/diff-scrollbar
 */

import { useCallback, useRef } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react'

import { cls } from './styles.ts'

/**
 * The smallest a thumb may get, as a fraction of its track.
 *
 * A file with a hundred times the viewport's content would otherwise leave a
 * thumb of a few pixels, which is not something a pointer can grab.
 */
const MIN_THUMB = 0.08

/** One axis's numbers, as `SplitHunks` measures them. */
export interface DiffAxis {
  /** Content size in pixels: the larger of the two halves'. */
  readonly content: number
  /** Viewport size in pixels; both halves are the same size by construction. */
  readonly viewport: number
}

/** What one shared scrollbar renders from. */
export interface DiffScrollbarProps {
  /** Which axis it scrolls. */
  readonly axis: 'x' | 'y'
  /** That axis's numbers. */
  readonly extent: DiffAxis
  /** Where the reader is now, in pixels of content. */
  readonly offset: number
  /** Move both halves to a content offset. */
  readonly onScroll: (offset: number) => void
  /** Screen-reader name for the control. */
  readonly label: string
}

/** Keep a value inside a range. */
function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high)
}

/**
 * One axis of the split's shared scrollbar.
 *
 * Nothing is shown while the content fits: a bar for an axis that cannot move is
 * a control that does nothing, and the grid leaves it no room either.
 * @param props - The axis's numbers, the position, and where a move goes.
 */
export function DiffScrollbar({
  axis,
  extent,
  offset,
  onScroll,
  label,
}: DiffScrollbarProps): ReactNode {
  const trackRef = useRef<HTMLDivElement | null>(null)
  const thumbRef = useRef<HTMLDivElement | null>(null)
  /**
   * The drag in progress: the pointer's start on this axis, and the fraction the
   * thumb held when it started. Both are needed so a drag continues from wherever
   * the press landed, track press included.
   */
  const drag = useRef<{ pointer: number; from: number } | null>(null)

  const horizontal = axis === 'x'
  const range = Math.max(extent.content - extent.viewport, 0)
  const thumb = extent.content <= 0 ? 1 : clamp(extent.viewport / extent.content, MIN_THUMB, 1)
  const fraction = range <= 0 ? 0 : clamp(offset / range, 0, 1)

  /** Where the pointer is on this axis. */
  const pointerAt = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>): number =>
      horizontal ? event.clientX : event.clientY,
    [horizontal],
  )

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>): void => {
      const track = trackRef.current
      if (track === null || range <= 0) return
      const length = horizontal ? track.clientWidth : track.clientHeight
      if (length <= 0) return
      event.preventDefault()
      // Where the thumb may travel: the track less the thumb's own length.
      const travel = Math.max(length * (1 - thumb), 1)
      const pointer = pointerAt(event)
      let from = fraction
      if (event.target !== thumbRef.current) {
        // A press on the track itself centres the thumb under the pointer first,
        // then keeps dragging from there — what a native bar does.
        const box = track.getBoundingClientRect()
        const origin = horizontal ? box.left : box.top
        from = clamp((pointer - origin - (length * thumb) / 2) / travel, 0, 1)
        onScroll(from * range)
      }
      drag.current = { pointer, from }
      // A drag that leaves the bar's 10px strip must keep going. A browser without
      // pointer capture (jsdom) simply stops at the edge.
      event.currentTarget.setPointerCapture?.(event.pointerId)
    },
    [fraction, horizontal, onScroll, pointerAt, range, thumb],
  )

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>): void => {
      const held = drag.current
      const track = trackRef.current
      if (held === null || track === null) return
      const length = horizontal ? track.clientWidth : track.clientHeight
      const travel = Math.max(length * (1 - thumb), 1)
      event.preventDefault()
      const next = clamp(held.from + (pointerAt(event) - held.pointer) / travel, 0, 1)
      onScroll(next * range)
    },
    [horizontal, onScroll, pointerAt, range, thumb],
  )

  const onPointerUp = useCallback((): void => {
    drag.current = null
  }, [])

  if (range <= 0) return null

  // The thumb's size and place are percentages of the track, so no measurement is
  // needed to draw it. Its own length comes off the track before the fraction is
  // applied — plain percentage arithmetic, no `calc()`.
  const size = `${(thumb * 100).toFixed(4)}%`
  const place = `${(fraction * (100 - thumb * 100)).toFixed(4)}%`

  return (
    <div
      ref={trackRef}
      className={horizontal ? cls.diffHBar : cls.diffVBar}
      data-diff-bar={axis}
      role="scrollbar"
      aria-label={label}
      aria-orientation={horizontal ? 'horizontal' : 'vertical'}
      aria-valuemin={0}
      aria-valuemax={Math.round(range)}
      aria-valuenow={Math.round(clamp(offset, 0, range))}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <div
        ref={thumbRef}
        className={cls.diffBarThumb}
        data-diff-bar-thumb=""
        style={horizontal ? { left: place, width: size } : { top: place, height: size }}
      />
    </div>
  )
}
