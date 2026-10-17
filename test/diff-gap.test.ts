/**
 * Core tests: the runs of unchanged lines between two hunks (A-12).
 *
 * Pure arithmetic and pure text handling, so this file needs no repository, no host
 * and no browser: a list of hunks goes in, the gaps come out, and the text a read
 * returns is numbered against them. What the HOST reads is covered where the real
 * `git show` calls live (`test/host-service.test.ts`), and what the panel draws is
 * covered in jsdom (`test/client-panel.test.ts`).
 *
 * @module dsh-git-panel/test/diff-gap
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  blobLines,
  diffGaps,
  diffSegments,
  gapKey,
  gapLines,
  snippetCoversGap,
  type DiffGap,
} from '../src/core/diff-gap.ts'
import type { DiffHunk } from '../src/core/types.ts'

/** One hunk with no lines of its own: only its coverage matters to this module. */
function hunk(
  oldStart: number,
  oldCount: number,
  newStart: number,
  newCount: number,
  heading = '',
): DiffHunk {
  return { oldStart, oldCount, newStart, newCount, heading, lines: [] }
}

/** The gap between old lines 4 and 9 of the fixture below, both sides at the same numbers. */
function sampleGap(): DiffGap {
  return { oldStart: 4, newStart: 4, count: 6 }
}

describe('diffGaps', () => {
  it('measures the run between two hunks from the hunks alone', () => {
    // The panel asks git for three lines of context per hunk, so a change at line 2
    // and one at line 12 arrive as hunks covering 1–4 and 10–12; lines 5–9 are the
    // run git printed nowhere.
    const gaps = diffGaps([hunk(1, 4, 1, 4), hunk(10, 3, 10, 3)])
    assert.deepEqual(gaps, [{ oldStart: 5, newStart: 5, count: 5 }])
  })

  it('keeps the offset the changes above the gap introduced', () => {
    // Three lines added before the second hunk: the same unchanged run sits at old
    // line 5 and new line 8, which is what both columns of a split read need.
    const gaps = diffGaps([hunk(1, 4, 1, 7), hunk(10, 3, 13, 3)])
    assert.deepEqual(gaps, [{ oldStart: 5, newStart: 8, count: 5 }])
  })

  it('finds no run where the hunks touch', () => {
    // Two changes three context lines apart merge into ONE hunk, and anything closer
    // than that leaves the second hunk starting where the first one ended.
    assert.deepEqual(diffGaps([hunk(1, 4, 1, 4), hunk(5, 3, 5, 3)]), [])
  })

  it('does not invent a run above the first hunk or below the last one', () => {
    // A `FileDiff` does not carry the file's total line count — its `lines` is the sum
    // of the hunks' own lines — so those two directions are deliberately left undone
    // rather than guessed at. One hunk, and hunks that touch the file's edges, all
    // produce nothing.
    assert.deepEqual(diffGaps([]), [])
    assert.deepEqual(diffGaps([hunk(1, 3, 1, 3)]), [])
    assert.deepEqual(diffGaps([hunk(5, 3, 5, 3)]), [])
  })

  it('finds every run of a many-hunk diff, in file order', () => {
    const gaps = diffGaps([hunk(1, 3, 1, 3), hunk(10, 3, 10, 3), hunk(30, 3, 30, 3)])
    assert.deepEqual(gaps, [
      { oldStart: 4, newStart: 4, count: 6 },
      { oldStart: 13, newStart: 13, count: 17 },
    ])
  })

  it('refuses a run the two sides disagree about', () => {
    // Across an unchanged run both sides advance by the same number of lines; a diff
    // whose sides do not is not one this can number honestly, so no gap is drawn
    // rather than lines put at the wrong numbers.
    assert.deepEqual(diffGaps([hunk(1, 3, 1, 3), hunk(10, 3, 12, 3)]), [])
  })
})

describe('diffSegments', () => {
  it('walks hunks and the runs between them, the gap first', () => {
    const first = hunk(1, 4, 1, 4, 'a')
    const second = hunk(10, 3, 10, 3, 'b')
    const segments = diffSegments([first, second])

    assert.deepEqual(
      segments.map((segment) => segment.kind),
      ['hunk', 'gap', 'hunk'],
    )
    assert.equal(segments[0]?.kind === 'hunk' ? segments[0].hunk : null, first)
    assert.deepEqual(segments[1]?.kind === 'gap' ? segments[1].gap : null, {
      oldStart: 5,
      newStart: 5,
      count: 5,
    })
    assert.equal(segments[2]?.kind === 'hunk' ? segments[2].hunk : null, second)
  })

  it('leaves a fully-contexted diff as hunks alone', () => {
    // No empty band between touching hunks: the row only exists where lines are
    // actually missing.
    assert.deepEqual(
      diffSegments([hunk(1, 4, 1, 4), hunk(5, 3, 5, 3)]).map((segment) => segment.kind),
      ['hunk', 'hunk'],
    )
  })
})

describe('gapKey', () => {
  it('addresses a gap by the line it begins at', () => {
    // Unique within one file's diff, and safe as an attribute value — which is why it
    // is not the `\0`-joined key the pane namespaces with.
    assert.equal(gapKey(sampleGap()), 'gap-4')
  })
})

describe('blobLines', () => {
  it('drops the empty tail a trailing newline leaves behind', () => {
    assert.deepEqual(blobLines('one\ntwo\n'), ['one', 'two'])
  })

  it('keeps a last line that is genuinely empty', () => {
    // Two newlines at the end mean the file's last line is empty; dropping every
    // empty tail would silently shorten it, and the numbering below would be wrong.
    assert.deepEqual(blobLines('one\n\n'), ['one', ''])
  })

  it('reads a file with no trailing newline, and an empty file', () => {
    assert.deepEqual(blobLines('one'), ['one'])
    assert.deepEqual(blobLines(''), [])
  })

  it('reads an empty line as a line', () => {
    assert.deepEqual(blobLines('\n'), [''])
  })
})

describe('gapLines', () => {
  it('numbers both sides from the gap, offset included', () => {
    const gap: DiffGap = { oldStart: 5, newStart: 8, count: 3 }
    const lines = gapLines(gap, ['a', 'b', 'c'])

    assert.deepEqual(
      lines.map((line) => [line.kind, line.text, line.oldLine, line.newLine]),
      [
        ['context', 'a', 5, 8],
        ['context', 'b', 6, 9],
        ['context', 'c', 7, 10],
      ],
    )
    // A reconstructed context line carries no word-level marks: nothing in it changed,
    // and highlighting an unchanged run would claim otherwise.
    assert.deepEqual(lines.map((line) => line.marks), [[], [], []])
  })

  it('is empty for an empty run', () => {
    assert.deepEqual(gapLines({ oldStart: 1, newStart: 1, count: 0 }, []), [])
  })
})

describe('snippetCoversGap', () => {
  it('accepts exactly the run that was asked for', () => {
    assert.equal(
      snippetCoversGap(sampleGap(), { from: 4, lines: ['a', 'b', 'c', 'd', 'e', 'f'], truncated: false }),
      true,
    )
  })

  it('refuses a range that was cut short', () => {
    // The host's ceiling and the runner's byte cap both arrive as `truncated`, and
    // half a run would put every following line at the wrong number.
    assert.equal(
      snippetCoversGap(sampleGap(), { from: 4, lines: ['a', 'b', 'c', 'd', 'e', 'f'], truncated: true }),
      false,
    )
  })

  it('refuses a short answer, and one that starts somewhere else', () => {
    // The file moved under the diff: the same position is no longer the same run.
    assert.equal(
      snippetCoversGap(sampleGap(), { from: 4, lines: ['a', 'b'], truncated: false }),
      false,
    )
    assert.equal(
      snippetCoversGap(sampleGap(), { from: 5, lines: ['a', 'b', 'c', 'd', 'e', 'f'], truncated: false }),
      false,
    )
  })
})
