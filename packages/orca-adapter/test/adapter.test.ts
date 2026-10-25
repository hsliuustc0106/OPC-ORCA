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
})

test('v0 adapter does not import child_process', () => {
  const source = readFileSync(fileURLToPath(new URL('../src/adapter.ts', import.meta.url)), 'utf8')
  assert.doesNotMatch(source, /from ['"]node:child_process['"]|require\(['"]node:child_process['"]\)/)
  assert.match(source, /TODO\(orca-cli\)/)
})
