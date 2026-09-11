/**
 * The panel itself: pure React over {@link ClientPorts}-shaped props.
 *
 * This module imports nothing from DSH — not a type, not a service, not a URL.
 * Everything it needs arrives as props: the session to describe, the host-facing
 * git client, a translator, and the tab's abort signal. The DSH-shaped wrapper
 * that supplies those lives in `client/adapter/tab-body.tsx`, which is what keeps
 * this component renderable, and reviewable, without a host.
 *
 * @module dsh-git-panel/client/ui/StatusPanel
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

import { lineCount, pathParts, relativeTimeParts } from '../../core/format.ts'
import type { GitPanelError, GitRemoteClient } from '../../core/ports.ts'
import type {
  BranchInfo,
  BranchRef,
  ChangeArea,
  CommitInfo,
  FileChange,
  RepoStatus,
} from '../../core/types.ts'
import { badgeFor } from '../../core/git-parse.ts'
import type { GitPanelKey } from '../locales.ts'
import { cls } from './styles.ts'
import {
  ArrowDownGlyph,
  ArrowUpGlyph,
  BranchGlyph,
  CaretGlyph,
  DotGlyph,
  RefreshGlyph,
  RingGlyph,
} from './icons.tsx'

/** The panel's translator: one key in, one string out. */
export type Translate = (
  key: GitPanelKey,
  vars?: Readonly<Record<string, string | number>>,
) => string

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

/**
 * Render one git failure in the panel's voice.
 * @param t - Translator.
 * @param error - The failure to explain.
 */
function errorCopy(t: Translate, error: GitPanelError): { title: string; detail: string | undefined } {
  switch (error.code) {
    case 'not-a-repo':
      return { title: t('noRepo.title'), detail: t('noRepo.hint') }
    case 'no-session':
      return { title: t('error.noSession'), detail: undefined }
    case 'git-missing':
      return { title: t('error.gitMissing'), detail: undefined }
    case 'timeout':
      return { title: t('error.timeout'), detail: undefined }
    case 'too-large':
      return { title: t('error.tooLarge'), detail: undefined }
    case 'bad-request':
      return { title: t('error.badRequest'), detail: undefined }
    default:
      // git's own words, verbatim and with their newlines: FR-4.4.
      return { title: t('error.generic', { message: error.message }), detail: error.detail }
  }
}

/**
 * Read the repository, then keep the reading fresh.
 *
 * One read happens per session and per explicit refresh; change notifications
 * only schedule another read, coalesced, so a burst of git commands from an
 * agent produces one refresh rather than one per file (§4.4, FR-1.4).
 * @param props - The panel's props.
 * @returns The latest snapshot for this session, or `null` while the first read is in flight.
 */
function useRepoSnapshot(
  sessionId: string,
  git: GitRemoteClient,
  tabSignal: AbortSignal | undefined,
): { snapshot: Snapshot | null; reload: () => void; busy: boolean } {
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
  return { snapshot: snapshot?.sessionId === sessionId ? snapshot : null, reload, busy }
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
 * The state rail: which branch, and how it stands against its upstream.
 *
 * `↑n`/`↓m` appear only when they are non-zero, so a settled repository shows a
 * quiet rail instead of "↑0 ↓0" — the counts are a signal, and a signal that is
 * always on is noise.
 */
function BranchRail({
  branch,
  upstreamGone,
  t,
  onRefresh,
  busy,
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
      <ToolButton label={t('action.refresh')} onClick={onRefresh}>
        {busy ? <span className={cls.spinner} /> : <RefreshGlyph />}
      </ToolButton>
    </div>
  )
}

/** One changed file, with the badge its group gives it. */
function ChangeRow({
  entry,
  area,
  t,
}: {
  readonly entry: FileChange
  readonly area: ChangeArea
  readonly t: Translate
}): ReactNode {
  const { directory, name } = pathParts(entry.path)
  const badge = badgeFor(entry, area)
  // A rename is the one case where the row cannot stand alone: the new path is
  // only half the story, so the original joins the tooltip.
  const tooltip =
    entry.origPath === undefined ? entry.path : `${entry.origPath} → ${entry.path}`

  return (
    <div className={cls.row} title={tooltip}>
      <span className={cls.badge} data-status={badge}>
        {badge}
      </span>
      <span className={cls.path}>
        {directory !== '' && <span className={cls.pathDir}>{directory}</span>}
        <span className={cls.pathName}>{name}</span>
      </span>
    </div>
  )
}

/** One group of changes, with its count. */
function Group({
  label,
  area,
  entries,
  t,
}: {
  readonly label: string
  readonly area: ChangeArea
  readonly entries: readonly FileChange[]
  readonly t: Translate
}): ReactNode {
  if (entries.length === 0) return null
  return (
    <section className={cls.group} data-group={area}>
      <div className={cls.groupHead}>
        <span className={cls.groupLabel}>{label}</span>
        <span className={cls.count}>{entries.length}</span>
      </div>
      {entries.map((entry) => (
        <ChangeRow key={`${area}:${entry.path}`} entry={entry} area={area} t={t} />
      ))}
    </section>
  )
}

/** One commit row. */
function CommitRow({
  commit,
  now,
  t,
  locale,
}: {
  readonly commit: CommitInfo
  readonly now: number
  readonly t: Translate
  readonly locale: string
}): ReactNode {
  const age = relativeTimeParts(commit.committedAt, now)
  const format = useMemo(() => new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }), [locale])
  const relative = format.format(age.value, age.unit)

  return (
    <div className={cls.commit}>
      <div className={cls.commitTop}>
        <span className={cls.commitHash}>{commit.shortOid}</span>
        <span className={cls.commitSubject} title={commit.subject}>
          {commit.subject === '' ? '—' : commit.subject}
        </span>
      </div>
      <div className={cls.commitMeta}>
        <span>{relative}</span>
        <span>·</span>
        <span>{commit.authorName}</span>
        {commit.pushed !== null && (
          <span
            className={cls.marker}
            data-pushed={commit.pushed}
            title={commit.pushed ? t('history.pushed') : t('history.unpushed')}
          >
            {commit.pushed ? <DotGlyph /> : <RingGlyph />}
          </span>
        )}
      </div>
    </div>
  )
}

/**
 * The history section, collapsed until asked for.
 *
 * Collapsed by default on purpose: reading history costs a git process, and the
 * panel's job at rest is the uncommitted change list.
 */
function History({
  sessionId,
  git,
  t,
  locale,
  signal,
}: {
  readonly sessionId: string
  readonly git: GitRemoteClient
  readonly t: Translate
  readonly locale: string
  readonly signal?: AbortSignal
}): ReactNode {
  const [open, setOpen] = useState(false)
  const [commits, setCommits] = useState<readonly CommitInfo[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [busy, setBusy] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [now] = useState(() => Date.now())

  const append = useCallback(
    async (offset: number) => {
      setBusy(true)
      const page = await git.log(sessionId, offset, 30, signal)
      setBusy(false)
      if (!page.ok) return
      setCommits((current) => (offset === 0 ? page.value.commits : [...current, ...page.value.commits]))
      setHasMore(page.value.hasMore)
      setLoaded(true)
    },
    [git, sessionId, signal],
  )

  useEffect(() => {
    if (!open || loaded) return
    void append(0)
  }, [open, loaded, append])

  return (
    <div className={cls.history}>
      <button
        type="button"
        className={cls.historyHead}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <CaretGlyph className={cls.historyCaret} data-open={String(open)} />
        {t('history.title')}
      </button>
      {open && (
        <>
          {loaded && commits.length === 0 && <p className={cls.note}>{t('history.empty')}</p>}
          {commits.map((commit) => (
            <CommitRow key={commit.oid} commit={commit} now={now} t={t} locale={locale} />
          ))}
          {hasMore && (
            <p className={cls.note}>
              <button
                type="button"
                className={cls.ghost}
                disabled={busy}
                onClick={() => void append(commits.length)}
              >
                {t('history.loadMore')}
              </button>
            </p>
          )}
        </>
      )}
    </div>
  )
}

/**
 * The git panel.
 * @param props - Session, git client, copy, and the tab's abort signal.
 */
export function StatusPanel({ sessionId, git, t, locale, signal }: StatusPanelProps): ReactNode {
  const { snapshot, reload, busy } = useRepoSnapshot(sessionId, git, signal)

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
    const { title, detail } = errorCopy(t, snapshot.error)
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
  // The branch listing is the only source that distinguishes a gone upstream
  // from a branch that simply has no counts.
  const upstreamGone = branches.find((branch) => branch.current)?.upstreamGone ?? false
  const clean =
    staged.length === 0 &&
    unstaged.length === 0 &&
    untracked.length === 0 &&
    conflicted.length === 0

  return (
    <div className={cls.root} data-git-panel="ready" data-repo={status.root}>
      <BranchRail
        branch={status.branch}
        upstreamGone={upstreamGone}
        t={t}
        onRefresh={reload}
        busy={busy}
      />
      <div className={cls.body}>
        {clean ? (
          <div className={cls.status} data-git-panel-state="clean">
            <p className={cls.statusTitle}>{t('clean.title')}</p>
            <p className={cls.statusHint}>{t('clean.hint')}</p>
          </div>
        ) : (
          <>
            <Group label={t('group.conflicted')} area="conflicted" entries={conflicted} t={t} />
            <Group label={t('group.staged')} area="staged" entries={staged} t={t} />
            <Group label={t('group.unstaged')} area="unstaged" entries={unstaged} t={t} />
            <Group label={t('group.untracked')} area="untracked" entries={untracked} t={t} />
            {status.truncated && <p className={cls.note}>{t('state.truncated')}</p>}
          </>
        )}
        <History sessionId={sessionId} git={git} t={t} locale={locale} signal={signal} />
      </div>
    </div>
  )
}
