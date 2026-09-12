/**
 * The icon-map file's parser, tested as the pure function it is.
 *
 * The point of these tests is the small YAML SUBSET the file accepts and the
 * problem sentences it produces for everything else: a typo in a deployment's
 * icon map has to say what is wrong, because the only other symptom is a glyph
 * that silently stayed built-in.
 *
 * @module dsh-git-panel/test/icon-config
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { parseIconConfig } from '../src/core/icon-config.ts'

describe('the icon map (FR-1.2)', () => {
  it('reads extension/path pairs, with or without the dot', () => {
    const parsed = parseIconConfig(
      ['.ts: /home/me/icons/ts.svg', 'md: ~/icons/md.svg', 'TSX: /x/tsx.svg'].join('\n'),
    )
    assert.deepEqual(parsed.problems, [])
    assert.deepEqual(parsed.icons, [
      { ext: 'ts', path: '/home/me/icons/ts.svg' },
      { ext: 'md', path: '~/icons/md.svg' },
      { ext: 'tsx', path: '/x/tsx.svg' },
    ])
  })

  it('ignores blank lines and comments, and a comment after a bare value', () => {
    const parsed = parseIconConfig(
      [
        '# what a deployment can override',
        '',
        '   ',
        'ts: /icons/ts.svg   # our own TypeScript mark',
        'md:',
        '  ',
      ].join('\n'),
    )
    assert.deepEqual(parsed.icons, [{ ext: 'ts', path: '/icons/ts.svg' }])
    assert.equal(parsed.problems.length, 1, 'the `md:` line has no value')
  })

  it('keeps a # that is part of the path, and edge spaces a quoted value has', () => {
    // Only a whitespace-plus-# starts a comment, so a bare path may contain one…
    assert.deepEqual(parseIconConfig('ts: /icons/a#b.svg').icons, [
      { ext: 'ts', path: '/icons/a#b.svg' },
    ])
    // …and quoting is how a path keeps its own leading or trailing spaces.
    assert.deepEqual(parseIconConfig('ts: " /icons/ts.svg "').icons, [
      { ext: 'ts', path: ' /icons/ts.svg ' },
    ])
    assert.deepEqual(parseIconConfig("ts: '~/my icons/ts.svg'").icons, [
      { ext: 'ts', path: '~/my icons/ts.svg' },
    ])
  })

  it('lets the last line for an extension win, and says so', () => {
    const parsed = parseIconConfig(['ts: /a.svg', 'ts: /b.svg'].join('\n'))
    assert.deepEqual(parsed.icons, [{ ext: 'ts', path: '/b.svg' }])
    assert.equal(parsed.problems.length, 1)
    assert.match(parsed.problems[0] ?? '', /already mapped/u)
  })

  it('turns every unusable line into a sentence, and keeps the good ones', () => {
    const parsed = parseIconConfig(
      [
        'typescript: /a.svg', // a long extension is still an extension shape
        'no colon here',
        ': /b.svg',
        'ts:',
        '.d.ts: /c.svg', // a dot inside the key is not an extension
        'md: /ok.svg',
      ].join('\n'),
    )
    assert.deepEqual(parsed.icons, [
      { ext: 'typescript', path: '/a.svg' },
      { ext: 'md', path: '/ok.svg' },
    ])
    assert.equal(parsed.problems.length, 4)
    assert.match(parsed.problems[0] ?? '', /expected "extension: path"/u)
    assert.match(parsed.problems[1] ?? '', /is not an extension/u)
    assert.match(parsed.problems[2] ?? '', /has no icon path/u)
    assert.match(parsed.problems[3] ?? '', /is not an extension/u)
  })
})
