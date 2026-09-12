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
const { NS, en, zh } = await import('../src/client/locales.ts')
const { GIT_PANEL_ID, GIT_PANEL_KIND, gitPanelDefinition } = await import(
  '../src/client/adapter/sidebar-tab.tsx'
)
const { apply } = await import('../src/client/index.tsx')

import type { BranchRef, CommitInfo, FileDiff, OperationReport, RepoStatus } from '../src/core/types.ts'
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

  it('splits a path so the file name survives and the directory can clip', async () => {
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

    await dragGrip(must(staged, `.${cls.paneGrip}`), 200, 100)
    assert.equal(drawerHeight(staged), '100px')

    // The heights are the drawers' own: dragging one leaves the others at their
    // stylesheet default, which is what "every partition resizes itself" means.
    await dragGrip(must(unstaged, `.${cls.paneGrip}`), 200, 40)
    assert.equal(drawerHeight(staged), '100px', 'a released grip must stop resizing')
    assert.equal(drawerHeight(unstaged), '160px')
    assert.equal(drawerHeight(untracked), '')

    await dragGrip(must(untracked, `.${cls.paneGrip}`), 100, 160)
    assert.equal(drawerHeight(unstaged), '160px')
    // jsdom has no layout, so a panel measures as zero and the grip falls back to
    // the window: 160 is below the floor, so the clamp is what this reads.
    assert.equal(drawerHeight(untracked), '44px')

    // A drawer is clamped at its own ceiling too, whatever the pointer does.
    await dragGrip(must(untracked, `.${cls.paneGrip}`), 0, -1000)
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

  it('loads history only when its tab is opened', async () => {
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
    const container = await render(h(StatusPanel, { sessionId: 's1', git, t, locale: 'en' }))
    await settle()
    assert.equal(logCalls, 0, 'a folded pane must not spend a git call')

    await click(must(container, `.${cls.bottomTab}`))

    assert.equal(logCalls, 1)
    const text = container.textContent ?? ''
    assert.match(text, /bbbbbbb/)
    assert.match(text, /a commit subject/)
    assert.match(text, /Ada/)
    // `pushed: false` renders the hollow ring, not the filled dot.
    const marker = container.querySelector(`.${cls.marker}`)
    assert.equal(marker?.getAttribute('data-pushed'), 'false')
  })

  it('folds the bottom pane to its tabs, and sizes it from the grip', async () => {
    const container = await render(
      h(StatusPanel, { sessionId: 's1', git: stubGit({}), t, locale: 'en' }),
    )
    await settle()

    // Folded is the resting state: the tab strip and nothing else, so the change
    // list keeps the height.
    const pane = must(container, `.${cls.bottom}`) as HTMLElement
    assert.equal(pane.getAttribute('data-expanded'), 'false')
    assert.equal(container.querySelector(`.${cls.bottomBody}`), null)

    await click(must(container, `.${cls.bottomTab}`))
    assert.equal(pane.getAttribute('data-expanded'), 'true')
    assert.equal(pane.getAttribute('data-tab'), 'history')
    // No inline height yet: the tab's own default (the stylesheet) applies.
    assert.equal(pane.style.height, '')

    // Two panes carry a grip (the first change drawer above and this one), so the
    // queries are scoped to the pane under test.
    const grip = must(container, `.${cls.bottom} .${cls.paneGrip}`)
    assert.equal(grip.getAttribute('role'), 'separator')
    assert.equal(grip.getAttribute('aria-label'), 'Drag to resize the bottom pane')

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
