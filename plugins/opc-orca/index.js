/**
 * @opc-orca/plugin — Phase 0 stub for DeepSeek Harness.
 *
 * Harness is the entrance. A later revision of this plugin will start the
 * coordinator, which stops at `awaiting_human_pr` before any pull request
 * open, update, or merge. This file registers no tools, no HTTP routes, no
 * send middleware, and no schedules.
 *
 * @param {unknown} ctx
 * @param {Record<string, unknown>} [_config]
 * @returns {() => void}
 */
export const name = 'opc-orca'

/** No host services are injected. The stub does not depend on a bot tree. */
export const inject = []

export function apply(ctx, _config = {}) {
  const factory = ctx && typeof ctx === 'object' && 'logger' in ctx ? ctx.logger : undefined
  const logger = typeof factory === 'function' ? factory('opc-orca') : factory
  const info = logger && typeof logger === 'object' && 'info' in logger ? logger.info : undefined
  if (typeof info === 'function') info('opc-orca: stub loaded; no tools registered')
  return function dispose() {}
}
