import assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { OrcaNoSenderError, OrcaNotConfiguredError, OrcaParseError } from '@opc-orca/orca-adapter'

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
  assert.match(dig.description, /does not grant spawn/)
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
  assert.equal(summary.intents[0].args.goal, 'fix the gate')
  assert.equal(summary.intents[1].args.spec, 'fix the gate')
  assert.equal(summary.intents[1].args.worker, undefined)
  assert.equal(summary.intents[2].args.worker, 'dsh')
  assert.equal(summary.intents[2].args.worktree, 'new-child')
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
  const callerOnly = await explicit.tools[0].execute({ goal: 'fix the gate', repo, live: true })
  assert.equal(callerOnly.live, false)
  assert.equal(callerOnly.state, 'waiting')
  assert.equal(callerOnly.githubWritePerformed, false)
  assert.equal(callerOnly.intents[0].args.runId, undefined)
  const stillDry = await explicit.tools[0].execute({ goal: 'fix the gate', repo, live: false })
  assert.equal(stillDry.live, false)
  assert.equal(stillDry.state, 'waiting')
})

test('operator setting wins over a dig caller live true', async () => {
  const configOnly = host()
  apply(configOnly.ctx, { live: true, env: { PATH: '' } })
  const dryConfig = await configOnly.tools[0].execute({ goal: 'fix the gate', repo, live: true })
  assert.equal(dryConfig.live, false)
  assert.equal(dryConfig.state, 'waiting')
  assert.equal(dryConfig.githubWritePerformed, false)

  const veto = host()
  apply(veto.ctx, { live: false, env: { PATH: '', OPC_ORCA_LIVE: '1' } })
  const dryVeto = await veto.tools[0].execute({ goal: 'fix the gate', repo, live: true })
  assert.equal(dryVeto.live, false)
  assert.equal(dryVeto.state, 'waiting')
  assert.equal(dryVeto.path, 'orca-worker')
  assert.equal(dryVeto.githubWritePerformed, false)
  assert.equal(dryVeto.intents[0].args.runId, undefined)

  const allowed = host()
  apply(allowed.ctx, { env: { PATH: '', OPC_ORCA_LIVE: '1' } })
  await assert.rejects(
    () => allowed.tools[0].execute({ goal: 'fix the gate', repo, live: true }),
    OrcaNotConfiguredError,
  )

  const configAndEnv = host()
  apply(configAndEnv.ctx, { live: true, env: { PATH: '', OPC_ORCA_LIVE: '1' } })
  const easyLive = await configAndEnv.tools[0].execute({ goal: 'typo in the readme', live: true })
  assert.equal(easyLive.live, true)
  assert.equal(easyLive.state, 'converging')
  assert.equal(easyLive.path, 'coordinator-direct')
  assert.equal(easyLive.githubWritePerformed, false)
  assert.notEqual(easyLive.state, 'awaiting_human_pr')
})

test('plugin config from is the handle and a tool argument is not', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'orca-plugin-'))
  const log = path.join(dir, 'spawn.log')
  const file = path.join(dir, 'orca')
  writeFileSync(
    file,
    `#!/bin/sh\nprintf '%s\\n' "$@" >> ${JSON.stringify(log)}\nprintf 'run-id: run-abc\\n'\n`,
  )
  chmodSync(file, 0o755)
  const env = { PATH: dir, OPC_ORCA_LIVE: '1' }

  const missing = host()
  apply(missing.ctx, { env })
  await assert.rejects(() => missing.tools[0].execute({ goal: 'fix the gate', repo }), OrcaNoSenderError)
  assert.equal(existsSync(log), false)

  const loaded = host()
  apply(loaded.ctx, { env, from: 'term_config' })
  await assert.rejects(
    () => loaded.tools[0].execute({ goal: 'fix the gate', repo, from: 'term_caller' }),
    OrcaParseError,
  )
  const spawned = readFileSync(log, 'utf8')
  assert.match(spawned, /--from\nterm_config\n/)
  assert.equal(spawned.includes('term_caller'), false)
  assert.equal(loaded.tools[0].parameters.from, undefined)
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
