/**
 * What kind of thing a changed file is, from its name alone.
 *
 * The change list draws one glyph per row so a reader can tell a source file from
 * a picture before reading the name (FR-1.2 puts the badge and the name on the
 * row; the glyph takes the slot the badge used to hold, and the badge moved to the
 * end of the row). This module is the pure half of that: a path in, a kind out —
 * no DOM, no icon, no colours, so the mapping can be enumerated in a test the way
 * `core/git-parse.ts`'s parsers are.
 *
 * Deliberately a SMALL set of kinds. A kind per language would need a glyph per
 * language, and at 14px the differences would be mush; what a reader actually gets
 * out of a row icon is the coarse question — "is this code, a document, a
 * picture, a config file?" — and that is what these answer.
 *
 * @module dsh-git-panel/core/file-kind
 */

/**
 * Every kind, in one tuple.
 *
 * The union is DERIVED from this list, and the icon table is a `Record` over the
 * union, so a new kind is added in exactly one place and the compiler points at
 * whatever else has to follow (a missing mark, a stale mapping). Keeping a hand
 * written union beside a hand written list is how the two drift.
 */
export const FILE_KINDS = [
  'code',
  'markup',
  'style',
  'data',
  'image',
  'doc',
  'shell',
  'config',
  'file',
] as const

/** The coarse kinds a row's glyph distinguishes. */
export type FileKind = (typeof FILE_KINDS)[number]

/**
 * Kinds by extension, lowercased and without the dot.
 *
 * `.svg` is markup by nature and an image by use; it is listed as `image`, which
 * is what a reader is looking for when a diagram changes.
 */
const BY_EXTENSION: Readonly<Record<string, FileKind>> = {
  // code
  ts: 'code', tsx: 'code', mts: 'code', cts: 'code', js: 'code', jsx: 'code',
  mjs: 'code', cjs: 'code', py: 'code', rb: 'code', go: 'code', rs: 'code',
  java: 'code', kt: 'code', kts: 'code', swift: 'code', c: 'code', h: 'code',
  cc: 'code', cpp: 'code', cxx: 'code', hpp: 'code', cs: 'code', php: 'code',
  scala: 'code', lua: 'code', pl: 'code', ex: 'code', exs: 'code', erl: 'code',
  clj: 'code', dart: 'code', r: 'code', jl: 'code', sql: 'code',
  // markup
  html: 'markup', htm: 'markup', xhtml: 'markup', xml: 'markup', vue: 'markup',
  svelte: 'markup', astro: 'markup', hbs: 'markup', ejs: 'markup', pug: 'markup',
  // style
  css: 'style', scss: 'style', sass: 'style', less: 'style', styl: 'style',
  // data
  json: 'data', jsonc: 'data', json5: 'data', yaml: 'data', yml: 'data',
  toml: 'data', ini: 'data', cfg: 'data', conf: 'data', properties: 'data',
  csv: 'data', tsv: 'data', graphql: 'data', gql: 'data', lock: 'data',
  // image
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image',
  avif: 'image', ico: 'image', bmp: 'image', tif: 'image', tiff: 'image',
  svg: 'image', psd: 'image',
  // doc
  md: 'doc', mdx: 'doc', markdown: 'doc', txt: 'doc', rst: 'doc', adoc: 'doc',
  org: 'doc', tex: 'doc',
  // shell
  sh: 'shell', bash: 'shell', zsh: 'shell', fish: 'shell', ksh: 'shell',
  ps1: 'shell', bat: 'shell', cmd: 'shell',
}

/**
 * Kinds by whole name, for the files whose meaning is not in an extension.
 *
 * A dotfile's leading dot is not an extension (`lastIndexOf('.')` is 0), and
 * `Dockerfile`/`Makefile`/`LICENSE` never had one, so these are exact matches on
 * the lowercased base name.
 */
const BY_NAME: Readonly<Record<string, FileKind>> = {
  dockerfile: 'config', 'docker-compose.yml': 'config', 'docker-compose.yaml': 'config',
  makefile: 'config', gnumakefile: 'config', 'cmakelists.txt': 'config',
  '.gitignore': 'config', '.gitattributes': 'config', '.gitmodules': 'config',
  '.npmrc': 'config', '.nvmrc': 'config', '.editorconfig': 'config',
  '.prettierrc': 'config', '.eslintignore': 'config', '.dockerignore': 'config',
  '.env': 'config', '.env.example': 'config', '.env.local': 'config',
  license: 'doc', 'license.md': 'doc', 'license.txt': 'doc',
  readme: 'doc', 'readme.md': 'doc', 'readme.txt': 'doc',
  notice: 'doc', authors: 'doc', changelog: 'doc', 'changelog.md': 'doc',
}

/**
 * The last path segment, lowercased: what both tables are keyed by.
 * @param path - Repo-relative, `/`-separated path.
 */
function nameOf(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1).toLowerCase()
}

/**
 * The extension a name ends in, or `null` when it has none.
 *
 * Only the LAST dot counts, so `a.test.ts` is `ts`. A dot that leads the name is
 * not an extension (`.gitignore`), and neither is a trailing one (`weird.`).
 * @param name - An already-lowercased path segment.
 */
function extensionOf(name: string): string | null {
  const dot = name.lastIndexOf('.')
  if (dot <= 0 || dot === name.length - 1) return null
  return name.slice(dot + 1)
}

/**
 * The kind of one changed file, from its repo-relative path.
 *
 * The last path segment is the name; only the LAST dot is an extension, so
 * `a.test.ts` is TypeScript and `.gitignore` — whose only dot is the leading one —
 * falls through to the name table. A name with no extension at all is a plain
 * file rather than a guess: an icon that is wrong is worse than one that is
 * generic.
 * @param path - Repo-relative, `/`-separated path.
 * @returns The kind, or `file` when nothing matches.
 */
export function fileKindOf(path: string): FileKind {
  const name = nameOf(path)
  const byName = BY_NAME[name]
  if (byName !== undefined) return byName
  const extension = extensionOf(name)
  return extension === null ? 'file' : (BY_EXTENSION[extension] ?? 'file')
}

/**
 * The extension key a path is matched by against a deployment's icon map, or
 * `null` when the path has no extension.
 *
 * The same rule as {@link fileKindOf}'s extension lookup — one dot rule for the
 * whole module — and the same normalization the icon-map file's keys go through
 * (`core/icon-config.ts`): no dot, lowercased.
 * @param path - Repo-relative, `/`-separated path.
 * @returns The key, or `null`.
 */
export function fileIconKeyOf(path: string): string | null {
  return extensionOf(nameOf(path))
}

/**
 * The custom icon a deployment mapped this path's extension to, if any.
 *
 * Pure — the map's values are whatever the caller's icons are (the panel passes
 * data URLs) — so the precedence rule of "a configured icon wins, the built-in
 * kind is the fallback" lives in one place, testable without a DOM.
 * @param path - Repo-relative, `/`-separated path.
 * @param icons - Extension (no dot, lowercased) to icon.
 * @returns The icon, or `undefined` when the built-in glyph should be used.
 */
export function customIconFor(
  path: string,
  icons: Readonly<Record<string, string>>,
): string | undefined {
  const key = fileIconKeyOf(path)
  return key === null ? undefined : icons[key]
}
