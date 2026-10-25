import { OrcaNotConfiguredError, OrcaParseError, OrcaSpawnError, OrcaStubError } from './errors.ts'
import { parseLiveStdout } from './parse.ts'
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
   * TODO(orca-cli): Phase 8 confirms the `--flag` spellings against the desktop CLI.
   */
  live?: boolean
}

type Flag = readonly [name: string, value: string]

/**
 * Live spawn is opt-in. Process spawn is reached only through `./spawn.ts`,
 * and only after `dryRun` is false and `live` is true.
 * Never synthesize an id when stdout does not contain one.
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
    const argv = [executable, command]
    throw new OrcaStubError(
      `refusing to spawn ${executable} ${command}: live spawn is off, no success is returned`,
      argv,
    )
  }

  async function runLive(command: OrcaCommand, flags: readonly Flag[]): Promise<LiveOrcaCall> {
    if (!executable) notConfigured(command)
    const args: string[] = [command]
    for (const [name, value] of flags) args.push(`--${name}`, value)
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
      throw new OrcaSpawnError(`${command} exited ${spawned.exitCode ?? 'null'}`, argv, spawned.exitCode)
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
      // Live does not copy it either: only stdout `run-id:` can add one.
      return dispatch('status', [], () => plan(planned, 'status', {}))
    },
    async runCreate(input: RunCreateInput) {
      const goal = required(input.goal, 'goal')
      const repo = required(input.repo, 'repo')
      const baseRef = input.baseRef === undefined ? undefined : required(input.baseRef, 'baseRef')
      const flags: Flag[] = [
        ['goal', goal],
        ['repo', repo],
      ]
      if (baseRef !== undefined) flags.push(['base', baseRef])
      return dispatch('run-create', flags, () => {
        const args: Record<string, string> = { goal, repo }
        if (baseRef !== undefined) args.base = baseRef
        return plan(planned, 'run-create', args)
      })
    },
    async taskCreate(input: TaskCreateInput) {
      if (!dryRun) {
        const runId = required(input.runId, 'runId')
        const title = required(input.title, 'title')
        defaultWorker(input.worker, input.worktree)
        if (!live) return refuse('task-create')
        return runLive('task-create', [
          ['run-id', runId],
          ['title', title],
          ['worker', input.worker ?? 'dsh'],
          ['worktree', input.worktree ?? 'new-child'],
        ])
      }
      const title = required(input.title, 'title')
      // runId is not copied. Dry-run must not look like a created run.
      return plan(planned, 'task-create', {
        title,
        ...dispatchArgs(input.worker, input.worktree),
      })
    },
    async taskList(input: TaskListInput = {}) {
      if (!dryRun) {
        const runId = required(input.runId, 'runId')
        if (!live) return refuse('task-list')
        return runLive('task-list', [['run-id', runId]])
      }
      // runId is not copied. Dry-run must not look like a listed run.
      return plan(planned, 'task-list', {})
    },
    async workerStart(input: WorkerStartInput) {
      if (!dryRun) {
        const taskId = required(input.taskId, 'taskId')
        defaultWorker(input.worker, input.worktree)
        if (!live) return refuse('worker-start')
        return runLive('worker-start', [
          ['task-id', taskId],
          ['worker', input.worker ?? 'dsh'],
          ['worktree', input.worktree ?? 'new-child'],
        ])
      }
      // taskId is not copied. Dry-run must not look like a started worker.
      return plan(planned, 'worker-start', dispatchArgs(input.worker, input.worktree))
    },
    async workerShow(input: WorkerShowInput = {}) {
      if (!dryRun) {
        const workerId = required(input.workerId, 'workerId')
        if (!live) return refuse('worker-show')
        return runLive('worker-show', [['worker-id', workerId]])
      }
      // workerId is not copied. Dry-run must not look like a shown worker.
      return plan(planned, 'worker-show', {})
    },
    async workerRelease(input: WorkerReleaseInput = {}) {
      if (!dryRun) {
        const workerId = required(input.workerId, 'workerId')
        if (!live) return refuse('worker-release')
        return runLive('worker-release', [['worker-id', workerId]])
      }
      // workerId is not copied. Dry-run must not look like a released worker.
      return plan(planned, 'worker-release', {})
    },
    async check(input: CheckInput) {
      if (!dryRun) {
        const runId = required(input.runId, 'runId')
        if (!live) return refuse('check')
        // The caller's converged flag is not passed and not copied.
        return runLive('check', [['run-id', runId]])
      }
      if (typeof input.converged !== 'boolean') throw new TypeError('converged is required')
      // runId is not copied. Dry-run must not look like a checked run.
      return plan(planned, 'check', { converged: input.converged ? 'true' : 'false' })
    },
    async reply(input: ReplyInput) {
      if (!dryRun) {
        const runId = required(input.runId, 'runId')
        const text = required(input.text, 'text')
        if (!live) return refuse('reply')
        return runLive('reply', [
          ['run-id', runId],
          ['text', text],
        ])
      }
      const text = required(input.text, 'text')
      // runId is not copied. Dry-run must not look like a sent message.
      return plan(planned, 'reply', { text })
    },
    async gateCreate(input: GateCreateInput) {
      if (!dryRun) {
        const runId = required(input.runId, 'runId')
        const reason = required(input.reason, 'reason')
        if (!live) return refuse('gate-create')
        return runLive('gate-create', [
          ['run-id', runId],
          ['reason', reason],
        ])
      }
      const reason = required(input.reason, 'reason')
      // runId is not copied. Dry-run must not look like a created gate.
      return plan(planned, 'gate-create', { reason })
    },
    async gateResolve(input: GateResolveInput) {
      if (!dryRun) {
        const gateId = required(input.gateId, 'gateId')
        const resolution = required(input.resolution, 'resolution')
        if (!live) return refuse('gate-resolve')
        return runLive('gate-resolve', [
          ['gate-id', gateId],
          ['resolution', resolution],
        ])
      }
      const resolution = required(input.resolution, 'resolution')
      // gateId is not copied. Dry-run must not look like a resolved gate.
      return plan(planned, 'gate-resolve', { resolution })
    },
  }
}
