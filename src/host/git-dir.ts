/**
 * Where a work tree keeps its git directory.
 *
 * Two host modules need this and neither should own it: the git state probe
 * stats `HEAD`/`index`/`MERGE_HEAD` inside it (FR-1.4), and the git service asks
 * whether `MERGE_HEAD` exists at all, which is the one fact `git status
 * --porcelain=v2` does not report and FR-9.3 needs (a fully resolved merge has
 * no unmerged paths left, yet is still open).
 *
 * Reading it instead of asking git is deliberate: it is the same two syscalls the
 * probe already performs, where a `git rev-parse --git-dir` would
 * be a process per status read.
 *
 * @module dsh-git-panel/host/git-dir
 */

import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Locate the git directory that owns a work tree's state files.
 *
 * A plain checkout has `.git/` as a directory; a linked worktree or a submodule
 * has `.git` as a FILE holding `gitdir: <path>`, and in that case HEAD and the
 * index live in the linked directory. Reading the pointer covers both without a
 * git process.
 * @param root - Absolute work tree root.
 * @returns Absolute git directory path.
 */
export async function gitDirOf(root: string): Promise<string> {
  const dotGit = join(root, '.git')
  try {
    const info = await stat(dotGit)
    if (info.isDirectory()) return dotGit
  } catch {
    return dotGit
  }
  try {
    const pointer = await readFile(dotGit, 'utf8')
    const match = /^gitdir:\s*(.+)$/mu.exec(pointer)
    if (match?.[1] !== undefined) {
      const target = match[1].trim()
      return target.startsWith('/') ? target : join(root, target)
    }
  } catch {
    // Fall through to the conventional path: a git that cannot read its own
    // pointer is a git whose poll simply reports no change.
  }
  return dotGit
}
