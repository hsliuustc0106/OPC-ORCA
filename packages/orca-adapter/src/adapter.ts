import { OrcaNotConfiguredError, OrcaStubError } from './errors.ts'
import { resolveOrcaExecutable, type ResolveOptions } from './resolve.ts'
import type {
  CheckInput,
  GateCreateInput,
  GateResolveInput,
  OrcaAdapter,
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
   * Default false: those calls reject and never resolve an id, a message id, a gate id, or a status payload.
   */
  dryRun?: boolean
}

/**
 * TODO(orca-cli): when a live command is wired, spawn the resolved binary
 * (`orca`, or `orca-ide` on Linux) as `[bin, command, …]` and parse its
 * stdout. Do not add a process spawn until that parser exists, and never
 * synthesize a run id, task id, worker id, message id, gate id, exit code 0, or status payload.
 * `dryRun` returns before that refusal and only for run-create, task-create,
 * worker-start, check, status, task-list, worker-show, worker-release, reply,
 * gate-create, and gate-resolve. Gate plans are backend decisions. They are
 * not a human PR yes.
 */
async function refuse(bin: string | null, platform: string, command: OrcaCommand): Promise<never> {
  if (!bin) {
    const looked = platform === 'linux' ? '`orca` and `orca-ide`' : '`orca`'
    throw new OrcaNotConfiguredError(
      `orca CLI not found (looked for ${looked} on PATH). ${command} is not configured.`,
    )
  }
  const argv = [bin, command]
  throw new OrcaStubError(
    `refusing to spawn ${bin} ${command}: v0 stub, no success is returned`,
    argv,
  )
}

function required(value: string | undefined, label: string): void {
  if (value === undefined || value.trim().length === 0) throw new TypeError(`${label} is required`)
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

export function createOrcaAdapter(options: CreateOrcaAdapterOptions = {}): OrcaAdapter {
  const dryRun = options.dryRun === true
  const platform = options.platform ?? process.platform
  const executable = resolveOrcaExecutable({ env: options.env, platform })
  const planned: PlannedOrcaCall[] = []

  return {
    executable,
    dryRun,
    get planned() {
      return planned.map((call) => ({ dryRun: true as const, command: call.command, args: { ...call.args } }))
    },
    async status(_input: StatusInput = {}) {
      if (!dryRun) return refuse(executable, platform, 'status')
      // A supplied runId is not copied. Dry-run must not look like a status payload.
      return plan(planned, 'status', {})
    },
    async runCreate(input: RunCreateInput) {
      required(input.goal, 'goal')
      required(input.repo, 'repo')
      if (input.baseRef !== undefined) required(input.baseRef, 'baseRef')
      if (!dryRun) return refuse(executable, platform, 'run-create')
      const args: Record<string, string> = { goal: input.goal, repo: input.repo }
      if (input.baseRef !== undefined) args.base = input.baseRef
      return plan(planned, 'run-create', args)
    },
    async taskCreate(input: TaskCreateInput) {
      if (!dryRun) {
        required(input.runId, 'runId')
        required(input.title, 'title')
        defaultWorker(input.worker, input.worktree)
        return refuse(executable, platform, 'task-create')
      }
      required(input.title, 'title')
      // runId is not copied. Dry-run must not look like a created run.
      return plan(planned, 'task-create', {
        title: input.title,
        ...dispatchArgs(input.worker, input.worktree),
      })
    },
    async taskList(input: TaskListInput = {}) {
      if (!dryRun) {
        required(input.runId, 'runId')
        return refuse(executable, platform, 'task-list')
      }
      // runId is not copied. Dry-run must not look like a listed run.
      return plan(planned, 'task-list', {})
    },
    async workerStart(input: WorkerStartInput) {
      if (!dryRun) {
        required(input.taskId, 'taskId')
        defaultWorker(input.worker, input.worktree)
        return refuse(executable, platform, 'worker-start')
      }
      // taskId is not copied. Dry-run must not look like a started worker.
      return plan(planned, 'worker-start', dispatchArgs(input.worker, input.worktree))
    },
    async workerShow(input: WorkerShowInput = {}) {
      if (!dryRun) {
        required(input.workerId, 'workerId')
        return refuse(executable, platform, 'worker-show')
      }
      // workerId is not copied. Dry-run must not look like a shown worker.
      return plan(planned, 'worker-show', {})
    },
    async workerRelease(input: WorkerReleaseInput = {}) {
      if (!dryRun) {
        required(input.workerId, 'workerId')
        return refuse(executable, platform, 'worker-release')
      }
      // workerId is not copied. Dry-run must not look like a released worker.
      return plan(planned, 'worker-release', {})
    },
    async check(input: CheckInput) {
      if (!dryRun) {
        required(input.runId, 'runId')
        return refuse(executable, platform, 'check')
      }
      if (typeof input.converged !== 'boolean') throw new TypeError('converged is required')
      // runId is not copied. Dry-run must not look like a checked run.
      return plan(planned, 'check', { converged: input.converged ? 'true' : 'false' })
    },
    async reply(input: ReplyInput) {
      if (!dryRun) {
        required(input.runId, 'runId')
        required(input.text, 'text')
        return refuse(executable, platform, 'reply')
      }
      required(input.text, 'text')
      // runId is not copied. Dry-run must not look like a sent message.
      return plan(planned, 'reply', { text: input.text })
    },
    async gateCreate(input: GateCreateInput) {
      if (!dryRun) {
        required(input.runId, 'runId')
        required(input.reason, 'reason')
        return refuse(executable, platform, 'gate-create')
      }
      required(input.reason, 'reason')
      // runId is not copied. Dry-run must not look like a created gate.
      return plan(planned, 'gate-create', { reason: input.reason })
    },
    async gateResolve(input: GateResolveInput) {
      if (!dryRun) {
        required(input.gateId, 'gateId')
        required(input.resolution, 'resolution')
        return refuse(executable, platform, 'gate-resolve')
      }
      required(input.resolution, 'resolution')
      // gateId is not copied. Dry-run must not look like a resolved gate.
      return plan(planned, 'gate-resolve', { resolution: input.resolution })
    },
  }
}
