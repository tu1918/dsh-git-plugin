/**
 * Host half entry: assembly only.
 *
 * This module wires the adapter (the only DSH-aware layer) to the git service
 * and the route layer, and does nothing else. Reading it should tell you exactly
 * which DSH capabilities the plugin uses — `webServer` for transport,
 * `sessions` for the session→directory mapping, and the context logger — and
 * nothing about how git or the panel work.
 *
 * The browser half is a separate bundle (exports `./client`), reached through the
 * `dsh.client` declaration in package.json; nothing here serves it.
 *
 * @module dsh-git-panel/host
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-session'
import type { HostPorts } from '../core/ports.ts'
import { createHostPorts } from './adapter/logger.ts'
import { createSessionDirResolver } from './adapter/workspace.ts'
import { createGitRunner } from './git-exec.ts'
import { createGitService, type GitServiceLimits } from './git-service.ts'
import { registerGitPanelRoutes } from './adapter/routes.ts'
import { createGitProbe } from './git-probe.ts'
import { createFileIconRegistry, resolveIconConfigPath } from './file-icons.ts'

/**
 * Services required before this plugin can mount.
 *
 * `workspaceRegistry` is deliberately absent: it is only consulted for a
 * diagnostic, and requiring it would keep the panel out of any composition that
 * does not register workspaces.
 */
export const inject = ['webServer', 'sessions']

/**
 * Read a positive millisecond setting, or `undefined`.
 *
 * `0` is the spelling that matters: it used to be handed straight to Node's
 * process options, where it means "no deadline at all", so a profile could
 * switch the safety net off without saying so. Anything that is not a positive,
 * finite number is dropped with a warning and the default stands instead.
 * @param value - What the profile said.
 * @param name - The setting's name, for the log line.
 * @param ports - Diagnostic port.
 * @returns The value when it is usable, otherwise `undefined`.
 */
function positiveMs(
  value: number | undefined,
  name: string,
  ports: HostPorts,
): number | undefined {
  if (value === undefined) return undefined
  if (Number.isFinite(value) && value > 0) return value
  ports.log(
    'warn',
    `ignoring ${name}=${String(value)}: a positive number of milliseconds is required, so the default stands`,
  )
  return undefined
}

/** Plugin configuration, as a profile patch or the settings card may set it. */
export interface Config {
  /**
   * Deadline for one git call, in milliseconds.
   *
   * Must be positive; a zero or negative value is ignored with a warning rather
   * than read as "no deadline" (see {@link positiveMs}).
   */
  readonly gitTimeoutMs?: number
  /** Ceiling on captured stdout for one git call, in bytes. */
  readonly maxStdoutBytes?: number
  /**
   * Where the file-type icon map lives (FR-1.2).
   *
   * Absent, the panel looks for `$DSH_HOME/git-panel-icons.yml`; the map itself is
   * `extension: path` lines, read per request so editing it needs no restart (see
   * `core/icon-config.ts` and `host/file-icons.ts`).
   */
  readonly fileIconsPath?: string
}

/**
 * Mount the panel's host half.
 * @param ctx - Host context carrying `webServer` and `sessions`.
 * @param config - Optional limits from the profile patch.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const ports = createHostPorts(ctx)
  const timeoutMs = positiveMs(config.gitTimeoutMs, 'gitTimeoutMs', ports)
  const limits: GitServiceLimits = {
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    ...(config.maxStdoutBytes === undefined ? {} : { maxStdoutBytes: config.maxStdoutBytes }),
  }

  const runner = createGitRunner()
  const resolver = createSessionDirResolver(ctx, ports)
  const service = createGitService(runner, resolver, ports, limits)
  const probe = createGitProbe(ports)
  // Read per request rather than once here: a deployment that edits its icon map
  // and reloads the panel gets the new icons without restarting the host.
  const icons = createFileIconRegistry(ports, resolveIconConfigPath(config.fileIconsPath))

  // `ctx.effect` ties both the routes and the probe to this plugin's own
  // lifetime, so an unload or a config reload leaves no route, no filesystem
  // watch, and no open SSE socket behind.
  ctx.effect(
    () => {
      const disposeRoutes = registerGitPanelRoutes(ctx, service, probe, ports, icons)
      ports.log('info', 'git panel host ready at /git-panel')
      return () => {
        disposeRoutes()
        probe.dispose()
      }
    },
    'dsh-git-panel: /git-panel routes + git state probe',
  )
}
