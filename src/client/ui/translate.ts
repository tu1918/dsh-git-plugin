/**
 * The panel's translator, in its own module.
 *
 * It sits here rather than in `StatusPanel.tsx` because two components need the
 * type and neither should have to import the other: the panel owns the copy, the
 * commit box consumes it, and a shared contract keeps that relationship one-way.
 * Like everything else under `ui/`, it names no DSH type.
 *
 * @module dsh-git-panel/client/ui/translate
 */

import type { GitPanelKey } from '../locales.ts'

/** The panel's translator: one key in, one string out. */
export type Translate = (
  key: GitPanelKey,
  vars?: Readonly<Record<string, string | number>>,
) => string

/**
 * One value a sentence can carry, which may itself be a sentence.
 *
 * The nesting is what keeps a composed phrase translatable: "Continue the
 * {kind}" with the kind substituted as TEXT would freeze it in whichever
 * language was active when the notice was created, which is the bug this file
 * exists to prevent. `say('operation.continue', { kind: say('operation.rebase') })`
 * renders in the language that is active when it is drawn, like everything else.
 */
export type SentenceVar = string | number | Sentence

/**
 * One sentence the panel has decided to say, before it is drawn.
 *
 * The action feedback keeps SENTENCES rather than translated strings, and that is
 * the whole point of this type: the translator reads the active dictionary when it
 * is CALLED (`client/adapter/locale.ts`), so a notice stored as text would stay in
 * whatever language was active when the operation finished while every other word
 * on screen followed a language switch. A key stored in the notice re-renders with
 * it.
 *
 * `raw` is the other half: a line that is already words and must not be looked up —
 * git's own `master -> master`, which belongs to git's locale, not this panel's.
 */
export type Sentence =
  | {
      readonly kind: 'key'
      readonly key: GitPanelKey
      readonly vars?: Readonly<Record<string, SentenceVar>>
    }
  | { readonly kind: 'raw'; readonly text: string }

/**
 * A sentence this panel wrote, to be translated when it is drawn.
 * @param key - The dictionary key.
 * @param vars - Values for the key's `{name}` placeholders; a value may itself be
 *   a sentence, so a phrase built out of two keys stays translatable.
 */
export function say(
  key: GitPanelKey,
  vars?: Readonly<Record<string, SentenceVar>>,
): Sentence {
  return { kind: 'key', key, vars }
}

/**
 * A sentence already in words, which is looked up by nobody.
 * @param text - The text, verbatim.
 */
export function verbatim(text: string): Sentence {
  return { kind: 'raw', text }
}

/**
 * Render one sentence with the current dictionary.
 * @param t - The live translator.
 * @param value - The sentence to render.
 */
export function sentence(t: Translate, value: Sentence): string {
  if (value.kind === 'raw') return value.text
  if (value.vars === undefined) return t(value.key)
  const vars: Record<string, string | number> = {}
  for (const [name, entry] of Object.entries(value.vars)) {
    vars[name] = typeof entry === 'object' ? sentence(t, entry) : entry
  }
  return t(value.key, vars)
}
