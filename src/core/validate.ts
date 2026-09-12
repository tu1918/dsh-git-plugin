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
 * operation that needs them lands (see D7). M4 brought the branch name for
 * `checkout`/`createBranch`/`deleteBranch`, the base for a new branch, and the
 * commit hash for `showCommit`; M5a's `undoCommit` reuses that hash validator,
 * and M5a's stash reuses it again (an entry is addressed by its commit id) while
 * adding {@link validateStashMessage}, whose "no message" case is a legal answer
 * rather than a rejection.
 *
 * @module dsh-git-panel/core/validate
 */

import type { Result } from './ports.ts'
import { originOf } from './remote-origin.ts'

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
 * Characters no git ref may contain (§5.5, and git's own `check-ref-format`).
 *
 * Space and `~^:?*[\` are git's, not the doc's; they are here because every one
 * of them makes the name a ref git cannot resolve, and passing it through would
 * only move the refusal to a git process that has to be spawned first.
 */
const REF_FORBIDDEN = /[\u0000-\u001f\u007f ~^:?*[\\]/u

/**
 * Validate a branch name (§5.5, FR-4.1–4.3).
 *
 * The doc forbids `..`, `:` and control characters and a leading `-`; the rest
 * is git's own grammar, applied for the same reason the `--` separator exists:
 * the name is handed to git as an argument, so it must not be able to be
 * anything else.
 * @param name - Whatever the request carried for the branch name.
 * @returns The accepted name, or the reason to refuse it.
 */
export function validateBranchName(name: unknown): Result<string> {
  if (typeof name !== 'string' || name === '') {
    return reject('a branch name is required')
  }
  if (name.length > 255) {
    return reject('the branch name is too long')
  }
  if (name.startsWith('-')) {
    return reject('a branch name may not start with a dash')
  }
  if (name === '@' || name.includes('..') || name.includes('@{')) {
    return reject(`a branch name may not contain "@{" or "..": ${name}`)
  }
  if (REF_FORBIDDEN.test(name)) {
    return reject(`a branch name may not contain spaces or any of ~^:?*[\\: ${name}`)
  }
  if (name.startsWith('/') || name.endsWith('/') || name.includes('//')) {
    return reject(`a branch name may not begin or end with a slash, or contain "//": ${name}`)
  }
  if (name.endsWith('.') || name.endsWith('.lock')) {
    return reject(`a branch name may not end with "." or ".lock": ${name}`)
  }
  // A name of only dots or a leading dot-segment is not a ref git will resolve.
  if (name.split('/').some((segment) => segment.startsWith('.'))) {
    return reject(`a branch name may not have a path segment starting with ".": ${name}`)
  }
  return { ok: true, value: name }
}

/**
 * Validate a commit hash (§5.5).
 *
 * The doc's shape, verbatim: lowercase hex, four to forty characters. A hash
 * reaches git only as a revision, so the shape is the whole defence — there is
 * no `--` that could make `HEAD~1` or `--upload-pack=…` inert here.
 * @param hash - Whatever the request carried for the hash.
 * @returns The accepted hash, or the reason to refuse it.
 */
export function validateHash(hash: unknown): Result<string> {
  if (typeof hash !== 'string' || hash === '') {
    return reject('a commit hash is required')
  }
  if (!/^[0-9a-f]{4,40}$/u.test(hash)) {
    return reject(`a commit hash must be 4 to 40 lowercase hex characters: ${hash}`)
  }
  return { ok: true, value: hash }
}

/**
 * Longest stash message accepted, in UTF-16 code units.
 *
 * A stash message is a one-line label on a stack entry, not a document: git keeps
 * it in the stash commit's subject, and a kilobyte is already past what a list row
 * can show. It is bounded at all because the wire body is (1 MiB), and a message
 * that size would land in the reflog of every entry it accompanies.
 */
const MAX_STASH_MESSAGE_LENGTH = 4 * 1024

/**
 * Validate the optional message of `git stash push` (FR-6.2).
 *
 * Absent, `null`, and blank all mean the same thing — stash without a message —
 * and come back as `null` rather than as a rejection: the panel offers a message
 * box, and leaving it empty is a choice, not a malformed request. Anything
 * present must still be a string of a sane length with no NUL, for the reason
 * every other validator here exists (§5.5): it reaches git as an argument.
 * @param message - Whatever the request carried for `message`.
 * @returns The accepted message or `null` for "none", or the reason to refuse.
 */
export function validateStashMessage(message: unknown): Result<string | null> {
  if (message === undefined || message === null) return { ok: true, value: null }
  if (typeof message !== 'string') {
    return reject('a stash message must be a string when it is given')
  }
  if (message.includes('\u0000')) {
    return reject('a stash message may not contain a NUL character')
  }
  if (message.trim() === '') return { ok: true, value: null }
  if (message.length > MAX_STASH_MESSAGE_LENGTH) {
    return reject('the stash message is too long')
  }
  // Returned as sent, not trimmed, for the same reason `validateMessage` is: git
  // does its own cleanup, and rewriting the text here would be this plugin
  // editing what the user typed.
  return { ok: true, value: message }
}

/**
 * Validate what a new branch should start from (FR-4.2).
 *
 * Two shapes, both of which the picker offers: an existing local branch name, or
 * a commit hash. Deliberately not "any revision expression" — `HEAD~1` and
 * `origin/main^{commit}` would each need git to interpret an expression, and the
 * doc's §5.5 rule is that the browser sends *intent*, not git syntax.
 * @param base - Whatever the request carried for the base.
 * @returns The accepted base, or the reason to refuse it.
 */
export function validateBranchBase(base: unknown): Result<string> {
  if (typeof base !== 'string' || base === '') {
    return reject('a base branch or commit is required')
  }
  const asHash = validateHash(base)
  if (asHash.ok) return asHash
  return validateBranchName(base)
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

/**
 * Longest username or password accepted, in UTF-16 code units.
 *
 * The wire body is already capped at 1 MiB, so this only stops one field from
 * being a document. Both are returned exactly as sent — a token is not a phrase
 * to be tidied, and whitespace can be meaningful in one.
 */
const MAX_CREDENTIAL_LENGTH = 4 * 1024

/** A credential for one remote origin, after validation. */
export interface GitCredentialInput {
  /** The origin the credential belongs to, exactly as git names it. */
  readonly origin: string
  /** The user name to send. */
  readonly username: string
  /** The password or personal access token. */
  readonly password: string
}

/**
 * Validate one field of a credential.
 * @param value - Whatever the request carried.
 * @param label - Field name, for the rejection sentence.
 * @returns The accepted value, or the reason to refuse.
 */
function credentialField(value: unknown, label: string): Result<string> {
  if (typeof value !== 'string' || value === '') {
    return reject(`the ${label} is required`)
  }
  if (value.includes('\u0000')) {
    return reject(`the ${label} may not contain a NUL character`)
  }
  if (value.length > MAX_CREDENTIAL_LENGTH) {
    return reject(`the ${label} is too long`)
  }
  return { ok: true, value }
}

/**
 * Validate a credential a user typed for an HTTPS remote.
 *
 * The remote must be a bare HTTP(S) origin — the same string git puts in its
 * prompt and the same one this plugin addresses the record by, so nothing here
 * has to interpret a path. Whether that origin is one of the repository's own
 * remotes is a separate question the host answers, because it needs the
 * repository (§5.5's "the host re-checks").
 * @param remote - Whatever the request carried for `remote`.
 * @param username - Whatever the request carried for `username`.
 * @param password - Whatever the request carried for `password`.
 * @returns The accepted credential, or the reason to refuse it.
 */
export function validateCredential(
  remote: unknown,
  username: unknown,
  password: unknown,
): Result<GitCredentialInput> {
  if (typeof remote !== 'string' || remote === '') {
    return reject('the remote origin is required')
  }
  if (originOf(remote) !== remote) {
    return reject(`the remote must be an HTTP(S) origin, such as https://host: ${remote}`)
  }
  const acceptedUser = credentialField(username, 'username')
  if (!acceptedUser.ok) return acceptedUser
  const acceptedPassword = credentialField(password, 'password')
  if (!acceptedPassword.ok) return acceptedPassword
  return {
    ok: true,
    value: { origin: remote, username: acceptedUser.value, password: acceptedPassword.value },
  }
}
