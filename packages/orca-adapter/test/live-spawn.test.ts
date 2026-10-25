import assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import {
  createOrcaAdapter,
  OrcaNotConfiguredError,
  OrcaParseError,
  OrcaSpawnError,
  OrcaStubError,
} from '../src/index.ts'
import type { LiveOrcaCall, OrcaCallResult } from '../src/index.ts'

function install(name: string, body: string): { dir: string; log: string } {
  const dir = mkdtempSync(path.join(tmpdir(), 'orca-live-'))
  const log = path.join(dir, 'spawn.log')
  const file = path.join(dir, name)
  writeFileSync(file, `#!/bin/sh\nlog=${JSON.stringify(log)}\n${body}\n`)
  chmodSync(file, 0o755)
  return { dir, log }
}

const successBody = `
printf '%s\\n' "$@" >> "$log"
cmd=$1
if [ "$1" = orchestration ]; then cmd=$2; fi
case "$cmd" in
  run-create) printf 'run-id: run-abc\\n' ;;
  task-create) printf 'task-id: task-abc\\n' ;;
  worker-start) printf 'worker-id: worker-abc\\n' ;;
  worker-show) printf 'worker-id: worker-abc\\n' ;;
  worker-release) printf 'worker-id: worker-abc\\n' ;;
  check) printf 'converged: false\\n' ;;
  reply) printf 'message-id: msg-abc\\n' ;;
  gate-create) printf 'gate-id: gate-abc\\n' ;;
  gate-resolve) printf 'gate-id: gate-from-cli\\n' ;;
  status) printf 'status: waiting\\n' ;;
  task-list) printf 'tasks: none\\n' ;;
  *) printf 'unknown\\n' >&2; exit 1 ;;
esac
`

function argvGroups(log: string): string[][] {
  const lines = log.trim().split('\n')
  const groups: string[][] = []
  let index = 0
  while (index < lines.length) {
    const line = lines[index]
    if (line === 'orchestration') {
      const group = [line]
      index += 1
      while (index < lines.length && lines[index] !== 'orchestration' && lines[index] !== 'status') {
        const next = lines[index]
        if (next === undefined) break
        group.push(next)
        index += 1
      }
      groups.push(group)
      continue
    }
    if (line === 'status') {
      groups.push([line])
      index += 1
      continue
    }
    index += 1
  }
  return groups
}

function liveAdapter(dir: string) {
  return createOrcaAdapter({ live: true, env: { PATH: dir }, platform: 'linux' })
}

function asLive(call: OrcaCallResult): LiveOrcaCall {
  if (call.dryRun !== false) assert.fail('expected a live result')
  return call
}

function errorText(error: unknown): string {
  const message = error instanceof Error ? error.message : ''
  return `${message} ${JSON.stringify(error)}`
}

test('dry-run stays a plan when the live flag is off or dry-run wins', async () => {
  const failing = install('orca', 'printf \'spawned\\n\' >> "$log"\nexit 1')
  assert.throws(() => createOrcaAdapter({ dryRun: true, live: true, env: { PATH: failing.dir } }), /dryRun and live/)

  const dry = createOrcaAdapter({
    dryRun: true,
    env: { PATH: failing.dir, OPC_ORCA_LIVE: '1' },
    platform: 'linux',
  })
  assert.equal(dry.dryRun, true)
  assert.equal(dry.live, false)
  const planned = await dry.runCreate({ goal: 'dig', repo: 'hsliuustc0106/OPC-ORCA', baseRef: 'origin/main' })
  assert.equal(planned.dryRun, true)
  if (planned.dryRun !== true) assert.fail('expected a dry-run plan')
  assert.equal(Object.hasOwn(planned, 'ids'), false)
  assert.deepEqual(planned.args, { goal: 'dig', repo: 'hsliuustc0106/OPC-ORCA', base: 'origin/main' })
  assert.equal(existsSync(failing.log), false)

  const ambiguous = createOrcaAdapter({
    env: { PATH: failing.dir, OPC_ORCA_LIVE: 'true' },
    platform: 'linux',
  })
  assert.equal(ambiguous.live, false)
  await assert.rejects(
    () => ambiguous.runCreate({ goal: 'dig', repo: 'hsliuustc0106/OPC-ORCA' }),
    OrcaStubError,
  )
  assert.equal(existsSync(failing.log), false)

  const forcedOff = createOrcaAdapter({
    live: false,
    env: { PATH: failing.dir, OPC_ORCA_LIVE: '1' },
    platform: 'linux',
  })
  assert.equal(forcedOff.live, false)
  await assert.rejects(() => forcedOff.workerStart({ taskId: 'task-1' }), OrcaStubError)
  assert.equal(existsSync(failing.log), false)
  assert.deepEqual(forcedOff.planned, [])
})

test('live spawn parses ids from a fake binary and does not invent missing ones', async () => {
  const { dir, log } = install('orca', successBody)
  const adapter = liveAdapter(dir)
  assert.equal(adapter.live, true)
  assert.equal(adapter.dryRun, false)
  assert.equal(adapter.executable, path.join(dir, 'orca'))

  const run = asLive(await adapter.runCreate({
    goal: 'dig',
    repo: 'hsliuustc0106/OPC-ORCA',
    baseRef: 'origin/main',
  }))
  assert.equal(run.command, 'run-create')
  assert.equal(run.exitCode, 0)
  assert.deepEqual(run.ids, { runId: 'run-abc' })
  assert.equal(Object.hasOwn(run.ids, 'taskId'), false)
  assert.equal(Object.hasOwn(run.ids, 'workerId'), false)

  const task = asLive(await adapter.taskCreate({
    runId: 'run-supplied',
    spec: 'dig',
  }))
  assert.deepEqual(task.ids, { taskId: 'task-abc' })
  assert.equal(Object.hasOwn(task.ids, 'runId'), false)

  const started = asLive(await adapter.workerStart({ taskId: 'task-supplied', runId: 'run-supplied' }))
  assert.deepEqual(started.ids, { workerId: 'worker-abc' })
  assert.equal(Object.hasOwn(started.ids, 'taskId'), false)

  const shown = asLive(await adapter.workerShow({ workerId: 'worker-supplied' }))
  assert.deepEqual(shown.ids, { workerId: 'worker-abc' })
  const released = asLive(await adapter.workerRelease({ workerId: 'worker-supplied' }))
  assert.deepEqual(released.ids, { workerId: 'worker-abc' })

  const checked = asLive(await adapter.check({ runId: 'run-supplied', converged: true }))
  assert.equal(checked.fields.converged, 'false')
  assert.equal(Object.hasOwn(checked.ids, 'runId'), false)
  assert.equal(Object.hasOwn(checked.fields, 'run-id'), false)

  await assert.rejects(
    () => adapter.reply({ runId: 'run-supplied', text: 'ship the tip' }),
    /messageId is required/,
  )
  const answered = asLive(await adapter.reply({
    runId: 'run-supplied',
    messageId: 'msg-ask',
    text: 'ship the tip',
  }))
  assert.deepEqual(answered.ids, { messageId: 'msg-abc' })
  assert.notEqual(answered.ids.messageId, 'msg-ask')
  assert.equal(Object.hasOwn(answered.ids, 'runId'), false)

  await assert.rejects(
    () => adapter.gateCreate({ reason: 'worker blocked' }),
    /taskId is required/,
  )
  const created = asLive(await adapter.gateCreate({ taskId: 'task-supplied', reason: 'worker blocked' }))
  assert.deepEqual(created.ids, { gateId: 'gate-abc' })
  const resolved = asLive(await adapter.gateResolve({ gateId: 'gate-supplied', resolution: 'continue' }))
  assert.deepEqual(resolved.ids, { gateId: 'gate-from-cli' })
  assert.notEqual(resolved.ids.gateId, 'gate-supplied')

  const observed = asLive(await adapter.status({ runId: 'run-supplied' }))
  assert.equal(observed.fields.status, 'waiting')
  assert.equal(Object.hasOwn(observed.ids, 'runId'), false)
  const listed = asLive(await adapter.taskList({ runId: 'run-supplied' }))
  assert.equal(listed.fields.tasks, 'none')
  assert.equal(Object.hasOwn(listed.ids, 'taskId'), false)

  assert.deepEqual(adapter.planned, [])
  const groups = argvGroups(readFileSync(log, 'utf8'))
  assert.deepEqual(groups[0], ['orchestration', 'run-create', '--objective', 'dig'])
  assert.deepEqual(groups[1], ['orchestration', 'task-create', '--spec', 'dig', '--run', 'run-supplied'])
  assert.deepEqual(groups[2], [
    'orchestration',
    'worker-start',
    '--task',
    'task-supplied',
    '--agent',
    'dsh',
    '--worktree',
    'new-child',
    '--run',
    'run-supplied',
  ])
  assert.deepEqual(groups[3], ['orchestration', 'worker-show', '--dispatch', 'worker-supplied'])
  assert.deepEqual(groups[4], ['orchestration', 'worker-release', '--dispatch', 'worker-supplied'])
  assert.deepEqual(groups[5], ['orchestration', 'check', '--run', 'run-supplied'])
  assert.deepEqual(groups[6], [
    'orchestration',
    'reply',
    '--id',
    'msg-ask',
    '--body',
    'ship the tip',
    '--run',
    'run-supplied',
  ])
  assert.deepEqual(groups[7], [
    'orchestration',
    'gate-create',
    '--task',
    'task-supplied',
    '--question',
    'worker blocked',
  ])
  assert.deepEqual(groups[8], [
    'orchestration',
    'gate-resolve',
    '--id',
    'gate-supplied',
    '--resolution',
    'continue',
  ])
  assert.deepEqual(groups[9], ['status'])
  assert.deepEqual(groups[10], ['orchestration', 'task-list', '--run', 'run-supplied'])
  const flat = groups.flat()
  assert.equal(flat.includes('--goal'), false)
  assert.equal(flat.includes('--repo'), false)
  assert.equal(flat.includes('--base'), false)
  assert.equal(flat.includes('--run-id'), false)
  assert.equal(flat.includes('--task-id'), false)
  assert.equal(flat.includes('--worker'), false)
  assert.equal(flat.includes('--worker-id'), false)
  assert.equal(flat.includes('--text'), false)
  assert.equal(flat.includes('--converged'), false)
  assert.equal(flat.includes('hsliuustc0106/OPC-ORCA'), false)
})

test('linux live spawn falls back to orca-ide', async () => {
  const { dir } = install('orca-ide', 'printf \'run-id: run-ide\\n\'\n')
  const adapter = liveAdapter(dir)
  assert.equal(adapter.executable, path.join(dir, 'orca-ide'))
  const run = asLive(await adapter.runCreate({ goal: 'dig', repo: 'repo' }))
  assert.equal(run.ids.runId, 'run-ide')
})

test('an extra parsed id is kept and a caller id is not added', async () => {
  const { dir } = install('orca', 'printf \'run-id: run-abc\\ntask-id: task-extra\\n\'\n')
  const adapter = liveAdapter(dir)
  const run = asLive(await adapter.runCreate({ goal: 'dig', repo: 'repo' }))
  assert.deepEqual(run.ids, { runId: 'run-abc', taskId: 'task-extra' })
})

test('unparseable stdout throws and does not invent an id', async () => {
  const cases = [
    'printf \'not a field\\n\'\n',
    'printf \'\\n\'\n',
    'printf \'task-id: task-abc\\n\'\n',
    'printf \'run-id: run-abc\\nrun-id: run-other\\n\'\n',
    'printf \'run-id:\\n\'\n',
    'printf \'run-id: run abc\\n\'\n',
  ]
  for (const body of cases) {
    const { dir } = install('orca', body)
    const adapter = liveAdapter(dir)
    await assert.rejects(
      () => adapter.runCreate({ goal: 'dig', repo: 'hsliuustc0106/OPC-ORCA' }),
      (error: unknown) => {
        assert.ok(error instanceof OrcaParseError)
        assert.equal(error.code, 'unparseable')
        assert.equal(Object.hasOwn(error, 'ids'), false)
        assert.equal(Object.hasOwn(error, 'runId'), false)
        assert.equal(errorText(error).includes('run-abc'), false)
        assert.equal(errorText(error).includes('task-abc'), false)
        return true
      },
    )
    assert.deepEqual(adapter.planned, [])
  }

  const stderr = install('orca', 'printf \'run-id: run-from-stderr\\n\' >&2\nprintf \'nope\\n\'\n')
  const adapter = liveAdapter(stderr.dir)
  await assert.rejects(() => adapter.runCreate({ goal: 'dig', repo: 'repo' }), (error: unknown) => {
    assert.ok(error instanceof OrcaParseError)
    assert.equal(errorText(error).includes('run-from-stderr'), false)
    return true
  })
})

test('non-zero exit throws and does not return stdout ids', async () => {
  const { dir } = install('orca', 'printf \'run-id: run-abc\\n\'\nexit 3\n')
  const adapter = liveAdapter(dir)
  await assert.rejects(
    () => adapter.runCreate({ goal: 'dig', repo: 'hsliuustc0106/OPC-ORCA' }),
    (error: unknown) => {
      assert.ok(error instanceof OrcaSpawnError)
      assert.equal(error.code, 'spawn-failed')
      assert.equal(error.exitCode, 3)
      assert.equal(error.argv[1], 'orchestration')
      assert.equal(error.argv[2], 'run-create')
      assert.equal(error.argv.includes('--objective'), true)
      assert.equal(error.argv.includes('--goal'), false)
      assert.equal(error.argv.includes('--repo'), false)
      assert.equal(Object.hasOwn(error, 'ids'), false)
      assert.equal(Object.hasOwn(error, 'runId'), false)
      assert.equal(errorText(error).includes('run-abc'), false)
      return true
    },
  )
  assert.deepEqual(adapter.planned, [])
  await assert.rejects(() => adapter.taskCreate({ runId: 'run-supplied', spec: 'dig' }), OrcaSpawnError)
})

test('live mode with no binary throws not-configured and does not succeed', async () => {
  const adapter = createOrcaAdapter({ live: true, env: { PATH: '', OPC_ORCA_LIVE: '1' }, platform: 'linux' })
  assert.equal(adapter.executable, null)
  assert.equal(adapter.live, true)
  let resolved = false
  await assert.rejects(
    () =>
      adapter.runCreate({ goal: 'dig', repo: 'repo' }).then(() => {
        resolved = true
      }),
    (error: unknown) => {
      assert.ok(error instanceof OrcaNotConfiguredError)
      assert.equal(error.code, 'not-configured')
      return true
    },
  )
  assert.equal(resolved, false)
  await assert.rejects(() => adapter.workerStart({ taskId: 'task-1' }), OrcaNotConfiguredError)
  assert.deepEqual(adapter.planned, [])
})

test('child_process stays inside the live spawn module', () => {
  const hits: string[] = []
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name === 'test') continue
      const full = path.join(dir, name)
      if (statSync(full).isDirectory()) {
        walk(full)
        continue
      }
      if (!/\.(ts|js)$/.test(name)) continue
      const text = readFileSync(full, 'utf8')
      if (/node:child_process|['"]child_process['"]/.test(text)) hits.push(full)
    }
  }
  walk('packages')
  walk('plugins')
  assert.deepEqual(
    hits.map((file) => file.split(path.sep).join('/')),
    ['packages/orca-adapter/src/spawn.ts'],
  )
})
