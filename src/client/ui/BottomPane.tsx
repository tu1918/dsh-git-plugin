/**
 * The bottom pane: one region, two tabs — the recent commits and the diff of the
 * file that was opened.
 *
 * "Opened" covers both ways in: a change row (FR-2.1), and one file of a commit
 * read against that commit (FR-7.2). They are the same kind of reading — one
 * file's changes — so they share the tab rather than each growing a surface.
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
 * The dock's own state — whether it is open and how tall it was dragged — is a
 * preference rather than component state (`bottom-view.ts`), because a pane that
 * closes itself on every page load is one the user has to re-open every time. It
 * opens on the history tab by default.
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
import { cls } from './styles.ts'
import type { Translate } from './translate.ts'
import { CloseGlyph } from './icons.tsx'

/** Which tab of the bottom pane is showing. */
export type BottomTab = 'history' | 'diff'

/** One change-list row or commit file whose diff is open. */
export interface OpenFile {
  /** Repo-relative path. */
  readonly path: string
  /**
   * Which comparison the row stands for (FR-2.2), or the commit FR-7.2 drilled
   * into. Both shapes of the panel's diff live in this one tab, so the target
   * travels with the path rather than the pane growing a second mode.
   */
  readonly target: DiffTarget
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
  /** The file whose diff is open, or `null` when no row has been chosen. */
  readonly openFile: OpenFile | null
  /** Drop the diff tab and fold the pane back to its strip. */
  readonly onCloseDiff: () => void
  /**
   * Open a commit row's menu (FR-3.8), owned by the panel above: the armed
   * confirmation and the action feedback both live there.
   */
  readonly onCommitMenu?: (commit: CommitInfo, anchor: HTMLElement) => void
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
 * @param props - The session, the client, the selected file, and the copy.
 */
export function BottomPane({
  sessionId,
  git,
  t,
  locale,
  signal,
  openFile,
  onCloseDiff,
  onCommitMenu,
  onOpenCommitFile,
}: BottomPaneProps): ReactNode {
  /**
   * The active tab, which is also whether the pane is open: `null` is the strip.
   *
   * Whether that is open comes from storage — a dock that folds itself on every
   * reload is one the user has to re-open every time — and so does the height it
   * was dragged to.
   */
  const [active, setActive] = useState<BottomTab | null>(() =>
    readBottomPane().expanded ? 'history' : null,
  )
  /** `null` means "not dragged yet": the stylesheet's per-tab default applies. */
  const [height, setHeight] = useState<number | null>(() => readBottomPane().height)

  useEffect(() => {
    writeBottomPane({ expanded: active !== null, height })
  }, [active, height])

  // A row that was just clicked is what the user wants to look at, so the pane
  // opens on it — that is the whole interaction the change list promises.
  useEffect(() => {
    if (openFile === null) return
    setActive('diff')
  }, [openFile])

  const expanded = active !== null
  /**
   * The tab whose panel is showing.
   *
   * The only case where it differs from {@link active}: the diff tab is the open
   * file, and the panel clears that file on its own when the row leaves the change
   * list (it was committed, or discarded). Pointing at a tab that no longer exists
   * would leave the body empty, so the dock falls back to the history rather than
   * showing a blank pane — and, since the user did not close it, it stays open.
   */
  const shown: BottomTab =
    active === 'diff' && openFile === null ? 'history' : (active ?? 'history')

  const select = useCallback((next: BottomTab): void => {
    // The active tab is a toggle: a second click puts the pane away. That is the
    // fold gesture the chevron used to carry, and the only non-drag one.
    setActive((current) => (current === next ? null : next))
  }, [])

  const closeDiff = useCallback((): void => {
    onCloseDiff()
    // The tab is gone, so nothing is active and the pane folds — what the × has
    // always meant.
    setActive(null)
  }, [onCloseDiff])

  const name = openFile === null ? '' : pathParts(openFile.path).name

  return (
    <div
      className={cls.bottom}
      data-bottom=""
      data-tab={shown}
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
          // Dragging the folded strip open needs a tab to show: the diff if the
          // panel has one open, the history otherwise.
          setActive((current) => current ?? (openFile === null ? 'history' : 'diff'))
        }}
      />
      <div className={cls.bottomTabs} role="tablist" aria-label={t('bottom.tabs')}>
        <button
          type="button"
          role="tab"
          className={cls.bottomTab}
          aria-selected={expanded && shown === 'history'}
          data-active={expanded && shown === 'history' ? 'true' : undefined}
          // The hint appears only while this tab is the one showing, because that
          // is when a click means "put the pane away" rather than "show it".
          title={expanded && shown === 'history' ? t('bottom.collapse') : undefined}
          onClick={() => select('history')}
        >
          {t('history.title')}
        </button>
        {openFile !== null && (
          // The label and its close button are siblings, never nested: a button
          // inside a button is invalid markup and the inner one is not reliably
          // clickable.
          <span className={cls.bottomTabGroup} data-active={expanded && shown === 'diff' ? 'true' : undefined}>
            <button
              type="button"
              role="tab"
              className={cls.bottomTab}
              aria-selected={expanded && shown === 'diff'}
              title={openFile.path}
              onClick={() => select('diff')}
            >
              {name}
            </button>
            <button
              type="button"
              className={cls.tool}
              title={t('diff.close')}
              aria-label={t('diff.close')}
              onClick={closeDiff}
            >
              <CloseGlyph />
            </button>
          </span>
        )}
        <span className={cls.spacer} />
      </div>
      {expanded && (
        <div className={cls.bottomBody}>
          {/* Both panels stay mounted and the inactive one is hidden, rather than
              rendered on demand: a tab that forgets its commits, its loaded pages
              and its scroll position the moment you look at the other one is not
              a tab — and switching back would spend another git call. */}
          <div className={cls.bottomScroll} data-shown={String(shown === 'history')}>
            <HistoryPanel
              sessionId={sessionId}
              git={git}
              t={t}
              locale={locale}
              signal={signal}
              active={expanded && shown === 'history'}
              onCommitMenu={onCommitMenu}
              onOpenCommitFile={onOpenCommitFile}
            />
          </div>
          {openFile !== null && (
            <div className={cls.bottomDiff} data-shown={String(shown === 'diff')}>
              <DiffPane
                // Keyed by target so switching files remounts the pane: a fold or
                // a layout read must not leak from the file that was open before.
                key={`${openFile.path}\u0000${diffTargetKey(openFile.target)}`}
                sessionId={sessionId}
                path={openFile.path}
                target={openFile.target}
                git={git}
                t={t}
                signal={signal}
                onClose={closeDiff}
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
