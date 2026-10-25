import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { ORCA_CLI, ORCA_COMMAND_FLAGS, orcaCliArgs, orcaCliConfirmTodo, orcaCommandHead } from '../src/cli.ts'
import type { OrcaCommand, OrcaFlagName } from '../src/index.ts'

const confirmed = [
  '[x] status',
  '[x] orchestration run-create --objective',
  '[x] orchestration task-create --spec --run',
  '[x] orchestration task-list --run',
  '[x] orchestration worker-start --task --agent --worktree --run',
  '[x] orchestration worker-show --dispatch',
  '[x] orchestration worker-release --dispatch',
  '[x] orchestration check --run',
  '[x] orchestration reply --id --body --run',
  '[x] orchestration gate-create --task --question',
  '[x] orchestration gate-resolve --id --resolution',
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
    status: [],
    'run-create': ['objective'],
    'task-create': ['spec', 'run'],
    'task-list': ['run'],
    'worker-start': ['task', 'agent', 'worktree', 'run'],
    'worker-show': ['dispatch'],
    'worker-release': ['dispatch'],
    check: ['run'],
    reply: ['id', 'body', 'run'],
    'gate-create': ['task', 'question'],
    'gate-resolve': ['id', 'resolution'],
  })

  assert.deepEqual(orcaCommandHead('status'), ['status'])
  assert.deepEqual(orcaCommandHead('run-create'), ['orchestration', 'run-create'])
  assert.deepEqual(
    orcaCliArgs(ORCA_CLI.commands.runCreate, [[ORCA_CLI.flags.objective, 'dig']]),
    ['orchestration', 'run-create', '--objective', 'dig'],
  )
  assert.deepEqual(
    orcaCliArgs(ORCA_CLI.commands.taskCreate, [
      [ORCA_CLI.flags.spec, 'dig'],
      [ORCA_CLI.flags.run, 'run-1'],
    ]),
    ['orchestration', 'task-create', '--spec', 'dig', '--run', 'run-1'],
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
    ],
  )
  assert.deepEqual(orcaCliArgs(ORCA_CLI.commands.workerShow, [[ORCA_CLI.flags.dispatch, 'dispatch-1']]), [
    'orchestration',
    'worker-show',
    '--dispatch',
    'dispatch-1',
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
  ])
  assert.deepEqual(orcaCliArgs(ORCA_CLI.commands.gateCreate, [
    [ORCA_CLI.flags.task, 'task-1'],
    [ORCA_CLI.flags.question, 'worker blocked'],
  ]), ['orchestration', 'gate-create', '--task', 'task-1', '--question', 'worker blocked'])
  assert.deepEqual(orcaCliArgs(ORCA_CLI.commands.gateResolve, [
    [ORCA_CLI.flags.id, 'gate-1'],
    [ORCA_CLI.flags.resolution, 'continue'],
  ]), ['orchestration', 'gate-resolve', '--id', 'gate-1', '--resolution', 'continue'])
  assert.deepEqual(orcaCliArgs(ORCA_CLI.commands.status, []), ['status'])
  assert.deepEqual(orcaCliArgs(ORCA_CLI.commands.check, [[ORCA_CLI.flags.run, 'run-1']]), [
    'orchestration',
    'check',
    '--run',
    'run-1',
  ])
  assert.throws(
    () => orcaCliArgs(ORCA_CLI.commands.check, [[ORCA_CLI.flags.objective, 'nope']]),
    /not listed for check/,
  )
  assert.throws(
    () => orcaCliArgs(ORCA_CLI.commands.runCreate, [['repo' as OrcaFlagName, 'nope']]),
    /not listed for run-create/,
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

  const commandKeys = Object.keys(ORCA_COMMAND_FLAGS) as OrcaCommand[]
  assert.deepEqual(commandKeys.sort(), [...commands].sort())
})
