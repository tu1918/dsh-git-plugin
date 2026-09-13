/**
 * The sequence editor: how a rewrite edits an interactive rebase's todo list.
 *
 * `git rebase -i` is the only way to fold one commit into its parent or remove
 * it without hand-rebuilding the branch, and it insists on asking an editor what
 * to do with the todo list. There is no terminal here, so this module writes a
 * static helper and names it in `GIT_SEQUENCE_EDITOR`; the rewrite's intent
 * travels in the environment, exactly as the askpass helper's does (see
 * `host/askpass.ts`).
 *
 * Two deliberate properties:
 *
 * - **The helper holds no intent.** It reads `GIT_PANEL_SEQUENCE`, a JSON
 *   `{target, previous, action}`, and the todo path git appends to its argv. The
 *   same file serves every rewrite in the process.
 * - **It refuses rather than guesses.** If the target line is not in the todo,
 *   or (for a fold) it does not immediately follow the commit it must fold into,
 *   the helper exits non-zero — git then aborts the rebase and the repository is
 *   left exactly as it was. A silently un-rewritten todo would run a rebase that
 *   does something other than what the user asked for, which is worse than
 *   failing.
 *
 * @module dsh-git-panel/host/sequence-editor
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { GitEditorControl } from '../core/ports.ts'

/** What one rewrite wants done to one line of the todo list. */
export interface SequenceSpec {
  /** Full object id of the commit whose line is being changed. */
  readonly target: string
  /**
   * The commit the target must immediately follow, or `null` when order does
   * not matter (`drop`). git's `fixup` folds into the PREVIOUS line, so this is
   * the assertion that keeps a fold from landing in the wrong commit.
   */
  readonly previous: string | null
  /** The action the target's line should carry. */
  readonly action: 'fixup' | 'drop'
}

/**
 * The helper's program text, with no shebang so Windows can wrap it too.
 *
 * Comments and blank lines in git's todo are skipped when looking for the
 * preceding commit, and a line's hash is matched by prefix because git writes
 * abbreviated ids into the todo.
 */
function helperSource(): string {
  return [
    '// dsh-git-panel sequence editor; see src/host/sequence-editor.ts.',
    "import { readFileSync, writeFileSync } from 'node:fs'",
    '',
    "const spec = JSON.parse(process.env.GIT_PANEL_SEQUENCE ?? '{}')",
    'const path = process.argv[2]',
    "if (typeof path !== 'string' || path === '') {",
    "  process.stderr.write('dsh-git-panel: the sequence editor received no todo path\\n')",
    '  process.exit(1)',
    '}',
    '',
    "const lines = readFileSync(path, 'utf8').split('\\n')",
    "const isComment = (line) => line.trim() === '' || line.trimStart().startsWith('#')",
    'const fieldsOf = (line) => line.trim().split(/\\s+/u)',
    'const names = (line, oid) => {',
    '  const hash = fieldsOf(line)[1] ?? \'\'',
    "  return /^[0-9a-f]+$/u.test(hash) && oid.startsWith(hash)",
    '}',
    '',
    'const targetIndex = lines.findIndex((line) => !isComment(line) && names(line, spec.target))',
    'if (targetIndex === -1) {',
    "  process.stderr.write('dsh-git-panel: the commit to rewrite is not in the rebase todo\\n')",
    '  process.exit(1)',
    '}',
    '',
    'if (spec.previous !== null) {',
    '  let before = targetIndex - 1',
    '  while (before >= 0 && isComment(lines[before])) before -= 1',
    '  if (before < 0 || !names(lines[before], spec.previous)) {',
    "    process.stderr.write('dsh-git-panel: the commit to rewrite does not follow its parent in the rebase todo\\n')",
    '    process.exit(1)',
    '  }',
    '}',
    '',
    'const fields = fieldsOf(lines[targetIndex])',
    'fields[0] = spec.action',
    "lines[targetIndex] = fields.join(' ')",
    "writeFileSync(path, lines.join('\\n'))",
    '',
  ].join('\n')
}

/** Resolved once per process; the file is static, so one copy serves every rewrite. */
let helper: Promise<string> | null = null

/**
 * Write the helper into a private temporary directory and return its path.
 *
 * POSIX gets an executable script with a shebang; Windows cannot run one, so it
 * gets a `.cmd` wrapper that forwards git's argument to the same JavaScript.
 * @returns Absolute path git should run as its sequence editor.
 */
function ensureHelper(): Promise<string> {
  if (helper === null) {
    helper = (async () => {
      const directory = await mkdtemp(join(tmpdir(), 'dsh-git-panel-sequence-'))
      const script = join(directory, 'sequence.mjs')
      if (process.platform === 'win32') {
        const wrapper = join(directory, 'sequence.cmd')
        await writeFile(script, helperSource())
        await writeFile(wrapper, `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`)
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
 * Build the editor control for one rewrite.
 * @param spec - Which line to change, and how.
 * @returns The `GitRunOptions.editor` value for the rebase call.
 */
export async function buildSequenceEditor(spec: SequenceSpec): Promise<GitEditorControl> {
  return { sequence: await ensureHelper(), spec: JSON.stringify(spec) }
}
