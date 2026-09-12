/**
 * The icon-map file: `extension: path`, one per line.
 *
 * The panel's file-type glyphs have a built-in set (`core/file-kind.ts`), and this
 * is how a deployment replaces one of them with its own SVG: a small YAML file
 * whose keys are extensions and whose values are icon file paths. It is a
 * deliberate SUBSET of YAML, parsed here rather than by a YAML library, because
 * the shape is a flat string map and nothing else: a dependency (and, for `core`,
 * an exception to its zero-import rule) would buy anchors, nested maps and
 * multi-line scalars that this file has no way to use. What IS accepted:
 *
 * - `ext: /path/to/icon.svg` — the extension may be written `.ts` or `ts`;
 * - blank lines and `#` comments (a full line, or after an unquoted value);
 * - values quoted with `'…'` or `"…"`, for a path with a `#` or edge spaces.
 *
 * Everything else on a line is a `problem`: a sentence the host logs, so a typo in
 * the file says what is wrong instead of silently mapping nothing.
 *
 * @module dsh-git-panel/core/icon-config
 */

/** One accepted line: an extension and the icon file it maps to. */
export interface IconConfigEntry {
  /** Extension without its dot, lowercased; the key a path is matched by. */
  readonly ext: string
  /** The icon file's path, exactly as the file wrote it (the host resolves it). */
  readonly path: string
}

/** What one parse produced. */
export interface ParsedIconConfig {
  /** The accepted entries, in file order. */
  readonly icons: readonly IconConfigEntry[]
  /** Lines that could not be used, each already phrased for a log line. */
  readonly problems: readonly string[]
}

/**
 * Take the value part of a line: quoted, or bare up to a trailing comment.
 * @param raw - Everything after the first colon.
 * @returns The value, or an empty string when there is none.
 */
function valueOf(raw: string): string {
  const text = raw.trim()
  const quote = text[0]
  if ((quote === '"' || quote === "'") && text.length > 1 && text.endsWith(quote)) {
    return text.slice(1, -1)
  }
  // Only a ` #` starts a comment in a bare value, so a path may contain `#`.
  const comment = text.search(/\s#/u)
  return (comment < 0 ? text : text.slice(0, comment)).trim()
}

/**
 * Normalize an extension key: the dot is decoration (`.ts` and `ts` are one key),
 * and the match is case-insensitive.
 * @param raw - The key as written.
 * @returns The key, or `null` when it is not an extension at all.
 */
function extOf(raw: string): string | null {
  const key = raw.trim().replace(/^\./u, '').toLowerCase()
  return /^[a-z0-9_+-]+$/u.test(key) ? key : null
}

/**
 * Parse one icon-map file.
 *
 * A later line for an extension wins over an earlier one, and says so: the file is
 * a map, and a reader who wrote the key twice wants the last word, not the first.
 * @param text - The file's contents.
 * @returns The entries and the lines that could not be used.
 */
export function parseIconConfig(text: string): ParsedIconConfig {
  const icons: IconConfigEntry[] = []
  const problems: string[] = []
  const seen = new Set<string>()

  text.split('\n').forEach((line, index) => {
    const where = `line ${index + 1}`
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) return
    const colon = trimmed.indexOf(':')
    if (colon < 0) {
      problems.push(`${where}: expected "extension: path", got ${JSON.stringify(trimmed)}`)
      return
    }
    const ext = extOf(trimmed.slice(0, colon))
    if (ext === null) {
      problems.push(`${where}: ${JSON.stringify(trimmed.slice(0, colon).trim())} is not an extension`)
      return
    }
    const path = valueOf(trimmed.slice(colon + 1))
    if (path === '') {
      problems.push(`${where}: .${ext} has no icon path`)
      return
    }
    if (seen.has(ext)) {
      problems.push(`${where}: .${ext} was already mapped; this line wins`)
      icons.splice(
        icons.findIndex((entry) => entry.ext === ext),
        1,
      )
    }
    seen.add(ext)
    icons.push({ ext, path })
  })

  return { icons, problems }
}
