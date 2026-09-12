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
 * A row also carries FR-6.1's discard button, and arms it itself (`useArmedKey`,
 * the same two-click pattern the branch picker uses). Its own arming state rather
 * than the panel's is deliberate: the panel's shared key belongs to the controls
 * in its own chrome, and a row that is re-rendered away takes its arm with it —
 * which is the safer half of the trade, since a discarded file has no row left to
 * re-aim at.
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
import { useArmedKey } from './armed.ts'
import { dirKey, type ChangeView } from './change-view.ts'
import { canDiscard } from './row-actions.ts'
import { CaretGlyph, DiscardGlyph, MinusGlyph, PlusGlyph } from './icons.tsx'

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
 *
 * The row also opens the panel's row menu (§9's file menu, M5a's first work
 * package): a right-click anywhere on the band, or Shift+F10 / the menu key while
 * the row has focus. The row is the anchor — the layer is measured from it — and
 * it is `event.currentTarget`, read here because a synthetic event's
 * `currentTarget` is only valid while the handler is running.
 *
 * And it carries FR-6.1's discard: on the working-tree rows (see
 * `ui/row-actions.ts` for which those are) the strip gains a third button which,
 * like every irreversible control here, arms instead of firing (§4.3).
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
  onMenu,
  onDiscard,
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
  /**
   * Open this row's menu, anchored on the row.
   *
   * The element travels with the call because the menu's layer is measured from
   * it, and only the row knows which element it is.
   */
  readonly onMenu: (entry: FileChange, area: ChangeArea, anchor: HTMLElement) => void
  /** Discard this row's working-tree change, once the row is armed (FR-6.1). */
  readonly onDiscard: (entry: FileChange, area: ChangeArea) => void
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
  // Which rows may discard at all is one rule, shared with the row menu
  // (`ui/row-actions.ts`): the menu must not offer what this row has no button for.
  const discardable = canDiscard(area)
  const { armed, arm, reset } = useArmedKey()
  const discardArmed = armed === entry.path
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
      onContextMenu={(event) => {
        // A right-click on the row is the row's menu, not the browser's: the
        // native one would cover the panel and offer nothing this list can do.
        event.preventDefault()
        onMenu(entry, area, event.currentTarget)
      }}
      onKeyDown={(event) => {
        // Only the row's own key press counts. A key press on the `+`/`−` inside
        // it bubbles here, and Space activates a button — so without this guard,
        // staging by keyboard would also open a diff, the same bug the click
        // handler's `stopPropagation` prevents for the mouse.
        if (event.target !== event.currentTarget) return
        // The keyboard's way into the row menu (§4.3's keyboard rules): the menu
        // key, or what a keyboard without one sends — Shift+F10.
        if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
          event.preventDefault()
          onMenu(entry, area, event.currentTarget)
          return
        }
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
        {discardable && !discardArmed && (
          <ToolButton
            label={t('action.discardPath', { path: entry.path })}
            disabled={busy}
            onClick={() => arm(entry.path)}
          >
            <DiscardGlyph size={15} />
          </ToolButton>
        )}
        {discardArmed && (
          // The armed state is words, not a tooltip: §4.3's pattern only works if
          // the second click is visibly a different click. While armed the strip
          // holds this button instead of the icon, and the pointer is on the row
          // (the arm came from this very button), so it is on screen.
          <button
            type="button"
            className={cls.danger}
            data-armed="true"
            disabled={busy}
            title={t('action.discardConfirm', { path: entry.path })}
            onClick={() => {
              reset()
              onDiscard(entry, area)
            }}
          >
            {t('action.discardArmed')}
          </button>
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
 * It is the disclosure caret's width (12) plus the gap that follows it (6), which
 * is what makes a child's row start exactly under its parent's NAME rather than
 * under its caret. Small on purpose, too: the sidebar is narrow, and a chain of
 * single-child directories is compacted into one node (`core/change-tree.ts`), so
 * a deep-looking path still costs only one or two levels of indent.
 */
const INDENT_PX = 18

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
  onMenu,
  onDiscard,
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
  readonly onMenu: (entry: FileChange, area: ChangeArea, anchor: HTMLElement) => void
  readonly onDiscard: (entry: FileChange, area: ChangeArea) => void
}): ReactNode {
  // Depth alone: the 12px that lines the tree up with the group header's caret
  // belongs to the button and the row themselves (both carry it in the
  // stylesheet), so there is one place — not two — that knows about it.
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
          onMenu={onMenu}
          onDiscard={onDiscard}
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
            onMenu={onMenu}
            onDiscard={onDiscard}
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
  resident,
  collapsed,
  view,
  onToggle,
  onStage,
  onUnstage,
  onOpen,
  onMenu,
  onDiscard,
}: {
  readonly label: string
  readonly area: ChangeArea
  readonly entries: readonly FileChange[]
  readonly t: Translate
  readonly busy: boolean
  readonly batch?: GroupBatch
  /**
   * Copy to show when the group has no rows, under its header.
   *
   * Only the staged drawer has one: its header alone does not say why it is empty,
   * and it is the anchor of the commit box above it. The working-tree sections
   * answer the same question with their count, which is why they are
   * {@link resident} without a note.
   */
  readonly emptyNote?: string
  /**
   * Whether the group stays on screen with no rows.
   *
   * A resident group is a section of the panel's furniture: its header and count
   * are how the panel says "there is nothing here", and keeping them means the
   * list does not re-flow the moment the first file appears. A group that comes
   * and goes is the other kind of thing — the conflict section exists while a
   * merge is open and not for one minute longer.
   */
  readonly resident?: boolean
  /** Whether the group's rows are folded away. */
  readonly collapsed: boolean
  /** FR-1.3: which shape the rows take, and which directories are folded. */
  readonly view: ChangeView
  /** Fold or unfold this group. */
  readonly onToggle: () => void
  readonly onStage: (paths: readonly string[]) => void
  readonly onUnstage: (paths: readonly string[]) => void
  readonly onOpen: (entry: FileChange, area: ChangeArea) => void
  readonly onMenu: (entry: FileChange, area: ChangeArea, anchor: HTMLElement) => void
  readonly onDiscard: (entry: FileChange, area: ChangeArea) => void
}): ReactNode {
  // An empty group is drawn when the caller says it is furniture, or when it has
  // an empty note to show — the note is what a resident group says INSTEAD of
  // rows, so a caller that asked for one gets the band it belongs to.
  if (entries.length === 0 && resident !== true && emptyNote === undefined) return null
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
        {/* The bulk action follows the rows: an empty section offers nothing to
            move, so its button would be a disabled control with nothing to explain
            it. The staged drawer is the exception, and it is the caller's to make:
            it passes an empty note, and the note is the explanation. */}
        {batch !== undefined &&
          (entries.length > 0 || emptyNote !== undefined) && (
            <span className={cls.groupActions}>
              <button
                type="button"
                className={cls.ghost}
                // A group with no rows has nothing to move, so the bulk action is
                // unavailable rather than a round trip that comes back as a refused
                // request. The staged drawer is why this matters in practice: it is
                // the one group that keeps its button while empty, and its own empty
                // note is what explains the grey.
                disabled={busy || entries.length === 0}
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
      {!collapsed && entries.length === 0 && emptyNote !== undefined && (
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
            onMenu={onMenu}
            onDiscard={onDiscard}
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
            onMenu={onMenu}
            onDiscard={onDiscard}
          />
        ))}
    </section>
  )
}
