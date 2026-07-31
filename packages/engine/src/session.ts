// @MAP
// types (34) | assertInitReceipt (168) | EngineSession (250)
//   .start (300) | .send (392) | .finish (420) | .close (440) | .stop (462)
//   .setDraining (480) | stall watchdog (512) | framing (556) | dispatch (620)
//   denial check (672) | hook check (706)
// @END-MAP
//
// MAP: EngineSession — a live handle on one engine subprocess speaking
//      stream-json. REFS: env.ts (scrub), isolation.ts (ADR-008 pair),
//      surface.ts (render|ignore|escalate), registry.ts (group reaping).
// INVARIANTS (each one is a MEASUREMENT or a review finding, not a preference —
// see the comment at its implementation):
//   - NO WORK happens before the init receipt passes: a mismatch, or no receipt
//     at all, STOPS the session. `send()` before `ready` throws.
//   - stdin stays OPEN for multi-turn; `result` is per-turn, not session-end.
//   - `finish()` closes stdin and keeps draining until the process 'close'.
//   - BOTH pipes are always drained. The engine BLOCKS under backpressure, so an
//     unread stderr deadlocks the phase (REVIEW-02 B8's exit criterion).
//   - the stall watchdog does NOT run while WE are the reason the stream is quiet.
//   - nothing is dropped silently — an unparseable line is an event, not a skip.
//   - a denied tool is detected on tool_result.is_error and nothing else.
//   - a hook the engine calls `success` can still have failed; the orchestrator
//     decides, not the engine.
//   - no stream 'error' may reach the top level: an unattended supervisor that
//     dies leaves DETACHED, authenticated children spending the user's quota.

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { applyIsolation, assertIsolated } from './isolation.ts'
import { scrubbedEnv } from './env.ts'
import {
  classify,
  classifyInner,
  effectiveClass,
  type Classification,
  type StreamClass,
  type SurfaceArtifact,
} from './surface.ts'
import type { SessionRegistry } from './registry.ts'

export interface StreamEvent {
  type: string
  subtype?: unknown
  [k: string]: unknown
}

export interface InitExpectation {
  /**
   * EXACT resolved model id, e.g. `claude-haiku-4-5-20251001`. Use this to pin a
   * specific model; it will fail the phase the day the vendor ships a new one,
   * which is a deliberate decision to re-pin rather than a bug.
   *
   * MEASURED 2026-07-31: `init.model` carries the RESOLVED ID, never the alias
   * that was passed on argv. `--model haiku` reports
   * `claude-haiku-4-5-20251001`. ADR-008 wrote this expectation as "`model` as
   * routed", and "as routed" is the trap: what you route with is an alias and
   * what comes back is an id, so the obvious equality check fails on every
   * healthy session. Found by this adapter's first live run.
   */
  model?: string
  /**
   * The ALIAS passed to `--model` (`haiku`, `sonnet`, `opus`), for the normal
   * case where the crew router asked for a family and not a specific build.
   *
   * Asserted as dash-delimited SEGMENT membership in the resolved id, not as a
   * substring: `claude-haiku-4-5-20251001`.split('-') must contain `haiku`.
   * Segment membership is used because a substring test is the weaker check that
   * happens to work here by luck, and this repo has already been bitten three
   * times by a guard that passes for the wrong reason. It can fire: routing
   * `opus` and being answered by haiku fails.
   */
  modelAlias?: string
  permissionMode?: string
  /** `none` means subscription auth. Asserted so a routed-away backend is caught. */
  apiKeySource?: string
  /** MCP servers that must be REGISTERED. Registration is not reachability. */
  mcpServers?: readonly string[]
  /** Inclusive CLI version range, e.g. ['2.1.220', '2.1.999']. */
  versionRange?: readonly [string, string]
}

/** What the engine reported about one hook invocation. */
export interface HookReport {
  hook: unknown
  outcome: unknown
  exitCode: unknown
  stdout: string
}

export interface SessionOptions {
  claudeBin?: string
  args: readonly string[]
  cwd: string
  env?: Record<string, string>
  registry: SessionRegistry
  surface: SurfaceArtifact
  /**
   * REQUIRED, deliberately. It was optional, and `assertInitReceipt(event, {})`
   * returns `[]` unconditionally — so forgetting this field produced a gate that
   * could not fire, on the gate ADR-008 puts in front of every phase. `{}` is
   * still legal but it now has to be typed out, which makes it a decision
   * somebody made rather than a default somebody inherited.
   */
  expect: InitExpectation
  /**
   * Inter-event silence that means "stuck". Measured baseline on a drained
   * stream: p50 207 ms, p95 385 ms, max 1,227 ms — so anything in the tens of
   * seconds is comfortably above normal jitter rather than a guess.
   */
  stallMs?: number
  /**
   * How long to wait for the init receipt AFTER the first turn is sent, before
   * failing the phase.
   *
   * Without this, an engine that emits no `system/init` at all is never gated:
   * the check only runs when an init arrives, so ABSENCE satisfies it. That is
   * the fail-open shape this repo has catalogued two dozen times, sitting in the
   * gate that guards everything else.
   *
   * Measured on 2.1.220: 86 ms from the first turn to the receipt, with nothing
   * emitted at all during 8 s of idle before it.
   */
  initMs?: number
  /**
   * Decide whether a hook actually did its job. Per-hook, because "empty stdout"
   * is normal for a logging hook and a silent product defect for the
   * MessageDisplay rewrite ADR-006's language dial runs on. Return a string to
   * fail the phase with it, or null to accept.
   */
  validateHook?: (report: HookReport) => string | null
  /** Opt out of isolation. Only legitimate when inheritance is the subject. */
  ambient?: boolean
}

export interface Denial {
  toolUseId: string | null
  /** The tool the engine refused, correlated from the prior `tool_use` block. */
  toolName: string | null
  /** The engine's own error text for the denied call. */
  detail: string
}

export interface SessionFailure {
  kind:
    | 'init-receipt'
    | 'stall'
    | 'hook'
    | 'spawn'
    /** A pipe to or from the engine errored. Would otherwise be an uncaught throw. */
    | 'io'
    /** The adapter itself threw while reading the engine. */
    | 'internal'
    /** The stream stopped being parseable, or one line exceeded the cap. */
    | 'framing'
  /** Plain language, for a non-coder, before any token is spent where possible. */
  message: string
  detail?: unknown
}

/** One JSON line the adapter could not use. Never silently discarded. */
export interface DroppedLine {
  bytes: number
  /** A short prefix, for diagnosing a framing change. */
  sample: string
  total: number
}

/**
 * The largest single stream line the adapter will assemble.
 *
 * Two reasons for a cap at all. V8's maximum string length is ~512 MiB, and
 * `#buf += chunk` past it throws `RangeError` inside a stream callback — i.e. an
 * uncaught exception that kills an unattended supervisor while leaving detached
 * children alive. And long before that, assembling a hundred-megabyte line pins
 * the event loop, so the watchdog cannot fire and the cockpit cannot repaint.
 * 32 MiB is far above any observed event and far below either cliff.
 */
const MAX_LINE_BYTES = 32 * 1024 * 1024

/** How much stderr to keep. A ring, not a log — this must never be the leak. */
const STDERR_KEEP_BYTES = 64 * 1024

/**
 * Scrub prose that crosses this boundary into a failure record.
 *
 * Applied to engine-authored TEXT only — spawn errors and the engine's own
 * denial messages, both of which routinely carry absolute paths
 * (`permission denied to write /Users/<name>/work/<client>/…`). Deliberately NOT
 * applied to the raw `event` payload: the orchestrator needs it intact, so the
 * artifact store owns redaction for anything it persists, exactly as
 * `tools/probe/lib/redact.mjs` does at serialization.
 *
 * The boundary is placed here rather than at the sinks because the sinks — the
 * morning report, the night-shift artifact store — do not exist yet, and a
 * boundary added after five consumers exist is a boundary that leaks around
 * three of them. That is the same lesson `redact.mjs` was written from, after a
 * committed public artifact published the owner's home path and username.
 */
const redactText = (s: string): string =>
  s
    .replace(/\/(?:Users|home)\/[^/\s"':]+/gi, '~')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<uuid>')

const parseVersion = (s: string): number[] | null => {
  const parts = s.split('.').map(Number)
  return parts.length > 0 && parts.every((n) => Number.isInteger(n) && n >= 0) ? parts : null
}

const cmpVersion = (a: readonly number[], b: readonly number[]): number => {
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const d = (a[i] ?? 0) - (b[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

/**
 * Assert the session's first `system/init` event before any work is allowed.
 *
 * ADR-008 makes this a GATE, not telemetry. The `-p` help states that settings
 * failing validation are *silently ignored*, so without a positive receipt the
 * entire hook layer — which is what ADR-006's language dial runs on — can vanish
 * with no signal at all. A mismatch has to fail the phase in plain language
 * before tokens are spent.
 *
 * Note what is asserted and what is not: MCP servers are checked for
 * REGISTRATION, never for `status === 'connected'`. That field races the init
 * emit — identical runs read `pending` then `connected`, with no later event
 * correcting it — so the stricter-sounding gate is the flakier one.
 * Connectivity is proven by calling a cheap tool, which is the caller's job.
 */
export function assertInitReceipt(init: StreamEvent, expect: InitExpectation = {}): string[] {
  const problems: string[] = []
  // This function is exported, so it can be handed the wrong event. Reporting
  // "model is undefined" about a `result` frame would be a confident answer to a
  // question nobody asked.
  if (init.type !== 'system' || init.subtype !== 'init') {
    return [`expected a system/init event, got ${JSON.stringify(`${init.type}/${String(init.subtype)}`)}`]
  }
  const get = <T>(k: string): T | undefined => init[k] as T | undefined

  if (expect.model !== undefined && get<string>('model') !== expect.model) {
    problems.push(`model is ${JSON.stringify(get('model'))}, expected ${JSON.stringify(expect.model)}`)
  }
  if (expect.modelAlias !== undefined) {
    const reported = get<string>('model')
    // A missing field is a failure, not a pass. An expectation read off an
    // absent key is the fail-open shape this project has now found 24 times.
    if (typeof reported !== 'string' || !reported.split('-').includes(expect.modelAlias)) {
      problems.push(
        `model is ${JSON.stringify(reported)}, which is not a ${JSON.stringify(expect.modelAlias)} build`
      )
    }
  }
  if (expect.permissionMode !== undefined && get<string>('permissionMode') !== expect.permissionMode) {
    problems.push(`permissionMode is ${JSON.stringify(get('permissionMode'))}, expected ${JSON.stringify(expect.permissionMode)}`)
  }
  if (expect.apiKeySource !== undefined && get<string>('apiKeySource') !== expect.apiKeySource) {
    // The discriminator that tells subscription auth from an API key, and the
    // one that catches a session answered by a different backend entirely.
    problems.push(`apiKeySource is ${JSON.stringify(get('apiKeySource'))}, expected ${JSON.stringify(expect.apiKeySource)}`)
  }
  if (expect.mcpServers && expect.mcpServers.length > 0) {
    const registered = new Set(
      (get<Array<{ name?: string }>>('mcp_servers') ?? []).map((s) => s?.name).filter((n): n is string => typeof n === 'string')
    )
    for (const want of expect.mcpServers) {
      if (!registered.has(want)) problems.push(`MCP server ${JSON.stringify(want)} is not registered on this session`)
    }
  }
  if (expect.versionRange) {
    const [lo, hi] = expect.versionRange
    const loP = parseVersion(lo)
    const hiP = parseVersion(hi)
    if (!loP || !hiP) {
      // A range that cannot be parsed must FAIL the gate, not disable it. The
      // arithmetic form silently returned NaN, and `NaN < 0` and `NaN > 0` are
      // both false — so one typo in a range turned the version check off with no
      // signal anywhere.
      problems.push(`version range ${JSON.stringify([lo, hi])} is not comparable`)
    } else {
      const raw = get<string>('claude_code_version') ?? ''
      const version = /(\d+\.\d+\.\d+)/.exec(raw)?.[1]
      const vP = version ? parseVersion(version) : null
      if (!vP) problems.push(`could not read a version out of ${JSON.stringify(raw)}`)
      else if (cmpVersion(vP, loP) < 0 || cmpVersion(vP, hiP) > 0) {
        problems.push(`CLI ${version} is outside the tested range ${lo}–${hi}`)
      }
    }
  }
  return problems
}

type Events = {
  /**
   * Every event, classified. `effective` is what a renderer must obey — the
   * outer class alone would hand raw chain-of-thought to the feed classed
   * `render`, because the `stream_event` envelope is pinned `render` and the
   * envelope is what carries `thinking_delta`.
   */
  event: [StreamEvent, Classification, Classification[], StreamClass]
  /** The init receipt PASSED. Nothing may be sent before this. */
  ready: [StreamEvent]
  /** A `result` — PER TURN, not the end of the session. */
  turn: [StreamEvent]
  /** A tool call the engine refused. Detected structurally. */
  denial: [Denial]
  /** Something a human has to be told about. */
  escalate: [StreamEvent, Classification]
  /** A line that could not be used. Emitted so a framing change is visible. */
  dropped: [DroppedLine]
  /** Raw engine stderr. Drained whether or not anyone listens. */
  stderr: [string]
  failure: [SessionFailure]
  /** The process is gone. Always the last event. */
  closed: [{ code: number | null; signal: NodeJS.Signals | null; pendingBytes: number; dropped: number }]
}

export class EngineSession extends EventEmitter<Events> {
  #child: ChildProcessWithoutNullStreams | null = null
  #buf = ''
  #stderrTail = ''
  #dropped = 0
  #lastEventAt = Date.now()
  #stallTimer: NodeJS.Timeout | null = null
  #initTimer: NodeJS.Timeout | null = null
  #draining = true
  /**
   * How many turns have been sent and not yet answered.
   *
   * A boolean here meant that `result` for turn 1 disarmed the watchdog while
   * turn 2 was still in flight — so a supervisor that pipelines two sends (the
   * invariants push and the task, to save a round trip) had no stall detection
   * on the second one. And a `-p` session with stdin open never exits, so that
   * phase would sit silent forever.
   */
  #pendingTurns = 0
  /** Turns written, ever. Distinguishes the priming turn from every later one. */
  #sent = 0
  #expectingOutput = false
  #started = false
  #finished = false
  #initSeen = false
  #gateFailed = false
  #closed = false
  #sessionId: string | null = null
  #spawnedArgv: readonly string[] | null = null
  /** tool_use_id → tool name, so a denial can say WHAT was refused. */
  readonly #toolNames = new Map<string, string>()
  readonly #opts: SessionOptions
  readonly #stallMs: number
  readonly #initMs: number
  #pgid: number | null = null
  #scrubbed: string[] = []

  constructor(opts: SessionOptions) {
    super()
    this.#opts = opts
    this.#stallMs = opts.stallMs ?? 60_000
    this.#initMs = opts.initMs ?? 30_000
  }

  get argv(): string[] {
    return applyIsolation(this.#opts.args, { ambient: this.#opts.ambient ?? false })
  }

  /**
   * Exactly the argv `spawn` received — frozen at spawn time, not recomputed.
   *
   * `argv` re-runs `applyIsolation` on every access, so asserting isolation
   * against it proves a fresh computation is isolated and says nothing about the
   * process that is running. This is the same "assert on the args the harness
   * actually passed" rule `p-backpressure-lossless` follows.
   */
  get spawnedArgv(): readonly string[] | null {
    return this.#spawnedArgv
  }

  /** The engine's session id, from the init receipt. Null until it arrives. */
  get sessionId(): string | null {
    return this.#sessionId
  }

  /** The last 64 KiB the engine wrote to stderr. Belongs in any failure record. */
  get stderrTail(): string {
    return this.#stderrTail
  }

  /**
   * Which denied environment variables were actually present and removed.
   *
   * Exposed because `scrubbedEnv` returns it and the only call site was throwing
   * it away — a value nothing reads is the same decoration as a counter nothing
   * compares against. A non-empty list is not a failure (the scrub worked) but it
   * IS a fact about the machine: `ANTHROPIC_BASE_URL` here means the operator's
   * shell is routed at another backend, and `CLAUDECODE` means Guidelane is
   * running inside a Claude Code session. Both belong in a run's record.
   */
  get scrubbedEnvKeys(): readonly string[] {
    return this.#scrubbed
  }

  start(): void {
    // A second start() spawned a second child, overwrote #pgid, and left the
    // first pgid in the registry forever while the first child's own 'close'
    // removed the SECOND one. A supervisor retrying a phase this way leaked one
    // live, authenticated engine per retry.
    if (this.#started) throw new Error('start() called twice — construct a new EngineSession per phase')
    this.#started = true

    const ambient = this.#opts.ambient ?? false
    const args = this.argv
    // WHAT THIS CAN AND CANNOT CATCH — stated precisely, because the first
    // version of this comment claimed a boundary that does not exist here.
    //
    // It canNOT catch a bug in `applyIsolation`: that function either returns
    // isolated argv or throws, so asserting over its output one line later is
    // the same tautology this codebase shipped once already.
    //
    // It CAN fire, on the one path where `applyIsolation` legitimately returns
    // argv untouched: an argv that is not a session invocation (no `-p`, no
    // `--print`). That argv would otherwise reach `spawn` with no isolation at
    // all. This class only ever means to run stream-json sessions, so that is a
    // caller error and it throws rather than launching an un-isolated session.
    // `test/session.test.ts` proves it fires.
    //
    // A post-spawn read-back of `child.spawnargs` was written here and then
    // REMOVED: Node passes `[bin, ...args]` verbatim, so it could not fail
    // either — and adding a second guard that cannot fire, in the same sprint
    // that documented instance 24 of exactly that shape, would have made 25 by
    // my own hand.
    if (!ambient) assertIsolated(args)
    this.#spawnedArgv = Object.freeze([...args])

    const { env, removed } = scrubbedEnv(this.#opts.env ?? {})
    this.#scrubbed = removed
    const child = spawn(this.#opts.claudeBin ?? 'claude', args, {
      cwd: this.#opts.cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      // Own process group, so the registry can reap grandchildren. Killing the
      // direct pid alone leaves authenticated processes spending quota.
      detached: true,
    })
    this.#child = child
    if (child.pid) {
      this.#pgid = child.pid
      this.#opts.registry.add(child.pid)
    }

    child.on('error', (err) => {
      // A child that never launched is not a finding about the engine.
      // Node's ENOENT/EACCES text carries the binary path and the cwd.
      this.emit('failure', { kind: 'spawn', message: 'The engine could not be started.', detail: redactText(String(err)) })
    })

    // An unhandled 'error' on any of these three streams throws out of a stream
    // callback and takes an unattended supervisor with it — while the children,
    // being `detached`, survive: authenticated, spending quota, with nobody
    // reading them and no `killAll()` ever running. `EPIPE` from writing to a
    // child that already exited is the everyday way to reach it.
    const onStreamError = (where: 'stdin' | 'stdout' | 'stderr') => (err: Error) => {
      this.emit('failure', {
        kind: 'io',
        message: 'The connection to the engine broke.',
        detail: { where, error: String(err) },
      })
    }
    child.stdin.on('error', onStreamError('stdin'))
    child.stdout.on('error', onStreamError('stdout'))
    child.stderr.on('error', onStreamError('stderr'))

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => this.#onChunk(chunk))

    // BOTH PIPES MUST BE DRAINED — REVIEW-02 B8 named this as an exit criterion
    // and it was missed. stderr is a pipe with a ~64 KiB kernel buffer, the
    // engine BLOCKS under backpressure rather than dropping (measured on
    // stdout; a pipe is a pipe), and Node only resumes unread stdio when the
    // child EXITS. A process blocked writing stderr never exits, so the rescue
    // never runs: the phase deadlocks, stdout goes quiet, and the stall watchdog
    // reports "the engine went quiet" about a fault that is four lines of ours.
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      this.#stderrTail = (this.#stderrTail + chunk).slice(-STDERR_KEEP_BYTES)
      this.emit('stderr', chunk)
    })

    // A consumer that paused before start() would otherwise be flooded: the
    // 'data' listener above puts stdout into flowing mode regardless.
    if (!this.#draining) child.stdout.pause()

    child.on('close', (code, signal) => {
      this.#closed = true
      this.#stopWatchdog()
      this.#clearInitTimer()
      if (this.#pgid !== null) {
        this.#opts.registry.remove(this.#pgid)
        // Null it, or a later stop() signals a pid the OS is free to have
        // reused. Over 500 sequential sessions in one night that is not exotic,
        // and the victim would be an unrelated process of the user's, killed
        // with no log line anywhere.
        this.#pgid = null
      }
      this.emit('closed', { code, signal, pendingBytes: this.#buf.length, dropped: this.#dropped })
    })

  }

  /**
   * THE GATE'S MISSING HALF.
   *
   * The receipt check only ran when an init arrived, so an engine that emits
   * none was never gated at all — absence satisfied the gate, which is the
   * fail-open shape this repo has catalogued two dozen times, sitting in the
   * gate that guards everything else.
   *
   * Armed from the first `send()` rather than from `start()`, because the engine
   * emits no init until it has input (measured: nothing at 8 s idle, init 86 ms
   * after the first turn). Arming at start would fail every session that was
   * constructed early and used later.
   */
  #armInitTimer(): void {
    if (this.#initTimer || this.#initSeen) return
    this.#initTimer = setTimeout(() => {
      if (this.#initSeen || this.#closed) return
      this.#failGate('The engine never reported how it started up, so this step was stopped before doing any work.', {
        waitedMs: this.#initMs,
      })
    }, this.#initMs)
    this.#initTimer.unref?.()
  }

  /**
   * Write one user turn.
   *
   * Throws rather than failing quietly. The optional-chaining form turned "you
   * called this in the wrong order" into "your phase mysteriously stalled 60
   * seconds later": a `send()` before `start()` vanished, armed the watchdog,
   * and produced `kind: 'stall'` — *"the engine went quiet"* — about an engine
   * that had never been spawned.
   */
  send(text: string): void {
    if (!this.#child) throw new Error('send() before start()')
    if (this.#gateFailed) throw new Error('the init receipt failed — this session may not be used')
    if (this.#closed) throw new Error('send() after the session closed')
    if (this.#finished) throw new Error('session already finished — stdin is closed')
    // THE PRIMING TURN. Exactly one send is allowed before the receipt, because
    // MEASURED 2026-07-31: the engine emits NO `system/init` until it receives a
    // user message. A session left idle for 8 s produced nothing; the receipt
    // arrived 86 ms after the first turn was written. So "await ready, then
    // send" deadlocks, and this gate cannot be "no send before init".
    //
    // What it IS: no *second* turn, no tool result, and no accepted output
    // before the receipt passes. On a mismatch the session is killed within
    // milliseconds of init, which is before the model's answer exists — but the
    // prompt has been submitted, so ADR-008's phrase "before tokens are spent"
    // is not literally achievable in `-p` stream-json and now says so.
    if (!this.#initSeen && this.#sent > 0) {
      throw new Error('send() again before the init receipt — await the `ready` event')
    }
    const line = JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } })
    this.#child.stdin.write(`${line}\n`)
    this.#sent += 1
    this.#pendingTurns += 1
    this.#expectingOutput = true
    this.#lastEventAt = Date.now()
    this.#armWatchdog()
    // The receipt clock starts HERE, not at start(): there is nothing to wait
    // for until the engine has been given something to initialise for.
    this.#armInitTimer()
  }

  /**
   * End the phase.
   *
   * MEASURED: closing stdin is the terminator. The process exits ~530 ms later,
   * and waiting 10 s before closing gives the same latency — so it is the close
   * that ends the session, not any elapsed-time rule. With stdin left open the
   * session sits alive indefinitely (still running at 75 s), which is why an
   * adapter that waits for process exit after `result` hangs forever.
   *
   * The stream is deliberately NOT torn down here: output keeps arriving after
   * the close (6,243 bytes in the measurement), so a closer that stops reading
   * truncates the phase — possibly losing the assistant text or the terminal
   * result itself.
   */
  finish(): void {
    if (!this.#child) throw new Error('finish() before start()')
    if (this.#finished) return
    this.#finished = true
    this.#expectingOutput = true
    this.#lastEventAt = Date.now()
    this.#child.stdin.end()
    // From here, silence means "did not exit after we closed stdin", which IS a
    // stall — unlike silence during normal work, which is usually just latency.
    this.#armWatchdog()
  }

  /**
   * The whole measured termination sequence, awaitable.
   *
   * `finish()` → drain → the process `close` event, with the lifecycle rules
   * baked in rather than re-derived by every caller. Two hand-rolled
   * `Promise.race([closed, timeout])` blocks in one test file were the API
   * saying this was missing.
   */
  close(timeoutMs = 30_000): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
    return new Promise((resolve, reject) => {
      if (this.#closed) {
        resolve({ code: null, signal: null })
        return
      }
      const timer = setTimeout(() => {
        this.stop()
        reject(new Error(`the engine did not exit within ${timeoutMs}ms of its input being closed`))
      }, timeoutMs)
      this.once('closed', ({ code, signal }) => {
        clearTimeout(timer)
        resolve({ code, signal })
      })
      this.finish()
    })
  }

  /** Reap the process group. Idempotent, and a no-op once the process is gone. */
  stop(): void {
    this.#stopWatchdog()
    this.#clearInitTimer()
    // After 'close' the pid is gone and the OS may already have handed it to
    // someone else. Signalling it then is not defensive, it is dangerous.
    if (this.#closed) return
    if (this.#pgid !== null) this.#opts.registry.kill(this.#pgid)
    this.#child?.kill('SIGKILL')
  }

  /**
   * Tell the session we have stopped reading (a paused renderer, a blocked
   * write), and tell it when we start again.
   *
   * MEASURED: the engine BLOCKS under backpressure rather than dropping — a
   * 55 s pause produced a ~100 KB burst on resume against a 64 KB pipe, with
   * every line intact. So a slow consumer loses nothing, but it does stall the
   * engine, and the stream goes legitimately quiet. The watchdog must not fire
   * then: we are the cause, and we are the only one who knows it.
   */
  setDraining(draining: boolean): void {
    this.#draining = draining
    if (draining) {
      this.#lastEventAt = Date.now()
      this.#child?.stdout.resume()
      this.#armWatchdog()
      return
    }
    this.#child?.stdout.pause()
    // ONE exception to "a paused consumer disables the watchdog": if the phase
    // is already terminating, the paused consumer is the only thing between us
    // and an exit that will never come. Disarming here produced a silent hang
    // with no terminal event — the outcome REVIEW-02 calls the worst available.
    if (this.#finished) this.#armWatchdog({ force: true })
    else this.#stopWatchdog()
  }

  /**
   * Arm the stall watchdog — but only while output is actually EXPECTED.
   *
   * The first version of this ran continuously and fired on a perfectly healthy
   * session that had finished its turn and was waiting for the caller to send
   * the next one. Between turns, silence is the correct state: the engine is
   * idle because nobody has asked it anything. A watchdog that cannot tell
   * "stuck" from "waiting for us" produces exactly the false alarm that teaches
   * a user to ignore alarms.
   *
   * Two other times silence is ours and not the engine's, both handled: while
   * `setDraining(false)` holds the stream (the engine BLOCKS under backpressure
   * rather than dropping — measured), and before the first `send()`.
   */
  #armWatchdog({ force = false }: { force?: boolean } = {}): void {
    this.#stopWatchdog()
    if (this.#closed) return
    if (!force && (!this.#expectingOutput || !this.#draining)) return
    const consumerPaused = !this.#draining
    this.#stallTimer = setInterval(() => {
      if (Date.now() - this.#lastEventAt < this.#stallMs) return
      this.#stopWatchdog()
      const silentMs = Date.now() - this.#lastEventAt
      const finished = this.#finished
      // Stop FIRST, then report. The message says the session is being stopped,
      // so the code has to actually stop it: prose that promises an action the
      // code does not take is the same defect class as a guard that cannot fire.
      // A stalled phase left running is an authenticated process spending quota
      // with nobody reading it.
      this.stop()
      this.emit('failure', {
        kind: 'stall',
        message: finished
          ? 'The engine did not finish after its input was closed, so it was stopped.'
          : 'The engine went quiet for longer than expected, so it was stopped.',
        // `consumerPaused` is recorded because it changes who is at fault: the
        // engine blocks when we stop reading, so a stall under a paused consumer
        // is ours and must not be reported as the vendor's.
        detail: { silentMs, finished, consumerPaused, stderrTail: this.#stderrTail.slice(-2_000) },
      })
    }, 1_000)
    this.#stallTimer.unref?.()
  }

  #stopWatchdog(): void {
    if (this.#stallTimer) clearInterval(this.#stallTimer)
    this.#stallTimer = null
  }

  #clearInitTimer(): void {
    if (this.#initTimer) clearTimeout(this.#initTimer)
    this.#initTimer = null
  }

  #failGate(message: string, detail: unknown): void {
    this.#gateFailed = true
    this.#clearInitTimer()
    // Stop, then report — the same order the stall watchdog obeys, and for the
    // same reason: this message tells the user the step was stopped before doing
    // any work, so it has to be true.
    this.stop()
    this.emit('failure', { kind: 'init-receipt', message, detail })
  }

  #onChunk(chunk: string): void {
    // A throw from here — a RangeError assembling a huge line, or a cockpit
    // listener that threw inside emit() — is an uncaught exception in a stream
    // callback. It kills an unattended supervisor and leaves detached,
    // authenticated children running. Deviating from EventEmitter's usual
    // let-it-throw contract is a deliberate trade for an unattended process.
    try {
      this.#onChunkInner(chunk)
    } catch (err) {
      this.stop()
      this.emit('failure', {
        kind: 'internal',
        message: 'Something went wrong while reading the engine, so the step was stopped.',
        detail: String(err),
      })
    }
  }

  #onChunkInner(chunk: string): void {
    this.#lastEventAt = Date.now()
    // `#buf` is newline-free by construction, so a newly arrived newline can
    // only be at or after the old length. Searching from there is what removes
    // the O(n²): the previous form re-split the ENTIRE accumulated buffer on
    // every chunk, so one large line delivered in 64 KiB pieces rescanned tens
    // of gigabytes with the event loop blocked throughout.
    const searchFrom = this.#buf.length
    this.#buf += chunk
    let lineStart = 0
    let nl = this.#buf.indexOf('\n', searchFrom)
    while (nl !== -1) {
      this.#onLine(this.#buf.slice(lineStart, nl))
      lineStart = nl + 1
      nl = this.#buf.indexOf('\n', lineStart)
    }
    if (lineStart > 0) this.#buf = this.#buf.slice(lineStart)
    if (this.#buf.length > MAX_LINE_BYTES) {
      const bytes = this.#buf.length
      this.#buf = ''
      this.stop()
      this.emit('failure', {
        kind: 'framing',
        message: 'The engine sent one message too large to read, so the step was stopped.',
        detail: { bytes, limit: MAX_LINE_BYTES },
      })
    }
  }

  #onLine(line: string): void {
    const s = line.trim()
    if (s === '') return
    let event: StreamEvent | null = null
    try {
      const parsed: unknown = JSON.parse(s)
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
        && typeof (parsed as StreamEvent).type === 'string') {
        event = parsed as StreamEvent
      }
    } catch {
      /* falls through to the drop path */
    }
    if (event === null) {
      // NOTHING IS DROPPED SILENTLY. surface.ts states that invariant and this
      // layer was violating it one level below: three silent `continue`s with no
      // counter and no event. It matters more here than anywhere, because
      // `#lastEventAt` is refreshed by BYTES — so if a CLI upgrade changed the
      // framing, every line would be discarded, the watchdog would stay fed, no
      // event would ever be emitted, and the phase would hang with a silent feed
      // and no terminal event. That is REVIEW-02's named worst case, produced by
      // this file rather than by the engine.
      this.#dropped += 1
      this.emit('dropped', { bytes: s.length, sample: s.slice(0, 200), total: this.#dropped })
      return
    }
    this.#handle(event)
  }

  #handle(event: StreamEvent): void {
    if (event.type === 'system' && event.subtype === 'init' && !this.#initSeen) {
      this.#initSeen = true
      this.#clearInitTimer()
      if (typeof event.session_id === 'string') this.#sessionId = event.session_id
      const problems = assertInitReceipt(event, this.#opts.expect)
      if (problems.length > 0) {
        this.#failGate(
          'This step did not start in the state it was supposed to, so it was stopped before doing any work.',
          problems
        )
        return
      }
      this.emit('ready', event)
    }
    // A gate that emitted and then let the phase run was the gate failing to
    // gate. Once it has failed, nothing further from this session is delivered.
    if (this.#gateFailed) return

    const cls = classify(this.#opts.surface, event)
    const inner = event.type === 'stream_event' ? classifyInner(this.#opts.surface, event) : []
    this.emit('event', event, cls, inner, effectiveClass(cls, inner))
    if (cls.class === 'escalate') this.emit('escalate', event, cls)
    for (const i of inner) if (i.class === 'escalate') this.emit('escalate', event, i)

    if (event.type === 'assistant') this.#rememberToolNames(event)
    if (event.type === 'user') this.#checkDenials(event)
    if (event.type === 'system' && event.subtype === 'hook_response') this.#checkHook(event)
    if (event.type === 'result') {
      // A turn is complete. Until the caller sends another one, or closes stdin,
      // the engine is idle on purpose and the watchdog must stand down — but
      // only once EVERY in-flight turn has been answered.
      if (!this.#finished) {
        this.#pendingTurns = Math.max(0, this.#pendingTurns - 1)
        if (this.#pendingTurns === 0) {
          this.#expectingOutput = false
          this.#stopWatchdog()
        }
      }
      this.emit('turn', event)
    }
  }

  /** Correlate tool_use ids to names, so a denial can say what was refused. */
  #rememberToolNames(event: StreamEvent): void {
    const msg = event.message as { content?: unknown } | undefined
    const content = Array.isArray(msg?.content) ? msg.content : []
    for (const block of content) {
      const b = block as { type?: unknown; id?: unknown; name?: unknown }
      if (b?.type === 'tool_use' && typeof b.id === 'string' && typeof b.name === 'string') {
        this.#toolNames.set(b.id, b.name)
      }
    }
  }

  /**
   * Detect a refused tool call.
   *
   * MEASURED (A3a/A3b): the structural channel is `tool_result.is_error`, and it
   * survives backpressure intact. The `permission_denied` advisory frame does
   * NOT — the binary logs `dropping oldest permission_denied advisory frames` —
   * so no code may treat its presence, or its absence, as evidence.
   */
  #checkDenials(event: StreamEvent): void {
    const msg = event.message as { content?: unknown } | undefined
    const content = Array.isArray(msg?.content) ? msg.content : []
    for (const block of content) {
      const b = block as { type?: unknown; is_error?: unknown; tool_use_id?: unknown; content?: unknown }
      if (b?.type !== 'tool_result' || b.is_error !== true) continue
      const id = typeof b.tool_use_id === 'string' ? b.tool_use_id : null
      this.emit('denial', {
        toolUseId: id,
        // Without this the cockpit cannot say "Guidelane tried to write a file
        // and was not allowed" without rebuilding the same id→name map itself.
        toolName: id ? this.#toolNames.get(id) ?? null : null,
        // The engine's own error text — routinely "…denied to write /Users/…".
        detail: redactText(typeof b.content === 'string' ? b.content : JSON.stringify(b.content ?? null)),
      })
    }
  }

  /**
   * Catch the hook failure the ENGINE calls a success — and surface the ones it
   * calls loud, which no other channel on this API carries.
   *
   * MEASURED (A7): a hook that exits non-zero reports `outcome: "error"`, and one
   * that outruns its timeout reports `outcome: "cancelled"` — distinct, so a
   * timeout is retryable and a bug is not. But a hook that emits an UNPARSEABLE
   * payload and exits 0 is reported as `exit_code: 0, outcome: "success"`, with
   * the garbage sitting in `stdout`. Its intended effect silently did not happen
   * and no structural channel says so.
   *
   * That is not an abstract concern: ADR-006's language dial IS a MessageDisplay
   * hook. A truncated write or an encoding bug produces exactly this shape, and
   * a non-coder receives untranslated engineer-facing output while every gate
   * reports green.
   *
   * WHY THERE IS A CALLBACK. The previous form did `JSON.parse` and returned
   * early on empty stdout — so it (a) exempted the commonest form of a truncated
   * write, zero bytes, and (b) called parseability "validation", accepting
   * `null`, `123`, `[]` and `{"wrong":"shape"}`. Whether either is a failure
   * depends on the hook: a logging hook emits nothing normally; the dial
   * emitting nothing is a product defect. Only the caller knows which hook this
   * is, so only the caller can decide.
   */
  #checkHook(event: StreamEvent): void {
    const report: HookReport = {
      hook: event.hook_name,
      outcome: event.outcome,
      exitCode: event.exit_code,
      stdout: typeof event.stdout === 'string' ? event.stdout : '',
    }
    // `system/hook_response` is classified `ignore` in the surface artifact, so
    // the engine's own loud verdicts reach no consumer at all unless this method
    // forwards them. "Loud on the wire" is not the same as "loud in the API".
    const problem =
      report.outcome !== 'success'
        ? `the engine reported outcome ${JSON.stringify(report.outcome)} (exit ${String(report.exitCode)})`
        : this.#opts.validateHook?.(report) ?? null
    if (problem === null) return
    this.emit('failure', {
      kind: 'hook',
      message: 'A step of the process did not do what it was supposed to.',
      detail: { ...report, stdout: report.stdout.slice(0, 500), problem },
    })
  }
}

export type { Classification, StreamClass, SurfaceArtifact }
