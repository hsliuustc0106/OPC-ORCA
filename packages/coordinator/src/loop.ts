import { DuplicateVerdictError, IllegalTransitionError, InvalidVerdictError } from './errors.ts'
import {
  DEFAULT_WORKER,
  DEFAULT_WORKTREE,
  type Difficulty,
  type DigSnapshot,
  type DigState,
  type HumanDecision,
  type Intent,
  type PrAction,
  type Verdict,
} from './states.ts'

export interface DigLoop {
  readonly state: DigState
  snapshot(): DigSnapshot
  acceptGoal(goal: string): void
  triage(result: { agentReady: boolean; difficulty?: Difficulty; reason?: string }): void
  /** Easy tasks only. Skips Orca dispatch and lands in `converging`. */
  runDirect(): void
  /** Normal tasks only. Records `run-create` and `task-create`. Does not call Orca. */
  bindRun(): void
  /** Records `worker-start` for dsh in a new-child worktree. Does not spawn a worker. */
  startWorker(): void
  /** Check loop. `converged: true` enters `converging`; otherwise stays in `waiting`. */
  check(result: { converged: boolean }): void
  /** Stop for a human. Requires one verdict for `sha`. Does not open a pull request. */
  askHumanPr(input: { sha: string; verdict: Verdict }): void
  /**
   * Replace the verdict when a new commit changed the tip.
   * Same SHA throws. State stays `awaiting_human_pr`.
   */
  noteVerdict(verdict: Verdict): void
  /**
   * Record the human's yes or no. Does not perform the GitHub write.
   * `yes` requires `open`, `update`, or `merge`.
   */
  humanPrDecision(answer: 'yes' | 'no', action?: PrAction): void
}

const VERDICT_OUTCOMES = new Set(['PASS', 'FAIL', 'INC'])

function normalizeVerdict(verdict: Verdict, previous: Verdict | null): Verdict {
  const sha = verdict.sha.trim()
  const writtenBy = verdict.writtenBy.trim()
  if (sha.length === 0) throw new InvalidVerdictError('Verdict requires a tip SHA')
  if (writtenBy.length === 0) throw new InvalidVerdictError('Written-by is required')
  if (!VERDICT_OUTCOMES.has(verdict.outcome)) {
    throw new InvalidVerdictError('Verdict outcome must be PASS, FAIL, or INC')
  }
  if (previous && previous.sha === sha) throw new DuplicateVerdictError(sha)
  return { outcome: verdict.outcome, sha, writtenBy }
}

export function createDigLoop(): DigLoop {
  let state: DigState = 'intake'
  let goal: string | null = null
  let difficulty: Difficulty | null = null
  let path: DigSnapshot['path'] = null
  const intents: Intent[] = []
  let tipSha: string | null = null
  let verdict: Verdict | null = null
  let humanDecision: HumanDecision | null = null
  let stopReason: string | null = null

  const need = (expected: readonly DigState[], action: string): void => {
    if (!expected.includes(state)) throw new IllegalTransitionError(state, action)
  }

  const snapshot = (): DigSnapshot => ({
    state,
    goal,
    difficulty,
    path,
    intents: intents.map((intent) => ({ command: intent.command, args: { ...intent.args } })),
    tipSha,
    verdict: verdict ? { ...verdict } : null,
    humanDecision: humanDecision ? { ...humanDecision } : null,
    githubWritePerformed: false,
    stopReason,
  })

  return {
    get state() {
      return state
    },
    snapshot,
    acceptGoal(next: string) {
      need(['intake'], 'accept a goal')
      const trimmed = next.trim()
      if (trimmed.length === 0) throw new TypeError('goal is empty')
      goal = trimmed
      state = 'triage'
    },
    triage(result) {
      need(['triage'], 'triage')
      if (!result.agentReady) {
        stopReason = result.reason?.trim() || 'needs-human'
        state = 'done'
        return
      }
      if (result.difficulty !== 'easy' && result.difficulty !== 'normal') {
        throw new TypeError('agent-ready triage requires difficulty easy or normal')
      }
      difficulty = result.difficulty
      state = 'plan'
    },
    runDirect() {
      need(['plan'], 'take the coordinator-direct path')
      if (difficulty !== 'easy') {
        throw new IllegalTransitionError(state, 'take the coordinator-direct path for a normal task')
      }
      path = 'coordinator-direct'
      intents.push({ command: 'coordinator-direct', args: { worker: 'none' } })
      state = 'converging'
    },
    bindRun() {
      need(['plan'], 'bind an Orca run')
      if (difficulty !== 'normal') {
        throw new IllegalTransitionError(state, 'bind an Orca run for an easy task')
      }
      if (!goal) throw new IllegalTransitionError(state, 'bind an Orca run without a goal')
      path = 'orca-worker'
      intents.push({ command: 'run-create', args: { goal, base: 'origin/main' } })
      intents.push({
        command: 'task-create',
        args: { worker: DEFAULT_WORKER, worktree: DEFAULT_WORKTREE },
      })
      state = 'run_bound'
    },
    startWorker() {
      need(['run_bound'], 'start a worker')
      intents.push({
        command: 'worker-start',
        args: { worker: DEFAULT_WORKER, worktree: DEFAULT_WORKTREE },
      })
      state = 'dispatched'
    },
    check(result) {
      need(['dispatched', 'waiting'], 'check')
      intents.push({ command: 'check', args: { converged: result.converged ? 'true' : 'false' } })
      state = result.converged ? 'converging' : 'waiting'
    },
    askHumanPr(input) {
      need(['converging'], 'ask a human about the pull request')
      const next = normalizeVerdict(input.verdict, verdict)
      if (next.sha !== input.sha.trim()) {
        throw new InvalidVerdictError('verdict SHA must match the tip SHA')
      }
      verdict = next
      tipSha = next.sha
      state = 'awaiting_human_pr'
    },
    noteVerdict(next) {
      need(['awaiting_human_pr'], 'replace the verdict')
      verdict = normalizeVerdict(next, verdict)
      tipSha = verdict.sha
    },
    humanPrDecision(answer, action) {
      need(['awaiting_human_pr'], 'record a human PR decision')
      if (answer === 'yes') {
        if (action !== 'open' && action !== 'update' && action !== 'merge') {
          throw new TypeError('human yes requires an action: open, update, or merge')
        }
        humanDecision = { answer: 'yes', action }
        stopReason = null
      } else if (answer === 'no') {
        humanDecision = { answer: 'no', action: null }
        stopReason = 'human declined PR action'
      } else {
        throw new TypeError('human decision must be yes or no')
      }
      state = 'done'
    },
  }
}
