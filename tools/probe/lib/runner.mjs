// @MAP
// parseArgs (48) | scrubbedChildEnv (120) | spawnCapture (163) | killAllChildren (150)
// makeContext (283) | runSuite (392) | renderMarkdown (500) | STATUS (30) | OUTCOME (39)
// @END-MAP
//
// MAP: Execution engine for the Guidelane S0 engine-conformance probe.
// REFS: consumed by ../run.mjs; probe definitions live in ../probes.mjs;
//       output passes through ./redact.mjs before it is ever written.
// INVARIANTS:
//   - Never runs a live engine call unless `--live` was passed explicitly.
//   - Every live call runs with cwd inside a disposable temp workspace, never the repo.
//   - The forbidden STATE (CLAUDE_CODE_SIMPLE / CLAUDE_CODE_SAFE_MODE, ADR-008) is
//     scrubbed from EVERY child env, and the scrub is asserted, not assumed.
//   - Every session spawn carries the ADR-008 isolation pair unless the probe
//     declares `ambient: true`, which only the probes whose SUBJECT is ambient
//     inheritance may do.
//   - A probe that throws is recorded as `error`, never allowed to abort the suite.
//   - An engine call that timed out or failed to spawn makes its probe
//     INCONCLUSIVE. A probe must never be able to report PASS on a stalled call.
//   - Zero npm dependencies — this must run on a bare Node 22 in CI.
//
// KNOWN LIMITATION (REVIEW-02, S1): `spawnCapture` is run-to-completion — it
// buffers everything and closes stdin immediately. The production engine adapter
// needs a live session handle (open stdin for the control channel, incremental
// parsing, stall timeout, graceful interrupt). That is a replacement, not an
// extension; see task "S1 Tier A". This file is the probe harness, not the adapter.

import { spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, renameSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

export const STATUS = {
  PASS: 'pass',
  FAIL: 'fail',
  PARTIAL: 'partial',
  SKIP: 'skip',
  ERROR: 'error',
  // Distinct from FAIL on purpose. FAIL means "the engine's contract changed".
  // INCONCLUSIVE means "this run cannot say anything about the engine" — a
  // stalled call, a capacity limit, a laptop that went to sleep. Conflating the
  // two is how a nightly job earns the alarm fatigue that makes it worthless.
  INCONCLUSIVE: 'inconclusive',
}

// How the child ended. This has to be a closed set the caller switches on,
// because the alternative — inferring from `code`/`signal` — collapses
// "the engine answered" into "the engine never ran".
export const OUTCOME = {
  COMPLETED: 'completed',
  TIMEOUT: 'timeout',
  // The synchronous throw from spawn(): almost nothing lands here, because Node
  // reports nearly every spawn failure asynchronously.
  SPAWN_FAILED: 'spawn-failed',
  // ...asynchronously, as a 'error' event on the child — ENOENT, EACCES, a
  // binary that is not executable. This used to resolve through the normal exit
  // path as COMPLETED with `code: null`, so a probe could conclude "the engine
  // did not print the marker" about a child that was never born.
  CHILD_ERROR: 'child-error',
}

const VALID_STATUS = new Set(Object.values(STATUS))

/**
 * Parse the harness CLI. Live calls are opt-in on purpose: they spend the
 * operator's real subscription quota.
 */
export function parseArgs(argv) {
  const opts = {
    live: false,
    only: null,
    kinds: null,
    model: 'haiku',
    timeoutMs: 120_000,
    outDir: null,
    keepWorkspaces: false,
    listOnly: false,
    updateBaseline: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    // Every value-taking flag validates its value. `--timeout` with no value
    // used to become NaN, and setTimeout(fn, NaN) fires on the next tick — the
    // whole suite would SIGKILL every child in ~1ms and report 27 engine
    // failures that never happened.
    const need = () => {
      const v = argv[++i]
      if (v === undefined || (v.startsWith('--') && v !== '')) {
        throw new Error(`${a} requires a value`)
      }
      return v
    }
    const list = () => need().split(',').map((s) => s.trim()).filter(Boolean)

    if (a === '--live') opts.live = true
    else if (a === '--only') opts.only = list()
    else if (a === '--kind') opts.kinds = list()
    else if (a === '--model') opts.model = need()
    else if (a === '--timeout') {
      const n = Number(need())
      if (!Number.isFinite(n) || n <= 0 || n > 3600) {
        throw new Error(`--timeout must be a positive number of seconds up to 3600 (got "${argv[i]}")`)
      }
      opts.timeoutMs = n * 1000
    } else if (a === '--out') opts.outDir = need()
    else if (a === '--keep-workspaces') opts.keepWorkspaces = true
    else if (a === '--update-baseline') opts.updateBaseline = true
    else if (a === '--list') opts.listOnly = true
    else if (a === '--help' || a === '-h') opts.help = true
    else throw new Error(`Unknown argument: ${a}`)
  }
  return opts
}

// Markers Claude Code sets for its own child processes. A probe must observe the
// engine as a *fresh* invocation would, not as a nested session, so these are
// removed from the child environment and the removal is recorded in the report.
const SCRUBBED_ENV_KEYS = [
  'CLAUDECODE',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_SSE_PORT',
  'CLAUDE_CODE_SIMPLE',
  'CLAUDE_CODE_SAFE_MODE',
]

// These do not change whether the session is "nested" — they change WHICH
// ENGINE ANSWERS. `ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN` is exactly how
// z.ai's coding plan points `claude` at GLM, and this project intends to ship a
// GLM engine later, so the owner's shell is a realistic place for them to live.
// Left unscrubbed, a full `--live` run would execute all 30 probes against a
// different vendor's Anthropic-compatible endpoint, `claude --version` would
// still print 2.1.220, the baseline's version gate would be satisfied, and the
// report would be committed and cited by ADR-007/008 as measured Anthropic
// behaviour. A conformance suite that does not control the backend is not
// measuring the engine it names.
const BACKEND_ENV_KEYS = [
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_CUSTOM_HEADERS',
  'ANTHROPIC_MODEL',
  'ANTHROPIC_SMALL_FAST_MODEL',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_SKIP_BEDROCK_AUTH',
]

// The ADR-008 isolation pair. `--strict-mcp-config` alone isolates MCP only and
// still inherits the operator's plugins, skills, agents and permission default.
// Consumed by applyIsolation() — it was previously exported and used by nothing
// while the real pair sat hardcoded elsewhere, i.e. two sources of truth for
// the project's central isolation invariant.
export const ISOLATION_PAIR = ['--strict-mcp-config', '--setting-sources', '']

// Flags the CLI accepts only on a session invocation. Used to cross-check the
// `-p`/`--print` sniff; a wider list catches more classifier misses.
const SESSION_ONLY_FLAGS = [
  '--allowedTools', '--disallowedTools', '--permission-mode', '--mcp-config',
  '--agents', '--append-system-prompt', '--system-prompt', '--json-schema',
  '--input-format', '--include-partial-messages', '--replay-user-messages',
  '--include-hook-events', '--fork-session', '--resume', '--session-id',
  '--no-session-persistence', '--max-budget-usd', '--effort', '--fallback-model',
  '--plugin-dir',
]

/**
 * Build a child environment with the forbidden state removed and the result
 * ASSERTED. `extra` is merged BEFORE the scrub, so a caller cannot reintroduce a
 * denied key by passing it in.
 */
export function scrubbedChildEnv(extra = {}, { allowAutoUpdate = false } = {}) {
  const env = { ...process.env, ...extra }
  const removed = []
  const backendOverrides = []
  for (const key of SCRUBBED_ENV_KEYS) {
    if (key in env) {
      delete env[key]
      removed.push(key)
    }
  }
  // Recorded by name, not silently dropped. "We removed a third-party base URL
  // before measuring" is a fact a reader of the public report needs, and its
  // absence is what makes the report trustworthy.
  for (const key of BACKEND_ENV_KEYS) {
    if (key in env) {
      delete env[key]
      backendOverrides.push(key)
    }
  }
  // Guidelane's engine adapter will do exactly this in production (ADR-001
  // follow-up: ungoverned auto-update is an unlisted SPOF).
  //
  // `allowAutoUpdate` is the single declared exception, and it exists because a
  // guard that is always on cannot be proven to do anything: p-autoupdate-
  // governable needs one child WITHOUT the variable to have a control arm. Same
  // shape as `ambient` — explicit, counted, and printed in the report, so the
  // report's "set on every child" line stays literally true instead of becoming
  // a claim nobody re-checked.
  if (allowAutoUpdate) {
    delete env.DISABLE_AUTOUPDATER
    // Marks the exception so the spawn-site assertion can tell a declared
    // control arm from a caller who simply forgot to scrub.
    env.__GUIDELANE_AUTOUPDATE_OPTOUT = '1'
  } else {
    env.DISABLE_AUTOUPDATER = '1'
  }
  // A non-UTF-8 locale mangles ı/ğ/ş/İ in hook scripts, and under launchd the
  // environment is nearly empty. Pre-emptive, and does not substitute for the
  // REVIEW-02 B10 measurement.
  if (!env.LANG) env.LANG = 'en_US.UTF-8'
  if (!env.LC_ALL) env.LC_ALL = 'en_US.UTF-8'

  // NOTE: the assertion that used to live here was a tautology. It iterated the
  // same constant the delete loop had just iterated, in the same function, with
  // nothing in between that could reintroduce a key — so there was no execution
  // path on which it could throw, while its comment claimed it would catch "an
  // upstream rename or a caller defeating the deny-list" (a rename changes both
  // loops identically). The real assertion now lives at the spawn site, which
  // is the boundary that actually has an adversary: see spawnCapture().
  return { env, removed, backendOverrides }
}

// Every live child, so a signal can reap the whole tree. An orphaned `claude`
// keeps spending the operator's quota with nobody reading its output.
const LIVE_CHILDREN = new Set()

export function killAllChildren() {
  for (const child of LIVE_CHILDREN) {
    try {
      process.kill(-child.pid, 'SIGKILL')
    } catch {
      try { child.kill('SIGKILL') } catch { /* already gone */ }
    }
  }
  LIVE_CHILDREN.clear()
}

const MAX_CAPTURE_BYTES = 8 * 1024 * 1024
const CLOSE_WATCHDOG_MS = 5_000

/**
 * Spawn a command, capture everything, and enforce a hard timeout.
 * Resolves (never rejects) so a hung engine degrades into evidence.
 */
export function spawnCapture(cmd, args, { cwd, env, stdin, timeoutMs }) {
  // The boundary with an adversary. `child_process.spawn` inherits the parent's
  // environment IN FULL when `env` is omitted — including `CLAUDECODE=1` and
  // `CLAUDE_CODE_ENTRYPOINT`, i.e. exactly the forbidden state ADR-008 bans —
  // while the report's deny-list line prints as if the scrub had happened. The
  // guarantee used to rest entirely on one external caller remembering to pass
  // `scrubbedChildEnv().env`. Now it cannot be forgotten.
  if (!env || typeof env !== 'object') {
    throw new Error(
      'spawnCapture: env is required — build it with scrubbedChildEnv(). ' +
        'An omitted env inherits the parent environment, forbidden state included.'
    )
  }
  for (const key of [...SCRUBBED_ENV_KEYS, ...BACKEND_ENV_KEYS]) {
    if (key in env) throw new Error(`env deny-list violated at the spawn site: ${key} reached spawn()`)
  }
  if (env.DISABLE_AUTOUPDATER === undefined && !env.__GUIDELANE_AUTOUPDATE_OPTOUT) {
    throw new Error('spawnCapture: DISABLE_AUTOUPDATER absent and no declared opt-out')
  }
  return new Promise((resolve) => {
    const started = process.hrtime.bigint()
    let stdout = ''
    let stderr = ''
    let stdoutTruncated = false
    let stderrTruncated = false
    let timedOut = false
    // null = never measured (no watchdog fired), true/false = measured.
    let groupAliveAfterKill = null
    let settled = false
    let watchdog = null

    let child
    try {
      child = spawn(cmd, args, {
        cwd,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
        // Become a process-group leader so the WHOLE tree is addressable.
        // Killing only the direct child leaves stdio MCP servers and Bash
        // grandchildren running — still authenticated, still billing.
        // Consequence accepted deliberately: the child no longer receives the
        // terminal's Ctrl-C, so run.mjs installs signal handlers that call
        // killAllChildren(). On Windows `detached` means "new console" and the
        // tree kill would need taskkill /T /F — K5 is still open, so this is
        // POSIX-only for now.
        detached: process.platform !== 'win32',
      })
    } catch (err) {
      resolve({
        code: null,
        signal: null,
        stdout: '',
        stderr: String((err && err.message) || err),
        timedOut: false,
        spawnFailed: true,
        outcome: OUTCOME.SPAWN_FAILED,
        ms: 0,
        cmd,
      })
      return
    }
    LIVE_CHILDREN.add(child)

    const finish = (code, signal, outcomeOverride) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (watchdog) clearTimeout(watchdog)
      // Only stop tracking a child we know actually died. On the watchdog path
      // 'close' never came, which is precisely the case where something in the
      // tree is still alive — deregistering there would hide it from
      // killAllChildren() at exit, i.e. leak the orphan the tracking exists for.
      if (signal !== 'SIGKILL_NO_CLOSE') LIVE_CHILDREN.delete(child)
      const ms = Number(process.hrtime.bigint() - started) / 1e6
      resolve({
        code,
        signal,
        stdout,
        stderr,
        stdoutTruncated,
        stderrTruncated,
        timedOut,
        spawnFailed: outcomeOverride === OUTCOME.CHILD_ERROR,
        outcome: outcomeOverride || (timedOut ? OUTCOME.TIMEOUT : OUTCOME.COMPLETED),
        // The pipe never closed, so something in the tree outlived the group
        // kill. Surfaced rather than swallowed: this is REVIEW-02 B1's shape.
        orphanSuspected: signal === 'SIGKILL_NO_CLOSE',
        // Measured, not inferred — see the watchdog above.
        orphanConfirmed: groupAliveAfterKill === true,
        ms: Math.round(ms),
        // The resolved command WITHOUT its arguments: argv carries absolute
        // fixture paths and inline --mcp-config JSON, and this object is one
        // `evidence: {...res}` away from a public report.
        cmd,
      })
    }

    const killTree = (signal) => {
      try {
        process.kill(-child.pid, signal)
      } catch {
        try { child.kill(signal) } catch { /* already gone */ }
      }
    }

    const timer = setTimeout(() => {
      timedOut = true
      killTree('SIGKILL')
      // 'close' fires only once the process has exited AND every stdio pipe is
      // closed. A grandchild holding the stdout write end keeps that pipe open
      // forever, so without this watchdog the promise never settles, the
      // sequential loop above never returns, and the nightly job hangs silently
      // — the exact "feed stops with no terminal event" failure the product
      // exists to prevent.
      watchdog = setTimeout(() => {
        // MEASURE, don't infer. "The pipe did not close within 5s" is equally
        // consistent with a live grandchild and with a slow flush, and the
        // actual question — is anything still in the child's process group? —
        // costs one syscall. `kill(-pgid, 0)` sends no signal; ESRCH means the
        // group is empty.
        //
        // SCOPE, stated so the report cannot overclaim: this answers only for
        // the CHILD'S OWN group, which is exactly what killTree targets. A
        // grandchild that called setsid() into a different group — the very
        // thing `hang.mjs escaped` does — is outside it by construction and
        // this check cannot see it. So `orphansConfirmed: 0` means "the group
        // we killed is empty", NOT "nothing escaped". Closing that gap needs a
        // process-table walk, which is REVIEW-02 B1's job, not the watchdog's.
        try {
          process.kill(-child.pid, 0)
          groupAliveAfterKill = true
        } catch {
          groupAliveAfterKill = false
        }
        finish(null, 'SIGKILL_NO_CLOSE')
      }, CLOSE_WATCHDOG_MS)
      watchdog.unref()
    }, timeoutMs)

    // setEncoding uses a StringDecoder, so a multi-byte character split across a
    // pipe-read boundary is not corrupted. Per-chunk `.toString()` turns Turkish
    // ı/ğ/ş into U+FFFD — which would have made this harness manufacture a false
    // positive for the very UTF-8 bug it is meant to measure (REVIEW-02 B10).
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (d) => {
      if (stdout.length >= MAX_CAPTURE_BYTES) { stdoutTruncated = true; return }
      stdout += d
    })
    child.stderr.on('data', (d) => {
      if (stderr.length >= MAX_CAPTURE_BYTES) { stderrTruncated = true; return }
      stderr += d
    })
    // An EPIPE here is a stream 'error' event, not a promise rejection: with no
    // listener it becomes an uncaught exception and takes the whole suite down.
    // The child exiting before it drains stdin is normal (bad flag, logged out).
    child.stdin.on('error', (err) => {
      stderr += `\n[stdin ${(err && err.code) || 'error'}] ${err && err.message}`
    })
    child.on('error', (err) => {
      stderr += `\n[spawn error] ${err && err.message}`
      // Explicitly CHILD_ERROR, not the exit path. A child that never ran must
      // not resolve as COMPLETED — a probe reading `code !== 0` or an absent
      // marker would report a confident finding about the engine.
      finish(null, null, OUTCOME.CHILD_ERROR)
    })
    child.on('close', finish)

    if (stdin !== undefined && stdin !== null) child.stdin.write(stdin)
    try {
      child.stdin.end()
    } catch {
      /* child may already have exited */
    }
  })
}

/**
 * Build the per-probe context handed to every probe's `run()`.
 */
export function makeContext({ opts, fixturesDir, suiteRoot, helpCache, audit }) {
  const claudeBin = process.env.GUIDELANE_CLAUDE_BIN || 'claude'

  const makeWorkspace = (probeId) => {
    const dir = join(suiteRoot, probeId.replace(/[^a-z0-9-]/gi, '_'))
    mkdirSync(dir, { recursive: true })
    return dir
  }

  // The only spawn path exposed to probes. It scrubs unconditionally, so a probe
  // passing `env: process.env` — which three of them did — cannot bypass the
  // deny-list, and the report's claim about scrubbing becomes true by
  // construction rather than by discipline.
  /**
   * Classify the invocation and apply the ADR-008 isolation pair.
   *
   * This lives on the spawn path, not in `claude()`, because `claude()` was not
   * the only way to reach spawn: `ctx.spawnCapture` is exposed for non-session
   * tools by CONVENTION, and a convention is not a constraint. A probe calling
   * `ctx.spawnCapture(ctx.claudeBin, ['-p', ...])` used to get a session with
   * the operator's plugins, skills, agents and bypassPermissions default, no
   * increment to `ambientSpawns`, and a report still printing "Sessions spawned
   * without the isolation pair: 4". Same fail-open shape as the 14-of-19 spawns
   * that were missing a flag before the harness took the job over.
   */
  function applyIsolation(cmd, args, { ambient }) {
    if (cmd !== claudeBin) return args
    const isSession = args.includes('-p') || args.includes('--print')
    if (!isSession) {
      // The sniff is an inference, and a silent miss fails open. These flags
      // exist only on session invocations, so seeing one here means the
      // classifier is wrong — stop rather than measure a contaminated session.
      const leaked = SESSION_ONLY_FLAGS.filter((f) => args.includes(f))
      if (leaked.length) {
        throw new Error(
          `session classifier failed: ${leaked.join(', ')} present without -p/--print. ` +
            `Isolation would have been skipped silently — widen the sniff, do not work around this.`
        )
      }
      return args
    }
    if (ambient) {
      audit.ambientSpawns += 1
      return args
    }
    const out = [...args]
    if (!out.includes(ISOLATION_PAIR[0])) out.push(ISOLATION_PAIR[0])
    const at = out.indexOf(ISOLATION_PAIR[1])
    if (at === -1) out.push(ISOLATION_PAIR[1], ISOLATION_PAIR[2])
    else if (out[at + 1] !== '') {
      // Presence is not isolation. `--setting-sources user` satisfied the old
      // `includes()` check, so the session loaded the operator's settings while
      // the result reported `isolated: true` and nothing counted it as ambient.
      throw new Error(
        `--setting-sources must be '' on an isolated session (got "${out[at + 1]}"). ` +
          `Pass ambient:true if measuring inherited configuration is the point.`
      )
    }
    return out
  }

  const run = async (
    cmd,
    args,
    {
      cwd,
      stdin,
      timeoutMs,
      env: extraEnv,
      expectTimeout = false,
      allowAutoUpdate = false,
      ambient = false,
      observationOnly = false,
    } = {}
  ) => {
    const finalArgs = applyIsolation(cmd, args, { ambient })
    const { env, removed } = scrubbedChildEnv(extraEnv === process.env ? {} : extraEnv, { allowAutoUpdate })
    audit.spawns += 1
    if (allowAutoUpdate) audit.autoUpdateOptOuts += 1
    for (const k of removed) audit.keysRemoved.add(k)
    const res = await spawnCapture(cmd, finalArgs, {
      cwd: cwd || suiteRoot,
      env,
      stdin,
      timeoutMs: timeoutMs || opts.timeoutMs,
    })
    // A timed-out call normally makes its probe INCONCLUSIVE, because a probe
    // cannot say anything about the engine from a call that never finished.
    // `expectTimeout` is the declared exception for probes whose SUBJECT is the
    // timeout path itself — without it, the two probes that verify the kill and
    // watchdog machinery can never report their own result. Same shape as
    // `ambient: true`: an opt-out that is explicit and counted, not implicit.
    if (res.outcome !== OUTCOME.COMPLETED) {
      // `expectTimeout` excuses a TIMEOUT and nothing else. A probe whose
      // subject is the timeout path still cannot draw a conclusion from a child
      // that failed to launch, so CHILD_ERROR and SPAWN_FAILED degrade
      // regardless of what the probe declared it was expecting.
      if (expectTimeout && res.outcome === OUTCOME.TIMEOUT) audit.expectedTimeouts += 1
      // An arm the probe declared non-blocking must not be able to override the
      // probe's own verdict. Counted and reported, so "this arm is allowed to
      // fail" stays visible rather than becoming a silent exemption.
      else if (observationOnly) audit.observationFailures.push({ cmd, outcome: res.outcome })
      else audit.degraded.push({ cmd, outcome: res.outcome })
    }
    // stdoutTruncated/stderrTruncated were computed and read by nothing. A probe
    // asserting on a marker that fell past the 8 MB cap would report a confident
    // FAIL about the engine; the honest verdict is "this run cannot say".
    if (res.stdoutTruncated || res.stderrTruncated) {
      audit.degraded.push({ cmd, outcome: 'output-truncated' })
    }
    if (res.orphanSuspected) audit.orphanSuspected += 1
    // A CONFIRMED orphan is a harness fault, not an engine finding: something
    // authenticated is still running and still spending quota. The one probe
    // that manufactures an escapee on purpose declares `expectTimeout`, so its
    // orphan is counted separately and the number can be pinned — a counter
    // with no expectation cannot falsify anything, which is the same shape as
    // the relative isolation check that passed green for a day.
    if (res.orphanConfirmed) {
      if (expectTimeout) audit.orphansExpected += 1
      else {
        audit.orphansConfirmed += 1
        audit.degraded.push({ cmd, outcome: 'orphan-confirmed' })
      }
    }
    return { ...res, scrubbedEnvKeys: removed }
  }

  const help = async (subcommand) => {
    const key = subcommand || '__root__'
    if (helpCache.has(key)) return helpCache.get(key)
    const args = subcommand ? [...subcommand.split(' '), '--help'] : ['--help']
    const res = await run(claudeBin, args, { timeoutMs: 30_000 })
    // stdout ONLY. Folding stderr in means a deprecation warning or an update
    // nag that happens to contain a flag name can make the flag-surface probe
    // pass on a flag that no longer exists.
    //
    // Cache ONLY a clean call. Caching unconditionally meant one slow spawn
    // poisoned the whole run: the first probe's 30s help() times out, '' is
    // cached, and five later probes report FAIL — "the engine's contract
    // changed" — from a laptop hiccup. `audit.degraded` is reset per probe, so
    // the later probes would not even be marked inconclusive.
    // ...and not a TRUNCATED one. The cache condition closed the poisoning hole
    // for timeouts and non-zero exits but not for output that hit the 8 MB cap:
    // the first caller is correctly INCONCLUSIVE, the truncated text is cached,
    // and five later help-text probes read it clean and report confident FAILs
    // about missing flags. Help output is far below the cap today — the point
    // is that the condition was one clause short of the guarantee it claimed.
    if (res.outcome === OUTCOME.COMPLETED && res.code === 0 && !res.stdoutTruncated) {
      helpCache.set(key, res.stdout)
    } else {
      audit.degraded.push({
        cmd: `help(${key})`,
        outcome: res.stdoutTruncated ? 'output-truncated' : res.outcome || `exit ${res.code}`,
      })
    }
    return res.stdout
  }

  /**
   * Run the engine. Callers pass only the flags under test; the harness adds the
   * safety floor: a disposable cwd, a scrubbed env, a hard timeout, closed stdin,
   * and — for session invocations — the ADR-008 isolation pair.
   *
   * `ambient: true` opts out of isolation. It is legitimate ONLY for probes whose
   * subject IS ambient inheritance, and it is recorded in the result so the
   * report can mark which measurements were not clean-room.
   */
  const claude = async (args, opts = {}) => {
    const { cwd, workspaceFor, ambient = false, ...rest } = opts
    const workspace = cwd || (workspaceFor ? makeWorkspace(workspaceFor) : suiteRoot)
    const isSession = args.includes('-p') || args.includes('--print')
    // Isolation itself now lives in `run` — the single spawn chokepoint — so a
    // probe reaching for `ctx.spawnCapture` cannot get an un-isolated session.
    // See applyIsolation().
    const res = await run(claudeBin, args, { ...rest, cwd: workspace, ambient })
    return { ...res, workspace, isolated: isSession ? !ambient : null }
  }

  /**
   * Parse newline-delimited JSON.
   *
   * A line that STARTS like JSON and fails to parse is a FRAMING BREAK, not
   * noise, and the two are not interchangeable: if the CLI ever chunks a large
   * frame across newlines, every downstream probe reports "the engine stopped
   * emitting X" when the truth is "the parser stopped seeing it". The counts
   * used to be attached to the returned array as an expando — dropped by both
   * JSON.stringify and redactDeep's array branch, and read by no probe. They
   * now degrade the probe, which is the only form of counting that changes an
   * outcome.
   *
   * `strict: false` for the one caller that legitimately feeds a pretty-printed
   * `--output-format json` document through here.
   */
  const jsonLines = (text, { strict = true } = {}) => {
    const out = []
    let skipped = 0
    let unparseable = 0
    for (const line of String(text || '').split('\n')) {
      const t = line.trim()
      if (!t) continue
      if (t[0] !== '{' && t[0] !== '[') { skipped += 1; continue }
      try {
        out.push(JSON.parse(t))
      } catch {
        unparseable += 1
      }
    }
    if (strict && unparseable > 0) {
      audit.degraded.push({ cmd: 'jsonLines', outcome: `${unparseable} unparseable JSONL line(s)` })
    }
    return out
  }

  /** A stream-json user message, ready to write to the engine's stdin. */
  const userMessage = (text) =>
    JSON.stringify({
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text }] },
    }) + '\n'

  return {
    claudeBin,
    fixtures: fixturesDir,
    suiteRoot,
    live: opts.live,
    model: opts.model,
    help,
    claude,
    jsonLines,
    userMessage,
    makeWorkspace,
    scrubbedEnv: (extra) => scrubbedChildEnv(extra).env,
    // Kept for non-session tools (`auth status`, `--version`, `auto-mode`).
    // Scrubbed by construction — there is no unscrubbed spawn on the context.
    spawnCapture: run,
  }
}

/**
 * Run every selected probe in sequence. Sequential is deliberate: concurrent
 * engine sessions would race on the same rate-limit window and make a limit
 * event indistinguishable from a genuine failure.
 */
// NOT os.tmpdir(). macOS gives launchd and each Terminal login session their own
// per-session TMPDIR under /var/folders, so a lock there is invisible between
// exactly the two processes it exists to serialise — both would acquire, both
// would run, and both the code and the report would claim serialisation. Third
// instance of this codebase's recurring fail-open-by-construction shape.
const LOCK_DIR = join(homedir(), '.guidelane')
const LOCK_PATH = join(LOCK_DIR, 'probe.lock')
// A run that dies by lid-close, OS kill or SIGKILL never reaches its finally.
// PID liveness alone is not enough because pids are recycled, so a lock older
// than any plausible run is also stale.
const LOCK_TTL_MS = 2 * 60 * 60 * 1000

/**
 * The lock this process holds, so a signal handler can release it.
 *
 * Every hard exit — SIGINT, SIGTERM, SIGHUP, uncaughtException — bypasses
 * runSuite's `finally`, so Ctrl-C used to leave a lockfile behind every single
 * time. It only ever self-healed because the steal-from-a-live-holder bug above
 * was covering for it: two defects propping each other up, and fixing either
 * one alone would have exposed the other.
 */
export let activeLock = null

/**
 * An expected operator condition, not a harness fault.
 *
 * "Another probe run is active" is designed behaviour with a carefully written
 * multi-line explanation, and it used to surface as `Harness crashed:` plus a
 * stack trace plus exit 2 — the code the contract defines as "the probe suite
 * is broken". The launchd job's alerting could not tell the two apart.
 */
export class ProbeUsageError extends Error {
  constructor(message, exitCode = 4) {
    super(message)
    this.name = 'ProbeUsageError'
    this.exitCode = exitCode
  }
}

/**
 * Refuse to run two suites at once. Sequencing inside one process is enforced by
 * the await loop; across processes it was enforced by nothing, so the 04:00
 * launchd run and a manual `--live` could interleave, race the same rate-limit
 * window, and contend on ~/.claude.json (REVIEW-02 B7).
 *
 * A lock that can strand its owner is worse than no lock, so a dead holder is
 * taken over automatically and the failure message says exactly what to do.
 */
function acquireLock() {
  mkdirSync(LOCK_DIR, { recursive: true })
  const mine = JSON.stringify({ pid: process.pid, startedAtMs: Date.now(), argv: process.argv.slice(2) })
  const state = { stoleStaleLock: false, staleReason: null }

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      writeFileSync(LOCK_PATH, mine, { flag: 'wx' })
      // Read back before claiming the lock. Two processes can both judge the
      // same lock stale, both remove it, and the loser's rmSync can delete the
      // winner's fresh file — after which its own `wx` succeeds and BOTH run,
      // with neither reporting an anomaly. Verifying ownership closes that.
      let back = null
      try { back = JSON.parse(readFileSync(LOCK_PATH, 'utf8')) } catch { /* raced */ }
      if (!back || Number(back.pid) !== process.pid) continue
      const handle = {
        state,
        release: () => {
          // Only ever delete OUR lock. `rmSync(force)` removed whatever file
          // happened to be there, including a successor's.
          try {
            const cur = JSON.parse(readFileSync(LOCK_PATH, 'utf8'))
            if (Number(cur.pid) !== process.pid) return
          } catch { /* gone or corrupt — fall through and clear it */ }
          try { rmSync(LOCK_PATH, { force: true }) } catch { /* already gone */ }
          activeLock = null
        },
      }
      activeLock = handle
      return handle
    } catch (err) {
      if (err && err.code !== 'EEXIST') throw err

      let held = null
      try { held = JSON.parse(readFileSync(LOCK_PATH, 'utf8')) } catch { /* corrupt or legacy */ }
      const holder = held && Number(held.pid)
      const ageMs = held && held.startedAtMs ? Date.now() - Number(held.startedAtMs) : Infinity

      let holderAlive = false
      if (holder > 0) {
        // EPERM means the process EXISTS but is not ours. The bare catch read
        // that as dead.
        try { process.kill(holder, 0); holderAlive = true } catch (e) { holderAlive = Boolean(e && e.code === 'EPERM') }
      }
      const expired = ageMs > LOCK_TTL_MS

      // LIVENESS BEATS THE TTL, always. The old condition was
      // `holderAlive && !expired`, whose contrapositive is: steal from a LIVE
      // holder once it passes 2h. A full --live run that hits a couple of
      // rate-limit pauses can exceed that while perfectly healthy — so the lock
      // voided itself at exactly the moment contention hurts most, and then
      // reported `staleReason: "lock age exceeds TTL"` about a process it had
      // just confirmed alive. The TTL is for a holder that died without
      // reaching its finally, not for a slow one.
      if (holderAlive) {
        throw new ProbeUsageError(
          `Another probe run is active (pid ${holder}, started ${Math.round(ageMs / 1000)}s ago` +
          `${expired ? `, past the ${LOCK_TTL_MS / 3600000}h expectation — it may be wedged` : ''}).\n` +
          `Concurrent engine sessions race on the same rate-limit window, which makes a limit event\n` +
          `indistinguishable from a real failure. Wait for it, or stop it with:  kill ${holder}\n` +
          `Only once that process is gone will this lock be reclaimed automatically.\n` +
          `\nWhat this lock does NOT protect: an interactive Claude Code session on the same login\n` +
          `shares the account's rate-limit window and no lock can serialise against it.`
        )
      }

      state.stoleStaleLock = true
      state.staleReason = `holder pid ${holder} is gone (lock age ${Math.round(ageMs / 1000)}s)`
      process.stderr.write(`Reclaiming stale probe lock (${state.staleReason}).\n`)
      // Rename, not remove: only one racer can move an inode, so exactly one
      // process reaches the re-create. The loser gets ENOENT and retries.
      const stashed = `${LOCK_PATH}.stale.${process.pid}`
      try {
        renameSync(LOCK_PATH, stashed)
        rmSync(stashed, { force: true })
      } catch (e) {
        if (!e || e.code !== 'ENOENT') throw e
      }
    }
  }
  throw new Error(`Could not acquire ${LOCK_PATH} after reclaiming a stale lock. Delete it manually and retry.`)
}

export async function runSuite({ probes, opts, fixturesDir }) {
  const lock = acquireLock()
  const suiteRoot = mkdtempSync(join(tmpdir(), 'guidelane-probe-'))
  const helpCache = new Map()
  const audit = {
    spawns: 0,
    ambientSpawns: 0,
    autoUpdateOptOuts: 0,
    expectedTimeouts: 0,
    orphanSuspected: 0,
    orphansConfirmed: 0,
    orphansExpected: 0,
    keysRemoved: new Set(),
    degraded: [],
    observationFailures: [],
  }
  const ctx = makeContext({ opts, fixturesDir, suiteRoot, helpCache, audit })

  if (opts.only) {
    const known = new Set(probes.map((p) => p.id))
    const unknown = opts.only.filter((id) => !known.has(id))
    // A typo in --only used to produce a zero-probe green run that overwrote the
    // report. Refuse instead.
    if (unknown.length) throw new ProbeUsageError(`Unknown probe id(s): ${unknown.join(', ')}`, 2)
  }

  const selected = probes.filter((p) => {
    if (opts.only && !opts.only.includes(p.id)) return false
    if (opts.kinds && !opts.kinds.includes(p.kind)) return false
    return true
  })
  if (selected.length === 0) throw new ProbeUsageError('Selection matched zero probes — refusing to write an empty report.', 2)

  const results = []
  try {
    for (const probe of selected) {
      const needsLive = probe.kind === 'live-call' || probe.kind === 'fixture-call'
      if (needsLive && !opts.live) {
        results.push({
          ...describe(probe),
          status: STATUS.SKIP,
          detail: 'Live engine call not enabled (pass --live to spend real quota).',
          evidence: null,
          ms: 0,
        })
        continue
      }

      const started = Date.now()
      audit.degraded = []
      audit.observationFailures = []
      try {
        const out = await probe.run(ctx)
        if (!out || typeof out !== 'object' || !VALID_STATUS.has(out.status)) {
          // A probe returning `{}` used to yield status `undefined`, which
          // counted as neither pass nor fail and left the CI gate green.
          throw new Error(`invalid probe result: status=${out && out.status}`)
        }
        const degraded = audit.degraded
        results.push({
          ...describe(probe),
          status: degraded.length ? STATUS.INCONCLUSIVE : out.status,
          detail: degraded.length
            ? `INCONCLUSIVE — ${degraded.length} engine call(s) did not complete (${degraded.map((d) => d.outcome).join(', ')}). ` +
              `The probe's own verdict was "${out.status}: ${out.detail}" and must not be believed.`
            : out.detail || '',
          evidence: out.evidence === undefined ? null : out.evidence,
          // Declared-non-blocking arms that failed. Reported, never silent: an
          // exemption nobody can see is indistinguishable from a bug.
          observationFailures: audit.observationFailures.length ? [...audit.observationFailures] : null,
          ms: Date.now() - started,
        })
      } catch (err) {
        results.push({
          ...describe(probe),
          status: STATUS.ERROR,
          detail: `Probe threw: ${(err && err.stack) || err}`,
          evidence: null,
          ms: Date.now() - started,
        })
      }
    }
  } finally {
    lock.release()
    // In a finally: a throw above must not leak a workspace containing files a
    // model wrote under --allowedTools Write.
    if (!opts.keepWorkspaces) {
      try {
        rmSync(suiteRoot, { recursive: true, force: true })
      } catch {
        /* leaving a temp dir behind is not worth failing a run over */
      }
    }
  }

  // `--only` and `--kind` were closed after a filtered run overwrote the
  // canonical report with "1 pass · 0 fail". The other non-default inputs were
  // not, and they are worse: `--live --timeout 5` runs all 30 probes, times out
  // nearly every engine call, degrades them all to INCONCLUSIVE — which
  // checkBaseline excludes, so NO DRIFT — and still writes
  // S0-conformance-report.md over the document ADR-007 and ADR-008 cite.
  const DEFAULT_MODEL = 'haiku'
  const DEFAULT_TIMEOUT_MS = 120_000
  const nonDefault = []
  if (opts.model !== DEFAULT_MODEL) nonDefault.push(`model=${opts.model}`)
  if (opts.timeoutMs !== DEFAULT_TIMEOUT_MS) nonDefault.push(`timeout=${opts.timeoutMs}ms`)
  if (process.env.GUIDELANE_CLAUDE_BIN) nonDefault.push('GUIDELANE_CLAUDE_BIN')
  const complete = Boolean(opts.live) && !opts.only && !opts.kinds && nonDefault.length === 0
  return {
    // Never the real path: it embeds the macOS confstr salt, a stable
    // per-account fingerprint. Redaction would catch it anyway; not emitting it
    // is one less thing depending on redaction.
    suiteRoot: '<TMP>/guidelane-probe-<run>',
    workspacesKept: opts.keepWorkspaces,
    stoleStaleLock: lock.state.stoleStaleLock,
    staleLockReason: lock.state.staleReason,
    runScope: {
      complete,
      // Why a run was not complete, so the partial banner can say so instead of
      // leaving the operator to re-derive it.
      nonDefault,
      live: Boolean(opts.live),
      only: opts.only || null,
      kinds: opts.kinds || null,
      probesDefined: probes.length,
      probesRun: results.length,
    },
    options: { live: opts.live, model: opts.model, timeoutMs: opts.timeoutMs },
    // Measured, not asserted: what the deny-list is, how many children it ran
    // against, and what was actually removed.
    envScrub: {
      denyList: SCRUBBED_ENV_KEYS,
      spawns: audit.spawns,
      ambientSpawns: audit.ambientSpawns,
      autoUpdateOptOuts: audit.autoUpdateOptOuts,
      expectedTimeouts: audit.expectedTimeouts,
      orphanSuspected: audit.orphanSuspected,
      orphansConfirmed: audit.orphansConfirmed,
      orphansExpected: audit.orphansExpected,
      actuallyRemoved: [...audit.keysRemoved],
    },
    counts: tally(results),
    results,
  }
}

function describe(probe) {
  return {
    id: probe.id,
    title: probe.title,
    kind: probe.kind,
    loadBearing: probe.loadBearing,
    claim: probe.claim,
    docRefs: probe.docRefs || [],
    failureImpact: probe.failureImpact || '',
  }
}

function tally(results) {
  const counts = { pass: 0, fail: 0, partial: 0, skip: 0, error: 0, inconclusive: 0 }
  for (const r of results) {
    // Fail closed: an unrecognised status is an error, not a new bucket that
    // quietly escapes the exit-code gate.
    if (counts[r.status] === undefined) counts.error += 1
    else counts[r.status] += 1
  }
  return counts
}

const STATUS_MARK = {
  pass: 'PASS',
  fail: 'FAIL',
  partial: 'PARTIAL',
  skip: 'skipped',
  error: 'ERROR',
  inconclusive: 'INCONCLUSIVE',
}

export function renderMarkdown(report, { version, generatedAt }) {
  const lines = []
  const c = report.counts
  const scope = report.runScope || { complete: true }

  lines.push('# S0 — Engine Conformance Probe Results')
  lines.push('')
  lines.push(`**Engine**: \`claude\` ${version || 'unknown'}`)
  lines.push(`**Run**: ${generatedAt} · live calls ${report.options.live ? 'ENABLED' : 'disabled'} · probe model \`${report.options.model}\``)
  lines.push(
    `**Totals**: ${c.pass} pass · ${c.fail} fail · ${c.partial} partial · ${c.inconclusive} inconclusive · ${c.error} error · ${c.skip} skipped`
  )
  lines.push('')
  if (!scope.complete) {
    lines.push(
      `> **PARTIAL RUN — NOT A CONFORMANCE BASELINE.** ${scope.probesRun} of ${scope.probesDefined} probes ran` +
      `${scope.only ? ` (\`--only ${scope.only.join(',')}\`)` : ''}` +
      `${scope.kinds ? ` (\`--kind ${scope.kinds.join(',')}\`)` : ''}` +
      `${scope.live ? '' : '; live calls DISABLED'}.`
    )
    lines.push('')
  }
  lines.push('> Generated by `tools/probe/run.mjs`. Do not hand-edit — re-run the probe instead.')
  lines.push('')

  const bad = report.results.filter(
    (r) => r.status === 'fail' || r.status === 'error' || r.status === 'partial' || r.status === 'inconclusive'
  )
  if (bad.length) {
    lines.push('## Findings requiring a decision')
    lines.push('')
    for (const r of bad) {
      lines.push(`### ${STATUS_MARK[r.status]} — ${r.title} \`${r.id}\``)
      lines.push('')
      lines.push(`- **Claim under test**: ${r.claim}`)
      lines.push(`- **Load-bearing**: ${r.loadBearing}`)
      lines.push(`- **If false**: ${r.failureImpact}`)
      lines.push(`- **Observed**: ${r.detail}`)
      if (r.docRefs.length) lines.push(`- **Plan refs**: ${r.docRefs.join(', ')}`)
      lines.push('')
    }
  }

  lines.push('## All probes')
  lines.push('')
  lines.push('| Probe | Result | Load-bearing | Observed |')
  lines.push('|---|---|---|---|')
  for (const r of report.results) {
    const detail = String(r.detail || '').replace(/\s+/g, ' ').replace(/\|/g, '\\|').slice(0, 200)
    lines.push(`| \`${r.id}\` ${r.title} | ${STATUS_MARK[r.status]} | ${r.loadBearing} | ${detail} |`)
  }
  lines.push('')
  const scrub = report.envScrub || { denyList: [], spawns: 0, actuallyRemoved: [] }
  lines.push(
    `Env deny-list (${scrub.denyList.map((k) => `\`${k}\``).join(', ')}) applied to all ${scrub.spawns} child ` +
    `process(es); actually present and removed: ${scrub.actuallyRemoved.length ? scrub.actuallyRemoved.map((k) => `\`${k}\``).join(', ') : 'none'}. ` +
    `A UTF-8 locale set on every child, and \`DISABLE_AUTOUPDATER=1\` on every child except ` +
    `${scrub.autoUpdateOptOuts || 0} deliberate control-arm spawn(s) (p-autoupdate-governable needs one child ` +
    `without the guard to prove the guard does anything; \`claude doctor\` installs nothing). ` +
    `Sessions spawned without the ADR-008 isolation pair (deliberately, to measure ambient inheritance): ${scrub.ambientSpawns || 0}. ` +
    `Plus one pre-flight \`claude --version\` spawned before the audit exists — scrubbed, but not in the count above.`
  )
  lines.push('')
  // These were collected and rendered nowhere, so the surface a human reads
  // could not show the thing the counters exist to surface. An orphan is the
  // failure where an authenticated engine keeps spending the owner's quota
  // after the run reports success.
  lines.push(
    `Process hygiene: ${scrub.orphansConfirmed || 0} confirmed live process group(s) after SIGKILL ` +
    `(any number above zero is a harness fault, not an engine finding), ` +
    `${scrub.orphansExpected || 0} of those declared by a probe whose subject is the timeout path, ` +
    `${scrub.orphanSuspected || 0} merely suspected (the pipe did not close within the watchdog window, ` +
    `which is equally consistent with a slow flush — this run's measurement says the group was in fact ` +
    `empty, so the old inference would have reported an orphan that did not exist). ` +
    `Timeouts a probe declared as its own subject: ${scrub.expectedTimeouts || 0}.`
  )
  lines.push('')
  lines.push(
    `**Scope of that check**: \`kill(-pgid, 0)\` answers for the direct child's own process group — ` +
    `exactly what the timeout kill targets. A grandchild that re-parented into its OWN group is outside ` +
    `it by construction, so a zero here means "the group we killed is empty", never "nothing escaped". ` +
    `Proving the stronger claim needs a process-table walk (REVIEW-02 B1).`
  )
  lines.push('')

  return lines.join('\n')
}
