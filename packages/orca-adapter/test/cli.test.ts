import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { ORCA_CLI, ORCA_COMMAND_FLAGS, orcaCliArgs, orcaCliConfirmTodo } from '../src/cli.ts'
import type { OrcaCommand } from '../src/types.ts'

test('CLI spellings live in one module and the checklist names each of them', () => {
  const todo = orcaCliConfirmTodo()
  const text = todo.join('\n')
  assert.match(text, /TODO\(orca-cli\)/)
  assert.match(text, /docs\/local-test\.md/)
  assert.match(text, /unchecked item is not a contract/)
  assert.match(text, /binary: orca/)
  assert.match(text, /orca-ide/)

  const commands = Object.values(ORCA_CLI.commands)
  assert.equal(new Set(commands).size, commands.length)
  for (const command of commands) {
    const flags = ORCA_COMMAND_FLAGS[command].map((flag) => `--${flag}`)
    const line = flags.length > 0 ? `[ ] ${command} ${flags.join(' ')}` : `[ ] ${command}`
    assert.equal(todo.includes(line), true, line)
  }
  for (const flag of Object.values(ORCA_CLI.flags)) {
    assert.match(text, new RegExp(`--${flag}\\b`))
  }
  assert.equal(text.includes('--converged'), false)

  assert.deepEqual(
    orcaCliArgs(ORCA_CLI.commands.runCreate, [
      [ORCA_CLI.flags.goal, 'dig'],
      [ORCA_CLI.flags.repo, 'hsliuustc0106/OPC-ORCA'],
      [ORCA_CLI.flags.base, 'origin/main'],
    ]),
    ['run-create', '--goal', 'dig', '--repo', 'hsliuustc0106/OPC-ORCA', '--base', 'origin/main'],
  )
  assert.deepEqual(orcaCliArgs(ORCA_CLI.commands.status, []), ['status'])
  assert.deepEqual(orcaCliArgs(ORCA_CLI.commands.check, [[ORCA_CLI.flags.runId, 'run-1']]), [
    'check',
    '--run-id',
    'run-1',
  ])
  assert.throws(
    () => orcaCliArgs(ORCA_CLI.commands.check, [[ORCA_CLI.flags.goal, 'nope']]),
    /not listed for check/,
  )

  const source = readFileSync(fileURLToPath(new URL('../src/adapter.ts', import.meta.url)), 'utf8')
  assert.match(source, /orcaCliArgs/)
  assert.match(source, /TODO\(orca-cli\)/)
  assert.doesNotMatch(source, /--goal|--repo|--run-id|--task-id|--worker-id|--gate-id|--resolution/)

  const commandKeys = Object.keys(ORCA_COMMAND_FLAGS) as OrcaCommand[]
  assert.deepEqual(commandKeys.sort(), [...commands].sort())
})
