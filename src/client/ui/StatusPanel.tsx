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
import { lineCount, pathParts, relativeTimeParts } from '../../core/format.ts'
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
import { badgeFor } from '../../core/git-parse.ts'
import { CommitBox } from './CommitBox.tsx'
import { errorCopy } from './error-copy.ts'
import { BottomPane, type OpenFile } from './BottomPane.tsx'
import { PaneResizer } from './pane-resizer.tsx'
import { readCollapsedGroups, writeCollapsedGroups } from './group-collapse.ts'
import { cls } from './styles.ts'
import type { Translate } from './translate.ts'
import {
  ArrowDownGlyph,
  ArrowUpGlyph,
  BranchGlyph,
  CaretGlyph,
  CloseGlyph,
  DotGlyph,
  MinusGlyph,
  PlusGlyph,
  RefreshGlyph,
  RingGlyph,
  SyncGlyph,
} from './icons.tsx'

export type { Translate }

/** Smallest the staged drawer may be dragged to, in pixels. */
const STAGED_MIN_HEIGHT = 44

/**
 * Height kept for the rail, the commit box and a usable change list below, however
 * far the staged drawer is dragged.
 */
const STAGED_RESERVED_HEIGHT = 220

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
type ActionOp = 'stage' | 'unstage' | 'commit' | 'push' | 'pull' | 'sync'

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

/** One glyph button with a tooltip and an accessible name. */
function ToolButton({
  label,
  disabled,
  onClick,
  children,
}: {
  readonly label: string
  readonly disabled?: boolean
  readonly onClick: () => void
  readonly children: ReactNode
}): ReactNode {
  return (
    <button
      type="button"
      className={cls.tool}
      title={label}
      aria-label={label}
      disabled={disabled === true}
      onClick={onClick}
    >
      {children}
    </button>
  )
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
      <div className={cls.branch} title={`${name} — ${track}`}>
        <BranchGlyph className={cls.branchGlyph} />
        <span className={cls.branchName}>{name}</span>
        {branch.head === 'unborn' && <span className={cls.branchState}>· {t('branch.unborn')}</span>}
        {branch.head === 'detached' && branch.oid !== null && (
          <span className={cls.branchState}>({branch.oid.slice(0, 7)})</span>
        )}
        {upstreamGone && (
          <span className={cls.branchState}>· {t('branch.upstreamGone')}</span>
        )}
      </div>
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
      <ToolButton label={t('action.refresh')} onClick={onRefresh}>
        {busy ? <span className={cls.spinner} /> : <RefreshGlyph />}
      </ToolButton>
    </div>
  )
}

/**
 * One changed file, with the badge its group gives it and its staging action.
 *
 * The whole row opens the diff (FR-2.1) rather than only its path: a row is the
 * unit the list is made of, and the row is what the pointer is on. That makes the
 * `+`/`−` buttons inside it a conflict of intent — pressing one must stage, and
 * must NOT also open a diff — so the action strip stops the click from reaching
 * the row. The strip is a plain `div` for exactly that: `ToolButton` keeps its
 * one-argument `onClick` signature, and the containment lives where the layout
 * says it does.
 */
function ChangeRow({
  entry,
  area,
  t,
  busy,
  onStage,
  onUnstage,
  onOpen,
}: {
  readonly entry: FileChange
  readonly area: ChangeArea
  readonly t: Translate
  readonly busy: boolean
  readonly onStage: (paths: readonly string[]) => void
  readonly onUnstage: (paths: readonly string[]) => void
  readonly onOpen: (entry: FileChange, area: ChangeArea) => void
}): ReactNode {
  const { directory, name } = pathParts(entry.path)
  const badge = badgeFor(entry, area)
  // A rename is the one case where the row cannot stand alone: the new path is
  // only half the story, so the original joins the tooltip.
  const tooltip =
    entry.origPath === undefined ? entry.path : `${entry.origPath} → ${entry.path}`
  // A staged row offers `−`; everything else offers `+`. For a conflict, `+` is
  // also how a merge is marked resolved — the same command git would be given.
  const canUnstage = area === 'staged'

  return (
    <div
      className={cls.row}
      title={tooltip}
      role="button"
      tabIndex={0}
      aria-label={t('diff.open', { path: entry.path })}
      onClick={() => onOpen(entry, area)}
      onKeyDown={(event) => {
        // Only the row's own key press counts. A key press on the `+`/`−` inside
        // it bubbles here, and Space activates a button — so without this guard,
        // staging by keyboard would also open a diff, the same bug the click
        // handler's `stopPropagation` prevents for the mouse.
        if (event.target !== event.currentTarget) return
        if (event.key !== 'Enter' && event.key !== ' ') return
        // Space would otherwise scroll the panel, which is not what pressing a
        // row means.
        event.preventDefault()
        onOpen(entry, area)
      }}
    >
      <span className={cls.badge} data-status={badge}>
        {badge}
      </span>
      <span className={cls.path}>
        {directory !== '' && <span className={cls.pathDir}>{directory}</span>}
        <span className={cls.pathName}>{name}</span>
      </span>
      <span className={cls.rowActions} onClick={(event) => event.stopPropagation()}>
        {!canUnstage && (
          <ToolButton
            label={t('action.stage')}
            disabled={busy}
            onClick={() => onStage([entry.path])}
          >
            {/* Bigger than the rail's tool glyphs: this is the row's main click,
                and the row is where the panel is used most. */}
            <PlusGlyph size={16} />
          </ToolButton>
        )}
        {canUnstage && (
          <ToolButton
            label={t('action.unstage')}
            disabled={busy}
            onClick={() => onUnstage([entry.path])}
          >
            <MinusGlyph size={16} />
          </ToolButton>
        )}
      </span>
    </div>
  )
}

/** A group's bulk action (FR-3.2). */
interface GroupBatch {
  /** Which way the whole group moves. */
  readonly kind: 'stage' | 'unstage'
  /** Run it over every path in the group. */
  readonly run: () => void
}

/**
 * One group of changes: a disclosure header, its count, its bulk action, and its
 * rows.
 *
 * The bulk action is FR-3.2 and it is not a convenience: §1.3's fourth lesson is
 * that a first commit of a few dozen untracked files is a disaster when each one
 * needs its own `+`.
 *
 * The header folds the group (§4.2 draws exactly that caret). The count stays on
 * screen while folded, because "there are 37 untracked files" is the reason to
 * open it and hiding the number as well would make folding the same as losing
 * them. The caret, the name and the count are one button and the bulk action is
 * its SIBLING — a button inside a button is invalid, and the inner one would not
 * be clickable in every browser.
 */
function Group({
  label,
  area,
  entries,
  t,
  busy,
  batch,
  emptyNote,
  collapsed,
  onToggle,
  onStage,
  onUnstage,
  onOpen,
}: {
  readonly label: string
  readonly area: ChangeArea
  readonly entries: readonly FileChange[]
  readonly t: Translate
  readonly busy: boolean
  readonly batch?: GroupBatch
  /**
   * Copy to show when the group has no rows, which also keeps the group on
   * screen. Without it an empty group renders nothing at all — right for a list
   * that comes and goes, wrong for the staged drawer, which is the anchor of the
   * commit box above it and should not vanish the moment the index is empty.
   */
  readonly emptyNote?: string
  /** Whether the group's rows are folded away. */
  readonly collapsed: boolean
  /** Fold or unfold this group. */
  readonly onToggle: () => void
  readonly onStage: (paths: readonly string[]) => void
  readonly onUnstage: (paths: readonly string[]) => void
  readonly onOpen: (entry: FileChange, area: ChangeArea) => void
}): ReactNode {
  if (entries.length === 0 && emptyNote === undefined) return null
  return (
    <section className={cls.group} data-group={area} data-collapsed={String(collapsed)}>
      <div className={cls.groupHead}>
        <button
          type="button"
          className={cls.groupToggle}
          aria-expanded={!collapsed}
          title={collapsed ? t('group.expand') : t('group.collapse')}
          onClick={onToggle}
        >
          <CaretGlyph className={cls.groupCaret} />
          <span className={cls.groupLabel}>{label}</span>
          <span className={cls.count}>{entries.length}</span>
        </button>
        {batch !== undefined && (
          <span className={cls.groupActions}>
            <button
              type="button"
              className={cls.ghost}
              disabled={busy}
              onClick={batch.run}
            >
              {batch.kind === 'stage' ? t('action.stageAll') : t('action.unstageAll')}
            </button>
          </span>
        )}
      </div>
      {!collapsed && entries.length === 0 && (
        <p className={cls.groupEmpty}>{emptyNote}</p>
      )}
      {!collapsed &&
        entries.map((entry) => (
          <ChangeRow
            key={`${area}:${entry.path}`}
            entry={entry}
            area={area}
            t={t}
            busy={busy}
            onStage={onStage}
            onUnstage={onUnstage}
            onOpen={onOpen}
          />
        ))}
    </section>
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
  /** `null` means "not dragged yet": the stylesheet's cap applies. */
  const [stagedHeight, setStagedHeight] = useState<number | null>(null)
  // Folded groups are a preference, not a render detail: someone who folds
  // "untracked" away does not want it back on the next visit (§4.2 draws the
  // caret). Initialised from storage, written back whenever it changes.
  const [collapsedGroups, setCollapsedGroups] =
    useState<ReadonlySet<ChangeArea>>(readCollapsedGroups)

  useEffect(() => {
    writeCollapsedGroups(collapsedGroups)
  }, [collapsedGroups])

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
  }, [sessionId])

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
      const result = await operation()
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

  const stage = (paths: readonly string[]): void => {
    void perform('stage', t('action.stage'), async () =>
      reportOf(await git.stage(sessionId, paths, signal)),
    )
  }
  const unstage = (paths: readonly string[]): void => {
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
      />
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
      {/* The column: the staged drawer, the message box, the working-tree list,
          then the bottom pane. The first two are deliberately not VS Code's order
          — see the drawer's own comment — and the last one cannot be: VS Code
          opens a diff in the editor area, and this plugin registers only a
          right-sidebar tab, so the diff shares the bottom pane with the history as
          its second tab (`BottomPane`). FR-2.1 still holds in both cases:
          embedded, never a modal. */}
      {/* The staged drawer sits directly above the commit box, because it is what
          that box commits: the association is the closest one in the panel, and it
          is worth breaking VS Code's own order (message box first, staged list
          below it) to make it read — these files, this message, commit. The cost
          is that staging a row moves it across the box, which is the same jump
          VS Code makes between its two groups. */}
      <div className={cls.stagedDrawer}>
        <PaneResizer
          label={t('staged.resize')}
          minHeight={STAGED_MIN_HEIGHT}
          reserved={STAGED_RESERVED_HEIGHT}
          onResize={setStagedHeight}
        />
        <div className={cls.stagedBody} style={stagedHeight === null ? undefined : { height: `${stagedHeight}px`, maxHeight: 'none' }}>
            <Group
              label={t('group.staged')}
              area="staged"
              entries={staged}
              t={t}
              busy={busy || pending}
              batch={{ kind: 'unstage', run: () => unstage(staged.map((entry) => entry.path)) }}
              emptyNote={t('group.stagedEmpty')}
              collapsed={collapsedGroups.has('staged')}
              onToggle={() => toggleGroup('staged')}
              onStage={stage}
              onUnstage={unstage}
              onOpen={openDiff}
            />
        </div>
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
            {/* Conflicts get a group and a `+` per row, but no bulk action: the
                conflict UI proper (FR-9) is a later milestone, and "stage all"
                over a half-resolved merge is not a shortcut worth offering. */}
            <Group label={t('group.conflicted')} area="conflicted" entries={conflicted} t={t} busy={busy || pending} collapsed={collapsedGroups.has('conflicted')} onToggle={() => toggleGroup('conflicted')} onStage={stage} onUnstage={unstage} onOpen={openDiff} />
            <Group
              label={t('group.unstaged')}
              area="unstaged"
              entries={unstaged}
              t={t}
              busy={busy || pending}
              batch={{ kind: 'stage', run: () => stage(unstaged.map((entry) => entry.path)) }}
              collapsed={collapsedGroups.has('unstaged')}
              onToggle={() => toggleGroup('unstaged')}
              onStage={stage}
              onUnstage={unstage}
              onOpen={openDiff}
            />
            <Group
              label={t('group.untracked')}
              area="untracked"
              entries={untracked}
              t={t}
              busy={busy || pending}
              batch={{ kind: 'stage', run: () => stage(untracked.map((entry) => entry.path)) }}
              collapsed={collapsedGroups.has('untracked')}
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
