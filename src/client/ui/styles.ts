/**
 * The panel's stylesheet, as one string plus its class map.
 *
 * Two constraints shape this file:
 *
 * 1. **Every colour is a DSH token** (§4.3: "全部颜色走 DSH 设计 token, 禁写死色值").
 *    The panel must follow the user's theme — including the skin system, which
 *    rewrites these aliases — so a literal hex here would be a bug that only
 *    shows up in someone else's theme.
 * 2. **Every git-typed value is set in the monospace face** (`--dsh-font-mono`):
 *    paths, branch names, hashes, and status letters. That is not decoration — it
 *    is git's own vernacular, it makes column alignment hold, and it
 *    distinguishes "a value git reported" from "a sentence we wrote". It is the
 *    one systematic choice this panel makes, and everything else stays quiet to
 *    let it read.
 *
 * The sheet is injected once per document, mirroring how the built-in packages
 * ship their CSS: a `<style data-plugin-css>` element so a reload replaces
 * rather than accumulates it.
 *
 * @module dsh-git-panel/client/ui/styles
 */

import {
  CHANGE_MIN_HEIGHT,
  COLUMN_SEPARATORS,
  COMMIT_INPUT_MAX_HEIGHT,
  COMMIT_INPUT_MIN_HEIGHT,
  COMMIT_MAX_HEIGHT,
  COMMIT_MIN_HEIGHT,
  DOCK_MIN_HEIGHT,
  DOCK_RESERVED,
  STAGED_MAX_HEIGHT,
  STAGED_RESERVED_HEIGHT,
} from './panel-layout.ts'

/** Prefix for every class, so nothing here can collide with another plugin. */
const P = 'dgp'

/** The class names the components use. */
export const cls = {
  root: `${P}-root`,
  head: `${P}-head`,
  branch: `${P}-branch`,
  branchGlyph: `${P}-branch-glyph`,
  branchName: `${P}-branch-name`,
  branchState: `${P}-branch-state`,
  branchCaret: `${P}-branch-caret`,
  branchPicker: `${P}-branch-picker`,
  branchRow: `${P}-branch-row`,
  branchPick: `${P}-branch-pick`,
  branchCheck: `${P}-branch-check`,
  branchPickName: `${P}-branch-pick-name`,
  branchTag: `${P}-branch-tag`,
  branchCreate: `${P}-branch-create`,
  branchForm: `${P}-branch-form`,
  branchInput: `${P}-branch-input`,
  branchBaseLabel: `${P}-branch-base`,
  branchSelect: `${P}-branch-select`,
  branchFormActions: `${P}-branch-form-actions`,
  branchFooter: `${P}-branch-footer`,
  stashPicker: `${P}-stash-picker`,
  stashRow: `${P}-stash-row`,
  stashHead: `${P}-stash-head`,
  stashSelector: `${P}-stash-selector`,
  stashSubject: `${P}-stash-subject`,
  stashActions: `${P}-stash-actions`,
  stashCreate: `${P}-stash-create`,
  stashForm: `${P}-stash-form`,
  stashInput: `${P}-stash-input`,
  stashCheck: `${P}-stash-check`,
  popover: `${P}-popover`,
  menu: `${P}-menu`,
  menuItem: `${P}-menu-item`,
  menuSeparator: `${P}-menu-separator`,
  danger: `${P}-danger`,
  mergeBox: `${P}-merge-box`,
  mergeLabel: `${P}-merge-label`,
  track: `${P}-track`,
  trackIcon: `${P}-track-icon`,
  spacer: `${P}-spacer`,
  tool: `${P}-tool`,
  body: `${P}-body`,
  group: `${P}-group`,
  groupHead: `${P}-group-head`,
  groupLabel: `${P}-group-label`,
  count: `${P}-count`,
  groupEmpty: `${P}-group-empty`,
  treeNode: `${P}-tree-node`,
  dirToggle: `${P}-dir-toggle`,
  dirName: `${P}-dir-name`,
  selectBoxWrap: `${P}-select-box-wrap`,
  selectBox: `${P}-select-box`,
  stagedPane: `${P}-staged-pane`,
  groupActions: `${P}-group-actions`,
  groupToggle: `${P}-group-toggle`,
  groupCaret: `${P}-group-caret`,
  ghost: `${P}-ghost`,
  row: `${P}-row`,
  badge: `${P}-badge`,
  path: `${P}-path`,
  pathDir: `${P}-path-dir`,
  pathName: `${P}-path-name`,
  rowActions: `${P}-row-actions`,
  commitBox: `${P}-commit-box`,
  commitInput: `${P}-commit-input`,
  commitInputWrap: `${P}-commit-input-wrap`,
  aiButton: `${P}-ai-button`,
  commitFoot: `${P}-commit-foot`,
  commitScope: `${P}-commit-scope`,
  commitButton: `${P}-commit-button`,
  actionBox: `${P}-action-box`,
  actionHead: `${P}-action-head`,
  actionLabel: `${P}-action-label`,
  actionNotice: `${P}-action-notice`,
  status: `${P}-status`,
  statusTitle: `${P}-status-title`,
  statusHint: `${P}-status-hint`,
  primary: `${P}-primary`,
  note: `${P}-note`,
  historySplit: `${P}-history-split`,
  historyList: `${P}-history-list`,
  historyDetail: `${P}-history-detail`,
  historyDetailHead: `${P}-history-detail-head`,
  commit: `${P}-commit`,
  commitRow: `${P}-commit-row`,
  commitTop: `${P}-commit-top`,
  commitHash: `${P}-commit-hash`,
  commitSubject: `${P}-commit-subject`,
  commitMeta: `${P}-commit-meta`,
  commitFields: `${P}-commit-fields`,
  commitFilesHead: `${P}-commit-files-head`,
  commitFile: `${P}-commit-file`,
  commitFilePath: `${P}-commit-file-path`,
  commitFileStat: `${P}-commit-file-stat`,
  marker: `${P}-marker`,
  spinner: `${P}-spinner`,
  spinnerGlyph: `${P}-spinner-glyph`,
  diffView: `${P}-diff-view`,
  paneGrip: `${P}-pane-grip`,
  bottom: `${P}-bottom`,
  bottomTabs: `${P}-bottom-tabs`,
  bottomTab: `${P}-bottom-tab`,
  bottomTabGroup: `${P}-bottom-tab-group`,
  bottomBody: `${P}-bottom-body`,
  bottomScroll: `${P}-bottom-scroll`,
  bottomDiff: `${P}-bottom-diff`,
  diffHead: `${P}-diff-head`,
  diffPath: `${P}-diff-path`,
  diffPathDir: `${P}-diff-path-dir`,
  diffPathName: `${P}-diff-path-name`,
  diffStats: `${P}-diff-stats`,
  diffAdded: `${P}-diff-added`,
  diffRemoved: `${P}-diff-removed`,
  diffSeg: `${P}-diff-seg`,
  diffSegButton: `${P}-diff-seg-button`,
  diffState: `${P}-diff-state`,
  diffHunks: `${P}-diff-hunks`,
  diffHunk: `${P}-diff-hunk`,
  diffHunkHead: `${P}-diff-hunk-head`,
  diffHunkRange: `${P}-diff-hunk-range`,
  diffHunkHeading: `${P}-diff-hunk-heading`,
  diffRow: `${P}-diff-row`,
  diffLine: `${P}-diff-line`,
  diffCell: `${P}-diff-cell`,
  diffGutter: `${P}-diff-gutter`,
  diffSign: `${P}-diff-sign`,
  diffText: `${P}-diff-text`,
  diffMark: `${P}-diff-mark`,
  diffFoldHint: `${P}-diff-fold-hint`,
  diffNote: `${P}-diff-note`,
} as const

/**
 * The stylesheet text.
 *
 * Layout note: the header and each group header stick, so the branch state and
 * the group a file belongs to stay visible while a long change list scrolls —
 * which is the whole reason the panel is not modal.
 */
export const css = `
.${cls.root} {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  color: var(--dsw-alias-label-primary);
  font-size: var(--dsh-content-font-size-secondary, 13px);
  line-height: 1.5;
}

/* ── floating layer ─────────────────────────────────────────────────────── */

/* A dropdown hangs over the panel's content instead of taking a row in its
   column (see ui/popover.tsx). Its top edge and height ceiling are measured
   from the panel and the anchor that opened it, so what is written here is the
   chrome: full panel width, above the sticky group headers (z-index 1) and the
   bottom pane's tab strip (2). The shadow is the theme's own drop mask rather
   than a literal black — the same token the GUI uses for its own floating
   layers, so a skin changes it too. */
.${cls.popover} {
  position: absolute;
  right: 0;
  left: 0;
  z-index: 3;
  display: flex;
  flex-direction: column;
  overflow: auto;
  border-bottom: 0.5px solid var(--dsw-alias-border-l3);
  background: var(--dsw-alias-bg-layer-2);
  box-shadow: 0 6px 16px var(--dsw-alias-bg-mask-2);
}

/* Flipped above its anchor when there was no room below (a row menu on the
   panel's last rows): the rule that separates the layer from the content moves
   to its top edge, where the content now is. */
.${cls.popover}[data-placement='above'] {
  border-top: 0.5px solid var(--dsw-alias-border-l3);
  border-bottom: 0;
}

/* ── a row menu (§9's two registered menus; M5a order 1 is the first) ───── */

/* The layer owns the chrome — position, background, border, shadow, scrolling —
   so this lays the entries out and nothing else. One row per action, the full
   width of the layer, because the panel is narrow enough that a menu sized to its
   longest sentence would be most of the sidebar anyway. */
.${cls.menu} {
  display: flex;
  flex-direction: column;
  padding: 4px;
}

/* Focus is on the menu as a whole — that is what the arrow keys listen to — but
   the ring that says "the keyboard is here" belongs on the ENTRY the keys would
   activate, not around the whole layer. So the layer's own ring is off, and the
   active entry's highlight is what shows. Scoped through the layer, and with the
   focus-visible pseudo-class spelled out, because the quality-floor rule at the
   end of this sheet targets any focused descendant of the root and would
   otherwise draw a ring around a dropdown — which reads as a rendering bug. */
.${cls.popover} > .${cls.menu}:focus,
.${cls.popover} > .${cls.menu}:focus-visible {
  outline: none;
}

.${cls.menuItem} {
  display: flex;
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  align-items: center;
  gap: 8px;
  padding: 5px 8px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

/* Hover and the keyboard's active row are the same state, and they share one
   rule: two highlights that can disagree would make Enter's target a guess. */
.${cls.menuItem}:hover:not(:disabled),
.${cls.menuItem}[data-active='true']:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
}

/* A destructive entry. §4.3 asks for the confirmation on the click; this is the
   colour that says a confirmation is coming, before it does. Written before the
   disabled rule below on purpose: while an operation is in flight even the
   destructive entry is unavailable, and unavailable is the state that should
   win. */
.${cls.menuItem}[data-danger='true'] {
  color: var(--dsw-alias-state-error-primary, var(--dsw-alias-label-primary));
}

.${cls.menuItem}:disabled {
  color: var(--dsw-alias-label-dimmed);
  cursor: default;
}

/* The hairline between two groups of entries, inset from both edges the way the
   entries' own text is. */
.${cls.menuSeparator} {
  height: 1px;
  margin: 4px 8px;
  background: var(--dsw-alias-border-l3);
}

/* ── state rail ─────────────────────────────────────────────────────────── */

.${cls.head} {
  display: flex;
  flex: none;
  align-items: center;
  gap: 6px;
  height: 38px;
  box-sizing: border-box;
  padding: 0 6px 0 12px;
  border-bottom: 0.5px solid var(--dsw-alias-border-l3);
}

.${cls.branch} {
  display: flex;
  min-width: 0;
  flex: auto;
  align-items: center;
  gap: 6px;
  padding: 3px 6px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  /* The branch name IS the picker's handle (FR-4.1), so it has to read as one:
     a pointer and a hover tint, which is exactly what §1.3's third lesson asks
     for (a switcher nobody notices is a switcher nobody uses). */
  cursor: pointer;
}

.${cls.branch}:hover {
  background: var(--dsw-alias-fill-l2);
}

.${cls.branchCaret} {
  flex: none;
  margin-left: 4px;
  color: var(--dsw-alias-label-tertiary);
  transition: transform 120ms ease;
}

.${cls.branch}[aria-expanded='true'] .${cls.branchCaret} {
  transform: rotate(90deg);
}

/* ── branch picker (FR-4.1–4.3) ─────────────────────────────────────────── */

/* The picker's content, inside its floating layer: the layer owns the border,
   the background, the scroll box, and the position, and this owns the padding
   and the two rows of a dropdown — the list, then "new branch…". */
.${cls.branchPicker} {
  display: flex;
  flex: none;
  flex-direction: column;
  gap: 1px;
  padding: 6px 8px 8px;
}

.${cls.branchRow} {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}

.${cls.branchRow}[data-current='true'] {
  color: var(--dsw-alias-label-primary);
}

.${cls.branchPick} {
  display: flex;
  flex: auto;
  min-width: 0;
  align-items: center;
  gap: 4px;
  padding: 3px 6px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.${cls.branchPick}:hover:not(:disabled) {
  background: var(--dsw-alias-fill-l2);
}

.${cls.branchPick}:disabled {
  cursor: default;
}

.${cls.branchCheck} {
  display: inline-flex;
  flex: none;
  width: 12px;
  justify-content: center;
  color: var(--dsw-alias-brand-primary);
}

.${cls.branchPickName} {
  min-width: 0;
  overflow: hidden;
  font-family: var(--dsh-font-mono);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.${cls.branchTag} {
  flex: none;
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
}

.${cls.branchCreate} {
  padding-top: 4px;
}

.${cls.branchForm} {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.${cls.branchInput},
.${cls.stashInput},
.${cls.branchSelect} {
  box-sizing: border-box;
  padding: 3px 6px;
  border: 1px solid var(--dsw-alias-border-l3);
  border-radius: 6px;
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 12px;
}

.${cls.branchInput} {
  font-family: var(--dsh-font-mono);
}

.${cls.stashInput} {
  font-family: var(--dsh-font-mono);
}

.${cls.branchBaseLabel} {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
}

.${cls.branchSelect} {
  flex: auto;
  min-width: 0;
  font-family: var(--dsh-font-mono);
}

.${cls.branchFormActions} {
  display: flex;
  gap: 6px;
}

.${cls.branchFooter} {
  display: flex;
  justify-content: flex-end;
  padding-top: 2px;
}

/* ── stash list (FR-6.2) ────────────────────────────────────────────────── */

/* Same shape as the branch picker — this is the content of the same kind of
   floating layer — but each entry is two lines, because a stash has both a
   selector and a sentence, and the panel is too narrow to put four controls and
   a subject on one row. */
.${cls.stashPicker} {
  display: flex;
  flex: none;
  flex-direction: column;
  gap: 2px;
  padding: 6px 8px 8px;
}

.${cls.stashRow} {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 3px;
  padding: 4px 6px;
  border-radius: 6px;
}

.${cls.stashRow}:hover {
  background: var(--dsw-alias-fill-l2);
}

.${cls.stashHead} {
  display: flex;
  min-width: 0;
  align-items: baseline;
  gap: 6px;
}

/* git's own selector (stash@{0}) is a git-typed value, so it is monospaced and
   quiet; the subject beside it is a sentence and takes the ordinary face. */
.${cls.stashSelector} {
  flex: none;
  color: var(--dsw-alias-label-tertiary);
  font-family: var(--dsh-font-mono);
  font-size: 11px;
}

.${cls.stashSubject} {
  min-width: 0;
  overflow: hidden;
  color: var(--dsw-alias-label-primary);
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* The row's controls wrap rather than overflow: apply, pop and the bin together
   are wider than a narrow sidebar, and a wrapped second line is readable where a
   clipped button is not. */
.${cls.stashActions} {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
}

.${cls.stashCreate} {
  padding-top: 4px;
}

.${cls.stashForm} {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.${cls.stashCheck} {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
}

/* The armed variant of a destructive control (§4.3): the second click is
   visibly a different click, so it takes the danger colour rather than the
   quiet ghost look its first click had. */
.${cls.danger} {
  flex: none;
  padding: 3px 8px;
  border: 1px solid var(--dsw-alias-state-error-primary, var(--dsw-alias-border-l3));
  border-radius: 6px;
  background: var(--dsw-alias-fill-l2);
  color: var(--dsw-alias-state-error-primary, var(--dsw-alias-label-primary));
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}

/* ── merge state (FR-9.3) ───────────────────────────────────────────────── */

.${cls.mergeBox} {
  display: flex;
  flex: none;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-bottom: 0.5px solid var(--dsw-alias-border-l3);
  background: var(--dsw-alias-fill-l2);
}

.${cls.mergeLabel} {
  flex: auto;
  min-width: 0;
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
}

.${cls.branchGlyph} {
  flex: none;
  color: var(--dsw-alias-label-tertiary);
}

.${cls.branchName} {
  min-width: 0;
  overflow: hidden;
  font-family: var(--dsh-font-mono);
  color: var(--dsw-alias-label-primary);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.${cls.branchState} {
  flex: none;
  color: var(--dsw-alias-label-tertiary);
}

.${cls.track} {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 3px;
  font-family: var(--dsh-font-mono);
  font-size: 11px;
  color: var(--dsw-alias-label-secondary);
}

.${cls.trackIcon} {
  color: var(--dsw-alias-label-tertiary);
}

.${cls.spacer} {
  flex: auto;
}

/* ── icon buttons ───────────────────────────────────────────────────────── */

.${cls.tool} {
  display: inline-flex;
  width: 26px;
  height: 26px;
  flex: none;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
}

.${cls.tool}:hover {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}

.${cls.tool}:disabled {
  color: var(--dsw-alias-label-dimmed);
  cursor: default;
}

.${cls.tool}:disabled:hover {
  background: transparent;
}

.${cls.ghost} {
  padding: 1px 6px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}

.${cls.ghost}:hover {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}

/* Unavailable is a state, not a hidden control: a group whose count reads 0 keeps
   its bulk button on screen (the layout promises these are never hover-only) and
   the button says why it does nothing. */
.${cls.ghost}:disabled {
  color: var(--dsw-alias-label-dimmed);
  cursor: default;
}

.${cls.ghost}:disabled:hover {
  background: transparent;
}

/* ── the staged list, and the change list below it ──────────────────────── */

/* The staged list is the one group drawn OUTSIDE the scrolling change body, and
   the rule under it is what separates "what this message commits" from the
   message itself. It is capped rather than draggable — the panel has exactly one
   grip, on the dock — so a long staged list scrolls inside its share instead of
   pushing the commit box off screen. */
.${cls.stagedPane} {
  display: flex;
  /* Sized by its CONTENT, capped by two ceilings — the drawer's own (two fifths of
     the panel) and the budget's absolute one, whichever bites first — and with no
     floor: a folded or empty drawer is as tall as its own header, so the commit box
     sits tight against it. The floor the budget keeps for it is a reservation
     against the dock's drag (see ui/panel-layout.ts), not a band of blank space.
     A long index scrolls in its own share instead of pushing the commit box and
     the change list down the panel. */
  flex: 0 1 auto;
  flex-direction: column;
  min-height: 0;
  max-height: min(40%, ${STAGED_MAX_HEIGHT}px);
  overflow: auto;
  border-bottom: 0.5px solid var(--dsw-alias-border-l3);
  padding-right: 10px;
  scrollbar-width: thin;
  scrollbar-color: var(--dsw-alias-scrollbar-bg-l1) transparent;
  scrollbar-gutter: stable;
}

.${cls.stagedPane} > .${cls.group} {
  flex: none;
}

/* The column the change panes share: the working-tree groups and the conflict
   group, all of them flowing into ONE scroller. That is the whole point of the
   shape — a single list that scrolls as one is what the comparable sidebar draws,
   and it is why the panel needs only one grip (the dock's) instead of one per
   group. */
.${cls.body} {
  /* The column's ONE elastic region, and the only one that grows: it takes what
     the regions around it leave, and it scrolls rather than asking for more.

     'flex-basis: 0' is what keeps a repository with a thousand changed files from
     taxing the regions around it. With the default 'auto' basis the list's
     CONTENT height is its base size, so a long list makes the column over-full and
     flexbox then shrinks every shrinkable region to pay for it — the staged drawer
     and the dock included, which is exactly the squeeze reported from the running
     panel. With a zero basis the content never enters the flex arithmetic at all:
     what the list gets is the leftover plus this floor, and anything longer than
     that scrolls inside it.

     Spelled as three longhands rather than the 'flex' shorthand: jsdom does not
     expand 'flex: 1 1 0', so the shorthand would leave the layout contracts in
     test/client-panel.test.ts asserting nothing. */
  display: flex;
  flex-grow: 1;
  flex-shrink: 1;
  flex-basis: 0;
  flex-direction: column;
  min-height: ${CHANGE_MIN_HEIGHT}px;
  margin-right: 2px;
  /* The rows put their '+'/'−' (and each group header its bulk action) against
     the right edge of whichever pane scrolls them. See the scrollbar block below
     for why that costs a gutter: an overlay scrollbar floats on top of whatever
     is under it, and what is under it here is the buttons. 10px is the widest an
     overlay scrollbar gets in the engines this runs in, so the clearance matches
     it. */
  padding-right: 10px;
  padding-bottom: 8px;
  overflow: auto;
  scrollbar-gutter: stable;
  scrollbar-color: var(--dsw-alias-scrollbar-bg-l1) transparent;
}

/* A group is a section of that list, not a pane of its own: it takes its natural
   height and the body scrolls. */
.${cls.body} > .${cls.group} {
  flex: none;
}

/* No rule between two groups: each section header carries its own lid (see
   above), which is the edge that has to stay visible while the rows scroll under
   it. Two rules would put a line right against the next section's header. */

/* The section header pins itself to the top of whichever scroller holds it, so
   the answer to "what am I looking at?" is always on screen: scrolling through a
   long change list keeps "Changes" at the top, and the list of untracked files
   below announces itself the same way the moment it arrives. Reported from the
   running panel as the thing that makes partial sections legible.

   Two details are load-bearing. The background has to be OPAQUE — rows scroll
   under this band, and the text behind it is unreadable otherwise — and the
   hairline is on the header's BOTTOM edge rather than on the next section's top
   edge, so the band reads as a lid over the rows (a sticky header with no rule
   under it looks like the list just stopped). */
.${cls.groupHead} {
  position: sticky;
  top: 0;
  z-index: 1;
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 6px;
  /* 12px on the trailing side to match the row: the group's bulk action and the
     rows' '+'/'−' are the same column of controls and should read as one. */
  padding: 5px 12px 4px 12px;
  border-bottom: 0.5px solid var(--dsw-alias-border-l3);
  background: var(--dsw-alias-bg-layer-1);
}

/* The label yields before the actions do: a group's bulk action must stay on
   screen in a narrow sidebar, and a shortened group name is still readable while
   a button that scrolled out of view is not there at all. */
.${cls.groupLabel} {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.02em;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* The disclosure: caret, name and count are one control, and the bulk action
   beside it is a sibling rather than a child — a button inside a button is
   invalid markup, and the inner one is not reliably clickable. */
.${cls.groupToggle} {
  display: flex;
  flex: auto;
  min-width: 0;
  align-items: center;
  gap: 6px;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.${cls.groupToggle}:hover .${cls.groupLabel} {
  color: var(--dsw-alias-label-primary);
}

.${cls.groupCaret} {
  flex: none;
  color: var(--dsw-alias-label-tertiary);
  transition: transform 120ms ease;
}

/* Keyed off the button's own 'aria-expanded' rather than a data attribute on the
   svg: the glyph components forward only size and className, so an attribute put
   on them goes nowhere (which is why the history caret never turned).

   The tree's directory rows share this glyph, so they need their own copy of the
   rule — a caret that never turns is exactly the bug this pair of selectors is
   here to prevent. */
.${cls.groupToggle}[aria-expanded='true'] .${cls.groupCaret},
.${cls.dirToggle}[aria-expanded='true'] .${cls.groupCaret} {
  transform: rotate(90deg);
}

.${cls.count} {
  flex: none;
  padding: 0 5px;
  border-radius: 7px;
  background: var(--dsw-alias-fill-l2);
  color: var(--dsw-alias-label-tertiary);
  font-family: var(--dsh-font-mono);
  font-size: 10px;
}

.${cls.groupActions} {
  display: flex;
  flex: none;
  align-items: center;
  gap: 2px;
  margin-left: auto;
  /* Always visible, and only *emphasised* on hover. The first version revealed
     it on hover alone (opacity 0 → 1) to keep the list quiet, and the group
     action then could not be found at all — the wireframe in the requirements
     doc (§4.2) draws these as visible controls, which is what this is. */
  opacity: 0.9;
  transition: opacity 120ms ease-out;
}

.${cls.groupHead}:hover .${cls.groupActions},
.${cls.groupHead}:focus-within .${cls.groupActions} {
  opacity: 1;
}

/* One step up from the generic ghost button: on a header it is a real control,
   not a footnote, and 'label-tertiary' was too close to the background to read
   as one. */
.${cls.groupActions} .${cls.ghost} {
  color: var(--dsw-alias-label-secondary);
}

/* The empty state of a resident group. Indented to the rows' text column
   (12px of row padding, a 14px checkbox, the 8px gap, a 12px badge, and the
   8px gap again) so it reads as "this group has no rows" rather than as a
   stray sentence. */
.${cls.groupEmpty} {
  margin: 0;
  padding: 4px 12px 6px 54px;
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
}

/* ── the tree shape (FR-1.3) ────────────────────────────────────────────── */

/* The wrapper owns the depth: its inline left padding is what indents a node,
   while the row inside keeps the padding every row has in both modes. One place
   decides how a row is laid out; the tree only says how deep it sits. */
.${cls.treeNode} {
  display: flex;
  min-width: 0;
}

.${cls.dirToggle} {
  display: flex;
  flex: auto;
  min-width: 0;
  align-items: center;
  gap: 6px;
  /* The leading 12px a root row used to carry now lives on the selection
     checkbox's margin (see the select-box block below): the caret follows the
     box, and both sit in the same columns as the file rows beneath them. The
     trailing 12px is unchanged — it is still the scrollbar gutter column. */
  padding: 3px 12px 3px 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}

.${cls.dirToggle}:hover .${cls.dirName} {
  color: var(--dsw-alias-label-primary);
}

/* ── row selection ────────────────────────────────────────────────────────── */

/* The checkbox's wrapper is the row-click firewall (its stopPropagation is in
   the component); the box itself is a 14px square in a fixed leading slot, so a
   column of them reads as one column down a long list. */
.${cls.selectBoxWrap} {
  display: flex;
  flex: none;
  align-items: center;
}

/* In the tree the wrapper owns the depth indent as its inline padding, so the
   slot the row's own leading padding would give has to come from this margin:
   a root directory's box then starts in the same column as the file rows'
   boxes beneath it. File rows need none — the row's own 12px does it. */
.${cls.treeNode} > .${cls.selectBoxWrap} {
  margin-left: 12px;
}

.${cls.selectBox} {
  display: inline-flex;
  width: 14px;
  height: 14px;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 1px solid var(--dsw-alias-border-l2, var(--dsw-alias-border-l3));
  border-radius: 3px;
  background: transparent;
  color: var(--dsw-alias-bg-layer-1);
  cursor: pointer;
}

.${cls.selectBox}:hover {
  border-color: var(--dsw-alias-label-tertiary);
}

/* The checked states are the only inked ones — a fill the tick contrasts
   against, so a glance down the list picks out the selected rows. 'mixed'
   fills the same way with a dash inside: partly selected still reads as
   "this row is doing something about the selection". */
.${cls.selectBox}[aria-checked='true'],
.${cls.selectBox}[aria-checked='mixed'] {
  border-color: var(--dsw-alias-state-business-primary, var(--dsw-alias-border-l3));
  background: var(--dsw-alias-state-business-primary, var(--dsw-alias-fill-l2));
}

/* A checked row is part of the pending batch; the faintest wash marks it,
   the same token hover uses, so the two never fight. */
.${cls.row}[data-selected='true'] {
  background: var(--dsw-alias-interactive-bg-hover);
}

.${cls.dirName} {
  min-width: 0;
  overflow: hidden;
  font-family: var(--dsh-font-mono);
  color: var(--dsw-alias-label-secondary);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.${cls.row} {
  display: flex;
  width: 100%;
  min-width: 0;
  /* The row is 100% wide AND padded, so it has to size by its border box. Under
     the default content-box its box came out 20px wider than the drawer that
     clips it, and the 30px '+'/'−' sitting against its right padding fell into
     that clipped strip — "the buttons are at the very edge and blocked". Boxes
     that mix a percentage width with padding have to say which box the percentage
     means. */
  box-sizing: border-box;
  align-items: center;
  gap: 8px;
  /* The trailing 12px is the group header's own trailing padding, so a row's
     '+'/'−' and its header's "stage all" line up down the right edge. It is also
     what keeps the button off the wall: the row's right edge is a button, so the
     row's padding is what decides whether it reads as inside the list. */
  padding: 4px 12px;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.${cls.row}:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}

.${cls.badge} {
  width: 12px;
  flex: none;
  font-family: var(--dsh-font-mono);
  font-size: 12px;
  font-weight: 600;
  text-align: center;
}

/* Git's own status letters, mapped onto the theme's semantic states. */
.${cls.badge}[data-status='M'],
.${cls.badge}[data-status='T'] { color: var(--dsw-alias-state-business-primary); }
.${cls.badge}[data-status='A'],
.${cls.badge}[data-status='?'] { color: var(--dsw-alias-state-success-primary); }
.${cls.badge}[data-status='D'] { color: var(--dsw-alias-state-error-primary); }
.${cls.badge}[data-status='R'],
.${cls.badge}[data-status='C'] { color: var(--dsw-alias-state-business-primary); }
.${cls.badge}[data-status='U'] { color: var(--dsw-alias-state-error-primary); }

.${cls.path} {
  display: flex;
  min-width: 0;
  flex: auto;
  overflow: hidden;
  font-family: var(--dsh-font-mono);
  font-size: 12px;
  white-space: nowrap;
}

.${cls.pathDir} {
  flex: none;
  color: var(--dsw-alias-label-tertiary);
}

.${cls.pathName} {
  flex: none;
  color: var(--dsw-alias-label-primary);
}

/* The row's own '+/−' is the panel's most repeated click, so it gets more room
   than the tool buttons in the rail and the diff header: a 13px glyph in a 26px
   box reads as a dot in a dense list. */
.${cls.rowActions} .${cls.tool} {
  width: 30px;
  height: 30px;
  border-radius: 7px;
}

.${cls.rowActions} {
  display: flex;
  flex: none;
  align-items: center;
  gap: 2px;
  opacity: 0;
}

.${cls.row}:hover .${cls.rowActions},
.${cls.row}:focus-within .${cls.rowActions} {
  opacity: 1;
}

/* The armed discard button replaces the row's third icon, so it is a word where
   the others are glyphs. The row is the ceiling (M3's lesson: a box that mixes a
   percentage width with padding has to say which box the percentage means), and
   the label ellipsises rather than pushing the path out of the panel — its tooltip
   carries the whole sentence either way. */
.${cls.rowActions} .${cls.danger} {
  max-width: 100%;
  overflow: hidden;
  margin-left: 2px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ── commit box ─────────────────────────────────────────────────────────── */

.${cls.commitBox} {
  /* Bounded in both directions by the budget: the textarea is what varies, and
     the footer does not shrink, so a box that hits its ceiling shrinks the
     textarea down to its own floor rather than clipping the commit button.

     'overflow: auto' rather than 'hidden' because of what else lands in this box:
     a refused commit's reason and the AI's "the diff was cut" note. Both are
     things the user must be able to read (FR-3.5, §4.3), and a ceiling that hid
     them would be a ceiling that hides the answer to "why did nothing happen?" —
     so the box scrolls instead, and only in that rare case. */
  display: flex;
  flex: none;
  flex-direction: column;
  gap: 5px;
  min-height: ${COMMIT_MIN_HEIGHT}px;
  max-height: ${COMMIT_MAX_HEIGHT}px;
  overflow: auto;
  scrollbar-width: thin;
  scrollbar-color: var(--dsw-alias-scrollbar-bg-l1) transparent;
  padding: 8px 12px;
  border-bottom: 0.5px solid var(--dsw-alias-border-l3);
}

.${cls.commitInputWrap} {
  position: relative;
  display: flex;
}

/* The ✨ lives inside the box's corner (§4.2 draws it that way) instead of in the
   footer row: it writes the textarea's content, so it belongs to the textarea,
   and the footer's width is already spoken for by the scope sentence. */
.${cls.aiButton} {
  position: absolute;
  top: 4px;
  right: 4px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
}

.${cls.aiButton}:hover:not(:disabled) {
  background: var(--dsw-alias-fill-l2);
  color: var(--dsw-alias-brand-primary);
}

.${cls.aiButton}:disabled {
  color: var(--dsw-alias-label-dimmed);
  cursor: default;
}

.${cls.commitInput} {
  width: 100%;
  /* The one thing in the region whose size the user decides: the message. The
     native vertical resize handle works between these two numbers, and the cap is
     what stops it from eating the column — the budget above measured the commit
     box assuming exactly this ceiling. */
  flex: 0 1 auto;
  min-height: ${COMMIT_INPUT_MIN_HEIGHT}px;
  max-height: ${COMMIT_INPUT_MAX_HEIGHT}px;
  box-sizing: border-box;
  /* Room for the ✨ so the first line of a message never runs under it. */
  padding: 6px 30px 6px 8px;
  border: 1px solid var(--dsw-alias-border-l3);
  border-radius: 6px;
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 12px;
  line-height: 1.5;
  resize: vertical;
}

.${cls.commitInput}::placeholder {
  color: var(--dsw-alias-label-dimmed);
}

.${cls.commitInput}:focus {
  border-color: var(--dsw-alias-brand-primary);
}

.${cls.commitFoot} {
  display: flex;
  flex: none;
  align-items: center;
  gap: 8px;
}

/* The scope sentence is the doc's §1.3 lesson made visible, so it takes the
   width it needs and the button keeps its own. */
.${cls.commitScope} {
  min-width: 0;
  flex: auto;
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
  line-height: 1.4;
}

.${cls.commitButton} {
  flex: none;
  padding: 4px 10px;
  border: 0;
  border-radius: 6px;
  background: var(--dsw-alias-button-primary-fill);
  color: var(--dsw-alias-label-primary-foreground);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.${cls.commitButton}:hover:not(:disabled) {
  background: var(--dsw-alias-button-primary-hover);
}

.${cls.commitButton}:disabled {
  background: var(--dsw-alias-fill-l2);
  color: var(--dsw-alias-label-dimmed);
  cursor: default;
}

/* ── operation feedback ─────────────────────────────────────────────────── */

/* Errors land beside the list rather than replacing it: §4.3 asks for the
   failure where the operation was, and the change list is still the user's. */
.${cls.actionBox} {
  flex: none;
  padding: 7px 12px 8px;
  border-bottom: 0.5px solid var(--dsw-alias-border-l3);
  background: var(--dsw-alias-bg-layer-2);
}

.${cls.actionHead} {
  display: flex;
  align-items: center;
  gap: 6px;
}

.${cls.actionLabel} {
  min-width: 0;
  flex: auto;
  color: var(--dsw-alias-state-error-primary);
  font-size: 11px;
  font-weight: 500;
}

.${cls.actionNotice} {
  flex: none;
  margin: 0;
  padding: 6px 12px;
  border-bottom: 0.5px solid var(--dsw-alias-border-l3);
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
  word-break: break-word;
}

/* ── states ─────────────────────────────────────────────────────────────── */

.${cls.status} {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  padding: 16px 14px;
}

.${cls.statusTitle} {
  margin: 0;
  color: var(--dsw-alias-label-secondary);
}

.${cls.statusHint} {
  margin: 0;
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
  line-height: 1.6;
}

.${cls.primary} {
  margin-top: 6px;
  padding: 3px 10px;
  border: 0;
  border-radius: 6px;
  background: var(--dsw-alias-button-primary-fill);
  color: var(--dsw-alias-label-primary-foreground);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.${cls.primary}:hover {
  background: var(--dsw-alias-button-primary-hover);
}

.${cls.note} {
  margin: 0;
  padding: 4px 12px;
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
}

/* A git diagnostic keeps its own newlines: FR-4.4 wants git's words, verbatim. */
.${cls.note}[data-multiline='true'] {
  font-family: var(--dsh-font-mono);
  font-size: 11px;
  white-space: pre-wrap;
  word-break: break-word;
}

/* ── the bottom pane: recent commits and the diff, as two tabs ──────────── */

/* One region for both, because they are the same kind of thing: something to read
   that is not the change list. Folded it is only its tab strip ('height: auto'),
   which is the state the panel starts in — the list above must not pay for a pane
   nobody opened. Expanding picks the tab's own default, in viewport units so the
   height stays definite whatever the panel's container turns out to be; a drag
   replaces that with pixels. */
.${cls.bottom} {
  display: flex;
  /* NOT shrinkable, and never taller than what the rest of the column's floors
     leave — the same number the grip's drag is clamped to, so a remembered
     height from a taller window cannot squeeze the regions above it either.

     '0 0' rather than '0 1' is the fix for "folding the staged drawer squeezes
     the dock": the dock's height belongs to its drag, its content, and the
     budget's clamp — never to a sibling's growth. With shrink on, expanding the
     staged list made flexbox tax the dock for the difference (the change list
     already at its floor has nothing left to give); with it off, the staged
     drawer absorbs its own growth by shrinking into its own scroller, and the
     dock keeps the height the user set.

     Spelled as three longhands rather than the 'flex' shorthand: jsdom does not
     expand 'flex: 0 0 auto', so the shorthand would leave the layout contracts
     in test/client-panel.test.ts asserting nothing. */
  flex-grow: 0;
  flex-shrink: 0;
  flex-basis: auto;
  flex-direction: column;
  min-height: ${DOCK_MIN_HEIGHT}px;
  max-height: calc(100% - ${DOCK_RESERVED}px);
  height: auto;
  overflow: hidden;
  border-top: 0.5px solid var(--dsw-alias-border-l3);
}

/* A per-tab default height, for a dock nobody has dragged yet. A diff gets half
   the screen — that is what a diff needs — while the commit list takes its
   content's height up to a cap, because a five-commit history that reserved half
   the panel would be mostly empty box. Both are fractions of the WINDOW, so both
   are re-clamped by the column budget: the dock may be 50vh on a tall window and
   the same rule gives it far less on a short one. */
.${cls.bottom}[data-expanded='true'][data-tab='diff'] {
  height: 50vh;
  max-height: calc(100% - ${DOCK_RESERVED}px);
}
.${cls.bottom}[data-expanded='true'][data-tab='history'] {
  height: auto;
  max-height: min(40vh, calc(100% - ${DOCK_RESERVED}px));
}

.${cls.bottomTabs} {
  display: flex;
  flex: none;
  align-items: center;
  gap: 2px;
  padding: 2px 6px 2px 8px;
  border-bottom: 0.5px solid var(--dsw-alias-border-l3);
  background: var(--dsw-alias-bg-layer-1);
}

/* A tab is mostly a label; the selected one is marked by the label's own colour
   and a rule under it, the way an editor's tabs read, rather than by a filled
   pill that would shout in a panel this quiet. */
.${cls.bottomTab} {
  max-width: 160px;
  overflow: hidden;
  padding: 4px 8px;
  border: 0;
  border-radius: 4px 4px 0 0;
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  font: inherit;
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.02em;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
}

.${cls.bottomTab}:hover {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}

.${cls.bottomTab}[data-active='true'] {
  color: var(--dsw-alias-label-primary);
  box-shadow: inset 0 -1.5px 0 var(--dsw-alias-brand-primary);
}

/* The diff's tab carries its own close button, which is a sibling so the tab
   itself stays a plain button (a button inside a button is invalid). */
.${cls.bottomTabGroup} {
  display: inline-flex;
  max-width: 180px;
  min-width: 0;
  align-items: center;
}

.${cls.bottomTabGroup} .${cls.tool} {
  width: 20px;
  height: 20px;
  margin-left: -4px;
}

.${cls.bottomBody} {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-height: 0;
}

/* The history tab's frame. It does NOT scroll: the split inside it has a
   scrolling column per side (the list and the selected commit), which is what
   lets the two scroll independently. The diff tab is the same idea with its own
   scroller (the hunks), so its path header and layout buttons stay put. */
.${cls.bottomScroll} {
  display: flex;
  flex: 1 1 auto;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
}

/* The diff panel is a flex column of its own (header, hunks, notes), so it does
   not scroll here — the hunks do. */
.${cls.bottomDiff} {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-height: 0;
}

.${cls.bottomScroll}[data-shown='false'],
.${cls.bottomDiff}[data-shown='false'] {
  display: none;
}

.${cls.commit} {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

/* The row itself is the button, and it holds both of its lines. That is what
   makes the hot zone equal to the hover band: a band that covered the caption
   while only the title answered a click would be lying about where the click
   lands. So the button carries the reset (no chrome, the row's type, the full
   width) AND the bands — the GUI's own interactive aliases, the same ones the
   built-in sidebars use for a hovered or current row. The element's
   data-selected attribute is the "you are here" state: the commit whose detail
   is open. (No backticks in this file's comments: the sheet is a template
   string, and one would end it early.) */
.${cls.commitRow} {
  display: flex;
  width: 100%;
  box-sizing: border-box;
  flex-direction: column;
  align-items: stretch;
  gap: 1px;
  padding: 4px 12px 5px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.${cls.commitRow}:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}

.${cls.commitRow}[data-selected='true'] {
  background: var(--dsw-alias-interactive-bg-active);
}

.${cls.commitRow}:focus-visible {
  outline: 1px solid var(--dsw-alias-brand-primary);
  outline-offset: -1px;
}

/* ── commit detail (FR-3.6) ─────────────────────────────────────────────── */

/* The button's two lines. They are plain flex rows now that the button is the
   row: no reset of their own to keep in step with. */
.${cls.commitTop} {
  display: flex;
  min-width: 0;
  align-items: baseline;
  gap: 6px;
}

/* ── the commit list and its detail (FR-3.6) ───────────────────────────── */

/* One row of two columns: the entries on the left, the selected commit on the
   right. Closed, the list takes the whole width — the split exists only while
   something is selected. */
.${cls.historySplit} {
  display: flex;
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
}

.${cls.historyList} {
  flex: 1 1 auto;
  min-width: 0;
  overflow: auto;
  scrollbar-width: thin;
  scrollbar-color: var(--dsw-alias-scrollbar-bg-l1) transparent;
}

.${cls.historySplit}[data-split='true'] > .${cls.historyList} {
  /* Half each, as asked: the entries stay readable while the information is
     open, and neither side can push the other out of the pane. */
  flex: 1 1 50%;
}

.${cls.historyDetail} {
  display: flex;
  flex: 1 1 50%;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
  overflow: auto;
  padding: 6px 12px 8px;
  border-left: 0.5px solid var(--dsw-alias-border-l3);
  scrollbar-width: thin;
  scrollbar-color: var(--dsw-alias-scrollbar-bg-l1) transparent;
}

/* Which commit the column is about: the row it came from is in the other column
   and can be scrolled out of sight. */
.${cls.historyDetailHead} {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 6px;
}

.${cls.commitFields} {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 1px 8px;
  margin: 0;
  font-size: 11px;
}

.${cls.commitFields} dt {
  color: var(--dsw-alias-label-tertiary);
}

.${cls.commitFields} dd {
  margin: 0;
  color: var(--dsw-alias-label-secondary);
}

.${cls.commitFilesHead} {
  margin: 4px 0 0;
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
}

.${cls.commitFile} {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 8px;
}

.${cls.commitFilePath} {
  min-width: 0;
  flex: auto;
  overflow: hidden;
  font-family: var(--dsh-font-mono);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.${cls.commitFileStat} {
  flex: none;
  display: inline-flex;
  gap: 6px;
  font-family: var(--dsh-font-mono);
  font-size: 11px;
}

.${cls.commitHash} {
  flex: none;
  color: var(--dsw-alias-label-tertiary);
  font-family: var(--dsh-font-mono);
  font-size: 11px;
}

.${cls.commitSubject} {
  min-width: 0;
  overflow: hidden;
  color: var(--dsw-alias-label-primary);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.${cls.commitMeta} {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 6px;
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
}

.${cls.marker} {
  flex: none;
  font-size: 9px;
}

.${cls.marker}[data-pushed='false'] { color: var(--dsw-alias-state-business-primary); }
.${cls.marker}[data-pushed='true'] { color: var(--dsw-alias-label-dimmed); }

/* ── diff (FR-2) ────────────────────────────────────────────────────────── */

/* The drag handle every adjustable pane shares ('PaneResizer'): a wide, invisible
   strip rather than a drawn rule, because it has to be grabbable without adding
   another line to an already dense panel. The hover tint is what tells the pointer
   it is on something. */
.${cls.paneGrip} {
  flex: none;
  height: 7px;
  cursor: row-resize;
  /* The drag is this strip's whole job, so the browser must not claim the
     gesture for scrolling on a touch screen. */
  touch-action: none;
}

.${cls.paneGrip}:hover,
.${cls.paneGrip}[data-dragging='true'] {
  background: var(--dsw-alias-interactive-bg-hover);
}

/* The pane fills the dock, and the hunks inside it do the scrolling, so the path
   header and the layout buttons stay put while a long diff moves under them. */
.${cls.diffView} {
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: auto;
}

.${cls.diffHead} {
  position: sticky;
  top: 0;
  z-index: 2;
  display: flex;
  flex: none;
  align-items: center;
  gap: 6px;
  padding: 4px 8px 4px 12px;
  border-bottom: 0.5px solid var(--dsw-alias-border-l3);
  background: var(--dsw-alias-bg-layer-1);
}

.${cls.diffPath} {
  display: flex;
  min-width: 0;
  flex: auto;
  overflow: hidden;
  font-family: var(--dsh-font-mono);
  font-size: 12px;
  white-space: nowrap;
}

/* Same rule as the change list (FR-1.2): the directory clips, the file name
   never does — it is the part a reader is looking for. */
.${cls.diffPathDir} {
  flex: none;
  overflow: hidden;
  color: var(--dsw-alias-label-tertiary);
  text-overflow: ellipsis;
}

.${cls.diffPathName} {
  flex: none;
  color: var(--dsw-alias-label-primary);
}

/* The counts take git's own colours; the diff view is exactly where the
   theme's success/error pair means "added"/"removed". */
.${cls.diffStats} {
  display: inline-flex;
  flex: none;
  gap: 5px;
  font-family: var(--dsh-font-mono);
  font-size: 11px;
}

.${cls.diffAdded} { color: var(--dsw-alias-state-success-primary); }
.${cls.diffRemoved} { color: var(--dsw-alias-state-error-primary); }

.${cls.diffSeg} {
  display: inline-flex;
  flex: none;
  gap: 1px;
  padding: 1px;
  border-radius: 7px;
  background: var(--dsw-alias-fill-l2);
}

.${cls.diffSegButton} {
  display: inline-flex;
  width: 22px;
  height: 20px;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
}

.${cls.diffSegButton}:hover {
  color: var(--dsw-alias-label-primary);
}

/* The pressed state is a token fill rather than a colour on the glyph: it has
   to read in every skin, and a glyph tint could not. */
.${cls.diffSegButton}[aria-pressed='true'] {
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
}

.${cls.diffState} {
  display: flex;
  flex: auto;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  margin: 0;
  padding: 16px 12px;
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
  line-height: 1.6;
}

.${cls.diffFoldHint} { margin: 0; }

.${cls.diffNote} {
  margin: 0;
  padding: 6px 12px;
  border-top: 0.5px solid var(--dsw-alias-border-l3);
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
}

.${cls.diffHunks} {
  min-height: 0;
  flex: auto;
  overflow: auto;
  scrollbar-color: var(--dsw-alias-scrollbar-bg-l1) transparent;
}

.${cls.diffHunk} {
  margin: 4px 0 6px;
}

.${cls.diffHunkHead} {
  display: flex;
  min-width: min-content;
  align-items: baseline;
  gap: 8px;
  padding: 2px 8px 2px 6px;
  background: var(--dsw-alias-fill-l2);
  font-family: var(--dsh-font-mono);
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary);
}

.${cls.diffHunkRange} { flex: none; }
.${cls.diffHunkHeading} { flex: none; color: var(--dsw-alias-label-secondary); }

/* 'min-width: min-content' on the rows (and the wrappers above) is what keeps
   a long line intact while the pane scrolls horizontally: without it the text
   would wrap at the pane's width and the two sides would stop lining up. */
.${cls.diffRow} {
  display: grid;
  width: 100%;
  min-width: min-content;
  grid-template-columns: 1fr 1fr;
  gap: 0 7px;
}

.${cls.diffLine},
.${cls.diffCell} {
  display: flex;
  min-width: min-content;
  align-items: flex-start;
  border-radius: 3px;
}

.${cls.diffCell} { flex: 1 1 0; }

.${cls.diffGutter} {
  width: 38px;
  flex: none;
  padding-right: 6px;
  color: var(--dsw-alias-label-dimmed);
  font-family: var(--dsh-font-mono);
  font-size: 11px;
  line-height: 1.5;
  text-align: right;
  user-select: none;
}

.${cls.diffSign} {
  width: 12px;
  flex: none;
  color: var(--dsw-alias-label-tertiary);
  font-family: var(--dsh-font-mono);
  line-height: 1.5;
  user-select: none;
}

.${cls.diffText} {
  min-width: 0;
  flex: auto;
  font-family: var(--dsh-font-mono);
  font-size: 12px;
  line-height: 1.5;
  white-space: pre;
}

/* An inline diff is the one layout where a row's tint is the only thing
   separating an addition from a removal, so the two kinds take the theme's
   own success/error colours as a wash. */
.${cls.diffLine}[data-kind='added'],
.${cls.diffCell}[data-line='added'] {
  background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 14%, transparent);
}

.${cls.diffLine}[data-kind='removed'],
.${cls.diffCell}[data-line='removed'] {
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 14%, transparent);
}

.${cls.diffLine}[data-kind='added'] .${cls.diffSign} { color: var(--dsw-alias-state-success-primary); }
.${cls.diffLine}[data-kind='removed'] .${cls.diffSign} { color: var(--dsw-alias-state-error-primary); }

/* The word-level mark (FR-2.3). Painted once, over the row tint: 'color-mix'
   keeps it a shade of the same token, so a theme swap moves both together. */
.${cls.diffMark} {
  border-radius: 2px;
  background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 30%, transparent);
}

/* ── loading ────────────────────────────────────────────────────────────── */

.${cls.spinner} {
  display: inline-block;
  width: 11px;
  height: 11px;
  border: 1.5px solid var(--dsw-alias-border-l4);
  border-top-color: var(--dsw-alias-label-secondary);
  border-radius: 50%;
  animation: ${P}-spin 700ms linear infinite;
}

.${cls.spinnerGlyph} {
  animation: ${P}-spin 700ms linear infinite;
}

@keyframes ${P}-spin {
  to { transform: rotate(360deg); }
}

/* ── scrollbars ─────────────────────────────────────────────────────────── */

/* A scrollbar that keeps its hands off the content.
 *
 * The change rows put their '+'/'−', and each group header its bulk action,
 * against the right edge of the list's scroller. An *overlay* scrollbar — the
 * kind that draws on top of whatever is under it and takes no layout space —
 * therefore lands exactly on those buttons, and it appears at the worst moment:
 * a list long enough to scroll is a list whose buttons get covered. (Reported
 * from the running panel.)
 *
 * Styling the WebKit scrollbar pseudo-elements is what switches Chromium from an
 * overlay scrollbar to a classic one that occupies its own column, so the content
 * box ends before it. Firefox ignores those pseudo-elements, but
 * 'scrollbar-width: thin' (plus the palette below) makes it use its own
 * space-taking scrollbar instead of GTK's overlay one. Between them, the two
 * engines the GUI runs in stop overlaying; the scroller's own right padding is
 * the insurance for anything that still does.
 */
.${cls.body},
.${cls.diffHunks},
.${cls.bottomScroll} {
  scrollbar-width: thin;
  scrollbar-color: var(--dsw-alias-scrollbar-bg-l1) transparent;
}

.${cls.body}::-webkit-scrollbar,
.${cls.diffHunks}::-webkit-scrollbar,
.${cls.bottomScroll}::-webkit-scrollbar {
  width: 10px;
  height: 10px;
}

.${cls.body}::-webkit-scrollbar-thumb,
.${cls.diffHunks}::-webkit-scrollbar-thumb,
.${cls.bottomScroll}::-webkit-scrollbar-thumb {
  border-radius: 5px;
  background: var(--dsw-alias-scrollbar-bg-l1);
}

.${cls.body}::-webkit-scrollbar-track,
.${cls.diffHunks}::-webkit-scrollbar-track,
.${cls.bottomScroll}::-webkit-scrollbar-track {
  background: transparent;
}

/* ── quality floor ──────────────────────────────────────────────────────── */

.${cls.root} :focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: -1px;
}

@media (prefers-reduced-motion: reduce) {
  .${cls.spinner} { animation-duration: 2400ms; }
  .${cls.spinnerGlyph} { animation-duration: 2400ms; }
  .${cls.groupCaret} { transition: none; }
}
`

/** The `<style>` element's identity, so a reload replaces instead of stacks. */
export const STYLE_TAG_ID = 'dsh-git-panel/panel.css'

/**
 * Install the stylesheet once per document.
 *
 * Called from the client plugin body, so the sheet exists before the first tab
 * renders. A second call is a no-op, which matters because the plugin body can
 * run again after a reload.
 * @param doc - Document to install into.
 */
export function installStyles(doc: Document): void {
  if (doc.querySelector(`style[data-plugin-css="${STYLE_TAG_ID}"]`) !== null) return
  const tag = doc.createElement('style')
  tag.dataset.plugin = 'dsh-git-panel'
  tag.dataset.pluginCss = STYLE_TAG_ID
  tag.textContent = css
  doc.head.appendChild(tag)
}
