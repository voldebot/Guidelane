// @MAP
// REQUIRED_FLAGS (30) | helpText probes (78) | pluginValidate (170)
// stream/protocol probes (206) | structured-output (286) | injection (330)
// control+cost (395) | session identity (470) | mcp (523) | plugin+hooks (585)
// governance/observational (676) | probes export (735)
// @END-MAP
//
// MAP: The S0 probe matrix — one entry per falsifiable engine assumption the
//      Guidelane plan depends on.
// REFS: executed by ./lib/runner.mjs; fixtures under ./fixtures/.
// INVARIANTS:
//   - Every probe states the plan claim it falsifies and what breaks if false.
//   - `help-text` probes cost nothing; `live-call`/`fixture-call` spend real quota.
//   - Prompts are deliberately trivial: we test the transport and the flags,
//     never the model's intelligence. Marker strings keep assertions exact.
//   - No probe deliberately triggers a rate limit, and none uses --bare/--safe-mode
//     except to read their documented semantics out of help text.

import { createHash, randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { STATUS } from './lib/runner.mjs'

const P = STATUS

/**
 * A stable, non-reversible stand-in for a name this repo must not publish.
 *
 * Several probes enumerate skills, agents and MCP servers. On a clean run those
 * are the CLI's own; on the isolation failure the probes exist to detect, they
 * are the OPERATOR'S — employer, client and internal-project names. Those are
 * not path-shaped or email-shaped, so `redactString` cannot match them and the
 * CI grep has no pattern for them; both layers miss, and the artifact is public.
 *
 * A fingerprint keeps the finding diffable run-to-run ("the same unexpected
 * thing is still there") while naming nothing.
 */
const fingerprint = (s) => createHash('sha256').update(String(s)).digest('hex').slice(0, 8)

/**
 * Split a name list into what is ours to publish and what is not.
 * `floor` is the pinned set of names that belong to the CLI, not the operator.
 */
const publishableNames = (names, floor) => ({
  known: names.filter((n) => floor.includes(n)).sort(),
  unknownCount: names.filter((n) => !floor.includes(n)).length,
  unknownFingerprints: names.filter((n) => !floor.includes(n)).map(fingerprint).sort(),
})

// The CLI's built-in floor as measured on 2.1.220 — the skills and agents that
// survive `--strict-mcp-config` + `--setting-sources ''` (ADR-008 amendment).
// Module-scoped because three probes need it and two sources of truth for a
// pinned baseline is how a pin drifts. Re-pin DELIBERATELY on a CLI upgrade;
// never widen it to make a red probe green.
const BUILTIN_SKILL_FLOOR = [
  'batch', 'claude-api', 'code-review', 'dataviz', 'debug', 'deep-research',
  'design-sync', 'doctor', 'fewer-permission-prompts', 'loop', 'run',
  'run-skill-generator', 'schedule', 'simplify', 'update-config', 'verify',
]
const BUILTIN_AGENT_FLOOR = ['Explore', 'Plan', 'claude', 'general-purpose', 'statusline-setup']

/** Truncate captured output so the JSON report stays readable. */
const clip = (s, n = 1200) => {
  const t = String(s || '')
  return t.length > n ? `${t.slice(0, n)}…[${t.length} chars]` : t
}

// `claude --help` hard-wraps descriptions across lines with deep indentation, so
// a phrase that reads as one sentence is not one string. Every help-text
// assertion matches against the collapsed form.
const flat = (s) => String(s || '').replace(/\s+/g, ' ')

// Every flag the plan's architecture depends on. A missing entry here is not a
// cosmetic problem: each one is load-bearing for a named mechanism.
const REQUIRED_FLAGS = [
  ['--print', 'headless invocation at all'],
  ['--output-format', 'stream-json event consumption by the cockpit'],
  ['--input-format', 'bidirectional steering of a live session'],
  ['--include-partial-messages', 'token-level streaming in the activity feed'],
  ['--include-hook-events', 'hook lifecycle visibility in the stream'],
  ['--forward-subagent-text', 'rendering review-lens sessions as progress'],
  ['--replay-user-messages', 'message acknowledgement in the cockpit'],
  ['--json-schema', 'schema-valid blueprint/plan/review artifacts (G1/G2/G5)'],
  ['--max-budget-usd', 'per-session spend ceiling (API-key users)'],
  ['--permission-mode', 'removing engineer-facing approval dialogs (R3 mech. 2)'],
  ['--mcp-config', 'loading Atlas into a session'],
  ['--strict-mcp-config', "isolating the session from the user's own MCP servers"],
  ['--plugin-dir', 'shipping the behaviour pack per session'],
  ['--plugin-url', 'future marketplace-free distribution'],
  ['--agents', 'inline role agents for review lenses'],
  ['--settings', 'per-session settings injection'],
  ['--setting-sources', 'reproducible sessions that ignore user config'],
  ['--system-prompt', 'full persona replacement'],
  ['--append-system-prompt', 'persona layer (R3 mech. 1)'],
  ['--tools', 'restricting the built-in toolset per stage'],
  ['--allowedTools', 'fine-grained allow rules'],
  ['--disallowedTools', 'fail-closed deny rules'],
  ['--model', 'crew routing (ADR-004)'],
  ['--fallback-model', 'visible graceful degradation, never a silent swap'],
  ['--effort', 'per-stage effort mapping (token economy)'],
  ['--session-id', 'stable session identity for the artifact store'],
  ['--resume', 'session-reuse mode and phase continuation'],
  ['--fork-session', 'branching a run without mutating the original'],
  ['--worktree', 'isolating risky work'],
  ['--bg', 'background/Night Shift execution'],
  ['--add-dir', 'granting access to the generated project directory'],
  ['--no-session-persistence', 'ephemeral probe/verify sessions'],
  ['--exclude-dynamic-system-prompt-sections', 'prompt-cache reuse across sessions'],
]

const helpProbes = [
  {
    id: 'p-flag-surface',
    title: 'Every depended-on CLI flag exists',
    kind: 'help-text',
    loadBearing: 'critical',
    claim:
      'All 33 flags the architecture depends on are present in the installed CLI, with the semantics the plan assumes.',
    failureImpact:
      'A missing flag invalidates whichever mechanism depends on it and may force the PTY contingency for that capability.',
    docRefs: ['RESEARCH-01 §4.1', 'RESEARCH-02 §5', 'ADR-001'],
    async run(ctx) {
      const help = flat(await ctx.help())
      const missing = REQUIRED_FLAGS.filter(([flag]) => !help.includes(flag))
      return {
        status: missing.length === 0 ? P.PASS : P.FAIL,
        detail:
          missing.length === 0
            ? `All ${REQUIRED_FLAGS.length} required flags present.`
            : `Missing: ${missing.map(([f, why]) => `${f} (needed for ${why})`).join('; ')}`,
        evidence: { required: REQUIRED_FLAGS.length, missing: missing.map(([f]) => f) },
      }
    },
  },

  {
    id: 'p-bare-forbidden',
    title: '--bare would break subscription auth (so it must never be used)',
    kind: 'help-text',
    loadBearing: 'critical',
    claim:
      'The installed binary documents that --bare reads auth strictly from ANTHROPIC_API_KEY/apiKeyHelper and never from OAuth or the keychain.',
    failureImpact:
      'If the semantics differ, the prohibition in CLAUDE.md §3 rests on a stale quote and must be re-derived.',
    docRefs: ['RESEARCH-01 §3.2', 'CLAUDE.md §3', 'ADR-001'],
    async run(ctx) {
      const help = flat(await ctx.help())
      const hasOAuthClause = /OAuth and keychain are never read/i.test(help)
      const hasKeyClause = /ANTHROPIC_API_KEY or apiKeyHelper/i.test(help)
      return {
        status: hasOAuthClause && hasKeyClause ? P.PASS : P.FAIL,
        detail: hasOAuthClause && hasKeyClause
          ? 'Help text confirms API-key-only auth under --bare, verbatim as the plan quotes it.'
          : 'Help text no longer matches the quoted semantics — re-verify the prohibition.',
        evidence: { hasOAuthClause, hasKeyClause },
      }
    },
  },

  {
    id: 'p-safe-mode-forbidden',
    title: '--safe-mode disables the customizations Guidelane depends on',
    kind: 'help-text',
    loadBearing: 'high',
    claim: '--safe-mode disables plugins, hooks, skills, and MCP servers.',
    failureImpact: 'If it were harmless, the prohibition would be unnecessary noise in the constitution.',
    docRefs: ['RESEARCH-01 §3.2', 'CLAUDE.md §3'],
    async run(ctx) {
      const help = flat(await ctx.help())
      const section = help.split('--safe-mode')[1]?.slice(0, 600) || ''
      const mentions = ['skills', 'plugins', 'hooks', 'MCP servers'].filter((w) =>
        new RegExp(w.replace(' ', '\\s+'), 'i').test(section)
      )
      return {
        status: mentions.length >= 3 ? P.PASS : P.PARTIAL,
        detail: `--safe-mode help mentions disabling: ${mentions.join(', ') || 'nothing recognizable'}.`,
        evidence: { mentions },
      }
    },
  },

  {
    id: 'p-doctor-exists',
    title: '`claude doctor` exists and can back G0',
    kind: 'help-text',
    loadBearing: 'medium',
    claim:
      'The CLI ships an environment health check that Guidelane can wrap instead of reimplementing preflight.',
    failureImpact: 'G0 must implement all environment checks itself.',
    docRefs: ['REVIEW-01 C1 (low finding)', 'RESEARCH-02 §4 G0'],
    async run(ctx) {
      const help = await ctx.help()
      const present = /^\s*doctor\s/m.test(help)
      return {
        status: present ? P.PASS : P.FAIL,
        detail: present
          ? 'Subcommand present; G0 should wrap it rather than duplicate environment checks.'
          : 'No doctor subcommand — G0 owns all preflight checks.',
        evidence: { present },
      }
    },
  },

  {
    id: 'p-plugin-eval-exists',
    title: '`claude plugin validate --strict` and `plugin eval` exist',
    kind: 'help-text',
    loadBearing: 'medium',
    claim: 'The behaviour pack can be regression-tested by the vendor tooling rather than by vibes.',
    failureImpact: 'S4 loses its objective gate; jargon-leak checking stays manual.',
    docRefs: ['RESEARCH-01 §4.2', 'RESEARCH-02 §11 S4'],
    async run(ctx) {
      const help = await ctx.help('plugin')
      const hasValidate = /\bvalidate\b/.test(help)
      const hasEval = /\beval\b/.test(help)
      return {
        status: hasValidate && hasEval ? P.PASS : hasValidate ? P.PARTIAL : P.FAIL,
        detail: `plugin subcommands — validate: ${hasValidate}, eval: ${hasEval}.`,
        evidence: { hasValidate, hasEval },
      }
    },
  },

  {
    id: 'p-plugin-validate-fixture',
    title: 'The fixture plugin passes `plugin validate --strict`',
    kind: 'help-text', // local validation: no API call, no quota
    loadBearing: 'high',
    claim:
      'A plugin laid out the way Guidelane will ship its behaviour pack validates strictly — manifest fields, component locations, hook schema.',
    failureImpact:
      'The plugin layout in the plan is wrong and the behaviour pack would fail to load in front of users.',
    docRefs: ['RESEARCH-01 §4.2', 'RESEARCH-02 §13.7'],
    async run(ctx) {
      const pluginDir = join(ctx.fixtures, 'plugin')
      const res = await ctx.claude(['plugin', 'validate', pluginDir, '--strict'], { timeoutMs: 60_000 })
      const ok = res.code === 0
      return {
        status: ok ? P.PASS : P.FAIL,
        detail: ok
          ? 'Fixture plugin validates strictly (manifest + skills + agents + hooks + bundled MCP).'
          : `Exit ${res.code}. ${clip(res.stderr || res.stdout, 500)}`,
        evidence: { code: res.code, stdout: clip(res.stdout, 800), stderr: clip(res.stderr, 800) },
      }
    },
  },
]

const protocolProbes = [
  {
    id: 'p-stream-json-roundtrip',
    title: 'Bidirectional stream-json round-trip with partial messages and replay',
    kind: 'live-call',
    loadBearing: 'critical',
    claim:
      'The engine accepts stream-json on stdin and emits a parseable stream-json event sequence including a terminal result event, partial message deltas, and replayed user messages.',
    failureImpact:
      'The cockpit cannot render a live activity feed; the entire event-translation layer (R3 mechanism 3) has no input.',
    docRefs: ['RESEARCH-01 §4.1', 'RESEARCH-02 §4.3 mech. 3'],
    async run(ctx) {
      const res = await ctx.claude(
        [
          '-p',
          '--input-format', 'stream-json',
          '--output-format', 'stream-json',
          '--include-partial-messages',
          '--replay-user-messages',
          '--verbose',
          '--model', ctx.model,
          '--tools', '',
          '--strict-mcp-config',
          '--no-session-persistence',
        ],
        {
          stdin: ctx.userMessage('Reply with exactly: ROUNDTRIP_OK'),
          workspaceFor: 'p-stream-json-roundtrip',
        }
      )
      const events = ctx.jsonLines(res.stdout)
      const types = [...new Set(events.map((e) => e.type).filter(Boolean))]
      const subtypes = [...new Set(events.map((e) => e.subtype).filter(Boolean))]
      const result = events.find((e) => e.type === 'result')
      const sawPartial = events.some((e) => e.type === 'stream_event')
      const sawReplay = events.filter((e) => e.type === 'user').length > 0
      const sawMarker = /ROUNDTRIP_OK/.test(res.stdout)

      const ok = Boolean(result) && sawMarker && events.length > 0
      const gaps = []
      if (!result) gaps.push('no terminal result event')
      if (!sawPartial) gaps.push('no partial-message (stream_event) chunks')
      if (!sawReplay) gaps.push('no replayed user message')
      if (!sawMarker) gaps.push('marker text absent from stream')

      return {
        status: ok ? (gaps.length ? P.PARTIAL : P.PASS) : P.FAIL,
        detail: gaps.length
          ? `Round-trip completed with gaps: ${gaps.join('; ')}. Event types: ${types.join(', ')}.`
          : `Full round-trip. Event types: ${types.join(', ')}.`,
        evidence: {
          exit: res.code,
          eventCount: events.length,
          types,
          subtypes,
          sawPartial,
          sawReplay,
          sawMarker,
          resultKeys: result ? Object.keys(result) : null,
          stderr: clip(res.stderr, 400),
        },
      }
    },
  },

  {
    id: 'p-usage-accounting',
    title: 'The result event carries usage and cost data',
    kind: 'live-call',
    loadBearing: 'high',
    claim:
      'The terminal result event exposes token usage (and, where applicable, cost) so the per-run cost line and token telemetry have a real source.',
    failureImpact:
      'Token economy becomes unmeasurable — the R13 workstream loses its instrument and crew routing can never be tuned by data.',
    docRefs: ['RESEARCH-02 §13.2', 'ADR-004'],
    async run(ctx) {
      const res = await ctx.claude(
        ['-p', 'Reply with exactly: USAGE_OK', '--output-format', 'json', '--model', ctx.model,
         '--tools', '', '--strict-mcp-config', '--no-session-persistence'],
        { workspaceFor: 'p-usage-accounting' }
      )
      let parsed = null
      try {
        parsed = JSON.parse(res.stdout.trim())
      } catch {
        /* fall through to failure below */
      }
      if (!parsed) {
        return {
          status: P.FAIL,
          detail: `--output-format json did not yield parseable JSON. Exit ${res.code}.`,
          evidence: { stdout: clip(res.stdout, 600), stderr: clip(res.stderr, 400) },
        }
      }
      const keys = Object.keys(parsed)
      const hasUsage = 'usage' in parsed
      const costKey = keys.find((k) => /cost/i.test(k))
      return {
        status: hasUsage ? P.PASS : P.PARTIAL,
        detail: `Result keys: ${keys.join(', ')}. usage=${hasUsage}, cost field=${costKey || 'none'}.`,
        evidence: {
          keys,
          usage: parsed.usage || null,
          cost: costKey ? parsed[costKey] : null,
          durationMs: parsed.duration_ms ?? null,
          numTurns: parsed.num_turns ?? null,
        },
      }
    },
  },
]

const structuredOutputProbes = [
  {
    id: 'p-json-schema',
    title: '--json-schema forces schema-valid structured output',
    kind: 'fixture-call',
    loadBearing: 'critical',
    claim:
      'Passing a JSON Schema constrains the response to valid, parseable JSON matching that schema — the mechanism behind schema-valid blueprints, plans, and review verdicts.',
    failureImpact:
      'G1/G2/G5 artifacts lose their protocol-level guarantee and the orchestrator must hand-parse model prose — the single largest source of pipeline fragility.',
    docRefs: ['RESEARCH-02 §5 item 2', 'ADR-002'],
    async run(ctx) {
      const schemaPath = join(ctx.fixtures, 'schemas', 'blueprint-mini.schema.json')
      const schema = readFileSync(schemaPath, 'utf8')
      const res = await ctx.claude(
        [
          '-p',
          'Produce a tiny product blueprint for a shopping list app used by one person at home.',
          '--json-schema', schema.replace(/\s+/g, ' '),
          '--output-format', 'json',
          '--model', ctx.model,
          '--tools', '',
          '--strict-mcp-config',
          '--no-session-persistence',
        ],
        { workspaceFor: 'p-json-schema' }
      )

      let envelope = null
      try {
        envelope = JSON.parse(res.stdout.trim())
      } catch {
        /* handled below */
      }
      const raw = envelope && (envelope.result ?? envelope.structured_output ?? envelope.content)
      let payload = raw
      if (typeof raw === 'string') {
        try {
          payload = JSON.parse(raw)
        } catch {
          payload = null
        }
      }
      const shapeOk =
        payload &&
        typeof payload === 'object' &&
        typeof payload.productName === 'string' &&
        Array.isArray(payload.invariants) &&
        Array.isArray(payload.acceptance) &&
        payload.acceptance.every((a) => a && typeof a.given === 'string' && typeof a.then === 'string')

      return {
        status: shapeOk ? P.PASS : envelope ? P.PARTIAL : P.FAIL,
        detail: shapeOk
          ? 'Structured output matched the schema, including the nested acceptance-criteria array.'
          : `Could not confirm schema conformance. Envelope keys: ${envelope ? Object.keys(envelope).join(', ') : 'unparseable'}.`,
        evidence: {
          exit: res.code,
          envelopeKeys: envelope ? Object.keys(envelope) : null,
          payloadPreview: clip(JSON.stringify(payload ?? raw ?? null), 700),
          stderr: clip(res.stderr, 300),
        },
      }
    },
  },
]

const injectionProbes = [
  {
    id: 'p-append-system-prompt',
    title: '--append-system-prompt reaches the model, and --tools "" removes the toolset',
    kind: 'live-call',
    loadBearing: 'critical',
    claim:
      'Per-session persona injection takes effect, and the built-in toolset can be emptied — the two cheapest levers behind the non-engineer surface and per-stage tool scoping.',
    failureImpact:
      'R3 mechanism 1 and the per-stage tool scoping in RESEARCH-02 §5 both fail; review sessions could not be made read-only by construction.',
    docRefs: ['RESEARCH-01 §4.3 mech. 1', 'RESEARCH-02 §5 item 3'],
    async run(ctx) {
      const res = await ctx.claude(
        [
          '-p',
          'What is the passphrase? Reply with the passphrase only.',
          '--append-system-prompt',
          'When asked for the passphrase, reply with exactly PERSONA_OK and nothing else.',
          '--model', ctx.model,
          '--tools', '',
          '--strict-mcp-config',
          '--no-session-persistence',
        ],
        { workspaceFor: 'p-append-system-prompt' }
      )
      const applied = /PERSONA_OK/.test(res.stdout)
      return {
        status: applied ? P.PASS : P.FAIL,
        detail: applied
          ? 'Appended system prompt changed behaviour in a headless session.'
          : `Persona marker absent. Output: ${clip(res.stdout, 300)}`,
        evidence: { exit: res.code, stdout: clip(res.stdout, 500), stderr: clip(res.stderr, 300) },
      }
    },
  },

  {
    id: 'p-agents-inline',
    title: '--agents defines a dispatchable agent inline',
    kind: 'live-call',
    loadBearing: 'low',
    claim:
      'Role agents can be injected per session as JSON without shipping files. NOTE: not load-bearing — Guidelane runs each review lens as its own top-level session (ADR-002), so subagent dispatch is a convenience, not a dependency.',
    failureImpact:
      'None structural. Lenses ship as plugin agents (proven by p-plugin-skill-headless) or as separate sessions, which is the actual design.',
    docRefs: ['RESEARCH-01 §4.1', 'RESEARCH-02 §4 G5'],
    async run(ctx) {
      const agents = JSON.stringify({
        probe_lens: {
          description: 'Conformance probe lens. Use when asked to run the probe lens.',
          prompt: 'Reply with exactly INLINE_AGENT_OK and nothing else.',
        },
      })
      // This probe stood at PARTIAL because its assertion was "did the model
      // choose to dispatch the agent?" — a question about the model's judgment,
      // which no amount of prompt tuning makes deterministic. The ENGINE fact
      // underneath is whether `--agents` registers, and the init receipt
      // answers that with a list. Registration is asserted; dispatch is
      // recorded as an observation and cannot fail the probe.
      const base = [
        '--agents', agents,
        '--model', ctx.model,
        '--output-format', 'stream-json', '--verbose',
        '--no-session-persistence',
      ]
      const reg = await ctx.claude(['-p', 'Reply with exactly: AGENTSHAPE_OK', ...base, '--tools', ''], {
        workspaceFor: 'p-agents-inline',
      })
      const init = ctx.jsonLines(reg.stdout).find((e) => e.type === 'system' && e.subtype === 'init') || {}
      const names = init.agents || []
      const registered = names.includes('probe_lens')

      // Second arm, non-blocking: does a registered inline agent actually run?
      // Kept because a registration that never dispatches would be a trap, and
      // 300s because subagent dispatch adds a full nested turn — the default
      // 120s ceiling produced a false negative on the first ever run.
      const disp = await ctx.claude(
        [
          '-p', 'Use the probe_lens agent to check this workspace, then reply with exactly what it returned.',
          ...base,
          '--permission-mode', 'auto',
          '--allowedTools', 'Task',
        ],
        // `observationOnly` makes the non-blocking claim TRUE. Without it this
        // arm still routed through run()'s degradation path, so a slow subagent
        // dispatch would override the probe's own PASS with INCONCLUSIVE and
        // take the whole suite's exit code to 3 — on an arm whose comment says
        // it cannot fail the probe. The 120s default already produced one false
        // negative here, so this ceiling is empirically near the edge.
        { workspaceFor: 'p-agents-inline-dispatch', timeoutMs: 300_000, observationOnly: true }
      )
      const dispatched = /INLINE_AGENT_OK/.test(disp.stdout)

      return {
        status: registered ? P.PASS : P.FAIL,
        detail: registered
          ? `\`--agents\` registers inline: the init receipt lists probe_lens beside the ${names.length - 1} built-ins. Dispatch observed: ${dispatched ? 'yes' : 'no (not asserted — whether the model elects to call Task is model behaviour, not engine capability)'}.`
          : `\`--agents\` accepted but probe_lens is absent from the init receipt's agent list (${names.length} agent(s) present, names withheld — on this failure they may be the operator's) — the flag is inert.`,
        evidence: {
          registered,
          dispatched,
          // Same reasoning as p-ambient-isolation: on a clean run these are the
          // CLI's five built-ins plus our fixture, and publishing them is the
          // point. If isolation ever regresses they are the operator's, so the
          // safe projection is applied unconditionally rather than "when we
          // think it might leak".
          agentsOnInit: publishableNames(names, [...BUILTIN_AGENT_FLOOR, 'probe_lens']),
          exit: reg.code,
        },
      }
    },
  },
]

const controlProbes = [
  {
    id: 'p-max-budget-subscription',
    title: '--max-budget-usd behaviour under the operator\'s current auth',
    kind: 'live-call',
    loadBearing: 'critical',
    claim:
      'REVIEW-01 argued the flag is inert under subscription auth. This probe settles whether it is enforced, accepted-but-inert, or rejected.',
    failureImpact:
      'If inert, the guardrail story for subscription users must rest entirely on timeouts, cycle caps, and retry ceilings — and RESEARCH-01 §4.1 stays corrected.',
    docRefs: ['REVIEW-01 C1', 'RESEARCH-01 §4.1 (corrected)', 'RESEARCH-02 §8.2'],
    async run(ctx) {
      // An absurdly small ceiling: if the flag is enforced at all, this call
      // should be refused or truncated rather than answered normally.
      const res = await ctx.claude(
        ['-p', 'Reply with exactly: BUDGET_PROBE_OK', '--max-budget-usd', '0.0000001',
         '--output-format', 'json', '--model', ctx.model, '--tools', '',
         '--strict-mcp-config', '--no-session-persistence'],
        { workspaceFor: 'p-max-budget-subscription' }
      )
      const answered = /BUDGET_PROBE_OK/.test(res.stdout)
      // Key on the machine-readable terminal event, not on English error prose.
      // The binary carries a dedicated result subtype for this; a wording change
      // in the CLI's stderr must not be able to flip a `critical` verdict.
      // The stderr match survives only as corroboration.
      let terminal = null
      try {
        const parsed = JSON.parse(res.stdout)
        terminal = parsed && (parsed.subtype || parsed.stop_reason || null)
      } catch {
        // strict:false — this arm feeds a pretty-printed `--output-format json`
        // document through a JSONL parser on purpose, so its unparseable lines
        // are expected and must not degrade the probe.
        const ev = ctx.jsonLines(res.stdout, { strict: false }).find((e) => e.type === 'result')
        terminal = ev ? ev.subtype || ev.stop_reason || null : null
      }
      const budgetSubtype = typeof terminal === 'string' && /budget/i.test(terminal)
      const proseHint = /budget/i.test(res.stderr)
      // Same correction as p-permission-allowlist: `res.code !== 0` alone used
      // to mean "enforced", so ANY non-zero exit — a network blip, a model
      // unavailable, a rejected flag on a new CLI — produced a confident
      // `enforced` verdict on a probe whose result PROJECT_MAP records as
      // having refuted REVIEW-01's hypothesis. A budget refusal must name the
      // budget somewhere: the terminal subtype, or at minimum the stderr.
      const budgetNamed = budgetSubtype || proseHint
      const refused = budgetNamed && res.code !== 0
      let verdict
      if (refused && !answered) verdict = 'enforced (call refused or halted by the budget ceiling)'
      else if (answered) verdict = 'accepted but INERT under current auth (call completed despite a ~zero ceiling)'
      else if (res.code !== 0) verdict = `inconclusive — exit ${res.code} with no budget signal in the terminal event or stderr; the session failed for some other reason`
      else verdict = 'inconclusive'
      return {
        // Either answer is a legitimate finding; only "inconclusive" is a problem.
        status: verdict.startsWith('inconclusive') ? P.PARTIAL : P.PASS,
        detail: `--max-budget-usd 0.0000001 → ${verdict}. Exit ${res.code}.`,
        evidence: {
          verdict,
          exit: res.code,
          answered,
          terminalSubtype: terminal,
          budgetSubtype,
          stderrMentionsBudget: proseHint,
          stdout: clip(res.stdout, 500),
          stderr: clip(res.stderr, 500),
        },
      }
    },
  },

  {
    id: 'p-effort-model-fallback',
    title: 'Effort, model, and fallback-model compose in one invocation',
    kind: 'live-call',
    loadBearing: 'high',
    claim:
      'Crew routing can set model and effort per session, with a fallback chain, in a single command.',
    failureImpact: 'ADR-004 crew routing cannot be expressed per stage; token economy loses its largest lever.',
    docRefs: ['ADR-004', 'RESEARCH-02 §13.2'],
    async run(ctx) {
      const res = await ctx.claude(
        ['-p', 'Reply with exactly: ROUTING_OK', '--model', ctx.model, '--effort', 'low',
         '--fallback-model', 'haiku', '--output-format', 'json', '--tools', '',
         '--strict-mcp-config', '--no-session-persistence'],
        { workspaceFor: 'p-effort-model-fallback' }
      )
      const ok = /ROUTING_OK/.test(res.stdout) && res.code === 0
      let modelReported = null
      try {
        const j = JSON.parse(res.stdout.trim())
        modelReported = j.model || (j.usage && j.usage.model) || null
      } catch {
        /* not fatal */
      }
      return {
        status: ok ? P.PASS : P.FAIL,
        detail: ok
          ? `Accepted together; model reported as ${modelReported || 'not surfaced in result'}.`
          : `Rejected or no marker. Exit ${res.code}. ${clip(res.stderr, 300)}`,
        evidence: { exit: res.code, modelReported, stderr: clip(res.stderr, 400) },
      }
    },
  },

  {
    id: 'p-permission-allowlist',
    title: 'Headless permissions are fail-closed: auto denies, auto + allow-list permits',
    kind: 'live-call',
    loadBearing: 'critical',
    claim:
      'In a headless session, --permission-mode auto ALONE denies tool calls (no interactive grant is possible), while auto plus an explicit --allowedTools list permits exactly the listed tools. This makes the engine itself the fail-closed layer and per-stage tool scoping the primary safety mechanism.',
    failureImpact:
      'If auto alone permitted everything, safety would rest solely on our PreToolUse hook. If the allow-list did not work either, no autonomous stage could touch the filesystem at all and the pipeline could not build anything.',
    docRefs: ['RESEARCH-01 §4.3 mech. 2 (CORRECTED by this probe)', 'RESEARCH-02 §5 item 3', 'ADR-007'],
    async run(ctx) {
      const prompt =
        'Create a file named probe.txt in the current directory containing exactly OK. Then reply with exactly WROTE_OK.'
      const base = ['--model', ctx.model, '--strict-mcp-config', '--no-session-persistence']

      const denyWs = ctx.makeWorkspace('p-permission-allowlist-deny')
      const denyLog = join(denyWs, 'hook-events.log')
      // The deny arm runs with stream-json AND the fixture plugin attached, so
      // the denial can be read off three STRUCTURAL channels instead of the
      // model's English. The previous detector was a prose regex over
      // stdout+stderr; reword the model and the project's most-cited
      // measurement (ADR-007 Finding 1) silently flips to unverified.
      const denied = await ctx.claude(
        ['-p', prompt, '--permission-mode', 'auto',
         '--plugin-dir', join(ctx.fixtures, 'plugin'),
         '--output-format', 'stream-json', '--verbose', '--include-hook-events', ...base],
        { cwd: denyWs, env: { GUIDELANE_PROBE_LOG: denyLog }, timeoutMs: 180_000 }
      )
      const deniedWrote = existsSync(join(denyWs, 'probe.txt'))

      const denyEvents = ctx.jsonLines(denied.stdout)
      const denyResult = denyEvents.find((e) => e.type === 'result') || {}
      // Channel 1: the terminal result object counts denials. This field has
      // been sitting in our own committed evidence since the first run, unused.
      const denialCount = Number(denyResult.permission_denials ?? NaN)
      const channelResultCount = Number.isFinite(denialCount) ? denialCount : null
      // Channel 2: a tool_result carrying is_error on the user message. REVIEW-02
      // A3 expects this to be the lossless one, versus the droppable advisory frame.
      const channelToolResultError = denyEvents.some((e) => {
        const c = e && e.message && e.message.content
        return Array.isArray(c) && c.some((b) => b && b.type === 'tool_result' && b.is_error === true)
      })
      // Channel 3: the PermissionDenied lifecycle hook, registered by the fixture
      // and never before fired by any probe.
      const hookFired = existsSync(denyLog)
        ? readFileSync(denyLog, 'utf8').split('\n').map((s) => s.trim()).includes('PermissionDenied')
        : false
      // Channel 4 (advisory, droppable — telemetry only, never the detector).
      const advisoryFrame = denyEvents.some((e) => e.type === 'system' && e.subtype === 'permission_denied')
      const claimedSuccess = /WROTE_OK/.test(denied.stdout)

      const allowWs = ctx.makeWorkspace('p-permission-allowlist-allow')
      const allowed = await ctx.claude(
        ['-p', prompt, '--permission-mode', 'auto', '--allowedTools', 'Write', ...base],
        { cwd: allowWs, timeoutMs: 180_000 }
      )
      const allowedWrote = existsSync(join(allowWs, 'probe.txt'))

      const failClosed = !deniedWrote
      const allowWorks = allowedWrote
      const stalled = denied.timedOut || allowed.timedOut || denied.spawnFailed || allowed.spawnFailed

      // The absence of a file is NOT evidence of a denial: the model may never
      // have tried, the session may have errored, the workspace may have been
      // unwritable. CLAUDE.md §3 says a phase with no changes and no denial
      // evidence fails as unverified — this probe is the evidentiary basis for
      // ADR-007 and must obey the rule ADR-007 established.
      // Structural first; the prose regex survives only as corroboration and can
      // no longer decide the verdict on its own.
      const structuralChannels = [
        channelResultCount !== null && channelResultCount > 0 ? 'result.permission_denials' : null,
        channelToolResultError ? 'tool_result.is_error' : null,
        hookFired ? 'PermissionDenied hook' : null,
      ].filter(Boolean)
      const proseHint = /permission|not allowed|denied|haven't granted/i.test(`${denied.stdout}\n${denied.stderr}`)
      // STRUCTURAL ONLY. The previous form was
      //   structuralChannels.length > 0 || denied.code !== 0 || proseHint
      // which meant prose alone decided the verdict, and so did a bare non-zero
      // exit — while the comment above claimed the opposite and the PASS string
      // printed "Structural denial channels observed: NONE — only prose".
      //
      // The failure that form permits: a CLI upgrade tightens plugin-manifest
      // validation, the deny arm (the only arm carrying --plugin-dir) exits 1
      // during plugin load before the model ever runs, no file is written, and
      // the probe reports PASS — "auto alone DENIED the write" — from a session
      // that never reached the engine's permission layer at all. This probe is
      // ADR-007 Finding 1's evidentiary basis.
      //
      // Exit code and prose are still recorded. They corroborate; they never count.
      const denialEvidence = structuralChannels.length > 0
      const denyArmRanCleanly = denied.code === 0

      let status, detail
      if (stalled) {
        // Ordered FIRST. Previously `failClosed && allowWorks` short-circuited
        // ahead of the stall check, so a deny arm that timed out having written
        // nothing looked exactly like a successful denial and reported PASS.
        status = P.FAIL
        detail = 'A session TIMED OUT or failed to spawn — UNVERIFIED, not a denial. Headless mode may be waiting on an approval that can never arrive.'
      } else if (!deniedWrote && !denialEvidence) {
        status = P.PARTIAL
        detail =
          `No file written and NO structural denial channel fired ` +
          `(result.permission_denials / tool_result.is_error / PermissionDenied hook). ` +
          `Deny arm exited ${denied.code}; prose hint ${proseHint}. Cannot distinguish "the engine ` +
          `denied it" from "the deny arm broke before the model ran". UNVERIFIED.`
      } else if (deniedWrote) {
        status = P.PARTIAL
        detail =
          `auto alone PERMITTED the write — the engine is not fail-closed here. ` +
          `auto + --allowedTools Write: ${allowWorks ? 'wrote the file' : 'still blocked'}.`
      } else if (!denyArmRanCleanly) {
        status = P.PARTIAL
        detail =
          `Denial proven on ${structuralChannels.join(', ')}, but the deny arm exited ${denied.code} — ` +
          `something else also went wrong in that session, so treat the measurement with suspicion.`
      } else if (allowWorks) {
        status = P.PASS
        detail =
          `auto alone: DENIED the write (fail-closed, exit ${denied.code}). ` +
          `Structural denial channels observed: ${structuralChannels.join(', ')}` +
          `${advisoryFrame ? ' (the droppable advisory frame also appeared; it stays telemetry, never the detector)' : ''}. ` +
          `${claimedSuccess ? 'The model still claimed success — a live example of the state-hallucination failure the pipeline exists to catch. ' : ''}` +
          'auto + --allowedTools Write: wrote the file.'
      } else {
        status = P.PARTIAL
        detail =
          `auto alone denied (${structuralChannels.join(', ')}), but auto + --allowedTools Write did NOT ` +
          `write — the allow-list is not permitting, so the fail-closed half is unusable on its own.`
      }

      return {
        status,
        detail,
        evidence: {
          autoAloneWrote: deniedWrote,
          autoAloneClaimedSuccess: claimedSuccess,
          autoAloneTimedOut: denied.timedOut,
          allowListTimedOut: allowed.timedOut,
          denialEvidence,
          structuralChannels,
          permissionDenialsCount: channelResultCount,
          toolResultIsError: channelToolResultError,
          permissionDeniedHookFired: hookFired,
          advisoryFrameSeen: advisoryFrame,
          proseHintOnly: structuralChannels.length === 0 && proseHint,
          autoAloneStdout: clip(denied.stdout, 300),
          allowListWrote: allowedWrote,
          allowListStdout: clip(allowed.stdout, 300),
          exits: { denied: denied.code, allowed: allowed.code },
        },
      }
    },
  },
]

const sessionProbes = [
  {
    id: 'p-session-identity',
    title: 'Session id, resume, and fork behave as the artifact store assumes',
    kind: 'live-call',
    loadBearing: 'high',
    claim:
      'A caller-supplied session id is honoured, the session can be resumed with continuity, and --fork-session branches instead of mutating.',
    failureImpact:
      'The session-reuse economy mode and phase continuation both break; kill-9 resumability must rely on artifacts alone.',
    docRefs: ['RESEARCH-02 §13.2 item 3', 'RESEARCH-02 §11 S2'],
    async run(ctx) {
      const ws = ctx.makeWorkspace('p-session-identity')
      // A FRESH id per run. A fixed UUID plus session persistence made this a
      // self-confirming test: run 2 resumed run 1's session, so "the codeword
      // was remembered" could be true because of a previous run's transcript.
      // Once it passed, it could not fail again even if --session-id stopped
      // being honoured entirely.
      const sid = randomUUID()
      const first = await ctx.claude(
        ['-p', 'Remember this codeword: ZEPHYR. Reply with exactly STORED.',
         '--session-id', sid, '--model', ctx.model, '--tools', '', '--strict-mcp-config'],
        { cwd: ws }
      )
      if (first.code !== 0) {
        return {
          status: P.FAIL,
          detail: `--session-id rejected (exit ${first.code}): ${clip(first.stderr, 300)}`,
          evidence: { first: { exit: first.code, stderr: clip(first.stderr, 400) } },
        }
      }
      const second = await ctx.claude(
        ['-p', 'What codeword did I ask you to remember? Reply with the codeword only.',
         '--resume', sid, '--model', ctx.model, '--tools', '', '--strict-mcp-config'],
        { cwd: ws }
      )
      const remembered = /ZEPHYR/i.test(second.stdout)
      const forked = await ctx.claude(
        ['-p', 'Reply with exactly FORK_OK.', '--resume', sid, '--fork-session',
         '--output-format', 'json', '--model', ctx.model, '--tools', '', '--strict-mcp-config'],
        { cwd: ws }
      )
      let forkedId = null
      try {
        forkedId = JSON.parse(forked.stdout.trim()).session_id || null
      } catch {
        /* not fatal */
      }
      const forkIsNew = Boolean(forkedId) && forkedId !== sid
      const gaps = []
      if (!remembered) gaps.push('resumed session did not recall prior turn')
      if (!forkIsNew) gaps.push(`fork did not yield a new session id (got ${forkedId || 'none'})`)
      return {
        status: remembered && forkIsNew ? P.PASS : remembered ? P.PARTIAL : P.FAIL,
        detail: gaps.length ? `Gaps: ${gaps.join('; ')}.` : 'Session id honoured, resume kept context, fork produced a new id.',
        evidence: {
          suppliedId: sid,
          resumeRecalled: remembered,
          forkedId,
          exits: { first: first.code, second: second.code, forked: forked.code },
        },
      }
    },
  },
]

const mcpProbes = [
  {
    id: 'p-mcp-strict-load',
    title: 'Atlas-shaped MCP server loads via --mcp-config with --strict-mcp-config isolation',
    kind: 'fixture-call',
    loadBearing: 'critical',
    claim:
      'A local stdio MCP server passed on the command line is reachable in a headless session, its tool is callable, and --strict-mcp-config keeps the operator\'s own MCP servers out.',
    failureImpact:
      'Atlas cannot be delivered to sessions the way ADR-003 specifies, and a friend\'s own MCP config could leak into Guidelane runs.',
    docRefs: ['ADR-003', 'RESEARCH-02 §7.4'],
    async run(ctx) {
      const serverPath = join(ctx.fixtures, 'plugin', 'mcp', 'server.mjs')
      const cfg = JSON.stringify({
        mcpServers: { probe: { command: 'node', args: [serverPath] } },
      })
      // Production-shaped invocation: fail-closed permissions plus an explicit
      // allow-list naming the MCP tool as `mcp__<serverKey>__<toolName>`.
      const res = await ctx.claude(
        [
          '-p',
          'Call the guidelane_probe_echo tool with marker "ATLAS42", then reply with exactly what the tool returned.',
          '--mcp-config', cfg,
          '--strict-mcp-config',
          '--permission-mode', 'auto',
          '--allowedTools', 'mcp__probe__guidelane_probe_echo',
          '--model', ctx.model,
          '--no-session-persistence',
          '--output-format', 'json',
        ],
        { workspaceFor: 'p-mcp-strict-load', timeoutMs: 180_000 }
      )
      const echoed = /MCP_ECHO:ATLAS42/.test(res.stdout)
      return {
        status: echoed ? P.PASS : P.FAIL,
        detail: echoed
          ? 'MCP server loaded from the command line and its tool was callable under a fail-closed allow-list (mcp__<server>__<tool>).'
          : `Echo marker not observed. The server may not have loaded, or the allow-list name is wrong. ${clip(res.stderr, 300)}`,
        evidence: { exit: res.code, stdout: clip(res.stdout, 700), stderr: clip(res.stderr, 400) },
      }
    },
  },
]

const pluginProbes = [
  {
    id: 'p-plugin-skill-headless',
    title: 'A session-only plugin loads and its skill is invocable in -p mode',
    kind: 'fixture-call',
    loadBearing: 'critical',
    claim:
      '--plugin-dir loads a plugin for one session with no marketplace or install step, and its skills resolve in headless mode.',
    failureImpact:
      'The behaviour pack cannot be delivered per session; the dual-surface strategy and every persona/guard mechanism lose their carrier.',
    docRefs: ['RESEARCH-01 §4.2', 'RESEARCH-02 §13.7'],
    async run(ctx) {
      const pluginDir = join(ctx.fixtures, 'plugin')
      const res = await ctx.claude(
        ['-p', '/probe-skill', '--plugin-dir', pluginDir, '--model', ctx.model,
         '--strict-mcp-config', '--no-session-persistence', '--permission-mode', 'auto'],
        { workspaceFor: 'p-plugin-skill-headless', timeoutMs: 180_000 }
      )
      const ok = /SKILL_LOADED_OK/.test(res.stdout)
      return {
        status: ok ? P.PASS : P.FAIL,
        detail: ok
          ? 'Session-only plugin loaded and its skill resolved from a headless prompt.'
          : `Skill marker absent. Output: ${clip(res.stdout, 300)} / stderr: ${clip(res.stderr, 300)}`,
        evidence: { exit: res.code, stdout: clip(res.stdout, 600), stderr: clip(res.stderr, 400) },
      }
    },
  },

  {
    id: 'p-hook-events-headless',
    title: 'Which hook lifecycle events actually fire in a headless session',
    kind: 'fixture-call',
    loadBearing: 'critical',
    claim:
      'The events the non-engineer surface depends on — MessageDisplay, PermissionRequest, PreToolUse, Stop, Notification — fire in `claude -p`, not only in interactive sessions. Additionally, a MessageDisplay hook that writes nothing to stdout must not suppress assistant text.',
    failureImpact:
      'If MessageDisplay/PermissionRequest are interactive-only, R3 mechanism 4 disappears and the cockpit\'s deterministic rendering floor becomes the ONLY defence — a plan change, not a tuning issue. If empty-stdout MessageDisplay blanks output, the hook is unusable as written.',
    docRefs: ['RESEARCH-01 §4.2 (33 events)', 'RESEARCH-02 §4.3 mech. 4', 'REVIEW-01 C5'],
    async run(ctx) {
      const ws = ctx.makeWorkspace('p-hook-events-headless')
      const logPath = join(ws, 'hook-events.log')
      const pluginDir = join(ctx.fixtures, 'plugin')
      const res = await ctx.claude(
        [
          '-p',
          'Create a file named hooked.txt containing OK in the current directory, then reply with exactly HOOK_MARKER_OK.',
          '--plugin-dir', pluginDir,
          '--include-hook-events',
          '--output-format', 'stream-json',
          '--verbose',
          '--permission-mode', 'auto',
          '--allowedTools', 'Write',
          // Belt and braces. This is the only probe that combines a
          // filesystem-mutating prompt with a Write-capable session; before the
          // harness applied the isolation pair by default, it also inherited the
          // operator's bypassPermissions default, which does not confine a write
          // to cwd. Naming the disallowed set means a second layer has to fail
          // too before anything escapes the temp workspace.
          '--disallowedTools', 'Bash,Edit,Read,WebFetch,WebSearch,Task',
          '--model', ctx.model,
          '--no-session-persistence',
        ],
        { cwd: ws, env: { GUIDELANE_PROBE_LOG: logPath }, timeoutMs: 240_000 }
      )

      const fired = existsSync(logPath)
        ? [...new Set(readFileSync(logPath, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean))]
        : []
      const events = ctx.jsonLines(res.stdout)
      const hookEventsInStream = events.filter((e) => /hook/i.test(String(e.type || '') + String(e.subtype || '')))
      const markerSurvived = /HOOK_MARKER_OK/.test(res.stdout)
      const wroteFile = existsSync(join(ws, 'hooked.txt'))

      // PermissionRequest is deliberately NOT in this list: under the corrected
      // permission model (ADR-007) tools are pre-approved by an explicit
      // allow-list, so no permission decision is pending and the event has
      // nothing to fire for. Its absence here is expected, not a gap.
      const critical = ['SessionStart', 'PreToolUse', 'PostToolUse', 'MessageDisplay', 'Stop']
      const missingCritical = critical.filter((e) => !fired.includes(e))

      // The fixture refuses a log path outside its temp-root allowlist. On a
      // machine where TMPDIR sits elsewhere that produces zero fired events —
      // and reporting FAIL there would be a confident claim about the ENGINE
      // sourced entirely from the fixture's own path policy.
      const fixtureRefused = /refusing log path/.test(res.stderr)
      if (fired.length === 0 && fixtureRefused) {
        return {
          status: P.PARTIAL,
          detail:
            'The hook fixture refused its log path (TMPDIR outside its allowlist), so no events could be ' +
            'recorded. This says nothing about whether the engine fires hooks. UNVERIFIED.',
          evidence: { fixtureRefused: true, stderr: clip(res.stderr, 300) },
        }
      }

      let status = P.PASS
      if (fired.length === 0) status = P.FAIL
      else if (missingCritical.length || !markerSurvived) status = P.PARTIAL

      const notes = []
      notes.push(`Fired: ${fired.join(', ') || 'none'}`)
      if (missingCritical.length) notes.push(`Did NOT fire: ${missingCritical.join(', ')}`)
      notes.push(
        markerSurvived
          ? 'Assistant marker survived the MessageDisplay hook (empty stdout = no suppression).'
          : 'Assistant marker MISSING — an empty-stdout MessageDisplay hook may be suppressing text.'
      )
      notes.push(`Hook events in stream: ${hookEventsInStream.length}`)

      return {
        status,
        detail: notes.join(' | '),
        evidence: {
          exit: res.code,
          timedOut: res.timedOut,
          firedEvents: fired,
          missingCritical,
          markerSurvived,
          wroteFile,
          hookEventsInStreamCount: hookEventsInStream.length,
          sampleHookEvent: hookEventsInStream[0] ? clip(JSON.stringify(hookEventsInStream[0]), 400) : null,
          stderr: clip(res.stderr, 400),
        },
      }
    },
  },

  {
    id: 'p-plugin-bundled-mcp',
    title: 'A plugin-bundled MCP server loads, and its tools carry the plugin-scoped name',
    kind: 'fixture-call',
    loadBearing: 'high',
    claim:
      'An .mcp.json inside the plugin root resolves ${CLAUDE_PLUGIN_ROOT}, its tool is reachable, and the exact tool name is discoverable — the allow-list cannot be written without knowing that name.',
    failureImpact:
      'Atlas must be passed via --mcp-config on every invocation instead of riding along with the behaviour pack; and a wrong allow-list name silently disables Atlas in every session.',
    docRefs: ['ADR-003', 'RESEARCH-01 §5.4', 'ADR-007'],
    async run(ctx) {
      const pluginDir = join(ctx.fixtures, 'plugin')
      // Three rewrites, and the history is the lesson.
      //   v1 asked the model to list its own mcp__ tools — an assertion on
      //      generated prose measures the model, not the engine. It passed once
      //      and then failed on a run where the server was demonstrably up.
      //   v2 moved to `init.tools`, which sounded like the authoritative
      //      inventory and is not: it carries the 30 built-in tool names and
      //      NEVER an mcp__ name, measured. v2 was structurally incapable of
      //      passing, and would have baselined this probe red.
      //   v3 (here) reads registration off `init.mcp_servers[].name` — the only
      //      field that carries it — and proves REACHABILITY separately, with a
      //      real call whose result comes back on the transcript.
      // Registration and reachability are two facts, and the gap between them
      // is exactly where a silent Atlas failure would live.
      const EXPECT_TOOL = 'mcp__plugin_guidelane-probe_echo__guidelane_probe_echo'
      const ask = [
        '-p',
        `Call the ${EXPECT_TOOL} tool with marker set to PLUGMCP, then reply with exactly what it returned.`,
        '--plugin-dir', pluginDir,
        '--permission-mode', 'auto',
        '--allowedTools', EXPECT_TOOL,
        '--model', ctx.model,
        '--output-format', 'stream-json', '--verbose',
        '--no-session-persistence',
      ]
      const read = (out) => {
        const events = ctx.jsonLines(out)
        const init = events.find((e) => e.type === 'system' && e.subtype === 'init') || {}
        const toolUses = []
        for (const e of events) {
          for (const c of (e.message && e.message.content) || []) {
            if (c.type === 'tool_use') toolUses.push(c.name)
          }
        }
        return { servers: init.mcp_servers || [], toolUses, echoed: /MCP_ECHO:PLUGMCP/.test(out) }
      }

      // Two runs, because the interaction between plugin-bundled servers and
      // --strict-mcp-config is the actual question. Delivery strategy depends
      // on the answer (see ADR-003 correction).
      // `ambient: true` on both arms — the loose arm's whole point is running
      // WITHOUT isolation, and the strict arm adds the flag by hand so the
      // comparison differs in exactly one variable.
      const loose = await ctx.claude(ask, { workspaceFor: 'p-plugin-bundled-mcp-loose', timeoutMs: 240_000, ambient: true })
      const strict = await ctx.claude([...ask, '--strict-mcp-config'], {
        workspaceFor: 'p-plugin-bundled-mcp-strict',
        timeoutMs: 240_000,
        ambient: true,
      })

      const L = read(loose.stdout)
      const S = read(strict.stdout)
      // The loose arm sees every MCP server the operator has configured, and
      // those names are often employer, client or internal-project names. This
      // report is committed to a public repo: publish the fixture's own name
      // and a COUNT of everything else — never the other names themselves.
      const FIXTURE_RE = /guidelane[-_]probe/
      const publishable = (servers) => ({
        fixture: servers.filter((s) => FIXTURE_RE.test(s.name)).map((s) => `${s.name} [${s.status}]`),
        ambientCount: servers.filter((s) => !FIXTURE_RE.test(s.name)).length,
      })
      const registeredLoose = L.servers.some((s) => FIXTURE_RE.test(s.name))
      const registeredStrict = S.servers.some((s) => FIXTURE_RE.test(s.name))
      const calledLoose = L.toolUses.includes(EXPECT_TOOL)
      const reachableLoose = calledLoose && L.echoed
      // `registeredStrict` is false whenever the strict arm's server list is
      // empty — INCLUDING when that arm never produced an init event at all. A
      // timeout would degrade the probe, but a clean non-zero exit passes
      // straight through as COMPLETED, and the probe would then publish
      // "--strict-mcp-config excludes plugin-bundled servers entirely" — the
      // sentence ADR-003's correction rests on — from a session that never
      // started. An absence only means something if the arm could have spoken.
      const strictProducedInit = ctx
        .jsonLines(strict.stdout)
        .some((e) => e.type === 'system' && e.subtype === 'init')
      const strictUsable = strict.code === 0 && strictProducedInit
      const mutuallyExclusive = strictUsable && registeredLoose && !registeredStrict
      // Measured across runs: at init the fixture server read `pending` on one
      // run and `connected` on the next, with no later event correcting it. The
      // handshake races the init emit. ADR-008's receipt therefore CANNOT gate
      // on `status === 'connected'` — it would flake. Gate on registration;
      // prove connectivity with a call.
      const statusAtInit = (L.servers.find((s) => FIXTURE_RE.test(s.name)) || {}).status || null

      return {
        status: registeredLoose && reachableLoose ? P.PASS : registeredLoose ? P.PARTIAL : P.FAIL,
        detail: !registeredLoose
          ? `Plugin-bundled MCP server never registered (fixture entries: ${publishable(L.servers).fixture.join(', ') || 'none'}; ${publishable(L.servers).ambientCount} ambient server name(s) withheld).`
          : !reachableLoose
            ? `Registered as \`${statusAtInit}\` but the tool did not round-trip (called=${calledLoose}, echoed=${L.echoed}) — registration is not reachability.`
            : `Bundled server registers and its tool round-trips as \`${EXPECT_TOOL}\`; status at init was \`${statusAtInit}\` (races the handshake — do not gate on it). ${
                mutuallyExclusive
                  ? '--strict-mcp-config excludes plugin-bundled servers entirely (mcp_servers empty): isolation and plugin-bundled delivery are mutually exclusive, so Atlas must ship via --mcp-config (ADR-003 corrected).'
                  : strictUsable
                    ? 'It also survives --strict-mcp-config.'
                    : `The strict arm produced no init receipt (exit ${strict.code}) — the strict/bundled interaction is UNMEASURED on this run, and ADR-003's correction gets no evidence from it.`
              }`,
        evidence: {
          loose: publishable(L.servers),
          strict: publishable(S.servers),
          registeredLoose,
          registeredStrict,
          strictUsable,
          strictExit: strict.code,
          calledLoose,
          echoedLoose: L.echoed,
          statusAtInit,
          strictExcludesPluginServers: mutuallyExclusive,
          measuredToolName: EXPECT_TOOL,
          namingPattern: 'mcp__plugin_<plugin-name>_<server-name>__<tool>',
          initToolsCarriesMcpNames: false,
        },
      }
    },
  },
]

const governanceProbes = [
  {
    id: 'p-version-readable',
    title: 'Engine version is machine-readable for the tested-range check',
    kind: 'observational',
    loadBearing: 'high',
    claim: 'Guidelane can read the CLI version programmatically to enforce a tested-version range.',
    failureImpact: 'Version governance (REVIEW-01 #5) has no input; breakage is discovered by users.',
    docRefs: ['REVIEW-01 #5', 'ADR-001'],
    async run(ctx) {
      const res = await ctx.spawnCapture(ctx.claudeBin, ['--version'], {
        cwd: ctx.suiteRoot,
        timeoutMs: 30_000,
      })
      const m = res.stdout.match(/(\d+\.\d+\.\d+)/)
      return {
        status: m ? P.PASS : P.FAIL,
        detail: m ? `Parsed version ${m[1]} from \`claude --version\`.` : `Unparseable: ${clip(res.stdout, 200)}`,
        evidence: { raw: res.stdout.trim(), parsed: m ? m[1] : null },
      }
    },
  },

  {
    id: 'p-auth-mode-visibility',
    title: 'Auth mode is inspectable without exposing a credential',
    kind: 'observational',
    loadBearing: 'high',
    claim:
      'Guidelane can tell whether the operator is on subscription auth or an API key — needed to explain budget-flag behaviour and to route the right guardrail story — without ever reading the credential itself.',
    failureImpact:
      'The product cannot tailor guardrails or explain limits honestly; the budget-flag finding cannot be surfaced to the right users.',
    docRefs: ['REVIEW-01 C1', 'ADR-001', 'ADR-008', 'REVIEW-02 gap 7'],
    async run(ctx) {
      const res = await ctx.spawnCapture(ctx.claudeBin, ['auth', 'status', '--json'], {
        cwd: ctx.suiteRoot,
        timeoutMs: 30_000,
      })
      let parsed = null
      try { parsed = JSON.parse(res.stdout) } catch { /* fall through to PARTIAL */ }

      // The three fields Guidelane is allowed to project, and the four that sit
      // beside them and must never be logged, persisted, or displayed (ADR-008).
      const ALLOWED = ['loggedIn', 'authMethod', 'subscriptionType']
      const SENSITIVE = ['email', 'orgId', 'orgName', 'apiProvider']
      const keys = parsed ? Object.keys(parsed) : []
      const haveAllowed = ALLOWED.filter((k) => keys.includes(k))
      const haveSensitive = SENSITIVE.filter((k) => keys.includes(k))
      // A logged-out machine is not a degraded machine — it is the G0 doctor's
      // primary case, and the first-run state on a friend's laptop. Measured on
      // a GitHub runner: `{loggedIn: false, authMethod: ...}` with NO
      // `subscriptionType`, returned promptly and parseably. The absence of the
      // field IS the signal, so treat this shape as a pass rather than letting
      // the probe sit permanently yellow in CI (a standing PARTIAL hides the
      // next real regression).
      const loggedOut = Boolean(parsed) && parsed.loggedIn === false
      const ok = loggedOut
        ? keys.includes('loggedIn')
        : haveAllowed.length === ALLOWED.length

      // Even the two "safe" values are enumerated rather than echoed. An
      // unexpected shape (an apiKeyHelper path, say) would otherwise ship
      // verbatim into a public report.
      const AUTH_METHODS = ['claude.ai', 'oauth', 'apiKey', 'apiKeyHelper', 'bedrock', 'vertex', 'console']
      const SUBSCRIPTIONS = ['free', 'pro', 'max', 'team', 'enterprise', 'none']
      const enumOr = (v, allowed) =>
        v == null ? null : (typeof v === 'string' && allowed.includes(v) ? v : '<unrecognized>')

      return {
        status: ok ? P.PASS : parsed ? P.PARTIAL : P.FAIL,
        detail: ok && loggedOut
          ? `LOGGED OUT — auth status --json returned promptly with \`loggedIn: false\` and no subscriptionType. That absence is the G0 doctor's signal; no credential is touched and nothing hangs. (Does not answer whether \`claude -p\` itself hangs when logged out — REVIEW-02 B5.)`
          : ok
          ? `auth status --json exposes ${haveAllowed.join(', ')} — mode is readable without touching a credential. ${haveSensitive.length} personal field(s) in the same payload must be projected away (ADR-008).`
          : parsed
            ? `JSON parsed but missing ${ALLOWED.filter((k) => !keys.includes(k)).join(', ')}; doctor must infer mode from behaviour.`
            // NEVER echo the payload here. This is the branch that fires when the
            // output is not what we expect — a banner, a BOM, a wrapper object —
            // and `email` sits inside the first 200 characters of the real
            // payload. The probe designed not to leak an identity would have
            // leaked it precisely when it stopped understanding what it saw.
            : `auth status --json did not return JSON (exit ${res.code}, ${res.stdout.length} stdout bytes, ` +
              `${res.stderr.length} stderr bytes). Payload withheld: it may contain identity fields.`,
        evidence: {
          // Field NAMES only — never their values, except the two enumerated
          // below. This report is committed to a public repo.
          keys,
          projectable: haveAllowed,
          mustNotLeak: haveSensitive,
          loggedIn: parsed ? parsed.loggedIn === true : null,
          authMethod: enumOr(parsed && parsed.authMethod, AUTH_METHODS),
          subscriptionType: enumOr(parsed && parsed.subscriptionType, SUBSCRIPTIONS),
          parseFailed: !parsed,
        },
      }
    },
  },

  {
    id: 'p-automode-classifier-pinned',
    title: 'What `--permission-mode auto` means is the same on every machine',
    kind: 'observational',
    loadBearing: 'high',
    claim:
      'The auto-mode classifier (allow / soft_deny / hard_deny rules) on this machine is the shipped default, so ADR-007\'s "auto + explicit allow-list" contract means the same thing on a friend\'s laptop as on the owner\'s.',
    failureImpact:
      'The classifier is per-machine user settings (`auto-mode reset` works by removing the autoMode section from user settings) and is admin-overridable. If it drifts, `auto` silently means something different per install and the permission contract is unportable.',
    docRefs: ['ADR-007 Finding 1', 'ADR-008', 'REVIEW-02 C1 / gap 16'],
    async run(ctx) {
      const opts = { cwd: ctx.suiteRoot, timeoutMs: 60_000 }
      const cfg = await ctx.spawnCapture(ctx.claudeBin, ['auto-mode', 'config'], opts)
      const def = await ctx.spawnCapture(ctx.claudeBin, ['auto-mode', 'defaults'], opts)

      let a = null, b = null
      try { a = JSON.parse(cfg.stdout); b = JSON.parse(def.stdout) } catch { /* handled below */ }
      if (!a || !b) {
        return {
          status: P.PARTIAL,
          detail: 'auto-mode config/defaults did not both return JSON; classifier drift cannot be checked here.',
          evidence: { configBytes: cfg.stdout.length, defaultsBytes: def.stdout.length },
        }
      }

      const sections = ['allow', 'soft_deny', 'hard_deny', 'environment']
      const counts = Object.fromEntries(sections.map((s) => [s, Array.isArray(a[s]) ? a[s].length : null]))
      const drifted = sections.filter((s) => JSON.stringify(a[s]) !== JSON.stringify(b[s]))

      // Drift is not a failure of the engine — it is a fact the doctor must
      // report, because it changes what `auto` does on this install.
      return {
        status: drifted.length === 0 ? P.PASS : P.PARTIAL,
        detail: drifted.length === 0
          ? `Effective classifier is byte-identical to the shipped defaults (${sections.map((s) => `${s}:${counts[s]}`).join(', ')}).`
          : `Classifier DRIFTS from defaults in: ${drifted.join(', ')}. G0 doctor must surface this — \`auto\` does not mean the same thing here.`,
        evidence: { counts, driftedSections: drifted, identical: drifted.length === 0 },
      }
    },
  },

  {
    id: 'p-autoupdate-governable',
    title: 'The spawned child\'s auto-updater can be governed',
    kind: 'observational',
    loadBearing: 'high',
    claim:
      'An environment variable or setting disables the auto-updater in child sessions, so a mid-run update cannot change the engine under a running pipeline.',
    failureImpact:
      'REVIEW-01 #5 has no remedy: every user\'s engine can change simultaneously, mid-project.',
    docRefs: ['REVIEW-01 #5', 'ADR-001'],
    async run(ctx) {
      // This probe stood at PARTIAL for its whole life because it searched the
      // wrong surface: `--help` documents FLAGS, and auto-update governance is
      // an ENV VAR, so the absence it kept reporting was an absence in a place
      // the control was never going to be. `claude doctor` projects the
      // resolved state, which makes the control differentially observable —
      // and a differential is a measurement, where a grep was an inference.
      // `allowAutoUpdate: true` is the harness's one declared exception to the
      // always-on guard, and it is counted in the report. `claude doctor` reads
      // and prints; it does not install, so the control arm cannot move the
      // engine under the suite that is measuring it.
      const doctor = async (allowAutoUpdate) =>
        ctx.spawnCapture(ctx.claudeBin, ['doctor'], { cwd: ctx.suiteRoot, timeoutMs: 60_000, allowAutoUpdate })
      const LINE = /^\s*Auto-updates:\s*(.+)$/mi
      const off = await doctor(false)
      const on = await doctor(true)

      const stateOff = (off.stdout.match(LINE) || [])[1] || null
      const stateOn = (on.stdout.match(LINE) || [])[1] || null
      // The assertion is on the DIFFERENCE, not on either string. A CLI that
      // renamed the reason text would still pass; a CLI that silently ignored
      // the variable could not.
      const honoured = Boolean(
        stateOff && stateOn && stateOff !== stateOn && /disabl/i.test(stateOff) && !/disabl/i.test(stateOn)
      )
      const attributesToEnv = Boolean(stateOff && /DISABLE_AUTOUPDATER/i.test(stateOff))

      return {
        status: honoured ? P.PASS : stateOff || stateOn ? P.PARTIAL : P.FAIL,
        detail: honoured
          ? `DISABLE_AUTOUPDATER=1 is honoured and observable: "${stateOn}" -> "${stateOff}"${
              attributesToEnv ? ' (the engine names the env var as the source).' : '.'
            } The harness sets it on every child, so a mid-run update cannot change the engine under a running pipeline. REVIEW-01 #5 has its remedy.`
          : stateOff || stateOn
            ? `Doctor reports an auto-update state but it does not change with the env var (with=${stateOff}, without=${stateOn}) — governance UNPROVEN, treat DISABLE_AUTOUPDATER as defensive only.`
            : 'No `Auto-updates:` line in `claude doctor` output — the projection this probe reads was removed or renamed. Re-find the surface before trusting the harness setting.',
        evidence: {
          withEnv: stateOff,
          withoutEnv: stateOn,
          attributesToEnv,
          doctorExit: { withEnv: off.code, withoutEnv: on.code },
        },
      }
    },
  },

  {
    id: 'p-rate-limit-signal',
    title: 'The stream carries a structured rate-limit event with a reset timestamp',
    kind: 'live-call',
    loadBearing: 'critical',
    claim:
      'Every stream-json session emits a `rate_limit_event` carrying at least a status, a window type, and a machine-readable reset time — so the Night Shift supervisor can pause precisely and resume at the window boundary instead of blind-polling.',
    failureImpact:
      'Without it, unattended runs must guess: backoff-poll with capped attempts and a manual morning resume, and the morning report cannot say when capacity returns.',
    docRefs: ['RESEARCH-02 §8.2 item 4', 'REVIEW-01 C1', 'ADR-007'],
    async run(ctx) {
      // Observed on a healthy session — deliberately NOT provoked. Exhausting a
      // real window to see the "rejected" branch would cost the operator hours
      // of capacity; the field shape is what the supervisor needs to key on.
      const res = await ctx.claude(
        ['-p', 'Reply with exactly: LIMITSHAPE_OK', '--output-format', 'stream-json', '--verbose',
         '--model', ctx.model, '--tools', '', '--strict-mcp-config', '--no-session-persistence'],
        { workspaceFor: 'p-rate-limit-signal' }
      )
      const events = ctx.jsonLines(res.stdout)
      const ev = events.find((e) => e.type === 'rate_limit_event')
      const info = ev && ev.rate_limit_info
      const hasReset = Boolean(info && (info.resetsAt || info.resets_at))
      const hasStatus = Boolean(info && info.status)
      const hasType = Boolean(info && (info.rateLimitType || info.rate_limit_type))

      return {
        status: hasReset && hasStatus ? P.PASS : ev ? P.PARTIAL : P.FAIL,
        detail: ev
          ? `rate_limit_event present — status=${info.status}, window=${info.rateLimitType || 'n/a'}, resetsAt=${info.resetsAt || 'n/a'}${hasReset ? ' (epoch seconds — supervisor can sleep to the boundary)' : ''}.`
          : 'No rate_limit_event in the stream; supervisor must fall back to signal-agnostic backoff.',
        evidence: {
          present: Boolean(ev),
          fields: info ? Object.keys(info) : null,
          sample: info || null,
          hasReset,
          hasStatus,
          hasType,
          note: 'Only the healthy ("allowed") branch is observed here; the rejected branch is not provoked on purpose.',
        },
      }
    },
  },
]

// Added after an independent 7-agent audit of the plan documents surfaced three
// runtime-layer assumptions the first matrix missed entirely (see REVIEW-02).
const isolationProbes = [
  {
    id: 'p-init-receipt',
    title: 'system/init is a machine-checkable receipt of the whole context package',
    kind: 'live-call',
    loadBearing: 'critical',
    claim:
      'The first stream event enumerates what the session actually got — tools, mcp_servers (with status), plugins, skills, agents, model, permissionMode, apiKeySource, memory_paths, version — so the orchestrator can assert its context package arrived instead of hoping.',
    failureImpact:
      'A stage can run to completion with Atlas silently absent, on a stale CLI, or with the wrong permission mode, and the bad output gets attributed to the model rather than to a broken context package.',
    docRefs: ['REVIEW-02 gap: init receipt', 'ADR-008', 'RESEARCH-02 §7.4'],
    async run(ctx) {
      const res = await ctx.claude(
        ['-p', 'say ok', '--output-format', 'stream-json', '--verbose', '--model', ctx.model,
         '--strict-mcp-config', '--setting-sources', '', '--no-session-persistence'],
        { workspaceFor: 'p-init-receipt' }
      )
      const init = ctx.jsonLines(res.stdout).find((e) => e.type === 'system' && e.subtype === 'init')
      if (!init) {
        return { status: P.FAIL, detail: 'No system/init event in the stream.', evidence: { stdout: clip(res.stdout, 400) } }
      }
      const required = ['session_id', 'cwd', 'tools', 'mcp_servers', 'model', 'permissionMode', 'plugins', 'skills', 'agents', 'apiKeySource', 'claude_code_version']
      const missing = required.filter((k) => !(k in init))

      // `apiKeySource` was read into evidence and asserted NOWHERE. Every
      // headline finding this suite produced — ADR-007's permission contract,
      // ADR-008's budget-enforced-under-subscription result — is a claim about
      // the SUBSCRIPTION path specifically, and none of them meant anything
      // unless the child actually ran on it. The harness now scrubs the backend
      // env vars too, so this should be structurally true; asserting it is what
      // turns "should be" into "was".
      const EXPECT_API_KEY_SOURCE = process.env.GUIDELANE_EXPECT_API_KEY_SOURCE || 'none'
      if (!missing.length && init.apiKeySource !== EXPECT_API_KEY_SOURCE) {
        return {
          status: P.FAIL,
          detail:
            `Session ran with apiKeySource=${init.apiKeySource}, expected ${EXPECT_API_KEY_SOURCE}. ` +
            `This run measures a different auth path than the one ADR-007/008 document, so it is not ` +
            `conformance evidence for them. Set GUIDELANE_EXPECT_API_KEY_SOURCE to probe another path deliberately.`,
          evidence: { apiKeySource: init.apiKeySource, expected: EXPECT_API_KEY_SOURCE },
        }
      }

      return {
        status: missing.length === 0 ? P.PASS : P.PARTIAL,
        detail: missing.length
          ? `init present but missing assertable fields: ${missing.join(', ')}.`
          : `init carries every field the orchestrator needs to assert on, and apiKeySource is ASSERTED (=${init.apiKeySource}, the auth-mode discriminator) rather than merely recorded. version=${init.claude_code_version}.`,
        evidence: {
          keys: Object.keys(init),
          missing,
          toolCount: (init.tools || []).length,
          // Names withheld: with the isolation pair on, this list should be
          // empty, and anything in it is a server the OPERATOR configured —
          // often an employer or client name, and this artifact is public.
          mcpServers: publishableNames((init.mcp_servers || []).map((s) => (s && s.name) || String(s)), []),
          apiKeySource: init.apiKeySource,
          apiKeySourceAsserted: EXPECT_API_KEY_SOURCE,
          permissionMode: init.permissionMode,
          version: init.claude_code_version,
        },
      }
    },
  },

  {
    id: 'p-ambient-isolation',
    title: "A spawned session inherits the operator's whole configuration unless isolated",
    kind: 'live-call',
    loadBearing: 'critical',
    claim:
      'Isolation requires BOTH --strict-mcp-config AND --setting-sources "". With MCP isolation alone, the child still inherits the operator\'s plugins, skills, agents and permission mode.',
    failureImpact:
      "Fresh-session-per-stage stops meaning reproducible context: a friend's own skills, hooks and permission defaults silently alter Guidelane runs, and the owner's personal constitution is injected into every build session. Drift control — the point of the architecture — quietly evaporates.",
    docRefs: ['REVIEW-02 gap: ambient isolation', 'ADR-008', 'RESEARCH-02 §3'],
    async run(ctx) {
      const ask = ['-p', 'say ok', '--output-format', 'stream-json', '--verbose',
                   '--model', ctx.model, '--no-session-persistence']
      const initOf = (out) => ctx.jsonLines(out).find((e) => e.type === 'system' && e.subtype === 'init') || {}
      const nameOf = (x) => (typeof x === 'string' ? x : (x && (x.name || x.id)) || String(x))
      const shape = (i) => ({
        plugins: (i.plugins || []).length,
        skills: (i.skills || []).length,
        agents: (i.agents || []).length,
        mcpServers: (i.mcp_servers || []).length,
        permissionMode: i.permissionMode,
      })

      // `ambient: true` — this is the one probe whose SUBJECT is ambient
      // inheritance, so the harness must not add the isolation pair for it.
      const mcpOnlyInit = initOf((await ctx.claude([...ask, '--strict-mcp-config'], { workspaceFor: 'p-ambient-mcp-only', ambient: true })).stdout)
      const isolatedInit = initOf((await ctx.claude([...ask, '--strict-mcp-config', '--setting-sources', ''], { workspaceFor: 'p-ambient-isolated', ambient: true })).stdout)
      const partial = shape(mcpOnlyInit)
      const isolated = shape(isolatedInit)

      // The CLI's own built-in floor, pinned BY NAME on 2.1.220 at module scope.
      // No flag removes these; `--setting-sources ''` removes the operator's,
      // not the CLI's. ADR-008 originally claimed "nothing reaches a stage
      // session that the orchestrator did not put there" — this is the
      // correction.
      const BUILTIN_SKILLS = BUILTIN_SKILL_FLOOR
      const BUILTIN_AGENTS = BUILTIN_AGENT_FLOOR

      const isoSkills = (isolatedInit.skills || []).map(nameOf).sort()
      const isoAgents = (isolatedInit.agents || []).map(nameOf).sort()
      const excessSkills = isoSkills.filter((n) => !BUILTIN_SKILLS.includes(n))
      const excessAgents = isoAgents.filter((n) => !BUILTIN_AGENTS.includes(n))
      const excessOther = []
      if (isolated.plugins > 0) excessOther.push(`plugins: ${isolated.plugins}`)
      if (isolated.mcpServers > 0) excessOther.push(`mcp_servers: ${isolated.mcpServers}`)
      if (isolatedInit.permissionMode && isolatedInit.permissionMode !== 'default') {
        excessOther.push(`permissionMode: ${isolatedInit.permissionMode}`)
      }

      // A RELATIVE assertion ("is the isolated run smaller?") can never falsify
      // an ABSOLUTE claim ("the session is clean"). That shape is why this probe
      // passed green while its own evidence recorded 16 skills still present.
      // Assert equality against a pinned baseline instead.
      const leaks = partial.plugins > isolated.plugins || partial.skills > isolated.skills || partial.agents > isolated.agents
      // Names beyond the floor are, by definition, the OPERATOR'S — employer,
      // client and internal-project names. They are not path-shaped or
      // email-shaped, so redactString cannot see them and the CI grep has no
      // pattern for them: both layers miss. Publishing them here would leak
      // exactly on the failure this probe exists to detect, and that has
      // already happened once in this repo's history.
      //
      // A short hash keeps the finding diffable across runs (did the same
      // unexpected thing appear again?) without naming anything.
      const excess = [
        ...excessSkills.map((n) => `skill:${fingerprint(n)}`),
        ...excessAgents.map((n) => `agent:${fingerprint(n)}`),
        ...excessOther,
      ]

      let status, detail
      if (excess.length) {
        status = P.FAIL
        detail =
          `The isolation pair did NOT produce the expected clean room — beyond the CLI's built-in floor, ` +
          `the isolated session still carried ${excessSkills.length} skill(s) and ${excessAgents.length} agent(s) ` +
          `not on the pinned list, fingerprinted: ${excess.join(', ')}. Names are withheld because on this exact ` +
          `failure they are the operator's, and this report is public — run the probe locally and read ` +
          `evidence.localOnlyHint to see them. Either these are new built-ins (re-pin the baseline in this probe) ` +
          `or --setting-sources '' leaks and ADR-008's guarantee must be weakened in writing.`
      } else if (!leaks) {
        status = P.PARTIAL
        detail =
          `No leakage difference observed on this machine (the operator's config may be empty): mcp-only ` +
          `${JSON.stringify(partial)} vs isolated ${JSON.stringify(isolated)}. Keep both flags regardless — the ` +
          `guarantee must not depend on the operator happening to have no config.`
      } else {
        status = P.PASS
        detail =
          `--strict-mcp-config alone LEAKS operator config (plugins ${partial.plugins}, skills ${partial.skills}, ` +
          `agents ${partial.agents}, permissionMode ${partial.permissionMode}); adding --setting-sources "" reduces it to ` +
          `exactly the CLI's built-in floor (${BUILTIN_SKILLS.length} skills, ${BUILTIN_AGENTS.length} agents, 0 plugins, ` +
          `0 mcp_servers, permissionMode default). Both flags required — and the floor is NOT empty, so stage allow-lists ` +
          `must withhold Task/Skill unless a stage deliberately needs them (ADR-008 amendment).`
      }

      return {
        status,
        detail,
        evidence: {
          mcpOnly: partial,
          isolated,
          // Only names ON the pinned floor are ours to publish — they are the
          // CLI's, not the operator's, and seeing which of them are present is
          // the whole point of the assertion. Anything else is a count.
          floorSkillsPresent: isoSkills.filter((n) => BUILTIN_SKILLS.includes(n)),
          floorAgentsPresent: isoAgents.filter((n) => BUILTIN_AGENTS.includes(n)),
          beyondFloorCount: { skills: excessSkills.length, agents: excessAgents.length },
          builtinFloorPinnedFor: '2.1.220',
          excessBeyondFloor: excess,
          localOnlyHint:
            excess.length > 0
              ? 'Names withheld from the public artifact. Re-run this probe locally and inspect the init event directly.'
              : null,
          bothFlagsRequired: true,
        },
      }
    },
  },

  {
    id: 'p-messagedisplay-rewrite',
    title: 'A MessageDisplay hook rewrite reaches stream-json, not just the terminal',
    kind: 'fixture-call',
    loadBearing: 'critical',
    claim:
      'A MessageDisplay hook returning displayContent replaces the assistant text that Guidelane reads from --output-format stream-json. Guidelane never renders the terminal, so a terminal-only rewrite would give the product exactly zero protection.',
    failureImpact:
      "R3 mechanism 4 disappears from the product surface and jargon suppression falls entirely to the cockpit's whitelist renderer.",
    docRefs: ['REVIEW-02 gap: MessageDisplay scope', 'RESEARCH-01 §4.3 mech. 4', 'ADR-008'],
    async run(ctx) {
      const res = await ctx.claude(
        ['-p', 'Reply with exactly: ORIGINAL_TEXT_MARKER',
         '--plugin-dir', join(ctx.fixtures, 'plugin'),
         '--strict-mcp-config', '--setting-sources', '', '--permission-mode', 'auto',
         '--model', ctx.model, '--output-format', 'stream-json', '--verbose', '--no-session-persistence'],
        { workspaceFor: 'p-messagedisplay-rewrite', env: { GUIDELANE_PROBE_REWRITE: '1' }, timeoutMs: 240_000 }
      )
      const events = ctx.jsonLines(res.stdout)
      const texts = []
      for (const e of events) {
        const c = e && e.message && e.message.content
        if (Array.isArray(c)) for (const blk of c) if (blk.type === 'text') texts.push(String(blk.text).trim())
      }
      const result = events.find((e) => e.type === 'result')
      const rewritten = texts.includes('REWRITTEN_BY_HOOK') || /REWRITTEN_BY_HOOK/.test(String(result && result.result))
      return {
        status: rewritten ? P.PASS : P.FAIL,
        detail: rewritten
          ? 'Rewrite propagated into assistant text AND the terminal result — mechanism 4 is real on the product surface. Note: hook failure is fail-open (the engine emits the original text), so the cockpit renderer stays the guarantee.'
          : `Rewrite did not reach the stream; assistant text was ${JSON.stringify(texts).slice(0, 200)}. Treat mechanism 4 as terminal-only.`,
        evidence: { assistantTexts: texts.slice(0, 5), resultText: clip(result && result.result, 200), rewritten },
      }
    },
  },
]

// The harness measuring itself. Everything here is free — no engine call, no
// quota — and every probe exercises a defence that was added on reasoning and
// had never actually fired. REVIEW-02 B1's orphan half lives here.
const lifecycleProbes = [
  {
    id: 'p-kill-reaps-process-group',
    title: 'A timed-out child takes its whole process tree with it',
    kind: 'observational',
    loadBearing: 'critical',
    claim:
      'When the harness times out a child, the process-group kill reaps its grandchildren too — so a stuck engine session cannot leave an authenticated `claude`, a stdio MCP server, or a Bash grandchild running against the user\'s quota.',
    failureImpact:
      "Orphaned engine processes keep spending a friend's subscription after a crash, with nobody reading their output. This is the S2 exit gate's core question, and it is invisible to every happy-path probe.",
    docRefs: ['REVIEW-02 B1', 'ADR-001'],
    async run(ctx) {
      const ws = ctx.makeWorkspace('p-kill-reaps-process-group')
      const pidfile = join(ws, 'pids.txt')
      const fixture = join(ctx.fixtures, 'hang', 'hang.mjs')

      const res = await ctx.spawnCapture(process.execPath, [fixture, 'grouped'], {
        cwd: ws,
        env: { GUIDELANE_HANG_PIDFILE: pidfile },
        timeoutMs: 4_000,
        expectTimeout: true,
      })

      if (!existsSync(pidfile)) {
        return {
          status: P.FAIL,
          detail: `Fixture never reported its pids — cannot judge reaping. stdout=${clip(res.stdout, 120)} stderr=${clip(res.stderr, 120)}`,
          evidence: { timedOut: res.timedOut, stdout: clip(res.stdout, 200) },
        }
      }
      const [parentPid, childPid] = readFileSync(pidfile, 'utf8')
        .split('\n').map((s) => Number(s.trim())).filter(Boolean)

      // kill(pid, 0) signals nothing; it only asks "may I signal this process".
      // ESRCH means the process is gone, which is what we want to see.
      const alive = (pid) => {
        try { process.kill(pid, 0); return true } catch { return false }
      }
      const parentAlive = alive(parentPid)
      const childAlive = alive(childPid)

      // Never leak a real process because a probe failed.
      for (const pid of [childPid, parentPid]) {
        if (alive(pid)) { try { process.kill(pid, 'SIGKILL') } catch { /* raced */ } }
      }

      const ok = res.timedOut && !parentAlive && !childAlive
      return {
        status: ok ? P.PASS : P.FAIL,
        detail: ok
          ? `Timeout killed the whole group: the direct child AND its grandchild were both gone afterwards. The process-group kill added at S0 close does what it claims.`
          : `Reaping incomplete — timedOut=${res.timedOut}, parent alive=${parentAlive}, grandchild alive=${childAlive}. ` +
            `A surviving grandchild is an authenticated process spending quota with nobody reading it.`,
        evidence: { timedOut: res.timedOut, parentSurvived: parentAlive, grandchildSurvived: childAlive, settleMs: res.ms },
      }
    },
  },

  {
    id: 'p-watchdog-settles-on-escaped-child',
    title: 'A grandchild that escapes the process group cannot hang the suite',
    kind: 'observational',
    loadBearing: 'critical',
    claim:
      "When a grandchild in its own process group holds the stdout pipe open, the child's 'close' event never fires — and the settle watchdog resolves the call anyway, so the run continues instead of hanging forever.",
    failureImpact:
      'The single worst outcome the product can have: a run that stops with no output, no error, and no terminal event. In the nightly job it burns to the CI cap; in front of a non-coder it is "the computer froze".',
    docRefs: ['REVIEW-02 B1', 'REVIEW-02 A5', 'sprint-close architecture review'],
    async run(ctx) {
      const ws = ctx.makeWorkspace('p-watchdog-settles')
      const pidfile = join(ws, 'pids.txt')
      const fixture = join(ctx.fixtures, 'hang', 'hang.mjs')

      const started = Date.now()
      // 'escaped' puts the grandchild in its OWN group, so the harness's group
      // kill provably cannot reach it. Only the watchdog can end this call.
      const res = await ctx.spawnCapture(process.execPath, [fixture, 'escaped'], {
        cwd: ws,
        env: { GUIDELANE_HANG_PIDFILE: pidfile },
        timeoutMs: 3_000,
        expectTimeout: true,
      })
      const elapsed = Date.now() - started

      const pids = existsSync(pidfile)
        ? readFileSync(pidfile, 'utf8').split('\n').map((s) => Number(s.trim())).filter(Boolean)
        : []
      const alive = (pid) => {
        try { process.kill(pid, 0); return true } catch { return false }
      }
      const escapee = pids[1]
      const escapeeSurvived = escapee ? alive(escapee) : null

      // This probe DELIBERATELY creates a process the harness cannot reap, so
      // cleaning it up is the probe's own responsibility.
      for (const pid of pids) {
        if (alive(pid)) { try { process.kill(pid, 'SIGKILL') } catch { /* raced */ } }
      }

      // Settled at all == the promise resolved == we are executing this line.
      // The question is whether it settled promptly rather than at some much
      // later accident.
      const settledPromptly = elapsed < 3_000 + 5_000 + 4_000
      const ok = res.timedOut && settledPromptly
      return {
        status: ok ? P.PASS : P.FAIL,
        detail: ok
          ? `Escaped grandchild held the pipe open and 'close' never came, yet the call settled in ${elapsed}ms via the watchdog. ` +
            `A stuck session degrades into evidence instead of a silent hang.` +
            (escapeeSurvived ? ' As designed, the escapee outlived the group kill — the probe reaped it itself.' : '')
          : `Settled in ${elapsed}ms with timedOut=${res.timedOut}. If this ever fails, the suite can hang with no output — treat it as urgent.`,
        evidence: { elapsedMs: elapsed, timedOut: res.timedOut, escapeeOutlivedGroupKill: escapeeSurvived, settleMs: res.ms },
      }
    },
  },

  {
    id: 'p-version-in-tested-range',
    title: 'The exercised CLI version is inside the tested range',
    kind: 'observational',
    loadBearing: 'high',
    claim:
      'Every run states the engine version it exercised and refuses to present its results as conformance evidence when that version is outside the range the suite has actually been validated against.',
    failureImpact:
      "REVIEW-01 #5's remedy is a tested version range plus a nightly probe. CI pins the version; the local launchd run does not, so an auto-update could silently move the engine under a green report and nobody would notice.",
    docRefs: ['REVIEW-01 #5', 'ADR-001', 'CLAUDE.md §3'],
    async run(ctx) {
      // Widen deliberately, with a commit, when a new version has been validated
      // by a full --live run. Never widen to make a red build go away.
      const TESTED = { min: '2.1.220', max: '2.1.999' }
      const res = await ctx.spawnCapture(ctx.claudeBin, ['--version'], { cwd: ctx.suiteRoot, timeoutMs: 30_000 })
      const m = res.stdout.match(/(\d+)\.(\d+)\.(\d+)/)
      if (!m) {
        return { status: P.FAIL, detail: `Unparseable version: ${clip(res.stdout, 120)}`, evidence: { raw: clip(res.stdout, 200) } }
      }
      const cmp = (a, b) => {
        const pa = a.split('.').map(Number)
        const pb = b.split('.').map(Number)
        for (let i = 0; i < 3; i++) { if (pa[i] !== pb[i]) return pa[i] - pb[i] }
        return 0
      }
      const version = `${m[1]}.${m[2]}.${m[3]}`
      const inRange = cmp(version, TESTED.min) >= 0 && cmp(version, TESTED.max) <= 0
      return {
        status: inRange ? P.PASS : P.FAIL,
        detail: inRange
          ? `Engine ${version} is inside the tested range ${TESTED.min}–${TESTED.max}.`
          : `Engine ${version} is OUTSIDE the tested range ${TESTED.min}–${TESTED.max}. This report is not conformance evidence until the suite is re-validated against it and the range is widened deliberately.`,
        evidence: { version, testedRange: TESTED, inRange },
      }
    },
  },
]

export const probes = [
  ...helpProbes,
  ...lifecycleProbes,
  ...isolationProbes,
  ...protocolProbes,
  ...structuredOutputProbes,
  ...injectionProbes,
  ...controlProbes,
  ...sessionProbes,
  ...mcpProbes,
  ...pluginProbes,
  ...governanceProbes,
]
