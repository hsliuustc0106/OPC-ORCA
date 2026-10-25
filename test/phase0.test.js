import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { test } from 'node:test'

const workflowDir = '.github/workflows'

test('risk and review workflows are Phase0 report-only', () => {
  for (const name of ['risk-tier.yml', 'review-gate.yml']) {
    const text = readFileSync(`${workflowDir}/${name}`, 'utf8')
    assert.match(text, /Phase0/)
    assert.match(text, /continue-on-error:\s*true/)
    assert.doesNotMatch(text, /pull_request_target/)
  }
})

function yamlWithoutComments(text) {
  return text
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('#'))
    .join('\n')
}

test('no workflow enables a merge queue or auto-merge', () => {
  for (const name of readdirSync(workflowDir)) {
    const text = yamlWithoutComments(readFileSync(`${workflowDir}/${name}`, 'utf8'))
    assert.doesNotMatch(text, /merge_group|auto-merge|gh pr merge|pull_request_target/)
  }
})

test('agent policy files declare themselves Phase0 report-only', () => {
  for (const name of ['risk-rules.json', 'review-policy.json']) {
    const policy = JSON.parse(readFileSync(`.github/agent/${name}`, 'utf8'))
    assert.equal(policy.phase, 'phase0-report-only')
    assert.match(policy.comment, /Phase 0 report-only/)
    assert.match(policy.comment, /do not (block|merge)|not a merge right|Nothing in CI/i)
  }
})
