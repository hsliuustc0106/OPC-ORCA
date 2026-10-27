import { randomBytes } from 'node:crypto'

import {
  orcaCliArgs,
  orcaCommandHead,
  ORCA_CLI,
  ORCA_DESKTOP_AGENTS,
  ORCA_SENDER_FLAG,
  ORCA_WORKER_SETUPS,
  type OrcaFlagName,
} from './cli.ts'
import {
  OrcaNoAgentError,
  OrcaNoSenderError,
  OrcaNotConfiguredError,
  OrcaParseError,
  OrcaSpawnError,
  OrcaStubError,
} from './errors.ts'
import { parseLiveStdout, workerStartFailureDetail } from './parse.ts'
import { resolveOrcaExecutable, type ResolveOptions } from './resolve.ts'
import { spawnOrca } from './spawn.ts'
import type {
  CheckInput,
  DryRunOrcaAdapter,
  GateCreateInput,
  GateResolveInput,
  LiveOrcaCall,
  OrcaAdapter,
  OrcaCallResult,
  OrcaCommand,
  OrcaWorker,
  OrcaWorktree,
  PlannedOrcaCall,
  PlannedOrcaCommand,
  ReplyInput,
  RunCreateInput,
  StatusInput,
  TaskCreateInput,
  TaskListInput,
  WorkerReleaseInput,
  WorkerShowInput,
  WorkerStartInput,
} from './types.ts'

export interface CreateOrcaAdapterOptions extends ResolveOptions {
  /**
   * Record planned run-create, task-create, worker-start, check, the
   * observation commands status, task-list, and worker-show, plus
   * worker-release, reply, gate-create, and gate-resolve.
   * Does not spawn and does not require the `orca` binary.
   * Wins over `live` and over `OPC_ORCA_LIVE`: a dry-run adapter never spawns.
   * Default false: those calls reject and never resolve an id, a message id, a gate id, or a status payload.
   */
  dryRun?: boolean
  /**
   * Spawn the resolved CLI. Also enabled when `env.OPC_ORCA_LIVE` is exactly
   * `1` (or `process.env` when `env` is omitted). `live: false` forces this
   * off. Ignored when `dryRun` is true. Default false.
   * This option is the adapter mechanism. A dig tool caller does not set it.
   * `runDig` sets it only after the operator allows live.
   * TODO(orca-cli): subcommand and flag spellings are `src/cli.ts`
   * (Orca desktop 1.4.240). This file must call `orcaCliArgs`.
   */
  live?: boolean
  /**
   * Coordinator terminal handle for live sender verbs. Wins over
   * `ORCA_TERMINAL_HANDLE` when this string has a non-empty trim.
   * A blank value is absent. Live verbs in `ORCA_SENDER_FLAG` refuse
   * to spawn when no handle remains. This adapter does not invent one.
   * Dry-run does not read it and does not record it.
   */
  from?: string
  /**
   * Desktop agent id for live worker-start. Wins over `OPC_ORCA_AGENT`
   * when this string has a non-empty trim. A blank value is absent.
   * Live worker-start throws `no-agent` when the value is missing or not
   * in `ORCA_DESKTOP_AGENTS`. The product label `dsh` is not accepted.
   * This adapter does not invent one. Dry-run does not read it and still
   * records worker `dsh`.
   */
  agent?: string
  /**
   * Optional live worker-start setup (`run`, `skip`, or `inherit`).
   * Wins over `OPC_ORCA_SETUP` when this string has a non-empty trim.
   * A blank value is absent, and an absent value omits the flag.
   * Any other value throws before spawn. Dry-run does not read it.
   */
  setup?: string
}

type Flag = readonly [OrcaFlagName, string]

/**
 * Live spawn is opt-in. Process spawn is reached only through `./spawn.ts`,
 * and only after `dryRun` is false and `live` is true.
 * Never synthesize an id when the `--json` result does not contain one.
 */
function liveRequested(options: CreateOrcaAdapterOptions): boolean {
  if (options.live === true) return true
  if (options.live === false) return false
  const env = options.env ?? process.env
  return env.OPC_ORCA_LIVE === '1'
}

function required(value: string | undefined, label: string): string {
  if (value === undefined || value.trim().length === 0) throw new TypeError(`${label} is required`)
  return value
}

function defaultWorker(worker: OrcaWorker | undefined, worktree: OrcaWorktree | undefined): void {
  if (worker !== undefined && worker !== 'dsh') {
    throw new TypeError('v0 worker is dsh only')
  }
  if (worktree !== undefined && worktree !== 'new-child') {
    throw new TypeError('v0 worktree is new-child only')
  }
}

function plan(
  planned: PlannedOrcaCall[],
  command: PlannedOrcaCommand,
  args: Record<string, string>,
): PlannedOrcaCall {
  const call: PlannedOrcaCall = { dryRun: true, command, args: { ...args } }
  planned.push(call)
  return call
}

/** A real Orca handle is one token (`term_…`). Anything else is not rewritten. */
const HANDLE_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/

function coordinatorHandle(options: CreateOrcaAdapterOptions): string | undefined {
  if (typeof options.from === 'string' && options.from.trim().length > 0) {
    return handleToken(options.from.trim(), 'from')
  }
  const env = options.env ?? process.env
  const raw = env.ORCA_TERMINAL_HANDLE
  if (typeof raw !== 'string' || raw.trim().length === 0) return undefined
  return handleToken(raw.trim(), 'ORCA_TERMINAL_HANDLE')
}

function handleToken(handle: string, source: string): string {
  if (!HANDLE_TOKEN.test(handle)) {
    throw new OrcaNoSenderError(
      `coordinator terminal handle from ${source} is not a single token. Refusing to invent one.`,
    )
  }
  return handle
}

function senderFlag(command: OrcaCommand): OrcaFlagName | undefined {
  if (!Object.hasOwn(ORCA_SENDER_FLAG, command)) return undefined
  return ORCA_SENDER_FLAG[command as keyof typeof ORCA_SENDER_FLAG]
}

function withSender(options: CreateOrcaAdapterOptions, command: OrcaCommand, flags: readonly Flag[]): Flag[] {
  const sender = senderFlag(command)
  const handle = coordinatorHandle(options)
  if (sender === undefined) return [...flags]
  if (handle === undefined) {
    throw new OrcaNoSenderError(
      `live ${command} needs a coordinator terminal handle. Set ORCA_TERMINAL_HANDLE or pass from. Refusing to invent one.`,
    )
  }
  return [...flags, [sender, handle]]
}

const DESKTOP_AGENTS = new Set<string>(ORCA_DESKTOP_AGENTS)
const WORKER_SETUPS = new Set<string>(ORCA_WORKER_SETUPS)

function configuredValue(
  options: CreateOrcaAdapterOptions,
  field: 'agent' | 'setup',
  envKey: 'OPC_ORCA_AGENT' | 'OPC_ORCA_SETUP',
): string | undefined {
  const direct = options[field]
  if (typeof direct === 'string' && direct.trim().length > 0) return direct.trim()
  const env = options.env ?? process.env
  const raw = env[envKey]
  if (typeof raw !== 'string' || raw.trim().length === 0) return undefined
  return raw.trim()
}

function desktopAgent(options: CreateOrcaAdapterOptions): string {
  const value = configuredValue(options, 'agent', 'OPC_ORCA_AGENT')
  if (value === undefined || !DESKTOP_AGENTS.has(value)) {
    throw new OrcaNoAgentError(
      'live worker-start needs a desktop agent id (OPC_ORCA_AGENT or agent). Refusing to pass dsh or invent one.',
    )
  }
  return value
}

function workerSetup(options: CreateOrcaAdapterOptions): string | undefined {
  const value = configuredValue(options, 'setup', 'OPC_ORCA_SETUP')
  if (value === undefined) return undefined
  if (!WORKER_SETUPS.has(value)) {
    throw new TypeError('worker setup must be run, skip, or inherit')
  }
  return value
}

/** Local worktree name for `new-child`. Not an Orca run, task, or dispatch id. */
function newChildWorktreeName(): string {
  return `opc-${randomBytes(6).toString('hex')}`
}

function dispatchArgs(worker: OrcaWorker | undefined, worktree: OrcaWorktree | undefined): Record<string, string> {
  defaultWorker(worker, worktree)
  return {
    worker: worker ?? 'dsh',
    worktree: worktree ?? 'new-child',
  }
}

export function createOrcaAdapter(options: CreateOrcaAdapterOptions & { dryRun: true }): DryRunOrcaAdapter
export function createOrcaAdapter(options?: CreateOrcaAdapterOptions): OrcaAdapter
export function createOrcaAdapter(options: CreateOrcaAdapterOptions = {}): OrcaAdapter {
  const dryRun = options.dryRun === true
  if (dryRun && options.live === true) {
    throw new TypeError('dryRun and live cannot both be set')
  }
  const live = dryRun ? false : liveRequested(options)
  const platform = options.platform ?? process.platform
  const executable = resolveOrcaExecutable({ env: options.env, platform })
  const planned: PlannedOrcaCall[] = []

  const looked = platform === 'linux' ? '`orca` and `orca-ide`' : '`orca`'

  function notConfigured(command: OrcaCommand): never {
    throw new OrcaNotConfiguredError(
      `orca CLI not found (looked for ${looked} on PATH). ${command} is not configured.`,
    )
  }

  function refuse(command: OrcaCommand): never {
    if (!executable) notConfigured(command)
    const argv = [executable, ...orcaCommandHead(command)]
    throw new OrcaStubError(
      `refusing to spawn ${argv.join(' ')}: live spawn is off, no success is returned`,
      argv,
    )
  }

  async function runLive(command: OrcaCommand, flags: readonly Flag[]): Promise<LiveOrcaCall> {
    if (!executable) notConfigured(command)
    const args = orcaCliArgs(command, withSender(options, command, flags))
    const argv = [executable, ...args]
    let spawned
    try {
      spawned = await spawnOrca(executable, args)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT' || code === 'EACCES') notConfigured(command)
      throw new OrcaSpawnError(`${command} could not be spawned`, argv, null)
    }
    // Stderr is not parsed and is not copied into the error: a CLI secret must not land here.
    if (spawned.exitCode !== 0) {
      const detail = command === 'worker-start' ? workerStartFailureDetail(spawned.stdout) : undefined
      const suffix = detail === undefined ? '' : `: ${detail}`
      throw new OrcaSpawnError(
        `${command} exited ${spawned.exitCode ?? 'null'}${suffix}`,
        argv,
        spawned.exitCode,
      )
    }
    let parsed
    try {
      parsed = parseLiveStdout(command, spawned.stdout, argv)
    } catch (error) {
      if (error instanceof OrcaParseError) throw error
      throw new OrcaParseError(`${command} stdout is unparseable`, argv)
    }
    return {
      dryRun: false,
      live: true,
      command,
      exitCode: 0,
      ids: parsed.ids,
      fields: parsed.fields,
    }
  }

  function dispatch(command: OrcaCommand, flags: readonly Flag[], recorded: () => PlannedOrcaCall): Promise<OrcaCallResult> {
    if (dryRun) return Promise.resolve(recorded())
    if (!live) refuse(command)
    return runLive(command, flags)
  }

  return {
    executable,
    dryRun,
    live,
    get planned() {
      return planned.map((call) => ({ dryRun: true as const, command: call.command, args: { ...call.args } }))
    },
    async status(_input: StatusInput = {}) {
      // A supplied runId is not copied. Dry-run must not look like a status payload.
      // Live does not copy it either: only `result.run.id` on run-create can add one.
      const command = ORCA_CLI.commands.status
      return dispatch(command, [], () => plan(planned, command, {}))
    },
    async runCreate(input: RunCreateInput) {
      const goal = required(input.goal, 'goal')
      const repo = required(input.repo, 'repo')
      const baseRef = input.baseRef === undefined ? undefined : required(input.baseRef, 'baseRef')
      const command = ORCA_CLI.commands.runCreate
      // repo and baseRef are the product binding, recorded on the dry-run plan.
      // Orca 1.4.240 run-create accepts the objective flag. The sender flag
      // is added for live spawn only. Do not pass repo or base as flags.
      const flags: Flag[] = [[ORCA_CLI.flags.objective, goal]]
      return dispatch(command, flags, () => {
        const args: Record<string, string> = { goal, repo }
        if (baseRef !== undefined) args.base = baseRef
        return plan(planned, command, args)
      })
    },
    async taskCreate(input: TaskCreateInput) {
      const command = ORCA_CLI.commands.taskCreate
      if (!dryRun) {
        const runId = required(input.runId, 'runId')
        const spec = required(input.spec, 'spec')
        if (!live) return refuse(command)
        // Worker and worktree are worker-start flags, not task-create flags.
        return runLive(command, [
          [ORCA_CLI.flags.spec, spec],
          [ORCA_CLI.flags.run, runId],
        ])
      }
      const spec = required(input.spec, 'spec')
      // runId is not copied. Dry-run must not look like a created run.
      return plan(planned, command, { spec })
    },
    async taskList(input: TaskListInput = {}) {
      const command = ORCA_CLI.commands.taskList
      if (!dryRun) {
        const runId = required(input.runId, 'runId')
        if (!live) return refuse(command)
        return runLive(command, [[ORCA_CLI.flags.run, runId]])
      }
      // runId is not copied. Dry-run must not look like a listed run.
      return plan(planned, command, {})
    },
    async workerStart(input: WorkerStartInput) {
      const command = ORCA_CLI.commands.workerStart
      if (!dryRun) {
        const taskId = required(input.taskId, 'taskId')
        const runId = input.runId === undefined ? undefined : required(input.runId, 'runId')
        defaultWorker(input.worker, input.worktree)
        if (!live) return refuse(command)
        if (!executable) notConfigured(command)
        const worktree = input.worktree ?? 'new-child'
        const flags: Flag[] = [
          [ORCA_CLI.flags.task, taskId],
          [ORCA_CLI.flags.agent, desktopAgent(options)],
          [ORCA_CLI.flags.worktree, worktree],
        ]
        // Desktop help requires --name for a new worktree and rejects it otherwise.
        if (worktree === 'new-child') flags.push([ORCA_CLI.flags.name, newChildWorktreeName()])
        const setup = workerSetup(options)
        if (setup !== undefined) flags.push([ORCA_CLI.flags.setup, setup])
        if (runId !== undefined) flags.push([ORCA_CLI.flags.run, runId])
        return runLive(command, flags)
      }
      // taskId and runId are not copied. Dry-run must not look like a started worker.
      return plan(planned, command, dispatchArgs(input.worker, input.worktree))
    },
    async workerShow(input: WorkerShowInput = {}) {
      const command = ORCA_CLI.commands.workerShow
      if (!dryRun) {
        const workerId = required(input.workerId, 'workerId')
        if (!live) return refuse(command)
        return runLive(command, [[ORCA_CLI.flags.dispatch, workerId]])
      }
      // workerId is not copied. Dry-run must not look like a shown worker.
      return plan(planned, command, {})
    },
    async workerRelease(input: WorkerReleaseInput = {}) {
      const command = ORCA_CLI.commands.workerRelease
      if (!dryRun) {
        const workerId = required(input.workerId, 'workerId')
        if (!live) return refuse(command)
        return runLive(command, [[ORCA_CLI.flags.dispatch, workerId]])
      }
      // workerId is not copied. Dry-run must not look like a released worker.
      return plan(planned, command, {})
    },
    async check(input: CheckInput) {
      const command = ORCA_CLI.commands.check
      if (!dryRun) {
        const runId = required(input.runId, 'runId')
        if (!live) return refuse(command)
        // The caller's converged flag is not passed and not copied.
        return runLive(command, [[ORCA_CLI.flags.run, runId]])
      }
      if (typeof input.converged !== 'boolean') throw new TypeError('converged is required')
      // runId is not copied. Dry-run must not look like a checked run.
      return plan(planned, command, { converged: input.converged ? 'true' : 'false' })
    },
    async reply(input: ReplyInput) {
      const command = ORCA_CLI.commands.reply
      if (!dryRun) {
        // Desktop reply requires the message id flag. Do not invent one from the run.
        const messageId = required(input.messageId, 'messageId')
        const text = required(input.text, 'text')
        const runId = required(input.runId, 'runId')
        if (!live) return refuse(command)
        return runLive(command, [
          [ORCA_CLI.flags.id, messageId],
          [ORCA_CLI.flags.body, text],
          [ORCA_CLI.flags.run, runId],
        ])
      }
      const text = required(input.text, 'text')
      // runId and messageId are not copied. Dry-run must not look like a sent message.
      return plan(planned, command, { text })
    },
    async gateCreate(input: GateCreateInput) {
      const command = ORCA_CLI.commands.gateCreate
      if (!dryRun) {
        // Desktop gate-create takes the task id, not the run id. Do not pass the run id.
        const taskId = required(input.taskId, 'taskId')
        const reason = required(input.reason, 'reason')
        if (!live) return refuse(command)
        return runLive(command, [
          [ORCA_CLI.flags.task, taskId],
          [ORCA_CLI.flags.question, reason],
        ])
      }
      const reason = required(input.reason, 'reason')
      // taskId is not copied. Dry-run must not look like a created gate.
      return plan(planned, command, { reason })
    },
    async gateResolve(input: GateResolveInput) {
      const command = ORCA_CLI.commands.gateResolve
      if (!dryRun) {
        const gateId = required(input.gateId, 'gateId')
        const resolution = required(input.resolution, 'resolution')
        if (!live) return refuse(command)
        return runLive(command, [
          [ORCA_CLI.flags.id, gateId],
          [ORCA_CLI.flags.resolution, resolution],
        ])
      }
      const resolution = required(input.resolution, 'resolution')
      // gateId is not copied. Dry-run must not look like a resolved gate.
      return plan(planned, command, { resolution })
    },
  }
}
