/**
 * DSH adapter: `ctx.logger` → the core's {@link HostPorts}.
 *
 * This is the only place the plugin names cordis's logging service; the git
 * service and the route layer take the neutral port and never learn that DSH's
 * logger exists. If the logging API changes, only this file changes.
 *
 * @module dsh-git-panel/host/adapter/logger
 */

import type { Context } from '@deepseek-ai/cordis'
import type { HostPorts } from '../../core/ports.ts'

/** The name every line from this plugin carries in the DSH log. */
const LOGGER_NAME = 'dsh-git-panel'

/**
 * Build the host's diagnostic port over the context's logger.
 * @param ctx - Host context carrying `ctx.logger`.
 * @returns The port the git service and routes report through.
 */
export function createHostPorts(ctx: Context): HostPorts {
  const logger = ctx.logger(LOGGER_NAME)
  return {
    log(level, message) {
      // Resolving the severity method by name keeps this adapter honest about
      // the port's small surface: info/warn/error are exactly cordis's own
      // severity names, so no mapping table is needed.
      logger[level](message)
    },
  }
}
