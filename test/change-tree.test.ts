/**
 * The change list as a file tree (FR-1.3), tested as the pure function it is.
 *
 * The interesting properties here are the ones a reader would notice: which
 * entries exist, how deep they sit, what each directory is called, what it
 * counts, and in what order. None of that needs a DOM — the components only draw
 * what this returns.
 *
 * @module dsh-git-panel/test/change-tree
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { changeTreeOf, filesUnder, type ChangeTreeNode } from '../src/core/change-tree.ts'
import type { ChangeArea, FileChange } from '../src/core/types.ts'
import { badgeFor } from '../src/core/git-parse.ts'

/** One changed file, as `git status` would have reported it. */
function change(path: string, overrides: Partial<FileChange> = {}): FileChange {
  return {
    path,
    index: '.',
    worktree: 'M',
    staged: false,
    untracked: false,
    conflicted: false,
    ...overrides,
  }
}

/** Every file node in the tree, in draw order. */
function flatten(nodes: readonly ChangeTreeNode[]): readonly Extract<ChangeTreeNode, { kind: 'file' }>[] {
  return nodes.flatMap((node) => (node.kind === 'file' ? [node] : flatten(node.children)))
}

/** Every path in the tree, files and directories alike, in draw order. */
function pathsOf(nodes: readonly ChangeTreeNode[]): string[] {
  return nodes.flatMap((node) =>
    node.kind === 'file' ? [node.entry.path] : [node.path, ...pathsOf(node.children)],
  )
}

describe('changeTreeOf (FR-1.3)', () => {
  it('nests files under their directories and keeps the entry itself', () => {
    const entry = change('src/core/git-parse.ts')
    const tree = changeTreeOf([entry])

    assert.equal(tree.length, 1)
    const dir = tree[0]
    assert.ok(dir?.kind === 'dir')
    assert.equal(dir.path, 'src/core')
    // The chain `src` → `core` had no other children, so it is one row.
    assert.equal(dir.label, 'src/core')
    assert.equal(dir.count, 1)
    const file = dir.children[0]
    assert.ok(file?.kind === 'file')
    // The entry is handed through untouched: the row opens a diff for exactly
    // what git reported, badges included.
    assert.equal(file.entry, entry)
    assert.equal(file.name, 'git-parse.ts')
    assert.equal(badgeFor(file.entry, 'unstaged' satisfies ChangeArea), 'M')
  })

  it('stops compacting where a directory has a file of its own', () => {
    // `src` holds a changed file, so its own row is something that can be
    // folded; merging it into `src/core` would hide that fact.
    const tree = changeTreeOf([change('src/a.ts'), change('src/core/b.ts')])
    // Directories first, then files: `core` is the first child of `src`, and
    // `src` keeps its own row precisely because `a.ts` is in it.
    assert.deepEqual(pathsOf(tree), ['src', 'src/core', 'src/core/b.ts', 'src/a.ts'])
    const src = tree[0]
    assert.ok(src?.kind === 'dir')
    assert.equal(src.label, 'src')
    assert.equal(src.count, 2)
  })

  it('puts a bare file at the top level, with no directory invented for it', () => {
    const tree = changeTreeOf([change('README.md')])
    assert.deepEqual(pathsOf(tree), ['README.md'])
    assert.equal(tree[0]?.kind, 'file')
  })

  it('sorts directories before files, each in git’s own byte order', () => {
    const tree = changeTreeOf([
      change('z.txt'),
      change('a.txt'),
      change('src/m.ts'),
      change('docs/n.md'),
      change('B.txt'),
    ])
    // Byte order, not a locale's: `B` before `a`, and the two directories ahead
    // of every file. The same repository must list the same way on any machine.
    assert.deepEqual(pathsOf(tree), ['docs', 'docs/n.md', 'src', 'src/m.ts', 'B.txt', 'a.txt', 'z.txt'])
  })

  it('counts every file at every depth under a directory', () => {
    const tree = changeTreeOf([
      change('src/a.ts'),
      change('src/deep/b.ts'),
      change('src/deep/deeper/c.ts'),
    ])
    const src = tree[0]
    assert.ok(src?.kind === 'dir')
    assert.equal(src.count, 3)
    const deep = src.children.find((node) => node.kind === 'dir')
    assert.ok(deep?.kind === 'dir')
    // `deep` holds a file of its own (`b.ts`), so it is not compacted away.
    assert.equal(deep.label, 'deep')
    assert.equal(deep.count, 2)
    const deeper = deep.children.find((node) => node.kind === 'dir')
    assert.ok(deeper?.kind === 'dir')
    assert.equal(deeper.label, 'deeper')
    assert.equal(deeper.count, 1)
  })

  it('builds one tree per group, so the same path can appear in two of them', () => {
    // FR-1.1: a file with a staged and an unstaged change is in two groups. Each
    // group is its own list, and this function never sees both at once.
    const staged = change('src/a.ts', { index: 'M', staged: true })
    const unstaged = change('src/a.ts')
    assert.deepEqual(pathsOf(changeTreeOf([staged])), ['src', 'src/a.ts'])
    assert.deepEqual(pathsOf(changeTreeOf([unstaged])), ['src', 'src/a.ts'])
  })

  it('never loses an entry, whatever shape its path has', () => {
    // A path ending in a separator is not something git reports, but whatever the
    // builder does with it, the entry itself must still be in the tree: a change
    // that cannot be staged or opened is worse than a row that reads oddly.
    const odd = change('odd/')
    const files = flatten(changeTreeOf([odd]))
    assert.equal(files.length, 1)
    assert.equal(files[0]?.entry, odd)
  })

  it('answers an empty tree for an empty group', () => {
    assert.deepEqual(changeTreeOf([]), [])
  })
})

describe('filesUnder', () => {
  it('collects every file below a directory, in draw order', () => {
    const tree = changeTreeOf([
      change('src/a.ts'),
      change('src/deep/b.ts'),
      change('src/deep/deeper/c.ts'),
      change('src/z.md'),
    ])
    const src = tree[0]
    assert.ok(src?.kind === 'dir')
    // Depth first, directories before files at each level: `deep`'s own dir
    // child `deeper` is drawn (and walked) before its file `b.ts`, exactly the
    // order the tree draws them.
    assert.deepEqual(
      filesUnder(src).map((entry) => entry.path),
      ['src/deep/deeper/c.ts', 'src/deep/b.ts', 'src/a.ts', 'src/z.md'],
    )
  })

  it('counts the files of a compacted chain under its merged row', () => {
    // The row says `src/core`, so its checkbox must select `src/core`'s files —
    // the chain is a drawing detail, not a selection boundary.
    const tree = changeTreeOf([change('src/core/git-parse.ts'), change('src/core/format.ts')])
    const dir = tree[0]
    assert.ok(dir?.kind === 'dir')
    assert.equal(dir.label, 'src/core')
    assert.equal(filesUnder(dir).length, 2)
  })

  it('collects across several subdirectories of one directory', () => {
    // A directory with two directory children is the one shape compaction
    // leaves behind; its checkbox selects both branches.
    const tree = changeTreeOf([change('a/x/c.ts'), change('a/y/d.ts')])
    const dir = tree[0]
    assert.ok(dir?.kind === 'dir')
    assert.equal(dir.label, 'a')
    assert.deepEqual(
      filesUnder(dir).map((entry) => entry.path),
      ['a/x/c.ts', 'a/y/d.ts'],
    )
  })
})
