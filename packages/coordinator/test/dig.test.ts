import assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { OrcaNoSenderError, OrcaNotConfiguredError } from '@opc-orca/orca-adapter'

import { operatorAllowsLive, runDig } from '../src/index.ts'

const repo = 'hsliuustc0106/OPC-ORCA'

function touchBin(): { dir: string; log: string } {
  const dir = mkdtempSync(path.join(tmpdir(), 'orca-dig-'))
  const log = path.join(dir, 'spawned')
  const file = path.join(dir, 'orca')
  writeFileSync(file, `#!/bin/sh\ntouch ${JSON.stringify(log)}\nprintf 'run-id: run-abc\\n'\n`)
  chmodSync(file, 0o755)
  return { dir, log }
}

test('operator switch: caller live true is not a grant', () => {
  assert.equal(operatorAllowsLive({ live: true, env: { PATH: '' } }), false)
  assert.equal(operatorAllowsLive({ live: true, configLive: true, env: { PATH: '' } }), false)
  assert.equal(operatorAllowsLive({ env: { PATH: '', OPC_ORCA_LIVE: 'true' } }), false)
  assert.equal(operatorAllowsLive({ env: { PATH: '', OPC_ORCA_LIVE: '' } }), false)
  assert.equal(
    operatorAllowsLive({ live: true, configLive: false, env: { PATH: '', OPC_ORCA_LIVE: '1' } }),
    false,
  )
  assert.equal(operatorAllowsLive({ live: false, env: { PATH: '', OPC_ORCA_LIVE: '1' } }), false)
  assert.equal(operatorAllowsLive({ env: { PATH: '', OPC_ORCA_LIVE: '1' } }), true)
  assert.equal(operatorAllowsLive({ live: true, env: { PATH: '', OPC_ORCA_LIVE: '1' } }), true)
  assert.equal(
    operatorAllowsLive({ live: true, configLive: true, env: { PATH: '', OPC_ORCA_LIVE: '1' } }),
    true,
  )
})

test('caller live true does not spawn when OPC_ORCA_LIVE is unset', async () => {
  const bin = touchBin()
  const summary = await runDig({
    goal: 'fix the gate',
    repo,
    live: true,
    env: { PATH: bin.dir },
    platform: 'linux',
  })
  assert.equal(summary.live, false)
  assert.equal(summary.state, 'waiting')
  assert.equal(summary.path, 'orca-worker')
  assert.equal(summary.githubWritePerformed, false)
  assert.equal(summary.humanDecision, null)
  assert.equal(summary.intents[0]?.args.runId, undefined)
  assert.equal(existsSync(bin.log), false)

  const easy = await runDig({
    goal: 'typo in the readme',
    live: true,
    configLive: true,
    env: { PATH: bin.dir },
    platform: 'linux',
  })
  assert.equal(easy.live, false)
  assert.equal(easy.state, 'converging')
  assert.equal(easy.path, 'coordinator-direct')
  assert.equal(easy.githubWritePerformed, false)
  assert.equal(existsSync(bin.log), false)
})

test('config.live false overrules caller live true and OPC_ORCA_LIVE=1', async () => {
  const bin = touchBin()
  const summary = await runDig({
    goal: 'fix the gate',
    repo,
    live: true,
    configLive: false,
    env: { PATH: bin.dir, OPC_ORCA_LIVE: '1' },
    platform: 'linux',
  })
  assert.equal(summary.live, false)
  assert.equal(summary.state, 'waiting')
  assert.equal(summary.githubWritePerformed, false)
  assert.equal(summary.intents[0]?.args.runId, undefined)
  assert.equal(existsSync(bin.log), false)
})

test('caller live false forces dry-run when the operator env is on', async () => {
  const bin = touchBin()
  const summary = await runDig({
    goal: 'fix the gate',
    repo,
    live: false,
    env: { PATH: bin.dir, OPC_ORCA_LIVE: '1' },
    platform: 'linux',
  })
  assert.equal(summary.live, false)
  assert.equal(summary.state, 'waiting')
  assert.equal(existsSync(bin.log), false)
})

test('operator env on tries to spawn and does not invent a summary', async () => {
  await assert.rejects(
    () =>
      runDig({
        goal: 'fix the gate',
        repo,
        env: { PATH: '', OPC_ORCA_LIVE: '1' },
        platform: 'linux',
      }),
    OrcaNotConfiguredError,
  )
  await assert.rejects(
    () =>
      runDig({
        goal: 'fix the gate',
        repo,
        live: true,
        configLive: true,
        env: { PATH: '', OPC_ORCA_LIVE: '1' },
        platform: 'linux',
      }),
    OrcaNotConfiguredError,
  )
  const easy = await runDig({
    goal: 'typo in the readme',
    env: { PATH: '', OPC_ORCA_LIVE: '1' },
    platform: 'linux',
  })
  assert.equal(easy.live, true)
  assert.equal(easy.state, 'converging')
  assert.equal(easy.path, 'coordinator-direct')
  assert.equal(easy.githubWritePerformed, false)
  assert.notEqual(easy.state, 'awaiting_human_pr')
})

const liveProtocol = `
printf '%s\\n' "$@" >> "$log"
cmd=$1
if [ "$1" = orchestration ]; then cmd=$2; fi
case "$cmd" in
  run-create) printf 'run-id: run-abc\\n' ;;
  task-create) printf 'task-id: task-abc\\n' ;;
  worker-start) printf 'worker-id: worker-abc\\n' ;;
  check) printf 'converged: false\\n' ;;
  *) printf 'unknown\\n' >&2; exit 1 ;;
esac
`

function liveBin(): { dir: string; log: string } {
  const dir = mkdtempSync(path.join(tmpdir(), 'orca-dig-live-'))
  const log = path.join(dir, 'spawn.log')
  const file = path.join(dir, 'orca')
  writeFileSync(file, `#!/bin/sh\nlog=${JSON.stringify(log)}\n${liveProtocol}\n`)
  chmodSync(file, 0o755)
  return { dir, log }
}

test('live dig without a terminal handle fails closed and does not spawn', async () => {
  const bin = touchBin()
  await assert.rejects(
    () =>
      runDig({
        goal: 'fix the gate',
        repo,
        env: { PATH: bin.dir, OPC_ORCA_LIVE: '1' },
        platform: 'linux',
      }),
    (error: unknown) => {
      assert.ok(error instanceof OrcaNoSenderError)
      assert.equal(error.code, 'no-sender')
      assert.equal(JSON.stringify(error).includes('term_'), false)
      return true
    },
  )
  assert.equal(existsSync(bin.log), false)
})

test('live dig passes --from from the env and from overrides it', async () => {
  const envBin = liveBin()
  const summary = await runDig({
    goal: 'fix the gate',
    repo,
    env: { PATH: envBin.dir, OPC_ORCA_LIVE: '1', ORCA_TERMINAL_HANDLE: 'term_env' },
    platform: 'linux',
  })
  assert.equal(summary.live, true)
  assert.equal(summary.state, 'waiting')
  assert.equal(summary.path, 'orca-worker')
  assert.equal(summary.githubWritePerformed, false)
  assert.equal(summary.humanDecision, null)
  assert.notEqual(summary.state, 'awaiting_human_pr')
  assert.equal(summary.intents[0]?.args.runId, 'run-abc')
  const envLog = readFileSync(envBin.log, 'utf8')
  assert.match(envLog, /--from\nterm_env\n/)
  assert.match(envLog, /--terminal\nterm_env\n/)
  assert.equal(envLog.includes('--terminal\nterm_env') && envLog.includes('check\n'), true)

  const fromBin = liveBin()
  const overridden = await runDig({
    goal: 'fix the gate',
    repo,
    from: 'term_config',
    env: { PATH: fromBin.dir, OPC_ORCA_LIVE: '1', ORCA_TERMINAL_HANDLE: 'term_env' },
    platform: 'linux',
  })
  assert.equal(overridden.state, 'waiting')
  assert.equal(overridden.githubWritePerformed, false)
  const fromLog = readFileSync(fromBin.log, 'utf8')
  assert.match(fromLog, /--from\nterm_config\n/)
  assert.equal(fromLog.includes('term_env'), false)
  assert.match(fromLog, /--terminal\nterm_config\n/)
})

test('configLive must be boolean', async () => {
  await assert.rejects(
    () => runDig({ goal: 'fix the gate', configLive: 'false' as unknown as boolean }),
    /configLive/,
  )
  await assert.rejects(
    () => runDig({ goal: 'fix the gate', from: 1 as unknown as string }),
    /from must be a string/,
  )
})
