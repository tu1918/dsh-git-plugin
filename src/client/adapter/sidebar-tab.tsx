/**
 * DSH adapter: the tab type's identity, its guide entry, and its chip title.
 *
 * Stage one of DSH's two-stage tab registration lives here — what the type IS —
 * along with the chip title that draws it. The body (stage two) is registered
 * from `client/index.tsx` beside this.
 *
 * The type is a PAGE type: it recognizes no resource address, because a panel
 * over the session's repository is not a viewer for any file. It is reached the
 * way the built-in Files tab is — by its guide entry — which is why this entry's
 * copy matters more here than a viewer's would.
 *
 * @module dsh-git-panel/client/adapter/sidebar-tab
 */

import type { ReactNode } from 'react'
import type { SidebarRightTabDefinition } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'

import { BranchGlyph, type GlyphProps } from '../ui/icons.tsx'
import { cls } from '../ui/styles.ts'

/** The tab kind this package owns; what `openTab` would name. */
export const GIT_PANEL_KIND = 'git-panel'

/**
 * This implementation's identity in the tab system, and the key its body and
 * title register under. A package name is the natural value.
 */
export const GIT_PANEL_ID = 'dsh-git-panel'

/** The guide entry's position among every registered type's entries. */
const GUIDE_ORDER = 20

/** The guide capsule's glyph: the same branch mark the chip and rail draw. */
function GitGuideGlyph({ size, className }: GlyphProps): ReactNode {
  return <BranchGlyph size={size} className={className} />
}

/**
 * The type's static definition.
 * @param t - Namespace-bound translate, read fresh on every title call.
 * @returns The definition to register.
 */
export function gitPanelDefinition(t: TranslateNS<'gitPanel'>): SidebarRightTabDefinition {
  return {
    id: GIT_PANEL_ID,
    kind: GIT_PANEL_KIND,
    // A type from outside the product. Stated rather than left to the default so
    // the intent survives a future change to that default.
    priority: 'extension',
    title: () => t('type.label'),
    guide: [
      {
        order: GUIDE_ORDER,
        title: () => t('guide.title'),
        description: () => t('guide.description'),
        icon: GitGuideGlyph,
      },
    ],
  }
}

/**
 * The chip title: the branch mark followed by the tab's label.
 * @param props - The tab information hook.
 */
export function GitPanelTitle({
  useTabInfo,
}: PropsRuntime<'sidebar.right.pane.tab.title'>): ReactNode {
  const { tab } = useTabInfo()
  return (
    <>
      <BranchGlyph className={cls.branchGlyph} />
      {tab.title}
    </>
  )
}
