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

export interface StatusInput {
  /**
   * Ignored. Dry-run does not copy a run id and does not return a status
   * payload. Live calls ignore this too and still refuse.
   */
  runId?: string
}

export interface TaskListInput {
  /**
   * Live calls require this. Dry-run does not: there is no run yet, and the
   * plan must not invent one. A supplied id is ignored, not returned.
   */
  runId?: string
}

export interface WorkerShowInput {
  /**
   * Live calls require this. Dry-run does not take a worker id and does not
   * invent one. A supplied id is ignored, not returned.
   */
  workerId?: string
}

export interface WorkerReleaseInput {
  /**
   * Live calls require this. Dry-run does not take a worker id and does not
   * invent one. A supplied id is ignored, not returned.
   */
  workerId?: string
}

export interface ReplyInput {
  /**
   * Live calls require this. Dry-run does not: there is no run yet, and the
   * plan must not invent one. A supplied id is ignored, not returned.
   */
  runId?: string
  /**
   * Dry-run records this text. It is the planned worker answer, not a
   * message id and not the human PR yes.
   */
  text: string
}

/** Commands a dry-run records. Other commands still reject. */
export type PlannedOrcaCommand =
  | 'run-create'
  | 'task-create'
  | 'worker-start'
  | 'check'
  | 'status'
  | 'task-list'
  | 'worker-show'
  | 'worker-release'
  | 'reply'

/**
 * A plan, not a live Orca result. `dryRun` is always true. There is no run
 * id, task id, worker id, message id, exit code, or status payload on this object.
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
  /** Plans recorded by dry-run dispatch, check, observation, reply, and worker-release. Empty when `dryRun` is false. */
  readonly planned: readonly PlannedOrcaCall[]
  /**
   * Dry-run resolves a plan and does not require the CLI. The plan has no
   * run id and no status payload. Otherwise the promise rejects with
   * not-configured or not-implemented.
   */
  status(input?: StatusInput): Promise<PlannedOrcaCall>
  /**
   * Dry-run resolves a plan and does not require the CLI. Otherwise the
   * promise rejects with not-configured or not-implemented and never
   * resolves a run id.
   */
  runCreate(input: RunCreateInput): Promise<PlannedOrcaCall>
  taskCreate(input: TaskCreateInput): Promise<PlannedOrcaCall>
  /**
   * Dry-run resolves a plan and does not require the CLI or a run id.
   * Otherwise the promise rejects with not-configured or not-implemented
   * and never resolves a task list.
   */
  taskList(input?: TaskListInput): Promise<PlannedOrcaCall>
  workerStart(input: WorkerStartInput): Promise<PlannedOrcaCall>
  /**
   * Dry-run resolves a plan and does not require the CLI or a worker id.
   * Otherwise the promise rejects with not-configured or not-implemented
   * and never resolves a worker record.
   */
  workerShow(input?: WorkerShowInput): Promise<PlannedOrcaCall>
  /**
   * Dry-run resolves a plan and does not require the CLI or a worker id.
   * Otherwise the promise rejects with not-configured or not-implemented
   * and never resolves a worker id.
   */
  workerRelease(input?: WorkerReleaseInput): Promise<PlannedOrcaCall>
  /**
   * Dry-run resolves a plan with the caller's converged flag and does not
   * require the CLI or a run id. Otherwise the promise rejects with
   * not-configured or not-implemented and never resolves a run id.
   */
  check(input: CheckInput): Promise<PlannedOrcaCall>
  /**
   * Dry-run resolves a plan with the answer text and does not require the
   * CLI or a run id. Otherwise the promise rejects with not-configured or
   * not-implemented and never resolves a message id. This is not a human
   * PR approval.
   */
  reply(input: ReplyInput): Promise<PlannedOrcaCall>
  gateCreate(input: { runId: string; reason: string }): Promise<never>
  gateResolve(input: { gateId: string; resolution: string }): Promise<never>
}
