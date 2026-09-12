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
import { after, before, beforeEach, describe, it } from 'node:test'
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
const { cls, STYLE_TAG_ID, installStyles } = await import('../src/client/ui/styles.ts')
const { DIR_COLLAPSE_KEY, VIEW_MODE_KEY } = await import('../src/client/ui/change-view.ts')
const { BOTTOM_PANE_KEY } = await import('../src/client/ui/bottom-view.ts')
const { NS, en, zh } = await import('../src/client/locales.ts')
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
} from '../src/core/types.ts'
import type { GitRemoteClient, Result } from '../src/core/ports.ts'

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
  watch?: (sessionId: string, onChange: () => void) => () => void
  /** What every report-returning mutation answers; a silent success by default. */
  report?: Result<OperationReport>
  /** What every commit answers; a fixed commit by default. */
  commit?: Result<CommitInfo>
  /** Where mutating calls are recorded, for the tests that assert on them. */
  calls?: ActionLog
  /** What every `diff` answers; {@link diffFixture} by default. */
  diff?: (path: string, area: string) => Result<FileDiff>
  /** Where diff requests are recorded, as `area:path@context`. */
  diffCalls?: string[]
  /** What `showCommit` answers; an empty file list by default. */
  showCommit?: Result<CommitDetail>
  /** What `generateCommitMessage` answers; a fixed message by default. */
  generated?: Result<GeneratedMessage>
  /** What `deleteBranch` answers, for the unmerged-refusal path. */
  deleteBranch?: Result<OperationReport>
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
    diff: (_sessionId, path, area, contextLines) => {
      options.diffCalls?.push(`${area}:${path}@${contextLines}`)
      const answer = options.diff?.(path, area) ?? { ok: true as const, value: diffFixture({ path, area }) }
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
      return Promise.resolve(report)
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

/** Set a textarea's value the way React's controlled inputs expect. */
async function typeInto(node: HTMLTextAreaElement, value: string): Promise<void> {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set
  await act(async () => {
    setter?.call(node, value)
    node.dispatchEvent(new window.Event('input', { bubbles: true }))
  })
  await settle()
}

/** Query one element, failing loudly rather than returning `null`. */
function must<T extends Element>(container: ParentNode, selector: string): T {
  const found = container.querySelector<T>(selector)
  if (found === null) throw new Error(`expected ${selector} to exist`)
  return found
}

/**
 * The height a drawer's scrolling body was dragged to, or `''` while it is still
 * on the stylesheet's default.
 * @param drawer - The drawer element, as `[data-drawer]` finds it.
 */
function drawerHeight(drawer: Element): string {
  return (must(drawer, `.${cls.changeBody}`) as HTMLElement).style.height
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

// The layout choice is persisted (FR-2.4), so one test's choice would otherwise
// decide how the next one renders.
beforeEach(() => {
  dom.window.localStorage.clear()
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
    const body = must(container, `[data-drawer="unstaged"] .${cls.changeBody}`)
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

  it('groups the changes and gives each row its area’s badge letter', async () => {
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
    // then a conflict (`U` in its own group, the same file never listed twice),
    // then the working tree, then what git does not track yet.
    assert.deepEqual(badges, [
      ['M', 'M'],
      ['U', 'U'],
      ['M', 'M'],
      ['?', '?'],
    ])
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
    assert.equal(container.querySelector('[data-git-panel-state="clean"]') !== null, true)
    assert.match(container.textContent ?? '', /No uncommitted changes/)
    // The staged drawer is a fixture of the panel rather than a list that comes
    // and goes with its content: it is the commit box's anchor, and its own empty
    // state says so in words.
    const drawer = must(container, `[data-group="staged"]`)
    assert.equal(must(drawer, `.${cls.count}`).textContent, '0')
    assert.equal(must(drawer, `.${cls.groupEmpty}`).textContent, 'No staged changes')
  })

  it('gives every resident group the same drawer, and sizes each from its own grip', async () => {
    const container = await render(
      h(StatusPanel, { sessionId: 's1', git: stubGit({}), t, locale: 'en' }),
    )
    await settle()

    // The three resident groups are one structure, drawn three times: a grip, a
    // scrolling body, and the group inside it. Same shape and same order as the
    // panel draws them.
    const drawers = [...container.querySelectorAll<HTMLElement>(`.${cls.changeDrawer}`)]
    assert.deepEqual(
      drawers.map((drawer) => drawer.getAttribute('data-drawer')),
      ['staged', 'unstaged', 'untracked'],
    )
    for (const drawer of drawers) {
      assert.equal(drawer.querySelectorAll(`:scope > .${cls.paneGrip}`).length, 1, 'one grip each')
      assert.equal(drawer.querySelectorAll(`:scope > .${cls.changeBody}`).length, 1)
      assert.equal(drawer.querySelectorAll(`.${cls.group}`).length, 1, 'the drawer hosts its group')
      assert.equal((drawer.querySelector(`.${cls.changeBody}`) as HTMLElement).style.height, '')
      // The drawer is top-anchored, so its free edge is the BOTTOM one: the grip
      // comes after the body it sizes. On the top edge the handle would invite a
      // pull upward that the layout cannot honour.
      assert.equal(
        drawer.lastElementChild?.className,
        cls.paneGrip,
        'a top-anchored drawer takes its grip on the bottom edge',
      )
    }

    // The conflict group is the one group that is NOT a drawer: it comes and goes
    // with the merge, and a grip on it would take height from the list for good.
    const conflicted = must(container, `[data-group="conflicted"]`)
    assert.equal(conflicted.closest(`.${cls.changeDrawer}`), null)
    assert.equal(conflicted.parentElement?.className, cls.body)

    // Each grip names its own group, so a drag is never ambiguous.
    assert.deepEqual(
      drawers.map((drawer) => must(drawer, `.${cls.paneGrip}`).getAttribute('aria-label')),
      [
        'Drag to resize the staged changes',
        'Drag to resize the changes',
        'Drag to resize the untracked files',
      ],
    )

    const staged = must<HTMLElement>(container, `[data-drawer="staged"]`)
    const unstaged = must<HTMLElement>(container, `[data-drawer="unstaged"]`)
    const untracked = must<HTMLElement>(container, `[data-drawer="untracked"]`)

    // Downward grows a bottom grip. jsdom has no layout, so the drawer measures
    // as zero and the travel is the whole height.
    await dragGrip(must(staged, `.${cls.paneGrip}`), 100, 200)
    assert.equal(drawerHeight(staged), '100px')

    // The heights are the drawers' own: dragging one leaves the others at their
    // stylesheet default, which is what "every partition resizes itself" means.
    await dragGrip(must(unstaged, `.${cls.paneGrip}`), 40, 200)
    assert.equal(drawerHeight(staged), '100px', 'a released grip must stop resizing')
    assert.equal(drawerHeight(unstaged), '160px')
    assert.equal(drawerHeight(untracked), '')

    // Upward shrinks it — and the floor is what stops it there.
    await dragGrip(must(untracked, `.${cls.paneGrip}`), 160, 100)
    assert.equal(drawerHeight(unstaged), '160px')
    assert.equal(drawerHeight(untracked), '44px')

    // A drawer is clamped at its own ceiling too, whatever the pointer does: 768
    // (the window, since the column measures zero) minus the 180 reserved.
    await dragGrip(must(untracked, `.${cls.paneGrip}`), 0, 1000)
    assert.equal(drawerHeight(untracked), '588px')
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

    // No clean state here — there are unstaged changes — but the drawer is still
    // there, counting zero, with its note instead of rows.
    assert.equal(container.querySelector('[data-git-panel-state="clean"]'), null)
    const drawer = must(container, `[data-group="staged"]`)
    assert.equal(must(drawer, `.${cls.count}`).textContent, '0')
    assert.equal(must(drawer, `.${cls.groupEmpty}`).textContent, 'No staged changes')
    assert.equal(drawer.querySelectorAll(`.${cls.row}`).length, 0)
    // A group whose content is genuinely optional still comes and goes.
    assert.equal(container.querySelector('[data-group="untracked"]') !== null, true)

    // Folding it leaves the header and the count: the anchor survives the fold.
    await click(must(drawer, `.${cls.groupToggle}`))
    assert.equal(drawer.querySelector(`.${cls.groupEmpty}`), null)
    assert.equal(must(drawer, `.${cls.count}`).textContent, '0')
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
    // 300px" — and the drawer above is asserted to be left exactly where it was.
    const stagedDrawer = must(container, `[data-drawer="staged"]`)
    await dragGrip(grip, 300, 0)
    assert.equal(pane.style.height, '300px')
    assert.equal(drawerHeight(stagedDrawer), '')

    // The same grip, dragged past the top of the panel: the clamp is what this
    // reads, since the pointer itself can go anywhere.
    const ceiling = Math.max(32, window.innerHeight - 200)
    await dragGrip(grip, 0, -1000)
    assert.equal(pane.style.height, `${ceiling}px`)

    // Folding from the chevron drops the explicit height (a height would leave a
    // blank body), and expanding brings the pane back where it was.
    await click(must(container, `.${cls.tool}[aria-expanded]`))
    assert.equal(pane.getAttribute('data-expanded'), 'false')
    assert.equal(pane.style.height, '')
    await click(must(container, `.${cls.tool}[aria-expanded]`))
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
    await click(must(reopened, `.${cls.tool}[aria-expanded]`))
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

  it('re-reads when the watcher reports a change', async () => {
    let listeners: (() => void)[] = []
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
      for (const listener of listeners) listener()
    })
    // The panel coalesces a burst into one trailing re-read.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 260))
    })
    assert.equal(statusCalls, 2, 'a change notification must trigger exactly one re-read')
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

    const drawer = must(container, `[data-drawer="staged"]`)
    assert.equal(must(drawer, `.${cls.count}`).textContent, '0', 'the drawer is still resident')
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

    // Context lines keep both sides; a removed/added pair is aligned, with each
    // column showing its own file's line number.
    const firstRow = [...container.querySelectorAll(`.${cls.diffRow}`)][0] as HTMLElement
    const firstCells = [...firstRow.querySelectorAll(`.${cls.diffCell}`)]
    assert.equal(firstCells.length, 2)
    assert.equal(must<HTMLElement>(firstCells[0] as Element, `.${cls.diffGutter}`).textContent, '1')
    assert.equal(must<HTMLElement>(firstCells[1] as Element, `.${cls.diffGutter}`).textContent, '1')

    const changed = [...container.querySelectorAll(`.${cls.diffRow}`)][1] as HTMLElement
    const cells = [...changed.querySelectorAll(`.${cls.diffCell}`)]
    assert.equal(cells[0]?.getAttribute('data-line'), 'removed')
    assert.equal(cells[1]?.getAttribute('data-line'), 'added')
    assert.match(cells[0]?.textContent ?? '', /return thirty \+ two/)
    assert.match(cells[1]?.textContent ?? '', /return sixty \+ four/)
    // 6 inline lines collapse into 4 rows: each removed/added pair shares one.
    assert.equal(container.querySelectorAll(`.${cls.diffRow}`).length, 4)

    // A later mount reads the remembered choice (FR-2.4).
    const reopened = await render(
      h(StatusPanel, { sessionId: 's1', git: stubGit({}), t, locale: 'en' }),
    )
    await settle()
    await click(must(reopened, `[data-group="unstaged"] .${cls.row}`))
    const buttons = [...reopened.querySelectorAll<HTMLButtonElement>(`.${cls.diffSegButton}`)]
    assert.equal(buttons[1]?.getAttribute('aria-pressed'), 'true')
    assert.equal(reopened.querySelectorAll(`.${cls.diffRow}`).length, 4)
  })

  it('drops an open diff whose file is no longer changed', async () => {
    // A committed or discarded file has no row to go back to, so the pane must
    // not stay behind describing something the list no longer lists.
    let status: Result<RepoStatus> = { ok: true, value: statusFixture() }
    let listeners: (() => void)[] = []
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
      for (const listener of listeners) listener()
    })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 260))
    })
    await flush()

    assert.equal(container.querySelector(`.${cls.diffView}`), null)
    assert.equal(container.querySelector(`[data-git-panel-state="clean"]`) !== null, true)
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
    await click(must(picker, `.${cls.ghost}`))
    const input = must<HTMLInputElement>(picker, `.${cls.branchInput}`)
    await typeIntoInput(input, 'feat/new')
    await click(must(picker, 'button[type="submit"]'))
    assert.deepEqual(calls.entries, ['createBranch:feat/new@'])

    // Again, this time starting from a branch rather than from HEAD (FR-4.2's
    // other half). `base: ''` in the log is the wire's "from the current HEAD".
    const again = await openPicker(container)
    await click(must(again, `.${cls.ghost}`))
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

    await click(must(container, `.${cls.bottomTab}`))
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
    await click(must(container, `.${cls.bottomTab}`))

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
    assert.equal(
      must<HTMLButtonElement>(compacted, 'button').getAttribute('title'),
      'deep/nested/dir',
    )
    // The count of everything under it stays visible, folded or not.
    assert.match(compacted.textContent ?? '', /1/)

    // Indentation is the wrapper's, one step per level: the directory sits at
    // the group's left edge and the file it holds one step in.
    assert.equal(compacted.style.paddingLeft, '0px')
    assert.equal(deepest.style.paddingLeft, '18px')

    // The root directory's caret starts in the same column as the group header's
    // caret above it, which is what the two 12px paddings agree on: the header's
    // own leading padding, and the directory button's. Measured rather than
    // assumed, because this is exactly the kind of thing that drifts.
    const headerCaret = must(
      must(container, '[data-group="unstaged"]'),
      `.${cls.groupToggle} .${cls.groupCaret}`,
    )
    const dirCaret = must(compacted, `.${cls.groupCaret}`)
    const computed = (node: Element): string => window.getComputedStyle(node).paddingLeft
    assert.equal(
      computed(must(compacted, 'button')),
      computed(must(container, `.${cls.groupHead}`)),
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
    const toggle = must<HTMLButtonElement>(dir, 'button')
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
      must<HTMLButtonElement>(dirNode(again, 'unstaged', 'deep/nested/dir'), 'button').getAttribute(
        'aria-expanded',
      ),
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
