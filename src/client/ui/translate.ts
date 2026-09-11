/**
 * The panel's translator, in its own module.
 *
 * It sits here rather than in `StatusPanel.tsx` because two components need the
 * type and neither should have to import the other: the panel owns the copy, the
 * commit box consumes it, and a shared contract keeps that relationship one-way.
 * Like everything else under `ui/`, it names no DSH type.
 *
 * @module dsh-git-panel/client/ui/translate
 */

import type { GitPanelKey } from '../locales.ts'

/** The panel's translator: one key in, one string out. */
export type Translate = (
  key: GitPanelKey,
  vars?: Readonly<Record<string, string | number>>,
) => string
