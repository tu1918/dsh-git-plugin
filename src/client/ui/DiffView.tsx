/**
 * The diff renderer (FR-2) and the pane that fetches what it renders.
 *
 * Two components, split along the one line that matters here: {@link DiffView}
 * is pure — diff in, markup out, no fetching and no persistence — while
 * {@link DiffPane} owns the reading and the two pieces of state that outlive a
 * single render (the layout choice, and whether a folded large diff has been
 * expanded). Keeping the renderer pure is what lets the same code draw a commit's
 * file later (FR-7.2) without dragging a fetch along with it.
 *
 * Three requirements are load-bearing in the markup:
 *
 * - **Word-level highlighting is a slice, not a comparison** (FR-2.3). The core
 *   hands over `[start, end)` offsets into the line's own text, so rendering walks
 *   the line once and emits one `<span>` per mark. Nothing here diffs two strings
 *   — an O(n²) comparison inside a render is exactly what §6 forbids.
 * - **`large` and `truncated` are different facts** (FR-2.6). A large diff is
 *   complete and folds until asked for; a truncated one is missing its tail and
 *   says so. Showing the second as the first would claim the file ends there.
 * - **The layout choice is remembered** (FR-2.4) in `localStorage`, and every
 *   access is guarded: a browser in private mode, or a jsdom document, throws on
 *   `localStorage` rather than returning `null`, and a panel that crashed on
 *   remembering a preference would be its own bug.
 *
 * The markup also fixes WHERE a diff operation goes, because the three kinds of
 * operation cannot share one toolbar: **view operations** — how the diff is read,
 * not what it says — live in the header's {@link ViewOps} group; **between-line
 * operations** live on the row between two hunks, whose class `styles.ts` names;
 * **line operations** live in the tail slot every row reserves there. Each anchor
 * carries `data-op-group` (`view` / `gap` / `line`), so which kind a control
 * belongs to is readable from the DOM. Only the first has controls today, so the
 * other two reserve their space in CSS rather than drawing an empty box: a
 * clickable area with no action behind it is worse than none at all.
 *
 * @module dsh-git-panel/client/ui/DiffView
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode, Ref } from 'react'

import { pathParts } from '../../core/format.ts'
import { diffTargetKey } from '../../core/diff-target.ts'
import type { GitPanelError, GitRemoteClient } from '../../core/ports.ts'
import type { DiffHunk, DiffLine, DiffTarget, FileDiff } from '../../core/types.ts'
import { cls } from './styles.ts'
import { useRepoChange } from './repo-change.tsx'
import type { Translate } from './translate.ts'
import { errorCopy } from './error-copy.ts'
import {
  ArrowDownGlyph,
  RefreshGlyph,
  SpinnerGlyph,
  SplitGlyph,
} from './icons.tsx'

/** How the diff lays its two sides out (FR-2.4). */
export type DiffLayout = 'inline' | 'side-by-side'

/** The `localStorage` key the layout choice lives under (FR-2.4). */
export const DIFF_LAYOUT_KEY = 'dsh-git-panel/diff-layout'

/** Context lines each hunk is asked for; the host clamps it to its own ceiling. */
const CONTEXT_LINES = 3

/**
 * Read the remembered layout (FR-2.4).
 *
 * Guarded on both ends: `localStorage` itself throws in a private-mode browser
 * and is absent in a bare jsdom document, and a stored string is untrusted input
 * that another tab — or another version of this plugin — may have written.
 * Anything unrecognised falls back to the default rather than rendering nothing.
 * @returns The remembered layout, or `'inline'`.
 */
export function readDiffLayout(): DiffLayout {
  try {
    return window.localStorage.getItem(DIFF_LAYOUT_KEY) === 'side-by-side'
      ? 'side-by-side'
      : 'inline'
  } catch {
    return 'inline'
  }
}

/**
 * Remember the layout choice (FR-2.4).
 *
 * A failure here is deliberately swallowed: the user's choice still applies to
 * this render, and losing the preference is not worth breaking the panel for.
 * @param layout - The layout to remember.
 */
export function writeDiffLayout(layout: DiffLayout): void {
  try {
    window.localStorage.setItem(DIFF_LAYOUT_KEY, layout)
  } catch {
    // Storage unavailable or full: the choice still holds for this session.
  }
}

/**
 * Render one line's text with its word-level marks (FR-2.3).
 *
 * The offsets address the line's own string, so the body is split in one pass:
 * an unmarked head, then each mark and the gap that follows it. Marks are
 * normalised rather than trusted — the host may hand over an out-of-range span,
 * and a renderer that slices past the end of its string would throw mid-render.
 * @param line - The line whose `text` and `marks` are drawn.
 * @param highlight - Whether marks should be painted at all; inline renders them,
 *   a paired side-by-side cell does not, since the pairing itself is the signal.
 * @returns The text, with marked runs wrapped in their own element.
 */
function LineBody({
  line,
  highlight,
}: {
  readonly line: DiffLine
  readonly highlight: boolean
}): ReactNode {
  const { text } = line
  if (!highlight || line.marks.length === 0 || text === '') return text

  const parts: ReactNode[] = []
  let cursor = 0
  for (const mark of line.marks) {
    const start = Math.max(0, Math.min(text.length, mark.start))
    const end = Math.max(start, Math.min(text.length, mark.end))
    if (start > cursor) parts.push(text.slice(cursor, start))
    if (end > start) {
      parts.push(
        <span className={cls.diffMark} key={`m${start}`}>
          {text.slice(start, end)}
        </span>,
      )
    }
    cursor = end
  }
  if (cursor < text.length) parts.push(text.slice(cursor))

  return <>{parts}</>
}

/** One rendered diff row: one line inline, or two aligned cells side by side. */
interface SplitRow {
  /** Line shown on the left, or `null` for a blank cell. */
  readonly left: DiffLine | null
  /** Line shown on the right, or `null` for a blank cell. */
  readonly right: DiffLine | null
}

/** One end of a changed run, in one hunk. */
type RunEdge = 'removed' | 'added'

/**
 * Pair a hunk's changed lines into side-by-side rows.
 *
 * Each run of removed lines is followed by a run of added lines (git emits them
 * that way), and the two are paired by index: the first removal is shown opposite
 * the first addition, and the longer side is padded with blanks so the columns
 * stay aligned. That is what makes an edit read as an edit — the old line on the
 * left and the new one beside it — which is the whole point of the layout.
 *
 * Context lines bypass the pairing: an unchanged line is a row with both sides
 * showing the same text, and its line numbers differ per side anyway.
 * @param hunk - The hunk to lay out.
 * @returns One entry per rendered row, in file order.
 */
function splitRows(hunk: DiffHunk): readonly SplitRow[] {
  const rows: SplitRow[] = []
  let index = 0

  while (index < hunk.lines.length) {
    const line = hunk.lines[index] as DiffLine
    if (line.kind === 'context') {
      rows.push({ left: line, right: line })
      index += 1
      continue
    }

    const removed: DiffLine[] = []
    while (index < hunk.lines.length && (hunk.lines[index] as DiffLine).kind === 'removed') {
      removed.push(hunk.lines[index] as DiffLine)
      index += 1
    }
    const added: DiffLine[] = []
    while (index < hunk.lines.length && (hunk.lines[index] as DiffLine).kind === 'added') {
      added.push(hunk.lines[index] as DiffLine)
      index += 1
    }

    const height = Math.max(removed.length, added.length)
    if (height === 0) {
      // Unreachable for a well-formed hunk — every line is context, removed, or
      // added — but an endless loop inside a render is a far worse failure than
      // one odd row, so the walk is guaranteed to move forward either way.
      rows.push({ left: line, right: null })
      index += 1
      continue
    }
    for (let offset = 0; offset < height; offset += 1) {
      rows.push({ left: removed[offset] ?? null, right: added[offset] ?? null })
    }
  }

  return rows
}

/** The 1-based line number a row shows in one column, or '' for a blank cell. */
function numberAt(line: DiffLine | null, edge: RunEdge): string {
  if (line === null) return ''
  const value = edge === 'removed' ? line.oldLine : line.newLine
  return value === null ? '' : String(value)
}

/** One column of a side-by-side row, or one whole inline row. */
function LineCell({
  line,
  edge,
  highlight,
}: {
  readonly line: DiffLine | null
  readonly edge: RunEdge
  readonly highlight: boolean
}): ReactNode {
  const number = numberAt(line, edge)
  return (
    <div
      className={cls.diffCell}
      data-line={line === null ? 'blank' : line.kind}
      data-op-group="line"
    >
      <span className={cls.diffGutter}>{number}</span>
      <span className={cls.diffText}>
        {line === null ? '' : <LineBody line={line} highlight={highlight} />}
      </span>
    </div>
  )
}

/** The `@@ -a,b +c,d @@` row that introduces a hunk, heading included. */
function HunkHead({ hunk }: { readonly hunk: DiffHunk }): ReactNode {
  return (
    <div className={cls.diffHunkHead}>
      <span className={cls.diffHunkRange}>
        {`@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@`}
      </span>
      {hunk.heading !== '' && <span className={cls.diffHunkHeading}>{hunk.heading}</span>}
    </div>
  )
}

/**
 * A side-by-side diff: two fixed halves, each its own scroller.
 *
 * The split is fixed — each half is half of the pane, always — so a line longer
 * than its half has to go somewhere. Clipping it loses content ("如果有超出去的话
 * 在底部加滚动条", reported from the running panel), and letting the ROW grow to
 * fit pushes the right half out of the pane (the report before that, "现在有越界
 * 的情况"). So each half scrolls on its own, which is what VS Code's side-by-side
 * diff does and the only shape that satisfies both.
 *
 * The two halves are kept in step on BOTH axes: a paired line that drifted apart
 * vertically would be worse than useless, and comparing a change means looking at
 * the same column offset on each side.
 * @param props - The hunks to split.
 */
function SplitHunks({ hunks }: { readonly hunks: readonly DiffHunk[] }): ReactNode {
  const leftRef = useRef<HTMLDivElement | null>(null)
  const rightRef = useRef<HTMLDivElement | null>(null)

  /**
   * Mirror one half's position onto the other.
   *
   * The guard is the assignment itself: the copy fires a scroll event on the
   * other half, which finds both values already equal and stops. No timer and no
   * lock to leak.
   * @param from - The half the user scrolled.
   */
  const sync = (from: 'left' | 'right'): void => {
    const source = (from === 'left' ? leftRef : rightRef).current
    const target = (from === 'left' ? rightRef : leftRef).current
    if (source === null || target === null) return
    if (target.scrollTop !== source.scrollTop) target.scrollTop = source.scrollTop
    if (target.scrollLeft !== source.scrollLeft) target.scrollLeft = source.scrollLeft
  }

  /**
   * One half: the same hunk structure as the other, one cell per row.
   *
   * Each side renders its own copy of the hunk header, so a half always says
   * where in the file it is — that is what the header is for, and the two copies
   * are the same height, which is what keeps the rows aligned.
   */
  const half = (
    which: 'left' | 'right',
    edge: RunEdge,
    ref: Ref<HTMLDivElement>,
  ): ReactNode => (
    <div
      className={cls.diffSide}
      data-side={which}
      ref={ref}
      onScroll={() => sync(which === 'left' ? 'left' : 'right')}
    >
      {hunks.map((hunk, hunkIndex) => (
        <div className={cls.diffHunk} key={`${hunk.oldStart}-${hunk.newStart}-${hunkIndex}`}>
          <HunkHead hunk={hunk} />
          {splitRows(hunk).map((row, rowIndex) => (
            <LineCell
              key={`${which}${rowIndex}`}
              line={which === 'left' ? row.left : row.right}
              edge={edge}
              highlight={false}
            />
          ))}
        </div>
      ))}
    </div>
  )

  return (
    <div className={cls.diffSplit} data-diff-split="true">
      {half('left', 'removed', leftRef)}
      {half('right', 'added', rightRef)}
    </div>
  )
}

/**
 * Every hunk of a diff, laid out the chosen way.
 *
 * The hunk header is emitted for both layouts: it is where the two sides' line
 * numbers come from, and an inline diff without it loses the only anchor a reader
 * has for "where in the file is this".
 * @param props - Hunks and layout.
 */
function DiffHunks({
  hunks,
  layout,
}: {
  readonly hunks: readonly DiffHunk[]
  readonly layout: DiffLayout
}): ReactNode {
  // Side by side is two scrollers of its own (see {@link SplitHunks}); inline is
  // one, because there the full width IS the reading width.
  if (layout === 'side-by-side') return <SplitHunks hunks={hunks} />

  return (
    <div className={cls.diffHunks}>
      {hunks.map((hunk, hunkIndex) => (
        <div className={cls.diffHunk} key={`${hunk.oldStart}-${hunk.newStart}-${hunkIndex}`}>
          <HunkHead hunk={hunk} />
          {hunk.lines.map((line, lineIndex) => (
            <div
              className={cls.diffLine}
              data-kind={line.kind}
              data-op-group="line"
              key={`l${line.oldLine ?? 0}-${line.newLine ?? 0}-${lineIndex}`}
            >
              <span className={cls.diffGutter}>{line.newLine ?? line.oldLine ?? ''}</span>
              <span className={cls.diffSign} aria-hidden="true">
                {line.kind === 'added' ? '+' : line.kind === 'removed' ? '-' : ' '}
              </span>
              <span className={cls.diffText}>
                <LineBody line={line} highlight />
              </span>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

/** Total added/removed counts, which only make sense once hunks exist. */
function DiffStats({
  additions,
  deletions,
}: {
  readonly additions: number
  readonly deletions: number
}): ReactNode {
  // A binary or combined diff has no line counts to report: showing `+0 −0`
  // there would be a claim about content the panel never read.
  if (additions === 0 && deletions === 0) return null
  return (
    <span className={cls.diffStats}>
      <span className={cls.diffAdded}>+{additions}</span>
      <span className={cls.diffRemoved}>−{deletions}</span>
    </span>
  )
}

/**
 * The header's view-operation group: the controls that change how the diff is
 * read rather than what it says.
 *
 * This is the only one of the diff's three operation anchors (see the module doc)
 * that has anything to hold today, and the only one always on screen. The
 * grouping is semantic as well as visual — the label rides the group, because the
 * sidebar is too narrow to print it.
 * @param props - The panel's translator, and the controls to group.
 */
function ViewOps({ t, children }: { t: Translate; children: ReactNode }): ReactNode {
  return (
    <span
      className={cls.diffOps}
      role="group"
      aria-label={t('diff.groupView')}
      data-op-group="view"
    >
      {children}
    </span>
  )
}

/** Everything {@link DiffView} renders from. */
export interface DiffViewProps {
  /** The diff to draw. */
  readonly diff: FileDiff
  /** The panel's copy. */
  readonly t: Translate
  /** The layout to draw it in. */
  readonly layout: DiffLayout
  /** Called with the layout the user picked. */
  readonly onLayout: (layout: DiffLayout) => void
  /** Whether a folded large diff has been unfolded (FR-2.6). */
  readonly expanded: boolean
  /** Unfold it. */
  readonly onExpand: () => void
  /**
   * Fold an unfolded large diff again.
   *
   * Optional so the renderer stays usable by a caller that has no fold state to
   * change — FR-7.2's commit drill-down draws one file at a time. Without it, an
   * expanded large diff offers no way back.
   */
  readonly onCollapse?: () => void
  /** Read the file again. */
  readonly onReload: () => void
  /** True while a read is in flight, so a reload cannot be started twice. */
  readonly busy: boolean
}

/**
 * One file's diff, in the chosen layout.
 *
 * Pure: it renders exactly what it is handed, so the same component can draw a
 * commit's file later (FR-7.2) without a fetch of its own.
 *
 * Its header carries the diff's OWN operations and nothing else — the layout
 * pair and the reload. Closing is the tab strip's business (each tab has its own
 * ×), so this row never doubles as a way out of the pane.
 * @param props - The diff and the panel's callbacks.
 */
export function DiffView({
  diff,
  t,
  layout,
  onLayout,
  expanded,
  onExpand,
  onCollapse,
  onReload,
  busy,
}: DiffViewProps): ReactNode {
  const { directory, name } = pathParts(diff.path)
  const state = diff.binary ? 'binary' : diff.combined ? 'combined' : diff.hunks.length === 0 ? 'empty' : 'lines'
  const folded = diff.large && !expanded

  return (
    <div className={cls.diffView} data-diff-area={diff.area} data-diff-state={state} aria-busy={busy}>
      <div className={cls.diffHead}>
        <span className={cls.diffPath} title={diff.path}>
          {directory !== '' && <span className={cls.diffPathDir}>{directory}</span>}
          <span className={cls.diffPathName}>{name}</span>
        </span>
        <DiffStats additions={diff.additions} deletions={diff.deletions} />
        <span className={cls.spacer} />
        <ViewOps t={t}>
          {/* Two buttons rather than a switch: `aria-pressed` states which layout
              is on, which a single toggle could only imply. */}
          <span className={cls.diffSeg} role="group" aria-label={t('diff.layout')}>
            <button
              type="button"
              className={cls.diffSegButton}
              aria-pressed={layout === 'inline'}
              title={t('diff.layoutInline')}
              aria-label={t('diff.layoutInline')}
              onClick={() => onLayout('inline')}
            >
              <ArrowDownGlyph size={12} />
            </button>
            <button
              type="button"
              className={cls.diffSegButton}
              aria-pressed={layout === 'side-by-side'}
              title={t('diff.layoutSplit')}
              aria-label={t('diff.layoutSplit')}
              onClick={() => onLayout('side-by-side')}
            >
              <SplitGlyph size={12} />
            </button>
          </span>
          <button
            type="button"
            className={cls.tool}
            title={t('diff.reload')}
            aria-label={t('diff.reload')}
            disabled={busy}
            onClick={onReload}
          >
            {busy ? <SpinnerGlyph className={cls.spinnerGlyph} size={12} /> : <RefreshGlyph />}
          </button>
        </ViewOps>
      </div>

      {diff.binary ? (
        <p className={cls.diffState}>{t('diff.binary')}</p>
      ) : diff.combined ? (
        <p className={cls.diffState}>{t('diff.combined')}</p>
      ) : diff.hunks.length === 0 ? (
        <p className={cls.diffState}>{t('diff.empty')}</p>
      ) : folded ? (
        <div className={cls.diffState}>
          <p className={cls.diffFoldHint}>{t('diff.folded', { count: diff.lines })}</p>
          <button type="button" className={cls.primary} onClick={onExpand}>
            {t('diff.expand')}
          </button>
        </div>
      ) : (
        <>
          <DiffHunks hunks={diff.hunks} layout={layout} />
          {diff.large && onCollapse !== undefined && (
            <p className={cls.diffNote}>
              <button type="button" className={cls.ghost} onClick={onCollapse}>
                {t('diff.collapse')}
              </button>
            </p>
          )}
        </>
      )}

      {/* Truncation is not folding: the tail was never read, so it is stated
          rather than offered as something a click could reveal. */}
      {diff.truncated && <p className={cls.diffNote}>{t('diff.truncated')}</p>}
    </div>
  )
}

/** Everything {@link DiffPane} renders from. */
export interface DiffPaneProps {
  /** The session whose repository is read. */
  readonly sessionId: string
  /** Repo-relative path to draw. */
  readonly path: string
  /** Which comparison to ask for, and the revision it is against (FR-2.2, FR-7.2). */
  readonly target: DiffTarget
  /** The host-facing git client. */
  readonly git: GitRemoteClient
  /** The panel's copy. */
  readonly t: Translate
  /** Aborted when the tab closes; cancels the read. */
  readonly signal?: AbortSignal
  /**
   * Whether this pane is the one on screen (several may be open at once).
   *
   * Only the pane on screen answers Escape: hidden panes are still mounted, and
   * each of them listening on the document would close every open diff at once,
   * which is not what "put this one away" means. Defaults to true, so a caller
   * with a single diff says nothing.
   */
  readonly active?: boolean
  /**
   * Leave this diff, which is what Escape does.
   *
   * The pane's own header carries no close control: closing belongs to the tab
   * that owns the diff, so the header row stays "diff operations only".
   */
  readonly onClose: () => void
}

/**
 * Close on Escape for as long as the caller is mounted.
 *
 * Bound to the document's capture phase rather than to the pane's own element:
 * the diff never moves focus into itself, so a listener on the container would
 * never hear a key. Capture order also means the pane answers before anything
 * deeper that also treats Escape as "go back".
 * @param onClose - Called when Escape is pressed, or `null` to bind nothing.
 */
function useEscapeToClose(onClose: (() => void) | null): void {
  useEffect(() => {
    if (onClose === null) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      onClose()
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [onClose])
}

/**
 * The diff pane: read one file, then hand it to {@link DiffView}.
 *
 * The pane owns three things a pure renderer cannot: the read itself, the layout
 * choice (initialised from `localStorage` and written back on every change,
 * FR-2.4), and whether a folded large diff has been unfolded (FR-2.6). The
 * `expanded` flag is reset during render when the target changes — the React-
 * documented way to drop state that belongs to the previous file, and the reason
 * folding is per-file rather than per-pane.
 * @param props - The target, the client, and the panel's callbacks.
 */
export function DiffPane({
  sessionId,
  path,
  target,
  git,
  t,
  signal,
  active = true,
  onClose,
}: DiffPaneProps): ReactNode {
  const [diff, setDiff] = useState<FileDiff | null>(null)
  const [error, setError] = useState<GitPanelError | null>(null)
  const [busy, setBusy] = useState(true)
  const [layout, setLayout] = useState<DiffLayout>(readDiffLayout)
  const [expanded, setExpanded] = useState(false)
  const [reloadNonce, setReloadNonce] = useState(0)
  /**
   * The panel's change notifications, subscribed rather than handed down: the
   * diff a user is reading refreshes itself under the agent's next write, and it
   * does so without this pane knowing what a "report from the git state probe"
   * is. Any kind counts — a file change or a stage both move what this shows.
   *
   * A COMMIT diff is the exception, and it is a real one: `git show <hash> -- f`
   * does not change when the agent writes `f`, so subscribing to every kind would
   * spend a process per keystroke on a reading that cannot go stale. Only a moved
   * ref — a commit, reset, amend or fetch — can change what a commit diff says,
   * so that is the one topic it follows.
   */
  const anyChange = useRepoChange()
  const refsChange = useRepoChange('refs')
  const change = target.area === 'commit' ? refsChange : anyChange
  /** The revision a commit target names; `''` for the working comparisons. */
  const revision = target.area === 'commit' ? target.hash : ''
  const area = target.area

  // A new file starts folded, whatever the last one was: FR-2.6's budget is per
  // file, and remembering "expanded" across files would unfold the next one
  // without asking. The reset covers a switch of comparison too — the same path
  // as a commit diff and as a working-tree diff are two different readings.
  const [shown, setShown] = useState(`${path}\u0000${diffTargetKey(target)}`)
  const nextShown = `${path}\u0000${diffTargetKey(target)}`
  if (shown !== nextShown) {
    setShown(nextShown)
    setExpanded(false)
  }

  // The target object is rebuilt by a caller every render, so the effect below is
  // keyed on its two primitives (the comparison and the revision) rather than on
  // its identity: a new object with the same content must not re-read.
  useEffect(() => {
    const controller = new AbortController()
    const abort = (): void => controller.abort()
    if (signal?.aborted === true) controller.abort()
    signal?.addEventListener('abort', abort)

    let live = true
    setBusy(true)
    void (async () => {
      const result = await git.diff(sessionId, path, target, CONTEXT_LINES, controller.signal)
      if (!live) return
      setBusy(false)
      if (result.ok) {
        const value = result.value
        setDiff(value)
        setError(null)
      } else {
        setError(result.error)
      }
    })()

    return () => {
      live = false
      signal?.removeEventListener('abort', abort)
      controller.abort()
    }
  }, [git, sessionId, path, area, revision, signal, change, reloadNonce])

  const onLayout = useCallback((next: DiffLayout): void => {
    setLayout(next)
    writeDiffLayout(next)
  }, [])

  useEscapeToClose(active ? onClose : null)

  const reload = useCallback((): void => setReloadNonce((value) => value + 1), [])

  // The previous reading stays on screen while a newer one is in flight: a
  // refresh that blanked the pane would flash on every `git add`, which is the
  // opposite of what an auto-refreshing diff is for.
  if (error !== null && diff === null) {
    const { title, detail } = errorCopy(t, error, 'read')
    return (
      <div className={cls.diffView} data-diff-state="failed">
        <div className={cls.diffHead}>
          <span className={cls.diffPath} title={path}>
            {path}
          </span>
          <span className={cls.spacer} />
          <ViewOps t={t}>
            <button
              type="button"
              className={cls.tool}
              title={t('diff.reload')}
              aria-label={t('diff.reload')}
              disabled={busy}
              onClick={reload}
            >
              <RefreshGlyph />
            </button>
          </ViewOps>
        </div>
        <div className={cls.status}>
          <p className={cls.statusTitle}>{title}</p>
          {detail !== undefined && detail !== '' && <p className={cls.note}>{detail}</p>}
          <button type="button" className={cls.primary} onClick={reload}>
            {t('action.retry')}
          </button>
        </div>
      </div>
    )
  }

  if (diff === null) {
    return (
      <div className={cls.diffView} data-diff-state="loading">
        <div className={cls.diffHead}>
          <span className={cls.diffPath} title={path}>
            {path}
          </span>
          <span className={cls.spacer} />
        </div>
        <p className={cls.diffState} aria-busy="true">
          <SpinnerGlyph className={cls.spinnerGlyph} size={12} /> {t('loading')}
        </p>
      </div>
    )
  }

  return (
    <DiffView
      diff={diff}
      t={t}
      layout={layout}
      onLayout={onLayout}
      expanded={expanded}
      onExpand={() => setExpanded(true)}
      onCollapse={() => setExpanded(false)}
      onReload={reload}
      busy={busy}
    />
  )
}
