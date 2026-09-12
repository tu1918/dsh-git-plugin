/**
 * The panel itself: pure React over {@link ClientPorts}-shaped props.
 *
 * This module imports nothing from DSH — not a type, not a service, not a URL.
 * Everything it needs arrives as props: the session to describe, the host-facing
 * git client, a translator, and the tab's abort signal. The DSH-shaped wrapper
 * that supplies those lives in `client/adapter/tab-body.tsx`, which is what keeps
 * this component renderable, and reviewable, without a host.
 *
 * Two rules shape the operation handling below:
 *
 * - **A failure lands beside the list, never instead of it** (§4.3). A failed
 *   push leaves the change list exactly where it was, with git's own multi-line
 *   output next to the button that caused it.
 * - **Every mutation re-reads the repository.** The change watcher will fire too
 *   — the index or HEAD moved — but the panel's own action should not wait for a
 *   poll to show what it just did.
 *
 * @module dsh-git-panel/client/ui/StatusPanel
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

import { commitScopeOf } from '../../core/commit-scope.ts'
import { lineCount } from '../../core/format.ts'
import type { GitPanelError, GitRemoteClient, Result } from '../../core/ports.ts'
import type {
  BranchInfo,
  BranchRef,
  ChangeArea,
  CommitInfo,
  DiffArea,
  FileChange,
  OperationReport,
  RepoStatus,
} from '../../core/types.ts'
import { ChangeGroupPane } from './ChangeGroupPane.tsx'
import { Group, ToolButton } from './ChangeGroup.tsx'
import { BranchPicker, type BranchRefusal } from './BranchPicker.tsx'
import { CommitBox } from './CommitBox.tsx'
import { errorCopy } from './error-copy.ts'
import { BottomPane, type OpenFile } from './BottomPane.tsx'
import {
  dirKey,
  readCollapsedDirs,
  readViewMode,
  writeCollapsedDirs,
  writeViewMode,
  type ChangeView,
  type ViewMode,
} from './change-view.ts'
import { readCollapsedGroups, writeCollapsedGroups } from './group-collapse.ts'
import { useArmedKey } from './armed.ts'
import { cls } from './styles.ts'
import type { Translate } from './translate.ts'
import {
  ArrowDownGlyph,
  ArrowUpGlyph,
  BranchGlyph,
  CaretGlyph,
  CloseGlyph,
  ListGlyph,
  PlusGlyph,
  RefreshGlyph,
  RingGlyph,
  SyncGlyph,
  TreeGlyph,
} from './icons.tsx'

export type { Translate }

/** The change-list groups, in the order the panel draws them. */
const CHANGE_AREAS: readonly ChangeArea[] = ['conflicted', 'staged', 'unstaged', 'untracked']

/** Everything the panel needs, in neutral terms. */
export interface StatusPanelProps {
  /** The session whose repository is described. */
  readonly sessionId: string
  /** The host-facing git client. */
  readonly git: GitRemoteClient
  /** The panel's copy. */
  readonly t: Translate
  /** BCP-47 tag for relative-time wording; the platform supplies the tables. */
  readonly locale: string
  /** Aborted when the tab closes; cancels in-flight reads. */
  readonly signal?: AbortSignal
}

/** One reading of the repository, tagged with the session it describes. */
type Snapshot =
  | { readonly sessionId: string; readonly kind: 'ready'; readonly status: RepoStatus; readonly branches: readonly BranchRef[] }
  | { readonly sessionId: string; readonly kind: 'failed'; readonly error: GitPanelError }

/** The mutations the panel can start. */
type ActionOp =
  | 'stage'
  | 'unstage'
  | 'commit'
  | 'push'
  | 'pull'
  | 'sync'
  | 'checkout'
  | 'createBranch'
  | 'deleteBranch'
  | 'mergeContinue'
  | 'mergeAbort'
  | 'generate'

/**
 * What the panel is doing, or last did, at the operation level.
 *
 * One value rather than three flags: a new operation should clear the previous
 * result, and a union makes that impossible to forget.
 */
type ActionState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'running'; readonly op: ActionOp; readonly label: string }
  | { readonly kind: 'done'; readonly op: ActionOp; readonly label: string; readonly summary: string }
  | { readonly kind: 'failed'; readonly op: ActionOp; readonly label: string; readonly error: GitPanelError }

/**
 * Reduce a mutation's report to the one line the panel shows.
 *
 * `git add` prints nothing, so the summary is often empty; the caller then shows
 * the operation's own name as the confirmation, which is enough because the
 * change list has already moved.
 * @param result - The mutation's outcome.
 * @returns The summary line, or the failure as it was.
 */
function reportOf(result: Result<OperationReport>): Result<string> {
  return result.ok ? { ok: true, value: result.value.summary } : result
}

/**
 * Which comparison a change-list row's diff should make (FR-2.2).
 *
 * The list's four groups collapse onto git's two comparable states: a staged row
 * diffs the index against HEAD, and everything else — unstaged, untracked, and a
 * conflicted path — diffs the working tree. That is the point of the mapping
 * rather than a rename: a file with both a staged and an unstaged change appears
 * in two groups, and clicking either row must open the side that row stands for.
 * @param area - The group the clicked row belongs to.
 * @returns The comparison to ask the host for.
 */
export function diffAreaOf(area: ChangeArea): DiffArea {
  return area === 'staged' ? 'index' : 'worktree'
}

/**
 * Read the repository, then keep the reading fresh.
 *
 * One read happens per session and per explicit refresh; change notifications
 * only schedule another read, coalesced, so a burst of git commands from an
 * agent produces one refresh rather than one per file (§4.4, FR-1.4).
 * @param sessionId - The session whose repository is read.
 * @param git - The host-facing git client.
 * @param tabSignal - Aborted when the tab closes.
 * @returns The latest snapshot for this session, or `null` while the first read
 *   is in flight, plus the reload trigger and the generation counter. The
 *   generation is returned rather than kept private because an open diff has to
 *   re-read on the same signal (FR-2's pane refreshes with the list).
 */
function useRepoSnapshot(
  sessionId: string,
  git: GitRemoteClient,
  tabSignal: AbortSignal | undefined,
): { snapshot: Snapshot | null; reload: () => void; busy: boolean; generation: number } {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [generation, setGeneration] = useState(0)
  const [busy, setBusy] = useState(true)

  useEffect(() => {
    const controller = new AbortController()
    const abort = (): void => controller.abort()
    if (tabSignal?.aborted === true) controller.abort()
    tabSignal?.addEventListener('abort', abort)

    let live = true
    setBusy(true)
    void (async () => {
      const [status, branches] = await Promise.all([
        git.status(sessionId, controller.signal),
        git.branches(sessionId, controller.signal),
      ])
      // A read that lost its race (a newer refresh, or a closed tab) must not
      // write state: the newer read owns the panel now.
      if (!live) return
      setBusy(false)
      if (status.ok) {
        setSnapshot({
          sessionId,
          kind: 'ready',
          status: status.value,
          // A branch listing that failed is not worth failing the panel over;
          // the change lists are the panel's reason to exist.
          branches: branches.ok ? branches.value : [],
        })
      } else {
        setSnapshot({ sessionId, kind: 'failed', error: status.error })
      }
    })()

    return () => {
      live = false
      tabSignal?.removeEventListener('abort', abort)
      controller.abort()
    }
  }, [sessionId, git, generation, tabSignal])

  // Subscription, separate from the read: a change only bumps the generation.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const unsubscribe = git.watch(sessionId, () => {
      if (timer !== undefined) return
      timer = setTimeout(() => {
        timer = undefined
        setGeneration((value) => value + 1)
      }, 180)
    })
    return () => {
      if (timer !== undefined) clearTimeout(timer)
      unsubscribe()
    }
  }, [sessionId, git])

  const reload = useCallback(() => setGeneration((value) => value + 1), [])
  return {
    snapshot: snapshot?.sessionId === sessionId ? snapshot : null,
    reload,
    busy,
    generation,
  }
}

/**
 * The state rail: which branch, how it stands against its upstream (FR-1.5), and
 * the three sync actions (FR-5.1).
 *
 * `↑n`/`↓m` appear only when they are non-zero, so a settled repository shows a
 * quiet rail instead of "↑0 ↓0" — the counts are a signal, and a signal that is
 * always on is noise. The actions follow the same principle: each is enabled only
 * in the state it can act on, so a synced branch offers nothing to press.
 */
function BranchRail({
  branch,
  upstreamGone,
  t,
  onRefresh,
  busy,
  canPull,
  canPush,
  canSync,
  onPull,
  onPush,
  onSync,
  pickerOpen,
  onTogglePicker,
  mode,
  onToggleMode,
}: {
  readonly branch: BranchInfo
  /**
   * Whether the configured upstream no longer exists.
   *
   * Not part of {@link BranchInfo}: `git status` cannot tell "the upstream is
   * gone" from "there are no counts to report", so this comes from the branch
   * listing, which git answers directly with `[gone]`.
   */
  readonly upstreamGone: boolean
  readonly t: Translate
  readonly onRefresh: () => void
  readonly busy: boolean
  /** Whether a pull would have anything to do. */
  readonly canPull: boolean
  /** Whether a push is possible — including the first one, which sets the upstream. */
  readonly canPush: boolean
  /** Whether the branch is both behind and ahead, the case `⇅` is for. */
  readonly canSync: boolean
  readonly onPull: () => void
  readonly onPush: () => void
  readonly onSync: () => void
  /** Whether the branch picker is unfolded. */
  readonly pickerOpen: boolean
  /** Fold or unfold the branch picker (FR-4.1). */
  readonly onTogglePicker: () => void
  /** FR-1.3: which shape the change list is drawn in. */
  readonly mode: ViewMode
  /** Switch between the flat list and the file tree. */
  readonly onToggleMode: () => void
}): ReactNode {
  const track =
    branch.upstream === null
      ? t('branch.noUpstream')
      : branch.ahead === 0 && branch.behind === 0
        ? t('branch.synced')
        : [
            branch.ahead > 0 ? t('branch.ahead', { count: branch.ahead }) : '',
            branch.behind > 0 ? t('branch.behind', { count: branch.behind }) : '',
          ]
            .filter((part) => part !== '')
            .join(' · ')

  const name =
    branch.head === 'detached'
      ? t('branch.detached')
      : (branch.name ?? t('branch.detached'))

  return (
    <div className={cls.head}>
      {/* The branch name is the picker's handle (FR-4.1). It reads as a control
          rather than as a label because §1.3's third lesson is that a branch
          switcher nobody notices is a branch switcher nobody uses. */}
      <button
        type="button"
        className={cls.branch}
        title={`${name} — ${track}`}
        aria-expanded={pickerOpen}
        aria-label={t('branch.picker', { name })}
        onClick={onTogglePicker}
      >
        <BranchGlyph className={cls.branchGlyph} />
        <span className={cls.branchName}>{name}</span>
        {branch.head === 'unborn' && <span className={cls.branchState}>· {t('branch.unborn')}</span>}
        {branch.head === 'detached' && branch.oid !== null && (
          <span className={cls.branchState}>({branch.oid.slice(0, 7)})</span>
        )}
        {upstreamGone && (
          <span className={cls.branchState}>· {t('branch.upstreamGone')}</span>
        )}
        <CaretGlyph className={cls.branchCaret} />
      </button>
      {/* Counts stay visible (the signal); the words live in the tooltip. */}
      {branch.ahead > 0 && (
        <span className={cls.track} title={t('branch.ahead', { count: branch.ahead })}>
          <ArrowUpGlyph className={cls.trackIcon} />
          {branch.ahead}
        </span>
      )}
      {branch.behind > 0 && (
        <span className={cls.track} title={t('branch.behind', { count: branch.behind })}>
          <ArrowDownGlyph className={cls.trackIcon} />
          {branch.behind}
        </span>
      )}
      <span className={cls.spacer} />
      <ToolButton label={t('action.sync')} disabled={!canSync || busy} onClick={onSync}>
        <SyncGlyph />
      </ToolButton>
      <ToolButton label={t('action.pull')} disabled={!canPull || busy} onClick={onPull}>
        <ArrowDownGlyph size={13} />
      </ToolButton>
      <ToolButton
        label={branch.ahead > 0 ? t('action.pushAhead', { count: branch.ahead }) : t('action.push')}
        disabled={!canPush || busy}
        onClick={onPush}
      >
        <ArrowUpGlyph size={13} />
      </ToolButton>
      {/* FR-1.3's mode switch, at the end of the rail the way VS Code puts its
          view actions in the view's title bar. The glyph draws the mode it would
          switch TO, which is what makes a single button read as a toggle. */}
      <ToolButton
        label={mode === 'tree' ? t('view.list') : t('view.tree')}
        pressed={mode === 'tree'}
        onClick={onToggleMode}
      >
        {mode === 'tree' ? <ListGlyph /> : <TreeGlyph />}
      </ToolButton>
      <ToolButton label={t('action.refresh')} onClick={onRefresh}>
        {busy ? <span className={cls.spinner} /> : <RefreshGlyph />}
      </ToolButton>
    </div>
  )
}

/**
 * The git panel.
 * @param props - Session, git client, copy, and the tab's abort signal.
 */
export function StatusPanel({ sessionId, git, t, locale, signal }: StatusPanelProps): ReactNode {
  const { snapshot, reload, busy, generation } = useRepoSnapshot(sessionId, git, signal)
  // The draft lives up here, not inside the box: a commit that fails must not
  // cost the user the message they just wrote.
  const [message, setMessage] = useState('')
  const [action, setAction] = useState<ActionState>({ kind: 'idle' })
  /**
   * The file whose diff is open, or `null` while the change list is showing.
   *
   * The row's own group is kept rather than the derived {@link DiffArea}, so the
   * "is this file still changed?" check below can look in the group the user
   * actually clicked — which is the only group that can say whether the row they
   * opened still exists.
   */
  const [openFile, setOpenFile] = useState<OpenFile | null>(null)
  /** Whether the branch picker is unfolded (FR-4.1). */
  const [pickerOpen, setPickerOpen] = useState(false)
  /** The last refused branch deletion, so an unmerged branch can arm its force click. */
  const [branchRefusal, setBranchRefusal] = useState<BranchRefusal | null>(null)
  /** True while a commit message is being generated (FR-3.5). */
  const [generating, setGenerating] = useState(false)
  /** A note about the last generation, such as a truncated diff. */
  const [aiNote, setAiNote] = useState<string | null>(null)
  /** The two-click confirmation shared by every irreversible control here (§4.3). */
  const {
    armed: armedKey,
    force: armedForce,
    arm: armKey,
    reset: disarm,
  } = useArmedKey()
  // Folded groups are a preference, not a render detail: someone who folds
  // "untracked" away does not want it back on the next visit (§4.2 draws the
  // caret). Initialised from storage, written back whenever it changes.
  const [collapsedGroups, setCollapsedGroups] =
    useState<ReadonlySet<ChangeArea>>(readCollapsedGroups)
  // FR-1.3's shape, and the tree's own folds. Both are preferences, like the
  // groups above: the mode outlives a render, and a folded directory that came
  // back on every refresh would not be worth folding.
  const [mode, setMode] = useState<ViewMode>(readViewMode)
  const [collapsedDirs, setCollapsedDirs] = useState<ReadonlySet<string>>(readCollapsedDirs)

  useEffect(() => {
    writeCollapsedGroups(collapsedGroups)
  }, [collapsedGroups])

  useEffect(() => {
    writeViewMode(mode)
  }, [mode])

  useEffect(() => {
    writeCollapsedDirs(collapsedDirs)
  }, [collapsedDirs])

  const toggleDir = useCallback((key: string): void => {
    setCollapsedDirs((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  /**
   * What every group needs in order to draw the current shape.
   *
   * One object rather than three props, so `Group` and the drawers that carry it
   * take "the view" as one thing instead of growing a parameter per future
   * display detail.
   */
  const view: ChangeView = useMemo(
    () => ({ mode, collapsedDirs, onToggleDir: toggleDir }),
    [mode, collapsedDirs, toggleDir],
  )

  const toggleGroup = useCallback((area: ChangeArea): void => {
    setCollapsedGroups((current) => {
      const next = new Set(current)
      if (next.has(area)) next.delete(area)
      else next.add(area)
      return next
    })
  }, [])

  // A different session is a different repository, so neither the draft nor the
  // last operation's result belongs to it — and neither does an open diff, which
  // describes a file in the old repository.
  useEffect(() => {
    setMessage('')
    setAction({ kind: 'idle' })
    setOpenFile(null)
    setPickerOpen(false)
    setBranchRefusal(null)
    setGenerating(false)
    setAiNote(null)
    // Neither the mode nor the folded directories are reset here: both are
    // preferences about how a list is drawn, exactly like the group folds above,
    // and a fold keyed by path is meaningful in the next repository too
    // (`node_modules` is folded wherever it appears).
    disarm()
  }, [sessionId, disarm])

  // A file committed or discarded while its diff is open no longer has a row to
  // return to, so the view is dropped rather than left showing a diff of
  // something the change list no longer lists. The check waits for a settled
  // read: during a refresh the group is briefly the old one, and clearing then
  // would close the pane on every keystroke of a `git add`.
  useEffect(() => {
    if (openFile === null || busy || snapshot === null || snapshot.kind !== 'ready') return
    // Listed in ANY group, not just the one it was opened from: staging a file
    // moves it between groups, and the diff should survive that.
    const { groups } = snapshot.status
    const listed = CHANGE_AREAS.some((area) =>
      groups[area].some((entry) => entry.path === openFile.path),
    )
    if (!listed) setOpenFile(null)
  }, [openFile, snapshot, busy])

  /**
   * Run one mutation, then report it or re-read the repository.
   * @param op - Which operation, for the feedback's placement.
   * @param label - The operation's name, for the feedback's heading.
   * @param operation - The call to make.
   */
  const perform = useCallback(
    async (op: ActionOp, label: string, operation: () => Promise<Result<string>>): Promise<void> => {
      setAction({ kind: 'running', op, label })
      let result: Result<string>
      try {
        result = await operation()
      } catch (error: unknown) {
        // A git client that throws instead of answering — a client-side bug, or
        // `fetch` refusing before it is a Result at all — must not leave the
        // panel spinning on an operation nobody is running any more. Turning it
        // into an ordinary failure keeps the same rule as everything else here:
        // the reason lands beside the list (§4.3).
        result = {
          ok: false,
          error: {
            code: 'git-failed',
            message: error instanceof Error ? error.message : String(error),
          },
        }
      }
      if (!result.ok) {
        setAction({ kind: 'failed', op, label, error: result.error })
        return
      }
      setAction({ kind: 'done', op, label, summary: result.value })
      // The watcher would notice the moved index too, but the panel's own action
      // should not wait for a poll to show what it just did.
      reload()
    },
    [reload],
  )

  if (snapshot === null) {
    return (
      <div className={cls.root} data-git-panel="loading">
        <div className={cls.status}>
          <p className={cls.statusHint}>
            <span className={cls.spinner} /> {t('loading')}
          </p>
        </div>
      </div>
    )
  }

  if (snapshot.kind === 'failed') {
    const { title, detail } = errorCopy(t, snapshot.error, 'read')
    return (
      <div className={cls.root} data-git-panel="failed" data-code={snapshot.error.code}>
        <div className={cls.status}>
          <p className={cls.statusTitle}>{title}</p>
          {detail !== undefined && detail !== '' && (
            <p className={cls.note} data-multiline={String(lineCount(detail) > 1)}>
              {detail}
            </p>
          )}
          <button type="button" className={cls.primary} onClick={reload}>
            {t('action.retry')}
          </button>
        </div>
      </div>
    )
  }

  const { status, branches } = snapshot
  const { staged, unstaged, untracked, conflicted } = status.groups
  const scope = commitScopeOf(status.groups)
  // The branch listing is the only source that distinguishes a gone upstream
  // from a branch that simply has no counts.
  const upstreamGone = branches.find((branch) => branch.current)?.upstreamGone ?? false
  const clean =
    staged.length === 0 &&
    unstaged.length === 0 &&
    untracked.length === 0 &&
    conflicted.length === 0

  const pending = action.kind === 'running'
  const onBranch = status.branch.head === 'branch' && status.branch.name !== null
  const hasUpstream = status.branch.upstream !== null
  // Each action exists for a state: `pull` needs somewhere to pull from, `push`
  // is either the first push (FR-5.2 sets the upstream) or has commits to send,
  // and `⇅` needs both directions to be true at once.
  const canPull = onBranch && hasUpstream
  const canPush = onBranch && (hasUpstream ? status.branch.ahead > 0 : true)
  const canSync = onBranch && hasUpstream && (status.branch.ahead > 0 || status.branch.behind > 0)

  // Both staging actions take a list, and the host refuses an empty one
  // (`validatePaths`) — which is the right contract, so the panel never sends it:
  // nothing to move means nothing to do, not a request that comes back as "the
  // request was incomplete". The group's own bulk button is disabled in that state
  // too, so this is the belt to its braces.
  const stage = (paths: readonly string[]): void => {
    if (paths.length === 0) return
    void perform('stage', t('action.stage'), async () =>
      reportOf(await git.stage(sessionId, paths, signal)),
    )
  }
  const unstage = (paths: readonly string[]): void => {
    if (paths.length === 0) return
    void perform('unstage', t('action.unstage'), async () =>
      reportOf(await git.unstage(sessionId, paths, signal)),
    )
  }
  const commitNow = (): void => {
    const widening = scope.kind === 'all-tracked'
    const label = widening ? t('commit.allTracked') : t('commit.button')
    void perform('commit', label, async () => {
      const result = widening
        ? await git.commitAll(sessionId, message, signal)
        : await git.commit(sessionId, message, signal)
      if (!result.ok) return result
      // Only a successful commit clears the box; a refused one keeps the text.
      setMessage('')
      return {
        ok: true,
        value: t('commit.done', { hash: result.value.shortOid, subject: result.value.subject }),
      }
    })
  }
  const pull = (): void => {
    void perform('pull', t('action.pull'), async () => reportOf(await git.pull(sessionId, signal)))
  }
  const push = (): void => {
    void perform('push', t('action.push'), async () => reportOf(await git.push(sessionId, signal)))
  }
  const sync = (): void => {
    void perform('sync', t('action.sync'), async () => reportOf(await git.sync(sessionId, signal)))
  }

  /**
   * Switch to another branch (FR-4.1).
   *
   * A refusal here is the interesting case, not an edge: git answers a dirty
   * working tree with several lines naming the files it would overwrite, and
   * `perform` renders them verbatim (FR-4.4). What M4 deliberately does NOT
   * offer is the doc's "stash, then switch" shortcut — stash is FR-6.2, and it
   * stays in M5 (D20).
   */
  const checkout = (name: string): void => {
    setPickerOpen(false)
    void perform('checkout', t('action.checkout'), async () =>
      reportOf(await git.checkout(sessionId, name, signal)),
    )
  }
  const createBranch = (name: string, base: string | null): void => {
    setPickerOpen(false)
    void perform('createBranch', t('action.createBranch'), async () =>
      reportOf(await git.createBranch(sessionId, name, base, signal)),
    )
  }
  /**
   * Delete a branch (FR-4.3).
   *
   * The first click is `-d`; a `not-merged` answer is recorded rather than only
   * reported, because the picker arms the same row as `-D` from it — the panel's
   * second click is the "未合并需强制确认" the doc asks for.
   */
  const deleteBranch = (name: string, force: boolean): void => {
    void perform('deleteBranch', t('action.deleteBranch'), async () => {
      const result = await git.deleteBranch(sessionId, name, force, signal)
      if (!result.ok) {
        setBranchRefusal({ name, code: result.error.code })
        return result
      }
      setBranchRefusal(null)
      return reportOf(result)
    })
  }
  const continueMerge = (): void => {
    void perform('mergeContinue', t('merge.continue'), async () =>
      reportOf(await git.continueMerge(sessionId, signal)),
    )
  }
  const abortMerge = (): void => {
    disarm()
    void perform('mergeAbort', t('merge.abort'), async () =>
      reportOf(await git.abortMerge(sessionId, signal)),
    )
  }
  /**
   * Ask the model for a commit message (FR-3.5).
   *
   * Not routed through {@link perform}: its result is a message to put in the
   * box, not a one-line report, and the box is the thing that must change. A
   * failure still lands in the same action box as every other operation, so the
   * panel keeps one error path.
   */
  const generate = (): void => {
    setGenerating(true)
    setAiNote(null)
    void (async () => {
      const result = await git.generateCommitMessage(sessionId, locale, signal)
      setGenerating(false)
      if (!result.ok) {
        setAction({ kind: 'failed', op: 'generate', label: t('commit.ai'), error: result.error })
        return
      }
      setMessage(result.value.message)
      if (result.value.truncated) setAiNote(t('commit.aiTruncated'))
    })()
  }
  /**
   * Open one row's diff (FR-2.1).
   * @param entry - The row that was activated.
   * @param area - The group it was activated in, which picks the comparison.
   */
  const openDiff = (entry: FileChange, area: ChangeArea): void => {
    setOpenFile({ path: entry.path, area: diffAreaOf(area) })
  }

  const failure = action.kind === 'failed' ? errorCopy(t, action.error, 'action') : null

  return (
    <div className={cls.root} data-git-panel="ready" data-repo={status.root}>
      <BranchRail
        branch={status.branch}
        upstreamGone={upstreamGone}
        t={t}
        onRefresh={reload}
        busy={busy || pending}
        canPull={canPull}
        canPush={canPush}
        canSync={canSync}
        onPull={pull}
        onPush={push}
        onSync={sync}
        pickerOpen={pickerOpen}
        onTogglePicker={() => setPickerOpen((open) => !open)}
        mode={mode}
        onToggleMode={() => setMode((current) => (current === 'tree' ? 'list' : 'tree'))}
      />
      {pickerOpen && (
        <BranchPicker
          branches={branches}
          t={t}
          busy={busy || pending}
          onCheckout={checkout}
          onCreate={createBranch}
          onDelete={deleteBranch}
          refusal={branchRefusal}
          onClose={() => setPickerOpen(false)}
        />
      )}
      {/* FR-9.3's two ways out of a merge. The bar exists because the state is
          otherwise invisible: with every conflict resolved, this panel looks
          exactly like an ordinary staged change set. */}
      {status.merging && (
        <div className={cls.mergeBox} data-merge="true">
          <span className={cls.mergeLabel}>{t('merge.inProgress')}</span>
          <button
            type="button"
            className={cls.ghost}
            disabled={pending || conflicted.length > 0}
            title={
              conflicted.length > 0
                ? t('merge.continueBlocked', { count: conflicted.length })
                : t('merge.continue')
            }
            onClick={continueMerge}
          >
            {t('merge.continue')}
          </button>
          <button
            type="button"
            className={armedKey === 'merge' ? cls.danger : cls.ghost}
            data-armed={String(armedKey === 'merge')}
            disabled={pending}
            title={armedKey === 'merge' ? t('merge.abortConfirm') : t('merge.abort')}
            onClick={() => {
              if (armedKey === 'merge') abortMerge()
              else armKey('merge')
            }}
          >
            {armedKey === 'merge' ? t('merge.abortArmed') : t('merge.abort')}
          </button>
        </div>
      )}
      {action.kind === 'failed' && failure !== null && (
        <div className={cls.actionBox} data-action-error={action.op}>
          <div className={cls.actionHead}>
            <span className={cls.actionLabel}>
              {action.label} · {t('action.failed')}
            </span>
            <ToolButton label={t('action.dismiss')} onClick={() => setAction({ kind: 'idle' })}>
              <CloseGlyph />
            </ToolButton>
          </div>
          <p className={cls.statusHint}>{failure.title}</p>
          {failure.detail !== undefined && failure.detail !== '' && (
            <p className={cls.note} data-multiline={String(lineCount(failure.detail) > 1)}>
              {failure.detail}
            </p>
          )}
        </div>
      )}
      {action.kind === 'done' && (
        <p className={cls.actionNotice} data-action-done={action.op}>
          {action.summary === '' ? action.label : action.summary}
        </p>
      )}
      {/* The column: the staged drawer, the message box, the working-tree
          drawers, the conflict group, then the bottom pane. The first two are
          deliberately not VS Code's order — see the drawer's own comment — and the
          last one cannot be: VS Code opens a diff in the editor area, and this
          plugin registers only a right-sidebar tab, so the diff shares the bottom
          pane with the history as its second tab (`BottomPane`). FR-2.1 still
          holds in both cases: embedded, never a modal. */}
      {/* The staged drawer sits directly above the commit box, because it is what
          that box commits: the association is the closest one in the panel, and it
          is worth breaking VS Code's own order (message box first, staged list
          below it) to make it read — these files, this message, commit. The cost
          is that staging a row moves it across the box, which is the same jump
          VS Code makes between its two groups. It is also the one drawer that
          stays on screen when it is empty: it is the box's anchor, and its count
          of zero is the answer to "what will this commit?". */}
      <ChangeGroupPane
        area="staged"
        label={t('group.staged')}
        resizeLabel={t('staged.resize')}
        entries={staged}
        t={t}
        busy={busy || pending}
        batch={{ kind: 'unstage', run: () => unstage(staged.map((entry) => entry.path)) }}
        emptyNote={t('group.stagedEmpty')}
        collapsed={collapsedGroups.has('staged')}
        view={view}
        onToggle={() => toggleGroup('staged')}
        onStage={stage}
        onUnstage={unstage}
        onOpen={openDiff}
      />
      <CommitBox
        message={message}
        onMessage={setMessage}
        scope={scope}
        busy={pending}
        // The box only carries its own failures: a rejected push is reported in
        // the action box above, where the button that caused it lives.
        error={action.kind === 'failed' && action.op === 'commit' && failure !== null ? failure.title : undefined}
        onCommit={commitNow}
        // FR-3.5's prompt is built from the staged diff, so the button is offered
        // exactly when there is one — an empty index has nothing to describe.
        aiEnabled={scope.kind === 'staged'}
        generating={generating}
        aiNote={aiNote ?? undefined}
        onGenerate={generate}
        t={t}
      />
      <div className={cls.body}>
        {clean ? (
          <div className={cls.status} data-git-panel-state="clean">
            <p className={cls.statusTitle}>{t('clean.title')}</p>
            <p className={cls.statusHint}>{t('clean.hint')}</p>
          </div>
        ) : (
          <>
            {/* Conflicts keep the top of the list, where VS Code puts them: while
                a merge is open, nothing in the panel matters more. They get a
                group and a `+` per row, but no bulk action — the conflict UI
                proper (FR-9) is a later milestone, and "stage all" over a
                half-resolved merge is not a shortcut worth offering — and no
                drawer either: a group that exists for one afternoon is not height
                anyone wants to take back from the list for good. */}
            <Group
              label={t('group.conflicted')}
              area="conflicted"
              entries={conflicted}
              t={t}
              busy={busy || pending}
              collapsed={collapsedGroups.has('conflicted')}
              view={view}
              onToggle={() => toggleGroup('conflicted')}
              onStage={stage}
              onUnstage={unstage}
              onOpen={openDiff}
            />
            {/* The working tree as two drawers with the same shape as the staged
                one — each with its own grip, its own cap, and its own scroller, so
                "make this group taller" works on any of them and a long group can
                never push another out of the panel. They are not resident: a group
                with no rows is not a pane worth keeping an empty note in, which is
                exactly what the staged drawer above is for. */}
            <ChangeGroupPane
              area="unstaged"
              label={t('group.unstaged')}
              resizeLabel={t('unstaged.resize')}
              entries={unstaged}
              t={t}
              busy={busy || pending}
              batch={{ kind: 'stage', run: () => stage(unstaged.map((entry) => entry.path)) }}
              collapsed={collapsedGroups.has('unstaged')}
              view={view}
              onToggle={() => toggleGroup('unstaged')}
              onStage={stage}
              onUnstage={unstage}
              onOpen={openDiff}
            />
            <ChangeGroupPane
              area="untracked"
              label={t('group.untracked')}
              resizeLabel={t('untracked.resize')}
              entries={untracked}
              t={t}
              busy={busy || pending}
              batch={{ kind: 'stage', run: () => stage(untracked.map((entry) => entry.path)) }}
              collapsed={collapsedGroups.has('untracked')}
              view={view}
              onToggle={() => toggleGroup('untracked')}
              onStage={stage}
              onUnstage={unstage}
              onOpen={openDiff}
            />
            {status.truncated && <p className={cls.note}>{t('state.truncated')}</p>}
          </>
        )}
      </div>
      {/* One region for everything that is not the change list: the recent
          commits and the diff of the row that was clicked share it as two tabs
          (VS Code keeps the list and the editor apart; this panel has no editor
          area, so they take turns in the same box). */}
      <BottomPane
        sessionId={sessionId}
        git={git}
        t={t}
        locale={locale}
        signal={signal}
        generation={generation}
        openFile={openFile}
        onCloseDiff={() => setOpenFile(null)}
      />
    </div>
  )
}
