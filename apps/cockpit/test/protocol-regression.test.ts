import assert from 'node:assert/strict'
import { test } from 'node:test'
import { semanticActivity } from '../src/protocol.ts'

test('CPT-SEMANTIC-BOUNDARY-06 refuses relative and Windows paths, diagnostics, terminal output, and arbitrary raw prose', () => {
  for (const message of [
    './private/project.ts',
    '../private/project.ts',
    'C:\\Users\\alice\\private\\project.ts',
    'ENOENT: no such file or directory, open private/project.ts',
    'Error: engine failed\n    at runBuild (src/build.ts:14:3)',
    '$ claude --print\nBuild finished',
    'The engine says this arbitrary raw message is safe.',
  ]) {
    assert.throws(
      () => semanticActivity({ type: 'phase_update', revision: 8, message }),
      /unsafe|semantic|redact/i,
      `raw diagnostic material must not become cockpit activity: ${message}`
    )
  }
})
