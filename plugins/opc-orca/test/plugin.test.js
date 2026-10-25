import assert from 'node:assert/strict'
import { test } from 'node:test'

import { apply, inject, name } from '../index.js'

test('stub identity registers nothing that can write or dispatch', () => {
  assert.equal(name, 'opc-orca')
  assert.deepEqual(inject, [])
  const notes = []
  const ctx = {
    logger(scope) {
      assert.equal(scope, 'opc-orca')
      return { info(message) { notes.push(message) } }
    },
    registerTool() {
      throw new Error('plugin must not register tools')
    },
    handleApi() {
      throw new Error('plugin must not register routes')
    },
  }
  const dispose = apply(ctx, {})
  assert.equal(typeof dispose, 'function')
  dispose()
  assert.deepEqual(notes, ['opc-orca: stub loaded; no tools registered'])
})

test('apply tolerates a host with no logger', () => {
  const dispose = apply(undefined, {})
  assert.equal(typeof dispose, 'function')
  dispose()
})
