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
  await assert.rejects(() => adapter.status(), OrcaNotConfiguredError)
  await assert.rejects(() => adapter.check({ runId: 'run-1' }), TypeError)
  await assert.rejects(() => adapter.reply({ runId: 'run-1', text: 'hi' }), OrcaNotConfiguredError)
  await assert.rejects(() => adapter.gateCreate({ runId: 'run-1', reason: 'wait' }), OrcaNotConfiguredError)
  await assert.rejects(() => adapter.gateResolve({ gateId: 'gate-1', resolution: 'yes' }), OrcaNotConfiguredError)
  await assert.rejects(() => adapter.taskCreate({ title: 'dig', worker: 'other' as 'dsh' }), TypeError)
  assert.equal(adapter.planned.length, 4)

  const dir = binDir(['orca'])
  const present = createOrcaAdapter({ dryRun: true, env: { PATH: dir }, platform: 'linux' })
  const again = await present.check({ converged: true })
  assert.deepEqual(again.args, { converged: 'true' })
  assert.equal(Object.hasOwn(again.args, 'runId'), false)
  assert.equal(present.planned.length, 1)
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
  assert.deepEqual(present.planned, [])
})

test('v0 adapter does not import child_process', () => {
  const source = readFileSync(fileURLToPath(new URL('../src/adapter.ts', import.meta.url)), 'utf8')
  assert.doesNotMatch(source, /from ['"]node:child_process['"]|require\(['"]node:child_process['"]\)/)
  assert.match(source, /TODO\(orca-cli\)/)
})
