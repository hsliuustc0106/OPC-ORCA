import { createOrcaAdapter, type OrcaAdapter, type PlannedOrcaCall } from '@opc-orca/orca-adapter'

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
  /**
   * Normal tasks only. Calls the adapter for `run-create` and `task-create`.
   * State guards throw before the promise. A dry-run plan is stored only
   * after both calls resolve. A live rejection leaves the state on `plan`.
   */
  bindRun(): Promise<void>
  /**
   * Calls the adapter for `worker-start` (dsh, new-child). Does not spawn.
   * A rejection leaves the state on `run_bound`.
   */
  startWorker(): Promise<void>
  /**
   * Waiting-loop check. Calls the adapter's `check`. A dry-run plan is stored
   * only after the call resolves; that plan's converged flag picks `waiting`
   * or `converging`. A rejection leaves the state on `dispatched` or `waiting`
   * and is not a converged tip. Does not invent a run id.
   */
  check(result: { converged: boolean }): Promise<void>
  /**
   * Observation while `waiting`. Calls the adapter's `status` in dry-run and
   * records that plan. Does not change state. Not a check and not convergence.
   * A rejection leaves the state on `waiting` and stores no status intent.
   * Does not invent a run id or a status payload.
   */
  status(): Promise<void>
  /**
   * Observation while `waiting`. Calls the adapter's `task-list` in dry-run.
   * Same failure rules as `status`. Not a substitute for `check`.
   */
  taskList(): Promise<void>
  /**
   * Observation while `waiting`. Calls the adapter's `worker-show` in dry-run.
   * Same failure rules as `status`. Not a substitute for `check`.
   */
  workerShow(): Promise<void>
  /**
   * Answer a worker ask while `waiting`. Calls the adapter's `reply` in
   * dry-run and records the answer text. Does not change state. Not a check,
   * not convergence, and not the human PR yes: it must not enter
   * `awaiting_human_pr`. A rejection leaves the state on `waiting` and
   * stores no reply intent. Does not invent a run id or a message id.
   */
  reply(input: { text: string }): Promise<void>
  /**
   * After `converging` on the Orca worker path (the worker is done with its
   * tip). Calls the adapter's `worker-release` in dry-run and records that
   * plan. Does not change state and does not open a pull request. A
   * rejection leaves the state on `converging` and stores no release intent.
   * Does not invent a worker id. The coordinator-direct path has no worker.
   */
  workerRelease(): Promise<void>
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

export interface DigLoopOptions {
  /**
   * Adapter for normal-task dispatch, the waiting-loop check, observation
   * (`status`, `task-list`, `worker-show`), `reply` while waiting, and
   * `worker-release` after converging. Default: dry-run, no binary required.
   * A live adapter is called the same way and must reject; the loop does not
   * invent a run id from that rejection. A rejected check is not converged.
   * A rejected observation is not a successful read. A rejected reply is not
   * an answer and is not the human PR yes. A rejected worker-release is not
   * a released worker.
   */
  adapter?: OrcaAdapter
  /** Repository passed to run-create. Required before `bindRun`. */
  repo?: string
}

const FABRICATED_ID = /^(runId|taskId|workerId|messageId|exitCode)$/

function toIntent(call: PlannedOrcaCall): Intent {
  return { command: call.command, args: { ...call.args } }
}

/** A dry-run plan is the only adapter result this loop may store. */
function requireDryPlan(call: PlannedOrcaCall, command: PlannedOrcaCall['command']): void {
  if (call.dryRun !== true || call.command !== command) {
    throw new TypeError('refusing to treat an Orca result as success')
  }
  for (const key of Object.keys(call.args)) {
    if (FABRICATED_ID.test(key)) throw new TypeError('refusing a fabricated Orca id')
  }
  if (command === 'run-create') {
    if (call.args.base !== 'origin/main') {
      throw new TypeError('dry-run run-create must record base origin/main')
    }
    return
  }
  if (command === 'check') {
    if (call.args.converged !== 'true' && call.args.converged !== 'false') {
      throw new TypeError('dry-run check must record converged true or false')
    }
    return
  }
  if (command === 'status' || command === 'task-list' || command === 'worker-show') {
    if (Object.keys(call.args).length !== 0) {
      throw new TypeError('dry-run observation must not record an id or a status payload')
    }
    return
  }
  if (command === 'worker-release') {
    if (Object.keys(call.args).length !== 0) {
      throw new TypeError('dry-run worker-release must not record a worker id or a payload')
    }
    return
  }
  if (command === 'reply') {
    const text = call.args.text
    if (Object.keys(call.args).length !== 1 || text === undefined || text.trim().length === 0) {
      throw new TypeError('dry-run reply must record the answer text and no id')
    }
    return
  }
  if (call.args.worker !== DEFAULT_WORKER || call.args.worktree !== DEFAULT_WORKTREE) {
    throw new TypeError('dry-run plan must use worker dsh and worktree new-child')
  }
}

export function createDigLoop(options: DigLoopOptions = {}): DigLoop {
  const adapter = options.adapter ?? createOrcaAdapter({ dryRun: true })
  const repo = options.repo?.trim() ?? ''
  let state: DigState = 'intake'
  let goal: string | null = null
  let difficulty: Difficulty | null = null
  let path: DigSnapshot['path'] = null
  const intents: Intent[] = []
  let tipSha: string | null = null
  let verdict: Verdict | null = null
  let humanDecision: HumanDecision | null = null
  let stopReason: string | null = null
  let adapterBusy = false

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

  const observe = (
    command: 'status' | 'task-list' | 'worker-show',
    action: string,
    call: () => Promise<PlannedOrcaCall>,
  ): Promise<void> => {
    need(['waiting'], action)
    if (adapterBusy) {
      throw new IllegalTransitionError(state, `${action} while another adapter call is in flight`)
    }
    adapterBusy = true
    return (async () => {
      try {
        const observed = await call()
        requireDryPlan(observed, command)
        intents.push(toIntent(observed))
      } finally {
        adapterBusy = false
      }
    })()
  }

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
      if (repo.length === 0) throw new TypeError('repo is required to bind an Orca run')
      if (adapterBusy) {
        throw new IllegalTransitionError(state, 'bind an Orca run while another adapter call is in flight')
      }
      const goalText = goal
      adapterBusy = true
      return (async () => {
        try {
          const run = await adapter.runCreate({ goal: goalText, repo, baseRef: 'origin/main' })
          requireDryPlan(run, 'run-create')
          const task = await adapter.taskCreate({
            title: goalText,
            worker: DEFAULT_WORKER,
            worktree: DEFAULT_WORKTREE,
          })
          requireDryPlan(task, 'task-create')
          path = 'orca-worker'
          intents.push(toIntent(run), toIntent(task))
          state = 'run_bound'
        } finally {
          adapterBusy = false
        }
      })()
    },
    startWorker() {
      need(['run_bound'], 'start a worker')
      if (adapterBusy) {
        throw new IllegalTransitionError(state, 'start a worker while another adapter call is in flight')
      }
      adapterBusy = true
      return (async () => {
        try {
          const started = await adapter.workerStart({
            worker: DEFAULT_WORKER,
            worktree: DEFAULT_WORKTREE,
          })
          requireDryPlan(started, 'worker-start')
          intents.push(toIntent(started))
          state = 'dispatched'
        } finally {
          adapterBusy = false
        }
      })()
    },
    check(result) {
      need(['dispatched', 'waiting'], 'check')
      if (typeof result.converged !== 'boolean') throw new TypeError('converged must be true or false')
      if (adapterBusy) {
        throw new IllegalTransitionError(state, 'check while another adapter call is in flight')
      }
      const flag = result.converged ? 'true' : 'false'
      adapterBusy = true
      return (async () => {
        try {
          const checked = await adapter.check({ converged: result.converged })
          requireDryPlan(checked, 'check')
          if (checked.args.converged !== flag) {
            throw new TypeError('dry-run check plan must record the caller converged flag')
          }
          intents.push(toIntent(checked))
          state = checked.args.converged === 'true' ? 'converging' : 'waiting'
        } finally {
          adapterBusy = false
        }
      })()
    },
    status() {
      return observe('status', 'read status', () => adapter.status())
    },
    taskList() {
      return observe('task-list', 'list tasks', () => adapter.taskList())
    },
    workerShow() {
      return observe('worker-show', 'show a worker', () => adapter.workerShow())
    },
    reply(input) {
      need(['waiting'], 'reply to a worker')
      if (typeof input?.text !== 'string' || input.text.trim().length === 0) {
        throw new TypeError('reply text is required')
      }
      if (adapterBusy) {
        throw new IllegalTransitionError(state, 'reply to a worker while another adapter call is in flight')
      }
      const text = input.text.trim()
      adapterBusy = true
      return (async () => {
        try {
          const answered = await adapter.reply({ text })
          requireDryPlan(answered, 'reply')
          if (answered.args.text !== text) {
            throw new TypeError('dry-run reply plan must record the answer text')
          }
          intents.push(toIntent(answered))
          // State stays waiting. Reply is a worker answer, not the human PR yes.
        } finally {
          adapterBusy = false
        }
      })()
    },
    workerRelease() {
      need(['converging'], 'release a worker')
      if (path !== 'orca-worker') {
        throw new IllegalTransitionError(state, 'release a worker on the coordinator-direct path')
      }
      if (adapterBusy) {
        throw new IllegalTransitionError(state, 'release a worker while another adapter call is in flight')
      }
      adapterBusy = true
      return (async () => {
        try {
          const released = await adapter.workerRelease()
          requireDryPlan(released, 'worker-release')
          intents.push(toIntent(released))
          // State stays converging. Release is not an ask to open, update, or merge.
        } finally {
          adapterBusy = false
        }
      })()
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
