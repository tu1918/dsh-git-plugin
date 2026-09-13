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

/**
 * The target a {@link diffTargetKey} names, or `null` for anything else.
 *
 * The inverse exists because a key travels where the object cannot: a right-side
 * tab records its address and nothing else, so a diff opened there is restored
 * from the key it was opened under. The hash is not validated here — whether it
 * still resolves is the host's question, the same way an expired undo row's is.
 * @param key - A key produced by {@link diffTargetKey}.
 * @returns The target it names, or `null` when the string is not one.
 */
export function diffTargetFromKey(key: string): DiffTarget | null {
  if (key === 'worktree' || key === 'index') return { area: key }
  const hash = key.startsWith('commit:') ? key.slice('commit:'.length) : ''
  return hash === '' ? null : { area: 'commit', hash }
}
