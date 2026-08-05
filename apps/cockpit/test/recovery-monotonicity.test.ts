import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

test('CPT-RECOVERY-MONOTONIC-27 B-before-A recovery completion cannot replace the newest canonical snapshot', async () => {
  // App currently exposes no reusable recovery coordinator, and importing its
  // browser entry point would render immediately. Keep this narrow source
  // contract until recovery ordering is separately exported for unit testing.
  const source = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8')
  const recovery = source.slice(source.indexOf('const recover = useCallback'), source.indexOf('\n\n  useEffect', source.indexOf('const recover = useCallback')))

  assert.notEqual(recovery, '', 'the browser entry point must retain a canonical snapshot recovery path')
  assert.match(
    recovery,
    /const\s+nextSnapshot\s*:\s*Snapshot\s*=\s*\{[\s\S]*?\}\s*;?[\s\S]*if\s*\(\s*lastRevision\.current\s*!==\s*undefined\s*&&\s*value\.revision\s*<\s*lastRevision\.current\s*\)\s*return\s+setUnavailable\(false\)\s*;?[\s\S]*lastRevision\.current\s*=\s*value\.revision\s*;?[\s\S]*if\s*\(\s*sameCanonicalSnapshot\(\s*useView\.getState\(\)\.snapshot\s*,\s*nextSnapshot\s*\)\s*\)\s*return\s+setUnavailable\(false\)\s*;?[\s\S]*setSnapshot\(\s*nextSnapshot\s*\)/,
    'a deferred R+1 must not replace an already accepted R+2, while an equal-revision canonical snapshot is compared and can update the visible state',
  )
})
