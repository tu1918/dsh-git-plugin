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

import { changeTreeOf, filesUnder, type ChangeTreeNode } from '../../core/change-tree.ts'
import { customIconFor, fileKindOf } from '../../core/file-kind.ts'
import { pathParts } from '../../core/format.ts'
import { badgeFor, type BadgeLetter } from '../../core/git-parse.ts'
import type { ChangeArea, FileChange } from '../../core/types.ts'
import type { GitPanelKey } from '../locales.ts'
import type { Translate } from './translate.ts'
import { cls } from './styles.ts'
import { useArmedKey } from './armed.ts'
import { dirKey, type ChangeView, type FileIcons } from './change-view.ts'
import { canDiscard } from './row-actions.ts'
import type { ToolbarPoint } from './toolbar.ts'
import {
  CaretGlyph,
  CheckGlyph,
  DiscardGlyph,
  FileKindGlyph,
  MinusGlyph,
  PlusGlyph,
} from './icons.tsx'

/**
 * What each badge letter says, in words, for its tooltip.
 *
 * The badge is a letter at the far right of the row — it used to sit at the front,
 * where the file-kind glyph is now — and a lone `M` is not something a reader
 * should have to decode, so the letter carries its meaning in a tooltip. One
 * letter, one sentence: the set is the panel's own (see {@link BadgeLetter}), so
 * nothing here needs the row's group to be read correctly. Typed as translation
 * KEYS, so a letter whose sentence is missing from the dictionaries is a compile
 * error rather than an empty tooltip.
 */
const STATUS_COPY: Readonly<Record<BadgeLetter, GitPanelKey>> = {
  M: 'status.modified',
  T: 'status.typeChanged',
  A: 'status.added',
  D: 'status.deleted',
  R: 'status.renamed',
  C: 'status.copied',
  U: 'status.untracked',
  '!': 'status.unmerged',
}

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
 * The selection checkbox a file row or a directory row carries.
 *
 * Not a native `<input type="checkbox">`: the row is a `role="button"` band whose
 * whole area opens the diff, and the checkbox is one of the controls inside it —
 * same containment story as the `+`/`−` strip. A wrapper span takes the
 * stopPropagation so ticking a box never opens a diff, and the box itself is a
 * real `role="checkbox"` button so the tick is one Tab stop with an
 * `aria-checked` state, including `mixed` for a directory whose files are only
 * partly chosen.
 */
export function RowCheckbox({
  checked,
  label,
  onToggle,
}: {
  /** Selected, unselected, or (a directory only) partly selected. */
  readonly checked: boolean | 'mixed'
  /** The accessible name; the caller builds it from the row's path. */
  readonly label: string
  readonly onToggle: () => void
}): ReactNode {
  return (
    <span className={cls.selectBoxWrap} onClick={(event) => event.stopPropagation()}>
      <button
        type="button"
        role="checkbox"
        aria-checked={checked}
        aria-label={label}
        className={cls.selectBox}
        onClick={onToggle}
      >
        {checked === true && <CheckGlyph size={10} />}
        {checked === 'mixed' && <MinusGlyph size={10} />}
      </button>
    </span>
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
 * The row also opens the panel's right-click toolbar (§9's file menu): a
 * right-click anywhere on the band, or Shift+F10 / the menu key while the row has
 * focus. What it hands over is a POINT, not itself — the card opens where the
 * pointer was, and a keyboard has no pointer, so that path measures the row
 * instead. Reading `event.currentTarget` here, rather than up in the panel, is
 * what makes both possible: a synthetic event's `currentTarget` is only valid
 * while the handler is running.
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
  selected,
  icons,
  onStage,
  onUnstage,
  onOpen,
  onMenu,
  onDiscard,
  onToggleSelect,
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
  /** Whether this row is part of the selection the group's batch acts on. */
  readonly selected: boolean
  /**
   * The deployment's own icons, extension to drawable URL (FR-1.2).
   *
   * Empty for every deployment that has not configured one, in which case a row
   * draws its built-in kind glyph — `customIconFor` is the whole rule.
   */
  readonly icons: FileIcons
  readonly onStage: (paths: readonly string[]) => void
  readonly onUnstage: (paths: readonly string[]) => void
  readonly onOpen: (entry: FileChange, area: ChangeArea) => void
  /**
   * Open this row's toolbar at a point, in viewport coordinates.
   *
   * The point travels with the call because the card is placed from it, and only
   * the row knows where the pointer was — or, when the keyboard asked, where the
   * row itself is.
   */
  readonly onMenu: (entry: FileChange, area: ChangeArea, point: ToolbarPoint) => void
  /** Discard this row's working-tree change, once the row is armed (FR-6.1). */
  readonly onDiscard: (entry: FileChange, area: ChangeArea) => void
  /** Add this row to the selection, or take it out. */
  readonly onToggleSelect: (path: string) => void
}): ReactNode {
  const { directory, name } = pathParts(entry.path)
  const badge = badgeFor(entry, area)
  const kind = fileKindOf(entry.path)
  // The deployment's icon for this extension, when it configured one; the built-in
  // kind glyph is the fallback, so an unconfigured panel is exactly as before.
  const customIcon = customIconFor(entry.path, icons)
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
      data-selected={String(selected)}
      aria-label={t('diff.open', { path: entry.path })}
      onClick={() => onOpen(entry, area)}
      onContextMenu={(event) => {
        // A right-click on the row is the row's menu, not the browser's: the
        // native one would cover the panel and offer nothing this list can do.
        event.preventDefault()
        onMenu(entry, area, { x: event.clientX, y: event.clientY })
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
          // No pointer to open at: the row's own leading edge, just under it, is
          // where the pointer would have been.
          const rect = event.currentTarget.getBoundingClientRect()
          onMenu(entry, area, { x: rect.left + 12, y: rect.bottom })
          return
        }
        if (event.key !== 'Enter' && event.key !== ' ') return
        // Space would otherwise scroll the panel, which is not what pressing a
        // row means.
        event.preventDefault()
        onOpen(entry, area)
      }}
    >
      <RowCheckbox
        checked={selected}
        label={
          selected
            ? t('select.uncheck', { path: entry.path })
            : t('select.check', { path: entry.path })
        }
        onToggle={() => onToggleSelect(entry.path)}
      />
      {/* The leading column says WHAT the file is; the far right is the change
          STATUS column. The two used to be one `M`/`A`/`?` letter at the front,
          which a reader had to decode before they knew what they were looking at.
          A configured icon replaces the built-in glyph and is drawn as an image
          (see ui/file-icons.ts for why that is the safe shape). */}
      <span
        className={cls.fileIcon}
        data-kind={kind}
        data-icon={customIcon === undefined ? 'builtin' : 'custom'}
        aria-hidden="true"
      >
        {customIcon === undefined ? (
          <FileKindGlyph kind={kind} />
        ) : (
          <img className={cls.fileIconImg} src={customIcon} alt="" />
        )}
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
      {/* The change STATUS column: the row's own far right, to the right of the
          actions, so the letter is in the same place down the whole list whatever
          the file and whatever the row's controls are doing. The tooltip carries
          the meaning, because a lone `M` is not a sentence. */}
      <span className={cls.badge} data-status={badge} title={t(STATUS_COPY[badge])}>
        {badge}
      </span>
    </div>
  )
}

/** A group's bulk action (FR-3.2). */
export interface GroupBatch {
  /** Which way the group moves. */
  readonly kind: 'stage' | 'unstage'
  /** Run it over every path in the group. */
  readonly run: () => void
  /**
   * The selection-aware form of the same action, or `undefined` while nothing in
   * this group is selected: with rows checked the header button acts on exactly
   * those paths instead of the whole group, and says so.
   */
  readonly selection?: {
    /** How many rows are checked. */
    readonly count: number
    /** Run it over the selected paths only. */
    readonly run: () => void
  }
}

/**
 * The selection's destructive action, shown beside the bulk action (FR-6.1).
 *
 * Like every irreversible control here it arms rather than fires (§4.3): the
 * first click turns the button into its own confirmation, the second runs it.
 */
export interface GroupDanger {
  /** How many selected rows the confirmed click would discard. */
  readonly count: number
  /** Whether the first click has been spent. */
  readonly armed: boolean
  /** §4.3's first click: arm the confirmation. */
  readonly onArm: () => void
  /** The second click: discard the selection. */
  readonly onFire: () => void
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
  isSelected,
  onStage,
  onUnstage,
  onOpen,
  onMenu,
  onDiscard,
  onToggleSelect,
}: {
  readonly node: ChangeTreeNode
  readonly area: ChangeArea
  readonly depth: number
  readonly t: Translate
  readonly busy: boolean
  readonly view: ChangeView
  readonly isSelected: (path: string) => boolean
  readonly onStage: (paths: readonly string[]) => void
  readonly onUnstage: (paths: readonly string[]) => void
  readonly onOpen: (entry: FileChange, area: ChangeArea) => void
  readonly onMenu: (entry: FileChange, area: ChangeArea, point: ToolbarPoint) => void
  readonly onDiscard: (entry: FileChange, area: ChangeArea) => void
  /** Add a row to the selection, or take it out (called once per path). */
  readonly onToggleSelect: (path: string) => void
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
          selected={isSelected(node.entry.path)}
          icons={view.icons}
          onStage={onStage}
          onUnstage={onUnstage}
          onOpen={onOpen}
          onMenu={onMenu}
          onDiscard={onDiscard}
          onToggleSelect={onToggleSelect}
        />
      </div>
    )
  }

  // Keyed by area as well as path: each group builds its own tree (FR-1.1), so
  // folding `src` in the staged drawer must not fold it in Changes too.
  const key = dirKey(area, node.path)
  const folded = view.collapsedDirs.has(key)
  // The directory's box stands for its files, so its state is their state in
  // aggregate: every one chosen is "on", some chosen is "mixed" — which is the
  // honest answer when the user ticks one file under a folder and the folder
  // still holds four more.
  const under = filesUnder(node)
  const chosen = under.filter((entry) => isSelected(entry.path)).length
  const dirState = chosen === under.length ? true : chosen > 0 ? 'mixed' : false
  const toggleDirSelection = (): void => {
    // All chosen → drop them all; otherwise adopt them all. The guard on each
    // path keeps a 'mixed' box from first unticking the chosen file on its way
    // to ticking the rest.
    if (dirState === true) under.forEach((entry) => { if (isSelected(entry.path)) onToggleSelect(entry.path) })
    else under.forEach((entry) => { if (!isSelected(entry.path)) onToggleSelect(entry.path) })
  }
  return (
    <>
      <div className={cls.treeNode} style={indent} data-tree-dir={node.path}>
        <RowCheckbox
          checked={dirState}
          label={
            dirState === true
              ? t('select.uncheckDir', { path: node.path })
              : t('select.checkDir', { path: node.path })
          }
          onToggle={toggleDirSelection}
        />
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
            isSelected={isSelected}
            onStage={onStage}
            onUnstage={onUnstage}
            onOpen={onOpen}
            onMenu={onMenu}
            onDiscard={onDiscard}
            onToggleSelect={onToggleSelect}
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
  danger,
  emptyNote,
  resident,
  collapsed,
  view,
  onToggle,
  isSelected,
  onStage,
  onUnstage,
  onOpen,
  onMenu,
  onDiscard,
  onToggleSelect,
}: {
  readonly label: string
  readonly area: ChangeArea
  readonly entries: readonly FileChange[]
  readonly t: Translate
  readonly busy: boolean
  readonly batch?: GroupBatch
  /**
   * The selection's destructive action, beside the bulk action.
   *
   * Only working-tree groups pass it (a staged row has nothing to discard), and
   * only while their selection is non-empty: without rows checked there is no
   * second target for the two-click confirmation to hit.
   */
  readonly danger?: GroupDanger
  /**
   * Copy to show when the group has no rows, under its header.
   *
   * The three resident groups all carry one — a bare count of 0 never says
   * whether it means "nothing here" or "this was never read". The conflict
   * group has none: it is not resident, and while a merge is open its emptiness
   * (no conflicts left) is not the question the panel has to answer.
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
  /** Whether one row is part of the selection, by path. */
  readonly isSelected: (path: string) => boolean
  readonly onStage: (paths: readonly string[]) => void
  readonly onUnstage: (paths: readonly string[]) => void
  readonly onOpen: (entry: FileChange, area: ChangeArea) => void
  readonly onMenu: (entry: FileChange, area: ChangeArea, point: ToolbarPoint) => void
  readonly onDiscard: (entry: FileChange, area: ChangeArea) => void
  /** Add a row to the selection, or take it out (called once per path). */
  readonly onToggleSelect: (path: string) => void
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
            it — the resident groups pass an empty note, and the note is the
            explanation their disabled button's tooltip uses. With rows checked
            the same button becomes the selection's action: what it will move is
            no longer "everything" but "these N", and its label says so. */}
        {(batch !== undefined && (entries.length > 0 || emptyNote !== undefined)) ||
        danger !== undefined ? (
          <span className={cls.groupActions}>
            {danger !== undefined && (
              // The selection's discard is the one irreversible bulk action, and it
              // is drawn on the LEFT and in the quiet ghost ink: it used to sit to
              // the right of the bulk action in the danger colour, and the product
              // owner reported reaching for it out of habit and discarding work by
              // mistake — a destructive control must not be the one the eye lands on
              // first. It still arms rather than fires, and only the armed state (the
              // second click, §4.3) takes the danger colour and says so in words.
              <button
                type="button"
                className={danger.armed ? cls.danger : cls.ghost}
                data-armed={String(danger.armed)}
                disabled={busy}
                onClick={danger.armed ? danger.onFire : danger.onArm}
              >
                {!danger.armed && <DiscardGlyph size={13} />}
                {danger.armed
                  ? t('action.discardSelectedArmed', { count: danger.count })
                  : t('action.discardSelected', { count: danger.count })}
              </button>
            )}
            {batch !== undefined && (entries.length > 0 || emptyNote !== undefined) && (
              <button
                type="button"
                className={cls.ghost}
                // The state the eye should land on: with rows checked this button is
                // the primary action, and the stylesheet fills it with the panel's
                // own primary button colour (`.groupActions .ghost[data-selected]`).
                data-selected={String(batch.selection !== undefined)}
                // A group with no rows has nothing to move, so the bulk action is
                // unavailable rather than a round trip that comes back as a refused
                // request. The resident groups are why this matters in practice:
                // they keep their button while empty, and each one's empty note is
                // what explains the grey.
                disabled={busy || entries.length === 0}
                title={
                  entries.length === 0 && emptyNote !== undefined
                    ? `${batch.kind === 'stage' ? t('action.stageAll') : t('action.unstageAll')} · ${emptyNote}`
                    : undefined
                }
                onClick={batch.selection !== undefined ? batch.selection.run : batch.run}
              >
                {/* The glyph says which way the rows move before the label is read:
                    + is stage (and marking a conflict resolved), − is unstage. */}
                {batch.kind === 'stage' ? <PlusGlyph size={13} /> : <MinusGlyph size={13} />}
                {batch.selection !== undefined
                  ? batch.kind === 'stage'
                    ? t('action.stageSelected', { count: batch.selection.count })
                    : t('action.unstageSelected', { count: batch.selection.count })
                  : batch.kind === 'stage'
                    ? t('action.stageAll')
                    : t('action.unstageAll')}
              </button>
            )}
          </span>
        ) : null}
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
            selected={isSelected(entry.path)}
            icons={view.icons}
            onStage={onStage}
            onUnstage={onUnstage}
            onOpen={onOpen}
            onMenu={onMenu}
            onDiscard={onDiscard}
            onToggleSelect={onToggleSelect}
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
            isSelected={isSelected}
            onStage={onStage}
            onUnstage={onUnstage}
            onOpen={onOpen}
            onMenu={onMenu}
            onDiscard={onDiscard}
            onToggleSelect={onToggleSelect}
          />
        ))}
    </section>
  )
}
