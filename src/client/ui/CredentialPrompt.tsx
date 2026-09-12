/**
 * The form a failed HTTPS operation grows (see `error.authRequired`).
 *
 * The host runs git with `GIT_TERMINAL_PROMPT=0`, so an HTTPS remote with no
 * stored credential cannot ask anyone for one and fails instead of hanging. This
 * is where the panel asks, inside the same failure notice that reports the
 * refusal — never a modal (§4.1), and never a native `confirm`.
 *
 * The form is deliberately small and forgetful: two fields, a submit, a cancel.
 * What happens to the values after submit is the panel's business — it hands
 * them to the host, which stores them through the harness's credential seam and
 * retries the operation that failed.
 *
 * @module dsh-git-panel/client/ui/CredentialPrompt
 */

import { useState } from 'react'
import type { ReactNode } from 'react'

import { cls } from './styles.ts'
import type { Translate } from './translate.ts'

/** What the form is given. */
export interface CredentialPromptProps {
  /** The origin git named, shown so the user can check what they are typing into. */
  readonly remote: string
  /** The panel's copy. */
  readonly t: Translate
  /** True while a request is in flight, which disables both buttons. */
  readonly busy: boolean
  /** Hand the typed pair to the panel, which stores it and retries. */
  readonly onSubmit: (username: string, password: string) => void
  /** Dismiss the form without storing anything. */
  readonly onCancel: () => void
}

/**
 * The credential form.
 * @param props - The origin, the copy, and what the buttons do.
 */
export function CredentialPrompt({
  remote,
  t,
  busy,
  onSubmit,
  onCancel,
}: CredentialPromptProps): ReactNode {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const ready = username !== '' && password !== ''

  return (
    <form
      className={cls.credential}
      data-credential={remote}
      onSubmit={(event) => {
        event.preventDefault()
        if (!ready || busy) return
        onSubmit(username, password)
      }}
    >
      <p className={cls.credentialHead}>{t('credential.title', { remote })}</p>
      <label className={cls.credentialLabel}>
        <span>{t('credential.username')}</span>
        <input
          className={cls.credentialInput}
          value={username}
          autoFocus
          autoComplete="off"
          aria-label={t('credential.username')}
          onChange={(event) => setUsername(event.target.value)}
        />
      </label>
      <label className={cls.credentialLabel}>
        <span>{t('credential.password')}</span>
        <input
          className={cls.credentialInput}
          type="password"
          value={password}
          autoComplete="off"
          aria-label={t('credential.password')}
          onChange={(event) => setPassword(event.target.value)}
        />
      </label>
      <span className={cls.credentialActions}>
        <button type="submit" className={cls.primary} disabled={busy || !ready}>
          {t('credential.save')}
        </button>
        <button type="button" className={cls.ghost} disabled={busy} onClick={onCancel}>
          {t('credential.cancel')}
        </button>
      </span>
    </form>
  )
}
