import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { createOrcaAdapter, OrcaNotConfiguredError, OrcaStubError } from '@opc-orca/orca-adapter'
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
  loop.check({ converged: false })
  assert.equal(loop.state, 'waiting')
  loop.check({ converged: false })
  loop.check({ converged: true })
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
  assert.equal(snap.intents[1]?.args.worker, 'dsh')
  assert.equal(snap.intents[1]?.args.worktree, 'new-child')
  assert.equal(snap.intents[1]?.args.title, 'fix the gate')
  assert.equal(snap.intents[1]?.args.runId, undefined)
  assert.equal(snap.intents[2]?.args.worker, 'dsh')
  assert.equal(snap.intents[2]?.args.worktree, 'new-child')
  assert.equal(snap.intents[2]?.args.taskId, undefined)
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
  loop.check({ converged: true })
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
})

test('dry-run dispatch records the adapter plan and does not call check', async () => {
  const adapter = createOrcaAdapter({ dryRun: true, env: { PATH: '' }, platform: 'linux' })
  const loop = createDigLoop({ adapter, repo })
  loop.acceptGoal('fix the gate')
  loop.triage({ agentReady: true, difficulty: 'normal' })
  await loop.bindRun()
  await loop.startWorker()
  loop.check({ converged: false })
  assert.equal(adapter.executable, null)
  assert.equal(adapter.dryRun, true)
  assert.deepEqual(
    adapter.planned.map((call) => call.command),
    ['run-create', 'task-create', 'worker-start'],
  )
  assert.equal(adapter.planned[0]?.args.base, 'origin/main')
  assert.equal(adapter.planned[1]?.args.worker, 'dsh')
  assert.equal(adapter.planned[1]?.args.worktree, 'new-child')
  assert.equal(adapter.planned[2]?.args.worker, 'dsh')
  assert.equal(adapter.planned[2]?.args.worktree, 'new-child')
  for (const call of adapter.planned) {
    assert.equal(call.dryRun, true)
    assert.equal(call.args.runId, undefined)
    assert.equal(call.args.taskId, undefined)
    assert.equal(call.args.exitCode, undefined)
  }
  assert.deepEqual(
    loop.snapshot().intents.slice(0, 3).map((intent) => intent.command),
    adapter.planned.map((call) => call.command),
  )
  await assert.rejects(() => adapter.check({ runId: 'not-a-run' }), OrcaNotConfiguredError)
  assert.equal(loop.state, 'waiting')
  assert.equal(loop.snapshot().githubWritePerformed, false)
})

test('easy path does not record an Orca plan', () => {
  const adapter = createOrcaAdapter({ dryRun: true, env: { PATH: '' }, platform: 'linux' })
  const loop = createDigLoop({ adapter, repo })
  loop.acceptGoal('typo in the readme')
  loop.triage({ agentReady: true, difficulty: 'easy' })
  loop.runDirect()
  assert.equal(loop.state, 'converging')
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
