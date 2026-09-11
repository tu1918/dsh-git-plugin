/**
 * Tests for the pure presentation helpers.
 *
 * @module dsh-git-panel/test/format
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { lineCount, pathParts, relativeTimeParts } from '../src/core/format.ts'

describe('pathParts', () => {
  it('splits a nested path, keeping the trailing separator on the directory', () => {
    assert.deepEqual(pathParts('src/core/git-parse.ts'), {
      directory: 'src/core/',
      name: 'git-parse.ts',
    })
  })

  it('treats a bare name as all name', () => {
    // FR-1.2: the name is what a reader needs, so it is never the part dropped.
    assert.deepEqual(pathParts('README.md'), { directory: '', name: 'README.md' })
  })

  it('keeps a name that itself contains dots', () => {
    assert.deepEqual(pathParts('a/b/.gitignore'), { directory: 'a/b/', name: '.gitignore' })
  })
})

describe('relativeTimeParts', () => {
  const now = Date.parse('2026-09-11T12:00:00Z')

  it('reports seconds inside the first minute', () => {
    assert.deepEqual(relativeTimeParts('2026-09-11T11:59:30Z', now), { value: -30, unit: 'second' })
  })

  it('reports minutes, hours, and days', () => {
    assert.deepEqual(relativeTimeParts('2026-09-11T11:57:00Z', now), { value: -3, unit: 'minute' })
    assert.deepEqual(relativeTimeParts('2026-09-11T09:00:00Z', now), { value: -3, unit: 'hour' })
    assert.deepEqual(relativeTimeParts('2026-09-08T12:00:00Z', now), { value: -3, unit: 'day' })
  })

  it('truncates toward zero so a fresh commit never rounds up', () => {
    // 23 hours must read "23 hours ago"; "1 day ago" looks like a bug to
    // someone watching their own commit appear.
    assert.deepEqual(relativeTimeParts('2026-09-10T13:00:00Z', now), { value: -23, unit: 'hour' })
  })

  it('reports months and years for old commits', () => {
    assert.deepEqual(relativeTimeParts('2026-06-11T12:00:00Z', now), { value: -3, unit: 'month' })
    assert.deepEqual(relativeTimeParts('2023-09-11T12:00:00Z', now), { value: -3, unit: 'year' })
  })

  it('falls back to "now" for a timestamp git could not have written', () => {
    // A bogus age is a visible lie about the repository; zero is merely useless.
    assert.deepEqual(relativeTimeParts('not a date', now), { value: 0, unit: 'second' })
  })
})

describe('lineCount', () => {
  it('counts non-empty lines, so a multi-line git refusal is recognised', () => {
    assert.equal(lineCount(undefined), 0)
    assert.equal(lineCount(''), 0)
    assert.equal(lineCount('error: one line\n'), 1)
    assert.equal(lineCount('error: your local changes\nPlease commit\n\n'), 2)
  })
})
