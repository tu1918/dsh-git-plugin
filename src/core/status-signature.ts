/**
 * Did the repository actually move? A fingerprint of one status reading.
 *
 * The panel refreshes itself on a timer while it is on screen (see
 * `client/ui/polling.ts`), because a file an agent writes touches nothing inside
 * `.git` — there is no index or HEAD event to hear, and the changes simply do not
 * appear. But a poll that finds the same repository must publish nothing:
 * re-rendering the whole panel every two seconds would fight every hover, focus
 * and scroll position, and would wake the diff and the history for nothing.
 *
 * So a reading is compared before it is applied. The comparison is a string over
 * exactly what the panel draws — the branch's identity and counts, the
 * operation in progress, and every row's two status letters and path — which is
 * deliberate: two readings with the same fingerprint produce the same pixels,
 * and `git status` has no third state to miss. It is not a deep-equality helper;
 * it is "is this the same screen?".
 *
 * @module dsh-git-panel/core/status-signature
 */

import type { RepoStatus } from './types.ts'

/** The separator: a NUL cannot appear in a path, a branch name, or a status letter. */
const SEP = '\u0000'

/**
 * The fingerprint the panel compares one reading against the last.
 * @param status - A status reading.
 * @returns A string that is equal exactly when the two readings draw the same panel.
 */
export function statusSignature(status: RepoStatus): string {
  const row = (entry: RepoStatus['groups']['staged'][number]): string =>
    `${entry.index}${entry.worktree}${entry.path}`
  const { staged, unstaged, untracked, conflicted } = status.groups
  return [
    status.root,
    status.branch.head,
    status.branch.oid ?? '',
    status.branch.name ?? '',
    status.branch.upstream ?? '',
    String(status.branch.ahead),
    String(status.branch.behind),
    String(status.operation),
    String(status.truncated),
    String(status.changedCount),
    [staged, unstaged, untracked, conflicted]
      .map((group) => group.map(row).join('\n'))
      .join(SEP),
  ].join(SEP)
}
