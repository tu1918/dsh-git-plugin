/**
 * One resident change drawer: a grip, a body that scrolls, and a group inside it.
 *
 * The staged drawer was the first of these, and it earned its shape: it stays on
 * screen when its group is empty (it is the commit box's anchor), it takes its
 * own height from a grip, and past that height it scrolls inside itself so a
 * twenty-file group cannot push the rest of the panel off screen. The working
 * tree's groups want exactly the same three things, so they are the same
 * component rather than three copies of the same markup — "每个分区的高度要能自己
 * 拖" is a property of a partition, not of the index.
 *
 * A drawer is `flex: 0 0 auto` in the body it sits in, with the grip as its first
 * child, because {@link PaneResizer} reads its parent's box for the drag's
 * starting height. The height stays `null` until a drag: the stylesheet's own
 * cap (`max-height: 40%`) then applies, so a window resize keeps meaning what it
 * meant.
 *
 * @module dsh-git-panel/client/ui/ChangeGroupPane
 */

import { useState } from 'react'
import type { ReactNode } from 'react'

import type { ChangeArea, FileChange } from '../../core/types.ts'
import { Group, type GroupBatch } from './ChangeGroup.tsx'
import { PaneResizer } from './pane-resizer.tsx'
import { cls } from './styles.ts'
import type { Translate } from './translate.ts'

/** Smallest a drawer may be dragged to: its header, which must stay usable. */
const MIN_PANE_HEIGHT = 44

/**
 * Height kept for the rest of the column — the rail, the commit box, the other
 * drawers, and a usable bottom pane — however far the pointer travels.
 *
 * Like the staged drawer's own reserve, this is deliberately generous: a grip
 * that can starve the panes below it makes the layout worse, not more flexible.
 */
const RESERVED_HEIGHT = 180

/** What one drawer is handed, beyond the group it draws. */
export interface ChangeGroupPaneProps {
  /** Which group this drawer hosts. */
  readonly area: ChangeArea
  /** The group's name. */
  readonly label: string
  /** The grip's accessible name, from the panel's dictionary. */
  readonly resizeLabel: string
  /** The group's rows. */
  readonly entries: readonly FileChange[]
  /** The panel's copy. */
  readonly t: Translate
  /** Whether a mutation is in flight, which disables the group's actions. */
  readonly busy: boolean
  /** The group's bulk action (FR-3.2), when it has one. */
  readonly batch?: GroupBatch
  /**
   * Copy to show when the group is empty, which also keeps the drawer on screen.
   * Absent means the drawer comes and goes with its rows.
   */
  readonly emptyNote?: string
  /** Whether the group's rows are folded away. */
  readonly collapsed: boolean
  /** Fold or unfold this group. */
  readonly onToggle: () => void
  readonly onStage: (paths: readonly string[]) => void
  readonly onUnstage: (paths: readonly string[]) => void
  readonly onOpen: (entry: FileChange, area: ChangeArea) => void
}

/**
 * One drawer, sized from its own grip.
 * @param props - The group to draw and the copy that names its grip.
 */
export function ChangeGroupPane({
  area,
  label,
  resizeLabel,
  entries,
  t,
  busy,
  batch,
  emptyNote,
  collapsed,
  onToggle,
  onStage,
  onUnstage,
  onOpen,
}: ChangeGroupPaneProps): ReactNode {
  /** `null` means "not dragged yet": the stylesheet's cap applies. */
  const [height, setHeight] = useState<number | null>(null)

  return (
    <div className={cls.changeDrawer} data-drawer={area}>
      <PaneResizer
        label={resizeLabel}
        minHeight={MIN_PANE_HEIGHT}
        reserved={RESERVED_HEIGHT}
        onResize={setHeight}
      />
      <div
        className={cls.changeBody}
        style={height === null ? undefined : { height: `${height}px`, maxHeight: 'none' }}
      >
        <Group
          label={label}
          area={area}
          entries={entries}
          t={t}
          busy={busy}
          batch={batch}
          emptyNote={emptyNote}
          collapsed={collapsed}
          onToggle={onToggle}
          onStage={onStage}
          onUnstage={onUnstage}
          onOpen={onOpen}
        />
      </div>
    </div>
  )
}
