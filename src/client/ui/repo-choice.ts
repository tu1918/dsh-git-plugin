/**
 * Which repository the user chose, remembered per container directory (FR-8.2).
 *
 * Keyed by the container — the session's own directory — rather than by the
 * session, because the session is transient while the directory is not: the next
 * conversation opened in the same place should still be reading the repository
 * that was chosen there.
 *
 * Guarded read and best-effort write for the reasons `bottom-view.ts` states:
 * storage throws in a private-mode browser and is absent in a bare jsdom
 * document, and a stored value is untrusted input another tab or another version
 * of this plugin may have written.
 *
 * @module dsh-git-panel/client/ui/repo-choice
 */

/** The `localStorage` key the per-container choices live under. */
export const REPO_CHOICE_KEY = 'dsh-git-panel/repo'

/** Container path → chosen repository root. */
export type RepoChoices = Readonly<Record<string, string>>

/**
 * Read the remembered choices.
 *
 * Anything that is not a map of string to string is dropped, so a value from
 * another version cannot make the panel throw on its first render.
 * @returns The stored choices, or an empty map.
 */
export function readRepoChoices(): RepoChoices {
  try {
    const raw = window.localStorage.getItem(REPO_CHOICE_KEY)
    if (raw === null) return {}
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
    const choices: Record<string, string> = {}
    for (const [container, root] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof root === 'string' && root !== '') choices[container] = root
    }
    return choices
  } catch {
    return {}
  }
}

/**
 * Remember one container's chosen repository.
 * @param container - The session's directory.
 * @param root - The repository chosen there.
 */
export function writeRepoChoice(container: string, root: string): void {
  try {
    const choices = { ...readRepoChoices(), [container]: root }
    window.localStorage.setItem(REPO_CHOICE_KEY, JSON.stringify(choices))
  } catch {
    // Storage unavailable: the choice still holds for this session.
  }
}
