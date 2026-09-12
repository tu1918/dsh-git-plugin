/**
 * DSH adapter: `ctx.logger` (and the model services) → the core's {@link HostPorts}.
 *
 * This is the only place the plugin names cordis's logging service; the git
 * service and the route layer take the neutral port and never learn that DSH's
 * logger exists. If the logging API changes, only this file changes.
 *
 * `generateText` and the credential store are here rather than in the git
 * service because they are the same kind of thing — host capabilities the core
 * describes in its own vocabulary — and their own DSH naming lives in `./llm.ts`
 * and `./credentials.ts`.
 *
 * @module dsh-git-panel/host/adapter/logger
 */

import type { Context } from '@deepseek-ai/cordis'
import type { HostPorts } from '../../core/ports.ts'
import { createGitCredentials } from './credentials.ts'
import { createTextGenerator } from './llm.ts'

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
    generateText: createTextGenerator(ctx),
    // Optional by construction: the store answers "nothing stored" and a stated
    // refusal to save when the composition mounts no credential provider.
    credentials: createGitCredentials(ctx),
  }
}
