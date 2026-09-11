/**
 * Word-level marks, computed by Visual Studio Code's own diff engine.
 *
 * ## Why the engine is a dependency and not a port
 *
 * FR-2.3 asks for VS Code's word-level marking, and the honest reading of that is
 * "run the algorithm VS Code runs". The `vscode-diff` package is exactly that
 * engine extracted from the VS Code source (`DefaultLinesDiffComputer` plus its
 * heuristics), MIT-licensed, and — the property that makes it usable here at all
 * — carrying **no dependencies of its own**, so the pure layer stays runnable
 * under a bare `node --test`.
 *
 * Writing the equivalent by hand was the alternative, and it was rejected for a
 * reason worth recording: the value of this engine is not the Myers search (a
 * hundred lines) but the heuristics layered on it — dropping matches too short to
 * be meaningful, extending a mark to a whole word, refining a changed block down
 * to character ranges. Those heuristics are the difference between "a diff" and
 * "the diff people recognise", which is precisely the acceptance criterion.
 *
 * ## What is NOT taken from the engine
 *
 * The line-level hunks. git already computes those, and better than an
 * in-process comparer can: it honours `.gitattributes`, rename detection, binary
 * sniffing, and it never needs the whole file in memory. So git produces the
 * structure and this module refines the changed blocks inside it, which is the
 * same division of labour VS Code itself uses between its diff computer and its
 * renderer.
 *
 * @module dsh-git-panel/core/diff-engine/marks
 */

import { DefaultLinesDiffComputer } from 'vscode-diff'

import type { DiffHunk, DiffLine, DiffSpan } from '../types.ts'

/**
 * The engine instance.
 *
 * Shared because the computer is stateless per call: it owns two algorithm
 * strategies, and rebuilding them for every hunk would allocate on the read path
 * for nothing.
 */
const computer = new DefaultLinesDiffComputer()

/**
 * Options handed to every call.
 *
 * - `ignoreTrimWhitespace: false` — trailing-whitespace edits are edits, and a
 *   diff view that hides them is lying about the file.
 * - `computeMoves: false` — moved-code detection is an editor affordance (it
 *   draws a moving text decoration). Inside one hunk's changed block there is
 *   nothing to move, and the pass is the expensive one.
 * - `maxComputationTimeMs: 1000` — the engine degrades to a coarser answer past
 *   its budget rather than hanging; one second is far beyond what a changed
 *   block costs, so hitting it means the input was pathological and a coarser
 *   answer beats a stalled request.
 */
const OPTIONS = {
  ignoreTrimWhitespace: false,
  maxComputationTimeMs: 1000,
  computeMoves: false,
} as const

/** The marks one block's lines earned, indexed by line. */
export interface WordMarks {
  /** Marks for the original (removed) lines, in order. */
  readonly original: readonly (readonly DiffSpan[])[]
  /** Marks for the modified (added) lines, in order. */
  readonly modified: readonly (readonly DiffSpan[])[]
}

/** A range as the engine reports it: 1-based lines and columns. */
interface EngineRange {
  readonly startLineNumber: number
  readonly startColumn: number
  readonly endLineNumber: number
  readonly endColumn: number
}

/**
 * The part of one line an engine range covers.
 *
 * A range may span lines, so the first and last ones are clipped at their column
 * and the lines between them are covered whole. Line 0 never exists: the engine
 * uses it for an insertion point before the first line, which has no character to
 * mark and is dropped.
 * @param range - The engine's range.
 * @param texts - The block's lines.
 * @param target - Per-line span lists to append to.
 */
function collectRange(
  range: EngineRange,
  texts: readonly string[],
  target: DiffSpan[][],
): void {
  const first = Math.max(1, range.startLineNumber)
  const last = Math.min(texts.length, range.endLineNumber)
  for (let number = first; number <= last; number += 1) {
    const text = texts[number - 1]
    if (text === undefined) continue
    const start =
      number === range.startLineNumber ? clamp(range.startColumn - 1, text.length) : 0
    const end = number === range.endLineNumber ? clamp(range.endColumn - 1, text.length) : text.length
    if (end <= start) continue
    target[number - 1]?.push({ start, end })
  }
}

/** Hold an offset inside a line, whatever the engine claimed. */
function clamp(offset: number, length: number): number {
  if (!Number.isFinite(offset) || offset < 0) return 0
  return Math.min(offset, length)
}

/**
 * Merge overlapping spans and drop the ones that cover a whole line.
 *
 * A full-line span is not worth drawing: the row already says the line was added
 * or removed, and painting the same sentence in the mark colour as well only
 * makes the mark colour meaningless. Dropping it here rather than in the renderer
 * keeps the rule where the marks are decided.
 * @param spans - Raw spans for one line.
 * @param text - The line the spans address.
 * @returns The marks to keep, sorted.
 */
function tidy(spans: readonly DiffSpan[], text: string): DiffSpan[] {
  const sorted = [...spans].sort((a, b) => a.start - b.start || a.end - b.end)
  const merged: DiffSpan[] = []
  for (const span of sorted) {
    const last = merged[merged.length - 1]
    if (last !== undefined && span.start <= last.end) {
      merged[merged.length - 1] = { start: last.start, end: Math.max(last.end, span.end) }
      continue
    }
    merged.push(span)
  }
  return merged.filter((span) => !(span.start === 0 && span.end === text.length && text.length > 0))
}

/**
 * The word-level marks between two blocks of lines.
 *
 * Exported because it is the engine's real seam: the tests pin its behaviour on
 * fixed input, and a future caller (a commit's file diff, FR-7.2) needs the same
 * "which parts of these two blocks differ" answer without a hunk around it.
 * @param original - The removed lines, in file order.
 * @param modified - The added lines, in file order.
 * @returns The marks for each side, indexed by line.
 */
export function wordMarks(
  original: readonly string[],
  modified: readonly string[],
): WordMarks {
  const originalSpans: DiffSpan[][] = original.map(() => [])
  const modifiedSpans: DiffSpan[][] = modified.map(() => [])

  // A block that only adds or only removes has no counterpart to mark against:
  // every line of it is wholly changed, and the row treatment already says so.
  if (original.length > 0 && modified.length > 0) {
    const diff = computer.computeDiff([...original], [...modified], OPTIONS)
    for (const change of diff.changes) {
      for (const inner of change.innerChanges ?? []) {
        collectRange(inner.originalRange, original, originalSpans)
        collectRange(inner.modifiedRange, modified, modifiedSpans)
      }
    }
  }

  return {
    original: originalSpans.map((spans, index) => tidy(spans, original[index] ?? '')),
    modified: modifiedSpans.map((spans, index) => tidy(spans, modified[index] ?? '')),
  }
}

/**
 * One run of changed lines, refined against its counterpart.
 *
 * The run's removals and its additions are two separate sequences to the engine,
 * which is why their offsets are tracked rather than assumed: a block that
 * removes three lines and adds one has three removals to align, and the engine —
 * not this function — decides which of them the addition corresponds to.
 * @param run - The run's lines, in the order the diff printed them.
 * @returns The same lines, with marks where they have any.
 */
function markRun(run: readonly DiffLine[]): DiffLine[] {
  const removed: number[] = []
  const added: number[] = []
  run.forEach((line, offset) => {
    if (line.kind === 'removed') removed.push(offset)
    else if (line.kind === 'added') added.push(offset)
  })

  const marks = wordMarks(
    removed.map((offset) => run[offset]?.text ?? ''),
    added.map((offset) => run[offset]?.text ?? ''),
  )

  const byOffset = new Map<number, readonly DiffSpan[]>()
  removed.forEach((offset, at) => byOffset.set(offset, marks.original[at] ?? []))
  added.forEach((offset, at) => byOffset.set(offset, marks.modified[at] ?? []))

  return run.map((line, offset) => {
    const spans = byOffset.get(offset)
    return spans === undefined ? line : { ...line, marks: spans }
  })
}

/**
 * Add word-level marks to one hunk's changed blocks.
 *
 * A "block" is a maximal run of non-context lines, which is also the unit a
 * unified diff draws: git prints a block's removals and then its additions, and
 * the two sequences are what the engine compares. Runs are marked independently
 * on purpose — pairing a block with a block two hunks away would invent a
 * relationship the diff does not claim.
 * @param hunk - The hunk to refine.
 * @returns The same hunk with its marks filled in.
 */
export function markHunk(hunk: DiffHunk): DiffHunk {
  const marked: DiffLine[] = []
  let index = 0
  while (index < hunk.lines.length) {
    const line = hunk.lines[index]
    if (line === undefined) break
    if (line.kind === 'context') {
      marked.push(line)
      index += 1
      continue
    }
    let end = index
    while (end < hunk.lines.length && hunk.lines[end]?.kind !== 'context') end += 1
    marked.push(...markRun(hunk.lines.slice(index, end)))
    index = end
  }
  return { ...hunk, lines: marked }
}
