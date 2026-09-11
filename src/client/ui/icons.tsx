/**
 * The panel's glyphs, drawn inline.
 *
 * Deliberately inline rather than imported from the UI primitives package: the
 * client bundle's externals are resolved against the browser's frozen module
 * table, and the fewer of them this bundle needs, the fewer ways it can fail to
 * load in a user's browser. Each glyph draws on `currentColor`, so it takes its
 * ink from whatever token the surrounding element already set.
 *
 * @module dsh-git-panel/client/ui/icons
 */

import type { ReactNode } from 'react'

/** Props every glyph here accepts. */
export interface GlyphProps {
  /** Rendered size in CSS pixels; the glyph is square. */
  readonly size?: number
  /** Extra class applied to the `svg`. */
  readonly className?: string
}

/** Shared `svg` attributes: one stroke convention for every glyph. */
function stroke(size: number, className: string | undefined, children: ReactNode): ReactNode {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.3}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  )
}

/**
 * A branch: the fork git draws in every graph.
 * @param props - Size and class.
 */
export function BranchGlyph({ size = 14, className }: GlyphProps): ReactNode {
  return stroke(
    size,
    className,
    <>
      <circle cx="4.5" cy="3.5" r="1.6" />
      <circle cx="4.5" cy="12.5" r="1.6" />
      <circle cx="11.5" cy="6.5" r="1.6" />
      <path d="M4.5 5.1v5.8" />
      <path d="M11.5 8.1c0 2-1.6 2.6-3.4 2.9" />
      <path d="M4.5 8.1h4.2a2.8 2.8 0 0 0 2.8-2.8" />
    </>,
  )
}

/**
 * A circular arrow: reload.
 * @param props - Size and class.
 */
export function RefreshGlyph({ size = 14, className }: GlyphProps): ReactNode {
  return stroke(
    size,
    className,
    <>
      <path d="M13 8a5 5 0 1 1-1.6-3.7" />
      <path d="M13 2.6V5.4h-2.8" />
    </>,
  )
}

/**
 * An arrow pointing up: commits to send.
 * @param props - Size and class.
 */
export function ArrowUpGlyph({ size = 12, className }: GlyphProps): ReactNode {
  return stroke(size, className, <path d="M8 12.5V3.8M4.6 7.2 8 3.8l3.4 3.4" />)
}

/**
 * An arrow pointing down: commits to receive.
 * @param props - Size and class.
 */
export function ArrowDownGlyph({ size = 12, className }: GlyphProps): ReactNode {
  return stroke(size, className, <path d="M8 3.5v8.7M4.6 8.8 8 12.2l3.4-3.4" />)
}

/**
 * A caret pointing right; rotated by CSS when a section opens.
 * @param props - Size and class.
 */
export function CaretGlyph({ size = 12, className }: GlyphProps): ReactNode {
  return stroke(size, className, <path d="M6.2 3.8 10.4 8l-4.2 4.2" />)
}

/**
 * A plus: stage.
 * @param props - Size and class.
 */
export function PlusGlyph({ size = 13, className }: GlyphProps): ReactNode {
  return stroke(size, className, <path d="M8 3.6v8.8M3.6 8h8.8" />)
}

/**
 * A minus: unstage.
 * @param props - Size and class.
 */
export function MinusGlyph({ size = 13, className }: GlyphProps): ReactNode {
  return stroke(size, className, <path d="M3.6 8h8.8" />)
}

/**
 * A tick, used for the current branch and for bulk actions.
 * @param props - Size and class.
 */
export function CheckGlyph({ size = 13, className }: GlyphProps): ReactNode {
  return stroke(size, className, <path d="M3.4 8.4 6.4 11.4 12.6 4.9" />)
}

/**
 * A filled dot: a commit's pushed state.
 * @param props - Size and class.
 */
export function DotGlyph({ size = 10, className }: GlyphProps): ReactNode {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 10 10"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="5" cy="5" r="3.2" fill="currentColor" />
    </svg>
  )
}

/**
 * A hollow ring: the counterpart to {@link DotGlyph}.
 * @param props - Size and class.
 */
export function RingGlyph({ size = 10, className }: GlyphProps): ReactNode {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 10 10"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="5" cy="5" r="2.7" fill="none" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  )
}

/**
 * Two arrows swapping: the branch's relation to its upstream.
 * @param props - Size and class.
 */
export function SyncGlyph({ size = 13, className }: GlyphProps): ReactNode {
  return stroke(
    size,
    className,
    <>
      <path d="M4 5.5h7.2M9 3.3l2.2 2.2L9 7.7" />
      <path d="M12 10.5H4.8M7 8.3 4.8 10.5 7 12.7" />
    </>,
  )
}

/**
 * A cross: dismiss.
 * @param props - Size and class.
 */
export function CloseGlyph({ size = 12, className }: GlyphProps): ReactNode {
  return stroke(size, className, <path d="M4.4 4.4 11.6 11.6M11.6 4.4 4.4 11.6" />)
}
