/**
 * Pure argument validation: the shapes a browser may put on the wire (§5.5).
 *
 * The doc's rule is that the browser sends only *relative* paths and *intent* —
 * never an absolute path, never a traversal, never anything `git` would have to
 * interpret. The `--` separator in every invocation already stops an argument
 * from being read as an option; this module stops the argument from being
 * something the panel should not name at all.
 *
 * It lives in `core/` for the reason the layer exists: these are ordinary pure
 * functions, so a test can enumerate every shape the doc forbids without a host,
 * a repository, or a socket. The host calls them before it builds an argument
 * list, which is the only place they have to hold.
 *
 * Later milestones' parameters arrive with their own validators, added when the
 * operation that needs them lands — a branch name for `createBranch`, a hash for
 * `undoCommit`. Writing them now would be code with no caller (see D7).
 *
 * @module dsh-git-panel/core/validate
 */

import type { Result } from './ports.ts'

/** Longest commit message accepted, in UTF-16 code units. */
const MAX_MESSAGE_LENGTH = 64 * 1024

/**
 * Build one rejection, in the panel's own failure vocabulary.
 * @param message - What was wrong, addressed to whoever sent it.
 * @returns The failure result every validator returns.
 */
function reject(message: string): Result<never> {
  return { ok: false, error: { code: 'bad-request', message } }
}

/**
 * Whether a path is absolute on any platform this ships on.
 *
 * A POSIX `/`, a Windows drive (`C:\` or `C:/`), and a leading backslash all
 * count: this validator runs on the host, and the string it is judging came from
 * a browser that could be running anywhere.
 * @param path - The path to classify.
 * @returns Whether the path is absolute.
 */
function isAbsolutePath(path: string): boolean {
  return path.startsWith('/') || path.startsWith('\\') || /^[A-Za-z]:[\\/]/u.test(path)
}

/**
 * Validate the paths of one staging operation.
 *
 * The rules are the doc's (§5.5) plus one of this plugin's own: no path may lead
 * into a `.git` directory. `git status` never reports such a path, so the rule
 * can only be reached by a hand-written request — which is exactly the request it
 * exists to refuse, since the index, the config, and the hooks all live there.
 * @param paths - Whatever the request carried for `paths`.
 * @returns The accepted paths, or the first reason to refuse.
 */
export function validatePaths(paths: unknown): Result<readonly string[]> {
  if (!Array.isArray(paths) || paths.length === 0) {
    return reject('at least one path is required')
  }
  const accepted: string[] = []
  for (const entry of paths) {
    if (typeof entry !== 'string' || entry === '') {
      return reject('every path must be a non-empty string')
    }
    if (entry.includes('\u0000')) {
      return reject('a path may not contain a NUL character')
    }
    if (isAbsolutePath(entry)) {
      return reject(`a path must be relative to the repository: ${entry}`)
    }
    // Both separators are split on: a Windows-shaped `..\` is as much a
    // traversal as `../`, and git accepts either spelling on Windows.
    const segments = entry.split(/[\\/]/u)
    if (segments.includes('..')) {
      return reject(`a path may not traverse upward: ${entry}`)
    }
    if (segments.includes('.git')) {
      return reject(`the .git directory is not the panel's to touch: ${entry}`)
    }
    accepted.push(entry)
  }
  return { ok: true, value: accepted }
}

/**
 * Validate a commit message.
 *
 * The message is returned **as sent**, not trimmed: git's own cleanup strips the
 * blank lines a user left, and rewriting the text here would be this plugin
 * editing what the user wrote. Trimming is only how "is it empty" is decided.
 * @param message - Whatever the request carried for `message`.
 * @returns The accepted message, or the reason to refuse it.
 */
export function validateMessage(message: unknown): Result<string> {
  if (typeof message !== 'string') {
    return reject('a commit message is required')
  }
  if (message.includes('\u0000')) {
    return reject('a commit message may not contain a NUL character')
  }
  // git aborts on an empty message; the panel says so before spending a process
  // on it, so the answer comes back as a sentence rather than as git's exit code.
  if (message.trim() === '') {
    return reject('a commit message may not be empty')
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    return reject('the commit message is too long')
  }
  return { ok: true, value: message }
}
