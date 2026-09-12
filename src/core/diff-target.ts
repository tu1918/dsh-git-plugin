/**
 * The identity of a diff request.
 *
 * A diff target is what the panel holds while one diff is open: it says which
 * comparison is on screen, and — for FR-7.2's commit drill-down — which commit
 * that comparison is against. Two targets are the same reading exactly when
 * their keys match, which is what the panes compare to decide whether the open
 * diff is still the one the user asked for.
 *
 * The revision has to be part of the key: `worktree` and `commit:<hash>` are
 * different readings of the same path, and a pane that keyed on the area alone
 * would keep showing one commit's diff after the user picked another file in a
 * different commit.
 *
 * @module dsh-git-panel/core/diff-target
 */

import type { DiffTarget } from './types.ts'

/**
 * A stable string identity for one diff target.
 * @param target - The comparison the panel is asking for.
 * @returns A key that differs whenever the reading would.
 */
export function diffTargetKey(target: DiffTarget): string {
  return target.area === 'commit' ? `commit:${target.hash}` : target.area
}
