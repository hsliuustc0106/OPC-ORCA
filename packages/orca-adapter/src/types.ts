/** Subcommands this adapter will eventually spawn. Flags are not a CLI contract yet. */
export type OrcaCommand =
  | 'status'
  | 'run-create'
  | 'task-create'
  | 'task-list'
  | 'worker-start'
  | 'worker-show'
  | 'worker-release'
  | 'check'
  | 'reply'
  | 'gate-create'
  | 'gate-resolve'

/** v0 knows one worker and one worktree layout. Anything else is rejected. */
export type OrcaWorker = 'dsh'
export type OrcaWorktree = 'new-child'

export interface RunCreateInput {
  goal: string
  repo: string
  baseRef?: string
}

export interface TaskCreateInput {
  /**
   * Live calls require this. Dry-run does not: there is no run yet, and the
   * plan must not invent one. A supplied id is ignored, not returned.
   */
  runId?: string
  title: string
  worker?: OrcaWorker
  worktree?: OrcaWorktree
}

export interface WorkerStartInput {
  /**
   * Live calls require this. Dry-run does not take a task id and does not
   * invent one. A supplied id is ignored, not returned.
   */
  taskId?: string
  worker?: OrcaWorker
  worktree?: OrcaWorktree
}

export interface CheckInput {
  /**
   * Live calls require this. Dry-run does not: there is no run yet, and the
   * plan must not invent one. A supplied id is ignored, not returned.
   */
  runId?: string
  /**
   * Dry-run records this caller flag as `true` or `false`. It is not an Orca
   * result. Live calls ignore it and still refuse.
   */
  converged?: boolean
}

/** Commands a dry-run records. Other commands still reject. */
export type PlannedOrcaCommand = 'run-create' | 'task-create' | 'worker-start' | 'check'

/**
 * A plan, not a live Orca result. `dryRun` is always true. There is no run
 * id, task id, or exit code on this object.
 */
export interface PlannedOrcaCall {
  readonly dryRun: true
  readonly command: PlannedOrcaCommand
  readonly args: Readonly<Record<string, string>>
}

export interface OrcaAdapter {
  /** Absolute path of the resolved binary, or null when nothing is configured. */
  readonly executable: string | null
  /** True only when this adapter was created with `dryRun`. */
  readonly dryRun: boolean
  /** Plans recorded by dry-run dispatch and check. Empty when `dryRun` is false. */
  readonly planned: readonly PlannedOrcaCall[]
  status(): Promise<never>
  /**
   * Dry-run resolves a plan and does not require the CLI. Otherwise the
   * promise rejects with not-configured or not-implemented and never
   * resolves a run id.
   */
  runCreate(input: RunCreateInput): Promise<PlannedOrcaCall>
  taskCreate(input: TaskCreateInput): Promise<PlannedOrcaCall>
  taskList(input: { runId: string }): Promise<never>
  workerStart(input: WorkerStartInput): Promise<PlannedOrcaCall>
  workerShow(input: { workerId: string }): Promise<never>
  workerRelease(input: { workerId: string }): Promise<never>
  /**
   * Dry-run resolves a plan with the caller's converged flag and does not
   * require the CLI or a run id. Otherwise the promise rejects with
   * not-configured or not-implemented and never resolves a run id.
   */
  check(input: CheckInput): Promise<PlannedOrcaCall>
  reply(input: { runId: string; text: string }): Promise<never>
  gateCreate(input: { runId: string; reason: string }): Promise<never>
  gateResolve(input: { gateId: string; resolution: string }): Promise<never>
}
