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
  changeDrawer: `${P}-change-drawer`,
  changeBody: `${P}-change-body`,
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
  historyList: `${P}-history-list`,
  commit: `${P}-commit`,
  commitTop: `${P}-commit-top`,
  commitHash: `${P}-commit-hash`,
  commitSubject: `${P}-commit-subject`,
  commitMeta: `${P}-commit-meta`,
  historyCaret: `${P}-history-caret`,
  commitDetail: `${P}-commit-detail`,
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
  bottomChevron: `${P}-bottom-chevron`,
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
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  color: var(--dsw-alias-label-primary);
  font-size: var(--dsh-content-font-size-secondary, 13px);
  line-height: 1.5;
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

/* Inline under the rail rather than a floating overlay: the panel lives in a
   resizable sidebar, and a list that re-flows the column is easier to use there
   than one that covers the changes it sits above. */
.${cls.branchPicker} {
  display: flex;
  flex: none;
  flex-direction: column;
  gap: 1px;
  max-height: 40vh;
  overflow: auto;
  padding: 6px 8px 8px;
  border-bottom: 0.5px solid var(--dsw-alias-border-l3);
  background: var(--dsw-alias-bg-layer-2);
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

/* ── a change drawer (ChangeGroupPane) ──────────────────────────────────── */

/* One shape for every resident group: the staged drawer above the commit box and
   the working-tree drawers below it. Each takes its content's height up to a cap
   and scrolls inside itself past it, so a twenty-file group never pushes the
   others off screen; each grip takes height back from the drawers below it, the
   way every other pane does. The cap is a percentage so it survives a window
   resize; a dragged height replaces it with pixels (the inline max-height:none).
   No min-height: 'auto' keeps a drawer no shorter than its own header plus one
   row, which is also the floor the grip clamps to. */
.${cls.changeDrawer} {
  display: flex;
  flex: 0 1 auto;
  flex-direction: column;
  max-height: 40%;
  overflow: hidden;
}

.${cls.changeBody} {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  /* The clearance the old single list had now lives here, on the scroller that
     actually owns the rows: '+'/'−' are the last thing before the edge, and the
     engines that draw an overlay scrollbar put it exactly there. The row keeps its
     own 12px, so the button ends 22px before the scrollbar and 32px from the
     visual edge — inside the list, rather than against its wall. */
  padding-right: 10px;
  scrollbar-width: thin;
  scrollbar-color: var(--dsw-alias-scrollbar-bg-l1) transparent;
}

.${cls.changeBody}::-webkit-scrollbar { width: 10px; height: 10px; }
.${cls.changeBody}::-webkit-scrollbar-thumb {
  border-radius: 5px;
  background: var(--dsw-alias-scrollbar-bg-l1);
}
.${cls.changeBody}::-webkit-scrollbar-track { background: transparent; }

/* The staged drawer is the one drawn above the commit box, and the rule under it
   is what separates "what this message commits" from the message itself. */
.${cls.changeDrawer}[data-drawer='staged'] {
  border-bottom: 0.5px solid var(--dsw-alias-border-l3);
}

/* The working-tree drawers sit one under another in the change body: hairline
   between them, and none above the first, which follows the commit box. */
.${cls.body} .${cls.changeDrawer} + .${cls.changeDrawer} {
  border-top: 0.5px solid var(--dsw-alias-border-l3);
}

/* ── change list ────────────────────────────────────────────────────────── */

/* The column the change panes share: the working-tree drawers, the conflict
   group and the clean state. The drawers size themselves and scroll their own
   rows, so this is a column rather than a scroller — the overflow stays as the
   backstop for a panel too short to honour every floor at once. */
.${cls.body} {
  /* 'flex: auto' with a floor: the body yields space to a dragged diff dock,
     but never so much that the change list it holds stops being usable. */
  display: flex;
  flex: auto;
  flex-direction: column;
  min-height: 56px;
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

/* The conflict group is not a drawer: it comes and goes with the merge, and a
   grip on a group that exists for one afternoon is not height anyone wants to
   take back from the list. */
.${cls.body} > .${cls.group} {
  flex: none;
}

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
   on them goes nowhere (which is why the history caret never turned). */
.${cls.groupToggle}[aria-expanded='true'] .${cls.groupCaret} {
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
   (12px of row padding + a 12px badge + the 8px gap) so it reads as "this group
   has no rows" rather than as a stray sentence. */
.${cls.groupEmpty} {
  margin: 0;
  padding: 4px 12px 6px 32px;
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
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

/* ── commit box ─────────────────────────────────────────────────────────── */

.${cls.commitBox} {
  display: flex;
  flex: none;
  flex-direction: column;
  gap: 5px;
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
  min-height: 48px;
  /* The textarea carries a native vertical resize handle; the cap is what stops
     it from eating the column, not the resize itself. */
  max-height: 260px;
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
  flex: 0 1 auto;
  flex-direction: column;
  min-height: 0;
  height: auto;
  overflow: hidden;
  border-top: 0.5px solid var(--dsw-alias-border-l3);
}

/* A diff gets a fixed half-screen — that is what a diff needs. The commit list
   instead takes its content's height up to a cap: a five-commit history that
   reserved half the panel would be mostly empty box. */
.${cls.bottom}[data-expanded='true'][data-tab='diff'] { height: 50vh; }
.${cls.bottom}[data-expanded='true'][data-tab='history'] {
  height: auto;
  max-height: 40vh;
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

.${cls.bottomChevron} {
  flex: none;
  transition: transform 120ms ease;
}

.${cls.tool}[aria-expanded='true'] .${cls.bottomChevron} {
  transform: rotate(90deg);
}

.${cls.bottomBody} {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-height: 0;
}

/* The commit list is the one panel that scrolls its whole body; the diff brings
   its own scroller (the hunks) so its path header and layout buttons stay put. */
.${cls.bottomScroll} {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  scrollbar-width: thin;
  scrollbar-color: var(--dsw-alias-scrollbar-bg-l1) transparent;
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
  padding: 4px 12px 5px 22px;
}

/* ── commit detail (FR-3.6) ─────────────────────────────────────────────── */

.${cls.commitTop} {
  display: flex;
  min-width: 0;
  align-items: baseline;
  gap: 6px;
  border-radius: 5px;
  cursor: pointer;
}

.${cls.commitTop}:hover .${cls.commitSubject} {
  color: var(--dsw-alias-brand-primary);
}

.${cls.historyCaret} {
  flex: none;
  align-self: center;
  color: var(--dsw-alias-label-tertiary);
  transition: transform 120ms ease;
}

.${cls.commitTop}[aria-expanded='true'] .${cls.historyCaret} {
  transform: rotate(90deg);
}

.${cls.commitDetail} {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 5px 0 3px 18px;
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
  .${cls.groupCaret},
  .${cls.bottomChevron} { transition: none; }
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
