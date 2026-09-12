/**
 * Addressing an HTTPS credential by the origin it belongs to.
 *
 * git asks for credentials with the remote's **origin** in the prompt — probed:
 * a remote of `http://127.0.0.1:34567/repo.git` produces
 * `Username for 'http://127.0.0.1:34567'`, path and all. That is the finest
 * granularity git's prompt carries, so it is also the key this plugin stores
 * under: two repositories on one host share one credential, which is how a
 * personal access token normally works anyway.
 *
 * Everything here is a pure function so it can be tested in a bare Node process
 * and reused by the host's credential adapter without dragging a DSH name in.
 *
 * @module dsh-git-panel/core/remote-origin
 */

/** Longest id this module will emit, so one absurd host cannot bloat a key. */
const ID_MAX_LENGTH = 48

/** Every character outside git's key grammar becomes a separator. */
function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
}

/**
 * A 32-bit FNV-1a digest, as eight lowercase hex digits.
 *
 * Hand-rolled rather than `node:crypto` because this module is part of core,
 * which may not import Node built-ins. It only has to decorrelate ids, not to
 * resist an attacker.
 * @param text - Text to digest.
 * @returns Eight lowercase hex characters.
 */
function digest(text: string): string {
  let value = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index)
    value = Math.imul(value, 0x01000193) >>> 0
  }
  return value.toString(16).padStart(8, '0')
}

/**
 * The origin of an HTTP(S) remote URL, or `null` for anything else.
 *
 * `null` covers SSH and `git://` remotes (which authenticate with a key or not
 * at all, never with a stored username and password), and a URL this parser
 * cannot read. Callers treat `null` as "no credential applies here".
 * @param remoteUrl - A remote's configured URL.
 * @returns `scheme://host[:port]`, or `null`.
 */
export function originOf(remoteUrl: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(remoteUrl)
  } catch {
    return null
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
  // `.origin` is already the shape git's prompt uses: no path, no trailing
  // slash, userinfo dropped, and a default port omitted.
  return parsed.origin
}

/**
 * The id segment of the credential record for one origin.
 *
 * The grammar for a record key segment is `^[a-z][a-z0-9-]*$`, which a URL can
 * never satisfy, so the origin is slugged for readability (`codeup-aliyun-com`)
 * and suffixed with a digest for uniqueness. The `r-` prefix both guarantees a
 * leading letter and marks the id as a remote's.
 * @param origin - An origin as {@link originOf} returns it.
 * @returns A legal, stable record id.
 */
export function credentialRecordId(origin: string): string {
  const tail = digest(origin)
  const room = ID_MAX_LENGTH - 'r-'.length - '-'.length - tail.length
  const head = slug(origin).slice(0, Math.max(room, 0))
  return head === '' ? `r-${tail}` : `r-${head}-${tail}`
}
