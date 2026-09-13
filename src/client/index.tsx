/**
 * Browser half entry: assembly only.
 *
 * The public two-stage path a DSH tab type takes, unmodified: the type into
 * `ctx.sidebarRightTabs`, then its body and chip title into the keyed
 * `sidebar.right.pane.tab` and `sidebar.right.pane.tab.title` seats under the
 * type's own `id`. Nothing here decides what the panel looks like or how git is
 * asked anything — this module only states which pieces exist and hands each the
 * port it needs.
 *
 * Every registration is wrapped in `ctx.effect`, so unloading the plugin removes
 * the tab type, its body, its title, and its dictionary together instead of
 * leaving a chip that renders nothing.
 *
 * @module dsh-git-panel/client
 */

import type { Context } from '@deepseek-ai/cordis'
// Side-effect type imports: each merges the service this module uses onto the
// client context (`slots` from the renderer, `sidebarRightTabs` from the sidebar,
// `locale` from the locale plugin).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'

import { createGitRemoteClient } from './adapter/git-client.ts'
import { GitDiffBody } from './adapter/diff-tab-body.tsx'
import { bindGitPanelLocale } from './adapter/locale.ts'
import {
  GIT_DIFF_ID,
  GIT_PANEL_ID,
  GitPanelTitle,
  gitDiffDefinition,
  gitPanelDefinition,
} from './adapter/sidebar-tab.tsx'
import { GitTabBody } from './adapter/tab-body.tsx'
import { NS, en, zh } from './locales.ts'
import { installStyles } from './ui/styles.ts'

/**
 * Browser services required before this plugin may mount.
 *
 * `sidebarRightTabs` is stage one's registry, `slots` owns the seats that stage
 * two registers into, and `locale` carries the dictionaries and the typed `t`.
 */
export const inject = ['slots', 'locale', 'sidebarRightTabs']

/**
 * Mount the panel's browser half.
 * @param ctx - Client root context carrying the tab registry, the slots, and copy.
 */
export function apply(ctx: Context): void {
  // The sheet is installed before anything can render a tab, and installing it
  // is idempotent so a plugin reload replaces rather than stacks it.
  installStyles(document)

  const { t, locale } = bindGitPanelLocale(ctx)
  const git = createGitRemoteClient()

  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-git-panel: dictionaries')

  ctx.effect(
    () => ctx.sidebarRightTabs.register(gitPanelDefinition(t)),
    'dsh-git-panel: git tab type',
  )

  // The diff viewer, registered the same two-stage way. It is a RESOURCE type:
  // the address names the file and the comparison, so the strip holds one tab
  // per reading instead of one chip that overwrites itself.
  ctx.effect(
    () => ctx.sidebarRightTabs.register(gitDiffDefinition(t)),
    'dsh-git-panel: diff tab type',
  )

  ctx.effect(
    () =>
      ctx.slots.inject('sidebar.right.pane.tab', () =>
        ctx.slots.register(
          {
            name: 'sidebar.right.pane.tab',
            key: GIT_PANEL_ID,
            locale: NS,
            // The business face: the pure panel receives this as a plain prop, so
            // no component ever imports the transport.
            inject: () => ({ git, locale }),
          },
          GitTabBody,
        ),
      ),
    'dsh-git-panel: git tab body',
  )

  // The diff body needs no locale tag of its own — it draws no relative times —
  // so the face it receives is the client alone.
  ctx.effect(
    () =>
      ctx.slots.inject('sidebar.right.pane.tab', () =>
        ctx.slots.register(
          { name: 'sidebar.right.pane.tab', key: GIT_DIFF_ID, locale: NS, inject: () => ({ git }) },
          GitDiffBody,
        ),
      ),
    'dsh-git-panel: diff tab body',
  )

  ctx.effect(
    () =>
      ctx.slots.inject('sidebar.right.pane.tab.title', () =>
        ctx.slots.register(
          { name: 'sidebar.right.pane.tab.title', key: GIT_PANEL_ID },
          GitPanelTitle,
        ),
      ),
    'dsh-git-panel: git tab title',
  )
}
