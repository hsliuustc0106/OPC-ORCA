import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { ORCA_CLI, ORCA_COMMAND_FLAGS, ORCA_SENDER_FLAG, orcaCliArgs, orcaCliConfirmTodo, orcaCommandHead } from '../src/cli.ts'
import type { OrcaCommand, OrcaFlagName } from '../src/index.ts'

const confirmed = [
  '[x] status --json',
  '[x] orchestration run-create --objective --from --json',
  '[x] orchestration task-create --spec --run --from --json',
  '[x] orchestration task-list --run --json',
  '[x] orchestration worker-start --task --agent --worktree --run --from --json',
  '[x] orchestration worker-show --dispatch --json',
  '[x] orchestration worker-release --dispatch --json',
  '[x] orchestration check --run --terminal --json',
  '[x] orchestration reply --id --body --run --from --json',
  '[x] orchestration gate-create --task --question --from --json',
  '[x] orchestration gate-resolve --id --resolution --from --json',
] as const

test('CLI spellings match the Orca 1.4.240 orchestration help', () => {
  const todo = orcaCliConfirmTodo()
  const text = todo.join('\n')
  assert.match(text, /TODO\(orca-cli\)/)
  assert.match(text, /docs\/local-test\.md/)
  assert.match(text, /1\.4\.240/)
  assert.match(text, /Do not invent a flag this list omits/)
  assert.match(text, /binary: orca/)
  assert.match(text, /orca-ide/)
  assert.match(text, /no --repo or --base/)
  assert.equal(text.includes('--goal'), false)
  assert.equal(text.includes('--run-id'), false)
  assert.equal(text.includes('--task-id'), false)
  assert.equal(text.includes('--worker-id'), false)
  assert.equal(text.includes('--title'), false)
  assert.equal(/--worker\b/.test(text), false)
  assert.equal(text.includes('--converged'), false)

  assert.equal(ORCA_CLI.group, 'orchestration')
  const commands = Object.values(ORCA_CLI.commands)
  assert.equal(new Set(commands).size, commands.length)
  for (const command of commands) {
    const flags = ORCA_COMMAND_FLAGS[command].map((flag) => `--${flag}`)
    const head = command === 'status' ? command : `${ORCA_CLI.group} ${command}`
    const line = flags.length > 0 ? `[x] ${head} ${flags.join(' ')}` : `[x] ${head}`
    assert.equal(todo.includes(line), true, line)
  }
  for (const line of confirmed) {
    assert.equal(todo.includes(line), true, line)
  }
  for (const flag of Object.values(ORCA_CLI.flags)) {
    assert.match(text, new RegExp(`--${flag}\\b`))
  }

  assert.deepEqual(ORCA_COMMAND_FLAGS, {
    status: ['json'],
    'run-create': ['objective', 'from', 'json'],
    'task-create': ['spec', 'run', 'from', 'json'],
    'task-list': ['run', 'json'],
    'worker-start': ['task', 'agent', 'worktree', 'run', 'from', 'json'],
    'worker-show': ['dispatch', 'json'],
    'worker-release': ['dispatch', 'json'],
    check: ['run', 'terminal', 'json'],
    reply: ['id', 'body', 'run', 'from', 'json'],
    'gate-create': ['task', 'question', 'from', 'json'],
    'gate-resolve': ['id', 'resolution', 'from', 'json'],
  })
  assert.deepEqual(ORCA_SENDER_FLAG, {
    'run-create': 'from',
    'task-create': 'from',
    'worker-start': 'from',
    check: 'terminal',
    reply: 'from',
    'gate-create': 'from',
    'gate-resolve': 'from',
  })
  assert.equal(Object.hasOwn(ORCA_SENDER_FLAG, 'status'), false)
  assert.equal(Object.hasOwn(ORCA_SENDER_FLAG, 'task-list'), false)
  assert.equal(Object.hasOwn(ORCA_SENDER_FLAG, 'worker-show'), false)
  assert.equal(Object.hasOwn(ORCA_SENDER_FLAG, 'worker-release'), false)
  assert.equal(ORCA_COMMAND_FLAGS['worker-start'].includes('terminal'), false)
  assert.equal(ORCA_COMMAND_FLAGS.check.includes('from'), false)

  assert.deepEqual(orcaCommandHead('status'), ['status'])
  assert.deepEqual(orcaCommandHead('run-create'), ['orchestration', 'run-create'])
  assert.deepEqual(
    orcaCliArgs(ORCA_CLI.commands.runCreate, [[ORCA_CLI.flags.objective, 'dig']]),
    ['orchestration', 'run-create', '--objective', 'dig', '--json'],
  )
  assert.deepEqual(
    orcaCliArgs(ORCA_CLI.commands.taskCreate, [
      [ORCA_CLI.flags.spec, 'dig'],
      [ORCA_CLI.flags.run, 'run-1'],
    ]),
    ['orchestration', 'task-create', '--spec', 'dig', '--run', 'run-1', '--json'],
  )
  assert.deepEqual(
    orcaCliArgs(ORCA_CLI.commands.workerStart, [
      [ORCA_CLI.flags.task, 'task-1'],
      [ORCA_CLI.flags.agent, 'dsh'],
      [ORCA_CLI.flags.worktree, 'new-child'],
      [ORCA_CLI.flags.run, 'run-1'],
    ]),
    [
      'orchestration',
      'worker-start',
      '--task',
      'task-1',
      '--agent',
      'dsh',
      '--worktree',
      'new-child',
      '--run',
      'run-1',
      '--json',
    ],
  )
  assert.deepEqual(orcaCliArgs(ORCA_CLI.commands.workerShow, [[ORCA_CLI.flags.dispatch, 'dispatch-1']]), [
    'orchestration',
    'worker-show',
    '--dispatch',
    'dispatch-1',
    '--json',
  ])
  assert.deepEqual(orcaCliArgs(ORCA_CLI.commands.reply, [
    [ORCA_CLI.flags.id, 'msg-1'],
    [ORCA_CLI.flags.body, 'ship the tip'],
    [ORCA_CLI.flags.run, 'run-1'],
  ]), [
    'orchestration',
    'reply',
    '--id',
    'msg-1',
    '--body',
    'ship the tip',
    '--run',
    'run-1',
    '--json',
  ])
  assert.deepEqual(orcaCliArgs(ORCA_CLI.commands.gateCreate, [
    [ORCA_CLI.flags.task, 'task-1'],
    [ORCA_CLI.flags.question, 'worker blocked'],
  ]), ['orchestration', 'gate-create', '--task', 'task-1', '--question', 'worker blocked', '--json'])
  assert.deepEqual(orcaCliArgs(ORCA_CLI.commands.gateResolve, [
    [ORCA_CLI.flags.id, 'gate-1'],
    [ORCA_CLI.flags.resolution, 'continue'],
  ]), ['orchestration', 'gate-resolve', '--id', 'gate-1', '--resolution', 'continue', '--json'])
  assert.deepEqual(orcaCliArgs(ORCA_CLI.commands.status, []), ['status', '--json'])
  assert.deepEqual(orcaCliArgs(ORCA_CLI.commands.check, [
    [ORCA_CLI.flags.run, 'run-1'],
    [ORCA_CLI.flags.terminal, 'term_test'],
  ]), [
    'orchestration',
    'check',
    '--run',
    'run-1',
    '--terminal',
    'term_test',
    '--json',
  ])
  assert.throws(
    () => orcaCliArgs(ORCA_CLI.commands.check, [[ORCA_CLI.flags.from, 'term_test']]),
    /not listed for check/,
  )
  assert.throws(
    () => orcaCliArgs(ORCA_CLI.commands.workerStart, [[ORCA_CLI.flags.terminal, 'term_test']]),
    /not listed for worker-start/,
  )
  assert.throws(
    () => orcaCliArgs(ORCA_CLI.commands.check, [[ORCA_CLI.flags.objective, 'nope']]),
    /not listed for check/,
  )
  assert.throws(
    () => orcaCliArgs(ORCA_CLI.commands.runCreate, [['repo' as OrcaFlagName, 'nope']]),
    /not listed for run-create/,
  )
  assert.throws(
    () => orcaCliArgs(ORCA_CLI.commands.runCreate, [[ORCA_CLI.flags.json, 'true']]),
    /takes no value/,
  )

  const source = readFileSync(fileURLToPath(new URL('../src/adapter.ts', import.meta.url)), 'utf8')
  assert.match(source, /orcaCliArgs/)
  assert.match(source, /TODO\(orca-cli\)/)
  assert.doesNotMatch(
    source,
    /--goal|--repo\b|--base\b|--run-id|--task-id|--worker-id|--gate-id|--objective|--spec\b|--dispatch|--question|--agent\b|--worktree|--body\b|--resolution|--run\b/,
  )

  const doc = readFileSync(fileURLToPath(new URL('../../../docs/local-test.md', import.meta.url)), 'utf8')
  for (const line of confirmed) {
    assert.equal(doc.includes(line), true, line)
  }
  assert.match(doc, /1\.4\.240/)
  assert.match(doc, /ORCA_TERMINAL_HANDLE/)
  assert.match(doc, /no-sender/)
  assert.match(doc, /Created terminal/)

  const commandKeys = Object.keys(ORCA_COMMAND_FLAGS) as OrcaCommand[]
  assert.deepEqual(commandKeys.sort(), [...commands].sort())
})
