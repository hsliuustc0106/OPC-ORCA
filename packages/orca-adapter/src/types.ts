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
  runId: string
  title: string
  worker?: OrcaWorker
  worktree?: OrcaWorktree
}

export interface WorkerStartInput {
  taskId: string
  worker?: OrcaWorker
  worktree?: OrcaWorktree
}

export interface OrcaAdapter {
  /** Absolute path of the resolved binary, or null when nothing is configured. */
  readonly executable: string | null
  status(): Promise<never>
  runCreate(input: RunCreateInput): Promise<never>
  taskCreate(input: TaskCreateInput): Promise<never>
  taskList(input: { runId: string }): Promise<never>
  workerStart(input: WorkerStartInput): Promise<never>
  workerShow(input: { workerId: string }): Promise<never>
  workerRelease(input: { workerId: string }): Promise<never>
  check(input: { runId: string }): Promise<never>
  reply(input: { runId: string; text: string }): Promise<never>
  gateCreate(input: { runId: string; reason: string }): Promise<never>
  gateResolve(input: { gateId: string; resolution: string }): Promise<never>
}
