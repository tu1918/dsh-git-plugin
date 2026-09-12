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

import {
  validateBranchBase,
  validateBranchName,
  validateHash,
  validateMessage,
  validatePaths,
  validateStashMessage,
} from '../src/core/validate.ts'

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

describe('branch name validation (FR-4.1–4.3)', () => {
  it('accepts the names git itself accepts', () => {
    for (const name of ['main', 'feat/git-panel', 'release-1.2', 'fix_thing', 'a.b.c']) {
      const result = validateBranchName(name)
      assert.ok(result.ok, `${name}: ${result.ok ? '' : result.error.message}`)
      assert.equal(result.value, name)
    }
  })

  it('refuses a name that is not a non-empty string', () => {
    for (const name of [undefined, null, '', 42, ['main']]) {
      const result = validateBranchName(name)
      assert.equal(result.ok, false, `expected ${JSON.stringify(name)} to be refused`)
      assert.equal(result.ok ? '' : result.error.code, 'bad-request')
    }
  })

  it('refuses what §5.5 names: traversal, colons, control characters, a leading dash', () => {
    for (const name of ['..', 'a..b', 'a:b', 'a\tb', 'a\nb', '-branch', '--upload-pack=x']) {
      const result = validateBranchName(name)
      assert.equal(result.ok, false, `expected ${JSON.stringify(name)} to be refused`)
    }
  })

  it('refuses the rest of git\u2019s ref grammar, so git never has to', () => {
    // Each of these is a name `git check-ref-format` rejects; letting one through
    // would only move the refusal into a spawned process.
    for (const name of [
      'has space',
      'tilde~1',
      'caret^',
      'question?',
      'star*',
      'bracket[',
      'back\\slash',
      'at@{1}',
      '@',
      'trailing.',
      'lock.lock',
      'double//slash',
      '/leading',
      'trailing/',
      '.hidden',
    ]) {
      const result = validateBranchName(name)
      assert.equal(result.ok, false, `expected ${JSON.stringify(name)} to be refused`)
    }
  })
})

describe('commit hash validation (§5.5)', () => {
  it('accepts the doc\u2019s shape', () => {
    for (const hash of ['abcd', 'a'.repeat(40), '0123456789abcdef']) {
      const result = validateHash(hash)
      assert.ok(result.ok, `${hash}: ${result.ok ? '' : result.error.message}`)
    }
  })

  it('refuses anything that is not 4–40 lowercase hex characters', () => {
    for (const hash of ['abc', 'a'.repeat(41), 'ABCD', 'xyz9', '', 'HEAD~1', 'abc def', '--all']) {
      const result = validateHash(hash)
      assert.equal(result.ok, false, `expected ${JSON.stringify(hash)} to be refused`)
    }
  })
})

describe('branch base validation (FR-4.2)', () => {
  it('accepts either a branch name or a commit hash', () => {
    for (const base of ['main', 'feat/x', 'a'.repeat(40)]) {
      const result = validateBranchBase(base)
      assert.ok(result.ok, `${base}: ${result.ok ? '' : result.error.message}`)
    }
  })

  it('refuses a revision expression, which is git syntax rather than intent', () => {
    for (const base of ['HEAD~1', 'main^{commit}', 'origin/main..HEAD', '']) {
      const result = validateBranchBase(base)
      assert.equal(result.ok, false, `expected ${JSON.stringify(base)} to be refused`)
    }
  })
})

describe('stash message validation (FR-6.2)', () => {
  it('answers "no message" for an absent, null, or blank one', () => {
    // FR-6.2 makes the message optional, so an empty box is a choice rather than
    // a malformed request; git writes its own `WIP on <branch>` label for it.
    for (const message of [undefined, null, '', '   ', '\n']) {
      const result = validateStashMessage(message)
      assert.ok(result.ok, `expected ${JSON.stringify(message)} to be accepted`)
      assert.equal(result.ok ? result.value : 'rejected', null)
    }
  })

  it('returns a message as sent, without trimming it', () => {
    const result = validateStashMessage('  half-done work  ')
    assert.ok(result.ok)
    assert.equal(result.value, '  half-done work  ')
  })

  it('refuses a non-string, a NUL, and a message that is too long', () => {
    for (const message of [7, { text: 'x' }, 'a\u0000b', 'x'.repeat(4097)]) {
      const result = validateStashMessage(message)
      assert.equal(result.ok, false, `expected ${JSON.stringify(message)} to be refused`)
      assert.equal(result.ok ? '' : result.error.code, 'bad-request')
    }
  })
})
