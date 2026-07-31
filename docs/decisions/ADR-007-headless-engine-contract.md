# ADR-007: The Headless Engine Contract — As Measured, Not As Assumed

- **Status**: Accepted
- **Date**: 2026-07-30
- **Deciders**: Talha (owner), Claude (technical lead)
- **Supersedes**: none. **Corrects** RESEARCH-01 §4.3 mechanism 2 and ADR-003's Atlas delivery method.

## Context

ADR-001 makes the official `claude` CLI Guidelane's engine and requires a
conformance probe before anything is built on it. That probe now exists
(`tools/probe/`) and has been run live against `claude` 2.1.220: 23 probes,
21 pass, 0 fail, 2 honest unknowns (`docs/research/S0-conformance-report.md`).

Three of its findings change the design. Two of them were assumptions the plan
stated confidently and got wrong; one is a capability the plan assumed absent.

## Options considered

### Finding 1 — Permission model in headless mode

RESEARCH-01 §4.3 mechanism 2 claimed: *"`--permission-mode auto` removes
engineer-facing approval dialogs from the default path. Safety moves to a
fail-closed `PreToolUse` hook plus `--disallowedTools`."*

Measured (`p-permission-allowlist`):

| Invocation | Result |
|---|---|
| `--permission-mode auto` alone | Tool call **denied** — *"Claude requested permissions to write to …, but you haven't granted it yet"*. No file written. **The model then replied `WROTE_OK` anyway.** |
| `--permission-mode auto --allowedTools Write` | File written, no interactive prompt |
| `--permission-mode bypassPermissions` | File written (all tools ungated) |

- **Option A — `bypassPermissions` + our own `PreToolUse` guard**: works, but
  moves the entire safety burden onto a hook we write. One bug in that hook and
  an autonomous agent has an ungated filesystem.
- **Option B — `auto` + explicit per-stage `--allowedTools`**: the engine
  itself denies everything not named. Our guard becomes defence in depth rather
  than the only wall.

### Finding 2 — Atlas delivery vs MCP isolation

ADR-003 specified Atlas as "bundled via the plugin's `.mcp.json`". Measured
(`p-plugin-bundled-mcp`): the bundled server does load, exposed as
`mcp__plugin_guidelane-probe_echo__guidelane_probe_echo` — i.e. exactly the
documented `mcp__plugin_<plugin>_<server>__<tool>` shape — **but it disappears
when `--strict-mcp-config` is set.** That flag excludes plugin-bundled servers
along with the user's own. So plugin-bundled Atlas and MCP isolation are
mutually exclusive.

- **Option A — bundle Atlas in the plugin, drop `--strict-mcp-config`**: the
  friend's own MCP servers leak into every Guidelane session — unpredictable
  tools, unpredictable latency, unpredictable failures.
- **Option B — pass Atlas via `--mcp-config` and keep `--strict-mcp-config`**:
  proven working (`p-mcp-strict-load`, tool callable as
  `mcp__atlas__<tool>`); sessions stay hermetic.

### Finding 3 — Rate limits are machine-readable after all

RESEARCH-02 §8.2 and REVIEW-01 both assumed no reliable limit signal and
specified blind backoff-polling. Measured (`p-rate-limit-signal`): **every**
stream-json session emits

```json
{"type":"rate_limit_event","rate_limit_info":{
  "status":"allowed","resetsAt":1785451200,"rateLimitType":"five_hour",
  "overageStatus":"rejected","isUsingOverage":false}}
```

`resetsAt` is epoch seconds. The supervisor does not have to guess.

#### Correction, 2026-07-31 (evening) — there is a second window type, and it is not sleepable

The block above records one window. A live run of the S1 engine adapter emitted a
second one, on the same flags and the same model, hours later:

```json
{"type":"rate_limit_event","rate_limit_info":{
  "status":"allowed_warning","resetsAt":1785985200,"rateLimitType":"seven_day",
  "utilization":0.51,"isUsingOverage":false}}
```

Three corrections follow, and the third is a design change:

1. **`status` has at least three values, not one.** `allowed_warning` is a
   healthy session approaching a ceiling. The suite had only ever seen `allowed`,
   and this value was surfaced by the adapter's fail-closed `unknown: escalate`
   branch rather than by anyone predicting it — which is the branch working as
   designed. It is now classified `render` in `tools/probe/stream-surface.json`.
2. **`utilization`** (a 0–1 fraction) is a field this ADR did not record. It is
   the only forward-looking number the engine gives: it says *how close*, where
   `resetsAt` only says *when it ends*.
3. **`seven_day` breaks "sleep to `resetsAt`".** That rule was written against a
   five-hour window, where sleeping is the right answer — the run resumes the
   same night. A seven-day window's `resetsAt` can be days out. A Night Shift
   supervisor that obeys Finding 3 literally would go silent until next week
   while looking exactly like a working run, which is the specific failure
   REVIEW-02 names as the worst available outcome in front of a non-coder.
   **The rule is therefore split by window type**: sleep only when the wait fits
   inside the run's own remaining budget; otherwise stop the phase, park the
   work, and say so in plain language with the reset date. The threshold is the
   supervisor's, not the engine's — the engine reports, Guidelane decides.

The probe (`p-rate-limit-signal`) asserts the *presence* of `status`,
`rateLimitType` and `resetsAt`, not their values, so it did not and will not go
red on this. That is deliberate: pinning the value set here would make the probe
fail every time the vendor adds a window, which is drift the cockpit whitelist is
built to absorb (`defaultForUnknown: escalate`) rather than a contract break.

## Decision

**Finding 1 → Option B.** Every session runs `--permission-mode auto` with an
explicit `--allowedTools` list scoped to that stage's role. Nothing unnamed can
run; the engine is the fail-closed layer. The `PreToolUse` guard and
`--disallowedTools` remain as defence in depth, not as the primary wall.
Read-only roles (planner, auditor, reviewer) get an allow-list containing no
mutating tools, which makes ADR-002's "review sessions are read-only by
construction" literally true, enforced by the vendor's own binary.

**Finding 2 → Option B.** Atlas ships via `--mcp-config` on every invocation,
with `--strict-mcp-config` always on. Session hermeticity outranks delivery
elegance. The behaviour-pack plugin still ships skills, agents, and hooks; it
simply does not carry the MCP server. ADR-003 is corrected accordingly.

**Finding 3 → adopt the signal.** The Night Shift supervisor parses
`rate_limit_event`, sleeps to `resetsAt` on a limit, and reports window type
and reset time in the morning report and the cockpit. Blind backoff-poll stays
as the fallback for unknown non-zero exits, not as the primary mechanism.
*Amended 2026-07-31 (see the correction under Finding 3): "sleeps to `resetsAt`"
holds for `five_hour` and must NOT be applied to `seven_day` — a wait that
outlasts the run stops the phase and tells the user, it does not sleep.*

Confirmations recorded by the same run (no design change, but now measured
rather than assumed): all 33 depended-on flags exist; `--bare`'s help text
matches the quote the prohibition rests on, verbatim; bidirectional stream-json
round-trips with partial messages, replay, and a terminal `result` event
carrying `usage`, `total_cost_usd`, `modelUsage`, `num_turns`;
`--json-schema` produced schema-valid nested output; `--append-system-prompt`
changes behaviour; session id / resume / fork behave as the artifact store
assumes; a session-only `--plugin-dir` plugin loads and its skill resolves from
a headless prompt; **`MessageDisplay` fires in headless mode and an
empty-stdout hook does not suppress assistant text** — so R3 mechanism 4 is
viable; 8 hook events fire in `-p` (SessionStart, InstructionsLoaded,
UserPromptSubmit, PreToolUse, PostToolUse, MessageDisplay, Stop, SessionEnd),
surfaced in-stream as `hook_started`/`hook_*` system events;
`claude plugin validate --strict` **fails on a missing `author` field**, so the
real manifest must carry one; and `--max-budget-usd` **is enforced** on this
machine's auth (a ~zero ceiling refused the call, exit 1) — REVIEW-01's
"probably inert under subscription" hypothesis is not confirmed here, though
the operator's auth mode was not independently determined, so the guardrail
story keeps timeouts, cycle caps, and retry ceilings as primary.

## Consequences

### Positive
- The safety model is **stronger and simpler** than planned: per-stage
  allow-lists are enforced by the engine, not by our code.
- Night Shift can pause precisely and tell the user when capacity returns.
- Sessions are hermetic: a friend's own MCP config cannot alter a Guidelane run.
- The non-engineer surface keeps its in-engine net (`MessageDisplay` works).

### Negative / accepted trade-offs
- Every session profile must now maintain an accurate allow-list; a missing
  entry shows up as "the agent did nothing" rather than as an error. The
  orchestrator must therefore treat *tool-denied* stream events as a first-class
  failure signal, not as silence.
- Atlas delivery is one more flag on every invocation instead of riding along
  with the plugin.
- The observed `rate_limit_event` is the healthy branch only; the rejected
  branch was deliberately not provoked (it would cost hours of the operator's
  capacity), so the supervisor must handle an unseen shape defensively.

### Follow-up work required
- [ ] S2: session profiles carry `role → (model, effort, allowedTools)`; add a
      denied-tool detector that fails the phase loudly instead of silently.
- [ ] S2: Night Shift parses `rate_limit_event`; sleep-to-`resetsAt`.
- [ ] Real behaviour-pack manifest must include `author`.
- [ ] Nightly CI: `node tools/probe/run.mjs` (help-text tier) on every run,
      `--live` on a schedule, per ADR-001.

## References

- `tools/probe/` — the harness; `docs/research/S0-conformance-report.md` and
  `S0-conformance-results.json` — the evidence.
- Corrects: `docs/research/RESEARCH-01-feasibility.md` §4.3 mech. 2;
  `docs/decisions/ADR-003-atlas-mcp.md` (delivery).
- Upgrades: `docs/research/RESEARCH-02-product-architecture.md` §8.2 item 4;
  `docs/research/REVIEW-01-independent-findings.md` C1 (rate-limit signal).
