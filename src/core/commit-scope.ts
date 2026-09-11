/**
 * What a commit button in the current state would actually record (FR-3.4).
 *
 * This is the doc's most specific lesson from the comparable plugin (§1.3, point
 * 5): EasyTZ's commit button quietly ran `git add -u`, so the list the user was
 * reading and the commit they got were two different things. The doc's answer is
 * that the scope must be *visible*, and this module is where the visible answer
 * comes from — one pure decision, so the button's label, its enabled state, and
 * the call the host makes are all derived from the same reading rather than
 * being three places that can disagree.
 *
 * The whole table, in evaluation order:
 *
 * | state | scope | what the button does |
 * |---|---|---|
 * | any unmerged path | `conflicted` | disabled; git refuses to commit until the merge is finished |
 * | something staged | `staged` | commits the index, exactly as shown |
 * | tracked changes, nothing staged | `all-tracked` | says so, then `add -u` + commit |
 * | only untracked files | `untracked-only` | disabled; `add -u` would not include them anyway |
 * | nothing at all | `clean` | disabled |
 *
 * Conflicts are checked first because they dominate: with an unmerged path in the
 * index, git rejects the commit whatever else is staged, so offering "commit the
 * index" would be offering a button that cannot work.
 *
 * @module dsh-git-panel/core/commit-scope
 */

import type { StatusGroups } from './types.ts'

/** The commit a button in this state would perform. */
export type CommitScope =
  /** The index has content: commit it, and say how much. */
  | { readonly kind: 'staged'; readonly count: number }
  /** Nothing is staged but tracked files changed: the button becomes "commit all tracked". */
  | { readonly kind: 'all-tracked'; readonly count: number }
  /** Unmerged paths remain: nothing can be committed yet. */
  | { readonly kind: 'conflicted'; readonly count: number }
  /** Only untracked files exist: they must be staged first. */
  | { readonly kind: 'untracked-only'; readonly count: number }
  /** No changes at all. */
  | { readonly kind: 'clean' }

/**
 * Decide the commit scope from the four change groups.
 * @param groups - The groups exactly as `git status` reported them.
 * @returns The scope, with the count the button shows.
 */
export function commitScopeOf(groups: StatusGroups): CommitScope {
  if (groups.conflicted.length > 0) {
    return { kind: 'conflicted', count: groups.conflicted.length }
  }
  if (groups.staged.length > 0) {
    return { kind: 'staged', count: groups.staged.length }
  }
  if (groups.unstaged.length > 0) {
    return { kind: 'all-tracked', count: groups.unstaged.length }
  }
  if (groups.untracked.length > 0) {
    return { kind: 'untracked-only', count: groups.untracked.length }
  }
  return { kind: 'clean' }
}

/** Whether a scope can be committed, and by which host call. */
export interface CommitPlan {
  /** Whether the button is usable at all. */
  readonly enabled: boolean
  /**
   * Whether the commit must first stage every tracked change (`commitAll`).
   *
   * `true` only for {@link CommitScope} `all-tracked`, which is the one case
   * where the panel itself widens what is being committed — and therefore the one
   * case its copy has to announce.
   */
  readonly all: boolean
}

/**
 * Turn a scope into the action it implies.
 * @param scope - The scope from {@link commitScopeOf}.
 * @returns Whether to enable the button, and whether to use `commitAll`.
 */
export function commitPlanOf(scope: CommitScope): CommitPlan {
  switch (scope.kind) {
    case 'staged':
      return { enabled: true, all: false }
    case 'all-tracked':
      return { enabled: true, all: true }
    case 'conflicted':
    case 'untracked-only':
    case 'clean':
      return { enabled: false, all: false }
  }
}
