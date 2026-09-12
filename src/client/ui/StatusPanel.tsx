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
 * - **Every mutation re-reads the repository.** The host's probe will report the
 *   index or the ref it moved, but the panel's own action should not wait for a
 *   round trip to show what it just did.
 *
 * @module dsh-git-panel/client/ui/StatusPanel
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { ReactNode, Ref } from 'react'

import { commitScopeOf } from '../../core/commit-scope.ts'
import { lineCount } from '../../core/format.ts'
import { statusSignature } from '../../core/status-signature.ts'
import type { GitChangeKind, GitPanelError, GitRemoteClient, Result } from '../../core/ports.ts'
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
import { Group, ToolButton } from './ChangeGroup.tsx'
import { BranchPicker, type BranchRefusal } from './BranchPicker.tsx'
import { Menu, type MenuEntry } from './menu.tsx'
import { Popover } from './popover.tsx'
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
import { createRepoChangeBus, RepoChangeProvider, type RepoChangeBus } from './repo-change.tsx'
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

/**
 * Every kind of change, for the triggers that cannot know better: the opening
 * read, and the refresh button.
 */
const ALL_CHANGE_KINDS: readonly GitChangeKind[] = ['refs', 'index', 'worktree']

/**
 * How long reports are collected before one read is made.
 *
 * An agent's command writes several state files in a row (an object, then the
 * index, then a ref), and each is a report; one read after the burst is what the
 * panel actually wants.
 */
const CHANGE_DEBOUNCE_MS = 180

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

/** The row whose menu is open, and the element its layer hangs from. */
interface RowMenu {
  /** The row element: the layer is measured from its bottom (or top) edge. */
  readonly anchor: HTMLElement
  /** The file the menu acts on. */
  readonly entry: FileChange
  /** The group the row was opened in, which decides what the row can do. */
  readonly area: ChangeArea
}

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
 * One read happens on mount, one per report from the host's git state probe, and
 * one per explicit refresh; a burst of reports is coalesced, so a hundred files
 * written by an agent produce one refresh rather than a hundred (§4.4, FR-1.4).
 *
 * Two rules make this cheap enough to leave switched on:
 *
 * - **A read that changes nothing publishes nothing.** The reading is fingerprinted
 *   (`core/status-signature.ts`) before it is applied, so a report about
 *   `.git/objects` — or a report the panel itself provoked — costs one status
 *   read and no re-render, and never wakes a pane that is showing the same thing.
 * - **A failed read never replaces a reading that worked.** The panel is a window
 *   on a repository, not on git's mood: it shows an error only when it has
 *   nothing else to show.
 *
 * @param sessionId - The session whose repository is read.
 * @param git - The host-facing git client.
 * @param tabSignal - Aborted when the tab closes.
 * @param bus - Where a change that DID alter the reading is published.
 * @returns The latest snapshot for this session, or `null` while the first read
 *   is in flight, plus the reload trigger and whether a read is in flight.
 */
function useRepoSnapshot(
  sessionId: string,
  git: GitRemoteClient,
  tabSignal: AbortSignal | undefined,
  bus: RepoChangeBus,
): { snapshot: Snapshot | null; reload: () => void; busy: boolean } {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [busy, setBusy] = useState(true)
  /** The fingerprint of the reading on screen, so an unchanged one publishes nothing. */
  const published = useRef<string | null>(null)
  /** Whether any reading has been published yet: the first one is not a change. */
  const shown = useRef(false)
  /** The signal every read of this mount shares; the effects own its lifetime. */
  const [controller] = useState(() => new AbortController())

  // A new session is a new repository: nothing from the old one may survive as
  // this one's "last reading".
  useEffect(() => {
    published.current = null
    shown.current = false
  }, [sessionId])

  useEffect(() => {
    const abort = (): void => controller.abort()
    if (tabSignal?.aborted === true) controller.abort()
    tabSignal?.addEventListener('abort', abort)
    return () => {
      tabSignal?.removeEventListener('abort', abort)
      controller.abort()
    }
  }, [controller, tabSignal])

  const read = useCallback(
    async (kinds: readonly GitChangeKind[]): Promise<void> => {
      const { signal } = controller
      if (signal.aborted) return
      const [status, branches] = await Promise.all([
        git.status(sessionId, signal),
        git.branches(sessionId, signal),
      ])
      // A read that lost its race (a closed tab, a newer session) must not write
      // state: the newer read owns the panel now.
      if (signal.aborted) return
      setBusy(false)
      if (!status.ok) {
        if (!shown.current) setSnapshot({ sessionId, kind: 'failed', error: status.error })
        return
      }
      const fingerprint = statusSignature(status.value)
      if (fingerprint === published.current) return
      const first = !shown.current
      published.current = fingerprint
      shown.current = true
      setSnapshot({
        sessionId,
        kind: 'ready',
        status: status.value,
        // A branch listing that failed is not worth failing the panel over; the
        // change lists are the panel's reason to exist.
        branches: branches.ok ? branches.value : [],
      })
      // The first reading is what the panes mount with. Only a later one is a
      // change somebody has to hear about.
      if (!first) bus.publish(kinds)
    },
    [bus, controller, git, sessionId],
  )

  // The opening read.
  useEffect(() => {
    void read(ALL_CHANGE_KINDS)
  }, [read])

  // The host's reports. They arrive as "what moved", which is what the panes get
  // in turn — the diff cares about a file, the history about a ref.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    let kinds: readonly GitChangeKind[] = ALL_CHANGE_KINDS
    const unsubscribe = git.watch(sessionId, (change) => {
      kinds = change.kinds
      if (timer !== undefined) return
      timer = setTimeout(() => {
        timer = undefined
        void read(kinds)
      }, CHANGE_DEBOUNCE_MS)
    })
    return () => {
      if (timer !== undefined) clearTimeout(timer)
      unsubscribe()
    }
  }, [git, read, sessionId])

  const reload = useCallback(() => {
    setBusy(true)
    void read(ALL_CHANGE_KINDS)
  }, [read])

  return {
    snapshot: snapshot?.sessionId === sessionId ? snapshot : null,
    reload,
    busy,
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
  railRef,
  pickerId,
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
  /**
   * The rail itself, which the picker's layer is measured from.
   *
   * A ref rather than a class lookup: the layer hangs under the control that
   * opened it, and the rail is that control's row.
   */
  readonly railRef: Ref<HTMLDivElement>
  /** Id of the picker's layer, which the branch button points at. */
  readonly pickerId: string
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
    <div className={cls.head} ref={railRef}>
      {/* The branch name is the picker's handle (FR-4.1). It reads as a control
          rather than as a label because §1.3's third lesson is that a branch
          switcher nobody notices is a branch switcher nobody uses. */}
      <button
        type="button"
        className={cls.branch}
        title={`${name} — ${track}`}
        aria-expanded={pickerOpen}
        aria-haspopup="dialog"
        aria-controls={pickerOpen ? pickerId : undefined}
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
  // One bus per panel: the panes below subscribe to it instead of being handed a
  // generation number through the tree, and a second session's panel is a second
  // repository with its own changes.
  const bus = useMemo(createRepoChangeBus, [])
  const { snapshot, reload, busy } = useRepoSnapshot(sessionId, git, signal, bus)
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
  /** The change row whose menu is open (§9's file menu), or `null`. */
  const [menu, setMenu] = useState<RowMenu | null>(null)
  /** The rail the picker's layer is measured from, and the id that names it. */
  const railRef = useRef<HTMLDivElement | null>(null)
  const pickerId = useId()
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
    setMenu(null)
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

  // The same rule for an open menu: the row it hangs from can leave the list
  // under it — another window commits or discards the file — and a menu over a
  // row that is gone would act on a path the panel no longer lists.
  useEffect(() => {
    if (menu === null || busy || snapshot === null || snapshot.kind !== 'ready') return
    const { groups } = snapshot.status
    const listed = CHANGE_AREAS.some((area) =>
      groups[area].some((entry) => entry.path === menu.entry.path),
    )
    if (!listed) setMenu(null)
  }, [menu, snapshot, busy])

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
      // The host's probe will report the index this moved too, but the panel's
      // own action should not wait for that round trip to show what it did.
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
    // The row IS the open menu's anchor, and a press on the anchor is not an
    // "outside" press — so without this the menu would stay up over the diff it
    // just opened.
    setMenu(null)
    setOpenFile({ path: entry.path, area: diffAreaOf(area) })
  }

  /**
   * Open one row's menu (§9's file menu), anchored on the row that asked for it.
   * @param entry - The row the menu acts on.
   * @param area - The group the row was opened in.
   * @param anchor - The row element, which the layer is measured from.
   */
  const openMenu = (entry: FileChange, area: ChangeArea, anchor: HTMLElement): void => {
    // Shift+F10 reaches here without a press, so the branch list would otherwise
    // stay open behind the menu: two layers, one panel.
    setPickerOpen(false)
    setMenu({ anchor, entry, area })
  }

  const failure = action.kind === 'failed' ? errorCopy(t, action.error, 'action') : null

  /**
   * What the open row menu offers.
   *
   * One entry today: the row's own staging action — the one thing this row can do
   * that the panel can already run (`git add` for a conflict is FR-9.2's "mark
   * resolved", the same command with the name that says so). It is the shape §9's
   * file menu fills in rather than a finished menu: 「放弃更改」 arrives with M5a's
   * discard (§10.1 order 2), the copying entries with §10.2 order 6.
   */
  const menuLabel = menu === null ? '' : t('menu.fileRow', { path: menu.entry.path })
  const menuEntries: readonly MenuEntry[] =
    menu === null
      ? []
      : [
          menu.area === 'staged'
            ? {
                kind: 'item',
                id: 'unstage',
                label: t('action.unstage'),
                disabled: pending,
                onSelect: () => unstage([menu.entry.path]),
              }
            : {
                kind: 'item',
                id: 'stage',
                label: menu.area === 'conflicted' ? t('action.resolve') : t('action.stage'),
                disabled: pending,
                onSelect: () => stage([menu.entry.path]),
              },
        ]

  return (
    // The provider renders nothing; it is how a pane below hears that the
    // repository moved without the panel threading a counter down to it.
    <RepoChangeProvider bus={bus}>
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
          railRef={railRef}
          pickerId={pickerId}
          mode={mode}
          onToggleMode={() => setMode((current) => (current === 'tree' ? 'list' : 'tree'))}
        />
        {/* The branch list floats over the panel instead of taking a row in its
            column: it is opened from the rail, used, and dismissed, and the file
            list underneath must not move while that happens (FR-4.1's dropdown). */}
        {pickerOpen && (
          <Popover
            anchor={railRef.current}
            id={pickerId}
            label={t('branch.pickerLabel')}
            onClose={() => setPickerOpen(false)}
          >
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
          </Popover>
        )}
        {/* A change row's menu (§9's file menu): the same layer the branch list
            uses, anchored on the row that opened it — right-click, Shift+F10, or
            the menu key — so it covers the list instead of moving it. */}
        {menu !== null && (
          <Popover
            anchor={menu.anchor}
            label={menuLabel}
            onClose={() => setMenu(null)}
          >
            <Menu
              entries={menuEntries}
              label={menuLabel}
              onClose={() => setMenu(null)}
            />
          </Popover>
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
        {/* The staged list sits directly above the commit box, because it is what
            that box commits: the association is the closest one in the panel, and it
            is worth breaking VS Code's own order (message box first, staged list
            below it) to make it read — these files, this message, commit. The cost
            is that staging a row moves it across the box, which is the same jump
            VS Code makes between its two groups. It is also the one group that
            stays on screen when it is empty: it is the box's anchor, and its count
            of zero is the answer to "what will this commit?".

            It is capped, not draggable: the panel has exactly one grip, on the dock
            below, so a long staged list scrolls inside its own share rather than
            pushing the box away. */}
        <div className={cls.stagedPane} data-pane="staged">
          <Group
            label={t('group.staged')}
            area="staged"
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
            onMenu={openMenu}
          />
        </div>
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
                onMenu={openMenu}
              />
              {/* The working tree as two more sections of this one list. They do not
                  size themselves: the body scrolls, and its groups flow into it —
                  which is what the comparable sidebar's source-control view does, and
                  the reason the panel needs no grip per group. They are not resident:
                  a group with no rows is not a section worth keeping an empty note in,
                  which is exactly what the staged list above is for. */}
              <Group
                label={t('group.unstaged')}
                area="unstaged"
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
                onMenu={openMenu}
              />
              <Group
                label={t('group.untracked')}
                area="untracked"
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
                onMenu={openMenu}
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
          openFile={openFile}
          onCloseDiff={() => setOpenFile(null)}
        />
      </div>
    </RepoChangeProvider>
  )
}
