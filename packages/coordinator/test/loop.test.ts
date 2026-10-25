import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  createDigLoop,
  DuplicateVerdictError,
  IllegalTransitionError,
  WIRE_ADAPTER_TODO,
} from '../src/index.ts'

const verdict = { outcome: 'PASS' as const, sha: 'abc123', writtenBy: 'Reviewer' }

function readyNormal() {
  const loop = createDigLoop()
  loop.acceptGoal('fix the gate')
  loop.triage({ agentReady: true, difficulty: 'normal' })
  return loop
}

test('normal path stops at the human PR gate and records no GitHub write', () => {
  const loop = readyNormal()
  assert.equal(loop.state, 'plan')
  loop.bindRun()
  loop.startWorker()
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
  assert.equal(snap.intents[1]?.args.worker, 'dsh')
  assert.equal(snap.intents[1]?.args.worktree, 'new-child')
  assert.equal(snap.intents[2]?.args.worker, 'dsh')
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

test('one Verdict per tip, and a new SHA replaces it', () => {
  const loop = readyNormal()
  loop.bindRun()
  loop.startWorker()
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
  assert.match(WIRE_ADAPTER_TODO, /not-configured/)
  assert.match(WIRE_ADAPTER_TODO, /awaiting_human_pr/)
  assert.match(WIRE_ADAPTER_TODO, /coordinator-direct/)
})
