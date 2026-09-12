/**
 * The stash list: save, apply, pop, and drop (FR-6.2).
 *
 * Like {@link BranchPicker} it is the CONTENT of a floating layer
 * (`ui/popover.tsx`), not a block in the panel's column: the stack is opened,
 * read, and dismissed, and unfolding it into the column would move the change
 * list the user was reading. Dismissal — outside press, Escape — belongs to the
 * layer and is not repeated here.
 *
 * Three choices are worth stating:
 *
 * - **The whole stack is listed, newest first.** git's own order, and git's own
 *   subject on each row (`WIP on main: …`, or `On main: <the message>`), because
 *   the panel has nothing better to say about an entry than git does.
 * - **Apply and pop are separate buttons.** They mean different things — `apply`
 *   keeps the entry, `pop` removes it once it applied — and a conflict keeps the
 *   entry either way, so collapsing them into one control would have to pick for
 *   the user which of the two they asked for.
 * - **Dropping arms first** (§4.3). It is the only irreversible action here: the
 *   stashed commits lose their last ref. The confirmed row is visibly a different
 *   button, and nothing here is a native `confirm` — §4.3 forbids it.
 *
 * @module dsh-git-panel/client/ui/StashPicker
 */

import { useState } from 'react'
import type { ReactNode } from 'react'

import type { StashEntry } from '../../core/types.ts'
import { useArmedKey } from './armed.ts'
import { ToolButton } from './ChangeGroup.tsx'
import { cls } from './styles.ts'
import type { Translate } from './translate.ts'
import { CloseGlyph, TrashGlyph } from './icons.tsx'

/** Everything the stash list renders from. */
export interface StashPickerProps {
  /** The stack, newest first, or `null` while the first read is in flight. */
  readonly stashes: readonly StashEntry[] | null
  /** The panel's copy. */
  readonly t: Translate
  /** True while any operation is in flight. */
  readonly busy: boolean
  /** Stash the working tree; `message` is `null` when the box was left empty (FR-6.2). */
  readonly onSave: (message: string | null, untracked: boolean) => void
  /** Apply one entry, dropping it when `pop` (FR-6.2). */
  readonly onApply: (entry: StashEntry, pop: boolean) => void
  /** Drop one entry without applying it (FR-6.2). */
  readonly onDrop: (entry: StashEntry) => void
  /** Close the layer. */
  readonly onClose: () => void
}

/**
 * The stash stack with its four actions.
 * @param props - Entries, copy, and the panel's callbacks.
 */
export function StashPicker({
  stashes,
  t,
  busy,
  onSave,
  onApply,
  onDrop,
  onClose,
}: StashPickerProps): ReactNode {
  // The arming lives here rather than in the panel, for the reason the branch
  // picker's does: the entry it belongs to dies with the layer, so a stacked
  // confirmation cannot outlive the row it was about.
  const { armed, arm, reset } = useArmedKey()
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [untracked, setUntracked] = useState(false)

  const submitSave = (): void => {
    if (busy) return
    // A blank box is "no message", not an empty one: FR-6.2 makes the message
    // optional, and git writes its own `WIP on <branch>` label for it.
    onSave(message.trim() === '' ? null : message, untracked)
    setMessage('')
    setSaving(false)
  }

  return (
    <div className={cls.stashPicker} data-stash-picker="true">
      {stashes === null && <p className={cls.note}>{t('loading')}</p>}
      {stashes !== null && stashes.length === 0 && (
        <p className={cls.note} data-stash-empty="true">
          {t('stash.empty')}
        </p>
      )}
      {(stashes ?? []).map((entry) => {
        const armedHere = armed === entry.oid
        return (
          <div key={entry.oid} className={cls.stashRow} data-armed={String(armedHere)}>
            <div className={cls.stashHead}>
              {/* git's selector, as git printed it: it is what the user sees in a
                  terminal, and the id the panel acts by is the row's own identity
                  rather than something worth reading here. */}
              <span className={cls.stashSelector}>{entry.selector}</span>
              <span className={cls.stashSubject} title={entry.subject}>
                {entry.subject}
              </span>
            </div>
            <div className={cls.stashActions}>
              <button
                type="button"
                className={cls.accent}
                disabled={busy}
                title={t('stash.applyHint', { selector: entry.selector })}
                onClick={() => onApply(entry, false)}
              >
                {t('stash.apply')}
              </button>
              <button
                type="button"
                className={cls.accent}
                disabled={busy}
                title={t('stash.popHint', { selector: entry.selector })}
                onClick={() => onApply(entry, true)}
              >
                {t('stash.pop')}
              </button>
              {!armedHere && (
                <ToolButton
                  label={t('stash.drop', { selector: entry.selector })}
                  disabled={busy}
                  onClick={() => arm(entry.oid)}
                >
                  <TrashGlyph size={13} />
                </ToolButton>
              )}
              {armedHere && (
                // §4.3: between the two clicks the control says what the next one
                // does, in words and in the danger colour.
                <button
                  type="button"
                  className={cls.danger}
                  data-armed="true"
                  disabled={busy}
                  title={t('stash.dropConfirm', { selector: entry.selector })}
                  onClick={() => {
                    reset()
                    onDrop(entry)
                  }}
                >
                  {t('stash.dropArmed')}
                </button>
              )}
            </div>
          </div>
        )
      })}

      <div className={cls.stashCreate}>
        {!saving && (
          // Accent ink: this is the layer's own action, not one of its footnotes —
          // the two inks are kept apart on purpose (see the `.accent` rule).
          <button
            type="button"
            className={cls.accent}
            disabled={busy}
            onClick={() => setSaving(true)}
          >
            {t('stash.save')}
          </button>
        )}
        {saving && (
          <form
            className={cls.stashForm}
            onSubmit={(event) => {
              event.preventDefault()
              submitSave()
            }}
          >
            <input
              className={cls.stashInput}
              value={message}
              autoFocus
              placeholder={t('stash.message')}
              aria-label={t('stash.message')}
              onChange={(event) => setMessage(event.target.value)}
            />
            {/* Not git's default, and stated rather than assumed: `git stash push`
                leaves untracked files alone, so a worktree that still holds them
                is not clean, and a switch blocked by one of them would still be
                blocked after a stash that did not include it. */}
            <label className={cls.stashCheck}>
              <input
                type="checkbox"
                checked={untracked}
                onChange={(event) => setUntracked(event.target.checked)}
              />
              <span>{t('stash.includeUntracked')}</span>
            </label>
            <span className={cls.branchFormActions}>
              <button type="submit" className={cls.primary} disabled={busy}>
                {t('stash.saveSubmit')}
              </button>
              <button
                type="button"
                className={cls.ghost}
                onClick={() => {
                  setSaving(false)
                  setMessage('')
                }}
              >
                {t('stash.saveCancel')}
              </button>
            </span>
          </form>
        )}
      </div>
      <div className={cls.branchFooter}>
        <ToolButton label={t('stash.close')} onClick={onClose}>
          <CloseGlyph size={12} />
        </ToolButton>
      </div>
    </div>
  )
}
