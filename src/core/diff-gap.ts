/**
 * The lines git left out between two hunks, and what may be done with them (A-12).
 *
 * A unified diff prints three lines of context around each change, so two changes
 * far apart arrive as two hunks with an unprinted run of unchanged lines between
 * them. That run has two halves, and they come from different places:
 *
 * - its **size** is arithmetic on the hunks the panel already has, which is what
 *   {@link diffGaps} does — no file, no git call, no new data;
 * - its **text** is not in the diff at all, so the panel reads one side of the file
 *   over its own route and hands the answer back here, where {@link gapLines} numbers
 *   it for both sides.
 *
 * Only the runs BETWEEN two hunks are modelled. The lines above the first hunk and
 * below the last one would need the file's total line count, and a `FileDiff` does
 * not carry it — its `lines` is the sum of the hunks' own lines. Those two
 * directions are left undone rather than guessed at.
 *
 * @module dsh-git-panel/core/diff-gap
 */

import type { DiffHunk, DiffLine, FileSnippet } from './types.ts'

/** A run of unchanged lines, between two hunks, that git did not print. */
export interface DiffGap {
  /** 1-based line in the old file the gap's first line has. */
  readonly oldStart: number
  /**
   * The same for the new file.
   *
   * It differs from {@link oldStart} by however many lines the changes above it
   * added or removed — one constant offset for the whole run, since nothing inside
   * a run changed.
   */
  readonly newStart: number
  /** How many unchanged lines the gap holds; always at least one. */
  readonly count: number
}

/**
 * One piece of a diff, in file order.
 *
 * A diff is hunks with the runs between them, so a renderer walks this list rather
 * than the hunks alone: the row that stands where the missing lines are then has
 * exactly one place to come from. A segment only exists where there is one — two
 * hunks that touch produce no gap at all, which is what keeps a fully-contexted
 * diff from growing an empty band between every pair of hunks.
 */
export type DiffSegment =
  | { readonly kind: 'hunk'; readonly hunk: DiffHunk }
  | { readonly kind: 'gap'; readonly gap: DiffGap }

/**
 * The key one gap is addressed by — in the renderer's state, and in its DOM.
 *
 * Only unique within one file's diff, which is what the callers that keep state
 * across files namespace it with (see `DiffPane`).
 * @param gap - The gap.
 * @returns A short, attribute-safe key.
 */
export function gapKey(gap: DiffGap): string {
  return `gap-${gap.oldStart}`
}

/**
 * The run between two hunks, or `null` when there is none to draw.
 *
 * The count comes from the old side, and the new side is required to agree about
 * it: across an unchanged run a well-formed unified diff advances both sides by the
 * same number of lines, so a diff whose two sides disagree is not one this can
 * number honestly — and a gap drawn over the wrong lines is worse than no gap.
 * @param previous - The hunk before the run.
 * @param next - The hunk after it.
 * @returns The gap, or `null` when the hunks touch or the two sides disagree.
 */
function gapBetween(previous: DiffHunk, next: DiffHunk): DiffGap | null {
  const oldStart = previous.oldStart + previous.oldCount
  const newStart = previous.newStart + previous.newCount
  const count = next.oldStart - oldStart
  if (count <= 0) return null
  if (next.newStart - newStart !== count) return null
  return { oldStart, newStart, count }
}

/**
 * The gaps between the hunks of a diff, in file order.
 * @param hunks - The hunks, in file order, as `core/diff-parse.ts` read them.
 * @returns One gap per pair of hunks far enough apart to have one.
 */
export function diffGaps(hunks: readonly DiffHunk[]): readonly DiffGap[] {
  const gaps: DiffGap[] = []
  for (let index = 1; index < hunks.length; index += 1) {
    const gap = gapBetween(hunks[index - 1] as DiffHunk, hunks[index] as DiffHunk)
    if (gap !== null) gaps.push(gap)
  }
  return gaps
}

/**
 * A diff as hunks and gaps, in file order.
 * @param hunks - The hunks, in file order.
 * @returns The segments a renderer walks; a gap always precedes the hunk it leads to.
 */
export function diffSegments(hunks: readonly DiffHunk[]): readonly DiffSegment[] {
  const segments: DiffSegment[] = []
  for (let index = 0; index < hunks.length; index += 1) {
    const hunk = hunks[index] as DiffHunk
    if (index > 0) {
      const gap = gapBetween(hunks[index - 1] as DiffHunk, hunk)
      if (gap !== null) segments.push({ kind: 'gap', gap })
    }
    segments.push({ kind: 'hunk', hunk })
  }
  return segments
}

/**
 * Split one blob's text into lines, terminators stripped.
 *
 * `git show <rev>:<path>` prints a blob verbatim, so a plain split leaves one empty
 * element behind when the file ends with a newline — which is nearly every file —
 * and that element is not a line of the file. One is therefore dropped; one, not
 * all: a file whose last line is genuinely empty ends with two newlines and keeps
 * its empty last line.
 * @param text - The blob, verbatim.
 * @returns The file's lines, with no terminators.
 */
export function blobLines(text: string): readonly string[] {
  if (text === '') return []
  const lines = text.split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  return lines
}

/**
 * Number one side's text as the context lines of a gap.
 *
 * The text is the same on both sides, so the two line numbers are derived rather
 * than read: the old side counts up from the gap's {@link DiffGap.oldStart} and the
 * new side from {@link DiffGap.newStart}, one line at a time. That is exactly what a
 * context line carries — both numbers — so the renderer treats these rows like any
 * other context row and the side-by-side layout can put them in both halves.
 * @param gap - The gap the text belongs to.
 * @param texts - The gap's lines, in file order.
 * @returns One context line per text; fewer when the text is short (which
 *   {@link snippetCoversGap} is what refuses).
 */
export function gapLines(gap: DiffGap, texts: readonly string[]): readonly DiffLine[] {
  const offset = gap.newStart - gap.oldStart
  return texts.map((text, index) => {
    const oldLine = gap.oldStart + index
    return { kind: 'context', text, oldLine, newLine: oldLine + offset, marks: [] }
  })
}

/**
 * Whether a snippet really answers a gap.
 *
 * Two things can make it not, and both mean "draw nothing": the host cut the read
 * short (its own ceiling, or the runner's stdout cap) and says so with `truncated`,
 * or the read came back short of the run the gap describes — the file moved under
 * the diff, so the lines are no longer the ones the gap stands for. Drawing half a
 * run would silently mis-number every line after it.
 * @param gap - The gap that was asked for.
 * @param snippet - What came back.
 * @returns Whether the snippet is the gap's whole run.
 */
export function snippetCoversGap(gap: DiffGap, snippet: FileSnippet): boolean {
  return !snippet.truncated && snippet.from === gap.oldStart && snippet.lines.length === gap.count
}
