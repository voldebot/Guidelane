# REVIEW-02 — Runtime-Protocol Gaps in the S0 Conformance Suite

**Date**: 2026-07-30
**Method**: 7-agent orchestrated audit (5 parallel extraction lenses → consolidation → completeness critic), 139 raw engine assumptions extracted from RESEARCH-01/02/04 + REVIEW-01 + architecture.md + CLAUDE.md, distilled into a 24-probe matrix, then adversarially critiqued for what the matrix *misses*. 848 K subagent tokens, 264 tool calls, 54 minutes, all on Opus 5.
**Subject**: the S0 engine conformance probe (`tools/probe/`, 26 probes) and the engine assumptions the plan rests on.
**Status of this document**: findings accepted; dispositions below are decisions. Three findings were measured immediately and became [ADR-008](../decisions/ADR-008-session-isolation-and-init-receipt.md). The rest is the S1 work list.

---

## 1. The verdict, verbatim

> "This matrix is a strong STATIC/CONFIGURATION conformance suite and a weak RUNTIME PROTOCOL suite. It would pass green on a machine where S1's activity feed is unrenderable and S2's kill-9 gate is unmet. […] the four things that actually decide whether a non-coder can watch a build go by are untested: (1) the bidirectional control channel […] an unanswered control request is a session that stalls forever with no result and no exit […]; (2) the closed set of stream types/subtypes the whitelist renderer must cover […]; (3) the loss-tolerance of the denial channel, where the binary literally logs 'dropping oldest permission_denied advisory frames' — directly undermining CLAUDE.md §3's 'a tool-denied stream event is a loud phase failure, never silence'; and (4) engine-side crash/cancel/orphan semantics, which IS the S2 exit gate."

That is a fair description of what was built. S0 answered *can we drive the engine and configure it correctly?* It did not answer *what does the engine do to us while it runs?* Those are different suites, and only the first exists.

## 2. What the critic got wrong — stated plainly

The critic audited the *proposed* 24-probe matrix, not the harness actually on disk. Several "dropped probe" complaints are false against the shipped suite:

| Critic's claim | Reality in `tools/probe/probes.mjs` |
|---|---|
| `--json-schema` "entirely absent" (gap 6) | `p-json-schema` exists and passes, including nested arrays. **The bounded-retry failure branch is genuinely untested** — that half stands. |
| `rate_limit_event` coverage "dropped" (gap 15) | `p-rate-limit-signal` exists and passes. **Only the healthy branch is observed** — that half stands. |
| Usage accounting "dropped" (gap 19) | `p-usage-accounting` exists. **The semantic question (billed dollars vs estimate) stands.** |
| Version + auto-update governance "dropped" (gap 20) | `p-version-readable` and `p-autoupdate-governable` both exist; the latter was the suite's standing PARTIAL and **passed on 2026-07-31** once it stopped grepping `--help` for an env var (§13, C4). Nothing was retired. |
| Persona/skill probes "lost" (gap 22) | `p-append-system-prompt` and `p-plugin-skill-headless` both exist and pass. |

One further correction, and it is load-bearing. The critic inferred from binary strings ("Display-only: the stored message and what the model sees are untouched") that a `MessageDisplay` rewrite cannot reach the product surface, and concluded R3 mechanism 4 is dead. **Measured on 2.1.220: the rewrite does reach `--output-format stream-json`** — the assistant text block and `result.result` both came back as `REWRITTEN_BY_HOOK` (`p-messagedisplay-rewrite`). Both statements are true at once: for a headless consumer, the stream *is* the display, while the stored transcript and the model's own context keep the original text.

That combination is better than either alone, and it lines up exactly with ADR-006: the model keeps thinking in English while the user reads their own language. It also means a rewrite cannot corrupt what a later session or a review lens reads — the transcript stays canonical.

## 3. Tier A — S1 blockers

Nothing in S1 (cockpit + engine adapter + live feed) ships before these are answered. Each is a probe, and the answer either confirms a design or forces one.

**A1 — The bidirectional control channel.** `control_request` / `control_response` are real in 2.1.220 with subtypes `can_use_tool`, `initialize`, `interrupt`, `set_permission_mode`, `set_model`, `hook_callback`, `mcp_message`, `control_cancel_request`. With `--input-format stream-json` the engine can ask the client a question and block on the answer. An adapter that only ever writes user messages and never answers produces a session with no further events, no `result`, and no exit — indistinguishable from a hang. *Probe*: run under the ADR-007 profile and (a) deliberately never answer, measuring whether the run terminates within a bound; (b) answer correctly and confirm progress. *Exit*: either the engine provably never emits `control_request` under our session profile — asserted every nightly run — or the adapter ships a responder **and** a hard stall timeout. "Silence with no terminal event" must be provably impossible before a feed goes in front of anyone.

**A2 — The closed set of stream `type`/`subtype` values.** The plan's only deterministic plain-language guarantee is whitelist-rendering of structured events, and the whitelist has no enumerated universe. The binary carries at least 28 system subtypes the plan never names — `compact_boundary`, `model_fallback`, `model_refusal_fallback`, `model_refusal_no_fallback`, `model_consent_fallback`, `permission_denied`, `notification`, `api_retry`, `error_during_execution`, `error_max_turns`, `error_max_budget_usd`, `error_max_structured_output_retries`, `interrupt`, `status`, `informational`, `thinking_tokens`, `session_state_changed`, `background_tasks_changed`, `request_user_dialog`, `side_question`, `hook_response`, `get_context_usage`, `set_model`, `set_permission_mode`, `can_use_tool`, `mcp_message`, `reload_plugins`, `apply_flag_settings`. An unhandled subtype in front of a non-coder is a blank card or a crash. *Probe*: extract the discriminated union from the shipped binary's strings **and** from every live probe's captured stream; emit it as a versioned artifact the adapter compiles its whitelist from; nightly CI diffs the union and **fails** on any new value. *Exit*: every observed value is classified `render | ignore | escalate`; unclassified = FAIL, not warning. — **PARTLY ANSWERED 2026-07-31, see §14.** `p-stream-surface-union` pins the universe of one maximally verbose configuration in `tools/probe/stream-surface.json` and FAILs on an unclassified pair. Two corrections to the paragraph above: of the ~28 binary-extracted subtype names, only `status` and `thinking_tokens` have been observed as real pairs, and the rest were deliberately **not** seeded (a guessed pair can never be falsified — Principle 8); and at least six of those names are listed as `control_request` subtypes in A1 above, so the two paragraphs contradict each other and nobody has measured which is right.

**A3 — Denial signal loss.** The binary logs `[engine] pendingDenialFrames buffer is full; dropping oldest permission_denied advisory frames`. CLAUDE.md §3 makes "a tool-denied stream event is a loud phase failure, never silence" a non-negotiable, and it currently listens on a lossy channel. Under load the detector misses and the phase reads as "the agent did nothing" — the exact failure ADR-007 named as its accepted negative. *Probe*: `auto` with an allow-list omitting Write, prompt that attempts ~20 rapid writes; count attempted `tool_use` blocks against denial signals on **both** channels (advisory system frame vs `tool_result.is_error` on the user message); find the depth at which advisory frames drop. *Exit*: a lossless, non-droppable denial signal is identified — most likely `tool_result.is_error` — and named as the detector's input; the advisory frame is demoted to telemetry. **This changes CLAUDE.md §3's wording**: the non-negotiable is a *denied-tool detector on a lossless channel*, not "the stream event is loud".

**A4 — `request_user_dialog`.** An interactive prompt inside a supposedly non-interactive session, and the failure mode is silent. Binary: "The CLI treats ABSENCE as 'cannot display' and fails closed: without the kind declared here, a dialog-gated flow degrades to its no-dialog behavior", plus `parked request_user_dialog request_id=` and `Ignoring late request_user_dialog answer`. Guidelane declares nothing, so an unknown set of engine flows silently degrade — invisible to every happy-path probe. *Probe*: enumerate all `dialog_kind` values from the binary; run a dialog-gated flow declaring none; record whether the stream shows the request or the flow just degrades; capture parking/lateness semantics. *Exit*: every kind mapped to "cockpit renders it" or "accepted degraded behaviour, written down". No unmapped kind.

**A5 — Stall baseline.** No engine-side timeout flag exists, so the orchestrator's per-stage timeout is the only guardrail — and nobody measured the maximum *legitimate* inter-event silence. `api_retry` means the engine silently retries the API; `tool_progress` exists in the binary but is unproven in `-p`; `npm install` and Playwright legitimately run for minutes. Separately: if the cockpit stops draining stdout, does the child deadlock? That classic Node spawn bug presents to a user as a frozen feed. *Probe*: a session whose Bash tool sleeps ~120 s; record max inter-event gap and whether progress events reach `-p`. Then stop draining stdout for 30 s and check for deadlock. *Exit*: a **measured** max-silence figure the stall timeout derives from, a documented backpressure answer, and a rule for what the feed shows during legitimate silence.

**A6 — Thinking content on the wire.** The binary emits `thinking_delta`, `signature_delta`, `redacted_thinking` and a `thinking_tokens` system subtype; the crew table routes builder/planner/security at `xhigh` and `max`. Raw chain-of-thought is the most engineer-facing text that exists, and the in-engine net (`MessageDisplay`) fires on assistant text, not thinking. *Probe*: one live call at `--effort xhigh --include-partial-messages`; enumerate every content-block type and delta type that actually appears. *Exit*: thinking is provably in the renderer's ignore set, asserted in CI rather than assumed.

**A7 — Hook failure is fail-open.** Binary: `MessageDisplay hook failed for completed message; emitting original text:`, with a taxonomy `hook_success | hook_non_blocking_error | hook_error_during_execution | hook_cancelled`. `prompt`-type hooks are themselves LLM calls — they can be slow, rate-limited, or fail — and every failure leaks unrewritten engineer text to a non-coder. This is a secure-by-default violation (blindspot Q4) on the product's core promise. *Probe*: hook that (a) exits non-zero, (b) exceeds its timeout, (c) returns malformed JSON; record whether original text is emitted and whether any `hook_*` attachment marks it. *Exit*: every failure mode produces a signal the cockpit can use to suppress or quarantine the message — or mechanism 4 is demoted to best-effort in writing and the deterministic whitelist is the sole guarantee. (ADR-008 already states the fail-open caveat; this probe decides whether it is *detectable*.)

## 4. Tier B — S2/S3 blockers

**B1 — Crash, orphan, resume (this *is* the S2 exit gate).** Four unknowns: after SIGKILL of the orchestrator, are the `claude` child, its stdio MCP child, and Bash grandchildren orphaned and still spending subscription quota (the binary uses `detached` in places); is a session killed mid-turn resumable via `--resume`; does re-spawning with the same `--session-id` error, resume, or overwrite; and `--no-session-persistence` exists, so on-disk persistence is a mode, not a guarantee. *Exit*: no orphan survives parent death (or the adapter's process-group kill provably reaps them); resume-after-SIGKILL either works or fails distinguishably enough to map to "redo the phase".

**B2 — Graceful cancellation.** S1's cockpit needs a stop button on day one, and the engine offers a first-class `interrupt` control request — better than SIGTERM. Untested whether it yields a terminal `result` with usage, flushes the transcript, leaves the session resumable, and reaps MCP children. *Exit*: one cancellation path produces terminal result + clean process tree + resumable session, and that path becomes the button. If neither does, S1 ships **without** a stop button rather than with a lying one.

**B3 — Auto-compaction inside a single stage.** The binary carries `compact_boundary` plus `auto_compact` machinery. Fresh-session-per-stage designs compaction away *across* stages but not *within* one long Build phase, and RESEARCH-04 C3 requires invariants to be always present, never retrieval-ranked. A mid-phase compaction can summarize the invariants away — the exact P3/P5 failure the architecture exists to kill. *Exit*: either auto-compact is provably disable-able for stage sessions, or `compact_boundary` becomes an orchestrator event that re-pushes invariants. Silent invariant loss forces a phase-splitting design change in S2.

**B4 — `--json-schema` failure branch.** RESEARCH-02 §5 mech 2 asserts "the CLI itself retries until valid". The binary shows the retry is **bounded** and terminates with `error_max_structured_output_retries`, so the claim is wrong at the edge and G1 has an unhandled terminal state. *Exit*: retry ceiling observed as a number; the error mapped to a plain-language G1 escalation.

**B5 — Logged-out and expired auth in headless.** The most likely first-run state on a friend's machine, and the one that can hang. Partly answered while writing this review (§6), but the hang question stands: does `-p` with an invalid credential exit non-zero within seconds, or block on a TTY / launch a browser? *Exit*: headless never hangs and never opens an interactive flow; every classifier branch maps to a plain-language G0 card.

**B6 — Crew routing has four fallback subtypes.** `model_fallback`, `model_refusal_fallback`, `model_refusal_no_fallback`, `model_consent_fallback` — the last implies a consent step inside a headless run. Untested: what happens when a routed model is not on the user's plan, whether the resolved model appears in `init` and `result.modelUsage`, and whether every `(model, effort)` pair in the shipped presets is accepted or **silently clamped**. A silent clamp makes ADR-004's recommendation badges dishonest. *Exit*: every routing outcome has an observable event the cockpit renders as the visible note; every preset row is proven distinguishable or removed from the table.

**B7 — Concurrency.** The architecture says the adapter multiplexes parallel stage sessions and §13.5 runs parallel review lenses, but no probe runs two engine sessions at once. Unknown whether concurrent `claude -p` processes contend on `~/.claude.json` and per-project state. A corrupted shared config on a friend's machine is unrecoverable by a non-coder. *Exit*: three concurrent runs produce three clean results, three distinct session files, no lock stall, and an unchanged config checksum — otherwise serial becomes the default and parallel lenses are cut from S3 *before* they are built.

**B8 — JSONL framing robustness.** The binary ships a `[stdout-guard]` that monkey-patches `process.stdout.write` — direct evidence that non-protocol stdout writes are a known hazard. A parser assuming one chunk equals one line dies on a large `tool_result` (a big file read, a base64 screenshot) split across pipe reads. *Exit*: strict one-JSON-object-per-line confirmed at the observed max line size, stderr classified into ignore/log/escalate, both pipes always drained.

**B9 — Long-idle survival across a rate-limit pause.** ADR-007 says the supervisor sleeps to `resetsAt`; the binary carries keepalive, heartbeat and idle-timeout machinery, so a held-open stream-json session may be reaped during a multi-hour wait. *Exit*: either the held session survives the longest plausible window, or the supervisor is specified as respawn+resume before S3b is built.

**B10 — UTF-8 / Turkish integrity end to end.** The path is engine stdout → JSONL → cockpit, and hook stdin/stdout → shell scripts. A hook running under a non-UTF-8 locale mangles `ı ğ ş İ`, and the corruption is invisible to every English-language test — it appears only in front of the actual user, which is the whole pilot. *Exit*: byte-identical round-trip on all three legs, or the adapter pins `LANG`/`LC_ALL` in the child env and the probe proves the fix.

## 5. Tier C — free assertions that ride along

No new live calls; these attach to probes that already run.

- **C1 — Auto-mode classifier pinning.** `claude auto-mode config` prints the *effective* classifier ("your settings where set, defaults otherwise") and `auto-mode reset` works by removing the `autoMode` section from user settings — so what `--permission-mode auto` means is per-machine and admin-overridable. Assert `config == defaults`, or record the diff. **Measured today (§6): identical on the owner's machine.** Also assert it stays identical under `--setting-sources ''`.
- **C2 — Rate-limit field contract** asserted on every live probe's stream (`status`, `resetsAt`, `rateLimitType`), plus a pure unit test feeding the supervisor synthetic rejected-branch and unknown-status shapes.
- **C3 — Usage/cost semantics** on every terminal event: `usage`, `total_cost_usd`, `modelUsage`, `num_turns`. The cockpit's cost line must be **labelled by what the number actually is** — estimated API-equivalent vs billed — or replaced by token counts. An unlabelled dollar figure shown to a friend is a brutal-honesty violation, not a missing feature.
- **C4 — Version stamping**: every report states the exercised CLI version; a version change with no re-run is a CI failure. ~~`p-autoupdate-governable` stays an explicitly tracked UNPROVEN item~~ — **closed 2026-07-31**: a two-arm `claude doctor` differential shows `Auto-updates: enabled` → `disabled (set by env: DISABLE_AUTOUPDATER)`, with the engine naming the variable as the source. The item was UNPROVEN only because the probe grepped `--help`, which documents flags rather than env vars. The version-stamp half of C4 is implemented (`baseline.engineVersion` is compared, not merely recorded).
- **C5 — Connector absence**: ~~assert `init.tools` contains no `mcp__claude_ai_*` entry~~. **This disposition was wrong and would have shipped a test that cannot fail.** Measured 2026-07-31: `init.tools` carries the ~30 built-in tool names and **never** an `mcp__` entry, whether connectors are loaded or not — so the proposed assertion is vacuous, and green would have meant nothing. The correct field is `init.mcp_servers[]`, which does list every configured server by name (`p-ambient-isolation` already reads it). Rewritten disposition: assert `init.mcp_servers` contains exactly the servers the orchestrator passed via `--mcp-config`, and nothing else.
- **C6 — `--forward-subagent-text` shape** (medium priority): the flag forwards subagent text *and thinking* with `parent_tool_use_id` set, multiplying A6 by the number of subagents. Enumerate emitted types once and confirm every forwarded block is attributable.
- **C7 — `--add-dir` scope semantics** (added 2026-07-31). Every stage session runs with `cwd` = the generated project, but several need a second root: the artifact store, a scratch dir, the profile's gate harness. Unknown whether `--add-dir` grants write as well as read, whether the added root is reported on the init receipt (so the receipt can assert it, per ADR-008), and how it composes with a fail-closed `--allowedTools`. *Exit*: a two-root session writes to both, and both appear on the receipt — or the adapter copies files instead of adding roots. **Deliberately deferred to the S1 Tier A batch**, not because it is unimportant but because one new probe costs a full `--live` re-baseline; batching it with the seven Tier A probes costs one re-baseline instead of eight.

## 6. New measurements taken while writing this review

Both are free, local, and quota-free.

**Auto-mode classifier (C1).** `claude auto-mode config` and `claude auto-mode defaults` are byte-identical on the owner's machine (61 641 bytes each; 17 allow / 65 soft_deny / 1 hard_deny / 20 environment rules). So the owner's `auto` is the shipped `auto` — but the mechanism to differ exists on any other machine, which is exactly why this becomes a doctor check.

**Auth-mode detection (B5, partial).** `claude auth status --json` returns:

```
loggedIn: true          authMethod: "claude.ai"     subscriptionType: "max"
apiProvider: <string>   email: <string>   orgId: <string>   orgName: <string>
```

This settles the detection half of gap 7 at zero cost: the doctor can distinguish logged-out, auth method, and plan tier without ever touching a credential. **It also creates a privacy obligation**: three of the seven fields are personal identifiers. Guidelane projects `{loggedIn, authMethod, subscriptionType}` and never logs, persists, or displays `email`, `orgId`, or `orgName`. That rule is now in ADR-008 and belongs in the adapter's code, not just in prose.

## 7. Deliberately not building

The critic also named eight probes as overreach. Accepted, with reasons — cost discipline is a stated project principle:

- **Plugin-bundled MCP naming and approval-gate probes**: re-litigate a settled decision. ADR-007 Finding 2 already rules Atlas ships via `--mcp-config`, never bundled, and CLAUDE.md §3 promotes that to a non-negotiable. Whatever the probes return, the answer is the same.
- **Connector deny-pattern live call**: redundant under `auto` + explicit allow-list. Downgraded to the free assertion C5.
- **Hook registry count**: whether the registry holds 30 or 33 events changes no decision. Footnote, not probe.
- **Agent-type hooks**: no mechanism in the plan depends on them.
- **MCP protocol revision at "critical"**: v1 Atlas is ~6 stdio tools plus resources; nothing uses Tasks, MCP Apps, or Extensions. A one-line correction to RESEARCH-01 §5.4, not a critical probe.
- **Nine-flag composability as one call**: non-localising — a failure says the profile is broken without saying which flag lost. Re-specified to read each flag's effect out of the init receipt, so it rides free on `p-init-receipt`.
- **Auth reachability as one probe**: split — detection is free (§6), only the "stray `ANTHROPIC_API_KEY` silently switches billing" half justifies quota.
- **Forbidden-flag/state probe as a critical discovery**: it is a regression assertion. The harness already scrubs the five env keys; the finding has been acted on.

## 8. What this changes in the plan

1. **CLAUDE.md §3** — the denied-tool non-negotiable is rewritten around a *lossless* signal (A3), and the `--bare`/`--safe-mode` ban is restated as a state ban with an env deny-list (ADR-008).
2. **S1 gains a protocol-conformance sub-stage.** S1 is no longer "cockpit + adapter"; it is "cockpit + adapter + the Tier A answers", because four of the seven decide whether the feed can exist at all. This is the honest cost of the finding, and it is why the S1 confidence number moves.
3. **S2's exit gate gets teeth.** "kill -9 mid-run, resume from disk" now explicitly includes orphan reaping and MCP child cleanup (B1).
4. **S3's parallel review lenses are provisional** until B7 says concurrency is safe.
5. **The cost line is provisional** until C3 says what the number means.
6. **`p-messagedisplay-rewrite` stays green in CI** as the guard on mechanism 4 — the one assumption the critic predicted would fail and which measurement instead confirmed.

## 9. Disposition of all 24 gaps

| # | Gap | Severity | Disposition |
|---|---|---|---|
| 1 | Closed set of stream type/subtype | critical | **A2** — **partly answered (§14, 2026-07-31)**: universe pinned + drift-gated for one configuration by `p-stream-surface-union`. Still open: the CI-visible (free) half, and every configuration this profile cannot produce |
| 2 | Bidirectional control channel | critical | **A1** — S1 blocker |
| 3 | `request_user_dialog` | critical | **A4** — S1 blocker |
| 4 | Droppable `permission_denied` frames | critical | **A3** — S1 blocker; rewrites CLAUDE.md §3 |
| 5 | In-stage auto-compaction | critical | **B3** — S2 |
| 6 | `--json-schema` retry ceiling | critical | **B4** — S2 (base probe already passes) |
| 7 | Logged-out / expired auth | critical | **B5** — detection half **resolved**; logged-out shape measured on a CI runner (§11); the `claude -p` hang half is still open |
| 8 | kill -9, orphans, resume | critical | **B1** — S2 exit gate |
| 9 | Graceful cancellation / `interrupt` | high | **B2** — S1 stop button depends on it |
| 10 | Stall baseline + backpressure | critical | **A5** — S1 blocker |
| 11 | Thinking content on the wire | critical | **A6** — S1 blocker |
| 12 | Hook fail-open | critical | **A7** — S1 blocker |
| 13 | Model fallback / effort clamping | high | **B6** — S3, gates ADR-004's badges |
| 14 | Did `--settings` take effect | high | **Resolved in principle by ADR-008** (init receipt as a gate); valid/invalid diff probe still to build |
| 15 | `rate_limit_event` regression | high | **C2** — free assertion + unit test |
| 16 | Auto-mode classifier as ambient state | high | **C1** — **measured today**: identical to defaults here |
| 17 | Concurrency | high | **B7** — gates parallel lenses |
| 18 | JSONL framing robustness | high | **B8** — S1/S2 |
| 19 | Cost/usage honesty | high | **C3** — label or remove the dollar figure |
| 20 | Version + auto-update governance | high | **C4** — already in suite; stays tracked UNPROVEN |
| 21 | `--forward-subagent-text` shape | medium | **C6** |
| 22 | Persona/skill delivery | medium | Already covered by `p-append-system-prompt` + `p-plugin-skill-headless`; the mechanism-4 premise is **refuted by measurement** (§2) |
| 23 | UTF-8 / Turkish integrity | medium | **B10** — invisible to English tests; pilot-critical |
| 24 | Long-idle survival | medium | **B9** — gates S3b design |

## 12. Addendum — A3a answered: the denial channel is `tool_result.is_error` (2026-07-31)

A third audit — four adversarial lenses against the plan for closing these gaps —
pointed out that the detector in `p-permission-allowlist` was a prose regex over
model-generated text, and that the structural answer was **already sitting unused
in our own committed evidence**: `p-usage-accounting` had recorded
`permission_denials` among the terminal result's 21 field names while discarding
every value.

The deny arm now runs with `--output-format stream-json --verbose
--include-hook-events` and the fixture plugin attached, and asserts on four
channels. Measured on CLI 2.1.220:

| Channel | Fired |
|---|---|
| `tool_result.is_error` on the user message | **yes** |
| `result.permission_denials` | absent on this run |
| `PermissionDenied` lifecycle hook | no |
| `permission_denied` advisory system frame | **no — did not appear at all** |

Three consequences:

1. **`tool_result.is_error` is the detector.** CLAUDE.md §3 is updated from a
   prediction to a measurement.
2. **The advisory frame is worse than droppable — it did not appear even in the
   uncontended case.** Any design keyed on it would have been detecting nothing,
   quietly, from day one.
3. **The `PermissionDenied` hook not firing is worth its own note**: the fixture
   registers it, so a consent-card UX cannot be built on that event without
   first finding out what actually triggers it.

**A3b remains open**: this proves the channel exists and fires, not that it is
lossless under load. Provoking the frame-drop condition needs sustained denials
plus backpressure — i.e. the reactive rig — so the S1 activity feed stays gated
on A3b, not on this.

## 13. Addendum — three gaps partly answered while fixing something else (2026-07-31)

Retiring the two standing PARTIALs (rev 17) required reading the init receipt and
a full stream carefully, and that paid out on three open items without a probe
being written for any of them. Recorded here because a measurement nobody writes
down gets re-measured.

**A2 (stream surface union) — a first enumerated sample, not the closed set.** One
plugin-attached session with hook events on produced exactly these
`type`/`subtype` pairs:

| Pair | Count in one short session |
|---|---|
| `system/init` | 1 |
| `system/hook_started` | 4 |
| `system/hook_response` | 4 |
| `system/hook_progress` | 2 |
| `system/thinking_tokens` | 7 |
| `assistant` (no subtype) | 2 |
| `rate_limit_event` (no subtype) | 1 |
| `result/success` | 1 |

That is a *sample from one configuration*, not the union — a session that uses
tools, streams partials, compacts, or errors will add pairs this run could not
produce. A2 stays open, but the whitelist now has a seed and the CI check that
fails on an unseen pair has something to start from.

**A6 (thinking deltas) — thinking surfaces as a running COUNT, not content.**
`system/thinking_tokens` carries `estimated_tokens` and `estimated_tokens_delta`
and no text. For the cockpit that is close to ideal: a live "still thinking"
signal with nothing to leak or mis-render. Still open: whether a model configured
for visible reasoning also emits content blocks, and what the feed does then.

**A1 (control channel) — one negative result.** No `mcp_status`, no
connection-state event of any kind, appeared after `init` in any run. Servers
listed `pending` at init and were simply never mentioned again, including the one
that answered a tool call moments later. Whatever the control channel turns out
to be, *server connection state is not published on it* — so the S1 adapter
cannot wait for a "ready" signal that does not exist.

## 14. Addendum — A2 measured and pinned; A6's open half answered as a side effect (2026-07-31, S1 night cycle 1)

`p-stream-surface-union` (`fixture-call`, baseline `pass`) now runs one maximally
verbose session and asserts every `type`/`subtype` pair it emits — and every
content-block and delta type inside a `stream_event` envelope — against
`tools/probe/stream-surface.json`, a hand-seeded, hand-classified artifact the
probe reads and never writes.

**Session profile measured**: `-p` with `--input-format stream-json`,
`--output-format stream-json`, `--verbose`, `--include-partial-messages`,
`--include-hook-events`, `--replay-user-messages`, `--plugin-dir` at the existing
probe fixture, `--tools ''`, `--no-session-persistence`, plus the ADR-008
isolation pair the harness adds. Model `haiku`, engine 2.1.220, 35 events.

### What was observed

| Outer pair | In the §13 seed? |
|---|---|
| `system/init` | yes |
| `system/hook_started` | yes |
| `system/hook_response` | yes |
| `system/thinking_tokens` | yes |
| `assistant` (no subtype) | yes |
| `rate_limit_event` (no subtype) | yes |
| `result/success` | yes |
| `user` (no subtype) | no — evidenced by `p-stream-json-roundtrip`, never written down as a pair |
| `stream_event` (no subtype) | no — same |
| **`system/status`** | **NO — new, and in neither §13 nor any prior write-up** |

`system/hook_progress` is classified but did **not** appear in this
configuration; that is tolerated and reported, not failed.

**Finding 1 — `system/status` exists and nothing in the plan named it.** Observed
on both of the first two runs. Payload key names `{type, subtype, session_id,
uuid, status}`; the values `status` can take are **not** measured, because the
probe deliberately retains no payload values (a stream body carries `cwd`,
session ids and the operator's plugin names, and the report is public). It is
classified **`escalate` as a fail-closed placeholder** — an unmodelled
session-level signal must reach a human rather than be swallowed — with a written
instruction to downgrade it only after its value set is enumerated. Enumerating
those values is open work, listed below.

**Finding 2 — A6's open half is answered, and the answer is the unwelcome one.**
§13 recorded that `system/thinking_tokens` carries counters and no text, and left
open "whether a session configured for visible reasoning also emits content
blocks". It does not need to be configured for anything. On **`--model haiku`
with no reasoning flag beyond `--include-partial-messages`**, the stream carried:

- `stream_event.event.content_block.type = thinking`, keys `{type, thinking, signature}`
- `stream_event.event.delta.type = thinking_delta`, keys `{type, thinking, estimated_tokens}`
- `stream_event.event.delta.type = signature_delta`, keys `{type, signature}`

So raw chain-of-thought reaches `-p` stream-json **by default**, and the
`MessageDisplay` rewrite fires on assistant text, not on thinking (ADR-008) — it
arrives unrewritten. All three are pinned `ignore` **by name**. A renderer that
ignores them by omission fails open the first time it is rewritten. A6 is not
closed (`redacted_thinking` was not observed, and effort/model variation is
untested), but its stated open question now has an answer.

**Finding 3 — two negative results worth recording.** Zero non-JSON lines on
stdout and zero events with an unusable `type`/`subtype` shape. The engine's
stdout was pure JSONL for this configuration. Both are asserted, so a regression
in either is a FAIL rather than a silence.

### How the probe is kept from failing open

Written down because every one of these exists to answer PROJECT_MAP Principle 9,
and because the subset check on its own is the classic vacuous assertion — an
empty observation is trivially a subset of anything:

1. **A pinned required minimum** (`system/init`, `assistant`, `user`,
   `stream_event`, `result/success`) — a session that dies after two events fails
   instead of passing.
2. **A floor pinned in code**, asserted as a subset of the artifact's required
   list, so an artifact edit cannot shrink the minimum to nothing. Not a second
   source of truth: it is a shape constraint, so the two cannot disagree.
3. **Fail-closed on the artifact**: missing, unparseable, empty, a class outside
   `render|ignore|escalate`, or an entry with no stated reason → FAIL before any
   engine call is made.
4. **`hasOwnProperty`, not `in`** — an event type of `constructor` or `toString`
   would otherwise read as already classified.
5. **Unknown pair names are shape-gated and fingerprinted** before publication.
   An unclassified pair is the one novel string this probe emits, produced
   exactly when it has stopped understanding the stream, and `redact.mjs` has no
   rule that could match a bare token. Hook subtypes derive from hook names and
   plugin-scoped names carry `plugin_<plugin>_<server>`, both operator-owned.

### H6 falsification, performed

| Corruption | Probe's own status |
|---|---|
| none (baseline) | `pass` |
| renamed `pairs["system/thinking_tokens"]` so an observed pair is unclassified | **`fail`**, naming that pair |
| restored | `pass` |
| removed `system/init` from `requiredPairs` (exercises the code-side floor; costs no quota — it returns before the engine call) | **`fail`**, naming the omission |
| restored | `pass` |

Statuses read from the probe's entry in the partial report, never from the
process exit code, which is `1` on every one of these runs because an unrecorded
probe is baseline drift.

### Honest scope, and what is still open

- This is **a sample from one configuration, not the closed set**, and the
  artifact says so in a field rather than only in prose. Not exercised: tool use,
  subagents, MCP servers, `--json-schema`, compaction, an interrupted session, a
  non-zero-exit result. Of the ~28 subtype names §3 A2 extracted from the binary,
  **only `status` and `thinking_tokens` have now been observed as real pairs.**
  The rest remain binary strings, and per Principle 8 they were deliberately
  **not** seeded into the artifact: a guessed pair in a pinned expectation can
  never be falsified, because it will never be observed. Two independent advisory
  reviews flagged that §3 A2 and §3 A1 disagree about whether `can_use_tool`,
  `set_model`, `set_permission_mode`, `mcp_message`, `interrupt` and
  `hook_callback` are `system` subtypes or `control_request` subtypes. Nobody has
  measured which. That contradiction is now on the record.
- **The classification column has no enforced consumer.** `apps/cockpit/` does
  not exist, so `render | ignore | escalate` is today a pinned decision, not a
  constraint on any renderer. The universe is asserted; obedience to the
  classification is not. This is the honest limit of what a probe can do before a
  renderer exists, and it should not be discovered in S2.
- **No `defaultForUnknown` rule is implemented anywhere.** Both advisory reviews
  independently proposed that the cockpit treat an unclassified pair as
  `escalate` at runtime, which would make the set's inevitable incompleteness
  survivable rather than a correctness risk. That is an orchestrator decision,
  not a probe change, and it is the single highest-value follow-up here.
- **Follow-ups not done tonight, named so they are not lost**: (a) enumerate the
  values of `system/status` and re-classify it deliberately; (b) split artifact
  validation into a separate free `observational` probe so CI gates it on every
  push — a `fixture-call` probe is `skip`ped without `--live` and CI therefore
  never runs this one; (c) have all 17 live probes assert `observed ⊆ artifact`
  through one shared helper, which is what would give A2 real breadth; (d)
  `p-stream-json-roundtrip` records `types` and `subtypes` as two independent
  lists, from which the pairs are not reconstructible — that is where the
  unattributed `status` subtype in the committed S0 evidence came from.
- **`subtype: null` is treated as an absent subtype** by the key function. One
  advisory review argued they should be distinct shapes. Not changed; recorded.

**Disposition**: A2 moves from *open blocker* to **partly answered — the
whitelist has an enumerated, asserted, drift-gated universe for one
configuration, and a CI-visible version of the check is follow-up (b)**. A6 moves
from *open* to **open with its central question answered**: content-bearing
thinking blocks do reach the wire, by default, unrewritten.

## 15. Addendum — the night's three findings verified, and two of them were wrong in a way that mattered (2026-07-31, owner review pass)

§14 was written by the session that did the work, so none of it counted as
verified (ADR-002: no claim is accepted from the session that produced it). Every
claim below was re-measured in a separate session against a fresh engine call.

**Finding 1 — `system/status` is real. Its classification was wrong.**
Reproduced. The pair rides with `--include-partial-messages` (absent from an
otherwise identical run without it). Its value was measurable all along and
nobody measured it: **`status = "requesting"`** — a request-progress signal, not
a session-level alarm. §14 classified it `escalate` as a fail-closed placeholder,
which was the right call while the value set was unknown and became alarm noise
the moment it was knowable. Now value-conditional: `requesting` → `ignore`,
anything else → `escalate`. This closes follow-up (a) of §14.

**Finding 2 — confirmed, and the confirmation is stronger than the claim.**
§14 inferred "unrewritten" from the ADR-008 note that `MessageDisplay` fires on
assistant text. That is an inference about a hook from a different measurement.
Measured directly instead, as a **same-run controlled differential**: with the
fixture plugin's rewrite hook armed, one assistant message came back with its
text block replaced by the hook's marker (`textWasRewritten: true`, 17 chars)
while its thinking block carried **129 characters of the model's original
reasoning, untouched** (`thinkingWasRewritten: false`). Same message, same run,
same hook. Thinking deltas carried the same 129 characters, and a `signature_delta`
carried 508. So: **the rewrite reaches assistant text and does not reach
thinking.** ADR-006's language dial is implemented by that rewrite, which makes
this a product defect and not a curiosity — a Turkish-dial user is one renderer
bug away from receiving English engineer-facing reasoning.

**Finding 3 — instance 23 confirmed exactly as reported, and fixed.**
`publishablePair` published `mcp__plugin_<client>_<server>__<tool>` and
`plugin_<operator>_<server>` **verbatim** — the two ADR-008 shapes its own
docstring named as its reason to exist — because underscores are inside
`[A-Za-z0-9_-]`. The hook-subtype case it also cited was caught only by the
coincidence of a colon. Replaced with an allow-list keyed on the committed
artifact's own pairs, falling back to engine-owned structure plus a fingerprint;
falsified against all five shapes, and against the classified pairs to confirm no
actionability was lost.

**The schema flaw that made the artifact unimplementable.**
Two of §14's three `escalate` entries were conditional on a **field value**, and
schemaVersion 1 could only classify a pair. Measured: a healthy session emits
`rate_limit_event` carrying `rate_limit_info = {status: "allowed", resetsAt,
rateLimitType: "five_hour", overageStatus: "rejected", overageDisabledReason,
isUsingOverage: false}` — so a renderer obeying that file literally escalates
**every phase forever**, and the alarm fatigue would bury the one escalation the
class was written for. Note `overageStatus`, `overageDisabledReason` and
`isUsingOverage` are three fields ADR-007's recorded contract does not mention.

schemaVersion **2** adds a `when` form (`path` · `values` · `unknown`), pins
`unknown: "escalate"` as a validated requirement rather than a convention, and
adds the top-level **`defaultForUnknown: "escalate"`** rule — which closes the
item §14 called "the single highest-value follow-up here". Only `allowed` is
pinned for the rate-limit branch, because only `allowed` has been observed;
`rejected` escalates by falling through, which is the correct treatment of a
branch ADR-007 could only handle defensively.

**All five new guards were falsified before being trusted** — each corrupted,
confirmed `fail`, restored, confirmed `pass`, with statuses read from the report
and never from the exit code: `when.unknown` failing open, `defaultForUnknown`
failing open, `class` and `when` both present, a `when.path` that resolves to
nothing (a rule that silently never matches — the decoration shape), and an
observed value absent from `values`. The first three return **before** the engine
call.

**Still open, unchanged by this pass**: §14 follow-ups (b) CI never runs this
`fixture-call` probe, (c) no shared `observed ⊆ artifact` helper across the other
live probes, (d) `p-stream-json-roundtrip`'s unreconstructible pair lists; the
`system` vs `control_request` subtype contradiction; the classification column
still has no consumer because `apps/cockpit/` does not exist; and `redacted_thinking`
plus variation by model and effort remain unmeasured for A6.

## 16. Addendum — A7 ANSWERED: hook failure is detectable in two modes and reported as **success** in the third (2026-07-31, S1-A0)

Four arms on the fixture plugin's `MessageDisplay` hook, measured before
anything was pinned. The hook's own log file separates *"ran and failed"* from
*"never ran"* — without that control, an engine that silently stopped running
hooks would have satisfied every assertion by emitting nothing.

| Arm | `exit_code` | `outcome` | `stderr` | Detectable? |
|---|---|---|---|---|
| control (healthy) | 0 | `success` | — | — |
| hook exits 9 | **9** | **`error`** | carries the message | **yes, loud** |
| hook emits malformed JSON, exits 0 | **0** | **`success`** | — (payload lands in `stdout`) | **NO** |
| hook outlives its 5s timeout | **1** | **`cancelled`** | — | **yes, and distinct from `error`** |

Three things follow.

**1. Fail-open is confirmed, in every mode.** All four arms ended in
`result/success` with `is_error: false`. A failing hook never fails the phase.
That is a design input, not a defect — but it means the orchestrator, not the
engine, owns the decision to stop.

**2. `cancelled` ≠ `error` is a usable distinction.** A timeout is retryable; a
non-zero exit is a bug in the hook. The engine separates them, so the
orchestrator can too, and neither has to be inferred from a message string.

**3. The third row is A7's actual answer, and it is worse than "fail-open".** A
hook that exits 0 while emitting an unparseable payload is reported as
**`outcome: "success"`**. Its intended effect silently did not happen and *no
structural channel says so*. This is not hypothetical for this project:
**ADR-006's language dial IS a `MessageDisplay` hook.** A truncated write, a
serialization bug, or the UTF-8 corruption this repo has already hit once would
each produce exactly this shape — and a non-coder would receive untranslated,
engineer-facing output while every gate reported green.

**Consequence, stated as a constraint rather than a note**: the orchestrator must
treat *non-empty hook stdout it cannot parse* as a hook failure itself. The
engine will not do it. `p-hook-failure-detectable` pins all four rows by
equality, so a future CLI that starts reporting an error there turns the probe
**red** — which would be good news, to be re-pinned deliberately.

### Also closed here: §14 follow-up (b)

`p-stream-surface-artifact` (`observational`, **free**) validates the artifact's
shape with no engine call, so **CI gates it on every push** — the gap that left
`stream-surface.json` checkable only by a manual `--live` run. The validator is
**extracted and shared** with `p-stream-surface-union` rather than copied: two
implementations of one pinned expectation is how a pin drifts, and the free copy
is the one CI runs, so a divergence would mean CI gating something the live suite
does not assert.

Falsified eight ways (fail-open `unknown`, deleted `defaultForUnknown`, removed
floor entries on both halves, a gutted reason, `class` and `when` both present, a
corrupt file). The ninth attempt **passed**, correctly and instructively:
reclassifying a thinking block to `render` is a valid *shape*. Shape validation
cannot see a product disaster, so **one classification is now pinned in code** —
`thinking`, `thinking_delta` and `signature_delta` must be `ignore`, on the
measured ground that they carry raw chain-of-thought that the language dial
provably does not touch (§15). Deliberately not generalised to every class: the
rest are genuinely decisions, and pinning them would freeze the artifact against
its own purpose.

## 17. Addendum — A4 ANSWERED as an absence, and A6's residuals closed (2026-07-31, S1-A1)

Both were run as **spikes first, probes second**. The loophole-loop pass had
flagged that I could not name a headless trigger for either, and writing probe
code before knowing that risks a probe that can never fire — the shape this repo
has produced 23 times.

### A4 — the engine never asks

With the write tool **present and not pre-approved**, all four permission modes
behave the same way, and none of them asks:

| `--permission-mode` | `tool_result.is_error` | `result.permission_denials` | dialog / control frame |
|---|---|---|---|
| `auto` | true | 1 | **none** |
| **`manual`** — literally "ask the user" | true | 1 | **none** |
| `dontAsk` | true | 2 | **none** |
| `plan` | 3 allowed, 1 denied | 0 | **none** |

`manual` is indistinguishable from `auto` headlessly. `--help` separately
documents that the **workspace trust dialog is skipped** in non-interactive mode.

So A4's exit criterion resolves to the cheap form the loophole-loop predicted:
*prove the engine never asks*. **Night Shift needs no control-channel responder
to run unattended**, and no `request_user_dialog` can silently degrade because
none is ever sent.

`p-no-headless-dialog` pins this — and the pin is built so the absence means
something. Each arm must **prove the permission decision was actually reached**
(a denied `tool_result` plus a counted `permission_denial`) before "no dialog
appeared" is read at all. Without that gate this probe would be
`p-autoupdate-governable` again: a confident absence from a surface that never
had the thing.

Two design corrections worth recording, because both were mistakes I made and
caught rather than reasoned around:

- **The first spike used `--tools ''`**, which *removes* the tool rather than
  withholding permission for it. "The engine did not ask" measured on a session
  with nothing to ask about is worth nothing. Re-run with the tool present.
- **A `plan`-mode arm was written and removed.** In plan mode the model is told
  to plan rather than act, so whether it attempts a write is a *model* choice —
  and its first run proved it by never reaching the decision. Related: when the
  decision point is not reached the probe now reports **INCONCLUSIVE, not FAIL**.
  A red there would be a confident claim that the *engine* changed, on evidence
  that says only "the model did not try this time".

Stability checked over three consecutive runs: `pass`, identical counts each time.

### A6 residuals — effort does not matter, the model does

| Arm | thinking chars | `redacted_thinking` | inner types |
|---|---|---|---|
| haiku, `--effort` low → max (5 levels) | 157–299 | **0** | all three, every level |
| haiku, no `--effort` | 287 | 0 | all three |
| **sonnet `--effort high`** | **0** | 0 | **`text` only** |

1. **Effort changes the volume, not the surface.** The three thinking types
   appear at every level, so the artifact's classification already covers them.
2. **`redacted_thinking` never appeared** in seven arms. It is not forceable with
   an ordinary prompt, so the limit is **recorded rather than probed** — a probe
   that cannot fire is decoration.
3. **The model changes the union.** Sonnet emitted no thinking surface at all
   under identical flags. The entire conformance suite runs on `--model haiku`,
   so `stream-surface.json` is *haiku's* universe; `_modelDependence` now says so
   in the artifact itself. A cockpit validated here and run on another model is
   validated against a different stream — which matters directly, because ADR-004
   routes different roles to different models.

**Disposition**: A4 → **CLOSED** (answered as a pinned absence). A6 → **CLOSED**,
with `redacted_thinking` recorded as unreachable by this method rather than
claimed absent.

## 18. Addendum — A5 and A3b ANSWERED: the engine BLOCKS, and the denial channel is lossless (2026-07-31, S1-C)

A5(b) and A3b are one experiment. The adapter's real question is: when the
cockpit stops draining stdout — a slow renderer, a paused UI, a blocked disk
write — does the engine (i) block until we read, (ii) drop events, or (iii) die?
And if it is lossy, does `tool_result.is_error` survive?

**The first attempt at this measurement was wrong and had to be redone.** It
paused stdout for 20s, saw a complete stream, and concluded "lossless" — without
ever proving the buffers had filled. That is a confident claim about a session
that may never have experienced backpressure: the same shape as
`p-autoupdate-governable` reading an absence off a surface that could not carry
the thing.

**The proof.** A macOS pipe is 64 KiB and Node's readable highWaterMark is
another 64 KiB, so a burst *larger than one pipe buffer* arriving the instant we
resume can only mean the writer was blocked with data queued behind it.

| Measurement | Value |
|---|---|
| stdout undrained for | 55 s |
| burst within 250 ms of resume | **99,715 – 121,970 bytes** (152–186 % of a 65,536-byte pipe) |
| bytes still arriving after the burst | 83,314 – 134,571 |
| lines / parsed / **unparseable** | 526 / 526 / **0** |
| denied `tool_result` survived | **yes** (1) |
| terminal `result/success` survived | **yes**, with `permission_denials: 1` |

**A5(b): the engine BLOCKS. It does not drop and it does not die.** Bytes kept
arriving after the burst, so it was alive and blocked rather than finished.

**A3b: `tool_result.is_error` is LOSSLESS under pressure — CLOSED.** This
vindicates A3a's choice of detector: the `permission_denied` *advisory* frame is
explicitly droppable (`dropping oldest permission_denied advisory frames`), the
structural `tool_result` is not. A gate may depend on it.

**A5(a): the stall baseline.** With stdout drained normally, inter-chunk gaps were
p50 **207 ms**, p95 **385 ms**, max **1,227 ms**. So an inter-event silence
watchdog has a measured floor to sit above rather than a guessed one.

**And a design consequence that is not in the table.** Because the engine blocks,
a slow cockpit loses nothing — but it *stalls the engine*, and the stream goes
legitimately silent. **An inter-event stall watchdog must therefore not fire when
the consumer is itself the cause.** That is knowable, since the consumer is us.

### The new spawn path, and why it is additive

`spawnCapture` buffers everything and hands back a string, so this probe could
not be written on top of it — the documented *"`spawnCapture` is a probe
primitive, not an adapter"* debt, paid narrowly instead of by building the S1-D
adapter early. `ctx.claudeStreaming` reuses `applyIsolation` and
`scrubbedChildEnv` **directly** and increments the same audit counters, so there
is still exactly one isolation and env-scrub path. A second implementation of a
fail-closed boundary is how that boundary drifts, and this repo has the scars.

The probe **asserts the isolation pair on the args the harness actually passed**,
rather than trusting the new path. Falsified: spawning it `ambient: true` fails
the probe with `sawStrictMcpConfig: false`.

### A1 — answered as an absence, on the same evidence that closed A4

No `control_request` frame has appeared in **any** session run across S1-A and
S1-C — four permission modes, hook-failure arms, thinking arms, backpressure
arms. `--help` exposes no `--permission-prompt-tool`; `--remote-control` is
interactive-only and does not apply to `-p`. So the engine does not initiate a
control request in print mode, and the REVIEW-02 §3 A1-vs-A2 contradiction over
which subtypes belong to `system` versus `control_request` is **moot for the
orchestrator**: you cannot mis-route a frame that is never sent.

Honest scope: this is a statement about *observed behaviour across every
configuration this suite exercises*, not about what exists in the binary. Per
Principle 8 a binary string would not have settled it either. `p-no-headless-dialog`'s
novel-pair guard is what would catch the day it changes.

### A process finding worth more than any single measurement

**Three falsification tests today silently did not test what they claimed**, and
each was caught only because the result looked wrong:

1. the `..` in a "refused path" was normalised away by `join()`, so the fixture
   never refused and the hook really did run;
2. an `&&` chain short-circuited on the probe runner's non-zero exit (baseline
   drift from an unrecorded probe), so the falsification never executed at all
   while printing nothing;
3. a `{ cwd: ws }` anchor matched **four** call sites and the edit landed in a
   different probe entirely.

Each would have been reported as "guard falsified". The rule this repo already
has — *a guard that cannot fire is decoration* — has a corollary it did not:
**a falsification test needs its own proof that it armed the right thing.** The
third was caught by printing the diff before running; that is now the practice.

## 19. Addendum — the phase terminator, measured (2026-07-31, S1-D)

The hazard §15 found by accident: with stdin held open a `-p` session does not
exit after `result`. Four arms settle what actually ends a phase.

| Arm | first `result` | stdin closed | process exited | after the close |
|---|---|---|---|---|
| A — close stdin immediately (what `spawnCapture` does) | 3,346 ms | 0 ms | exit 0 @ 3,871 ms | **6,243 bytes still arrived** |
| B — close on the first `result` | 2,404 ms | 2,404 ms | exit 0 | **+539 ms** |
| C — wait 10 s after `result`, then close | 4,261 ms | 14,262 ms | exit 0 | **+524 ms** |
| D — never close (control) | 2,294 ms | never | **SIGKILL at 75 s** | never exited |

**The terminator is `stdin.end()`.** Arm C is the proof: the exit follows the
*close* by 524 ms, statistically identical to arm B's 539 ms, so it is the close
that ends the session and not any elapsed-time rule. Arm D shows the session will
otherwise sit open indefinitely.

**Arm A gives a second rule the adapter needs**: 6,243 bytes arrived *after* stdin
was closed. A closer that stops reading at the close **truncates the phase
output** — potentially the assistant text, or the terminal `result` itself.

### The adapter lifecycle this pins

1. spawn, write the turn, and **keep stdin open** for multi-turn work;
2. on the `result` of the final turn, `stdin.end()`;
3. **keep draining stdout until the process `close` event** (~0.5 s);
4. **no exit within a bounded window after closing stdin is the real stall
   signal** — and, per §18, an inter-event silence watchdog must not fire while
   the consumer is itself the cause of the silence.

`p-phase-terminator` pins arms B and D by equality. If a future CLI makes the
session exit on its own, the probe goes **red with "this is an IMPROVEMENT"** —
waiting for process exit would become safe — to be re-pinned deliberately rather
than discovered by an adapter that mysteriously stops hanging.

**One defect caught inside the probe before it shipped**, worth naming because it
is subtler than the fail-open shape: the no-close arm published `exited: true` in
its evidence, because the snapshot was taken *after* the probe's own `stop()`
SIGKILLed the child. The assertion was correct; the **published evidence
contradicted its own verdict**, and a reader trusting the artifact over the prose
would have concluded the opposite of the finding. Evidence is now snapshotted
before the kill and records `killedByProbeAfterwards: true`.

## 20. Addendum — what the adapter's own first live run found (2026-07-31, S1-D)

Four findings, none of them predicted. All four came from *running* the adapter
against the real engine rather than from reading the stream spec, which is the
same lesson S0 kept producing: a binary string is evidence a code path exists,
not that it fires.

### 20.1 `init.model` is the RESOLVED id, never the routed alias

Measured: `--model haiku` → `claude-haiku-4-5-20251001`; `--model sonnet` →
`claude-sonnet-5`. The adapter's first end-to-end run failed its own init receipt
with `model is "claude-haiku-4-5-20251001", expected "haiku"`.

ADR-008 §2 phrases the receipt as asserting "`model` as routed". That phrasing is
the trap — what you route with is an alias and what comes back is an id, so the
obvious equality check fails on every healthy session. Corrected in place in
ADR-008; the receipt now takes `model` (exact id, for pinning a build) and
`modelAlias` (dash-segment membership, for the family the crew router asked for).

Note the two id shapes: one carries a date suffix and the other does not. Any
rule that parses the id positionally is already wrong.

**Consequence, instance 24 of the fail-open shape.**
`p-effort-model-fallback` — the evidence for ADR-004 crew routing, load-bearing
`high` — read the model off `--output-format json`, which does not carry it. It
had been publishing `"model reported as not surfaced in result"` and passing on a
zero exit for its entire life. It could not distinguish a session that honoured
`--model` from one that ignored it, which is precisely the claim it exists to
support. Now reads the init receipt and asserts; falsified by routing `sonnet`
while asserting `haiku` (`routed --model haiku but claude-sonnet-5 answered`),
then reverted and re-run green.

`--effort` has **no receipt field at all**, so the probe records
`effortAssertable: false`. A green result on that probe means the flags composed
and the model routed — it has never meant effort was verified, and now says so.

### 20.2 A second rate-limit window exists, and it is not sleepable

Measured on a healthy session, hours after the one that produced ADR-007's
Finding 3:

```json
{"status":"allowed_warning","resetsAt":1785985200,"rateLimitType":"seven_day",
 "utilization":0.51,"isUsingOverage":false}
```

Three deltas against ADR-007: `status` has a third value (`allowed_warning`),
`utilization` is a field the ADR does not record, and **`rateLimitType` can be
`seven_day`**. ADR-007's "sleep to `resetsAt`" was written against a five-hour
window where sleeping resumes the same night; a seven-day `resetsAt` can be days
out. A Night Shift supervisor obeying that rule literally would go silent until
next week while looking exactly like a working run. ADR-007 is corrected in
place: sleep only when the wait fits the run's remaining budget, otherwise stop,
park the work, and say so with the reset date.

**How it was found is the point.** Nobody predicted `allowed_warning`. The
adapter surfaced it because `stream-surface.json`'s `unknown: escalate` branch
refused to drop a value it did not recognise — the fail-closed default doing the
exact job it was written for, on its first real encounter with the unknown.
It is now classified `render`: the user should be told they are half way through
a weekly allowance, and interrupting them for it would be the alarm fatigue the
schemaVersion 2 rewrite exists to prevent.

### 20.3 The init receipt — the gate every phase passes through — had zero tests

`assertInitReceipt` gates every stage before a token is spent (ADR-008), and it
had no unit coverage whatsoever until its first live failure. The gate that
guards everything else was itself unguarded. Now 14 tests, each written to be
able to fire, including the two directions that matter most: an **absent** field
must fail the gate rather than satisfy it, and the version compare must be
numeric (`'2.1.9'` sorts above `'2.1.220'` as a string, and that error lets a
version *below* the tested floor through).

### 20.4 A failing gate that leaks a live session hides its own failure

The first live failure left the `claude` child running, so node's event loop
never drained; the test run hung for five minutes with an empty output file and
the assertion error invisible until the process was killed by hand. The failure
was fully diagnosed only *after* a manual `kill -9`.

The narrow fix is test hygiene (`t.after` reaps the group). The general rule is
not: **an authenticated process left running by a failure is a failure that
spends quota while reporting nothing.** The stall watchdog already stops the
session before reporting for exactly this reason; the same discipline has to hold
at every exit path the orchestrator has, not only the one that was designed for
it.

## 21. Addendum — the S1 sprint-close audit, and what two independent reviewers found in code I had already verified (2026-07-31)

Two advisory passes over `packages/engine` — a design review and an adversarial
security audit, each given the code and no explanation of it. They converged
independently on seven findings and the security pass added five more. Every one
was verified against the code before acting; every one held. The suite was green
and the live tests passed before this ran.

**The headline is uncomfortable and worth stating plainly: the gate that ADR-008
puts in front of every phase did not gate anything.** `assertInitReceipt`
returned a list of problems, the caller emitted a `failure` event, and then fell
through and kept running. The user-facing string said *"so it was stopped before
doing any work"* — and nothing was stopped, and work had already begun, because
the documented call order put the prompt on the wire before init was parsed. My
own live test asserted the failure fired and then sent a turn anyway: **it
documented the bug and called it a pass.**

Three more fail-open layers were stacked in the same gate: `expect` was optional,
so omitting it produced a gate that could not fire; the check ran only from
inside the init branch, so an engine that emits no receipt was never gated at
all; and there was no way for a caller to *wait* for the gate, so "before tokens
are spent" was structurally impossible with that API.

### 21.1 What the fix required measuring

Making `send()` wait for the receipt deadlocked immediately — both live tests hung
for exactly the 30-second timeout. The cause is a fact nobody had measured:

> **The engine emits no `system/init` until it receives a user message.** Idle
> for 8 s with stdin open: nothing. The receipt arrived **86 ms** after the first
> turn was written.

So the gate cannot be "no send before init". It is **one priming turn, then
nothing until the receipt passes** — no second turn, no accepted output, and a
kill within milliseconds of a mismatch, which is before the model's answer
exists. ADR-008's "before tokens are spent" is corrected in place: the prompt's
input tokens are spent, and that is the true and small cost of the gate.

### 21.2 The other findings, in severity order

- **Raw chain-of-thought was renderable at the API boundary.** `stream_event` is
  pinned `render`, and the envelope is what carries `thinking_delta`. The adapter
  emitted only the OUTER class, so a cockpit doing the obvious
  `if (cls.class === 'render')` would stream unrewritten English reasoning into a
  Turkish user's feed with every gate green. The artifact pinned it, the probe
  pinned it, CI gated it — and the pin stopped at the adapter. Fixed with
  `effectiveClass(outer, inner)` in **one** place, because re-deriving the
  combination rule per consumer is ignoring-by-convention one layer up.
- **stderr was piped and never read.** REVIEW-02 **B8 already named "both pipes
  always drained" as an exit criterion** and the rewrite dropped it — the
  predecessor harness has the listener, under a comment naming the consequence.
  The engine blocks under backpressure rather than dropping, so ~64 KiB of
  unread stderr deadlocks the phase, stdout goes quiet, and the stall watchdog
  reports *"the engine went quiet"* about a fault that is four lines of ours.
- **An `EPIPE` on stdin would kill the supervisor and orphan the children.** The
  children are `detached`, so an uncaught throw takes the parent and leaves
  authenticated processes running with nobody reading them. Same class: any
  consumer listener that throws propagated out of the `data` handler.
- **The framing layer violated the classifier's own invariant.** Three silent
  `continue`s discarded unparseable lines, while `#lastEventAt` was refreshed by
  *bytes* — so a CLI framing change would keep the watchdog fed while every line
  was dropped: no events, no terminal event, a silent feed. `#buf` also had no
  cap and was rescanned in full on every chunk.
- **`loadSurface` was materially weaker than its own probe-side twin**, which is
  the drift the probe's docstring warns about, one directory away. It checked
  `defaultForUnknown` and nothing else, so three shapes loaded cleanly: a `when`
  rule missing `unknown` (yielding `class: undefined`, silently dropped by any
  renderer), a `class: "renderr"` typo, and **a thinking entry reclassified to
  `render`** — a valid *shape* and a raw-reasoning leak. The strong copy ran in
  CI; the weak one ran on the user's machine. Fixed by extracting the validator
  to `tools/probe/lib/stream-surface-schema.mjs` and importing it from **both**.
- **The env deny-list was proven inadequate by measurement, not argument.** The
  audit asked whether `CLAUDE_CODE_OAUTH_TOKEN` was covered. Extracting every
  auth-or-routing-shaped variable *from the 2.1.220 binary* returned about a
  hundred names, of which the nine-key list caught nine — missing
  `CLAUDE_CODE_OAUTH_TOKEN`, `CLAUDE_CODE_OAUTH_REFRESH_TOKEN`,
  `CLAUDE_CODE_SESSION_ACCESS_TOKEN`, `CLAUDE_CODE_CLIENT_KEY`,
  `ANTHROPIC_IDENTITY_TOKEN`, `ANTHROPIC_FOUNDRY_AUTH_TOKEN`, the whole `AWS_*`
  credential family and `GOOGLE_APPLICATION_CREDENTIALS`. Now a prefix rule over
  five namespaces plus 25 named `CLAUDE_CODE_` auth keys, iterating the
  environment rather than the list.
- Plus: a stale `#pgid` could SIGKILL a **recycled** process group (and every
  session is its own group leader, so the likeliest victim is another live
  engine); `start()` twice leaked a child per retry; `#expectingOutput` as a
  boolean left a second in-flight turn unwatched; `setDraining(false)` then
  `finish()` disarmed the watchdog entirely; `cmpVersion` returned `NaN` on a
  malformed range and silently disabled the version gate; and `#checkHook`
  exempted *empty* stdout — the commonest form of the truncated write it exists
  to catch — while calling `JSON.parse` "validation".

### 21.3 What this says about the process

The code was written against measured facts, type-checked, unit-tested, and
verified end to end against the real engine — and an adversarial pass still found
a critical fail-open in the single most load-bearing gate, plus a raw-reasoning
leak at an API boundary that three separate mechanisms had been built to prevent.

That is not an argument against the earlier verification; it is the exact
evidence for ADR-002's rule that **no claim is accepted from the session that
produced the work**. The author's own tests encoded the author's own assumption
about what the gate did. It took a reader with no such assumption to notice that
the message and the code disagreed.

## 11. Addendum — the logged-out shape, measured for free (2026-07-30)

The first CI run doubled as a B5 probe nobody had to pay for: a GitHub runner has
no subscription login, so the free tier executed against a genuinely logged-out
machine. Result:

```
{ loggedIn: false, authMethod: <string> }     // no subscriptionType
```

Three things follow.

1. **The G0 doctor's detection path works logged-out.** `claude auth status --json`
   returned promptly and parseably — no hang, no browser, no credential touched.
2. **`subscriptionType` is absent rather than empty.** The doctor must key on its
   absence, not on a falsy value; code that reads `parsed.subscriptionType` and
   compares strings will silently classify a logged-out user as "unknown plan".
3. **This does NOT answer the dangerous half of B5.** `claude -p` with no valid
   login is the path that can hang or open an interactive flow, and nothing here
   exercised it. B5 stays open for that.

The probe now treats the logged-out shape as a pass with an explicit note, rather
than a PARTIAL. A standing yellow in a nightly job is how the next real
regression goes unnoticed.

## 10. Confidence

- **This review's findings are real**: 90%. Most rest on strings extracted from the shipped binary plus documented help text; three were directly measured. The residual 10% is that a binary string is evidence a code path exists, not that it fires under our session profile — which is precisely what the Tier A probes are for.
- **S1 as previously scoped**: was 80%, now **68%**. Not because anything got worse, but because seven unknowns that were invisible are now named, and four of them can produce "the feed silently stops" — the single worst outcome for a non-coder.
- **S1 with Tier A answered**: **80%**, back to the prior number with the fragility relocated from unknown to measured.
- **S2 kill-9 gate**: was 72%, now **60%** until B1 runs. Orphaned engine processes spending a friend's quota after a crash is a real, unmeasured, user-visible failure.
- **Overall plan**: **72% → 70%.** The plan did not get worse; my estimate of it got more honest. Discovering seven S1 unknowns after declaring S0 done is exactly the "author blindness" pattern the blindspot rule exists to catch, and it took an independent audit to catch it — which is evidence for the process, not against it.

**The one thing I would not defend**: S0 was declared complete on a suite that could not have detected a stalled feed. That was a real gap in my own work, found by an adversarial pass rather than by me.
