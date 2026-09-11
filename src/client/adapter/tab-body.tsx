/**
 * DSH adapter: the `sidebar.right.pane.tab` body seat.
 *
 * The whole job of this module is translation. It receives the four shares the
 * slot runtime hands a tab body — the owner's share, the keyed seat, the session
 * standard kit, and the locale seat — plus the business face registered alongside
 * it, and renders the plugin's own pure component with plain props.
 *
 * That split is what keeps `client/ui/` free of DSH: the panel never sees
 * `useTabInfo`, never receives a branded session id, and never learns that a
 * `t` here began life as `ctx.locale.bind('gitPanel')`.
 *
 * @module dsh-git-panel/client/adapter/tab-body
 */

import type { ReactNode } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Side-effect imports: each merges the slot declarations this component's props
// type is composed from. `ui-session` supplies `sessionId`, `ui-sidebar-right`
// declares the seat and its `useTabInfo` hook.
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'

import type { GitRemoteClient } from '../../core/ports.ts'
import { StatusPanel, type Translate } from '../ui/StatusPanel.tsx'
import type { NS } from '../locales.ts'

/** The business face the registration publishes to this body. */
export interface GitTabFace {
  /** The host-facing git client. */
  readonly git: GitRemoteClient
  /** BCP-47 tag of the locale in force when the tab opened. */
  readonly locale: string
}

/** The composed props the slot runtime delivers. */
export type GitTabBodyProps = PropsRuntime<'sidebar.right.pane.tab'> &
  InjectFace<GitTabFace> &
  PropsLocale<typeof NS>

/**
 * The tab body: unwrap the DSH props, render the panel.
 * @param props - Composed slot props plus the injected git face.
 */
export function GitTabBody({ sessionId, git, locale, t, useTabInfo }: GitTabBodyProps): ReactNode {
  const { tab } = useTabInfo()
  return (
    <StatusPanel
      sessionId={sessionId}
      git={git}
      // The slot's own `t` is namespace-bound and re-reads on every call, so a
      // language switch reaches the panel without a re-registration.
      t={t as Translate}
      locale={locale}
      signal={tab.signal}
    />
  )
}
