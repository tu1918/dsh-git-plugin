/**
 * The recent-commits panel: the rows, and the reading that produces them.
 *
 * It is the content of one tab of the bottom pane (the other is the diff), so it
 * has no header and no height of its own: activating its tab is what mounts it
 * with `active`, and the pane around it owns the scrolling edge and the grip.
 *
 * The load is lazy for the reason §4.4 gives: a git call is a process, and the
 * panel's job at rest is the uncommitted change list. Nothing is read until the
 * tab is actually shown, which is also why `active` rather than `mounted`
 * triggers the first page.
 *
 * @module dsh-git-panel/client/ui/History
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

import { relativeTimeParts } from '../../core/format.ts'
import type { GitRemoteClient } from '../../core/ports.ts'
import type { CommitInfo } from '../../core/types.ts'
import { cls } from './styles.ts'
import type { Translate } from './translate.ts'
import { DotGlyph, RingGlyph } from './icons.tsx'

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
 * The commit list, paged with the host's look-ahead.
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

  return (
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
  )
}
