/**
 * Lane assignment for the commit graph (FR-7.1).
 *
 * The panel embeds a swimlane diagram beside the history list: each commit is a
 * node in one column, a first parent continues straight down, and every extra
 * parent (a merge) opens a new column. This module turns a page of commits into
 * the per-row drawing instructions; the client turns those into SVG. Everything
 * here is a pure function over {@link CommitInfo}, so the lane arithmetic is
 * testable without a browser or a repository.
 *
 * ## Why a lane, not a colour
 *
 * The rows say where lines are, never what they look like. Column identity is
 * the whole model: a lane is a physical column, so the same lane number in two
 * adjacent rows means the two segments meet. Colour is a presentation choice the
 * renderer makes from the lane number — which also keeps the "no hardcoded
 * colours" rule (§4.3) out of core.
 *
 * ## Continuity across pages (FR-7.1's 分页不断线)
 *
 * The assignment is a single left-to-right pass from the newest commit down, and
 * a row depends only on the rows above it. Building the graph over all loaded
 * commits therefore gives the same rows for the first page whether or not the
 * second page has been loaded: loading more can only extend the diagram, never
 * redraw it. That is the property that makes "pagination does not break the
 * lines" true by construction rather than by a fix-up.
 *
 * @module dsh-git-panel/core/commit-graph
 */

import type { CommitInfo } from './types.ts'

/**
 * How many columns one row's drawing occupies.
 *
 * `lanes` is the count of columns the renderer must reserve, which is what sizes
 * the SVG. It is per row rather than per page, so the caller takes the maximum
 * over the rows; a row with fewer columns still draws at the same x positions
 * because those positions are lane numbers, not offsets within the row.
 */
export interface GraphRow {
  /** Column the commit's node sits in. */
  readonly lane: number
  /**
   * Lanes with a line arriving from the row above.
   *
   * Empty on the newest commit of a line: nothing is above it, so its node is
   * where that line begins.
   */
  readonly from: readonly number[]
  /**
   * Lanes with a line leaving toward the row below.
   *
   * A commit with no parents (a root) ends its line, so its lane is absent here.
   */
  readonly to: readonly number[]
  /**
   * Parent links that are not the straight continuation of the node's own lane.
   *
   * Each edge is drawn within this row, from the node at mid-height to the
   * parent's lane at the row's bottom edge. The first parent that cannot keep
   * the node's lane (because a newer child already claimed its own) also appears
   * here: that is the "a branch merges back into a lane" case.
   */
  readonly edges: readonly GraphEdge[]
  /** Columns this row's drawing spans; the renderer sizes an SVG from it. */
  readonly lanes: number
}

/** One link from a commit's node to a parent that sits in another lane. */
export interface GraphEdge {
  /** Lane the link leaves: always the commit's own lane. */
  readonly from: number
  /** Lane the link arrives at, on the row's bottom edge. */
  readonly to: number
}

/**
 * Assign every commit to a lane and describe the lines between them.
 *
 * `commits` is expected newest-first, as `git log` reports it, and with children
 * before parents — both hold for the history read the panel performs. A commit
 * whose lane is not yet known (a branch tip, or the second parent of a merge
 * seen before any child) opens the first free lane; one already expected by a
 * lane keeps that lane, which is what keeps a first-parent chain straight.
 *
 * @param commits - Commits newest first.
 * @returns One row per commit, in the same order.
 */
export function buildGraph(commits: readonly CommitInfo[]): readonly GraphRow[] {
  /**
   * For each column, the commit the next row down is expected to contain.
   *
   * A `null` slot is free for a new line to open in. Trailing `null`s are
   * trimmed after every row so a wide merge does not reserve columns for the
   * rest of the history, but indices of the remaining lanes never move — that
   * stability is what lets the renderer treat a lane as a fixed column.
   */
  const lanes: (string | null)[] = []
  const rows: GraphRow[] = []

  for (const commit of commits) {
    // Where the line comes from, read before this commit claims anything: a
    // freshly opened lane has nothing above it.
    const from: number[] = []
    for (let index = 0; index < lanes.length; index += 1) {
      if (lanes[index] !== null) from.push(index)
    }

    let lane = lanes.indexOf(commit.oid)
    if (lane === -1) {
      lane = lanes.indexOf(null)
      if (lane === -1) {
        lane = lanes.length
        lanes.push(null)
      }
      lanes[lane] = commit.oid
    }

    // The node now owns its lane; its parents take over from here.
    lanes[lane] = null

    const edges: GraphEdge[] = []
    commit.parents.forEach((parent, index) => {
      let target = lanes.indexOf(parent)
      if (target === -1) {
        // A parent no lane expects yet: the first parent stays in this lane (so
        // a straight chain stays straight), the rest open a free one.
        target = index === 0 ? lane : lanes.indexOf(null)
        if (target === -1) {
          target = lanes.length
          lanes.push(null)
        }
        lanes[target] = parent
      }
      // A first parent that already sits elsewhere is a merge-back: the node's
      // own lane ends here and the link is drawn across.
      if (target !== lane) edges.push({ from: lane, to: target })
    })

    while (lanes.length > 0 && lanes[lanes.length - 1] === null) lanes.pop()

    const to: number[] = []
    let width = lane + 1
    for (let index = 0; index < lanes.length; index += 1) {
      if (lanes[index] !== null) {
        to.push(index)
        width = Math.max(width, index + 1)
      }
    }
    for (const edge of edges) width = Math.max(width, edge.to + 1)

    rows.push({ lane, from, to, edges, lanes: width })
  }

  return rows
}
