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
 * - product worker label `dsh` stays on the dry-run plan. Live `--agent` is
 *   the operator desktop id (`agent`, otherwise `OPC_ORCA_AGENT`), one of
 *   `ORCA_DESKTOP_AGENTS`. `dsh` is not that id. Unset or any other value
 *   throws `no-agent` before spawn. The adapter does not invent one.
 * - worktree `new-child` → `worker-start --worktree`, plus a unique `--name`
 *   (`opc-` and random hex). That name is not a dispatch id. Desktop help
 *   requires `--name` for a new worktree and rejects it for current ones.
 * - `--setup` (`run`, `skip`, or `inherit`) only when the operator set
 *   `setup` or `OPC_ORCA_SETUP`. Unset omits the flag (desktop default `run`).
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
 * - `worker-start` lists optional `--repo` and `--base-branch`. 1.4.240 help
 *   does not require them for `new-child` (the runtime error for a new
 *   worktree names `--name` only). This adapter does not pass them. The
 *   product binding stays on the run-create plan.
 * - `--json` is passed on every live spawn, with no value. Stdout is the
 *   JSON envelope in `parse.ts`. Prose is unparseable.
 * - Live `reply` requires a caller-supplied message id for `--id`. The
 *   adapter does not invent one.
 * - `worker-start` accepts `--terminal` as the worker target. This adapter
 *   does not pass it. The coordinator handle on that verb is `--from`.
 * - `task-list` accepts `--from`, and the 1.4.240 handler skips sender
 *   resolution when `--run` is set. Live task-list always passes `--run`,
 *   so this adapter does not pass `--from` there.
 * - `status`, `worker-show`, and `worker-release` take no sender flag.
 *
 * TODO(orca-cli): `--json` stdout is the 1.4.240 envelope in `parse.ts`.
 * Prose, including `Run run_… created and bound: …`, stays fail-closed.
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
    json: 'json',
    name: 'name',
    setup: 'setup',
  },
} as const

/**
 * `--agent` values named by Orca desktop 1.4.240 `worker-start` help
 * ("such as" this list). Live spawn accepts only these. `dsh` is absent.
 */
export const ORCA_DESKTOP_AGENTS = [
  'claude',
  'codex',
  'cursor',
  'antigravity',
  'muse',
  'zcode',
  'opencode',
  'opencode2',
] as const

/** `--setup` values named by the same help. */
export const ORCA_WORKER_SETUPS = ['run', 'skip', 'inherit'] as const

export type OrcaFlagName = (typeof ORCA_CLI.flags)[keyof typeof ORCA_CLI.flags]

/**
 * Flags this adapter may pass for each subcommand. `check` has no
 * `--converged`. A flag the desktop help lists but this map omits is not
 * passed.
 */
export const ORCA_COMMAND_FLAGS = {
  status: [ORCA_CLI.flags.json],
  'run-create': [ORCA_CLI.flags.objective, ORCA_CLI.flags.from, ORCA_CLI.flags.json],
  'task-create': [ORCA_CLI.flags.spec, ORCA_CLI.flags.run, ORCA_CLI.flags.from, ORCA_CLI.flags.json],
  'task-list': [ORCA_CLI.flags.run, ORCA_CLI.flags.json],
  'worker-start': [
    ORCA_CLI.flags.task,
    ORCA_CLI.flags.agent,
    ORCA_CLI.flags.worktree,
    ORCA_CLI.flags.name,
    ORCA_CLI.flags.setup,
    ORCA_CLI.flags.run,
    ORCA_CLI.flags.from,
    ORCA_CLI.flags.json,
  ],
  'worker-show': [ORCA_CLI.flags.dispatch, ORCA_CLI.flags.json],
  'worker-release': [ORCA_CLI.flags.dispatch, ORCA_CLI.flags.json],
  check: [ORCA_CLI.flags.run, ORCA_CLI.flags.terminal, ORCA_CLI.flags.json],
  reply: [ORCA_CLI.flags.id, ORCA_CLI.flags.body, ORCA_CLI.flags.run, ORCA_CLI.flags.from, ORCA_CLI.flags.json],
  'gate-create': [ORCA_CLI.flags.task, ORCA_CLI.flags.question, ORCA_CLI.flags.from, ORCA_CLI.flags.json],
  'gate-resolve': [ORCA_CLI.flags.id, ORCA_CLI.flags.resolution, ORCA_CLI.flags.from, ORCA_CLI.flags.json],
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
 * pairs, then a value-less `--json`. `status` has no group. `shell: false`
 * is the spawn module's job. This function does not spawn.
 */
export function orcaCliArgs(
  command: OrcaCommand,
  flags: readonly (readonly [OrcaFlagName, string])[],
): string[] {
  const allowed = new Set<string>(ORCA_COMMAND_FLAGS[command])
  const args: string[] = [...orcaCommandHead(command)]
  for (const [name, value] of flags) {
    if (name === ORCA_CLI.flags.json) {
      throw new TypeError(`orca CLI flag --${name} takes no value`)
    }
    if (!allowed.has(name)) {
      throw new TypeError(`orca CLI flag --${name} is not listed for ${command}`)
    }
    args.push(`--${name}`, value)
  }
  if (allowed.has(ORCA_CLI.flags.json)) args.push(`--${ORCA_CLI.flags.json}`)
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
    'TODO(orca-cli): live stdout is the 1.4.240 --json envelope in parse.ts. Prose such as "Run run_… created and bound" is unparseable. No id is scraped from that line.',
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
    'Not passed on spawn: run-create has no --repo or --base (those stay on the dry-run plan). task-create has no --task-title. worker-start does not pass --repo or --base-branch (1.4.240 help lists both as optional; new-child requires --name only) or --terminal (that terminal flag is the worker target, not the coordinator handle). --setup is omitted unless the operator set run, skip, or inherit. task-list does not pass --from. check does not pass --from. --json is boolean and is passed with no value.',
  )
  return lines
}
