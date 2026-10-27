/**
 * @opc-orca/plugin — DeepSeek Harness entrance for OPC-ORCA.
 *
 * Harness is the entrance. `apply` registers one `dig` tool: a goal goes in,
 * the coordinator runs, and a status summary comes out. Live spawn is
 * operator-owned: `OPC_ORCA_LIVE=1` and config `live` is not false. A tool
 * caller passing `live: true` does not grant spawn. The tool stops before
 * `awaiting_human_pr` and does not open, update, or merge a pull request.
 *
 * @param {unknown} ctx
 * @param {{
 *   live?: boolean,
 *   from?: string,
 *   agent?: string,
 *   setup?: string,
 *   env?: { PATH?: string, OPC_ORCA_LIVE?: string, ORCA_TERMINAL_HANDLE?: string, OPC_ORCA_AGENT?: string, OPC_ORCA_SETUP?: string },
 * }} [config]
 * @returns {() => void}
 */
import { runDig } from '@opc-orca/coordinator'

export const name = 'opc-orca'

/** The Harness tool registry. This plugin does not inject a bot tree. */
export const inject = ['tools']

export function apply(ctx, config = {}) {
  const tools = ctx && typeof ctx === 'object' && 'tools' in ctx ? ctx.tools : undefined
  const register = tools && typeof tools === 'object' && 'register' in tools ? tools.register : undefined
  if (typeof register !== 'function') throw new TypeError('opc-orca requires ctx.tools.register')

  const factory = ctx && typeof ctx === 'object' && 'logger' in ctx ? ctx.logger : undefined
  const logger = typeof factory === 'function' ? factory('opc-orca') : factory
  const info = logger && typeof logger === 'object' && 'info' in logger ? logger.info : undefined
  if (typeof info === 'function') info('opc-orca: dig tool registered')

  const tool = {
    name: 'dig',
    description:
      'Dig one goal through the OPC-ORCA coordinator. Default is dry-run and does not spawn. ' +
      'Live spawn runs only when the operator set OPC_ORCA_LIVE=1 and plugin config live is not false. ' +
      'A caller live true does not grant spawn. Caller or config live false forces dry-run. ' +
      'The summary stops before the human PR gate and does not open, update, or merge a pull request.',
    parameters: {
      goal: { type: 'string', required: true, description: 'Work to dig.' },
      repo: {
        type: 'string',
        description: 'Repository for a normal task. Required when difficulty is normal.',
      },
      difficulty: {
        type: 'string',
        description: 'easy or normal. Defaults to normal when repo is set, otherwise easy.',
      },
      live: {
        type: 'boolean',
        description:
          'Request a live spawn. Ignored unless OPC_ORCA_LIVE=1 and config live is not false. live false forces dry-run.',
      },
      converged: {
        type: 'boolean',
        description: 'Dry-run check flag. Default false. A live check uses stdout converged, not this flag.',
      },
    },
    output: {
      schema: { type: 'object' },
      render(_args, value) {
        return [{ type: 'text', text: JSON.stringify(value) }]
      },
    },
    /**
     * @param {Record<string, unknown>} [args]
     */
    async execute(args = {}) {
      const input = args && typeof args === 'object' ? args : {}
      // Forward both switches. runDig applies operator-wins: caller live true
      // is not a grant, and config.live false vetoes OPC_ORCA_LIVE=1.
      return runDig({
        goal: typeof input.goal === 'string' ? input.goal : '',
        repo: typeof input.repo === 'string' ? input.repo : undefined,
        difficulty: typeof input.difficulty === 'string' ? input.difficulty : undefined,
        converged: typeof input.converged === 'boolean' ? input.converged : undefined,
        live: typeof input.live === 'boolean' ? input.live : undefined,
        configLive: typeof config.live === 'boolean' ? config.live : undefined,
        from: typeof config.from === 'string' ? config.from : undefined,
        agent: typeof config.agent === 'string' ? config.agent : undefined,
        setup: typeof config.setup === 'string' ? config.setup : undefined,
        env: config.env,
      })
    },
  }

  const registered = register(tool)
  return function dispose() {
    if (typeof registered === 'function') registered()
  }
}
