/**
 * The two-click confirmation §4.3 asks for, as a hook.
 *
 * The doc's rule is that an irreversible action is armed by a first click and
 * executed by a second one within three seconds — never a native `confirm`,
 * which blocks the whole GUI and cannot be styled. The timer is what makes the
 * arming expire: a button left armed is a button that deletes something on the
 * next stray click.
 *
 * The key is generic because the same pattern covers both a lone button (an
 * abort) and a list of them (one per branch): with a key, arming one row
 * disarms the others, which is what a user expects from a list.
 *
 * `force` is the other half of FR-4.3. An unmerged branch is refused by the host
 * with the `not-merged` code, and the panel's answer is the same click again —
 * but armed as the *forced* variant. Keeping that flag next to the key means the
 * armed row can say which of the two deletions the next click will perform.
 *
 * @module dsh-git-panel/client/ui/armed
 */

import { useCallback, useEffect, useState } from 'react'

/** How long an armed control stays armed (§4.3: within three seconds). */
export const ARM_TIMEOUT_MS = 3_000

/** One armed control's state and the calls that drive it. */
export interface ArmedState {
  /** The armed key, or `null` when nothing is armed. */
  readonly armed: string | null
  /** Whether the armed click is the forced variant. */
  readonly force: boolean
  /**
   * Arm this key, replacing whatever was armed.
   * @param key - Identity of the control being armed.
   * @param force - Whether the next click performs the forced action.
   */
  readonly arm: (key: string, force?: boolean) => void
  /** Disarm immediately — after the action ran, or when the panel changes. */
  readonly reset: () => void
}

/**
 * Track which key is currently armed.
 *
 * Expiry is driven by an effect on the state rather than by a timer stored beside
 * it, so re-arming the same key restarts the window instead of being swallowed by
 * the timer already running.
 * @param timeoutMs - How long the arming lasts.
 * @returns The armed key, its force flag, and the calls that drive them.
 */
export function useArmedKey(timeoutMs: number = ARM_TIMEOUT_MS): ArmedState {
  const [state, setState] = useState<{ key: string; force: boolean } | null>(null)

  useEffect(() => {
    if (state === null) return
    const timer = setTimeout(() => setState(null), timeoutMs)
    return () => clearTimeout(timer)
  }, [state, timeoutMs])

  const arm = useCallback((key: string, force = false) => setState({ key, force }), [])
  const reset = useCallback(() => setState(null), [])
  return { armed: state?.key ?? null, force: state?.force ?? false, arm, reset }
}
