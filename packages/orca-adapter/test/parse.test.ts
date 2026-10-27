import assert from 'node:assert/strict'
import { test } from 'node:test'

import { OrcaParseError } from '../src/errors.ts'
import { parseLiveStdout } from '../src/parse.ts'

const argv = ['orca', 'orchestration', 'run-create', '--json']

function envelope(result: unknown, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ id: 'rpc_not_a_run', ok: true, result, _meta: { runtimeId: 'rt_1' }, ...extra })
}

test('run-create reads result.run.id and ignores the envelope id', () => {
  const parsed = parseLiveStdout(
    'run-create',
    envelope({ run: { id: 'run_2e83440fda21', objective: 'smoke parse sample' } }),
    argv,
  )
  assert.deepEqual(parsed.ids, { runId: 'run_2e83440fda21' })
  assert.deepEqual(parsed.fields, {})
  assert.equal(JSON.stringify(parsed).includes('rpc_not_a_run'), false)
})

test('prose run-create text is unparseable and is not scraped', () => {
  const prose = 'Run run_57808dafd589 created and bound: smoke parse sample\n'
  assert.throws(
    () => parseLiveStdout('run-create', prose, argv),
    (error: unknown) => {
      assert.ok(error instanceof OrcaParseError)
      assert.equal(error.code, 'unparseable')
      assert.equal(`${error.message} ${JSON.stringify(error)}`.includes('run_57808dafd589'), false)
      return true
    },
  )
})

test('a false ok and a wrong id shape throw', () => {
  const bad = [
    JSON.stringify({ ok: false, result: { run: { id: 'run_should_not' } } }),
    JSON.stringify({ ok: true, result: { run: { id: 'not an id' } } }),
    JSON.stringify({ ok: true, id: 'rpc_not_a_run' }),
    'run-id: run-abc\n',
    '',
    '[]',
    'null',
  ]
  for (const stdout of bad) {
    assert.throws(
      () => parseLiveStdout('run-create', stdout, argv),
      (error: unknown) => {
        assert.ok(error instanceof OrcaParseError)
        const text = `${error.message} ${JSON.stringify(error)}`
        assert.equal(text.includes('run_should_not'), false)
        assert.equal(text.includes('run-abc'), false)
        assert.equal(text.includes('rpc_not_a_run'), false)
        return true
      },
    )
  }
})

test('each verb reads only its confirmed id path', () => {
  assert.deepEqual(
    parseLiveStdout('task-create', envelope({ task: { id: 'task-abc', status: 'open' }, run: { id: 'run-nope' } }), argv).ids,
    { taskId: 'task-abc' },
  )
  assert.deepEqual(
    parseLiveStdout(
      'worker-start',
      envelope({ dispatchId: 'worker-abc', state: 'ready', runId: 'run-nope', taskId: 'task-nope' }),
      argv,
    ).ids,
    { workerId: 'worker-abc' },
  )
  assert.throws(
    () => parseLiveStdout('worker-start', envelope({ dispatchId: 'worker-abc', state: 'running' }), argv),
    OrcaParseError,
  )
  assert.deepEqual(
    parseLiveStdout('worker-show', envelope({ dispatch: { id: 'worker-abc', taskId: 'task-camel' } }), argv).ids,
    { workerId: 'worker-abc' },
  )
  assert.throws(
    () => parseLiveStdout('worker-show', envelope({ dispatch: null }), argv),
    OrcaParseError,
  )
  assert.deepEqual(
    parseLiveStdout('worker-release', envelope({ dispatchId: 'worker-abc' }), argv).ids,
    { workerId: 'worker-abc' },
  )
  assert.deepEqual(
    parseLiveStdout('reply', envelope({ message: { id: 'msg-abc' } }), argv).ids,
    { messageId: 'msg-abc' },
  )
  assert.deepEqual(
    parseLiveStdout('gate-create', envelope({ gate: { id: 'gate-abc', task_id: 'task-1' } }), argv).ids,
    { gateId: 'gate-abc' },
  )
  assert.deepEqual(
    parseLiveStdout('gate-resolve', envelope({ gate: { id: 'gate-done', resolution: 'continue' } }), argv).ids,
    { gateId: 'gate-done' },
  )
})

test('status, task-list, and check map confirmed fields and do not copy ids', () => {
  const status = parseLiveStdout(
    'status',
    envelope({ runtime: { state: 'ready', reachable: true }, app: { running: true }, run: { id: 'run-nope' } }),
    argv,
  )
  assert.deepEqual(status.fields, { status: 'ready' })
  assert.deepEqual(status.ids, {})
  assert.throws(
    () => parseLiveStdout('status', envelope({ runtime: { state: 'waiting' } }), argv),
    OrcaParseError,
  )

  const listed = parseLiveStdout(
    'task-list',
    envelope({ tasks: [{ id: 'task-nope' }], count: 1, runId: 'run-nope' }),
    argv,
  )
  assert.deepEqual(listed.fields, { tasks: '1' })
  assert.deepEqual(listed.ids, {})
  assert.throws(
    () => parseLiveStdout('task-list', envelope({ tasks: [], count: 1 }), argv),
    OrcaParseError,
  )

  const checked = parseLiveStdout(
    'check',
    envelope({
      messages: [{ type: 'worker_done', id: 'msg-nope' }],
      count: 1,
      runId: 'run-nope',
      converged: true,
    }),
    argv,
  )
  assert.deepEqual(checked.fields, { converged: 'false' })
  assert.deepEqual(checked.ids, {})
  assert.equal(JSON.stringify(checked).includes('msg-nope'), false)
  assert.equal(JSON.stringify(checked).includes('run-nope'), false)
})
