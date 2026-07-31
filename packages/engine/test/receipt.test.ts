// The init receipt is the gate every phase passes through before it is allowed
// to spend a token (ADR-008). It had ZERO unit tests until its first live run
// failed on a real session — which is how the alias-vs-resolved-id fact below
// was found. The gate that guards everything else was itself unguarded.
//
// Every test here follows PROJECT_MAP Principle 9: it must be able to FIRE.
// A receipt test that only ever feeds matching input proves nothing.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assertInitReceipt } from '../src/index.ts'
import type { StreamEvent } from '../src/index.ts'

/** A real init event, trimmed to the asserted keys. Values are as MEASURED. */
const init = (over: Record<string, unknown> = {}): StreamEvent => ({
  type: 'system',
  subtype: 'init',
  model: 'claude-haiku-4-5-20251001',
  permissionMode: 'auto',
  apiKeySource: 'none',
  claude_code_version: '2.1.220',
  mcp_servers: [{ name: 'atlas', status: 'pending' }],
  ...over,
})

test('an empty expectation asserts nothing and reports nothing', () => {
  assert.deepEqual(assertInitReceipt(init()), [])
})

// --- model: the alias trap ---------------------------------------------------

test('modelAlias accepts the RESOLVED id the engine actually reports', () => {
  // MEASURED: --model haiku comes back as claude-haiku-4-5-20251001.
  assert.deepEqual(assertInitReceipt(init(), { modelAlias: 'haiku' }), [])
})

test('modelAlias fires when a different family answered', () => {
  const problems = assertInitReceipt(init({ model: 'claude-sonnet-4-5-20250929' }), { modelAlias: 'haiku' })
  assert.equal(problems.length, 1)
  assert.match(problems[0] ?? '', /not a "haiku" build/)
})

test('modelAlias is SEGMENT membership, not substring', () => {
  // The reason this distinction is tested: substring would pass here, and a
  // guard that passes for the wrong reason is the defect this repo keeps
  // rediscovering. `haikuish` contains `haiku`; it is not a haiku build.
  assert.equal(assertInitReceipt(init({ model: 'claude-haikuish-9' }), { modelAlias: 'haiku' }).length, 1)
})

test('modelAlias fires on a MISSING model field rather than passing', () => {
  const problems = assertInitReceipt({ type: 'system', subtype: 'init' }, { modelAlias: 'haiku' })
  assert.equal(problems.length, 1, 'an absent field must fail the gate, never satisfy it')
})

test('model (exact) still pins a specific build', () => {
  assert.deepEqual(assertInitReceipt(init(), { model: 'claude-haiku-4-5-20251001' }), [])
  // And the alias form is REJECTED by the exact form — which is the failure the
  // live run hit, kept as a test so nobody "fixes" it by loosening the compare.
  assert.equal(assertInitReceipt(init(), { model: 'haiku' }).length, 1)
})

// --- the rest of the receipt -------------------------------------------------

test('apiKeySource is asserted, so a routed-away backend fails the phase', () => {
  // `none` is subscription auth. A session answered via ANTHROPIC_BASE_URL in
  // the operator's shell reports something else, and the S0 report would
  // otherwise have been committed as Anthropic evidence.
  assert.deepEqual(assertInitReceipt(init(), { apiKeySource: 'none' }), [])
  const problems = assertInitReceipt(init({ apiKeySource: 'ANTHROPIC_API_KEY' }), { apiKeySource: 'none' })
  assert.equal(problems.length, 1)
})

test('permissionMode mismatch fires', () => {
  assert.equal(assertInitReceipt(init({ permissionMode: 'bypassPermissions' }), { permissionMode: 'auto' }).length, 1)
})

test('an MCP server is checked for REGISTRATION, never for connected', () => {
  // `status` races the init emit — identical runs read `pending` then
  // `connected`. Gating on it flakes; gating on the name does not.
  assert.deepEqual(assertInitReceipt(init(), { mcpServers: ['atlas'] }), [])
  assert.equal(assertInitReceipt(init(), { mcpServers: ['atlas', 'missing'] }).length, 1)
})

test('an empty mcpServers expectation does not vacuously pass a session with none', () => {
  // Guard against the reverse bug: [] must mean "assert nothing", and a
  // populated list must actually be checked against an EMPTY server set.
  assert.deepEqual(assertInitReceipt(init({ mcp_servers: [] }), { mcpServers: [] }), [])
  assert.equal(assertInitReceipt(init({ mcp_servers: [] }), { mcpServers: ['atlas'] }).length, 1)
})

test('the version range is inclusive at both ends and fires outside it', () => {
  assert.deepEqual(assertInitReceipt(init(), { versionRange: ['2.1.220', '2.1.999'] }), [])
  assert.deepEqual(assertInitReceipt(init(), { versionRange: ['2.1.220', '2.1.220'] }), [])
  assert.equal(assertInitReceipt(init({ claude_code_version: '2.1.219' }), { versionRange: ['2.1.220', '2.1.999'] }).length, 1)
  assert.equal(assertInitReceipt(init({ claude_code_version: '2.2.0' }), { versionRange: ['2.1.220', '2.1.999'] }).length, 1)
})

test('version compare is numeric, not lexicographic', () => {
  // '2.1.9' > '2.1.220' as strings. A lexicographic compare would let a version
  // BELOW the tested floor through, which is the direction that matters.
  assert.equal(assertInitReceipt(init({ claude_code_version: '2.1.9' }), { versionRange: ['2.1.220', '2.1.999'] }).length, 1)
})

test('an unreadable version fails rather than being skipped', () => {
  assert.equal(assertInitReceipt(init({ claude_code_version: 'unknown' }), { versionRange: ['2.1.220', '2.1.999'] }).length, 1)
  assert.equal(assertInitReceipt({ type: 'system', subtype: 'init' }, { versionRange: ['2.1.220', '2.1.999'] }).length, 1)
})

test('every problem is reported, not just the first', () => {
  const problems = assertInitReceipt(init({ model: 'claude-opus-4-5', apiKeySource: 'ANTHROPIC_API_KEY' }), {
    modelAlias: 'haiku',
    apiKeySource: 'none',
    versionRange: ['9.0.0', '9.9.9'],
  })
  assert.equal(problems.length, 3, `expected all three, got ${JSON.stringify(problems)}`)
})
