import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  createOrcaAdapter,
  OrcaNotConfiguredError,
  OrcaStubError,
  resolveOrcaExecutable,
} from '../src/index.ts'

function binDir(names: readonly string[]): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'orca-bin-'))
  for (const name of names) {
    const file = path.join(dir, name)
    writeFileSync(file, '#!/bin/sh\nexit 0\n')
    chmodSync(file, 0o755)
  }
  return dir
}

test('resolve prefers orca, then orca-ide on linux only', () => {
  const both = binDir(['orca', 'orca-ide'])
  const ideOnly = binDir(['orca-ide'])
  assert.equal(resolveOrcaExecutable({ env: { PATH: '' }, platform: 'linux' }), null)
  assert.equal(
    resolveOrcaExecutable({ env: { PATH: `${ideOnly}${path.delimiter}${both}` }, platform: 'linux' }),
    path.join(both, 'orca'),
  )
  assert.equal(
    resolveOrcaExecutable({ env: { PATH: ideOnly }, platform: 'linux' }),
    path.join(ideOnly, 'orca-ide'),
  )
  assert.equal(resolveOrcaExecutable({ env: { PATH: ideOnly }, platform: 'darwin' }), null)
  assert.equal(
    resolveOrcaExecutable({ env: { PATH: both }, platform: 'darwin' }),
    path.join(both, 'orca'),
  )
})

test('missing CLI throws not-configured and does not succeed', async () => {
  const adapter = createOrcaAdapter({ env: { PATH: '' }, platform: 'linux' })
  assert.equal(adapter.executable, null)
  await assert.rejects(
    () => adapter.status(),
    (error: unknown) => {
      assert.ok(error instanceof OrcaNotConfiguredError)
      assert.equal(error.code, 'not-configured')
      assert.match(error.message, /orca-ide/)
      return true
    },
  )
  await assert.rejects(() => adapter.runCreate({ goal: 'dig', repo: 'hsliuustc0106/OPC-ORCA' }), OrcaNotConfiguredError)
  await assert.rejects(() => adapter.runCreate({ goal: ' ', repo: 'repo' }), TypeError)
})

test('present CLI still refuses to spawn', async () => {
  const dir = binDir(['orca'])
  const adapter = createOrcaAdapter({ env: { PATH: dir }, platform: 'linux' })
  assert.equal(adapter.executable, path.join(dir, 'orca'))
  await assert.rejects(
    () => adapter.workerStart({ taskId: 'task-1' }),
    (error: unknown) => {
      assert.ok(error instanceof OrcaStubError)
      assert.equal(error.code, 'not-implemented')
      assert.deepEqual(error.argv, [path.join(dir, 'orca'), 'worker-start'])
      return true
    },
  )
  await assert.rejects(() => adapter.taskCreate({ runId: 'run-1', title: 'dig', worker: 'dsh', worktree: 'new-child' }), OrcaStubError)
  await assert.rejects(
    () => adapter.workerStart({ taskId: 'task-1', worker: 'other' as 'dsh' }),
    TypeError,
  )
  await assert.rejects(
    () => adapter.check({ runId: 'run-1', converged: true }),
    (error: unknown) => {
      assert.ok(error instanceof OrcaStubError)
      assert.equal(error.code, 'not-implemented')
      assert.deepEqual(error.argv, [path.join(dir, 'orca'), 'check'])
      return true
    },
  )
  await assert.rejects(
    () => adapter.status({ runId: 'run-1' }),
    (error: unknown) => {
      assert.ok(error instanceof OrcaStubError)
      assert.equal(error.code, 'not-implemented')
      assert.deepEqual(error.argv, [path.join(dir, 'orca'), 'status'])
      return true
    },
  )
  await assert.rejects(
    () => adapter.taskList({ runId: 'run-1' }),
    (error: unknown) => {
      assert.ok(error instanceof OrcaStubError)
      assert.deepEqual(error.argv, [path.join(dir, 'orca'), 'task-list'])
      return true
    },
  )
  await assert.rejects(
    () => adapter.workerShow({ workerId: 'worker-1' }),
    (error: unknown) => {
      assert.ok(error instanceof OrcaStubError)
      assert.deepEqual(error.argv, [path.join(dir, 'orca'), 'worker-show'])
      return true
    },
  )
  await assert.rejects(
    () => adapter.workerRelease({ workerId: 'worker-1' }),
    (error: unknown) => {
      assert.ok(error instanceof OrcaStubError)
      assert.equal(error.code, 'not-implemented')
      assert.deepEqual(error.argv, [path.join(dir, 'orca'), 'worker-release'])
      return true
    },
  )
  await assert.rejects(
    () => adapter.reply({ runId: 'run-1', text: 'ship the tip' }),
    (error: unknown) => {
      assert.ok(error instanceof OrcaStubError)
      assert.equal(error.code, 'not-implemented')
      assert.deepEqual(error.argv, [path.join(dir, 'orca'), 'reply'])
      return true
    },
  )
  await assert.rejects(
    () => adapter.gateCreate({ runId: 'run-1', reason: 'worker blocked' }),
    (error: unknown) => {
      assert.ok(error instanceof OrcaStubError)
      assert.equal(error.code, 'not-implemented')
      assert.deepEqual(error.argv, [path.join(dir, 'orca'), 'gate-create'])
      return true
    },
  )
  await assert.rejects(
    () => adapter.gateResolve({ gateId: 'gate-1', resolution: 'continue' }),
    (error: unknown) => {
      assert.ok(error instanceof OrcaStubError)
      assert.equal(error.code, 'not-implemented')
      assert.deepEqual(error.argv, [path.join(dir, 'orca'), 'gate-resolve'])
      return true
    },
  )
  assert.deepEqual(adapter.planned, [])
})

test('dry-run records dispatch without a binary and does not return ids', async () => {
  const adapter = createOrcaAdapter({ dryRun: true, env: { PATH: '' }, platform: 'linux' })
  assert.equal(adapter.executable, null)
  assert.equal(adapter.dryRun, true)
  const run = await adapter.runCreate({
    goal: 'dig',
    repo: 'hsliuustc0106/OPC-ORCA',
    baseRef: 'origin/main',
  })
  const task = await adapter.taskCreate({
    runId: 'run-fake',
    title: 'dig',
    worker: 'dsh',
    worktree: 'new-child',
  })
  const started = await adapter.workerStart({ taskId: 'task-fake' })
  assert.equal(run.dryRun, true)
  assert.equal(Object.hasOwn(run.args, 'runId'), false)
  assert.equal(Object.hasOwn(task.args, 'runId'), false)
  assert.equal(Object.hasOwn(started.args, 'taskId'), false)
  assert.equal(Object.hasOwn(started.args, 'exitCode'), false)
  assert.deepEqual(run.args, { goal: 'dig', repo: 'hsliuustc0106/OPC-ORCA', base: 'origin/main' })
  assert.deepEqual(task.args, { title: 'dig', worker: 'dsh', worktree: 'new-child' })
  assert.deepEqual(started.args, { worker: 'dsh', worktree: 'new-child' })
  const checked = await adapter.check({ runId: 'run-fake', converged: false })
  assert.equal(checked.dryRun, true)
  assert.equal(checked.command, 'check')
  assert.deepEqual(checked.args, { converged: 'false' })
  assert.equal(Object.hasOwn(checked.args, 'runId'), false)
  assert.equal(Object.hasOwn(checked.args, 'exitCode'), false)
  assert.deepEqual(
    adapter.planned.map((call) => call.command),
    ['run-create', 'task-create', 'worker-start', 'check'],
  )
  const observedStatus = await adapter.status({ runId: 'run-fake' })
  const observedTasks = await adapter.taskList({ runId: 'run-fake' })
  const observedWorker = await adapter.workerShow({ workerId: 'worker-fake' })
  assert.equal(observedStatus.dryRun, true)
  assert.equal(observedStatus.command, 'status')
  assert.deepEqual(observedStatus.args, {})
  assert.deepEqual(observedTasks.args, {})
  assert.deepEqual(observedWorker.args, {})
  for (const call of [observedStatus, observedTasks, observedWorker]) {
    assert.equal(Object.hasOwn(call.args, 'runId'), false)
    assert.equal(Object.hasOwn(call.args, 'taskId'), false)
    assert.equal(Object.hasOwn(call.args, 'workerId'), false)
    assert.equal(Object.hasOwn(call.args, 'exitCode'), false)
    assert.equal(Object.hasOwn(call.args, 'status'), false)
    assert.equal(Object.hasOwn(call.args, 'payload'), false)
  }
  const released = await adapter.workerRelease({ workerId: 'worker-fake' })
  const answered = await adapter.reply({ runId: 'run-fake', text: 'ship the tip' })
  assert.equal(released.dryRun, true)
  assert.equal(released.command, 'worker-release')
  assert.deepEqual(released.args, {})
  assert.equal(answered.dryRun, true)
  assert.equal(answered.command, 'reply')
  assert.deepEqual(answered.args, { text: 'ship the tip' })
  const created = await adapter.gateCreate({ runId: 'run-fake', reason: 'worker blocked' })
  const resolved = await adapter.gateResolve({ gateId: 'gate-fake', resolution: 'continue' })
  assert.equal(created.dryRun, true)
  assert.equal(created.command, 'gate-create')
  assert.deepEqual(created.args, { reason: 'worker blocked' })
  assert.equal(resolved.dryRun, true)
  assert.equal(resolved.command, 'gate-resolve')
  assert.deepEqual(resolved.args, { resolution: 'continue' })
  for (const call of [released, answered, created, resolved]) {
    assert.equal(Object.hasOwn(call.args, 'runId'), false)
    assert.equal(Object.hasOwn(call.args, 'taskId'), false)
    assert.equal(Object.hasOwn(call.args, 'workerId'), false)
    assert.equal(Object.hasOwn(call.args, 'messageId'), false)
    assert.equal(Object.hasOwn(call.args, 'gateId'), false)
    assert.equal(Object.hasOwn(call.args, 'exitCode'), false)
  }
  assert.deepEqual(
    adapter.planned.map((call) => call.command),
    [
      'run-create',
      'task-create',
      'worker-start',
      'check',
      'status',
      'task-list',
      'worker-show',
      'worker-release',
      'reply',
      'gate-create',
      'gate-resolve',
    ],
  )
  await assert.rejects(() => adapter.check({ runId: 'run-1' }), TypeError)
  await assert.rejects(() => adapter.reply({ text: ' ' }), TypeError)
  await assert.rejects(() => adapter.reply({ runId: 'run-1', text: '' }), TypeError)
  await assert.rejects(() => adapter.gateCreate({ reason: ' ' }), TypeError)
  await assert.rejects(() => adapter.gateCreate({ runId: 'run-1', reason: '' }), TypeError)
  await assert.rejects(() => adapter.gateResolve({ resolution: ' ' }), TypeError)
  await assert.rejects(() => adapter.gateResolve({ gateId: 'gate-1', resolution: '' }), TypeError)
  await assert.rejects(() => adapter.taskCreate({ title: 'dig', worker: 'other' as 'dsh' }), TypeError)
  assert.equal(adapter.planned.length, 11)

  const dir = binDir(['orca'])
  const present = createOrcaAdapter({ dryRun: true, env: { PATH: dir }, platform: 'linux' })
  const again = await present.check({ converged: true })
  assert.deepEqual(again.args, { converged: 'true' })
  assert.equal(Object.hasOwn(again.args, 'runId'), false)
  const presentStatus = await present.status({ runId: 'run-fake' })
  const presentTasks = await present.taskList({ runId: 'run-fake' })
  const presentWorker = await present.workerShow({ workerId: 'worker-fake' })
  assert.deepEqual(presentStatus.args, {})
  assert.deepEqual(presentTasks.args, {})
  assert.deepEqual(presentWorker.args, {})
  assert.equal(Object.hasOwn(presentStatus.args, 'runId'), false)
  assert.equal(Object.hasOwn(presentTasks.args, 'runId'), false)
  assert.equal(Object.hasOwn(presentWorker.args, 'workerId'), false)
  const presentRelease = await present.workerRelease()
  const presentReply = await present.reply({ runId: 'run-fake', text: 'ship the tip' })
  const presentGate = await present.gateCreate({ runId: 'run-fake', reason: 'worker blocked' })
  const presentResolve = await present.gateResolve({ gateId: 'gate-fake', resolution: 'yes' })
  assert.deepEqual(presentRelease.args, {})
  assert.deepEqual(presentReply.args, { text: 'ship the tip' })
  assert.deepEqual(presentGate.args, { reason: 'worker blocked' })
  assert.deepEqual(presentResolve.args, { resolution: 'yes' })
  assert.equal(Object.hasOwn(presentRelease.args, 'workerId'), false)
  assert.equal(Object.hasOwn(presentReply.args, 'runId'), false)
  assert.equal(Object.hasOwn(presentReply.args, 'messageId'), false)
  assert.equal(Object.hasOwn(presentGate.args, 'runId'), false)
  assert.equal(Object.hasOwn(presentGate.args, 'gateId'), false)
  assert.equal(Object.hasOwn(presentResolve.args, 'gateId'), false)
  assert.equal(Object.hasOwn(presentResolve.args, 'exitCode'), false)
  assert.equal(present.planned.length, 8)
})

test('live path does not resolve a run id', async () => {
  const missing = createOrcaAdapter({ env: { PATH: '' }, platform: 'linux' })
  assert.equal(missing.dryRun, false)
  let resolved = false
  await assert.rejects(
    () =>
      missing.runCreate({ goal: 'dig', repo: 'hsliuustc0106/OPC-ORCA' }).then(() => {
        resolved = true
      }),
    OrcaNotConfiguredError,
  )
  await assert.rejects(
    () => missing.taskCreate({ runId: 'run-1', title: 'dig', worker: 'dsh', worktree: 'new-child' }),
    OrcaNotConfiguredError,
  )
  await assert.rejects(() => missing.workerStart({ taskId: 'task-1' }), OrcaNotConfiguredError)
  await assert.rejects(() => missing.check({ runId: 'run-1' }), OrcaNotConfiguredError)
  await assert.rejects(() => missing.check({ converged: true }), TypeError)
  await assert.rejects(() => missing.status(), OrcaNotConfiguredError)
  await assert.rejects(() => missing.status({ runId: 'run-1' }), OrcaNotConfiguredError)
  await assert.rejects(() => missing.taskList(), TypeError)
  await assert.rejects(() => missing.taskList({ runId: ' ' }), TypeError)
  await assert.rejects(() => missing.taskList({ runId: 'run-1' }), OrcaNotConfiguredError)
  await assert.rejects(() => missing.workerShow(), TypeError)
  await assert.rejects(() => missing.workerShow({ workerId: 'worker-1' }), OrcaNotConfiguredError)
  await assert.rejects(() => missing.workerRelease(), TypeError)
  await assert.rejects(() => missing.workerRelease({ workerId: ' ' }), TypeError)
  await assert.rejects(() => missing.workerRelease({ workerId: 'worker-1' }), OrcaNotConfiguredError)
  await assert.rejects(() => missing.reply({ text: 'ship the tip' }), TypeError)
  await assert.rejects(() => missing.reply({ runId: 'run-1', text: ' ' }), TypeError)
  await assert.rejects(() => missing.reply({ runId: 'run-1', text: 'ship the tip' }), OrcaNotConfiguredError)
  await assert.rejects(() => missing.gateCreate({ reason: 'worker blocked' }), TypeError)
  await assert.rejects(() => missing.gateCreate({ runId: 'run-1', reason: ' ' }), TypeError)
  await assert.rejects(() => missing.gateCreate({ runId: 'run-1', reason: 'worker blocked' }), OrcaNotConfiguredError)
  await assert.rejects(() => missing.gateResolve({ resolution: 'continue' }), TypeError)
  await assert.rejects(() => missing.gateResolve({ gateId: 'gate-1', resolution: ' ' }), TypeError)
  await assert.rejects(
    () => missing.gateResolve({ gateId: 'gate-1', resolution: 'continue' }),
    OrcaNotConfiguredError,
  )
  assert.equal(resolved, false)
  assert.deepEqual(missing.planned, [])

  const dir = binDir(['orca'])
  const present = createOrcaAdapter({ env: { PATH: dir }, platform: 'linux' })
  await assert.rejects(
    () => present.runCreate({ goal: 'dig', repo: 'hsliuustc0106/OPC-ORCA', baseRef: 'origin/main' }),
    (error: unknown) => {
      assert.ok(error instanceof OrcaStubError)
      assert.equal(error.code, 'not-implemented')
      return true
    },
  )
  await assert.rejects(() => present.workerStart({ taskId: 'task-1' }), OrcaStubError)
  await assert.rejects(() => present.check({ runId: 'run-1', converged: true }), OrcaStubError)
  await assert.rejects(() => present.status(), OrcaStubError)
  await assert.rejects(() => present.taskList({ runId: 'run-1' }), OrcaStubError)
  await assert.rejects(() => present.workerShow({ workerId: 'worker-1' }), OrcaStubError)
  await assert.rejects(() => present.workerRelease({ workerId: 'worker-1' }), OrcaStubError)
  await assert.rejects(() => present.reply({ runId: 'run-1', text: 'ship the tip' }), OrcaStubError)
  await assert.rejects(() => present.gateCreate({ runId: 'run-1', reason: 'worker blocked' }), OrcaStubError)
  await assert.rejects(() => present.gateResolve({ gateId: 'gate-1', resolution: 'continue' }), OrcaStubError)
  assert.deepEqual(present.planned, [])
})

test('child_process is imported only by the live spawn module', () => {
  const offenders: string[] = []
  for (const name of ['adapter.ts', 'errors.ts', 'index.ts', 'parse.ts', 'resolve.ts', 'types.ts', 'spawn.ts']) {
    const text = readFileSync(fileURLToPath(new URL(`../src/${name}`, import.meta.url)), 'utf8')
    if (/node:child_process|['"]child_process['"]/.test(text)) offenders.push(name)
  }
  assert.deepEqual(offenders, ['spawn.ts'])
  const spawnSource = readFileSync(fileURLToPath(new URL('../src/spawn.ts', import.meta.url)), 'utf8')
  assert.match(spawnSource, /shell:\s*false/)
  const adapterSource = readFileSync(fileURLToPath(new URL('../src/adapter.ts', import.meta.url)), 'utf8')
  assert.match(adapterSource, /TODO\(orca-cli\)/)
})
