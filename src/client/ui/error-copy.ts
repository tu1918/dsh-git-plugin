/**
 * One git failure, said in the panel's voice.
 *
 * Its own module rather than a private helper inside the status panel, for a
 * structural reason: the diff pane renders failures too, and importing it from
 * `StatusPanel.tsx` would make the two components import each other. A cycle like
 * that happens to work under ESM — both uses are deferred to render time — but a
 * module that cannot be loaded on its own is a trap for the next change, and the
 * rule this file follows is cheaper than remembering the exception.
 *
 * @module dsh-git-panel/client/ui/error-copy
 */

import type { GitPanelError } from '../../core/ports.ts'
import type { Translate } from './translate.ts'

/**
 * Render one git failure in the panel's voice.
 *
 * Every recognized code gets copy written for it, because a code exists only
 * where the panel does something specific with the failure; the rest fall through
 * to git's own words, verbatim and with their newlines (FR-4.4).
 * @param t - Translator.
 * @param error - The failure to explain.
 * @param mode - Whether a read or an operation failed, which changes the generic
 *   wording: "could not read" is wrong for a push that was refused.
 * @returns A heading and an optional multi-line detail.
 */
export function errorCopy(
  t: Translate,
  error: GitPanelError,
  mode: 'read' | 'action',
): { title: string; detail: string | undefined } {
  switch (error.code) {
    case 'not-a-repo':
      return { title: t('noRepo.title'), detail: t('noRepo.hint') }
    case 'no-session':
      return { title: t('error.noSession'), detail: undefined }
    case 'git-missing':
      return { title: t('error.gitMissing'), detail: undefined }
    case 'timeout':
      return { title: t('error.timeout'), detail: undefined }
    case 'too-large':
      return { title: t('error.tooLarge'), detail: undefined }
    case 'bad-request':
      return { title: t('error.badRequest'), detail: undefined }
    case 'nothing-to-commit':
      return { title: t('error.nothingToCommit'), detail: undefined }
    case 'non-fast-forward':
      // FR-5.4's whole point: name the state and the way out, rather than
      // forwarding git's hint text and leaving the user to translate it.
      return { title: t('error.nonFastForward'), detail: error.detail }
    case 'conflict':
      return { title: t('error.conflict'), detail: error.detail }
    default:
      // git's own words, verbatim and with their newlines: FR-4.4.
      return {
        title:
          mode === 'action'
            ? t('error.actionFailed', { message: error.message })
            : t('error.generic', { message: error.message }),
        detail: error.detail,
      }
  }
}
