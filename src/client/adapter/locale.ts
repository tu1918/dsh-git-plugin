/**
 * DSH adapter: `ctx.locale` → the panel's translator.
 *
 * Two things are established here that the rest of the browser half then takes
 * for granted:
 *
 * - The `gitPanel` locale namespace is DECLARED, by merging into the slot
 *   runtime's `LocaleNamespaceMap`. That declaration is what makes the key set
 *   type-checked everywhere else: a typo in `t('group.staged')` is a compile
 *   error, not a string that quietly renders its own key.
 * - The bound translator is obtained once per plugin mount. `ctx.locale.bind`
 *   returns a stable function that reads the active dictionary on every call, so
 *   a language switch reaches an already-rendered panel with no re-registration.
 *
 * Keeping this out of `locales.ts` is deliberate: that module is then pure data
 * with no DSH import at all, so the dictionaries can be read (and diffed) by
 * anything, including a test process.
 *
 * @module dsh-git-panel/client/adapter/locale
 */

import type { Context } from '@deepseek-ai/cordis'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'

import type { GitPanelKey } from '../locales.ts'
import { NS } from '../locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The git panel's own copy; see `client/locales.ts`. */
    gitPanel: GitPanelKey
  }
}

/** What the panel needs from the locale service. */
export interface BoundLocale {
  /** Namespace-bound translate, re-read on every call. */
  readonly t: TranslateNS<typeof NS>
  /**
   * BCP-47 tag of the locale in force when the tab opened.
   *
   * Used only for `Intl.RelativeTimeFormat`, which owns its own wording tables.
   * Unlike `t`, this is sampled once, so relative-time wording follows the
   * language the panel opened in; the visible prose still switches live.
   */
  readonly locale: string
}

/**
 * Bind the panel's translator.
 * @param ctx - Client context carrying `locale`.
 * @returns The bound translator and the active locale tag.
 */
export function bindGitPanelLocale(ctx: Context): BoundLocale {
  return { t: ctx.locale.bind(NS), locale: ctx.locale.getLocale().active }
}
