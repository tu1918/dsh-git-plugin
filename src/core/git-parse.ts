/**
 * Pure parsers from `git` plumbing output to the domain model, plus the small
 * derivations the UI needs on top of it.
 *
 * Every function here is pure, takes the raw text `git` produced, and returns
 * model values — no I/O, no clocks, no platform branches. That is what makes the
 * whole module testable in a bare `node --test` process, and it is why the
 * parsers are the file the doc's M0 gate ("解析器测试全绿") is really about.
 *
 * The output formats parsed here are porcelain v2 (`--porcelain=v2 --branch -z`)
 * for status, `for-each-ref --format` for branches, and a `%x00`/`%x1e`
 * delimited `log --format` for history. Each parser is written against `-z`
 * output, where git emits paths raw — no C-style quoting and no truncation — so
 * this module never unescapes a pathname.
 *
 * @module dsh-git-panel/core/git-parse
 */

import type {
  BranchInfo,
  BranchRef,
  ChangeArea,
  CommitInfo,
  FileChange,
  LogPage,
  StatusCode,
  StatusGroups,
} from './types.ts'

/** Every letter porcelain v2 can put in an `XY` pair, in git's own order. */
const STATUS_LETTERS = 'MTADRCUX' as const

/** A record's fixed leading tokens, then the path that ends it. */
interface RecordHead {
  /** The space-separated tokens before the path. */
  readonly tokens: readonly string[]
  /** Everything after the last token: the path, raw and unquoted. */
  readonly rest: string
}

/**
 * Split at most `count` space-separated tokens off the front of a record.
 *
 * A pathname may contain spaces, so a record cannot be split on every space:
 * only its fixed leading fields are. `-z` guarantees the path itself holds no
 * NUL, so the record is one field and `rest` is exactly the pathname.
 * @param field - One NUL-delimited record.
 * @param count - How many tokens precede the path.
 * @returns The tokens and the remaining path, or `null` when the record is short.
 */
function takeHead(field: string, count: number): RecordHead | null {
  const tokens: string[] = []
  let at = 0
  for (let taken = 0; taken < count; taken++) {
    const space = field.indexOf(' ', at)
    if (space === -1) return null
    tokens.push(field.slice(at, space))
    at = space + 1
  }
  return { tokens, rest: field.slice(at) }
}

/**
 * Walk `--porcelain=v2 -z` output as one unit per record.
 *
 * `-z` terminates every record with NUL, so splitting on NUL is what keeps a
 * pathname containing a newline intact. Header lines are the one exception: they
 * are newline-separated inside a single NUL field, so a field that *starts* with
 * `#` is split on newlines and every non-empty line is yielded separately. A
 * record field always starts with `1`/`2`/`u`/`?`/`!`, so no pathname can be
 * mistaken for a header.
 * @param raw - Raw stdout of `git status --porcelain=v2 --branch -z`.
 * @returns One string per header line and per record.
 */
function* statusUnits(raw: string): Generator<string> {
  for (const field of raw.split('\x00')) {
    if (field === '') continue
    if (field.startsWith('#')) {
      for (const line of field.split('\n')) if (line !== '') yield line
      continue
    }
    yield field
  }
}

/**
 * Read one status letter.
 * @param letter - A single character from an `XY` pair.
 * @returns The letter, or `null` when it is not one git emits.
 */
function statusLetter(letter: string): StatusCode | null {
  if (letter === '.') return '.'
  if (letter === '?') return '?'
  return STATUS_LETTERS.includes(letter) ? (letter as StatusCode) : null
}

/**
 * Split an `XY` pair into its index and worktree letters.
 * @param xy - The two-letter status pair.
 * @returns Both letters, or `null` when either is unrecognised.
 */
function parseXY(xy: string): { index: StatusCode; worktree: StatusCode } | null {
  if (xy.length !== 2) return null
  const index = statusLetter(xy[0] as string)
  const worktree = statusLetter(xy[1] as string)
  if (index === null || worktree === null) return null
  return { index, worktree }
}

/**
 * Build one model entry from a parsed status pair.
 * @param path - Repo-relative pathname.
 * @param index - Index-side letter.
 * @param worktree - Worktree-side letter.
 * @param conflicted - Whether the record was an unmerged one.
 * @param origPath - Previous path of a rename or copy.
 * @returns The entry.
 */
function toChange(
  path: string,
  index: StatusCode,
  worktree: StatusCode,
  conflicted: boolean,
  origPath?: string,
): FileChange {
  return {
    path,
    ...(origPath === undefined ? {} : { origPath }),
    index,
    worktree,
    staged: index !== '.' && index !== '?',
    untracked: index === '?',
    conflicted,
  }
}

/** A branch header's fields, as `--branch` reports them. */
interface BranchHeaders {
  oid: string | null
  head: string | null
  detached: boolean
  unborn: boolean
  upstream: string | null
  ahead: number
  behind: number
}

/**
 * Fold the `# branch.*` headers into HEAD's description.
 * @param headers - Header fields, mutated in place as lines arrive.
 * @param line - One header line, without its leading `# `.
 */
function applyBranchHeader(headers: BranchHeaders, line: string): void {
  const space = line.indexOf(' ')
  const key = space === -1 ? line : line.slice(0, space)
  const value = space === -1 ? '' : line.slice(space + 1)
  switch (key) {
    case 'branch.oid':
      // An unborn branch has no object, and git spells that `(initial)`.
      if (value === '(initial)') headers.unborn = true
      else headers.oid = value
      return
    case 'branch.head':
      if (value === '(detached)') headers.detached = true
      else headers.head = value
      return
    case 'branch.upstream':
      headers.upstream = value
      return
    case 'branch.ab': {
      // `+<ahead> -<behind>`; absent entirely when there is no upstream.
      const match = /^\+(\d+)\s+-(\d+)$/.exec(value)
      if (match !== null) {
        headers.ahead = Number(match[1])
        headers.behind = Number(match[2])
      }
      return
    }
    default:
      // `branch.ab` is the only other header git emits; ignore anything new
      // rather than failing a status read over an unrecognised hint.
      return
  }
}

/** What one `git status` read yields before the service adds its own facts. */
export interface ParsedStatus {
  /** HEAD's position and upstream relation. */
  readonly branch: BranchInfo
  /** Every changed path, exactly once. */
  readonly entries: readonly FileChange[]
}

/**
 * Parse `git status --porcelain=v2 --branch -z`.
 *
 * Recognises the four record kinds git emits (ordinary, renamed/copied,
 * unmerged, untracked) and ignores the `!` ignored-path records, which the
 * panel never lists.
 * @param raw - Raw stdout of the command above.
 * @returns HEAD's description and one entry per changed path.
 */
export function parseStatusV2(raw: string): ParsedStatus {
  const headers: BranchHeaders = {
    oid: null,
    head: null,
    detached: false,
    unborn: false,
    upstream: null,
    ahead: 0,
    behind: 0,
  }
  const entries: FileChange[] = []
  // A rename record's previous path is the NEXT unit, so the walker pulls it
  // when it consumes a `2` record rather than treating it as a record itself.
  const units = statusUnits(raw)

  for (let unit = units.next(); !unit.done; unit = units.next()) {
    const field = unit.value

    if (field.startsWith('# ')) {
      applyBranchHeader(headers, field.slice(2))
      continue
    }

    const kind = field[0]
    if (kind === '!') continue // ignored paths are never listed
    if (kind === '?') {
      const path = field.slice(2)
      if (path !== '') entries.push(toChange(path, '?', '.', false))
      continue
    }

    if (kind === '1') {
      const head = takeHead(field, 8)
      if (head === null) continue
      const xy = parseXY(head.tokens[1] as string)
      if (xy === null || head.rest === '') continue
      entries.push(toChange(head.rest, xy.index, xy.worktree, false))
      continue
    }

    if (kind === '2') {
      const head = takeHead(field, 9)
      if (head === null) continue
      const xy = parseXY(head.tokens[1] as string)
      if (xy === null || head.rest === '') continue
      // The rename's original path is the following unit; `-z` makes it a
      // separate NUL-terminated field, which is why it is pulled here.
      const next = units.next()
      const origPath = next.done ? undefined : next.value
      entries.push(toChange(head.rest, xy.index, xy.worktree, false, origPath))
      continue
    }

    if (kind === 'u') {
      const head = takeHead(field, 10)
      if (head === null) continue
      const xy = parseXY(head.tokens[1] as string)
      if (xy === null || head.rest === '') continue
      // An unmerged path is reported once, in its own group, whatever letters
      // its two sides carry (FR-9.1).
      entries.push(toChange(head.rest, xy.index, xy.worktree, true))
      continue
    }
    // Unknown record kinds are new git features, not corrupt input: skipping
    // one shows a slightly short list instead of failing the whole panel.
  }

  const branch: BranchInfo = {
    oid: headers.oid,
    name: headers.unborn || headers.detached ? null : headers.head,
    upstream: headers.upstream,
    ahead: headers.ahead,
    behind: headers.behind,
    head: headers.unborn ? 'unborn' : headers.detached ? 'detached' : 'branch',
  }
  // An unborn repository still knows the branch name it is on; keep it, since
  // the panel shows "main (no commits yet)" rather than a bare detached HEAD.
  if (headers.unborn && headers.head !== null) {
    return { branch: { ...branch, name: headers.head }, entries }
  }
  return { branch, entries }
}

/**
 * Sort entries into the panel's four lists (FR-1.1).
 *
 * Groups are disjoint: an unmerged path appears only under conflicts, and an
 * untracked path only under untracked, even though both also carry an `XY` pair.
 * Within a group the order is git's own, which is already path-sorted.
 * @param entries - Every changed path.
 * @returns The four lists.
 */
export function groupsOf(entries: readonly FileChange[]): StatusGroups {
  const staged: FileChange[] = []
  const unstaged: FileChange[] = []
  const untracked: FileChange[] = []
  const conflicted: FileChange[] = []
  for (const entry of entries) {
    if (entry.conflicted) {
      conflicted.push(entry)
      continue
    }
    if (entry.untracked) {
      untracked.push(entry)
      continue
    }
    if (entry.staged) staged.push(entry)
    if (entry.worktree !== '.') unstaged.push(entry)
  }
  return { staged, unstaged, untracked, conflicted }
}

/**
 * Count distinct changed paths — the number the commit button reports.
 * @param entries - Every changed path.
 * @returns How many paths differ from HEAD, counting each once.
 */
export function changedPathCount(entries: readonly FileChange[]): number {
  const paths = new Set<string>()
  for (const entry of entries) paths.add(entry.path)
  return paths.size
}

/**
 * The status letter a badge shows for one entry in one group.
 *
 * A rename or copy in the worktree column reads `R`, matching what the file row
 * means there; untracked and unmerged paths have their own letters whatever the
 * raw pair said.
 * @param entry - The entry being drawn.
 * @param area - Which group is drawing it.
 * @returns The letter for the badge.
 */
export function badgeFor(entry: FileChange, area: ChangeArea): StatusCode {
  switch (area) {
    case 'untracked':
      return '?'
    case 'conflicted':
      return 'U'
    case 'staged':
      return entry.index === '.' || entry.index === '?' ? 'M' : entry.index
    case 'unstaged':
      return entry.worktree === '.' ? 'M' : entry.worktree
  }
}

/**
 * Parse `git for-each-ref` output for local branches (FR-4.1).
 *
 * The expected format is seven `%00`-separated atoms per line, with `%(HEAD)`
 * FIRST: `HEAD`, `refname:short`, `objectname`, `upstream:short`,
 * `upstream:track`, `committerdate:iso-strict`, and `subject`. Asking git for the
 * `%(HEAD)` marker is what marks the current row without a second process, and it
 * is also the only correct answer when HEAD is detached (every row is a space, so
 * nothing is marked). `upstream:track` is git's `[ahead 1, behind 2]` / `[gone]`
 * spelling, which is the only place those counts appear without a second process.
 * @param raw - Raw stdout of the matching `for-each-ref` call.
 * @returns Local branches, most recently committed first, then by name.
 */
export function parseBranches(raw: string): readonly BranchRef[] {
  const branches: BranchRef[] = []
  for (const line of raw.split('\n')) {
    if (line === '') continue
    const parts = line.split('\x00')
    if (parts.length < 7) continue
    const [head, name, oid, upstream, track, committedAt, subject] = parts as [
      string,
      string,
      string,
      string,
      string,
      string,
      string,
    ]
    if (name === '') continue
    const ab = /ahead (\d+)/.exec(track)
    const be = /behind (\d+)/.exec(track)
    branches.push({
      name,
      current: head === '*',
      oid,
      upstream: upstream === '' ? null : upstream,
      ahead: ab === null ? 0 : Number(ab[1]),
      behind: be === null ? 0 : Number(be[1]),
      upstreamGone: track.includes('gone'),
      committedAt,
      subject,
    })
  }
  branches.sort((left, right) => {
    const byDate = right.committedAt.localeCompare(left.committedAt)
    return byDate !== 0 ? byDate : left.name.localeCompare(right.name)
  })
  return branches
}

/** One commit's raw fields, before the service adds upstream awareness. */
export interface ParsedLogPage {
  /** Commits in this page, newest first, each with `pushed: null`. */
  readonly commits: readonly CommitInfo[]
}

/**
 * Parse `git log` output written with `%x00` field and `%x1e` record separators.
 *
 * The expected field order is `%H`, `%h`, `%s`, `%an`, `%aI`, `%cI`, `%P`.
 * `pushed` is left `null` here: whether a commit is on the upstream is a fact
 * about a ref, not about the commit, so the service settles it separately.
 * @param raw - Raw stdout of the matching `log` call.
 * @returns The page's commits.
 */
export function parseLog(raw: string): ParsedLogPage {
  const commits: CommitInfo[] = []
  for (const record of raw.split('\x1e')) {
    const trimmed = record.replace(/^\n+/, '')
    if (trimmed === '') continue
    const fields = trimmed.split('\x00')
    if (fields.length < 7) continue
    const [oid, shortOid, subject, authorName, authoredAt, committedAt, parents] = fields as [
      string,
      string,
      string,
      string,
      string,
      string,
      string,
    ]
    if (oid === '') continue
    commits.push({
      oid,
      shortOid,
      subject,
      authorName,
      authoredAt,
      committedAt,
      parents: parents === '' ? [] : parents.split(' '),
      pushed: null,
    })
  }
  return { commits }
}

/**
 * Assemble one history page from its parsed commits and what the read learned.
 *
 * `hasMore` is passed in rather than derived: the service asks git for one commit
 * MORE than the page size, so "is there another page" is answered by the same
 * single read. That deliberately avoids `git rev-list --count HEAD`, which walks
 * the entire history — seconds on a large monorepo — just to print a number the
 * "load more" control does not need.
 * @param commits - Commits in this page, extra look-ahead already dropped.
 * @param total - Total reachable commits, or `null` when it was not counted.
 * @param hasMore - Whether commits remain past this page.
 * @returns The page.
 */
export function logPageOf(
  commits: readonly CommitInfo[],
  total: number | null,
  hasMore: boolean,
): LogPage {
  return { commits, total, hasMore }
}

/**
 * Mark each commit with whether the upstream already contains it.
 *
 * `unpushed` is the set of commits reachable from HEAD but not from the
 * upstream, which is exactly what `git log <upstream>..HEAD` lists — usually a
 * handful, so asking for it costs one cheap process rather than a walk of the
 * whole history.
 * @param commits - Commits in this page.
 * @param unpushed - Object ids the upstream does not have.
 * @returns A new page with `pushed` settled for every commit.
 */
export function markPushed(
  commits: readonly CommitInfo[],
  unpushed: ReadonlySet<string>,
): readonly CommitInfo[] {
  return commits.map((commit) => ({ ...commit, pushed: !unpushed.has(commit.oid) }))
}
