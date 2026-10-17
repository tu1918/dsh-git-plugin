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
 * belongs to is readable from the DOM.
 *
 * The gap row is the one that has a control today: a diff prints three lines of
 * context around each change, so the unchanged run between two hunks is simply
 * absent, and the row that stands where it is (A-12) is what reads it back and draws
 * it. Its position comes from the hunks alone ({@link diffSegments}), its text from
 * one read of the file's old side, and both layouts walk the same segment list — a
 * side-by-side diff draws the run in BOTH halves, because a row present in one half
 * and not the other is exactly what makes a paired reading drift. The third anchor,
 * the per-line tail, still reserves its space in CSS rather than drawing an empty
 * box: a clickable area with no action behind it is worse than none at all.
 *
 * @module dsh-git-panel/client/ui/DiffView
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode, Ref } from 'react'

import { pathParts } from '../../core/format.ts'
import { diffTargetKey } from '../../core/diff-target.ts'
import {
  diffSegments,
  gapKey,
  gapLines,
  snippetCoversGap,
  type DiffGap,
} from '../../core/diff-gap.ts'
import type { GitPanelError, GitRemoteClient } from '../../core/ports.ts'
import type { DiffHunk, DiffLine, DiffTarget, FileDiff } from '../../core/types.ts'
import { cls } from './styles.ts'
import { DiffScrollbar, type DiffAxis } from './diff-scrollbar.tsx'
import { useRepoChange } from './repo-change.tsx'
import type { Translate } from './translate.ts'
import { errorCopy } from './error-copy.ts'
import {
  ArrowDownGlyph,
  OpenInTabGlyph,
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
 * Why a between-hunk read could not be drawn (A-12).
 *
 * Two different things, kept apart because they read differently: the answer was
 * about the run but did not cover it — too large to read, or the file moved — versus
 * the read itself failing, where the panel's own words for that failure are the
 * honest thing to show. Collapsing them into one "could not read" sentence is how a
 * missing host route came to look like an oversized run.
 */
export type GapFailure =
  /** The run came back cut short, or short of the width the gap describes. */
  | { readonly kind: 'unreadable' }
  /** The read failed; `error` is the host's own failure, absent when the transport threw. */
  | { readonly kind: 'error'; readonly error: GitPanelError | null }

/**
 * What one between-hunk row's read currently holds (A-12).
 */
export type GapReading =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly lines: readonly string[] }
  | { readonly status: 'failed'; readonly failure: GapFailure }

/**
 * One gap's key inside the pane's state: the reading it belongs to, then the gap.
 *
 * The reading is part of the key because a pane outlives a switch of file. A read
 * that was in flight when the reader moved on lands under ITS key and is never
 * drawn, instead of appearing under a gap of the next file that happens to begin at
 * the same line.
 * @param readingKey - The identity of the reading the gap belongs to.
 * @param gap - The gap.
 * @returns The key this gap's open/read state lives under.
 */
export function gapStoreKey(readingKey: string, gap: DiffGap): string {
  return `${readingKey}\u0000${gapKey(gap)}`
}

/** Everything the two layouts need to draw and drive the between-hunk rows. */
interface GapControls {
  /** The reading the hunks on screen belong to; part of every gap's state key. */
  readonly readingKey: string
  /** Which gaps are open, by {@link gapStoreKey}. */
  readonly open: ReadonlySet<string>
  /** What each gap's read holds, by {@link gapStoreKey}. */
  readonly readings: ReadonlyMap<string, GapReading>
  /** Open or close one gap. */
  readonly onToggle: (gap: DiffGap) => void
  /** Read one gap whose read failed again. */
  readonly onRetry: (gap: DiffGap) => void
  /** The panel's copy. */
  readonly t: Translate
}

/** The state one gap's key resolves to inside one set of controls. */
function gapState(controls: GapControls, gap: DiffGap): {
  readonly open: boolean
  readonly reading: GapReading | undefined
} {
  const key = gapStoreKey(controls.readingKey, gap)
  return { open: controls.open.has(key), reading: controls.readings.get(key) }
}

/**
 * The sentence one failed run reads out (A-12).
 *
 * An oversized or mismatched run is the panel's own words about the run; a read that
 * failed is the failure's own words — `errorCopy` writes them, so the row says what
 * the host refused rather than guessing at a reason of its own.
 * @param t - The panel's translator.
 * @param gap - The gap that could not be drawn.
 * @param reading - What its read holds.
 * @returns The sentence to show on the band.
 */
function failureText(t: Translate, gap: DiffGap, reading: GapReading | undefined): string {
  if (reading?.status !== 'failed') return t('diff.gapUnreadable', { count: gap.count })
  const { failure } = reading
  if (failure.kind === 'unreadable') return t('diff.gapUnreadable', { count: gap.count })
  if (failure.error === null) return t('diff.gapFailed', { count: gap.count })
  return errorCopy(t, failure.error, 'read').title
}

/**
 * The row between two hunks: the anchor a between-line operation lives on (A-12).
 *
 * One control, whose words say what the next click does — open the run, close it
 * again, or read it once more after a read that could not answer it. A read in
 * flight says so rather than showing an enabled control that would start a second
 * one, and a run that could not be read is STATED rather than drawn in part: the
 * lines around it are numbered by position, so half a run would mis-number every
 * line below it.
 */
function GapBand({
  gap,
  controls,
}: {
  readonly gap: DiffGap
  readonly controls: GapControls
}): ReactNode {
  const { open, reading } = gapState(controls, gap)
  /** What the band says: a read that failed or is still running outranks the toggle. */
  const state = open ? (reading?.status ?? 'loading') : 'closed'
  /** The failure's multi-line detail, when there is one, as the note's tooltip. */
  const failureDetail =
    reading?.status === 'failed' && reading.failure.kind === 'error'
      ? reading.failure.error?.detail
      : undefined

  return (
    <div
      className={cls.diffGap}
      data-op-group="gap"
      data-gap={gapKey(gap)}
      data-gap-state={state}
      role="group"
      aria-label={controls.t('diff.groupGap')}
    >
      {state === 'loading' ? (
        <span className={cls.diffGapNote} aria-busy="true">
          <SpinnerGlyph className={cls.spinnerGlyph} size={12} /> {controls.t('diff.gapReading')}
        </span>
      ) : state === 'failed' ? (
        <>
          {/* The failed state says WHICH failure it is: an oversized run is the panel's
              own sentence, while a read that failed is explained by the failure itself —
              the host's refusal, or the panel's words for a transport that threw. */}
          <span className={cls.diffGapNote} title={failureDetail}>
            {failureText(controls.t, gap, reading)}
          </span>
          <button type="button" className={cls.ghost} onClick={() => controls.onRetry(gap)}>
            {controls.t('action.retry')}
          </button>
        </>
      ) : (
        <button
          type="button"
          className={cls.diffGapButton}
          aria-expanded={open}
          onClick={() => controls.onToggle(gap)}
        >
          {open
            ? controls.t('diff.gapCollapse', { count: gap.count })
            : controls.t('diff.gapExpand', { count: gap.count })}
        </button>
      )}
    </div>
  )
}

/**
 * One gap in full: its band, and — once it is open and read — the run's own lines.
 *
 * The rows are drawn by the caller because the two layouts draw a line differently
 * (an inline row, or one half's cell), and the run has to be drawn in BOTH halves of
 * a side-by-side diff or the halves drift apart below it.
 */
function GapBlock({
  gap,
  controls,
  renderRow,
}: {
  readonly gap: DiffGap
  readonly controls: GapControls
  /** How one line of the run is drawn in this layout. */
  readonly renderRow: (line: DiffLine, index: number) => ReactNode
}): ReactNode {
  const { open, reading } = gapState(controls, gap)
  // The length is checked as well as the state: the diff on screen may have been
  // re-read since this run was fetched, and a run that is no longer this gap's width
  // would be numbered wrong from its second line on.
  const ready = reading?.status === 'ready' && reading.lines.length === gap.count ? reading : null
  const lines = open && ready !== null ? gapLines(gap, ready.lines) : []

  return (
    <div className={cls.diffGapBlock} data-gap-block="true">
      <GapBand gap={gap} controls={controls} />
      {lines.map((line, index) => renderRow(line, index))}
    </div>
  )
}

/**
 * One inline row: the line's number, its sign, and its text.
 *
 * Shared by a hunk's own lines and by the lines a gap opens, so an expanded run
 * reads exactly like the context it stands for, and a change to the row's markup
 * cannot reach only half of them.
 */
function InlineLine({ line }: { readonly line: DiffLine }): ReactNode {
  return (
    <div className={cls.diffLine} data-kind={line.kind} data-op-group="line">
      <span className={cls.diffGutter}>{line.newLine ?? line.oldLine ?? ''}</span>
      <span className={cls.diffSign} aria-hidden="true">
        {line.kind === 'added' ? '+' : line.kind === 'removed' ? '-' : ' '}
      </span>
      <span className={cls.diffText}>
        <LineBody line={line} highlight />
      </span>
    </div>
  )
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
 * A side-by-side diff: two fixed halves, each its own scroller, one shared bar
 * pair.
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
 * the same column offset on each side. Since two independent scrollers cannot
 * share a native bar, the halves hide theirs and {@link DiffScrollbar} draws one
 * per axis for both — see `styles.ts` for why the grid looks the way it does.
 *
 * Both halves walk the SAME segments (A-12), because the halves are separate
 * scrollers with nothing per-row between them: a between-hunk row drawn in one half
 * and not the other is exactly what would push a paired line out of step.
 * @param props - The hunks to split, the gap controls, and the panel's copy.
 */
function SplitHunks({
  hunks,
  gaps,
}: {
  readonly hunks: readonly DiffHunk[]
  readonly gaps: GapControls
}): ReactNode {
  const t = gaps.t
  const leftRef = useRef<HTMLDivElement | null>(null)
  const rightRef = useRef<HTMLDivElement | null>(null)
  const splitRef = useRef<HTMLDivElement | null>(null)
  /**
   * Where each half was left by the last programmatic write, or `-1` when nothing
   * was written to it.
   *
   * Needed because the two halves do NOT have the same scrollable range: the two
   * sides of a diff hold different text, so one is routinely a few pixels wider.
   * Mirroring "A moved, so set B" makes B fire its own scroll event, and a plain
   * "are the two equal?" guard reads that echo as B having moved — then B's
   * clamped value is written back onto A, which drags the half the reader is
   * holding. The two then fight each other for as long as the drag lasts, which is
   * exactly the reported "拖一边，另一边延迟闪动".
   */
  const echo = useRef<Record<'left' | 'right', { x: number; y: number }>>({
    left: { x: -1, y: -1 },
    right: { x: -1, y: -1 },
  })
  /** What the shared bars draw from: how far each axis can go, and where it is. */
  const [extent, setExtent] = useState<{ x: DiffAxis; y: DiffAxis }>({
    x: { content: 0, viewport: 0 },
    y: { content: 0, viewport: 0 },
  })
  const [offset, setOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 })

  /**
   * Re-read the halves' sizes.
   *
   * One bar serves two scrollers whose content differs, so an axis's range is the
   * LARGER of the two: a shared bar that stopped at the narrower half's end could
   * not reach the rest of the wider one. The viewport is the same on both by
   * construction, so either half answers it.
   */
  const measure = useCallback((): void => {
    const left = leftRef.current
    const right = rightRef.current
    if (left === null || right === null) return
    const next = {
      x: {
        content: Math.max(left.scrollWidth, right.scrollWidth),
        viewport: Math.min(left.clientWidth, right.clientWidth),
      },
      y: {
        content: Math.max(left.scrollHeight, right.scrollHeight),
        viewport: Math.min(left.clientHeight, right.clientHeight),
      },
    }
    setExtent((current) =>
      current.x.content === next.x.content &&
      current.x.viewport === next.x.viewport &&
      current.y.content === next.y.content &&
      current.y.viewport === next.y.viewport
        ? current
        : next,
    )
  }, [])

  /** Publish where the halves are, so the shared thumb follows a wheel or a drag. */
  const record = useCallback((): void => {
    const left = leftRef.current
    const right = rightRef.current
    if (left === null || right === null) return
    const x = Math.max(left.scrollLeft, right.scrollLeft)
    const y = Math.max(left.scrollTop, right.scrollTop)
    setOffset((current) => (current.x === x && current.y === y ? current : { x, y }))
  }, [])

  useLayoutEffect(() => {
    measure()
    const split = splitRef.current
    if (split === null) return
    // The halves' width follows the pane's, and that changes how far a long line
    // overflows — which is the difference between a bar and no bar.
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => measure())
    observer?.observe(split)
    // Web fonts land after the first paint and change every measured width.
    void document.fonts?.ready.then(() => measure()).catch(() => undefined)
    return () => observer?.disconnect()
  }, [measure, hunks])

  /**
   * Mirror one half's position onto the other.
   *
   * An event from a half whose position is the one we last wrote to it is our own
   * echo, and is dropped. The record is spent on use — one write makes one event —
   * so a later read that happens to land on the same pixel is still the reader's.
   * @param from - The half that reported a scroll.
   */
  const sync = (from: 'left' | 'right'): void => {
    const source = (from === 'left' ? leftRef : rightRef).current
    const target = (from === 'left' ? rightRef : leftRef).current
    if (source === null || target === null) return

    const written = echo.current[from]
    if (written.x === source.scrollLeft && written.y === source.scrollTop) {
      echo.current[from] = { x: -1, y: -1 }
    } else {
      const moves = target.scrollTop !== source.scrollTop || target.scrollLeft !== source.scrollLeft
      if (target.scrollTop !== source.scrollTop) target.scrollTop = source.scrollTop
      if (target.scrollLeft !== source.scrollLeft) target.scrollLeft = source.scrollLeft
      // Read back rather than reuse what was asked for: a half that cannot go that
      // far stops short, and it is the position it really reached that its own
      // event will report.
      echo.current[from === 'left' ? 'right' : 'left'] = moves
        ? { x: target.scrollLeft, y: target.scrollTop }
        : { x: -1, y: -1 }
    }
    record()
  }

  /**
   * Move both halves from a shared bar.
   *
   * Both are written in the same step, which is the point of the bar: there is no
   * "other half" to catch up, so nothing here lags. Each stops at its own end,
   * which `diff-scrollbar.tsx` accounts for by ranging over the wider one.
   */
  const scrollBoth = useCallback(
    (axis: 'x' | 'y', value: number): void => {
      const left = leftRef.current
      const right = rightRef.current
      if (left === null || right === null) return
      if (axis === 'x') {
        left.scrollLeft = value
        right.scrollLeft = value
      } else {
        left.scrollTop = value
        right.scrollTop = value
      }
      record()
    },
    [record],
  )

  /**
   * One half: the same hunk structure as the other, one cell per row.
   *
   * Each side renders its own copy of the hunk header, so a half always says
   * where in the file it is — that is what the header is for, and the two copies
   * are the same height, which is what keeps the rows aligned. The between-hunk rows
   * are copied the same way, for the same reason.
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
      {diffSegments(hunks).map((segment, segmentIndex) =>
        segment.kind === 'hunk' ? (
          <div className={cls.diffHunk} key={`${which}-h${segmentIndex}`}>
            <HunkHead hunk={segment.hunk} />
            {splitRows(segment.hunk).map((row, rowIndex) => (
              <LineCell
                key={`${which}${rowIndex}`}
                line={which === 'left' ? row.left : row.right}
                edge={edge}
                highlight={false}
              />
            ))}
          </div>
        ) : (
          <GapBlock
            key={`${which}-g${segmentIndex}`}
            gap={segment.gap}
            controls={gaps}
            // A gap's lines are context on both sides, so the same line feeds both
            // halves — the cell takes the number its own edge reads.
            renderRow={(line, rowIndex) => (
              <LineCell key={`${which}g${rowIndex}`} line={line} edge={edge} highlight={false} />
            )}
          />
        ),
      )}
    </div>
  )

  return (
    <div className={cls.diffSplit} data-diff-split="true" ref={splitRef}>
      <div className={cls.diffHalves}>
        {half('left', 'removed', leftRef)}
        {half('right', 'added', rightRef)}
      </div>
      <DiffScrollbar
        axis="y"
        extent={extent.y}
        offset={offset.y}
        onScroll={(value) => scrollBoth('y', value)}
        label={t('diff.scrollY')}
      />
      <DiffScrollbar
        axis="x"
        extent={extent.x}
        offset={offset.x}
        onScroll={(value) => scrollBoth('x', value)}
        label={t('diff.scrollX')}
      />
    </div>
  )
}

/**
 * Every hunk of a diff, laid out the chosen way.
 *
 * The hunk header is emitted for both layouts: it is where the two sides' line
 * numbers come from, and an inline diff without it loses the only anchor a reader
 * has for "where in the file is this".
 *
 * What is walked is the SEGMENT list rather than the hunks (A-12), so the row
 * between two hunks — where the lines git left out belong — has one place to come
 * from in this layout too. A diff whose hunks touch has no such row at all.
 * @param props - Hunks, layout, the gap controls, and the panel's copy.
 */
function DiffHunks({
  hunks,
  layout,
  gaps,
}: {
  readonly hunks: readonly DiffHunk[]
  readonly layout: DiffLayout
  readonly gaps: GapControls
}): ReactNode {
  // Side by side is two scrollers of its own under one pair of bars (see
  // {@link SplitHunks}); inline is one scroller, because there the full width IS
  // the reading width.
  if (layout === 'side-by-side') return <SplitHunks hunks={hunks} gaps={gaps} />

  return (
    <div className={cls.diffHunks}>
      {diffSegments(hunks).map((segment, segmentIndex) =>
        segment.kind === 'hunk' ? (
          <div className={cls.diffHunk} key={`h${segmentIndex}`}>
            <HunkHead hunk={segment.hunk} />
            {segment.hunk.lines.map((line, lineIndex) => (
              <InlineLine key={`l${line.oldLine ?? 0}-${line.newLine ?? 0}-${lineIndex}`} line={line} />
            ))}
          </div>
        ) : (
          <GapBlock
            key={`g${segmentIndex}`}
            gap={segment.gap}
            controls={gaps}
            renderRow={(line, rowIndex) => (
              <InlineLine key={`gl${line.oldLine ?? 0}-${line.newLine ?? 0}-${rowIndex}`} line={line} />
            )}
          />
        ),
      )}
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
  /**
   * Promote this reading into a right-side tab of its own.
   *
   * Absent for a diff that is ALREADY in such a tab: there is nowhere further to
   * open it, and a button that did nothing would be worse than no button. The
   * dock passes it, which is the one place a diff can still be moved out of.
   */
  readonly onOpenInTab?: () => void
  /**
   * Which gaps between hunks are open, by {@link gapStoreKey}.
   *
   * The state lives in the pane rather than here because it outlives one render and
   * costs a read to build; the renderer stays pure by being handed it.
   */
  readonly openGaps: ReadonlySet<string>
  /** What each gap's read holds, keyed the same way. */
  readonly gapReadings: ReadonlyMap<string, GapReading>
  /** The identity of the reading these hunks belong to: the key prefix gaps use. */
  readonly readingKey: string
  /** Open or close one gap between two hunks (A-12's between-line operation). */
  readonly onToggleGap: (gap: DiffGap) => void
  /** Read a gap whose read failed again. */
  readonly onRetryGap: (gap: DiffGap) => void
}

/**
 * One file's diff, in the chosen layout.
 *
 * Pure: it renders exactly what it is handed, so the same component can draw a
 * commit's file later (FR-7.2) without a fetch of its own. The between-hunk rows are
 * the one place that shows: their text is fetched by the pane, and this component is
 * handed the answer — open or closed, read or failed — rather than reading anything
 * itself.
 *
 * Its header carries the diff's OWN operations and nothing else — the layout
 * pair, the reload, and, in the dock, the move into a right-side tab of its own.
 * Closing is the tab strip's business (each tab has its own ×), so this row
 * never doubles as a way out of the pane.
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
  onOpenInTab,
  openGaps,
  gapReadings,
  readingKey,
  onToggleGap,
  onRetryGap,
}: DiffViewProps): ReactNode {
  /** The between-hunk rows' whole contract, gathered once for both layouts. */
  const gaps: GapControls = {
    readingKey,
    open: openGaps,
    readings: gapReadings,
    onToggle: onToggleGap,
    onRetry: onRetryGap,
    t,
  }
  const { directory, name } = pathParts(diff.path)
  // No hunks is two different facts: a conflict whose sides could not be paired
  // (one of them is missing) says so, where an ordinary file simply has nothing
  // to show.
  const empty = diff.hunks.length === 0
  const state = diff.binary
    ? 'binary'
    : diff.combined
      ? 'combined'
      : !empty
        ? 'lines'
        : diff.conflict
          ? 'oneSided'
          : 'empty'
  const folded = diff.large && !expanded

  return (
    <div
      className={cls.diffView}
      data-diff-area={diff.area}
      data-diff-state={state}
      data-diff-conflict={String(diff.conflict)}
      aria-busy={busy}
    >
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
          {/* Opening the same diff in the right sidebar is a view operation like
              the rest: it changes where the diff is read, not what it says. */}
          {onOpenInTab !== undefined && (
            <button
              type="button"
              className={cls.tool}
              title={t('diff.openInTab')}
              aria-label={t('diff.openInTab')}
              onClick={onOpenInTab}
            >
              <OpenInTabGlyph />
            </button>
          )}
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

      {/* The sides of a conflict are not an "old" and a "new", so red/green alone
          would leave the reader guessing which version they are looking at. One
          line names them; it holds in both layouts, because the removed ink is
          the same ink on a whole row and on a side-by-side cell. */}
      {diff.conflict && !empty && <p className={cls.diffConflict}>{t('diff.conflictSides')}</p>}

      {diff.binary ? (
        <p className={cls.diffState}>{t('diff.binary')}</p>
      ) : diff.combined ? (
        <p className={cls.diffState}>{t('diff.combined')}</p>
      ) : diff.conflict && empty ? (
        <p className={cls.diffState}>{t('diff.conflictOneSide')}</p>
      ) : empty ? (
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
          <DiffHunks hunks={diff.hunks} layout={layout} gaps={gaps} />
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

/**
 * Which file and comparison the hunks on screen belong to.
 *
 * The pane keeps the previous reading while a newer one is in flight, so what is
 * rendered can be one file behind the props. A between-hunk read must be made against
 * the file those hunks belong to — asking the props would ask the NEXT file for the
 * old gap's lines — so the reading carries its own identity, and every gap read uses
 * that.
 */
interface DiffReading {
  /** `path\0target`, the same string {@link gapStoreKey} namespaces keys with. */
  readonly key: string
  /** Repo-relative path the hunks were read from. */
  readonly path: string
  /** The comparison they were read against, revision included. */
  readonly target: DiffTarget
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
  /**
   * Move this diff into a right-side tab of its own, if there is somewhere to
   * move it to. Omitted by a pane that is already such a tab.
   */
  readonly onOpenInTab?: () => void
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
 * The pane owns what a pure renderer cannot: the read itself, the layout choice
 * (initialised from `localStorage` and written back on every change, FR-2.4),
 * whether a folded large diff has been unfolded (FR-2.6), and the between-hunk rows
 * (A-12) — which of them are open, and what each one's own read returned. The
 * `expanded` flag is reset during render when the target changes — the React-
 * documented way to drop state that belongs to the previous file, and the reason
 * folding is per-file rather than per-pane — and the gaps are reset the same way,
 * keyed on the READING rather than on the props: until a newer file's hunks land, the
 * rows on screen still belong to the old one, and its own gaps may stay open.
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
  onOpenInTab,
}: DiffPaneProps): ReactNode {
  const [diff, setDiff] = useState<FileDiff | null>(null)
  const [error, setError] = useState<GitPanelError | null>(null)
  const [busy, setBusy] = useState(true)
  const [layout, setLayout] = useState<DiffLayout>(readDiffLayout)
  const [expanded, setExpanded] = useState(false)
  const [reloadNonce, setReloadNonce] = useState(0)
  /** Which file and comparison the hunks on screen came from (see {@link DiffReading}). */
  const [reading, setReading] = useState<DiffReading | null>(null)
  /** Which between-hunk rows are open, by {@link gapStoreKey}. */
  const [openGaps, setOpenGaps] = useState<ReadonlySet<string>>(new Set())
  /** What each of those rows' reads holds, by the same key. */
  const [gapReadings, setGapReadings] = useState<ReadonlyMap<string, GapReading>>(new Map())
  /**
   * The reading of the last render, for the guard in {@link readGap}.
   *
   * A ref rather than a dependency because the settle handler is created once per
   * read and must ask the question at the moment it answers, not at the moment it was
   * started.
   */
  const readingRef = useRef<DiffReading | null>(null)
  readingRef.current = reading
  /**
   * The reads in flight, by gap state key.
   *
   * A ref rather than state because this is deduplication, not rendering: two clicks
   * on one row — or a click racing the render that would have shown it open — must
   * share ONE read.
   */
  const gapReads = useRef(new Map<string, Promise<void>>())
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

  // Every gap closes when a NEW reading lands: what is open belongs to the hunks on
  // screen, so switching away and back starts on a collapsed diff — which is what a
  // fresh file should look like. Keyed on the reading's key rather than on the props
  // above, so the file still being read does not close the gaps of the one on screen.
  const readingKey = reading?.key ?? ''
  const [gapsFor, setGapsFor] = useState('')
  if (gapsFor !== readingKey) {
    setGapsFor(readingKey)
    setOpenGaps(new Set())
    setGapReadings(new Map())
  }

  /**
   * Read one gap's lines, and record what came back against its own key.
   *
   * The answer is dropped when the pane has moved to another reading: it names a file
   * that is no longer drawn, and recording it would only resurrect state the reset
   * above has already thrown away. A read that failed — for any reason, including a
   * range the host had to cut short — becomes `failed`, which the row states and
   * offers to read again.
   * @param forReading - The reading the gap belongs to; its key namespaces the state.
   * @param gap - The gap to read.
   */
  const readGap = useCallback(
    (forReading: DiffReading, gap: DiffGap): void => {
      const storeKey = gapStoreKey(forReading.key, gap)
      if (gapReads.current.has(storeKey)) return
      setGapReadings((current) => {
        const next = new Map(current)
        next.set(storeKey, { status: 'loading' })
        return next
      })
      const task = (async (): Promise<void> => {
        let value: GapReading = { status: 'failed', failure: { kind: 'error', error: null } }
        try {
          const result = await git.fileLines(
            sessionId,
            forReading.path,
            forReading.target,
            gap.oldStart,
            gap.count,
            signal,
          )
          if (result.ok) {
            // `snippetCoversGap` is what refuses half a run: the lines are numbered by
            // position, so a short or cut answer would mis-number everything below it.
            value = snippetCoversGap(gap, result.value)
              ? { status: 'ready', lines: result.value.lines }
              : { status: 'failed', failure: { kind: 'unreadable' } }
          } else {
            // The host's own refusal, kept whole: it is what the row reads out, and it is
            // how a route this host does not have says so instead of looking like a run
            // that was too big.
            value = { status: 'failed', failure: { kind: 'error', error: result.error } }
          }
        } catch {
          // A transport that threw rather than answering: the row says the read failed —
          // there are no words of the host's to forward — and offers the retry.
        }
        if (readingRef.current?.key !== forReading.key) return
        setGapReadings((current) => {
          const next = new Map(current)
          next.set(storeKey, value)
          return next
        })
      })()
      gapReads.current.set(storeKey, task)
      const done = (): void => {
        gapReads.current.delete(storeKey)
      }
      void task.then(done, done)
    },
    [git, sessionId, signal],
  )

  /** Open or close one between-hunk row, reading it the first time it opens. */
  const onToggleGap = useCallback(
    (gap: DiffGap): void => {
      const forReading = reading
      if (forReading === null) return
      const storeKey = gapStoreKey(forReading.key, gap)
      const opening = !openGaps.has(storeKey)
      setOpenGaps((current) => {
        const next = new Set(current)
        if (opening) next.add(storeKey)
        else next.delete(storeKey)
        return next
      })
      // A row that has never been read starts its read here; one that already has its
      // lines keeps them, so closing and opening it again costs nothing.
      if (opening && gapReadings.get(storeKey) === undefined) readGap(forReading, gap)
    },
    [reading, openGaps, gapReadings, readGap],
  )

  /** Read one row whose read failed again, after dropping the spent attempt. */
  const onRetryGap = useCallback(
    (gap: DiffGap): void => {
      const forReading = reading
      if (forReading === null) return
      const storeKey = gapStoreKey(forReading.key, gap)
      gapReads.current.delete(storeKey)
      setOpenGaps((current) => new Set(current).add(storeKey))
      readGap(forReading, gap)
    },
    [reading, readGap],
  )

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
    // The identity of what this read returns, built here rather than read from the
    // render's props later: a between-hunk row's own read is made against the file
    // these hunks came from, whenever the reader gets round to clicking it.
    const requestKey = `${path}\u0000${diffTargetKey(target)}`
    void (async () => {
      const result = await git.diff(sessionId, path, target, CONTEXT_LINES, controller.signal)
      if (!live) return
      setBusy(false)
      if (result.ok) {
        const value = result.value
        setDiff(value)
        setReading({ key: requestKey, path, target })
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
      onOpenInTab={onOpenInTab}
      openGaps={openGaps}
      gapReadings={gapReadings}
      readingKey={readingKey}
      onToggleGap={onToggleGap}
      onRetryGap={onRetryGap}
    />
  )
}
