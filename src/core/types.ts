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
  /**
   * True while a merge is in progress — `MERGE_HEAD` exists.
   *
   * Not derivable from {@link groups}: once every conflicted path has been
   * marked resolved the conflict list is empty while the merge is still open, and
   * that is exactly the state FR-9.3's "continue / abort the merge" speaks to.
   */
  readonly merging: boolean
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

/** One commit's metadata plus its file list; the shape FR-3.6 drills into. */
export interface CommitDetail {
  /** The commit itself. */
  readonly commit: CommitInfo
  /** Files the commit touched, with per-file line counts. */
  readonly files: readonly CommitFileStat[]
}

/**
 * One file inside a commit, with its churn (FR-3.6).
 *
 * The counts come from `git show --numstat`, which also answers the binary
 * question: git prints `-` instead of a number for a file it will not count,
 * and that absence is reported rather than turned into a zero.
 */
export interface CommitFileStat {
  /** Repo-relative path, `/`-separated. */
  readonly path: string
  /** Lines added, or `null` when git reported the file as binary. */
  readonly additions: number | null
  /** Lines removed, or `null` when git reported the file as binary. */
  readonly deletions: number | null
  /** True when git reported the path as binary rather than counting lines. */
  readonly binary: boolean
}

/**
 * One AI-written commit message (FR-3.5).
 *
 * `truncated` says the staged diff was cut before the model saw it (§8.3), which
 * the panel states rather than hiding: a message written from half a diff is
 * still useful, but the user is the one who knows what the other half was.
 */
export interface GeneratedMessage {
  /** The generated subject (and body, when the model wrote one). */
  readonly message: string
  /** True when the diff was cut to fit the prompt budget. */
  readonly truncated: boolean
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

/* ── diff viewing (FR-2) ─────────────────────────────────────────────────── */

/**
 * Which two things a diff compares (FR-2.2).
 *
 * The two values are the two states git can diff against without a second
 * revision: the index (staged) and the working tree. An untracked path is a
 * worktree diff of "nothing" against the file, which the host renders as an
 * all-added diff rather than a third area — the panel's own group already says
 * the file is untracked, so the wire has no third case to carry.
 */
export type DiffArea = 'worktree' | 'index'

/** A half-open `[start, end)` range of characters inside one line's text. */
export interface DiffSpan {
  /** First highlighted character (UTF-16 code unit offset into the line). */
  readonly start: number
  /** One past the last highlighted character. */
  readonly end: number
}

/** One rendered line of a diff. */
export interface DiffLine {
  /** Whether the line is context, an insertion, or a deletion. */
  readonly kind: 'context' | 'added' | 'removed'
  /** The line's text, without its terminator. */
  readonly text: string
  /** 1-based line number in the old file, or `null` for an added line. */
  readonly oldLine: number | null
  /** 1-based line number in the new file, or `null` for a removed line. */
  readonly newLine: number | null
  /**
   * Word-level ranges worth highlighting (§FR-2.3).
   *
   * Empty on context lines and on a line whose whole body changed — highlighting
   * an entire line adds nothing over the row's own add/remove treatment. Offsets
   * address {@link text}, so a renderer slices the string directly.
   */
  readonly marks: readonly DiffSpan[]
}

/** One `@@ … @@` block. */
export interface DiffHunk {
  /** First old-file line the hunk covers. */
  readonly oldStart: number
  /** Number of old-file lines the hunk covers. */
  readonly oldCount: number
  /** First new-file line the hunk covers. */
  readonly newStart: number
  /** Number of new-file lines the hunk covers. */
  readonly newCount: number
  /**
   * git's trailing `@@` context — the enclosing function or section header.
   * `''` when git printed none.
   */
  readonly heading: string
  /** The hunk's lines, in file order, context included. */
  readonly lines: readonly DiffLine[]
}

/**
 * One file's diff, as the renderer needs it.
 *
 * `large` and `truncated` are different facts and both are stated rather than
 * derived, because the panel's next action differs: a `large` diff is complete
 * and can simply be expanded (FR-2.6's "default folded, click to load"), while a
 * `truncated` one is missing its tail and can only be reported.
 */
export interface FileDiff {
  /** Repo-relative path, `/`-separated. */
  readonly path: string
  /** Which comparison produced this. */
  readonly area: DiffArea
  /** The hunks, in file order; empty for a binary or combined diff. */
  readonly hunks: readonly DiffHunk[]
  /** Lines added across every hunk. */
  readonly additions: number
  /** Lines removed across every hunk. */
  readonly deletions: number
  /** Body lines across every hunk (context included), for the FR-2.6 gate. */
  readonly lines: number
  /** True when git reported the file as binary: FR-2.5 shows a notice instead. */
  readonly binary: boolean
  /**
   * True when git answered with a combined (`diff --cc`) diff, which this
   * renderer does not read — the conflict view proper is FR-9. Stated so the
   * panel can say "not this renderer" instead of "no differences".
   */
  readonly combined: boolean
  /**
   * True when `lines` exceeds the panel's one-shot render budget, so the panel
   * opens folded (FR-2.6). The host never folds: it counts and says so.
   */
  readonly large: boolean
  /** True when git's output hit the host's byte cap and the tail is missing. */
  readonly truncated: boolean
}
