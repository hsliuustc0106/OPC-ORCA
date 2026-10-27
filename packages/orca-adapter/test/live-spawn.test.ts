import assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import {
  createOrcaAdapter,
  OrcaNoAgentError,
  OrcaNoSenderError,
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

function emit(result: unknown): string {
  const payload = JSON.stringify({ ok: true, id: 'rpc_envelope', result })
  return `printf '%s\\n' ${JSON.stringify(payload)}`
}

const successBody = `
printf '%s\\n' "$@" >> "$log"
cmd=$1
if [ "$1" = orchestration ]; then cmd=$2; fi
case "$cmd" in
  run-create) ${emit({ run: { id: 'run-abc', objective: 'dig' } })} ;;
  task-create) ${emit({ task: { id: 'task-abc', status: 'open' } })} ;;
  worker-start) ${emit({ dispatchId: 'worker-abc', state: 'ready', runId: 'run-not-copied', taskId: 'task-not-copied' })} ;;
  worker-show) ${emit({ dispatch: { id: 'worker-abc', taskId: 'task-camel' } })} ;;
  worker-release) ${emit({ dispatchId: 'worker-abc' })} ;;
  check) ${emit({ messages: [], count: 0, runId: 'run-not-copied', converged: true })} ;;
  reply) ${emit({ message: { id: 'msg-abc' } })} ;;
  gate-create) ${emit({ gate: { id: 'gate-abc', task_id: 'task-supplied', status: 'open' } })} ;;
  gate-resolve) ${emit({ gate: { id: 'gate-from-cli', status: 'resolved' } })} ;;
  status) ${emit({ runtime: { state: 'ready' }, app: { running: true } })} ;;
  task-list) ${emit({ tasks: [], count: 0, runId: 'run-not-copied' })} ;;
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
    index += 1
  }
  return groups
}

const HANDLE = 'term_test'

function liveAdapter(
  dir: string,
  options?: { handle?: string | null; from?: string; agent?: string | null; setup?: string },
) {
  const handle = options && 'handle' in options ? options.handle : HANDLE
  const env: {
    PATH: string
    ORCA_TERMINAL_HANDLE?: string
    OPC_ORCA_AGENT?: string
    OPC_ORCA_SETUP?: string
  } = { PATH: dir }
  if (typeof handle === 'string' && handle.length > 0) env.ORCA_TERMINAL_HANDLE = handle
  if (options?.agent !== null) env.OPC_ORCA_AGENT = options?.agent ?? 'cursor'
  if (options?.setup !== undefined) env.OPC_ORCA_SETUP = options.setup
  return createOrcaAdapter({
    live: true,
    env,
    platform: 'linux',
    ...(options?.from !== undefined ? { from: options.from } : {}),
  })
}

function withoutWorktreeName(group: readonly string[]): { name: string; rest: string[] } {
  const index = group.indexOf('--name')
  assert.notEqual(index, -1)
  const name = group[index + 1] ?? ''
  assert.match(name, /^opc-[a-f0-9]{12}$/)
  const rest = group.slice()
  rest.splice(index, 2)
  return { name, rest }
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
  assert.equal(observed.fields.status, 'ready')
  assert.equal(Object.hasOwn(observed.ids, 'runId'), false)
  const listed = asLive(await adapter.taskList({ runId: 'run-supplied' }))
  assert.equal(listed.fields.tasks, '0')
  assert.equal(Object.hasOwn(listed.ids, 'taskId'), false)

  assert.deepEqual(adapter.planned, [])
  const groups = argvGroups(readFileSync(log, 'utf8'))
  assert.deepEqual(groups[0], ['orchestration', 'run-create', '--objective', 'dig', '--from', HANDLE, '--json'])
  assert.deepEqual(groups[1], ['orchestration', 'task-create', '--spec', 'dig', '--run', 'run-supplied', '--from', HANDLE, '--json'])
  const startedArgv = withoutWorktreeName(groups[2] ?? [])
  assert.deepEqual(startedArgv.rest, [
    'orchestration',
    'worker-start',
    '--task',
    'task-supplied',
    '--agent',
    'cursor',
    '--worktree',
    'new-child',
    '--run',
    'run-supplied',
    '--from',
    HANDLE,
    '--json',
  ])
  assert.equal(startedArgv.rest.includes('dsh'), false)
  assert.equal(startedArgv.rest.includes('--repo'), false)
  assert.equal(startedArgv.rest.includes('--base-branch'), false)
  assert.equal(startedArgv.rest.includes('--setup'), false)
  assert.equal(groups[2]?.includes('--terminal'), false)
  assert.deepEqual(groups[3], ['orchestration', 'worker-show', '--dispatch', 'worker-supplied', '--json'])
  assert.equal(groups[3]?.includes('--from'), false)
  assert.equal(groups[3]?.includes(HANDLE), false)
  assert.deepEqual(groups[4], ['orchestration', 'worker-release', '--dispatch', 'worker-supplied', '--json'])
  assert.equal(groups[4]?.includes('--from'), false)
  assert.deepEqual(groups[5], ['orchestration', 'check', '--run', 'run-supplied', '--terminal', HANDLE, '--json'])
  assert.equal(groups[5]?.includes('--from'), false)
  assert.deepEqual(groups[6], [
    'orchestration',
    'reply',
    '--id',
    'msg-ask',
    '--body',
    'ship the tip',
    '--run',
    'run-supplied',
    '--from',
    HANDLE,
    '--json',
  ])
  assert.deepEqual(groups[7], [
    'orchestration',
    'gate-create',
    '--task',
    'task-supplied',
    '--question',
    'worker blocked',
    '--from',
    HANDLE,
    '--json',
  ])
  assert.deepEqual(groups[8], [
    'orchestration',
    'gate-resolve',
    '--id',
    'gate-supplied',
    '--resolution',
    'continue',
    '--from',
    HANDLE,
    '--json',
  ])
  assert.deepEqual(groups[9], ['status', '--json'])
  assert.equal(groups[9]?.includes(HANDLE), false)
  assert.deepEqual(groups[10], ['orchestration', 'task-list', '--run', 'run-supplied', '--json'])
  assert.equal(groups[10]?.includes('--from'), false)
  assert.equal(groups[10]?.includes('--terminal'), false)
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
  const { dir } = install('orca-ide', `${emit({ run: { id: 'run-ide' } })}\n`)
  const adapter = liveAdapter(dir)
  assert.equal(adapter.executable, path.join(dir, 'orca-ide'))
  const run = asLive(await adapter.runCreate({ goal: 'dig', repo: 'repo' }))
  assert.equal(run.ids.runId, 'run-ide')
})

test('run-create keeps result.run.id and drops the envelope id and other ids', async () => {
  const body = JSON.stringify(
    {
      id: 'rpc_not_a_run',
      ok: true,
      result: {
        run: { id: 'run_2e83440fda21', objective: 'smoke parse sample' },
        task: { id: 'task-extra' },
      },
      _meta: { runtimeId: 'rt_1' },
    },
    null,
    2,
  )
  const { dir } = install('orca', `cat <<'ENDJSON'\n${body}\nENDJSON\n`)
  const adapter = liveAdapter(dir)
  const run = asLive(await adapter.runCreate({ goal: 'dig', repo: 'repo', baseRef: 'run-supplied' }))
  assert.deepEqual(run.ids, { runId: 'run_2e83440fda21' })
  assert.equal(Object.hasOwn(run.ids, 'taskId'), false)
  assert.equal(JSON.stringify(run).includes('rpc_not_a_run'), false)
  assert.equal(JSON.stringify(run).includes('run-supplied'), false)
})

test('unparseable stdout throws and does not invent an id', async () => {
  const prose = 'Run run_57808dafd589 created and bound: smoke parse sample\\n'
  const cases = [
    `printf '${prose}'\n`,
    'printf \'not a field\\n\'\n',
    'printf \'\\n\'\n',
    'printf \'run-id: run-abc\\n\'\n',
    `printf '%s\\n' ${JSON.stringify(JSON.stringify({ ok: false, result: { run: { id: 'run-abc' } } }))}\n`,
    `printf '%s\\n' ${JSON.stringify(JSON.stringify({ ok: true, id: 'rpc_not_a_run' }))}\n`,
    `printf '%s\\n' ${JSON.stringify(JSON.stringify({ ok: true, result: { run: {} } }))}\n`,
    `printf '%s\\n' ${JSON.stringify(JSON.stringify({ ok: true, result: { run: { id: 'run abc' } } }))}\n`,
    `printf '%s\\n' ${JSON.stringify(JSON.stringify({ ok: 'true', result: { run: { id: 'run-abc' } } }))}\n`,
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
        assert.equal(errorText(error).includes('run_57808dafd589'), false)
        assert.equal(errorText(error).includes('rpc_not_a_run'), false)
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
  const { dir } = install('orca', `${emit({ run: { id: 'run-abc' } })}\nexit 3\n`)
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

test('a live sender verb without a handle fails closed and does not spawn', async () => {
  const { dir, log } = install('orca', successBody)
  const adapter = liveAdapter(dir, { handle: null })
  await assert.rejects(
    () => adapter.runCreate({ goal: 'dig', repo: 'repo' }),
    (error: unknown) => {
      assert.ok(error instanceof OrcaNoSenderError)
      assert.equal(error.code, 'no-sender')
      assert.match(error.message, /ORCA_TERMINAL_HANDLE/)
      assert.match(error.message, /Refusing to invent one/)
      assert.equal(errorText(error).includes('term_'), false)
      assert.equal(errorText(error).includes('run-abc'), false)
      assert.equal(Object.hasOwn(error, 'runId'), false)
      return true
    },
  )
  assert.equal(existsSync(log), false)
  assert.deepEqual(adapter.planned, [])
  const blankEnv = liveAdapter(dir, { handle: '   ' })
  await assert.rejects(() => blankEnv.runCreate({ goal: 'dig', repo: 'repo' }), OrcaNoSenderError)
  assert.equal(existsSync(log), false)
  await assert.rejects(() => adapter.check({ runId: 'run-1', converged: false }), OrcaNoSenderError)
  await assert.rejects(() => adapter.taskCreate({ runId: 'run-1', spec: 'dig' }), OrcaNoSenderError)
  await assert.rejects(() => adapter.workerStart({ taskId: 'task-1', runId: 'run-1' }), OrcaNoSenderError)
  const shown = asLive(await adapter.workerShow({ workerId: 'worker-1' }))
  assert.equal(shown.ids.workerId, 'worker-abc')
  const observed = asLive(await adapter.status())
  assert.equal(observed.fields.status, 'ready')
  assert.equal(existsSync(log), true)
  const spawned = readFileSync(log, 'utf8')
  assert.equal(spawned.includes('run-create'), false)
  assert.equal(spawned.includes('--from'), false)
  assert.equal(spawned.includes('--terminal'), false)
})

test('from wins over ORCA_TERMINAL_HANDLE and a bad token does not spawn', async () => {
  const { dir, log } = install('orca', successBody)
  const adapter = liveAdapter(dir, { from: 'term_config' })
  const run = asLive(await adapter.runCreate({ goal: 'dig', repo: 'repo' }))
  assert.equal(run.ids.runId, 'run-abc')
  const argv = readFileSync(log, 'utf8')
  assert.match(argv, /--from\nterm_config\n/)
  assert.equal(argv.includes(HANDLE), false)
  assert.equal(argv.includes('--terminal'), false)

  const blank = liveAdapter(dir, { handle: 'term_env', from: '   ' })
  const again = asLive(await blank.runCreate({ goal: 'dig', repo: 'repo' }))
  assert.equal(again.ids.runId, 'run-abc')
  assert.match(readFileSync(log, 'utf8'), /--from\nterm_env\n/)

  const bad = install('orca', 'printf \'run-id: run-abc\\n\'\n')
  const rejected = liveAdapter(bad.dir, { from: 'term bad' })
  await assert.rejects(
    () => rejected.runCreate({ goal: 'dig', repo: 'repo' }),
    (error: unknown) => {
      assert.ok(error instanceof OrcaNoSenderError)
      assert.equal(error.code, 'no-sender')
      assert.equal(errorText(error).includes('term bad'), false)
      assert.equal(errorText(error).includes('term_env'), false)
      return true
    },
  )
  assert.equal(existsSync(bad.log), false)

  const beforeDry = readFileSync(log, 'utf8').length
  const dry = createOrcaAdapter({
    dryRun: true,
    from: 'term_config',
    env: { PATH: dir, ORCA_TERMINAL_HANDLE: HANDLE, OPC_ORCA_LIVE: '1', OPC_ORCA_AGENT: 'dsh' },
    platform: 'linux',
  })
  const planned = await dry.runCreate({ goal: 'dig', repo: 'repo', baseRef: 'origin/main' })
  assert.equal(planned.dryRun, true)
  if (planned.dryRun !== true) assert.fail('expected a dry-run plan')
  assert.deepEqual(planned.args, { goal: 'dig', repo: 'repo', base: 'origin/main' })
  assert.equal(Object.hasOwn(planned.args, 'from'), false)
  assert.equal(readFileSync(log, 'utf8').length, beforeDry)

  const named = await dry.workerStart({ taskId: 'task-fake', runId: 'run-fake' })
  assert.equal(named.dryRun, true)
  if (named.dryRun !== true) assert.fail('expected a dry-run plan')
  assert.deepEqual(named.args, { worker: 'dsh', worktree: 'new-child' })
  assert.equal(Object.hasOwn(named.args, 'name'), false)
  assert.equal(Object.hasOwn(named.args, 'agent'), false)
})

test('live new-child passes a unique name and the configured desktop agent', async () => {
  const { dir, log } = install('orca', successBody)
  const adapter = liveAdapter(dir, { setup: 'skip' })
  const first = asLive(await adapter.workerStart({ taskId: 'task-1', runId: 'run-1' }))
  const second = asLive(await adapter.workerStart({ taskId: 'task-1', runId: 'run-1' }))
  assert.equal(first.ids.workerId, 'worker-abc')
  assert.equal(second.ids.workerId, 'worker-abc')
  const groups = argvGroups(readFileSync(log, 'utf8')).filter((group) => group[1] === 'worker-start')
  assert.equal(groups.length, 2)
  const names = groups.map((group) => withoutWorktreeName(group).name)
  assert.notEqual(names[0], names[1])
  assert.equal(names[0] === 'worker-abc' || names[1] === 'worker-abc', false)
  for (const group of groups) {
    const parsed = withoutWorktreeName(group)
    assert.deepEqual(parsed.rest, [
      'orchestration',
      'worker-start',
      '--task',
      'task-1',
      '--agent',
      'cursor',
      '--worktree',
      'new-child',
      '--setup',
      'skip',
      '--run',
      'run-1',
      '--from',
      HANDLE,
      '--json',
    ])
    assert.equal(parsed.rest.includes('dsh'), false)
    assert.equal(parsed.rest.includes('--repo'), false)
    assert.equal(parsed.rest.includes('--base-branch'), false)
  }

  const overridden = createOrcaAdapter({
    live: true,
    agent: 'codex',
    setup: 'inherit',
    env: { PATH: dir, ORCA_TERMINAL_HANDLE: HANDLE, OPC_ORCA_AGENT: 'cursor', OPC_ORCA_SETUP: 'skip' },
    platform: 'linux',
  })
  await overridden.workerStart({ taskId: 'task-1', runId: 'run-1' })
  const last = argvGroups(readFileSync(log, 'utf8')).filter((group) => group[1] === 'worker-start').at(-1) ?? []
  assert.equal(last.includes('codex'), true)
  assert.equal(last.includes('cursor'), false)
  assert.equal(last.includes('inherit'), true)
  assert.equal(last.includes('skip'), false)
})

test('live worker-start without a desktop agent fails closed and does not spawn', async () => {
  const { dir, log } = install('orca', successBody)
  const missing = liveAdapter(dir, { agent: null })
  await assert.rejects(
    () => missing.workerStart({ taskId: 'task-1', runId: 'run-1' }),
    (error: unknown) => {
      assert.ok(error instanceof OrcaNoAgentError)
      assert.equal(error.code, 'no-agent')
      assert.match(error.message, /Refusing to pass dsh or invent one/)
      assert.equal(errorText(error).includes('cursor'), false)
      assert.equal(errorText(error).includes('worker-abc'), false)
      return true
    },
  )
  assert.equal(existsSync(log), false)

  const invalid = liveAdapter(dir, { agent: 'dsh' })
  await assert.rejects(
    () => invalid.workerStart({ taskId: 'task-1', runId: 'run-1' }),
    (error: unknown) => {
      assert.ok(error instanceof OrcaNoAgentError)
      assert.equal(errorText(error).includes('dsh'), true)
      assert.match(error.message, /invent one/)
      return true
    },
  )
  assert.equal(existsSync(log), false)

  const badSetup = liveAdapter(dir, { setup: 'hang' })
  await assert.rejects(() => badSetup.workerStart({ taskId: 'task-1', runId: 'run-1' }), /worker setup must be run, skip, or inherit/)
  assert.equal(existsSync(log), false)
})

test('a non-ready worker-start surfaces failedStage and does not keep the dispatch id', async () => {
  const failed = install(
    'orca',
    `${emit({
      dispatchId: 'ctx_should_not',
      state: 'failed',
      failedStage: 'agent_readiness',
      lastError: 'timeout',
    })}\nexit 1`,
  )
  const adapter = liveAdapter(failed.dir)
  await assert.rejects(
    () => adapter.workerStart({ taskId: 'task-1', runId: 'run-1' }),
    (error: unknown) => {
      assert.ok(error instanceof OrcaSpawnError)
      assert.equal(error.code, 'spawn-failed')
      assert.equal(error.exitCode, 1)
      assert.match(error.message, /state failed/)
      assert.match(error.message, /failedStage agent_readiness/)
      assert.match(error.message, /lastError timeout/)
      assert.equal(errorText(error).includes('ctx_should_not'), false)
      assert.equal(Object.hasOwn(error, 'workerId'), false)
      return true
    },
  )
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
