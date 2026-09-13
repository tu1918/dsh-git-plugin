/**
 * The right-click toolbar: the panel's own layer, opened at the pointer.
 *
 * §9's two row menus used to be rendered inside `ui/popover.tsx` — the same
 * full-width strip, hanging off the same kind of anchor, as the branch list and
 * the stash stack. That put one shape on two different things: a dropdown the
 * rail opens and keeps open while you read it, and a menu you summon with one
 * click and use with the next. They looked identical, so a right-click looked
 * like the rail had opened something.
 *
 * What this module does instead, and why each part is load-bearing:
 *
 * - **It opens where the pointer is, from a snapshot.** No anchor element and no
 *   re-measuring on scroll: the card stays where it was summoned, the way an
 *   operating system's context menu does. A list scrolling out from under it does
 *   not drag it along, because the toolbar is not the row's decoration.
 * - **It is only as wide as its own words.** `max-content`, capped at the panel
 *   minus one gap, so a menu about a path is a small card next to that path
 *   instead of a stripe across the whole sidebar.
 * - **{@link placeToolbar} is a pure function.** jsdom has no layout: the
 *   pull-back at the right edge and the flip above a low pointer are decided from
 *   stated rectangles, and the DOM half below only feeds it the ones it read.
 *   Same arrangement, and for the same reason, as `placeLayer`.
 * - **It does not reuse `Popover`.** That module's contract is "hang under an
 *   element", which is precisely what this surface is not; sharing the chrome is
 *   what made the two look alike to begin with. The rail keeps `Popover`.
 *
 * The entries and the keyboard are §10.1's order 1, moved rather than rewritten:
 * one highlight the pointer and the arrow keys share, hairlines between groups,
 * and `stayOpen` for §4.3's two-click confirmation. A menu's behaviour was never
 * what was wrong with it. What is new is the leading mark on every entry, which
 * is what makes a card this small scannable.
 *
 * @module dsh-git-panel/client/ui/toolbar
 */

import { useLayoutEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react'

import { cls } from './styles.ts'

/** A point in viewport coordinates — where the pointer was, in `MouseEvent` terms. */
export interface ToolbarPoint {
  /** Distance from the viewport's left edge. */
  readonly x: number
  /** Distance from the viewport's top edge. */
  readonly y: number
}

/** Where the card sits, in the panel's own coordinates. */
export interface ToolbarBox {
  /** Distance from the panel's left edge. */
  readonly left: number
  /** Distance from the panel's top edge. */
  readonly top: number
  /** Ceiling on the card's height, or `null` while the panel has no height. */
  readonly maxHeight: number | null
}

/** What {@link placeToolbar} measures from. */
export interface ToolbarPlacementInput {
  /** The point the toolbar opens at, in the panel's own coordinates. */
  readonly origin: ToolbarPoint
  /** The panel's size. */
  readonly panel: { readonly width: number; readonly height: number }
  /** The card's own size, as its content wants it. */
  readonly size: { readonly width: number; readonly height: number }
  /** Space between the point and the card, on every side. */
  readonly gap: number
}

/** Whether two placements are the same box, down to the pixel. */
function sameBox(a: ToolbarBox | null, b: ToolbarBox): boolean {
  return a !== null && a.left === b.left && a.top === b.top && a.maxHeight === b.maxHeight
}

/**
 * Put the card where it was summoned, and keep it inside the panel.
 *
 * Three rules, each answering a way the card could leave the sidebar it lives in:
 * it opens to the right and below the pointer, it slides back when its own width
 * would carry it past the panel's right edge, and it flips above the pointer when
 * there is no room below but there is above (a right-click on the panel's last
 * rows). A panel with no measurable height is jsdom rather than a browser: there
 * the card stays under the point with no ceiling, the same concession
 * `placeLayer` makes.
 *
 * @param input - The point, the panel, the card's size, and the gap.
 * @returns The card's left, top, and height ceiling.
 */
export function placeToolbar({ origin, panel, size, gap }: ToolbarPlacementInput): ToolbarBox {
  // The right edge is the panel's, not the viewport's: a card wider than the room
  // it has is pinned to the left gap and left to wrap (the stylesheet caps it).
  const rightmost = Math.max(gap, panel.width - size.width - gap)
  const left = Math.min(Math.max(origin.x, gap), rightmost)
  const below = origin.y + gap
  const roomBelow = panel.height - below - gap
  const roomAbove = origin.y - gap - gap
  const above = panel.height > 0 && size.height > roomBelow && roomAbove > roomBelow
  const top = above ? Math.max(origin.y - gap - size.height, gap) : below
  const room = panel.height - top - gap
  return { left, top, maxHeight: panel.height > 0 && room > 0 ? room : null }
}

/** A hairline between two groups of entries. */
export interface ToolbarSeparator {
  readonly kind: 'separator'
}

/** One thing the toolbar can do. */
export interface ToolbarItem {
  readonly kind: 'item'
  /** Identity of the entry, keying its row and naming it to a test. */
  readonly id: string
  /** What the entry says. */
  readonly label: string
  /**
   * The mark drawn in the leading column.
   *
   * Optional, but the column is always drawn: a card whose marks line up says
   * "these are the things this row can do" at a glance, and one entry without a
   * mark must not pull its own label out of that column.
   */
  readonly icon?: ReactNode
  /** Run it. The toolbar closes first, unless {@link ToolbarItem.stayOpen}. */
  readonly onSelect: () => void
  /** Whether this entry cannot run right now, such as while an operation is in flight. */
  readonly disabled?: boolean
  /**
   * Whether activating this entry leaves the toolbar open.
   *
   * It is §4.3's first click: the entry arms rather than acts, and the card has to
   * stay up for the second click to be possible. The entry says so in its own
   * label between the two clicks (the caller rebuilds it from the armed state),
   * which is what makes the second click visibly a different one. Without this
   * flag the card closes on the arm and the confirmation has nowhere to happen.
   */
  readonly stayOpen?: boolean
}

/** One row of the toolbar. */
export type ToolbarEntry = ToolbarSeparator | ToolbarItem

/** Everything the toolbar renders from. */
export interface ContextToolbarProps {
  /** The viewport point the card opens at: the pointer, or the focused row's edge. */
  readonly origin: ToolbarPoint
  /** The entries, in the order they are drawn. */
  readonly entries: readonly ToolbarEntry[]
  /** Accessible name for the card: the row it belongs to. */
  readonly label: string
  /** Dismiss the toolbar. */
  readonly onClose: () => void
}

/** Space between the point and the card, matching the rail's layers. */
const GAP = 4

/** Whether an entry can be activated. */
function usable(entry: ToolbarEntry | undefined): entry is ToolbarItem {
  return entry !== undefined && entry.kind === 'item' && entry.disabled !== true
}

/** The index of the first entry that can be activated, or -1 when there is none. */
function firstEnabled(entries: readonly ToolbarEntry[]): number {
  return entries.findIndex((entry) => usable(entry))
}

/**
 * The next activatable entry, wrapping the way arrow keys do.
 *
 * Disabled entries and separators are stepped over rather than landed on: a
 * highlight that can sit on a row which does nothing would make Enter look broken.
 * @param entries - The toolbar's entries.
 * @param from - The active index, or -1 when nothing is active yet.
 * @param delta - `1` for down, `-1` for up.
 * @returns The index to activate next, or -1 when every entry is disabled.
 */
function stepEnabled(entries: readonly ToolbarEntry[], from: number, delta: number): number {
  const count = entries.length
  if (count === 0) return -1
  // Nothing active yet: down starts at the first entry, up at the last one.
  const start = from < 0 ? (delta > 0 ? -1 : count) : from
  for (let step = 1; step <= count; step += 1) {
    const index = (((start + delta * step) % count) + count) % count
    if (usable(entries[index])) return index
  }
  return -1
}

/**
 * A card at the pointer: focusable, arrow-navigable, closed by Escape or Tab.
 * @param props - Where it opens, what it offers, its name, and its dismissal.
 */
export function ContextToolbar({ origin, entries, label, onClose }: ContextToolbarProps): ReactNode {
  const ref = useRef<HTMLDivElement | null>(null)
  const [box, setBox] = useState<ToolbarBox | null>(null)
  const [active, setActive] = useState(() => firstEnabled(entries))

  // Measured in a layout effect so the first paint is already in place. The panel
  // is read through the DOM rather than passed in: a toolbar is opened from a row
  // that has no idea how wide its sidebar is.
  //
  // The effect depends on `entries` because the card's contents can be replaced in
  // place — the reset entry swaps in its three modes — and a box that was right
  // for four entries can be too short for seven. The array is rebuilt on every
  // render, so the guard in the updater is what keeps this from being a render
  // loop: an unchanged box is not a state change.
  //
  // The cleanup hands focus back to whatever had it — the row the keyboard opened
  // this from — but only when focus is still ours or nowhere at all: a press
  // outside moved it somewhere the user chose, and taking it back would undo that
  // click.
  useLayoutEffect(() => {
    const card = ref.current
    const panel = card?.closest<HTMLElement>(`.${cls.root}`) ?? null
    if (card === null || panel === null) return
    const place = (): void => {
      const panelRect = panel.getBoundingClientRect()
      const next = placeToolbar({
        origin: { x: origin.x - panelRect.left, y: origin.y - panelRect.top },
        panel: { width: panelRect.width, height: panelRect.height },
        // `scrollHeight` rather than the element's height: once a ceiling is
        // applied the box is clamped, and only this still says how tall the
        // content wants to be — which is what the flip has to compare against.
        size: { width: card.offsetWidth, height: card.scrollHeight },
        gap: GAP,
      })
      setBox((current) => (sameBox(current, next) ? current : next))
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [origin, entries])

  useLayoutEffect(() => {
    const card = ref.current
    const previous = document.activeElement
    card?.focus()
    return () => {
      const now = document.activeElement
      const ours = card?.contains(now) === true
      if (!ours && now !== null && now !== document.body) return
      if (previous instanceof HTMLElement && previous !== document.body && previous.isConnected) {
        previous.focus()
      }
    }
  }, [])

  // No anchor, so nothing is exempt from "outside": the pointerdown that opened
  // the toolbar is already over by the time this listener exists, and a press
  // anywhere else is the user leaving.
  useLayoutEffect(() => {
    const onPress = (event: Event): void => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (ref.current?.contains(target) === true) return
      onClose()
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('pointerdown', onPress, true)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPress, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const activate = (index: number): void => {
    const entry = entries[index]
    if (!usable(entry)) return
    // Close first, then act, like the branch picker: the card is gone before the
    // operation's own state arrives, so nothing renders into a layer that is
    // already leaving. An entry that stays open is the exception, and it is the
    // two-click confirmation: the toolbar IS the control both clicks belong to.
    if (entry.stayOpen !== true) onClose()
    entry.onSelect()
  }

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    // Enter and Space on an entry belong to that button: without this guard the
    // key would run the entry here AND fire the button's own click.
    if ((event.key === 'Enter' || event.key === ' ') && event.target !== event.currentTarget) return
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp':
        event.preventDefault()
        setActive((current) => stepEnabled(entries, current, event.key === 'ArrowDown' ? 1 : -1))
        break
      case 'Home':
        event.preventDefault()
        setActive(stepEnabled(entries, -1, 1))
        break
      case 'End':
        event.preventDefault()
        setActive(stepEnabled(entries, entries.length, -1))
        break
      case 'Enter':
      case ' ':
        event.preventDefault()
        activate(active)
        break
      // Escape is deliberately NOT here. This module owns its own dismissal
      // (there is no Popover under it), so the window listener below already
      // closes on Escape from anywhere — including from here, since a key event
      // on the card bubbles to the window. Handling it in both places would run
      // the caller's `onClose` twice for one key, and a caller whose close is a
      // state change would see it land twice.
      case 'Tab':
        // A menu is not a tab stop: Tab leaves it, and closing is how it says so.
        onClose()
        break
      default:
        break
    }
  }

  return (
    <div
      ref={ref}
      className={cls.toolbar}
      role="menu"
      aria-label={label}
      tabIndex={-1}
      data-toolbar="true"
      onKeyDown={onKeyDown}
      // A second right-click inside the card is still about the card; the OS one
      // would cover the entry the user is aiming at.
      onContextMenu={(event) => event.preventDefault()}
      style={
        box === null
          ? undefined
          : {
              left: `${box.left}px`,
              top: `${box.top}px`,
              maxHeight: box.maxHeight === null ? undefined : `${box.maxHeight}px`,
            }
      }
    >
      {entries.map((entry, index) =>
        entry.kind === 'separator' ? (
          <div key={`separator:${index}`} className={cls.toolbarSeparator} role="separator" />
        ) : (
          <button
            key={entry.id}
            type="button"
            className={cls.toolbarItem}
            role="menuitem"
            // Focus stays on the container; an entry is a target, not a stop.
            tabIndex={-1}
            disabled={entry.disabled === true}
            // The entry's own id, which is what lets a test name the one entry it
            // means rather than counting rows.
            data-id={entry.id}
            data-active={String(index === active)}
            // The pointer and the arrow keys move the same highlight, so a toolbar
            // never points at an entry the pointer has already left.
            onPointerMove={() => setActive(index)}
            onClick={() => activate(index)}
          >
            <span className={cls.toolbarIcon} aria-hidden="true">
              {entry.icon}
            </span>
            <span className={cls.toolbarLabel}>{entry.label}</span>
          </button>
        ),
      )}
    </div>
  )
}
