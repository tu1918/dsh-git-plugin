/**
 * The file-kind mapping behind a change row's glyph (FR-1.2).
 *
 * Pure-function tests, no DOM: the icon is the drawing, this is the decision, and
 * the interesting part of a mapping like this is the edges — a dotfile, a
 * multi-dot name, an uppercase extension, a name that names nothing at all.
 *
 * @module dsh-git-panel/test/file-kind
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { customIconFor, fileIconKeyOf, fileKindOf } from '../src/core/file-kind.ts'

describe('file kinds (FR-1.2)', () => {
  it('reads the extension of the last path segment only', () => {
    assert.equal(fileKindOf('src/client/ui/ChangeGroup.tsx'), 'code')
    assert.equal(fileKindOf('a.test.ts'), 'code')
    assert.equal(fileKindOf('docs/plan.md'), 'doc')
    // The directory's dots are not the file's extension.
    assert.equal(fileKindOf('v1.2/main.py'), 'code')
  })

  it('maps one kind per family, which is the whole point of the glyph', () => {
    assert.equal(fileKindOf('index.html'), 'markup')
    assert.equal(fileKindOf('styles.scss'), 'style')
    assert.equal(fileKindOf('package-lock.json'), 'data')
    assert.equal(fileKindOf('logo.png'), 'image')
    assert.equal(fileKindOf('build.sh'), 'shell')
  })

  it('is case-insensitive, so an uppercase name is not a different kind', () => {
    assert.equal(fileKindOf('SRC/App.TSX'), 'code')
    assert.equal(fileKindOf('LOGO.PNG'), 'image')
    assert.equal(fileKindOf('Makefile'), 'config')
  })

  it('knows the files whose meaning is not in an extension', () => {
    assert.equal(fileKindOf('Dockerfile'), 'config')
    assert.equal(fileKindOf('Makefile'), 'config')
    assert.equal(fileKindOf('.gitignore'), 'config')
    assert.equal(fileKindOf('.env.local'), 'config')
    assert.equal(fileKindOf('LICENSE'), 'doc')
    assert.equal(fileKindOf('CHANGELOG.md'), 'doc')
  })

  it('answers a plain file when nothing matches, rather than guessing', () => {
    // `data.xyz` has an extension nothing knows; `no-extension` has none; a
    // dotfile's leading dot is not one; and a trailing dot names none either.
    for (const path of ['data.xyz', 'no-extension', '.npmignore', 'weird.']) {
      assert.equal(fileKindOf(path), 'file', path)
    }
  })

  it('separates a dotfile from a dotfile with a real extension', () => {
    // `.eslintrc.json` ends in a known extension; `.gitignore` does not.
    assert.equal(fileKindOf('.eslintrc.json'), 'data')
    assert.equal(fileKindOf('.gitignore'), 'config')
  })
})

describe('a deployment’s own icons (FR-1.2)', () => {
  it('keys a path by the same extension rule as the kind table', () => {
    assert.equal(fileIconKeyOf('src/a.ts'), 'ts')
    assert.equal(fileIconKeyOf('src/a.TS'), 'ts', 'the match is case-insensitive')
    assert.equal(fileIconKeyOf('a.test.ts'), 'ts', 'only the last dot counts')
    assert.equal(fileIconKeyOf('.gitignore'), null, 'a leading dot is not an extension')
    assert.equal(fileIconKeyOf('README'), null)
    assert.equal(fileIconKeyOf('weird.'), null, 'a trailing dot names none either')
  })

  it('prefers a configured icon, and falls back to nothing when there is none', () => {
    const icons = { ts: 'data:image/svg+xml;charset=utf-8,%3Csvg%2F%3E' }
    assert.equal(customIconFor('src/a.ts', icons), icons.ts)
    // A file with no extension, and one whose extension is not mapped: the row
    // keeps its built-in kind glyph.
    assert.equal(customIconFor('LICENSE', icons), undefined)
    assert.equal(customIconFor('docs/plan.md', icons), undefined)
    assert.equal(customIconFor('src/a.ts', {}), undefined)
  })
})
