/**
 * Domain model for the git panel.
 *
 * This module is pure TypeScript with no DSH, cordis, React, or Node imports, so
 * it runs unchanged in a bare `node --test` process. Both halves of the plugin
 * speak these types; only the adapters translate to and from DSH's own shapes.
 *
 * Paths in this model are always repo-relative and `/`-separated, whatever the
 * host platform: `git` emits `/` in porcelain output, and the client never sees
 * an absolute path.
 *
 * @module dsh-git-panel/core/types
 */

/** One letter of a porcelain-v2 `XY` status pair, plus `?` for untracked. */
export type StatusCode =
  /** modified */
  | 'M'
  /** type changed (file ⇄ symlink, or mode) */
  | 'T'
  /** added */
  | 'A'
  /** deleted */
  | 'D'
  /** renamed */
  | 'R'
  /** copied */
  | 'C'
  /** unmerged (both sides changed) */
  | 'U'
  /** untracked */
  | '?'
  /** no change on this side */
  | '.'

/** Which of the panel's lists a change belongs to. */
export type ChangeArea = 'staged' | 'unstaged' | 'untracked' | 'conflicted'

/**
 * One changed path as `git status` reports it.
 *
 * A path carries two independent status letters — the index (`staged`) one and
 * the worktree (`unstaged`) one — so a file modified in both areas appears in
 * two groups from one entry. The panel never invents an entry: whatever the
 * groups show is exactly what the index holds, which is the doc's FR-3.4
 * ("提交范围必须显式可见").
 */
export interface FileChange {
  /** Repo-relative path, `/`-separated. */
  readonly path: string
  /** The previous path of a rename or copy. */
  readonly origPath?: string
  /** Index-side status letter (`X`). */
  readonly index: StatusCode
  /** Worktree-side status letter (`Y`). */
  readonly worktree: StatusCode
  /** True when the index side carries a change (the path is staged). */
  readonly staged: boolean
  /** True for an untracked path. */
  readonly untracked: boolean
  /** True for an unmerged path. */
  readonly conflicted: boolean
}

/** The panel's four lists, in render order. */
export interface StatusGroups {
  /** Index-side changes: what `commit` would record right now. */
  readonly staged: readonly FileChange[]
  /** Worktree-side changes to a tracked path. */
  readonly unstaged: readonly FileChange[]
  /** Paths git does not track yet. */
  readonly untracked: readonly FileChange[]
  /** Unmerged paths, from a conflicted merge/rebase/cherry-pick. */
  readonly conflicted: readonly FileChange[]
}

/** Whether HEAD points at a branch, is detached, or the repo has no commit yet. */
export type HeadState = 'branch' | 'detached' | 'unborn'

/**
 * Where HEAD is and how it relates to its upstream (FR-1.5).
 *
 * `ahead`/`behind` are 0 when there is no upstream or the counts are unknown;
 * `upstream` distinguishes "in sync" from "nothing to compare against", which
 * the sync actions' enabled state depends on (FR-5.1).
 */
export interface BranchInfo {
  /** Full HEAD object id, or `null` in an unborn repository. */
  readonly oid: string | null
  /** Branch name, or `null` when HEAD is detached. */
  readonly name: string | null
  /** Upstream tracking branch name, or `null` when the branch has none. */
  readonly upstream: string | null
  /** Commits on HEAD not on the upstream. */
  readonly ahead: number
  /** Commits on the upstream not on HEAD. */
  readonly behind: number
  /** Coarse HEAD classification, derived from `name` and `oid`. */
  readonly head: HeadState
}

/** One whole-repository status reading: the panel's primary payload. */
export interface RepoStatus {
  /** Absolute repo root, resolved by `git rev-parse --show-toplevel`. */
  readonly root: string
  /** HEAD position and upstream relation. */
  readonly branch: BranchInfo
  /** The four change lists. */
  readonly groups: StatusGroups
  /** True when the listing hit the host's entry cap and is incomplete. */
  readonly truncated: boolean
  /** Changed paths counted once each, including untracked and conflicted ones. */
  readonly changedCount: number
}

/** One local branch, as the picker lists it (FR-4.1). */
export interface BranchRef {
  /** Short branch name. */
  readonly name: string
  /** True for the branch HEAD is on. */
  readonly current: boolean
  /** Commit the branch points at. */
  readonly oid: string
  /** Upstream tracking branch name, or `null`. */
  readonly upstream: string | null
  /** Commits on this branch not on its upstream. */
  readonly ahead: number
  /** Commits on the upstream not on this branch. */
  readonly behind: number
  /** True when the upstream is configured but gone from the remote. */
  readonly upstreamGone: boolean
  /** Committer date, ISO-8601. */
  readonly committedAt: string
  /** First line of the branch tip's commit message. */
  readonly subject: string
}

/** One commit row in the history list (FR-3.6). */
export interface CommitInfo {
  /** Full commit object id. */
  readonly oid: string
  /** Abbreviated object id, as the row shows it. */
  readonly shortOid: string
  /** First line of the commit message. */
  readonly subject: string
  /** Author name. */
  readonly authorName: string
  /** Author date, ISO-8601. */
  readonly authoredAt: string
  /** Committer date, ISO-8601; the list's sort key. */
  readonly committedAt: string
  /** Parent object ids, in order; more than one means a merge. */
  readonly parents: readonly string[]
  /**
   * Whether the commit is on the upstream branch: `true` pushed, `false`
   * unpushed, `null` when no upstream makes the question unanswerable. The
   * history row's ○/● marker reads this.
   */
  readonly pushed: boolean | null
}

/** One page of history (FR-3.7). */
export interface LogPage {
  /** Commits in this page, newest first. */
  readonly commits: readonly CommitInfo[]
  /** Total commits reachable from HEAD, or `null` when not counted. */
  readonly total: number | null
  /** Whether more commits remain past this page. */
  readonly hasMore: boolean
}

/**
 * What one mutating operation did, in the panel's vocabulary.
 *
 * `summary` is git's own first useful line when git printed one — a push's
 * `master -> master`, a pull's `Already up to date.` — and `''` when the command
 * is silent, which is the ordinary case for `add`. The panel shows it as a
 * transient result line, never as the operation's only evidence: a successful
 * mutation always re-reads the status, so the change list remains the truth and
 * this is only the sentence beside it.
 */
export interface OperationReport {
  /** git's own one-line result, or `''` when the command printed nothing. */
  readonly summary: string
  /** Every line git printed, verbatim and multi-line (§4.3). */
  readonly detail: string
}

/** Log levels the panel reports through the host port. */
export type LogLevel = 'info' | 'warn' | 'error'
