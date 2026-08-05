import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import test from 'node:test'

const root = resolve(new URL('../..', import.meta.url).pathname)

function reconcile(rows, evidence) {
  const selectors = new Set()
  for (const row of rows) {
    const selector = row.executionEvidence
    if (!selector || typeof selector.source !== 'string' || typeof selector.selector !== 'string' || !selector.selector) throw new Error(`${row.id} lacks an executionEvidence selector`)
    const key = `${selector.source}:${selector.selector}`
    if (selectors.has(key)) throw new Error(`duplicate opaque executionEvidence selector: ${key}`)
    selectors.add(key)
    const matches = evidence.filter((entry) => entry.source === selector.source && entry.selector === selector.selector)
    if (matches.length !== 1 || matches[0].status !== 'passed') throw new Error(`${row.id} has no unique passed execution evidence`)
    if (matches[0].commentOnly === true) throw new Error(`${row.id} maps only to source/comment text, not an executed test`)
  }
}

test('inventory has at least 139 IDs, including the frozen Final-29 and Final-30 boundaries, with category-appropriate executionEvidence selectors', async () => {
  const inventory = JSON.parse(await readFile(join(root, 'tools/gates/s2-test-inventory.json'), 'utf8'))
  assert.ok(inventory.scenarios.length >= 139)
  for (const behaviorKey of ['S2-ART-STALE-REVISION', 'S2-ART-MANIFEST-AHEAD']) {
    const matchingRows = inventory.scenarios.filter((row) => row.category === 'artifact-state-authority' && (row.testName?.includes(behaviorKey) || row.executionEvidence?.selector?.includes(behaviorKey)))
    assert.equal(matchingRows.length, 1, `${behaviorKey} must have exactly one artifact-state-authority inventory row`)
    assert.equal(matchingRows[0].file, 'packages/orchestrator/test/artifacts.test.ts', `${behaviorKey} must map to its executable artifact-state test`)
  }
  const browserIds = new Set(['S2-F24-A-BROWSER', 'S2-F27-CPT-ACTIVITY-20', 'S2-F27-CPT-GATE-PURPOSES-21', 'S2-F29-CPT-TAB', 'S2-F30-CPT-LAYOUT'])
  const expectedSource = (row) => row.category === 'cockpit-novice-journey' || browserIds.has(row.id) ? 'browser' : row.category === 'local-web-normal' ? 'native-gate' : row.category === 'local-web-seeded' ? 'native-seed-rejection' : row.command === 'npm run test:offline' ? 'offline-tap' : 'orchestrator-tap'
  for (const row of inventory.scenarios) {
    assert.equal(row.executionEvidence?.source, expectedSource(row), `${row.id} must name its executed evidence source`)
    assert.equal(typeof row.executionEvidence?.selector, 'string', `${row.id} must name an opaque executed-evidence selector`)
    assert.ok(row.executionEvidence.selector.length > 0, `${row.id} selector must not be empty`)
  }
})

test('execution evidence reconciliation fails closed', () => {
  const row = { id: 'S2-X-01', executionEvidence: { source: 'offline-tap', selector: 'tap:alpha' } }
  assert.doesNotThrow(() => reconcile([row], [{ source: 'offline-tap', selector: 'tap:alpha', status: 'passed' }]))
  assert.throws(() => reconcile([row], []), /unique passed/)
  assert.throws(() => reconcile([row], [{ source: 'offline-tap', selector: 'tap:alpha', status: 'skipped' }]), /unique passed/)
  assert.throws(() => reconcile([row], [{ source: 'offline-tap', selector: 'tap:alpha', status: 'passed', commentOnly: true }]), /source\/comment/)
  assert.throws(() => reconcile([row], [{ source: 'offline-tap', selector: 'tap:alpha', status: 'passed' }, { source: 'offline-tap', selector: 'tap:alpha', status: 'passed' }]), /unique passed/)
  assert.throws(() => reconcile([row, { id: 'S2-X-02', executionEvidence: { source: 'offline-tap', selector: 'tap:alpha' } }], [{ source: 'offline-tap', selector: 'tap:alpha', status: 'passed' }]), /duplicate opaque/)
})
