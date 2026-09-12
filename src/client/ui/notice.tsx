/**
 * A floating notice: one thing the panel just did, said over the panel and then
 * taken away.
 *
 * ## Why a layer rather than a line in the column
 *
 * The feedback used to be two bands in the column — a success line and a failure
 * box, each taking a row above the change list. Every one of them pushed the list,
 * the commit box and the dock down for as long as it was on screen, and the list
 * is the panel's subject: an operation's own report should not move the thing the
 * user is about to click. Floating it over the top of the panel (under the rail)
 * costs the list nothing, and the notice is the only thing on screen that wants to
 * be read right now.
 *
 * It is a LAYER, not a modal: nothing is blocked, the list stays live underneath,
 * and pressing anywhere else does not dismiss it (that is `ui/popover.tsx`'s
 * contract, and it is wrong for a notice — a notice is not a choice the user is
 * making). Only the ×, or the clock for a success, takes it away.
 *
 * ## Two lifetimes, one component
 *
 * `durationMs` is the caller's decision and it is the whole difference between the
 * two cases:
 *
 * - **Success: it goes by itself.** The panel's default is
 *   {@link NOTICE_DURATION_MS}; a future settings entry may change what the panel
 *   passes, which is why the number is a prop rather than baked in here.
 * - **Failure: it waits.** git's refusal is multi-line, it is the explanation of
 *   why the click did nothing, and FR-4.4 asks for those words verbatim — a
 *   message that vanishes while it is being read is worse than no message. A
 *   failed notice may also carry controls (`children`), such as FR-4.4's
 *   "stash, then switch" shortcut, which must not disappear from under the
 *   pointer. `null` therefore means "until dismissed".
 *
 * Re-running the timer is keyed on the notice's own text, so a notice replaced by
 * a different one gets its full time; a re-render that says the same thing does
 * not restart the clock. The caller must pass a STABLE `onDismiss`, or every
 * re-render would restart it.
 *
 * @module dsh-git-panel/client/ui/notice
 */

import { useEffect } from 'react'
import type { ReactNode } from 'react'

import { lineCount } from '../../core/format.ts'
import { cls } from './styles.ts'
import { CloseGlyph } from './icons.tsx'

/**
 * How long a successful notice stays, in milliseconds.
 *
 * Long enough to read a sentence such as "Committed a1b2c3: fix the thing", short
 * enough not to sit in front of the list. The panel passes this for successes; a
 * failure passes `null` instead (see the module doc).
 */
export const NOTICE_DURATION_MS = 4000

/** Everything one notice renders from. */
export interface NoticeProps {
  /** Whether this reports something that worked or something that did not. */
  readonly kind: 'success' | 'error'
  /**
   * Which operation this reports.
   *
   * It is what `data-action-done` / `data-action-error` carry, so a notice can be
   * found by the operation it belongs to rather than by position.
   */
  readonly op: string
  /** The sentence itself. */
  readonly title: string
  /**
   * An optional kicker above the title.
   *
   * The failure case uses it for "Pull · failed", so the reason below reads as the
   * reason for THAT operation.
   */
  readonly label?: string
  /** git's own output, verbatim and multi-line (FR-4.4). */
  readonly detail?: string
  /** Extra controls under the words, such as FR-4.4's blocked-switch shortcut. */
  readonly children?: ReactNode
  /**
   * How long it stays before closing itself, or `null` to wait for the ×.
   *
   * See the module doc for which case is which.
   */
  readonly durationMs: number | null
  /** Close it. Must be stable across renders, or the timer restarts each one. */
  readonly onDismiss: () => void
  /** Accessible name for the ×. */
  readonly dismissLabel: string
}

/**
 * One floating notice.
 * @param props - What it says, how long it stays, and how it goes away.
 */
export function Notice({
  kind,
  op,
  title,
  label,
  detail,
  children,
  durationMs,
  onDismiss,
  dismissLabel,
}: NoticeProps): ReactNode {
  // The notice's own identity, as the timer's dependency: a notice whose words
  // changed is a new thing to read and gets its full time again, while a render
  // that repeats the same words does not restart the clock. `onDismiss` is in the
  // list only because eslint's exhaustive-deps would want it; the contract says it
  // is stable.
  useEffect(() => {
    if (durationMs === null) return
    const timer = setTimeout(onDismiss, durationMs)
    return () => clearTimeout(timer)
  }, [durationMs, onDismiss, kind, title, label, detail])

  // `Boolean`, not `!== undefined`: a caller that conditionally renders a control
  // passes `false` when it does not want one, and an empty scrolling band under
  // the words would be a seam that says nothing.
  const body = detail !== undefined || Boolean(children)
  return (
    <div
      className={cls.notice}
      data-notice={kind}
      // A success is an announcement; a failure interrupts. The roles say which
      // one a screen reader should hear without being asked.
      role={kind === 'error' ? 'alert' : 'status'}
      {...(kind === 'error' ? { 'data-action-error': op } : { 'data-action-done': op })}
    >
      <div className={cls.noticeHead}>
        <div className={cls.noticeLines}>
          {label !== undefined && <p className={cls.actionLabel}>{label}</p>}
          <p className={cls.noticeLine}>{title}</p>
        </div>
        <button
          type="button"
          className={cls.tool}
          title={dismissLabel}
          aria-label={dismissLabel}
          onClick={onDismiss}
        >
          <CloseGlyph />
        </button>
      </div>
      {body && (
        <div className={cls.noticeBody}>
          {detail !== undefined && detail !== '' && (
            // `cls.note` because a git diagnostic keeps its own newlines and mono
            // face there (FR-4.4); `noticeDetail` only takes that class's padding
            // away, which the card supplies itself.
            <p
              className={`${cls.note} ${cls.noticeDetail}`}
              data-multiline={String(lineCount(detail) > 1)}
            >
              {detail}
            </p>
          )}
          {children}
        </div>
      )}
    </div>
  )
}
