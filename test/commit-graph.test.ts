/**
 * Commit graph lane assignment (FR-7.1).
 *
 * The diagram is only as good as the columns it puts commits in, and the two
 * properties asked for — a merge opens a lane, a fork closes one — are both
 * statements about lane numbers. The last test is the one the requirement names
 * in its own words: pagination must not break the lines.
 *
 * @module dsh-git-panel/test/commit-graph
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { buildGraph } from '../src/core/commit-graph.ts'
import type { CommitInfo } from '../src/core/types.ts'

/** A commit with the given short id (used as the full id too) and parents. */
function commit(oid: string, parents: readonly string[] = []): CommitInfo {
  return {
    oid,
    shortOid: oid,
    subject: `${oid} subject`,
    authorName: 'Ada',
    authoredAt: '2026-09-11T10:00:00+08:00',
    committedAt: '2026-09-11T10:00:00+08:00',
    parents,
    refs: [],
    pushed: null,
  }
}

describe('buildGraph (FR-7.1)', () => {
  it('answers nothing for an empty history', () => {
    assert.deepEqual(buildGraph([]), [])
  })

  it('keeps a linear history in one lane, opened at the tip and closed at the root', () => {
    const rows = buildGraph([commit('c', ['b']), commit('b', ['a']), commit('a')])
    assert.deepEqual(
      rows.map((row) => ({ lane: row.lane, from: row.from, to: row.to, edges: row.edges, lanes: row.lanes })),
      [
        { lane: 0, from: [], to: [0], edges: [], lanes: 1 },
        { lane: 0, from: [0], to: [0], edges: [], lanes: 1 },
        { lane: 0, from: [0], to: [], edges: [], lanes: 1 },
      ],
    )
  })

  it('opens a lane for a merge’s second parent and closes it when that line rejoins', () => {
    // m ─┬─ a ─┐
    //    └─ b ─┴─ base
    const rows = buildGraph([
      commit('m', ['a', 'b']),
      commit('a', ['base']),
      commit('b', ['base']),
      commit('base'),
    ])

    // The merge fans out from the node into the new lane.
    assert.deepEqual(rows[0], { lane: 0, from: [], to: [0, 1], edges: [{ from: 0, to: 1 }], lanes: 2 })
    // The first-parent chain stays straight while the second line passes through.
    assert.deepEqual(rows[1], { lane: 0, from: [0, 1], to: [0, 1], edges: [], lanes: 2 })
    // b sits in the second lane and its link back to base crosses over.
    assert.deepEqual(rows[2], { lane: 1, from: [0, 1], to: [0], edges: [{ from: 1, to: 0 }], lanes: 2 })
    // base closes the line: nothing leaves it, so no column is reserved below.
    assert.deepEqual(rows[3], { lane: 0, from: [0], to: [], edges: [], lanes: 1 })
  })

  it('merges a first parent that already has a lane back into that lane', () => {
    // n ─┐
    // m ─┴─ (parents x, y): x is already expected by lane 0, so m's link crosses
    // over and m's own lane continues with y.
    const rows = buildGraph([commit('n', ['x']), commit('m', ['x', 'y']), commit('y', ['x']), commit('x')])
    assert.deepEqual(rows[0], { lane: 0, from: [], to: [0], edges: [], lanes: 1 })
    assert.deepEqual(rows[1], { lane: 1, from: [0], to: [0, 1], edges: [{ from: 1, to: 0 }], lanes: 2 })
    assert.deepEqual(rows[2], { lane: 1, from: [0, 1], to: [0], edges: [{ from: 1, to: 0 }], lanes: 2 })
    assert.deepEqual(rows[3], { lane: 0, from: [0], to: [], edges: [], lanes: 1 })
  })

  it('gives a tip that no line expects its own lane', () => {
    const rows = buildGraph([commit('t1', ['p1']), commit('t2', ['p2']), commit('p1'), commit('p2')])
    assert.equal(rows[0]?.lane, 0)
    assert.equal(rows[1]?.lane, 1, 'the second unrelated tip opens lane 1')
    assert.deepEqual(rows[1]?.from, [0], 'and the first tip’s line is passing through')
    assert.deepEqual(rows[2]?.to, [1], 'p1 ends, p2’s line continues')
    assert.deepEqual(rows[3]?.to, [])
  })

  it('does not redraw the lines when another page is loaded', () => {
    const all = [
      commit('d', ['c']),
      commit('c', ['a', 'b']),
      commit('a', ['base']),
      commit('b', ['base']),
      commit('base'),
    ]
    const firstPage = buildGraph(all.slice(0, 2))
    const whole = buildGraph(all)
    assert.deepEqual(firstPage, whole.slice(0, 2), 'a prefix of the history is a prefix of the graph')
  })
})
