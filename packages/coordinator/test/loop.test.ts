import assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import {
  createOrcaAdapter,
  OrcaNoSenderError,
  OrcaNotConfiguredError,
  OrcaParseError,
  OrcaSpawnError,
  OrcaStubError,
} from '@opc-orca/orca-adapter'
import type { OrcaAdapter, PlannedOrcaCall } from '@opc-orca/orca-adapter'

import {
  createDigLoop,
  DuplicateVerdictError,
  IllegalTransitionError,
  WIRE_ADAPTER_TODO,
} from '../src/index.ts'

const verdict = { outcome: 'PASS' as const, sha: 'abc123', writtenBy: 'Reviewer' }
const repo = 'hsliuustc0106/OPC-ORCA'

function readyNormal() {
  const loop = createDigLoop({ repo })
  loop.acceptGoal('fix the gate')
  loop.triage({ agentReady: true, difficulty: 'normal' })
  return loop
}

test('normal path stops at the human PR gate and records no GitHub write', async () => {
  const loop = readyNormal()
  assert.equal(loop.state, 'plan')
  await loop.bindRun()
  await loop.startWorker()
  await loop.check({ converged: false })
  assert.equal(loop.state, 'waiting')
  await loop.check({ converged: false })
  await loop.check({ converged: true })
  assert.equal(loop.state, 'converging')
  loop.askHumanPr({ sha: 'abc123', verdict })
  assert.equal(loop.state, 'awaiting_human_pr')
  assert.throws(() => loop.humanPrDecision('yes'), TypeError)
  loop.humanPrDecision('yes', 'open')
  const snap = loop.snapshot()
  assert.equal(snap.state, 'done')
  assert.equal(snap.githubWritePerformed, false)
  assert.deepEqual(snap.humanDecision, { answer: 'yes', action: 'open' })
  assert.deepEqual(
    snap.intents.map((intent) => intent.command),
    ['run-create', 'task-create', 'worker-start', 'check', 'check', 'check'],
  )
  assert.equal(snap.intents[0]?.args.base, 'origin/main')
  assert.equal(snap.intents[0]?.args.goal, 'fix the gate')
  assert.equal(snap.intents[0]?.args.repo, repo)
  assert.equal(snap.intents[0]?.args.runId, undefined)
  assert.equal(snap.intents[1]?.args.spec, 'fix the gate')
  assert.equal(snap.intents[1]?.args.worker, undefined)
  assert.equal(snap.intents[1]?.args.worktree, undefined)
  assert.equal(snap.intents[1]?.args.runId, undefined)
  assert.equal(snap.intents[2]?.args.worker, 'dsh')
  assert.equal(snap.intents[2]?.args.worktree, 'new-child')
  assert.equal(snap.intents[2]?.args.taskId, undefined)
  assert.equal(snap.intents[3]?.args.converged, 'false')
  assert.equal(snap.intents[4]?.args.converged, 'false')
  assert.equal(snap.intents[5]?.args.converged, 'true')
  assert.equal(snap.intents[3]?.args.runId, undefined)
  assert.equal(snap.intents[5]?.args.runId, undefined)
  assert.ok(!snap.intents.some((intent) => /pr-|merge|github/i.test(intent.command)))
})

test('easy path never dispatches a worker and still waits for a human', () => {
  const loop = createDigLoop()
  loop.acceptGoal('typo in the readme')
  loop.triage({ agentReady: true, difficulty: 'easy' })
  assert.throws(() => loop.bindRun(), IllegalTransitionError)
  loop.runDirect()
  assert.equal(loop.state, 'converging')
  loop.askHumanPr({ sha: 'def456', verdict: { outcome: 'INC', sha: 'def456', writtenBy: 'Reviewer' } })
  loop.humanPrDecision('no')
  const snap = loop.snapshot()
  assert.equal(snap.path, 'coordinator-direct')
  assert.deepEqual(snap.intents.map((intent) => intent.command), ['coordinator-direct'])
  assert.equal(snap.githubWritePerformed, false)
  assert.equal(snap.stopReason, 'human declined PR action')
  assert.equal(snap.state, 'done')
})

test('triage can stop without a PR ask', () => {
  const loop = createDigLoop()
  loop.acceptGoal('redesign the product')
  loop.triage({ agentReady: false, reason: 'needs a decision' })
  assert.equal(loop.state, 'done')
  assert.equal(loop.snapshot().stopReason, 'needs a decision')
  assert.equal(loop.snapshot().humanDecision, null)
  assert.throws(() => loop.askHumanPr({ sha: 'abc123', verdict }), IllegalTransitionError)
})

test('one Verdict per tip, and a new SHA replaces it', async () => {
  const loop = readyNormal()
  await loop.bindRun()
  await loop.startWorker()
  await loop.check({ converged: true })
  assert.throws(
    () => loop.askHumanPr({ sha: 'abc123', verdict: { outcome: 'PASS', sha: 'abc123', writtenBy: '  ' } }),
    /Written-by/,
  )
  loop.askHumanPr({ sha: 'abc123', verdict })
  assert.throws(() => loop.noteVerdict(verdict), DuplicateVerdictError)
  loop.noteVerdict({ outcome: 'FAIL', sha: 'fff999', writtenBy: 'Reviewer' })
  assert.equal(loop.state, 'awaiting_human_pr')
  assert.equal(loop.snapshot().tipSha, 'fff999')
  assert.equal(loop.snapshot().verdict?.outcome, 'FAIL')
})

test('normal work cannot take the direct path', () => {
  const loop = readyNormal()
  assert.throws(() => loop.runDirect(), IllegalTransitionError)
})

test('adapter wiring is an explicit TODO, not a silent success', () => {
  assert.match(WIRE_ADAPTER_TODO, /TODO\(wire-adapter\)/)
  assert.match(WIRE_ADAPTER_TODO, /dryRun/)
  assert.match(WIRE_ADAPTER_TODO, /not-configured/)
  assert.match(WIRE_ADAPTER_TODO, /not-implemented/)
  assert.match(WIRE_ADAPTER_TODO, /awaiting_human_pr/)
  assert.match(WIRE_ADAPTER_TODO, /coordinator-direct/)
  assert.match(WIRE_ADAPTER_TODO, /waiting loop calls check in dryRun/)
  assert.match(WIRE_ADAPTER_TODO, /status, task-list, and worker-show/)
  assert.match(WIRE_ADAPTER_TODO, /not a substitute for check/)
  assert.match(WIRE_ADAPTER_TODO, /reply may be called in dryRun/)
  assert.match(WIRE_ADAPTER_TODO, /is not the human PR yes/)
  assert.match(WIRE_ADAPTER_TODO, /worker-release may be called in dryRun/)
  assert.match(WIRE_ADAPTER_TODO, /gate-create and gate-resolve may be called in dryRun/)
  assert.match(WIRE_ADAPTER_TODO, /do not move awaiting_human_pr/)
  assert.match(WIRE_ADAPTER_TODO, /not a substitute for the human PR yes/)
  assert.doesNotMatch(WIRE_ADAPTER_TODO, /Still unwired:[^.]+\bcheck\b/)
  assert.doesNotMatch(WIRE_ADAPTER_TODO, /Still unwired:[^.]+\bstatus\b/)
  assert.doesNotMatch(WIRE_ADAPTER_TODO, /Still unwired:[^.]+\btask-list\b/)
  assert.doesNotMatch(WIRE_ADAPTER_TODO, /Still unwired:[^.]+\bworker-show\b/)
  assert.doesNotMatch(WIRE_ADAPTER_TODO, /Still unwired:[^.]+\bworker-release\b/)
  assert.doesNotMatch(WIRE_ADAPTER_TODO, /Still unwired:[^.]+\breply\b/)
  assert.doesNotMatch(WIRE_ADAPTER_TODO, /Still unwired:[^.]+\bgate-create\b/)
  assert.doesNotMatch(WIRE_ADAPTER_TODO, /Still unwired:[^.]+\bgate-resolve\b/)
  assert.match(WIRE_ADAPTER_TODO, /OPC_ORCA_LIVE/)
  assert.match(WIRE_ADAPTER_TODO, /non-zero exit/)
  assert.match(WIRE_ADAPTER_TODO, /unparseable stdout/)
  assert.match(WIRE_ADAPTER_TODO, /no-sender/)
  assert.match(WIRE_ADAPTER_TODO, /parsed live result/)
  assert.match(WIRE_ADAPTER_TODO, /does not advance/)
  assert.doesNotMatch(WIRE_ADAPTER_TODO, /stores only dry-run plans/)
  assert.doesNotMatch(WIRE_ADAPTER_TODO, /Still unwired: live spawn/)
})

test('dry-run waiting loop records the check plan and does not invent a run id', async () => {
  const adapter = createOrcaAdapter({ dryRun: true, env: { PATH: '' }, platform: 'linux' })
  const loop = createDigLoop({ adapter, repo })
  loop.acceptGoal('fix the gate')
  loop.triage({ agentReady: true, difficulty: 'normal' })
  await loop.bindRun()
  await loop.startWorker()
  await loop.check({ converged: false })
  assert.equal(adapter.executable, null)
  assert.equal(adapter.dryRun, true)
  assert.deepEqual(
    adapter.planned.map((call) => call.command),
    ['run-create', 'task-create', 'worker-start', 'check'],
  )
  assert.equal(adapter.planned[0]?.args.base, 'origin/main')
  assert.equal(adapter.planned[1]?.args.spec, 'fix the gate')
  assert.equal(adapter.planned[1]?.args.worker, undefined)
  assert.equal(adapter.planned[1]?.args.worktree, undefined)
  assert.equal(adapter.planned[2]?.args.worker, 'dsh')
  assert.equal(adapter.planned[2]?.args.worktree, 'new-child')
  assert.deepEqual(adapter.planned[3]?.args, { converged: 'false' })
  for (const call of adapter.planned) {
    assert.equal(call.dryRun, true)
    assert.equal(call.args.runId, undefined)
    assert.equal(call.args.taskId, undefined)
    assert.equal(call.args.exitCode, undefined)
  }
  assert.deepEqual(
    loop.snapshot().intents.map((intent) => intent.command),
    adapter.planned.map((call) => call.command),
  )
  assert.deepEqual(loop.snapshot().intents[3]?.args, adapter.planned[3]?.args)
  const echoed = await adapter.check({ runId: 'not-a-run', converged: true })
  assert.equal(Object.hasOwn(echoed.args, 'runId'), false)
  assert.equal(echoed.args.converged, 'true')
  assert.equal(loop.state, 'waiting')
  assert.equal(loop.snapshot().githubWritePerformed, false)
  assert.equal(loop.snapshot().intents.length, 4)
})

test('check before dispatch does not call the adapter', () => {
  const adapter = createOrcaAdapter({ dryRun: true, env: { PATH: '' }, platform: 'linux' })
  const loop = createDigLoop({ adapter, repo })
  loop.acceptGoal('fix the gate')
  loop.triage({ agentReady: true, difficulty: 'normal' })
  assert.throws(() => loop.check({ converged: true }), IllegalTransitionError)
  assert.equal(loop.state, 'plan')
  assert.deepEqual(adapter.planned, [])
})

test('easy path does not record an Orca plan', () => {
  const adapter = createOrcaAdapter({ dryRun: true, env: { PATH: '' }, platform: 'linux' })
  const loop = createDigLoop({ adapter, repo })
  loop.acceptGoal('typo in the readme')
  loop.triage({ agentReady: true, difficulty: 'easy' })
  loop.runDirect()
  assert.equal(loop.state, 'converging')
  assert.throws(() => loop.status(), IllegalTransitionError)
  assert.throws(() => loop.taskList(), IllegalTransitionError)
  assert.throws(() => loop.workerShow(), IllegalTransitionError)
  assert.throws(() => loop.reply({ text: 'yes' }), IllegalTransitionError)
  assert.throws(() => loop.workerRelease(), IllegalTransitionError)
  assert.throws(() => loop.gateCreate({ reason: 'worker blocked' }), IllegalTransitionError)
  assert.throws(() => loop.gateResolve({ resolution: 'yes' }), IllegalTransitionError)
  assert.deepEqual(adapter.planned, [])
})

test('bindRun without a repo does not call the adapter', () => {
  const adapter = createOrcaAdapter({ dryRun: true, env: { PATH: '' }, platform: 'linux' })
  const loop = createDigLoop({ adapter })
  loop.acceptGoal('fix the gate')
  loop.triage({ agentReady: true, difficulty: 'normal' })
  assert.throws(() => loop.bindRun(), /repo is required/)
  assert.equal(loop.state, 'plan')
  assert.deepEqual(adapter.planned, [])
})

test('live adapter rejection does not bind a run or invent an id', async () => {
  const missing = createOrcaAdapter({ env: { PATH: '' }, platform: 'linux' })
  const missingLoop = createDigLoop({ adapter: missing, repo })
  missingLoop.acceptGoal('fix the gate')
  missingLoop.triage({ agentReady: true, difficulty: 'normal' })
  await assert.rejects(() => missingLoop.bindRun(), (error: unknown) => {
    assert.ok(error instanceof OrcaNotConfiguredError)
    assert.equal(error.code, 'not-configured')
    return true
  })
  assert.equal(missingLoop.state, 'plan')
  assert.equal(missingLoop.snapshot().path, null)
  assert.deepEqual(missingLoop.snapshot().intents, [])
  assert.equal(missingLoop.snapshot().githubWritePerformed, false)
  assert.deepEqual(missing.planned, [])

  const dir = mkdtempSync(path.join(tmpdir(), 'orca-bin-'))
  const bin = path.join(dir, 'orca')
  writeFileSync(bin, '#!/bin/sh\nexit 0\n')
  chmodSync(bin, 0o755)
  const present = createOrcaAdapter({ env: { PATH: dir }, platform: 'linux' })
  const presentLoop = createDigLoop({ adapter: present, repo })
  presentLoop.acceptGoal('fix the gate')
  presentLoop.triage({ agentReady: true, difficulty: 'normal' })
  await assert.rejects(() => presentLoop.bindRun(), (error: unknown) => {
    assert.ok(error instanceof OrcaStubError)
    assert.equal(error.code, 'not-implemented')
    return true
  })
  assert.equal(presentLoop.state, 'plan')
  assert.deepEqual(presentLoop.snapshot().intents, [])
  assert.deepEqual(present.planned, [])
  assert.equal(presentLoop.snapshot().githubWritePerformed, false)
})

const HANDLE = 'term_test'

function liveEnv(dir: string): { PATH: string; ORCA_TERMINAL_HANDLE: string; OPC_ORCA_AGENT: string } {
  return { PATH: dir, ORCA_TERMINAL_HANDLE: HANDLE, OPC_ORCA_AGENT: 'cursor' }
}

function emit(result: unknown): string {
  const payload = JSON.stringify({ ok: true, id: 'rpc_envelope', result })
  return `printf '%s\\n' ${JSON.stringify(payload)}`
}

function liveScript(body: string): { dir: string; log: string } {
  const dir = mkdtempSync(path.join(tmpdir(), 'orca-live-loop-'))
  const log = path.join(dir, 'spawn.log')
  const file = path.join(dir, 'orca')
  writeFileSync(file, `#!/bin/sh\nlog=${JSON.stringify(log)}\n${body}\n`)
  chmodSync(file, 0o755)
  return { dir, log }
}

test('live spawn failure does not advance the coordinator', async () => {
  const missing = createOrcaAdapter({ live: true, env: { PATH: '' }, platform: 'linux' })
  const missingLoop = createDigLoop({ adapter: missing, repo })
  missingLoop.acceptGoal('fix the gate')
  missingLoop.triage({ agentReady: true, difficulty: 'normal' })
  await assert.rejects(() => missingLoop.bindRun(), OrcaNotConfiguredError)
  assert.equal(missingLoop.state, 'plan')
  assert.deepEqual(missingLoop.snapshot().intents, [])
  assert.equal(missingLoop.snapshot().githubWritePerformed, false)
  assert.notEqual(missingLoop.state, 'awaiting_human_pr')

  const crashed = liveScript('printf \'run-id: run-abc\\n\'\nexit 3\n')
  const crashedAdapter = createOrcaAdapter({ live: true, env: liveEnv(crashed.dir), platform: 'linux' })
  const crashedLoop = createDigLoop({ adapter: crashedAdapter, repo })
  crashedLoop.acceptGoal('fix the gate')
  crashedLoop.triage({ agentReady: true, difficulty: 'normal' })
  await assert.rejects(() => crashedLoop.bindRun(), (error: unknown) => {
    assert.ok(error instanceof OrcaSpawnError)
    assert.equal(error.exitCode, 3)
    assert.equal(Object.hasOwn(error, 'runId'), false)
    return true
  })
  assert.equal(crashedLoop.state, 'plan')
  assert.deepEqual(crashedLoop.snapshot().intents, [])
  assert.equal(JSON.stringify(crashedLoop.snapshot()).includes('run-abc'), false)
  assert.equal(crashedLoop.snapshot().githubWritePerformed, false)

  const garbled = liveScript('printf \'not a field\\n\'\nexit 0\n')
  const garbledAdapter = createOrcaAdapter({ live: true, env: liveEnv(garbled.dir), platform: 'linux' })
  const garbledLoop = createDigLoop({ adapter: garbledAdapter, repo })
  garbledLoop.acceptGoal('fix the gate')
  garbledLoop.triage({ agentReady: true, difficulty: 'normal' })
  await assert.rejects(() => garbledLoop.bindRun(), OrcaParseError)
  assert.equal(garbledLoop.state, 'plan')
  assert.deepEqual(garbledLoop.snapshot().intents, [])
  assert.equal(garbledLoop.snapshot().githubWritePerformed, false)

  const half = liveScript(`
printf '%s\\n' "$@" >> "$log"
cmd=$1
if [ "$1" = orchestration ]; then cmd=$2; fi
case "$cmd" in
  run-create) ${emit({ run: { id: 'run-abc' } })} ;;
  *) printf 'Run run_57808dafd589 created and bound: smoke parse sample\\n' ;;
esac
`)
  const halfAdapter = createOrcaAdapter({ live: true, env: liveEnv(half.dir), platform: 'linux' })
  const halfLoop = createDigLoop({ adapter: halfAdapter, repo })
  halfLoop.acceptGoal('fix the gate')
  halfLoop.triage({ agentReady: true, difficulty: 'normal' })
  await assert.rejects(() => halfLoop.bindRun(), OrcaParseError)
  assert.equal(halfLoop.state, 'plan')
  assert.equal(halfLoop.snapshot().path, null)
  assert.deepEqual(halfLoop.snapshot().intents, [])
  assert.equal(JSON.stringify(halfLoop.snapshot()).includes('run-abc'), false)
  assert.equal(halfLoop.snapshot().githubWritePerformed, false)
  assert.notEqual(halfLoop.state, 'awaiting_human_pr')
})

const liveProtocol = `
printf '%s\\n' "$@" >> "$log"
cmd=$1
if [ "$1" = orchestration ]; then cmd=$2; fi
case "$cmd" in
  run-create) ${emit({ run: { id: 'run-abc' } })} ;;
  task-create) ${emit({ task: { id: 'task-abc', status: 'open' } })} ;;
  worker-start) ${emit({ dispatchId: 'worker-abc', state: 'ready' })} ;;
  worker-show) ${emit({ dispatch: { id: 'worker-abc' } })} ;;
  worker-release) ${emit({ dispatchId: 'worker-abc' })} ;;
  check) ${emit({ messages: [{ type: 'worker_done' }], count: 1, converged: true })} ;;
  status) ${emit({ runtime: { state: 'ready' } })} ;;
  task-list) ${emit({ tasks: [], count: 0 })} ;;
  reply) ${emit({ message: { id: 'msg-abc' } })} ;;
  gate-create) ${emit({ gate: { id: 'gate-abc' } })} ;;
  gate-resolve) ${emit({ gate: { id: 'gate-done' } })} ;;
  *) printf 'unknown\\n' >&2; exit 1 ;;
esac
`

function argvGroups(log: string): string[][] {
  const commands = new Set([
    'run-create',
    'task-create',
    'worker-start',
    'worker-show',
    'worker-release',
    'check',
    'status',
    'task-list',
    'reply',
    'gate-create',
    'gate-resolve',
  ])
  const groups: string[][] = []
  let current: string[] | null = null
  for (const line of log.trim().split('\n')) {
    if (line === 'orchestration') {
      current = null
      continue
    }
    if (commands.has(line)) {
      current = [line]
      groups.push(current)
    } else if (current) {
      current.push(line)
    }
  }
  return groups
}

test('a live bind without a terminal handle fails closed and does not advance', async () => {
  const bin = liveScript('printf \'run-id: run-abc\\n\'\n')
  const adapter = createOrcaAdapter({ live: true, env: { PATH: bin.dir }, platform: 'linux' })
  const loop = createDigLoop({ adapter, repo })
  loop.acceptGoal('fix the gate')
  loop.triage({ agentReady: true, difficulty: 'normal' })
  await assert.rejects(
    () => loop.bindRun(),
    (error: unknown) => {
      assert.ok(error instanceof OrcaNoSenderError)
      assert.equal(error.code, 'no-sender')
      assert.equal(JSON.stringify(error).includes('term_'), false)
      return true
    },
  )
  assert.equal(loop.state, 'plan')
  assert.deepEqual(loop.snapshot().intents, [])
  assert.equal(existsSync(bin.log), false)
  assert.equal(JSON.stringify(loop.snapshot()).includes('run-abc'), false)
  assert.equal(loop.snapshot().githubWritePerformed, false)
  assert.notEqual(loop.state, 'awaiting_human_pr')
})

test('a parsed live result advances the coordinator and still stops for a human', async () => {
  const ok = liveScript(liveProtocol)
  const adapter = createOrcaAdapter({ live: true, env: liveEnv(ok.dir), platform: 'linux' })
  const loop = createDigLoop({ adapter, repo })
  loop.acceptGoal('fix the gate')
  loop.triage({ agentReady: true, difficulty: 'normal' })
  await loop.bindRun()
  assert.equal(loop.state, 'run_bound')
  assert.equal(loop.snapshot().path, 'orca-worker')
  assert.equal(loop.snapshot().intents[0]?.args.runId, 'run-abc')
  assert.equal(loop.snapshot().intents[0]?.args.goal, undefined)
  assert.equal(loop.snapshot().intents[1]?.args.taskId, 'task-abc')
  assert.equal(loop.snapshot().intents[1]?.args.runId, undefined)
  await loop.startWorker()
  assert.equal(loop.state, 'dispatched')
  assert.equal(loop.snapshot().intents[2]?.args.workerId, 'worker-abc')

  await loop.check({ converged: true })
  assert.equal(loop.state, 'waiting')
  assert.equal(loop.snapshot().intents[3]?.args.converged, 'false')
  assert.equal(loop.snapshot().intents[3]?.args.runId, undefined)

  await loop.status()
  await loop.taskList()
  await loop.workerShow()
  await assert.rejects(() => loop.reply({ text: 'ship the tip' }), /messageId is required/)
  assert.equal(loop.state, 'waiting')
  assert.equal(loop.snapshot().intents.some((intent) => intent.command === 'reply'), false)
  await loop.reply({ text: 'ship the tip', messageId: 'msg-ask' })
  assert.equal(loop.snapshot().intents.at(-1)?.args.messageId, 'msg-abc')
  assert.notEqual(loop.snapshot().intents.at(-1)?.args.messageId, 'msg-ask')
  await loop.gateCreate({ reason: 'worker blocked' })
  await loop.gateResolve({ resolution: 'continue' })
  assert.equal(loop.state, 'waiting')
  assert.equal(loop.snapshot().humanDecision, null)
  assert.throws(() => loop.askHumanPr({ sha: 'abc123', verdict }), IllegalTransitionError)
  assert.equal(loop.snapshot().intents[4]?.args.status, 'ready')
  assert.deepEqual(loop.snapshot().intents[5]?.args, { tasks: '0' })
  assert.deepEqual(loop.snapshot().intents[6]?.args, { workerId: 'worker-abc' })
  assert.deepEqual(loop.snapshot().intents[7]?.args, { messageId: 'msg-abc' })
  assert.deepEqual(loop.snapshot().intents[8]?.args, { gateId: 'gate-abc' })
  assert.deepEqual(loop.snapshot().intents[9]?.args, { gateId: 'gate-done' })

  await loop.check({ converged: true })
  assert.equal(loop.state, 'waiting')
  assert.equal(loop.snapshot().intents.at(-1)?.args.converged, 'false')
  assert.equal(loop.snapshot().intents.at(-1)?.args.runId, undefined)
  assert.throws(() => loop.workerRelease(), IllegalTransitionError)
  assert.throws(() => loop.askHumanPr({ sha: 'abc123', verdict }), IllegalTransitionError)
  assert.equal(loop.state, 'waiting')
  assert.equal(loop.snapshot().githubWritePerformed, false)
  assert.equal(loop.snapshot().humanDecision, null)
  assert.notEqual(loop.state, 'awaiting_human_pr')

  const groups = argvGroups(readFileSync(ok.log, 'utf8'))
  assert.deepEqual(groups[0], ['run-create', '--objective', 'fix the gate', '--from', HANDLE, '--json'])
  assert.deepEqual(groups[1], ['task-create', '--spec', 'fix the gate', '--run', 'run-abc', '--from', HANDLE, '--json'])
  assert.equal(groups[1]?.includes('--worker'), false)
  assert.equal(groups[1]?.includes('--agent'), false)
  const nameAt = groups[2]?.indexOf('--name') ?? -1
  const worktreeName = groups[2]?.[nameAt + 1] ?? ''
  assert.match(worktreeName, /^opc-[a-f0-9]{12}$/)
  const workerArgv = (groups[2] ?? []).filter((_, index) => index !== nameAt && index !== nameAt + 1)
  assert.deepEqual(workerArgv, [
    'worker-start',
    '--task',
    'task-abc',
    '--agent',
    'cursor',
    '--worktree',
    'new-child',
    '--run',
    'run-abc',
    '--from',
    HANDLE,
    '--json',
  ])
  assert.equal(workerArgv.includes('dsh'), false)
  assert.notEqual(worktreeName, 'worker-abc')
  assert.equal(groups[2]?.includes('--terminal'), false)
  assert.deepEqual(groups[3], ['check', '--run', 'run-abc', '--terminal', HANDLE, '--json'])
  assert.equal(groups[3]?.includes('--from'), false)
  assert.equal(groups[3]?.includes('--converged'), false)
  assert.equal(groups.some((group) => group[0] === 'reply' && group.includes('--id') && group.includes('msg-ask') && group.includes('--body')), true)
  assert.equal(groups.some((group) => group[0] === 'gate-create' && group.includes('--task') && group.includes('task-abc') && group.includes('--question')), true)
  assert.equal(groups.some((group) => group[0] === 'gate-resolve' && group.includes('--id') && group.includes('gate-abc')), true)
  assert.equal(groups.some((group) => group.includes('--goal') || group.includes('--repo') || group.includes('--run-id') || group.includes(repo)), false)
  assert.equal(groups.some((group) => group.includes('run-supplied')), false)
  const raw = readFileSync(ok.log, 'utf8')
  assert.match(raw, /^orchestration\nrun-create\n/)
  assert.equal(adapter.planned.length, 0)
})

test('a non-zero live check does not advance and does not keep stdout ids', async () => {
  const crashed = liveScript(`
printf '%s\\n' "$@" >> "$log"
cmd=$1
if [ "$1" = orchestration ]; then cmd=$2; fi
case "$cmd" in
  run-create) ${emit({ run: { id: 'run-ok' } })} ;;
  task-create) ${emit({ task: { id: 'task-ok' } })} ;;
  worker-start) ${emit({ dispatchId: 'worker-ok', state: 'ready' })} ;;
  check) ${emit({ messages: [], count: 0, runId: 'run-nope' })}; exit 5 ;;
  *) exit 1 ;;
esac
`)
  const adapter = createOrcaAdapter({ live: true, env: liveEnv(crashed.dir), platform: 'linux' })
  const loop = createDigLoop({ adapter, repo })
  loop.acceptGoal('fix the gate')
  loop.triage({ agentReady: true, difficulty: 'normal' })
  await loop.bindRun()
  await loop.startWorker()
  assert.equal(loop.state, 'dispatched')
  await assert.rejects(
    () => loop.check({ converged: true }),
    (error: unknown) => {
      assert.ok(error instanceof OrcaSpawnError)
      assert.equal(error.exitCode, 5)
      assert.equal(Object.hasOwn(error, 'runId'), false)
      return true
    },
  )
  assert.equal(loop.state, 'dispatched')
  assert.deepEqual(
    loop.snapshot().intents.map((intent) => intent.command),
    ['run-create', 'task-create', 'worker-start'],
  )
  assert.equal(loop.snapshot().intents[0]?.args.runId, 'run-ok')
  assert.equal(JSON.stringify(loop.snapshot()).includes('run-nope'), false)
  assert.equal(loop.snapshot().githubWritePerformed, false)
  assert.notEqual(loop.state, 'awaiting_human_pr')
  assert.throws(() => loop.askHumanPr({ sha: 'abc123', verdict }), IllegalTransitionError)
})

test('a non-ready live worker-start does not advance and does not keep the dispatch id', async () => {
  const failed = liveScript(`
printf '%s\\n' "$@" >> "$log"
cmd=$1
if [ "$1" = orchestration ]; then cmd=$2; fi
case "$cmd" in
  run-create) ${emit({ run: { id: 'run-ok' } })} ;;
  task-create) ${emit({ task: { id: 'task-ok' } })} ;;
  worker-start) ${emit({ dispatchId: 'ctx_should_not', state: 'failed', failedStage: 'agent_readiness', lastError: 'timeout' })}; exit 1 ;;
  *) exit 1 ;;
esac
`)
  const adapter = createOrcaAdapter({ live: true, env: liveEnv(failed.dir), platform: 'linux' })
  const loop = createDigLoop({ adapter, repo })
  loop.acceptGoal('fix the gate')
  loop.triage({ agentReady: true, difficulty: 'normal' })
  await loop.bindRun()
  assert.equal(loop.state, 'run_bound')
  await assert.rejects(
    () => loop.startWorker(),
    (error: unknown) => {
      assert.ok(error instanceof OrcaSpawnError)
      assert.match(error.message, /failedStage agent_readiness/)
      assert.match(error.message, /lastError timeout/)
      assert.equal(JSON.stringify(error).includes('ctx_should_not'), false)
      return true
    },
  )
  assert.equal(loop.state, 'run_bound')
  assert.deepEqual(
    loop.snapshot().intents.map((intent) => intent.command),
    ['run-create', 'task-create'],
  )
  assert.equal(JSON.stringify(loop.snapshot()).includes('ctx_should_not'), false)
  assert.equal(loop.snapshot().githubWritePerformed, false)
  assert.notEqual(loop.state, 'awaiting_human_pr')
})

test('unparseable live check stdout does not advance', async () => {
  const garbled = liveScript(`
cmd=$1
if [ "$1" = orchestration ]; then cmd=$2; fi
case "$cmd" in
  run-create) ${emit({ run: { id: 'run-ok' } })} ;;
  task-create) ${emit({ task: { id: 'task-ok' } })} ;;
  worker-start) ${emit({ dispatchId: 'worker-ok', state: 'ready' })} ;;
  check) printf 'converged: maybe\\n' ;;
  *) exit 1 ;;
esac
`)
  const adapter = createOrcaAdapter({ live: true, env: liveEnv(garbled.dir), platform: 'linux' })
  const loop = createDigLoop({ adapter, repo })
  loop.acceptGoal('fix the gate')
  loop.triage({ agentReady: true, difficulty: 'normal' })
  await loop.bindRun()
  await loop.startWorker()
  await assert.rejects(() => loop.check({ converged: true }), OrcaParseError)
  assert.equal(loop.state, 'dispatched')
  assert.equal(
    loop.snapshot().intents.some((intent) => intent.command === 'check'),
    false,
  )
  assert.equal(JSON.stringify(loop.snapshot()).includes('maybe'), false)
  assert.equal(loop.snapshot().githubWritePerformed, false)
})

test('a live result missing its parsed id does not advance', async () => {
  let taskCalls = 0
  const adapter = {
    executable: '/tmp/orca',
    dryRun: false,
    live: true,
    planned: [],
    async runCreate() {
      return {
        dryRun: false as const,
        live: true as const,
        command: 'run-create' as const,
        exitCode: 0 as const,
        ids: {},
        fields: {},
      }
    },
    async taskCreate() {
      taskCalls += 1
      throw new Error('task-create must not run without a parsed run id')
    },
  } as unknown as OrcaAdapter
  const loop = createDigLoop({ adapter, repo })
  loop.acceptGoal('fix the gate')
  loop.triage({ agentReady: true, difficulty: 'normal' })
  await assert.rejects(() => loop.bindRun(), /missing runId/)
  assert.equal(taskCalls, 0)
  assert.equal(loop.state, 'plan')
  assert.deepEqual(loop.snapshot().intents, [])
  assert.equal(loop.snapshot().githubWritePerformed, false)
})

function dispatchThen(check: OrcaAdapter['check']): OrcaAdapter {
  return {
    executable: null,
    dryRun: true,
    planned: [],
    async runCreate(): Promise<PlannedOrcaCall> {
      return {
        dryRun: true,
        command: 'run-create',
        args: { goal: 'fix the gate', repo, base: 'origin/main' },
      }
    },
    async taskCreate(): Promise<PlannedOrcaCall> {
      return {
        dryRun: true,
        command: 'task-create',
        args: { spec: 'fix the gate' },
      }
    },
    async workerStart(): Promise<PlannedOrcaCall> {
      return {
        dryRun: true,
        command: 'worker-start',
        args: { worker: 'dsh', worktree: 'new-child' },
      }
    },
    check,
  } as unknown as OrcaAdapter
}

async function dispatchedLoop(adapter: OrcaAdapter) {
  const loop = createDigLoop({ adapter, repo })
  loop.acceptGoal('fix the gate')
  loop.triage({ agentReady: true, difficulty: 'normal' })
  await loop.bindRun()
  await loop.startWorker()
  return loop
}

test('a thrown check is not converged and stores no check intent', async () => {
  const notConfigured = new OrcaNotConfiguredError('orca CLI not found. check is not configured.')
  const blocked = await dispatchedLoop(
    dispatchThen(async () => {
      throw notConfigured
    }),
  )
  await assert.rejects(
    () => blocked.check({ converged: true }),
    (caught: unknown) => caught === notConfigured,
  )
  await assert.rejects(
    () => blocked.check({ converged: true }),
    (caught: unknown) => caught === notConfigured,
  )
  assert.equal(blocked.state, 'dispatched')
  assert.deepEqual(
    blocked.snapshot().intents.map((intent) => intent.command),
    ['run-create', 'task-create', 'worker-start'],
  )
  assert.equal(blocked.snapshot().githubWritePerformed, false)

  let calls = 0
  const notImplemented = new OrcaStubError('refusing to spawn orca check: v0 stub, no success is returned', [
    'orca',
    'check',
  ])
  const loop = await dispatchedLoop(
    dispatchThen(async () => {
      calls += 1
      if (calls === 1) {
        return { dryRun: true, command: 'check', args: { converged: 'false' } }
      }
      throw notImplemented
    }),
  )
  await loop.check({ converged: false })
  assert.equal(loop.state, 'waiting')
  await assert.rejects(
    () => loop.check({ converged: true }),
    (caught: unknown) => {
      assert.equal(caught, notImplemented)
      assert.ok(caught instanceof OrcaStubError)
      assert.equal(caught.code, 'not-implemented')
      return true
    },
  )
  assert.equal(loop.state, 'waiting')
  assert.deepEqual(
    loop.snapshot().intents.map((intent) => intent.command),
    ['run-create', 'task-create', 'worker-start', 'check'],
  )
  assert.equal(loop.snapshot().intents[3]?.args.converged, 'false')
  assert.equal(loop.snapshot().githubWritePerformed, false)
})

test('a check plan that is not the caller flag is not stored as converged', async () => {
  const flipped = await dispatchedLoop(
    dispatchThen(async () => ({
      dryRun: true,
      command: 'check',
      args: { converged: 'true' },
    })),
  )
  await assert.rejects(() => flipped.check({ converged: false }), /caller converged flag/)
  assert.equal(flipped.state, 'dispatched')
  assert.equal(
    flipped.snapshot().intents.some((intent) => intent.command === 'check'),
    false,
  )

  const liveResult = await dispatchedLoop(
    dispatchThen(async () => ({
      dryRun: false,
      command: 'check',
      args: { converged: 'true' },
    }) as unknown as PlannedOrcaCall),
  )
  await assert.rejects(() => liveResult.check({ converged: true }), /refusing to treat an Orca result as success/)
  assert.equal(liveResult.state, 'dispatched')
  assert.equal(liveResult.snapshot().githubWritePerformed, false)
})

test('a fabricated run id on check is not stored as converged', async () => {
  const loop = await dispatchedLoop(
    dispatchThen(async () => ({
      dryRun: true,
      command: 'check',
      args: { converged: 'true', runId: 'run-fake' },
    })),
  )
  await assert.rejects(() => loop.check({ converged: true }), /fabricated Orca id/)
  assert.equal(loop.state, 'dispatched')
  assert.equal(
    loop.snapshot().intents.some((intent) => intent.command === 'check'),
    false,
  )
  assert.equal(loop.snapshot().githubWritePerformed, false)
})

function observationPlan(
  command: 'status' | 'task-list' | 'worker-show',
  args: Record<string, string> = {},
): PlannedOrcaCall {
  return { dryRun: true, command, args }
}

function withObservation(
  handlers: {
    status?: () => Promise<PlannedOrcaCall>
    taskList?: () => Promise<PlannedOrcaCall>
    workerShow?: () => Promise<PlannedOrcaCall>
  } = {},
): OrcaAdapter {
  const base = dispatchThen(async (input) => ({
    dryRun: true,
    command: 'check',
    args: { converged: input.converged ? 'true' : 'false' },
  }))
  return {
    ...base,
    async status() {
      if (handlers.status) return handlers.status()
      return observationPlan('status')
    },
    async taskList() {
      if (handlers.taskList) return handlers.taskList()
      return observationPlan('task-list')
    },
    async workerShow() {
      if (handlers.workerShow) return handlers.workerShow()
      return observationPlan('worker-show')
    },
  } as OrcaAdapter
}

async function waitingLoop(adapter: OrcaAdapter) {
  const loop = await dispatchedLoop(adapter)
  await loop.check({ converged: false })
  return loop
}

test('waiting observation records plans and does not converge', async () => {
  const adapter = createOrcaAdapter({ dryRun: true, env: { PATH: '' }, platform: 'linux' })
  const loop = createDigLoop({ adapter, repo })
  loop.acceptGoal('fix the gate')
  loop.triage({ agentReady: true, difficulty: 'normal' })
  await loop.bindRun()
  assert.throws(() => loop.taskList(), IllegalTransitionError)
  assert.deepEqual(
    adapter.planned.map((call) => call.command),
    ['run-create', 'task-create'],
  )
  await loop.startWorker()
  assert.throws(() => loop.status(), IllegalTransitionError)
  assert.throws(() => loop.workerShow(), IllegalTransitionError)
  assert.deepEqual(
    adapter.planned.map((call) => call.command),
    ['run-create', 'task-create', 'worker-start'],
  )
  await loop.check({ converged: false })
  await loop.status()
  await loop.taskList()
  await loop.workerShow()
  assert.equal(loop.state, 'waiting')
  assert.deepEqual(
    adapter.planned.map((call) => call.command),
    ['run-create', 'task-create', 'worker-start', 'check', 'status', 'task-list', 'worker-show'],
  )
  for (const call of adapter.planned.slice(4)) {
    assert.equal(call.dryRun, true)
    assert.deepEqual(call.args, {})
    assert.equal(call.args.runId, undefined)
    assert.equal(call.args.taskId, undefined)
    assert.equal(call.args.workerId, undefined)
    assert.equal(call.args.exitCode, undefined)
  }
  assert.deepEqual(
    loop.snapshot().intents.map((intent) => intent.command),
    adapter.planned.map((call) => call.command),
  )
  for (const intent of loop.snapshot().intents.slice(4)) {
    assert.deepEqual(intent.args, {})
  }
  await loop.check({ converged: true })
  assert.equal(loop.state, 'converging')
  assert.equal(loop.snapshot().intents.at(-1)?.command, 'check')
  assert.equal(loop.snapshot().intents.at(-1)?.args.converged, 'true')
  assert.throws(() => loop.status(), IllegalTransitionError)
  assert.equal(loop.state, 'converging')
  assert.equal(loop.snapshot().githubWritePerformed, false)
})

test('a thrown observation is not success and does not converge', async () => {
  const notConfigured = new OrcaNotConfiguredError('orca CLI not found. status is not configured.')
  const blocked = await waitingLoop(
    withObservation({
      status: async () => {
        throw notConfigured
      },
    }),
  )
  await assert.rejects(
    () => blocked.status(),
    (caught: unknown) => caught === notConfigured,
  )
  assert.equal(blocked.state, 'waiting')
  assert.deepEqual(
    blocked.snapshot().intents.map((intent) => intent.command),
    ['run-create', 'task-create', 'worker-start', 'check'],
  )

  const notImplemented = new OrcaStubError(
    'refusing to spawn orca task-list: v0 stub, no success is returned',
    ['orca', 'task-list'],
  )
  const loop = await waitingLoop(
    withObservation({
      taskList: async () => {
        throw notImplemented
      },
    }),
  )
  await loop.status()
  await assert.rejects(
    () => loop.taskList(),
    (caught: unknown) => {
      assert.equal(caught, notImplemented)
      assert.ok(caught instanceof OrcaStubError)
      assert.equal(caught.code, 'not-implemented')
      return true
    },
  )
  assert.equal(loop.state, 'waiting')
  assert.deepEqual(
    loop.snapshot().intents.map((intent) => intent.command),
    ['run-create', 'task-create', 'worker-start', 'check', 'status'],
  )
  assert.deepEqual(loop.snapshot().intents.at(-1)?.args, {})
  assert.equal(loop.snapshot().githubWritePerformed, false)
  await loop.workerShow()
  await loop.check({ converged: true })
  assert.equal(loop.state, 'converging')
  assert.equal(loop.snapshot().intents.at(-1)?.args.converged, 'true')
})

test('an observation plan with an id or a status payload is not stored', async () => {
  const cases: Array<{
    call: (loop: Awaited<ReturnType<typeof waitingLoop>>) => Promise<void>
    handlers: Parameters<typeof withObservation>[0]
    message: RegExp
  }> = [
    {
      call: (loop) => loop.status(),
      handlers: { status: async () => observationPlan('status', { runId: 'run-fake' }) },
      message: /fabricated Orca id/,
    },
    {
      call: (loop) => loop.taskList(),
      handlers: { taskList: async () => observationPlan('task-list', { taskId: 'task-fake' }) },
      message: /fabricated Orca id/,
    },
    {
      call: (loop) => loop.workerShow(),
      handlers: { workerShow: async () => observationPlan('worker-show', { workerId: 'worker-fake' }) },
      message: /fabricated Orca id/,
    },
    {
      call: (loop) => loop.status(),
      handlers: { status: async () => observationPlan('status', { phase: 'running', status: 'ok' }) },
      message: /status payload/,
    },
    {
      call: (loop) => loop.workerShow(),
      handlers: { workerShow: async () => observationPlan('worker-show', { converged: 'true' }) },
      message: /status payload/,
    },
    {
      call: (loop) => loop.taskList(),
      handlers: {
        taskList: async () =>
          ({ dryRun: true, command: 'check', args: { converged: 'true' } }) as PlannedOrcaCall,
      },
      message: /refusing to treat an Orca result as success/,
    },
  ]
  for (const item of cases) {
    const loop = await waitingLoop(withObservation(item.handlers))
    await assert.rejects(() => item.call(loop), item.message)
    assert.equal(loop.state, 'waiting')
    assert.deepEqual(
      loop.snapshot().intents.map((intent) => intent.command),
      ['run-create', 'task-create', 'worker-start', 'check'],
    )
    assert.equal(loop.snapshot().githubWritePerformed, false)
  }
})

test('a fabricated Orca id is not stored as success', async () => {
  const adapter = {
    executable: null,
    dryRun: true,
    planned: [],
    async runCreate(): Promise<PlannedOrcaCall> {
      return {
        dryRun: true,
        command: 'run-create',
        args: { goal: 'fix the gate', repo, base: 'origin/main', runId: 'run-fake' },
      }
    },
    async taskCreate(): Promise<PlannedOrcaCall> {
      throw new Error('task-create must not run after a fabricated run id')
    },
  } as unknown as OrcaAdapter
  const loop = createDigLoop({ adapter, repo })
  loop.acceptGoal('fix the gate')
  loop.triage({ agentReady: true, difficulty: 'normal' })
  await assert.rejects(() => loop.bindRun(), /fabricated Orca id/)
  assert.equal(loop.state, 'plan')
  assert.deepEqual(loop.snapshot().intents, [])
  assert.equal(loop.snapshot().githubWritePerformed, false)
})

function withReplyRelease(
  handlers: {
    reply?: (input: { text: string }) => Promise<PlannedOrcaCall>
    workerRelease?: () => Promise<PlannedOrcaCall>
  } = {},
): OrcaAdapter {
  const base = withObservation()
  return {
    ...base,
    async reply(input: { text: string }) {
      if (handlers.reply) return handlers.reply(input)
      return { dryRun: true, command: 'reply', args: { text: input.text } }
    },
    async workerRelease() {
      if (handlers.workerRelease) return handlers.workerRelease()
      return { dryRun: true, command: 'worker-release', args: {} }
    },
  } as OrcaAdapter
}

test('reply while waiting records the answer and does not reach the human PR gate', async () => {
  const adapter = createOrcaAdapter({ dryRun: true, env: { PATH: '' }, platform: 'linux' })
  const loop = createDigLoop({ adapter, repo })
  loop.acceptGoal('fix the gate')
  loop.triage({ agentReady: true, difficulty: 'normal' })
  await loop.bindRun()
  await loop.startWorker()
  assert.throws(() => loop.reply({ text: 'ship the tip' }), IllegalTransitionError)
  assert.equal(loop.state, 'dispatched')
  await loop.check({ converged: false })
  assert.throws(() => loop.reply({ text: ' ' }), TypeError)
  assert.throws(() => loop.reply({ text: '' }), TypeError)
  await loop.reply({ text: '  ship the tip  ' })
  await loop.reply({ text: 'yes' })
  await loop.reply({ text: 'open' })
  assert.equal(loop.state, 'waiting')
  assert.equal(loop.snapshot().humanDecision, null)
  assert.equal(loop.snapshot().tipSha, null)
  assert.equal(loop.snapshot().githubWritePerformed, false)
  assert.throws(() => loop.askHumanPr({ sha: 'abc123', verdict }), IllegalTransitionError)
  assert.equal(loop.state, 'waiting')
  const replies = loop.snapshot().intents.filter((intent) => intent.command === 'reply')
  assert.deepEqual(
    replies.map((intent) => intent.args),
    [{ text: 'ship the tip' }, { text: 'yes' }, { text: 'open' }],
  )
  for (const intent of replies) {
    assert.equal(intent.args.runId, undefined)
    assert.equal(intent.args.messageId, undefined)
    assert.equal(intent.args.exitCode, undefined)
    assert.equal(intent.args.workerId, undefined)
  }
  assert.deepEqual(
    adapter.planned.filter((call) => call.command === 'reply').map((call) => call.args),
    [{ text: 'ship the tip' }, { text: 'yes' }, { text: 'open' }],
  )
  assert.throws(() => loop.workerRelease(), IllegalTransitionError)
  assert.equal(
    adapter.planned.some((call) => call.command === 'worker-release'),
    false,
  )
  await loop.check({ converged: true })
  assert.equal(loop.state, 'converging')
  assert.throws(() => loop.reply({ text: 'still here' }), IllegalTransitionError)
  assert.equal(loop.snapshot().intents.filter((intent) => intent.command === 'reply').length, 3)
  await loop.workerRelease()
  assert.equal(loop.state, 'converging')
  assert.equal(loop.snapshot().humanDecision, null)
  assert.equal(loop.snapshot().githubWritePerformed, false)
  const release = loop.snapshot().intents.at(-1)
  assert.equal(release?.command, 'worker-release')
  assert.deepEqual(release?.args, {})
  assert.equal(release?.args.workerId, undefined)
  assert.equal(adapter.planned.at(-1)?.command, 'worker-release')
  assert.deepEqual(adapter.planned.at(-1)?.args, {})
  loop.askHumanPr({ sha: 'abc123', verdict })
  assert.equal(loop.state, 'awaiting_human_pr')
  assert.throws(() => loop.reply({ text: 'yes' }), IllegalTransitionError)
  assert.throws(() => loop.workerRelease(), IllegalTransitionError)
  assert.equal(loop.state, 'awaiting_human_pr')
  assert.equal(loop.snapshot().humanDecision, null)
  assert.equal(loop.snapshot().githubWritePerformed, false)
  assert.equal(loop.snapshot().intents.at(-1)?.command, 'worker-release')
})

test('a thrown reply is not an answer and does not leave waiting', async () => {
  const notConfigured = new OrcaNotConfiguredError('orca CLI not found. reply is not configured.')
  const blocked = await waitingLoop(
    withReplyRelease({
      reply: async () => {
        throw notConfigured
      },
    }),
  )
  await assert.rejects(
    () => blocked.reply({ text: 'ship the tip' }),
    (caught: unknown) => caught === notConfigured,
  )
  assert.equal(blocked.state, 'waiting')
  assert.equal(blocked.snapshot().humanDecision, null)
  assert.equal(
    blocked.snapshot().intents.some((intent) => intent.command === 'reply'),
    false,
  )
  assert.equal(blocked.snapshot().githubWritePerformed, false)
  assert.throws(() => blocked.askHumanPr({ sha: 'abc123', verdict }), IllegalTransitionError)
  assert.equal(blocked.state, 'waiting')

  const notImplemented = new OrcaStubError(
    'refusing to spawn orca reply: v0 stub, no success is returned',
    ['orca', 'reply'],
  )
  const loop = await waitingLoop(
    withReplyRelease({
      reply: async () => {
        throw notImplemented
      },
    }),
  )
  await assert.rejects(
    () => loop.reply({ text: 'yes' }),
    (caught: unknown) => {
      assert.equal(caught, notImplemented)
      assert.ok(caught instanceof OrcaStubError)
      assert.equal(caught.code, 'not-implemented')
      return true
    },
  )
  assert.equal(loop.state, 'waiting')
  assert.equal(
    loop.snapshot().intents.some((intent) => intent.command === 'reply'),
    false,
  )
  assert.equal(loop.snapshot().githubWritePerformed, false)
})

test('a reply plan with an id or the wrong text is not stored', async () => {
  const cases: Array<{
    reply: () => Promise<PlannedOrcaCall>
    message: RegExp
  }> = [
    {
      reply: async () => ({ dryRun: true, command: 'reply', args: { text: 'ship the tip', runId: 'run-fake' } }),
      message: /fabricated Orca id/,
    },
    {
      reply: async () => ({ dryRun: true, command: 'reply', args: { text: 'ship the tip', messageId: 'msg-1' } }),
      message: /fabricated Orca id/,
    },
    {
      reply: async () => ({ dryRun: true, command: 'reply', args: { text: 'ship the tip', exitCode: '0' } }),
      message: /fabricated Orca id/,
    },
    {
      reply: async () => ({ dryRun: true, command: 'reply', args: { text: '   ' } }),
      message: /answer text and no id/,
    },
    {
      reply: async () => ({ dryRun: true, command: 'reply', args: { text: 'ship the tip', approved: 'yes' } }),
      message: /answer text and no id/,
    },
    {
      reply: async () => ({ dryRun: true, command: 'reply', args: { text: 'different' } }),
      message: /reply plan must record the answer text/,
    },
    {
      reply: async () =>
        ({ dryRun: false, command: 'reply', args: { text: 'ship the tip' } }) as unknown as PlannedOrcaCall,
      message: /refusing to treat an Orca result as success/,
    },
    {
      reply: async () => ({ dryRun: true, command: 'check', args: { converged: 'true' } }),
      message: /refusing to treat an Orca result as success/,
    },
  ]
  for (const item of cases) {
    const loop = await waitingLoop(withReplyRelease({ reply: item.reply }))
    await assert.rejects(() => loop.reply({ text: 'ship the tip' }), item.message)
    assert.equal(loop.state, 'waiting')
    assert.equal(loop.snapshot().humanDecision, null)
    assert.equal(
      loop.snapshot().intents.some((intent) => intent.command === 'reply'),
      false,
    )
    assert.equal(loop.snapshot().githubWritePerformed, false)
    assert.throws(() => loop.askHumanPr({ sha: 'abc123', verdict }), IllegalTransitionError)
    assert.equal(loop.state, 'waiting')
  }
})

test('a thrown worker-release is not success and stays converging', async () => {
  const notConfigured = new OrcaNotConfiguredError(
    'orca CLI not found. worker-release is not configured.',
  )
  const blocked = await waitingLoop(
    withReplyRelease({
      workerRelease: async () => {
        throw notConfigured
      },
    }),
  )
  await blocked.check({ converged: true })
  assert.equal(blocked.state, 'converging')
  await assert.rejects(
    () => blocked.workerRelease(),
    (caught: unknown) => caught === notConfigured,
  )
  assert.equal(blocked.state, 'converging')
  assert.equal(
    blocked.snapshot().intents.some((intent) => intent.command === 'worker-release'),
    false,
  )
  assert.equal(blocked.snapshot().humanDecision, null)
  assert.equal(blocked.snapshot().githubWritePerformed, false)

  const notImplemented = new OrcaStubError(
    'refusing to spawn orca worker-release: v0 stub, no success is returned',
    ['orca', 'worker-release'],
  )
  const loop = await waitingLoop(
    withReplyRelease({
      workerRelease: async () => {
        throw notImplemented
      },
    }),
  )
  await loop.check({ converged: true })
  await assert.rejects(
    () => loop.workerRelease(),
    (caught: unknown) => {
      assert.equal(caught, notImplemented)
      assert.ok(caught instanceof OrcaStubError)
      assert.equal(caught.code, 'not-implemented')
      return true
    },
  )
  assert.equal(loop.state, 'converging')
  assert.equal(loop.snapshot().intents.at(-1)?.command, 'check')
  assert.equal(loop.snapshot().intents.at(-1)?.args.converged, 'true')
  assert.equal(loop.snapshot().humanDecision, null)
  assert.equal(loop.snapshot().githubWritePerformed, false)
})

test('a worker-release plan with an id or a payload is not stored', async () => {
  const cases: Array<{
    workerRelease: () => Promise<PlannedOrcaCall>
    message: RegExp
  }> = [
    {
      workerRelease: async () => ({
        dryRun: true,
        command: 'worker-release',
        args: { workerId: 'worker-fake' },
      }),
      message: /fabricated Orca id/,
    },
    {
      workerRelease: async () => ({
        dryRun: true,
        command: 'worker-release',
        args: { exitCode: '0' },
      }),
      message: /fabricated Orca id/,
    },
    {
      workerRelease: async () => ({
        dryRun: true,
        command: 'worker-release',
        args: { released: 'true' },
      }),
      message: /worker id or a payload/,
    },
    {
      workerRelease: async () =>
        ({ dryRun: false, command: 'worker-release', args: {} }) as unknown as PlannedOrcaCall,
      message: /refusing to treat an Orca result as success/,
    },
    {
      workerRelease: async () => ({ dryRun: true, command: 'reply', args: { text: 'yes' } }),
      message: /refusing to treat an Orca result as success/,
    },
  ]
  for (const item of cases) {
    const loop = await waitingLoop(withReplyRelease({ workerRelease: item.workerRelease }))
    await loop.check({ converged: true })
    const before = loop.snapshot().intents.length
    await assert.rejects(() => loop.workerRelease(), item.message)
    assert.equal(loop.state, 'converging')
    assert.equal(loop.snapshot().intents.length, before)
    assert.equal(
      loop.snapshot().intents.some((intent) => intent.command === 'worker-release'),
      false,
    )
    assert.equal(loop.snapshot().humanDecision, null)
    assert.equal(loop.snapshot().githubWritePerformed, false)
  }
})

function withGates(
  handlers: {
    gateCreate?: (input: { reason: string }) => Promise<PlannedOrcaCall>
    gateResolve?: (input: { resolution: string }) => Promise<PlannedOrcaCall>
  } = {},
): OrcaAdapter {
  const base = withReplyRelease()
  return {
    ...base,
    async gateCreate(input: { reason: string }) {
      if (handlers.gateCreate) return handlers.gateCreate(input)
      return { dryRun: true, command: 'gate-create', args: { reason: input.reason } }
    },
    async gateResolve(input: { resolution: string }) {
      if (handlers.gateResolve) return handlers.gateResolve(input)
      return { dryRun: true, command: 'gate-resolve', args: { resolution: input.resolution } }
    },
  } as OrcaAdapter
}

test('backend gates while waiting record plans and do not reach the human PR gate', async () => {
  const adapter = createOrcaAdapter({ dryRun: true, env: { PATH: '' }, platform: 'linux' })
  const loop = createDigLoop({ adapter, repo })
  loop.acceptGoal('fix the gate')
  loop.triage({ agentReady: true, difficulty: 'normal' })
  await loop.bindRun()
  await loop.startWorker()
  assert.throws(() => loop.gateCreate({ reason: 'worker blocked' }), IllegalTransitionError)
  assert.throws(() => loop.gateResolve({ resolution: 'continue' }), IllegalTransitionError)
  assert.equal(loop.state, 'dispatched')
  assert.equal(
    adapter.planned.some((call) => call.command === 'gate-create' || call.command === 'gate-resolve'),
    false,
  )
  await loop.check({ converged: false })
  assert.throws(() => loop.gateCreate({ reason: ' ' }), TypeError)
  assert.throws(() => loop.gateCreate({ reason: '' }), TypeError)
  assert.throws(() => loop.gateResolve({ resolution: ' ' }), TypeError)
  assert.throws(() => loop.gateResolve({ resolution: '' }), TypeError)
  await loop.gateCreate({ reason: '  worker blocked  ' })
  await loop.gateResolve({ resolution: 'continue' })
  await loop.gateCreate({ reason: 'need a task decision' })
  await loop.gateResolve({ resolution: 'yes' })
  await loop.gateResolve({ resolution: 'open' })
  await loop.gateResolve({ resolution: 'merge' })
  assert.equal(loop.state, 'waiting')
  assert.equal(loop.snapshot().humanDecision, null)
  assert.equal(loop.snapshot().tipSha, null)
  assert.equal(loop.snapshot().verdict, null)
  assert.equal(loop.snapshot().githubWritePerformed, false)
  assert.throws(() => loop.askHumanPr({ sha: 'abc123', verdict }), IllegalTransitionError)
  assert.equal(loop.state, 'waiting')
  const gates = loop.snapshot().intents.filter((intent) => intent.command === 'gate-create' || intent.command === 'gate-resolve')
  assert.deepEqual(
    gates.map((intent) => ({ command: intent.command, args: intent.args })),
    [
      { command: 'gate-create', args: { reason: 'worker blocked' } },
      { command: 'gate-resolve', args: { resolution: 'continue' } },
      { command: 'gate-create', args: { reason: 'need a task decision' } },
      { command: 'gate-resolve', args: { resolution: 'yes' } },
      { command: 'gate-resolve', args: { resolution: 'open' } },
      { command: 'gate-resolve', args: { resolution: 'merge' } },
    ],
  )
  for (const intent of gates) {
    assert.equal(intent.args.runId, undefined)
    assert.equal(intent.args.gateId, undefined)
    assert.equal(intent.args.exitCode, undefined)
    assert.equal(intent.args.taskId, undefined)
    assert.equal(intent.args.workerId, undefined)
  }
  assert.ok(!gates.some((intent) => /pr-|merge|github/i.test(intent.command)))
  assert.deepEqual(
    adapter.planned
      .filter((call) => call.command === 'gate-create' || call.command === 'gate-resolve')
      .map((call) => ({ command: call.command, args: call.args })),
    gates.map((intent) => ({ command: intent.command, args: intent.args })),
  )
  await loop.check({ converged: true })
  assert.equal(loop.state, 'converging')
  assert.throws(() => loop.gateCreate({ reason: 'too late' }), IllegalTransitionError)
  assert.throws(() => loop.gateResolve({ resolution: 'yes' }), IllegalTransitionError)
  assert.equal(loop.snapshot().intents.filter((intent) => intent.command === 'gate-create').length, 2)
  assert.equal(loop.snapshot().intents.filter((intent) => intent.command === 'gate-resolve').length, 4)
  loop.askHumanPr({ sha: 'abc123', verdict })
  assert.equal(loop.state, 'awaiting_human_pr')
  assert.throws(() => loop.gateCreate({ reason: 'yes' }), IllegalTransitionError)
  assert.throws(() => loop.gateResolve({ resolution: 'merge' }), IllegalTransitionError)
  assert.equal(loop.state, 'awaiting_human_pr')
  assert.equal(loop.snapshot().humanDecision, null)
  assert.equal(loop.snapshot().githubWritePerformed, false)
  assert.equal(loop.snapshot().intents.at(-1)?.command, 'check')
  assert.equal(loop.snapshot().intents.at(-1)?.args.converged, 'true')
})

test('a thrown backend gate is not success and does not leave waiting', async () => {
  const notConfigured = new OrcaNotConfiguredError('orca CLI not found. gate-create is not configured.')
  const blocked = await waitingLoop(
    withGates({
      gateCreate: async () => {
        throw notConfigured
      },
    }),
  )
  await assert.rejects(
    () => blocked.gateCreate({ reason: 'worker blocked' }),
    (caught: unknown) => caught === notConfigured,
  )
  assert.equal(blocked.state, 'waiting')
  assert.equal(blocked.snapshot().humanDecision, null)
  assert.equal(
    blocked.snapshot().intents.some((intent) => intent.command === 'gate-create' || intent.command === 'gate-resolve'),
    false,
  )
  assert.equal(blocked.snapshot().githubWritePerformed, false)
  assert.throws(() => blocked.askHumanPr({ sha: 'abc123', verdict }), IllegalTransitionError)
  assert.equal(blocked.state, 'waiting')

  const notImplemented = new OrcaStubError(
    'refusing to spawn orca gate-resolve: v0 stub, no success is returned',
    ['orca', 'gate-resolve'],
  )
  const loop = await waitingLoop(
    withGates({
      gateResolve: async () => {
        throw notImplemented
      },
    }),
  )
  await loop.gateCreate({ reason: 'worker blocked' })
  await assert.rejects(
    () => loop.gateResolve({ resolution: 'yes' }),
    (caught: unknown) => {
      assert.equal(caught, notImplemented)
      assert.ok(caught instanceof OrcaStubError)
      assert.equal(caught.code, 'not-implemented')
      return true
    },
  )
  assert.equal(loop.state, 'waiting')
  assert.deepEqual(
    loop.snapshot().intents.filter((intent) => intent.command === 'gate-create' || intent.command === 'gate-resolve'),
    [{ command: 'gate-create', args: { reason: 'worker blocked' } }],
  )
  assert.equal(loop.snapshot().humanDecision, null)
  assert.equal(loop.snapshot().githubWritePerformed, false)
  assert.throws(() => loop.askHumanPr({ sha: 'abc123', verdict }), IllegalTransitionError)
  assert.equal(loop.state, 'waiting')
})

test('a backend gate plan with an id or the wrong text is not stored', async () => {
  const cases: Array<{
    call: (loop: Awaited<ReturnType<typeof waitingLoop>>) => Promise<void>
    handlers: Parameters<typeof withGates>[0]
    message: RegExp
  }> = [
    {
      call: (loop) => loop.gateCreate({ reason: 'worker blocked' }),
      handlers: {
        gateCreate: async () => ({
          dryRun: true,
          command: 'gate-create',
          args: { reason: 'worker blocked', runId: 'run-fake' },
        }),
      },
      message: /fabricated Orca id/,
    },
    {
      call: (loop) => loop.gateCreate({ reason: 'worker blocked' }),
      handlers: {
        gateCreate: async () => ({
          dryRun: true,
          command: 'gate-create',
          args: { reason: 'worker blocked', gateId: 'gate-1' },
        }),
      },
      message: /fabricated Orca id/,
    },
    {
      call: (loop) => loop.gateResolve({ resolution: 'continue' }),
      handlers: {
        gateResolve: async () => ({
          dryRun: true,
          command: 'gate-resolve',
          args: { resolution: 'continue', gateId: 'gate-1' },
        }),
      },
      message: /fabricated Orca id/,
    },
    {
      call: (loop) => loop.gateResolve({ resolution: 'yes' }),
      handlers: {
        gateResolve: async () => ({
          dryRun: true,
          command: 'gate-resolve',
          args: { resolution: 'yes', exitCode: '0' },
        }),
      },
      message: /fabricated Orca id/,
    },
    {
      call: (loop) => loop.gateCreate({ reason: 'worker blocked' }),
      handlers: {
        gateCreate: async () => ({ dryRun: true, command: 'gate-create', args: { reason: '   ' } }),
      },
      message: /reason and no id/,
    },
    {
      call: (loop) => loop.gateCreate({ reason: 'worker blocked' }),
      handlers: {
        gateCreate: async () => ({
          dryRun: true,
          command: 'gate-create',
          args: { reason: 'worker blocked', approved: 'yes' },
        }),
      },
      message: /reason and no id/,
    },
    {
      call: (loop) => loop.gateResolve({ resolution: 'continue' }),
      handlers: {
        gateResolve: async () => ({
          dryRun: true,
          command: 'gate-resolve',
          args: { resolution: 'continue', action: 'merge' },
        }),
      },
      message: /resolution and no id/,
    },
    {
      call: (loop) => loop.gateCreate({ reason: 'worker blocked' }),
      handlers: {
        gateCreate: async () => ({ dryRun: true, command: 'gate-create', args: { reason: 'different' } }),
      },
      message: /gate-create plan must record the reason/,
    },
    {
      call: (loop) => loop.gateResolve({ resolution: 'continue' }),
      handlers: {
        gateResolve: async () => ({ dryRun: true, command: 'gate-resolve', args: { resolution: 'yes' } }),
      },
      message: /gate-resolve plan must record the resolution/,
    },
    {
      call: (loop) => loop.gateCreate({ reason: 'worker blocked' }),
      handlers: {
        gateCreate: async () =>
          ({ dryRun: false, command: 'gate-create', args: { reason: 'worker blocked' } }) as unknown as PlannedOrcaCall,
      },
      message: /refusing to treat an Orca result as success/,
    },
    {
      call: (loop) => loop.gateResolve({ resolution: 'continue' }),
      handlers: {
        gateResolve: async () => ({ dryRun: true, command: 'check', args: { converged: 'true' } }),
      },
      message: /refusing to treat an Orca result as success/,
    },
  ]
  for (const item of cases) {
    const loop = await waitingLoop(withGates(item.handlers))
    const before = loop.snapshot().intents.length
    await assert.rejects(() => item.call(loop), item.message)
    assert.equal(loop.state, 'waiting')
    assert.equal(loop.snapshot().intents.length, before)
    assert.equal(loop.snapshot().humanDecision, null)
    assert.equal(
      loop.snapshot().intents.some((intent) => intent.command === 'gate-create' || intent.command === 'gate-resolve'),
      false,
    )
    assert.equal(loop.snapshot().githubWritePerformed, false)
    assert.throws(() => loop.askHumanPr({ sha: 'abc123', verdict }), IllegalTransitionError)
    assert.equal(loop.state, 'waiting')
  }
})
