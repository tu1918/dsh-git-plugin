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

import type { FileKind } from '../../core/file-kind.ts'

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

/**
 * A waste bin: delete a branch (FR-4.3).
 *
 * The only glyph here that stands for an irreversible action, which is why the
 * button it sits in is one that arms rather than fires.
 * @param props - Size and class.
 */
export function TrashGlyph({ size = 13, className }: GlyphProps): ReactNode {
  return stroke(
    size,
    className,
    <>
      <path d="M3.2 4.6h9.6" />
      <path d="M6.4 4.6V3.4h3.2v1.2" />
      <path d="M4.6 4.6l.6 8h5.6l.6-8" />
      <path d="M6.8 7v3.4M9.2 7v3.4" />
    </>,
  )
}

/**
 * An arrow pointing backwards with a hooked tail: discard the change (FR-6.1).
 *
 * A hook that ends pointing left, never closing into a loop: a closed loop reads
 * as "reload" (see {@link RefreshGlyph}), this control is undo, not retry. Not
 * the bin {@link TrashGlyph} draws either: this button reverts a tracked file's
 * edits, where nothing is deleted at all, and only an untracked file is actually
 * removed. A bin would be true for half of its clicks.
 * @param props - Size and class.
 */
export function DiscardGlyph({ size = 14, className }: GlyphProps): ReactNode {
  return stroke(
    size,
    className,
    <>
      <path d="M6.8 7.2 3.2 10.4l3.6 3.2" />
      <path d="M3.5 10.4h4.8c2.8 0 4.5-1.2 4.5-3.4 0-2.3-1.9-3.4-4.3-3.4H7.7" />
    </>,
  )
}

/**
 * A four-pointed star: generate the message with the model (FR-3.5).
 *
 * The doc draws this control as `✨`, and the shape is what makes it read as
 * "written for you" rather than as one more git action.
 * @param props - Size and class.
 */
export function SparkleGlyph({ size = 13, className }: GlyphProps): ReactNode {
  return stroke(
    size,
    className,
    <>
      <path d="M6.2 2.6l1.1 2.9 2.9 1.1-2.9 1.1-1.1 2.9-1.1-2.9L2.2 6.6l2.9-1.1z" />
      <path d="M11.6 9.2l.6 1.5 1.5.6-1.5.6-.6 1.5-.6-1.5-1.5-.6 1.5-.6z" />
    </>,
  )
}

/**
 * Two columns: the side-by-side diff layout (FR-2.4).
 *
 * Deliberately a picture of the layout it selects rather than a generic "view
 * options" icon: the two layout buttons are the only way to tell the modes
 * apart, and a glyph that draws the result is readable without a tooltip.
 * @param props - Size and class.
 */
export function SplitGlyph({ size = 13, className }: GlyphProps): ReactNode {
  return stroke(
    size,
    className,
    <>
      <rect x="2.4" y="3.4" width="11.2" height="9.2" rx="1.4" />
      <path d="M8 3.4v9.2" />
    </>,
  )
}

/**
 * A file tree: nested rows with a disclosure arrow (FR-1.3).
 *
 * It draws the layout it selects, like {@link SplitGlyph} does for the diff, so
 * the toggle is readable without its tooltip.
 * @param props - Size and class.
 */
export function TreeGlyph({ size = 13, className }: GlyphProps): ReactNode {
  return stroke(
    size,
    className,
    <>
      <path d="M2.6 3.6h4.2M4.6 8h4.2M6.6 12.4h4.2" />
      <path d="M2.6 3.6v8.8" />
      <path d="M4.6 8v4.4" />
    </>,
  )
}

/**
 * A flat list: one row per file, no hierarchy (FR-1.3's other mode).
 * @param props - Size and class.
 */
export function ListGlyph({ size = 13, className }: GlyphProps): ReactNode {
  return stroke(
    size,
    className,
    <>
      <path d="M2.6 4h10.8M2.6 8h10.8M2.6 12h10.8" />
    </>,
  )
}

/**
 * A box with its lid open and a slot in front: the stash (FR-6.2).
 *
 * Drawn as a container rather than as a stack of papers, because what the control
 * does is put work AWAY and keep it — a "documents" glyph would read as the file
 * list right below it. It is deliberately not the bin {@link TrashGlyph}: the
 * stash's own destructive action is dropping one entry, and that is the entry's
 * button, not this one.
 * @param props - Size and class.
 */
export function StashGlyph({ size = 14, className }: GlyphProps): ReactNode {
  return stroke(
    size,
    className,
    <>
      <path d="M2.4 3.4h11.2v2.4H2.4z" />
      <path d="M3.6 5.8v6.8h8.8V5.8" />
      <path d="M6.4 8.4h3.2" />
    </>,
  )
}

/**
 * The page every file-kind glyph is drawn on: the body and its folded corner.
 *
 * One outline, one mark per kind — the shape a reader learns once and then reads
 * at a glance, the way an editor's file-icon theme works. The mark always lives in
 * the lower half (x 5–11, y 8–13) so the kinds line up as a column.
 */
const FILE_PAGE = (
  <>
    <path d="M3.8 2.2h5.1l3.3 3.3v8.3H3.8z" />
    <path d="M8.9 2.2v3.3h3.3" />
  </>
)

/** What each kind draws on that page; `file` deliberately draws nothing. */
const FILE_MARKS: Readonly<Record<FileKind, ReactNode>> = {
  // The two brackets a language is read through.
  code: (
    <>
      <path d="M7.2 8.4 5.8 10.4l1.4 2" />
      <path d="M8.8 8.4l1.4 2-1.4 2" />
    </>
  ),
  // A tag: what the file IS, rather than what it is written in. Kept clear of the
  // page's own right edge (12.2) so the two outlines never read as one stroke.
  markup: (
    <>
      <path d="M7.6 8.8h2.6l1.2 1.6-1.2 1.6H7.6l-1.2-1.6z" />
      <circle cx="7.8" cy="10.4" r=".6" />
    </>
  ),
  // A hash: the selector a stylesheet is addressed by.
  style: <path d="M6.6 8.2l-.7 4.4M10.1 8.2l-.7 4.4M5.2 9.6h5.6M4.9 11.4h5.6" />,
  // A grid: the shape of anything structured.
  data: (
    <>
      <path d="M5.4 8.6h5.2v4.6H5.4z" />
      <path d="M5.4 10.9h5.2M8 8.6v4.6" />
    </>
  ),
  // A horizon and a sun, in no frame: the frame is what the data grid already is.
  image: (
    <>
      <path d="M5 12.8l2-2.4 1.4 1.5 1.1-1.1 1.5 2z" />
      <circle cx="6.6" cy="9.1" r=".9" />
    </>
  ),
  // Prose: three lines, the last one short.
  doc: <path d="M5.6 8.8h4.8M5.6 10.6h4.8M5.6 12.4h2.8" />,
  // A prompt and a cursor.
  shell: (
    <>
      <path d="M5.8 8.8 7.4 10.4l-1.6 1.6" />
      <path d="M8.8 12.2h2.4" />
    </>
  ),
  // Sliders: the settings the file holds, rather than data it holds.
  config: (
    <>
      <path d="M5.2 9h5.6M5.2 12h5.6" />
      <circle cx="7" cy="9" r=".9" />
      <circle cx="9.6" cy="12" r=".9" />
    </>
  ),
  // Nothing: "I do not know" should look like a plain file, not like a guess.
  file: null,
}

/** Props for {@link FileKindGlyph}. */
export interface FileKindGlyphProps extends GlyphProps {
  /** Which file kind to draw. */
  readonly kind: FileKind
}

/**
 * The glyph for one changed file's kind, drawn where the row's badge used to sit.
 *
 * @param props - The kind, the size, and an extra class.
 */
export function FileKindGlyph({ kind, size = 14, className }: FileKindGlyphProps): ReactNode {
  return stroke(
    size,
    className,
    <>
      {FILE_PAGE}
      {FILE_MARKS[kind]}
    </>,
  )
}

/**
 * The panel's spinner, as an inline SVG.
 *
 * The CSS spinner is a styled `span`; this one exists for places that need the
 * glyph inside a flex row whose children are all boxes (the diff header's tool
 * buttons, which are `<button>` elements and cannot nest a rotating pseudo
 * element). Both spin with the same keyframes, so a reload looks the same
 * wherever it is started.
 * @param props - Size and class.
 */
export function SpinnerGlyph({ size = 13, className }: GlyphProps): ReactNode {
  return stroke(
    size,
    className,
    <path d="M13 8a5 5 0 1 1-1.6-3.7" strokeLinecap="round" />,
  )
}
