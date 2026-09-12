/**
 * The askpass helper: how a stored credential reaches a non-interactive git.
 *
 * git refuses to prompt when `GIT_TERMINAL_PROMPT=0` (the plugin sets it so a
 * request can never hang on a terminal nobody can see), but it still asks a
 * program named by `GIT_ASKPASS` for the two answers. Probed against a local
 * server demanding Basic auth: with the variable set and this helper on the
 * other end, git asks twice (`Username for 'http://host:port'`,
 * `Password for user@…`) and proceeds.
 *
 * Two deliberate properties:
 *
 * - **The script holds no secret.** It is static per process and reads its
 *   answers from `GIT_PANEL_CREDENTIALS`, a JSON map of origin to credential.
 *   Only the child process environment carries values, which is the discipline
 *   the askpass protocol is built around.
 * - **Only the origin is matched.** git's prompt names the origin and nothing
 *   finer (`…/repo.git` prints as `https://host`), so a map keyed by anything
 *   narrower could never be matched. The lookup parses the URL out of the
 *   prompt rather than scanning for a substring, so a URL carrying a user name
 *   (`https://user@host`) still resolves to the same origin.
 *
 * @module dsh-git-panel/host/askpass
 */

import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { GitAskPass, GitCredential } from '../core/ports.ts'

/**
 * The helper's program text, with no shebang so Windows can wrap it too.
 *
 * Answers one prompt on stdout, with git stripping the trailing newline.
 * Anything it cannot answer prints an empty line, which git treats as the same
 * "no credential" it would have had without the helper.
 */
function helperSource(): string {
  return [
    '// dsh-git-panel askpass helper; see src/host/askpass.ts.',
    "const map = JSON.parse(process.env.GIT_PANEL_CREDENTIALS ?? '{}')",
    "const prompt = process.argv[2] ?? ''",
    "let origin = ''",
    "const quoted = /'([^']+)'/.exec(prompt)",
    'if (quoted !== null) {',
    '  try { origin = new URL(quoted[1]).origin } catch { origin = \'\' }',
    '}',
    'let credential = origin === \'\' ? undefined : map[origin]',
    'if (credential === undefined) {',
    '  for (const [key, value] of Object.entries(map)) {',
    '    if (prompt.includes(key)) { credential = value; break }',
    '  }',
    '}',
    'if (credential === undefined) {',
    "  process.stdout.write('\\n')",
    '  process.exit(0)',
    '}',
    'const answer = /^Username/i.test(prompt) ? credential.username : credential.password',
    "process.stdout.write(String(answer) + '\\n')",
    '',
  ].join('\n')
}

/** Resolved once per process; the file is static, so one copy serves every call. */
let helper: Promise<string> | null = null

/**
 * Write the helper into a private temporary directory and return its path.
 *
 * POSIX gets an executable script with a shebang; Windows cannot run one, so it
 * gets a `.cmd` wrapper that passes the prompt through to the same JavaScript.
 * @returns Absolute path git should run.
 */
function ensureHelper(): Promise<string> {
  if (helper === null) {
    helper = (async () => {
      const directory = await mkdtemp(join(tmpdir(), 'dsh-git-panel-askpass-'))
      const script = join(directory, 'askpass.mjs')
      if (process.platform === 'win32') {
        const wrapper = join(directory, 'askpass.cmd')
        await writeFile(script, helperSource())
        await writeFile(wrapper, `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`)
        // The directory is 0700 and the script holds no secret, but it should
        // not outlive the process either.
        process.once('exit', () => {
          void rm(directory, { recursive: true, force: true })
        })
        return wrapper
      }
      await writeFile(script, `#!${process.execPath}\n${helperSource()}`, { mode: 0o755 })
      process.once('exit', () => {
        void rm(directory, { recursive: true, force: true })
      })
      return script
    })()
  }
  return helper
}

/**
 * Build the askpass payload for one git call, or `undefined` when nothing applies.
 *
 * @param credentials - Stored credentials, keyed by origin.
 * @returns The helper path and the JSON map, or `undefined` for an empty map —
 *   in which case git runs exactly as it did before this feature existed.
 */
export async function buildAskpass(
  credentials: ReadonlyMap<string, GitCredential>,
): Promise<GitAskPass | undefined> {
  if (credentials.size === 0) return undefined
  const map: Record<string, GitCredential> = {}
  for (const [origin, credential] of credentials) map[origin] = credential
  return { helper: await ensureHelper(), map: JSON.stringify(map) }
}
