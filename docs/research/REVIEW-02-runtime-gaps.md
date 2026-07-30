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
| Version + auto-update governance "dropped" (gap 20) | `p-version-readable` and `p-autoupdate-governable` both exist; the latter is the suite's standing PARTIAL. Nothing was retired. |
| Persona/skill probes "lost" (gap 22) | `p-append-system-prompt` and `p-plugin-skill-headless` both exist and pass. |

One further correction, and it is load-bearing. The critic inferred from binary strings ("Display-only: the stored message and what the model sees are untouched") that a `MessageDisplay` rewrite cannot reach the product surface, and concluded R3 mechanism 4 is dead. **Measured on 2.1.220: the rewrite does reach `--output-format stream-json`** — the assistant text block and `result.result` both came back as `REWRITTEN_BY_HOOK` (`p-messagedisplay-rewrite`). Both statements are true at once: for a headless consumer, the stream *is* the display, while the stored transcript and the model's own context keep the original text.

That combination is better than either alone, and it lines up exactly with ADR-006: the model keeps thinking in English while the user reads their own language. It also means a rewrite cannot corrupt what a later session or a review lens reads — the transcript stays canonical.

## 3. Tier A — S1 blockers

Nothing in S1 (cockpit + engine adapter + live feed) ships before these are answered. Each is a probe, and the answer either confirms a design or forces one.

**A1 — The bidirectional control channel.** `control_request` / `control_response` are real in 2.1.220 with subtypes `can_use_tool`, `initialize`, `interrupt`, `set_permission_mode`, `set_model`, `hook_callback`, `mcp_message`, `control_cancel_request`. With `--input-format stream-json` the engine can ask the client a question and block on the answer. An adapter that only ever writes user messages and never answers produces a session with no further events, no `result`, and no exit — indistinguishable from a hang. *Probe*: run under the ADR-007 profile and (a) deliberately never answer, measuring whether the run terminates within a bound; (b) answer correctly and confirm progress. *Exit*: either the engine provably never emits `control_request` under our session profile — asserted every nightly run — or the adapter ships a responder **and** a hard stall timeout. "Silence with no terminal event" must be provably impossible before a feed goes in front of anyone.

**A2 — The closed set of stream `type`/`subtype` values.** The plan's only deterministic plain-language guarantee is whitelist-rendering of structured events, and the whitelist has no enumerated universe. The binary carries at least 28 system subtypes the plan never names — `compact_boundary`, `model_fallback`, `model_refusal_fallback`, `model_refusal_no_fallback`, `model_consent_fallback`, `permission_denied`, `notification`, `api_retry`, `error_during_execution`, `error_max_turns`, `error_max_budget_usd`, `error_max_structured_output_retries`, `interrupt`, `status`, `informational`, `thinking_tokens`, `session_state_changed`, `background_tasks_changed`, `request_user_dialog`, `side_question`, `hook_response`, `get_context_usage`, `set_model`, `set_permission_mode`, `can_use_tool`, `mcp_message`, `reload_plugins`, `apply_flag_settings`. An unhandled subtype in front of a non-coder is a blank card or a crash. *Probe*: extract the discriminated union from the shipped binary's strings **and** from every live probe's captured stream; emit it as a versioned artifact the adapter compiles its whitelist from; nightly CI diffs the union and **fails** on any new value. *Exit*: every observed value is classified `render | ignore | escalate`; unclassified = FAIL, not warning.

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
- **C4 — Version stamping**: every report states the exercised CLI version; a version change with no re-run is a CI failure. `p-autoupdate-governable` stays an explicitly tracked UNPROVEN item rather than quietly disappearing.
- **C5 — Connector absence**: assert `init.tools` contains no `mcp__claude_ai_*` entry, instead of spending a live call proving a belt on top of already-proven braces.
- **C6 — `--forward-subagent-text` shape** (medium priority): the flag forwards subagent text *and thinking* with `parent_tool_use_id` set, multiplying A6 by the number of subagents. Enumerate emitted types once and confirm every forwarded block is attributable.

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
| 1 | Closed set of stream type/subtype | critical | **A2** — S1 blocker, CI drift alarm |
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
