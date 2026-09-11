/**
 * The argument validator (§5.5), tested as the pure function it is.
 *
 * The point of these tests is coverage of the shapes the doc forbids, not of the
 * happy path: every rule here exists because something hostile or accidental
 * reached a `git` argument list without it. What the host then does with an
 * accepted path is `host-mutations.test.ts`'s business.
 *
 * @module dsh-git-panel/test/validate
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { validateMessage, validatePaths } from '../src/core/validate.ts'

describe('path validation', () => {
  it('accepts repo-relative paths and keeps their order', () => {
    const result = validatePaths(['src/a.ts', 'docs/b.md', 'nested/deep/c.txt'])
    assert.ok(result.ok)
    assert.deepEqual(result.value, ['src/a.ts', 'docs/b.md', 'nested/deep/c.txt'])
  })

  it('accepts a path whose own name merely looks suspicious', () => {
    // `.gitignore` starts with `.git` but is not a `.git` segment: the rule is
    // about the directory, not the prefix.
    const result = validatePaths(['.gitignore', '.gitattributes', 'a..b.txt', '..hidden/x'])
    assert.ok(result.ok, result.ok ? '' : result.error.message)
    assert.deepEqual(result.value, ['.gitignore', '.gitattributes', 'a..b.txt', '..hidden/x'])
  })

  it('refuses an empty list, and a list that is not a list', () => {
    for (const paths of [[], undefined, null, 'a.txt', { 0: 'a.txt' }]) {
      const result = validatePaths(paths)
      assert.equal(result.ok, false, `expected ${JSON.stringify(paths)} to be refused`)
      assert.equal(result.ok ? '' : result.error.code, 'bad-request')
    }
  })

  it('refuses an entry that is not a non-empty string', () => {
    for (const paths of [[1], [null], [''], ['a.txt', undefined], ['a.txt', {}]]) {
      const result = validatePaths(paths)
      assert.equal(result.ok, false, `expected ${JSON.stringify(paths)} to be refused`)
    }
  })

  it('refuses an absolute path in every spelling', () => {
    for (const path of ['/etc/passwd', '\\Windows\\system32', 'C:\\Users\\me', 'C:/Users/me']) {
      const result = validatePaths([path])
      assert.equal(result.ok, false, `expected ${path} to be refused`)
      assert.match(result.ok ? '' : result.error.message, /relative/u)
    }
  })

  it('refuses an upward traversal in both separator spellings', () => {
    for (const path of ['../secret', 'a/../../secret', '..\\secret', 'a\\..\\..\\secret', '..']) {
      const result = validatePaths([path])
      assert.equal(result.ok, false, `expected ${path} to be refused`)
      assert.match(result.ok ? '' : result.error.message, /traverse/u)
    }
  })

  it('refuses any path that leads into a .git directory', () => {
    for (const path of ['.git/config', '.git', 'sub/.git/config', '.git\\hooks\\pre-commit']) {
      const result = validatePaths([path])
      assert.equal(result.ok, false, `expected ${path} to be refused`)
      assert.match(result.ok ? '' : result.error.message, /\.git/u)
    }
  })

  it('refuses a NUL, which no filesystem path may contain', () => {
    const result = validatePaths(['a\u0000b'])
    assert.equal(result.ok, false)
  })

  it('refuses the first bad entry wherever it sits in the list', () => {
    const result = validatePaths(['ok.txt', 'also/ok.txt', '../bad'])
    assert.equal(result.ok, false)
  })
})

describe('message validation', () => {
  it('accepts an ordinary message', () => {
    const result = validateMessage('feat: add the thing')
    assert.ok(result.ok)
    assert.equal(result.value, 'feat: add the thing')
  })

  it('returns the message as sent, without trimming it', () => {
    // git's own cleanup strips surrounding blank lines; rewriting the text here
    // would be this plugin editing what the user wrote.
    const message = '\n\n  subject\n\nbody\n'
    const result = validateMessage(message)
    assert.ok(result.ok)
    assert.equal(result.value, message)
  })

  it('refuses an empty or whitespace-only message', () => {
    // git would abort with "empty commit message"; refusing here means the panel
    // can say so without spending a process on it.
    for (const message of ['', '   ', '\n\n', '\t']) {
      const result = validateMessage(message)
      assert.equal(result.ok, false, `expected ${JSON.stringify(message)} to be refused`)
      assert.match(result.ok ? '' : result.error.message, /empty/u)
    }
  })

  it('refuses a message that is not a string', () => {
    for (const message of [undefined, null, 42, { text: 'hi' }, ['hi']]) {
      const result = validateMessage(message)
      assert.equal(result.ok, false)
      assert.equal(result.ok ? '' : result.error.code, 'bad-request')
    }
  })

  it('refuses a NUL character', () => {
    const result = validateMessage('subject\u0000body')
    assert.equal(result.ok, false)
  })

  it('refuses a message too long to be an argument', () => {
    const result = validateMessage('x'.repeat(64 * 1024 + 1))
    assert.equal(result.ok, false)
    assert.match(result.ok ? '' : result.error.message, /too long/u)
    // The boundary itself is accepted.
    assert.equal(validateMessage('x'.repeat(64 * 1024)).ok, true)
  })
})
