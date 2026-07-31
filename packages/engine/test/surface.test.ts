import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { loadSurface, classify, classifyInner, pairKeyOf } from '../src/surface.ts'

// The REAL committed artifact, not a fixture. A classifier tested only against
// a hand-made stub proves the classifier and says nothing about the file the
// product actually ships with.
const SURFACE_PATH = fileURLToPath(new URL('../../../tools/probe/stream-surface.json', import.meta.url))
const surface = loadSurface(SURFACE_PATH)

test('the committed artifact loads and is schemaVersion 2 with a fail-closed default', () => {
  assert.equal(surface.schemaVersion, 2)
  assert.equal(surface.defaultForUnknown, 'escalate')
})

test('pair keys are built the way the artifact keys them', () => {
  assert.equal(pairKeyOf({ type: 'assistant' }), 'assistant')
  assert.equal(pairKeyOf({ type: 'system', subtype: 'init' }), 'system/init')
  assert.equal(pairKeyOf({ type: 'result', subtype: null }), 'result')
})

test('an UNKNOWN pair escalates — it is never dropped', () => {
  // The artifact is a sample of one flag configuration on one model, so unknown
  // pairs are a certainty rather than an edge case. A renderer that drops them
  // goes silent, which REVIEW-02 names as the worst outcome for a non-coder.
  const c = classify(surface, { type: 'totally_new_event_type' })
  assert.equal(c.class, 'escalate')
  assert.equal(c.reason, 'unclassified')
})

test('an unconditional pinned class is honoured', () => {
  assert.equal(classify(surface, { type: 'assistant' }).class, 'render')
  assert.equal(classify(surface, { type: 'system', subtype: 'init' }).class, 'ignore')
})

test('rate_limit_event is IGNORED while healthy and ESCALATES otherwise', () => {
  // The whole reason schemaVersion 2 exists. Under v1 this pair carried an
  // unconditional `escalate`, so a renderer obeying the file literally would
  // have alarmed on every healthy phase — and the alarm fatigue would bury the
  // one escalation the class was written for.
  const healthy = classify(surface, { type: 'rate_limit_event', rate_limit_info: { status: 'allowed' } })
  assert.equal(healthy.class, 'ignore')
  assert.equal(healthy.reason, 'conditional')

  const paused = classify(surface, { type: 'rate_limit_event', rate_limit_info: { status: 'rejected' } })
  assert.equal(paused.class, 'escalate')
  assert.equal(paused.reason, 'conditional-unknown-value')
})

test('a conditional rule whose path does not resolve escalates rather than vanishing', () => {
  // A `when` rule pointing at a field that no longer exists would otherwise
  // silently never match — the decoration shape.
  const c = classify(surface, { type: 'rate_limit_event' })
  assert.equal(c.class, 'escalate')
  assert.equal(c.reason, 'conditional-unknown-value')
})

test('system/status is quiet only for the one value that was measured', () => {
  assert.equal(classify(surface, { type: 'system', subtype: 'status', status: 'requesting' }).class, 'ignore')
  assert.equal(classify(surface, { type: 'system', subtype: 'status', status: 'something_new' }).class, 'escalate')
})

test('thinking, thinking_delta and signature_delta are IGNORED BY NAME', () => {
  // Raw chain-of-thought reaches the wire by default on some models, and
  // ADR-006's language dial is a hook that provably does not touch it. Ignoring
  // these by omission would fail open the first time the renderer is rewritten.
  const cases = [
    { content_block: { type: 'thinking' } },
    { delta: { type: 'thinking_delta' } },
    { delta: { type: 'signature_delta' } },
  ]
  for (const event of cases) {
    const results = classifyInner(surface, { type: 'stream_event', event })
    assert.ok(results.length > 0)
    for (const r of results) assert.equal(r.class, 'ignore', `${r.pair} must be ignored`)
  }
})

test('text deltas render', () => {
  const results = classifyInner(surface, { type: 'stream_event', event: { delta: { type: 'text_delta' } } })
  assert.ok(results.some((r) => r.class === 'render'))
})

test('an unknown inner type escalates', () => {
  const results = classifyInner(surface, { type: 'stream_event', event: { delta: { type: 'brand_new_delta' } } })
  assert.equal(results[0]?.class, 'escalate')
  assert.equal(results[0]?.reason, 'unclassified')
})

test('loadSurface refuses an artifact that fails open', () => {
  const bad = fileURLToPath(new URL('./fixtures/surface-fail-open.json', import.meta.url))
  assert.throws(() => loadSurface(bad), /defaultForUnknown = "ignore", must be "escalate"/)
})

test('loadSurface refuses the shapes it used to load cleanly', () => {
  // This loader checked `defaultForUnknown` and NOTHING else, while the probe
  // suite enforced four more invariants on the same file — so the strong copy
  // ran in CI and the weak one ran on the user's machine. It now calls the same
  // validator. Each fixture is a shape that loaded fine before.
  for (const [name, pattern] of [
    // `when` with no `unknown` yielded `class: undefined`, which every renderer
    // drops silently.
    ['surface-when-no-unknown.json', /when\.unknown/],
    // A typo'd class is outside the three-value set, so it is neither rendered
    // nor escalated — it vanishes.
    ['surface-bad-class.json', /expected one of render \| ignore \| escalate/],
    // A VALID shape that is a raw chain-of-thought leak. Shape validation alone
    // would wave this through, which is why one classification is pinned.
    ['surface-thinking-render.json', /must be "ignore"/],
  ] as const) {
    const p = fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))
    assert.throws(() => loadSurface(p), pattern, `${name} must be refused`)
  }
})
