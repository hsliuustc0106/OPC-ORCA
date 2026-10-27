import {
  createOrcaAdapter,
  type LiveOrcaCall,
  type LiveOrcaIds,
  type OrcaAdapter,
  type OrcaCallResult,
  type PlannedOrcaCall,
} from '@opc-orca/orca-adapter'

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
   * State guards throw before the promise. Both results are stored only
   * after both calls resolve. A dry-run plan is stored as recorded. A parsed
   * live result stores the run id and task id from stdout and passes that
   * run id into task-create. A throw leaves the state on `plan` and stores
   * neither intent.
   */
  bindRun(): Promise<void>
  /**
   * Calls the adapter for `worker-start` (worker label dsh, worktree new-child).
   * The default adapter does not spawn. A dry-run plan has no task id. A
   * parsed live result stores the worker id and is called with the task id
   * from task-create (`--task`) and the run id (`--run`). Live `--agent` is
   * the operator desktop id. A rejection, including `no-agent` and a
   * non-ready receipt, leaves the state on `run_bound`.
   */
  startWorker(): Promise<void>
  /**
   * Waiting-loop check. Calls the adapter's `check`. A dry-run plan is stored
   * only after the call resolves; that plan's converged flag must match the
   * caller and picks `waiting` or `converging`. A parsed live result stores
   * stdout `converged` (the caller flag is not copied) and picks the same
   * states. A rejection leaves the state on `dispatched` or `waiting` and
   * is not a converged tip. Does not invent a run id.
   */
  check(result: { converged: boolean }): Promise<void>
  /**
   * Observation while `waiting`. Records the adapter result and does not
   * change state. A dry-run plan is the command only. A parsed live result
   * stores the status token. Not a check and not convergence. A rejection
   * leaves the state on `waiting` and stores no status intent. Does not
   * invent a run id or a status payload.
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
   * Answer a worker ask while `waiting`. A dry-run plan records the answer
   * text and no id. A parsed live result records the message id from stdout.
   * Live argv needs the caller's message id (`--id`) and does not invent
   * one. Does not change state. Not a check, not convergence, and not the
   * human PR yes: it must not enter `awaiting_human_pr`. A rejection leaves
   * the state on `waiting` and stores no reply intent. Does not invent a
   * run id or a message id.
   */
  reply(input: { text: string; messageId?: string }): Promise<void>
  /**
   * Open an Orca backend gate while `waiting`. Calls the adapter's
   * `gate-create` and records the reason. Live passes the task id from
   * task-create as `--task` and the reason as `--question`. Does not change
   * state. Not a check, not convergence, and not the human PR yes: it must
   * not enter `awaiting_human_pr`. A rejection leaves the state on `waiting`
   * and stores no gate-create intent. Does not invent a task id or a gate id.
   */
  gateCreate(input: { reason: string }): Promise<void>
  /**
   * Resolve an Orca backend gate while `waiting`. Calls the adapter's
   * `gate-resolve` in dry-run and records the resolution. Does not change
   * state. Not the human PR yes: it must not enter `awaiting_human_pr`, and
   * it does not open, update, or merge a pull request. A rejection leaves
   * the state on `waiting` and stores no gate-resolve intent. Does not
   * invent a gate id or an exit code.
   */
  gateResolve(input: { resolution: string }): Promise<void>
  /**
   * After `converging` on the Orca worker path (the worker is done with its
   * tip). A dry-run plan is the command only. A parsed live result stores
   * the worker id from stdout. Does not change state and does not open a
   * pull request. A rejection leaves the state on `converging` and stores
   * no release intent. Does not invent a worker id. The coordinator-direct
   * path has no worker.
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
   * (`status`, `task-list`, `worker-show`), `reply` while waiting, backend
   * `gate-create` and `gate-resolve` while waiting, and `worker-release`
   * after converging. Default: dry-run, no binary required, even if
   * `OPC_ORCA_LIVE=1` is set in the process environment. A live failure
   * (`not-configured`, `not-implemented`, `no-sender`, `no-agent`, `spawn-failed`, `unparseable`)
   * rejects and does not advance state. A parsed live result stores the
   * ids, status, and converged flag from that result and advances the same
   * states as a dry-run plan. The loop does not invent a run id or a gate
   * id. A rejected check is not converged. A rejected observation is not a
   * successful read. A rejected reply is not an answer and is not the human
   * PR yes. A rejected gate is not a created or resolved backend gate and
   * is not the human PR yes. A rejected worker-release is not a released
   * worker. Nothing here moves `awaiting_human_pr` except `askHumanPr`.
   */
  adapter?: OrcaAdapter
  /** Repository passed to run-create. Required before `bindRun`. */
  repo?: string
}

const FABRICATED_ID = /^(runId|taskId|workerId|messageId|gateId|exitCode)$/

function toIntent(call: PlannedOrcaCall): Intent {
  return { command: call.command, args: { ...call.args } }
}

/** A dry-run plan must match the command and must not carry an Orca id. */
function requireDryPlan(call: OrcaCallResult, command: PlannedOrcaCall['command']): asserts call is PlannedOrcaCall {
  if (call.dryRun !== true || call.command !== command) {
    throw new TypeError('refusing to treat an Orca result as success')
  }
  for (const key of Object.keys(call.args)) {
    if (FABRICATED_ID.test(key)) throw new TypeError('refusing a fabricated Orca id')
  }
  if (command === 'run-create') {
    const goal = call.args.goal
    const repoArg = call.args.repo
    if (
      call.args.base !== 'origin/main' ||
      goal === undefined ||
      goal.trim().length === 0 ||
      repoArg === undefined ||
      repoArg.trim().length === 0
    ) {
      throw new TypeError('dry-run run-create must record goal, repo, and base origin/main')
    }
    return
  }
  if (command === 'task-create') {
    const spec = call.args.spec
    if (Object.keys(call.args).length !== 1 || spec === undefined || spec.trim().length === 0) {
      throw new TypeError('dry-run task-create must record the spec and no id')
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
  if (command === 'gate-create') {
    const reason = call.args.reason
    if (Object.keys(call.args).length !== 1 || reason === undefined || reason.trim().length === 0) {
      throw new TypeError('dry-run gate-create must record the reason and no id')
    }
    return
  }
  if (command === 'gate-resolve') {
    const resolution = call.args.resolution
    if (Object.keys(call.args).length !== 1 || resolution === undefined || resolution.trim().length === 0) {
      throw new TypeError('dry-run gate-resolve must record the resolution and no id')
    }
    return
  }
  if (call.args.worker !== DEFAULT_WORKER || call.args.worktree !== DEFAULT_WORKTREE) {
    throw new TypeError('dry-run plan must use worker dsh and worktree new-child')
  }
}

const LIVE_ID_KEYS = ['runId', 'taskId', 'workerId', 'messageId', 'gateId'] as const

type Accepted =
  | { kind: 'dry'; intent: Intent }
  | { kind: 'live'; intent: Intent; ids: LiveOrcaIds; converged: 'true' | 'false' | null }

function liveId(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim()) {
    throw new TypeError('refusing to treat an Orca result as success')
  }
  return value
}

/**
 * A live result is stored only when the adapter already parsed it
 * (`live`, exit 0, required field present). Ids are copied from that
 * object. A missing field throws and the caller must not advance.
 */
function acceptLive(call: LiveOrcaCall, command: PlannedOrcaCall['command']): Accepted {
  if (call.live !== true || call.exitCode !== 0 || call.fields === undefined) {
    throw new TypeError('refusing to treat an Orca result as success')
  }
  const ids: LiveOrcaIds = {}
  const args: Record<string, string> = {}
  for (const key of LIVE_ID_KEYS) {
    const value = liveId(call.ids?.[key])
    if (value === undefined) continue
    ids[key] = value
    args[key] = value
  }
  let converged: 'true' | 'false' | null = null
  if (command === 'run-create') {
    if (ids.runId === undefined) throw new TypeError('live run-create result is missing runId')
  } else if (command === 'task-create') {
    if (ids.taskId === undefined) throw new TypeError('live task-create result is missing taskId')
  } else if (command === 'worker-start' || command === 'worker-show' || command === 'worker-release') {
    if (ids.workerId === undefined) throw new TypeError('live worker result is missing workerId')
  } else if (command === 'check') {
    const value = call.fields.converged
    if (value !== 'true' && value !== 'false') throw new TypeError('live check result is missing converged')
    args.converged = value
    converged = value
  } else if (command === 'status') {
    const value = call.fields.status
    if (typeof value !== 'string' || value.length === 0) throw new TypeError('live status result is missing status')
    args.status = value
  } else if (command === 'task-list') {
    const value = call.fields.tasks
    if (typeof value !== 'string' || value.length === 0) throw new TypeError('live task-list result is missing tasks')
    args.tasks = value
  } else if (command === 'reply') {
    if (ids.messageId === undefined) throw new TypeError('live reply result is missing messageId')
  } else if (command === 'gate-create' || command === 'gate-resolve') {
    if (ids.gateId === undefined) throw new TypeError('live gate result is missing gateId')
  }
  return { kind: 'live', intent: { command, args }, ids, converged }
}

/** Dry-run plans stay as recorded. A parsed live result is accepted. Anything else throws. */
function acceptResult(call: OrcaCallResult, command: PlannedOrcaCall['command']): Accepted {
  if (call.command !== command) throw new TypeError('refusing to treat an Orca result as success')
  if (call.dryRun === true) {
    requireDryPlan(call, command)
    return { kind: 'dry', intent: toIntent(call) }
  }
  if (call.dryRun !== false || call.live !== true) {
    throw new TypeError('refusing to treat an Orca result as success')
  }
  return acceptLive(call, command)
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
  /** Ids copied from parsed live results. Dry-run never fills these. */
  const bound: { runId?: string; taskId?: string; workerId?: string; gateId?: string } = {}

  const remember = (ids: LiveOrcaIds): void => {
    if (ids.runId !== undefined) bound.runId = ids.runId
    if (ids.taskId !== undefined) bound.taskId = ids.taskId
    if (ids.workerId !== undefined) bound.workerId = ids.workerId
    if (ids.gateId !== undefined) bound.gateId = ids.gateId
  }

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
    call: () => Promise<OrcaCallResult>,
  ): Promise<void> => {
    need(['waiting'], action)
    if (adapterBusy) {
      throw new IllegalTransitionError(state, `${action} while another adapter call is in flight`)
    }
    adapterBusy = true
    return (async () => {
      try {
        const observed = await call()
        const accepted = acceptResult(observed, command)
        if (accepted.kind === 'live') remember(accepted.ids)
        intents.push(accepted.intent)
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
          const runAccepted = acceptResult(run, 'run-create')
          const task = await adapter.taskCreate({
            spec: goalText,
            ...(runAccepted.kind === 'live' && runAccepted.ids.runId !== undefined
              ? { runId: runAccepted.ids.runId }
              : {}),
          })
          const taskAccepted = acceptResult(task, 'task-create')
          if (runAccepted.kind === 'live') remember(runAccepted.ids)
          if (taskAccepted.kind === 'live') remember(taskAccepted.ids)
          path = 'orca-worker'
          intents.push(runAccepted.intent, taskAccepted.intent)
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
            ...(bound.taskId !== undefined ? { taskId: bound.taskId } : {}),
            ...(bound.runId !== undefined ? { runId: bound.runId } : {}),
          })
          const accepted = acceptResult(started, 'worker-start')
          if (accepted.kind === 'live') remember(accepted.ids)
          intents.push(accepted.intent)
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
          const checked = await adapter.check({
            converged: result.converged,
            ...(bound.runId !== undefined ? { runId: bound.runId } : {}),
          })
          const accepted = acceptResult(checked, 'check')
          if (accepted.kind === 'dry') {
            if (checked.dryRun !== true || checked.args.converged !== flag) {
              throw new TypeError('dry-run check plan must record the caller converged flag')
            }
            intents.push(accepted.intent)
            state = checked.args.converged === 'true' ? 'converging' : 'waiting'
            return
          }
          if (accepted.converged !== 'true' && accepted.converged !== 'false') {
            throw new TypeError('live check result is missing converged')
          }
          remember(accepted.ids)
          intents.push(accepted.intent)
          state = accepted.converged === 'true' ? 'converging' : 'waiting'
        } finally {
          adapterBusy = false
        }
      })()
    },
    status() {
      return observe('status', 'read status', () => adapter.status())
    },
    taskList() {
      return observe('task-list', 'list tasks', () =>
        bound.runId !== undefined ? adapter.taskList({ runId: bound.runId }) : adapter.taskList(),
      )
    },
    workerShow() {
      return observe('worker-show', 'show a worker', () =>
        bound.workerId !== undefined ? adapter.workerShow({ workerId: bound.workerId }) : adapter.workerShow(),
      )
    },
    reply(input) {
      need(['waiting'], 'reply to a worker')
      if (typeof input?.text !== 'string' || input.text.trim().length === 0) {
        throw new TypeError('reply text is required')
      }
      let messageId: string | undefined
      if (input.messageId !== undefined) {
        if (typeof input.messageId !== 'string') throw new TypeError('reply message id is empty')
        messageId = input.messageId.trim()
        if (messageId.length === 0) throw new TypeError('reply message id is empty')
      }
      if (adapterBusy) {
        throw new IllegalTransitionError(state, 'reply to a worker while another adapter call is in flight')
      }
      const text = input.text.trim()
      adapterBusy = true
      return (async () => {
        try {
          const answered = await adapter.reply({
            text,
            ...(messageId !== undefined ? { messageId } : {}),
            ...(bound.runId !== undefined ? { runId: bound.runId } : {}),
          })
          const accepted = acceptResult(answered, 'reply')
          if (accepted.kind === 'dry') {
            if (answered.dryRun !== true || answered.args.text !== text) {
              throw new TypeError('dry-run reply plan must record the answer text')
            }
          } else {
            remember(accepted.ids)
          }
          intents.push(accepted.intent)
          // State stays waiting. Reply is a worker answer, not the human PR yes.
        } finally {
          adapterBusy = false
        }
      })()
    },
    gateCreate(input) {
      need(['waiting'], 'create a backend gate')
      if (typeof input?.reason !== 'string' || input.reason.trim().length === 0) {
        throw new TypeError('gate reason is required')
      }
      if (adapterBusy) {
        throw new IllegalTransitionError(state, 'create a backend gate while another adapter call is in flight')
      }
      const reason = input.reason.trim()
      adapterBusy = true
      return (async () => {
        try {
          const created = await adapter.gateCreate({
            reason,
            ...(bound.taskId !== undefined ? { taskId: bound.taskId } : {}),
          })
          const accepted = acceptResult(created, 'gate-create')
          if (accepted.kind === 'dry') {
            if (created.dryRun !== true || created.args.reason !== reason) {
              throw new TypeError('dry-run gate-create plan must record the reason')
            }
          } else {
            remember(accepted.ids)
          }
          intents.push(accepted.intent)
          // State stays waiting. A backend gate is not the human PR yes.
        } finally {
          adapterBusy = false
        }
      })()
    },
    gateResolve(input) {
      need(['waiting'], 'resolve a backend gate')
      if (typeof input?.resolution !== 'string' || input.resolution.trim().length === 0) {
        throw new TypeError('gate resolution is required')
      }
      if (adapterBusy) {
        throw new IllegalTransitionError(state, 'resolve a backend gate while another adapter call is in flight')
      }
      const resolution = input.resolution.trim()
      adapterBusy = true
      return (async () => {
        try {
          const resolved = await adapter.gateResolve({
            resolution,
            ...(bound.gateId !== undefined ? { gateId: bound.gateId } : {}),
          })
          const accepted = acceptResult(resolved, 'gate-resolve')
          if (accepted.kind === 'dry') {
            if (resolved.dryRun !== true || resolved.args.resolution !== resolution) {
              throw new TypeError('dry-run gate-resolve plan must record the resolution')
            }
          } else {
            remember(accepted.ids)
          }
          intents.push(accepted.intent)
          // State stays waiting. Resolving a backend gate is not the human PR yes.
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
          const released = await adapter.workerRelease(
            bound.workerId !== undefined ? { workerId: bound.workerId } : {},
          )
          const accepted = acceptResult(released, 'worker-release')
          if (accepted.kind === 'live') remember(accepted.ids)
          intents.push(accepted.intent)
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
