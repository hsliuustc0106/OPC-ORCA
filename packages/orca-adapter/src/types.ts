/**
 * Subcommands the adapter can spawn when live is on.
 * Flag spellings live in `src/cli.ts` (`orcaCliConfirmTodo`). They were
 * confirmed against Orca desktop 1.4.240. They are not a guessed success.
 */
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

/**
 * v0 knows one agent and one worktree layout. Anything else is rejected.
 * Live `worker-start` passes the agent as `--agent` (value `dsh`) and the
 * worktree as `--worktree`. In-repo docs name that agent `dsh`.
 */
export type OrcaWorker = 'dsh'
export type OrcaWorktree = 'new-child'

export interface RunCreateInput {
  /** Product goal. Live passes this as `--objective`. */
  goal: string
  /**
   * Product binding. Required so a plan names the repo. Orca 1.4.240
   * `orchestration run-create` has no `--repo`. This value is not a CLI flag.
   */
  repo: string
  /**
   * Product binding. The coordinator passes `origin/main`. Orca 1.4.240
   * `orchestration run-create` has no `--base`. This value is not a CLI flag.
   */
  baseRef?: string
}

export interface TaskCreateInput {
  /**
   * Live calls require this. Dry-run does not: there is no run yet, and the
   * plan must not invent one. A supplied id is ignored, not returned.
   * Live passes it as `--run`.
   */
  runId?: string
  /**
   * Task spec (the goal text). Live passes this as `--spec`. It is not a
   * `--task-title`. Worker and worktree are not task-create fields.
   */
  spec: string
}

export interface WorkerStartInput {
  /**
   * Live calls require this. Dry-run does not take a task id and does not
   * invent one. A supplied id is ignored, not returned. Live passes it as
   * `--task`.
   */
  taskId?: string
  /**
   * Live passes this as `--run` when set. Dry-run does not copy it.
   */
  runId?: string
  /** Live passes this as `--agent`. Default `dsh`. */
  worker?: OrcaWorker
  /** Live passes this as `--worktree`. Default `new-child`. */
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
   * result. Live calls do not copy it: stdout must print `converged:`.
   */
  converged?: boolean
}

export interface StatusInput {
  /**
   * Ignored. Dry-run does not copy a run id and does not return a status
   * payload. Live calls do not copy it either. Status stdout must print
   * `status:`; a run id is returned only when stdout prints `run-id:`.
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
   * Live passes it as `--run`.
   */
  runId?: string
  /**
   * Live calls require this. It is the desktop id of the message being
   * answered (`--id`). Dry-run does not copy it. The adapter does not
   * invent one.
   */
  messageId?: string
  /**
   * Dry-run records this text. Live passes it as `--body`. It is the planned
   * worker answer, not a message id and not the human PR yes.
   */
  text: string
}

export interface GateCreateInput {
  /**
   * Live calls require this. It is the task id from task-create, passed as
   * `--task`. Desktop `gate-create` has no `--run`. Dry-run does not copy
   * it. The adapter does not invent one.
   */
  taskId?: string
  /**
   * Dry-run records this reason. Live passes it as `--question`. It is the
   * planned backend gate, not a gate id and not the human PR yes.
   */
  reason: string
}

export interface GateResolveInput {
  /**
   * Live calls require this. Dry-run does not take a gate id and does not
   * invent one. A supplied id is ignored, not returned.
   */
  gateId?: string
  /**
   * Dry-run records this resolution. It is a backend decision for a worker
   * or task, not a gate id, not an exit code, and not the human PR yes.
   */
  resolution: string
}

/** Commands a dry-run records. */
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
  | 'gate-create'
  | 'gate-resolve'

/**
 * A plan, not a live Orca result. `dryRun` is always true. There is no run
 * id, task id, worker id, message id, gate id, exit code, or status payload
 * on this object.
 */
export interface PlannedOrcaCall {
  readonly dryRun: true
  readonly command: PlannedOrcaCommand
  readonly args: Readonly<Record<string, string>>
}

/**
 * Ids copied from live stdout. A key is present only when that field was
 * parsed. Absent keys are not filled from the caller's arguments.
 */
export interface LiveOrcaIds {
  runId?: string
  taskId?: string
  workerId?: string
  messageId?: string
  gateId?: string
}

/**
 * A live CLI result. `exitCode` is 0 only because the process exited 0.
 * `ids` come from stdout. This is not a dry-run plan and not a human PR yes.
 */
export interface LiveOrcaCall {
  readonly dryRun: false
  readonly live: true
  readonly command: OrcaCommand
  readonly exitCode: 0
  readonly ids: Readonly<LiveOrcaIds>
  readonly fields: Readonly<Record<string, string>>
}

export type OrcaCallResult = PlannedOrcaCall | LiveOrcaCall

export interface OrcaAdapter {
  /** Absolute path of the resolved binary, or null when nothing is configured. */
  readonly executable: string | null
  /** True only when this adapter was created with `dryRun`. */
  readonly dryRun: boolean
  /**
   * True only when this adapter will spawn. Dry-run forces this false.
   * Off unless `live: true` or `OPC_ORCA_LIVE=1`.
   */
  readonly live: boolean
  /** Plans recorded by dry-run dispatch, check, observation, reply, worker-release, and backend gates. Empty when `dryRun` is false. */
  readonly planned: readonly PlannedOrcaCall[]
  /**
   * Dry-run resolves a plan and does not require the CLI. The plan has no
   * run id and no status payload. With live off, the promise rejects with
   * not-configured or not-implemented. With live on, it spawns and rejects
   * with not-configured, spawn-failed, or unparseable instead of inventing
   * a status payload.
   */
  status(input?: StatusInput): Promise<OrcaCallResult>
  /**
   * Dry-run resolves a plan and does not require the CLI. With live off, the
   * promise rejects and never resolves a run id. With live on, a run id is
   * returned only when stdout prints `run-id:`.
   */
  runCreate(input: RunCreateInput): Promise<OrcaCallResult>
  taskCreate(input: TaskCreateInput): Promise<OrcaCallResult>
  /**
   * Dry-run resolves a plan and does not require the CLI or a run id.
   * With live off, the promise rejects and never resolves a task list.
   * With live on, `tasks:` must be printed; a task id is not invented.
   */
  taskList(input?: TaskListInput): Promise<OrcaCallResult>
  workerStart(input: WorkerStartInput): Promise<OrcaCallResult>
  /**
   * Dry-run resolves a plan and does not require the CLI or a worker id.
   * With live off, the promise rejects and never resolves a worker record.
   * With live on, a worker id is returned only when stdout prints `worker-id:`.
   */
  workerShow(input?: WorkerShowInput): Promise<OrcaCallResult>
  /**
   * Dry-run resolves a plan and does not require the CLI or a worker id.
   * With live off, the promise rejects and never resolves a worker id.
   * With live on, a worker id is returned only when stdout prints `worker-id:`.
   */
  workerRelease(input?: WorkerReleaseInput): Promise<OrcaCallResult>
  /**
   * Dry-run resolves a plan with the caller's converged flag and does not
   * require the CLI or a run id. With live off, the promise rejects and
   * never resolves a run id. With live on, `converged:` must be printed;
   * the caller's flag is not copied.
   */
  check(input: CheckInput): Promise<OrcaCallResult>
  /**
   * Dry-run resolves a plan with the answer text and does not require the
   * CLI or a run id. With live off, the promise rejects and never resolves
   * a message id. With live on, a message id is returned only when stdout
   * prints `message-id:`. This is not a human PR approval.
   */
  reply(input: ReplyInput): Promise<OrcaCallResult>
  /**
   * Dry-run resolves a plan with the reason and does not require the CLI
   * or a run id. With live off, the promise rejects and never resolves a
   * gate id. With live on, a gate id is returned only when stdout prints
   * `gate-id:`. This is an Orca backend gate, not a human PR approval.
   */
  gateCreate(input: GateCreateInput): Promise<OrcaCallResult>
  /**
   * Dry-run resolves a plan with the resolution and does not require the
   * CLI or a gate id. With live off, the promise rejects and never resolves
   * a gate id or an exit code. With live on, exit 0 is returned only when
   * the process exited 0, and a gate id only when stdout prints `gate-id:`.
   * This is an Orca backend gate, not a human PR approval.
   */
  gateResolve(input: GateResolveInput): Promise<OrcaCallResult>
}

/** Adapter created with `dryRun: true`. Every call resolves a plan and does not spawn. */
export interface DryRunOrcaAdapter extends OrcaAdapter {
  readonly dryRun: true
  readonly live: false
  status(input?: StatusInput): Promise<PlannedOrcaCall>
  runCreate(input: RunCreateInput): Promise<PlannedOrcaCall>
  taskCreate(input: TaskCreateInput): Promise<PlannedOrcaCall>
  taskList(input?: TaskListInput): Promise<PlannedOrcaCall>
  workerStart(input: WorkerStartInput): Promise<PlannedOrcaCall>
  workerShow(input?: WorkerShowInput): Promise<PlannedOrcaCall>
  workerRelease(input?: WorkerReleaseInput): Promise<PlannedOrcaCall>
  check(input: CheckInput): Promise<PlannedOrcaCall>
  reply(input: ReplyInput): Promise<PlannedOrcaCall>
  gateCreate(input: GateCreateInput): Promise<PlannedOrcaCall>
  gateResolve(input: GateResolveInput): Promise<PlannedOrcaCall>
}
