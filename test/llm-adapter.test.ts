/**
 * The host's model adapter (FR-3.5), driven with a stand-in context.
 *
 * This is the one file in the plugin that names `ctx.llm` and
 * `ctx.agentDefaultModel`, so it is also the one place where a wrong call shape
 * would only show up in production. Nothing here needs a model to exist: the
 * context is a stub whose `stream` is an async generator of the harness's own
 * chunk types, which is exactly what the real service hands back.
 *
 * @module dsh-git-panel/test/llm-adapter
 */

import type { Context } from '@deepseek-ai/cordis'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { createTextGenerator } from '../src/host/adapter/llm.ts'

/** What one `llm.stream` call was given, as far as these tests look at it. */
interface RecordedCall {
  readonly provider: string
  readonly model: string
  readonly reasoningEffort?: string
  readonly maxTokens?: number
  readonly signal?: AbortSignal
  readonly purpose?: string
  readonly messages: readonly { readonly role: string; readonly content: readonly { type: string; text?: string }[] }[]
}

/**
 * A context offering the two services the adapter reads.
 * @param options - The route, the chunks to stream, and whether the services exist.
 * @returns The stub context and the recorded `stream` calls.
 */
function stubCtx(options: {
  readonly provider?: string
  readonly model?: string
  readonly reasoningEffort?: string
  readonly chunks?: readonly unknown[]
  readonly withServices?: boolean
}): { ctx: Context; calls: RecordedCall[] } {
  const calls: RecordedCall[] = []
  const chunks = options.chunks ?? []
  const ctx = {
    get: (name: string) => {
      if (options.withServices === false) return undefined
      if (name === 'llm') {
        return {
          stream(recorded: RecordedCall) {
            calls.push(recorded)
            return (async function* stream() {
              for (const chunk of chunks) yield chunk
            })()
          },
        }
      }
      if (name === 'agentDefaultModel') {
        return {
          currentSelection: () => ({
            provider: options.provider ?? 'deepseek',
            model: options.model ?? 'deepseek-chat',
            ...(options.reasoningEffort === undefined
              ? {}
              : { reasoningEffort: options.reasoningEffort }),
          }),
        }
      }
      return undefined
    },
  }
  return { ctx: ctx as unknown as Context, calls }
}

/** A stream that says one short text block and stops. */
function textChunks(text: string): readonly unknown[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

describe('the model adapter (FR-3.5)', () => {
  it('asks the deployment’s default model and returns its text', async () => {
    const { ctx, calls } = stubCtx({ chunks: textChunks('feat: written') })
    const result = await createTextGenerator(ctx)('Write a commit message')

    assert.ok(result.ok, result.ok ? '' : JSON.stringify(result.error))
    assert.equal(result.value, 'feat: written')
    assert.equal(calls.length, 1)
    // The route is the deployment's default selection, not this plugin's choice.
    assert.equal(calls[0]?.provider, 'deepseek')
    assert.equal(calls[0]?.model, 'deepseek-chat')
    // A commit message is short: the ceiling is what stops a runaway answer.
    assert.equal(typeof calls[0]?.maxTokens, 'number')
    // An auxiliary call must not claim to be something else in the harness's
    // telemetry, so no `purpose` is set.
    assert.equal(calls[0]?.purpose, undefined)
    // The prompt travels as one user message.
    assert.equal(calls[0]?.messages[0]?.role, 'user')
    assert.equal(calls[0]?.messages[0]?.content[0]?.text, 'Write a commit message')
  })

  it('carries the reasoning effort through when the default has one', async () => {
    const { ctx, calls } = stubCtx({ chunks: textChunks('x'), reasoningEffort: 'high' })
    await createTextGenerator(ctx)('hi')
    assert.equal(calls[0]?.reasoningEffort, 'high')
  })

  it('joins several text blocks, and ignores reasoning', async () => {
    const { ctx } = stubCtx({
      chunks: [
        { type: 'block-start', index: 0, blockType: 'reasoning' },
        { type: 'reasoning-delta', index: 0, text: 'thinking about it' },
        { type: 'block-end', index: 0, block: { type: 'reasoning', text: 'thinking about it' } },
        { type: 'block-start', index: 1, blockType: 'text' },
        { type: 'text-delta', index: 1, text: 'fix: one' },
        { type: 'block-end', index: 1, block: { type: 'text', text: 'fix: one' } },
        { type: 'block-start', index: 2, blockType: 'text' },
        { type: 'text-delta', index: 2, text: 'and two' },
        { type: 'block-end', index: 2, block: { type: 'text', text: 'and two' } },
        { type: 'finish', reason: { kind: 'stop' } },
      ],
    })
    const result = await createTextGenerator(ctx)('hi')
    assert.ok(result.ok)
    assert.equal(result.value, 'fix: one\nand two')
    assert.doesNotMatch(result.value, /thinking/u)
  })

  it('answers no-llm rather than throwing when the composition has no model', async () => {
    // The plugin is mounted in compositions without a model; the ✨ button has to
    // explain itself there, and the rest of the panel has to keep working.
    const { ctx, calls } = stubCtx({ withServices: false })
    const result = await createTextGenerator(ctx)('hi')
    assert.equal(result.ok, false)
    assert.equal(result.ok ? '' : result.error.code, 'no-llm')
    assert.equal(calls.length, 0)
  })

  it('turns a stream that ends in an error into a failure, not into an empty message', async () => {
    const { ctx } = stubCtx({
      chunks: [
        { type: 'block-start', index: 0, blockType: 'text' },
        { type: 'text-delta', index: 0, text: 'partial' },
        { type: 'finish', reason: { kind: 'error', failure: { message: 'rate limited', code: 'RATE_LIMIT' } } },
      ],
    })
    const result = await createTextGenerator(ctx)('hi')
    assert.equal(result.ok, false)
    assert.equal(result.ok ? '' : result.error.message, 'rate limited')
  })

  it('reports an empty answer instead of handing the box a blank message', async () => {
    const { ctx } = stubCtx({ chunks: [{ type: 'finish', reason: { kind: 'stop' } }] })
    const result = await createTextGenerator(ctx)('hi')
    assert.equal(result.ok, false)
    assert.equal(result.ok ? '' : result.error.code, 'internal')
  })

  it('aborts the call when the request goes away', async () => {
    const { ctx, calls } = stubCtx({ chunks: textChunks('x') })
    const controller = new AbortController()
    controller.abort()
    await createTextGenerator(ctx)('hi', controller.signal)
    // The deadline controller is the one git's request has no say over; the
    // caller's signal is bridged into it, so an abandoned panel stops paying.
    assert.equal(calls[0]?.signal?.aborted, true)
  })
})
