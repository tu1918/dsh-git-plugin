/**
 * The change list as a file tree (FR-1.3).
 *
 * A pure function over the same {@link FileChange} list the flat view renders, so
 * the two modes cannot disagree about what changed: they differ only in how the
 * paths are arranged, never in which entries exist.
 *
 * Three decisions are worth stating, because each is a visible property of the
 * tree rather than an implementation detail:
 *
 * - **Directories first, then files, each in git's own byte order.** Not the
 *   operating system's locale order: the list is a view of the repository, and it
 *   has to look the same on two machines looking at the same commit. (`git
 *   status` itself sorts bytewise, which is also why a plain code-point
 *   comparison is the right one here and `localeCompare` is not.)
 * - **A chain of single-child directories is compacted** into one node, so
 *   `src/core/diff-engine/marks.ts` arrives as `src/core/diff-engine` + the file
 *   rather than as six rows of one entry each. The sidebar is narrow; a tree that
 *   spends its width on arrows has stopped paying for itself. A directory that
 *   also holds a changed file is never compacted, because its own row is
 *   something the user can fold.
 * - **Each group builds its own tree.** A file with a staged and an unstaged
 *   change appears in both of FR-1.1's groups, and each group is its own list —
 *   merging them into one tree would have to invent a row that means two things.
 *
 * @module dsh-git-panel/core/change-tree
 */

import type { FileChange } from './types.ts'

/** One directory in the tree. */
export interface ChangeTreeDir {
  /** Discriminant. */
  readonly kind: 'dir'
  /** Path from the repository root, `/`-separated, without a trailing slash. */
  readonly path: string
  /**
   * What the row draws: the last segment, or several segments when a chain was
   * compacted (`core/diff-engine`). Always a suffix of {@link path}.
   */
  readonly label: string
  /** Subdirectories first, then files. */
  readonly children: readonly ChangeTreeNode[]
  /** Changed files at every depth under this directory. */
  readonly count: number
}

/** One changed file in the tree. */
export interface ChangeTreeFile {
  /** Discriminant. */
  readonly kind: 'file'
  /** The change itself, exactly as the flat list would have rendered it. */
  readonly entry: FileChange
  /** File name only; its directories are the nodes above it. */
  readonly name: string
}

/** One row of a group's tree. */
export type ChangeTreeNode = ChangeTreeDir | ChangeTreeFile

/** Byte-order comparison, so the order does not depend on the machine's locale. */
function byName(left: string, right: string): number {
  if (left === right) return 0
  return left < right ? -1 : 1
}

/** A directory while it is being built. */
interface Draft {
  readonly dirs: Map<string, Draft>
  readonly files: ChangeTreeFile[]
}

/** Build one level of the tree from its draft. */
function finish(draft: Draft, prefix: string): readonly ChangeTreeNode[] {
  const children: ChangeTreeNode[] = []
  for (const [name, child] of [...draft.dirs].sort(([a], [b]) => byName(a, b))) {
    const path = prefix === '' ? name : `${prefix}/${name}`
    const nodes = finish(child, path)
    children.push(compact(path, name, nodes))
  }
  return [...children, ...[...draft.files].sort((a, b) => byName(a.name, b.name))]
}

/**
 * Fold a directory that has exactly one child directory and no files into it.
 * @param path - The directory's own path.
 * @param label - The directory's own label.
 * @param children - Its finished children.
 * @returns The directory, possibly merged with its only child.
 */
function compact(path: string, label: string, children: readonly ChangeTreeNode[]): ChangeTreeDir {
  const only = children.length === 1 ? children[0] : undefined
  if (only !== undefined && only.kind === 'dir') {
    // The child's label is a suffix of its path; joining keeps the drawn label
    // equal to the path's tail, which is what makes the row readable.
    return {
      kind: 'dir',
      path: only.path,
      label: `${label}/${only.label}`,
      children: only.children,
      count: only.count,
    }
  }
  return { kind: 'dir', path, label, children, count: countOf(children) }
}

/** How many files sit at or under these nodes. */
function countOf(nodes: readonly ChangeTreeNode[]): number {
  let total = 0
  for (const node of nodes) total += node.kind === 'dir' ? node.count : 1
  return total
}

/**
 * Arrange one group's changes as a tree (FR-1.3).
 *
 * A path with no `/` becomes a top-level file, which is the same row the flat
 * list draws; nothing here rewrites a path, so the entry a row opens a diff for
 * is always the entry git reported.
 * @param entries - One group's changes, in git's order.
 * @returns The tree's top-level nodes; a directory per distinct leading segment.
 */
export function changeTreeOf(entries: readonly FileChange[]): readonly ChangeTreeNode[] {
  const root: Draft = { dirs: new Map(), files: [] }

  for (const entry of entries) {
    const segments = entry.path.split('/')
    const name = segments.pop() ?? entry.path
    let level = root
    for (const segment of segments) {
      let next = level.dirs.get(segment)
      if (next === undefined) {
        next = { dirs: new Map(), files: [] }
        level.dirs.set(segment, next)
      }
      level = next
    }
    level.files.push({ kind: 'file', entry, name })
  }

  return finish(root, '')
}
