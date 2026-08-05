import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

function stepBlocks(workflow) {
  const lines = workflow.split('\n')
  const starts = lines.map((line, index) => /^\s*-\s+(?:uses|name):/.test(line) ? index : -1).filter((index) => index >= 0)
  return starts.map((start, index) => lines.slice(start, starts[index + 1] ?? lines.length).join('\n'))
}

test('engine conformance uses immutable actions, does not persist checkout credentials, and runs the shared fail-closed source scanner', async () => {
  const workflow = await readFile(new URL('../../.github/workflows/engine-conformance.yml', import.meta.url), 'utf8')
  const uses = [...workflow.matchAll(/^\s*(?:-\s*)?uses:\s*([^\s#]+)/gm)].map((match) => match[1])
  const checkout = stepBlocks(workflow).filter((step) => /uses:\s*actions\/checkout@/.test(step))

  assert.match(workflow, /^permissions:\n\s+contents:\s*read\s*$/m)
  assert.ok(uses.length > 0, 'engine conformance must declare actions')
  assert.ok(uses.every((reference) => /^[^@]+@[a-f0-9]{40}$/i.test(reference)), 'every action reference must use a full immutable commit SHA')
  assert.equal(checkout.length, 3, 'every engine conformance job must use a hardened checkout')
  assert.ok(checkout.every((step) => /persist-credentials:\s*false/.test(step)), 'checkout must never persist the workflow token in local Git configuration')
  assert.match(workflow, /run:\s*node tools\/gates\/gate-artifacts\.mjs --source-only/, 'the committed-source redaction gate must use the shared scanner')
})

test('product offline resolves its evidence root at shell runtime before any evidence command', async () => {
  const workflow = await readFile(new URL('../../.github/workflows/product-offline.yml', import.meta.url), 'utf8')
  const prepare = workflow.indexOf('name: Prepare isolated evidence root')
  const capture = workflow.indexOf('name: Capture immutable source identity')

  assert.doesNotMatch(workflow, /^\s*S2_EVIDENCE_DIR:\s*\$\{\{\s*runner\.temp\s*\}\}/m, 'runner context is unavailable in job-level env')
  assert.ok(prepare >= 0 && prepare < capture, 'the evidence root must be resolved before evidence is captured')
  assert.match(workflow.slice(prepare, capture), /S2_EVIDENCE_DIR="\$\{RUNNER_TEMP\}\/guidelane-s2-gates"/)
  assert.match(workflow.slice(prepare, capture), />> "\$GITHUB_ENV"/, 'the resolved path must be exported only to later workflow steps')
})
