import { OrcaParseError } from './errors.ts'
import type { LiveOrcaIds, OrcaCommand } from './types.ts'

/**
 * Live stdout is the Orca desktop 1.4.240 `--json` envelope:
 * `{ ok: true, result, … }`. Pretty-printed or compact JSON both parse.
 * The envelope `id` and `_meta` are not a run, task, worker, message, or
 * gate id. Extra result fields are ignored. A missing `ok: true`, a wrong
 * shape, or prose (including `Run run_… created and bound: …`) throws.
 * Nothing here copies an id from the caller's arguments or scrapes one
 * out of a sentence.
 *
 * Confirmed result paths (tag v1.4.240):
 * - `run-create`: `result.run.id`
 * - `task-create`: `result.task.id`
 * - `worker-start`: `result.dispatchId`, and `result.state` must be `ready`.
 *   Any other state is a failure. `failedStage` and `lastError` are copied
 *   into the error text only. The dispatch id is not.
 * - `worker-show`: `result.dispatch.id` (`dispatch` null is unparseable)
 * - `worker-release`: `result.dispatchId`
 * - `reply`: `result.message.id`
 * - `gate-create` and `gate-resolve`: `result.gate.id`
 * - `task-list`: `result.tasks` array and `result.count` equal to its length.
 *   `fields.tasks` is that count as a decimal string. Task ids are not copied.
 * - `status`: `result.runtime.state` is one of the desktop runtime states.
 *   `fields.status` is that token.
 * - `check`: `result.messages` array and `result.count` equal to its length.
 *   Desktop check is a mailbox read and has no converged field. A parsed
 *   read records `fields.converged` as `false`. It does not invent a tip.
 */
const ID_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/

const RUNTIME_STATES = new Set([
  'not_running',
  'starting',
  'ready',
  'graph_not_ready',
  'stale_bootstrap',
])

function fail(command: OrcaCommand, argv: readonly string[]): never {
  throw new OrcaParseError(`${command} stdout is unparseable`, argv)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function idToken(value: unknown): string | undefined {
  if (typeof value !== 'string' || !ID_TOKEN.test(value)) return undefined
  return value
}

function nestedId(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined
  return idToken(value.id)
}

function countMatches(value: unknown, length: number): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value === length
}

function detailToken(value: unknown): string | undefined {
  if (typeof value !== 'string' || !ID_TOKEN.test(value)) return undefined
  return value
}

function detailText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const collapsed = value.replace(/[\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (collapsed.length === 0) return undefined
  return collapsed.length > 160 ? collapsed.slice(0, 160) : collapsed
}

/**
 * Readable worker-start failure from a desktop JSON receipt.
 * Returns undefined when the receipt does not name a non-ready state,
 * `failedStage`, or `lastError`. Never includes `dispatchId`.
 */
export function workerStartFailureDetail(stdout: string): string | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout)
  } catch {
    return undefined
  }
  if (!isRecord(parsed)) return undefined
  const result = isRecord(parsed.result) ? parsed.result : undefined
  const error = isRecord(parsed.error) ? parsed.error : undefined
  const data = error !== undefined && isRecord(error.data) ? error.data : undefined
  const state = result === undefined ? undefined : detailToken(result.state)
  const failedStage =
    (result === undefined ? undefined : detailToken(result.failedStage)) ??
    (result === undefined ? undefined : detailToken(result.stage)) ??
    (data === undefined ? undefined : detailToken(data.failedStage))
  const lastError =
    (result === undefined ? undefined : detailText(result.lastError)) ??
    (data === undefined ? undefined : detailText(data.lastError))
  const parts: string[] = []
  if (state !== undefined && state !== 'ready') parts.push(`state ${state}`)
  if (failedStage !== undefined) parts.push(`failedStage ${failedStage}`)
  if (lastError !== undefined) parts.push(`lastError ${lastError}`)
  if (parts.length === 0) return undefined
  return parts.join('; ')
}

export function parseLiveStdout(
  command: OrcaCommand,
  stdout: string,
  argv: readonly string[],
): { ids: LiveOrcaIds; fields: Record<string, string> } {
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout)
  } catch {
    return fail(command, argv)
  }
  if (!isRecord(parsed) || parsed.ok !== true || !isRecord(parsed.result)) return fail(command, argv)
  const result = parsed.result
  const ids: LiveOrcaIds = {}
  const fields: Record<string, string> = {}

  if (command === 'run-create') {
    const runId = nestedId(result.run)
    if (runId === undefined) return fail(command, argv)
    ids.runId = runId
  } else if (command === 'task-create') {
    const taskId = nestedId(result.task)
    if (taskId === undefined) return fail(command, argv)
    ids.taskId = taskId
  } else if (command === 'worker-start') {
    const workerId = idToken(result.dispatchId)
    if (workerId === undefined || result.state !== 'ready') {
      const detail = workerStartFailureDetail(stdout)
      throw new OrcaParseError(
        detail === undefined ? `${command} stdout is unparseable` : `${command} stdout is unparseable: ${detail}`,
        argv,
      )
    }
    ids.workerId = workerId
  } else if (command === 'worker-show') {
    const workerId = nestedId(result.dispatch)
    if (workerId === undefined) return fail(command, argv)
    ids.workerId = workerId
  } else if (command === 'worker-release') {
    const workerId = idToken(result.dispatchId)
    if (workerId === undefined) return fail(command, argv)
    ids.workerId = workerId
  } else if (command === 'reply') {
    const messageId = nestedId(result.message)
    if (messageId === undefined) return fail(command, argv)
    ids.messageId = messageId
  } else if (command === 'gate-create' || command === 'gate-resolve') {
    const gateId = nestedId(result.gate)
    if (gateId === undefined) return fail(command, argv)
    ids.gateId = gateId
  } else if (command === 'task-list') {
    if (!Array.isArray(result.tasks) || !countMatches(result.count, result.tasks.length)) {
      return fail(command, argv)
    }
    fields.tasks = String(result.count)
  } else if (command === 'status') {
    if (!isRecord(result.runtime) || typeof result.runtime.state !== 'string') return fail(command, argv)
    if (!RUNTIME_STATES.has(result.runtime.state)) return fail(command, argv)
    fields.status = result.runtime.state
  } else if (command === 'check') {
    if (!Array.isArray(result.messages) || !countMatches(result.count, result.messages.length)) {
      return fail(command, argv)
    }
    fields.converged = 'false'
  }

  return { ids, fields }
}
