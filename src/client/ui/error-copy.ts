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
      // §5.5's shape failures (a bad path, a bad hash) are unreachable from an
      // honest panel, but an undoCommit refusal is a reachable STATE — a stale
      // row, a first commit, a published merge — and its sentence is the answer
      // to "why did nothing happen". The message is the host's own one-liner in
      // every case, so it is the title; git's output, when any, is the detail.
      return { title: error.message, detail: error.detail }
    case 'nothing-to-commit':
      return { title: t('error.nothingToCommit'), detail: undefined }
    case 'non-fast-forward':
      // FR-5.4's whole point: name the state and the way out, rather than
      // forwarding git's hint text and leaving the user to translate it.
      return { title: t('error.nonFastForward'), detail: error.detail }
    case 'conflict':
      return { title: t('error.conflict'), detail: error.detail }
    case 'dirty-worktree':
      // FR-4.4: git's own sentence names the files it would overwrite, and that
      // list is the detail; the title says what the state means and that stashing
      // is the way on (the shortcut beside this box is that way).
      return { title: t('error.dirtyWorktree'), detail: error.detail }
    case 'not-merged':
      // FR-4.3: git's own words are "the branch ... is not fully merged", which
      // says what is true but not what to do. The picker has already armed the
      // forced click, so this sentence points at it.
      return { title: t('error.notMerged'), detail: undefined }
    case 'auth-required':
      // The panel cannot prompt on a terminal, so it asks here instead: the
      // title says what is missing and the form beside it is the answer. git's
      // own words stay as the detail — they name the host, which is the one
      // fact the user needs to check against what they are about to type.
      return { title: t('error.authRequired'), detail: error.detail }
    case 'credentials-unavailable':
      // Nothing to add to the host's own sentence: the deployment is missing a
      // capability, and no retry of the user's will change that.
      return { title: error.message, detail: undefined }
    case 'upstream-gone':
      // git's own words name the ref it could not merge with; the title says what
      // that means and how to get out of it, because the panel has no button for
      // this one — the fix is a change to the branch's configuration.
      return { title: t('error.upstreamGone'), detail: error.detail }
    case 'no-llm':
      // FR-3.5 cannot run here, and the reason is the deployment's, not the
      // user's — so it says which fact is missing rather than "try again".
      return { title: t('error.noLlm'), detail: undefined }
    case 'clipboard':
      // The copy entries' one failure: the browser refused the write (jsdom, an
      // insecure context, a denied permission). The panel's own sentence, because
      // there is no git output to forward.
      return { title: t('error.clipboard'), detail: undefined }
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
