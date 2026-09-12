/**
 * The branch picker: switch, create, and delete local branches (FR-4.1–4.3).
 *
 * It is one module rather than three because the three actions share a list and a
 * confirmation rule, and separating them would put the arming state in the panel
 * — where it would have to be threaded back down as props anyway.
 *
 * It is the content of a floating layer (`ui/popover.tsx`), not a block in the
 * panel's column: the list is opened over the changes, so opening it never moves
 * the file list the user was reading. Dismissal (outside press, Escape) belongs
 * to the layer, so it is not repeated here — this module only says what the layer
 * contains.
 *
 * Two behaviours are worth stating, because both are the doc's rather than a
 * convenience:
 *
 * - **The current branch is not switchable and not deletable.** Git refuses both
 *   anyway; the picker disables them instead, so the refusal is visible before
 *   the click rather than after it (§1.3's lesson about discoverability).
 * - **An unmerged branch takes two clicks, the second one forced.** The first
 *   delete is `git branch -d`, which the host refuses with `not-merged`; that
 *   refusal arms the same row as `git branch -D` (FR-4.3's "未合并需强制确认").
 *   Nothing here is a native `confirm` — §4.3 forbids it.
 *
 * @module dsh-git-panel/client/ui/BranchPicker
 */

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'

import type { GitPanelError } from '../../core/ports.ts'
import type { BranchRef } from '../../core/types.ts'
import { useArmedKey } from './armed.ts'
import { ToolButton } from './ChangeGroup.tsx'
import { cls } from './styles.ts'
import type { Translate } from './translate.ts'
import { CheckGlyph, CloseGlyph, TrashGlyph } from './icons.tsx'

/** A delete the host refused, so the row can offer the forced click. */
export interface BranchRefusal {
  /** Branch the refusal was about. */
  readonly name: string
  /** The failure code; only `not-merged` arms the forced click. */
  readonly code: GitPanelError['code']
}

/** Everything the picker renders from. */
export interface BranchPickerProps {
  /** Every local branch, as `git for-each-ref` listed them. */
  readonly branches: readonly BranchRef[]
  /** The panel's copy. */
  readonly t: Translate
  /** True while any operation is in flight. */
  readonly busy: boolean
  /** Switch to an existing branch (FR-4.1). */
  readonly onCheckout: (name: string) => void
  /** Create a branch and switch to it (FR-4.2). */
  readonly onCreate: (name: string, base: string | null) => void
  /** Delete a branch; `force` is the second, armed click (FR-4.3). */
  readonly onDelete: (name: string, force: boolean) => void
  /** The last refused delete, or `null`. */
  readonly refusal: BranchRefusal | null
  /** Close the picker's layer. */
  readonly onClose: () => void
}

/**
 * The branch list with its three actions.
 * @param props - Branches, copy, and the panel's callbacks.
 */
export function BranchPicker({
  branches,
  t,
  busy,
  onCheckout,
  onCreate,
  onDelete,
  refusal,
  onClose,
}: BranchPickerProps): ReactNode {
  const { armed, force, arm, reset } = useArmedKey()
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [base, setBase] = useState('')

  // The host's refusal IS the arming: an unmerged branch has just been refused
  // with `-d`, and the next click is the forced one. Doing it in an effect keeps
  // the picker's own state and the panel's report from having to agree twice.
  useEffect(() => {
    if (refusal === null) return
    if (refusal.code !== 'not-merged') return
    arm(refusal.name, true)
    // `arm` and `reset` are stable; the refusal is the input that matters.
  }, [refusal, arm])

  const submitCreate = (): void => {
    const trimmed = name.trim()
    if (trimmed === '' || busy) return
    onCreate(trimmed, base === '' ? null : base)
    setName('')
    setCreating(false)
  }

  return (
    <div className={cls.branchPicker} data-branch-picker="true">
      {branches.length === 0 && <p className={cls.note}>{t('branch.none')}</p>}
      {branches.map((branch) => {
        const armedHere = armed === branch.name
        return (
          <div
            key={branch.name}
            className={cls.branchRow}
            data-current={String(branch.current)}
            data-armed={String(armedHere)}
          >
            <button
              type="button"
              className={cls.branchPick}
              // A switch to where HEAD already is would be a no-op round trip,
              // and the current row is the list's heading as much as an entry.
              disabled={branch.current || busy}
              title={t('branch.switchTo', { name: branch.name })}
              onClick={() => {
                onClose()
                onCheckout(branch.name)
              }}
            >
              <span className={cls.branchCheck}>
                {branch.current && <CheckGlyph size={11} />}
              </span>
              <span className={cls.branchPickName}>{branch.name}</span>
              {branch.current && <span className={cls.branchTag}>{t('branch.current')}</span>}
            </button>
            {!branch.current && !armedHere && (
              <ToolButton
                label={t('branch.delete', { name: branch.name })}
                disabled={busy}
                onClick={() => arm(branch.name)}
              >
                <TrashGlyph size={13} />
              </ToolButton>
            )}
            {armedHere && (
              // The armed state is words, not a tooltip: §4.3's pattern only
              // works if the second click is visibly a different click.
              <button
                type="button"
                className={cls.danger}
                data-armed="true"
                disabled={busy}
                title={t('branch.deleteConfirm', { name: branch.name })}
                onClick={() => {
                  reset()
                  onDelete(branch.name, force)
                }}
              >
                {force
                  ? t('branch.deleteForceArmed', { name: branch.name })
                  : t('branch.deleteArmed', { name: branch.name })}
              </button>
            )}
          </div>
        )
      })}

      <div className={cls.branchCreate}>
        {!creating && (
          <button type="button" className={cls.ghost} onClick={() => setCreating(true)}>
            {t('branch.create')}
          </button>
        )}
        {creating && (
          <form
            className={cls.branchForm}
            onSubmit={(event) => {
              event.preventDefault()
              submitCreate()
            }}
          >
            <input
              className={cls.branchInput}
              value={name}
              autoFocus
              placeholder={t('branch.createName')}
              aria-label={t('branch.createName')}
              onChange={(event) => setName(event.target.value)}
            />
            {/* FR-4.2's second half: from the current HEAD, or from a branch the
                user picks. A commit hash is offered by the diff/history panes
                rather than here, where a list is what a pointer can work with. */}
            <label className={cls.branchBaseLabel}>
              <span>{t('branch.createBase')}</span>
              <select
                className={cls.branchSelect}
                value={base}
                aria-label={t('branch.createBase')}
                onChange={(event) => setBase(event.target.value)}
              >
                <option value="">{t('branch.createFromHead')}</option>
                {branches.map((branch) => (
                  <option key={branch.name} value={branch.name}>
                    {branch.name}
                  </option>
                ))}
              </select>
            </label>
            <span className={cls.branchFormActions}>
              <button
                type="submit"
                className={cls.primary}
                disabled={busy || name.trim() === ''}
              >
                {t('branch.createSubmit')}
              </button>
              <button
                type="button"
                className={cls.ghost}
                onClick={() => {
                  setCreating(false)
                  setName('')
                }}
              >
                {t('branch.createCancel')}
              </button>
            </span>
          </form>
        )}
      </div>
      <div className={cls.branchFooter}>
        <ToolButton label={t('branch.pickerClose')} onClick={onClose}>
          <CloseGlyph size={12} />
        </ToolButton>
      </div>
    </div>
  )
}
