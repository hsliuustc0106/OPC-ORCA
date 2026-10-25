import { OrcaNotConfiguredError, OrcaStubError } from './errors.ts'
import { resolveOrcaExecutable, type ResolveOptions } from './resolve.ts'
import type {
  CheckInput,
  OrcaAdapter,
  OrcaCommand,
  OrcaWorker,
  OrcaWorktree,
  PlannedOrcaCall,
  PlannedOrcaCommand,
  RunCreateInput,
  TaskCreateInput,
  WorkerStartInput,
} from './types.ts'

export interface CreateOrcaAdapterOptions extends ResolveOptions {
  /**
   * Record planned run-create, task-create, worker-start, and check.
   * Does not spawn and does not require the `orca` binary.
   * Default false: those calls reject and never resolve an id.
   */
  dryRun?: boolean
}

/**
 * TODO(orca-cli): when a live command is wired, spawn the resolved binary
 * (`orca`, or `orca-ide` on Linux) as `[bin, command, …]` and parse its
 * stdout. Do not add a process spawn until that parser exists, and never
 * synthesize a run id, task id, gate id, or exit code 0.
 * `dryRun` returns before that refusal and only for run-create, task-create,
 * worker-start, and check.
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
    async status() {
      return refuse(executable, platform, 'status')
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
    async taskList(input) {
      required(input.runId, 'runId')
      return refuse(executable, platform, 'task-list')
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
    async workerShow(input) {
      required(input.workerId, 'workerId')
      return refuse(executable, platform, 'worker-show')
    },
    async workerRelease(input) {
      required(input.workerId, 'workerId')
      return refuse(executable, platform, 'worker-release')
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
    async reply(input) {
      required(input.runId, 'runId')
      required(input.text, 'text')
      return refuse(executable, platform, 'reply')
    },
    async gateCreate(input) {
      required(input.runId, 'runId')
      required(input.reason, 'reason')
      return refuse(executable, platform, 'gate-create')
    },
    async gateResolve(input) {
      required(input.gateId, 'gateId')
      required(input.resolution, 'resolution')
      return refuse(executable, platform, 'gate-resolve')
    },
  }
}
