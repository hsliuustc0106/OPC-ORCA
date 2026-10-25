import { OrcaParseError } from './errors.ts'
import type { LiveOrcaIds, OrcaCommand } from './types.ts'

/**
 * Line protocol for live stdout. One field per line: `key: value`.
 * Values are tokens. `converged` must be `true` or `false`.
 * Unknown lines, duplicates, and a missing required field throw.
 * Nothing in here copies an id from the caller's arguments.
 */
const FIELD = /^([a-z]+(?:-[a-z]+)*): ([A-Za-z0-9][A-Za-z0-9._:-]*)$/

const ID_KEYS = ['run-id', 'task-id', 'worker-id', 'message-id', 'gate-id'] as const

const REQUIRED: Record<OrcaCommand, readonly string[]> = {
  status: ['status'],
  'run-create': ['run-id'],
  'task-create': ['task-id'],
  'task-list': ['tasks'],
  'worker-start': ['worker-id'],
  'worker-show': ['worker-id'],
  'worker-release': ['worker-id'],
  check: ['converged'],
  reply: ['message-id'],
  'gate-create': ['gate-id'],
  'gate-resolve': ['gate-id'],
}

const EXTRA: Record<OrcaCommand, readonly string[]> = {
  status: ['status'],
  'run-create': [],
  'task-create': [],
  'task-list': ['tasks'],
  'worker-start': [],
  'worker-show': [],
  'worker-release': [],
  check: ['converged'],
  reply: [],
  'gate-create': [],
  'gate-resolve': [],
}

const ID_PROP = {
  'run-id': 'runId',
  'task-id': 'taskId',
  'worker-id': 'workerId',
  'message-id': 'messageId',
  'gate-id': 'gateId',
} as const

function allowedKeys(command: OrcaCommand): Set<string> {
  return new Set<string>([...ID_KEYS, ...EXTRA[command]])
}

export function parseLiveStdout(
  command: OrcaCommand,
  stdout: string,
  argv: readonly string[],
): { ids: LiveOrcaIds; fields: Record<string, string> } {
  const allowed = allowedKeys(command)
  const fields: Record<string, string> = {}
  for (const raw of stdout.split('\n')) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw
    if (line.length === 0) continue
    const match = FIELD.exec(line)
    const key = match?.[1]
    const value = match?.[2]
    if (!key || value === undefined) {
      throw new OrcaParseError(`${command} stdout is unparseable`, argv)
    }
    if (!allowed.has(key)) {
      throw new OrcaParseError(`${command} stdout has an unexpected field ${key}`, argv)
    }
    if (Object.hasOwn(fields, key)) {
      throw new OrcaParseError(`${command} stdout repeats ${key}`, argv)
    }
    if (key === 'converged' && value !== 'true' && value !== 'false') {
      throw new OrcaParseError(`${command} stdout has an unusable converged`, argv)
    }
    fields[key] = value
  }
  for (const key of REQUIRED[command]) {
    if (!Object.hasOwn(fields, key)) {
      throw new OrcaParseError(`${command} stdout is missing ${key}`, argv)
    }
  }
  const ids: LiveOrcaIds = {}
  for (const key of ID_KEYS) {
    const value = fields[key]
    if (value !== undefined) ids[ID_PROP[key]] = value
  }
  return { ids, fields }
}
