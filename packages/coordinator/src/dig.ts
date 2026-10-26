import { createOrcaAdapter, type CreateOrcaAdapterOptions } from '@opc-orca/orca-adapter'

import { createDigLoop } from './loop.ts'
import type { Difficulty, DigPath, DigState, HumanDecision, Intent } from './states.ts'

export interface DigEnv {
  PATH?: string | undefined
  OPC_ORCA_LIVE?: string | undefined
  /** Coordinator terminal handle. Used only when this dig is live. */
  ORCA_TERMINAL_HANDLE?: string | undefined
}

export interface DigRequest {
  goal: string
  /** `easy` skips Orca. `normal` dispatches. Omitted: `normal` when `repo` is set, otherwise `easy`. */
  difficulty?: Difficulty
  /** Required for a normal task. Passed to run-create. */
  repo?: string
  /**
   * Tool-caller request. `true` does not grant spawn. `false` forces dry-run
   * even when `OPC_ORCA_LIVE=1`. Omitted follows the operator env.
   */
  live?: boolean
  /**
   * Plugin config. `false` forces dry-run even when the caller passes
   * `live: true` and `OPC_ORCA_LIVE=1`. `true` does not grant spawn.
   * Omitted does not veto.
   */
  configLive?: boolean
  /**
   * Dry-run check flag. Default false, so a dry-run dig stops in `waiting`.
   * A live check ignores this and uses stdout `converged:`.
   */
  converged?: boolean
  /** Lookup for `PATH`, `OPC_ORCA_LIVE`, and `ORCA_TERMINAL_HANDLE`. When set, `process.env` is not read. */
  env?: DigEnv
  /**
   * Coordinator terminal handle. Wins over `env.ORCA_TERMINAL_HANDLE`.
   * A blank string is absent. Live sender verbs fail closed without one.
   * This is not a tool-caller field: the plugin forwards operator config only.
   */
  from?: string
  platform?: string
}

export interface DigSummary {
  state: DigState
  path: DigPath | null
  goal: string | null
  difficulty: Difficulty | null
  live: boolean
  intents: readonly Intent[]
  /** Fixed false. `runDig` does not open, update, or merge a pull request. */
  githubWritePerformed: false
  humanDecision: HumanDecision | null
  stopReason: string | null
}

export interface OperatorLiveInput {
  /** Tool caller. `true` is not a grant. `false` forces dry-run. */
  live?: boolean
  /** Plugin config. `false` vetoes. `true` is not a grant. */
  configLive?: boolean
  /** Lookup for `OPC_ORCA_LIVE`. When set, `process.env` is not read. */
  env?: DigEnv
}

/**
 * Operator setting wins. Spawn only when `OPC_ORCA_LIVE` is exactly `1`
 * and neither the tool caller nor plugin config set `live` to false.
 * Caller `live: true` alone returns false. `configLive: true` alone returns false.
 */
export function operatorAllowsLive(input: OperatorLiveInput): boolean {
  if (input.live === false) return false
  if (input.configLive === false) return false
  const env = input.env ?? process.env
  return env.OPC_ORCA_LIVE === '1'
}

/**
 * Run one dig from a goal and return a summary.
 * Stops before `askHumanPr`: the result is `converging` or `waiting`
 * (or `done` only when triage is not used here). It does not record a
 * verdict and it does not open, update, or merge a pull request.
 * A throw from the adapter leaves no summary.
 */
export async function runDig(request: DigRequest): Promise<DigSummary> {
  if (typeof request?.goal !== 'string' || request.goal.trim().length === 0) {
    throw new TypeError('goal is empty')
  }
  if (request.live !== undefined && typeof request.live !== 'boolean') {
    throw new TypeError('live must be true or false')
  }
  if (request.configLive !== undefined && typeof request.configLive !== 'boolean') {
    throw new TypeError('configLive must be true or false')
  }
  if (request.converged !== undefined && typeof request.converged !== 'boolean') {
    throw new TypeError('converged must be true or false')
  }
  if (request.from !== undefined && typeof request.from !== 'string') {
    throw new TypeError('from must be a string')
  }
  const repo = typeof request.repo === 'string' ? request.repo.trim() : ''
  let difficulty = request.difficulty
  if (difficulty === undefined) difficulty = repo.length > 0 ? 'normal' : 'easy'
  if (difficulty !== 'easy' && difficulty !== 'normal') {
    throw new TypeError('difficulty must be easy or normal')
  }

  const live = operatorAllowsLive(request)
  const env = request.env
  const platform = request.platform
  const adapterOptions: CreateOrcaAdapterOptions = {}
  if (env !== undefined) adapterOptions.env = env
  if (platform !== undefined) adapterOptions.platform = platform
  if (request.from !== undefined) adapterOptions.from = request.from
  const adapter = live
    ? createOrcaAdapter({ ...adapterOptions, live: true })
    : createOrcaAdapter({ ...adapterOptions, dryRun: true })

  const loop = createDigLoop({ adapter, repo: repo.length > 0 ? repo : undefined })
  loop.acceptGoal(request.goal)
  loop.triage({ agentReady: true, difficulty })
  if (difficulty === 'easy') {
    loop.runDirect()
  } else {
    await loop.bindRun()
    await loop.startWorker()
    await loop.check({ converged: request.converged === true })
  }

  const snap = loop.snapshot()
  if (snap.state === 'awaiting_human_pr' || snap.state === 'done') {
    throw new TypeError('dig must stop before the human PR gate')
  }
  return {
    state: snap.state,
    path: snap.path,
    goal: snap.goal,
    difficulty: snap.difficulty,
    live,
    intents: snap.intents,
    githubWritePerformed: false,
    humanDecision: snap.humanDecision,
    stopReason: snap.stopReason,
  }
}
