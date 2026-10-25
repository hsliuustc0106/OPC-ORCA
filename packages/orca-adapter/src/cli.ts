import type { OrcaCommand } from './types.ts'

/**
 * Orca CLI subcommands and flag names, in one place.
 *
 * TODO(orca-cli): confirm each line of `orcaCliConfirmTodo()` against the
 * Orca desktop CLI during the local run described in `docs/local-test.md`.
 * An unchecked line is not a contract. Do not invent a successful spawn
 * from this list, and do not treat a green dry-run as confirmation.
 *
 * The binary name this repo resolves is `orca`. On Linux only, the resolver
 * falls back to `orca-ide` when `orca` is absent. That fallback is not a
 * desktop subcommand.
 */
export const ORCA_CLI = {
  binary: 'orca',
  linuxFallback: 'orca-ide',
  commands: {
    status: 'status',
    runCreate: 'run-create',
    taskCreate: 'task-create',
    taskList: 'task-list',
    workerStart: 'worker-start',
    workerShow: 'worker-show',
    workerRelease: 'worker-release',
    check: 'check',
    reply: 'reply',
    gateCreate: 'gate-create',
    gateResolve: 'gate-resolve',
  },
  flags: {
    goal: 'goal',
    repo: 'repo',
    base: 'base',
    runId: 'run-id',
    title: 'title',
    worker: 'worker',
    worktree: 'worktree',
    taskId: 'task-id',
    workerId: 'worker-id',
    text: 'text',
    reason: 'reason',
    gateId: 'gate-id',
    resolution: 'resolution',
  },
} as const

export type OrcaFlagName = (typeof ORCA_CLI.flags)[keyof typeof ORCA_CLI.flags]

/** Flags this adapter may pass for each subcommand. `check` has no `--converged`. */
export const ORCA_COMMAND_FLAGS = {
  status: [],
  'run-create': [ORCA_CLI.flags.goal, ORCA_CLI.flags.repo, ORCA_CLI.flags.base],
  'task-create': [ORCA_CLI.flags.runId, ORCA_CLI.flags.title, ORCA_CLI.flags.worker, ORCA_CLI.flags.worktree],
  'task-list': [ORCA_CLI.flags.runId],
  'worker-start': [ORCA_CLI.flags.taskId, ORCA_CLI.flags.worker, ORCA_CLI.flags.worktree],
  'worker-show': [ORCA_CLI.flags.workerId],
  'worker-release': [ORCA_CLI.flags.workerId],
  check: [ORCA_CLI.flags.runId],
  reply: [ORCA_CLI.flags.runId, ORCA_CLI.flags.text],
  'gate-create': [ORCA_CLI.flags.runId, ORCA_CLI.flags.reason],
  'gate-resolve': [ORCA_CLI.flags.gateId, ORCA_CLI.flags.resolution],
} as const satisfies Record<OrcaCommand, readonly OrcaFlagName[]>

/**
 * Argv tail for one live spawn: subcommand, then `--flag` `value` pairs.
 * `shell: false` is the spawn module's job. This function does not spawn.
 */
export function orcaCliArgs(
  command: OrcaCommand,
  flags: readonly (readonly [OrcaFlagName, string])[],
): string[] {
  const allowed = new Set<string>(ORCA_COMMAND_FLAGS[command])
  const args: string[] = [command]
  for (const [name, value] of flags) {
    if (!allowed.has(name)) {
      throw new TypeError(`orca CLI flag --${name} is not listed for ${command}`)
    }
    args.push(`--${name}`, value)
  }
  return args
}

/**
 * Checklist for the operator's local run. Generated from `ORCA_CLI` so a
 * new flag cannot skip the list. Checking a box is a human note in this
 * file's review, not something the smoke script can do.
 */
export function orcaCliConfirmTodo(): readonly string[] {
  const lines = [
    'TODO(orca-cli): confirm each item against the Orca desktop CLI during the local run (docs/local-test.md). An unchecked item is not a contract.',
    `[ ] binary: ${ORCA_CLI.binary}`,
    `[ ] Linux PATH fallback in this repo only (not a desktop subcommand): ${ORCA_CLI.linuxFallback}`,
  ]
  const commands = Object.values(ORCA_CLI.commands)
  for (const command of commands) {
    const flags = ORCA_COMMAND_FLAGS[command].map((flag) => `--${flag}`)
    lines.push(flags.length > 0 ? `[ ] ${command} ${flags.join(' ')}` : `[ ] ${command}`)
  }
  return lines
}
