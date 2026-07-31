// Lifecycle behaviour that does NOT need the real engine. The live tier proves
// the contract against the vendor binary; this tier proves the parts that are
// ours, deterministically and for free.
//
// `/bin/cat` stands in for the engine wherever the test is about the adapter's
// own plumbing: it holds stdin open, stays silent until spoken to, and exits
// when stdin closes — which is the measured engine lifecycle exactly (`result`
// is per-turn; closing stdin is the terminator).
//
// Those fakes run `ambient: true` ON PURPOSE, and it is worth being explicit
// about why rather than letting it look like a shortcut: `applyIsolation` would
// otherwise append `--strict-mcp-config --setting-sources ''` to `cat`'s argv,
// which `cat` treats as filenames and dies on. The first version of this file
// did exactly that, and both watchdog tests failed with a promise that never
// settled — the fake died instantly, so there was nothing to time out. Isolation
// is asserted against real argv in `isolation.test.ts` and against the real
// engine in `live.test.ts`; here it would only be testing `cat`.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { EngineSession, SessionRegistry, loadSurface } from '../src/index.ts'

const SURFACE_PATH = fileURLToPath(new URL('../../../tools/probe/stream-surface.json', import.meta.url))
const surface = loadSurface(SURFACE_PATH)

/** A fake engine: alive, silent, and ended by closing stdin. */
const fake = (over: Record<string, unknown> = {}) => ({
  claudeBin: '/bin/cat',
  args: [] as string[],
  ambient: true,
  cwd: process.cwd(),
  registry: new SessionRegistry(),
  surface,
  ...over,
})

// --- isolation at the spawn boundary ----------------------------------------

test('start() REFUSES an argv that would be spawned without isolation', () => {
  // The one path where applyIsolation legitimately returns argv untouched: not a
  // session invocation, so no `-p`, so no pair added. This is what makes the
  // assertion in start() a real guard rather than a tautology over its own
  // output — if it ever stops throwing here, the guard has become decoration.
  const session = new EngineSession(fake({ args: ['--model', 'haiku'], ambient: false }))
  assert.throws(() => session.start(), /--strict-mcp-config/)
})

test('ambient:true is the only way past it, and it has to be asked for', () => {
  const session = new EngineSession(fake({ args: ['--model', 'haiku'] }))
  assert.ok(!session.argv.includes('--strict-mcp-config'), 'ambient must not silently isolate')
})

// --- registry and environment ------------------------------------------------

test('the registry holds the session while it lives and releases it on close', async () => {
  const registry = new SessionRegistry()
  const session = new EngineSession(fake({ registry }))
  const closed = new Promise((resolve) => session.on('closed', resolve))
  session.start()
  assert.equal(registry.size, 1, 'a live session must be reapable')
  session.finish()
  await closed
  assert.equal(registry.size, 0, 'a closed session must not be held forever')
})

test('scrubbedEnvKeys reports what was actually removed, not what is on the list', async () => {
  // Passed as `extra`, which is merged BEFORE the scrub — so a caller cannot
  // re-introduce a denied key by supplying it explicitly.
  const session = new EngineSession(fake({ env: { CLAUDE_CODE_SIMPLE: '1' } }))
  const closed = new Promise((resolve) => session.on('closed', resolve))
  session.start()
  assert.ok(session.scrubbedEnvKeys.includes('CLAUDE_CODE_SIMPLE'))
  // A report of presence, not an echo of the deny-list: a key that was never set
  // must not appear, or the value says nothing about the machine.
  assert.ok(!session.scrubbedEnvKeys.includes('AWS_BEARER_TOKEN_BEDROCK'))
  session.finish()
  await closed
})

// --- the stall watchdog, both directions ------------------------------------

test('the watchdog does NOT fire while nobody has asked the engine anything', async () => {
  // The false alarm that shipped first: a watchdog running continuously fires on
  // a perfectly healthy session sitting idle between turns. Silence we caused is
  // not a stall, and an alarm that cries wolf teaches a user to ignore alarms.
  const session = new EngineSession(fake({ stallMs: 150 }))
  const failures: unknown[] = []
  session.on('failure', (f) => failures.push(f))
  session.start()
  await new Promise((r) => setTimeout(r, 700)) // >> stallMs, and nothing was sent
  assert.deepEqual(failures, [], 'a session nobody has spoken to is idle, not stalled')
  const closed = new Promise((resolve) => session.on('closed', resolve))
  session.finish()
  await closed
})

test('the watchdog DOES fire when the engine goes quiet after being asked', async () => {
  // Without this, the test above proves nothing: a watchdog that never fires at
  // all would also pass it. `cat` echoes the one line we send and then goes
  // silent — the shape of a phase that accepted the turn and hung.
  const registry = new SessionRegistry()
  const session = new EngineSession(fake({ registry, stallMs: 200 }))
  const failed = new Promise<{ kind: string; detail?: unknown }>((resolve) => session.on('failure', resolve))
  session.start()
  session.send('anything')
  const f = await failed
  assert.equal(f.kind, 'stall')
  assert.equal((f.detail as { finished: boolean }).finished, false, 'this stall is mid-turn, not post-finish')
  // Stop-then-report: the message tells the user the session was stopped, so it
  // must actually have been. Prose promising an action the code does not take is
  // the same defect class as a guard that cannot fire — and a stalled phase left
  // running is an authenticated process spending quota with nobody reading it.
  assert.equal(registry.size, 0, 'a stalled session must be reaped, not merely reported')
})

test('the watchdog fires with the post-finish message when stdin closed and nothing exited', async () => {
  // The other arm: `finish()` re-arms the watchdog, because after stdin closes
  // silence stops being latency and starts meaning "did not exit". `sleep` never
  // reads stdin, so closing it changes nothing and the process just sits there.
  const registry = new SessionRegistry()
  const session = new EngineSession(fake({ registry, claudeBin: '/bin/sleep', args: ['30'], stallMs: 200 }))
  const failed = new Promise<{ kind: string; message: string }>((resolve) => session.on('failure', resolve))
  session.start()
  session.finish()
  const f = await failed
  assert.equal(f.kind, 'stall')
  assert.match(f.message, /did not finish after its input was closed/)
  assert.equal(registry.size, 0)
})
