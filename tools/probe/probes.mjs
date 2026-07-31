// @MAP
// publication allow-lists (62-160) | validateStreamSurface (164)
// REQUIRED_FLAGS (323) | help-text probes (359) | stream/protocol probes (552)
// structured-output (907) | injection (974) | control+cost (1088)
// session identity (1347) | mcp (1413) | plugin+hooks (1457) | dialog (1839)
// stream-surface artifact, FREE (1970) | governance/observational (2030)
// isolation (2287) | lifecycle (2511) | probes export (2665)
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

/**
 * Publish a stream `type`/`subtype` pair name, or fingerprint the component of
 * it that may not be the engine's to publish.
 *
 * The first form of this helper shape-gated the WHOLE string: any name whose
 * `[/=.]`-separated fragments matched `^[A-Za-z][A-Za-z0-9_-]{0,40}$` published
 * verbatim. Underscores are inside that character class, so
 * `mcp__plugin_<client>_<server>__<tool>` and `plugin_<operator>_<server>` —
 * the exact ADR-008 shapes the docstring named as its own reason to exist —
 * went through in full, and the hook-subtype case it also cited was caught only
 * by the coincidence of a colon. Measured against both shapes, not argued.
 * That was instance 23 of this repo's recurring defect, sitting inside the
 * leak-prevention helper itself.
 *
 * The replacement is an allow-list with a pinned expectation, so it fails
 * CLOSED on the only input that matters: a name nobody has classified, which is
 * produced at exactly the moment the probe stops understanding the stream.
 *   - A pair the committed artifact classifies is ours, and publishes verbatim.
 *   - Anything else keeps ENGINE-OWNED structure only — the top-level `type`,
 *     or the `event.…` accessor path — and fingerprints the name-bearing part.
 *
 * The FAIL stays actionable: `system/<unpublishable:…>` still says which
 * top-level type grew a subtype, and the payload is readable on the local run.
 */
const STREAM_TYPE_FLOOR = [
  'system', 'assistant', 'user', 'stream_event', 'result',
  'rate_limit_event', 'control_request', 'control_response',
]
const INNER_ACCESSOR_FLOOR = ['event.type', 'event.delta.type', 'event.content_block.type']
const unpublishable = (s) => `<unpublishable:${fingerprint(s)} len=${String(s).length}>`

const publishablePairIn = (classified) => (key) => {
  const k = String(key)
  if (classified.has(k)) return k
  const eq = k.indexOf('=')
  if (eq > 0) {
    const accessor = k.slice(0, eq)
    return INNER_ACCESSOR_FLOOR.includes(accessor)
      ? `${accessor}=${unpublishable(k.slice(eq + 1))}`
      : unpublishable(k)
  }
  const slash = k.indexOf('/')
  const type = slash === -1 ? k : k.slice(0, slash)
  if (!STREAM_TYPE_FLOOR.includes(type)) return unpublishable(k)
  return slash === -1 ? type : `${type}/${unpublishable(k.slice(slash + 1))}`
}

/**
 * The same rule for a top-level event KEY name, against a floor MEASURED on
 * 2.1.220 across every pair this suite has observed (10 pairs, one maximally
 * verbose session). Keys are protocol vocabulary and no operator-owned name has
 * ever been seen in one — but "never been seen" is precisely the argument that
 * produced instance 23, so an unlisted key fingerprints instead of publishing.
 * Re-pin DELIBERATELY when the engine adds a field; never widen it to make a
 * report read better.
 */
const STREAM_KEY_FLOOR = [
  'agents', 'analytics_disabled', 'apiKeySource', 'api_error_status', 'capabilities',
  'claude_code_version', 'cwd', 'duration_api_ms', 'duration_ms', 'estimated_tokens',
  'estimated_tokens_delta', 'event', 'exit_code', 'fast_mode_disabled_reason',
  'fast_mode_state', 'hook_event', 'hook_id', 'hook_name', 'isReplay', 'is_error',
  'mcp_servers', 'memory_paths', 'message', 'model', 'modelUsage', 'num_turns',
  'outcome', 'output', 'output_style', 'parent_tool_use_id', 'permissionMode',
  'permission_denials', 'plugin_errors', 'plugins', 'product_feedback_disabled',
  'rate_limit_info', 'request_id', 'result', 'session_id', 'skills', 'slash_commands',
  'status', 'stderr', 'stdout', 'stop_reason', 'subtype', 'terminal_reason',
  'time_to_request_ms', 'timestamp', 'tools', 'total_cost_usd', 'ttft_ms',
  'ttft_stream_ms', 'type', 'usage', 'uuid',
]
const publishableKey = (key) =>
  STREAM_KEY_FLOOR.includes(String(key)) ? String(key) : unpublishable(key)

const own = (map, k) => Object.prototype.hasOwnProperty.call(map, k)

/** Read the committed stream-surface artifact. Never writes it. */
const readStreamSurface = () => {
  try {
    return { surface: JSON.parse(readFileSync(new URL('./stream-surface.json', import.meta.url), 'utf8')), readError: null }
  } catch (err) {
    return { surface: null, readError: `${(err && (err.code || err.name)) || 'error'}: ${(err && err.message) || err}` }
  }
}

const SURFACE_CLASSES = ['render', 'ignore', 'escalate']
// Floors pinned in CODE and asserted as SUBSETS of the artifact's own required
// lists. Not a second source of truth — a shape constraint on the expectation,
// so the two cannot disagree; only the artifact can be caught shrinking.
// Without them, deleting entries from the artifact makes a session that died
// after two events satisfy the subset check and pass having measured nothing.
const SURFACE_REQUIRED_FLOOR = ['system/init', 'assistant', 'result/success']
const SURFACE_REQUIRED_INNER_FLOOR = ['event.type=content_block_delta', 'event.delta.type=text_delta']

/**
 * Validate `stream-surface.json` as an EXPECTATION, with no engine call.
 *
 * Extracted so the live probe (`p-stream-surface-union`) and the free probe
 * (`p-stream-surface-artifact`) share one implementation. Two copies of a
 * validator is how a pinned expectation drifts, and the free copy is the one CI
 * runs — so a divergence would mean CI gating something the live suite does not
 * assert, which is worse than no free gate at all.
 */
const validateStreamSurface = (surface) => {
  const problems = []
  const pairsMap = surface && surface.pairs && typeof surface.pairs === 'object' ? surface.pairs : null
  const innerMap = surface && surface.innerPairs && typeof surface.innerPairs === 'object' ? surface.innerPairs : null
  const requiredPairs = surface && Array.isArray(surface.requiredPairs) ? surface.requiredPairs : null
  const requiredInner = surface && Array.isArray(surface.requiredInnerPairs) ? surface.requiredInnerPairs : null

  const validateMap = (map, label) => {
    if (!map) return problems.push(`${label} is missing or not an object`)
    const keys = Object.keys(map).filter((k) => !k.startsWith('_'))
    if (keys.length === 0) problems.push(`${label} is empty — an empty whitelist classifies nothing`)
    for (const k of keys) {
      const v = map[k]
      if (!v || typeof v !== 'object') { problems.push(`${label}["${k}"] is not an object`); continue }
      // schemaVersion 2: exactly one of `class` (unconditional) or `when`
      // (value-conditional). Accepting both would be two sources of truth for
      // one decision, which is how a pin drifts.
      const hasClass = own(v, 'class')
      const hasWhen = own(v, 'when')
      if (hasClass === hasWhen) {
        problems.push(`${label}["${k}"] must carry exactly one of class | when (has ${hasClass && hasWhen ? 'both' : 'neither'})`)
      } else if (hasClass) {
        if (!SURFACE_CLASSES.includes(v.class)) {
          problems.push(`${label}["${k}"] has class=${JSON.stringify(v.class)}, expected one of ${SURFACE_CLASSES.join(' | ')}`)
        }
      } else {
        const w = v.when
        if (!w || typeof w !== 'object') problems.push(`${label}["${k}"].when is not an object`)
        else {
          if (typeof w.path !== 'string' || !w.path.trim()) {
            problems.push(`${label}["${k}"].when.path is missing — nothing to read the value from`)
          }
          const vals = w.values && typeof w.values === 'object' ? Object.entries(w.values) : null
          if (!vals || vals.length === 0) {
            problems.push(`${label}["${k}"].when.values is empty — a conditional that matches nothing is the unconditional rule it replaced`)
          } else {
            for (const [val, cls] of vals) {
              if (!SURFACE_CLASSES.includes(cls)) problems.push(`${label}["${k}"].when.values["${val}"] = ${JSON.stringify(cls)}, expected one of ${SURFACE_CLASSES.join(' | ')}`)
            }
          }
          // Deliberately narrower than the class set. Discriminating by value is
          // a statement that the values matter, so an unrecognised one has to
          // reach a human; `unknown: ignore` would swallow exactly the case
          // nobody anticipated.
          if (w.unknown !== 'escalate') {
            problems.push(`${label}["${k}"].when.unknown = ${JSON.stringify(w.unknown)}, must be "escalate" — a value-conditional rule may not fail open on an unmodelled value`)
          }
        }
      }
      // An unexplained classification is a convention, not a constraint — the
      // next person cannot tell a decision from a placeholder.
      if (typeof v.why !== 'string' || v.why.trim().length < 10) {
        problems.push(`${label}["${k}"] carries no stated reason`)
      }
    }
  }
  validateMap(pairsMap, 'pairs')
  validateMap(innerMap, 'innerPairs')

  // The rule for a pair in NO list. The artifact enumerates a universe it also
  // states is a sample, so "what happens to the ones I did not enumerate" is not
  // an edge case, it is the guaranteed steady state. Pinned here rather than
  // left to each renderer, because a renderer that drops the unrecognised goes
  // silent, and silence is REVIEW-02's named worst outcome.
  if (!surface || surface.defaultForUnknown !== 'escalate') {
    problems.push(`defaultForUnknown = ${JSON.stringify(surface && surface.defaultForUnknown)}, must be "escalate" — an unenumerated pair may not be silently dropped`)
  }
  // Without a pinned minimum the live probe passes on an empty stream: it would
  // observe nothing, find nothing unclassified, and report green having measured
  // nothing at all. This is the guard that makes it able to fire.
  if (!requiredPairs || requiredPairs.length === 0) {
    problems.push('requiredPairs is missing or empty — the live probe would pass on a zero-event stream')
  }
  for (const k of SURFACE_REQUIRED_FLOOR) {
    if (requiredPairs && !requiredPairs.includes(k)) {
      problems.push(`requiredPairs omits "${k}", which is pinned in code — without it a session that died early satisfies the subset check and passes having measured nothing`)
    }
  }
  if (!requiredInner || requiredInner.length === 0) {
    problems.push('requiredInnerPairs is missing or empty — the live probe would pass on an envelope with no content')
  }
  for (const k of SURFACE_REQUIRED_INNER_FLOOR) {
    if (requiredInner && !requiredInner.includes(k)) {
      problems.push(`requiredInnerPairs omits "${k}", which is pinned in code — without it an envelope carrying no text satisfies the subset check`)
    }
  }
  for (const k of requiredPairs || []) {
    if (pairsMap && !own(pairsMap, k)) problems.push(`requiredPairs names "${k}", absent from pairs — that requirement can never be satisfied cleanly`)
  }
  for (const k of requiredInner || []) {
    if (innerMap && !own(innerMap, k)) problems.push(`requiredInnerPairs names "${k}", absent from innerPairs`)
  }

  // One CLASSIFICATION pinned in code, not just a shape.
  //
  // Everything above checks that the artifact is well-formed. Well-formed is not
  // safe: reclassifying a thinking block to `render` is a perfectly valid edit
  // that ships raw chain-of-thought to a non-coder. Measured 2026-07-31 — content
  // -bearing thinking reaches `-p` stream-json by default, and the MessageDisplay
  // rewrite that implements ADR-006's language dial provably does NOT touch it
  // (same-run differential: the text block came back rewritten, the thinking
  // block kept its original characters). So this is the one place where a
  // classification is a product invariant rather than a judgement call, and a
  // shape-only validator would wave it through.
  //
  // Deliberately NOT generalised into "check every class": the rest genuinely are
  // decisions, and pinning them would freeze the artifact against its own purpose.
  const THINKING_MUST_IGNORE = [
    'event.content_block.type=thinking',
    'event.delta.type=thinking_delta',
    'event.delta.type=signature_delta',
  ]
  for (const k of THINKING_MUST_IGNORE) {
    if (!innerMap || !own(innerMap, k)) {
      problems.push(`innerPairs omits "${k}", which is pinned in code — a renderer that ignores thinking BY OMISSION fails open the first time it is rewritten`)
    } else if (innerMap[k].class !== 'ignore') {
      problems.push(`innerPairs["${k}"].class = ${JSON.stringify(innerMap[k].class)}, must be "ignore" — this is raw chain-of-thought, it reaches the wire by default, and ADR-006's language dial does not touch it`)
    }
  }
  return { problems, pairsMap, innerMap, requiredPairs, requiredInner }
}

/** Truncate captured output so the JSON report stays readable. */
const clip = (s, n = 1200) => {
  const t = String(s || '')
  return t.length > n ? `${t.slice(0, n)}…[${t.length} chars]` : t
}

// `claude --help` hard-wraps descriptions across lines with deep indentation, so
// a phrase that reads as one sentence is not one string. Every help-text
// assertion matches against the collapsed form.
const flat = (s) => String(s || '').replace(/\s+/g, ' ')

/**
 * The set of flags the help text actually DECLARES, read from the option column.
 *
 * Deliberately NOT built on `flat()`: the line structure is the only thing that
 * distinguishes a flag's definition from a mention of it inside someone else's
 * description, and flattening destroys exactly that. Option lines are indented
 * then start with `-`; the head of the line (before the 2+ space gutter) is the
 * flag and its metavar.
 */
const declaredFlags = (helpRaw) => {
  const found = new Set()
  for (const line of String(helpRaw || '').split('\n')) {
    if (!/^\s{1,8}-/.test(line)) continue
    // trim() FIRST — the line begins with the indent, so splitting on the gutter
    // without trimming yields an empty first element and finds nothing at all.
    const head = line.trim().split(/\s{2,}/)[0]
    for (const tok of head.split(/[,\s]+/)) {
      const flag = tok.replace(/[=<[].*$/, '')
      if (/^--?[A-Za-z]/.test(flag)) found.add(flag)
    }
  }
  return found
}

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
      const raw = await ctx.help()
      const help = flat(raw)
      // TWO SIGNALS, because either alone fails silently in a different direction.
      //
      // Substring-over-flattened-help (the original) cannot tell a flag's
      // DEFINITION from a mention of it inside another flag's description. Remove
      // `--forward-subagent-text` and add "replaces the removed
      // --forward-subagent-text" under a neighbour, and this `critical` probe —
      // whose entire job is catching removals — stays green forever.
      //
      // The option-column parse alone would be worse: it depends on the vendor's
      // help formatter, so a layout change makes it report every flag missing,
      // i.e. libel the engine. (This probe's fix was deferred once on the grounds
      // that column parsing "trades one silent failure for another". That was
      // wrong, and it was wrong because my throwaway parser had a bug — the line
      // starts with two spaces, so `split(/\s{2,}/)[0]` was the empty string. The
      // measured parser finds 69 declared flags and misses none of the required
      // ones. Test the worry before honouring it.)
      const declared = declaredFlags(raw)
      // A healthy parse sees ~69 flags; a broken one sees ~0. The gap is enormous,
      // so a floor separates "the formatter changed" from "flags disappeared"
      // without either masking the other.
      const PARSER_FLOOR = 40
      const parserBroke = declared.size < PARSER_FLOOR

      const missing = REQUIRED_FLAGS.filter(([flag]) => !help.includes(flag))
      // The case neither signal catches alone: present in the text, absent from
      // the option column — a flag that now exists only as prose about its own
      // removal.
      const proseOnly = parserBroke
        ? []
        : REQUIRED_FLAGS.filter(([flag]) => help.includes(flag) && !declared.has(flag)).map(([f]) => f)

      if (parserBroke) {
        return {
          status: P.PARTIAL,
          detail:
            `The option-column parser found only ${declared.size} flags (floor ${PARSER_FLOOR}) — the help ` +
            `formatter changed, so the declared-vs-mentioned check cannot run. Substring check says ` +
            `${missing.length ? `MISSING ${missing.map(([f]) => f).join(', ')}` : 'all present'}, but that check ` +
            `cannot distinguish a definition from a mention. Fix the parser before believing either answer.`,
          evidence: { declaredCount: declared.size, parserFloor: PARSER_FLOOR, substringMissing: missing.map(([f]) => f) },
        }
      }

      return {
        status: missing.length === 0 && proseOnly.length === 0 ? P.PASS : P.FAIL,
        detail:
          missing.length === 0 && proseOnly.length === 0
            ? `All ${REQUIRED_FLAGS.length} required flags present AND declared in the option column (${declared.size} flags parsed).`
            : [
                missing.length ? `Missing entirely: ${missing.map(([f, why]) => `${f} (needed for ${why})`).join('; ')}` : null,
                proseOnly.length
                  ? `MENTIONED BUT NOT DECLARED — present in the help text yet absent from the option column, ` +
                    `i.e. removed and only referred to in prose: ${proseOnly.join(', ')}. This is the exact case ` +
                    `a substring check reports as healthy.`
                  : null,
              ].filter(Boolean).join(' | '),
        evidence: {
          required: REQUIRED_FLAGS.length,
          missing: missing.map(([f]) => f),
          mentionedButNotDeclared: proseOnly,
          declaredCount: declared.size,
        },
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

  {
    id: 'p-stream-surface-union',
    title: 'Every stream type/subtype pair a session emits is classified in the committed surface artifact',
    kind: 'fixture-call',
    loadBearing: 'critical',
    claim:
      "The cockpit's only deterministic plain-language guarantee is whitelist-rendering, and a whitelist needs an enumerated universe: every `type`/`subtype` pair a session emits — and every content-block and delta type inside a `stream_event` envelope — appears in `tools/probe/stream-surface.json` carrying a deliberate `render | ignore | escalate` classification.",
    failureImpact:
      'An unclassified subtype reaches a non-coder as a blank card or a crash, and the failure is invisible during development: the pair simply never appeared on the machine where the whitelist was written.',
    docRefs: ['REVIEW-02 §3 A2', 'REVIEW-02 §13', 'RESEARCH-02 §4.3 mech. 3', 'ADR-008'],
    async run(ctx) {
      // SCOPE — stated here because the probe's name overclaims and the detail
      // line is where a reader will look for the caveat: this observes ONE
      // session under ONE flag configuration. It is a SAMPLE OF THE SURFACE,
      // NOT THE CLOSED SET. Configurations it does not exercise: tool use,
      // subagents, MCP servers, --json-schema, a non-zero-exit result, an
      // interrupted session, a rate-limited one. What it CAN prove is a
      // one-directional and still useful thing — that nothing this
      // configuration emits is unclassified, and that the pairs the renderer
      // depends on actually arrive.
      //
      // The artifact is an INPUT. It is hand-seeded and hand-classified, and
      // this probe never writes it: a probe that generates its own expectation
      // and then checks it against itself is a tautology (PROJECT_MAP
      // Principle 9, Q3) and would have passed green on day one forever.
      const { surface, readError } = readStreamSurface()
      // Fail CLOSED on a missing or corrupt artifact. An absent whitelist means
      // "nothing is classified", which is the maximally unsafe state — reporting
      // green for it is the same shape as the baseline gate that printed "no
      // baseline yet" and exited 0 over a merge conflict.
      if (!surface || typeof surface !== 'object' || Array.isArray(surface)) {
        return {
          status: P.FAIL,
          detail:
            `tools/probe/stream-surface.json could not be read as an object (${readError || 'not an object'}). ` +
            `The classification gate cannot run, so this probe refuses to report a verdict about the stream.`,
          evidence: { readError, artifactUsable: false },
        }
      }

      // Validate the artifact BEFORE spending a live call: a broken expectation
      // file cannot be rescued by a good measurement, and quota is real. The
      // validator is shared with the free probe — see validateStreamSurface.
      const { problems: artifactProblems, pairsMap, innerMap, requiredPairs, requiredInner } =
        validateStreamSurface(surface)
      if (artifactProblems.length) {
        return {
          status: P.FAIL,
          detail: `stream-surface.json is not a usable expectation: ${artifactProblems.join('; ')}. No engine call was made.`,
          evidence: { artifactProblems, artifactUsable: false, schemaVersion: surface.schemaVersion ?? null },
        }
      }

      // The publication allow-list is the artifact's own key sets — the same
      // committed file this probe asserts against, so the two cannot disagree.
      // Bound once as a 1-arity closure: `.map(publishablePair)` would have
      // handed map's index through as the second argument.
      const pub = publishablePairIn(new Set([
        ...Object.keys(pairsMap).filter((k) => !k.startsWith('_')),
        ...Object.keys(innerMap).filter((k) => !k.startsWith('_')),
      ]))

      const ws = ctx.makeWorkspace('p-stream-surface-union')
      const logPath = join(ws, 'hook-events.log')
      const res = await ctx.claude(
        [
          '-p',
          '--input-format', 'stream-json',
          '--output-format', 'stream-json',
          '--verbose',
          '--include-partial-messages',
          '--include-hook-events',
          '--replay-user-messages',
          // Read-only reuse of the existing fixture — hook lifecycle pairs are a
          // third of the known union and cannot be observed without a plugin
          // that registers hooks. NOT mutated: several green probes consume it.
          '--plugin-dir', join(ctx.fixtures, 'plugin'),
          '--model', ctx.model,
          '--tools', '',
          '--no-session-persistence',
        ],
        {
          cwd: ws,
          env: { GUIDELANE_PROBE_LOG: logPath },
          stdin: ctx.userMessage('Reply with exactly: SURFACE_OK'),
          timeoutMs: 240_000,
        }
      )

      // Counted separately from jsonLines(), which silently drops a line that
      // does not start like JSON. For every other probe that is noise; for this
      // one it is the whole subject — a non-JSON line on stdout is a surface the
      // cockpit's line parser has no classification for, and dropping it here
      // would be the probe hiding its own finding.
      const rawLines = String(res.stdout || '').split('\n').map((s) => s.trim()).filter(Boolean)
      const nonJsonLines = rawLines.filter((l) => l[0] !== '{' && l[0] !== '[')
      const events = ctx.jsonLines(res.stdout)

      const malformed = []
      const observed = new Set()
      const innerObserved = new Set()
      const condUnresolved = new Set()
      const condUnknownValues = new Set()
      // Top-level KEY NAMES per pair, so a FAIL is actionable. Naming an
      // unclassified pair and nothing else leaves the next person to guess at
      // `render | ignore | escalate`, and a guessed classification is precisely
      // the decoration this repo keeps producing. Key names are engine
      // vocabulary and safe to publish; VALUES are not — `system/init` alone
      // carries cwd, session_id and the operator's plugin names (H10) — so no
      // value is ever retained here.
      const shapes = {}
      const innerShapes = {}
      const noteShape = (into, key, obj) => {
        if (!into[key]) into[key] = new Set()
        for (const k of Object.keys(obj)) into[key].add(k)
      }
      for (const e of events) {
        if (!e || typeof e !== 'object' || Array.isArray(e)) { malformed.push('non-object event'); continue }
        // The typeof, never the value: a non-string `type` could be an object
        // carrying anything, and this string is destined for a public report.
        if (typeof e.type !== 'string' || !e.type) { malformed.push(`event with a ${typeof e.type} type`); continue }
        const sub = e.subtype
        if (sub !== undefined && sub !== null && typeof sub !== 'string') {
          // Through the allow-list, not the bare type: the shape line above was
          // hardened and this one was not, so a type name went verbatim into a
          // public report at the exact moment the probe stopped understanding
          // the stream.
          malformed.push(`${pub(e.type)} with non-string subtype`)
          continue
        }
        const pairKey = sub === undefined || sub === null ? e.type : `${e.type}/${sub}`
        observed.add(pairKey)
        noteShape(shapes, pairKey, e)
        // A `when` rule is only a constraint if its path resolves on the event
        // it classifies. A path that never resolves silently never matches, so
        // the pair falls through to nothing at all — a decoration rule, the
        // shape this repo has now produced 23 times. Resolve it here so the
        // rule is falsifiable by the same run that observes the pair.
        const cond = own(pairsMap, pairKey) ? pairsMap[pairKey].when : null
        if (cond && typeof cond.path === 'string') {
          const val = cond.path.split('.').reduce((o, seg) => (o == null ? undefined : o[seg]), e)
          if (val === undefined || val === null) condUnresolved.add(pairKey)
          else if (!own(cond.values, String(val))) condUnknownValues.add(`${pairKey} via ${cond.path} = ${unpublishable(String(val))}`)
        }
        if (e.type !== 'stream_event') continue
        const inner = e.event
        if (!inner || typeof inner !== 'object') { malformed.push('stream_event carrying no event object'); continue }
        if (typeof inner.type === 'string') {
          innerObserved.add(`event.type=${inner.type}`)
          noteShape(innerShapes, `event.type=${inner.type}`, inner)
        } else malformed.push('stream_event.event with non-string type')
        if (inner.delta && typeof inner.delta.type === 'string') {
          innerObserved.add(`event.delta.type=${inner.delta.type}`)
          noteShape(innerShapes, `event.delta.type=${inner.delta.type}`, inner.delta)
        }
        if (inner.content_block && typeof inner.content_block.type === 'string') {
          innerObserved.add(`event.content_block.type=${inner.content_block.type}`)
          noteShape(innerShapes, `event.content_block.type=${inner.content_block.type}`, inner.content_block)
        }
      }

      // hasOwnProperty, not `in`: `in` walks the prototype chain, so an event
      // type of `constructor` or `toString` would read as already classified.
      const unknownPairs = [...observed].filter((k) => !own(pairsMap, k)).sort()
      const unknownInner = [...innerObserved].filter((k) => !own(innerMap, k)).sort()
      // Everything below this line that leaves the probe goes through `pub`.
      // A pair that MATCHED the artifact came from our own committed file and is
      // safe verbatim; an unmatched one is a novel string produced at the exact
      // moment the probe stopped understanding the stream.
      const pubUnknownPairs = unknownPairs.map(pub)
      const pubUnknownInner = unknownInner.map(pub)
      const missingRequired = requiredPairs.filter((k) => !observed.has(k))
      const missingRequiredInner = requiredInner.filter((k) => !innerObserved.has(k))

      // Interpretation aid, deliberately NOT an assertion: if no hook pair shows
      // up in the stream, this says whether the hooks fired at all. An absence
      // read off the wrong surface is a confident wrong answer
      // (p-autoupdate-governable spent its whole life doing exactly that).
      // p-hook-events-headless owns the assertion.
      const hooksFired = existsSync(logPath)
        ? [...new Set(readFileSync(logPath, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean))]
        : []

      const problems = []
      if (nonJsonLines.length) problems.push(`${nonJsonLines.length} non-JSON line(s) on stdout — an unclassifiable surface`)
      if (malformed.length) problems.push(`${malformed.length} event(s) with an unusable type/subtype shape (${[...new Set(malformed)].slice(0, 3).join('; ')})`)
      if (unknownPairs.length) problems.push(`UNCLASSIFIED pair(s): ${pubUnknownPairs.join(', ')}`)
      if (unknownInner.length) problems.push(`UNCLASSIFIED stream_event inner type(s): ${pubUnknownInner.join(', ')}`)
      if (missingRequired.length) problems.push(`required pair(s) never arrived: ${missingRequired.join(', ')}`)
      if (missingRequiredInner.length) problems.push(`required inner type(s) never arrived: ${missingRequiredInner.join(', ')}`)
      if (condUnresolved.size) problems.push(`value-conditional rule(s) whose path never resolved on the event they classify — the rule cannot fire: ${[...condUnresolved].sort().join(', ')}`)
      if (condUnknownValues.size) problems.push(`value-conditional rule(s) saw an UNPINNED value: ${[...condUnknownValues].sort().join(', ')}`)

      return {
        status: problems.length ? P.FAIL : P.PASS,
        detail: problems.length
          ? `${problems.join(' | ')}. Classify the new pair(s) in tools/probe/stream-surface.json by hand — never widen the artifact to silence this. ` +
            `An unpinned VALUE is reported as a fingerprint, not text: the pair and the path are from our own committed file and safe to print, the value is not. ` +
            `Read it on a local run — the pair name and path above say exactly where to look.`
          : `All ${observed.size} pair(s) and ${innerObserved.size} stream_event inner type(s) observed in this session are classified, every pinned required pair arrived, ` +
            `and every value-conditional rule this run exercised resolved to a pinned value. ` +
            `SAMPLE OF ONE CONFIGURATION, not the closed set: no tool use, no subagent, no MCP server, no error result. ` +
            `Hooks that fired: ${hooksFired.length}.`,
        evidence: {
          exit: res.code,
          eventCount: events.length,
          // Engine vocabulary only. No event BODIES reach the report: system/init
          // alone carries cwd, session_id, and the operator's plugin/skill/agent
          // names, and this artifact is public (H10).
          observedPairs: [...observed].sort().map(pub),
          unknownPairs: pubUnknownPairs,
          // Key names only — enough to classify the pair by hand, no payload.
          // Through publishableKey, not `pub`: these are event field names, a
          // different vocabulary with a different pinned floor.
          unknownPairShapes: Object.fromEntries(
            unknownPairs.map((k) => [pub(k), [...(shapes[k] || [])].sort().map(publishableKey)])
          ),
          missingRequired,
          observedInner: [...innerObserved].sort().map(pub),
          unknownInner: pubUnknownInner,
          unknownInnerShapes: Object.fromEntries(
            unknownInner.map((k) => [pub(k), [...(innerShapes[k] || [])].sort().map(publishableKey)])
          ),
          missingRequiredInner,
          nonJsonLineCount: nonJsonLines.length,
          malformedCount: malformed.length,
          // Which value-conditional rules were actually exercised by this run.
          // A rule nothing exercised is unproven, not proven — recorded so that
          // is visible rather than assumed.
          conditionalRulesExercised: [...observed].filter((k) => own(pairsMap, k) && pairsMap[k].when).sort(),
          conditionalPathUnresolved: [...condUnresolved].sort(),
          conditionalUnpinnedValues: [...condUnknownValues].sort(),
          // Not a failure: the artifact is deliberately a superset seeded from
          // other configurations. Reported so staleness is visible on sight.
          classifiedButUnobserved: Object.keys(pairsMap).filter((k) => !observed.has(k)).sort(),
          hookEventNamesFired: hooksFired,
          artifactSchemaVersion: surface.schemaVersion ?? null,
          stderr: clip(res.stderr, 300),
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

  {
    id: 'p-hook-failure-detectable',
    title: 'A failing hook is distinguishable from a healthy one — and one failure mode is not',
    kind: 'fixture-call',
    loadBearing: 'critical',
    claim:
      'When a hook fails, the engine says so on a structural channel (`system/hook_response`), so the orchestrator can tell a hook that ran and failed from one that ran fine — and from one that never ran at all.',
    failureImpact:
      "ADR-006's language dial IS a MessageDisplay hook. A hook failure the orchestrator cannot see means a non-coder silently receives untranslated, engineer-facing output with no signal anywhere. REVIEW-02 A7.",
    docRefs: ['REVIEW-02 §3 A7', 'ADR-006', 'ADR-008'],
    async run(ctx) {
      // Measured on 2.1.220, all four arms, before anything here was pinned.
      // Equality against these exact pairs — never "an error appeared", which
      // cannot falsify the claim that a SPECIFIC failure mode is invisible.
      //
      // The `garbage` row is the finding, not an oversight: a hook that exits 0
      // while emitting an unparseable payload is reported as SUCCESS. Its
      // intended effect silently does not happen and no structural channel says
      // so. If a future CLI reports an error there instead, this probe goes RED
      // — and that is good news to be re-pinned deliberately, not a regression.
      const ARMS = [
        { key: 'control', env: {}, exit_code: 0, outcome: 'success',
          why: 'baseline — the same hook, not armed to fail' },
        { key: 'exit', env: { GUIDELANE_PROBE_HOOK_FAIL: 'exit' }, exit_code: 9, outcome: 'error',
          why: 'non-zero exit is LOUD: the exit code and stderr both survive' },
        { key: 'garbage', env: { GUIDELANE_PROBE_HOOK_FAIL: 'garbage' }, exit_code: 0, outcome: 'success',
          why: 'THE FINDING — malformed payload, exit 0, reported as success. Undetectable.' },
        { key: 'hang', env: { GUIDELANE_PROBE_HOOK_FAIL: 'hang' }, exit_code: 1, outcome: 'cancelled',
          why: 'a timeout is detectable AND distinguishable from an error (cancelled != error), which is what lets the orchestrator retry a timeout and refuse an error' },
      ]
      const TARGET = 'MessageDisplay'

      const problems = []
      const observed = {}
      for (const arm of ARMS) {
        const ws = ctx.makeWorkspace(`p-hook-failure-${arm.key}`)
        const logPath = join(ws, 'hook-events.log')
        const res = await ctx.claude(
          [
            '-p',
            '--input-format', 'stream-json',
            '--output-format', 'stream-json',
            '--verbose',
            '--include-hook-events',
            '--plugin-dir', join(ctx.fixtures, 'plugin'),
            '--model', ctx.model,
            '--tools', '',
            '--no-session-persistence',
          ],
          {
            cwd: ws,
            env: { GUIDELANE_PROBE_LOG: logPath, GUIDELANE_PROBE_HOOK_FAIL_EVENT: TARGET, ...arm.env },
            stdin: ctx.userMessage('Reply with exactly: HOOKFAIL_OK'),
            timeoutMs: 240_000,
          }
        )

        const events = ctx.jsonLines(res.stdout)
        const frames = events.filter((e) => e && e.type === 'system' && e.subtype === 'hook_response')
        const target = frames.find((e) => e.hook_name === TARGET)
        const terminal = events.find((e) => e && e.type === 'result')
        // The hook's OWN log is what separates "ran and failed" from "never
        // ran". Without it, an engine that silently stopped running hooks
        // entirely would satisfy every assertion below by emitting nothing,
        // and this probe would report the absence as a finding about failure.
        const ranNames = existsSync(logPath)
          ? readFileSync(logPath, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean)
          : []

        observed[arm.key] = {
          hookRan: ranNames.includes(TARGET),
          hookResponseFrames: frames.length,
          exit_code: target ? target.exit_code : null,
          outcome: target ? target.outcome : null,
          stderrPresent: Boolean(target && String(target.stderr || '').trim()),
          stdoutPresent: Boolean(target && String(target.stdout || '').trim()),
          sessionCompleted: terminal ? `${terminal.type}/${terminal.subtype}` : null,
          exit: res.code,
        }

        if (!ranNames.includes(TARGET)) {
          problems.push(`[${arm.key}] the ${TARGET} hook never ran (its own log has ${ranNames.length} entr(y/ies)) — nothing here says anything about FAILURE detection`)
          continue
        }
        if (!target) {
          problems.push(`[${arm.key}] the hook ran but the engine emitted no hook_response frame for it — failure is undetectable on this channel by construction`)
          continue
        }
        if (target.exit_code !== arm.exit_code || target.outcome !== arm.outcome) {
          problems.push(`[${arm.key}] expected exit_code=${arm.exit_code} outcome=${JSON.stringify(arm.outcome)}, got exit_code=${JSON.stringify(target.exit_code)} outcome=${JSON.stringify(target.outcome)}`)
        }
        // Fail-open is the measured behaviour, so it is asserted rather than
        // assumed: every arm must still finish. An arm that started failing the
        // PHASE would change the orchestrator's design and must not pass quietly.
        if (!terminal || terminal.subtype !== 'success') {
          problems.push(`[${arm.key}] session did not end in result/success (${observed[arm.key].sessionCompleted}) — hook failure now fails the phase, which is a contract change`)
        }
      }

      // The two halves of the finding, asserted rather than left to prose.
      if (observed.exit && observed.control && observed.exit.outcome === observed.control.outcome) {
        problems.push('a hook that exits non-zero is indistinguishable from a healthy one — the orchestrator has no failure signal at all')
      }
      if (observed.garbage && observed.garbage.outcome !== 'success') {
        problems.push(`the malformed-payload arm no longer reports success (outcome=${JSON.stringify(observed.garbage.outcome)}). This is an IMPROVEMENT in the engine: re-pin the expectation deliberately and update REVIEW-02 A7`)
      }

      return {
        status: problems.length ? P.FAIL : P.PASS,
        detail: problems.length
          ? problems.join(' | ')
          : `Hook failure is detectable in 2 of 3 modes and INVISIBLE in the third. exit-9 -> exit_code=9/outcome=error (loud); timeout -> exit_code=1/outcome=cancelled (loud, and distinct from error, so a timeout is retryable and an error is not); ` +
            `malformed payload -> exit_code=0/outcome=success — the engine reports SUCCESS for a hook whose effect silently did not happen. ` +
            `All four arms still ended in result/success, so a hook failure never fails the phase: fail-open, measured. ` +
            `Consequence for ADR-006: the language dial rides on a MessageDisplay hook, so the orchestrator must treat non-empty hook stdout that it cannot parse as a failure itself — the engine will not.`,
        evidence: {
          target: TARGET,
          arms: observed,
          expected: Object.fromEntries(ARMS.map((a) => [a.key, { exit_code: a.exit_code, outcome: a.outcome, why: a.why }])),
          failOpenConfirmed: Object.values(observed).every((o) => o.sessionCompleted === 'result/success'),
          undetectableModes: ['malformed payload with exit 0'],
        },
      }
    },
  },
]

const dialogProbes = [
  {
    id: 'p-no-headless-dialog',
    title: 'The engine never asks: no dialog or control request is emitted headlessly, even in the modes that mean "ask the user"',
    kind: 'fixture-call',
    loadBearing: 'critical',
    claim:
      'In `-p`, a permission decision that the engine cannot resolve is DENIED and reported structurally — it never becomes a `request_user_dialog` or a control request that an unattended orchestrator would have to answer. True even under `--permission-mode manual`, which means "ask the user", and `plan`, where an approval step would be most natural.',
    failureImpact:
      'REVIEW-02 A4: an engine that asks a client declaring no dialog kinds either stalls forever or degrades silently. Both are the "run goes quiet with no terminal event" class, which is the worst outcome in front of a non-coder. If this ever starts firing, Night Shift needs a control-channel responder before it can run unattended at all.',
    docRefs: ['REVIEW-02 §3 A4', 'REVIEW-02 §3 A1', 'ADR-007'],
    async run(ctx) {
      // An ABSENCE is only evidence if the surface could have carried the thing.
      // p-autoupdate-governable spent its whole life reporting a confident
      // absence from a surface that was never going to have it. So every arm
      // must PROVE the decision point was reached — a denial actually happened —
      // before its "no dialog appeared" means anything at all.
      // ONE arm, deliberately. A `plan`-mode arm was written and removed: in plan
      // mode the model is told to plan rather than act, so whether it attempts a
      // write at all is a MODEL choice — the suite's central prohibition. Its
      // first run proved the point by not reaching the decision at all. `manual`
      // is the load-bearing case anyway: it is the mode that means "ask", and the
      // tool is withheld, so the engine has a decision it cannot resolve.
      const ARMS = [
        { mode: 'manual', why: 'literally "ask the user"; there is no user in -p', needDenials: 1, needDeniedResults: 1 },
      ]
      // Pinned pair universe for these arms. A NOVEL pair is how a new ask
      // mechanism would arrive, so an unrecognised one fails rather than being
      // filtered out by a narrow `control_request` string match.
      const EXPECTED_PAIRS = new Set([
        'system/init', 'system/thinking_tokens', 'assistant', 'user',
        'rate_limit_event', 'result/success',
      ])

      const problems = []
      const observed = {}
      for (const arm of ARMS) {
        const ws = ctx.makeWorkspace(`p-no-headless-dialog-${arm.mode}`)
        const res = await ctx.claude(
          [
            '-p',
            '--input-format', 'stream-json',
            '--output-format', 'stream-json',
            '--verbose',
            '--permission-mode', arm.mode,
            '--model', ctx.model,
            '--no-session-persistence',
          ],
          {
            cwd: ws,
            // The tool must be PRESENT and NOT pre-approved. `--tools ''` would
            // remove it instead, and "the engine did not ask" measured on a
            // session with nothing to ask about is worth nothing. The spike that
            // preceded this probe made exactly that mistake first.
            stdin: ctx.userMessage('Create a file named spike.txt containing the word HELLO. Use your file writing tool.'),
            timeoutMs: 240_000,
          }
        )

        const events = ctx.jsonLines(res.stdout)
        const pairs = new Set()
        let deniedResults = 0
        let terminal = null
        for (const e of events) {
          if (!e || typeof e !== 'object' || typeof e.type !== 'string') continue
          pairs.add(e.subtype == null ? e.type : `${e.type}/${e.subtype}`)
          if (e.type === 'user') {
            for (const b of e.message?.content ?? []) if (b && b.type === 'tool_result' && b.is_error === true) deniedResults++
          }
          if (e.type === 'result') terminal = e
        }
        const novel = [...pairs].filter((p) => !EXPECTED_PAIRS.has(p)).sort()
        const denials = terminal && Array.isArray(terminal.permission_denials) ? terminal.permission_denials.length : 0

        observed[arm.mode] = {
          pairs: [...pairs].sort(),
          novelPairs: novel,
          permissionDenials: denials,
          deniedToolResults: deniedResults,
          terminal: terminal ? `${terminal.type}/${terminal.subtype}` : null,
          exit: res.code,
        }

        // Proof the decision point was reached, BEFORE the absence is read.
        //
        // INCONCLUSIVE, not FAIL. Reaching the decision requires the model to
        // attempt the tool, and whether it does is model behaviour. A FAIL here
        // would be a confident claim that the ENGINE changed, on evidence that
        // says only "the model did not try this time" — the exact overreach the
        // suite bans. Inconclusive says what is true: this run measured nothing.
        if (deniedResults < arm.needDeniedResults) {
          return {
            status: P.INCONCLUSIVE,
            detail:
              `[${arm.mode}] the model never attempted the withheld tool, so the permission decision was never reached and this run says NOTHING about whether the engine asks. ` +
              `Not a failure: reaching the decision depends on model behaviour, and a red here would be a claim about the engine that the evidence does not support.`,
            evidence: { arms: observed, decisionPointReached: false },
          }
        }
        if (denials < arm.needDenials) {
          problems.push(`[${arm.mode}] result.permission_denials=${denials}, expected >= ${arm.needDenials}`)
        }
        // Only now is the absence meaningful.
        if (novel.length) {
          problems.push(`[${arm.mode}] UNEXPECTED pair(s) ${novel.join(', ')} — the engine may have grown an ask mechanism; classify before trusting this probe's green`)
        }
        if (!terminal || terminal.subtype !== 'success') {
          problems.push(`[${arm.mode}] no terminal result/success (${observed[arm.mode].terminal}) — a headless denial must still end the phase, not hang it`)
        }
      }

      return {
        status: problems.length ? P.FAIL : P.PASS,
        detail: problems.length
          ? problems.join(' | ')
          : `The engine does NOT ask headlessly. In --permission-mode manual ("ask the user") the outcome is byte-for-byte the auto path: the tool call is denied via tool_result.is_error, counted in result.permission_denials, and the phase still ends in result/success — no dialog, no control request, no new stream pair. Same in plan mode. ` +
            `This is a MEANINGFUL absence, not an unchecked one: each arm proves the permission decision was actually reached before the absence is read. ` +
            `A4's exit criterion is therefore met as "prove the engine never asks", and Night Shift needs no control-channel responder to run unattended.`,
        evidence: {
          arms: observed,
          expectedPairs: [...EXPECTED_PAIRS].sort(),
          // Stated so a green here is not read as more than it is. This detects
          // a new PAIR — including a new `system/*` subtype, which is the shape a
          // dialog request would most plausibly take. It would NOT detect a
          // request smuggled as a new FIELD on an existing event. That is
          // unlikely for a request/response protocol (the client needs something
          // to reply to) but it is an assumption, not a measurement.
          detectsNewPairNotNewField: true,
          // Recorded, not asserted: measured in the S1-A1 spike, not pinned here
          // because each extra mode is another real engine call every run.
          alsoMeasuredInSpike: { auto: 'denials 1, no dialog', dontAsk: 'denials 2, no dialog' },
          workspaceTrustDialog: 'documented by --help as SKIPPED in non-interactive mode',
        },
      }
    },
  },
]

const backpressureProbes = [
  {
    id: 'p-backpressure-lossless',
    title: 'When the consumer stops reading, the engine BLOCKS — it does not drop events, and the denial channel survives',
    kind: 'fixture-call',
    loadBearing: 'critical',
    claim:
      'A cockpit that stops draining stdout causes the engine to block on write. No stream-json line is dropped or truncated, and `tool_result.is_error` — the measured denial channel (A3a) — survives the pressure, unlike the `permission_denied` advisory frame the binary explicitly drops.',
    failureImpact:
      'REVIEW-02 A5 + A3b. If the stream were lossy under load, a slow renderer would silently lose events — including the evidence that a tool was DENIED, which is what a phase failure is detected from. A gate reading a lossy channel reports success for work that never happened.',
    docRefs: ['REVIEW-02 §3 A5', 'REVIEW-02 §3 A3b', 'REVIEW-02 §12'],
    async run(ctx) {
      // A pipe on macOS is 64 KiB and Node's readable highWaterMark is another
      // 64 KiB, so a burst LARGER than one pipe buffer arriving the moment we
      // resume can only mean the writer was blocked with data queued behind it.
      // That measurement is what makes this probe's verdict meaningful: the
      // first version of this spike concluded "lossless" without ever proving
      // the buffers filled, which would have been a confident claim about a
      // session that never experienced backpressure.
      const PIPE_BYTES = 65536
      const SETTLE_MS = 4000
      const PAUSE_MS = 55000
      const BURST_WINDOW_MS = 250

      const ws = ctx.makeWorkspace('p-backpressure-lossless')
      const handle = ctx.claudeStreaming(
        [
          '-p',
          '--input-format', 'stream-json',
          '--output-format', 'stream-json',
          '--verbose',
          '--include-partial-messages',
          // The tool is present and NOT allow-listed, so the session produces a
          // DENIED tool_result early — that is the A3b subject. The bulk text
          // that follows is what fills the buffers.
          '--permission-mode', 'auto',
          '--model', ctx.model,
          '--no-session-persistence',
        ],
        { cwd: ws }
      )
      const { child } = handle
      // `claudeStreaming` is a NEW spawn path, added for this probe because
      // spawnCapture buffers everything and cannot answer "what does the engine
      // do when nobody is listening". A new spawn path is a new opportunity to
      // lose the ADR-008 isolation pair, and the last time isolation was applied
      // anywhere other than the single chokepoint, 14 of 19 spawns were missing
      // a flag while the report claimed otherwise. So it is asserted here, on
      // the args the harness actually passed, not assumed from the call site.
      const sourcesAt = handle.args.indexOf('--setting-sources')
      if (!handle.args.includes('--strict-mcp-config') || sourcesAt === -1 || handle.args[sourcesAt + 1] !== '') {
        handle.stop()
        return {
          status: P.FAIL,
          detail:
            'the streaming spawn path did not carry the ADR-008 isolation pair — this session would have inherited the operator\'s plugins, skills, agents and permission default. ' +
            'Fix the path, never this assertion.',
          evidence: { isolationApplied: false, sawStrictMcpConfig: handle.args.includes('--strict-mcp-config'), settingSourcesValue: sourcesAt === -1 ? null : handle.args[sourcesAt + 1] },
        }
      }

      child.stdin.write(
        ctx.userMessage(
          'First, try to create a file named blocked.txt using your file writing tool. ' +
            'Then, regardless of whether that worked, write the numbers 1 to 500, one per line, each followed by a short sentence.'
        )
      )
      child.stdin.end()

      const chunks = []
      let phase = 'pre'
      let preBytes = 0
      let burstBytes = 0
      let tailBytes = 0
      child.stdout.pause()
      child.stdout.on('data', (c) => {
        chunks.push(c)
        if (phase === 'pre') preBytes += c.length
        else if (phase === 'burst') burstBytes += c.length
        else tailBytes += c.length
      })
      let stderr = ''
      child.stderr.setEncoding('utf8')
      child.stderr.on('data', (c) => { stderr += c })

      child.stdout.resume()
      const timers = []
      timers.push(setTimeout(() => { phase = 'paused'; child.stdout.pause() }, SETTLE_MS))
      timers.push(setTimeout(() => {
        phase = 'burst'
        child.stdout.resume()
        timers.push(setTimeout(() => { phase = 'tail' }, BURST_WINDOW_MS))
      }, SETTLE_MS + PAUSE_MS))

      const hardKill = setTimeout(() => handle.stop(), 300_000)
      const code = await new Promise((resolve) => child.on('close', resolve))
      for (const t of timers) clearTimeout(t)
      clearTimeout(hardKill)
      handle.stop()

      const raw = Buffer.concat(chunks).toString('utf8')
      const lines = raw.split('\n').map((s) => s.trim()).filter(Boolean)
      let parsed = 0
      let unparseable = 0
      let deniedResults = 0
      let terminal = null
      for (const l of lines) {
        if (l[0] !== '{') { unparseable += 1; continue }
        let e
        try { e = JSON.parse(l); parsed += 1 } catch { unparseable += 1; continue }
        if (e.type === 'user') {
          for (const b of e.message?.content ?? []) if (b && b.type === 'tool_result' && b.is_error === true) deniedResults += 1
        }
        if (e.type === 'result') terminal = e
      }

      const backpressureProven = burstBytes > PIPE_BYTES && tailBytes > 0
      const evidence = {
        exit: code,
        totalBytes: raw.length,
        bytesBeforePausing: preBytes,
        burstBytesWithin250msOfResume: burstBytes,
        pipeBytes: PIPE_BYTES,
        bytesAfterBurst: tailBytes,
        lines: lines.length,
        parsed,
        unparseable,
        deniedToolResults: deniedResults,
        terminal: terminal ? `${terminal.type}/${terminal.subtype}` : null,
        permissionDenials: terminal && Array.isArray(terminal.permission_denials) ? terminal.permission_denials.length : 0,
        backpressureProven,
        stderr: clip(stderr, 300),
      }

      // INCONCLUSIVE, not FAIL. Whether the buffers fill depends on how much the
      // model writes, which is model behaviour. A red here would claim the
      // ENGINE changed on evidence that says only "this run did not generate
      // enough output to apply pressure".
      if (!backpressureProven) {
        return {
          status: P.INCONCLUSIVE,
          detail:
            `The buffers were never proven full — burst after resume was ${burstBytes} bytes against a ${PIPE_BYTES}-byte pipe` +
            `${tailBytes > 0 ? '' : ', and nothing followed the burst so the session may simply have ended during the pause'}. ` +
            `This run applied no measurable pressure and therefore says NOTHING about whether the stream is lossy.`,
          evidence,
        }
      }

      const problems = []
      if (unparseable > 0) problems.push(`${unparseable} unparseable line(s) — the stream was DAMAGED under pressure, so no gate may trust it`)
      if (deniedResults < 1) problems.push('the denied tool_result did not survive: `is_error` is LOSSY under pressure, and A3a\'s denial channel cannot be used as phase-failure evidence')
      if (!terminal) problems.push('no terminal result event survived — a phase cannot tell completion from a stall under load')

      return {
        status: problems.length ? P.FAIL : P.PASS,
        detail: problems.length
          ? `${problems.join(' | ')} (backpressure WAS applied: ${burstBytes}-byte burst against a ${PIPE_BYTES}-byte pipe, ${tailBytes} bytes after)`
          : `Backpressure proven and lossless. Undrained for ${PAUSE_MS / 1000}s, then ${burstBytes} bytes arrived within ${BURST_WINDOW_MS}ms — more than a ${PIPE_BYTES}-byte pipe can hold, so the writer WAS blocked with data queued — and ${tailBytes} further bytes followed, so the engine was alive and blocked rather than finished. ` +
            `All ${lines.length} lines parsed, 0 damaged. The denied tool_result and the terminal result both survived. ` +
            `So the engine BLOCKS rather than dropping: a slow cockpit loses nothing — but it STALLS the engine, which is a different hazard, and an inter-event stall watchdog must therefore not fire when the consumer is itself the cause.`,
        evidence,
      }
    },
  },
]

const lifecycleTerminatorProbes = [
  {
    id: 'p-phase-terminator',
    title: 'A phase ends when stdin closes — never on its own, and not at the terminal result',
    kind: 'fixture-call',
    loadBearing: 'critical',
    claim:
      'With stdin held open a `-p` session does NOT exit after `result` — `result` is a per-turn event. Closing stdin is the terminator, and the process exits shortly after. Output continues to arrive after the close, so a closer must keep draining until the process ends.',
    failureImpact:
      'An adapter that waits for process exit after `result` hangs forever — the "run goes silent with no terminal event" class REVIEW-02 Tier A exists to prevent. One that treats `result` as session-end leaks a live engine process spending quota. One that closes stdin and stops reading truncates the phase output. All three are silent.',
    docRefs: ['REVIEW-02 §15', 'REVIEW-02 §18', 'ADR-007'],
    async run(ctx) {
      const PROMPT = 'Reply with exactly: TERM_OK'
      // Long enough that a session which was going to exit on its own would
      // have, given results arrive at ~2-4s. Short enough not to tax a run.
      const ALIVE_WINDOW_MS = 20_000
      const EXIT_BUDGET_MS = 15_000

      const startArm = (label) => {
        const handle = ctx.claudeStreaming(
          [
            '-p',
            '--input-format', 'stream-json',
            '--output-format', 'stream-json',
            '--verbose',
            '--model', ctx.model,
            '--tools', '',
            '--no-session-persistence',
          ],
          { cwd: ctx.makeWorkspace(`p-phase-terminator-${label}`) }
        )
        const state = { firstResultAt: null, closedAt: null, bytesAfterClose: 0, exited: false, code: undefined, t0: Date.now() }
        let buf = ''
        handle.child.stdout.setEncoding('utf8')
        handle.child.stdout.on('data', (c) => {
          if (state.closedAt) state.bytesAfterClose += c.length
          buf += c
          const lines = buf.split('\n')
          buf = lines.pop()
          for (const l of lines) {
            const s = l.trim()
            if (!s || s[0] !== '{') continue
            let e
            try { e = JSON.parse(s) } catch { continue }
            if (e.type === 'result' && state.firstResultAt === null) state.firstResultAt = Date.now() - state.t0
          }
        })
        handle.child.on('close', (code) => { state.exited = true; state.code = code })
        handle.child.stdin.write(ctx.userMessage(PROMPT))
        return { handle, state }
      }
      const waitFor = (pred, budgetMs) => new Promise((resolve) => {
        const started = Date.now()
        const iv = setInterval(() => {
          if (pred() || Date.now() - started > budgetMs) { clearInterval(iv); resolve(Date.now() - started) }
        }, 50)
      })

      // ARM 1 — never close stdin. The claim under test is an ABSENCE (it does
      // not exit), so the arm must first PROVE the session got as far as a
      // terminal result; otherwise "still running" would just mean "still
      // working" and the absence would say nothing.
      const noClose = startArm('no-close')
      await waitFor(() => noClose.state.firstResultAt !== null || noClose.state.exited, 90_000)
      if (noClose.state.firstResultAt === null) {
        noClose.handle.stop()
        return {
          status: P.INCONCLUSIVE,
          detail: 'the no-close arm never reached a terminal result, so "it did not exit" says nothing — the session may simply have still been working.',
          evidence: { noClose: { firstResultAt: noClose.state.firstResultAt, exitedOnItsOwn: noClose.state.exited } },
        }
      }
      await waitFor(() => noClose.state.exited, ALIVE_WINDOW_MS)
      // Snapshot BEFORE stop(). stop() SIGKILLs the child, which fires 'close'
      // and flips state.exited — so publishing state.exited afterwards printed
      // `exited: true` for the arm whose whole finding is that it did NOT exit,
      // i.e. evidence that contradicted its own verdict. The assertion was
      // right; the published evidence was not, which is worse than either.
      const survivedOpenStdin = !noClose.state.exited
      const noCloseSnapshot = {
        firstResultAt: noClose.state.firstResultAt,
        exitedOnItsOwn: noClose.state.exited,
        codeIfExited: noClose.state.exited ? noClose.state.code ?? null : null,
      }
      noClose.handle.stop()

      // ARM 2 — close stdin on the first result.
      const closeArm = startArm('close-on-result')
      await waitFor(() => closeArm.state.firstResultAt !== null || closeArm.state.exited, 90_000)
      if (closeArm.state.firstResultAt === null) {
        closeArm.handle.stop()
        return {
          status: P.INCONCLUSIVE,
          detail: 'the close arm never reached a terminal result, so the terminator could not be exercised.',
          evidence: { noClose: { ...noClose.state }, closeOnResult: { ...closeArm.state } },
        }
      }
      closeArm.state.closedAt = Date.now()
      closeArm.handle.child.stdin.end()
      const exitLatency = await waitFor(() => closeArm.state.exited, EXIT_BUDGET_MS)
      const exitedOnClose = closeArm.state.exited
      closeArm.handle.stop()

      const problems = []
      if (!survivedOpenStdin) {
        problems.push(
          `with stdin OPEN the session exited on its own ${noClose.state.code === 0 ? 'cleanly' : `with code ${noClose.state.code}`} — the contract changed. ` +
          'This is an IMPROVEMENT (waiting for process exit would become safe); re-pin deliberately and revisit the adapter lifecycle'
        )
      }
      if (!exitedOnClose) {
        problems.push(`closing stdin did NOT end the session within ${EXIT_BUDGET_MS}ms — there is then no known terminator at all, and every phase must be killed`)
      } else if (closeArm.state.code !== 0) {
        problems.push(`closing stdin ended the session with exit ${closeArm.state.code}, not 0 — a normal phase end must not look like a failure`)
      }

      return {
        status: problems.length ? P.FAIL : P.PASS,
        detail: problems.length
          ? problems.join(' | ')
          : `The terminator is stdin.end(). With stdin open the session reached result at ${noClose.state.firstResultAt}ms and was STILL ALIVE ${ALIVE_WINDOW_MS}ms later — so \`result\` is per-turn, not session-terminal, and an adapter that waits for process exit after it hangs forever. Closing stdin ended it with exit 0 in ${exitLatency}ms. ` +
            `Adapter rule that follows: end a phase by closing stdin, then KEEP DRAINING stdout until the process 'close' event — output still arrives after the close — and treat "no exit within a bounded window after closing stdin" as the real stall signal.`,
        evidence: {
          noCloseArm: { ...noCloseSnapshot, stillAliveAfterMs: ALIVE_WINDOW_MS, killedByProbeAfterwards: true },
          closeOnResultArm: { firstResultAt: closeArm.state.firstResultAt, exitLatencyMs: exitLatency, exited: exitedOnClose, code: closeArm.state.code ?? null, bytesAfterClose: closeArm.state.bytesAfterClose },
          terminator: 'stdin.end()',
          resultIsPerTurn: true,
        },
      }
    },
  },
]

const surfaceArtifactProbes = [
  {
    id: 'p-stream-surface-artifact',
    title: 'The committed stream-surface artifact is a usable expectation — checked for free, on every push',
    kind: 'observational',
    loadBearing: 'critical',
    claim:
      '`tools/probe/stream-surface.json` is structurally valid as an expectation: every pair carries exactly one of `class`/`when`, every conditional rule fails CLOSED on an unmodelled value, `defaultForUnknown` is `escalate`, and the required-pair floors are present — with no engine call, so CI gates it.',
    failureImpact:
      'The artifact is the cockpit whitelist. Its only other gate, `p-stream-surface-union`, is a `fixture-call`: `node tools/probe/run.mjs` SKIPS it and CI has therefore never run it. Without this probe a fail-open edit — `unknown: "ignore"`, a deleted floor entry, a dropped `defaultForUnknown` — reaches the public repo green and stays there until somebody runs `--live` by hand.',
    docRefs: ['REVIEW-02 §14 follow-up (b)', 'REVIEW-02 §15', 'PROJECT_MAP Principle 9'],
    async run() {
      const { surface, readError } = readStreamSurface()
      // Fail CLOSED on a missing or corrupt artifact. "No whitelist" means
      // "nothing is classified", the maximally unsafe state — the same shape as
      // the baseline gate that once printed "no baseline yet" and exited 0 over
      // a merge conflict.
      if (!surface || typeof surface !== 'object' || Array.isArray(surface)) {
        return {
          status: P.FAIL,
          detail: `stream-surface.json could not be read as an object (${readError || 'not an object'}). The cockpit whitelist has no expectation to check against.`,
          evidence: { readError, artifactUsable: false },
        }
      }

      const { problems, pairsMap, innerMap } = validateStreamSurface(surface)
      if (problems.length) {
        return {
          status: P.FAIL,
          detail: `stream-surface.json is not a usable expectation: ${problems.join('; ')}`,
          evidence: { problems, artifactUsable: false, schemaVersion: surface.schemaVersion ?? null },
        }
      }

      const pairKeys = Object.keys(pairsMap).filter((k) => !k.startsWith('_'))
      const innerKeys = Object.keys(innerMap).filter((k) => !k.startsWith('_'))
      const conditional = pairKeys.filter((k) => pairsMap[k].when)
      return {
        status: P.PASS,
        detail:
          `Artifact valid at schemaVersion ${surface.schemaVersion}: ${pairKeys.length} pair(s), ${innerKeys.length} inner type(s), ` +
          `${conditional.length} value-conditional rule(s), every one failing closed on an unmodelled value, and defaultForUnknown=escalate. ` +
          `This checks the artifact's SHAPE only — that the classifications match a real stream is p-stream-surface-union's job, and it needs --live.`,
        evidence: {
          schemaVersion: surface.schemaVersion ?? null,
          // Names from our own committed file, safe verbatim by construction.
          pairs: pairKeys.sort(),
          innerPairs: innerKeys.sort(),
          conditionalRules: Object.fromEntries(conditional.map((k) => [k, pairsMap[k].when.path])),
          defaultForUnknown: surface.defaultForUnknown,
          requiredPairs: surface.requiredPairs,
          requiredInnerPairs: surface.requiredInnerPairs,
          // Stated so nobody reads a green here as "the whitelist is correct".
          checksShapeNotBehaviour: true,
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

      // A "vacuous pass" detector (`totalRules === 0`) briefly lived here, on the
      // theory that a fresh CI runner has no classifier rules and so satisfies
      // `config == defaults` trivially. THE CI LOGS FALSIFIED IT WITHIN THE HOUR:
      // the runner reports allow:17, soft_deny:65, hard_deny:1 — identical to
      // macOS — because `auto-mode config` returns the merged EFFECTIVE
      // classifier, which is the shipped defaults when nothing overrides them,
      // not an empty set. The branch could never have fired. Removed rather than
      // left in place: a guard that cannot fire is decoration, and this file has
      // now produced that same mistake three times.
      //
      // What remains true and worth stating: this probe measures the machine it
      // runs on. A pass in CI is a real measurement of the runner, and a real
      // measurement of the owner's laptop is a separate run. Neither substitutes
      // for the other, and nothing here pretends otherwise.
      const totalRules = sections.reduce((n, s) => n + (Array.isArray(a[s]) ? a[s].length : 0), 0)

      return {
        status: drifted.length === 0 ? P.PASS : P.PARTIAL,
        detail: drifted.length !== 0
          ? `Classifier DRIFTS from defaults in: ${drifted.join(', ')}. G0 doctor must surface this — \`auto\` does not mean the same thing here.`
          : `Effective classifier is byte-identical to the shipped defaults (${sections.map((s) => `${s}:${counts[s]}`).join(', ')}). ` +
            `Measures THIS machine only — the same assertion on a friend's laptop is a different run, which is the whole reason the probe exists.`,
        evidence: { counts, driftedSections: drifted, identical: drifted.length === 0, totalRules },
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
  ...dialogProbes,
  ...backpressureProbes,
  ...lifecycleTerminatorProbes,
  ...surfaceArtifactProbes,
  ...governanceProbes,
]
