/**
 * Real-repository helpers for the integration tests.
 *
 * These tests deliberately drive the actual `git` binary rather than feeding
 * fixtures: the parsers' whole job is to match git's real output, so a fixture
 * written from the same misunderstanding as the parser would pass while the
 * plugin stayed broken. Every temp repo is isolated from the developer's own
 * config ({@link ISOLATED_ENV}), so a global `core.autocrlf` or `commit.gpgsign`
 * cannot change what a test observes.
 *
 * @module dsh-git-panel/test/helpers/repo
 */

import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

/**
 * Environment for every git call in tests: no credential prompt (a test must
 * fail fast, never hang), and no user or system config, so the machine's own
 * git settings cannot leak into an expectation.
 */
const ISOLATED_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_TERMINAL_PROMPT: '0',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
  GIT_AUTHOR_NAME: 'Test Author',
  GIT_AUTHOR_EMAIL: 'author@example.com',
  GIT_COMMITTER_NAME: 'Test Committer',
  GIT_COMMITTER_EMAIL: 'committer@example.com',
}

/** Every directory a test created, removed together at the end. */
const created: string[] = []

/** One git call's outcome, with a non-zero exit captured rather than thrown. */
export interface GitOutcome {
  /** Exit code; `null` when the process was killed by a signal. */
  readonly code: number | null
  /** Standard output. */
  readonly stdout: string
  /** Standard error. */
  readonly stderr: string
}

/**
 * Run `git` in a directory and return its outcome, capturing failure.
 *
 * The throwing form below is for setup steps, where a failure means the test
 * itself is wrong; this one is for the assertions that are ABOUT failure.
 * @param cwd - Directory to run in.
 * @param args - Arguments after `git`.
 * @returns The outcome, whatever the exit code.
 */
export function gitTry(cwd: string, args: readonly string[]): GitOutcome {
  try {
    const stdout = execFileSync('git', [...args], {
      cwd,
      encoding: 'utf8',
      env: ISOLATED_ENV,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { code: 0, stdout, stderr: '' }
  } catch (error) {
    const failure = error as { status?: number | null; stdout?: string; stderr?: string }
    return {
      code: failure.status ?? null,
      stdout: failure.stdout ?? '',
      stderr: failure.stderr ?? '',
    }
  }
}

/**
 * Run `git` in a directory, requiring success.
 * @param cwd - Directory to run in.
 * @param args - Arguments after `git`.
 * @returns Standard output.
 * @throws When git exits non-zero; the message carries git's own stderr.
 */
export function git(cwd: string, args: readonly string[]): string {
  const outcome = gitTry(cwd, args)
  if (outcome.code !== 0) {
    throw new Error(`git ${args.join(' ')} failed (${outcome.code}):\n${outcome.stderr}`)
  }
  return outcome.stdout
}

/** Create one temp directory and register it for cleanup. */
function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), `dsh-git-panel-${prefix}-`))
  created.push(dir)
  return dir
}

/** Write a file inside a repo, creating parent directories. */
export function write(repo: string, path: string, contents: string): void {
  const absolute = join(repo, path)
  const parent = dirname(absolute)
  if (parent !== '') mkdirSync(parent, { recursive: true })
  writeFileSync(absolute, contents, 'utf8')
}

/** Stage everything. */
export function stageAll(repo: string): void {
  git(repo, ['add', '-A'])
}

/**
 * Commit the index with a fixed identity, ignoring any signing config.
 * @param repo - Repository directory.
 * @param message - Commit subject.
 */
export function commit(repo: string, message: string): void {
  git(repo, ['commit', '-q', '--no-gpg-sign', '-m', message])
}

/**
 * Create an initialised repository with a deterministic identity and no
 * line-ending translation, so `status` reports exactly what the test wrote.
 * @param prefix - Short label used in the temp directory's name.
 * @returns The repository's absolute path.
 */
export function makeRepo(prefix = 'repo'): string {
  const repo = tempDir(prefix)
  git(repo, ['init', '-q'])
  git(repo, ['config', 'user.email', 'test@example.com'])
  git(repo, ['config', 'user.name', 'Test User'])
  git(repo, ['config', 'core.autocrlf', 'false'])
  git(repo, ['config', 'commit.gpgsign', 'false'])
  return repo
}

/**
 * Create a temp directory that is NOT inside any git repository.
 *
 * Distinct from {@link makeRepo} on purpose: a subdirectory of a repository is
 * still IN that repository, so a test for the "not a repository" state needs a
 * directory git cannot resolve a work tree for at all.
 * @param prefix - Short label used in the temp directory's name.
 * @returns The directory's absolute path.
 */
export function makePlainDir(prefix = 'plain'): string {
  return tempDir(prefix)
}

/**
 * Create a bare repository usable as a push target over the file transport.
 * @param prefix - Short label used in the temp directory's name.
 * @returns The bare repository's absolute path.
 */
export function makeBareRemote(prefix = 'remote'): string {
  const remote = tempDir(prefix)
  git(remote, ['init', '--bare', '-q'])
  return remote
}

/**
 * The branch HEAD currently points at.
 * @param repo - Repository directory.
 * @returns The short branch name.
 */
export function currentBranch(repo: string): string {
  return git(repo, ['symbolic-ref', '--short', 'HEAD']).trim()
}

/**
 * Run the exact status command the plugin runs and return its raw output.
 *
 * Kept beside the helpers so a test cannot accidentally assert against a
 * differently-shaped invocation than the host uses.
 * @param repo - Repository directory.
 * @returns Raw `--porcelain=v2 --branch -z` stdout.
 */
export function rawStatus(repo: string): string {
  return git(repo, ['status', '--porcelain=v2', '--branch', '-z'])
}

/** Remove every directory these helpers created. */
export function cleanupRepos(): void {
  for (const dir of created.splice(0, created.length)) {
    rmSync(dir, { recursive: true, force: true })
  }
}
