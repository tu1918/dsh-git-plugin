/**
 * A menu's contents: its entries, and the keyboard that drives them.
 *
 * §9 registers exactly two row menus for this panel — a commit's "restore / pick"
 * and a file's "discard / copy" — and M5a's discard joins the second (§10.1). All
 * three need the same three things: labelled entries, hairline separators between
 * groups of them, and ONE highlight that the pointer and the arrow keys both move.
 * This module is that layer. The floating box that positions it, dismisses it on
 * Escape and on a press outside it is `ui/popover.tsx` — the same general piece the
 * branch list already uses — so a row menu is "that layer, plus this content".
 *
 * Two decisions are worth stating, because each has a cheaper alternative that is
 * wrong here:
 *
 * - **Hand-rolled, not primitives' `Menu`.** The dependency rule (§5.2, third
 *   arrow) keeps `src/client/ui/**` free of DSH, so primitives' Menu cannot be
 *   named here at all; wrapping it in `client/adapter/` would put a menu's chrome
 *   behind an adapter while this panel's own popover is what positions it. The
 *   guard that holds that line is `test/dependency-direction.test.ts`.
 * - **One highlight, not two states.** The entry the pointer is over and the entry
 *   the arrow keys are on are the same `data-active` row, and the first entry is
 *   active when the menu opens (the ARIA menu pattern). A menu whose hover and
 *   keyboard selection can disagree about what Enter will do is a menu that lies
 *   about its own next click.
 *
 * The model carries `separator`, `danger` and `disabled` because the menus above
 * need them: a group of copying entries, then the destructive ones (§9's own
 * shape), and an operation the panel is already running.
 *
 * @module dsh-git-panel/client/ui/menu
 */

import { useLayoutEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react'

import { cls } from './styles.ts'

/** A hairline between two groups of entries. */
export interface MenuSeparator {
  readonly kind: 'separator'
}

/** One thing a menu can do. */
export interface MenuItem {
  readonly kind: 'item'
  /** Identity of the entry, keying its row. */
  readonly id: string
  /** What the entry says. */
  readonly label: string
  /** Run it. The menu closes first, the way every other control here behaves. */
  readonly onSelect: () => void
  /** Whether this entry cannot run right now, such as while an operation is in flight. */
  readonly disabled?: boolean
  /** Whether the entry destroys something, and so takes the danger colour (§4.3). */
  readonly danger?: boolean
  /**
   * Whether activating this entry leaves the menu open.
   *
   * It is §4.3's first click: the entry arms rather than acts, and the menu has to
   * stay up for the second click to be possible. The entry says so in its own
   * label between the two clicks (the caller rebuilds it from the armed state),
   * which is what makes the second click visibly a different one. Without this
   * flag the menu closes on the arm and the confirmation has nowhere to happen.
   */
  readonly stayOpen?: boolean
}

/** One row of a menu. */
export type MenuEntry = MenuSeparator | MenuItem

/** Everything the menu renders from. */
export interface MenuProps {
  /** The entries, in the order they are drawn. */
  readonly entries: readonly MenuEntry[]
  /** Accessible name for the menu: the row it belongs to. */
  readonly label: string
  /** Dismiss the menu. */
  readonly onClose: () => void
}

/** Whether an entry can be activated. */
function usable(entry: MenuEntry | undefined): entry is MenuItem {
  return entry !== undefined && entry.kind === 'item' && entry.disabled !== true
}

/** The index of the first entry that can be activated, or -1 when there is none. */
function firstEnabled(entries: readonly MenuEntry[]): number {
  return entries.findIndex((entry) => usable(entry))
}

/**
 * The next activatable entry, wrapping the way arrow keys do.
 *
 * Disabled entries and separators are stepped over rather than landed on: a
 * highlight that can sit on a row which does nothing would make Enter look broken.
 * @param entries - The menu's entries.
 * @param from - The active index, or -1 when nothing is active yet.
 * @param delta - `1` for down, `-1` for up.
 * @returns The index to activate next, or -1 when every entry is disabled.
 */
function stepEnabled(entries: readonly MenuEntry[], from: number, delta: number): number {
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
 * A menu: focusable, arrow-navigable, closed by Escape or Tab.
 * @param props - The entries, the menu's name, and its dismissal.
 */
export function Menu({ entries, label, onClose }: MenuProps): ReactNode {
  const ref = useRef<HTMLDivElement | null>(null)
  const [active, setActive] = useState(() => firstEnabled(entries))

  // Focus the menu itself rather than its first entry: the container is what the
  // arrow keys listen on, and focusing an entry would also make Space activate it
  // natively (the double-activation the guard in `onKeyDown` exists to prevent).
  // The first entry is still the active one, so Enter works without an arrow key.
  //
  // The cleanup hands focus back to whatever had it — the row that opened this
  // menu with Shift+F10 — but only when focus is still ours or nowhere at all: a
  // press outside moved it somewhere the user chose, and taking it back would undo
  // that click.
  useLayoutEffect(() => {
    const layer = ref.current
    const previous = document.activeElement
    layer?.focus()
    return () => {
      const now = document.activeElement
      const ours = layer?.contains(now) === true
      if (!ours && now !== null && now !== document.body) return
      if (previous instanceof HTMLElement && previous !== document.body && previous.isConnected) {
        previous.focus()
      }
    }
  }, [])

  const activate = (index: number): void => {
    const entry = entries[index]
    if (!usable(entry)) return
    // Close first, then act, like the branch picker: the layer is gone before the
    // operation's own state arrives, so nothing renders into a menu that is
    // already leaving. An entry that stays open is the exception, and it is the
    // two-click confirmation: the menu IS the control both clicks belong to.
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
      case 'Escape':
        // The layer closes on Escape too. Doing it here as well keeps this module
        // usable on its own, and two closes of one menu are one state.
        event.preventDefault()
        onClose()
        break
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
      className={cls.menu}
      role="menu"
      aria-label={label}
      tabIndex={-1}
      data-menu="true"
      onKeyDown={onKeyDown}
      // A second right-click inside the menu is still about the menu; the OS one
      // would cover the entry the user is aiming at.
      onContextMenu={(event) => event.preventDefault()}
    >
      {entries.map((entry, index) =>
        entry.kind === 'separator' ? (
          <div key={`separator:${index}`} className={cls.menuSeparator} role="separator" />
        ) : (
          <button
            key={entry.id}
            type="button"
            className={cls.menuItem}
            role="menuitem"
            // Focus stays on the container; an entry is a target, not a stop.
            tabIndex={-1}
            disabled={entry.disabled === true}
            data-active={String(index === active)}
            data-danger={String(entry.danger === true)}
            // The pointer and the arrow keys move the same highlight, so a menu
            // never points at an entry the pointer has already left.
            onPointerMove={() => setActive(index)}
            onClick={() => activate(index)}
          >
            {entry.label}
          </button>
        ),
      )}
    </div>
  )
}
