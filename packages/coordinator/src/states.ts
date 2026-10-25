export const DIG_STATES = [
  'intake',
  'triage',
  'plan',
  'run_bound',
  'dispatched',
  'waiting',
  'converging',
  'awaiting_human_pr',
  'done',
] as const

export type DigState = (typeof DIG_STATES)[number]

export type Difficulty = 'easy' | 'normal'
export type PrAction = 'open' | 'update' | 'merge'
export type VerdictOutcome = 'PASS' | 'FAIL' | 'INC'
export type DigPath = 'coordinator-direct' | 'orca-worker'

export interface Verdict {
  outcome: VerdictOutcome
  sha: string
  /** Bot or role name. Rendered as the `Written-by:` line. The implementer is not this writer. */
  writtenBy: string
}

export interface Intent {
  command: string
  args: Readonly<Record<string, string>>
}

export interface HumanDecision {
  answer: 'yes' | 'no'
  action: PrAction | null
}

export interface DigSnapshot {
  state: DigState
  goal: string | null
  difficulty: Difficulty | null
  path: DigPath | null
  intents: readonly Intent[]
  tipSha: string | null
  verdict: Verdict | null
  humanDecision: HumanDecision | null
  /**
   * Fixed false. This package never opens, updates, or merges a pull request.
   * A human yes only fills `humanDecision`.
   */
  githubWritePerformed: false
  stopReason: string | null
}

/** Agent and worktree on the worker-start dry-run plan. Live passes `dsh` as `--agent`. */
export const DEFAULT_WORKER = 'dsh'
export const DEFAULT_WORKTREE = 'new-child'
