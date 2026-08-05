import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

test('S2-F24-D redaction gate scans hardening and protocol-like files without blanket exclusions and reports truthful file and byte totals', async () => {
  const gate = await readFile(new URL('./gate-artifacts.mjs', import.meta.url), 'utf8')
  assert.equal(/'packages\/orchestrator\/test\/(?:hardening|protocol)\.test\.ts'/.test(gate), false, 'hostile literal fixtures must be narrowly classified, never whole-file excluded')
  assert.match(gate, /scannedSourceFiles\s*:/, 'the result must enumerate every scanned source file')
  assert.match(gate, /scannedSourceBytes\s*:/, 'the result must truthfully enumerate scanned source bytes')
})
