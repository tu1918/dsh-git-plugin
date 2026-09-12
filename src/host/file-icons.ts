/**
 * The deployment's own file-type icons: one YAML file, read into SVGs.
 *
 * The panel ships nine built-in glyphs (`core/file-kind.ts` picks between them).
 * This is the way out of that set: a small YAML map — extension to icon file path
 * (`core/icon-config.ts` parses it) — whose SVGs the browser draws instead of the
 * built-in glyph for those extensions. The file is read on demand rather than at
 * mount, so editing it and reloading the panel is enough; nothing has to restart.
 *
 * Three rules shape what is served, because the browser is handed the bytes:
 *
 * 1. **Only the files the map names.** The browser never sends a path — it sends
 *    nothing but its session id — so there is no path to validate from the wire;
 *    what is validated is the map, which is the operator's own file.
 * 2. **Only things that look like SVG, and only up to a cap.** A 40 MiB "icon" is
 *    not an icon, and sending one to every panel would cost the GUI, not us.
 * 3. **A problem is a log line, never a failure.** A missing file, a refused path
 *    or a bad line leaves that extension on its built-in glyph; the panel keeps
 *    working, and the reason is in the host log where the operator can find it.
 *
 * @module dsh-git-panel/host/file-icons
 */

import { readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'

import { parseIconConfig } from '../core/icon-config.ts'
import type { HostPorts } from '../core/ports.ts'

/** One icon the browser may draw: the extension it replaces and its source. */
export interface FileIcon {
  /** Extension without its dot, lowercased. */
  readonly ext: string
  /** The SVG document's text, verbatim. */
  readonly svg: string
}

/** The icon map, as the route layer consumes it. */
export interface FileIconRegistry {
  /**
   * Read the map and every icon it names.
   * @returns The icons that could be used, in file order.
   */
  list(): Promise<readonly FileIcon[]>
}

/** Largest icon accepted, in bytes. */
const MAX_ICON_BYTES = 64 * 1024

/**
 * Largest number of icons accepted.
 *
 * A guard rather than a product limit: the response carries every icon's text
 * inline, and a map of hundreds would be a megabyte the panel downloads on every
 * mount. A deployment with more than this many file types wants a different
 * mechanism, not a bigger cap.
 */
const MAX_ICONS = 64

/** The icon-map file a deployment gets when it does not name one. */
const DEFAULT_CONFIG_FILE = 'git-panel-icons.yml'

/**
 * Where the icon map lives: `$DSH_HOME/git-panel-icons.yml`, or the path a
 * deployment configured.
 * @param configured - The profile's `fileIconsPath`, if it set one.
 * @returns An absolute path (a leading `~/` in the configured value is expanded).
 */
export function resolveIconConfigPath(configured: string | undefined): string {
  if (configured === undefined || configured.trim() === '') {
    return join(process.env['DSH_HOME'] ?? join(homedir(), '.dsh'), DEFAULT_CONFIG_FILE)
  }
  return expandHome(configured.trim())
}

/**
 * Expand a leading `~/`, because a path in a config file is written by a person.
 * @param path - The path as configured.
 * @returns An absolute path.
 */
function expandHome(path: string): string {
  return path === '~' || path.startsWith('~/') ? join(homedir(), path.slice(1)) : path
}

/** One cached icon file, with what it takes to notice a change. */
interface CachedIcon {
  /** Modification time the text was read at. */
  readonly mtimeMs: number
  /** Size the text was read at. */
  readonly size: number
  /** The document. */
  readonly svg: string
}

/**
 * Build the registry.
 * @param ports - Diagnostic port, so a refused line or file is visible.
 * @param configPath - Absolute path of the icon map.
 * @returns The registry the route layer asks.
 */
export function createFileIconRegistry(ports: HostPorts, configPath: string): FileIconRegistry {
  /** Icon files already read, keyed by absolute path. */
  const cache = new Map<string, CachedIcon>()

  /**
   * Read one icon file, reusing the text when the file has not moved.
   * @param ext - The extension it is mapped to, for the log lines.
   * @param path - The absolute path to read.
   * @returns The document, or `null` when it cannot be used.
   */
  async function readIcon(ext: string, path: string): Promise<string | null> {
    let info: Awaited<ReturnType<typeof stat>>
    try {
      info = await stat(path)
    } catch (error) {
      ports.log('warn', `git-panel: icon for .${ext} is unreadable at ${path}: ${String(error)}`)
      return null
    }
    if (!info.isFile()) {
      ports.log('warn', `git-panel: icon for .${ext} is not a file: ${path}`)
      return null
    }
    if (info.size > MAX_ICON_BYTES) {
      ports.log(
        'warn',
        `git-panel: icon for .${ext} is ${info.size} bytes, over the ${MAX_ICON_BYTES}-byte cap: ${path}`,
      )
      return null
    }

    const cached = cache.get(path)
    if (cached !== undefined && cached.mtimeMs === info.mtimeMs && cached.size === info.size) {
      return cached.svg
    }

    let svg: string
    try {
      svg = await readFile(path, 'utf8')
    } catch (error) {
      ports.log('warn', `git-panel: icon for .${ext} could not be read at ${path}: ${String(error)}`)
      return null
    }
    // A cheap shape check, not a parser: the document is handed to an `<img>` as an
    // image, where scripts and external references do not run, so what is being
    // refused here is "this is not an SVG at all" — a JPEG, a build artefact, a
    // directory listing saved by mistake.
    if (!/<svg[\s>]/iu.test(svg)) {
      ports.log('warn', `git-panel: icon for .${ext} is not an SVG document: ${path}`)
      return null
    }

    cache.set(path, { mtimeMs: info.mtimeMs, size: info.size, svg })
    return svg
  }

  return {
    async list(): Promise<readonly FileIcon[]> {
      let text: string
      try {
        text = await readFile(configPath, 'utf8')
      } catch (error) {
        // No map is the ordinary case, not a failure: the panel has its built-in
        // glyphs and that is what most deployments will use.
        if ((error as { code?: string }).code !== 'ENOENT') {
          ports.log('warn', `git-panel: icon map at ${configPath} could not be read: ${String(error)}`)
        }
        return []
      }

      const parsed = parseIconConfig(text)
      for (const problem of parsed.problems) {
        ports.log('warn', `git-panel: ${configPath} ${problem}`)
      }

      const icons: FileIcon[] = []
      for (const entry of parsed.icons) {
        if (icons.length >= MAX_ICONS) {
          ports.log(
            'warn',
            `git-panel: ${configPath} names more than ${MAX_ICONS} icons; the rest are ignored`,
          )
          break
        }
        const path = expandHome(entry.path)
        if (!isAbsolute(path)) {
          ports.log(
            'warn',
            `git-panel: icon for .${entry.ext} must be an absolute path (or start with ~/): ${entry.path}`,
          )
          continue
        }
        const svg = await readIcon(entry.ext, path)
        if (svg !== null) icons.push({ ext: entry.ext, svg })
      }
      return icons
    },
  }
}
