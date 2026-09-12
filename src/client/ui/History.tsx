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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'

import { buildGraph } from '../../core/commit-graph.ts'
import type { GraphRow } from '../../core/commit-graph.ts'
import { relativeTimeParts } from '../../core/format.ts'
import type { GitRemoteClient, Result } from '../../core/ports.ts'
import type { CommitDetail, CommitInfo } from '../../core/types.ts'
import { cls } from './styles.ts'
import { useRepoChange } from './repo-change.tsx'
import type { Translate } from './translate.ts'
import { CloseGlyph, DotGlyph, RingGlyph } from './icons.tsx'

/** Rows per page: FR-3.7's default, and what "load more" appends. */
const LOG_PAGE_SIZE = 30

/** The host's own ceiling on one log read, mirrored so a refresh asks for no more. */
const MAX_LOG_ROWS = 500

/**
 * How often the relative times are recomputed while the history is showing.
 *
 * The column's smallest unit is a minute, so half a minute is enough for "just
 * now" to become "1 minute ago" without a user noticing the moment it changed.
 * This is a clock, not a read: it costs no git process, which is the whole
 * difference between it and the polling the panel refuses to do.
 */
const CLOCK_TICK_MS = 30_000

/** Horizontal pitch of one graph lane, and the node's radius, in pixels. */
const GRAPH_LANE_W = 10
const GRAPH_NODE_R = 2.8

/**
 * The most lanes the strip will reserve width for.
 *
 * A pathological history (a many-parent octopus merge) should not push the
 * commit messages off the pane, so the column stops growing here and any lane
 * past it is simply clipped. Real histories stay well under it.
 */
const GRAPH_MAX_LANES = 8

/**
 * The ink each lane draws with, cycled by lane number.
 *
 * The GUI's token set has no chart palette, so these borrow the semantic colour
 * aliases — the same colours the state badges and markers use. A lane keeps its
 * lane number for as long as its line runs, so its colour is stable across rows;
 * when a freed lane is reused it may take the same colour as the line before it.
 * (Deliberately not red: an error-red line would read as a warning about the
 * commit it passes.)
 */
const GRAPH_INK = [
  'var(--dsw-alias-brand-primary)',
  'var(--dsw-alias-state-business-primary)',
  'var(--dsw-alias-state-success-primary)',
  'var(--dsw-alias-state-warn-primary)',
  'var(--dsw-alias-label-secondary)',
] as const

/** The ink for one lane. */
function graphInk(lane: number): string {
  return GRAPH_INK[lane % GRAPH_INK.length] ?? GRAPH_INK[0]
}

/** The x centre of one lane inside the strip. */
function laneX(lane: number): number {
  return lane * GRAPH_LANE_W + GRAPH_LANE_W / 2
}

/**
 * One row's slice of the swimlane diagram (FR-7.1).
 *
 * Drawn as SVG lines with percentage y-coordinates rather than a viewBox: the
 * row's height is whatever its text needs, and a percentage lets a segment reach
 * from the row's top edge to its middle without the component having to measure
 * anything. `from` arrives at the node, `to` leaves it, and `edges` are the
 * parent links that cross into another lane.
 * @param props - The row's lane arithmetic and the strip's shared width.
 */
function GraphCell({ row, width }: { readonly row: GraphRow; readonly width: number }): ReactNode {
  return (
    <span className={cls.commitGraph} style={{ width }}>
      <svg width="100%" height="100%" aria-hidden="true" focusable="false">
        {row.from.map((lane) => (
          <line
            key={`from-${lane}`}
            x1={laneX(lane)}
            y1="0%"
            x2={laneX(lane)}
            y2="50%"
            stroke={graphInk(lane)}
            strokeWidth="1.4"
          />
        ))}
        {/* A lane gets a lower-half vertical only when a line was already there
            (it passes through) or it is the node's own lane going straight on.
            A lane the merge OPENS is reached by its diagonal alone: drawing a
            vertical there as well (it is in `to`) puts a stub from mid-row down
            beside the diagonal, which reads as a third, phantom lane. */}
        {row.to
          .filter((lane) => lane === row.lane || row.from.includes(lane))
          .map((lane) => (
            <line
              key={`to-${lane}`}
              x1={laneX(lane)}
              y1="50%"
              x2={laneX(lane)}
              y2="100%"
              stroke={graphInk(lane)}
              strokeWidth="1.4"
            />
          ))}
        {row.edges.map((edge) => (
          <line
            key={`edge-${edge.from}-${edge.to}`}
            x1={laneX(edge.from)}
            y1="50%"
            x2={laneX(edge.to)}
            y2="100%"
            stroke={graphInk(edge.to)}
            strokeWidth="1.4"
          />
        ))}
        <circle cx={laneX(row.lane)} cy="50%" r={GRAPH_NODE_R} fill={graphInk(row.lane)} />
      </svg>
    </span>
  )
}

/**
 * One file inside a commit (FR-3.6), and the way into its diff (FR-7.2).
 *
 * The row is a real `<button>`: clicking it opens this file as the commit
 * changed it. It stays a row rather than growing a button of its own, for the
 * same reason a commit row does — the hot zone and the hover band have to be the
 * same rectangle.
 *
 * The counts are `null` for a binary file rather than zero — git declined to
 * count it, and a row reading `+0 −0` would claim it changed nothing.
 * @param props - The file's churn, the panel's copy, and where a click goes.
 */
function CommitFileRow({
  file,
  t,
  onOpen,
}: {
  readonly file: CommitDetail['files'][number]
  readonly t: Translate
  /** Open this file's diff for the commit the column is about (FR-7.2). */
  readonly onOpen: () => void
}): ReactNode {
  return (
    <button
      type="button"
      className={cls.commitFile}
      data-commit-file={file.path}
      title={file.path}
      aria-label={t('history.openFile', { path: file.path })}
      onClick={onOpen}
    >
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
    </button>
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
  onOpenFile,
}: {
  readonly commit: CommitInfo
  /** The commit's detail, or `null` while it is still being read. */
  readonly detail: Result<CommitDetail> | null
  readonly t: Translate
  readonly locale: string
  readonly onClose: () => void
  /** Open one listed file as this commit changed it (FR-7.2). */
  readonly onOpenFile: (path: string) => void
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
            <CommitFileRow key={file.path} file={file} t={t} onOpen={() => onOpenFile(file.path)} />
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
  graph,
  graphWidth,
  now,
  t,
  locale,
  selected,
  onSelect,
  onMenu,
}: {
  readonly commit: CommitInfo
  /** This commit's slice of the swimlane diagram (FR-7.1). */
  readonly graph: GraphRow
  /** The graph strip's width, shared by every row so the text stays aligned. */
  readonly graphWidth: number
  readonly now: number
  readonly t: Translate
  readonly locale: string
  /** Whether this commit is the one showing in the detail column. */
  readonly selected: boolean
  readonly onSelect: () => void
  /**
   * Open the row's menu, anchored on the row element (§9's commit menu).
   *
   * Every row carries the copying entries, and the panel above decides whether
   * this particular row may also undo. Absent only when nothing above owns a
   * menu, in which case the row leaves the native context menu alone.
   */
  readonly onMenu?: (anchor: HTMLElement) => void
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
        onContextMenu={
          onMenu === undefined
            ? undefined
            : (event) => {
                event.preventDefault()
                onMenu(event.currentTarget)
              }
        }
        onKeyDown={
          onMenu === undefined
            ? undefined
            : (event) => {
                // Shift+F10 is what a keyboard without a menu key sends.
                if (event.key !== 'ContextMenu' && !(event.key === 'F10' && event.shiftKey)) return
                event.preventDefault()
                onMenu(event.currentTarget)
              }
        }
      >
        <GraphCell row={graph} width={graphWidth} />
        <span className={cls.commitLines}>
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
  /**
   * Open a commit row's menu (§9's commit menu).
   *
   * The menu itself — its layer, its entries, its armed confirmation — belongs
   * to the panel, which owns the action feedback this operation reports through;
   * this panel only decides WHICH rows may undo: the newest commit, because
   * FR-3.8 undoes exactly that one. It says so with `canUndo` rather than by
   * withholding the menu, because the copying entries are on every row.
   */
  readonly onCommitMenu?: (commit: CommitInfo, anchor: HTMLElement, canUndo: boolean) => void
  /**
   * Open one file of the selected commit as that commit changed it (FR-7.2).
   *
   * The panel above receives it because opening a diff is the bottom pane's
   * business — it owns the diff tab and the rail layers that have to close when
   * a file is opened from down here.
   */
  readonly onOpenCommitFile: (commit: CommitInfo, path: string) => void
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
  onCommitMenu,
  onOpenCommitFile,
}: HistoryPanelProps): ReactNode {
  const [commits, setCommits] = useState<readonly CommitInfo[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [busy, setBusy] = useState(false)
  const [loaded, setLoaded] = useState(false)
  /**
   * The clock the rows' relative times are measured against.
   *
   * It has to move. It was captured once when this pane mounted, which made
   * every commit newer than the pane's own age look like it came from the
   * future — a commit made while the panel was open rendered as "in 1 minute" —
   * and froze every other row's age for as long as the pane stayed open.
   */
  const [now, setNow] = useState(() => Date.now())
  /** The selected commit, by object id: the one the detail column is about. */
  const [openOid, setOpenOid] = useState<string | null>(null)
  /** Details already read, by object id, so reselecting costs no process. */
  const [details, setDetails] = useState<ReadonlyMap<string, Result<CommitDetail>>>(new Map())
  /**
   * How many rows are on screen, so a refresh keeps that width.
   *
   * A refresh that always re-read one page would throw away the pages a user
   * loaded, and one that kept the old rows would leave the list permanently the
   * wrong length. It is a ref because the reads above already hold the rows, and
   * a second copy in state would be a second thing to keep in step.
   */
  const held = useRef(0)
  /** The change count this list was read at; a different one means it is stale. */
  const [readAt, setReadAt] = useState<number | null>(null)
  /**
   * History changes, which is a narrower thing than "the repository changed":
   * a commit, a fetch, a rebase or a reset moves a ref, while an agent editing a
   * file does not. Subscribing to that one kind is what keeps a write from
   * costing a `git log`.
   */
  const refsChanged = useRepoChange('refs')

  const append = useCallback(
    async (offset: number) => {
      setBusy(true)
      const page = await git.log(sessionId, offset, LOG_PAGE_SIZE, signal)
      setBusy(false)
      if (!page.ok) return
      // A row read just now must say "now", not whatever the clock said when the
      // pane mounted.
      setNow(Date.now())
      setCommits((current) => {
        const next = offset === 0 ? page.value.commits : [...current, ...page.value.commits]
        held.current = next.length
        return next
      })
      setHasMore(page.value.hasMore)
      setLoaded(true)
    },
    [git, sessionId, signal],
  )

  /** Re-read what is on screen — as many rows as are on screen, not just one page. */
  const refresh = useCallback(async () => {
    const limit = Math.min(Math.max(held.current, LOG_PAGE_SIZE), MAX_LOG_ROWS)
    setBusy(true)
    const page = await git.log(sessionId, 0, limit, signal)
    setBusy(false)
    if (!page.ok) return
    setNow(Date.now())
    setCommits(page.value.commits)
    held.current = page.value.commits.length
    setHasMore(page.value.hasMore)
    setLoaded(true)
  }, [git, sessionId, signal])

  // The list follows the repository for as long as its tab is showing. A commit
  // made by the agent, a fetch, or this panel's own commit all arrive here as a
  // ref change; the FIRST read is the mount, and only a later one is "the
  // history moved under you".
  useEffect(() => {
    if (!active) return
    if (readAt === refsChanged) return
    setReadAt(refsChanged)
    void (loaded ? refresh() : append(0))
  }, [active, loaded, readAt, refsChanged, append, refresh])

  // The clock behind those ages: reset on becoming visible, then tick while the
  // tab is on screen. A folded pane does not need to know what time it is.
  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), CLOCK_TICK_MS)
    return () => clearInterval(timer)
  }, [active])

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
  /** FR-3.8 undoes the NEWEST commit, so only that row carries a menu. */
  const newestOid = commits[0]?.oid
  /**
   * The swimlane diagram over the WHOLE loaded list (FR-7.1).
   *
   * Building it here rather than per page is what makes pagination continuous:
   * the assignment for a row depends only on the rows above it, so appending a
   * page extends the diagram instead of redrawing it.
   */
  const graph = useMemo(() => buildGraph(commits), [commits])
  /**
   * The strip's width — one number for every row.
   *
   * It is the widest lane any row needs, not each row's own width: a merge that
   * opens a lane must not shift the hash beside it, and the row above it that
   * does not use that lane still draws at the same x positions.
   */
  const graphWidth = useMemo(() => {
    const widest = graph.reduce((lanes, row) => Math.max(lanes, row.lanes), 0)
    return Math.min(Math.max(widest, 1), GRAPH_MAX_LANES) * GRAPH_LANE_W
  }, [graph])

  return (
    // The list is the first child and the detail the second, which is what makes
    // "entries on the left, information on the right" a property of the markup
    // rather than of a style rule the tests would have to guess at.
    <div className={cls.historySplit} data-split={String(selected !== null)}>
      <div className={cls.historyList}>
        {loaded && commits.length === 0 && <p className={cls.note}>{t('history.empty')}</p>}
        {commits.map((commit, index) => {
          const row = graph[index]
          if (row === undefined) return null
          return (
            <CommitRow
              key={commit.oid}
              commit={commit}
              graph={row}
              graphWidth={graphWidth}
              now={now}
              t={t}
              locale={locale}
              selected={commit.oid === openOid}
              onSelect={() => select(commit.oid)}
              onMenu={
                onCommitMenu === undefined
                  ? undefined
                  : (anchor) => onCommitMenu(commit, anchor, commit.oid === newestOid)
              }
            />
          )
        })}
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
          onOpenFile={(path) => onOpenCommitFile(selected, path)}
        />
      )}
    </div>
  )
}
