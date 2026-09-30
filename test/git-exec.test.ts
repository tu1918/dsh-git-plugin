/**
 * The process seam's own tests: what happens when git will not leave.
 *
 * Every other host test drives the real `git`, which is the right way to test
 * parsers and services — and the wrong way to test a deadline, because a real
 * git exits when it is asked to. These tests put a stand-in `git` first on PATH
 * instead: one that ignores SIGTERM, one that leaves a helper holding its pipes,
 * and so on. They exist because the plugin shipped with a spinner that never
 * stopped (F-1): `execFile`'s timeout sent SIGTERM and settled on `close`, and
 * neither survives contact with a process that does not cooperate.
 *
 * What is pinned here:
 *
 * - a call that outlives its deadline settles anyway, and says `timedOut`;
 * - a process that leaves a child holding the pipe settles on the process ENDING
 *   rather than on the pipes closing;
 * - the output cap cuts what is kept and reports `truncated`, without turning
 *   into a timeout;
 * - a missing binary is still its own outcome, and an ordinary non-zero exit is
 *   still an ordinary non-zero exit.
 *
 * @module dsh-git-panel/test/git-exec
 */

import { chmodSync } from 'node:fs'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { createGitRunner } from '../src/host/git-exec.ts'
import { cleanupRepos, makePlainDir, write } from './helpers/repo.ts'

after(cleanupRepos)

/** The runner under test; it holds no state between calls. */
const runner = createGitRunner()

/**
 * Put a stand-in `git` first on PATH for the duration of `body`.
 *
 * PATH is read when the child environment is built, so this is what makes the
 * runner spawn the script instead of the real git. Restored in `finally` so a
 * failed assertion cannot leak the stand-in into the next test.
 * @param script - The shell script to install as `git`.
 * @param body - Receives a directory to run in.
 */
async function withFakeGit(
  script: string,
  body: (cwd: string) => Promise<void>,
): Promise<void> {
  const bin = makePlainDir('fake-git-bin')
  const cwd = makePlainDir('fake-git-cwd')
  write(bin, 'git', script)
  chmodSync(join(bin, 'git'), 0o755)
  const previous = process.env.PATH
  process.env.PATH = `${bin}:${previous ?? ''}`
  try {
    await body(cwd)
  } finally {
    process.env.PATH = previous
  }
}

describe('the git runner', () => {
  it('returns stdout and the exit code for a command that behaves', async () => {
    await withFakeGit('#!/bin/sh\necho one\nexit 0\n', async (cwd) => {
      const result = await runner.run(['status'], { cwd, timeoutMs: 5_000 })
      assert.deepEqual(result, {
        code: 0,
        stdout: 'one\n',
        stderr: '',
        timedOut: false,
        truncated: false,
        spawnFailed: false,
      })
    })
  })

  it('reports an ordinary non-zero exit as one', async () => {
    await withFakeGit('#!/bin/sh\necho bad 1>&2\nexit 3\n', async (cwd) => {
      const result = await runner.run(['diff'], { cwd, timeoutMs: 5_000 })
      assert.equal(result.code, 3)
      assert.equal(result.stderr, 'bad\n')
      assert.equal(result.timedOut, false)
      assert.equal(result.truncated, false)
      assert.equal(result.spawnFailed, false)
    })
  })

  it('reports a missing binary rather than an exit', async () => {
    const empty = makePlainDir('empty-path')
    const cwd = makePlainDir('no-git-cwd')
    const previous = process.env.PATH
    process.env.PATH = empty
    try {
      const result = await runner.run(['status'], { cwd, timeoutMs: 5_000 })
      assert.equal(result.spawnFailed, true)
      assert.equal(result.code, null)
    } finally {
      process.env.PATH = previous
    }
  })

  it('settles past the deadline even when the child ignores SIGTERM', async () => {
    // The reported failure (F-1) in one script: `trap '' TERM` is a git helper
    // that will not take the polite signal, and the `sleep` is a grandchild that
    // keeps the stdout pipe open after its parent dies — both of the ways the
    // old `execFile` call could stay pending forever.
    await withFakeGit("#!/bin/sh\ntrap '' TERM\nsleep 30\n", async (cwd) => {
      const started = Date.now()
      const result = await runner.run(['fetch'], { cwd, timeoutMs: 200 })
      const elapsed = Date.now() - started

      assert.equal(result.timedOut, true, 'the deadline is what ended this call')
      assert.equal(result.code, null, 'killed rather than exited')
      // SIGTERM is ignored, so SIGKILL (after the grace) is what ends it, plus
      // the pipe-drain grace the surviving `sleep` makes necessary. Anything
      // near the stand-in's own 30s means the escalation never happened.
      assert.ok(elapsed < 6_000, `expected a bounded wait, took ${elapsed}ms`)
    })
  })

  it('does not wait for a helper that outlives the process it came from', async () => {
    // A parent that exits at once but leaves a child holding the write end: the
    // `close` event never comes while that child lives, so a runner that waits
    // for it waits for the helper (the `git-remote-*` case). The result must be
    // the parent's, one drain grace after the parent ended.
    await withFakeGit('#!/bin/sh\necho done\nsleep 30 &\nexit 0\n', async (cwd) => {
      const started = Date.now()
      const result = await runner.run(['fetch'], { cwd, timeoutMs: 10_000 })
      const elapsed = Date.now() - started

      assert.equal(result.code, 0)
      assert.equal(result.stdout, 'done\n')
      assert.equal(result.timedOut, false)
      assert.ok(elapsed < 3_000, `expected the parent's own exit to be enough, took ${elapsed}ms`)
    })
  })

  it('cuts output at the cap and says so rather than calling it a timeout', async () => {
    await withFakeGit(
      "#!/bin/sh\ni=0\nwhile [ $i -lt 5000 ]; do printf 'aaaaaaaaaa'; i=$((i+1)); done\n",
      async (cwd) => {
        const result = await runner.run(['status'], { cwd, timeoutMs: 10_000, maxStdoutBytes: 1_000 })
        assert.equal(result.truncated, true)
        assert.equal(result.timedOut, false, 'a cut at the cap is not a deadline')
        assert.ok(result.stdout.length <= 1_000, `kept ${result.stdout.length} characters`)
      },
    )
  })
})
