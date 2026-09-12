/**
 * The AI commit message's pure halves (FR-3.5).
 *
 * The prompt's guarantees are worth testing because they are cheap to break and
 * expensive to notice: the panel is the only thing standing between a staged diff
 * and the deployment's model budget, so the budget, the language, and the
 * "the diff was cut" sentence are all assertions rather than prose in a comment.
 *
 * @module dsh-git-panel/test/commit-message
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  MAX_PROMPT_DIFF_CHARS,
  buildCommitMessagePrompt,
  cleanCommitMessage,
  truncateDiff,
} from '../src/core/commit-message.ts'

describe('truncateDiff (§8.3)', () => {
  it('passes a diff that fits through untouched, and says so', () => {
    const result = truncateDiff('small diff', 100)
    assert.deepEqual(result, { text: 'small diff', truncated: false })
  })

  it('cuts on a line boundary and reports the cut', () => {
    const diff = ['line one', 'line two', 'line three'].join('\n')
    const result = truncateDiff(diff, 14)
    assert.equal(result.truncated, true)
    // Never a half-written line: the model must not see a fragment as content.
    assert.equal(result.text, 'line one')
    assert.ok(!result.text.endsWith('\n'))
  })

  it('defaults to the module budget', () => {
    const long = 'x'.repeat(MAX_PROMPT_DIFF_CHARS + 10)
    assert.equal(truncateDiff(long).truncated, true)
    assert.equal(truncateDiff('x'.repeat(MAX_PROMPT_DIFF_CHARS)).truncated, false)
  })

  it('cuts a single enormous line rather than sending it whole', () => {
    const result = truncateDiff('x'.repeat(50), 10)
    assert.equal(result.truncated, true)
    assert.equal(result.text.length, 10)
  })
})

describe('buildCommitMessagePrompt', () => {
  const diff = 'diff --git a/a.ts b/a.ts\n+const a = 1\n'

  it('asks for Conventional Commits and for the answer alone', () => {
    const prompt = buildCommitMessagePrompt(diff, 'en', false)
    assert.match(prompt, /Conventional Commits/u)
    assert.match(prompt, /no explanation, no quotes, no code fences/u)
    assert.match(prompt, /at most 72 characters/u)
    assert.match(prompt, /Write in English/u)
    assert.ok(prompt.includes(diff), 'the diff travels with the prompt')
  })

  it('writes the message in the panel’s language', () => {
    assert.match(buildCommitMessagePrompt(diff, 'zh-CN', false), /Simplified Chinese/u)
    assert.match(buildCommitMessagePrompt(diff, 'en-US', false), /Write in English/u)
    // An unknown or empty tag is not a reason to refuse: English is the default.
    assert.match(buildCommitMessagePrompt(diff, '', false), /Write in English/u)
  })

  it('tells the model when it is looking at part of the change', () => {
    assert.match(buildCommitMessagePrompt(diff, 'en', true), /truncated before you saw it/u)
    assert.doesNotMatch(buildCommitMessagePrompt(diff, 'en', false), /truncated/u)
  })
})

describe('cleanCommitMessage', () => {
  it('keeps an ordinary answer', () => {
    assert.equal(cleanCommitMessage('feat(panel): add the branch picker'), 'feat(panel): add the branch picker')
  })

  it('keeps a subject and body, trimming only the edges', () => {
    const raw = '\n\nfix: stop rewriting the index\n\nThe read took the lock.\n\n'
    assert.equal(cleanCommitMessage(raw), 'fix: stop rewriting the index\n\nThe read took the lock.')
  })

  it('unwraps a fenced block', () => {
    assert.equal(cleanCommitMessage('```\nfeat: add\n```'), 'feat: add')
    assert.equal(cleanCommitMessage('```text\nfeat: add\n```'), 'feat: add')
  })

  it('drops a label the model added anyway', () => {
    assert.equal(cleanCommitMessage('Commit message: feat: add'), 'feat: add')
    assert.equal(cleanCommitMessage('提交信息：feat: 新增'), 'feat: 新增')
  })

  it('unquotes a quoted one-liner', () => {
    assert.equal(cleanCommitMessage('"feat: add"'), 'feat: add')
    assert.equal(cleanCommitMessage('“fix: repair”'), 'fix: repair')
  })

  it('returns nothing rather than inventing a message', () => {
    // The caller reports an empty answer as a failure; a placeholder here would
    // put words in the user's commit that no model wrote.
    assert.equal(cleanCommitMessage('   \n  '), '')
    assert.equal(cleanCommitMessage('```\n```'), '')
  })
})
