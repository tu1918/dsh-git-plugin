/**
 * The bottom pane: one region, one strip of tabs — the recent commits, plus one
 * tab per open diff.
 *
 * "Opened" covers both ways into a diff: a change row (FR-2.1), and one file of a
 * commit read against that commit (FR-7.2). They are the same kind of reading —
 * one file's changes — so they share the strip rather than each growing a
 * surface, and more than one may be open at a time: the strip is this panel's
 * editor area, and comparing two files means having both in front of you.
 *
 * ## Why tabs instead of a stacked diff
 *
 * The diff first shipped as its own pane docked under the history, which meant
 * two panes competing for the bottom of the column: opening a diff pushed the
 * commit history out of the way, and closing it left a hole. They are the same
 * kind of thing — "read something about this repository that is not the change
 * list" — so they share one region and one height, and switching between them
 * costs a click instead of a scroll.
 *
 * ## Who owns the tab
 *
 * The tab is the panel's state, not this pane's: opening a diff is what a row or
 * a commit's file list decides, and a file may leave the change list while its
 * diff is open. This component renders the strip and the bodies from what it is
 * handed; only the height is its own. The two are one value there and here alike
 * — the dock is folded exactly when there is no tab.
 *
 * ## The height
 *
 * Folded, the pane is its tab strip and nothing else, which is the state the
 * panel starts in: the change list is the panel's subject and the pane must not
 * tax it. Selecting a tab expands the pane to that tab's own default (half the
 * screen for a diff, 40% for the history); dragging the grip replaces the default
 * with a pixel height, and the change list above takes whatever is left. The
 * defaults live in the stylesheet, keyed by `data-tab`, so a window resize keeps
 * meaning what it meant.
 *
 * The dock's height is a preference rather than component state
 * (`bottom-view.ts`), because a pane that re-sizes itself on every page load is
 * one the user has to push back every time. It opens on the history tab by
 * default.
 *
 * ## The tab is the switch
 *
 * There is no separate fold/unfold button: whether the pane is showing is
 * **whether a tab is active**. Clicking a tab activates it and opens the pane;
 * clicking the active tab again puts the pane away, which is the gesture the
 * chevron used to be — VS Code's panel tabs behave the same way, and it has to
 * exist in some form, because a fold that only a drag can perform is not available
 * to every input device.
 *
 * That also removes a state that could disagree with itself. A pane that keeps a
 * `tab` AND an `expanded` flag can end up expanded with no tab selected (which is
 * what a fold left behind), and then it renders an empty body; here the two are
 * one value, and `null` is the folded strip.
 *
 * ## What the height may cost
 *
 * The dock is the column's only draggable region, and the rest of the column has
 * floors (`panel-layout.ts`). Those two facts are one rule: a drag is clamped at
 * `panel − DOCK_RESERVED`, and the same number is written into this pane's
 * `max-height`, so a height remembered from a taller window is clamped too —
 * otherwise a reload in a shorter window would squeeze the change list below the
 * floor the budget promised it.
 *
 * @module dsh-git-panel/client/ui/BottomPane
 */

import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'

import { pathParts } from '../../core/format.ts'
import { diffTargetKey } from '../../core/diff-target.ts'
import type { GitRemoteClient } from '../../core/ports.ts'
import type { CommitInfo, DiffTarget } from '../../core/types.ts'
import { readBottomPane, writeBottomPane } from './bottom-view.ts'
import { DOCK_MIN_HEIGHT, DOCK_RESERVED } from './panel-layout.ts'
import { DiffPane } from './DiffView.tsx'
import { HistoryPanel } from './History.tsx'
import { PaneResizer } from './pane-resizer.tsx'
import type { ToolbarPoint } from './toolbar.ts'
import { cls } from './styles.ts'
import type { Translate } from './translate.ts'
import { CloseGlyph } from './icons.tsx'

/**
 * Which tab of the bottom pane is showing.
 *
 * `history` is the commit list; a `file` tab names ONE open diff by its key. The
 * dock is folded exactly when the tab is `null`, so "which tab" and "is it open"
 * remain one value.
 */
export type BottomTab =
  | { readonly kind: 'history' }
  | { readonly kind: 'file'; readonly key: string }

/** One change-list row or commit file whose diff is open. */
export interface OpenFile {
  /** Repo-relative path. */
  readonly path: string
  /**
   * Which comparison the row stands for (FR-2.2), or the commit FR-7.2 drilled
   * into. Both shapes of the panel's diff live in this one tab strip, so the
   * target travels with the path rather than the pane growing a second mode.
   */
  readonly target: DiffTarget
}

/**
 * The identity of one open diff: the path AND the comparison it is read with.
 *
 * Two entries with the same path but different targets are two different
 * readings, and they get two tabs — the same reason `diffTargetKey` exists.
 * @param file - One entry of the open-file list.
 * @returns A key unique per open diff.
 */
export function openFileKey(file: OpenFile): string {
  return `${file.path}\u0000${diffTargetKey(file.target)}`
}

/** What the pane is handed. */
export interface BottomPaneProps {
  /** The session whose repository is read. */
  readonly sessionId: string
  /** The host-facing git client. */
  readonly git: GitRemoteClient
  /** The panel's copy. */
  readonly t: Translate
  /** BCP-47 tag for relative-time wording. */
  readonly locale: string
  /** Aborted when the tab closes; cancels in-flight reads. */
  readonly signal?: AbortSignal
  /**
   * The diffs that are open, in the order their tabs were opened.
   *
   * More than one, because the strip is this panel's editor area: comparing two
   * files means having both open, not ping-ponging through a single tab. Every
   * one of them stays mounted while the dock is expanded, so switching back is a
   * paint rather than another git call.
   */
  readonly openFiles: readonly OpenFile[]
  /** Which tab is showing, or `null` when the dock is folded to its strip. */
  readonly tab: BottomTab | null
  /** Show a tab, or fold the dock with `null`. */
  readonly onTab: (next: BottomTab | null) => void
  /**
   * Drop one open diff — what the diff's own × does (FR-2.1).
   *
   * The strip carries no × of its own any more: the close control lives in the
   * diff's header, next to the path it closes.
   */
  readonly onCloseFile: (key: string) => void
  /**
   * Open a commit row's menu (§9's commit menu), owned by the panel above: the
   * armed confirmation and the action feedback both live there. `canUndo` says
   * whether the row is the newest, which is the only one FR-3.8 may undo.
   */
  readonly onCommitMenu?: (commit: CommitInfo, point: ToolbarPoint, canUndo: boolean) => void
  /**
   * Open one file of a commit as that commit changed it (FR-7.2).
   *
   * Required, unlike the menu above it: this is the drill-down FR-7.2 asks for,
   * and the history panel's file rows are buttons exactly because someone can
   * always answer them. Owned by the panel above for the same reason the menu is
   * — opening a diff means closing the layers the rail owns, and this pane is not
   * where they live.
   */
  readonly onOpenCommitFile: (commit: CommitInfo, path: string) => void
}

/**
 * The tabbed bottom pane.
 * @param props - The session, the client, the open diffs, and the selected tab.
 */
export function BottomPane({
  sessionId,
  git,
  t,
  locale,
  signal,
  openFiles,
  tab,
  onTab,
  onCloseFile,
  onCommitMenu,
  onOpenCommitFile,
}: BottomPaneProps): ReactNode {
  /**
   * How tall the dock was dragged, or `null` for the stylesheet's per-tab default.
   *
   * The dock's own state is a preference rather than component state
   * (`bottom-view.ts`), because a pane that re-sizes itself on every page load is
   * one the user has to push back every time. Whether it is OPEN is not read here
   * — that is the tab, and the tab belongs to the panel above, which is where a
   * file gets opened in the first place.
   */
  const [height, setHeight] = useState<number | null>(() => readBottomPane().height)
  const expanded = tab !== null

  useEffect(() => {
    writeBottomPane({ expanded, height })
  }, [expanded, height])

  /**
   * The file whose diff is showing, or `null` when the history is.
   *
   * The only case where it differs from the tab: a file tab can name an entry the
   * panel has since dropped (the row was committed or discarded). Pointing at a
   * tab that no longer exists would leave the body empty, so the dock falls back
   * to the history rather than showing a blank pane — and, since the user did not
   * close it, it stays open.
   */
  const shownFile =
    tab !== null && tab.kind === 'file'
      ? (openFiles.find((file) => openFileKey(file) === tab.key) ?? null)
      : null
  /** The tab's kind, which is what `data-tab` and the height defaults key on. */
  const shownKind: 'history' | 'diff' = shownFile === null ? 'history' : 'diff'

  const select = useCallback(
    (next: BottomTab): void => {
      // The active tab is a toggle: a second click puts the pane away. That is the
      // fold gesture the chevron used to carry, and the only non-drag one.
      const same =
        tab !== null &&
        (next.kind === 'history'
          ? tab.kind === 'history'
          : tab.kind === 'file' && tab.key === next.key)
      onTab(same ? null : next)
    },
    [onTab, tab],
  )

  const lastOpen = openFiles[openFiles.length - 1]

  return (
    <div
      className={cls.bottom}
      data-bottom=""
      data-tab={shownKind}
      data-expanded={String(expanded)}
      // Folded, the pane is its strip: an explicit height would leave a blank
      // body, so it is only applied while a panel is showing — and it comes back
      // when the pane is expanded again.
      style={
        expanded && height !== null
          ? // A dragged height wins over the per-tab default in the stylesheet, but
            // not over the column's budget: `maxHeight` is the same clamp the drag
            // itself was limited by, and it is what a remembered height from a
            // taller window runs into.
            { height: `${height}px`, maxHeight: `calc(100% - ${String(DOCK_RESERVED)}px)` }
          : undefined
      }
    >
      {/* The dock is bottom-anchored: its bottom edge is pinned to the panel's,
          so its free edge is the top one and a drag upward grows it. It is the
          panel's only grip — the change groups above flow into one scroller
          instead of carrying one each. */}
      <PaneResizer
        label={t('bottom.resize')}
        minHeight={DOCK_MIN_HEIGHT}
        reserved={DOCK_RESERVED}
        onResize={(next) => {
          setHeight(next)
          // Dragging the folded strip open needs a tab to show: the newest diff
          // if the panel has one open, the history otherwise.
          onTab(tab ?? (lastOpen === undefined ? { kind: 'history' } : { kind: 'file', key: openFileKey(lastOpen) }))
        }}
      />
      <div className={cls.bottomTabs} role="tablist" aria-label={t('bottom.tabs')}>
        <button
          type="button"
          role="tab"
          className={cls.bottomTab}
          // The one tab that is always there: it must not be squeezed out of the
          // strip by however many diffs are open.
          data-resident="true"
          aria-selected={expanded && shownKind === 'history'}
          data-active={expanded && shownKind === 'history' ? 'true' : undefined}
          // The hint appears only while this tab is the one showing, because that
          // is when a click means "put the pane away" rather than "show it".
          title={expanded && shownKind === 'history' ? t('bottom.collapse') : undefined}
          onClick={() => select({ kind: 'history' })}
        >
          {t('history.title')}
        </button>
        {openFiles.map((file) => {
          const key = openFileKey(file)
          const on = shownFile !== null && openFileKey(shownFile) === key
          return (
            // The label and its close control are SIBLINGS, never nested: a button
            // inside a button is invalid markup and the inner one is not reliably
            // clickable. The × is revealed by hovering or focusing this tab, so the
            // strip stays quiet until the pointer is on the tab it would close.
            <span key={key} className={cls.bottomTabGroup}>
              <button
                type="button"
                role="tab"
                className={cls.bottomTab}
                aria-selected={expanded && on}
                // The active-state attribute lives on the tab itself, so the rule
                // that draws the underline under it has something to match: put on a
                // wrapper, the selected diff would have no underline at all.
                data-active={expanded && on ? 'true' : undefined}
                // The full path, because the label may be shortened (FR-1.2).
                title={file.path}
                onClick={() => select({ kind: 'file', key })}
              >
                {pathParts(file.path).name}
              </button>
              <button
                type="button"
                className={cls.tool}
                data-close-tab={file.path}
                // Named per file: a strip of buttons all reading "close this diff"
                // would tell a screen reader nothing about which one it is on.
                title={t('bottom.closeFile', { path: file.path })}
                aria-label={t('bottom.closeFile', { path: file.path })}
                onClick={() => onCloseFile(key)}
              >
                <CloseGlyph />
              </button>
            </span>
          )
        })}
        <span className={cls.spacer} />
      </div>
      {expanded && (
        <div className={cls.bottomBody}>
          {/* Every open panel stays mounted and the inactive ones are hidden,
              rather than rendered on demand: a tab that forgets its commits, its
              loaded pages, its scroll position or its fold the moment you look at
              another one is not a tab — and switching back would spend another git
              call. The cost is one re-read per open diff when the repository
              really moves, which is the price of the tab the user opened. */}
          <div className={cls.bottomScroll} data-shown={String(shownFile === null)}>
            <HistoryPanel
              sessionId={sessionId}
              git={git}
              t={t}
              locale={locale}
              signal={signal}
              active={expanded && shownFile === null}
              onCommitMenu={onCommitMenu}
              onOpenCommitFile={onOpenCommitFile}
            />
          </div>
          {openFiles.map((file) => {
            const key = openFileKey(file)
            const on = shownFile !== null && openFileKey(shownFile) === key
            return (
              <div key={key} className={cls.bottomDiff} data-shown={String(on)}>
                <DiffPane
                  sessionId={sessionId}
                  path={file.path}
                  target={file.target}
                  git={git}
                  t={t}
                  signal={signal}
                  // Only the pane on screen answers Escape: several hidden panes
                  // each listening on the document would close every open diff at
                  // once, which is not what "close this one" means.
                  active={on}
                  onClose={() => onCloseFile(key)}
                />
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
