/**
 * The layering guard: an executable version of §5.2's dependency rules.
 *
 * The doc asks for this to be enforced with eslint's `no-restricted-imports`.
 * It is enforced here instead, for one practical reason: `npm test` already runs
 * on every change, and a rule that runs is worth more than a rule that is
 * configured somewhere. A lint config that nobody runs, or that a new directory
 * silently falls outside of, would not hold the line the doc actually cares
 * about — which is that DSH churn stops at the adapter directories.
 *
 * The three rules, exactly as the doc states them:
 *
 * 1. `src/core/` imports nothing but itself — with one named, argued exception,
 *    `vscode-diff`. FR-2.3 asks for VS Code's word-level marking, and that
 *    package IS VS Code's diff engine extracted: MIT, zero dependencies, pure
 *    TypeScript. It adds nothing the pure layer was protecting against — no DSH,
 *    no cordis, no React, no Node — so `node --test` still runs `src/core`
 *    directly. Otherwise: no foreign imports at all.
 * 2. `src/*​/adapter/` is the ONLY place a DSH package may be imported. Each DSH
 *    capability gets a small adapter that translates it into a core port.
 * 3. Business and UI code (`src/host/*`, `src/client/ui/*`) imports neither DSH
 *    nor, in the UI's case, the adapter that wraps it — the arrow points inward.
 *
 * The one exemption is the two ENTRY modules, `src/host/index.ts` and
 * `src/client/index.tsx`. An assembly module's entire reason to exist is to
 * receive `ctx` and say which pieces exist, so it necessarily names the context
 * type; the doc's own layout (§5.1) puts those two files there for exactly that
 * purpose. Everything they assemble is still only reachable through a port.
 *
 * When DSH's SDK moves, the failures this test allows you to have are confined to
 * a handful of files, which is the whole argument for the extra indirection.
 *
 * @module dsh-git-panel/test/dependency-direction
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, posix, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

/** Repository root, derived from this file's location. */
const root = join(fileURLToPath(new URL('.', import.meta.url)), '..')

/** Anything that identifies a DSH or cordis package. */
const DSH_PACKAGE = /^@deepseek-ai\//

/** Bare specifiers the pure layer must not touch either. */
const FOREIGN_IN_CORE = /^(?:react|react-dom|node:|@deepseek-ai\/)/

/**
 * The bare specifiers the pure layer is allowed to name.
 *
 * Exactly one, and deliberately so: `vscode-diff` (see the module doc above and
 * `src/core/diff-engine/marks.ts`). A second entry here should have to be argued
 * for in the same terms — that it is dependency-free, MIT-or-compatible, pure
 * TypeScript, and something the doc's own requirements name.
 */
const CORE_ALLOWED_PACKAGES: ReadonlySet<string> = new Set(['vscode-diff'])

/**
 * Bare specifiers the host's business layer must not touch.
 *
 * Node builtins are absent on purpose: this layer runs in the DSH process, so
 * `node:fs` is its native vocabulary. What it must not reach for is a DSH
 * package or a browser framework.
 */
const FOREIGN_IN_HOST = /^(?:react|react-dom|@deepseek-ai\/)/

/** Every `.ts`/`.tsx` file under a directory, as repo-relative POSIX paths. */
function sourceFiles(dir: string): string[] {
  const found: string[] = []
  const walk = (absolute: string): void => {
    for (const entry of readdirSync(absolute)) {
      const child = join(absolute, entry)
      if (statSync(child).isDirectory()) {
        walk(child)
        continue
      }
      if (child.endsWith('.ts') || child.endsWith('.tsx')) {
        found.push(relative(root, child).split(sep).join(posix.sep))
      }
    }
  }
  walk(join(root, dir))
  return found.sort()
}

/**
 * Remove comments while preserving string literals.
 *
 * A regex-only stripper is not good enough here: this file documents its own
 * rules in prose that contains phrases like `from "in sync"`, and a naive
 * `from\s+['"]...` pattern happily reads that as an import. It also has to keep
 * string bodies intact, because a `//` inside `'http://…'` must not start a
 * comment. So the scan tracks whether it is inside a comment, and emits
 * everything else verbatim.
 * @param text - Source text.
 * @returns The same text with comment bodies removed.
 */
function stripComments(text: string): string {
  let out = ''
  let index = 0
  type Mode = 'code' | 'line' | 'block' | 'single' | 'double' | 'template'
  let mode: Mode = 'code'
  while (index < text.length) {
    const char = text[index] as string
    const next = text[index + 1]

    if (mode === 'code') {
      if (char === '/' && next === '/') { mode = 'line'; index += 2; continue }
      if (char === '/' && next === '*') { mode = 'block'; index += 2; continue }
      if (char === "'") mode = 'single'
      else if (char === '"') mode = 'double'
      else if (char === '`') mode = 'template'
      out += char
      index += 1
      continue
    }
    if (mode === 'line') {
      if (char === '\n') { mode = 'code'; out += char }
      index += 1
      continue
    }
    if (mode === 'block') {
      if (char === '*' && next === '/') { mode = 'code'; index += 2; continue }
      index += 1
      continue
    }
    // Inside a string: a backslash escapes the next character.
    if (char === '\\') { out += char + (next ?? ''); index += 2; continue }
    const closing = mode === 'single' ? "'" : mode === 'double' ? '"' : '`'
    if (char === closing) mode = 'code'
    out += char
    index += 1
  }
  return out
}

/**
 * Every module specifier a file imports.
 *
 * Deliberately textual: a type-checker already resolves imports, and what this
 * guard must catch is the import STATEMENT being present at all, including in a
 * file that does not currently compile. It covers static declarations,
 * re-exports, and dynamic `import()`.
 * @param absolute - Absolute path to the source file.
 * @returns The specifiers it names.
 */
function importsOf(absolute: string): string[] {
  const text = stripComments(readFileSync(absolute, 'utf8'))
  const specifiers: string[] = []
  const patterns = [
    /\bfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\bimport\s+['"]([^'"]+)['"]/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ]
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      if (match[1] !== undefined) specifiers.push(match[1])
    }
  }
  return specifiers
}

/** Whether a repo-relative path sits inside an adapter directory. */
function isAdapter(path: string): boolean {
  return path.includes('/adapter/')
}

/**
 * The two assembly modules, which are allowed to name the context type.
 *
 * Listed explicitly rather than matched by pattern: any future addition to this
 * list should be a deliberate decision, since each entry widens the surface the
 * compatibility layer is supposed to contain.
 */
const ENTRY_MODULES: readonly string[] = ['src/host/index.ts', 'src/client/index.tsx']

/** Whether a repo-relative path is one of the two assembly modules. */
function isEntry(path: string): boolean {
  return ENTRY_MODULES.includes(path)
}

describe('dependency direction (§5.2)', () => {
  it('keeps src/core free of every import but the diff engine', () => {
    const offenders: string[] = []
    for (const path of sourceFiles('src/core')) {
      for (const specifier of importsOf(join(root, path))) {
        // Relative imports inside core are its own business; the one allowlisted
        // package is argued for above; anything else — DSH, React, a Node
        // builtin — breaks the pure layer's testability.
        if (specifier.startsWith('.')) continue
        if (CORE_ALLOWED_PACKAGES.has(specifier)) continue
        offenders.push(`${path} → ${specifier}`)
      }
    }
    assert.deepEqual(
      offenders,
      [],
      'src/core must stay pure TypeScript: it may only import its own relative modules',
    )
  })

  it('confines DSH imports to the adapter directories', () => {
    const offenders: string[] = []
    for (const path of sourceFiles('src')) {
      if (path.startsWith('src/core/')) continue
      if (isAdapter(path)) continue
      if (isEntry(path)) continue
      for (const specifier of importsOf(join(root, path))) {
        if (DSH_PACKAGE.test(specifier)) offenders.push(`${path} → ${specifier}`)
      }
    }
    assert.deepEqual(
      offenders,
      [],
      'only src/*/adapter/ (and the two entry modules) may import a @deepseek-ai/* package',
    )
  })

  it('keeps the UI independent of the adapter that renders it', () => {
    // The arrow points one way: adapter → ui. A component that imported its own
    // adapter could no longer be rendered, or reviewed, without a host.
    const offenders: string[] = []
    for (const path of sourceFiles('src/client/ui')) {
      for (const specifier of importsOf(join(root, path))) {
        if (specifier.includes('/adapter/')) offenders.push(`${path} → ${specifier}`)
      }
    }
    assert.deepEqual(offenders, [], 'src/client/ui must not import src/client/adapter')
  })

  it('keeps the host business layer off DSH types too', () => {
    // `src/host/*.ts` (git-exec, git-service, watcher, routes) works through the
    // core ports only; the adapter satisfies them.
    const offenders: string[] = []
    for (const path of sourceFiles('src/host')) {
      if (isAdapter(path)) continue
      if (isEntry(path)) continue
      for (const specifier of importsOf(join(root, path))) {
        if (FOREIGN_IN_HOST.test(specifier)) offenders.push(`${path} → ${specifier}`)
      }
    }
    assert.deepEqual(offenders, [], 'src/host business modules must import only core + relative')
  })

  it('actually finds the files it claims to guard', () => {
    // A guard that silently scans nothing passes for the wrong reason.
    assert.ok(sourceFiles('src/core').length >= 3, 'expected core modules')
    assert.ok(sourceFiles('src/host/adapter').length >= 2, 'expected host adapters')
    assert.ok(sourceFiles('src/client/ui').length >= 3, 'expected UI modules')
  })
})
