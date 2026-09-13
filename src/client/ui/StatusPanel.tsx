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
import { lineCount, repoAbsolutePath } from '../../core/format.ts'
import { readingSignature } from '../../core/status-signature.ts'
import type { GitChangeKind, GitPanelError, GitRemoteClient, Result } from '../../core/ports.ts'
import type {
  BranchInfo,
  BranchRef,
  RemoteBranchRef,
  RepoChoice,
  RepoListing,
  ChangeArea,
  CommitInfo,
  ConflictSide,
  DiffTarget,
  FileChange,
  InProgressOperation,
  OperationReport,
  RepoStatus,
  ResetMode,
  RewriteAction,
  StashEntry,
} from '../../core/types.ts'
import type { GitPanelKey } from '../locales.ts'
import { Group, ToolButton } from './ChangeGroup.tsx'
import { BranchPicker, type BranchRefusal } from './BranchPicker.tsx'
import { StashPicker } from './StashPicker.tsx'
import { ContextToolbar, type ToolbarEntry, type ToolbarPoint } from './toolbar.tsx'
import { Popover } from './popover.tsx'
import { CommitBox } from './CommitBox.tsx'
import { errorCopy } from './error-copy.ts'
import { BottomPane, openFileKey, type BottomTab, type OpenFile } from './BottomPane.tsx'
import { readBottomPane } from './bottom-view.ts'
import {
  dirKey,
  readCollapsedDirs,
  readViewMode,
  writeCollapsedDirs,
  writeViewMode,
  type ChangeView,
  type FileIcons,
  type ViewMode,
} from './change-view.ts'
import { iconUrlsOf } from './file-icons.ts'
import { readCollapsedGroups, writeCollapsedGroups } from './group-collapse.ts'
import { createRepoChangeBus, RepoChangeProvider, type RepoChangeBus } from './repo-change.tsx'
import { canDiscard, canResolveConflict } from './row-actions.ts'
import { writeClipboard } from './clipboard.ts'
import { useArmedKey } from './armed.ts'
import { readRepoChoices, writeRepoChoice } from './repo-choice.ts'
import { cls } from './styles.ts'
import { say, sentence, verbatim, type Sentence, type Translate } from './translate.ts'
import { NOTICE_DURATION_MS, Notice } from './notice.tsx'
import { CredentialPrompt } from './CredentialPrompt.tsx'
import {
  AcceptMineGlyph,
  AcceptTheirsGlyph,
  ArrowDownGlyph,
  ArrowUpGlyph,
  BranchGlyph,
  CaretGlyph,
  CheckGlyph,
  CherryPickGlyph,
  CopyGlyph,
  DiscardGlyph,
  FetchGlyph,
  ListGlyph,
  MergeGlyph,
  MinusGlyph,
  PlusGlyph,
  RefreshGlyph,
  ResetGlyph,
  RevertGlyph,
  RingGlyph,
  SquashGlyph,
  StashGlyph,
  SyncGlyph,
  TreeGlyph,
  TrashGlyph,
  UndoGlyph,
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
  /**
   * Move one open diff into a right-side tab of its own.
   *
   * Supplied by the DSH adapter, which is the only side that knows what a
   * resource address is. Omitted in a bare render (and in the jsdom tests),
   * which is also what keeps the diff header's promote button out of the markup:
   * with nowhere to move a diff to, there is no operation to offer.
   */
  readonly onOpenDiffTab?: (file: OpenFile) => void
}

/** One reading of the repository, tagged with the session it describes. */
type Snapshot =
  | { readonly sessionId: string; readonly kind: 'ready'; readonly status: RepoStatus; readonly branches: readonly BranchRef[] }
  | { readonly sessionId: string; readonly kind: 'failed'; readonly error: GitPanelError }

/** The mutations the panel can start. */
type ActionOp =
  | 'stage'
  | 'unstage'
  | 'discard'
  | 'resolve'
  | 'commit'
  | 'push'
  | 'pull'
  | 'fetch'
  | 'sync'
  | 'repo'
  | 'checkout'
  | 'createBranch'
  | 'deleteBranch'
  | 'operationContinue'
  | 'operationSkip'
  | 'operationAbort'
  | 'generate'
  | 'undo'
  | 'revert'
  | 'cherryPick'
  | 'squash'
  | 'drop'
  | 'reset'
  | 'stash'
  | 'copy'

/**
 * What the panel is doing, or last did, at the operation level.
 *
 * One value rather than three flags: a new operation should clear the previous
 * result, and a union makes that impossible to forget.
 *
 * `label` and `summary` are {@link Sentence}s, not strings: the feedback outlives
 * the language it was written in — a notice stored as text kept the old locale
 * after a language switch, which is the bug `translate.ts` explains.
 */
type ActionState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'running'; readonly op: ActionOp; readonly label: Sentence }
  | {
      readonly kind: 'done'
      readonly op: ActionOp
      readonly label: Sentence
      /** git's own line, or `null` when the command printed nothing. */
      readonly summary: Sentence | null
    }
  | { readonly kind: 'failed'; readonly op: ActionOp; readonly label: Sentence; readonly error: GitPanelError }

/**
 * A credential the panel is asking for, after an HTTPS operation failed.
 *
 * The operation is remembered as a thunk rather than re-derived: the retry has
 * to be the SAME call (a fetch is a fetch; a sync is pull-then-push), and the
 * label is kept so the retry's notice reads exactly as the first attempt's did.
 */
interface CredentialRequest {
  readonly op: ActionOp
  readonly label: Sentence
  /** The origin git named, which is what the host will store against. */
  readonly remote: string
  /** Re-run the operation that failed. */
  readonly retry: () => Promise<void>
}

/** The change-list row whose toolbar is open, and the point it was summoned at. */
interface FileRowMenu {
  readonly kind: 'file'
  /**
   * Where the card opens, in viewport coordinates.
   *
   * A point rather than the row element: the pointer path has no element to hang
   * from, and the row is not what the card belongs to — see `ui/toolbar.tsx`.
   */
  readonly origin: ToolbarPoint
  /** The file the menu acts on. */
  readonly entry: FileChange
  /** The group the row was opened in, which decides what the row can do. */
  readonly area: ChangeArea
}

/**
 * The commit whose toolbar is open (§9's commit menu), and where it was summoned.
 *
 * The panel never checks whether the commit is STILL the newest: the history is
 * the bottom pane's reading, not this snapshot's, and the host re-resolves HEAD
 * at execution time — a stale row is refused there, with the reason beside the
 * list the way every other refusal lands.
 *
 * `canUndo` is the one thing the panel does decide locally, because it is not a
 * staleness question: FR-3.8 undoes exactly the newest commit, and the bottom
 * pane is what knows which row that is. The copying entries are on every row, so
 * a menu exists either way.
 */
interface CommitRowMenu {
  readonly kind: 'commit'
  /** Where the card opens, in viewport coordinates. */
  readonly origin: ToolbarPoint
  readonly commit: CommitInfo
  /** Whether this row is the newest one, and so the one FR-3.8 may undo. */
  readonly canUndo: boolean
  /**
   * Whether the reset entry has been opened into its three modes.
   *
   * A flat menu cannot nest, and three always-visible reset entries would bury
   * the entries above them, so the reset entry replaces the menu's contents with
   * soft / mixed / hard (and a way back) on its first click.
   */
  readonly resetOpen: boolean
}

/** One open row menu, of either kind the panel has. */
type RowMenu = FileRowMenu | CommitRowMenu

/**
 * Reduce a mutation's report to the one line the panel shows.
 *
 * `git add` prints nothing, so the summary is often empty; the caller then shows
 * the operation's own name as the confirmation, which is enough because the
 * change list has already moved. git's line is kept verbatim — it is git's own
 * `master -> master`, in git's locale, not a key in this panel's dictionary.
 * @param result - The mutation's outcome.
 * @returns The summary sentence (`null` when git printed nothing), or the failure as it was.
 */
function reportOf(result: Result<OperationReport>): Result<Sentence | null> {
  return result.ok
    ? { ok: true, value: result.value.summary === '' ? null : verbatim(result.value.summary) }
    : result
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
 * @returns The target to ask the host for.
 */
export function diffAreaOf(area: ChangeArea): DiffTarget {
  return area === 'staged' ? { area: 'index' } : { area: 'worktree' }
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
  repoEpoch: number,
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
  /**
   * The branch listing of the last reading.
   *
   * Kept so a read whose branch listing failed reuses it instead of publishing
   * an empty list — the same "a failed read never replaces a reading that
   * worked" rule the status half follows above. It also keeps the fingerprint
   * stable across such a failure, so the picker does not empty and refill.
   */
  const lastBranches = useRef<readonly BranchRef[]>([])
  /** The signal every read of this mount shares; the effects own its lifetime. */
  const [controller] = useState(() => new AbortController())

  // A new session — or a switch to another repository inside one (FR-8) — is a
  // new repository: nothing from the old one may survive as this one's "last
  // reading". The epoch is the switch's signal, and it also re-runs the opening
  // read and re-subscribes the probe, because a stream's watched root is fixed
  // when it is opened.
  useEffect(() => {
    published.current = null
    shown.current = false
    lastBranches.current = []
  }, [sessionId, repoEpoch])

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
      // A branch listing that failed is not worth failing the panel over — the
      // change lists are the panel's reason to exist — and it must not erase the
      // listing that worked: the picker would empty out on a transient failure.
      // The last good one stands in, which also keeps the fingerprint unchanged.
      const localBranches = branches.ok ? branches.value : lastBranches.current
      const fingerprint = readingSignature(status.value, localBranches)
      if (fingerprint === published.current) return
      const first = !shown.current
      published.current = fingerprint
      shown.current = true
      lastBranches.current = localBranches
      setSnapshot({
        sessionId,
        kind: 'ready',
        status: status.value,
        branches: localBranches,
      })
      // The first reading is what the panes mount with. Only a later one is a
      // change somebody has to hear about.
      if (!first) bus.publish(kinds)
    },
    // `repoEpoch` is not read here: it is in the list so that switching
    // repository rebuilds this callback, which is what re-runs the opening read
    // and re-subscribes the probe below.
    [bus, controller, git, repoEpoch, sessionId],
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
  }, [git, read, sessionId, repoEpoch])

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
 * The deployment's own file-type icons (FR-1.2), read once per panel mount.
 *
 * A read that fails is deliberately quiet: the built-in glyphs are exactly what a
 * deployment without an icon map sees, so falling back IS the feature — while what
 * could actually be wrong (a bad line, an unreadable path, an oversized file) is
 * reported by the host, in the log the operator reads.
 *
 * It is not re-read when the session changes: it is deployment configuration, not
 * a property of the repository the panel is showing.
 * @param git - The host-facing git client.
 * @param sessionId - The session the panel is showing, which the transport keys on.
 * @param tabSignal - Aborted when the tab closes.
 * @returns Extension to drawable URL; empty when nothing is configured.
 */
function useFileIcons(
  git: GitRemoteClient,
  sessionId: string,
  tabSignal: AbortSignal | undefined,
): FileIcons {
  const [icons, setIcons] = useState<FileIcons>({})
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const result = await git.fileIcons(sessionId, tabSignal)
      if (cancelled || !result.ok) return
      setIcons(iconUrlsOf(result.value))
    })()
    return () => {
      cancelled = true
    }
  }, [git, sessionId, tabSignal])
  return icons
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
  onFetch,
  onSync,
  pickerOpen,
  onTogglePicker,
  branchRef,
  pickerId,
  stashOpen,
  onToggleStash,
  stashRef,
  mode,
  onToggleMode,
  repos,
  selectedRepo,
  onSelectRepo,
}: {
  readonly branch: BranchInfo
  /** Repositories under this session's directory (FR-8); empty when there is none. */
  readonly repos: readonly RepoChoice[]
  /** The root being read, or `null` while the listing is unknown. */
  readonly selectedRepo: string | null
  /** Point the panel at another repository; only offered when there is a choice. */
  readonly onSelectRepo: (root: string) => void
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
  /**
   * Fetch every remote.
   *
   * Always pressable: unlike pull and push it has no precondition to fail — it
   * works on a detached HEAD, an unborn branch, and a branch with no upstream.
   * A repository with no remote at all is refused by the host with a sentence.
   */
  readonly onFetch: () => void
  readonly onSync: () => void
  /** Whether the branch picker is unfolded. */
  readonly pickerOpen: boolean
  /** Fold or unfold the branch picker (FR-4.1). */
  readonly onTogglePicker: () => void
  /**
   * The branch button itself — the control the picker's layer hangs from.
   *
   * A ref rather than a class lookup, and the BUTTON rather than the rail it sits
   * in: the layer lines up with the control that opened it, and the rail's left
   * edge is not that control's (the repository picker can sit in front of it).
   */
  readonly branchRef: Ref<HTMLButtonElement>
  /** Id of the picker's layer, which the branch button points at. */
  readonly pickerId: string
  /** Whether the stash list is unfolded (FR-6.2). */
  readonly stashOpen: boolean
  /** Fold or unfold the stash list. */
  readonly onToggleStash: () => void
  /** The stash button, which the stash layer hangs from. */
  readonly stashRef: Ref<HTMLButtonElement>
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
      {/* Which repository this panel is reading (FR-8). Rendered ONLY when there
          is a choice, so a workspace that is one repository — the ordinary case —
          looks exactly as it did before this feature existed. */}
      {repos.length > 1 && (
        <select
          className={cls.repoSelect}
          value={selectedRepo ?? ''}
          title={t('repo.pickTitle')}
          aria-label={t('repo.pick')}
          onChange={(event) => onSelectRepo(event.target.value)}
        >
          {repos.map((repo) => (
            <option key={repo.root} value={repo.root}>
              {repo.name}
            </option>
          ))}
        </select>
      )}
      {/* The branch name is the picker's handle (FR-4.1). It reads as a control
          rather than as a label because §1.3's third lesson is that a branch
          switcher nobody notices is a branch switcher nobody uses. */}
      <button
        type="button"
        className={cls.branch}
        ref={branchRef}
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
      {/* Fetch sits beside Pull because both bring something down, and the dashed
          arrow is how they are told apart: this one only updates what the panel
          knows about the remote, and never touches the working tree. */}
      <ToolButton label={t('action.fetch')} disabled={busy} onClick={onFetch}>
        <FetchGlyph />
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
      {/* FR-6.2's stack, opened from the rail like the branch list: both are
          statements about the worktree this rail describes, and neither should
          push the change list out of the way to be read. Hand-written rather than
          a `ToolButton` for the same reason the branch button is: what it opens is
          a layer, and `aria-expanded` is the state a disclosure has. */}
      <button
        type="button"
        className={cls.tool}
        ref={stashRef}
        title={t('stash.open')}
        aria-label={t('stash.open')}
        aria-expanded={stashOpen}
        aria-haspopup="dialog"
        onClick={onToggleStash}
      >
        <StashGlyph />
      </button>
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
export function StatusPanel({
  sessionId,
  git,
  t,
  locale,
  signal,
  onOpenDiffTab,
}: StatusPanelProps): ReactNode {
  // One bus per panel: the panes below subscribe to it instead of being handed a
  // generation number through the tree, and a second session's panel is a second
  // repository with its own changes.
  const bus = useMemo(createRepoChangeBus, [])
  /**
   * Which repository is being read, and which ones there are to choose from (FR-8).
   *
   * A container directory holds several; the host remembers the choice per
   * session, and this is the panel's copy of that answer. `null` while the
   * listing is unknown, or when there is no repository at all — in which case the
   * ordinary "not a repo" path below reports it.
   */
  const [listing, setListing] = useState<RepoListing | null>(null)
  /**
   * Bumped when the user points the panel at another repository.
   *
   * The host's selection does the real work; this exists so the reads and the
   * probe subscription are rebuilt — a stream's watched root is fixed when it
   * opens, so following a switch means opening another one.
   */
  const [repoEpoch, setRepoEpoch] = useState(0)
  const selectedRepo = listing?.selected ?? null
  const { snapshot, reload, busy } = useRepoSnapshot(
    sessionId,
    repoEpoch,
    git,
    signal,
    bus,
  )
  // The deployment's own file-type icons, if it configured any (FR-1.2).
  const icons = useFileIcons(git, sessionId, signal)
  // The draft lives up here, not inside the box: a commit that fails must not
  // cost the user the message they just wrote.
  const [message, setMessage] = useState('')
  const [action, setAction] = useState<ActionState>({ kind: 'idle' })
  /**
   * The credential the panel is asking for, or `null`.
   *
   * Set when an operation fails with `auth-required`, cleared by a successful
   * save (which retries), by cancel, by dismissing the notice, and by starting
   * any other operation — a form for a remote the user has moved on from would
   * be an answer to a question nobody asked any more.
   */
  const [credential, setCredential] = useState<CredentialRequest | null>(null)
  /**
   * The diffs that are open, in the order their tabs were opened (FR-2.1, FR-7.2).
   *
   * A list rather than one file: the dock's strip is the panel's editor area, and
   * reading a commit means walking its file list without closing the last diff.
   * The target travels with each path, so a working comparison and a commit's
   * reading of the same file are two entries rather than one that overwrites.
   */
  const [openFiles, setOpenFiles] = useState<readonly OpenFile[]>([])
  /**
   * Which bottom tab is showing, or `null` while the dock is folded to its strip.
   *
   * Read from storage for the same reason the height is: a dock that folds itself
   * on every reload is one the user has to re-open every time.
   */
  const [bottomTab, setBottomTab] = useState<BottomTab | null>(() =>
    readBottomPane().expanded ? { kind: 'history' } : null,
  )
  /** Whether the branch picker is unfolded (FR-4.1). */
  const [pickerOpen, setPickerOpen] = useState(false)
  /** Whether the stash list is unfolded (FR-6.2). */
  const [stashOpen, setStashOpen] = useState(false)
  /**
   * The stash stack, newest first, or `null` before the first read.
   *
   * Read when the layer opens and after every stash operation that changes it,
   * rather than kept live: the stack is a thing the user looks at on purpose, and
   * the git probe's `refs` report already tells the panel when something else
   * moved `refs/stash`.
   */
  const [stashes, setStashes] = useState<readonly StashEntry[] | null>(null)
  /** Bumped to re-read the stack after an operation the panel itself performed. */
  const [stashReads, setStashReads] = useState(0)
  /**
   * The remote-tracking branches, for the picker's read-only list.
   *
   * Read only while the picker is open, for the same reason the stash stack is:
   * it is a list the user opened on purpose, and `refs/remotes` is large in a
   * repository with many remotes. Unlike the stack it is re-read whenever the
   * snapshot reloads, which the probe's `refs` report and every successful
   * operation already cause — so a fetch updates this list without extra wiring.
   */
  const [remoteBranches, setRemoteBranches] = useState<readonly RemoteBranchRef[]>([])
  /**
   * The branch a blocked switch was trying to reach (FR-4.4).
   *
   * Kept because the shortcut beside the failure box has to retry the SAME
   * switch: git's refusal is reported with its own multi-line output, and
   * "stash, then switch" is only meaningful next to the switch it would unblock.
   */
  const [stashSwitch, setStashSwitch] = useState<string | null>(null)
  /** The change row whose menu is open (§9's file menu), or `null`. */
  /** The row whose menu is open (§9's file menu, or FR-3.8's commit menu), or `null`. */
  const [menu, setMenu] = useState<RowMenu | null>(null)
  /** The two rail controls whose layers hang from them, and the id that names the picker's. */
  const branchRef = useRef<HTMLButtonElement | null>(null)
  const stashRef = useRef<HTMLButtonElement | null>(null)
  const pickerId = useId()
  /** The last refused branch deletion, so an unmerged branch can arm its force click. */
  const [branchRefusal, setBranchRefusal] = useState<BranchRefusal | null>(null)
  /** True while a commit message is being generated (FR-3.5). */
  const [generating, setGenerating] = useState(false)
  /** A note about the last generation, such as a truncated diff. */
  const [aiNote, setAiNote] = useState<Sentence | null>(null)
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
  /**
   * The rows checked in each group, by area.
   *
   * A selection is working state, not a preference: it belongs to this look at
   * this repository and dies with it. Kept as a map of sets — the same path can
   * be checked in the unstaged group and, after staging, count again in the
   * staged one, and the two checks are separate statements.
   */
  const [selected, setSelected] = useState<ReadonlyMap<ChangeArea, ReadonlySet<string>>>(
    new Map(),
  )

  /**
   * Check or uncheck one row of one group.
   * @param area - The group the row belongs to.
   * @param path - The row's path, which is its identity in the group.
   */
  const toggleSelected = useCallback((area: ChangeArea, path: string): void => {
    setSelected((current) => {
      const had = current.get(area)?.has(path) ?? false
      const nextArea = new Set(current.get(area) ?? [])
      if (had) nextArea.delete(path)
      else nextArea.add(path)
      const next = new Map(current)
      // An area with nothing checked is the same as an area never touched: not
      // keeping it is what lets `get(area)` everywhere below mean "unchecked".
      if (nextArea.size === 0) next.delete(area)
      else next.set(area, nextArea)
      return next
    })
  }, [])

  /**
   * The checked paths of one group that are still on its rows, in the group's
   * own order — the exact argument the batch action sends, so the order the
   * user reads the list in is the order git is asked in.
   * @param area - The group to read.
   * @param entries - The group's current rows.
   */
  const selectedIn = useCallback(
    (area: ChangeArea, entries: readonly FileChange[]): readonly string[] =>
      entries
        .filter((entry) => selected.get(area)?.has(entry.path) === true)
        .map((entry) => entry.path),
    [selected],
  )

  /**
   * A check is a statement about the list as it is now: a row that leaves it —
   * staged away, discarded, committed from another window — takes its check
   * with it. A checked path with no row left would aim a batch action at
   * nothing, and the count in the header's label would lie.
   */
  useEffect(() => {
    if (snapshot === null || snapshot.kind !== 'ready') return
    const { groups } = snapshot.status
    setSelected((current) => {
      let changed = false
      const next = new Map<ChangeArea, ReadonlySet<string>>()
      for (const [area, paths] of current) {
        const listed = new Set(groups[area].map((entry) => entry.path))
        const kept = new Set([...paths].filter((path) => listed.has(path)))
        if (kept.size !== paths.size) changed = true
        if (kept.size > 0) next.set(area, kept)
      }
      return changed ? next : current
    })
  }, [snapshot])

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
    () => ({ mode, collapsedDirs, onToggleDir: toggleDir, icons }),
    [mode, collapsedDirs, toggleDir, icons],
  )

  const toggleGroup = useCallback((area: ChangeArea): void => {
    setCollapsedGroups((current) => {
      const next = new Set(current)
      if (next.has(area)) next.delete(area)
      else next.add(area)
      return next
    })
  }, [])

  /**
   * Take the feedback away.
   *
   * Declared with the other hooks rather than beside the notice it serves,
   * because the render path returns early while the first read is in flight and
   * the hook count must not change between those two renders.
   *
   * Stable on purpose: `Notice`'s clock is keyed on its dismisser, so a new
   * function on every render would restart the timer on every render — and the
   * panel re-renders whenever the repository moves, which is always.
   */
  const dismissNotice = useCallback((): void => {
    setAction({ kind: 'idle' })
    // The credential form lives inside the failure notice, so dismissing the
    // notice dismisses it too.
    setCredential(null)
  }, [])

  // Which repositories this session's directory holds, and which one is read
  // (FR-8). The host owns the selection; this reads it, and — when the user's own
  // earlier choice for this container was not the host's default — points the
  // host at it before anything is read, so the panel opens on the repository it
  // was last pointed at rather than flashing the default one.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const result = await git.repos(sessionId, signal)
      if (cancelled) return
      if (!result.ok) {
        setListing(null)
        return
      }
      const remembered = readRepoChoices()[result.value.container]
      const applies =
        remembered !== undefined &&
        remembered !== result.value.selected &&
        result.value.repos.some((repo) => repo.root === remembered)
      if (!applies) {
        setListing(result.value)
        return
      }
      const moved = await git.selectRepo(sessionId, remembered, signal)
      if (cancelled) return
      setListing(moved.ok ? { ...result.value, selected: remembered } : result.value)
    })()
    return () => {
      cancelled = true
    }
  }, [git, sessionId, signal])

  /**
   * Point the panel at another repository of this container (FR-8).
   *
   * The choice is remembered against the container, not the session, so the next
   * conversation in this directory opens on the same repository (FR-8.2).
   * @param root - One of the roots the rail's picker offered.
   */
  const switchRepo = (root: string): void => {
    const current = listing
    if (current === null || root === current.selected) return
    void (async () => {
      const moved = await git.selectRepo(sessionId, root, signal)
      if (!moved.ok) {
        setAction({ kind: 'failed', op: 'repo', label: say('repo.pick'), error: moved.error })
        return
      }
      writeRepoChoice(current.container, root)
      setListing({ ...current, selected: root })
      setRepoEpoch((value) => value + 1)
    })()
  }

  // A different session — or another repository inside this one (FR-8) — is a
  // different repository, so neither the draft nor the last operation's result
  // belongs to it, and neither do the open diffs, which describe files in the old
  // repository. The dock itself stays where it was: a user who had the pane open
  // keeps it open, on the history. `selectedRepo` is the second trigger.
  useEffect(() => {
    setMessage('')
    setAction({ kind: 'idle' })
    setOpenFiles([])
    setBottomTab((current) => (current === null ? null : { kind: 'history' }))
    setPickerOpen(false)
    setMenu(null)
    setBranchRefusal(null)
    setGenerating(false)
    setAiNote(null)
    // The stash stack belongs to the old repository's `refs/stash`, and the
    // blocked switch it was offering to unblock no longer exists here.
    setStashOpen(false)
    setStashes(null)
    setStashSwitch(null)
    // The checked rows die with the session too: they were a statement about the
    // old repository's list, and this one has never been read.
    setSelected(new Map())
    // The repository listing is not cleared here: it describes the CONTAINER, and
    // a switch inside that container does not change it — only `selected` moves.
    // Neither the mode nor the folded directories are reset here: both are
    // preferences about how a list is drawn, exactly like the group folds above,
    // and a fold keyed by path is meaningful in the next repository too
    // (`node_modules` is folded wherever it appears).
    disarm()
  }, [disarm, selectedRepo, sessionId])

  // A file committed or discarded while its diff is open no longer has a row to
  // return to, so that tab is dropped rather than left showing a diff of
  // something the change list no longer lists. The check waits for a settled
  // read: during a refresh the group is briefly the old one, and clearing then
  // would close the pane on every keystroke of a `git add`.
  //
  // A COMMIT diff (FR-7.2) is not this kind of view: its subject is a piece of
  // history, and the file it names is usually not in the change list at all — so
  // this rule would close it the instant it opened. Its staleness is the host's
  // to answer, the same way an expired undo row's is.
  //
  // A promoted diff is out of reach here: it lives on the right, in a tab this
  // panel does not own and cannot close. Its pane re-reads itself and reports the
  // empty comparison on its own.
  useEffect(() => {
    if (busy || snapshot === null || snapshot.kind !== 'ready') return
    // Listed in ANY group, not just the one it was opened from: staging a file
    // moves it between groups, and the diff should survive that.
    const { groups } = snapshot.status
    setOpenFiles((current) => {
      const kept = current.filter(
        (file) =>
          file.target.area === 'commit' ||
          CHANGE_AREAS.some((area) => groups[area].some((entry) => entry.path === file.path)),
      )
      // The same array when nothing changed: a new one would re-render the whole
      // dock on every status read.
      return kept.length === current.length ? current : kept
    })
  }, [snapshot, busy])

  // The same rule for an open toolbar: the row it was summoned from can leave the
  // list — another window commits or discards the file — and a card acting on a
  // path the panel no longer lists is a card about nothing. This is now the ONLY
  // staleness check the toolbar has: it no longer hangs off the row, so nothing
  // detaches under it. A commit menu has no such check here (the history is the
  // bottom pane's reading, not this snapshot's); its stale case is the host's
  // refusal, which FR-3.8's re-verification exists to produce.
  useEffect(() => {
    if (menu === null || menu.kind !== 'file' || busy || snapshot === null || snapshot.kind !== 'ready') return
    const { groups } = snapshot.status
    const listed = CHANGE_AREAS.some((area) =>
      groups[area].some((entry) => entry.path === menu.entry.path),
    )
    if (!listed) setMenu(null)
  }, [menu, snapshot, busy])

  /**
   * Run one mutation, then report it or re-read the repository.
   * @param op - Which operation, for the feedback's placement.
   * @param label - The operation's name, held as a sentence so it follows the language.
   * @param operation - The call to make.
   */
  const perform = useCallback(
    async (
      op: ActionOp,
      label: Sentence,
      operation: () => Promise<Result<Sentence | null>>,
    ): Promise<void> => {
      setAction({ kind: 'running', op, label })
      // Any new operation retires an old credential form: the failure it was
      // answering is no longer the one on screen.
      setCredential(null)
      let result: Result<Sentence | null>
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
        // A remote that wanted a credential is the one failure the panel can
        // offer to fix in place: remember how to re-run the operation and which
        // origin git named, so the form beside the refusal can answer it.
        if (result.error.code === 'auth-required' && result.error.remote !== undefined) {
          const remote = result.error.remote
          setCredential({ op, label, remote, retry: () => perform(op, label, operation) })
        }
        return
      }
      setAction({ kind: 'done', op, label, summary: result.value })
      // The host's probe will report the index this moved too, but the panel's
      // own action should not wait for that round trip to show what it did.
      reload()
    },
    [reload],
  )

  /**
   * Store a typed credential and retry the operation that asked for it.
   *
   * The save is its own request, so the secret travels once and the retry is the
   * plain operation it always was. A failed save lands in the same notice with
   * the host's own sentence — a deployment with no credential provider is the
   * case that produces one.
   * @param username - What the user typed.
   * @param password - What the user typed; a token, in practice.
   */
  const submitCredential = (username: string, password: string): void => {
    const request = credential
    if (request === null) return
    void (async () => {
      setAction({ kind: 'running', op: request.op, label: request.label })
      const saved = await git.saveCredential(sessionId, request.remote, username, password, signal)
      if (!saved.ok) {
        setAction({ kind: 'failed', op: request.op, label: request.label, error: saved.error })
        return
      }
      setCredential(null)
      await request.retry()
    })()
  }

  /**
   * Re-read the stash stack (FR-6.2).
   *
   * Called after every stash operation the panel performs, and it does nothing
   * while the layer is closed: the only reader of this state is the list itself,
   * and the probe's `refs` report re-reads it the next time the layer opens.
   */
  const refreshStashes = useCallback(() => setStashReads((count) => count + 1), [])

  // The stack is read when the layer opens, and again after any operation the
  // panel ran while it was open. A read that fails is reported the way every other
  // failure here is — beside the list — and leaves an empty stack rather than a
  // spinner that never stops.
  //
  // `t` is deliberately NOT a dependency, although the failure path uses it: the
  // translator the slot hands down is namespace-bound once and reads the live
  // locale when it is CALLED, so a rename cannot make this copy stale — while a
  // dependency on its identity would re-read the stack on every render that
  // produced a new function, which is a loop rather than a refresh.
  useEffect(() => {
    if (!stashOpen) return
    let cancelled = false
    void (async () => {
      const result = await git.stashes(sessionId, signal)
      if (cancelled) return
      if (!result.ok) {
        setAction({ kind: 'failed', op: 'stash', label: say('action.stash'), error: result.error })
        setStashes([])
        return
      }
      setStashes(result.value)
    })()
    return () => {
      cancelled = true
    }
  }, [git, sessionId, signal, stashOpen, stashReads])

  // Remote-tracking branches, read while the picker is open. Keyed on the
  // snapshot as well as `pickerOpen`, so every reload — the probe's `refs`
  // report, or the panel's own fetch — re-reads them without extra wiring. A
  // failed read leaves the empty sentence, which is the same way the local
  // branch listing treats a read it could not complete.
  useEffect(() => {
    if (!pickerOpen) return
    let cancelled = false
    void (async () => {
      const result = await git.remoteBranches(sessionId, signal)
      if (cancelled) return
      setRemoteBranches(result.ok ? result.value : [])
    })()
    return () => {
      cancelled = true
    }
  }, [git, sessionId, signal, pickerOpen, snapshot])

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
  // The checked rows of each group, still on the list (the prune effect above
  // keeps them that way). Everything the header buttons need is derived here:
  // the paths in the group's order, and from them the counts the labels say.
  const stagedSel = selectedIn('staged', staged)
  const unstagedSel = selectedIn('unstaged', unstaged)
  const untrackedSel = selectedIn('untracked', untracked)
  const conflictedSel = selectedIn('conflicted', conflicted)
  /**
   * The selection-aware form of one group's bulk action, or `undefined` when
   * nothing in the group is checked — the header then keeps the whole-group
   * form (FR-3.2) it has always had.
   */
  const selectionOf = (
    kind: 'stage' | 'unstage',
    paths: readonly string[],
  ): { count: number; run: () => void } | undefined =>
    paths.length > 0
      ? { count: paths.length, run: () => (kind === 'stage' ? stage(paths) : unstage(paths)) }
      : undefined
  /**
   * The header's armed discard for one working-tree group: present only while
   * rows are checked AND the group's rows can be discarded at all (a staged row
   * has nothing to throw away — `canDiscard`'s rule, `ui/row-actions.ts`).
   */
  const dangerOf = (area: ChangeArea, paths: readonly string[]) => {
    if (!canDiscard(area) || paths.length === 0) return undefined
    const key = `discard-selected:${area}`
    return {
      count: paths.length,
      armed: armedKey === key,
      onArm: () => armKey(key),
      onFire: () => discardSelected(paths),
    }
  }
  const scope = commitScopeOf(status.groups)
  // The branch listing is the only source that distinguishes a gone upstream
  // from a branch that simply has no counts.
  const upstreamGone = branches.find((branch) => branch.current)?.upstreamGone ?? false
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
    void perform('stage', say('action.stage'), async () =>
      reportOf(await git.stage(sessionId, paths, signal)),
    )
  }
  const unstage = (paths: readonly string[]): void => {
    if (paths.length === 0) return
    void perform('unstage', say('action.unstage'), async () =>
      reportOf(await git.unstage(sessionId, paths, signal)),
    )
  }
  /**
   * Discard one row's working-tree change (FR-6.1).
   *
   * The report is the panel's own sentence rather than git's: `git restore` prints
   * nothing at all, and what the user needs to hear is which file they just gave up
   * on — the row leaves the list a moment later, so this notice is the only place
   * that says what happened.
   * @param entry - The row whose change is discarded.
   */
  const discard = (entry: FileChange): void => {
    // The armed state was this click's whole reason to exist; disarm so a later
    // click on another row cannot inherit it. (The row's own inline button keeps
    // its own arming; see `ChangeRow`.)
    disarm()
    void perform('discard', say('action.discard'), async () => {
      const result = await git.discard(sessionId, [entry.path], signal)
      if (!result.ok) return result
      return { ok: true, value: say('discard.done', { path: entry.path }) }
    })
  }

  /**
   * Accept one whole side of a conflicted file (FR-9.2).
   *
   * The notice is the panel's sentence rather than git's, for the same reason
   * discard has one: `git restore` and `git add` print nothing on success, and
   * the row leaves the conflict group a moment later — so this is the only place
   * that says which side the user just took.
   * @param entry - The conflicted row.
   * @param side - Which side the user accepted, in the user's words.
   */
  const resolveConflict = (entry: FileChange, side: ConflictSide): void => {
    disarm()
    const label = say(side === 'mine' ? 'action.acceptMine' : 'action.acceptTheirs')
    void perform('resolve', label, async () => {
      const result = await git.resolveConflict(sessionId, side, [entry.path], signal)
      if (!result.ok) return result
      return {
        ok: true,
        value: say(side === 'mine' ? 'resolve.doneMine' : 'resolve.doneTheirs', {
          path: entry.path,
        }),
      }
    })
  }

  /**
   * Discard every checked row of one working-tree group.
   *
   * Only reachable through the header's armed button, so the two-click
   * confirmation has already been spent by the time this runs; the notice names
   * the count rather than each path, the way the single-row sentence cannot
   * afford to when forty files go at once.
   * @param paths - The checked rows' paths, in the group's own order.
   */
  const discardSelected = (paths: readonly string[]): void => {
    disarm()
    void perform('discard', say('action.discard'), async () => {
      const result = await git.discard(sessionId, paths, signal)
      if (!result.ok) return result
      return { ok: true, value: say('discard.doneSelected', { count: paths.length }) }
    })
  }

  const commitNow = (): void => {
    const widening = scope.kind === 'all-tracked'
    const label = say(widening ? 'commit.allTracked' : 'commit.button')
    void perform('commit', label, async () => {
      const result = widening
        ? await git.commitAll(sessionId, message, signal)
        : await git.commit(sessionId, message, signal)
      if (!result.ok) return result
      // Only a successful commit clears the box; a refused one keeps the text.
      setMessage('')
      return {
        ok: true,
        value: say('commit.done', {
          hash: result.value.shortOid,
          subject: result.value.subject,
        }),
      }
    })
  }
  const pull = (): void => {
    void perform('pull', say('action.pull'), async () => reportOf(await git.pull(sessionId, signal)))
  }
  const push = (): void => {
    void perform('push', say('action.push'), async () => reportOf(await git.push(sessionId, signal)))
  }
  const sync = (): void => {
    void perform('sync', say('action.sync'), async () => reportOf(await git.sync(sessionId, signal)))
  }
  const fetchRemotes = (): void => {
    void perform('fetch', say('action.fetch'), async () =>
      reportOf(await git.fetch(sessionId, signal)),
    )
  }

  /**
   * Stash the working tree (FR-6.2).
   *
   * The notice is the panel's own sentence rather than git's: git's line is
   * `Saved working directory and index state …`, and what the user needs to hear
   * is that the stack now holds what the worktree just lost.
   * @param message - The label the user typed, or `null` for git's own.
   * @param untracked - Whether untracked files went with it (`-u`).
   */
  const stashSave = (message: string | null, untracked: boolean): void => {
    void perform('stash', say('action.stash'), async () => {
      const result = await git.stashSave(sessionId, message, untracked, signal)
      if (!result.ok) return result
      refreshStashes()
      return {
        ok: true,
        value:
          message === null
            ? say('stash.saveDone')
            : say('stash.saveDoneNamed', { message }),
      }
    })
  }

  /**
   * Apply one stash entry, dropping it when `pop` (FR-6.2).
   *
   * The row is addressed by the entry's object id, and the host resolves it again
   * at execution time: `stash@{0}` is a position, and another window's stash would
   * have moved it. A conflict is a failure here like any other, and git keeps the
   * entry — which the re-read below then shows.
   * @param entry - The row the click came from.
   * @param pop - Whether to drop the entry once it applied cleanly.
   */
  const stashApply = (entry: StashEntry, pop: boolean): void => {
    void perform('stash', say('action.stash'), async () => {
      const result = await git.stashApply(sessionId, entry.oid, pop, signal)
      if (!result.ok) return result
      refreshStashes()
      return {
        ok: true,
        value: pop
          ? say('stash.popDone', { selector: entry.selector })
          : say('stash.applyDone', { selector: entry.selector }),
      }
    })
  }

  /**
   * Drop one stash entry without applying it (FR-6.2).
   *
   * The arming happened in the picker (its own `useArmedKey`), so the second click
   * arrives here ready to run; the notice names the selector the user clicked.
   * @param entry - The row whose armed button was confirmed.
   */
  const stashDrop = (entry: StashEntry): void => {
    void perform('stash', say('action.stash'), async () => {
      const result = await git.stashDrop(sessionId, entry.oid, signal)
      if (!result.ok) return result
      refreshStashes()
      return { ok: true, value: say('stash.dropDone', { selector: entry.selector }) }
    })
  }

  /**
   * Stash, then retry the switch git refused (FR-4.4's shortcut, restored in M5a
   * by D20).
   *
   * Untracked files go with it (`-u`) — deliberately, and unlike the form's own
   * default: git's refusal names files it would overwrite, and those can be
   * untracked ones, so a stash that left them behind would leave the switch
   * blocked and the click looking broken. Nothing is lost either way: the entry
   * lands in the stack this panel lists. A second refusal is reported like the
   * first, and the shortcut stays where it was so the user can decide again.
   * @param name - The branch the blocked switch was going to.
   */
  const stashAndSwitch = (name: string): void => {
    setStashSwitch(null)
    // The label is the whole action, not its first half: if the RETRY is what
    // fails, the box's heading has to name the thing the user clicked.
    void perform('stash', say('stash.andSwitch', { name }), async () => {
      const saved = await git.stashSave(sessionId, null, true, signal)
      if (!saved.ok) return saved
      refreshStashes()
      const switched = await git.checkout(sessionId, name, signal)
      if (!switched.ok) {
        // Still blocked by local work (an edit that arrived between the two
        // clicks, say): keep the shortcut on screen, because it is still the
        // answer. Any other reason clears it — a stash has nothing to offer.
        setStashSwitch(switched.error.code === 'dirty-worktree' ? name : null)
        return switched
      }
      return { ok: true, value: say('stash.switched', { name }) }
    })
  }

  /**
   * Switch to another branch (FR-4.1).
   *
   * A refusal here is the interesting case, not an edge: git answers a dirty
   * working tree with several lines naming the files it would overwrite, and
   * `perform` renders them verbatim (FR-4.4). What M4 deliberately did not offer
   * was the doc's "stash, then switch" shortcut — stash is FR-6.2, and it lives in
   * M5a; the refusal now remembers which switch it blocked so that shortcut can
   * retry it (D20).
   */
  const checkout = (name: string): void => {
    setPickerOpen(false)
    setStashSwitch(null)
    void perform('checkout', say('action.checkout'), async () => {
      const result = await git.checkout(sessionId, name, signal)
      if (!result.ok) {
        // The code is what makes the shortcut possible: `dirty-worktree` is the
        // one refusal a stash would clear, and every other failure of a switch
        // (a typo, a missing branch) is not.
        if (result.error.code === 'dirty-worktree') setStashSwitch(name)
        return result
      }
      return reportOf(result)
    })
  }
  const createBranch = (name: string, base: string | null): void => {
    setPickerOpen(false)
    void perform('createBranch', say('action.createBranch'), async () =>
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
    void perform('deleteBranch', say('action.deleteBranch'), async () => {
      const result = await git.deleteBranch(sessionId, name, force, signal)
      if (!result.ok) {
        setBranchRefusal({ name, code: result.error.code })
        return result
      }
      setBranchRefusal(null)
      return reportOf(result)
    })
  }
  /** The dictionary's name for the operation git is part-way through. */
  const operationName = (kind: InProgressOperation): Sentence =>
    kind === 'merge'
      ? say('operation.merge')
      : kind === 'revert'
        ? say('operation.revert')
        : kind === 'cherry-pick'
          ? say('operation.cherryPick')
          : say('operation.rebase')

  /**
   * Conclude the operation git is part-way through.
   *
   * The kind comes from the snapshot the bar was drawn from, and the host
   * re-checks it against its own state before running anything — so a click that
   * raced a finished operation is refused rather than run against the wrong one.
   */
  const continueOperation = (): void => {
    const kind = status.operation
    if (kind === null) return
    void perform(
      'operationContinue',
      say('operation.continue', { kind: operationName(kind) }),
      async () => reportOf(await git.continueOperation(sessionId, kind, signal)),
    )
  }

  /** Abandon the commit blocking a rebase, and let the replay carry on. */
  const skipOperation = (): void => {
    const kind = status.operation
    if (kind !== 'rebase') return
    void perform('operationSkip', say('operation.skip'), async () =>
      reportOf(await git.skipOperation(sessionId, kind, signal)),
    )
  }

  /** Abandon the whole operation and return to the state before it began. */
  const abortOperation = (): void => {
    const kind = status.operation
    if (kind === null) return
    disarm()
    void perform(
      'operationAbort',
      say('operation.abort', { kind: operationName(kind) }),
      async () => reportOf(await git.abortOperation(sessionId, kind, signal)),
    )
  }

  /**
   * Create a new commit reversing one row's commit ("还原此提交").
   * @param commit - The row the menu acted on.
   */
  const revertCommit = (commit: CommitInfo): void => {
    disarm()
    void perform('revert', say('action.revertCommit'), async () => {
      const result = await git.revertCommit(sessionId, commit.oid, signal)
      if (!result.ok) return result
      return { ok: true, value: say('rewrite.revertDone', { subject: commit.subject }) }
    })
  }

  /**
   * Apply one row's commit to the current branch ("捡取此提交").
   * @param commit - The row the menu acted on.
   */
  const cherryPick = (commit: CommitInfo): void => {
    disarm()
    void perform('cherryPick', say('action.cherryPick'), async () => {
      const result = await git.cherryPick(sessionId, commit.oid, signal)
      if (!result.ok) return result
      return { ok: true, value: say('rewrite.cherryPickDone', { subject: commit.subject }) }
    })
  }

  /**
   * Fold one row's commit into its parent, or drop it.
   * @param commit - The row the menu acted on.
   * @param action - Which of the two rewrites to run.
   */
  const rewriteCommit = (commit: CommitInfo, action: RewriteAction): void => {
    disarm()
    void perform(
      action,
      action === 'squash' ? say('action.squashCommit') : say('action.dropCommit'),
      async () => {
        const result = await git.rewriteCommit(sessionId, commit.oid, action, signal)
        if (!result.ok) return result
        return {
          ok: true,
          value: say(action === 'squash' ? 'rewrite.squashDone' : 'rewrite.dropDone', {
            subject: commit.subject,
          }),
        }
      },
    )
  }

  /**
   * Move the branch to one row's commit ("重置到此提交").
   * @param commit - The row the menu acted on.
   * @param mode - How much of the current state to keep.
   */
  const resetTo = (commit: CommitInfo, mode: ResetMode): void => {
    disarm()
    const label =
      mode === 'soft'
        ? say('action.resetSoft')
        : mode === 'mixed'
          ? say('action.resetMixed')
          : say('action.resetHard')
    const done =
      mode === 'soft'
        ? 'rewrite.resetSoftDone'
        : mode === 'mixed'
          ? 'rewrite.resetMixedDone'
          : 'rewrite.resetHardDone'
    void perform('reset', label, async () => {
      const result = await git.resetTo(sessionId, commit.oid, mode, signal)
      if (!result.ok) return result
      return { ok: true, value: say(done, { subject: commit.subject }) }
    })
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
        setAction({ kind: 'failed', op: 'generate', label: say('commit.ai'), error: result.error })
        return
      }
      setMessage(result.value.message)
      if (result.value.truncated) setAiNote(say('commit.aiTruncated'))
    })()
  }

  /**
   * Show one file's diff, opening its tab if it is not already open (FR-2.1).
   *
   * The open toolbar is put away first. A pointer press elsewhere closes it on its
   * own, but a row activated by Enter never sends one — and the two layers the
   * rail opens have the same hole — so without this the card would sit over the
   * diff it had just opened.
   *
   * The dock is the change list's own reading surface, so this always opens (or
   * selects) a dock tab even for a file the user once promoted: the right-side
   * tab is a separate surface the user manages, and a file open in both is the
   * same thing as a file open in two editor splits.
   * @param file - The path and the comparison to read it with.
   */
  const showDiff = (file: OpenFile): void => {
    const key = openFileKey(file)
    setMenu(null)
    setPickerOpen(false)
    setStashOpen(false)
    setOpenFiles((current) =>
      current.some((entry) => openFileKey(entry) === key) ? current : [...current, file],
    )
    setBottomTab({ kind: 'file', key })
  }

  /**
   * Open one row's diff (FR-2.1).
   * @param entry - The row that was activated.
   * @param area - The group it was activated in, which picks the comparison.
   */
  const openDiff = (entry: FileChange, area: ChangeArea): void => {
    showDiff({ path: entry.path, target: diffAreaOf(area) })
  }

  /**
   * Open one file of a commit as that commit changed it (FR-7.2).
   *
   * The commit is addressed by its full object id: the host reads the file with
   * `git show <hash> -- <path>`, so which commit the row was in IS the request.
   * @param commit - The commit whose file list was clicked in.
   * @param path - The file the user picked.
   */
  const openCommitFile = (commit: CommitInfo, path: string): void => {
    showDiff({ path, target: { area: 'commit', hash: commit.oid } })
  }

  /**
   * Close one open diff (the × in the diff's own header).
   *
   * Its neighbour takes the strip over, or the history when it was the last one:
   * closing a diff is not a reason to put the whole pane away, so the dock stays
   * open either way.
   * @param key - Which open diff to drop.
   */
  const closeFile = (key: string): void => {
    const index = openFiles.findIndex((file) => openFileKey(file) === key)
    const next = openFiles.filter((file) => openFileKey(file) !== key)
    setOpenFiles(next)
    setBottomTab((current) => {
      if (current === null || current.kind !== 'file' || current.key !== key) return current
      // The tab to the right, or the one to the left when the last tab closed.
      const neighbour = next[Math.min(index, next.length - 1)]
      return neighbour === undefined
        ? { kind: 'history' }
        : { kind: 'file', key: openFileKey(neighbour) }
    })
  }

  /**
   * Move one open diff into a right-side tab of its own, closing it here.
   *
   * The move is one intent, not an open followed by a close: the dock tab goes
   * away in the same click that puts the reading on the right, which is what
   * "open it in a tab" means when the diff is already on screen. Nothing is
   * remembered about where it went — the panel cannot see the Sidebar's tabs, and
   * the Sidebar unmounts this panel the moment the new tab takes focus, so any
   * memory here would be gone by the time it was next asked for. A later click on
   * the row opens it in the dock again, which is the dock being the primary
   * surface.
   * @param key - Which open diff to promote.
   */
  const promoteFile = (key: string): void => {
    const file = openFiles.find((entry) => openFileKey(entry) === key)
    if (file === undefined || onOpenDiffTab === undefined) return
    onOpenDiffTab(file)
    closeFile(key)
  }

  /**
   * Open one row's toolbar (§9's file menu), at the point the row handed over.
   * @param entry - The row the menu acts on.
   * @param area - The group the row was opened in.
   * @param origin - Where the card opens: the pointer, or the row for a keyboard.
   */
  const openMenu = (entry: FileChange, area: ChangeArea, origin: ToolbarPoint): void => {
    // Shift+F10 reaches here without a press, so the branch list or the stash stack
    // would otherwise stay open behind the menu: two layers, one panel.
    setPickerOpen(false)
    setStashOpen(false)
    setMenu({ kind: 'file', origin, entry, area })
  }

  /**
   * Undo the newest commit (FR-3.8).
   *
   * Which undo happens — `reset --mixed` or `revert` — is the host's decision,
   * re-verified at execution time; the notice names the commit because after a
   * reset its row is gone from the history and this sentence is the only record
   * of what was acted on.
   * @param commit - The row the menu acted on.
   */
  const undoCommit = (commit: CommitInfo): void => {
    // The armed state was this click's whole reason to exist; disarm so a later
    // click on another row cannot inherit it.
    disarm()
    void perform('undo', say('action.undoCommit'), async () => {
      const result = await git.undoCommit(sessionId, commit.oid, signal)
      if (!result.ok) return result
      return {
        ok: true,
        value:
          result.value.mode === 'reset'
            ? say('undo.doneReset', { subject: result.value.subject })
            : say('undo.doneRevert', { subject: result.value.subject }),
      }
    })
  }

  /**
   * Open one commit row's toolbar (§9's commit menu), at the point it handed over.
   * @param commit - The commit the menu acts on.
   * @param origin - Where the card opens: the pointer, or the row for a keyboard.
   * @param canUndo - Whether this row is the newest, and so may carry FR-3.8's undo.
   */
  const openCommitMenu = (commit: CommitInfo, origin: ToolbarPoint, canUndo: boolean): void => {
    // Same one-layer rule as the file menu: Shift+F10 arrives without a press.
    setPickerOpen(false)
    setStashOpen(false)
    setMenu({ kind: 'commit', origin, commit, canUndo, resetOpen: false })
  }

  /**
   * Put one value on the clipboard and say so (§10.2 order 6).
   *
   * Not routed through {@link perform}: a copy is not a repository operation, so
   * there is nothing to re-read and no write to audit — but a host that refuses
   * the write (an insecure context, a denied permission, jsdom) lands in the same
   * action box as every other failure, which is the panel's one error path.
   * @param label - The entry's own name, held as a sentence so the notice follows
   *   the language like every other word on screen.
   * @param value - The exact text to copy.
   */
  const copyToClipboard = async (label: Sentence, value: string): Promise<void> => {
    if (await writeClipboard(value)) {
      setAction({ kind: 'done', op: 'copy', label, summary: say('copy.done', { value }) })
      return
    }
    setAction({
      kind: 'failed',
      op: 'copy',
      label,
      error: { code: 'clipboard', message: '' },
    })
  }

  const failure = action.kind === 'failed' ? errorCopy(t, action.error, 'action') : null

  /** The arming key of one row's discard entry, so the entry and its confirm agree. */
  const discardKey = (entry: FileChange, area: ChangeArea): string =>
    `discard:${area}:${entry.path}`

  /** The arming key of one conflict-side entry, keyed by side so the two do not share. */
  const resolveKey = (entry: FileChange, area: ChangeArea, side: ConflictSide): string =>
    `${side === 'mine' ? 'accept-mine' : 'accept-theirs'}:${area}:${entry.path}`

  /**
   * The entries of one file row's toolbar (§9's file menu).
   *
   * Two groups, one hairline: what this card can DO to the repository — stage,
   * unstage or mark resolved, and discard where the row has working-tree edits —
   * and then what it can take away from it, the two copying entries §9 lists
   * (order 6). git first, because that is what a row's toolbar is for; the copies
   * are the errand you occasionally have here. Every entry carries a mark, because
   * a card this small is read by shape before it is read by word.
   *
   * Discard appears exactly where `ui/row-actions.ts` says the row has a button for
   * it: the working-tree rows. It is an armed entry (`stayOpen`), so the first click
   * arms it and the card stays up for the second — §4.3's two-click confirmation,
   * with the entry itself becoming the confirmation. Note what is NOT doing the
   * warning: colour. Nothing on this card is painted red (see `styles.ts`), so the
   * confirmation is a sentence and a second click, not a hue. The copies are on
   * every row, because a path is copyable whatever its state.
   */
  const fileMenuEntries = (row: FileRowMenu): readonly ToolbarEntry[] => {
    const staging: ToolbarEntry =
      row.area === 'staged'
        ? {
            kind: 'item',
            id: 'unstage',
            label: t('action.unstage'),
            icon: <MinusGlyph />,
            disabled: pending,
            onSelect: () => unstage([row.entry.path]),
          }
        : {
            kind: 'item',
            id: 'stage',
            label: row.area === 'conflicted' ? t('action.resolve') : t('action.stage'),
            // For a conflict the same command means the other thing, and its mark
            // says which: a tick for "resolved", a plus for "staged".
            icon: row.area === 'conflicted' ? <CheckGlyph /> : <PlusGlyph />,
            disabled: pending,
            onSelect: () => stage([row.entry.path]),
          }
    const copies: readonly ToolbarEntry[] = [
      { kind: 'separator' },
      {
        kind: 'item',
        id: 'copyRelativePath',
        label: t('copy.relativePath'),
        icon: <CopyGlyph />,
        onSelect: () => void copyToClipboard(say('copy.relativePath'), row.entry.path),
      },
      {
        kind: 'item',
        id: 'copyAbsolutePath',
        label: t('copy.absolutePath'),
        icon: <CopyGlyph />,
        onSelect: () =>
          void copyToClipboard(
            say('copy.absolutePath'),
            repoAbsolutePath(status.root, row.entry.path),
          ),
      },
    ]
    // A conflict row's menu offers the same choice the row's strip does (FR-9.2):
    // take my side, take the other side, or — later — merge them. The two takes
    // arm for the same reason the row's buttons do; the merge entry is disabled
    // because it is not built, and a menu entry has nowhere to carry the button's
    // tooltip, which is where that sentence lives.
    const conflict: readonly ToolbarEntry[] = !canResolveConflict(row.area)
      ? []
      : [
          ...(['mine', 'other'] as const).map((side): ToolbarEntry => {
            const sideKey = resolveKey(row.entry, row.area, side)
            const armedSide = armedKey === sideKey
            return {
              kind: 'item',
              id: side === 'mine' ? 'acceptMine' : 'acceptTheirs',
              label: armedSide
                ? t(side === 'mine' ? 'action.acceptMineArmed' : 'action.acceptTheirsArmed')
                : t(side === 'mine' ? 'action.acceptMine' : 'action.acceptTheirs'),
              icon: side === 'mine' ? <AcceptMineGlyph /> : <AcceptTheirsGlyph />,
              stayOpen: true,
              disabled: pending,
              onSelect: () => {
                if (!armedSide) {
                  // §4.3's first click: arm, and leave the card up for the second.
                  armKey(sideKey)
                  return
                }
                setMenu(null)
                resolveConflict(row.entry, side)
              },
            }
          }),
          {
            kind: 'item',
            id: 'merge',
            label: t('action.merge'),
            icon: <MergeGlyph />,
            disabled: true,
            onSelect: () => {
              // Drawn for where it will sit; the tooltip on the row's own button
              // is what explains the wait.
            },
          },
        ]
    if (!canDiscard(row.area)) return [staging, ...conflict, ...copies]
    const key = discardKey(row.entry, row.area)
    const armedHere = armedKey === key
    return [
      staging,
      ...conflict,
      {
        kind: 'item',
        id: 'discard',
        label: armedHere ? t('action.discardArmed') : t('action.discard'),
        icon: <DiscardGlyph />,
        stayOpen: true,
        disabled: pending,
        onSelect: () => {
          if (!armedHere) {
            // §4.3's first click: arm, and leave the card up for the second one.
            armKey(key)
            return
          }
          // The second click runs it, and the confirmation is done being useful:
          // the card goes the way every other entry takes it.
          setMenu(null)
          discard(row.entry)
        },
      },
      ...copies,
    ]
  }

  /**
   * The entries of one commit row's toolbar (§9's commit menu).
   *
   * The same two groups as the file row's toolbar: what this card can do to the
   * repository, then — after one hairline — what it can take away from it.
   *
   * The doing half starts with the rewriting entries: revert and cherry-pick
   * produce a NEW commit ("还原 / 捡取"), squash and drop rewrite the branch, and
   * the reset entry opens a second layer with its three modes. Undo comes last
   * among them and only on the newest row, because FR-3.8 undoes exactly one
   * commit; it shares the group because it is one of these, not a way of reading
   * the commit. The copies are on every row — a hash or a message is worth taking
   * from any commit.
   *
   * Every rewriting entry arms rather than fires: §4.3's two clicks, with the
   * entry itself becoming the confirmation. Which sentence it arms with is a
   * claim the host re-checks at execution time (the pushed marker for undo, the
   * parents and ancestry for the rest), so the two cannot disagree about what is
   * coming. Revert and cherry-pick refuse a merge commit, squash refuses the
   * first commit — all of them with the host's own sentence beside the list.
   * None of them is painted red: the mark and the confirmation sentence are what
   * carry the weight (see `styles.ts`).
   *
   * The rewriting entries carry the marks that tell them apart at a glance. They
   * are the things this panel can do to history, and a card of nine text rows is
   * read by shape before it is read by word.
   */
  const commitMenuEntries = (row: CommitRowMenu): readonly ToolbarEntry[] => {
    const copies: readonly ToolbarEntry[] = [
      {
        kind: 'item',
        id: 'copyShortHash',
        label: t('copy.shortHash'),
        icon: <CopyGlyph />,
        onSelect: () => void copyToClipboard(say('copy.shortHash'), row.commit.shortOid),
      },
      {
        kind: 'item',
        id: 'copyFullHash',
        label: t('copy.fullHash'),
        icon: <CopyGlyph />,
        onSelect: () => void copyToClipboard(say('copy.fullHash'), row.commit.oid),
      },
      {
        kind: 'item',
        id: 'copyMessage',
        label: t('copy.message'),
        icon: <CopyGlyph />,
        // The history list reads `%s`, the subject line; the body is not on this
        // side of the wire, so this copies what the row itself shows.
        onSelect: () => void copyToClipboard(say('copy.message'), row.commit.subject),
      },
    ]

    /**
     * One entry that arms on the first click and acts on the second (§4.3).
     * @param id - Stable id, for tests and for the entry's own identity.
     * @param armingKey - The panel-wide armed-state key for this entry.
     * @param idle - Label before it is armed.
     * @param confirmation - Label once armed; it says what the second click does.
     * @param icon - The mark in the entry's leading column.
     * @param run - What the second click runs.
     * @param disabled - Whether the entry cannot do anything at all.
     */
    const armable = (
      id: string,
      armingKey: string,
      idle: GitPanelKey,
      confirmation: GitPanelKey,
      icon: ReactNode,
      run: () => void,
      disabled = false,
    ): ToolbarEntry => {
      const armedHere = armedKey === armingKey
      return {
        kind: 'item',
        id,
        label: armedHere ? t(confirmation) : t(idle),
        icon,
        stayOpen: true,
        disabled: pending || disabled,
        onSelect: () => {
          if (!armedHere) {
            armKey(armingKey)
            return
          }
          setMenu(null)
          run()
        },
      }
    }

    // The reset entry's second layer: the three modes and a way back. Everything
    // else is out of the way while it is open, so the mode list cannot be
    // mistaken for the row's ordinary menu.
    if (row.resetOpen) {
      const modes: readonly {
        readonly mode: ResetMode
        readonly id: string
        readonly label: GitPanelKey
        readonly confirmation: GitPanelKey
      }[] = [
        { mode: 'soft', id: 'resetSoft', label: 'action.resetSoft', confirmation: 'action.resetSoftArmed' },
        { mode: 'mixed', id: 'resetMixed', label: 'action.resetMixed', confirmation: 'action.resetMixedArmed' },
        { mode: 'hard', id: 'resetHard', label: 'action.resetHard', confirmation: 'action.resetHardArmed' },
      ]
      return [
        ...modes.map((entry) =>
          armable(
            entry.id,
            `reset:${row.commit.oid}:${entry.mode}`,
            entry.label,
            entry.confirmation,
            // One mark for all three: they are three answers to one question,
            // and the labels are what tell the answers apart.
            <ResetGlyph />,
            () => resetTo(row.commit, entry.mode),
          ),
        ),
        { kind: 'separator' },
        {
          kind: 'item',
          id: 'resetBack',
          label: t('action.resetBack'),
          // No mark: the column stays reserved so the modes above keep their
          // alignment, and the gap reads as the way back out of the sub-list.
          onSelect: () => setMenu({ ...row, resetOpen: false }),
        },
      ]
    }

    const rewrites: readonly ToolbarEntry[] = [
      armable(
        'revert',
        `revert:${row.commit.oid}`,
        'action.revertCommit',
        'action.revertCommitArmed',
        <RevertGlyph />,
        () => revertCommit(row.commit),
      ),
      armable(
        'cherryPick',
        `cherryPick:${row.commit.oid}`,
        'action.cherryPick',
        'action.cherryPickArmed',
        <CherryPickGlyph />,
        () => cherryPick(row.commit),
      ),
      armable(
        'squash',
        `squash:${row.commit.oid}`,
        'action.squashCommit',
        'action.squashCommitArmed',
        <SquashGlyph />,
        () => rewriteCommit(row.commit, 'squash'),
        // A first commit has nothing to fold into; the host says so too, but a
        // disabled entry is the cheaper answer.
        row.commit.parents.length === 0,
      ),
      armable(
        'drop',
        `drop:${row.commit.oid}`,
        'action.dropCommit',
        'action.dropCommitArmed',
        // The bin again: dropping a commit really does delete it, which is the
        // half of discard's story where a bin would have been honest.
        <TrashGlyph />,
        () => rewriteCommit(row.commit, 'drop'),
      ),
    ]

    const resetEntry: ToolbarEntry = {
      kind: 'item',
      id: 'resetHere',
      label: t('action.resetHere'),
      icon: <ResetGlyph />,
      stayOpen: true,
      disabled: pending,
      onSelect: () => {
        // Opening a layer is not an armed action; drop whatever was armed so the
        // modes cannot inherit an arming from a previous click.
        disarm()
        setMenu({ ...row, resetOpen: true })
      },
    }

    // What the card can DO, as one group: the rewrites, the reset entry that opens
    // its three modes, and — on the newest row only — the undo. Undo sits last
    // among them because FR-3.8 undoes exactly one commit, not because it is a
    // different kind of thing from the four above it.
    const git: ToolbarEntry[] = [...rewrites, resetEntry]
    if (row.canUndo) {
      const key = `undo:${row.commit.oid}`
      const armedHere = armedKey === key
      git.push({
        kind: 'item',
        id: 'undo',
        label: armedHere
          ? row.commit.pushed === true
            ? t('action.undoCommitArmedRevert')
            : t('action.undoCommitArmedReset')
          : t('action.undoCommit'),
        icon: <UndoGlyph />,
        stayOpen: true,
        disabled: pending,
        onSelect: () => {
          if (!armedHere) {
            // §4.3's first click: arm, and leave the card up for the second one.
            armKey(key)
            return
          }
          setMenu(null)
          undoCommit(row.commit)
        },
      })
    }
    // One hairline, between the two kinds of thing this card holds: what it does
    // to the repository, and what it takes away from it.
    return [...git, { kind: 'separator' }, ...copies]
  }

  const menuLabel =
    menu === null
      ? ''
      : menu.kind === 'file'
        ? t('toolbar.fileRow', { path: menu.entry.path })
        : t('toolbar.commitRow', { hash: menu.commit.shortOid })
  const menuEntries: readonly ToolbarEntry[] =
    menu === null ? [] : menu.kind === 'file' ? fileMenuEntries(menu) : commitMenuEntries(menu)

  // The operation bar's own words, resolved at render time so a language switch
  // re-says them like every other label on screen.
  const operationKind = status.operation
  const operationLabel = operationKind === null ? '' : sentence(t, operationName(operationKind))

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
          onFetch={fetchRemotes}
          onSync={sync}
          repos={listing?.repos ?? []}
          selectedRepo={selectedRepo}
          onSelectRepo={switchRepo}
          pickerOpen={pickerOpen}
          onTogglePicker={() => {
            // The rail has two layers and one row to hang them from: opening one
            // closes the other, which is the same rule the row toolbar follows.
            // The toolbar has to be cleared here rather than left to its own
            // outside-press rule: a rail button reached by keyboard sends Enter,
            // and that never sends a pointerdown.
            setMenu(null)
            setStashOpen(false)
            setPickerOpen((open) => !open)
          }}
          branchRef={branchRef}
          pickerId={pickerId}
          stashOpen={stashOpen}
          onToggleStash={() => {
            setMenu(null)
            setPickerOpen(false)
            setStashOpen((open) => !open)
          }}
          stashRef={stashRef}
          mode={mode}
          onToggleMode={() => setMode((current) => (current === 'tree' ? 'list' : 'tree'))}
        />
        {/* The branch list floats over the panel instead of taking a row in its
            column: it is opened from the rail, used, and dismissed, and the file
            list underneath must not move while that happens (FR-4.1's dropdown).
            It hangs from the BUTTON, not the rail: that is the control the user
            pressed, and the layer lines up with it. */}
        {pickerOpen && (
          <Popover
            anchor={branchRef.current}
            id={pickerId}
            label={t('branch.pickerLabel')}
            onClose={() => setPickerOpen(false)}
          >
            <BranchPicker
              branches={branches}
              remoteBranches={remoteBranches}
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
        {/* The stash stack (FR-6.2): the same layer again, hanging from the button
            that opened it, so reading the stack never moves the change list. */}
        {stashOpen && (
          <Popover
            anchor={stashRef.current}
            label={t('stash.title')}
            onClose={() => setStashOpen(false)}
          >
            <StashPicker
              stashes={stashes}
              t={t}
              busy={busy || pending}
              onSave={stashSave}
              onApply={stashApply}
              onDrop={stashDrop}
            />
          </Popover>
        )}
        {/* A row's toolbar (§9's two menus): NOT the layer above. The rail's
            dropdowns hang off the control that opens them and span the column;
            this card is placed at the point that summoned it — right-click,
            Shift+F10, or the menu key — and is only as wide as its own words, so
            a right-click never looks like the branch list opening. */}
        {menu !== null && (
          <ContextToolbar
            origin={menu.origin}
            entries={menuEntries}
            label={menuLabel}
            onClose={() => setMenu(null)}
          />
        )}
        {/* The ways out of an interrupted operation — FR-9.3's merge included.
            The bar exists because the state is otherwise invisible: with every
            conflict resolved this panel looks exactly like an ordinary staged
            change set, and a rewrite stopped on an empty pick shows no conflict
            at all. */}
        {operationKind !== null && (
          <div className={cls.mergeBox} data-operation={operationKind}>
            <span className={cls.mergeLabel}>
              {t('operation.inProgress', { kind: operationLabel })}
            </span>
            <button
              type="button"
              className={cls.ghost}
              disabled={pending || conflicted.length > 0}
              title={
                conflicted.length > 0
                  ? t('operation.continueBlocked', { count: conflicted.length })
                  : t('operation.continue', { kind: operationLabel })
              }
              onClick={continueOperation}
            >
              {t('operation.continue', { kind: operationLabel })}
            </button>
            {/* Only a rebase has a commit to skip: the pick that would conflict or
                was already applied can be abandoned without throwing the whole
                rewrite away. */}
            {operationKind === 'rebase' && (
              <button
                type="button"
                className={cls.ghost}
                disabled={pending || conflicted.length > 0}
                title={t('operation.skipHint')}
                onClick={skipOperation}
              >
                {t('operation.skip')}
              </button>
            )}
            <button
              type="button"
              className={armedKey === 'operation' ? cls.danger : cls.ghost}
              data-armed={String(armedKey === 'operation')}
              disabled={pending}
              title={
                armedKey === 'operation'
                  ? t('operation.abortConfirm', { kind: operationLabel })
                  : t('operation.abort', { kind: operationLabel })
              }
              onClick={() => {
                if (armedKey === 'operation') abortOperation()
                else armKey('operation')
              }}
            >
              {armedKey === 'operation'
                ? t('operation.abortArmed', { kind: operationLabel })
                : t('operation.abort', { kind: operationLabel })}
            </button>
          </div>
        )}
        {action.kind === 'failed' && failure !== null && (
          <Notice
            kind="error"
            op={action.op}
            label={`${sentence(t, action.label)} · ${t('action.failed')}`}
            title={failure.title}
            detail={failure.detail}
            // `null`: a refusal waits to be read and dismissed. It carries git's
            // multi-line words (FR-4.4) and may carry a control below them, and
            // neither may vanish from under the pointer.
            durationMs={null}
            onDismiss={dismissNotice}
            dismissLabel={t('action.dismiss')}
          >
            {/* FR-4.4's shortcut, restored now that FR-6.2 exists (D20). It sits
                beside the refusal it answers — the multi-line list of files git
                would have overwritten — and appears whenever a switch is known to
                be blocked by local work, which is the one failure a stash clears.
                Not armed: the work it removes from the worktree is put on the
                stack this panel lists, so the same layer's "apply" undoes it.
                Accent ink, because it is the way on rather than a footnote to the
                failure. */}
            {stashSwitch !== null && (
              <button
                type="button"
                className={cls.accent}
                disabled={pending}
                title={t('stash.andSwitchHint', { name: stashSwitch })}
                onClick={() => stashAndSwitch(stashSwitch)}
              >
                {t('stash.andSwitch', { name: stashSwitch })}
              </button>
            )}
            {/* The form for a remote that asked for a credential: it sits in the
                notice that reported the refusal, so the reason and the answer are
                the same card (§4.1 forbids a modal). */}
            {credential !== null && (
              <CredentialPrompt
                remote={credential.remote}
                t={t}
                busy={pending}
                onSubmit={submitCredential}
                onCancel={() => setCredential(null)}
              />
            )}
          </Notice>
        )}
        {action.kind === 'done' && (
          <Notice
            kind="success"
            op={action.op}
            title={action.summary === null ? sentence(t, action.label) : sentence(t, action.summary)}
            durationMs={NOTICE_DURATION_MS}
            onDismiss={dismissNotice}
            dismissLabel={t('action.dismiss')}
          />
        )}
        {/* The column: the staged drawer, the message box, the working-tree
            drawers, the conflict group, then the bottom pane. The first two are
            deliberately not VS Code's order — see the drawer's own comment — and the
            last one cannot be: VS Code opens a diff in the editor area, and this
            plugin registers only a right-sidebar tab, so the diffs share the bottom
            pane with the history, as tabs of one strip (`BottomPane`). FR-2.1 still
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
            resident
            batch={{
              kind: 'unstage',
              run: () => unstage(staged.map((entry) => entry.path)),
              selection: selectionOf('unstage', stagedSel),
            }}
            emptyNote={t('group.stagedEmpty')}
            collapsed={collapsedGroups.has('staged')}
            view={view}
            onToggle={() => toggleGroup('staged')}
            isSelected={(path) => selected.get('staged')?.has(path) === true}
            onStage={stage}
            onUnstage={unstage}
            onOpen={openDiff}
            onMenu={openMenu}
            onDiscard={discard}
            onResolve={resolveConflict}
            onToggleSelect={(path) => toggleSelected('staged', path)}
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
          {/* Nothing replaces the list when the repository is clean: the three
              sections are resident, and their counts ARE the clean state — one
              header saying 0 is a shorter way to say "no uncommitted changes" than
              a paragraph, and it does not re-flow the list the moment a file
              appears. The commit box says the same thing where it matters, beside
              the button that would do the committing. */}
          {/* Conflicts keep the top of the list, where VS Code puts them: while
              a merge is open, nothing in the panel matters more. They get a
              group and a `+` per row, but no whole-group bulk action — the
              conflict UI proper (FR-9) is a later milestone, and "stage all"
              over a half-resolved merge is not a shortcut worth offering — and
              they are NOT resident: a group that exists for one afternoon is
              not height anyone wants to take back from the list for good.
              What they do get is the selection: checked rows move together,
              and the header then offers exactly those (which is also how a
              merge is marked resolved, FR-9.2). */}
          <Group
            label={t('group.conflicted')}
            area="conflicted"
            entries={conflicted}
            t={t}
            busy={busy || pending}
            batch={
              conflictedSel.length > 0
                ? {
                    kind: 'stage',
                    run: () => stage(conflicted.map((entry) => entry.path)),
                    selection: selectionOf('stage', conflictedSel),
                  }
                : undefined
            }
            collapsed={collapsedGroups.has('conflicted')}
            view={view}
            onToggle={() => toggleGroup('conflicted')}
            isSelected={(path) => selected.get('conflicted')?.has(path) === true}
            onStage={stage}
            onUnstage={unstage}
            onOpen={openDiff}
            onMenu={openMenu}
            onDiscard={discard}
            onResolve={resolveConflict}
            onToggleSelect={(path) => toggleSelected('conflicted', path)}
          />
          {/* The working tree as two more sections of this one list. They do not
              size themselves: the body scrolls, and its groups flow into it —
              which is what the comparable sidebar's source-control view does, and
              the reason the panel needs no grip per group. Both are resident: an
              empty section keeps its header, its 0, and its own empty sentence —
              the same answer the staged drawer gives, because a bare count never
              says whether "0" means "nothing here" or "this was never read". */}
          <Group
            label={t('group.unstaged')}
            area="unstaged"
            entries={unstaged}
            t={t}
            busy={busy || pending}
            resident
            batch={{
              kind: 'stage',
              run: () => stage(unstaged.map((entry) => entry.path)),
              selection: selectionOf('stage', unstagedSel),
            }}
            danger={dangerOf('unstaged', unstagedSel)}
            emptyNote={t('group.unstagedEmpty')}
            collapsed={collapsedGroups.has('unstaged')}
            view={view}
            onToggle={() => toggleGroup('unstaged')}
            isSelected={(path) => selected.get('unstaged')?.has(path) === true}
            onStage={stage}
            onUnstage={unstage}
            onOpen={openDiff}
            onMenu={openMenu}
            onDiscard={discard}
            onResolve={resolveConflict}
            onToggleSelect={(path) => toggleSelected('unstaged', path)}
          />
          <Group
            label={t('group.untracked')}
            area="untracked"
            entries={untracked}
            t={t}
            busy={busy || pending}
            resident
            batch={{
              kind: 'stage',
              run: () => stage(untracked.map((entry) => entry.path)),
              selection: selectionOf('stage', untrackedSel),
            }}
            danger={dangerOf('untracked', untrackedSel)}
            emptyNote={t('group.untrackedEmpty')}
            collapsed={collapsedGroups.has('untracked')}
            view={view}
            onToggle={() => toggleGroup('untracked')}
            isSelected={(path) => selected.get('untracked')?.has(path) === true}
            onStage={stage}
            onUnstage={unstage}
            onOpen={openDiff}
            onMenu={openMenu}
            onDiscard={discard}
            onResolve={resolveConflict}
            onToggleSelect={(path) => toggleSelected('untracked', path)}
          />
          {status.truncated && <p className={cls.note}>{t('state.truncated')}</p>}
        </div>
        {/* One region for everything that is not the change list: the recent
            commits and every open diff share it as one strip of tabs (VS Code
            keeps the list and the editor apart; this panel has no editor area, so
            they take turns in the same box). */}
        <BottomPane
          // Keyed by the repository, so switching one REMOUNTS the dock. The
          // history panel owns its commit list and only re-reads on a `refs`
          // event; a switch is not such an event, so without this the list keeps
          // showing the repository the panel just left until something else
          // refreshes it (reported from the running panel). The dock's own
          // preferences live in `localStorage`, so the tab, its fold and its
          // height survive the remount.
          key={selectedRepo ?? 'no-repo'}
          sessionId={sessionId}
          git={git}
          t={t}
          locale={locale}
          signal={signal}
          openFiles={openFiles}
          tab={bottomTab}
          onTab={setBottomTab}
          onCloseFile={closeFile}
          onPromoteDiff={onOpenDiffTab === undefined ? undefined : promoteFile}
          onCommitMenu={openCommitMenu}
          onOpenCommitFile={openCommitFile}
        />
      </div>
    </RepoChangeProvider>
  )
}
