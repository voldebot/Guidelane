// @MAP
// types (30) | assertInitReceipt (120) | EngineSession (190)
//   .send (250) | .finish (270) | stall watchdog (300) | denial + hook checks (350)
// @END-MAP
//
// MAP: EngineSession — a live handle on one engine subprocess speaking
//      stream-json. REFS: env.ts (scrub), isolation.ts (ADR-008 pair),
//      surface.ts (render|ignore|escalate), registry.ts (group reaping).
// INVARIANTS (each one is a MEASUREMENT, not a preference — see the comment
// at its implementation):
//   - stdin stays OPEN for multi-turn; `result` is per-turn, not session-end.
//   - `finish()` closes stdin and keeps draining until the process 'close'.
//   - the stall watchdog does NOT run while WE are the reason the stream is quiet.
//   - a denied tool is detected on tool_result.is_error and nothing else.
//   - a hook that emits unparseable stdout is a FAILURE even though the engine
//     reports it as success.
//   - no work happens before the init receipt passes.

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { applyIsolation, assertIsolated } from './isolation.ts'
import { scrubbedEnv } from './env.ts'
import { classify, classifyInner, type Classification, type StreamClass } from './surface.ts'
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

export interface SessionOptions {
  claudeBin?: string
  args: readonly string[]
  cwd: string
  env?: Record<string, string>
  registry: SessionRegistry
  surface: Parameters<typeof classify>[0]
  expect?: InitExpectation
  /**
   * Inter-event silence that means "stuck". Measured baseline on a drained
   * stream: p50 207 ms, p95 385 ms, max 1,227 ms — so anything in the tens of
   * seconds is comfortably above normal jitter rather than a guess.
   */
  stallMs?: number
  /** Opt out of isolation. Only legitimate when inheritance is the subject. */
  ambient?: boolean
}

export interface Denial {
  toolUseId: string | null
  /** The engine's own error text for the denied call. */
  detail: string
}

export interface SessionFailure {
  kind: 'init-receipt' | 'stall' | 'hook-unparseable' | 'spawn'
  /** Plain language, for a non-coder, before any token is spent where possible. */
  message: string
  detail?: unknown
}

const cmpVersion = (a: string, b: string): number => {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
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
  const get = <T>(k: string): T | undefined => init[k] as T | undefined

  if (expect.model !== undefined && get<string>('model') !== expect.model) {
    problems.push(`model is ${JSON.stringify(get('model'))}, expected ${JSON.stringify(expect.model)}`)
  }
  if (expect.modelAlias !== undefined) {
    const reported = get<string>('model')
    // A missing field is a failure, not a pass. An expectation read off an
    // absent key is the fail-open shape this project has now found 23 times.
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
    const raw = get<string>('claude_code_version') ?? ''
    const version = /(\d+\.\d+\.\d+)/.exec(raw)?.[1]
    if (!version) problems.push(`could not read a version out of ${JSON.stringify(raw)}`)
    else {
      const [lo, hi] = expect.versionRange
      if (cmpVersion(version, lo) < 0 || cmpVersion(version, hi) > 0) {
        problems.push(`CLI ${version} is outside the tested range ${lo}–${hi}`)
      }
    }
  }
  return problems
}

type Events = {
  /** Every event, already classified. The cockpit renders on this. */
  event: [StreamEvent, Classification]
  /** A `result` — PER TURN, not the end of the session. */
  turn: [StreamEvent]
  /** A tool call the engine refused. Detected structurally. */
  denial: [Denial]
  /** Something a human has to be told about. */
  escalate: [StreamEvent, Classification]
  failure: [SessionFailure]
  /** The process is gone. Always the last event. */
  closed: [{ code: number | null; signal: NodeJS.Signals | null }]
}

export class EngineSession extends EventEmitter<Events> {
  #child: ChildProcessWithoutNullStreams | null = null
  #buf = ''
  #lastEventAt = Date.now()
  #stallTimer: NodeJS.Timeout | null = null
  #draining = true
  // Output is only EXPECTED between a send and its turn, and between finish()
  // and close. Outside those windows the engine is idle because nobody asked it
  // anything, and silence is correct rather than suspicious.
  #expectingOutput = false
  #finished = false
  #initSeen = false
  #closed = false
  readonly #opts: SessionOptions
  readonly #stallMs: number
  #pgid: number | null = null
  #scrubbed: string[] = []

  constructor(opts: SessionOptions) {
    super()
    this.#opts = opts
    this.#stallMs = opts.stallMs ?? 60_000
  }

  get argv(): string[] {
    return applyIsolation(this.#opts.args, { ambient: this.#opts.ambient ?? false })
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
      this.emit('failure', { kind: 'spawn', message: 'The engine could not be started.', detail: String(err) })
    })
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => this.#onChunk(chunk))
    child.on('close', (code, signal) => {
      this.#closed = true
      this.#stopWatchdog()
      if (this.#pgid !== null) this.#opts.registry.remove(this.#pgid)
      this.emit('closed', { code, signal })
    })
  }

  /** Write one user turn. Safe to call again after a `turn` event. */
  send(text: string): void {
    if (this.#finished) throw new Error('session already finished — stdin is closed')
    const line = JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } })
    this.#child?.stdin.write(`${line}\n`)
    this.#expectingOutput = true
    this.#lastEventAt = Date.now()
    this.#armWatchdog()
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
    if (this.#finished) return
    this.#finished = true
    this.#expectingOutput = true
    this.#lastEventAt = Date.now()
    this.#child?.stdin.end()
    // From here, silence means "did not exit after we closed stdin", which IS a
    // stall — unlike silence during normal work, which is usually just latency.
    this.#armWatchdog()
  }

  /** Reap the process group. Idempotent. */
  stop(): void {
    this.#stopWatchdog()
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
    } else {
      this.#stopWatchdog()
      this.#child?.stdout.pause()
    }
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
  #armWatchdog(): void {
    this.#stopWatchdog()
    if (!this.#expectingOutput || !this.#draining || this.#closed) return
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
        detail: { silentMs, finished },
      })
    }, 1_000)
    this.#stallTimer.unref?.()
  }

  #stopWatchdog(): void {
    if (this.#stallTimer) clearInterval(this.#stallTimer)
    this.#stallTimer = null
  }

  #onChunk(chunk: string): void {
    this.#lastEventAt = Date.now()
    this.#buf += chunk
    const lines = this.#buf.split('\n')
    this.#buf = lines.pop() ?? ''
    for (const line of lines) {
      const s = line.trim()
      if (s === '') continue
      if (s[0] !== '{') continue // non-JSON on stdout is not ours to render
      let event: StreamEvent
      try {
        event = JSON.parse(s) as StreamEvent
      } catch {
        continue
      }
      if (typeof event.type !== 'string') continue
      this.#handle(event)
    }
  }

  #handle(event: StreamEvent): void {
    if (event.type === 'system' && event.subtype === 'init' && !this.#initSeen) {
      this.#initSeen = true
      const problems = assertInitReceipt(event, this.#opts.expect ?? {})
      if (problems.length > 0) {
        this.emit('failure', {
          kind: 'init-receipt',
          message: 'This step did not start in the state it was supposed to, so it was stopped before doing any work.',
          detail: problems,
        })
      }
    }

    const cls = classify(this.#opts.surface, event)
    this.emit('event', event, cls)
    if (cls.class === 'escalate') this.emit('escalate', event, cls)

    if (event.type === 'stream_event') {
      for (const inner of classifyInner(this.#opts.surface, event)) {
        if (inner.class === 'escalate') this.emit('escalate', event, inner)
      }
    }

    if (event.type === 'user') this.#checkDenials(event)
    if (event.type === 'system' && event.subtype === 'hook_response') this.#checkHook(event)
    if (event.type === 'result') {
      // A turn is complete. Until the caller sends another one, or closes stdin,
      // the engine is idle on purpose and the watchdog must stand down.
      if (!this.#finished) {
        this.#expectingOutput = false
        this.#stopWatchdog()
      }
      this.emit('turn', event)
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
      this.emit('denial', {
        toolUseId: typeof b.tool_use_id === 'string' ? b.tool_use_id : null,
        detail: typeof b.content === 'string' ? b.content : JSON.stringify(b.content ?? null),
      })
    }
  }

  /**
   * Catch the hook failure the ENGINE calls a success.
   *
   * MEASURED (A7): a hook that exits non-zero reports `outcome: "error"`, and one
   * that outruns its timeout reports `outcome: "cancelled"` — both loud. But a
   * hook that emits an UNPARSEABLE payload and exits 0 is reported as
   * `exit_code: 0, outcome: "success"`, with the garbage sitting in `stdout`.
   * Its intended effect silently did not happen and no structural channel says
   * so.
   *
   * That is not an abstract concern here: ADR-006's language dial IS a
   * MessageDisplay hook. A truncated write or an encoding bug produces exactly
   * this shape, and a non-coder receives untranslated engineer-facing output
   * while every gate reports green. So the orchestrator validates hook stdout
   * itself, because the engine will not.
   */
  #checkHook(event: StreamEvent): void {
    const out = typeof event.stdout === 'string' ? event.stdout.trim() : ''
    if (out === '') return
    try {
      JSON.parse(out)
    } catch {
      this.emit('failure', {
        kind: 'hook-unparseable',
        message: 'A step of the process produced output that could not be read, so its effect did not happen.',
        detail: {
          hook: typeof event.hook_name === 'string' ? event.hook_name : null,
          // The engine's own verdict, recorded precisely because it disagrees.
          engineOutcome: event.outcome,
          engineExitCode: event.exit_code,
          bytes: out.length,
        },
      })
    }
  }
}

export type { Classification, StreamClass }
