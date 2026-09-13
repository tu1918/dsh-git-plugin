/**
 * DSH adapter: the diff type's `sidebar.right.pane.tab` body.
 *
 * The counterpart of `tab-body.tsx` for one file's diff. A tab of this type is
 * opened at an address built by `sidebar-tab.tsx`, so the body's whole job is to
 * read that address back and hand the resulting path and comparison to the
 * plugin's own pure pane. Nothing is fetched here: `DiffPane` already owns the
 * read, the layout preference, and the fold, so the right-side tab and the dock
 * draw a diff the same way.
 *
 * @module dsh-git-panel/client/adapter/diff-tab-body
 */

import type { ReactNode } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Side-effect imports: each merges the slot declarations this component's props
// type is composed from, exactly as `tab-body.tsx` does.
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'

import type { GitRemoteClient } from '../../core/ports.ts'
import type { NS } from '../locales.ts'
import { DiffPane } from '../ui/DiffView.tsx'
import { cls } from '../ui/styles.ts'
import type { Translate } from '../ui/translate.ts'
import { parseDiffTabAddress } from './sidebar-tab.tsx'

/** The business face the diff type's registration publishes to this body. */
export interface GitDiffTabFace {
  /** The host-facing git client. */
  readonly git: GitRemoteClient
}

/** The composed props the slot runtime delivers. */
export type GitDiffTabBodyProps = PropsRuntime<'sidebar.right.pane.tab'> &
  InjectFace<GitDiffTabFace> &
  PropsLocale<typeof NS>

/**
 * The diff tab body: read the address the tab was opened at, render the pane.
 *
 * Escape closes the TAB here, not a dock summary: `tab.actions.close` is the
 * right-side strip's own close, which is the gesture a reader of a single tab
 * expects.
 * @param props - Composed slot props plus the injected git face.
 */
export function GitDiffBody({
  sessionId,
  git,
  t,
  useTabInfo,
}: GitDiffTabBodyProps): ReactNode {
  const { tab } = useTabInfo()
  const file = parseDiffTabAddress(tab.navigation.address)

  // A tab restored from a layout this plugin no longer understands: it is one of
  // ours (the type claimed the address) but carries nothing to draw. Said out
  // loud rather than left as a blank pane.
  if (file === null) {
    return (
      <div className={cls.diffView} data-diff-state="failed">
        <p className={cls.diffState}>{t('diffTab.missing')}</p>
      </div>
    )
  }

  return (
    <DiffPane
      sessionId={sessionId}
      path={file.path}
      target={file.target}
      git={git}
      // The slot's own `t` re-reads on every call, so a language switch reaches
      // an already-open tab without a re-registration.
      t={t as Translate}
      signal={tab.signal}
      // A hidden tab (another chip is on screen) must not answer Escape: every
      // mounted body listening would close all of them at once.
      active={tab.visible}
      onClose={() => tab.actions.close()}
    />
  )
}
