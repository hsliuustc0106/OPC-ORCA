import { OrcaNotConfiguredError, OrcaStubError } from './errors.ts'
import { resolveOrcaExecutable, type ResolveOptions } from './resolve.ts'
import type {
  OrcaAdapter,
  OrcaCommand,
  OrcaWorker,
  OrcaWorktree,
  RunCreateInput,
  TaskCreateInput,
  WorkerStartInput,
} from './types.ts'

/**
 * TODO(orca-cli): when a command is wired, spawn the resolved binary
 * (`orca`, or `orca-ide` on Linux) as `[bin, command, …]` and parse its
 * stdout. Do not add a process spawn until that parser exists, and never
 * synthesize a run id, task id, gate id, or exit code 0.
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

function required(value: string, label: string): void {
  if (value.trim().length === 0) throw new TypeError(`${label} is required`)
}

function defaultWorker(worker: OrcaWorker | undefined, worktree: OrcaWorktree | undefined): void {
  if (worker !== undefined && worker !== 'dsh') {
    throw new TypeError('v0 worker is dsh only')
  }
  if (worktree !== undefined && worktree !== 'new-child') {
    throw new TypeError('v0 worktree is new-child only')
  }
}

export function createOrcaAdapter(options: ResolveOptions = {}): OrcaAdapter {
  const platform = options.platform ?? process.platform
  const executable = resolveOrcaExecutable({ env: options.env, platform })

  return {
    executable,
    async status() {
      return refuse(executable, platform, 'status')
    },
    async runCreate(input: RunCreateInput) {
      required(input.goal, 'goal')
      required(input.repo, 'repo')
      if (input.baseRef !== undefined) required(input.baseRef, 'baseRef')
      return refuse(executable, platform, 'run-create')
    },
    async taskCreate(input: TaskCreateInput) {
      required(input.runId, 'runId')
      required(input.title, 'title')
      defaultWorker(input.worker, input.worktree)
      return refuse(executable, platform, 'task-create')
    },
    async taskList(input) {
      required(input.runId, 'runId')
      return refuse(executable, platform, 'task-list')
    },
    async workerStart(input: WorkerStartInput) {
      required(input.taskId, 'taskId')
      defaultWorker(input.worker, input.worktree)
      return refuse(executable, platform, 'worker-start')
    },
    async workerShow(input) {
      required(input.workerId, 'workerId')
      return refuse(executable, platform, 'worker-show')
    },
    async workerRelease(input) {
      required(input.workerId, 'workerId')
      return refuse(executable, platform, 'worker-release')
    },
    async check(input) {
      required(input.runId, 'runId')
      return refuse(executable, platform, 'check')
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
