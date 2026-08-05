import { test } from 'node:test'
import assert from 'node:assert/strict'
import { scrubbedEnv, DENIED_ENV_KEYS, FORBIDDEN_STATE_KEYS, BACKEND_ROUTING_KEYS } from '../src/env.ts'

// These tests are written to FAIL if the deny-list stops working, not to
// re-state it. The S0 suite shipped an assertion that iterated the same constant
// its own delete loop had just iterated, in the same function, with nothing in
// between — a guard with no execution path on which it could throw. So every
// test here goes through the real function with a real environment.

test('a denied key present in the parent environment is removed', () => {
  const saved = process.env.CLAUDECODE
  process.env.CLAUDECODE = '1'
  try {
    const { env, removed } = scrubbedEnv()
    assert.equal(env.CLAUDECODE, undefined)
    assert.ok(removed.includes('CLAUDECODE'))
  } finally {
    if (saved === undefined) delete process.env.CLAUDECODE
    else process.env.CLAUDECODE = saved
  }
})

test('a caller CANNOT re-introduce a denied key by passing it explicitly', () => {
  // The scrub runs after the merge on purpose. If it ran first, `extra` would be
  // the documented way around the deny-list, and a convention is not a
  // constraint.
  const { env, removed } = scrubbedEnv({ ANTHROPIC_BASE_URL: 'https://example.invalid' })
  assert.equal(env.ANTHROPIC_BASE_URL, undefined)
  assert.ok(removed.includes('ANTHROPIC_BASE_URL'))
})

test('ENGINE-ENV-FINAL-32 scrubbedEnv admits only finite supported internal keys and omits an arbitrary caller GUIDELANE sentinel', () => {
  const sentinel = 'GUIDELANE_OWN'
  const { env, removed } = scrubbedEnv({ [sentinel]: 'must-not-cross-the-engine-boundary' })

  assert.equal(env[sentinel], undefined, 'an arbitrary caller GUIDELANE_* name is not an engine capability grant')
  assert.ok(removed.includes(sentinel), 'the omitted sentinel is reported as withheld rather than silently inherited')
  assert.deepEqual(
    Object.keys(env).filter((key) => key.startsWith('GUIDELANE_')),
    [],
    'this engine boundary has no supported caller-provided GUIDELANE_* keys',
  )
})

test('ENGINE-ENV-FINAL-33 scrubbedEnv metadata counts exactly the operator entries that cross and reports omitted entries', () => {
  const supplied = {
    PATH: 'final33-controlled-path',
    LANG: 'final33-controlled-lang',
    FINAL33_OPERATOR_SECRET: 'must-not-cross-the-engine-boundary',
  }
  const { env, removed, inherited } = scrubbedEnv(supplied)
  const admitted = Object.keys(env).filter((key) => key !== 'DISABLE_AUTOUPDATER')

  assert.equal(env.PATH, supplied.PATH)
  assert.equal(env.LANG, supplied.LANG)
  assert.equal(env.FINAL33_OPERATOR_SECRET, undefined)
  assert.equal(inherited, admitted.length, 'inherited counts every ambient or supplied operator entry that actually reaches the child, excluding the internally forced updater value')
  assert.ok(removed.includes('FINAL33_OPERATOR_SECRET'), 'omitted caller input remains auditable')
  assert.ok(!removed.includes('PATH'), 'an admitted explicit portable key is not reported as removed')
  assert.ok(!removed.includes('LANG'), 'an admitted explicit portable key is not reported as removed')
})

test('auto-update is disabled in every child', () => {
  assert.equal(scrubbedEnv().env.DISABLE_AUTOUPDATER, '1')
})

test('the deny-list covers backend routing, not just the nesting markers', () => {
  // The S0 suite scrubbed only the five CLAUDE_CODE_* markers and would have
  // measured GLM while reporting it as Anthropic's engine. This asserts the
  // WIDER set is present — the narrow one passing is exactly the bug.
  for (const key of BACKEND_ROUTING_KEYS) assert.ok(DENIED_ENV_KEYS.includes(key), `${key} must be denied`)
  for (const key of FORBIDDEN_STATE_KEYS) assert.ok(DENIED_ENV_KEYS.includes(key), `${key} must be denied`)
  assert.ok(DENIED_ENV_KEYS.length >= 14, 'deny-list shrank — re-pin deliberately')
})

test('every denied key is actually removed when present, one at a time', () => {
  // Not a tautology over the constant: each key is really set on the process
  // environment and really read back through the function.
  for (const key of DENIED_ENV_KEYS) {
    const saved = process.env[key]
    process.env[key] = 'leaked'
    try {
      assert.equal(scrubbedEnv().env[key], undefined, `${key} survived the scrub`)
    } finally {
      if (saved === undefined) delete process.env[key]
      else process.env[key] = saved
    }
  }
})
