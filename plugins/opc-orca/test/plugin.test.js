import assert from 'node:assert/strict'
import { test } from 'node:test'

import { OrcaNotConfiguredError } from '@opc-orca/orca-adapter'

import { apply, inject, name } from '../index.js'

const repo = 'hsliuustc0106/OPC-ORCA'

function host(notes = []) {
  const tools = []
  let routes = 0
  const ctx = {
    logger(scope) {
      assert.equal(scope, 'opc-orca')
      return {
        info(message) {
          notes.push(message)
        },
      }
    },
    tools: {
      register(tool) {
        tools.push(tool)
        return () => {
          const index = tools.indexOf(tool)
          if (index >= 0) tools.splice(index, 1)
        }
      },
    },
    handleApi() {
      routes += 1
      throw new Error('plugin must not register routes')
    },
  }
  return {
    ctx,
    tools,
    routes: () => routes,
    notes,
  }
}

test('dig is the only tool and a dry-run call does not write GitHub', async () => {
  assert.equal(name, 'opc-orca')
  assert.deepEqual(inject, ['tools'])
  const notes = []
  const loaded = host(notes)
  const dispose = apply(loaded.ctx, { env: { PATH: '' } })
  assert.equal(typeof dispose, 'function')
  assert.equal(loaded.routes(), 0)
  assert.deepEqual(notes, ['opc-orca: dig tool registered'])
  assert.equal(loaded.tools.length, 1)
  const dig = loaded.tools[0]
  assert.equal(dig.name, 'dig')
  assert.match(dig.description, /dry-run/)
  assert.match(dig.description, /does not open, update, or merge/)
  assert.equal(dig.parameters.goal.required, true)

  const summary = await dig.execute({ goal: 'fix the gate', repo })
  assert.equal(summary.live, false)
  assert.equal(summary.state, 'waiting')
  assert.equal(summary.path, 'orca-worker')
  assert.equal(summary.githubWritePerformed, false)
  assert.equal(summary.humanDecision, null)
  assert.notEqual(summary.state, 'awaiting_human_pr')
  assert.deepEqual(
    summary.intents.map((intent) => intent.command),
    ['run-create', 'task-create', 'worker-start', 'check'],
  )
  assert.equal(summary.intents[0].args.runId, undefined)
  assert.equal(summary.intents[0].args.base, 'origin/main')
  assert.equal(summary.intents[3].args.converged, 'false')
  assert.equal(summary.intents.some((intent) => /pr-|merge|github/i.test(intent.command)), false)
  const rendered = dig.output.render({ goal: 'fix the gate' }, summary)
  assert.equal(rendered[0].type, 'text')
  assert.equal(JSON.parse(rendered[0].text).state, 'waiting')

  const easy = await dig.execute({ goal: 'typo in the readme' })
  assert.equal(easy.live, false)
  assert.equal(easy.state, 'converging')
  assert.equal(easy.path, 'coordinator-direct')
  assert.equal(easy.githubWritePerformed, false)
  assert.deepEqual(easy.intents.map((intent) => intent.command), ['coordinator-direct'])
  assert.notEqual(easy.state, 'awaiting_human_pr')

  const converged = await dig.execute({ goal: 'fix the gate', repo, converged: true })
  assert.equal(converged.state, 'converging')
  assert.equal(converged.githubWritePerformed, false)
  assert.equal(converged.humanDecision, null)

  dispose()
  assert.equal(loaded.tools.length, 0)
})

test('live is opt-in and a missing binary does not become a summary', async () => {
  const loaded = host()
  apply(loaded.ctx, { env: { PATH: '', OPC_ORCA_LIVE: '1' } })
  const dig = loaded.tools[0]
  await assert.rejects(() => dig.execute({ goal: 'fix the gate', repo }), OrcaNotConfiguredError)

  const forced = host()
  apply(forced.ctx, { env: { PATH: '', OPC_ORCA_LIVE: '1' }, live: false })
  const dry = await forced.tools[0].execute({ goal: 'fix the gate', repo })
  assert.equal(dry.live, false)
  assert.equal(dry.state, 'waiting')
  assert.equal(dry.githubWritePerformed, false)

  const explicit = host()
  apply(explicit.ctx, { env: { PATH: '' } })
  await assert.rejects(
    () => explicit.tools[0].execute({ goal: 'fix the gate', repo, live: true }),
    OrcaNotConfiguredError,
  )
  const stillDry = await explicit.tools[0].execute({ goal: 'fix the gate', repo, live: false })
  assert.equal(stillDry.live, false)
  assert.equal(stillDry.state, 'waiting')
})

test('apply requires the tool registry and tolerates a host with no logger', () => {
  assert.throws(() => apply(undefined, {}), /ctx\.tools\.register/)
  const dispose = apply({ tools: { register() {} } }, { env: { PATH: '' } })
  assert.equal(typeof dispose, 'function')
  dispose()
})

test('an empty goal is not a successful dig', async () => {
  const loaded = host()
  apply(loaded.ctx, { env: { PATH: '' } })
  await assert.rejects(() => loaded.tools[0].execute({ goal: '  ' }), /goal is empty/)
})
