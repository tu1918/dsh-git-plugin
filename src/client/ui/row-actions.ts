/**
 * Which actions one change row offers, as pure predicates.
 *
 * These rules live here, rather than at each place that asks, because two places
 * always ask the same question: the row's own inline buttons, and the row menu
 * (§9's file menu) built by the panel. A button the row draws while the menu says
 * nothing — or an entry the menu offers on a row that has no button for it — is a
 * panel contradicting itself, and the way that happens is two copies of one rule
 * drifting apart.
 *
 * FR-6.1 asked for "文件行提供放弃更改按钮" without saying which rows, so the answer
 * is the panel's, and it follows the row model the list already has: **a row offers
 * what its own side of the index can do**. The working-tree rows (`unstaged`,
 * `untracked`) hold the only state discard can act on, so they get it. A staged row
 * holds an index change, and its action is unstage — discarding from there would
 * throw away worktree edits that row is not showing, which is the kind of surprise
 * a destructive button must not spring. A conflicted row is unmerged in the index,
 * where `git restore` refuses to guess a side: abandoning a conflict belongs to
 * FR-9's merge UI, not to a file row.
 *
 * @module dsh-git-panel/client/ui/row-actions
 */

import type { ChangeArea } from '../../core/types.ts'

/**
 * Whether a row in this group offers "discard the working-tree change" (FR-6.1).
 * @param area - The group the row is drawn in.
 * @returns Whether the row's inline button and its menu entry exist.
 */
export function canDiscard(area: ChangeArea): boolean {
  return area === 'unstaged' || area === 'untracked'
}

/**
 * Whether a row offers "accept one side of the conflict" (FR-9.2).
 *
 * Only an unmerged path has sides to take, and only the conflict group holds
 * those rows. The predicate exists for the same reason {@link canDiscard} does:
 * the row's inline buttons and its menu must offer the same thing.
 * @param area - The group the row is drawn in.
 * @returns Whether the row's conflict actions exist.
 */
export function canResolveConflict(area: ChangeArea): boolean {
  return area === 'conflicted'
}
