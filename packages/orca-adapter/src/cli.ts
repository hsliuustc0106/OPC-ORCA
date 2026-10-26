import type { OrcaCommand } from './types.ts'

/**
 * Orca CLI subcommands and flag names, in one place.
 *
 * Confirmed against Orca desktop 1.4.240 on macOS (local E2E): top-level
 * `run-create` is an unknown command. Every verb except `status` is
 * `orca orchestration <verb>`. `status` stays top-level.
 *
 * Bindings this adapter passes:
 * - goal text → `run-create --objective`
 * - task spec → `task-create --spec` (not `--task-title`)
 * - run id → `--run` (not `--run-id`)
 * - task id → `--task` (not `--task-id`), on `worker-start` and `gate-create`
 * - worker `dsh` → `worker-start --agent` (in-repo docs name that agent `dsh`)
 * - worktree `new-child` → `worker-start --worktree`
 * - worker id from stdout → `--dispatch` on `worker-show` and `worker-release`
 * - reply message id → `reply --id`; answer text → `--body`
 * - gate reason → `gate-create --question`
 * - gate id → `gate-resolve --id`; resolution stays `--resolution`
 * - coordinator terminal handle → `--from` on the verbs in `ORCA_SENDER_FLAG`
 *   whose value is `from`. `check` takes that same handle as `--terminal`.
 *   The handle is `from` or `ORCA_TERMINAL_HANDLE`. It is not invented.
 *
 * Not passed. Do not invent these flags:
 * - `run-create` has no `--goal`, `--repo`, or `--base`. Repo and base stay
 *   on the dry-run plan as the product binding (`origin/main`).
 * - `task-create` has no `--worker` or `--worktree`. Optional `--task-title`
 *   is not filled from the spec.
 * - `worker-start` accepts optional `--repo` and `--base-branch`. This
 *   adapter does not pass them; the product binding stays on the run-create
 *   plan until a desktop confirm says those worker flags are that binding.
 * - `--json` is not passed. Stdout stays the line protocol in `parse.ts`.
 * - Live `reply` requires a caller-supplied message id for `--id`. The
 *   adapter does not invent one.
 * - `worker-start` accepts `--terminal` as the worker target. This adapter
 *   does not pass it. The coordinator handle on that verb is `--from`.
 * - `task-list` accepts `--from`, and the 1.4.240 handler skips sender
 *   resolution when `--run` is set. Live task-list always passes `--run`,
 *   so this adapter does not pass `--from` there.
 * - `status`, `worker-show`, and `worker-release` take no sender flag.
 *
 * TODO(orca-cli): the stdout line protocol was not part of the 1.4.240 help
 * confirm. Unparseable stdout, including JSON, stays fail-closed.
 *
 * The binary name this repo resolves is `orca`. On Linux only, the resolver
 * falls back to `orca-ide` when `orca` is absent. That fallback is not a
 * desktop subcommand.
 */
export const ORCA_CLI = {
  binary: 'orca',
  linuxFallback: 'orca-ide',
  /** Desktop group for every verb except `status`. */
  group: 'orchestration',
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
    objective: 'objective',
    spec: 'spec',
    run: 'run',
    task: 'task',
    agent: 'agent',
    worktree: 'worktree',
    dispatch: 'dispatch',
    id: 'id',
    body: 'body',
    question: 'question',
    resolution: 'resolution',
    from: 'from',
    terminal: 'terminal',
  },
} as const

export type OrcaFlagName = (typeof ORCA_CLI.flags)[keyof typeof ORCA_CLI.flags]

/**
 * Flags this adapter may pass for each subcommand. `check` has no
 * `--converged`. A flag the desktop help lists but this map omits is not
 * passed.
 */
export const ORCA_COMMAND_FLAGS = {
  status: [],
  'run-create': [ORCA_CLI.flags.objective, ORCA_CLI.flags.from],
  'task-create': [ORCA_CLI.flags.spec, ORCA_CLI.flags.run, ORCA_CLI.flags.from],
  'task-list': [ORCA_CLI.flags.run],
  'worker-start': [
    ORCA_CLI.flags.task,
    ORCA_CLI.flags.agent,
    ORCA_CLI.flags.worktree,
    ORCA_CLI.flags.run,
    ORCA_CLI.flags.from,
  ],
  'worker-show': [ORCA_CLI.flags.dispatch],
  'worker-release': [ORCA_CLI.flags.dispatch],
  check: [ORCA_CLI.flags.run, ORCA_CLI.flags.terminal],
  reply: [ORCA_CLI.flags.id, ORCA_CLI.flags.body, ORCA_CLI.flags.run, ORCA_CLI.flags.from],
  'gate-create': [ORCA_CLI.flags.task, ORCA_CLI.flags.question, ORCA_CLI.flags.from],
  'gate-resolve': [ORCA_CLI.flags.id, ORCA_CLI.flags.resolution, ORCA_CLI.flags.from],
} as const satisfies Record<OrcaCommand, readonly OrcaFlagName[]>

/**
 * Sender flag for a live verb, confirmed against Orca desktop 1.4.240.
 * `from` is `--from` (caller). `check` is `--terminal`, not `--from`.
 * Absent verbs do not resolve a sender when this adapter calls them:
 * `status` is top-level; `worker-show` and `worker-release` take only
 * `--dispatch`; live `task-list` always passes `--run`, and that handler
 * skips sender resolution. `worker-start --terminal` is a worker target,
 * not this map.
 */
export const ORCA_SENDER_FLAG = {
  'run-create': ORCA_CLI.flags.from,
  'task-create': ORCA_CLI.flags.from,
  'worker-start': ORCA_CLI.flags.from,
  check: ORCA_CLI.flags.terminal,
  reply: ORCA_CLI.flags.from,
  'gate-create': ORCA_CLI.flags.from,
  'gate-resolve': ORCA_CLI.flags.from,
} as const satisfies Partial<Record<OrcaCommand, OrcaFlagName>>

/** Argv head for one command, without the binary and without flags. */
export function orcaCommandHead(command: OrcaCommand): readonly string[] {
  if (command === ORCA_CLI.commands.status) return [command]
  return [ORCA_CLI.group, command]
}

/**
 * Argv tail for one live spawn: group and subcommand, then `--flag` `value`
 * pairs. `status` has no group. `shell: false` is the spawn module's job.
 * This function does not spawn.
 */
export function orcaCliArgs(
  command: OrcaCommand,
  flags: readonly (readonly [OrcaFlagName, string])[],
): string[] {
  const allowed = new Set<string>(ORCA_COMMAND_FLAGS[command])
  const args: string[] = [...orcaCommandHead(command)]
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
 * new flag cannot skip the list. The boxes record the 1.4.240 help confirm.
 * They are not a green live spawn. Live smoke stays operator-owned.
 */
export function orcaCliConfirmTodo(): readonly string[] {
  const lines = [
    'Confirmed against Orca desktop 1.4.240 (Mac local E2E, docs/local-test.md). Live argv uses these spellings. A later desktop build can still differ. Do not invent a flag this list omits.',
    'TODO(orca-cli): stdout is still the line protocol in parse.ts. Desktop --json was not adopted. Unparseable stdout stays fail-closed.',
    'Sender: --from on run-create, task-create, worker-start, reply, gate-create, and gate-resolve. check uses --terminal for that same handle. No handle is invented. task-list, status, worker-show, and worker-release do not take a sender on this adapter.',
    `[x] binary: ${ORCA_CLI.binary}`,
    `[x] Linux PATH fallback in this repo only (not a desktop subcommand): ${ORCA_CLI.linuxFallback}`,
  ]
  const commands = Object.values(ORCA_CLI.commands)
  for (const command of commands) {
    const flags = ORCA_COMMAND_FLAGS[command].map((flag) => `--${flag}`)
    const head = command === ORCA_CLI.commands.status ? command : `${ORCA_CLI.group} ${command}`
    lines.push(flags.length > 0 ? `[x] ${head} ${flags.join(' ')}` : `[x] ${head}`)
  }
  lines.push(
    'Not passed on spawn: run-create has no --repo or --base (those stay on the dry-run plan). task-create has no --task-title. worker-start does not pass --repo, --base-branch, or --terminal (that terminal flag is the worker target, not the coordinator handle). task-list does not pass --from. check does not pass --from. --json is not passed.',
  )
  return lines
}
