/**
 * DSH adapter: `ctx.llm` + `ctx.agentDefaultModel` → the core's `generateText`.
 *
 * This is the only file that names the harness's model services, which is the
 * §5.2 arrangement: the git service builds a prompt as a string and gets a string
 * back, so no component, no service, and no test needs a model to exist.
 *
 * Three properties of the call are decided here rather than in the prompt builder:
 *
 * - **The route comes from the deployment's default model.** `agentDefaultModel`
 *   is what the harness itself uses for an Agent created without an explicit
 *   model, so an auxiliary call made on the user's behalf lands on the same model
 *   their conversations use. Nothing in this plugin's own config selects a model.
 * - **Absence is a value, not a throw.** A composition with no model mounted (a
 *   headless test host, or a deployment that never configured one) answers the
 *   `no-llm` failure, which the panel shows beside the ✨ button. Reading through
 *   `ctx.get` is how "optional" is expressed: it does not add the service to
 *   `inject`, so the panel still mounts — and the rest of it still works — in a
 *   composition that has no model at all.
 * - **The message wears this plugin's own source kind**, declared below rather
 *   than borrowed from a shared one.
 *
 * @module dsh-git-panel/host/adapter/llm
 */

import { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type { Result } from '../../core/ports.ts'

/**
 * This plugin's source kind, declared into the harness's map.
 *
 * DSH 0.2 removed the shared `plugin` source (`MessageSourceMap` is now a
 * merge-extensible sum whose producers each declare their own kind — the
 * interface's own doc says there is no catch-all), so the attribution this
 * plugin stamps can no longer be spelled with one of DSH's values and has to be
 * added beside them.
 *
 * The augmentation names the module that DECLARES the interface, not the
 * package entry: `@deepseek-ai/dsh-llm` only re-exports the type, and augmenting
 * a re-export would declare a second, shadowing interface instead of merging
 * with it.
 *
 * The key is a literal because an interface takes no computed name; it is the
 * same string as {@link PLUGIN}, so renaming one without the other fails the
 * typecheck rather than silently dropping the attribution.
 */
declare module '@deepseek-ai/dsh-llm/message' {
  interface MessageSourceMap {
    'dsh-git-panel': { kind: 'dsh-git-panel' }
  }
}

/** One model's answer, in the panel's vocabulary. */
export type TextGenerator = (prompt: string, signal?: AbortSignal) => Promise<Result<string>>

/** Deadline for one generation. */
const TEXT_TIMEOUT_MS = 60_000

/** Ceiling on the answer; a commit message is one short paragraph. */
const MAX_OUTPUT_TOKENS = 512

/** The plugin identity stamped on the request, as the harness's own callers do. */
const PLUGIN = 'dsh-git-panel'

/**
 * Build the text generator over this context's model services.
 * @param ctx - Host context.
 * @returns A generator that answers `no-llm` when the composition has no model.
 */
export function createTextGenerator(ctx: Context): TextGenerator {
  return async (prompt, signal) => {
    // `get` rather than `ctx.llm`: optional by construction, so a host without a
    // model still mounts the panel and only this one button explains itself.
    const llm = ctx.get('llm')
    const defaults = ctx.get('agentDefaultModel')
    if (llm === undefined || defaults === undefined) {
      return {
        ok: false,
        error: {
          code: 'no-llm',
          message: 'this deployment has no language model configured',
        },
      }
    }

    const selection = defaults.currentSelection()
    const deadline = new AbortController()
    const timer = setTimeout(() => deadline.abort(), TEXT_TIMEOUT_MS)
    timer.unref()
    const onAbort = (): void => deadline.abort()
    // An already-aborted caller never fires its event again, so the check comes
    // first: a request that was cancelled before this call was made must not
    // spend a model round trip.
    if (signal?.aborted === true) onAbort()
    else signal?.addEventListener('abort', onAbort)

    try {
      const assembler = new BlockAssembler()
      const stream = llm.stream({
        provider: selection.provider,
        model: selection.model,
        ...(selection.reasoningEffort === undefined
          ? {}
          : { reasoningEffort: selection.reasoningEffort }),
        messages: [
          createUserMessage({
            content: [{ type: 'text', text: prompt }],
            source: { kind: PLUGIN },
          }),
        ],
        maxTokens: MAX_OUTPUT_TOKENS,
        signal: deadline.signal,
      })
      for await (const chunk of stream) assembler.push(chunk)

      // A stream can end by failing rather than by stopping — the harness reports
      // that as the terminal finish reason, not as a thrown error.
      const finish = assembler.finish
      if (finish.kind === 'error' || finish.kind === 'aborted') {
        return {
          ok: false,
          error: { code: 'internal', message: finish.failure.message },
        }
      }

      const blocks = assembler.blocks()
      const text = blocks
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('\n')
        .trim()
      if (text === '') {
        return { ok: false, error: { code: 'internal', message: 'the model answered with no text' } }
      }
      return { ok: true, value: text }
    } catch (error: unknown) {
      return {
        ok: false,
        error: {
          code: 'internal',
          message: error instanceof Error ? error.message : String(error),
        },
      }
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    }
  }
}
