/**
 * Core tests: the unified-diff parser and the word-level marking that feeds it.
 *
 * Both halves of this file are pure: a string in, the panel's diff model out. The
 * fixtures below are real `git diff` output, kept verbatim from the commands the
 * host runs — including the parts the parser is supposed to ignore, because those
 * are exactly the lines an over-eager parser gets wrong.
 *
 * @module dsh-git-panel/test/diff-parse
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { MAX_DIFF_LINES, parseUnifiedDiff } from '../src/core/diff-parse.ts'
import { markHunk, wordMarks } from '../src/core/diff-engine/marks.ts'
import type { DiffHunk } from '../src/core/types.ts'

/** One ordinary two-hunk modification, as `git diff` prints it. */
const TWO_HUNKS = [
  'diff --git a/src/app.ts b/src/app.ts',
  'index 1111111..2222222 100644',
  '--- a/src/app.ts',
  '+++ b/src/app.ts',
  '@@ -1,5 +1,5 @@',
  " import { start } from './boot'",
  ' ',
  '-const port = 3000',
  '+const port = 8080',
  ' start(port)',
  ' ',
  '@@ -20,3 +20,4 @@ function tail() {',
  '   const done = true',
  '   return done',
  ' }',
  '+// trailing comment',
  '',
].join('\n')

/** A brand-new file, which is how the untracked path reaches the parser. */
const NEW_FILE = [
  'diff --git a/new.txt b/new.txt',
  'new file mode 100644',
  'index 0000000..94954ab',
  '--- /dev/null',
  '+++ b/new.txt',
  '@@ -0,0 +1,2 @@',
  '+hello',
  '+world',
  '',
].join('\n')

describe('parseUnifiedDiff', () => {
  it('reads hunks, line numbers, and counts', () => {
    const diff = parseUnifiedDiff(TWO_HUNKS, { path: 'src/app.ts', area: 'worktree', truncated: false })

    assert.equal(diff.path, 'src/app.ts')
    assert.equal(diff.area, 'worktree')
    assert.equal(diff.binary, false)
    assert.equal(diff.combined, false)
    assert.equal(diff.large, false)
    assert.equal(diff.additions, 2)
    assert.equal(diff.deletions, 1)
    assert.equal(diff.lines, 10)
    assert.equal(diff.hunks.length, 2)

    const [first, second] = diff.hunks
    assert.ok(first !== undefined && second !== undefined)
    assert.deepEqual(
      [first.oldStart, first.oldCount, first.newStart, first.newCount, first.heading],
      [1, 5, 1, 5, ''],
    )
    assert.deepEqual(
      [second.oldStart, second.oldCount, second.newStart, second.newCount, second.heading],
      [20, 3, 20, 4, 'function tail() {'],
    )

    // The changed lines carry both numbers on the side they exist on, and none
    // on the side they do not: that is what the renderer's gutter reads.
    const removed = first.lines.find((line) => line.kind === 'removed')
    const added = first.lines.find((line) => line.kind === 'added')
    assert.deepEqual(
      [removed?.oldLine, removed?.newLine, added?.oldLine, added?.newLine],
      [3, null, null, 3],
    )
    assert.deepEqual(first.lines.map((line) => line.kind), [
      'context',
      'context',
      'removed',
      'added',
      'context',
      'context',
    ])
    // A blank context line is a space and nothing else, not an absent line.
    assert.equal(first.lines[1]?.text, '')
    assert.deepEqual(second.lines.map((line) => line.kind), [
      'context',
      'context',
      'context',
      'added',
    ])
    assert.equal(second.lines[3]?.newLine, 23)
  })

  it('marks the words that changed, on both sides', () => {
    const diff = parseUnifiedDiff(TWO_HUNKS, { path: 'src/app.ts', area: 'worktree', truncated: false })
    const first = diff.hunks[0]
    assert.ok(first !== undefined)
    const removed = first.lines.find((line) => line.kind === 'removed')
    const added = first.lines.find((line) => line.kind === 'added')

    // Asserting the marked TEXT, not the offsets: the marks are what the
    // renderer slices, and the engine owns the offsets.
    assert.deepEqual(marked(removed), ['3000'])
    assert.deepEqual(marked(added), ['8080'])
  })

  it('gives a whole-line replacement no inner marks', () => {
    // The row already says the line changed; painting the entire sentence in the
    // mark colour as well would make the mark colour mean nothing.
    const text = ['@@ -1 +1 @@', '-foo', '+bar', ''].join('\n')
    const diff = parseUnifiedDiff(text, { path: 'a.txt', area: 'worktree', truncated: false })
    assert.equal(diff.hunks.length, 1)
    assert.deepEqual(diff.hunks[0]?.lines.map((line) => line.marks), [[], []])
    // Both counts defaulted to 1, since git omits a count of one.
    assert.deepEqual(
      [diff.hunks[0]?.oldCount, diff.hunks[0]?.newCount],
      [1, 1],
    )
  })

  it('renders a new file as one whole addition', () => {
    const diff = parseUnifiedDiff(NEW_FILE, { path: 'new.txt', area: 'worktree', truncated: false })
    assert.equal(diff.additions, 2)
    assert.equal(diff.deletions, 0)
    assert.deepEqual(diff.hunks[0]?.lines.map((line) => line.text), ['hello', 'world'])
    assert.deepEqual(diff.hunks[0]?.lines.map((line) => line.oldLine), [null, null])
    // Nothing to pair an addition against, so no inner marks are invented.
    assert.deepEqual(diff.hunks[0]?.lines.map((line) => line.marks), [[], []])
  })

  it('reads a binary file as a sentence, not as hunks', () => {
    const text = [
      'diff --git a/img.png b/img.png',
      'index 1111111..2222222 100644',
      'Binary files a/img.png and b/img.png differ',
      '',
    ].join('\n')
    const diff = parseUnifiedDiff(text, { path: 'img.png', area: 'index', truncated: false })
    assert.equal(diff.binary, true)
    assert.deepEqual(diff.hunks, [])
    assert.equal(diff.lines, 0)
  })

  it('sets a combined diff aside instead of misreading it', () => {
    // `git diff` answers a conflicted path with `diff --cc` and `@@@` headers,
    // whose body has two prefix columns. Parsing that as ordinary hunks would
    // invent lines; the conflict view that renders it is FR-9.
    const text = [
      'diff --cc src/conflict.ts',
      'index 1111111,2222222..3333333',
      '--- a/src/conflict.ts',
      '+++ b/src/conflict.ts',
      '@@@ -1,2 -1,2 +1,3 @@@',
      '  keep',
      '- ours',
      ' -theirs',
      '++both',
      '',
    ].join('\n')
    const diff = parseUnifiedDiff(text, { path: 'src/conflict.ts', area: 'worktree', truncated: false })
    assert.equal(diff.combined, true)
    assert.deepEqual(diff.hunks, [])
    assert.equal(diff.binary, false)
  })

  it('ignores the no-newline marker', () => {
    const text = ['@@ -1 +1 @@', '-old', '\\ No newline at end of file', '+new', ''].join('\n')
    const diff = parseUnifiedDiff(text, { path: 'a.txt', area: 'worktree', truncated: false })
    assert.deepEqual(diff.hunks[0]?.lines.map((line) => line.text), ['old', 'new'])
  })

  it('reports an empty diff for empty output', () => {
    const diff = parseUnifiedDiff('', { path: 'a.txt', area: 'worktree', truncated: false })
    assert.deepEqual(diff.hunks, [])
    assert.equal(diff.lines, 0)
    assert.equal(diff.truncated, false)
  })

  it('carries the runner’s truncation flag through', () => {
    // A cut diff looks like a shorter diff, so the fact cannot be re-derived
    // from the text: it travels from the runner.
    const diff = parseUnifiedDiff(TWO_HUNKS, { path: 'src/app.ts', area: 'index', truncated: true })
    assert.equal(diff.truncated, true)
    assert.equal(diff.area, 'index')
  })

  it('opens a diff past the render budget folded', () => {
    const body = Array.from({ length: MAX_DIFF_LINES + 1 }, (_, index) => `+line ${index}`)
    const text = ['@@ -0,0 +1,5001 @@', ...body, ''].join('\n')
    const diff = parseUnifiedDiff(text, { path: 'big.txt', area: 'worktree', truncated: false })
    assert.equal(diff.lines, MAX_DIFF_LINES + 1)
    assert.equal(diff.large, true)
    // The host counts; it does not fold. The lines are all there to expand.
    assert.equal(diff.hunks[0]?.lines.length, MAX_DIFF_LINES + 1)
  })
})

describe('wordMarks', () => {
  it('marks the changed token on both sides', () => {
    const marks = wordMarks(['const a = 1'], ['const b = 1'])
    assert.deepEqual(marks.original[0], [{ start: 6, end: 7 }])
    assert.deepEqual(marks.modified[0], [{ start: 6, end: 7 }])
  })

  it('marks a pure insertion on the added side only', () => {
    const marks = wordMarks(['  return a + b'], ['  return a + b + c'])
    assert.deepEqual(marks.original[0], [])
    assert.deepEqual(marks.modified[0], [{ start: 14, end: 18 }])
  })

  it('marks nothing when the whole line changed', () => {
    const marks = wordMarks(['foo'], ['bar'])
    assert.deepEqual(marks.original, [[]])
    assert.deepEqual(marks.modified, [[]])
  })

  it('marks nothing when there is no counterpart block', () => {
    // A block that only adds (or only removes) has nothing to align against.
    assert.deepEqual(wordMarks([], ['a', 'b']).modified, [[], []])
    assert.deepEqual(wordMarks(['a', 'b'], []).original, [[], []])
  })
})

describe('markHunk', () => {
  it('pairs each changed block on its own', () => {
    // Two blocks in one hunk: pairing across the context line would invent a
    // relationship the diff does not claim.
    const hunk: DiffHunk = {
      oldStart: 1,
      oldCount: 5,
      newStart: 1,
      newCount: 5,
      heading: '',
      lines: [
        { kind: 'removed', text: 'alpha = 1', oldLine: 1, newLine: null, marks: [] },
        { kind: 'added', text: 'alpha = 2', oldLine: null, newLine: 1, marks: [] },
        { kind: 'context', text: 'unchanged', oldLine: 2, newLine: 2, marks: [] },
        { kind: 'removed', text: 'beta = 3', oldLine: 3, newLine: null, marks: [] },
        { kind: 'added', text: 'beta = 4', oldLine: null, newLine: 3, marks: [] },
      ],
    }
    const marked = markHunk(hunk)
    assert.deepEqual(marked.lines.map((line) => line.marks.length > 0), [true, true, false, true, true])
    assert.deepEqual(marked.lines[3]?.marks, [{ start: 7, end: 8 }])
    // The input hunk is not mutated: the parser hands over a value it still owns.
    assert.deepEqual(hunk.lines[0]?.marks, [])
  })
})

/**
 * The text under a line's marks, for assertions that read like the change rather
 * than like offsets.
 * @param line - A diff line, or undefined.
 * @returns One substring per mark.
 */
function marked(line: { readonly text: string; readonly marks: readonly { start: number; end: number }[] } | undefined): string[] {
  if (line === undefined) return []
  return line.marks.map((mark) => line.text.slice(mark.start, mark.end))
}
