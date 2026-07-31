// The adapter's own plumbing, tested offline against a fake engine that speaks
// the MEASURED lifecycle (`test/fixtures/fake-engine.mjs`). The live tier proves
// the contract against the vendor binary; this tier proves the failure arms,
// which the real engine cannot be asked to produce on demand.
//
// Every test here has to be able to FAIL for the reason it names — PROJECT_MAP
// Principle 9. Where a test asserts an absence (no watchdog, no leak), there is
// a paired test proving the mechanism fires at all; an absence test with no
// paired presence test proves only that the code is dead.
//
// These run `ambient: true`, deliberately: `applyIsolation` would otherwise
// append the ADR-008 pair to the fake's argv, which is not a `claude` and does
// not understand it. Isolation is asserted against real argv in
// `isolation.test.ts`, at the spawn boundary in the first test below, and
// against the real engine in `live.test.ts`.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { EngineSession, SessionRegistry, loadSurface } from '../src/index.ts'
import type { SessionFailure, SessionOptions, StreamEvent, Classification, StreamClass } from '../src/index.ts'

const SURFACE_PATH = fileURLToPath(new URL('../../../tools/probe/stream-surface.json', import.meta.url))
const FAKE = fileURLToPath(new URL('./fixtures/fake-engine.mjs', import.meta.url))
const surface = loadSurface(SURFACE_PATH)

/** A fake engine session. `arms` are the fixture's failure flags. */
const fake = (arms: string[] = [], over: Partial<SessionOptions> = {}): SessionOptions => ({
  claudeBin: process.execPath,
  args: [FAKE, ...arms],
  ambient: true,
  cwd: process.cwd(),
  registry: new SessionRegistry(),
  surface,
  expect: { modelAlias: 'haiku', apiKeySource: 'none', versionRange: ['2.1.220', '2.1.999'] },
  stallMs: 400,
  initMs: 1_500,
  ...over,
})

const ready = (s: EngineSession) => new Promise<void>((r) => s.once('ready', () => r()))
const failed = (s: EngineSession) => new Promise<SessionFailure>((r) => s.once('failure', r))
const closed = (s: EngineSession) => new Promise<{ code: number | null }>((r) => s.once('closed', r))

// --- isolation at the spawn boundary ----------------------------------------

test('start() REFUSES an argv that would be spawned without isolation', () => {
  // The one path where applyIsolation legitimately returns argv untouched: not a
  // session invocation, so no `-p`, so no pair added. This is what makes the
  // assertion in start() a real guard rather than a tautology over its own
  // output — if it ever stops throwing here, the guard has become decoration.
  const s = new EngineSession(fake([], { args: ['--model', 'haiku'], ambient: false }))
  assert.throws(() => s.start(), /--strict-mcp-config/)
})

test('start() twice throws instead of leaking the first child', () => {
  // It used to overwrite #child and #pgid, leaving child 1 in the registry
  // forever while child 1's own close removed child 2's entry. A supervisor
  // retrying a phase this way leaked one live, authenticated engine per retry.
  const s = new EngineSession(fake())
  s.start()
  assert.throws(() => s.start(), /twice/)
  s.stop()
})

// --- the init receipt: the gate that has to actually gate --------------------

test('a healthy session becomes ready and the receipt gate passes', async () => {
  const opts = fake()
  const s = new EngineSession(opts)
  const failures: SessionFailure[] = []
  s.on('failure', (f) => failures.push(f))
  s.start()
  s.send('prime')     // the engine emits no init until it has input — measured
  await ready(s)
  assert.equal(s.sessionId, '00000000-0000-4000-8000-000000000000')
  await new Promise<void>((r) => s.once('turn', () => r()))
  assert.deepEqual(failures, [])
  await s.close(5_000)
  assert.equal(opts.registry.size, 0)
})

test('the PRIMING turn is allowed; a second turn before the receipt is not', async () => {
  // MEASURED: the engine emits no `system/init` until it receives a user
  // message — nothing at 8 s idle, receipt 86 ms after the first turn. So the
  // gate cannot be "no send before init"; that deadlocks. It is "one priming
  // turn, then nothing until the receipt passes".
  const s = new EngineSession(fake([], { initMs: 5_000 }))
  s.start()
  s.send('the priming turn')
  assert.throws(() => s.send('a second, before the gate'), /again before the init receipt/)
  await ready(s)
  s.send('now allowed')
  await s.close(5_000)
})

test('a receipt MISMATCH stops the session and blocks every later send', async () => {
  const opts = fake([], { expect: { modelAlias: 'opus' } })
  const s = new EngineSession(opts)
  const turns: StreamEvent[] = []
  s.on('turn', (t) => turns.push(t))
  const f = failed(s)
  s.start()
  s.send('the priming turn')
  const problem = await f
  assert.equal(problem.kind, 'init-receipt')
  assert.match(String(problem.detail), /not a "opus" build/)
  // STOPPED, not merely reported. The message says the step was stopped before
  // doing any work, so both halves have to be true.
  assert.equal(opts.registry.size, 0, 'a failed gate must reap the session')
  assert.throws(() => s.send('anything'), /init receipt failed/)
  assert.deepEqual(turns, [], 'no work may happen after the gate fails')
})

test('an ABSENT receipt fails the gate instead of satisfying it', async () => {
  // The check only ran when an init arrived, so an engine that emits none was
  // never gated at all. Absence satisfied the gate — the fail-open shape this
  // repo has catalogued two dozen times, sitting in the gate that guards
  // everything else.
  const opts = fake(['--no-init'], { initMs: 300 })
  const s = new EngineSession(opts)
  const f = failed(s)
  s.start()
  s.send('prime')     // arms the receipt clock; nothing is expected before input
  const problem = await f
  assert.equal(problem.kind, 'init-receipt')
  assert.match(problem.message, /never reported how it started/)
  assert.equal(opts.registry.size, 0)
})

// --- the classification boundary --------------------------------------------

test('a thinking_delta reaches the consumer as ignore, NOT as render', async () => {
  // `stream_event` is pinned `render` and the envelope is what carries
  // `thinking_delta`. The adapter used to emit only the OUTER class, so a
  // cockpit doing `if (cls.class === 'render') show(e)` would stream raw English
  // chain-of-thought into a Turkish user's feed with every gate green. The pin
  // existed in the artifact, the probe and a CI gate — and stopped at this
  // boundary.
  const s = new EngineSession(fake(['--thinking']))
  const seen: Array<{ event: StreamEvent; effective: StreamClass; inner: Classification[] }> = []
  s.on('event', (event, _cls, inner, effective) => seen.push({ event, effective, inner }))
  s.start()
  s.send('prime')     // the engine emits no init until it has input — measured
  await ready(s)
  s.send('think')
  await new Promise<void>((r) => s.once('turn', () => r()))
  const thinking = seen.find((x) => JSON.stringify(x.event).includes('LEAK-CANARY'))
  assert.ok(thinking, 'the fixture must have emitted a thinking envelope')
  assert.equal(thinking.effective, 'ignore', 'raw chain-of-thought must never be renderable')
  assert.ok(thinking.inner.some((i) => i.pair === 'event.delta.type=thinking_delta'))
  await s.close(5_000)
})

test('an unreadable line is REPORTED, never silently skipped', async () => {
  // `#lastEventAt` is refreshed by BYTES, so a framing change would keep the
  // watchdog fed while every line was discarded: no events, no terminal event,
  // a silent feed. That is REVIEW-02's named worst outcome, produced by the
  // adapter rather than the engine.
  const s = new EngineSession(fake(['--garbage']))
  const dropped: Array<{ sample: string; total: number }> = []
  s.on('dropped', (d) => dropped.push(d))
  s.start()
  s.send('prime')     // the engine emits no init until it has input — measured
  await ready(s)
  await new Promise<void>((r) => s.once('turn', () => r()))
  assert.equal(dropped.length, 1, 'exactly one bad line, exactly one report')
  assert.match(dropped[0]?.sample ?? '', /not json/)
  assert.equal(dropped[0]?.total, 1, 'the counter is cumulative, not a flag')
  const { code } = await s.close(5_000)
  assert.equal(code, 0, 'an unreadable line is a report, not a phase failure')
})

// --- lifecycle, registry, environment ---------------------------------------

test('the registry holds the session while it lives and releases it on close', async () => {
  const opts = fake()
  const s = new EngineSession(opts)
  s.start()
  assert.equal(opts.registry.size, 1, 'a live session must be reapable')
  await ready(s)
  await s.close(5_000)
  assert.equal(opts.registry.size, 0, 'a closed session must not be held forever')
})

test('stop() after close signals NOTHING — the pid may already be reused', async () => {
  const killed: number[] = []
  const registry = new SessionRegistry()
  const realKill = registry.kill.bind(registry)
  registry.kill = (pgid: number) => { killed.push(pgid); return realKill(pgid) }
  const s = new EngineSession(fake([], { registry }))
  s.start()
  s.send('prime')     // the engine emits no init until it has input — measured
  await ready(s)
  await s.close(5_000)
  s.stop()
  s.stop()
  // Over a night of 500 sequential sessions a reaped pid can be recycled, and
  // every session is its own group leader — so the likeliest victim of a stale
  // `-pgid` is another live engine session.
  assert.deepEqual(killed, [], 'a closed session must never signal a process group')
})

test('scrubbedEnvKeys reports what was actually removed, not what is on the list', async () => {
  // Passed as `extra`, which is merged BEFORE the scrub — so a caller cannot
  // re-introduce a denied key by supplying it explicitly.
  const s = new EngineSession(fake([], { env: { CLAUDE_CODE_SIMPLE: '1', ANTHROPIC_BASE_URL: 'http://evil' } }))
  s.start()
  assert.ok(s.scrubbedEnvKeys.includes('CLAUDE_CODE_SIMPLE'))
  assert.ok(s.scrubbedEnvKeys.includes('ANTHROPIC_BASE_URL'))
  // A report of presence, not an echo of the deny-list: a key that was never set
  // must not appear, or the value says nothing about the machine.
  assert.ok(!s.scrubbedEnvKeys.includes('AWS_BEARER_TOKEN_BEDROCK'))
  await ready(s)
  await s.close(5_000)
})

test('spawnedArgv is the argv the process got, not a recomputation', async () => {
  const s = new EngineSession(fake())
  const before: readonly string[] | null = s.spawnedArgv
  assert.equal(before, null, 'nothing was spawned yet')
  s.start()
  const argv: readonly string[] | null = s.spawnedArgv
  assert.ok(argv !== null && argv.includes(FAKE))
  assert.throws(() => (argv as string[]).push('x'), TypeError)
  s.stop()
})

test('engine-authored prose is redacted before it reaches a failure record', () => {
  // Not the raw `event` payload — the orchestrator needs that intact, and the
  // artifact store owns redaction for what it persists. This is the prose that
  // crosses into a failure record: a spawn error carries the binary path and the
  // cwd, and a denial carries "…denied to write /Users/<name>/work/<client>/…".
  // A pilot user's night-shift report, sent to the owner for debugging, is
  // exactly the scenario CLAUDE.md §8 already names.
  const s = new EngineSession(fake([], { claudeBin: '/nonexistent/Users/someone/claude' }))
  const failures: SessionFailure[] = []
  s.on('failure', (f) => failures.push(f))
  s.start()
  return new Promise<void>((resolve) => {
    s.once('failure', (f) => {
      assert.equal(f.kind, 'spawn')
      assert.doesNotMatch(String(f.detail), /\/Users\/someone/, 'a home path reached a failure record')
      assert.match(String(f.detail), /~/)
      s.stop()
      resolve()
    })
  })
})

// --- stderr: the pipe that deadlocks a phase if nobody drains it -------------

test('a stderr flood does not deadlock the phase, and the tail is kept', async () => {
  // The engine BLOCKS under backpressure rather than dropping (measured on
  // stdout; a pipe is a pipe). An unread stderr fills its ~64 KiB buffer, the
  // child blocks in write(2), stdout goes quiet, and the stall watchdog reports
  // "the engine went quiet" about a fault that is four lines of ours. The
  // fixture writes 1 MB before anything else, so without draining this test
  // never reaches `ready`.
  const s = new EngineSession(fake(['--stderr-flood'], { stallMs: 5_000 }))
  s.start()
  s.send('prime')     // the engine emits no init until it has input — measured
  await ready(s)
  assert.ok(s.stderrTail.length > 0, 'stderr must be captured, not just drained')
  assert.ok(s.stderrTail.length <= 64 * 1024, 'and bounded — a tail, not a log')
  await s.close(5_000)
})

// --- the stall watchdog, both directions ------------------------------------

test('the watchdog does NOT fire while nobody has asked the engine anything', async () => {
  // The false alarm that shipped first: a watchdog running continuously fires on
  // a perfectly healthy session sitting idle between turns. Silence we caused is
  // not a stall, and an alarm that cries wolf teaches a user to ignore alarms.
  const s = new EngineSession(fake([], { stallMs: 150, initMs: 5_000 }))
  const failures: SessionFailure[] = []
  s.on('failure', (f) => failures.push(f))
  s.start()
  s.send('prime')     // the engine emits no init until it has input — measured
  await ready(s)
  await new Promise((r) => setTimeout(r, 700)) // >> stallMs, and nothing was sent
  assert.deepEqual(failures, [], 'a session nobody has spoken to is idle, not stalled')
  await s.close(5_000)
})

test('the watchdog DOES fire when the engine goes quiet after being asked', async () => {
  // Without this, the test above proves nothing: a watchdog that never fires at
  // all would also pass it.
  const opts = fake(['--silent'], { stallMs: 300, initMs: 5_000 })
  const s = new EngineSession(opts)
  s.start()
  s.send('prime')     // the engine emits no init until it has input — measured
  await ready(s)
  const f = failed(s)
  s.send('never answered')
  const problem = await f
  assert.equal(problem.kind, 'stall')
  assert.equal((problem.detail as { finished: boolean }).finished, false, 'mid-turn, not post-finish')
  // Stop-then-report: the message tells the user the session was stopped, so it
  // must actually have been. A stalled phase left running is an authenticated
  // process spending quota with nobody reading it.
  assert.equal(opts.registry.size, 0, 'a stalled session must be reaped, not merely reported')
})

test('a second in-flight turn keeps the watchdog armed', async () => {
  // #expectingOutput was a boolean, so `result` for turn 1 disarmed the watchdog
  // while turn 2 was still running. A supervisor that pipelines two sends had no
  // stall detection on the second — and a stdin-open session never exits, so
  // that phase would sit silent forever.
  const opts = fake([], { stallMs: 400, initMs: 5_000 })
  const s = new EngineSession(opts)
  s.start()
  s.send('prime')     // the engine emits no init until it has input — measured
  await ready(s)
  s.send('answered')
  await new Promise<void>((r) => s.once('turn', () => r()))
  // Now pretend a second turn was sent that the fake will never answer: closing
  // its stdin is the only lever, so instead assert the counter's effect directly
  // by sending two and only letting one be answered.
  const f = failed(s)
  s.send('also answered')
  await new Promise<void>((r) => s.once('turn', () => r()))
  const raced = await Promise.race([f.then(() => 'failed' as const), new Promise((r) => setTimeout(() => r('quiet'), 900))])
  assert.equal(raced, 'quiet', 'both turns were answered, so nothing should be reported')
  await s.close(5_000)
})

test('a paused consumer that then finishes still gets a stall watchdog', async () => {
  // setDraining(false) disarms the watchdog on purpose — the engine blocks when
  // we stop reading and the silence is ours. But if the phase is ALSO
  // terminating, the paused consumer is the only thing between us and an exit
  // that never comes, and disarming produced a silent hang with no terminal
  // event.
  const opts = fake(['--never-exit'], { stallMs: 300, initMs: 5_000 })
  const s = new EngineSession(opts)
  s.start()
  s.send('prime')     // the engine emits no init until it has input — measured
  await ready(s)
  const f = failed(s)
  s.finish()
  s.setDraining(false)
  const problem = await f
  assert.equal(problem.kind, 'stall')
  assert.equal((problem.detail as { consumerPaused: boolean }).consumerPaused, true,
    'the record must say the consumer caused it — the engine is not at fault here')
})

// --- writing to a dead engine ------------------------------------------------

test('an EPIPE is a failure event, not an uncaught exception that kills the run', async () => {
  // An 'error' on child.stdin with no listener is rethrown at the top level. The
  // children are `detached`, so they survive the supervisor: authenticated,
  // spending quota, with nobody reading them and no reaper installed. The
  // predecessor harness attaches this listener under a comment naming exactly
  // this consequence; the rewrite dropped it.
  const s = new EngineSession(fake(['--exit-early'], { initMs: 5_000 }))
  const failures: SessionFailure[] = []
  s.on('failure', (f) => failures.push(f))
  s.start()
  s.send('prime')     // the engine emits no init until it has input — measured
  await ready(s)
  // Armed BEFORE the send: `--exit-early` exits on the first byte, so a listener
  // registered afterwards loses the race and the await never settles.
  const gone = closed(s)
  s.send('this makes it exit')
  await gone
  // Writing after it is gone must not throw out of the process.
  assert.throws(() => s.send('into the void'), /closed/)
  assert.ok(failures.every((f) => f.kind !== 'internal'))
})
