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
  track: `${P}-track`,
  trackIcon: `${P}-track-icon`,
  spacer: `${P}-spacer`,
  tool: `${P}-tool`,
  body: `${P}-body`,
  group: `${P}-group`,
  groupHead: `${P}-group-head`,
  groupLabel: `${P}-group-label`,
  count: `${P}-count`,
  groupActions: `${P}-group-actions`,
  ghost: `${P}-ghost`,
  row: `${P}-row`,
  badge: `${P}-badge`,
  path: `${P}-path`,
  pathDir: `${P}-path-dir`,
  pathName: `${P}-path-name`,
  rowActions: `${P}-row-actions`,
  status: `${P}-status`,
  statusTitle: `${P}-status-title`,
  statusHint: `${P}-status-hint`,
  primary: `${P}-primary`,
  note: `${P}-note`,
  history: `${P}-history`,
  historyHead: `${P}-history-head`,
  historyCaret: `${P}-history-caret`,
  commit: `${P}-commit`,
  commitTop: `${P}-commit-top`,
  commitHash: `${P}-commit-hash`,
  commitSubject: `${P}-commit-subject`,
  commitMeta: `${P}-commit-meta`,
  marker: `${P}-marker`,
  spinner: `${P}-spinner`,
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
  cursor: default;
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

/* ── change list ────────────────────────────────────────────────────────── */

.${cls.body} {
  flex: auto;
  min-height: 0;
  margin-right: 2px;
  padding-bottom: 8px;
  overflow: auto;
  scrollbar-gutter: stable;
  scrollbar-color: var(--dsw-alias-scrollbar-bg-l1) transparent;
}

.${cls.groupHead} {
  position: sticky;
  top: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 8px 4px 12px;
  background: var(--dsw-alias-bg-layer-1);
}

.${cls.groupLabel} {
  flex: none;
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.02em;
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
  /* Actions stay hidden until the header is hovered or focused within, so the
     list reads as a list and the controls appear where the pointer already is. */
  opacity: 0;
}

.${cls.groupHead}:hover .${cls.groupActions},
.${cls.groupHead}:focus-within .${cls.groupActions} {
  opacity: 1;
}

.${cls.row} {
  display: flex;
  width: 100%;
  min-width: 0;
  align-items: center;
  gap: 8px;
  padding: 4px 8px 4px 12px;
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

/* ── history ────────────────────────────────────────────────────────────── */

.${cls.history} {
  margin-top: 4px;
  border-top: 0.5px solid var(--dsw-alias-border-l3);
}

.${cls.historyHead} {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 6px;
  padding: 7px 8px 7px 12px;
  border: 0;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.02em;
  text-align: left;
  cursor: pointer;
}

.${cls.historyHead}:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}

.${cls.historyCaret} {
  flex: none;
  color: var(--dsw-alias-label-tertiary);
  transition: transform 120ms ease;
}

.${cls.historyCaret}[data-open='true'] {
  transform: rotate(90deg);
}

.${cls.commit} {
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 4px 12px 5px 22px;
}

.${cls.commitTop} {
  display: flex;
  min-width: 0;
  align-items: baseline;
  gap: 6px;
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

@keyframes ${P}-spin {
  to { transform: rotate(360deg); }
}

/* ── quality floor ──────────────────────────────────────────────────────── */

.${cls.root} :focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: -1px;
}

@media (prefers-reduced-motion: reduce) {
  .${cls.spinner} { animation-duration: 2400ms; }
  .${cls.historyCaret} { transition: none; }
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
