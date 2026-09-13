/**
 * DSH adapter: the tab types' identities, the panel's guide entry and chip
 * title, and the diff viewer's address codec.
 *
 * Stage one of DSH's two-stage tab registration lives here — what each type IS —
 * along with the chip title that draws the panel. The bodies (stage two) are
 * registered from `client/index.tsx` beside this.
 *
 * Two types, two shapes. The panel is a PAGE type: it recognizes no resource
 * address, because a panel over the session's repository is not a viewer for any
 * file, and it is reached the way the built-in Files tab is — by its guide entry.
 * The diff viewer is a RESOURCE type: it recognizes the addresses
 * {@link diffTabAddress} builds, which is what gives every open file its own tab
 * and every reading of it its own chip.
 *
 * @module dsh-git-panel/client/adapter/sidebar-tab
 */

import type { ReactNode } from 'react'
import type { SidebarRightTabDefinition } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'

import { pathParts } from '../../core/format.ts'
import { diffTargetFromKey, diffTargetKey } from '../../core/diff-target.ts'
import type { DiffTarget } from '../../core/types.ts'
import { BranchGlyph, type GlyphProps } from '../ui/icons.tsx'
import { cls } from '../ui/styles.ts'

/** The tab kind this package owns; what `openTab` would name. */
export const GIT_PANEL_KIND = 'git-panel'

/**
 * This implementation's identity in the tab system, and the key its body and
 * title register under. A package name is the natural value.
 */
export const GIT_PANEL_ID = 'dsh-git-panel'

/**
 * The diff viewer's tab kind.
 *
 * A RESOURCE type rather than a page: resource tabs are claimed by address and
 * deduplicate on (kind, address), so putting the path and the comparison in the
 * address is what gives one file — and one file read one way — its own tab. A
 * page type records every tab of its kind at one address, which collapses every
 * diff into a single chip.
 */
export const GIT_DIFF_KIND = 'git-diff'

/** The diff viewer's registration id; the key its body registers under. */
export const GIT_DIFF_ID = 'dsh-git-panel-diff'

/**
 * The scheme-and-type prefix of every diff address.
 *
 * `/` after the type and between the two segments, so the address parses back
 * without a query string: a diff address is an identity, and a chip title is
 * read from it. The type segment must match {@link GIT_DIFF_KIND}, because the
 * resource model reads the segment after `dsh-resource://` as the protocol.
 */
const GIT_DIFF_ADDRESS_PREFIX = `dsh-resource://${GIT_DIFF_KIND}/`

/** The minimum a diff address needs; `OpenFile` satisfies it structurally. */
export interface DiffTabSubject {
  /** Repo-relative path. */
  readonly path: string
  /** Which comparison the tab reads. */
  readonly target: DiffTarget
}

/**
 * The address one open diff is recorded under.
 *
 * Both halves are percent-encoded, so a path with a slash, a space or a `#`
 * stays ONE segment and the target key never collides with the separator. The
 * address is the tab's whole identity — the body parses it back rather than
 * reading parameters — which is what lets a tab restored by undo, whose opener's
 * parameters are gone, still know what it shows.
 * @param file - The path and the comparison to read it with.
 * @returns The resource address to open.
 */
export function diffTabAddress(file: DiffTabSubject): string {
  return `${GIT_DIFF_ADDRESS_PREFIX}${encodeURIComponent(diffTargetKey(file.target))}/${encodeURIComponent(file.path)}`
}

/**
 * Read back what an address opened.
 *
 * The inverse of {@link diffTabAddress}, and tolerant by design: an address that
 * is not one of ours, or whose target key is not one {@link diffTargetFromKey}
 * names, returns `null` rather than a half-built subject.
 * @param address - An address a tab record was opened at.
 * @returns The subject, or `null` when the address is not a diff address.
 */
export function parseDiffTabAddress(address: string): DiffTabSubject | null {
  if (!address.startsWith(GIT_DIFF_ADDRESS_PREFIX)) return null
  const rest = address.slice(GIT_DIFF_ADDRESS_PREFIX.length)
  const separator = rest.indexOf('/')
  if (separator < 0) return null
  let target: DiffTarget | null
  let path: string
  try {
    target = diffTargetFromKey(decodeURIComponent(rest.slice(0, separator)))
    path = decodeURIComponent(rest.slice(separator + 1))
  } catch {
    // A malformed percent escape is not a diff address either.
    return null
  }
  if (target === null || path === '') return null
  return { path, target }
}

/** Whether an address is one this package's diff viewer can draw. */
function isDiffAddress(address: string): boolean {
  return parseDiffTabAddress(address) !== null
}

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
 * The diff viewer's static definition.
 *
 * No guide entry: a diff is opened from the change list or from the dock it was
 * promoted out of, never picked off the guide page — there is no file to name
 * before one has been chosen.
 * @param t - Namespace-bound translate, read fresh on every title call.
 * @returns The definition to register.
 */
export function gitDiffDefinition(t: TranslateNS<'gitPanel'>): SidebarRightTabDefinition {
  return {
    id: GIT_DIFF_ID,
    kind: GIT_DIFF_KIND,
    // Recognized by address, which is what makes the strip hold one tab per file
    // and per comparison; the type never claims an address it cannot read.
    patterns: [`${GIT_DIFF_ADDRESS_PREFIX}**`],
    priority: 'extension',
    canOpen: isDiffAddress,
    // The chip is the file's name: the directory is what the body's own header
    // shows in full, and a strip of `src/a.ts` and `lib/a.ts` would be two chips
    // the reader cannot tell apart.
    title: (address) => {
      const file = parseDiffTabAddress(address)
      return file === null ? t('type.diffLabel') : pathParts(file.path).name
    },
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
