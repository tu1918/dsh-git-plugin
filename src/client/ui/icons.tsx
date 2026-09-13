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
 * A dashed arrow pointing down: fetch, which receives refs without merging them.
 *
 * Dashed rather than plain so it reads as a different action from Pull beside it
 * (the two are both "something comes down"); what it brings down is knowledge of
 * the remote, not changes to the working tree.
 * @param props - Size and class.
 */
export function FetchGlyph({ size = 13, className }: GlyphProps): ReactNode {
  return stroke(
    size,
    className,
    <>
      <path d="M8 3.4v8.8" strokeDasharray="2.4 2.4" />
      <path d="M4.7 8.7 8 12l3.3-3.3" strokeDasharray="2.4 2.4" />
    </>,
  )
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
 * Two sheets, one behind the other: take a copy of a value.
 *
 * The toolbar's five copying entries all draw this: the mark answers "what kind
 * of thing is this entry", and the label beside it answers which value. Five
 * variations on a sheet would be five pictures nobody can tell apart.
 * @param props - Size and class.
 */
export function CopyGlyph({ size = 13, className }: GlyphProps): ReactNode {
  return stroke(
    size,
    className,
    <>
      <rect x="3" y="5.4" width="6.6" height="7.6" rx="1.1" />
      <path d="M5.8 5.4V4.2c0-.7.5-1.2 1.2-1.2h4.6c.7 0 1.2.5 1.2 1.2v4.6c0 .7-.5 1.2-1.2 1.2h-1.2" />
    </>,
  )
}

/**
 * A commit and an arrow leaving it backwards: revert this commit (order 9).
 *
 * The dot is the commit being reversed and the arrow is the new one that undoes
 * it, which is the one thing about revert worth drawing — history is not
 * rewritten, something is added to it. Deliberately not a closed loop, which
 * would read as "reload" (see {@link DiscardGlyph} for the same warning).
 * @param props - Size and class.
 */
export function RevertGlyph({ size = 13, className }: GlyphProps): ReactNode {
  return stroke(
    size,
    className,
    <>
      <circle cx="12.4" cy="8.4" r="1.2" />
      <path d="M9.6 8.4H3.4" />
      <path d="M6 5.8 3.4 8.4l2.6 2.6" />
    </>,
  )
}

/**
 * A commit lifted off one line and set down on another: cherry-pick (order 9).
 *
 * The empty line at the bottom is the current branch and the dot above it is the
 * commit on its way there. The gap between the arrow's head and the line is what
 * says the commit has not landed yet.
 * @param props - Size and class.
 */
export function CherryPickGlyph({ size = 13, className }: GlyphProps): ReactNode {
  return stroke(
    size,
    className,
    <>
      <circle cx="8" cy="4.2" r="1.5" />
      <path d="M8 5.9v3.6" />
      <path d="M6.2 7.7 8 9.5l1.8-1.8" />
      <path d="M3 12.6h10" />
    </>,
  )
}

/**
 * An arrow folding down onto a line: squash into the previous commit (order 9).
 *
 * The line is the commit underneath, and the arrow is the one above coming down
 * onto it — the fold is the whole of what squash does.
 * @param props - Size and class.
 */
export function SquashGlyph({ size = 13, className }: GlyphProps): ReactNode {
  return stroke(
    size,
    className,
    <>
      <path d="M8 3.4v5.2" />
      <path d="M5.8 6.4 8 8.6l2.2-2.2" />
      <path d="M3.6 12.2h8.8" />
    </>,
  )
}

/**
 * Two chevrons pointing back: reset to a commit (order 9).
 *
 * The double arrow is the media-controls "rewind", which is the right register:
 * reset moves the branch itself, where revert and cherry-pick add to it. The
 * three modes share this mark and are told apart by their labels — soft, mixed
 * and hard are three answers to one question, not three different actions.
 * @param props - Size and class.
 */
export function ResetGlyph({ size = 13, className }: GlyphProps): ReactNode {
  return stroke(
    size,
    className,
    <>
      <path d="M7.4 4.6 3.8 8l3.6 3.4" />
      <path d="M12.6 4.6 9 8l3.6 3.4" />
    </>,
  )
}

/**
 * An elbow arrow hooking back to the left: undo the newest commit (FR-3.8).
 *
 * Drawn as an elbow rather than as {@link DiscardGlyph}'s curl so the two are not
 * one shape seen twice: discard acts on a file's edits, undo acts on a commit.
 * They never share a toolbar, but they do share a reader.
 * @param props - Size and class.
 */
export function UndoGlyph({ size = 13, className }: GlyphProps): ReactNode {
  return stroke(
    size,
    className,
    <>
      <path d="M12.4 11.6V9.8a3.4 3.4 0 0 0-3.4-3.4H4.6" />
      <path d="M7.2 3.8 4.6 6.4l2.6 2.6" />
    </>,
  )
}

/**
 * What each kind draws, on its own.
 *
 * No shared outline on purpose. The first version drew every kind as a mark inside
 * the same page, and the result was nine glyphs that read as one thing at 14px —
 * reported from the running panel: "they all look the same at a glance". Now each
 * kind IS its mark, drawn large in the 16x16 box (content in 3..13, so the 1.3
 * stroke never clips), and only the fallback is a page.
 */
const FILE_MARKS: Readonly<Record<FileKind, ReactNode>> = {
  // Braces: the shape source code is written in, which is the question this row
  // answers ("is this code?"), not which language it is. The left brace sits on the
  // left and the right one on the right — a brace's spike points away from its own
  // arms, so the two must not overlap or the pair reads as one knot.
  code: (
    <>
      <path d="M7.2 3.2c-1.5 0-2.1 1-2.1 2.3v1.2c0 1.1-.4 1.7-1.3 1.9.9.2 1.3.8 1.3 1.9v1.2c0 1.3.6 2.3 2.1 2.3" />
      <path d="M8.8 3.2c1.5 0 2.1 1 2.1 2.3v1.2c0 1.1.4 1.7 1.3 1.9-.9.2-1.3.8-1.3 1.9v1.2c0 1.3-.6 2.3-2.1 2.3" />
    </>
  ),
  // A tag: what the file IS, rather than what it is written in.
  markup: (
    <>
      <path d="M5.4 4.8h5.2l2.4 3.2-2.4 3.2H5.4L3 8z" />
      <circle cx="6.4" cy="8" r=".9" />
    </>
  ),
  // A hash: the selector a stylesheet is addressed by.
  style: <path d="M7.2 3.4 5.8 12.6M11 3.4 9.6 12.6M3.6 6.6h9.4M3 10.4h9.4" />,
  // A grid: the shape of anything structured.
  data: <path d="M3.6 3.6h8.8v8.8H3.6zM3.6 8h8.8M8 3.6v8.8" />,
  // A horizon and a sun, in no frame: the frame is what the data grid already is.
  image: (
    <>
      <path d="M3.2 12.8l3.4-4 2.2 2.5 1.8-2 2.6 3.5z" />
      <circle cx="5.2" cy="5.4" r="1.2" />
    </>
  ),
  // Prose: three lines, the last one short.
  doc: <path d="M3.6 4.4h8.8M3.6 8h8.8M3.6 11.6h5" />,
  // A prompt and a cursor.
  shell: (
    <>
      <path d="M4 4.2 8.4 8.4 4 12.6" />
      <path d="M9.2 12.6h3.2" />
    </>
  ),
  // Sliders: the settings the file holds, rather than data it holds.
  config: (
    <>
      <path d="M3.4 5.6h9.2M3.4 10.4h9.2" />
      <circle cx="6.4" cy="5.6" r="1.4" />
      <circle cx="9.6" cy="10.4" r="1.4" />
    </>
  ),
  // The plain page — the only framed mark, and the honest answer for "I do not
  // know": it should look like no claim at all.
  file: (
    <>
      <path d="M4 2.6h5.2L12.8 6.4v7H4z" />
      <path d="M9.2 2.6v3.8h3.6" />
    </>
  ),
}

/** Props for {@link FileKindGlyph}. */
export interface FileKindGlyphProps extends GlyphProps {
  /** Which file kind to draw. */
  readonly kind: FileKind
}

/**
 * The glyph for one changed file's kind, drawn where the row's badge used to sit.
 *
 * A row is 12px of text tall and the glyph is 14px wide: what a reader gets out of
 * it is one glance, so each mark is drawn as large as the box allows.
 *
 * @param props - The kind, the size, and an extra class.
 */
export function FileKindGlyph({ kind, size = 14, className }: FileKindGlyphProps): ReactNode {
  return stroke(size, className, FILE_MARKS[kind])
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
