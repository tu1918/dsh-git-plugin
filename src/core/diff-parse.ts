/**
 * `git diff` output → the panel's diff model.
 *
 * The parser is in core, next to `git-parse.ts`, for the same reason that one is:
 * it is a byte-level reading of git's output, and the interesting part of a diff
 * view is exactly this translation — so it must be testable by handing it a
 * string, with no repository, no host, and no browser in the way.
 *
 * ## Why git produces the line structure
 *
 * The line-level hunks come from git rather than from the diff engine
 * (`diff-engine/marks.ts` explains the split): git honours `.gitattributes`
 * filters, detects renames, sniffs binary files, and can be asked for a range of
 * context — none of which an in-process comparer over two strings can promise,
 * and all of which the panel would then have to reimplement and keep in step with
 * git. The engine's job is the part git does not report: which characters inside
 * a changed line actually changed.
 *
 * ## What the parser tolerates
 *
 * Real output is messy, and every tolerance here exists because of a case that
 * reaches this file:
 *
 * - a **binary** file, which git answers with one sentence and no hunks;
 * - a **combined** diff (`diff --cc`, from a conflicted path), which is a
 *   different format with `@@@` headers — recognised and set aside rather than
 *   misread as ordinary hunks;
 * - **truncation** at the host's byte cap, which can leave the last hunk half
 *   printed: whatever arrived is parsed, and the flag says the tail is missing;
 * - paths git **quotes** (`"a/pa\tth"`), mode-only changes, renames, and the
 *   `\ No newline at end of file` marker — all of which are skipped because the
 *   panel asked for exactly one path and reads only its body lines.
 *
 * @module dsh-git-panel/core/diff-parse
 */

import { markHunk } from './diff-engine/marks.ts'
import type { DiffArea, DiffHunk, DiffLine, FileDiff } from './types.ts'

/**
 * Body lines past which the panel opens a diff folded (FR-2.6).
 *
 * The host never folds: it counts, and says so in the response. Folding is a
 * rendering decision, and the browser half is where rendering decisions live.
 */
export const MAX_DIFF_LINES = 5000

/**
 * A hunk header: `@@ -oldStart,oldCount +newStart,newCount @@ heading`.
 *
 * git omits a count of 1 (`@@ -1 +1 @@`), which is why both counts are optional
 * in the pattern and defaulted rather than rejected.
 */
const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/u

/** What {@link parseUnifiedDiff} needs to know about the request. */
export interface ParseUnifiedDiffOptions {
  /** The path the diff was asked for; echoed back for the renderer's header. */
  readonly path: string
  /** Which comparison git was asked for; echoed back for the same reason. */
  readonly area: DiffArea
  /**
   * Whether git's output was cut at the host's byte cap. Not something the text
   * can reveal — a truncated diff looks like a shorter diff — so the runner's
   * own flag is passed through.
   */
  readonly truncated: boolean
  /**
   * Whether the text compares the two sides of an unmerged path rather than one
   * state against another. The text cannot say — both are ordinary unified
   * diffs — so the host, which knows which command it ran, passes it through.
   * Optional, and false, for the callers that only read a plain diff.
   */
  readonly conflict?: boolean
}

/** A hunk while it is being read. */
interface PendingHunk {
  readonly oldStart: number
  readonly oldCount: number
  readonly newStart: number
  readonly newCount: number
  readonly heading: string
  readonly lines: DiffLine[]
  /** Next old-file line number, 1-based. */
  oldNumber: number
  /** Next new-file line number, 1-based. */
  newNumber: number
}

/**
 * Read one `git diff` output into the panel's {@link FileDiff}.
 * @param text - git's stdout, verbatim.
 * @param options - The path, the area, and whether the output was cut.
 * @returns The diff, ready for the wire.
 */
export function parseUnifiedDiff(text: string, options: ParseUnifiedDiffOptions): FileDiff {
  const hunks: DiffHunk[] = []
  let pending: PendingHunk | null = null
  let binary = false
  let combined = false
  /** Whether the section being read is a combined diff, whose body is skipped. */
  let sectionCombined = false
  let additions = 0
  let deletions = 0

  /** Close the hunk in progress, if any. */
  const flush = (): void => {
    if (pending === null) return
    hunks.push(
      markHunk({
        oldStart: pending.oldStart,
        oldCount: pending.oldCount,
        newStart: pending.newStart,
        newCount: pending.newCount,
        heading: pending.heading,
        lines: pending.lines,
      }),
    )
    pending = null
  }

  /** Append one body line of the hunk in progress. */
  const body = (marker: string, content: string): void => {
    if (pending === null) return
    if (marker === '+') {
      pending.lines.push({
        kind: 'added',
        text: content,
        oldLine: null,
        newLine: pending.newNumber,
        marks: [],
      })
      pending.newNumber += 1
      additions += 1
      return
    }
    if (marker === '-') {
      pending.lines.push({
        kind: 'removed',
        text: content,
        oldLine: pending.oldNumber,
        newLine: null,
        marks: [],
      })
      pending.oldNumber += 1
      deletions += 1
      return
    }
    pending.lines.push({
      kind: 'context',
      text: content,
      oldLine: pending.oldNumber,
      newLine: pending.newNumber,
      marks: [],
    })
    pending.oldNumber += 1
    pending.newNumber += 1
  }

  const rows = text.split('\n')
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index] as string
    // The split leaves an empty tail whenever the output ended with a newline,
    // which is every well-formed diff.
    if (index === rows.length - 1 && row === '') break

    // A hunk's own content is always prefixed, so an unprefixed marker can only
    // be structure: this test is what lets the header checks below run without
    // mistaking a removed line that happens to read "@@" for a header.
    if (pending !== null && /^[ +\-\\]/u.test(row)) {
      if (row.startsWith('\\')) continue
      body(row.slice(0, 1), row.slice(1))
      continue
    }

    if (row.startsWith('diff --cc ') || row.startsWith('diff --combined ')) {
      flush()
      combined = true
      sectionCombined = true
      continue
    }
    if (row.startsWith('diff --git ')) {
      flush()
      sectionCombined = false
      continue
    }
    // A combined diff's body is a different grammar (`@@@ -1,2 -1,2 +1,3 @@@`
    // and two-column prefixes). It is skipped whole rather than half-read: the
    // conflict view that would render it is FR-9.
    if (sectionCombined) {
      continue
    }
    if (row.startsWith('Binary files ') || row.startsWith('GIT binary patch')) {
      flush()
      binary = true
      continue
    }

    const header = HUNK_HEADER.exec(row)
    if (header !== null) {
      flush()
      const oldStart = Number(header[1] ?? 1)
      const newStart = Number(header[3] ?? 1)
      pending = {
        oldStart,
        oldCount: header[2] === undefined ? 1 : Number(header[2]),
        newStart,
        newCount: header[4] === undefined ? 1 : Number(header[4]),
        heading: header[5] ?? '',
        lines: [],
        oldNumber: oldStart,
        newNumber: newStart,
      }
      continue
    }
    // Anything else outside a hunk is a section header git prints for us to
    // ignore: `index …`, `new file mode …`, `rename from …`, `--- a/…`.
  }
  flush()

  const lines = hunks.reduce((total, hunk) => total + hunk.lines.length, 0)
  return {
    path: options.path,
    area: options.area,
    hunks,
    additions,
    deletions,
    lines,
    binary,
    combined,
    conflict: options.conflict ?? false,
    large: lines > MAX_DIFF_LINES,
    truncated: options.truncated,
  }
}
