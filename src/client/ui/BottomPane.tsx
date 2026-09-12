/**
 * The bottom pane: one region, two tabs — the recent commits and the diff of the
 * file the change list selected.
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
 * @module dsh-git-panel/client/ui/BottomPane
 */

import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'

import { pathParts } from '../../core/format.ts'
import type { GitRemoteClient } from '../../core/ports.ts'
import type { DiffArea } from '../../core/types.ts'
import { DiffPane } from './DiffView.tsx'
import { HistoryPanel } from './History.tsx'
import { PaneResizer } from './pane-resizer.tsx'
import { cls } from './styles.ts'
import type { Translate } from './translate.ts'
import { CaretGlyph, CloseGlyph } from './icons.tsx'

/** Which tab of the bottom pane is showing. */
export type BottomTab = 'history' | 'diff'

/** Smallest the pane may be dragged to: its own tab strip. */
const MIN_PANE_HEIGHT = 32

/**
 * Height kept for everything above the pane — the rail, the commit box and a
 * usable change list — however far the pointer travels.
 */
const PANE_RESERVED_HEIGHT = 200

/** One change-list row whose diff is open. */
export interface OpenFile {
  /** Repo-relative path. */
  readonly path: string
  /** Which comparison the row stands for (FR-2.2). */
  readonly area: DiffArea
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
  /** The panel's change counter, so an open diff re-reads when the repo moves. */
  readonly generation: number
  /** The file whose diff is open, or `null` when no row has been chosen. */
  readonly openFile: OpenFile | null
  /** Drop the diff tab and fold the pane back to its strip. */
  readonly onCloseDiff: () => void
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
  generation,
  openFile,
  onCloseDiff,
}: BottomPaneProps): ReactNode {
  const [tab, setTab] = useState<BottomTab>('history')
  /** Whether a panel is showing at all; the folded pane is just the strip. */
  const [expanded, setExpanded] = useState(false)
  /** `null` means "not dragged yet": the stylesheet's per-tab default applies. */
  const [height, setHeight] = useState<number | null>(null)

  // A row that was just clicked is what the user wants to look at, so the pane
  // opens on it — that is the whole interaction the change list promises.
  useEffect(() => {
    if (openFile === null) return
    setTab('diff')
    setExpanded(true)
  }, [openFile])

  const select = useCallback((next: BottomTab): void => {
    setTab(next)
    setExpanded(true)
  }, [])

  const closeDiff = useCallback((): void => {
    onCloseDiff()
    setTab('history')
    setExpanded(false)
  }, [onCloseDiff])

  const name = openFile === null ? '' : pathParts(openFile.path).name

  return (
    <div
      className={cls.bottom}
      data-bottom=""
      data-tab={tab}
      data-expanded={String(expanded)}
      // Folded, the pane is its strip: an explicit height would leave a blank
      // body, so it is only applied while a panel is showing — and it comes back
      // when the pane is expanded again.
      style={
        expanded && height !== null ? { height: `${height}px`, maxHeight: 'none' } : undefined
      }
    >
      <PaneResizer
        label={t('bottom.resize')}
        minHeight={MIN_PANE_HEIGHT}
        reserved={PANE_RESERVED_HEIGHT}
        onResize={(next) => {
          setHeight(next)
          setExpanded(true)
        }}
      />
      <div className={cls.bottomTabs} role="tablist" aria-label={t('bottom.tabs')}>
        <button
          type="button"
          role="tab"
          className={cls.bottomTab}
          aria-selected={tab === 'history' && expanded}
          data-active={tab === 'history' && expanded ? 'true' : undefined}
          onClick={() => select('history')}
        >
          {t('history.title')}
        </button>
        {openFile !== null && (
          // The label and its close button are siblings, never nested: a button
          // inside a button is invalid markup and the inner one is not reliably
          // clickable.
          <span className={cls.bottomTabGroup} data-active={tab === 'diff' && expanded ? 'true' : undefined}>
            <button
              type="button"
              role="tab"
              className={cls.bottomTab}
              aria-selected={tab === 'diff' && expanded}
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
        {/* Without this, folding the pane would be a drag-only gesture, and a
            drag is not something every input device can perform. */}
        <button
          type="button"
          className={cls.tool}
          title={expanded ? t('bottom.collapse') : t('bottom.expand')}
          aria-label={expanded ? t('bottom.collapse') : t('bottom.expand')}
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          <CaretGlyph className={cls.bottomChevron} />
        </button>
      </div>
      {expanded && (
        <div className={cls.bottomBody}>
          {/* Both panels stay mounted and the inactive one is hidden, rather than
              rendered on demand: a tab that forgets its commits, its loaded pages
              and its scroll position the moment you look at the other one is not
              a tab — and switching back would spend another git call. */}
          <div className={cls.bottomScroll} data-shown={String(tab === 'history')}>
            <HistoryPanel
              sessionId={sessionId}
              git={git}
              t={t}
              locale={locale}
              signal={signal}
              active={expanded && tab === 'history'}
            />
          </div>
          {openFile !== null && (
            <div className={cls.bottomDiff} data-shown={String(tab === 'diff')}>
              <DiffPane
                // Keyed by target so switching files remounts the pane: a fold or
                // a layout read must not leak from the file that was open before.
                key={`${openFile.path}\u0000${openFile.area}`}
                sessionId={sessionId}
                path={openFile.path}
                area={openFile.area}
                git={git}
                t={t}
                signal={signal}
                generation={generation}
                onClose={closeDiff}
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
