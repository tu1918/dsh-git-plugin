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
 * Which side of a conflict the user accepts, in the user's own words.
 *
 * Deliberately NOT git's `ours`/`theirs`: those names flip meaning under
 * `git rebase`, where `--ours` is the branch being rebased onto and `--theirs`
 * is the commit being replayed. The host translates this intent into the right
 * stage when it runs, so the panel says the same thing in every operation kind.
 */
export type ConflictSide = 'mine' | 'other'

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

/**
 * The operation git is part-way through, if any.
 *
 * Each one leaves its own marker in the git directory (`MERGE_HEAD`,
 * `REVERT_HEAD`, `CHERRY_PICK_HEAD`, `rebase-merge/`), and each answers to its
 * own `--continue` / `--skip` / `--abort`. The panel needs to know WHICH one,
 * not merely that one is running: `merge --abort` on a stopped cherry-pick is
 * not the same escape hatch.
 */
export type InProgressOperation =
  /** A merge waiting to be concluded (FR-9.3). */
  | 'merge'
  /** The history row's "还原此提交" stopped on conflicts. */
  | 'revert'
  /** The "捡取此提交" counterpart, same story. */
  | 'cherry-pick'
  /** A rewrite (squash / drop) replaying commits, or stopped on conflicts. */
  | 'rebase'

/** One whole-repository status reading: the panel's primary payload. */
export interface RepoStatus {
  /** Absolute repo root, resolved by `git rev-parse --show-toplevel`. */
  readonly root: string
  /** HEAD position and upstream relation. */
  readonly branch: BranchInfo
  /** The four change lists. */
  readonly groups: StatusGroups
  /**
   * The operation waiting to be continued, or `null` when none is.
   *
   * Not derivable from {@link groups}: once every conflicted path has been
   * marked resolved the conflict list is empty while the operation is still
   * open, and that is exactly the state "continue / skip / abort" speaks to.
   * Any of the four can also be stopped with NO conflicts left (a rewrite whose
   * remaining pick became empty, say), which is why this cannot be inferred from
   * the change lists either.
   */
  readonly operation: InProgressOperation | null
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

/**
 * One remote-tracking branch, as the picker lists it for reading.
 *
 * Read-only on purpose: the panel does not offer to check one out. Doing so
 * needs a decision the user has to make (rebase the local branch onto the
 * remote, or drop the local commits) and both outcomes can land in a conflict
 * state — which is FR-9's territory, not this list's.
 *
 * `name` is git's `refname:short` (`origin/feature`). The remote name is NOT
 * split out: a remote may itself contain a `/`, so splitting on the first one
 * would be wrong, and a list that only shows the name does not need it.
 */
export interface RemoteBranchRef {
  /** Short ref name, such as `origin/feature`. */
  readonly name: string
  /** Commit the branch points at. */
  readonly oid: string
  /** Committer date of that commit, ISO-8601. */
  readonly committedAt: string
  /** First line of that commit's message. */
  readonly subject: string
}

/** One repository the panel may point at, when the session's directory holds several (FR-8). */
export interface RepoChoice {
  /** Absolute work tree root, as discovered under the session's directory. */
  readonly root: string
  /** Display name: the root's own directory name. */
  readonly name: string
}

/**
 * Which repositories this session has, and which one the panel is reading (FR-8).
 *
 * `container` is the session's own directory — the thing the user opened — and it
 * is what the client remembers a choice against: a session is transient, a
 * directory is not. When the directory is itself a repository, `repos` holds
 * exactly that one and the panel shows no picker at all.
 */
export interface RepoListing {
  /** The session's directory: what a remembered choice is keyed by. */
  readonly container: string
  /** Repositories found at or one level below the container, most active first. */
  readonly repos: readonly RepoChoice[]
  /** The root the panel is currently reading, or `null` when there is none. */
  readonly selected: string | null
}

/**
 * What a ref decorating a commit is (FR-3.6's row, widened).
 *
 * The three namespaces git keeps apart are kept apart here too, because that is
 * the only reliable way to tell them apart: `feature/x` and `origin/feature/x`
 * are two different kinds of ref whose names differ only by a prefix, and a
 * decoration string cannot say which is which without being told.
 */
export type CommitRefKind =
  /** A local branch (`refs/heads/…`). */
  | 'branch'
  /** A remote-tracking branch (`refs/remotes/…`). */
  | 'remote'
  /** A tag, annotated or not (`refs/tags/…`). */
  | 'tag'

/**
 * One ref that points at a commit, as the history row decorates it.
 *
 * `name` is the short form — `main`, `upstream/main`, `v0.2.9` — which is what a
 * reader recognises; the kind is what the row colours and names in its tooltip.
 */
export interface CommitRef {
  /** Which namespace the ref came from. */
  readonly kind: CommitRefKind
  /** Short ref name, as git prints it. */
  readonly name: string
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
   * Refs pointing at this commit — branches, remote-tracking branches and tags.
   *
   * Empty on most commits, and on every commit in a page the host could not read
   * the refs for: the decoration is a convenience, and losing it must not cost
   * the row. Ordered by kind (branch, remote, tag) and then by name.
   */
  readonly refs: readonly CommitRef[]
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

/**
 * Which way FR-3.8's undo went.
 *
 * The host decides, from state it re-read at execution time (never from the
 * client's claim): a commit the upstream does not contain is undone with
 * `reset --mixed` — its changes return to the working tree — while one that is
 * already published is undone with `revert`, a new commit rather than rewritten
 * history.
 */
export type UndoMode = 'reset' | 'revert'

/**
 * What undoing the newest commit did (FR-3.8, §5.4's `{ mode }`).
 *
 * The undone commit's identity rides along so the panel's notice can name what
 * it acted on — after a reset the row is gone from the history, so the notice
 * is the only place that says which commit it was.
 */
export interface UndoResult {
  /** Which command undid the commit. */
  readonly mode: UndoMode
  /** Abbreviated object id of the commit that was undone. */
  readonly shortOid: string
  /** First line of the undone commit's message. */
  readonly subject: string
}

/**
 * How far back `git reset` should reach when moving the branch to a commit.
 *
 * The three are git's own, and they differ in what they leave behind: `soft`
 * keeps both the index and the working tree, `mixed` keeps the working tree but
 * empties the index, and `hard` throws both away. The panel offers all three and
 * names the difference in each entry's confirmation, because a user who picks
 * the wrong one loses work with no undo of the loss itself.
 */
export type ResetMode = 'soft' | 'mixed' | 'hard'

/**
 * How one commit should be rewritten away.
 *
 * `squash` folds the commit into its parent, keeping the parent's message (the
 * panel cannot edit messages, and a predictable result beats git's concatenation
 * template — see the plan's D48). `drop` removes the commit and replays the
 * commits that followed it.
 */
export type RewriteAction = 'squash' | 'drop'

/**
 * One stash entry, as `git stash list` reports it (FR-6.2).
 *
 * `selector` is what git printed (`stash@{0}`) and what the row shows, but it is
 * deliberately NOT what the panel sends back: a selector is a position in the
 * stack, so a stash created in another window shifts every entry behind it. The
 * panel addresses an entry by {@link oid} and the host re-resolves that against
 * its own reading at execution time — the same "the row may be stale" rule
 * FR-3.8's undo follows.
 */
export interface StashEntry {
  /** Full object id of the stash commit. */
  readonly oid: string
  /** Abbreviated object id, as the row shows it. */
  readonly shortOid: string
  /** The selector git currently gives this entry, such as `stash@{0}`. */
  readonly selector: string
  /**
   * The stash's own subject: `WIP on main: <short oid> <subject>` when git wrote
   * it, or `On main: <message>` when the user gave one.
   */
  readonly subject: string
  /** Committer date, ISO-8601. */
  readonly createdAt: string
}

/** Log levels the panel reports through the host port. */
export type LogLevel = 'info' | 'warn' | 'error'

/* ── diff viewing (FR-2) ─────────────────────────────────────────────────── */

/**
 * Which comparison produced a diff (FR-2.2, FR-7.2).
 *
 * `worktree` and `index` are the two states git can diff without a second
 * revision. An untracked path is a worktree diff of "nothing" against the file,
 * which the host renders as an all-added diff rather than a third area — the
 * panel's own group already says the file is untracked, so the wire has no third
 * case to carry.
 *
 * `commit` is FR-7.2's drill-down: one file as a particular commit changed it.
 * This is the LABEL a finished diff carries; the request that asks for one is a
 * {@link DiffTarget}, whose commit form also names the revision — "the commit"
 * is not a state a path can be compared against without being told which one.
 */
export type DiffArea = 'worktree' | 'index' | 'commit'

/**
 * What one diff is asked for.
 *
 * The two working comparisons address nothing but the path and the index; a
 * commit comparison addresses a revision as well, so the hash lives IN the
 * target rather than in a second, optional parameter — a commit diff without a
 * commit is not a value this model should be able to represent.
 */
export type DiffTarget =
  | { readonly area: 'worktree' }
  | { readonly area: 'index' }
  | { readonly area: 'commit'; readonly hash: string }

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
