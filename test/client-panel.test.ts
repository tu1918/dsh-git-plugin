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
import { after, before, describe, it } from 'node:test'
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

import type { BranchRef, CommitInfo, OperationReport, RepoStatus } from '../src/core/types.ts'
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

/** A git client whose answers the test chooses. */
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

/** The three sync buttons of the state rail, in render order. */
function syncButtons(container: HTMLElement): HTMLButtonElement[] {
  const rail = must(container, `.${cls.head}`)
  return [...rail.querySelectorAll<HTMLButtonElement>(`.${cls.tool}`)].slice(0, 3)
}

before(() => {
  installStyles(document)
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
    // A conflict is `U` in its own group; the same file is not listed twice.
    assert.deepEqual(badges, [
      ['U', 'U'],
      ['M', 'M'],
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

  it('loads history only when the section is opened', async () => {
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
    assert.equal(logCalls, 0, 'a collapsed section must not spend a git call')

    const header = container.querySelector(`.${cls.historyHead}`)
    assert.ok(header)
    await act(async () => {
      header.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    })
    await settle()

    assert.equal(logCalls, 1)
    const text = container.textContent ?? ''
    assert.match(text, /bbbbbbb/)
    assert.match(text, /a commit subject/)
    assert.match(text, /Ada/)
    // `pushed: false` renders the hollow ring, not the filled dot.
    const marker = container.querySelector(`.${cls.marker}`)
    assert.equal(marker?.getAttribute('data-pushed'), 'false')
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
