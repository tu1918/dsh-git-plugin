/**
 * Client-half tests: real React, real DOM, no DSH process.
 *
 * The browser half's behaviour is the deliverable, so it is exercised here in a
 * jsdom document rather than eyeballed: the panel's loading → ready transition,
 * the four groups and their badges, the clean and failure states, the history
 * section's lazy load, and the plugin's own two-stage registration.
 *
 * What is NOT here is DSH itself. The registration is checked against stub
 * registries that record what was asked of them, which is the honest split: this
 * proves the plugin asks for the right things at the right time, and the real
 * mount is confirmed in the GUI.
 *
 * @module dsh-git-panel/test/client-panel
 */

import { JSDOM } from 'jsdom'
import { after, afterEach, before, beforeEach, describe, it, mock } from 'node:test'
import assert from 'node:assert/strict'

// A document must exist before any component is rendered. jsdom is installed on
// the globals rather than passed around because React reaches for `document` and
// `window` directly.
const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
  url: 'http://127.0.0.1:3080/',
  pretendToBeVisual: true,
})
const { window } = dom
// `navigator` is getter-only on Node 24's globalThis, so it cannot be assigned;
// every other global here is writable. Defining it keeps React's environment
// detection from seeing Node's own navigator object.
const globals: Record<string, unknown> = {
  window,
  document: window.document,
  HTMLElement: window.HTMLElement,
  Element: window.Element,
  Node: window.Node,
  Event: window.Event,
  MouseEvent: window.MouseEvent,
  requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(() => callback(Date.now()), 0),
  cancelAnimationFrame: (handle: number) => clearTimeout(handle),
}
for (const [name, value] of Object.entries(globals)) {
  Object.defineProperty(globalThis, name, { value, writable: true, configurable: true })
}
Object.defineProperty(globalThis, 'navigator', {
  value: window.navigator,
  writable: true,
  configurable: true,
})
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const { createElement: h } = await import('react')
const { createRoot } = await import('react-dom/client')
const { act } = await import('react')

const { StatusPanel } = await import('../src/client/ui/StatusPanel.tsx')
const { placeLayer } = await import('../src/client/ui/popover.tsx')
const { Menu } = await import('../src/client/ui/menu.tsx')
const { cls, STYLE_TAG_ID, installStyles } = await import('../src/client/ui/styles.ts')
const { DIR_COLLAPSE_KEY, VIEW_MODE_KEY } = await import('../src/client/ui/change-view.ts')
const { BOTTOM_PANE_KEY } = await import('../src/client/ui/bottom-view.ts')
const {
  CHANGE_MIN_HEIGHT,
  COLUMN_SEPARATORS,
  RAIL_HEIGHT,
  COMMIT_INPUT_MAX_HEIGHT,
  COMMIT_INPUT_MIN_HEIGHT,
  COMMIT_MAX_HEIGHT,
  COMMIT_MIN_HEIGHT,
  DOCK_MIN_HEIGHT,
  DOCK_RESERVED,
  STAGED_MAX_HEIGHT,
  STAGED_RESERVED_HEIGHT,
} = await import('../src/client/ui/panel-layout.ts')
const { NS, en, zh } = await import('../src/client/locales.ts')
const { FILE_KINDS } = await import('../src/core/file-kind.ts')
const { diffTargetKey } = await import('../src/core/diff-target.ts')
const { FileKindGlyph } = await import('../src/client/ui/icons.tsx')
const { GIT_PANEL_ID, GIT_PANEL_KIND, gitPanelDefinition } = await import(
  '../src/client/adapter/sidebar-tab.tsx'
)
const { apply } = await import('../src/client/index.tsx')

import type {
  BranchRef,
  CommitDetail,
  CommitInfo,
  FileDiff,
  GeneratedMessage,
  OperationReport,
  RepoStatus,
  StashEntry,
  UndoResult,
} from '../src/core/types.ts'
import type { GitChange, GitChangeKind, GitRemoteClient, Result } from '../src/core/ports.ts'
import type { MenuEntry } from '../src/client/ui/menu.tsx'

/** A translator over the real English dictionary. */
const t = (key: keyof typeof en, vars?: Readonly<Record<string, string | number>>): string => {
  const template = en[key]
  if (vars === undefined) return template
  return template.replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? `{${name}}`))
}

/** A status reading with one file in each area. */
function statusFixture(): RepoStatus {
  return {
    root: '/repo',
    branch: {
      oid: 'a'.repeat(40),
      name: 'main',
      upstream: 'origin/main',
      ahead: 2,
      behind: 1,
      head: 'branch',
    },
    groups: {
      staged: [
        { path: 'src/staged.ts', index: 'M', worktree: '.', staged: true, untracked: false, conflicted: false },
      ],
      unstaged: [
        { path: 'deep/nested/dir/changed.ts', index: '.', worktree: 'M', staged: false, untracked: false, conflicted: false },
      ],
      untracked: [
        { path: 'notes.md', index: '?', worktree: '.', staged: false, untracked: true, conflicted: false },
      ],
      conflicted: [
        { path: 'both.txt', index: 'U', worktree: 'U', staged: true, untracked: false, conflicted: true },
      ],
    },
    truncated: false,
    merging: false,
    changedCount: 4,
  }
}

/** A branch listing that agrees with {@link statusFixture}. */
function branchesFixture(): readonly BranchRef[] {
  return [
    {
      name: 'main',
      current: true,
      oid: 'a'.repeat(40),
      upstream: 'origin/main',
      ahead: 2,
      behind: 1,
      upstreamGone: false,
      committedAt: '2026-09-11T10:00:00+08:00',
      subject: 'latest',
    },
  ]
}

/** One commit for the history section. */
function commitFixture(): CommitInfo {
  return {
    oid: 'b'.repeat(40),
    shortOid: 'bbbbbbb',
    subject: 'a commit subject',
    authorName: 'Ada',
    authoredAt: '2026-09-11T10:00:00+08:00',
    committedAt: '2026-09-11T10:00:00+08:00',
    parents: [],
    pushed: false,
  }
}

/** Every mutating call the panel made, in order, as a readable string. */
interface ActionLog {
  readonly entries: string[]
}

/** One stash entry for the stash list (FR-6.2). */
function stashFixture(overrides: Partial<StashEntry> = {}): StashEntry {
  return {
    oid: 'd'.repeat(40),
    shortOid: 'ddddddd',
    selector: 'stash@{0}',
    subject: 'WIP on main: aaaa111 first',
    createdAt: '2026-09-11T10:00:00+08:00',
    ...overrides,
  }
}

/**
 * A diff with one edit and two changed words, and the offsets FR-2.3 needs.
 *
 * The marks address `text` directly, which is the whole point of the contract:
 * the renderer slices a string rather than comparing two of them, so this
 * fixture can assert on the exact characters that end up highlighted.
 */
function diffFixture(overrides: Partial<FileDiff> = {}): FileDiff {
  return {
    path: 'src/changed.ts',
    area: 'worktree',
    hunks: [
      {
        oldStart: 1,
        oldCount: 3,
        newStart: 1,
        newCount: 3,
        heading: 'function fixture()',
        lines: [
          { kind: 'context', text: 'export function fixture(): number {', oldLine: 1, newLine: 1, marks: [] },
          { kind: 'removed', text: '  return thirty + two', oldLine: 2, newLine: null, marks: [{ start: 9, end: 15 }, { start: 18, end: 21 }] },
          { kind: 'added', text: '  return sixty + four', oldLine: null, newLine: 2, marks: [{ start: 9, end: 14 }, { start: 17, end: 21 }] },
          { kind: 'context', text: '}', oldLine: 3, newLine: 3, marks: [] },
        ],
      },
      {
        oldStart: 10,
        oldCount: 1,
        newStart: 10,
        newCount: 1,
        heading: '',
        lines: [
          { kind: 'removed', text: 'let oldOnly = 1', oldLine: 10, newLine: null, marks: [] },
          { kind: 'added', text: 'let newOnly = 1', oldLine: null, newLine: 10, marks: [] },
        ],
      },
    ],
    additions: 2,
    deletions: 2,
    lines: 6,
    binary: false,
    combined: false,
    large: false,
    truncated: false,
    ...overrides,
  }
}

/**
 * A git client whose answers the test chooses.
 *
 * `diff` answers the same way for every request unless the caller overrides it;
 * when it does, not supplying a way to record the calls is the caller's business
 * and the recording is simply skipped.
 */
function stubGit(options: {
  status?: Result<RepoStatus>
  branches?: readonly BranchRef[]
  log?: readonly CommitInfo[]
  watch?: (sessionId: string, onChange: (change: GitChange) => void) => () => void
  /** What every report-returning mutation answers; a silent success by default. */
  report?: Result<OperationReport>
  /** What every commit answers; a fixed commit by default. */
  commit?: Result<CommitInfo>
  /** Where mutating calls are recorded, for the tests that assert on them. */
  calls?: ActionLog
  /** What every `diff` answers; {@link diffFixture} by default. */
  diff?: (path: string, area: FileDiff['area']) => Result<FileDiff>
  /** Where diff requests are recorded, as `target:path@context`. */
  diffCalls?: string[]
  /** What `showCommit` answers; an empty file list by default. */
  showCommit?: Result<CommitDetail>
  /** What `generateCommitMessage` answers; a fixed message by default. */
  generated?: Result<GeneratedMessage>
  /** What `deleteBranch` answers, for the unmerged-refusal path. */
  deleteBranch?: Result<OperationReport>
  /** What `discard` answers, for the refusal path. */
  discard?: Result<OperationReport>
  /** What `undoCommit` answers; a reset of the newest commit by default. */
  undoCommit?: Result<UndoResult>
  /** What the stash listing answers; one entry by default (FR-6.2). */
  stashes?: readonly StashEntry[]
  /** What `stashSave` answers, for the refusal path. */
  stashSave?: Result<OperationReport>
  /** What `stashApply` answers, for the conflict path. */
  stashApply?: Result<OperationReport>
  /** What `stashDrop` answers, for the stale-row path. */
  stashDrop?: Result<OperationReport>
  /** What `checkout` answers: a value, or a function for the tests that need the
   *  first attempt refused and the retry accepted (FR-4.4's shortcut). */
  checkout?: Result<OperationReport> | (() => Result<OperationReport>)
  /** The deployment's icon map (FR-1.2); empty by default, as most deployments are.
   *  A function is for the tests that count the reads. */
  fileIcons?: Readonly<Record<string, string>> | (() => Readonly<Record<string, string>>)
}): GitRemoteClient {
  const report: Result<OperationReport> =
    options.report ?? { ok: true, value: { summary: '', detail: '' } }
  const committed: Result<CommitInfo> = options.commit ?? { ok: true, value: commitFixture() }
  const note = (line: string): void => {
    options.calls?.entries.push(line)
  }

  return {
    status: () => Promise.resolve(options.status ?? { ok: true, value: statusFixture() }),
    branches: () => Promise.resolve({ ok: true, value: options.branches ?? branchesFixture() }),
    log: () =>
      Promise.resolve({ ok: true, value: { commits: options.log ?? [], total: null, hasMore: false } }),
    diff: (_sessionId, path, target, contextLines) => {
      options.diffCalls?.push(`${diffTargetKey(target)}:${path}@${contextLines}`)
      const answer = options.diff?.(path, target.area) ?? {
        ok: true as const,
        value: diffFixture({ path, area: target.area }),
      }
      return Promise.resolve(answer)
    },
    stage: (_sessionId, paths) => {
      note(`stage:${paths.join(',')}`)
      return Promise.resolve(report)
    },
    unstage: (_sessionId, paths) => {
      note(`unstage:${paths.join(',')}`)
      return Promise.resolve(report)
    },
    discard: (_sessionId, paths) => {
      note(`discard:${paths.join(',')}`)
      return Promise.resolve(options.discard ?? report)
    },
    commit: (_sessionId, message) => {
      note(`commit:${message}`)
      return Promise.resolve(committed)
    },
    commitAll: (_sessionId, message) => {
      note(`commitAll:${message}`)
      return Promise.resolve(committed)
    },
    push: () => {
      note('push')
      return Promise.resolve(report)
    },
    pull: () => {
      note('pull')
      return Promise.resolve(report)
    },
    sync: () => {
      note('sync')
      return Promise.resolve(report)
    },
    checkout: (_sessionId, name) => {
      note(`checkout:${name}`)
      const answer = options.checkout
      return Promise.resolve(
        typeof answer === 'function' ? answer() : (answer ?? report),
      )
    },
    createBranch: (_sessionId, name, base) => {
      note(`createBranch:${name}@${base ?? ''}`)
      return Promise.resolve(report)
    },
    deleteBranch: (_sessionId, name, force) => {
      note(`deleteBranch:${name}${force ? ':force' : ''}`)
      return Promise.resolve(options.deleteBranch ?? report)
    },
    continueMerge: () => {
      note('continueMerge')
      return Promise.resolve(report)
    },
    abortMerge: () => {
      note('abortMerge')
      return Promise.resolve(report)
    },
    generateCommitMessage: (_sessionId, locale) => {
      note(`generate:${locale}`)
      return Promise.resolve(
        options.generated ?? { ok: true, value: { message: 'feat: generated', truncated: false } },
      )
    },
    showCommit: (_sessionId, hash) => {
      note(`showCommit:${hash}`)
      return Promise.resolve(
        options.showCommit ?? {
          ok: true,
          value: {
            commit: { ...commitFixture(), oid: hash, shortOid: hash.slice(0, 7) },
            files: [],
          },
        },
      )
    },
    undoCommit: (_sessionId, hash) => {
      note(`undoCommit:${hash}`)
      return Promise.resolve(
        options.undoCommit ?? {
          ok: true,
          value: { mode: 'reset' as const, shortOid: hash.slice(0, 7), subject: 'a commit subject' },
        },
      )
    },
    stashes: () => {
      note('stashes')
      return Promise.resolve({ ok: true, value: options.stashes ?? [stashFixture()] })
    },
    stashSave: (_sessionId, message, untracked) => {
      note(`stashSave:${message ?? ''}${untracked ? ':untracked' : ''}`)
      return Promise.resolve(options.stashSave ?? report)
    },
    stashApply: (_sessionId, oid, pop) => {
      note(`stashApply:${oid}${pop ? ':pop' : ''}`)
      return Promise.resolve(options.stashApply ?? report)
    },
    stashDrop: (_sessionId, oid) => {
      note(`stashDrop:${oid}`)
      return Promise.resolve(options.stashDrop ?? report)
    },
    // Not logged: the shared log is "the mutations the panel made", and this is a
    // deployment read (the stash listing is filtered the same way where it matters).
    fileIcons: () => {
      const answer = options.fileIcons
      const value = typeof answer === 'function' ? answer() : (answer ?? {})
      return Promise.resolve({ ok: true as const, value })
    },
    watch: options.watch ?? (() => () => undefined),
  }
}

/** The fixture status with only the named groups left populated. */
function statusWith(parts: Partial<RepoStatus['groups']>): RepoStatus {
  return {
    ...statusFixture(),
    groups: { staged: [], unstaged: [], untracked: [], conflicted: [], ...parts },
    changedCount: 1,
  }
}

/** The fixture status with a chosen branch state. */
function statusOnBranch(branch: Partial<RepoStatus['branch']>): RepoStatus {
  return { ...statusFixture(), branch: { ...statusFixture().branch, ...branch } }
}

/**
 * A status whose only change is a staged file.
 *
 * Stated rather than inherited from {@link statusFixture}, which deliberately
 * carries all four groups: the commit box's behaviour depends on exactly which
 * groups are populated, so a test about one scope has to say so.
 */
function stagedOnlyStatus(): RepoStatus {
  return statusWith({
    staged: [
      { path: 'src/staged.ts', index: 'M', worktree: '.', staged: true, untracked: false, conflicted: false },
    ],
  })
}

/** Render a tree into a detached container and return it. */
async function render(element: ReturnType<typeof h>): Promise<HTMLElement> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  rendered.push(root)
  await act(async () => {
    root.render(element)
  })
  return container
}

/** Let pending promises and effects settle. */
async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

/**
 * Let a mutation, its state update, and the re-read it triggers all land.
 *
 * One more turn of the event loop than {@link settle}: an action resolves a
 * promise, then the panel re-reads the repository, which resolves another.
 */
async function flush(): Promise<void> {
  await settle()
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  await settle()
}

/** Click an element inside `act`, so React flushes the update it causes. */
async function click(node: Element): Promise<void> {
  await act(async () => {
    node.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  })
  await flush()
}

/**
 * Press an element — a `pointerdown`, which is what a floating layer dismisses
 * itself on.
 *
 * Not a `click`: a layer closes when the press starts outside it, whatever the
 * pointer does afterwards, and a test that dispatched `click` would be checking
 * the wrong event.
 */
async function press(node: Element): Promise<void> {
  await act(async () => {
    node.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true }))
  })
  await settle()
}

/** A rectangle for stubbing layout, since jsdom has none. */
function rect(top: number, height: number): DOMRect {
  return {
    top,
    bottom: top + height,
    height,
    left: 0,
    right: 320,
    width: 320,
    x: 0,
    y: top,
    toJSON: () => ({}),
  } as DOMRect
}

/** Set a textarea's value the way React's controlled inputs expect. */
async function typeInto(node: HTMLTextAreaElement, value: string): Promise<void> {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set
  await act(async () => {
    setter?.call(node, value)
    node.dispatchEvent(new window.Event('input', { bubbles: true }))
  })
  await settle()
}

/**
 * What each group header counts, in the order the panel draws them.
 *
 * Scoped to the headers on purpose: `.dgp-count` is also the badge a directory row
 * carries in the tree, so a bare query would mix the two.
 */
function groupCounts(container: HTMLElement): (string | null)[] {
  return [...container.querySelectorAll(`.${cls.groupHead} .${cls.count}`)].map(
    (node) => node.textContent,
  )
}

/** Query one element, failing loudly rather than returning `null`. */
function must<T extends Element>(container: ParentNode, selector: string): T {
  const found = container.querySelector<T>(selector)
  if (found === null) throw new Error(`expected ${selector} to exist`)
  return found
}

/**
 * Drag a pane's grip the way a pointer does: press on the grip, move, release.
 *
 * The release is not decoration. The grip listens on `window` so a pointer that
 * leaves its 7px strip keeps resizing, which means a grip that is never released
 * keeps resizing *everything* dragged afterwards — a real bug that a test which
 * only ever presses and moves cannot see.
 * @param grip - The grip element.
 * @param fromY - Where the press lands.
 * @param toY - Where the pointer ends up.
 */
async function dragGrip(grip: Element, fromY: number, toY: number): Promise<void> {
  await act(async () => {
    grip.dispatchEvent(new window.MouseEvent('pointerdown', { clientY: fromY, bubbles: true }))
    window.dispatchEvent(new window.MouseEvent('pointermove', { clientY: toY, bubbles: true }))
    window.dispatchEvent(new window.MouseEvent('pointerup', { bubbles: true }))
  })
  await flush()
}

/** The three sync buttons of the state rail, in render order. */
function syncButtons(container: HTMLElement): HTMLButtonElement[] {
  const rail = must(container, `.${cls.head}`)
  return [...rail.querySelectorAll<HTMLButtonElement>(`.${cls.tool}`)].slice(0, 3)
}

/** The layout key the pane persists under; read here so the tests name it once. */
const DIFF_LAYOUT_KEY = 'dsh-git-panel/diff-layout'

before(() => {
  installStyles(document)
})

/**
 * Every root this file has rendered, so a test's effects are torn down.
 *
 * A mounted panel keeps a clock (the history's relative times) and, while a
 * change is arriving, a debounce. A file that never unmounts leaves those timers
 * pending, and the test process then has nothing to do but wait for them: it
 * hangs instead of reporting.
 */
const rendered: { unmount: () => void }[] = []

// The layout choice is persisted (FR-2.4), so one test's choice would otherwise
// decide how the next one renders.
beforeEach(() => {
  dom.window.localStorage.clear()
})

afterEach(async () => {
  const pending = rendered.splice(0)
  await act(async () => {
    for (const root of pending) root.unmount()
  })
  document.body.textContent = ''
})

after(() => {
  dom.window.close()
})

describe('the panel stylesheet', () => {
  it('is installed once, however often it is asked for', () => {
    installStyles(document)
    installStyles(document)
    const tags = document.querySelectorAll(`style[data-plugin-css="${STYLE_TAG_ID}"]`)
    assert.equal(tags.length, 1, 'a reload must replace the sheet, not stack a second copy')
  })

  it('gives a commit row a hover band and a selected band', () => {
    installStyles(document)
    const sheet =
      document.querySelector<HTMLStyleElement>(`style[data-plugin-css="${STYLE_TAG_ID}"]`)
        ?.textContent ?? ''
    // jsdom cannot resolve `var()`, so this asserts the RULES rather than a
    // computed colour: the hover band and the "you are here" band are the visible
    // half of a commit row being a control, and the tokens are the GUI's own
    // interactive aliases (the same ones the built-in sidebars use).
    assert.match(
      sheet,
      new RegExp(`\\.${cls.commitRow}:hover\\s*\\{[^}]*--dsw-alias-interactive-bg-hover`, 'u'),
    )
    assert.match(
      sheet,
      new RegExp(
        `\\.${cls.commitRow}\\[data-selected='true'\\]\\s*\\{[^}]*--dsw-alias-interactive-bg-active`,
        'u',
      ),
    )
  })

  it('gives a menu entry one highlight, whoever put it there', () => {
    installStyles(document)
    const sheet =
      document.querySelector<HTMLStyleElement>(`style[data-plugin-css="${STYLE_TAG_ID}"]`)
        ?.textContent ?? ''
    // Hover and the arrow keys' active row share ONE rule on purpose: a menu whose
    // two highlights could disagree about what Enter will run would be lying about
    // its own next click.
    assert.match(
      sheet,
      new RegExp(
        `\\.${cls.menuItem}:hover:not\\(:disabled\\),\\s*\\.${cls.menuItem}\\[data-active='true'\\]:not\\(:disabled\\)\\s*\\{[^}]*--dsw-alias-interactive-bg-hover`,
        'u',
      ),
    )
  })

  it('paints an action in the GUI’s link ink, and keeps the footnote ink separate', () => {
    installStyles(document)
    const sheet =
      document.querySelector<HTMLStyleElement>(`style[data-plugin-css="${STYLE_TAG_ID}"]`)
        ?.textContent ?? ''
    // Two borderless text controls, two inks — reported from the running panel:
    // "新建分支" and "贮藏当前更改" were the footnote colour, so nothing looked
    // clickable. `.ghost` stays tertiary (a cancel, a fold), `.accent` takes the
    // token DSH itself paints clickable text with, so a skin still decides.
    assert.match(sheet, new RegExp(`\\.${cls.ghost}\\s*\\{[^}]*--dsw-alias-label-tertiary`, 'u'))
    assert.match(sheet, new RegExp(`\\.${cls.accent}\\s*\\{[^}]*--dsw-alias-link`, 'u'))
    assert.match(
      sheet,
      new RegExp(
        `\\.${cls.accent}:hover:not\\(:disabled\\)\\s*\\{[^}]*--dsw-alias-interactive-bg-hover`,
        'u',
      ),
    )
  })

  it('ellipsizes a file name too long for its tab or its diff header', () => {
    installStyles(document)
    const sheet =
      document.querySelector<HTMLStyleElement>(`style[data-plugin-css="${STYLE_TAG_ID}"]`)
        ?.textContent ?? ''
    // Reported from the running panel: "文件名超长的需要省略". A name longer than
    // the box has to end in an ellipsis rather than be chopped mid-letter by the
    // container's own clip — the tab because it is a tab, the diff header and the
    // change row because that is where the file is named.
    for (const name of [cls.bottomTab, cls.diffPathName, cls.pathName]) {
      assert.match(
        sheet,
        new RegExp(`\\.${name}\\s*\\{[^}]*overflow: hidden[^}]*text-overflow: ellipsis`, 'u'),
        `${name} must ellipsize`,
      )
    }
    // And the DIRECTORY is the side that gives way first (FR-1.2): its shrink
    // weight is a hundred times the name's, so the name is the last thing to lose
    // a character — and it ends in an ellipsis when it finally does.
    for (const [dir, name] of [
      [cls.pathDir, cls.pathName],
      [cls.diffPathDir, cls.diffPathName],
    ] as const) {
      assert.match(sheet, new RegExp(`\\.${dir}\\s*\\{[^}]*flex: 0 100 auto`, 'u'))
      assert.match(sheet, new RegExp(`\\.${name}\\s*\\{[^}]*flex: 0 1 auto`, 'u'))
    }
  })

  it('reveals a diff tab’s × only while the pointer or the keyboard is on it', () => {
    installStyles(document)
    const sheet =
      document.querySelector<HTMLStyleElement>(`style[data-plugin-css="${STYLE_TAG_ID}"]`)
        ?.textContent ?? ''
    // Asked for after the first multi-tab build: "hover 到标签条上的某个 tab 时候，
    // 显示 × 进行关闭". It keeps its width while hidden, so revealing it never nudges
    // the label, and it is revealed by the tab it belongs to rather than by the
    // whole strip. `visibility` and not plain transparency: a control nobody can
    // see must not be a target, or a stray tap on a tab's right edge would close it.
    assert.match(
      sheet,
      new RegExp(
        `\\.${cls.bottomTabGroup} \\.${cls.tool}\\s*\\{[^}]*visibility: hidden[^}]*opacity: 0`,
        'u',
      ),
    )
    assert.match(
      sheet,
      new RegExp(
        `\\.${cls.bottomTabGroup}:hover \\.${cls.tool},\\s*\\.${cls.bottomTabGroup}:focus-within \\.${cls.tool}\\s*\\{[^}]*visibility: visible[^}]*opacity: 1`,
        'u',
      ),
    )
  })

  it('gives each half of a side-by-side diff its own scrollbar, and keeps the halves fixed', () => {
    installStyles(document)
    const sheet =
      document.querySelector<HTMLStyleElement>(`style[data-plugin-css="${STYLE_TAG_ID}"]`)
        ?.textContent ?? ''
    // Two reports, one shape: "左右 diff 视图，固定分为左右两半区。现在有越界的情况"
    // and then "如果有超出去的话在底部加滚动条". Letting the row grow to fit the
    // longest line pushed the right half off the pane; clipping it lost the rest of
    // the line. So each half is half of the pane whatever the lines are, and each
    // half is its own scroller — the scrollbar for an over-long line appears at the
    // bottom of the half that overflows.
    assert.match(sheet, new RegExp(`\\.${cls.diffSplit}\\s*\\{[^}]*display: flex`, 'u'))
    assert.match(sheet, new RegExp(`\\.${cls.diffSide}\\s*\\{[^}]*flex: 1 1 50%`, 'u'))
    assert.match(sheet, new RegExp(`\\.${cls.diffSide}\\s*\\{[^}]*overflow: auto`, 'u'))
    // The divider is a LANE, not just breathing room: the gap sits between the two
    // scrollers, so a per-line action placed there can never be dragged sideways by
    // a long line, and the hairline is the boundary itself.
    assert.match(sheet, new RegExp(`\\.${cls.diffSplit}\\s*\\{[^}]*gap: 16px`, 'u'))
    assert.match(
      sheet,
      new RegExp(
        `\\.${cls.diffSide}\\[data-side='right'\\]\\s*\\{[^}]*border-left: 0.5px solid`,
        'u',
      ),
    )
    // A cell rides its own content (so the half can scroll to it) but never
    // narrower than the half; its height is the line box, or a padded cell would
    // make the two halves drift apart line by line.
    assert.match(sheet, new RegExp(`\\.${cls.diffCell}\\s*\\{[^}]*width: max-content`, 'u'))
    assert.match(sheet, new RegExp(`\\.${cls.diffCell}\\s*\\{[^}]*min-width: 100%`, 'u'))
    assert.match(sheet, new RegExp(`\\.${cls.diffCell}\\s*\\{[^}]*min-height: 18px`, 'u'))
    // A header wider than the half must not push it either: the heading ellipsizes.
    assert.match(sheet, new RegExp(`\\.${cls.diffHunkHead}\\s*\\{[^}]*min-width: 0`, 'u'))
    assert.match(
      sheet,
      new RegExp(`\\.${cls.diffHunkHeading}\\s*\\{[^}]*text-overflow: ellipsis`, 'u'),
    )
    // The INLINE layout keeps whole lines and the pane's own horizontal scroll.
    assert.match(sheet, new RegExp(`\\.${cls.diffLine}\\s*\\{[^}]*min-width: min-content`, 'u'))
  })

  it('sizes a change row by its border box, so its actions stay inside the list', async () => {
    // Reported from the running panel: "the +/− are too close to the edge and
    // blocked". The cause was geometric, not cosmetic. `.dgp-row` is `width: 100%`
    // *and* padded by 20px; under the default `content-box` its box therefore came
    // out wider than the drawer that clips it, and the buttons pinned to its right
    // padding sat in the clipped strip. Whatever else changes, the row's box has to
    // be the box the percentage was measured against.
    const container = await render(
      h(StatusPanel, { sessionId: 's1', git: stubGit({}), t, locale: 'en' }),
    )
    await settle()

    const row = must(container, `.${cls.row}`)
    const style = window.getComputedStyle(row)
    assert.equal(style.boxSizing, 'border-box', 'width: 100% must include the row’s padding')
    assert.equal(style.paddingRight, '12px', 'the +/− keeps a gutter inside the row')
    assert.equal(style.width, '100%')

    // And the scroller that owns the rows keeps the gutter the old single list had,
    // because `+`/`−` are the last thing before the edge: `overflow: auto` is what
    // the overlay-scrollbar engines draw on top of.
    const body = must(container, `.${cls.body}`)
    assert.equal(window.getComputedStyle(body).paddingRight, '10px')
    assert.equal(window.getComputedStyle(body).overflow, 'auto')
  })
})

describe('StatusPanel rendering', () => {
  it('shows a loading state, then the repository', async () => {
    const container = await render(
      h(StatusPanel, { sessionId: 's1', git: stubGit({}), t, locale: 'en' }),
    )
    await settle()

    const root = container.querySelector(`.${cls.root}`)
    assert.ok(root, 'the panel root must render')
    assert.equal(root.getAttribute('data-git-panel'), 'ready')
    assert.equal(root.getAttribute('data-repo'), '/repo')
  })

  it('renders the branch rail with the name and the ahead/behind counts', async () => {
    const container = await render(
      h(StatusPanel, { sessionId: 's1', git: stubGit({}), t, locale: 'en' }),
    )
    await settle()
    const text = container.textContent ?? ''
    assert.match(text, /main/)
    // Counts are shown as bare numbers beside directional glyphs.
    assert.equal(container.querySelectorAll(`.${cls.track}`).length, 2)
  })

  it('gives each row its area’s badge letter', async () => {
    const container = await render(
      h(StatusPanel, { sessionId: 's1', git: stubGit({}), t, locale: 'en' }),
    )
    await settle()
    const text = container.textContent ?? ''
    assert.match(text, /Merge conflicts/)
    assert.match(text, /Staged changes/)
    assert.match(text, /Changes/)
    assert.match(text, /Untracked files/)

    const badges = [...container.querySelectorAll(`.${cls.badge}`)].map((node) => [
      node.getAttribute('data-status'),
      node.textContent,
    ])
    // The staged rows come first, because their drawer sits above the commit box;
    // then a conflict in its own group (the same file never listed twice), then the
    // working tree, then what git does not track yet. One letter, one state: the
    // conflict is `!` — `U` is untracked, and `C`/`M` were taken — which is the
    // letter VS Code's own SCM view uses for an unmerged path.
    assert.deepEqual(badges, [
      ['M', 'M'],
      ['!', '!'],
      ['M', 'M'],
      ['U', 'U'],
    ])
  })

  it('leads a row with a file-kind glyph and ends it with the status letter', async () => {
    const container = await render(
      h(StatusPanel, { sessionId: 's1', git: stubGit({}), t, locale: 'en' }),
    )
    await settle()

    const row = must(fileNode(container, 'unstaged', 'deep/nested/dir/changed.ts'), `.${cls.row}`)
    // One row, one order: the box, what the file IS, the path, the hover actions,
    // and the change-status column at the far right — where the letter stays put
    // down the whole list. The status used to open the row, which meant a reader
    // met an `M` before knowing what the file was.
    assert.deepEqual(
      [...row.children].map((child) => child.className),
      [cls.selectBoxWrap, cls.fileIcon, cls.path, cls.rowActions, cls.badge],
    )
    // It really is the last thing in the row, so nothing can push it off the edge.
    assert.equal(row.lastElementChild?.className, cls.badge)
    // The glyph is a hint, not content: it says nothing to a screen reader, and
    // the row's own name already carries the truth.
    assert.equal(must(row, `.${cls.fileIcon}`).getAttribute('aria-hidden'), 'true')
    assert.equal(must(row, `.${cls.fileIcon}`).getAttribute('data-kind'), 'code')

    // A different file, a different kind — and the same row shape.
    const notes = must(fileNode(container, 'untracked', 'notes.md'), `.${cls.row}`)
    assert.equal(must(notes, `.${cls.fileIcon}`).getAttribute('data-kind'), 'doc')
    assert.equal(
      must(notes, `.${cls.fileIcon}`).querySelector('svg')?.getAttribute('viewBox'),
      '0 0 16 16',
    )
  })

  it('draws a configured icon for its extension, and keeps the built-in glyph elsewhere', async () => {
    let reads = 0
    const svg = '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="7"/></svg>'
    const container = await render(
      h(StatusPanel, {
        sessionId: 's1',
        git: stubGit({
          fileIcons: () => {
            reads += 1
            // Keys arrive normalized (no dot, lowercased) — the host's icon map is
            // what accepts `.TS`, and that normalization is tested there.
            return { ts: svg }
          },
        }),
        t,
        locale: 'en',
      }),
    )
    await settle()

    // `src/staged.ts` has an extension the deployment mapped.
    const staged = must(fileNode(container, 'staged', 'src/staged.ts'), `.${cls.row}`)
    const icon = must(staged, `.${cls.fileIcon}`)
    assert.equal(icon.getAttribute('data-icon'), 'custom')
    const img = must<HTMLImageElement>(icon, 'img')
    assert.match(img.src, /^data:image\/svg\+xml;charset=utf-8,/)
    assert.ok(img.src.includes(encodeURIComponent(svg).slice(0, 24)), 'the document is carried verbatim')

    // A file whose extension is not mapped keeps its built-in kind glyph — one
    // configured icon does not change the rest of the list.
    const notes = must(fileNode(container, 'untracked', 'notes.md'), `.${cls.row}`)
    assert.equal(must(notes, `.${cls.fileIcon}`).getAttribute('data-icon'), 'builtin')
    assert.ok(must(notes, `.${cls.fileIcon}`).querySelector('svg'), 'the built-in glyph is inline SVG')
    assert.equal(must(notes, `.${cls.fileIcon}`).querySelector('img'), null)

    // Read once per panel mount: an icon map is deployment configuration, and a
    // request per render would be a request per keystroke for some deployments.
    assert.equal(reads, 1)
  })

  it('gives the status letter its meaning as a tooltip', async () => {
    // The letter is at the end of the row now, away from the name, and a lone `M`
    // is not something a reader should have to decode.
    const container = await render(
      h(StatusPanel, { sessionId: 's1', git: stubGit({}), t, locale: 'en' }),
    )
    await settle()

    const badgeOf = (area: string, path: string): string | null =>
      must(must(fileNode(container, area, path), `.${cls.row}`), `.${cls.badge}`).getAttribute(
        'title',
      )
    assert.equal(badgeOf('staged', 'src/staged.ts'), 'Modified')
    assert.equal(badgeOf('conflicted', 'both.txt'), 'Unmerged')
    assert.equal(badgeOf('untracked', 'notes.md'), 'Untracked')
  })

  it('draws every file kind as a mark of its own', async () => {
    // The kinds are the whole point of the icon: two that render the same drawing
    // would be a copy-paste a reader pays for. `FILE_KINDS` is the single list, so
    // a tenth kind is covered here the moment it is added to core.
    const drawn = new Map<string, string>()
    for (const kind of FILE_KINDS) {
      const container = await render(h(FileKindGlyph, { kind }))
      const svg = must(container, 'svg')
      assert.equal(svg.getAttribute('viewBox'), '0 0 16 16', kind)
      const shapes = [...svg.querySelectorAll('path, circle')]
      assert.ok(shapes.length >= 1, `${kind}: a mark, not an empty box`)
      if (kind === 'file') {
        assert.equal(shapes.length, 2, 'the plain file is the page and its fold, nothing else')
      }
      // No shared outline: every kind used to sit inside the same page, which made
      // nine glyphs read as one at 14px ("they all look the same at a glance").
      // Only the fallback may draw that page, and it draws nothing on it.
      if (kind !== 'file') {
        assert.equal(
          shapes.some((shape) => (shape.getAttribute('d') ?? '').includes('M4 2.6h5.2')),
          false,
          `${kind}: the fallback's page outline is the fallback's alone`,
        )
      }
      drawn.set(kind, svg.innerHTML)
    }
    assert.equal(new Set(drawn.values()).size, FILE_KINDS.length, 'no two kinds share a drawing')
  })

  it('splits a path in the flat list, so the file name survives and the directory can clip', async () => {
    // FR-1.3's other mode. It has to be asked for now: the tree is the default.
    window.localStorage.setItem(VIEW_MODE_KEY, 'list')
    const container = await render(
      h(StatusPanel, { sessionId: 's1', git: stubGit({}), t, locale: 'en' }),
    )
    await settle()
    const dirs = [...container.querySelectorAll(`.${cls.pathDir}`)].map((n) => n.textContent)
    const names = [...container.querySelectorAll(`.${cls.pathName}`)].map((n) => n.textContent)
    assert.ok(dirs.includes('deep/nested/dir/'), 'the directory keeps its separator')
    assert.ok(names.includes('changed.ts'), 'the name is its own span, so it is never clipped')
    // The full path stays reachable as the row's tooltip (FR-1.2).
    const titles = [...container.querySelectorAll(`.${cls.row}`)].map((n) => n.getAttribute('title'))
    assert.ok(titles.includes('deep/nested/dir/changed.ts'))
  })

  it('says so when the working tree is clean', async () => {
    const clean = statusFixture()
    const empty = {
      ...clean,
      groups: { staged: [], unstaged: [], untracked: [], conflicted: [] },
      changedCount: 0,
    }
    const container = await render(
      h(StatusPanel, {
        sessionId: 's1',
        git: stubGit({ status: { ok: true, value: empty } }),
        t,
        locale: 'en',
      }),
    )
    await settle()
    // There is no "clean" paragraph any more: the three sections are resident, and
    // their counts are the clean state (asked for from the running panel — the
    // message said what the headers either side of it already said).
    assert.deepEqual(groupCounts(container), ['0', '0', '0'], 'every section stays, counting zero')
    assert.equal(container.querySelector('[data-git-panel-state="clean"]'), null)
    // The conflict section is the one that comes and goes: a merge is an afternoon,
    // not furniture.
    assert.equal(container.querySelector('[data-group="conflicted"]'), null)
    // The staged drawer is a fixture of the panel for the same reason: it is the
    // commit box's anchor, and its own empty state says so in words. The two
    // working-tree sections carry their own sentence now (asked for: a bare 0
    // never says whether it means "nothing here" or "never read").
    const drawer = must(container, `[data-group="staged"]`)
    assert.equal(must(drawer, `.${cls.count}`).textContent, '0')
    assert.equal(must(drawer, `.${cls.groupEmpty}`).textContent, 'No staged changes')
    assert.equal(
      must(container, `[data-group="unstaged"] .${cls.groupEmpty}`).textContent,
      'No changes',
    )
    assert.equal(
      must(container, `[data-group="untracked"] .${cls.groupEmpty}`).textContent,
      'No untracked files',
    )
  })

  it('gives the panel one scroller and one grip, not a grip per group', async () => {
    const container = await render(
      h(StatusPanel, { sessionId: 's1', git: stubGit({}), t, locale: 'en' }),
    )
    await settle()

    // Every group is a section of one list, in the order the panel draws them:
    // the staged list above the commit box, then the working-tree groups inside
    // the scrolling body.
    const stagedPane = must(container, `[data-pane="staged"]`)
    assert.equal(
      must(stagedPane, `.${cls.group}`).getAttribute('data-group'),
      'staged',
      'the staged list is the group drawn outside the body',
    )
    assert.deepEqual(
      [...container.querySelectorAll(`.${cls.body} > .${cls.group}`)].map((group) =>
        group.getAttribute('data-group'),
      ),
      ['conflicted', 'unstaged', 'untracked'],
      'the rest flow into the one scroller',
    )

    // The staged list is capped rather than draggable: a long index scrolls in
    // its own share instead of pushing the commit box away. Both ends of that
    // share come from the budget, and the relative ceiling is the smaller of the
    // two fifths and the drawer's own maximum.
    const stagedStyle = window.getComputedStyle(stagedPane)
    assert.equal(stagedStyle.maxHeight, `min(40%, ${String(STAGED_MAX_HEIGHT)}px)`)
    // No floor: the drawer hugs its content, so a collapsed one leaves no blank
    // band above the commit box.
    assert.equal(stagedStyle.minHeight, '0px')
    assert.equal(stagedStyle.overflow, 'auto')

    // And the single scroller is the body.
    const body = must(container, `.${cls.body}`)
    assert.equal(window.getComputedStyle(body).overflow, 'auto')

    // Exactly ONE grip in the whole panel, and it is the dock's. This is the
    // regression the shape exists to prevent: one grip per group put two of them
    // back to back wherever a group was empty (the changes drawer's bottom edge
    // and the dock's top edge), which read as a stack of dead bars.
    const grips = [...container.querySelectorAll(`.${cls.paneGrip}`)]
    assert.equal(grips.length, 1, `expected one grip, found ${String(grips.length)}`)
    assert.ok(
      must(container, `.${cls.bottom}`).contains(grips[0] as Element),
      'the grip that remains is the dock’s',
    )
    // No group carries a grip, and no group is a resizable box of its own.
    assert.equal(stagedPane.querySelector(`.${cls.paneGrip}`), null)
    assert.equal(body.querySelector(`:scope > .${cls.group} .${cls.paneGrip}`), null)
  })

  it('bounded every region, so nothing can squeeze the change list out of shape', async () => {
    // Reported from the running panel: with the dock dragged open and a full
    // index, the change list was squeezed to a header and a scrollbar. The fix is
    // a budget rather than more flex: every region has a floor, the change list is
    // the only one that grows, and the dock's drag is clamped at what the others'
    // floors leave (`ui/panel-layout.ts`).
    const container = await render(
      h(StatusPanel, { sessionId: 's1', git: stubGit({}), t, locale: 'en' }),
    )
    await settle()

    // The staged drawer is the one region with no floor: a folded or empty drawer
    // is as tall as its header, so the commit box sits tight against it (asked for
    // from the running panel). What the budget keeps for it is a reservation
    // against the dock's drag, which the arithmetic test below pins.
    const staged = window.getComputedStyle(must(container, `[data-pane="staged"]`))
    assert.equal(staged.minHeight, '0px')
    assert.equal(staged.maxHeight, `min(40%, ${String(STAGED_MAX_HEIGHT)}px)`)

    const box = window.getComputedStyle(must(container, `.${cls.commitBox}`))
    assert.equal(box.minHeight, `${String(COMMIT_MIN_HEIGHT)}px`)
    assert.equal(box.maxHeight, `${String(COMMIT_MAX_HEIGHT)}px`)
    // A refused commit's reason and the AI's truncation note land in this box, so
    // its ceiling scrolls rather than hiding them.
    assert.equal(box.overflow, 'auto')

    // The message is what varies inside that box, and it is bounded by its own
    // floor and ceiling rather than by the box clipping the commit button.
    const input = window.getComputedStyle(must(container, `.${cls.commitInput}`))
    assert.equal(input.minHeight, `${String(COMMIT_INPUT_MIN_HEIGHT)}px`)
    assert.equal(input.maxHeight, `${String(COMMIT_INPUT_MAX_HEIGHT)}px`)
    assert.equal(input.resize, 'vertical', 'the handle still works, inside those bounds')
    assert.equal(window.getComputedStyle(must(container, `.${cls.commitFoot}`)).flexGrow, '0')

    // The change list: the one elastic region, and the reason the budget exists.
    const body = window.getComputedStyle(must(container, `.${cls.body}`))
    assert.equal(body.minHeight, `${String(CHANGE_MIN_HEIGHT)}px`)
    assert.equal(body.flexGrow, '1')
    // A zero basis, so the list's CONTENT never enters the flex arithmetic: with
    // the default 'auto' basis a thousand changed files make the column over-full
    // and flexbox shrinks the staged drawer and the dock to pay for it.
    assert.match(body.flexBasis, /^0(px)?$/u)
    assert.equal(body.overflow, 'auto')

    // The dock: the tab strip at its smallest, and never more than the rest of
    // the column's floors leave.
    const dock = must<HTMLElement>(container, `.${cls.bottom}`)
    const dockStyle = window.getComputedStyle(dock)
    assert.equal(dockStyle.minHeight, `${String(DOCK_MIN_HEIGHT)}px`)
    // The dock opens on the history tab, whose default is "content height, up to
    // two fifths of the window" — and never more than the budget leaves.
    assert.equal(dockStyle.maxHeight, `min(40vh, 100% - ${String(DOCK_RESERVED)}px)`)
    // And it never pays for a sibling's growth: with shrink on, expanding the
    // staged list taxed the dock for the difference (the change list was
    // already at its floor) — folding the staged drawer visibly squeezed the
    // tab area. Reported from the running panel; the shrink flag stays off.
    assert.equal(dockStyle.flexShrink, '0')

    // A dragged height is remembered, but clamped by the same number — otherwise
    // a reload in a shorter window would squeeze the regions above the dock.
    await dragGrip(must(dock, `.${cls.paneGrip}`), 300, 0)
    assert.equal(dock.style.height, '300px')
    assert.equal(dock.style.maxHeight, `calc(100% - ${String(DOCK_RESERVED)}px)`)
  })

  it('keeps the column in one budget, shared by the stylesheet and the grip', () => {
    installStyles(document)
    const sheet =
      document.querySelector<HTMLStyleElement>(`style[data-plugin-css="${STYLE_TAG_ID}"]`)
        ?.textContent ?? ''

    // The number the drag clamps to IS the sum of the other regions' floors: one
    // constant, used by both halves. Written out here rather than imported so that
    // changing a floor without changing the sum goes red.
    assert.equal(
      DOCK_RESERVED,
      RAIL_HEIGHT +
        STAGED_RESERVED_HEIGHT +
        COMMIT_MIN_HEIGHT +
        CHANGE_MIN_HEIGHT +
        COLUMN_SEPARATORS,
    )
    // ...and the stylesheet does not carry its own copy of it.
    assert.match(
      sheet,
      new RegExp(
        `\\.${cls.bottom}\\s*\\{[^}]*max-height:\\s*calc\\(100% - ${String(DOCK_RESERVED)}px\\)`,
        'u',
      ),
    )
  })

  it('pins each section header to the top of the list it scrolls in', async () => {
    // Requirement from the running panel: scrolling a long change list must keep
    // "Changes" on screen, and the untracked files below must announce themselves
    // the same way when they arrive — so a partially scrolled region still says
    // what it is.
    const container = await render(
      h(StatusPanel, { sessionId: 's1', git: stubGit({}), t, locale: 'en' }),
    )
    await settle()

    // Every section that can scroll carries a sticky header: the three in the
    // body's scroller, and the staged drawer's own.
    const body = must(container, `.${cls.body}`)
    const sections = [
      ...body.querySelectorAll(`:scope > .${cls.group}`),
      must(must(container, `[data-pane="staged"]`), `.${cls.group}`),
    ]
    assert.equal(sections.length, 4)
    for (const section of sections) {
      const head = must(section, `.${cls.groupHead}`)
      const style = window.getComputedStyle(head)
      assert.equal(style.position, 'sticky', `${section.getAttribute('data-group')} header sticks`)
      assert.equal(style.top, '0px')
    }

    // The band is opaque (rows scroll under it) and carries the hairline on its
    // own bottom edge, so the sticky header reads as a lid rather than as a list
    // that stopped. jsdom cannot resolve var(), so the rule itself is asserted.
    installStyles(document)
    const sheet =
      document.querySelector<HTMLStyleElement>(`style[data-plugin-css="${STYLE_TAG_ID}"]`)
        ?.textContent ?? ''
    assert.match(
      sheet,
      new RegExp(
        `\\.${cls.groupHead}\\s*\\{[^}]*border-bottom: 0\\.5px solid var\\(--dsw-alias-border-l3\\)[^}]*background: var\\(--dsw-alias-bg-layer-1\\)`,
        'u',
      ),
    )
    // And the rule that used to separate two sections (a top border on the NEXT
    // group) is gone: it would draw a second line against that lid.
    assert.doesNotMatch(
      sheet,
      new RegExp(`\\.${cls.body} > \\.${cls.group} \\+ \\.${cls.group}\\s*\\{[^}]*border-top`, 'u'),
    )
    assert.ok(body.contains(must(body, `.${cls.group} .${cls.groupHead}`)))
  })

  it('keeps the staged drawer on screen when only the index is empty', async () => {
    const status = statusFixture()
    const working = {
      ...status,
      groups: { ...status.groups, staged: [], conflicted: [] },
    }
    const container = await render(
      h(StatusPanel, {
        sessionId: 's1',
        git: stubGit({ status: { ok: true, value: working } }),
        t,
        locale: 'en',
      }),
    )
    await settle()

    // The drawer is still there, counting zero, with its note instead of rows.
    const drawer = must(container, `[data-group="staged"]`)
    assert.equal(must(drawer, `.${cls.count}`).textContent, '0')
    assert.equal(must(drawer, `.${cls.groupEmpty}`).textContent, 'No staged changes')
    assert.equal(drawer.querySelectorAll(`.${cls.row}`).length, 0)
    // The two working-tree sections are resident for the same reason, so they are
    // there too (this fixture still has one change and one untracked file) — the
    // conflict section is the only one that comes and goes.
    assert.deepEqual(groupCounts(container), ['0', '1', '1'])

    // Folding it leaves the header and the count: the anchor survives the fold.
    await click(must(drawer, `.${cls.groupToggle}`))
    assert.equal(drawer.querySelector(`.${cls.groupEmpty}`), null)
    assert.equal(must(drawer, `.${cls.count}`).textContent, '0')
  })

  it('keeps the working-tree sections on screen when they are empty, with their own note', async () => {
    // The same decision as the staged drawer, applied to the whole furniture:
    // a section with no rows keeps its header, its 0, and its own empty sentence.
    // Its bulk action stays too — disabled, with the note borrowing its tooltip
    // the way the staged drawer's button already did.
    const status = statusFixture()
    const onlyUntracked = {
      ...status,
      groups: { staged: [], unstaged: [], conflicted: [], untracked: status.groups.untracked },
    }
    const container = await render(
      h(StatusPanel, {
        sessionId: 's1',
        git: stubGit({ status: { ok: true, value: onlyUntracked } }),
        t,
        locale: 'en',
      }),
    )
    await settle()

    const empty = must(container, `[data-group="unstaged"]`)
    assert.equal(must(empty, `.${cls.groupHead} .${cls.count}`).textContent, '0')
    assert.equal(empty.querySelector(`.${cls.row}`), null)
    assert.equal(must(empty, `.${cls.groupEmpty}`).textContent, 'No changes')
    // Greyed out, and the note is what explains the grey.
    const bulk = must<HTMLButtonElement>(empty, `.${cls.groupActions} button`)
    assert.equal(bulk.disabled, true)
    assert.match(bulk.getAttribute('title') ?? '', /Stage all · No changes/)

    const full = must(container, `[data-group="untracked"]`)
    assert.equal(must(full, `.${cls.groupHead} .${cls.count}`).textContent, '1')
    assert.notEqual(full.querySelector(`.${cls.groupActions}`), null, 'rows bring their bulk action')
    assert.equal(full.querySelector(`.${cls.groupEmpty}`), null, 'rows replace the note')
  })

  it('renders a git failure in the panel’s own words, with git’s text as detail', async () => {
    const container = await render(
      h(StatusPanel, {
        sessionId: 's1',
        git: stubGit({
          status: {
            ok: false,
            error: {
              code: 'git-failed',
              message: 'your local changes would be overwritten',
              detail: 'error: your local changes\nPlease commit your changes\n',
            },
          },
        }),
        t,
        locale: 'en',
      }),
    )
    await settle()
    const root = container.querySelector(`.${cls.root}`)
    assert.equal(root?.getAttribute('data-git-panel'), 'failed')
    assert.equal(root?.getAttribute('data-code'), 'git-failed')
    const detail = container.querySelector(`.${cls.note}`)
    // Git's own multi-line refusal must survive verbatim (FR-4.4).
    assert.equal(detail?.getAttribute('data-multiline'), 'true')
    assert.match(detail?.textContent ?? '', /Please commit your changes/)
  })

  it('names the not-a-repository state as such, not as an error dump', async () => {
    const container = await render(
      h(StatusPanel, {
        sessionId: 's1',
        git: stubGit({ status: { ok: false, error: { code: 'not-a-repo', message: 'nope' } } }),
        t,
        locale: 'en',
      }),
    )
    await settle()
    assert.match(container.textContent ?? '', /not a git repository/)
  })

  it('opens the dock on the history tab, and still reads lazily while folded', async () => {
    let logCalls = 0
    const git: GitRemoteClient = {
      ...stubGit({}),
      log: () => {
        logCalls += 1
        return Promise.resolve({
          ok: true,
          value: { commits: [commitFixture()], total: null, hasMore: false },
        })
      },
    }

    // Folded (a remembered choice, see the preference test below) means folded:
    // the pane spends no git call until its tab is showing.
    window.localStorage.setItem(BOTTOM_PANE_KEY, JSON.stringify({ expanded: false, height: null }))
    const folded = await render(h(StatusPanel, { sessionId: 's1', git, t, locale: 'en' }))
    await settle()
    assert.equal(logCalls, 0, 'a folded pane must not spend a git call')
    await click(must(folded, `.${cls.bottomTab}`))

    // The default is the other way round: the dock is open on the history tab, so
    // its first page is read as the panel mounts.
    window.localStorage.clear()
    logCalls = 0
    const container = await render(h(StatusPanel, { sessionId: 's1', git, t, locale: 'en' }))
    await settle()
    assert.equal(must(container, `.${cls.bottom}`).getAttribute('data-expanded'), 'true')
    assert.equal(logCalls, 1, 'the default is an open history tab')

    assert.equal(logCalls, 1)
    const text = container.textContent ?? ''
    assert.match(text, /bbbbbbb/)
    assert.match(text, /a commit subject/)
    assert.match(text, /Ada/)
    // `pushed: false` renders the hollow ring, not the filled dot.
    const marker = container.querySelector(`.${cls.marker}`)
    assert.equal(marker?.getAttribute('data-pushed'), 'false')
  })

  it('opens by default, folds to its tabs, and sizes itself from the grip', async () => {
    const container = await render(
      h(StatusPanel, { sessionId: 's1', git: stubGit({}), t, locale: 'en' }),
    )
    await settle()

    // Open on the history tab is the resting state now: the pane's job is to be
    // read, and a strip of tabs with nothing behind it is not a default anyone
    // asked for (reported from the running panel: "I have to open it every
    // refresh").
    const pane = must(container, `.${cls.bottom}`) as HTMLElement
    assert.equal(pane.getAttribute('data-expanded'), 'true')
    assert.equal(pane.getAttribute('data-tab'), 'history')
    assert.notEqual(container.querySelector(`.${cls.bottomBody}`), null)
    // No inline height yet: the tab's own default (the stylesheet) applies.
    assert.equal(pane.style.height, '')

    // Two panes carry a grip (the first change drawer above and this one), so the
    // queries are scoped to the pane under test.
    const grip = must(container, `.${cls.bottom} .${cls.paneGrip}`)
    assert.equal(grip.getAttribute('role'), 'separator')
    assert.equal(grip.getAttribute('aria-label'), 'Drag to resize the bottom pane')
    // The dock is bottom-anchored, so its free edge is the TOP one — the mirror
    // image of the change drawers, whose grip sits on their bottom edge.
    assert.equal(
      pane.firstElementChild?.className,
      cls.paneGrip,
      'a bottom-anchored pane takes its grip on the top edge',
    )

    // jsdom reports a zero-height box, so the drag reads as "the pointer rose
    // 300px" — and nothing above it gets an inline height, because nothing above
    // it is draggable: it is the panel's only grip.
    await dragGrip(grip, 300, 0)
    assert.equal(pane.style.height, '300px')
    assert.equal(
      container.querySelectorAll(`.${cls.paneGrip}`).length,
      1,
      'the dock holds the panel’s only grip',
    )

    // The same grip, dragged past the top of the panel: the clamp is what this
    // reads, since the pointer itself can go anywhere. jsdom gives the panel no
    // height, so the resizer falls back to the window — and the number it clamps
    // to is the budget's, the same one the stylesheet puts on this pane.
    const ceiling = Math.max(DOCK_MIN_HEIGHT, window.innerHeight - DOCK_RESERVED)
    await dragGrip(grip, 0, -1000)
    assert.equal(pane.style.height, `${ceiling}px`)

    // There is no fold/unfold chevron any more: whether the pane is showing IS
    // whether a tab is active (asked for after the strip grew one control too
    // many). Clicking the tab that is showing puts the pane away — the gesture the
    // chevron used to carry — and clicking it again brings it back.
    assert.equal(
      pane.querySelectorAll(`.${cls.tool}[aria-expanded]`).length,
      0,
      'the strip carries no separate fold control',
    )
    const historyTab = must<HTMLButtonElement>(container, `.${cls.bottomTab}`)
    assert.equal(historyTab.getAttribute('aria-selected'), 'true')
    // The hint belongs on the tab only while it is the one showing, because that
    // is when a click means "away" rather than "show me".
    assert.equal(historyTab.getAttribute('title'), 'Collapse the bottom pane')

    // Folding this way drops the explicit height (a height would leave a blank
    // body), and selecting the tab again brings the pane back where it was.
    await click(historyTab)
    assert.equal(pane.getAttribute('data-expanded'), 'false')
    assert.equal(pane.style.height, '')
    assert.equal(historyTab.getAttribute('aria-selected'), 'false')
    assert.equal(historyTab.getAttribute('title'), null)
    await click(historyTab)
    assert.equal(pane.getAttribute('data-expanded'), 'true')
    assert.equal(pane.style.height, `${ceiling}px`)

    // The dock's state is a preference, not component state: folding it and
    // coming back must not re-open it, and the dragged height comes back with it.
    const reopened = await render(
      h(StatusPanel, { sessionId: 's1', git: stubGit({}), t, locale: 'en' }),
    )
    await settle()
    assert.equal(must(reopened, `.${cls.bottom}`).getAttribute('data-expanded'), 'true')
    assert.equal((must(reopened, `.${cls.bottom}`) as HTMLElement).style.height, `${ceiling}px`)
    await click(must(reopened, `.${cls.bottomTab}`))
    assert.equal(
      (must(reopened, `.${cls.bottom}`) as HTMLElement).getAttribute('data-expanded'),
      'false',
    )
    const stillFolded = await render(
      h(StatusPanel, { sessionId: 's1', git: stubGit({}), t, locale: 'en' }),
    )
    await settle()
    assert.equal(
      must(stillFolded, `.${cls.bottom}`).getAttribute('data-expanded'),
      'false',
      'a folded dock stays folded across a reload',
    )
  })

  it('falls back to the history when the file whose diff is open leaves the list', async () => {
    // The diff tab IS the open file, and the panel drops that file on its own when
    // the row disappears (it was committed, or discarded). A dock left pointing at
    // a tab that no longer exists used to render an empty body; it now shows the
    // history and stays open, because the user did not close anything.
    const base = statusFixture()
    let listeners: ((change: GitChange) => void)[] = []
    let status: Result<RepoStatus> = { ok: true, value: base }
    const git: GitRemoteClient = {
      ...stubGit({}),
      status: () => Promise.resolve(status),
      watch: (_sessionId, onChange) => {
        listeners.push(onChange)
        return () => {
          listeners = listeners.filter((l) => l !== onChange)
        }
      },
    }
    const container = await render(h(StatusPanel, { sessionId: 's1', git, t, locale: 'en' }))
    await settle()
    await click(must(container, `[data-group="unstaged"] .${cls.row}`))
    await flush()
    assert.equal(must(container, `.${cls.bottom}`).getAttribute('data-tab'), 'diff')

    // The file is gone from every group: only the staged fixture entry is left.
    status = { ok: true, value: statusWith({ staged: base.groups.staged }) }
    await act(async () => {
      for (const listener of listeners) listener({ kinds: ['index'] })
    })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 260))
    })
    await flush()

    const pane = must(container, `.${cls.bottom}`)
    assert.equal(pane.getAttribute('data-expanded'), 'true', 'the user closed nothing')
    assert.equal(pane.getAttribute('data-tab'), 'history')
    assert.equal(must(container, `.${cls.bottomTab}`).getAttribute('aria-selected'), 'true')
    assert.equal(container.querySelector('[data-shown="false"]'), null)
  })

  it('re-reads when the host reports a change', async () => {
    let listeners: ((change: GitChange) => void)[] = []
    let statusCalls = 0
    const git: GitRemoteClient = {
      ...stubGit({}),
      status: () => {
        statusCalls += 1
        return Promise.resolve({ ok: true, value: statusFixture() })
      },
      watch: (_sessionId, onChange) => {
        listeners.push(onChange)
        return () => {
          listeners = listeners.filter((l) => l !== onChange)
        }
      },
    }
    await render(h(StatusPanel, { sessionId: 's1', git, t, locale: 'en' }))
    await settle()
    assert.equal(statusCalls, 1)

    await act(async () => {
      for (const listener of listeners) listener({ kinds: ['worktree'] })
    })
    // The panel coalesces a burst into one trailing re-read.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 260))
    })
    assert.equal(statusCalls, 2, 'a change notification must trigger exactly one re-read')
  })

  it('publishes nothing when the reading did not change', async () => {
    // The panel is told about `.git/objects`, a lock file, a branch it already
    // knows: re-reading costs one status call, and re-rendering would fight every
    // hover and scroll position in the panel. The panes must not hear about it.
    let listeners: ((change: GitChange) => void)[] = []
    let logCalls = 0
    const git: GitRemoteClient = {
      ...stubGit({}),
      log: () => {
        logCalls += 1
        return Promise.resolve({
          ok: true,
          value: { commits: [commitFixture()], total: null, hasMore: false },
        })
      },
      watch: (_sessionId, onChange) => {
        listeners.push(onChange)
        return () => {
          listeners = listeners.filter((l) => l !== onChange)
        }
      },
    }
    const container = await render(h(StatusPanel, { sessionId: 's1', git, t, locale: 'en' }))
    await settle()
    assert.equal(logCalls, 1)

    await act(async () => {
      for (const listener of listeners) listener({ kinds: ['refs'] })
    })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 260))
    })
    assert.equal(logCalls, 1, 'an unchanged repository must not wake the history')
    assert.match(container.textContent ?? '', /a commit subject/)
  })

  it('re-reads the history when a ref moves, and not when only a file does', async () => {
    let listeners: ((change: GitChange) => void)[] = []
    let status: Result<RepoStatus> = { ok: true, value: statusFixture() }
    let logCalls = 0
    let commits: readonly CommitInfo[] = [commitFixture()]
    const git: GitRemoteClient = {
      ...stubGit({}),
      status: () => Promise.resolve(status),
      log: () => {
        logCalls += 1
        return Promise.resolve({ ok: true, value: { commits, total: null, hasMore: false } })
      },
      watch: (_sessionId, onChange) => {
        listeners.push(onChange)
        return () => {
          listeners = listeners.filter((l) => l !== onChange)
        }
      },
    }
    const container = await render(h(StatusPanel, { sessionId: 's1', git, t, locale: 'en' }))
    await settle()
    assert.equal(logCalls, 1)
    assert.match(container.textContent ?? '', /a commit subject/)

    /** Report a change, and let the panel's coalescing window pass. */
    const announce = async (kinds: readonly GitChangeKind[]): Promise<void> => {
      await act(async () => {
        for (const listener of listeners) listener({ kinds: [...kinds] })
      })
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 260))
      })
    }

    const base = statusFixture()
    const moved = (oid: string): RepoStatus => ({ ...base, branch: { ...base.branch, oid } })

    // A commit lands: the branch moves, and the list is about what is recent.
    status = { ok: true, value: moved('b'.repeat(40)) }
    commits = [
      { ...commitFixture(), oid: 'c'.repeat(40), shortOid: 'ccccccc', subject: 'a newer commit' },
      commitFixture(),
    ]
    await announce(['refs'])
    assert.equal(logCalls, 2, 'a ref move must re-read the history')
    assert.match(container.textContent ?? '', /a newer commit/)

    // A file in the working tree is not history: re-reading the log for it would
    // be a git process the user never asked for.
    status = {
      ok: true,
      value: {
        ...moved('b'.repeat(40)),
        groups: {
          ...base.groups,
          untracked: [
            { path: 'fresh.txt', index: '?', worktree: '.', staged: false, untracked: true, conflicted: false },
          ],
        },
      },
    }
    await announce(['worktree'])
    assert.equal(logCalls, 2, 'a worktree change must not spend a git log')
  })

  it('never dates a commit in the future, even when the pane opened before it', async () => {
    // The regression: the rows measured against a reference captured when this
    // pane mounted, so a commit made WHILE it was open was newer than that
    // reference and its row read "in 1 minute" instead of "just now".
    const fresh = { ...commitFixture(), committedAt: new Date(Date.now() + 90_000).toISOString() }
    const container = await render(
      h(StatusPanel, { sessionId: 's1', git: stubGit({ log: [fresh] }), t, locale: 'en' }),
    )
    await settle()

    const meta = must(container, '[data-commit-meta="true"]').textContent ?? ''
    assert.doesNotMatch(meta, /\bin \d/u, `a commit must never read as future-dated, got: ${meta}`)
    assert.match(meta, /now/u)
  })

  it('ages its rows as the clock moves', async () => {
    // A reference captured once also means "30 seconds ago" stays that forever.
    // The pane keeps its own clock: this is a label, not a git call.
    mock.timers.enable({ apis: ['setInterval', 'Date'], now: Date.parse('2026-09-11T12:00:00Z') })
    try {
      const commit = { ...commitFixture(), committedAt: '2026-09-11T11:59:30Z' }
      const container = await render(
        h(StatusPanel, { sessionId: 's1', git: stubGit({ log: [commit] }), t, locale: 'en' }),
      )
      await settle()
      const meta = (): string => must(container, '[data-commit-meta="true"]').textContent ?? ''
      assert.match(meta(), /30 seconds ago/u)

      await act(async () => {
        mock.timers.tick(60_000)
      })
      assert.match(meta(), /1 minute ago/u)
    } finally {
      mock.timers.reset()
    }
  })
})

describe('staging from the change list', () => {
  it('stages a single row through its own + button (FR-3.1)', async () => {
    const calls: ActionLog = { entries: [] }
    const container = await render(
      h(StatusPanel, { sessionId: 's1', git: stubGit({ calls }), t, locale: 'en' }),
    )
    await settle()

    const row = must(container, `[data-group="unstaged"] .${cls.row}`)
    await click(must(row, `.${cls.rowActions} button`))
    assert.deepEqual(calls.entries, ['stage:deep/nested/dir/changed.ts'])
  })

  it('unstages a staged row through its − button (FR-3.1)', async () => {
    const calls: ActionLog = { entries: [] }
    const container = await render(
      h(StatusPanel, { sessionId: 's1', git: stubGit({ calls }), t, locale: 'en' }),
    )
    await settle()

    const row = must(container, `[data-group="staged"] .${cls.row}`)
    await click(must(row, `.${cls.rowActions} button`))
    assert.deepEqual(calls.entries, ['unstage:src/staged.ts'])
  })

  it('offers + on an untracked row and on a conflicted one', async () => {
    // A conflict's `+` is the same command git would be given to mark it
    // resolved; the dedicated conflict UI is FR-9's, in a later milestone.
    const calls: ActionLog = { entries: [] }
    const container = await render(
      h(StatusPanel, { sessionId: 's1', git: stubGit({ calls }), t, locale: 'en' }),
    )
    await settle()

    await click(must(must(container, `[data-group="untracked"] .${cls.row}`), `.${cls.rowActions} button`))
    await click(must(must(container, `[data-group="conflicted"] .${cls.row}`), `.${cls.rowActions} button`))
    assert.deepEqual(calls.entries, ['stage:notes.md', 'stage:both.txt'])
  })

  it('folds a group away, remembers the fold, and unfolds it again', async () => {
    const container = await render(
      h(StatusPanel, { sessionId: 's1', git: stubGit({}), t, locale: 'en' }),
    )
    await settle()

    const toggle = must(container, `[data-group="untracked"] .${cls.groupToggle}`)
    const rows = container.querySelectorAll(`[data-group="untracked"] .${cls.row}`).length
    const count = must(container, `[data-group="untracked"] .${cls.count}`).textContent
    assert.ok(rows > 0)
    assert.equal(toggle.getAttribute('aria-expanded'), 'true')

    await click(toggle)
    // The header stays and keeps the count: "there are N untracked files" is the
    // reason to unfold it again, so folding must not hide the number too.
    assert.equal(container.querySelectorAll(`[data-group="untracked"] .${cls.row}`).length, 0)
    assert.equal(must(container, `[data-group="untracked"] .${cls.count}`).textContent, count)
    assert.equal(toggle.getAttribute('aria-expanded'), 'false')

    // A fold is a preference, not a render detail: it is written down.
    assert.deepEqual(
      JSON.parse(window.localStorage.getItem('dsh-git-panel/collapsed-groups') ?? '[]'),
      ['untracked'],
    )

    // A fresh panel starts folded, which is the half of the feature a same-mount
    // assertion cannot see.
    const second = await render(
      h(StatusPanel, { sessionId: 's1', git: stubGit({}), t, locale: 'en' }),
    )
    await settle()
    assert.equal(second.querySelectorAll(`[data-group="untracked"] .${cls.row}`).length, 0)
    assert.equal(second.querySelector(`[data-group="untracked"]`) !== null, true)

    await click(toggle)
    assert.ok(container.querySelectorAll(`[data-group="untracked"] .${cls.row}`).length > 0)
    assert.deepEqual(
      JSON.parse(window.localStorage.getItem('dsh-git-panel/collapsed-groups') ?? '[]'),
      [],
    )
  })

  it('stages a whole group from its header (FR-3.2)', async () => {
    // §1.3's fourth lesson: a first commit of dozens of files must not need one
    // click each.
    const calls: ActionLog = { entries: [] }
    const status = statusWith({
      untracked: [
        { path: 'a.md', index: '?', worktree: '.', staged: false, untracked: true, conflicted: false },
        { path: 'b.md', index: '?', worktree: '.', staged: false, untracked: true, conflicted: false },
      ],
    })
    const container = await render(
      h(StatusPanel, {
        sessionId: 's1',
        git: stubGit({ calls, status: { ok: true, value: status } }),
        t,
        locale: 'en',
      }),
    )
    await settle()

    const head = must(container, `[data-group="untracked"] .${cls.groupActions}`)
    const button = must<HTMLButtonElement>(head, 'button')
    assert.equal(button.textContent, 'Stage all')
    await click(button)
    assert.deepEqual(calls.entries, ['stage:a.md,b.md'])
  })

  it('unstages a whole group from its header (FR-3.2)', async () => {
    const calls: ActionLog = { entries: [] }
    const container = await render(
      h(StatusPanel, { sessionId: 's1', git: stubGit({ calls }), t, locale: 'en' }),
    )
    await settle()

    const head = must(container, `[data-group="staged"] .${cls.groupActions}`)
    const button = must<HTMLButtonElement>(head, 'button')
    assert.equal(button.textContent, 'Unstage all')
    await click(button)
    assert.deepEqual(calls.entries, ['unstage:src/staged.ts'])
  })

  it('shows a group action without waiting for a hover', async () => {
    const container = await render(
      h(StatusPanel, { sessionId: 's1', git: stubGit({}), t, locale: 'en' }),
    )
    await settle()

    // The first version revealed the bulk action on hover alone ('opacity: 0'),
    // and the button could not be found at all. The stylesheet is installed in
    // this document, so this reads the real cascade result rather than a class
    // name — and a rule that went back to hidden would fail it.
    const opacity = Number(
      window.getComputedStyle(
        must(container, `[data-group="unstaged"] .${cls.groupActions}`),
      ).opacity,
    )
    assert.ok(opacity > 0.5, `a group action must be visible at rest, got opacity ${opacity}`)
  })

  it('will not bulk-unstage an empty index, and says so instead of failing', async () => {
    // The staged drawer is the one group that stays on screen while empty, so its
    // "Unstage all" used to be a button that could only ever fail: the panel sent
    // `paths: []`, the host refused it (`validatePaths`: at least one path), and
    // the user read "the request was incomplete, reopen this panel" — an
    // instruction that could not possibly help, since the panel was fine.
    const calls: ActionLog = { entries: [] }
    const status = statusFixture()
    const working = { ...status, groups: { ...status.groups, staged: [], conflicted: [] } }
    const container = await render(
      h(StatusPanel, {
        sessionId: 's1',
        git: stubGit({ calls, status: { ok: true, value: working } }),
        t,
        locale: 'en',
      }),
    )
    await settle()

    const drawer = must(container, `[data-pane="staged"]`)
    assert.equal(must(drawer, `.${cls.count}`).textContent, '0', 'the staged list is still resident')
    const button = must<HTMLButtonElement>(drawer, `.${cls.groupActions} button`)
    assert.equal(button.textContent, 'Unstage all', 'the control stays findable, not hover-only')
    assert.equal(button.disabled, true, 'a group with no rows has nothing to move')
    // A disabled button is only honest if it says why.
    assert.equal(button.title, 'Unstage all · No staged changes')

    // Neither a click nor a stray programmatic call may reach the host: the bulk
    // action on an empty group is a no-op, not a refused request.
    await click(button)
    assert.deepEqual(calls.entries, [])
    assert.equal(container.querySelector(`[data-action-error]`), null, 'no failure box')
    assert.equal(container.querySelector(`[data-action-done]`), null, 'and no false success')

    // A group that does have rows keeps its action, and it still works.
    const unstagedHead = must(container, `[data-group="unstaged"] .${cls.groupActions}`)
    const stageButton = must<HTMLButtonElement>(unstagedHead, 'button')
    assert.equal(stageButton.disabled, false)
    assert.equal(stageButton.title, '')
    await click(stageButton)
    assert.deepEqual(calls.entries, ['stage:deep/nested/dir/changed.ts'])
  })

  it('reports a git client that throws rather than leaving the panel spinning', async () => {
    // Every client method is typed to *answer* with a `Result`, and the panel's
    // failure handling assumed that. A client that throws instead — a bug here, or
    // `fetch` rejecting before a Result exists — left the operation "running"
    // forever: a spinner and permanently disabled buttons, with nothing said.
    const git: GitRemoteClient = {
      ...stubGit({}),
      stage: () => {
        throw new TypeError('Failed to fetch')
      },
    }
    const container = await render(h(StatusPanel, { sessionId: 's1', git, t, locale: 'en' }))
    await settle()

    await click(must(container, `[data-group="untracked"] .${cls.rowActions} button`))

    const box = must(container, `[data-action-error="stage"]`)
    assert.match(box.textContent ?? '', /failed/)
    assert.match(box.textContent ?? '', /Failed to fetch/, 'the reason is kept, not swallowed')
    assert.equal(container.querySelector(`[data-action-done]`), null)
  })
})

describe('selecting rows for batch actions', () => {
  /** The selection checkbox inside one row band. */
  function boxOf(row: Element): HTMLButtonElement {
    return must<HTMLButtonElement>(row, `.${cls.selectBox}`)
  }

  /** The group header's bulk button (the first button in the actions span). */
  function bulkButton(container: HTMLElement, area: string): HTMLButtonElement {
    return must<HTMLButtonElement>(
      must(container, `[data-group="${area}"] .${cls.groupActions}`),
      'button',
    )
  }

  it('stages exactly the checked unstaged rows from the group header', async () => {
    const calls: ActionLog = { entries: [] }
    const status = statusWith({
      unstaged: [
        { path: 'a.ts', index: '.', worktree: 'M', staged: false, untracked: false, conflicted: false },
        { path: 'b.ts', index: '.', worktree: 'M', staged: false, untracked: false, conflicted: false },
        { path: 'c.ts', index: '.', worktree: 'M', staged: false, untracked: false, conflicted: false },
      ],
    })
    const container = await render(
      h(StatusPanel, {
        sessionId: 's1',
        git: stubGit({ calls, status: { ok: true, value: status } }),
        t,
        locale: 'en',
      }),
    )
    await settle()

    const group = must(container, '[data-group="unstaged"]')
    // Nothing checked: the header is FR-3.2's whole-group action, unchanged.
    assert.equal(bulkButton(container, 'unstaged').textContent, 'Stage all')

    const rows = group.querySelectorAll(`.${cls.row}`)
    await click(boxOf(rows[0] as Element))
    await click(boxOf(rows[1] as Element))
    // The label now names what it will move — "these 2", not "everything".
    const button = bulkButton(container, 'unstaged')
    assert.equal(button.textContent, 'Stage selected (2)')
    // Checked rows are marked; the unchecked one is not.
    assert.equal(
      group.querySelectorAll(`.${cls.row}[data-selected='true']`).length,
      2,
    )

    await click(button)
    assert.deepEqual(calls.entries, ['stage:a.ts,b.ts'])
  })

  it('unstages exactly the checked staged rows', async () => {
    const calls: ActionLog = { entries: [] }
    const status = statusWith({
      staged: [
        { path: 'a.ts', index: 'M', worktree: '.', staged: true, untracked: false, conflicted: false },
        { path: 'b.ts', index: 'A', worktree: '.', staged: true, untracked: false, conflicted: false },
      ],
    })
    const container = await render(
      h(StatusPanel, {
        sessionId: 's1',
        git: stubGit({ calls, status: { ok: true, value: status } }),
        t,
        locale: 'en',
      }),
    )
    await settle()

    assert.equal(bulkButton(container, 'staged').textContent, 'Unstage all')
    const rows = must(container, '[data-group="staged"]').querySelectorAll(`.${cls.row}`)
    await click(boxOf(rows[1] as Element))
    const button = bulkButton(container, 'staged')
    assert.equal(button.textContent, 'Unstage selected (1)')
    await click(button)
    assert.deepEqual(calls.entries, ['unstage:b.ts'])
  })

  it('selects every file under a directory from the tree, and reads "mixed" on a part', async () => {
    const calls: ActionLog = { entries: [] }
    const diffCalls: string[] = []
    const status = statusWith({
      unstaged: [
        { path: 'deep/nested/dir/changed.ts', index: '.', worktree: 'M', staged: false, untracked: false, conflicted: false },
        { path: 'deep/nested/dir/other.ts', index: '.', worktree: 'M', staged: false, untracked: false, conflicted: false },
      ],
    })
    const container = await render(
      h(StatusPanel, {
        sessionId: 's1',
        git: stubGit({ calls, diffCalls, status: { ok: true, value: status } }),
        t,
        locale: 'en',
      }),
    )
    await settle()

    const dir = dirNode(container, 'unstaged', 'deep/nested/dir')
    const dirBox = boxOf(dir)
    assert.equal(dirBox.getAttribute('aria-checked'), 'false')

    await click(dirBox)
    // The directory adopts its whole subtree: both file rows checked, the box
    // reads "on", and the header counts exactly the files the box stands for.
    assert.equal(dirBox.getAttribute('aria-checked'), 'true')
    assert.equal(
      must(container, '[data-tree-file="deep/nested/dir/changed.ts"]')
        .querySelector(`.${cls.selectBox}`)
        ?.getAttribute('aria-checked'),
      'true',
    )
    assert.equal(
      must(container, '[data-tree-file="deep/nested/dir/other.ts"]')
        .querySelector(`.${cls.selectBox}`)
        ?.getAttribute('aria-checked'),
      'true',
    )
    assert.equal(bulkButton(container, 'unstaged').textContent, 'Stage selected (2)')

    // Ticking one file back off leaves the other checked: the directory's own
    // box is the honest "some", not a silent "all" or "none".
    await click(
      must<HTMLButtonElement>(
        must(container, '[data-tree-file="deep/nested/dir/changed.ts"]'),
        `.${cls.selectBox}`,
      ),
    )
    assert.equal(dirBox.getAttribute('aria-checked'), 'mixed')
    assert.equal(bulkButton(container, 'unstaged').textContent, 'Stage selected (1)')
    // The checkbox is a control, not the row: ticking it opened no diff.
    assert.deepEqual(diffCalls, [])

    await click(bulkButton(container, 'unstaged'))
    assert.deepEqual(calls.entries, ['stage:deep/nested/dir/other.ts'])
  })

  it('discards the selection only after the header button arms, and never offers it on the staged group', async () => {
    const calls: ActionLog = { entries: [] }
    const status = statusWith({
      unstaged: [
        { path: 'a.ts', index: '.', worktree: 'M', staged: false, untracked: false, conflicted: false },
        { path: 'b.ts', index: '.', worktree: 'M', staged: false, untracked: false, conflicted: false },
      ],
      staged: [
        { path: 's.ts', index: 'M', worktree: '.', staged: true, untracked: false, conflicted: false },
      ],
    })
    const container = await render(
      h(StatusPanel, {
        sessionId: 's1',
        git: stubGit({ calls, status: { ok: true, value: status } }),
        t,
        locale: 'en',
      }),
    )
    await settle()

    // A staged row has no working-tree change to throw away, so its header
    // never grows the destructive button — not even with rows checked.
    await click(
      must<HTMLButtonElement>(must(container, `[data-group="staged"] .${cls.row}`), `.${cls.selectBox}`),
    )
    assert.equal(
      container.querySelector(`[data-group="staged"] .${cls.groupActions} .${cls.danger}`),
      null,
    )

    const group = must(container, '[data-group="unstaged"]')
    const rows = group.querySelectorAll(`.${cls.row}`)
    await click(boxOf(rows[0] as Element))
    await click(boxOf(rows[1] as Element))

    const danger = must<HTMLButtonElement>(
      must(group, `.${cls.groupActions}`),
      `.${cls.danger}`,
    )
    assert.equal(danger.textContent, 'Discard selected (2)')
    // The first click arms rather than fires (§4.3)...
    await click(danger)
    assert.deepEqual(calls.entries, [])
    const armed = must<HTMLButtonElement>(must(group, `.${cls.groupActions}`), `.${cls.danger}`)
    assert.match(armed.textContent ?? '', /cannot be undone/)
    // ...and the second discards exactly the checked paths, naming the count.
    await click(armed)
    assert.deepEqual(calls.entries, ['discard:a.ts,b.ts'])
    assert.match(must(container, '[data-action-done]').textContent ?? '', /2 files/)
  })

  it('drops the checks of rows that leave the list', async () => {
    // The first reading has three files; once the repository reports two of
    // them gone (staged elsewhere, say), their checks must not linger — a
    // checked path with no row would aim the next batch at nothing.
    let listeners: ((change: GitChange) => void)[] = []
    const full = statusWith({
      unstaged: [
        { path: 'a.ts', index: '.', worktree: 'M', staged: false, untracked: false, conflicted: false },
        { path: 'b.ts', index: '.', worktree: 'M', staged: false, untracked: false, conflicted: false },
        { path: 'c.ts', index: '.', worktree: 'M', staged: false, untracked: false, conflicted: false },
      ],
    })
    const rest = statusWith({
      unstaged: [
        { path: 'c.ts', index: '.', worktree: 'M', staged: false, untracked: false, conflicted: false },
      ],
    })
    let current = full
    const git: GitRemoteClient = {
      ...stubGit({}),
      status: () => Promise.resolve({ ok: true, value: current }),
      watch: (_sessionId, onChange) => {
        listeners.push(onChange)
        return () => {
          listeners = listeners.filter((l) => l !== onChange)
        }
      },
    }
    const container = await render(h(StatusPanel, { sessionId: 's1', git, t, locale: 'en' }))
    await settle()

    const rows = must(container, '[data-group="unstaged"]').querySelectorAll(`.${cls.row}`)
    await click(boxOf(rows[0] as Element))
    await click(boxOf(rows[1] as Element))
    assert.equal(bulkButton(container, 'unstaged').textContent, 'Stage selected (2)')

    // The repository moves on without the panel acting; the re-read that
    // follows must take the vanished rows' checks with them.
    current = rest
    await act(async () => {
      for (const listener of listeners) listener({ kinds: ['worktree'] })
    })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 260))
    })
    assert.equal(bulkButton(container, 'unstaged').textContent, 'Stage all')
    assert.equal(
      container.querySelectorAll(`[data-group="unstaged"] .${cls.row}[data-selected='true']`).length,
      0,
    )
  })

  it('lets a checked conflict move with the same header action that marks one resolved', async () => {
    const calls: ActionLog = { entries: [] }
    const container = await render(
      h(StatusPanel, { sessionId: 's1', git: stubGit({ calls }), t, locale: 'en' }),
    )
    await settle()

    // The conflict group has no whole-group bulk action — half-resolved merges
    // must not be stageable in one click — so its header starts empty...
    assert.equal(container.querySelector(`[data-group="conflicted"] .${cls.groupActions}`), null)
    // ...and grows one only for a selection.
    await click(
      must<HTMLButtonElement>(must(container, `[data-group="conflicted"] .${cls.row}`), `.${cls.selectBox}`),
    )
    const button = bulkButton(container, 'conflicted')
    assert.equal(button.textContent, 'Stage selected (1)')
    await click(button)
    assert.deepEqual(calls.entries, ['stage:both.txt'])
  })

  it('forgets the selection when the panel switches sessions', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    rendered.push(root)
    await act(async () => {
      root.render(h(StatusPanel, { sessionId: 's1', git: stubGit({}), t, locale: 'en' }))
    })
    await settle()

    await click(
      must<HTMLButtonElement>(must(container, `[data-group="unstaged"] .${cls.row}`), `.${cls.selectBox}`),
    )
    assert.equal(bulkButton(container, 'unstaged').textContent, 'Stage selected (1)')

    // A different session is a different repository: the check was a statement
    // about the old list and must not ride along.
    await act(async () => {
      root.render(h(StatusPanel, { sessionId: 's2', git: stubGit({}), t, locale: 'en' }))
    })
    await settle()
    assert.equal(bulkButton(container, 'unstaged').textContent, 'Stage all')
  })
})

describe('the commit box (FR-3.3, FR-3.4)', () => {
  it('commits the index, and says how many files that is', async () => {
    const calls: ActionLog = { entries: [] }
    const container = await render(
      h(StatusPanel, {
        sessionId: 's1',
        git: stubGit({ calls, status: { ok: true, value: stagedOnlyStatus() } }),
        t,
        locale: 'en',
      }),
    )
    await settle()

    // One staged file, and nothing else would be included.
    const scope = must(container, '[data-commit-scope]')
    assert.equal(scope.getAttribute('data-commit-scope'), 'staged')
    assert.match(scope.textContent ?? '', /1 staged file/)

    const button = must<HTMLButtonElement>(container, `.${cls.commitButton}`)
    assert.equal(button.textContent, 'Commit (1)')
    assert.equal(button.disabled, true, 'an empty message is not a commit')

    const input = must<HTMLTextAreaElement>(container, `.${cls.commitInput}`)
    await typeInto(input, 'feat: add the thing')
    assert.equal(button.disabled, false)

    await click(button)
    assert.deepEqual(calls.entries, ['commit:feat: add the thing'])
    // The box reports the commit git made, and clears itself for the next one.
    assert.match(container.textContent ?? '', /Committed bbbbbbb: a commit subject/)
    assert.equal(input.value, '')
  })

  it('submits on Ctrl+Enter (FR-3.3)', async () => {
    const calls: ActionLog = { entries: [] }
    const container = await render(
      h(StatusPanel, {
        sessionId: 's1',
        git: stubGit({ calls, status: { ok: true, value: stagedOnlyStatus() } }),
        t,
        locale: 'en',
      }),
    )
    await settle()

    const input = must<HTMLTextAreaElement>(container, `.${cls.commitInput}`)
    await typeInto(input, 'via keyboard')
    await act(async () => {
      input.dispatchEvent(
        new window.KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }),
      )
    })
    await flush()
    assert.deepEqual(calls.entries, ['commit:via keyboard'])
  })

  it('leaves a plain Enter as a newline', async () => {
    const calls: ActionLog = { entries: [] }
    const container = await render(
      h(StatusPanel, {
        sessionId: 's1',
        git: stubGit({ calls, status: { ok: true, value: stagedOnlyStatus() } }),
        t,
        locale: 'en',
      }),
    )
    await settle()

    const input = must<HTMLTextAreaElement>(container, `.${cls.commitInput}`)
    await typeInto(input, 'subject')
    // No preventDefault is asserted here: what matters is that no commit left.
    input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await flush()
    assert.deepEqual(calls.entries, [])
  })

  it('announces the add -u widening when nothing is staged (FR-3.4)', async () => {
    const calls: ActionLog = { entries: [] }
    const status = statusWith({
      unstaged: [
        { path: 'a.txt', index: '.', worktree: 'M', staged: false, untracked: false, conflicted: false },
        { path: 'b.txt', index: '.', worktree: 'M', staged: false, untracked: false, conflicted: false },
      ],
      untracked: [
        { path: 'new.txt', index: '?', worktree: '.', staged: false, untracked: true, conflicted: false },
      ],
    })
    const container = await render(
      h(StatusPanel, {
        sessionId: 's1',
        git: stubGit({ calls, status: { ok: true, value: status } }),
        t,
        locale: 'en',
      }),
    )
    await settle()

    // The label names the widening before it happens, and counts only what
    // `add -u` will actually include — the untracked file is not in the count.
    const button = must<HTMLButtonElement>(container, `.${cls.commitButton}`)
    assert.equal(button.textContent, 'Commit all tracked changes (2)')
    assert.match(container.textContent ?? '', /Runs git add -u first/)

    await typeInto(must<HTMLTextAreaElement>(container, `.${cls.commitInput}`), 'sweep')
    await click(button)
    assert.deepEqual(calls.entries, ['commitAll:sweep'])
  })

  it('disables the button when only untracked files exist', async () => {
    const status = statusWith({
      untracked: [
        { path: 'new.txt', index: '?', worktree: '.', staged: false, untracked: true, conflicted: false },
      ],
    })
    const container = await render(
      h(StatusPanel, { sessionId: 's1', git: stubGit({ status: { ok: true, value: status } }), t, locale: 'en' }),
    )
    await settle()
    await typeInto(must<HTMLTextAreaElement>(container, `.${cls.commitInput}`), 'nope')

    assert.equal(must<HTMLButtonElement>(container, `.${cls.commitButton}`).disabled, true)
    assert.match(container.textContent ?? '', /stage the ones you want to commit first/)
  })

  it('disables the button while conflicts remain, even with something staged', async () => {
    // git refuses to commit with an unmerged path, whatever else is staged.
    const status = statusWith({
      staged: [
        { path: 'resolved.txt', index: 'M', worktree: '.', staged: true, untracked: false, conflicted: false },
      ],
      conflicted: [
        { path: 'both.txt', index: 'U', worktree: 'U', staged: true, untracked: false, conflicted: true },
      ],
    })
    const container = await render(
      h(StatusPanel, { sessionId: 's1', git: stubGit({ status: { ok: true, value: status } }), t, locale: 'en' }),
    )
    await settle()
    await typeInto(must<HTMLTextAreaElement>(container, `.${cls.commitInput}`), 'premature')

    assert.equal(must<HTMLButtonElement>(container, `.${cls.commitButton}`).disabled, true)
    assert.equal(must(container, '[data-commit-scope]').getAttribute('data-commit-scope'), 'conflicted')
  })

  it('keeps the message when the commit is refused', async () => {
    // Losing a written message to a failed commit would be its own bug.
    const container = await render(
      h(StatusPanel, {
        sessionId: 's1',
        git: stubGit({
          status: { ok: true, value: stagedOnlyStatus() },
          commit: { ok: false, error: { code: 'nothing-to-commit', message: 'nothing staged' } },
        }),
        t,
        locale: 'en',
      }),
    )
    await settle()

    const input = must<HTMLTextAreaElement>(container, `.${cls.commitInput}`)
    await typeInto(input, 'my careful message')
    await click(must<HTMLButtonElement>(container, `.${cls.commitButton}`))

    assert.equal(input.value, 'my careful message')
    assert.match(must(container, '[data-commit-error]').textContent ?? '', /index is empty/)
  })
})

describe('the sync actions (FR-5.1)', () => {
  it('enables sync, pull, and push when the branch is both ahead and behind', async () => {
    const calls: ActionLog = { entries: [] }
    const container = await render(
      h(StatusPanel, { sessionId: 's1', git: stubGit({ calls }), t, locale: 'en' }),
    )
    await settle()

    const buttons = syncButtons(container)
    assert.equal(buttons.length, 3)
    assert.equal(buttons.some((button) => button.disabled), false)

    await click(buttons[1] as HTMLButtonElement)
    assert.deepEqual(calls.entries, ['pull'])
  })

  it('offers the first push on a branch with no upstream (FR-5.2)', async () => {
    const calls: ActionLog = { entries: [] }
    const container = await render(
      h(StatusPanel, {
        sessionId: 's1',
        git: stubGit({
          calls,
          status: { ok: true, value: statusOnBranch({ upstream: null, ahead: 0, behind: 0 }) },
          branches: [{ ...branchesFixture()[0]!, upstream: null, upstreamGone: false }],
        }),
        t,
        locale: 'en',
      }),
    )
    await settle()

    const [sync, pull, push] = syncButtons(container)
    assert.equal(sync?.disabled, true, 'there is nothing to pull from')
    assert.equal(pull?.disabled, true)
    assert.equal(push?.disabled, false, 'the first push is the one that sets the upstream')

    await click(push as HTMLButtonElement)
    assert.deepEqual(calls.entries, ['push'])
  })

  it('offers only a pull when the branch is level with its upstream', async () => {
    const container = await render(
      h(StatusPanel, {
        sessionId: 's1',
        git: stubGit({
          status: { ok: true, value: statusOnBranch({ ahead: 0, behind: 0 }) },
          branches: [{ ...branchesFixture()[0]!, ahead: 0, behind: 0 }],
        }),
        t,
        locale: 'en',
      }),
    )
    await settle()
    const [sync, pull, push] = syncButtons(container)
    // There is nothing to send and nothing to reconcile — but asking the remote
    // whether it has moved is always a reasonable thing to do.
    assert.equal(sync?.disabled, true)
    assert.equal(push?.disabled, true)
    assert.equal(pull?.disabled, false)
  })
})

describe('operation failures (§4.3)', () => {
  it('shows a refused push beside the list, keeping git’s output and the list', async () => {
    const container = await render(
      h(StatusPanel, {
        sessionId: 's1',
        git: stubGit({
          report: {
            ok: false,
            error: {
              code: 'non-fast-forward',
              message: 'the remote has commits this branch does not',
              detail: 'error: failed to push some refs\nhint: use git pull\n',
            },
          },
        }),
        t,
        locale: 'en',
      }),
    )
    await settle()

    await click(syncButtons(container)[1] as HTMLButtonElement)

    const box = must(container, '[data-action-error="pull"]')
    assert.match(box.textContent ?? '', /remote has commits this branch does not/)
    const detail = must(box, `.${cls.note}`)
    // git's own multi-line refusal survives verbatim (§4.3, FR-4.4).
    assert.equal(detail.getAttribute('data-multiline'), 'true')
    assert.match(detail.textContent ?? '', /failed to push some refs/)

    // The failure did not replace the panel: every change row is still there.
    assert.equal(container.querySelectorAll(`.${cls.badge}`).length, 4)
    assert.equal(must(container, `.${cls.root}`).getAttribute('data-git-panel'), 'ready')
  })

  it('closes the failure when it is dismissed', async () => {
    const container = await render(
      h(StatusPanel, {
        sessionId: 's1',
        git: stubGit({ report: { ok: false, error: { code: 'git-failed', message: 'boom' } } }),
        t,
        locale: 'en',
      }),
    )
    await settle()
    await click(syncButtons(container)[0] as HTMLButtonElement)
    assert.equal(container.querySelector('[data-action-error]') !== null, true)

    const box = must(container, '[data-action-error]')
    await click(must(box, `.${cls.tool}`))
    assert.equal(container.querySelector('[data-action-error]'), null)
  })

  it('reports a successful operation with a name, even when git said nothing', async () => {
    // `git add` prints nothing, so the confirmation is the operation's own name.
    const container = await render(
      h(StatusPanel, { sessionId: 's1', git: stubGit({}), t, locale: 'en' }),
    )
    await settle()
    await click(must(must(container, `[data-group="staged"] .${cls.row}`), `.${cls.rowActions} button`))

    const notice = must(container, '[data-action-done="unstage"]')
    assert.equal(notice.textContent, 'Unstage')
  })
})

describe('the diff view (FR-2)', () => {
  it('opens on a change row, draws the hunks and the word marks, and closes again', async () => {
    const diffCalls: string[] = []
    const container = await render(
      h(StatusPanel, {
        sessionId: 's1',
        git: stubGit({
          // The pane asks for the file the row stands for, and for three lines
          // of context.
          diff: (path, area) => ({ ok: true, value: diffFixture({ path, area: area as FileDiff['area'] }) }),
          diffCalls,
        }),
        t,
        locale: 'en',
      }),
    )
    await settle()

    // A tracked row that is not staged reads the working tree (FR-2.2).
    await click(must(container, `[data-group="unstaged"] .${cls.row}`))
    assert.deepEqual(diffCalls, ['worktree:deep/nested/dir/changed.ts@3'])

    // The list stays, and the column follows VS Code's Source Control view: the
    // message box, then the change list, then one bottom pane holding the history
    // and the diff as two tabs — the plugin has no editor area, so the diff takes
    // a tab rather than a layer. FR-2.1 is still an embedded pane: the rail and
    // the box never move.
    assert.equal(container.querySelector(`.${cls.diffView}`) !== null, true)
    assert.equal(container.querySelector(`[data-group="unstaged"]`) !== null, true)
    assert.equal(container.querySelector(`.${cls.head}`) !== null, true)
    assert.equal(container.querySelector(`.${cls.commitBox}`) !== null, true)
    assert.deepEqual(
      [
        ...container.querySelectorAll(
          `[data-group="staged"], .${cls.commitBox}, [data-group="unstaged"], .${cls.bottom}`,
        ),
      ].map((node) =>
        node.getAttribute('data-group') === 'staged'
          ? 'staged'
          : node.getAttribute('data-group') !== null
            ? 'list'
            : node.classList.contains(cls.commitBox)
              ? 'box'
              : 'bottom',
      ),
      ['staged', 'box', 'list', 'bottom'],
    )
    // The diff is the pane's active tab, and the default height is the
    // stylesheet's (keyed by that tab): a window resize keeps the meaning, and
    // only a drag replaces it with pixels.
    const pane = must(container, `.${cls.bottom}`) as HTMLElement
    assert.equal(pane.getAttribute('data-tab'), 'diff')
    assert.equal(pane.getAttribute('data-expanded'), 'true')
    assert.equal(pane.style.height, '')
    assert.equal(container.querySelector(`.${cls.paneGrip}`)?.getAttribute('role'), 'separator')

    // Every hunk says where it is, heading included.
    const heads = [...container.querySelectorAll(`.${cls.diffHunkRange}`)].map((n) => n.textContent)
    assert.deepEqual(heads, ['@@ -1,3 +1,3 @@', '@@ -10,1 +10,1 @@'])
    assert.match(container.textContent ?? '', /function fixture\(\)/)

    // Inline: one row per line, an old line number for a removal, a new one for
    // an addition.
    const rows = [...container.querySelectorAll(`.${cls.diffLine}`)]
    assert.equal(rows.length, 6)
    assert.equal(rows[1]?.getAttribute('data-kind'), 'removed')
    assert.equal(must<HTMLElement>(rows[1] as Element, `.${cls.diffGutter}`).textContent, '2')
    assert.equal(rows[1]?.querySelector(`.${cls.diffSign}`)?.textContent, '-')
    assert.match(rows[1]?.textContent ?? '', /return thirty \+ two/)
    assert.equal(rows[2]?.getAttribute('data-kind'), 'added')
    assert.equal(must<HTMLElement>(rows[2] as Element, `.${cls.diffGutter}`).textContent, '2')
    assert.equal(rows[2]?.querySelector(`.${cls.diffSign}`)?.textContent, '+')

    // The counts are the diff's own, from the header.
    assert.match(container.textContent ?? '', /\+2/)
    assert.match(container.textContent ?? '', /−2/)

    // FR-2.3: the marked runs are their own elements, sliced at the offsets the
    // core reported — two per changed line, and none on a context line.
    const marks = [...container.querySelectorAll(`.${cls.diffMark}`)].map((n) => n.textContent)
    assert.deepEqual(marks, ['thirty', 'two', 'sixty', 'four'])

    // Escape is the way back, and the change list is exactly as it was.
    await act(async () => {
      document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    await flush()
    assert.equal(container.querySelector(`.${cls.diffView}`), null)
    assert.equal(container.querySelector(`[data-group="unstaged"] .${cls.row}`) !== null, true)
  })

  it('opens a row by keyboard, but not when the key press is on its action button', async () => {
    const calls: ActionLog = { entries: [] }
    const diffCalls: string[] = []
    const container = await render(
      h(StatusPanel, { sessionId: 's1', git: stubGit({ calls, diffCalls }), t, locale: 'en' }),
    )
    await settle()

    const row = must(container, `[data-group="unstaged"] .${cls.row}`)
    // A role="button" row is activatable by Enter and Space alike.
    await act(async () => {
      row.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    await flush()
    assert.deepEqual(diffCalls, ['worktree:deep/nested/dir/changed.ts@3'])
    assert.match(row.getAttribute('aria-label') ?? '', /deep\/nested\/dir\/changed\.ts/)

    // Space on the row's own `+` activates the button; it must not also bubble
    // into the row and open the file.
    await act(async () => {
      document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    await flush()
    diffCalls.length = 0
    const plus = must(must(container, `[data-group="unstaged"] .${cls.row}`), `.${cls.rowActions} button`)
    await act(async () => {
      plus.dispatchEvent(new window.KeyboardEvent('keydown', { key: ' ', bubbles: true }))
    })
    await flush()
    assert.deepEqual(diffCalls, [])
    assert.equal(container.querySelector(`.${cls.diffView}`), null)
  })

  it('reads the index, not the working tree, for a staged row (FR-2.2)', async () => {
    const diffCalls: string[] = []
    const container = await render(
      h(StatusPanel, {
        sessionId: 's1',
        git: stubGit({ diffCalls }),
        t,
        locale: 'en',
      }),
    )
    await settle()

    await click(must(container, `[data-group="staged"] .${cls.row}`))
    // A file with both a staged and an unstaged change appears in two groups;
    // each row must open its own side.
    assert.deepEqual(diffCalls, ['index:src/staged.ts@3'])
    assert.equal(must(container, `.${cls.diffView}`).getAttribute('data-diff-area'), 'index')
  })

  it('refreshes an open diff when the repository moves (§4.4)', async () => {
    // The pane subscribes to the panel's change bus rather than being handed a
    // counter; this is the behaviour that subscription exists for — a diff a
    // user is reading follows the agent's next write to that file.
    const diffCalls: string[] = []
    let listeners: ((change: GitChange) => void)[] = []
    const base = statusFixture()
    let status: Result<RepoStatus> = { ok: true, value: base }
    const git: GitRemoteClient = {
      ...stubGit({ diffCalls }),
      status: () => Promise.resolve(status),
      watch: (_sessionId, onChange) => {
        listeners.push(onChange)
        return () => {
          listeners = listeners.filter((l) => l !== onChange)
        }
      },
    }
    const container = await render(h(StatusPanel, { sessionId: 's1', git, t, locale: 'en' }))
    await settle()
    await click(must(container, `[data-group="unstaged"] .${cls.row}`))
    assert.equal(diffCalls.length, 1)

    // Something changed elsewhere in the repository (a new untracked file), so
    // this reading differs from the last one and the change is published.
    status = {
      ok: true,
      value: {
        ...base,
        groups: {
          ...base.groups,
          untracked: [
            ...base.groups.untracked,
            { path: 'fresh.txt', index: '?', worktree: '.', staged: false, untracked: true, conflicted: false },
          ],
        },
      },
    }
    await act(async () => {
      for (const listener of listeners) listener({ kinds: ['worktree'] })
    })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 260))
    })

    assert.equal(diffCalls.length, 2, 'the open diff must re-read what it shows')
  })

  it('stages from the + without opening a diff', async () => {
    const calls: ActionLog = { entries: [] }
    const diffCalls: string[] = []
    const container = await render(
      h(StatusPanel, { sessionId: 's1', git: stubGit({ calls, diffCalls }), t, locale: 'en' }),
    )
    await settle()

    const row = must(container, `[data-group="unstaged"] .${cls.row}`)
    await click(must(row, `.${cls.rowActions} button`))
    // The action strip stops the row's own click: staging must not also open a
    // diff, which is the one interaction §8 calls out by name.
    assert.deepEqual(calls.entries, ['stage:deep/nested/dir/changed.ts'])
    assert.deepEqual(diffCalls, [])
    assert.equal(container.querySelector(`.${cls.diffView}`), null)
    assert.equal(container.querySelector(`[data-group="unstaged"] .${cls.row}`) !== null, true)
  })

  it('folds a large diff until it is asked for (FR-2.6)', async () => {
    const big = diffFixture({ large: true, lines: 9000 })
    const container = await render(
      h(StatusPanel, {
        sessionId: 's1',
        git: stubGit({ diff: () => ({ ok: true, value: big }) }),
        t,
        locale: 'en',
      }),
    )
    await settle()
    await click(must(container, `[data-group="unstaged"] .${cls.row}`))

    assert.equal(container.querySelectorAll(`.${cls.diffLine}`).length, 0)
    assert.match(container.textContent ?? '', /Large diff \(9000 lines\): folded by default/)

    const load = must<HTMLButtonElement>(container, `.${cls.primary}`)
    assert.equal(load.textContent, 'Load')
    await click(load)
    assert.equal(container.querySelectorAll(`.${cls.diffLine}`).length, 6)
  })

  it('says so for a binary file instead of drawing nothing (FR-2.5)', async () => {
    const binary = diffFixture({ binary: true, hunks: [], additions: 0, deletions: 0, lines: 0 })
    const container = await render(
      h(StatusPanel, {
        sessionId: 's1',
        git: stubGit({ diff: () => ({ ok: true, value: binary }) }),
        t,
        locale: 'en',
      }),
    )
    await settle()
    await click(must(container, `[data-group="untracked"] .${cls.row}`))

    assert.equal(container.querySelectorAll(`.${cls.diffLine}`).length, 0)
    assert.match(container.textContent ?? '', /Binary file: no diff is shown/)
    assert.equal(
      must(container, `.${cls.diffView}`).getAttribute('data-diff-state'),
      'binary',
    )
  })

  it('names the combined diff it cannot read rather than calling it empty', async () => {
    // FR-9's conflict view is a later milestone; until then the honest answer is
    // "not this renderer", not "no differences".
    const combined = diffFixture({ combined: true, hunks: [] })
    const container = await render(
      h(StatusPanel, {
        sessionId: 's1',
        git: stubGit({ diff: () => ({ ok: true, value: combined }) }),
        t,
        locale: 'en',
      }),
    )
    await settle()
    await click(must(container, `[data-group="conflicted"] .${cls.row}`))

    assert.equal(
      must(container, `.${cls.diffView}`).getAttribute('data-diff-state'),
      'combined',
    )
    assert.match(container.textContent ?? '', /combined \(diff --cc\) diff/)
  })

  it('reports a truncated diff as missing its tail, not as folded (FR-2.6)', async () => {
    const truncated = diffFixture({ truncated: true })
    const container = await render(
      h(StatusPanel, {
        sessionId: 's1',
        git: stubGit({ diff: () => ({ ok: true, value: truncated }) }),
        t,
        locale: 'en',
      }),
    )
    await settle()
    await click(must(container, `[data-group="unstaged"] .${cls.row}`))

    // The lines are all there; only the end of the output is missing.
    assert.equal(container.querySelectorAll(`.${cls.diffLine}`).length, 6)
    assert.match(container.textContent ?? '', /end of the diff was not read/)
  })

  it('switches to side by side, pairs the changed lines, and remembers the choice', async () => {
    const container = await render(
      h(StatusPanel, { sessionId: 's1', git: stubGit({}), t, locale: 'en' }),
    )
    await settle()
    await click(must(container, `[data-group="unstaged"] .${cls.row}`))

    const [inline, split] = [...container.querySelectorAll<HTMLButtonElement>(`.${cls.diffSegButton}`)]
    assert.equal(inline?.getAttribute('aria-pressed'), 'true')
    assert.equal(split?.getAttribute('aria-pressed'), 'false')

    await click(split as HTMLButtonElement)
    assert.equal(dom.window.localStorage.getItem(DIFF_LAYOUT_KEY), 'side-by-side')

    // Two fixed halves, each its own scroller: "left" is the old file, "right" the
    // new one, and both render one cell per row so a paired change stays on a line.
    const sides = [...container.querySelectorAll<HTMLElement>(`.${cls.diffSide}`)]
    assert.equal(sides.length, 2)
    const [before, after] = sides as [HTMLElement, HTMLElement]
    assert.equal(before.getAttribute('data-side'), 'left')
    assert.equal(after.getAttribute('data-side'), 'right')

    const beforeCells = [...before.querySelectorAll(`.${cls.diffCell}`)]
    const afterCells = [...after.querySelectorAll(`.${cls.diffCell}`)]
    // 6 inline lines collapse into 4 rows: each removed/added pair shares one, and
    // each half shows its own file's line number on it.
    assert.equal(beforeCells.length, 4)
    assert.equal(afterCells.length, 4)
    assert.deepEqual(
      beforeCells.map((cell) => must<HTMLElement>(cell, `.${cls.diffGutter}`).textContent),
      ['1', '2', '3', '10'],
    )
    assert.deepEqual(
      afterCells.map((cell) => must<HTMLElement>(cell, `.${cls.diffGutter}`).textContent),
      ['1', '2', '3', '10'],
    )
    // The context row is the same line on both sides; the changed row is not.
    assert.equal(beforeCells[0]?.getAttribute('data-line'), 'context')
    assert.equal(afterCells[0]?.getAttribute('data-line'), 'context')
    assert.equal(beforeCells[1]?.getAttribute('data-line'), 'removed')
    assert.equal(afterCells[1]?.getAttribute('data-line'), 'added')
    assert.match(beforeCells[1]?.textContent ?? '', /return thirty \+ two/)
    assert.match(afterCells[1]?.textContent ?? '', /return sixty \+ four/)

    // A later mount reads the remembered choice (FR-2.4).
    const reopened = await render(
      h(StatusPanel, { sessionId: 's1', git: stubGit({}), t, locale: 'en' }),
    )
    await settle()
    await click(must(reopened, `[data-group="unstaged"] .${cls.row}`))
    const buttons = [...reopened.querySelectorAll<HTMLButtonElement>(`.${cls.diffSegButton}`)]
    assert.equal(buttons[1]?.getAttribute('aria-pressed'), 'true')
    assert.equal(reopened.querySelectorAll(`.${cls.diffCell}`).length, 8)
  })

  it('scrolls the two halves together, on both axes', async () => {
    // A long line must be readable without the halves drifting apart: each half
    // has its own scrollbars, and moving one moves the other.
    const container = await render(
      h(StatusPanel, { sessionId: 's1', git: stubGit({}), t, locale: 'en' }),
    )
    await settle()
    await click(must(container, `[data-group="unstaged"] .${cls.row}`))
    await click(
      [...container.querySelectorAll<HTMLButtonElement>(`.${cls.diffSegButton}`)][1] as HTMLButtonElement,
    )
    await flush()

    const sides = [...container.querySelectorAll<HTMLElement>(`.${cls.diffSide}`)]
    const [before, after] = sides as [HTMLElement, HTMLElement]

    before.scrollTop = 120
    before.scrollLeft = 40
    await act(async () => {
      before.dispatchEvent(new dom.window.Event('scroll'))
    })

    assert.equal(after.scrollTop, 120, 'the halves stay paired while reading down')
    assert.equal(after.scrollLeft, 40, 'and stay on the same column while reading across')

    // And the mirror image: the guard is the values being equal, so the copy does
    // not bounce back.
    after.scrollTop = 300
    await act(async () => {
      after.dispatchEvent(new dom.window.Event('scroll'))
    })
    assert.equal(before.scrollTop, 300)
  })

  it('drops an open diff whose file is no longer changed', async () => {
    // A committed or discarded file has no row to go back to, so the pane must
    // not stay behind describing something the list no longer lists.
    let status: Result<RepoStatus> = { ok: true, value: statusFixture() }
    let listeners: ((change: GitChange) => void)[] = []
    const git: GitRemoteClient = {
      ...stubGit({}),
      status: () => Promise.resolve(status),
      watch: (_sessionId, onChange) => {
        listeners.push(onChange)
        return () => {
          listeners = listeners.filter((listener) => listener !== onChange)
        }
      },
    }
    const container = await render(h(StatusPanel, { sessionId: 's1', git, t, locale: 'en' }))
    await settle()
    await click(must(container, `[data-group="unstaged"] .${cls.row}`))
    assert.equal(container.querySelector(`.${cls.diffView}`) !== null, true)

    status = { ok: true, value: statusWith({}) }
    await act(async () => {
      for (const listener of listeners) listener({ kinds: ['worktree'] })
    })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 260))
    })
    await flush()

    assert.equal(container.querySelector(`.${cls.diffView}`), null)
    assert.deepEqual(
      groupCounts(container),
      ['0', '0', '0'],
      'the panel is showing a clean working tree',
    )
  })
})

describe('the plugin’s registration', () => {
  it('registers the type, its body, and its title under one id', async () => {
    const calls = { types: 0, bodies: 0, titles: 0, dictionaries: 0 }
    let definition: { id: string; kind: string } | undefined
    let bodyKey: string | undefined
    let titleKey: string | undefined

    const ctx = {
      effect: (run: () => unknown) => {
        run()
        return () => undefined
      },
      locale: {
        bind: () => t,
        getLocale: () => ({ active: 'en' }),
        register: () => {
          calls.dictionaries += 1
          return () => undefined
        },
      },
      sidebarRightTabs: {
        register: (def: { id: string; kind: string }) => {
          calls.types += 1
          definition = def
          return () => undefined
        },
      },
      slots: {
        inject: (_name: string, factory: () => unknown) => {
          factory()
          return () => undefined
        },
        register: (options: { name: string; key: string }) => {
          if (options.name === 'sidebar.right.pane.tab') {
            calls.bodies += 1
            bodyKey = options.key
          }
          if (options.name === 'sidebar.right.pane.tab.title') {
            calls.titles += 1
            titleKey = options.key
          }
          return () => undefined
        },
      },
    }

    apply(ctx as never)

    assert.equal(calls.types, 1)
    assert.equal(calls.bodies, 1)
    assert.equal(calls.titles, 1)
    assert.equal(calls.dictionaries, 1)
    assert.equal(definition?.id, GIT_PANEL_ID)
    assert.equal(definition?.kind, GIT_PANEL_KIND)
    // DSH finds a body by the definition's `id`, so these must agree exactly.
    assert.equal(bodyKey, GIT_PANEL_ID)
    assert.equal(titleKey, GIT_PANEL_ID)
  })

  it('offers a guide entry, which is the only way to open a page type', () => {
    const definition = gitPanelDefinition(((key: keyof typeof en) => en[key]) as never)
    assert.equal(definition.guide?.length, 1)
    assert.equal(definition.guide?.[0]?.title(), 'Git changes')
    assert.equal(typeof definition.guide?.[0]?.description?.(), 'string')
    assert.ok(definition.guide?.[0]?.icon, 'a guide capsule needs a glyph')
    // A page type claims no resource address.
    assert.equal(definition.patterns, undefined)
  })
})

describe('the dictionaries', () => {
  it('define the same keys in both languages', () => {
    assert.deepEqual(Object.keys(zh).sort(), Object.keys(en).sort())
  })

  it('names the namespace the adapter declares', () => {
    assert.equal(NS, 'gitPanel')
  })
})

/* ── M4: branches, conflicts, AI message, commit detail ─────────────────── */

/**
 * The fixture with its conflict resolved, so the commit scope is the index.
 *
 * {@link statusWith} keeps only the groups it is given, which is the wrong tool
 * here: these tests want everything the fixture has EXCEPT the conflict.
 */
function withoutConflicts(): RepoStatus {
  const base = statusFixture()
  return { ...base, groups: { ...base.groups, conflicted: [] } }
}

/** Two branches: the current one, and one that can be switched to. */
function twoBranches(): readonly BranchRef[] {
  return [
    ...branchesFixture(),
    {
      name: 'feature/x',
      current: false,
      oid: 'c'.repeat(40),
      upstream: null,
      ahead: 0,
      behind: 0,
      upstreamGone: false,
      committedAt: '2026-09-10T10:00:00+08:00',
      subject: 'work in progress',
    },
  ]
}

/** Set an `<input>`'s value the way React's controlled inputs expect. */
async function typeIntoInput(node: HTMLInputElement, value: string): Promise<void> {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
  await act(async () => {
    setter?.call(node, value)
    node.dispatchEvent(new window.Event('input', { bubbles: true }))
  })
  await settle()
}

/** Choose an option the way a browser does, change event included. */
async function selectOption(node: HTMLSelectElement, value: string): Promise<void> {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')?.set
  await act(async () => {
    setter?.call(node, value)
    node.dispatchEvent(new window.Event('change', { bubbles: true }))
  })
  await settle()
}

/** Open the branch picker from the rail, and return it. */
async function openPicker(container: HTMLElement): Promise<HTMLElement> {
  await click(must(container, `.${cls.branch}`))
  return must<HTMLElement>(container, '[data-branch-picker="true"]')
}

describe('the branch picker (FR-4.1–4.3)', () => {
  it('lists the local branches and switches on a row click', async () => {
    const calls: ActionLog = { entries: [] }
    const container = await render(
      h(StatusPanel, {
        sessionId: 's1',
        git: stubGit({ branches: twoBranches(), calls }),
        t,
        locale: 'en',
      }),
    )
    await settle()
    // The list is folded until the rail's branch name is pressed: FR-4.1's
    // control has to be discoverable, but it is not always on screen.
    assert.equal(container.querySelector('[data-branch-picker]'), null)

    const picker = await openPicker(container)
    const picks = [...picker.querySelectorAll<HTMLButtonElement>(`.${cls.branchPick}`)]
    assert.equal(picks.length, 2)
    // The current branch is a heading as much as an entry: switching to where
    // HEAD already is would be a no-op round trip.
    assert.equal(picks[0]?.disabled, true)
    assert.equal(picks[1]?.disabled, false)

    await click(picks[1] as Element)
    assert.deepEqual(calls.entries, ['checkout:feature/x'])
    // The picker folds itself away behind the action it started.
    assert.equal(container.querySelector('[data-branch-picker]'), null)
  })

  it('creates a branch from HEAD, and from a chosen base', async () => {
    const calls: ActionLog = { entries: [] }
    const container = await render(
      h(StatusPanel, {
        sessionId: 's1',
        git: stubGit({ branches: twoBranches(), calls }),
        t,
        locale: 'en',
      }),
    )
    await settle()

    const picker = await openPicker(container)
    await click(must(picker, `.${cls.accent}`))
    const input = must<HTMLInputElement>(picker, `.${cls.branchInput}`)
    await typeIntoInput(input, 'feat/new')
    await click(must(picker, 'button[type="submit"]'))
    assert.deepEqual(calls.entries, ['createBranch:feat/new@'])

    // Again, this time starting from a branch rather than from HEAD (FR-4.2's
    // other half). `base: ''` in the log is the wire's "from the current HEAD".
    const again = await openPicker(container)
    await click(must(again, `.${cls.accent}`))
    await typeIntoInput(must<HTMLInputElement>(again, `.${cls.branchInput}`), 'feat/from-main')
    await selectOption(must<HTMLSelectElement>(again, `.${cls.branchSelect}`), 'main')
    await click(must(again, 'button[type="submit"]'))
    assert.deepEqual(calls.entries, ['createBranch:feat/new@', 'createBranch:feat/from-main@main'])
  })

  it('deletes in two clicks, and refuses a delete the panel cannot confirm', async () => {
    const calls: ActionLog = { entries: [] }
    const container = await render(
      h(StatusPanel, {
        sessionId: 's1',
        git: stubGit({ branches: twoBranches(), calls }),
        t,
        locale: 'en',
      }),
    )
    await settle()

    const picker = await openPicker(container)
    const row = [...picker.querySelectorAll(`.${cls.branchRow}`)][1]
    assert.ok(row)
    await click(must(row, `.${cls.tool}`))

    // §4.3's pattern: the first click only arms, and it does so in words.
    const armed = must(row, `.${cls.danger}[data-armed="true"]`)
    assert.match(armed.textContent ?? '', /Click again to delete feature\/x/)
    assert.deepEqual(calls.entries, [], 'arming must not delete anything')

    await click(armed)
    assert.deepEqual(calls.entries, ['deleteBranch:feature/x'])
  })

  it('asks for a forced delete when the host refuses an unmerged branch (FR-4.3)', async () => {
    const calls: ActionLog = { entries: [] }
    const refusal = {
      ok: false as const,
      error: { code: 'not-merged' as const, message: 'the branch has commits that are not merged anywhere else' },
    }
    const container = await render(
      h(StatusPanel, {
        sessionId: 's1',
        git: stubGit({ branches: twoBranches(), calls, deleteBranch: refusal }),
        t,
        locale: 'en',
      }),
    )
    await settle()

    const picker = await openPicker(container)
    const row = [...picker.querySelectorAll(`.${cls.branchRow}`)][1]
    assert.ok(row)
    await click(must(row, `.${cls.tool}`))
    await click(must(row, `.${cls.danger}`))

    // The refusal is reported, and the SAME row is now armed as the forced
    // variant — that is what "未合并需强制确认" has to look like.
    assert.match(container.textContent ?? '', /commits nothing else reaches/)
    const forced = must(picker, `.${cls.danger}[data-armed="true"]`)
    assert.match(forced.textContent ?? '', /force-delete feature\/x/)

    await click(forced)
    assert.deepEqual(calls.entries, ['deleteBranch:feature/x', 'deleteBranch:feature/x:force'])
  })

  it('folds away on Escape', async () => {
    const container = await render(
      h(StatusPanel, { sessionId: 's1', git: stubGit({ branches: twoBranches() }), t, locale: 'en' }),
    )
    await settle()
    await openPicker(container)
    await act(async () => {
      window.dispatchEvent(new window.Event('keydown', { bubbles: true }))
      document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    await settle()
    assert.equal(container.querySelector('[data-branch-picker]'), null)
  })
})

describe('the branch picker as a dropdown (§4.3, FR-4.1)', () => {
  it('floats over the panel instead of taking a row in its column', async () => {
    const container = await render(
      h(StatusPanel, { sessionId: 's1', git: stubGit({ branches: twoBranches() }), t, locale: 'en' }),
    )
    await settle()
    const panel = must(container, `.${cls.root}`)
    const before = [...panel.children]

    const picker = await openPicker(container)
    const layer = must<HTMLElement>(container, '[data-popover="true"]')

    // The whole point of the change: the list is positioned out of the column's
    // flow, so opening it cannot push the staged drawer, the commit box, or the
    // change groups down — the file list stays where the pointer left it.
    assert.equal(window.getComputedStyle(layer).position, 'absolute')
    assert.ok(layer.contains(picker), 'the picker renders inside the layer')
    // Opening adds exactly one element, and it is the layer.
    assert.deepEqual(
      [...panel.children].filter((child) => !before.includes(child)),
      [layer],
    )
    // Its top edge is measured from the rail, which is why the rail is a ref.
    assert.equal(layer.previousElementSibling, must(container, `.${cls.head}`))
    // And the control that opened it says so, to a screen reader as well.
    const trigger = must(container, `.${cls.branch}`)
    assert.equal(trigger.getAttribute('aria-expanded'), 'true')
    assert.equal(trigger.getAttribute('aria-haspopup'), 'dialog')
    assert.equal(trigger.getAttribute('aria-controls'), layer.id)
    assert.equal(layer.getAttribute('role'), 'dialog')
  })

  it('hangs under the rail, capped at the room the panel has left', async () => {
    const container = await render(
      h(StatusPanel, { sessionId: 's1', git: stubGit({ branches: twoBranches() }), t, locale: 'en' }),
    )
    await settle()
    // jsdom has no layout, so the two rectangles a browser would compute are
    // stated here: a 38px rail at the top of a 600px panel.
    const panel = must(container, `.${cls.root}`)
    const rail = must(container, `.${cls.head}`)
    panel.getBoundingClientRect = () => rect(100, 600)
    rail.getBoundingClientRect = () => rect(100, 38)

    await openPicker(container)
    const layer = must<HTMLElement>(container, '[data-popover="true"]')

    // 38 of rail + the 4px gap, in the panel's own coordinates; and the list can
    // only be as tall as the panel below it, so it scrolls instead of running
    // out of the bottom of a narrow sidebar.
    assert.equal(layer.style.top, '42px')
    assert.equal(layer.style.maxHeight, '554px')
  })

  it('closes on a press outside it, and keeps its state for a press inside', async () => {
    const container = await render(
      h(StatusPanel, { sessionId: 's1', git: stubGit({ branches: twoBranches() }), t, locale: 'en' }),
    )
    await settle()

    let picker = await openPicker(container)
    // Inside: the armed-delete flow and the create form live here, and a press
    // that dismisses the list mid-edit would make both unusable.
    await press(must(picker, `.${cls.branchRow}`))
    assert.ok(container.querySelector('[data-branch-picker]'), 'a press inside must not close it')

    // The trigger is not "outside" either: it owns the toggle, and closing on its
    // press as well would make the next click close-and-reopen in one go.
    await press(must(container, `.${cls.branch}`))
    assert.ok(container.querySelector('[data-branch-picker]'), 'the anchor owns its own toggle')

    // Anywhere else in the panel — the change list, the commit box — dismisses.
    await press(must(container, `.${cls.commitBox}`))
    assert.equal(container.querySelector('[data-branch-picker]'), null)

    // Reopening after a dismissal still works, and the layer is back.
    picker = await openPicker(container)
    assert.ok(picker.isConnected)
  })
})

/* ── M5a order 1: the row menu, and the layer it hangs from ─────────────── */

/**
 * Press a key on an element, so the panel's own key handlers see it.
 * @param node - The element the key lands on.
 * @param init - The key, and any modifiers.
 */
async function keyDown(node: Element, init: KeyboardEventInit): Promise<void> {
  await act(async () => {
    node.dispatchEvent(
      new window.KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }),
    )
  })
  await flush()
}

/** Right-click one group's first change row, and return the menu it opened. */
async function openRowMenu(container: HTMLElement, area: string): Promise<HTMLElement> {
  const row = must<HTMLElement>(container, `[data-group="${area}"] .${cls.row}`)
  await act(async () => {
    row.dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
  })
  await settle()
  return must<HTMLElement>(container, '[data-menu="true"]')
}

/** A menu's entries, as the labels a user reads. */
function menuLabels(menu: HTMLElement): (string | null)[] {
  return [...menu.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent)
}

describe('where a floating layer goes (§4.3’s dropdowns)', () => {
  // jsdom has no layout, so every rectangle here is stated: a 600px panel whose
  // top edge sits at y=100, and the 38px rail at its top.
  const panel = { top: 100, height: 600 }
  const rail = { top: 100, bottom: 138 }

  it('hangs under the anchor, capped at the room the panel has left', () => {
    assert.deepEqual(placeLayer({ anchor: rail, panel, gap: 4, naturalHeight: 120 }), {
      placement: 'below',
      top: 42,
      bottom: null,
      maxHeight: 554,
    })
  })

  it('keeps a long list below when above is no roomier', () => {
    // Thirty branches under the rail: the list scrolls where it was opened rather
    // than jumping to the top of the panel, because there is nothing above the
    // rail to gain. Only a menu on the panel's bottom rows is worth moving.
    const placed = placeLayer({ anchor: rail, panel, gap: 4, naturalHeight: 900 })
    assert.equal(placed.placement, 'below')
    assert.equal(placed.maxHeight, 554)
  })

  it('flips above a row that has no room under it', () => {
    // A row menu on the panel's last rows: a 26px row ending 14px above the
    // bottom edge leaves 6px below, which is a menu nobody could use.
    const row = { top: 660, bottom: 686 }
    assert.deepEqual(placeLayer({ anchor: row, panel, gap: 4, naturalHeight: 44 }), {
      placement: 'above',
      top: null,
      bottom: 44,
      maxHeight: 552,
    })
  })

  it('leaves a short menu below when it fits, even near the bottom', () => {
    const row = { top: 620, bottom: 646 }
    const placed = placeLayer({ anchor: row, panel, gap: 4, naturalHeight: 44 })
    assert.equal(placed.placement, 'below')
    assert.equal(placed.maxHeight, 46)
  })

  it('does not move a layer inside a panel that has no height to measure', () => {
    // jsdom, or a panel that is not visible: there is no room to run out of, so
    // the layer stays under its anchor and keeps its height. (Both existing
    // dropdown tests rely on this: they state the anchor's rectangle and nothing
    // else.)
    const placed = placeLayer({ anchor: rail, panel: { top: 100, height: 0 }, gap: 4, naturalHeight: 0 })
    assert.deepEqual(placed, { placement: 'below', top: 42, bottom: null, maxHeight: null })
  })
})

describe('the row menu (§9’s file menu, M5a order 1)', () => {
  it('opens under the row that was right-clicked, with the action that row offers', async () => {
    const container = await render(
      h(StatusPanel, { sessionId: 's1', git: stubGit({}), t, locale: 'en' }),
    )
    await settle()
    const panel = must(container, `.${cls.root}`)
    const before = [...panel.children]

    // jsdom measures nothing, so the row's rectangle is stated: 26px of row whose
    // top edge is 300px below the panel's.
    const row = must<HTMLElement>(container, `[data-group="unstaged"] .${cls.row}`)
    row.getBoundingClientRect = () => rect(300, 26)

    const menu = await openRowMenu(container, 'unstaged')
    const layer = must<HTMLElement>(container, '[data-popover="true"]')

    // The same floating layer the branch list uses: it covers the list instead of
    // taking a row in the column, so the file under the pointer never moves.
    assert.equal(window.getComputedStyle(layer).position, 'absolute')
    assert.equal(layer.dataset.placement, 'below')
    // Measured from the ROW — 26px of row plus the 4px gap — not from the rail.
    assert.equal(layer.style.top, '330px')
    // Opening adds exactly one element, and it is the layer.
    assert.deepEqual(
      [...panel.children].filter((child) => !before.includes(child)),
      [layer],
    )
    // A menu, named for the row it belongs to.
    assert.equal(menu.getAttribute('role'), 'menu')
    assert.match(menu.getAttribute('aria-label') ?? '', /deep\/nested\/dir\/changed\.ts/)
    // The working-tree row offers its own staging action and the destructive one,
    // with a hairline between them (§9's menu shape).
    assert.deepEqual(menuLabels(menu), ['Stage', 'Discard changes'])
    assert.equal(menu.querySelectorAll('[role="separator"]').length, 1)
  })

  it('runs the action on the file the row stands for, and closes', async () => {
    const calls: ActionLog = { entries: [] }
    const container = await render(
      h(StatusPanel, { sessionId: 's1', git: stubGit({ calls }), t, locale: 'en' }),
    )
    await settle()

    const menu = await openRowMenu(container, 'unstaged')
    await click(must(menu, '[role="menuitem"]'))

    assert.deepEqual(calls.entries, ['stage:deep/nested/dir/changed.ts'])
    assert.equal(container.querySelector('[data-menu="true"]'), null)
  })

  it('offers the other side of the index on a staged row, and stage on an untracked one', async () => {
    const calls: ActionLog = { entries: [] }
    const container = await render(
      h(StatusPanel, { sessionId: 's1', git: stubGit({ calls }), t, locale: 'en' }),
    )
    await settle()

    const staged = await openRowMenu(container, 'staged')
    assert.deepEqual(menuLabels(staged), ['Unstage'])
    await click(must(staged, '[role="menuitem"]'))

    const untracked = await openRowMenu(container, 'untracked')
    assert.deepEqual(menuLabels(untracked), ['Stage', 'Discard changes'])
    await click(must(untracked, '[role="menuitem"]'))

    assert.deepEqual(calls.entries, ['unstage:src/staged.ts', 'stage:notes.md'])
  })

  it('marks a conflict resolved under the name that says so (FR-9.2)', async () => {
    const calls: ActionLog = { entries: [] }
    const container = await render(
      h(StatusPanel, { sessionId: 's1', git: stubGit({ calls }), t, locale: 'en' }),
    )
    await settle()

    const menu = await openRowMenu(container, 'conflicted')
    // The command is `git add` either way; the entry says what that means here.
    assert.deepEqual(menuLabels(menu), ['Mark resolved'])
    await click(must(menu, '[role="menuitem"]'))
    assert.deepEqual(calls.entries, ['stage:both.txt'])
  })

  it('opens from the keyboard, and the keys belong to it while it is open (§4.3)', async () => {
    const calls: ActionLog = { entries: [] }
    const container = await render(
      h(StatusPanel, { sessionId: 's1', git: stubGit({ calls }), t, locale: 'en' }),
    )
    await settle()
    const row = must<HTMLElement>(container, `[data-group="untracked"] .${cls.row}`)
    row.focus()

    // Shift+F10 is what a keyboard without a menu key sends.
    await keyDown(row, { key: 'F10', shiftKey: true })
    const menu = must<HTMLElement>(container, '[data-menu="true"]')
    // Focus moves into the menu, and its first entry is already the active one, so
    // Enter works without an arrow key first.
    assert.equal(document.activeElement, menu)
    assert.equal(must<HTMLElement>(menu, '[role="menuitem"]').dataset.active, 'true')

    await keyDown(menu, { key: 'Enter' })
    assert.deepEqual(calls.entries, ['stage:notes.md'])
    assert.equal(container.querySelector('[data-menu="true"]'), null)
    // Focus goes back to the row it came from, so the keyboard is where it was.
    assert.equal(document.activeElement, row)
  })

  it('is dismissed by a press outside it, and by the row opening its diff', async () => {
    const container = await render(
      h(StatusPanel, { sessionId: 's1', git: stubGit({}), t, locale: 'en' }),
    )
    await settle()

    const menu = await openRowMenu(container, 'unstaged')
    // Inside is the menu's own business: a press there must not dismiss it, or the
    // entry could never be clicked.
    await press(must(menu, '[role="menuitem"]'))
    assert.ok(container.querySelector('[data-menu="true"]'), 'a press inside must not close it')

    // Anywhere else in the panel dismisses it, exactly like the branch list.
    await press(must(container, `.${cls.commitBox}`))
    assert.equal(container.querySelector('[data-menu="true"]'), null)

    // Opening the row's diff is a press on the menu's own anchor, which the layer
    // does not count as "outside" — so the panel closes it itself.
    await openRowMenu(container, 'unstaged')
    await click(must(container, `[data-group="unstaged"] .${cls.row}`))
    assert.equal(container.querySelector('[data-menu="true"]'), null)
  })

  it('leaves the panel with one layer: a row menu closes the branch list', async () => {
    const container = await render(
      h(StatusPanel, { sessionId: 's1', git: stubGit({ branches: twoBranches() }), t, locale: 'en' }),
    )
    await settle()
    await openPicker(container)

    const row = must<HTMLElement>(container, `[data-group="unstaged"] .${cls.row}`)
    // Shift+F10 arrives without a press, so nothing would dismiss the open branch
    // list but the panel itself.
    await keyDown(row, { key: 'ContextMenu' })

    assert.equal(container.querySelector('[data-branch-picker]'), null)
    assert.ok(container.querySelector('[data-menu="true"]'))
  })
})

describe('discarding a change from its row (FR-6.1, §4.3)', () => {
  it('arms the row’s own button first, and only the second click discards', async () => {
    const calls: ActionLog = { entries: [] }
    const container = await render(
      h(StatusPanel, { sessionId: 's1', git: stubGit({ calls }), t, locale: 'en' }),
    )
    await settle()

    const row = must<HTMLElement>(container, `[data-group="unstaged"] .${cls.row}`)
    // The third button in the strip is the discard: `+`/`-` first, then this one.
    const buttons = [...row.querySelectorAll<HTMLButtonElement>(`.${cls.rowActions} button`)]
    assert.equal(buttons.length, 2)
    const discard = buttons[1]
    if (discard === undefined) throw new Error('expected a discard button')
    assert.match(discard.getAttribute('aria-label') ?? '', /Discard the changes to/)

    await click(discard)
    // §4.3: the first click arms and says so in words, and nothing was thrown away.
    assert.deepEqual(calls.entries, [])
    const armed = must<HTMLElement>(row, '[data-armed="true"]')
    assert.match(armed.textContent ?? '', /cannot be undone/u)
    assert.match(armed.getAttribute('title') ?? '', /cannot be undone/u)

    await click(armed)
    assert.deepEqual(calls.entries, ['discard:deep/nested/dir/changed.ts'])
    const done = must(container, '[data-action-done="discard"]')
    assert.match(done.textContent ?? '', /deep\/nested\/dir\/changed\.ts/)
  })

  it('does not offer discard where there is no working-tree change to throw away', async () => {
    const container = await render(
      h(StatusPanel, { sessionId: 's1', git: stubGit({}), t, locale: 'en' }),
    )
    await settle()

    // A staged row's action is unstage, and a conflicted row's is "mark resolved":
    // discarding from either would throw away state that row is not showing (the
    // rule is one function, `ui/row-actions.ts`).
    for (const area of ['staged', 'conflicted']) {
      const row = must<HTMLElement>(container, `[data-group="${area}"] .${cls.row}`)
      const buttons = [...row.querySelectorAll(`.${cls.rowActions} button`)]
      assert.equal(buttons.length, 1, `${area} has one button, not two`)
    }
    // ...and the menu agrees with the row: no entry, no hairline.
    const stagedMenu = await openRowMenu(container, 'staged')
    assert.deepEqual(menuLabels(stagedMenu), ['Unstage'])
    assert.equal(stagedMenu.querySelectorAll('[role="separator"]').length, 0)
  })

  it('arms inside the row menu, which stays up for the second click', async () => {
    const calls: ActionLog = { entries: [] }
    const container = await render(
      h(StatusPanel, { sessionId: 's1', git: stubGit({ calls }), t, locale: 'en' }),
    )
    await settle()

    let menu = await openRowMenu(container, 'untracked')
    const layer = must<HTMLElement>(container, '[data-popover="true"]')
    await click(must(menu, '[role="menuitem"][data-danger="true"]'))

    // The first click is §4.3's arming, so the entry must not take the menu down
    // with it — and it is the entry itself that now reads as the confirmation.
    assert.deepEqual(calls.entries, [])
    menu = must<HTMLElement>(container, '[data-menu="true"]')
    assert.equal(must(container, '[data-popover="true"]'), layer, 'the menu never closed')
    const armed = must<HTMLElement>(menu, '[role="menuitem"][data-danger="true"]')
    assert.match(armed.textContent ?? '', /cannot be undone/u)

    await click(armed)
    assert.deepEqual(calls.entries, ['discard:notes.md'])
    assert.equal(container.querySelector('[data-menu="true"]'), null)
  })

  it('lands a refused discard beside the list, and keeps the row (FR-1.4)', async () => {
    const container = await render(
      h(StatusPanel, {
        sessionId: 's1',
        git: stubGit({
          discard: {
            ok: false,
            error: { code: 'git-failed', message: 'could not restore', detail: 'error: nope' },
          },
        }),
        t,
        locale: 'en',
      }),
    )
    await settle()

    const row = must<HTMLElement>(container, `[data-group="unstaged"] .${cls.row}`)
    await click(must(row, `.${cls.rowActions} button:last-child`))
    await click(must<HTMLElement>(row, '[data-armed="true"]'))

    const box = must(container, '[data-action-error="discard"]')
    assert.match(box.textContent ?? '', /nope/u)
    assert.ok(container.querySelector(`[data-group="unstaged"] .${cls.row}`), 'the list survives')
  })
})

/* ── M5a order 3: undoing the newest commit from its history row (FR-3.8) ── */

/** Right-click the history row at `index` (0 = newest), and return the menu it opened. */
async function openHistoryMenu(container: HTMLElement, index = 0): Promise<HTMLElement> {
  const row = [...container.querySelectorAll<HTMLElement>(`.${cls.commitRow}`)][index]
  if (row === undefined) throw new Error(`expected a commit row at index ${index}`)
  await act(async () => {
    row.dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
  })
  await settle()
  return must<HTMLElement>(container, '[data-menu="true"]')
}

describe('undoing the newest commit from its history row (FR-3.8, §4.3)', () => {
  it('opens a one-entry danger menu on the newest commit, and nowhere else', async () => {
    const older = { ...commitFixture(), oid: 'e'.repeat(40), shortOid: 'eeeeeee' }
    const container = await render(
      // Newest first, as `git log` reports it.
      h(StatusPanel, { sessionId: 's1', git: stubGit({ log: [commitFixture(), older] }), t, locale: 'en' }),
    )
    await settle()

    const menu = await openHistoryMenu(container)
    // A menu, named for the commit it belongs to.
    assert.equal(menu.getAttribute('role'), 'menu')
    assert.match(menu.getAttribute('aria-label') ?? '', /bbbbbbb/)
    const items = [...menu.querySelectorAll('[role="menuitem"]')]
    assert.equal(items.length, 1, 'undo is the only entry so far')
    assert.equal(items[0]?.textContent, 'Undo this commit')
    assert.equal(items[0]?.getAttribute('data-danger'), 'true')

    // The older row has no menu at all: FR-3.8 undoes the newest commit, so a
    // row with no entries gets no empty menu.
    await keyDown(menu, { key: 'Escape' })
    const rows = [...container.querySelectorAll<HTMLElement>(`.${cls.commitRow}`)]
    await act(async () => {
      rows[1]?.dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    })
    await settle()
    assert.equal(container.querySelector('[data-menu="true"]'), null)
  })

  it('arms first with the reset sentence for an unpushed commit; only the second click undoes', async () => {
    const calls: ActionLog = { entries: [] }
    const container = await render(
      // commitFixture().pushed is false: the row's marker says "not pushed yet".
      h(StatusPanel, { sessionId: 's1', git: stubGit({ calls, log: [commitFixture()] }), t, locale: 'en' }),
    )
    await settle()

    let menu = await openHistoryMenu(container)
    const layer = must<HTMLElement>(container, '[data-popover="true"]')
    await click(must(menu, '[role="menuitem"]'))

    // §4.3's first click: armed, and the entry itself says what the second click
    // does — for an unpublished commit, the changes return to the working tree.
    assert.deepEqual(calls.entries, [])
    menu = must<HTMLElement>(container, '[data-menu="true"]')
    assert.equal(must(container, '[data-popover="true"]'), layer, 'the menu never closed')
    const armed = must<HTMLElement>(menu, '[role="menuitem"][data-danger="true"]')
    assert.match(armed.textContent ?? '', /changes return to the working tree/)

    await click(armed)
    // The host is handed the commit's FULL object id; it re-verifies the rest.
    assert.deepEqual(calls.entries, [`undoCommit:${'b'.repeat(40)}`])
    assert.equal(container.querySelector('[data-menu="true"]'), null)
    const done = must(container, '[data-action-done="undo"]')
    // The notice names the commit, because its row is gone from the history.
    assert.match(done.textContent ?? '', /a commit subject/)
    assert.match(done.textContent ?? '', /back in the working tree/)
  })

  it('arms with the revert sentence for a published commit, and reports the new commit', async () => {
    const calls: ActionLog = { entries: [] }
    const published = { ...commitFixture(), pushed: true }
    const container = await render(
      h(StatusPanel, {
        sessionId: 's1',
        git: stubGit({
          calls,
          log: [published],
          undoCommit: {
            ok: true,
            value: { mode: 'revert', shortOid: 'bbbbbbb', subject: 'a commit subject' },
          },
        }),
        t,
        locale: 'en',
      }),
    )
    await settle()

    const menu = await openHistoryMenu(container)
    await click(must(menu, '[role="menuitem"]'))
    const armed = must<HTMLElement>(container, '[role="menuitem"][data-danger="true"]')
    // Published history is not rewritten: the confirmation says a NEW commit
    // undoes the old one.
    assert.match(armed.textContent ?? '', /a revert commit is created/)

    await click(armed)
    assert.deepEqual(calls.entries, [`undoCommit:${'b'.repeat(40)}`])
    assert.match(must(container, '[data-action-done="undo"]').textContent ?? '', /revert commit undoing/)
  })

  it('opens from the keyboard, and Enter arms then executes', async () => {
    const calls: ActionLog = { entries: [] }
    const container = await render(
      h(StatusPanel, { sessionId: 's1', git: stubGit({ calls, log: [commitFixture()] }), t, locale: 'en' }),
    )
    await settle()
    const row = must<HTMLElement>(container, `.${cls.commitRow}`)
    row.focus()

    // Shift+F10 is what a keyboard without a menu key sends.
    await keyDown(row, { key: 'F10', shiftKey: true })
    const menu = must<HTMLElement>(container, '[data-menu="true"]')
    assert.equal(document.activeElement, menu)
    assert.equal(must<HTMLElement>(menu, '[role="menuitem"]').dataset.active, 'true')

    await keyDown(menu, { key: 'Enter' })
    assert.deepEqual(calls.entries, [], 'the first activation only arms')
    assert.ok(container.querySelector('[data-menu="true"]'), 'the menu stays up for the second click')

    await keyDown(menu, { key: 'Enter' })
    assert.deepEqual(calls.entries, [`undoCommit:${'b'.repeat(40)}`])
    assert.equal(container.querySelector('[data-menu="true"]'), null)
  })

  it('lands a refusal beside the list, with the host’s own sentence', async () => {
    const container = await render(
      h(StatusPanel, {
        sessionId: 's1',
        git: stubGit({
          log: [commitFixture()],
          undoCommit: {
            ok: false,
            error: { code: 'bad-request', message: 'that commit is no longer the newest one' },
          },
        }),
        t,
        locale: 'en',
      }),
    )
    await settle()

    const menu = await openHistoryMenu(container)
    await click(must(menu, '[role="menuitem"]'))
    await click(must(container, '[role="menuitem"][data-danger="true"]'))

    // The refusal is a reachable state (the history moved under the row), and
    // its sentence is the answer — shown where the operation was (§4.3), with
    // the history list exactly as it was.
    const box = must(container, '[data-action-error="undo"]')
    assert.match(box.textContent ?? '', /no longer the newest one/)
    assert.equal(container.querySelectorAll(`.${cls.commitRow}`).length, 1)
  })
})

/* ── M5a order 4: the stash, and FR-4.4's way out of a blocked switch ───── */

/**
 * Open the stash layer from the rail, and return it.
 *
 * The rail's icon buttons carry their accessible name as the tooltip, so the
 * stash one is found by the dictionary rather than by position — which is what
 * keeps this helper working when the rail gains another button.
 * @param container - The rendered panel.
 * @returns The stash list's content element.
 */
async function openStashes(container: HTMLElement): Promise<HTMLElement> {
  const stash = [...container.querySelectorAll<HTMLButtonElement>(`.${cls.tool}`)].find(
    (button) => button.getAttribute('aria-label') === en['stash.open'],
  )
  if (stash === undefined) throw new Error('expected the rail to offer a stash button')
  await click(stash)
  return must<HTMLElement>(container, '[data-stash-picker="true"]')
}

/** Click a native checkbox, the way a pointer does: the default action toggles it. */
async function toggleCheckbox(node: HTMLInputElement): Promise<void> {
  await act(async () => {
    node.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }))
  })
  await settle()
}

describe('the stash list (FR-6.2, §4.3)', () => {
  it('opens from the rail and lists the stack newest first, by git’s own selectors', async () => {
    const older = stashFixture({
      oid: 'e'.repeat(40),
      shortOid: 'eeeeeee',
      selector: 'stash@{1}',
      subject: 'On main: older work',
    })
    const container = await render(
      h(StatusPanel, {
        sessionId: 's1',
        git: stubGit({ stashes: [stashFixture(), older] }),
        t,
        locale: 'en',
      }),
    )
    await settle()

    // Folded until the rail's button is pressed: the stack is read on purpose,
    // not on every panel mount.
    assert.equal(container.querySelector('[data-stash-picker]'), null)

    const picker = await openStashes(container)
    const selectors = [...picker.querySelectorAll(`.${cls.stashSelector}`)].map(
      (node) => node.textContent,
    )
    assert.deepEqual(selectors, ['stash@{0}', 'stash@{1}'])
    assert.match(picker.textContent ?? '', /WIP on main: aaaa111 first/)
    assert.match(picker.textContent ?? '', /On main: older work/)
    // Each entry offers both ways to bring it back, and the destructive one is
    // not one of them. Both are accent-inked: they are the row's actions, not
    // footnotes (that is the fix for "I could not tell this text was clickable").
    const labels = [...picker.querySelectorAll(`.${cls.accent}`)].map((button) => button.textContent)
    assert.deepEqual(labels.slice(0, 4), ['Apply', 'Pop', 'Apply', 'Pop'])
  })

  it('stashes the message the user typed, with untracked files only when asked', async () => {
    const calls: ActionLog = { entries: [] }
    const container = await render(
      h(StatusPanel, { sessionId: 's1', git: stubGit({ calls }), t, locale: 'en' }),
    )
    await settle()

    const picker = await openStashes(container)
    const save = [...picker.querySelectorAll<HTMLButtonElement>(`.${cls.accent}`)].find(
      (button) => button.textContent === 'Stash current changes…',
    )
    assert.ok(save, 'the list offers a way to stash the worktree')
    await click(save)
    await typeIntoInput(must<HTMLInputElement>(picker, `.${cls.stashInput}`), 'half-done work')
    await toggleCheckbox(must<HTMLInputElement>(picker, 'input[type="checkbox"]'))
    await click(must(picker, 'button[type="submit"]'))

    // Untracked files are git's `-u`, and the panel asks for them only because
    // the box was ticked; the label goes with it. (Reading the stack is a call of
    // its own and is not what this test is about.)
    assert.deepEqual(
      calls.entries.filter((entry) => entry !== 'stashes').slice(0, 1),
      ['stashSave:half-done work:untracked'],
    )
    const notice = must(container, '[data-action-done="stash"]')
    assert.equal(notice.textContent, 'Stashed the current changes: half-done work')
  })

  it('applies and pops by the entry’s id, never by the position it is shown at', async () => {
    const calls: ActionLog = { entries: [] }
    const older = stashFixture({ oid: 'e'.repeat(40), selector: 'stash@{1}' })
    const container = await render(
      h(StatusPanel, {
        sessionId: 's1',
        git: stubGit({ calls, stashes: [stashFixture(), older] }),
        t,
        locale: 'en',
      }),
    )
    await settle()

    const picker = await openStashes(container)
    const rows = [...picker.querySelectorAll<HTMLElement>(`.${cls.stashRow}`)]
    await click(must(rows[0] as Element, `.${cls.accent}`))

    // A selector is a position another window can shift; the id is what the
    // panel sends, and the host resolves it again.
    const acts = (): string[] => calls.entries.filter((entry) => entry !== 'stashes')
    assert.deepEqual(acts().slice(0, 1), [`stashApply:${'d'.repeat(40)}`])
    assert.equal(
      must(container, '[data-action-done="stash"]').textContent,
      'Applied stash@{0}',
    )

    const pops = [...rows[1]!.querySelectorAll<HTMLButtonElement>(`.${cls.accent}`)]
    await click(pops[1] as Element)
    assert.equal(acts()[1], `stashApply:${'e'.repeat(40)}:pop`)
    assert.equal(
      must(container, '[data-action-done="stash"]').textContent,
      'Popped stash@{1}',
    )
  })

  it('drops an entry only after its own button arms, and keeps the list up in between', async () => {
    const calls: ActionLog = { entries: [] }
    const container = await render(
      h(StatusPanel, { sessionId: 's1', git: stubGit({ calls }), t, locale: 'en' }),
    )
    await settle()

    const picker = await openStashes(container)
    const trash = [...picker.querySelectorAll<HTMLButtonElement>(`.${cls.tool}`)].find(
      (button) => button.getAttribute('aria-label') === 'Drop stash stash@{0} (cannot be undone)',
    )
    assert.ok(trash, 'the entry offers a way to drop it')
    await click(trash)

    // §4.3's first click: armed, visibly a different button, nothing dropped.
    assert.deepEqual(
      calls.entries.filter((entry) => entry !== 'stashes'),
      [],
    )
    const armed = must<HTMLElement>(picker, `.${cls.danger}`)
    assert.equal(armed.textContent, 'Click again: drop')
    assert.ok(container.querySelector('[data-stash-picker="true"]'), 'the layer stays up')

    await click(armed)
    assert.deepEqual(
      calls.entries.filter((entry) => entry !== 'stashes').slice(0, 1),
      [`stashDrop:${'d'.repeat(40)}`],
    )
    assert.equal(
      must(container, '[data-action-done="stash"]').textContent,
      'Dropped stash@{0}',
    )
  })

  it('says the stack is empty rather than showing nothing at all', async () => {
    const container = await render(
      h(StatusPanel, { sessionId: 's1', git: stubGit({ stashes: [] }), t, locale: 'en' }),
    )
    await settle()

    const picker = await openStashes(container)
    assert.equal(
      must(picker, '[data-stash-empty="true"]').textContent,
      'There are no stashes yet.',
    )
  })

  it('paints the text that opens a form as an action, and a form’s cancel as a footnote', async () => {
    // Reported from the running panel: 新建分支 / 贮藏当前更改 were plain text —
    // the same ink as the sentence beside them — so neither looked clickable. Both
    // are `.accent` now, and the footnote ink stays for the controls that really
    // are secondary.
    const container = await render(
      h(StatusPanel, { sessionId: 's1', git: stubGit({}), t, locale: 'en' }),
    )
    await settle()

    const picker = await openPicker(container)
    assert.equal(must(picker, `.${cls.accent}`).textContent, 'New branch…')
    await click(must(picker, `.${cls.accent}`))
    const cancel = [...picker.querySelectorAll(`.${cls.ghost}`)].find(
      (button) => button.textContent === 'Cancel',
    )
    assert.ok(cancel, 'the form’s own cancel stays a footnote')

    // The other layer the complaint named. Opening it closes the branch list —
    // one layer at a time — which is that rule seen from the other side.
    const stashes = await openStashes(container)
    const save = [...stashes.querySelectorAll(`.${cls.accent}`)].find(
      (button) => button.textContent === 'Stash current changes…',
    )
    assert.ok(save, 'the stash layer’s own action is accent-inked too')
    assert.equal(container.querySelector('[data-branch-picker]'), null)
  })
})

describe('stashing, then switching (FR-4.4, D20)', () => {
  /** The refusal git prints when a switch would overwrite local work. */
  function blockedSwitch(): Result<OperationReport> {
    return {
      ok: false,
      error: {
        code: 'dirty-worktree',
        message: 'local changes would be overwritten, so the operation was refused',
        detail:
          'error: Your local changes to the following files would be overwritten by checkout:\n\ta.txt\nPlease commit your changes or stash them before you switch branches.\nAborting\n',
      },
    }
  }

  it('shows git’s own refusal, then stashes and retries the very switch it blocked', async () => {
    const calls: ActionLog = { entries: [] }
    const container = await render(
      h(StatusPanel, {
        sessionId: 's1',
        git: stubGit({ branches: twoBranches(), calls, checkout: blockedSwitch() }),
        t,
        locale: 'en',
      }),
    )
    await settle()

    const picker = await openPicker(container)
    const picks = [...picker.querySelectorAll<HTMLButtonElement>(`.${cls.branchPick}`)]
    await click(picks[1] as Element)

    // FR-4.4's first half, unchanged since M4: the multi-line output survives to
    // the screen, verbatim.
    const box = must(container, '[data-action-error="checkout"]')
    assert.match(box.textContent ?? '', /Aborting/)
    assert.match(box.textContent ?? '', /a\.txt/)

    const shortcut = [...box.querySelectorAll('button')].find(
      (button) => button.textContent === 'Stash, then switch to feature/x',
    )
    assert.ok(shortcut, 'the blocked switch offers the way on')

    // The stub answers the retry the same way, so the click proves the ORDER:
    // stash first, then the switch it unblocks. The switch is still blocked, so
    // the shortcut is still the answer and stays on screen.
    await click(shortcut)
    assert.deepEqual(calls.entries, [
      'checkout:feature/x',
      'stashSave::untracked',
      'checkout:feature/x',
    ])
    assert.ok(
      [...container.querySelectorAll('button')].some((button) =>
        (button.textContent ?? '').startsWith('Stash, then switch'),
      ),
      'a still-blocked switch keeps its way out',
    )
  })

  it('reports a clean switch after stashing, naming the branch', async () => {
    const calls: ActionLog = { entries: [] }
    let attempt = 0
    const container = await render(
      h(StatusPanel, {
        sessionId: 's1',
        git: stubGit({
          branches: twoBranches(),
          calls,
          // Refused once, as the blocked state, then accepted: the shortcut's
          // whole promise is that the second attempt succeeds.
          checkout: () =>
            attempt++ === 0
              ? blockedSwitch()
              : { ok: true, value: { summary: '', detail: '' } },
        }),
        t,
        locale: 'en',
      }),
    )
    await settle()

    const picker = await openPicker(container)
    await click([...picker.querySelectorAll<HTMLButtonElement>(`.${cls.branchPick}`)][1] as Element)
    const box = must(container, '[data-action-error="checkout"]')
    const shortcut = [...box.querySelectorAll('button')].find((button) =>
      (button.textContent ?? '').startsWith('Stash, then switch'),
    )
    await click(shortcut as Element)

    assert.equal(
      must(container, '[data-action-done="stash"]').textContent,
      'Stashed the current changes and switched to feature/x',
    )
    // The switch happened, so the way out it was offering is gone.
    assert.equal(container.querySelector('[data-action-error]'), null)
    assert.equal(
      [...container.querySelectorAll('button')].some((button) =>
        (button.textContent ?? '').startsWith('Stash, then switch'),
      ),
      false,
    )
  })

  it('offers no shortcut for a switch that a stash would not fix', async () => {
    const container = await render(
      h(StatusPanel, {
        sessionId: 's1',
        git: stubGit({
          branches: twoBranches(),
          checkout: { ok: false, error: { code: 'bad-request', message: 'there is no such branch' } },
        }),
        t,
        locale: 'en',
      }),
    )
    await settle()

    const picker = await openPicker(container)
    await click([...picker.querySelectorAll<HTMLButtonElement>(`.${cls.branchPick}`)][1] as Element)

    const box = must(container, '[data-action-error="checkout"]')
    assert.match(box.textContent ?? '', /no such branch/)
    assert.equal(
      [...box.querySelectorAll('button')].some((button) =>
        (button.textContent ?? '').startsWith('Stash, then switch'),
      ),
      false,
    )
  })
})

describe('the menu’s own entries and keyboard (M5a’s row-menu mechanism)', () => {
  /** A menu of four entries, one of them a separator and one of them disabled. */
  function renderMenu(chosen: string[]): Promise<HTMLElement> {
    const entries: readonly MenuEntry[] = [
      { kind: 'item', id: 'first', label: 'First', onSelect: () => chosen.push('first') },
      { kind: 'separator' },
      { kind: 'item', id: 'off', label: 'Unavailable', disabled: true, onSelect: () => chosen.push('off') },
      { kind: 'item', id: 'last', label: 'Discard', danger: true, onSelect: () => chosen.push('last') },
    ]
    return render(h(Menu, { entries, label: 'Actions', onClose: () => chosen.push('close') }))
  }

  it('draws one row per entry, marks the destructive one, and names the separator', async () => {
    const container = await renderMenu([])
    const menu = must<HTMLElement>(container, '[role="menu"]')
    assert.deepEqual(menuLabels(menu), ['First', 'Unavailable', 'Discard'])
    assert.equal(menu.querySelectorAll('[role="separator"]').length, 1)
    assert.equal(must<HTMLButtonElement>(menu, '[data-danger="true"]').textContent, 'Discard')
    assert.equal(must<HTMLButtonElement>(menu, 'button[disabled]').textContent, 'Unavailable')
  })

  it('steps over the disabled entry and the separator, and wraps at both ends', async () => {
    const container = await renderMenu([])
    const menu = must<HTMLElement>(container, '[role="menu"]')
    const active = (): string | null => must(menu, '[data-active="true"]').textContent

    // It opens on the first entry that can be activated.
    assert.equal(active(), 'First')
    // Down skips the disabled one rather than landing on a row Enter cannot use.
    await keyDown(menu, { key: 'ArrowDown' })
    assert.equal(active(), 'Discard')
    // ...and wraps, so the end of the menu is not a dead stop.
    await keyDown(menu, { key: 'ArrowDown' })
    assert.equal(active(), 'First')
    await keyDown(menu, { key: 'ArrowUp' })
    assert.equal(active(), 'Discard')
    await keyDown(menu, { key: 'Home' })
    assert.equal(active(), 'First')
    await keyDown(menu, { key: 'End' })
    assert.equal(active(), 'Discard')
  })

  it('runs the active entry on Enter, and closes first', async () => {
    const chosen: string[] = []
    const container = await renderMenu(chosen)
    const menu = must<HTMLElement>(container, '[role="menu"]')

    await keyDown(menu, { key: 'ArrowDown' })
    await keyDown(menu, { key: 'Enter' })
    // The dismissal comes first, the way the branch picker does it: the layer is
    // gone before the operation's own state arrives.
    assert.deepEqual(chosen, ['close', 'last'])
  })

  it('keeps the menu up for an entry that arms instead of acting', async () => {
    const chosen: string[] = []
    const container = await render(
      h(Menu, {
        entries: [
          { kind: 'item', id: 'arm', label: 'Discard', stayOpen: true, onSelect: () => chosen.push('arm') },
          { kind: 'item', id: 'plain', label: 'Copy', onSelect: () => chosen.push('plain') },
        ] satisfies MenuEntry[],
        label: 'Actions',
        onClose: () => chosen.push('close'),
      }),
    )
    const menu = must<HTMLElement>(container, '[role="menu"]')

    await keyDown(menu, { key: 'Enter' })
    // §4.3's first click: the entry ran (it armed) and the menu is still there for
    // the second one, which is the whole point of the flag.
    assert.deepEqual(chosen, ['arm'])

    await keyDown(menu, { key: 'ArrowDown' })
    await keyDown(menu, { key: 'Enter' })
    // An ordinary entry still closes the menu before it acts.
    assert.deepEqual(chosen, ['arm', 'close', 'plain'])
  })

  it('closes on Escape and on Tab, which are the two ways out', async () => {
    const chosen: string[] = []
    const container = await renderMenu(chosen)
    await keyDown(must(container, '[role="menu"]'), { key: 'Escape' })
    assert.deepEqual(chosen, ['close'])

    const again: string[] = []
    const second = await renderMenu(again)
    await keyDown(must(second, '[role="menu"]'), { key: 'Tab' })
    assert.deepEqual(again, ['close'])
  })

  it('moves the same highlight the pointer moves', async () => {
    const container = await renderMenu([])
    const menu = must<HTMLElement>(container, '[role="menu"]')
    const last = must<HTMLElement>(menu, 'button[data-danger="true"]')

    await act(async () => {
      last.dispatchEvent(new window.Event('pointermove', { bubbles: true }))
    })
    // One highlight, not two: what the pointer is over is what Enter will run.
    assert.equal(must(menu, '[data-active="true"]').textContent, 'Discard')
  })
})

describe('the conflict row and the merge bar (FR-9.2–9.3)', () => {
  it('labels a conflicted row’s action as marking it resolved', async () => {
    const calls: ActionLog = { entries: [] }
    const container = await render(
      h(StatusPanel, { sessionId: 's1', git: stubGit({ calls }), t, locale: 'en' }),
    )
    await settle()

    const group = must(container, '[data-group="conflicted"]')
    const action = must(group, `.${cls.tool}`)
    assert.equal(action.getAttribute('title'), 'Mark both.txt as resolved')
    // The command is the same one the `+` always ran: `git add` IS how a conflict
    // is marked resolved, so there is no second code path to go wrong.
    await click(action)
    assert.deepEqual(calls.entries, ['stage:both.txt'])
  })

  it('offers the merge bar only while a merge is open, and holds continue until it can work', async () => {
    const calls: ActionLog = { entries: [] }
    const container = await render(
      h(StatusPanel, {
        sessionId: 's1',
        git: stubGit({ status: { ok: true, value: { ...statusFixture(), merging: true } }, calls }),
        t,
        locale: 'en',
      }),
    )
    await settle()

    const bar = must(container, '[data-merge="true"]')
    const buttons = [...bar.querySelectorAll<HTMLButtonElement>('button')]
    const [cont, abort] = buttons
    assert.ok(cont && abort)
    // Conflicts remain, so `git commit` would refuse; the button says why.
    assert.equal(cont.disabled, true)
    assert.match(cont.getAttribute('title') ?? '', /still in conflict/)

    // Aborting is destructive, so it takes the same two clicks as a deletion.
    await click(abort)
    const armed = must(bar, `.${cls.danger}[data-armed="true"]`)
    assert.match(armed.textContent ?? '', /Click again to abandon/)
    assert.deepEqual(calls.entries, [])
    await click(armed)
    assert.deepEqual(calls.entries, ['abortMerge'])
  })

  it('continues the merge once every conflict is resolved', async () => {
    const calls: ActionLog = { entries: [] }
    const resolved = { ...withoutConflicts(), merging: true }
    const container = await render(
      h(StatusPanel, {
        sessionId: 's1',
        git: stubGit({ status: { ok: true, value: resolved }, calls }),
        t,
        locale: 'en',
      }),
    )
    await settle()

    const bar = must(container, '[data-merge="true"]')
    const cont = must<HTMLButtonElement>(bar, 'button')
    assert.equal(cont.disabled, false)
    await click(cont)
    assert.deepEqual(calls.entries, ['continueMerge'])
  })
})

describe('the AI commit message (FR-3.5)', () => {
  it('offers the sparkle only when there is a staged diff to describe', async () => {
    const untrackedOnly = statusWith({ conflicted: [], staged: [], unstaged: [] })
    const without = await render(
      h(StatusPanel, {
        sessionId: 's1',
        git: stubGit({ status: { ok: true, value: untrackedOnly } }),
        t,
        locale: 'en',
      }),
    )
    await settle()
    const disabled = must<HTMLButtonElement>(without, `.${cls.aiButton}`)
    assert.equal(disabled.disabled, true)
    assert.match(disabled.getAttribute('title') ?? '', /Stage the changes/)

    const withStaged = await render(
      h(StatusPanel, {
        sessionId: 's1',
        git: stubGit({ status: { ok: true, value: withoutConflicts() } }),
        t,
        locale: 'en',
      }),
    )
    await settle()
    assert.equal(must<HTMLButtonElement>(withStaged, `.${cls.aiButton}`).disabled, false)
  })

  it('puts the generated message in the box, and says when the diff was cut', async () => {
    const calls: ActionLog = { entries: [] }
    const container = await render(
      h(StatusPanel, {
        sessionId: 's1',
        git: stubGit({
          status: { ok: true, value: withoutConflicts() },
          calls,
          generated: { ok: true, value: { message: 'feat: written for you', truncated: true } },
        }),
        t,
        locale: 'en',
      }),
    )
    await settle()

    await click(must(container, `.${cls.aiButton}`))
    // The text lands in the box as editable text, not as a commit: FR-3.5's
    // whole promise is that the user still decides.
    assert.equal(must<HTMLTextAreaElement>(container, `.${cls.commitInput}`).value, 'feat: written for you')
    assert.deepEqual(calls.entries, ['generate:en'])
    assert.match(must(container, '[data-ai-note="true"]').textContent ?? '', /was truncated/)
  })

  it('reports a deployment without a model instead of failing silently', async () => {
    const container = await render(
      h(StatusPanel, {
        sessionId: 's1',
        git: stubGit({
          status: { ok: true, value: withoutConflicts() },
          generated: {
            ok: false,
            error: { code: 'no-llm', message: 'this deployment has no language model configured' },
          },
        }),
        t,
        locale: 'en',
      }),
    )
    await settle()

    await click(must(container, `.${cls.aiButton}`))
    assert.match(container.textContent ?? '', /no language model configured/)
    // The box keeps whatever it had; nothing was written on a failure.
    assert.equal(must<HTMLTextAreaElement>(container, `.${cls.commitInput}`).value, '')
  })
})

describe('the commit detail (FR-3.6)', () => {
  it('expands a commit into its metadata and file list', async () => {
    const calls: ActionLog = { entries: [] }
    const detail: CommitDetail = {
      commit: { ...commitFixture(), parents: ['d'.repeat(40)], pushed: true },
      files: [
        { path: 'src/a.ts', additions: 12, deletions: 3, binary: false },
        { path: 'bin.dat', additions: null, deletions: null, binary: true },
      ],
    }
    const git: GitRemoteClient = {
      ...stubGit({ calls, log: [commitFixture()] }),
      showCommit: (_sessionId, hash) => {
        calls.entries.push(`showCommit:${hash}`)
        return Promise.resolve({ ok: true, value: { ...detail, commit: { ...detail.commit, oid: hash } } })
      },
    }
    const container = await render(h(StatusPanel, { sessionId: 's1', git, t, locale: 'en' }))
    await settle()

    // The dock opens on the history tab by itself, so the rows are already there:
    // clicking that tab now means "put the pane away", which is the fold gesture.
    assert.equal(must(container, `.${cls.bottom}`).getAttribute('data-expanded'), 'true')
    assert.equal(container.querySelector('[data-commit-detail]'), null)

    // The row IS the button — not just its title line. The hot zone has to be
    // what the hover band covers, or the band lies about where a click lands;
    // both of the row's lines are inside this one element.
    const entry = must<HTMLButtonElement>(container, `.${cls.commitRow}`)
    assert.equal(entry.tagName, 'BUTTON')
    assert.equal(entry.getAttribute('role'), null)
    assert.equal(entry.getAttribute('aria-expanded'), 'false')
    entry.focus()
    assert.equal(document.activeElement, entry, 'the row must be reachable by keyboard')
    const row = must(container, `.${cls.commit}`)
    assert.equal(row.getAttribute('data-commit'), 'b'.repeat(40))
    // The band covers the title line AND the metadata line: both are children of
    // the button, so there is no part of the band that does not respond.
    assert.ok(entry.contains(must(container, `.${cls.commitTop}`)))
    assert.ok(entry.contains(must(container, `[data-commit-meta]`)))
    // No disclosure caret in front of the hash: the row itself is the button, so
    // an expand arrow would be a second affordance saying what the band already
    // says (asked for after the row became one button).
    const title = must(container, `.${cls.commitTop}`)
    assert.equal(title.querySelector('svg'), null, 'the entry carries no leading glyph')
    assert.equal(title.firstElementChild?.className, cls.commitHash)
    assert.equal(entry.getAttribute('data-selected'), 'false')

    // Closed, the list has the whole pane to itself.
    const split = must(container, `.${cls.historySplit}`)
    assert.equal(split.getAttribute('data-split'), 'false')
    assert.equal(split.children.length, 1)

    // Clicking the CAPTION toggles too. That is the assertion that would fail if
    // the button ever went back to wrapping only the title.
    await click(must(container, `[data-commit-meta]`))
    await flush()
    assert.equal(entry.getAttribute('aria-expanded'), 'true')
    assert.equal(entry.getAttribute('data-selected'), 'true')

    // Open, the pane is two columns: the ENTRIES on the left, the selected
    // commit's information on the right. That order is markup, not styling.
    assert.equal(split.getAttribute('data-split'), 'true')
    assert.equal(split.children.length, 2)
    assert.equal(split.children[0]?.className, cls.historyList)
    assert.equal(split.children[1]?.className, cls.historyDetail)
    assert.ok(split.children[0]?.contains(entry), 'the clicked row stays in the left column')
    // The information column names its commit, because the row it came from is in
    // the other column and can be scrolled out of sight.
    const head = must(split.children[1] as Element, `.${cls.historyDetailHead}`)
    assert.match(head.textContent ?? '', /bbbbbbb/)
    assert.match(head.textContent ?? '', /a commit subject/)

    const panel = must(container, '[data-commit-detail]')
    const text = panel.textContent ?? ''
    assert.match(text, /src\/a\.ts/)
    assert.match(text, /\+12/)
    assert.match(text, /−3/)
    // git declined to count the binary file, so the row says so rather than
    // showing a churn of zero.
    assert.match(text, /bin\.dat/)
    assert.match(text, /binary/)
    assert.match(text, /ddddddd/, 'the parent is named, shortened')
    assert.deepEqual(calls.entries, [`showCommit:${'b'.repeat(40)}`])

    // Its own close button is the second way out, for anyone who does not think
    // to click the row again.
    await click(must(split.children[1] as Element, `.${cls.tool}`))
    assert.equal(container.querySelector('[data-commit-detail]'), null)
    assert.equal(split.getAttribute('data-split'), 'false')
    assert.equal(split.children.length, 1)

    // Closing and reopening costs no second git call: the detail is remembered.
    await click(entry)
    assert.equal(entry.getAttribute('aria-expanded'), 'true')
    assert.equal(calls.entries.length, 1)

    // Clicking the selected row again closes the column.
    await click(entry)
    assert.equal(container.querySelector('[data-commit-detail]'), null)
    assert.equal(entry.getAttribute('aria-expanded'), 'false')
    assert.equal(entry.getAttribute('data-selected'), 'false')
  })

  it('switches the information column to whichever commit was clicked last', async () => {
    const calls: ActionLog = { entries: [] }
    const second: CommitInfo = {
      ...commitFixture(),
      oid: 'e'.repeat(40),
      shortOid: 'eeeeeee',
      subject: 'the newer one',
    }
    const git: GitRemoteClient = {
      // Newest first, as `git log` reports it.
      ...stubGit({ calls, log: [second, commitFixture()] }),
      showCommit: (_sessionId, hash) =>
        Promise.resolve({
          ok: true,
          value: {
            commit: { ...commitFixture(), oid: hash, shortOid: hash.slice(0, 7) },
            files: [{ path: 'src/a.ts', additions: 1, deletions: 0, binary: false }],
          },
        }),
    }
    const container = await render(h(StatusPanel, { sessionId: 's1', git, t, locale: 'en' }))
    await settle()

    // No click to open the dock: it starts expanded on the history tab.
    const rows = [...container.querySelectorAll<HTMLElement>(`.${cls.commitRow}`)]
    assert.equal(rows.length, 2)

    await click(must(rows[0] as Element, `[data-commit-meta]`))
    await flush()
    let info = must(container, `[data-commit-detail]`)
    assert.match(info.textContent ?? '', /eeeeeee/)
    assert.match(info.textContent ?? '', /the newer one/)

    // Selecting another commit re-points the same column; it does not stack a
    // second one beside it.
    await click(rows[1] as Element)
    await flush()
    info = must(container, `[data-commit-detail]`)
    assert.match(info.textContent ?? '', /bbbbbbb/)
    assert.match(info.textContent ?? '', /a commit subject/)
    assert.equal(container.querySelectorAll('[data-commit-detail]').length, 1)
  })
})

/* ── M5b order 5: one file of a commit, read against that commit (FR-7.2) ── */

describe('the commit’s own file diff (FR-7.2)', () => {
  it('opens a listed file in the diff tab, read against that commit', async () => {
    const diffCalls: string[] = []
    const git: GitRemoteClient = {
      ...stubGit({ diffCalls, log: [commitFixture()] }),
      showCommit: (_sessionId, hash) =>
        Promise.resolve({
          ok: true,
          value: {
            commit: { ...commitFixture(), oid: hash, pushed: true },
            files: [{ path: 'src/history-only.ts', additions: 2, deletions: 1, binary: false }],
          },
        }),
    }
    const container = await render(h(StatusPanel, { sessionId: 's1', git, t, locale: 'en' }))
    await settle()

    await click(must(container, `.${cls.commitRow}`))
    await flush()

    // The file row IS a button: the hot zone and the hover band have to be the
    // same rectangle, exactly as on the commit rows above it.
    const file = must<HTMLButtonElement>(container, '[data-commit-file="src/history-only.ts"]')
    assert.equal(file.tagName, 'BUTTON')
    assert.match(file.getAttribute('aria-label') ?? '', /src\/history-only\.ts/u)
    file.focus()
    assert.equal(document.activeElement, file, 'the file row must be reachable by keyboard')

    await click(file)
    await flush()

    // The dock's diff tab is already where a change row's diff goes; a commit's
    // file takes the same tab rather than growing a second diff surface.
    assert.equal(must(container, `.${cls.bottom}`).getAttribute('data-tab'), 'diff')
    assert.deepEqual(diffCalls, [`commit:${'b'.repeat(40)}:src/history-only.ts@3`])
    assert.equal(must(container, `.${cls.diffView}`).getAttribute('data-diff-area'), 'commit')
    // The list and the detail column stay mounted behind the tab, so going back
    // costs a click rather than a re-read.
    assert.notEqual(container.querySelector('[data-commit-detail]'), null)
  })

  it('survives a change-list refresh, and follows a ref rather than a file', async () => {
    // A commit diff names a path that is usually NOT in the change list, so the
    // "the row is gone, drop the view" rule would close it the moment it opened.
    // And the reading itself is history: only a moved ref can make it stale.
    const diffCalls: string[] = []
    let listeners: ((change: GitChange) => void)[] = []
    const base = statusFixture()
    let status: Result<RepoStatus> = { ok: true, value: base }
    const git: GitRemoteClient = {
      ...stubGit({ diffCalls, log: [commitFixture()] }),
      status: () => Promise.resolve(status),
      showCommit: () =>
        Promise.resolve({
          ok: true,
          value: {
            commit: commitFixture(),
            files: [{ path: 'src/history-only.ts', additions: 2, deletions: 1, binary: false }],
          },
        }),
      watch: (_sessionId, onChange) => {
        listeners.push(onChange)
        return () => {
          listeners = listeners.filter((listener) => listener !== onChange)
        }
      },
    }
    const container = await render(h(StatusPanel, { sessionId: 's1', git, t, locale: 'en' }))
    await settle()
    await click(must(container, `.${cls.commitRow}`))
    await flush()
    await click(must(container, '[data-commit-file="src/history-only.ts"]'))
    await flush()
    assert.deepEqual(diffCalls, [`commit:${'b'.repeat(40)}:src/history-only.ts@3`])

    /** Publish one kind of change, through the same channel the probe uses. */
    const publish = async (kinds: readonly GitChangeKind[]): Promise<void> => {
      await act(async () => {
        for (const listener of listeners) listener({ kinds })
      })
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 260))
      })
      await flush()
    }

    // A file the change list did not have before: the reading changes, so the
    // panel publishes — and the commit diff must neither be dropped nor re-read.
    const withFile = {
      ...base,
      groups: {
        ...base.groups,
        untracked: [
          ...base.groups.untracked,
          { path: 'fresh.txt', index: '?', worktree: '.', staged: false, untracked: true, conflicted: false },
        ] as RepoStatus['groups']['untracked'],
      },
    }
    status = { ok: true, value: withFile }
    await publish(['worktree'])
    assert.equal(must(container, `.${cls.bottom}`).getAttribute('data-tab'), 'diff')
    assert.equal(diffCalls.length, 1, 'a working-tree change cannot change a commit’s diff')

    // A ref moved: that IS something a commit diff can go stale on.
    status = { ok: true, value: { ...withFile, branch: { ...withFile.branch, oid: 'c'.repeat(40) } } }
    await publish(['refs'])
    assert.equal(diffCalls.length, 2, 'a moved ref must re-read the commit diff')
  })
})

/* ── the dock’s diff tabs: more than one open at a time ─────────────────── */

/** The × that one diff tab reveals on hover: it lives in that tab's own group. */
function tabCloseButton(container: HTMLElement, path: string): HTMLButtonElement {
  return must<HTMLButtonElement>(container, `[data-close-tab="${path}"]`)
}

/** Whether each mounted diff is the one on screen, in tab order. */
function shownDiffs(container: HTMLElement): (string | null)[] {
  return [...container.querySelectorAll<HTMLElement>(`.${cls.bottomDiff}`)].map((node) =>
    node.getAttribute('data-shown'),
  )
}

describe('the dock’s diff tabs (FR-2.1)', () => {
  it('keeps every opened file open, one tab each, and switches between them for free', async () => {
    const diffCalls: string[] = []
    const container = await render(
      h(StatusPanel, { sessionId: 's1', git: stubGit({ diffCalls }), t, locale: 'en' }),
    )
    await settle()

    await click(must(container, `[data-group="staged"] .${cls.row}`))
    await flush()
    await click(must(container, `[data-group="unstaged"] .${cls.row}`))
    await flush()

    // One tab per open file, after the resident history tab; the earlier diff is
    // still mounted, so going back to it costs no git call.
    const tabs = [...container.querySelectorAll<HTMLElement>(`.${cls.bottomTab}`)]
    assert.deepEqual(
      tabs.map((tab) => tab.textContent),
      ['Recent commits', 'staged.ts', 'changed.ts'],
    )
    assert.deepEqual(diffCalls, ['index:src/staged.ts@3', 'worktree:deep/nested/dir/changed.ts@3'])
    assert.equal(container.querySelectorAll(`.${cls.diffView}`).length, 2)
    assert.deepEqual(shownDiffs(container), ['false', 'true'])

    await click(tabs[1] as Element)
    await flush()
    assert.deepEqual(shownDiffs(container), ['true', 'false'])
    assert.equal(diffCalls.length, 2, 'switching tabs is not a re-read')
    assert.equal(must(container, `.${cls.bottom}`).getAttribute('data-tab'), 'diff')
  })

  it('marks the showing tab, and gives every diff tab its own × to reveal', async () => {
    const container = await render(
      h(StatusPanel, { sessionId: 's1', git: stubGit({}), t, locale: 'en' }),
    )
    await settle()

    // The selected-state attribute has to sit on the TAB: the rule that draws the
    // underline matches it, and on a wrapper the selected diff would have none
    // (reported from the running panel: "最近提交 has the blue line, the diff
    // doesn't").
    let tabs = [...container.querySelectorAll<HTMLElement>(`.${cls.bottomTab}`)]
    assert.equal(tabs[0]?.getAttribute('data-active'), 'true')
    // Nothing to close yet: the one resident tab is the history, and it is not a
    // diff. (Closed by clicking the tab again, which folds the pane.)
    assert.equal(container.querySelectorAll(`.${cls.bottomTabs} .${cls.tool}`).length, 0)

    await click(must(container, `[data-group="unstaged"] .${cls.row}`))
    await flush()
    tabs = [...container.querySelectorAll<HTMLElement>(`.${cls.bottomTab}`)]
    assert.equal(tabs[0]?.getAttribute('data-active'), null, 'the history gives the mark up')
    assert.equal(tabs[1]?.getAttribute('data-active'), 'true')

    // One × per diff tab, named after the file it closes. It is hidden until the
    // pointer (or the keyboard) is on THAT tab — a rule in the stylesheet, since
    // jsdom cannot resolve a hover.
    const close = tabCloseButton(container, 'deep/nested/dir/changed.ts')
    assert.equal(must(container, `.${cls.bottomTabs} .${cls.tool}`).getAttribute('data-close-tab'), 'deep/nested/dir/changed.ts')
    assert.match(close.getAttribute('aria-label') ?? '', /deep\/nested\/dir\/changed\.ts/u)
    // The diff's own header keeps its operations only — no second way out of the
    // pane, which is what "差异操作这行就只进行差异操作" asked for.
    const head = must(container, `.${cls.diffView} .${cls.diffHead}`)
    assert.deepEqual(
      [...head.querySelectorAll<HTMLElement>('button')].map((button) => button.getAttribute('aria-label')),
      ['Unified (inline)', 'Side by side', 'Read the diff again'],
    )
  })

  it('closes only the tab whose × was pressed, and hands over to its neighbour', async () => {
    const container = await render(
      h(StatusPanel, { sessionId: 's1', git: stubGit({}), t, locale: 'en' }),
    )
    await settle()
    await click(must(container, `[data-group="staged"] .${cls.row}`))
    await flush()
    await click(must(container, `[data-group="unstaged"] .${cls.row}`))
    await flush()

    await click(tabCloseButton(container, 'deep/nested/dir/changed.ts'))
    await flush()

    // The other diff takes the strip over; closing one tab is not a reason to put
    // the whole pane away.
    const tabs = [...container.querySelectorAll<HTMLElement>(`.${cls.bottomTab}`)]
    assert.deepEqual(
      tabs.map((tab) => tab.textContent),
      ['Recent commits', 'staged.ts'],
    )
    assert.equal(tabs[1]?.getAttribute('data-active'), 'true')
    assert.equal(must(container, `.${cls.bottom}`).getAttribute('data-expanded'), 'true')

    // The last one closes back to the history, still open: the user closed a diff,
    // not the dock.
    await click(tabCloseButton(container, 'src/staged.ts'))
    await flush()
    assert.equal(container.querySelector(`.${cls.diffView}`), null)
    assert.equal(must(container, `.${cls.bottom}`).getAttribute('data-tab'), 'history')
    assert.equal(must(container, `.${cls.bottom}`).getAttribute('data-expanded'), 'true')
    assert.equal(must(container, `.${cls.bottomTab}`).getAttribute('data-active'), 'true')
  })

  it('closes only the showing diff on Escape, not every open one', async () => {
    const container = await render(
      h(StatusPanel, { sessionId: 's1', git: stubGit({}), t, locale: 'en' }),
    )
    await settle()
    await click(must(container, `[data-group="staged"] .${cls.row}`))
    await flush()
    await click(must(container, `[data-group="unstaged"] .${cls.row}`))
    await flush()

    await act(async () => {
      document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    await flush()

    // Every open diff is mounted, so a document-level Escape must be answered by
    // the one on screen alone — the hidden panes stay open.
    assert.equal(container.querySelectorAll(`.${cls.diffView}`).length, 1)
    assert.equal(must(container, `.${cls.diffView}`).getAttribute('data-diff-area'), 'index')
  })
})

/* ── the change list as a file tree (FR-1.3) ────────────────────────────── */

/** The directory row for one path, in one group. */
function dirNode(container: HTMLElement, area: string, path: string): HTMLElement {
  return must<HTMLElement>(container, `[data-group="${area}"] [data-tree-dir="${path}"]`)
}

/** The file row for one path, in one group. */
function fileNode(container: HTMLElement, area: string, path: string): HTMLElement {
  return must<HTMLElement>(container, `[data-group="${area}"] [data-tree-file="${path}"]`)
}

/** The rail's mode toggle: the only icon button that is a two-state control. */
function modeToggle(container: HTMLElement): HTMLButtonElement {
  return must<HTMLButtonElement>(container, `.${cls.head} .${cls.tool}[aria-pressed]`)
}

describe('the file tree (FR-1.3)', () => {
  it('nests each group’s files under their directories, and opens in that shape', async () => {
    const container = await render(
      h(StatusPanel, { sessionId: 's1', git: stubGit({}), t, locale: 'en' }),
    )
    await settle()

    // FR-1.3 says the tree folds by directory, so a nested path arrives as
    // directory rows plus a file row — the directory part is no longer repeated
    // on every row.
    const deepest = fileNode(container, 'unstaged', 'deep/nested/dir/changed.ts')
    assert.match(deepest.textContent ?? '', /changed\.ts/)
    assert.equal(
      deepest.querySelector(`.${cls.pathDir}`),
      null,
      'the tree must not repeat the directory on the file’s own row',
    )
    // FR-1.2 still holds: the full path is the row's tooltip.
    assert.equal(must(deepest, `.${cls.row}`).getAttribute('title'), 'deep/nested/dir/changed.ts')

    // A chain of single-child directories is compacted into one row, which is
    // what keeps a deep path from spending the sidebar's width on arrows: the
    // whole chain `deep` → `nested` → `dir` is a single row here, and the file
    // hangs directly under it.
    const compacted = dirNode(container, 'unstaged', 'deep/nested/dir')
    assert.match(compacted.textContent ?? '', /deep\/nested\/dir/)
    // The row draws the chain, the tooltip and the key carry the real path.
    // The compacted chain's disclosure is still a button, now behind the row's
    // selection checkbox — the checkbox leads, the disclosure follows.
    assert.equal(
      must<HTMLButtonElement>(compacted, `button.${cls.dirToggle}`).getAttribute('title'),
      'deep/nested/dir',
    )
    // The count of everything under it stays visible, folded or not.
    assert.match(compacted.textContent ?? '', /1/)

    // Indentation is the wrapper's, one step per level: the directory sits at
    // the group's left edge and the file it holds one step in.
    assert.equal(compacted.style.paddingLeft, '0px')
    assert.equal(deepest.style.paddingLeft, '18px')

    // The selection checkbox now leads every row. Its slot is what the two 12px
    // paddings used to agree on: a file row's box rides on the row's own leading
    // padding, a directory row's on this margin, so both columns line up. The
    // disclosure button follows the box with no leading padding of its own.
    // Measured rather than assumed, because this is exactly the kind of thing
    // that drifts.
    const headerCaret = must(
      must(container, '[data-group="unstaged"]'),
      `.${cls.groupToggle} .${cls.groupCaret}`,
    )
    const dirCaret = must(compacted, `.${cls.groupCaret}`)
    const computed = (node: Element): string => window.getComputedStyle(node).paddingLeft
    assert.equal(
      computed(must<HTMLButtonElement>(compacted, `button.${cls.dirToggle}`)),
      '0px',
    )
    assert.equal(
      window.getComputedStyle(must(compacted, `.${cls.selectBoxWrap}`)).marginLeft,
      '12px',
    )
    assert.equal(computed(headerCaret.parentElement as Element), '0px')
    assert.equal(dirCaret.parentElement?.className, cls.dirToggle)

    // A top-level file has no directory row above it.
    assert.match(fileNode(container, 'untracked', 'notes.md').textContent ?? '', /notes\.md/)
    assert.equal(
      dirNode(container, 'staged', 'src').textContent?.includes('staged.ts'),
      false,
      'a directory row names the directory, not its files',
    )
  })

  it('folds a directory, and remembers the fold', async () => {
    const container = await render(
      h(StatusPanel, { sessionId: 's1', git: stubGit({}), t, locale: 'en' }),
    )
    await settle()

    const dir = dirNode(container, 'unstaged', 'deep/nested/dir')
    const toggle = must<HTMLButtonElement>(dir, `button.${cls.dirToggle}`)
    assert.equal(toggle.getAttribute('aria-expanded'), 'true')
    // The caret is the only thing that says "this row holds rows". It must
    // actually turn — the directory rows share the group header's glyph, and a
    // selector scoped to the wrong button is how this stopped working before.
    const opened = window.getComputedStyle(must(dir, `.${cls.groupCaret}`)).transform
    await click(toggle)
    const closed = window.getComputedStyle(must(dir, `.${cls.groupCaret}`)).transform
    assert.notEqual(closed, opened, 'the directory caret must turn when it folds')

    assert.equal(toggle.getAttribute('aria-expanded'), 'false')
    assert.equal(container.querySelector('[data-tree-file="deep/nested/dir/changed.ts"]'), null)
    // The fold is keyed by group AND path: each group builds its own tree, so
    // folding `deep` in Changes must not fold it in the staged drawer.
    assert.deepEqual(JSON.parse(window.localStorage.getItem(DIR_COLLAPSE_KEY) ?? '[]'), [
      'unstaged:deep/nested/dir',
    ])
    // The count survives the fold — that number is the reason to open it again.
    assert.match(dir.textContent ?? '', /1/)

    // A remount reads the fold back, the way a page refresh does.
    const again = await render(
      h(StatusPanel, { sessionId: 's1', git: stubGit({}), t, locale: 'en' }),
    )
    await settle()
    assert.equal(
      must<HTMLButtonElement>(
        dirNode(again, 'unstaged', 'deep/nested/dir'),
        `button.${cls.dirToggle}`,
      ).getAttribute('aria-expanded'),
      'false',
    )
  })

  it('switches to the flat list and back from the rail, and remembers the choice', async () => {
    const container = await render(
      h(StatusPanel, { sessionId: 's1', git: stubGit({}), t, locale: 'en' }),
    )
    await settle()

    const toggle = modeToggle(container)
    // The glyph names the mode it would switch TO; the pressed state says which
    // one is on screen, which is what a screen reader needs to hear.
    assert.equal(toggle.getAttribute('aria-pressed'), 'true')
    assert.equal(toggle.getAttribute('title'), 'Show as a flat list')
    assert.notEqual(container.querySelector('[data-tree-dir]'), null)

    await click(toggle)
    assert.equal(modeToggle(container).getAttribute('aria-pressed'), 'false')
    assert.equal(modeToggle(container).getAttribute('title'), 'Show as a file tree')
    assert.equal(container.querySelector('[data-tree-dir]'), null)
    // The flat list is the same rows with their directory spans back.
    const dirs = [...container.querySelectorAll(`.${cls.pathDir}`)].map((n) => n.textContent)
    assert.ok(dirs.includes('deep/nested/dir/'))
    assert.equal(window.localStorage.getItem(VIEW_MODE_KEY), 'list')

    // And the choice survives a remount, like the diff layout and the folds.
    const again = await render(
      h(StatusPanel, { sessionId: 's1', git: stubGit({}), t, locale: 'en' }),
    )
    await settle()
    assert.equal(again.querySelector('[data-tree-dir]'), null)

    await click(modeToggle(again))
    assert.equal(window.localStorage.getItem(VIEW_MODE_KEY), 'tree')
    assert.notEqual(again.querySelector('[data-tree-dir]'), null)
  })

  it('stages and opens a diff from inside the tree, with the full path', async () => {
    const calls: ActionLog = { entries: [] }
    const diffCalls: string[] = []
    const container = await render(
      h(StatusPanel, {
        sessionId: 's1',
        git: stubGit({
          calls,
          diffCalls,
          diff: (path, area) => ({
            ok: true,
            value: diffFixture({ path, area: area as FileDiff['area'] }),
          }),
        }),
        t,
        locale: 'en',
      }),
    )
    await settle()

    // The tree changes how a path is DRAWN, never which path an action carries:
    // both of these address the file by its repository-relative path (FR-3.1,
    // FR-2.1).
    const file = fileNode(container, 'unstaged', 'deep/nested/dir/changed.ts')
    await click(must(file, `.${cls.tool}`))
    assert.deepEqual(calls.entries, ['stage:deep/nested/dir/changed.ts'])

    await click(must(file, `.${cls.row}`))
    assert.deepEqual(diffCalls, ['worktree:deep/nested/dir/changed.ts@3'])
  })
})
