/**
 * Pure presentation helpers: the small derivations the panel's rows need.
 *
 * These live in `core` rather than in the component for the same reason the
 * parsers do — they are decisions with right and wrong answers, so they belong
 * somewhere `node --test` can reach them without a browser.
 *
 * @module dsh-git-panel/core/format
 */

/** A path split for display: the directory prefix and the final segment. */
export interface PathParts {
  /** Everything up to and including the last separator; empty for a bare name. */
  readonly directory: string
  /** The final segment. */
  readonly name: string
}

/**
 * Split a repo-relative path into its directory prefix and file name.
 *
 * The panel renders these as two spans: the name keeps full ink and never
 * shrinks, the directory is muted and allowed to clip (FR-1.2 — a long path
 * loses directories, never the file name).
 * @param path - Repo-relative path, `/`-separated.
 * @returns The directory prefix (with its trailing separator) and the name.
 */
export function pathParts(path: string): PathParts {
  const cut = path.lastIndexOf('/')
  if (cut === -1) return { directory: '', name: path }
  return { directory: path.slice(0, cut + 1), name: path.slice(cut + 1) }
}

/** A relative age, in the unit a localiser can render. */
export interface RelativeTimeParts {
  /** Signed magnitude: negative for a time in the past. */
  readonly value: number
  /** Unit name accepted by `Intl.RelativeTimeFormat`. */
  readonly unit: 'second' | 'minute' | 'hour' | 'day' | 'month' | 'year'
}

/** Unit thresholds in seconds, largest first, with the divisor for each. */
const RELATIVE_UNITS: readonly (readonly [RelativeTimeParts['unit'], number])[] = [
  ['year', 31_536_000],
  ['month', 2_592_000],
  ['day', 86_400],
  ['hour', 3_600],
  ['minute', 60],
]

/**
 * Turn a timestamp into a relative age the caller can localise.
 *
 * Returning the value and unit rather than a string keeps the wording out of
 * `core`: the component hands both to `Intl.RelativeTimeFormat`, so "3 minutes
 * ago" and "3 分钟前" come from the platform's own tables instead of a dictionary
 * the plugin would have to maintain in every language.
 * @param iso - Timestamp, ISO-8601 as git reports it.
 * @param now - Current epoch milliseconds.
 * @returns The signed age and its unit; `second` for anything under a minute.
 *   A timestamp in the future is clamped to zero — see below.
 */
export function relativeTimeParts(iso: string, now: number): RelativeTimeParts {
  const at = Date.parse(iso)
  // An unparseable date must not become "in 56 years": falling back to zero
  // renders as "now", which is wrong but harmless, whereas a bogus age is a
  // visible lie about the repository.
  if (Number.isNaN(at)) return { value: 0, unit: 'second' }

  // A commit cannot be from the future. The timestamp is git's and the clock is
  // the panel's, and they are not the same clock: with a reference captured
  // before the commit existed, a fresh commit computed minutes ahead and
  // rendered as "in 1 minute" — a sentence no reader can act on. Zero localises
  // to "now", which is the closest true thing anyone can say about it.
  const seconds = Math.min((at - now) / 1000, 0)
  const magnitude = Math.abs(seconds)
  for (const [unit, size] of RELATIVE_UNITS) {
    if (magnitude >= size) {
      // `Math.trunc` rather than `round`: a commit 23 hours old is "23 hours
      // ago", never "1 day ago", which reads as a rounding bug to a user
      // watching a fresh commit.
      return { value: Math.trunc(seconds / size), unit }
    }
  }
  return { value: Math.trunc(seconds), unit: 'second' }
}

/**
 * Count the lines of a git diagnostic, for the "show git's own words" case.
 *
 * FR-4.4 requires the panel to show git's multi-line refusal verbatim rather
 * than a paraphrase, so the row needs to know whether it is rendering one line
 * or a block.
 * @param text - Raw text, possibly `undefined`.
 * @returns How many non-empty lines it contains.
 */
export function lineCount(text: string | undefined): number {
  if (text === undefined) return 0
  return text.split('\n').filter((line) => line.trim() !== '').length
}
