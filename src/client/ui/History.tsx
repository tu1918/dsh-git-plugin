/**
 * The recent-commits panel: the rows, the detail they open, and the reading that
 * produces them (FR-3.6).
 *
 * It is the content of one tab of the bottom pane (the other is the diff), so it
 * has no header and no height of its own: activating its tab is what mounts it
 * with `active`, and the pane around it owns the scrolling edge and the grip.
 *
 * The load is lazy for the reason §4.4 gives: a git call is a process, and the
 * panel's job at rest is the uncommitted change list. Nothing is read until the
 * tab is actually shown, which is also why `active` rather than `mounted`
 * triggers the first page. The DETAIL is lazier still — one row at a time, on
 * the click that opens it, because `git show --numstat` is another process and
 * most rows are never opened.
 *
 * @module dsh-git-panel/client/ui/History
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

import { relativeTimeParts } from '../../core/format.ts'
import type { GitRemoteClient, Result } from '../../core/ports.ts'
import type { CommitDetail, CommitInfo } from '../../core/types.ts'
import { cls } from './styles.ts'
import type { Translate } from './translate.ts'
import { DotGlyph, RingGlyph } from './icons.tsx'

/**
 * One file inside a commit (FR-3.6).
 *
 * The counts are `null` for a binary file rather than zero — git declined to
 * count it, and a row reading `+0 −0` would claim it changed nothing.
 * @param props - The file's churn and the panel's copy.
 */
function CommitFileRow({
  file,
  t,
}: {
  readonly file: CommitDetail['files'][number]
  readonly t: Translate
}): ReactNode {
  return (
    <div className={cls.commitFile} title={file.path}>
      <span className={cls.commitFilePath}>
        <span className={cls.pathName}>{file.path}</span>
      </span>
      {file.binary ? (
        <span className={cls.note}>{t('history.binary')}</span>
      ) : (
        <span className={cls.commitFileStat}>
          <span className={cls.diffAdded}>+{file.additions ?? 0}</span>
          <span className={cls.diffRemoved}>−{file.deletions ?? 0}</span>
        </span>
      )}
    </div>
  )
}

/**
 * One commit row: the handle for this commit, its metadata, and the detail it
 * can expand into.
 *
 * The row's entry is a real `<button>` because a commit is something the panel
 * will do things TO — M5 adds drop/squash/reset, and FR-3.8's undo already names
 * the newest commit. A button is what that handle has to be: focusable,
 * Enter/Space-activatable, and `aria-expanded`-able without a hand-rolled
 * keyboard handler that can drift from the mouse one.
 */
function CommitRow({
  commit,
  detail,
  now,
  t,
  locale,
  busy,
  open,
  onToggle,
}: {
  readonly commit: CommitInfo
  /** The row's detail, or `null` while it has not been read (or failed). */
  readonly detail: Result<CommitDetail> | null
  readonly now: number
  readonly t: Translate
  readonly locale: string
  /** True while this row's detail is being read. */
  readonly busy: boolean
  readonly open: boolean
  readonly onToggle: () => void
}): ReactNode {
  const age = relativeTimeParts(commit.committedAt, now)
  const format = useMemo(() => new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }), [locale])
  const date = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }),
    [locale],
  )
  const relative = format.format(age.value, age.unit)

  return (
    // The row carries the commit's full object id, because per-commit operations
    // (M5's drop/squash/reset) address a commit by that id and the DOM is where a
    // future action strip will read it from. The short hash stays what is shown.
    <div className={cls.commit} data-open={String(open)} data-commit={commit.oid}>
      {/* The row IS the button, and it holds both of its lines.
          That is the whole point: the hot zone has to be what the hover band
          covers, or the band lies about where a click lands. The comparable
          sidebar's commit rows have the same reach (they are a div wearing
          `role="button"`, which is the same shape with worse semantics); ours is
          a real `<button>`, so focus, Enter/Space and a future disabled state
          come from the element rather than from a hand-rolled key handler.
          Consequence to keep in mind for the action strip recorded in
          docs/plan.md: it has to be a SIBLING of this button, never a child —
          a button inside a button is invalid markup, and the inner one is not
          reliably clickable (the same rule the change group's header follows).
          That is also why the reference implementation keeps its per-commit
          operations in a row-level context menu. */}
      <button
        type="button"
        className={cls.commitRow}
        data-selected={String(open)}
        aria-expanded={open}
        aria-label={t('history.open', { hash: commit.shortOid })}
        title={commit.subject}
        onClick={onToggle}
      >
        <span className={cls.commitTop}>
          <span className={cls.commitHash}>{commit.shortOid}</span>
          <span className={cls.commitSubject}>{commit.subject === '' ? '—' : commit.subject}</span>
        </span>
        <span className={cls.commitMeta} data-commit-meta="true">
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
        </span>
      </button>
      {open && (
        <div className={cls.commitDetail} data-commit-detail={commit.shortOid}>
          {detail === null && <p className={cls.note}>{t('history.loading')}</p>}
          {detail !== null && !detail.ok && (
            <p className={cls.note} data-multiline={String((detail.error.detail ?? '').includes('\n'))}>
              {detail.error.message}
            </p>
          )}
          {detail !== null && detail.ok && (
            <>
              <dl className={cls.commitFields}>
                <dt>{t('history.author')}</dt>
                <dd>{detail.value.commit.authorName}</dd>
                <dt>{t('history.authoredAt')}</dt>
                <dd>{date.format(new Date(detail.value.commit.authoredAt))}</dd>
                <dt>{t('history.committedAt')}</dt>
                <dd>{date.format(new Date(detail.value.commit.committedAt))}</dd>
                {detail.value.commit.parents.length > 0 && (
                  <>
                    <dt>{t('history.parents')}</dt>
                    <dd className={cls.commitHash}>
                      {detail.value.commit.parents.map((parent) => parent.slice(0, 7)).join(' ')}
                    </dd>
                  </>
                )}
              </dl>
              <p className={cls.commitFilesHead}>
                {t('history.files', { count: detail.value.files.length })}
              </p>
              {detail.value.files.length === 0 && <p className={cls.note}>{t('history.noFiles')}</p>}
              {detail.value.files.map((file) => (
                <CommitFileRow key={file.path} file={file} t={t} />
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}

/** What the commits panel is handed. */
export interface HistoryPanelProps {
  /** The session whose repository is read. */
  readonly sessionId: string
  /** The host-facing git client. */
  readonly git: GitRemoteClient
  /** The panel's copy. */
  readonly t: Translate
  /** BCP-47 tag for relative-time wording. */
  readonly locale: string
  /** Aborted when the tab closes; cancels the read. */
  readonly signal?: AbortSignal
  /** Whether this panel is the one on screen, which is what starts the read. */
  readonly active: boolean
}

/**
 * The commit list, paged with the host's look-ahead, with per-row detail.
 * @param props - Session, client, copy, and whether the tab is showing.
 */
export function HistoryPanel({
  sessionId,
  git,
  t,
  locale,
  signal,
  active,
}: HistoryPanelProps): ReactNode {
  const [commits, setCommits] = useState<readonly CommitInfo[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [busy, setBusy] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [now] = useState(() => Date.now())
  /** The row whose detail is open, by object id. */
  const [openOid, setOpenOid] = useState<string | null>(null)
  /** Details already read, by object id, so reopening costs no process. */
  const [details, setDetails] = useState<ReadonlyMap<string, Result<CommitDetail>>>(new Map())
  /** The row whose detail is being read right now, if any. */
  const [loadingOid, setLoadingOid] = useState<string | null>(null)

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
    if (!active || loaded) return
    void append(0)
  }, [active, loaded, append])

  const toggle = useCallback(
    (oid: string) => {
      setOpenOid((current) => (current === oid ? null : oid))
      if (details.has(oid)) return
      setLoadingOid(oid)
      void (async () => {
        const detail = await git.showCommit(sessionId, oid, signal)
        setLoadingOid((current) => (current === oid ? null : current))
        setDetails((current) => new Map(current).set(oid, detail))
      })()
    },
    [details, git, sessionId, signal],
  )

  return (
    <>
      {loaded && commits.length === 0 && <p className={cls.note}>{t('history.empty')}</p>}
      {commits.map((commit) => (
        <CommitRow
          key={commit.oid}
          commit={commit}
          detail={details.get(commit.oid) ?? null}
          now={now}
          t={t}
          locale={locale}
          busy={loadingOid === commit.oid}
          open={openOid === commit.oid}
          onToggle={() => toggle(commit.oid)}
        />
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
  )
}
