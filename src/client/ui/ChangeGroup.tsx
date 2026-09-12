/**
 * One change group: its header, its bulk action, and its rows.
 *
 * It is its own module because the group is drawn in two different containers —
 * the resident drawers above and below the commit box, and the plain section the
 * conflicts still live in — and the two must not drift: a bare `+`, a count that
 * survives a fold, and a bulk action that stays on screen are properties of "a
 * group", not of where it happens to sit.
 *
 * The rows inside it take one of FR-1.3's two shapes, and the shape is decided
 * here rather than by the containers, for the same reason: both modes exist in
 * both containers, and a second copy of this markup is how the two would drift.
 *
 * @module dsh-git-panel/client/ui/ChangeGroup
 */

import type { ReactNode } from 'react'

import { changeTreeOf, type ChangeTreeNode } from '../../core/change-tree.ts'
import { pathParts } from '../../core/format.ts'
import { badgeFor } from '../../core/git-parse.ts'
import type { ChangeArea, FileChange } from '../../core/types.ts'
import type { Translate } from './translate.ts'
import { cls } from './styles.ts'
import { dirKey, type ChangeView } from './change-view.ts'
import { CaretGlyph, MinusGlyph, PlusGlyph } from './icons.tsx'

/** One glyph button with a tooltip and an accessible name. */
export function ToolButton({
  label,
  disabled,
  pressed,
  onClick,
  children,
}: {
  readonly label: string
  readonly disabled?: boolean
  /**
   * Whether this control is a toggle that is currently on.
   *
   * `undefined` means "not a toggle": passing it always would turn every icon
   * button into a two-state control as far as a screen reader is concerned.
   */
  readonly pressed?: boolean
  readonly onClick: () => void
  readonly children: ReactNode
}): ReactNode {
  return (
    <button
      type="button"
      className={cls.tool}
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled === true}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

/**
 * One changed file, with the badge its group gives it and its staging action.
 *
 * The whole row opens the diff (FR-2.1) rather than only its path: a row is the
 * unit the list is made of, and the row is what the pointer is on. That makes the
 * `+`/`−` buttons inside it a conflict of intent — pressing one must stage, and
 * must NOT also open a diff — so the action strip stops the click from reaching
 * the row. The strip is a plain `div` for exactly that: `ToolButton` keeps its
 * one-argument `onClick` signature, and the containment lives where the layout
 * says it does.
 */
export function ChangeRow({
  entry,
  area,
  t,
  busy,
  showDirectory = true,
  onStage,
  onUnstage,
  onOpen,
}: {
  readonly entry: FileChange
  readonly area: ChangeArea
  readonly t: Translate
  readonly busy: boolean
  /**
   * Whether the row draws the directory part of the path.
   *
   * `false` in the tree, where the directories are the nodes above the row and
   * repeating them on every row would be the same text twice — and, in a narrow
   * sidebar, the reason the file name itself gets truncated.
   */
  readonly showDirectory?: boolean
  readonly onStage: (paths: readonly string[]) => void
  readonly onUnstage: (paths: readonly string[]) => void
  readonly onOpen: (entry: FileChange, area: ChangeArea) => void
}): ReactNode {
  const { directory, name } = pathParts(entry.path)
  const badge = badgeFor(entry, area)
  // A rename is the one case where the row cannot stand alone: the new path is
  // only half the story, so the original joins the tooltip.
  const tooltip =
    entry.origPath === undefined ? entry.path : `${entry.origPath} → ${entry.path}`
  // A staged row offers `−`; everything else offers `+`. For a conflict, `+` is
  // also how a merge is marked resolved — the same command git would be given
  // (FR-9.2) — so it is labelled as what it does there rather than as "stage".
  const canUnstage = area === 'staged'
  const stageLabel =
    area === 'conflicted' ? t('action.markResolved', { path: entry.path }) : t('action.stage')

  return (
    <div
      className={cls.row}
      title={tooltip}
      role="button"
      tabIndex={0}
      aria-label={t('diff.open', { path: entry.path })}
      onClick={() => onOpen(entry, area)}
      onKeyDown={(event) => {
        // Only the row's own key press counts. A key press on the `+`/`−` inside
        // it bubbles here, and Space activates a button — so without this guard,
        // staging by keyboard would also open a diff, the same bug the click
        // handler's `stopPropagation` prevents for the mouse.
        if (event.target !== event.currentTarget) return
        if (event.key !== 'Enter' && event.key !== ' ') return
        // Space would otherwise scroll the panel, which is not what pressing a
        // row means.
        event.preventDefault()
        onOpen(entry, area)
      }}
    >
      <span className={cls.badge} data-status={badge}>
        {badge}
      </span>
      <span className={cls.path}>
        {showDirectory && directory !== '' && <span className={cls.pathDir}>{directory}</span>}
        <span className={cls.pathName}>{name}</span>
      </span>
      <span className={cls.rowActions} onClick={(event) => event.stopPropagation()}>
        {!canUnstage && (
          <ToolButton
            label={stageLabel}
            disabled={busy}
            onClick={() => onStage([entry.path])}
          >
            {/* Bigger than the rail's tool glyphs: this is the row's main click,
                and the row is where the panel is used most. */}
            <PlusGlyph size={16} />
          </ToolButton>
        )}
        {canUnstage && (
          <ToolButton
            label={t('action.unstage')}
            disabled={busy}
            onClick={() => onUnstage([entry.path])}
          >
            <MinusGlyph size={16} />
          </ToolButton>
        )}
      </span>
    </div>
  )
}

/** A group's bulk action (FR-3.2). */
export interface GroupBatch {
  /** Which way the whole group moves. */
  readonly kind: 'stage' | 'unstage'
  /** Run it over every path in the group. */
  readonly run: () => void
}

/**
 * How far one tree level is indented, in CSS pixels.
 *
 * Small on purpose: the sidebar is narrow, and the directories that carry the
 * structure are usually compacted into one node (`core/change-tree.ts`), so a
 * deep-looking path still costs only one or two levels of indent.
 */
const INDENT_PX = 14

/**
 * One node of a group's tree: a directory's disclosure row, or a change row.
 *
 * Indentation is the wrapper's left padding rather than the row's own, so the row
 * keeps the padding the stylesheet gives every row in both modes — one place owns
 * "how a row is laid out", and the tree only says how deep it sits.
 */
function TreeNodeView({
  node,
  area,
  depth,
  t,
  busy,
  view,
  onStage,
  onUnstage,
  onOpen,
}: {
  readonly node: ChangeTreeNode
  readonly area: ChangeArea
  readonly depth: number
  readonly t: Translate
  readonly busy: boolean
  readonly view: ChangeView
  readonly onStage: (paths: readonly string[]) => void
  readonly onUnstage: (paths: readonly string[]) => void
  readonly onOpen: (entry: FileChange, area: ChangeArea) => void
}): ReactNode {
  const indent = { paddingLeft: `${depth * INDENT_PX}px` }

  if (node.kind === 'file') {
    return (
      <div className={cls.treeNode} style={indent} data-tree-file={node.entry.path}>
        <ChangeRow
          entry={node.entry}
          area={area}
          t={t}
          busy={busy}
          showDirectory={false}
          onStage={onStage}
          onUnstage={onUnstage}
          onOpen={onOpen}
        />
      </div>
    )
  }

  // Keyed by area as well as path: each group builds its own tree (FR-1.1), so
  // folding `src` in the staged drawer must not fold it in Changes too.
  const key = dirKey(area, node.path)
  const folded = view.collapsedDirs.has(key)
  return (
    <>
      <div className={cls.treeNode} style={indent} data-tree-dir={node.path}>
        <button
          type="button"
          className={cls.dirToggle}
          aria-expanded={!folded}
          title={node.path}
          onClick={() => view.onToggleDir(key)}
        >
          <CaretGlyph className={cls.groupCaret} />
          <span className={cls.dirName}>{node.label}</span>
          {/* The count is what makes a folded directory still informative: "there
              are 12 changed files in here" is the reason to open it. */}
          <span className={cls.count}>{node.count}</span>
        </button>
      </div>
      {!folded &&
        node.children.map((child) => (
          <TreeNodeView
            key={child.kind === 'dir' ? `dir:${child.path}` : `file:${child.entry.path}`}
            node={child}
            area={area}
            depth={depth + 1}
            t={t}
            busy={busy}
            view={view}
            onStage={onStage}
            onUnstage={onUnstage}
            onOpen={onOpen}
          />
        ))}
    </>
  )
}

/**
 * One group of changes: a disclosure header, its count, its bulk action, and its
 * rows.
 *
 * The bulk action is FR-3.2 and it is not a convenience: §1.3's fourth lesson is
 * that a first commit of a few dozen untracked files is a disaster when each one
 * needs its own `+`.
 *
 * The header folds the group (§4.2 draws exactly that caret). The count stays on
 * screen while folded, because "there are 37 untracked files" is the reason to
 * open it and hiding the number as well would make folding the same as losing
 * them. The caret, the name and the count are one button and the bulk action is
 * its SIBLING — a button inside a button is invalid, and the inner one would not
 * be clickable in every browser.
 */
export function Group({
  label,
  area,
  entries,
  t,
  busy,
  batch,
  emptyNote,
  collapsed,
  view,
  onToggle,
  onStage,
  onUnstage,
  onOpen,
}: {
  readonly label: string
  readonly area: ChangeArea
  readonly entries: readonly FileChange[]
  readonly t: Translate
  readonly busy: boolean
  readonly batch?: GroupBatch
  /**
   * Copy to show when the group has no rows, which also keeps the group on
   * screen. Without it an empty group renders nothing at all — right for a list
   * that comes and goes, wrong for the staged drawer, which is the anchor of the
   * commit box above it and should not vanish the moment the index is empty.
   */
  readonly emptyNote?: string
  /** Whether the group's rows are folded away. */
  readonly collapsed: boolean
  /** FR-1.3: which shape the rows take, and which directories are folded. */
  readonly view: ChangeView
  /** Fold or unfold this group. */
  readonly onToggle: () => void
  readonly onStage: (paths: readonly string[]) => void
  readonly onUnstage: (paths: readonly string[]) => void
  readonly onOpen: (entry: FileChange, area: ChangeArea) => void
}): ReactNode {
  if (entries.length === 0 && emptyNote === undefined) return null
  // Built once per render, and only when it will be drawn: the flat list is a
  // direct map, so a mode switch is the only thing that pays for the tree, and a
  // folded group pays for nothing at all.
  const tree = !collapsed && view.mode === 'tree' ? changeTreeOf(entries) : []
  return (
    <section className={cls.group} data-group={area} data-collapsed={String(collapsed)}>
      <div className={cls.groupHead}>
        <button
          type="button"
          className={cls.groupToggle}
          aria-expanded={!collapsed}
          title={collapsed ? t('group.expand') : t('group.collapse')}
          onClick={onToggle}
        >
          <CaretGlyph className={cls.groupCaret} />
          <span className={cls.groupLabel}>{label}</span>
          <span className={cls.count}>{entries.length}</span>
        </button>
        {batch !== undefined && (
          <span className={cls.groupActions}>
            <button
              type="button"
              className={cls.ghost}
              // A group with no rows has nothing to move, so the bulk action is
              // unavailable rather than a round trip that comes back as a refused
              // request. The staged drawer is why this matters in practice: it is
              // the one group that stays on screen while empty, so its "unstage
              // all" was a button that could only ever fail.
              disabled={busy || entries.length === 0}
              // The label alone ("Unstage all") would leave a greyed-out button
              // unexplained, so the group's own empty note completes the sentence.
              title={
                entries.length === 0 && emptyNote !== undefined
                  ? `${batch.kind === 'stage' ? t('action.stageAll') : t('action.unstageAll')} · ${emptyNote}`
                  : undefined
              }
              onClick={batch.run}
            >
              {batch.kind === 'stage' ? t('action.stageAll') : t('action.unstageAll')}
            </button>
          </span>
        )}
      </div>
      {!collapsed && entries.length === 0 && (
        <p className={cls.groupEmpty}>{emptyNote}</p>
      )}
      {!collapsed &&
        view.mode === 'list' &&
        entries.map((entry) => (
          <ChangeRow
            key={`${area}:${entry.path}`}
            entry={entry}
            area={area}
            t={t}
            busy={busy}
            onStage={onStage}
            onUnstage={onUnstage}
            onOpen={onOpen}
          />
        ))}
      {!collapsed &&
        tree.map((node) => (
          <TreeNodeView
            key={node.kind === 'dir' ? `dir:${node.path}` : `file:${node.entry.path}`}
            node={node}
            area={area}
            depth={0}
            t={t}
            busy={busy}
            view={view}
            onStage={onStage}
            onUnstage={onUnstage}
            onOpen={onOpen}
          />
        ))}
    </section>
  )
}
