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
      readonly vars?: Readonly<Record<string, string | number>>
    }
  | { readonly kind: 'raw'; readonly text: string }

/**
 * A sentence this panel wrote, to be translated when it is drawn.
 * @param key - The dictionary key.
 * @param vars - Values for the key's `{name}` placeholders.
 */
export function say(
  key: GitPanelKey,
  vars?: Readonly<Record<string, string | number>>,
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
  return value.kind === 'raw' ? value.text : t(value.key, value.vars)
}
