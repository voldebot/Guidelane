// Live end-to-end proof. OPT-IN: it spends real quota on the owner's own
// subscription, so it is skipped unless GUIDELANE_LIVE=1. CI has no login and
// ADR-001 forbids putting one there, so this can only run where a human is
// already signed in — the same constraint that split the conformance probe into
// two tiers.
//
//   GUIDELANE_LIVE=1 npm test --workspace @guidelane/engine
//
// What it proves is exactly what unit tests cannot: that the MEASURED lifecycle
// rules hold when the real engine is on the other end.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EngineSession, SessionRegistry, loadSurface } from '../src/index.ts'
import type { StreamEvent, Classification, SessionFailure } from '../src/index.ts'

const LIVE = process.env.GUIDELANE_LIVE === '1'
const SURFACE_PATH = fileURLToPath(new URL('../../../tools/probe/stream-surface.json', import.meta.url))

test('live: the measured lifecycle holds against the real engine', { skip: !LIVE }, async (t) => {
  const registry = new SessionRegistry()
  const surface = loadSurface(SURFACE_PATH)
  const session = new EngineSession({
    args: [
      '-p',
      '--input-format', 'stream-json',
      '--output-format', 'stream-json',
      '--verbose',
      '--model', 'haiku',
      '--tools', '',
      '--no-session-persistence',
    ],
    cwd: mkdtempSync(join(tmpdir(), 'guidelane-engine-')),
    registry,
    surface,
    expect: {
      // The ALIAS, not the id — `init.model` reports `claude-haiku-4-5-20251001`.
      // This line said `model: 'haiku'` and failed on the first real session.
      modelAlias: 'haiku',
      // `none` is subscription auth. Asserted rather than logged, so a session
      // answered by a routed-away backend fails the receipt instead of being
      // reported as Anthropic's engine.
      apiKeySource: 'none',
      versionRange: ['2.1.220', '2.1.999'],
    },
    stallMs: 90_000,
  })

  // A failing assertion must not leak an authenticated process. Without this,
  // the first live failure left `claude` alive, node's loop never drained, and
  // the run hung for five minutes with an empty output file — the failure was
  // invisible until the process was killed by hand.
  t.after(() => { session.stop(); registry.killAll() })

  const seen: Array<{ event: StreamEvent; cls: Classification }> = []
  const escalations: Classification[] = []
  const failures: SessionFailure[] = []
  const turns: StreamEvent[] = []
  let assistantText = ''

  session.on('event', (event, cls) => {
    seen.push({ event, cls })
    if (event.type === 'assistant') {
      const msg = event.message as { content?: Array<{ type?: string; text?: string }> } | undefined
      for (const b of msg?.content ?? []) if (b.type === 'text') assistantText += b.text ?? ''
    }
  })
  session.on('escalate', (_e, cls) => escalations.push(cls))
  session.on('failure', (f) => failures.push(f))

  const closed = new Promise<{ code: number | null }>((resolve) => session.on('closed', resolve))
  // ARM BEFORE SEND. Registering the listener after send() is a race the engine
  // wins whenever it answers faster than this test resumes — the `turn` fires
  // into no listener and the await never settles. It hung exactly once that way.
  const turn = (): Promise<StreamEvent> =>
    new Promise((resolve) => session.once('turn', (t) => { turns.push(t); resolve(t) }))

  session.start()
  const argv = session.argv
  assert.ok(argv.includes('--strict-mcp-config'), 'isolation pair must be on the real argv')

  const turn1 = turn()
  session.send('Reply with exactly: ENGINE_OK_1')
  await turn1

  // MULTI-TURN on one session: `result` is per-turn, so the session is still
  // alive here. An adapter that treated the first result as session-end would
  // have leaked this process.
  const turn2 = turn()
  session.send('Reply with exactly: ENGINE_OK_2')
  await turn2

  assert.equal(turns.length, 2, 'two turns on one session')
  assert.match(assistantText, /ENGINE_OK_1/)
  assert.match(assistantText, /ENGINE_OK_2/)

  // The init receipt gate ran and found nothing wrong.
  assert.deepEqual(failures.filter((f) => f.kind === 'init-receipt'), [])

  // TERMINATION: closing stdin ends it. Measured at ~530 ms; a generous budget
  // here, because the assertion is "it ends", not "it ends fast".
  const t0 = Date.now()
  session.finish()
  const { code } = await Promise.race([
    closed,
    new Promise<{ code: null }>((_r, reject) => setTimeout(() => reject(new Error('did not exit after stdin closed')), 20_000)),
  ])
  const exitLatency = Date.now() - t0
  assert.equal(code, 0, 'a normal phase end must not look like a failure')
  assert.ok(exitLatency < 20_000)

  // No orphan: the registry released the group.
  assert.equal(registry.size, 0, 'registry still holds a live process group')

  // The classifier ran on real events, and the schemaVersion 2 fix holds END TO
  // END: a healthy session emits rate_limit_event, and under the old
  // one-class-per-pair schema that alone would have escalated every phase.
  //
  // The assertion is on the REASON, not the class. `allowed` is ignored and
  // `allowed_warning` is rendered — both are healthy, and pinning either class
  // here would make this test fail the next time the owner's usage crosses a
  // threshold, which is a fact about the subscription and not about the adapter.
  // `conditional` means the value was MODELLED; `conditional-unknown-value` is
  // the fail-closed branch and means it was not. That is the real invariant.
  const rateLimit = seen.filter((s) => s.event.type === 'rate_limit_event')
  assert.ok(rateLimit.length > 0, 'a healthy session emits rate_limit_event')
  for (const r of rateLimit) {
    assert.equal(
      r.cls.reason,
      'conditional',
      `an unmodelled rate_limit_info.status reached the classifier: ${JSON.stringify(r.event)}`
    )
    assert.notEqual(r.cls.class, 'escalate', 'a healthy rate_limit_event must NOT escalate')
  }
  assert.deepEqual(escalations, [], `nothing should escalate on a healthy session, got ${JSON.stringify(escalations)}`)

  // And nothing was silently dropped: every event got a class.
  assert.ok(seen.length > 0)
  for (const s of seen) assert.ok(['render', 'ignore', 'escalate'].includes(s.cls.class))
})

test('live: an init receipt mismatch fails the phase before work', { skip: !LIVE }, async (t) => {
  // The gate must fire on the real stream, not just in a unit test. Ask for a
  // model the session will not be running, and the receipt should say so.
  const registry = new SessionRegistry()
  const session = new EngineSession({
    args: ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
      '--model', 'haiku', '--tools', '', '--no-session-persistence'],
    cwd: mkdtempSync(join(tmpdir(), 'guidelane-engine-bad-')),
    registry,
    surface: loadSurface(SURFACE_PATH),
    expect: { model: 'definitely-not-the-model-this-session-runs' },
    stallMs: 90_000,
  })
  t.after(() => { session.stop(); registry.killAll() })
  const failures: SessionFailure[] = []
  session.on('failure', (f) => failures.push(f))
  const closed = new Promise((resolve) => session.on('closed', resolve))

  session.start()
  const firstTurn = new Promise<void>((resolve) => session.once('turn', () => resolve()))
  session.send('Reply with exactly: ENGINE_OK')
  await firstTurn
  session.finish()
  await closed

  const receipt = failures.filter((f) => f.kind === 'init-receipt')
  assert.equal(receipt.length, 1, 'the init receipt gate did not fire on a real mismatch')
  assert.match(String(receipt[0]?.detail), /model is/)
  assert.equal(registry.size, 0)
})
