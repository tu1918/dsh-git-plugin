/**
 * The recent-commits panel: the list, the detail of the selected commit, and the
 * reading that produces them (FR-3.6).
 *
 * It is the content of one tab of the bottom pane (the other is the diff), so it
 * has no header and no height of its own: activating its tab is what mounts it
 * with `active`, and the pane around it owns the grip.
 *
 * ## Why the detail is a column, not an expansion
 *
 * Clicking a commit splits the panel in two: the entries stay on the left and the
 * selected commit's information opens on the right. Expanding the detail under
 * the row was the first shape, and it has two costs that only show up once a
 * commit has more than a couple of files: the list jumps (the row you clicked
 * moves down by the height of the detail) and the detail pushes the rest of the
 * history off screen. A side-by-side split keeps both in place, and it is what
 * the comparable sidebar's commit view does with the pane at its bottom.
 *
 * The DETAIL is read lazily — one commit at a time, on the click that selects it,
 * because `git show --numstat` is another process and most commits are never
 * opened. Each one is remembered, so switching back and forth costs nothing.
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
import { CloseGlyph, DotGlyph, RingGlyph } from './icons.tsx'

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
 * The right half: everything the panel knows about the selected commit.
 *
 * It names its commit in its own header — hash and subject — because the row
 * that was clicked is in the other column and can be scrolled out of sight.
 * @param props - The commit, its detail, and the way back to the full-width list.
 */
function CommitDetailPane({
  commit,
  detail,
  t,
  locale,
  onClose,
}: {
  readonly commit: CommitInfo
  /** The commit's detail, or `null` while it is still being read. */
  readonly detail: Result<CommitDetail> | null
  readonly t: Translate
  readonly locale: string
  readonly onClose: () => void
}): ReactNode {
  const date = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }),
    [locale],
  )

  return (
    <section
      className={cls.historyDetail}
      data-commit-detail={commit.shortOid}
      aria-label={t('history.detail', { hash: commit.shortOid })}
    >
      <div className={cls.historyDetailHead}>
        <span className={cls.commitHash}>{commit.shortOid}</span>
        <span className={cls.commitSubject} title={commit.subject}>
          {commit.subject === '' ? '—' : commit.subject}
        </span>
        <button
          type="button"
          className={cls.tool}
          title={t('history.close')}
          aria-label={t('history.close')}
          onClick={onClose}
        >
          <CloseGlyph />
        </button>
      </div>
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
          <p className={cls.commitFilesHead}>{t('history.files', { count: detail.value.files.length })}</p>
          {detail.value.files.length === 0 && <p className={cls.note}>{t('history.noFiles')}</p>}
          {detail.value.files.map((file) => (
            <CommitFileRow key={file.path} file={file} t={t} />
          ))}
        </>
      )}
    </section>
  )
}

/**
 * One commit row: the handle for this commit.
 *
 * The row IS a real `<button>` — both of its lines — because a commit is
 * something the panel will do things TO (M5 adds drop/squash/reset, and FR-3.8's
 * undo already names the newest commit). A real button brings focus, Enter/Space
 * activation and a future disabled state with it, and it is also what makes the
 * clickable area exactly the hover band: a highlight that covered the caption
 * while only the title answered a click would be lying about where the click
 * lands. Consequence for that action strip: it has to be a SIBLING of this
 * button, never a child.
 */
function CommitRow({
  commit,
  now,
  t,
  locale,
  selected,
  onSelect,
}: {
  readonly commit: CommitInfo
  readonly now: number
  readonly t: Translate
  readonly locale: string
  /** Whether this commit is the one showing in the detail column. */
  readonly selected: boolean
  readonly onSelect: () => void
}): ReactNode {
  const age = relativeTimeParts(commit.committedAt, now)
  const format = useMemo(() => new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }), [locale])
  const relative = format.format(age.value, age.unit)

  return (
    // The row carries the commit's full object id, because per-commit operations
    // (M5's drop/squash/reset) address a commit by that id. The short hash is what
    // is shown.
    <div className={cls.commit} data-commit={commit.oid}>
      <button
        type="button"
        className={cls.commitRow}
        data-selected={String(selected)}
        aria-expanded={selected}
        aria-label={t('history.open', { hash: commit.shortOid })}
        title={commit.subject}
        onClick={onSelect}
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
 * The commit list, paged with the host's look-ahead, and the selected commit's
 * detail beside it.
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
  /** The selected commit, by object id: the one the detail column is about. */
  const [openOid, setOpenOid] = useState<string | null>(null)
  /** Details already read, by object id, so reselecting costs no process. */
  const [details, setDetails] = useState<ReadonlyMap<string, Result<CommitDetail>>>(new Map())

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

  const select = useCallback(
    (oid: string) => {
      // Clicking the selected row again closes the column: with only two states,
      // one gesture has to do both, and the detail's own close button is there
      // for anyone who expects it to be the only way.
      setOpenOid((current) => (current === oid ? null : oid))
      if (details.has(oid)) return
      void (async () => {
        const detail = await git.showCommit(sessionId, oid, signal)
        setDetails((current) => new Map(current).set(oid, detail))
      })()
    },
    [details, git, sessionId, signal],
  )

  const selected = commits.find((commit) => commit.oid === openOid) ?? null

  return (
    // The list is the first child and the detail the second, which is what makes
    // "entries on the left, information on the right" a property of the markup
    // rather than of a style rule the tests would have to guess at.
    <div className={cls.historySplit} data-split={String(selected !== null)}>
      <div className={cls.historyList}>
        {loaded && commits.length === 0 && <p className={cls.note}>{t('history.empty')}</p>}
        {commits.map((commit) => (
          <CommitRow
            key={commit.oid}
            commit={commit}
            now={now}
            t={t}
            locale={locale}
            selected={commit.oid === openOid}
            onSelect={() => select(commit.oid)}
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
      </div>
      {selected !== null && (
        <CommitDetailPane
          commit={selected}
          detail={details.get(selected.oid) ?? null}
          t={t}
          locale={locale}
          onClose={() => setOpenOid(null)}
        />
      )}
    </div>
  )
}
