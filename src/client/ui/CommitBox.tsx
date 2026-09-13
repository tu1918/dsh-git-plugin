/**
 * The commit box: where a message is written (FR-3.3) and where the commit's
 * SCOPE is made visible (FR-3.4).
 *
 * It is a controlled component with no state of its own. The message belongs to
 * the panel because a failed commit must not cost the user the paragraph they
 * just wrote, and the scope belongs to the panel because it is a reading of git
 * status, not something a text box can know.
 *
 * What is *here* is the copy: which sentence explains the current scope, and
 * which words the button carries. That is the doc's §1.3 lesson, point 5 — the
 * comparable plugin's commit button quietly ran `add -u` and the list disagreed
 * with the commit — so the widening exists as words on screen before it exists as
 * an argument to git.
 *
 * @module dsh-git-panel/client/ui/CommitBox
 */

import type { ReactNode } from 'react'

import { commitPlanOf } from '../../core/commit-scope.ts'
import type { CommitScope } from '../../core/commit-scope.ts'
import { cls } from './styles.ts'
import { sentence, type Sentence, type Translate } from './translate.ts'
import { SparkleGlyph } from './icons.tsx'

/** Everything the box renders from. */
export interface CommitBoxProps {
  /** The message so far. */
  readonly message: string
  /** Called with the new text on every keystroke. */
  readonly onMessage: (value: string) => void
  /** What a commit would record right now. */
  readonly scope: CommitScope
  /** True while an operation is in flight, so the box cannot start a second. */
  readonly busy: boolean
  /** The last commit failure, already translated; shown under the box. */
  readonly error?: string
  /** Commit, with the scope the button is currently describing. */
  readonly onCommit: () => void
  /**
   * Ask the host to write a message for the staged diff (FR-3.5).
   *
   * Only offered when there IS a staged diff: the doc's prompt is built from
   * `git diff --cached`, so with an empty index the button would be a round trip
   * whose only possible answer is "there is nothing to describe".
   */
  readonly aiEnabled: boolean
  /** True while a generation is running. */
  readonly generating: boolean
  /** A note about the last generation, e.g. that the diff was truncated. */
  readonly aiNote?: Sentence
  /** Start a generation. */
  readonly onGenerate: () => void
  /** The panel's translator. */
  readonly t: Translate
}

/**
 * The button's words for a scope.
 * @param scope - The current scope.
 * @param t - Translator.
 * @returns The button label, count included where the count is meaningful.
 */
function labelOf(scope: CommitScope, t: Translate): string {
  switch (scope.kind) {
    case 'staged':
      return t('commit.buttonCount', { count: scope.count })
    case 'all-tracked':
      return t('commit.allTrackedCount', { count: scope.count })
    default:
      // The remaining scopes cannot commit, so the plain word is the right one
      // to sit greyed out beside the reason.
      return t('commit.button')
  }
}

/**
 * The sentence that says what the button will do.
 * @param scope - The current scope.
 * @param t - Translator.
 * @returns One line, or the empty string where the button's own words already
 *   say it — see the `all-tracked` case.
 */
function hintOf(scope: CommitScope, t: Translate): string {
  switch (scope.kind) {
    case 'staged':
      return t('commit.hintStaged', { count: scope.count })
    case 'all-tracked':
      // Deliberately empty (asked for from the running panel). The button's own
      // label already names the widening and counts it
      // (`commit.allTrackedCount`), and the sentence that used to spell out the
      // `add -u` under it was one line of mechanism beside words already doing
      // the job. The span stays in the markup and keeps carrying
      // `data-commit-scope`: it is what holds the button against the right edge,
      // and it is how the panel reads the scope back.
      return ''
    case 'conflicted':
      return t('commit.hintConflicted', { count: scope.count })
    case 'untracked-only':
      return t('commit.hintUntracked')
    case 'clean':
      return t('commit.hintClean')
  }
}

/**
 * The panel's commit box.
 * @param props - Message, scope, and the panel's callbacks.
 */
export function CommitBox({
  message,
  onMessage,
  scope,
  busy,
  error,
  onCommit,
  aiEnabled,
  generating,
  aiNote,
  onGenerate,
  t,
}: CommitBoxProps): ReactNode {
  const plan = commitPlanOf(scope)
  // An empty message is not a commit the host would accept, so the button says
  // so by being unavailable — no round trip is spent learning it.
  const ready = plan.enabled && !busy && message.trim() !== ''

  const submit = (): void => {
    if (ready) onCommit()
  }

  return (
    <div className={cls.commitBox}>
      {/* The ✨ sits inside the box, as §4.2 draws it: it writes the text this
          very textarea holds, so it belongs to the box rather than to the
          action rail. */}
      <div className={cls.commitInputWrap}>
        <textarea
          className={cls.commitInput}
          value={message}
          rows={2}
          placeholder={t('commit.placeholder')}
          aria-label={t('commit.placeholder')}
          onChange={(event) => onMessage(event.target.value)}
          onKeyDown={(event) => {
            // Ctrl+Enter (⌘+Enter on a Mac) is FR-3.3's shortcut. Plain Enter stays
            // a newline, because a commit message has a body.
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
              event.preventDefault()
              submit()
            }
          }}
        />
        <button
          type="button"
          className={cls.aiButton}
          disabled={!aiEnabled || busy || generating}
          title={aiEnabled ? t('commit.ai') : t('commit.aiNeedsStaged')}
          aria-label={aiEnabled ? t('commit.ai') : t('commit.aiNeedsStaged')}
          onClick={onGenerate}
        >
          {generating ? <span className={cls.spinner} /> : <SparkleGlyph size={14} />}
        </button>
      </div>
      <div className={cls.commitFoot}>
        <span className={cls.commitScope} data-commit-scope={scope.kind}>
          {hintOf(scope, t)}
        </span>
        <button
          type="button"
          className={cls.commitButton}
          disabled={!ready}
          title={labelOf(scope, t)}
          onClick={submit}
        >
          {labelOf(scope, t)}
        </button>
      </div>
      {error !== undefined && error !== '' && (
        <p className={cls.statusHint} data-commit-error="true">
          {error}
        </p>
      )}
      {aiNote !== undefined && (
        <p className={cls.statusHint} data-ai-note="true">
          {sentence(t, aiNote)}
        </p>
      )}
    </div>
  )
}
