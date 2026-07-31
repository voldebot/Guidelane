# Project Status

> Maintained by the overnight orchestrator. Morning briefing always appears at the top after a run.
> Sprint: **S1 (open 2026-07-31)**. This run covers **S1-A** (REVIEW-02 Tier A items measurable on
> the existing harness) and **S1-B** (the throwaway reactive rig).
> Authority: `CLAUDE.md` · `PROJECT_MAP.md` · `docs/research/REVIEW-02-runtime-gaps.md` §3, §12, §13.

---

## READ THIS BEFORE EVERY CYCLE — hard constraints for this run

Every one of these exists because it was violated, or because an adversarial audit of this very file
proved it would be. **H2 and H3 are the two that end the night if you get them wrong. Read them
twice.**

### H1 — Never regenerate the baseline.

`node tools/probe/run.mjs --live --update-baseline` is **FORBIDDEN this run.** It is a full 17-probe
live sweep — real subscription quota — and it is the owner's supervised morning job. Validate a new
probe with a **filtered live** run instead:

```bash
node tools/probe/run.mjs --live --only <new-probe-id>
```

A filtered run writes `docs/research/S0-conformance-report.partial.{md,json}` (both gitignored) and
leaves the canonical report and `tools/probe/baseline.json` untouched. `run.mjs` additionally refuses
`--update-baseline` on a partial run, so the worst case is recoverable: `baseline.json` is version
controlled and this branch is disposable.

### H2 — The free-tier run is BLIND to every probe this night builds. Never use it as evidence.

Measured in `tools/probe/run.mjs:187` — `const judged = report.results.filter((r) => r.status !==
'skip' && r.status !== 'inconclusive')`. A `live-call` or `fixture-call` probe run **without**
`--live` is marked `skip`, so it is excluded from `judged`, produces **no drift**, and the suite
prints green and exits **0**.

**Consequence, and it is the trap that would have ruined this night:** running plain
`node tools/probe/run.mjs` after adding your probe prints `13 pass · 0 fail` and exits 0 **while your
probe has never executed a single line of its own body.** That green means nothing. It is not
evidence of anything. Do not write it into your result section as if it were.

The only run that exercises a new probe is the filtered **live** form in H1.

### H3 — Expected drift is PASS for the decision line. Real drift is STOP.

`node tools/probe/run.mjs --live --only <your-id>` will exit **1**, printing something like:

```
BASELINE DRIFT — expected status changed:
  <your-probe-id>: (unrecorded) -> pass
```

That is correct, designed behaviour (`run.mjs:284-291`: *"An unrecorded probe IS drift"*), not a test
failure. But the orchestrator's decide phase STOPs the whole night on `tests failed`, so **you must
classify the exit code, never report it raw.**

- **Write the Tests line in exactly this shape:**
  `- Tests: PASS (new probe <id> = <its own status>; suite exit 1 = unrecorded-probe drift per H3; baseline.json untouched; drift list names ONLY probes added this run)`
- **`tests PASSED` is satisfied if and only if** every line in the drift block names a probe added
  during this run, **and** your new probe's own status is `pass`.
- **If a drift line names any of the 30 probe ids already in `tools/probe/baseline.json`**, or any
  probe reports `fail` / `error`, that is a genuine regression → `STOP — real baseline drift`.

The "ONLY probes added this run" clause is load-bearing (H5 Q3). Without a pinned expectation the
exemption becomes a blanket amnesty that hides a real regression in the existing 30 — which is the
exact fail-open shape this repo has produced 22 times.

**Decide phase: paste this rule verbatim into your QUALITY GATE agent's prompt.** That agent is told
to run the test command; it will see exit 1 and return DISCREPANCY on a perfectly correct result,
which trips the `verdict not VERIFIED` half of STOP independently of the tests half.

### H4 — Assert on an engine-emitted field, against a pinned expectation. Never on model output.

Three probes were written that asserted on generated prose; all three were wrong and two passed once
before flipping. **Legal** assertion surfaces: `system/init` fields, stream `type`/`subtype` pairs,
`tool_result.is_error`, `result.*`, `claude doctor` output differentials, structural channels.
**Illegal**: asking the model to describe its own configuration, its own tools, or its own choices.

### H5 — PROJECT_MAP Principle 9, applied to every guard you write.

Three questions, all three must have a good answer before you ship an assertion:

1. **Can it fire?** (An assertion over the same constant its own setup loop just used cannot.)
2. **Is it a constraint or a convention?** (A comment saying "callers should…" stops nobody.)
3. **Does it have a pinned expectation?** (A counter nothing compares against falsifies nothing.)

The recurring defect in this repo, found **22 times across three review passes**, is exactly one
shape: *the harness inferred where it should have asserted, and every inference failed open.*
Expect to be instance 23.

### H6 — Prove the probe can fail. Mandatory, and it is a probe's real exit criterion.

Q1 of H5 is only satisfied by demonstration. For every probe you ship:

1. Run `node tools/probe/run.mjs --live --only <id>` → record your probe's own **status**.
2. Deliberately corrupt its pinned expectation (change the expected value, not the assertion logic).
3. Re-run the same command → your probe's own **status must become `fail`**.
4. Restore the expectation and re-run → back to `pass`.

**Read the probe's `status` in the partial report, never the process exit code.** The exit code is 1
in every one of these runs because of H3 drift, so an exit-code-based falsification test always
"passes" and therefore measures nothing.

A probe that cannot be made to fail is decoration. Report it as a failed item, do not ship it.

### H7 — Consolidate BEFORE you stop, never after.

Before writing any `## Cycle N decision: STOP` line, **and** before the CONTINUE line of your cycle,
you must have already written the cycle's measurement down:

- Append to the dated addendum in `docs/research/REVIEW-02-runtime-gaps.md` — every measurement taken,
  **including negative results and failed attempts**. Follow the existing addendum style (§12, §13).
- Update the §3 / §9 disposition of any Tier A item you touched.
- Add or resolve the matching `PROJECT_MAP.md` §6 ledger row.

Name the addendum heading in your decision line so the write-down is verifiable rather than claimed.
**A night that measured something and wrote nothing down is a failed night**, regardless of how many
probes landed. This is an exit obligation, not a queued item — an earlier version of this plan made
it item 8 of 8 and it was therefore the first thing the night would lose.

### H8 — Commit at the end of every cycle. Nothing else instructs you to.

```bash
git add -A && git commit -m "S1 night cycle N: <one line>"
```

The orchestrator never tells any phase to commit, so without this the night's work exists only in the
working tree and a rate-limit death loses all of it. Commit even on a failed cycle — a failed
attempt with its evidence is worth more than a clean tree.

### H9 — Do NOT push. A hook enforces it.

`.git/hooks/pre-push` blocks every push and explains why. Do not remove it, do not use `--no-verify`.
The repo is public and an unrecorded probe drifts the baseline, so a push turns CI red before the
owner has reviewed a line. Morning order: review → one full `--live --update-baseline` → remove hook
→ push.

### H10 — Redaction is a boundary, not a discipline.

Anything written into `docs/research/` goes through `tools/probe/lib/redact.mjs`. Never hand-write a
captured stream, env dump, or absolute path into a committed artifact — and that includes the H7
addendum, which is hand-authored prose in a public repo. No `/Users/...` paths, no usernames.
Operator-owned names (skills, agents, MCP servers beyond the pinned built-in floor) are published as
a count plus a short fingerprint, never verbatim.

### H11 — A negative result, honestly evidenced, is a PASS.

Several items below may find that the engine simply never does the thing. *"We ran the flow under the
ADR-007/008 profile and the engine emitted no `request_user_dialog` at all, here is the captured
stream"* **closes the blocker** and is a successful cycle. Write `CONTINUE`.

Only these are STOP conditions: a harness crash (`run.mjs` exit 2), an inconclusive run (exit 3), a
rate limit (H13), real baseline drift (H3), or a probe you could not make falsifiable (H6).

**Do not manufacture a positive result.** An invented finding is worse than a negative one.

### H12 — This is a nested session, and the isolation rules still apply.

You are a `claude -p` child running under `--permission-mode bypassPermissions`, and your environment
carries the ADR-008 **forbidden state** (`CLAUDECODE`, `CLAUDE_CODE_ENTRYPOINT`, …). Anything you
spawn inherits it unless it scrubs.

- The probe harness already handles this: `tools/probe/lib/runner.mjs` scrubs the 5-key nesting
  deny-list plus the 9 backend-routing variables and applies the isolation pair
  (`--strict-mcp-config` + `--setting-sources ''`) at the single `run()` chokepoint. Use `run()`.
- **The one deliberate exception is item 5's rig**, which by definition needs a spawn path `run()`
  cannot provide. It must **reuse `runner.mjs`'s env scrub and isolation pair** — import them, do not
  re-type them. A measurement taken on an un-isolated session measures the operator's machine, not
  the engine, and is worthless.

### H13 — If you hit a rate limit, STOP with the exact literal string.

The orchestrator has **no rate-limit handling**; a limited phase exits non-zero and the loop
continues regardless. The stop detector is a literal grep (`^## Cycle <number> decision: STOP`), so
**substitute the real cycle number** — a line containing the letter `N` will not match and the night
runs on burning empty calls.

Correct, for cycle 3: `## Cycle 3 decision: STOP — rate limited [verdict=PARTIAL]`

### H14 — Scope guard: one item, ~30 minutes, and it must fit.

Each cycle's phase is hard-killed at 1800 s by `gtimeout`. A killed phase writes nothing, yet its
item is already consumed by the picker's dedupe — so an over-scoped item is permanently lost. If an
item is visibly bigger than one phase, do the part that fits, write down exactly what remains under
H7, and say so plainly. Partial-with-evidence beats killed-with-nothing.

---

## Next steps (priority order)

### 1. A2 — enumerate the stream `type`/`subtype` union and pin it as an artifact

**Gap**: REVIEW-02 §3 A2. The cockpit's only deterministic plain-language guarantee is
whitelist-rendering, and the whitelist has no enumerated universe. An unhandled subtype in front of a
non-coder is a blank card or a crash.

**Known seed** (REVIEW-02 §13, one short session): `system/init`, `system/hook_started`,
`system/hook_response`, `system/hook_progress`, `system/thinking_tokens`, `assistant` (no subtype),
`rate_limit_event` (no subtype), `result/success`.

**Correction to an earlier draft of this item — read it, it was wrong:** there is **no retained
corpus of captured streams** in this harness. Each probe captures and discards. Do not go looking for
one; you will lose the cycle.

**Build**: a probe (suggested id `p-stream-surface-union`) that runs **its own** session, collects
every `type`/`subtype` pair *that session* emits, and asserts them against a committed, versioned
artifact (suggest `tools/probe/stream-surface.json`) in which every pair carries a classification:
`render | ignore | escalate`.

- **Seed the artifact by hand** from the eight pairs above plus whatever your session adds. The
  artifact is an input the probe asserts against — **never** something the probe writes and then
  checks, which is a tautology (H5 Q1).
- An observed pair absent from the artifact is **FAIL**. An artifact pair carrying no classification
  is **FAIL**.
- State in the probe's own header comment that this is a *sample from N configurations, not the closed
  set* — honest scope beats an overclaiming name.

**Exit**: H6 satisfied (add a fake pair to the artifact classification-less, confirm `fail`, restore).

---

### 2. A4 — probe `request_user_dialog` degradation

**Gap**: REVIEW-02 §3 A4. An interactive prompt inside a supposedly non-interactive session, and the
failure mode is **silent**. The binary states: *"The CLI treats ABSENCE as 'cannot display' and fails
closed: without the kind declared here, a dialog-gated flow degrades to its no-dialog behavior"*,
plus `parked request_user_dialog request_id=` and `Ignoring late request_user_dialog answer`.
Guidelane declares nothing, so an unknown set of engine flows silently degrade.

**Build**: a probe (suggested id `p-request-user-dialog`) that runs a dialog-gated flow declaring no
kinds and records whether the stream shows the request at all, or the flow simply degrades.

**Binary strings set the agenda, they never set the verdict** (PROJECT_MAP Principle 8). You may grep
the binary to *find candidate* `dialog_kind` values, but the probe's PASS/FAIL must rest on what the
engine emitted in your run. A FAIL driven by a grep over a minified bundle is a probe that breaks on
the next release for no reason.

**Exit**: H6 satisfied. **H11 applies strongly here** — "the engine emitted no `request_user_dialog`
under our profile, evidence attached" is a legitimate close.

---

### 3. A6 — probe the thinking surface with partial messages on

**Gap**: REVIEW-02 §3 A6. Raw chain-of-thought is the most engineer-facing text that exists, and the
crew table routes builder/planner/security at `xhigh` and `max`. The in-engine rewrite net
(`MessageDisplay`) fires on assistant text, **not** thinking.

**Known partial answer** (REVIEW-02 §13): `system/thinking_tokens` carries `estimated_tokens` and
`estimated_tokens_delta` and **no text**. Still open: whether a session configured for visible
reasoning also emits content blocks (`thinking_delta`, `signature_delta`, `redacted_thinking`).

**Build**: a probe (suggested id `p-thinking-surface`) making one live call with
`--include-partial-messages`, enumerating **every** content-block type and delta type that appears,
and asserting that set against a pinned expectation.

**The open half is the whole point.** `system/thinking_tokens` is already covered by existing probes;
if your probe only re-observes that, it duplicates green coverage and its exit criterion is vacuous.
The finding this item needs is whether **content-bearing** thinking blocks can reach the wire.

**Cost note**: `--include-partial-messages` is chatty. Trivial prompt, `--model haiku` (the suite's
live default) — you are measuring the wire format, not reasoning quality.

**Exit**: H6 satisfied; thinking is provably in the renderer's ignore set, pinned by name.

---

### 4. A7 — probe whether hook failure is *detectable*

**Gap**: REVIEW-02 §3 A7. The binary emits `MessageDisplay hook failed for completed message;
emitting original text:` with the taxonomy `hook_success | hook_non_blocking_error |
hook_error_during_execution | hook_cancelled`. Every failure leaks unrewritten engineer text to a
non-coder — a secure-by-default violation (blindspot Q4) on the product's **core promise**.
ADR-008 states the fail-open caveat; this probe decides whether it is **detectable**.

**Build**: a probe (suggested id `p-hook-failure-detectable`) with a fixture hook that fails three
ways: (a) exits non-zero, (b) exceeds its timeout, (c) returns malformed JSON. For each: does the
original unrewritten text get emitted, and does any `hook_*` attachment mark it? Run with
`--include-hook-events` — read `p-hook-events-headless` first for the mechanism.

**Do not mutate a shared fixture in place.** `tools/probe/fixtures/plugin` is consumed by several
existing probes, at least one of them free-tier and CI-gating. Add a **new** fixture directory for the
failing hooks. Breaking a green probe to write a new one turns H3's exemption into a real regression
and STOPs the night.

**Exit**: H6 satisfied. Either every failure mode produces a usable signal, **or** the finding is that
it does not — in which case mechanism 4 is demoted to best-effort in writing (H7 addendum) and the
deterministic whitelist becomes the sole guarantee. Both close the blocker.

---

### 5. S1-B — build the ~40-line throwaway reactive rig and run its hard gate

**Why**: A1, A5 and A3b's backpressure half are **structurally unmeasurable** with the current
primitive. `spawnCapture` buffers everything, closes stdin immediately, and times out on wall-clock
rather than inter-event silence — so it cannot answer a control request, cannot be cancelled, and
cannot hold a stream open. Recorded as S1 debt (task #17) and in `CLAUDE.md` §8.

**Build**: a throwaway rig at `tools/rig/reactive.mjs` — target ~40 lines of logic, not a framework,
not the future adapter. It must spawn `claude` with `--input-format stream-json --output-format
stream-json --verbose`, keep **stdin open**, parse events line-by-line as they arrive, and write a
reply mid-stream.

**H12 is not waived for the rig, it is waived only for `run()`.** Import the env scrub and the
isolation pair from `tools/probe/lib/runner.mjs` and apply them. An un-isolated rig measures the
operator's machine and every downstream A1/A5 number is void. This is the one deliberate second spawn
path in the repo; say so in the file header, and say it is temporary.

**HARD VALIDATION GATE — binary:**
> The rig must observe an event mid-stream and write a reply the engine **visibly acts on.**

"Visibly acts on" means a subsequent **engine-emitted** event demonstrably caused by the reply — not
the model saying it received something (H4).

**A failed gate is a successful measurement.** It collapses A1's exit criterion to the cheaper form
and makes S1 less expensive — learning that from 40 lines instead of from an adapter built on a guess
is the entire point. Do not grind past a reasonable attempt; write down what you tried and what the
engine did.

**Record the verdict as one of these exact strings** — items 6 and 7 branch on them:
`RIG GATE: PASSED` · `RIG GATE: FAILED`

**Then write `CONTINUE` either way.** `RIG GATE: FAILED` is an H11 negative result, not a test
failure. Only a crash, a rate limit, or real drift STOPs here.

**Confidence going in**: ~62%. Novel mechanism, no prior art in this repo. If your honest confidence
after building is lower, state the number.

---

### 6. A1 — the control channel (branches on the rig gate)

**Read the most recent `RIG GATE:` line in this file first. If there is no such line — because cycle
5 was killed, rate-limited, or never ran — treat it as `FAILED` and take the cheap arm. Fail closed.**

**If `RIG GATE: PASSED`** → build the A1 probe on the rig. Two arms (REVIEW-02 §3 A1): (a) deliberately
never answer a `control_request` and measure whether the run terminates within a bound; (b) answer
correctly and confirm progress. *Exit*: the adapter needs a responder **and** a hard stall timeout,
both specified from measured numbers. "Silence with no terminal event" must be provably impossible
before a feed goes in front of anyone.

**If `RIG GATE: FAILED` (or absent)** → the cheap arm: a probe asserting the engine **never emits** a
`control_request` under the ADR-007/008 session profile. Weaker but honest, and assertable on the
existing harness. State in the probe's header that it is the fallback form and why, so nobody later
mistakes it for the full answer.

**Exit**: H6 satisfied in either arm.

---

### 7. A5 or C7 (branches on the rig gate)

**Same fail-closed default as item 6: no `RIG GATE:` line means `FAILED`.**

**If `RIG GATE: PASSED`** → **A5**, per REVIEW-02 §3 A5. No engine-side timeout flag exists, so the
orchestrator's per-stage timeout is the **only** guardrail, and nobody has measured the maximum
*legitimate* inter-event silence. Run a session whose Bash tool sleeps ~120 s; record the max
inter-event gap and whether `tool_progress` reaches `-p`. Then stop draining stdout for 30 s and check
for the classic Node spawn deadlock (which presents to a user as a frozen feed). *Exit*: a **measured**
max-silence figure, a documented backpressure answer, and a rule for what the feed shows during
legitimate silence.

**If `RIG GATE: FAILED` (or absent)** → **C7** (`--add-dir` scope semantics, REVIEW-02 §5 C7),
deliberately parked to ride along with this batch. Unknown: whether `--add-dir` grants write as well
as read, whether the added root appears on the init receipt (so the receipt can assert it per
ADR-008), and how it composes with a fail-closed `--allowedTools`. *Exit*: a two-root session writes
to both and both appear on the receipt — or the adapter copies files instead of adding roots.

---

## Morning checklist for the owner (NOT a pickable item)

The night deliberately leaves these undone:

- **Read every new probe before trusting it.** For each, ask H5's three questions and confirm the H6
  falsification run actually happened (the cycle result must name the corrupted expectation and the
  resulting `fail` status). An unattended session is the profile most likely to reproduce the
  inferred-instead-of-asserted defect.
- **One full re-baseline**, supervised: `node tools/probe/run.mjs --live --update-baseline`.
  All new probes at once — this is exactly why H1 forbids doing it per cycle.
- **Remove the guard, then push**: `rm .git/hooks/pre-push` — not before.
- **Check for orphans**: `pgrep -fl claude` before assuming the night is over.

---

## UI follow-ups for morning
(empty — Guidelane has no UI code yet; `apps/cockpit/` does not exist. Backend/harness work only.)

## Cycle history
(populated by orchestrator, newest first)

## Cycle 1 picked: A2 — enumerate the stream `type`/`subtype` union and pin it as a committed artifact
- Source: '## Next steps' item #1 (A2, REVIEW-02 §3). TaskList empty; no cycle has picked anything yet
  (cycle history was empty at scan time), so #1 is the lowest unpicked item.
- Files: `tools/probe/probes.mjs` (new probe `p-stream-surface-union`),
  `tools/probe/stream-surface.json` (new hand-seeded artifact),
  `docs/research/REVIEW-02-runtime-gaps.md` (H7 addendum + §3/§9 disposition),
  `PROJECT_MAP.md` (§6 ledger row). No UI files exist; none touched.
- Why: the cockpit's only deterministic plain-language guarantee is whitelist-rendering, and the
  whitelist currently has no enumerated universe — an unclassified subtype in front of a non-coder is
  a blank card or a crash.
- Success criterion: `node tools/probe/run.mjs --live --only p-stream-surface-union` reports the
  probe's own status as `pass` (read from the partial report, not the exit code — H3/H6); the artifact
  is hand-seeded with every pair classified `render | ignore | escalate`; an observed pair missing from
  the artifact and an artifact pair with no classification both FAIL; H6 falsification demonstrated by
  corrupting a pinned expectation and recording the resulting `fail` status, then restoring; H7
  write-down landed before the cycle's decision line.

## Cycle 1 result
- Files changed: `tools/probe/probes.mjs` (new probe `p-stream-surface-union` + module-scope
  `publishablePair`/`SAFE_STREAM_TOKEN`), `tools/probe/stream-surface.json` (NEW hand-seeded artifact),
  `docs/research/REVIEW-02-runtime-gaps.md` (new §14 addendum; §3 A2 + §9 row 1 dispositions),
  `PROJECT_MAP.md` (5 new §6 ledger rows), `STATUS.md`. No UI files exist; none touched.
- Tests: PASS (new probe p-stream-surface-union = pass; suite exit 1 = unrecorded-probe drift per H3;
  baseline.json untouched; drift list names ONLY probes added this run)
- Advisors consulted: backend-architect (probe/artifact design + fail-open analysis),
  security-pentester (7-question adversarial audit, leak analysis), general-purpose
  (second-opinion review of my code — dispatched, had not returned before this write-up; see
  "not done" below)
- Confidence: **80%** that this probe is a real assertion rather than decoration. The 20%:
  named below, not hidden.
- Summary: `p-stream-surface-union` runs one maximally verbose session and asserts every
  `type`/`subtype` pair — and every content-block/delta type inside `stream_event` — against a
  hand-seeded, hand-classified `tools/probe/stream-surface.json`. It found two things the plan did
  not know: the pair **`system/status`**, named nowhere in REVIEW-02; and **content-bearing thinking
  blocks reaching `-p` stream-json on `--model haiku` with no reasoning flag**, unrewritten by the
  MessageDisplay hook — which answers the open half of A6 as a side effect. H7 write-down landed in
  REVIEW-02 **§14** before this line.

### Cycle 1 — H6 falsification, as performed (the probe's real exit criterion)
Statuses read from the probe's entry in `S0-conformance-results.partial.json`, never the exit code.

| Corruption | Probe's own status |
|---|---|
| none | `pass` |
| renamed `pairs["system/thinking_tokens"]` → an observed pair becomes unclassified | **`fail`**, naming it |
| restored | `pass` |
| removed `system/init` from `requiredPairs` → trips the code-side floor (returns before the engine call, costs no quota) | **`fail`**, naming it |
| restored | `pass` |

Two independent guards falsified, not one: the observed-⊆-artifact check **and** the pinned-minimum
check. The second matters more — the subset check alone passes on an empty stream.

### Cycle 1 — weak spots, stated before anyone has to ask
1. **CI never runs this probe.** It is a `fixture-call`, so it is `skip`ped without `--live`, and the
   free tier is the only tier CI has (H2). Artifact validity — which needs no engine at all — should
   be split into a free `observational` probe. Not done tonight; logged in PROJECT_MAP §6.
2. **The classification column has no consumer.** `apps/cockpit/` does not exist, so
   `render | ignore | escalate` is a pinned decision, not a constraint on any renderer. The universe
   is asserted; obedience to it is not. H5 Q2 answered honestly: this half is currently a convention.
3. **`system/status` is classified without knowing what it means.** `escalate` is a deliberate
   fail-closed placeholder, not a measurement. The probe retains no payload values by design (H10),
   so enumerating them is separate work.
4. **One configuration, ~28 unmeasured binary names.** Only `status` and `thinking_tokens` of REVIEW-02
   §3 A2's extracted list have been seen as real pairs. The rest were deliberately NOT seeded — a
   guessed pair in a pinned expectation can never be falsified (Principle 8). So the artifact is
   honestly small, and "union" in the probe id overclaims relative to what one session proves; the
   detail line carries the caveat on every run.
5. **The second-opinion `general-purpose` review had not returned when I wrote this**, and the two
   advisory reviews that did return arrived *after* I had already run the first live tests — so the
   phase spec's ordering (advisors → code → review → tests) was not honoured strictly. Their findings
   were folded in afterwards (the leak gate on unknown pair names and the code-side required floor
   both came from them, and both are in the shipped code), but a finding that lands in the morning
   review has not been acted on. Read them before trusting the probe.
6. **I corrupted the artifact for H6 and `git checkout --` did not restore it** — the file was
   untracked. Caught and repaired by re-reading the file; the final run confirms `requiredPairs`
   contains all five entries. Worth noting because the same reflex on a *tracked* file would have
   silently reverted real work.

### Cycle 1 — second-opinion review landed AFTER the first commit; two fixes applied, five not
The `general-purpose` review returned after commit `1d03844`. Two findings were fixed in a follow-up
commit; the rest are on the record rather than done, because the cycle's time box was spent.

**Fixed:**
- **The code-side floor existed on the outer half only.** `requiredInnerPairs` was checked for
  non-emptiness but had no pinned floor — so swapping it for one envelope-only entry made a stream
  carrying *no text at all* satisfy the inner subset check. I wrote that exact guard and applied it
  to one of the two places. Now `REQUIRED_INNER_FLOOR` mirrors it. Falsified free (returns before the
  engine call): corrupt → `fail` naming the omission → restore → artifact byte-identical to committed.
- **One leak channel.** The malformed-event message published `e.type` verbatim into a public report,
  at exactly the moment the probe stopped understanding the stream. Now goes through
  `publishablePair` like every other novel string. The sibling line one above it had already been
  hardened; this one had been missed.

**NOT fixed — read these before trusting the probe:**
1. **`rate_limit_event` is classified `escalate` and it fires on every healthy session.** My own
   evidence shows it in a 35-event trivial run that exited 0. A cockpit implementing this whitelist
   literally would escalate on every phase, forever — manufacturing alarm fatigue, whose first
   casualty is the one escalation that matters. The real problem is schema, not classification: two
   of the three `escalate` entries are conditional on a *field value* (`rate_limit_event.status`,
   `system/status.status`) and the one-class-per-pair artifact cannot express that. This is the most
   important finding of the night and it is unfixed.
2. **A JSONL framing break is invisible in my evidence.** A line starting with `{` that fails to
   parse is dropped by `ctx.jsonLines` before my loop sees it, so it lands in neither
   `nonJsonLineCount` nor `malformedCount` — the evidence would publish `0/0` about a broken stream.
   The harness does force INCONCLUSIVE via `audit.degraded`, and INCONCLUSIVE is excluded from the
   drift gate, so a permanent framing regression never turns the baseline red. REVIEW-02 B8 is this
   probe's own subject matter and it is delegated to a counter the gate ignores.
3. **`exit` is recorded and compared against nothing** (H5 Q3 verbatim). Concrete cost: if a flag is
   renamed in a future CLI, the child exits non-zero with empty stdout and the probe reports
   "required pair(s) never arrived: system/init, …" — a confident wrong claim about the engine, which
   is the `p-autoupdate-governable` shape exactly.
4. **The hook pairs are the stated reason for loading the plugin, and their absence passes silently.**
   `system/hook_started` / `system/hook_response` are classified but not required.
5. **The `_`-prefix filter in the artifact validator is an escape hatch**: a key starting with `_` is
   un-validated *and* counts as classified.

**Also flagged and accepted as residual**: the artifact can be widened to silence a red probe, and
the only thing stopping that is a sentence in a failure message — a convention, not a constraint.
`classifiedButUnobserved` in the evidence is the review signal for it.

**Honesty note on validation**: after these two edits I ran `node --check` and the free falsification
above (which exercises the new floor's code path). I did **not** make another `--live` run after
them, so the last green live run is against the code as of commit `1d03844` plus two changes whose
pass-path behaviour is unchanged by inspection. Not the same thing as measured.

### Cycle 1 scan notes (pre-flight evidence, not the item)
- Free-tier pre-flight: `node tools/probe/run.mjs` → `13 pass · 0 fail · 0 partial · 0 inconclusive ·
  0 error · 17 skipped`. Baseline is healthy going in. **Per H2 this says nothing about any probe
  built tonight** — it is recorded only as a "the existing 30 were green before I started" datum, so
  a later real regression is attributable.
- `grep -rn "TODO\|FIXME" tools/ docs/decisions/` → no matches.
- Working tree at scan time: only `docs/FILEMAP.md` modified (hook-generated).
- 30 probe ids present in `tools/probe/probes.mjs`; `p-stream-surface-union` is not among them and
  `tools/probe/stream-surface.json` does not exist — the item is genuinely unstarted.

## Cycle 1 quality gate — independent verification (decide phase)

An advisory `general-purpose` agent re-read every file named in the cycle-1 result and made **one**
fresh `node tools/probe/run.mjs --live --only p-stream-surface-union` run. It was given H3 verbatim so
it would classify exit 1 rather than report it raw.

**Verdict: VERIFIED.** No discrepancy between claim and reality anywhere.

- Tests: PASS (new probe `p-stream-surface-union` = `pass`; suite exit 1 = unrecorded-probe drift per
  H3; `baseline.json` untouched and carries no entry for the new probe; drift list names ONLY
  `p-stream-surface-union: (unrecorded) -> pass`, a probe added this run)
- Live run detail: 31 events, 10 pairs, 11 inner types, 0 unknown, 0 missing-required, child exit 0,
  5 hooks fired.
- **This run supersedes the cycle-1 "Honesty note on validation".** The last green live run no longer
  predates the two follow-up edits of `bc0a369` — the probe passes *with* `REQUIRED_INNER_FLOOR` and
  the `publishablePair` leak fix in place. That gap is closed, measured rather than inspected.
- Independently reproduced, not merely re-read: `rate_limit_event` fired on the gate's own trivial,
  healthy, exit-0 session (confirming the night's headline unfixed finding is real); `system/status`
  and the three thinking pairs appeared again on `--model haiku` with no reasoning flag (confirming
  the A6 side-finding); and STATUS.md weak-spot #2 was traced to `runner.mjs:625-630`.
- All five self-disclosed NOT-fixed items were confirmed present and accurately described. Nothing
  had been overstated as fixed.

### The gate found one defect cycle 1 did NOT disclose — and H5 predicted it by number

**Instance 23. `publishablePair` is a shape *inference* that fails open, while its docstring claims it
is the allow-list `publishableNames`.** (`tools/probe/probes.mjs:74-78`, docstring `:62-73`.)

`publishableNames` (`:44-48`) fingerprints anything outside a pinned floor. `publishablePair` instead
splits on `[/=.]` — exactly the separators in paths and dotted names — and passes any fragment matching
`^[A-Za-z][A-Za-z0-9_-]{0,40}$`. Measured by the gate:

| Input | Result |
|---|---|
| `plugin_<operator-plugin>_<server>` | **published verbatim** — and the docstring names this exact shape as what it protects against |
| `mcp__plugin_<client>_<server>__<tool>` | **published verbatim** |
| an absolute home path | **published verbatim** by this function (caught downstream by `redact.mjs` only) |
| `SessionStart:startup`, or any token >41 chars | correctly fingerprinted |

Why it matters despite low probability: it fires *precisely* on an unknown pair name — i.e. at the
moment the probe has stopped understanding the stream, which is the isolation failure it exists to
detect. `CLAUDE.md` §8 states operator-owned names are the one class `redact.mjs` and the CI grep
cannot see, so there is no backstop for the first two rows. **Proposed fix** (not applied this cycle):
give `publishablePair` a pinned floor — the artifact's own `pairs`/`innerPairs` key sets are the
natural allow-list — and fingerprint everything else, i.e. actually be `publishableNames`.

**No active exposure**: the gate's live run observed 0 unknown pairs, so nothing committed tonight
contains a leaked name. This is a latent fail-open, not a disclosure.

Two smaller nits, both low severity and both recorded rather than fixed:
- `REQUIRED_INNER_FLOOR` is byte-identical to the artifact's `requiredInnerPairs`, so on the inner half
  the artifact is not independent corroboration — it can only catch a shrink. That is its stated
  purpose; noted so no future reader over-credits it.
- `REQUIRED_FLOOR` (`:545`) pins only 3 of the 5 `requiredPairs`. `stream_event` is transitively
  covered by `REQUIRED_INNER_FLOOR`; **`user` is pinned nowhere in code.**

## Cycle 1 decision: CONTINUE — next: A4 (`Next steps` item #2) — probe `request_user_dialog` degradation, new id `p-request-user-dialog` [verdict=VERIFIED]
- Gate basis: tests PASS (probe `p-stream-surface-union` own status = `pass`; suite exit 1 =
  unrecorded-probe drift per H3; `baseline.json` untouched; drift list names ONLY the probe added this
  run) + independent agent verdict **VERIFIED** on a fresh live run made with the `bc0a369` edits in
  place. All three CONTINUE preconditions met.
- H7 write-down is landed and verifiable: `docs/research/REVIEW-02-runtime-gaps.md`
  **"## 14. Addendum — A2 measured and pinned; A6's open half answered as a side effect (2026-07-31,
  S1 night cycle 1)"** (line 226), plus the §3 A2 amendment (line 38), the §9 row-1 disposition
  (line 125), and 5 + 1 `PROJECT_MAP.md` §6 ledger rows.
- **Rider for the next code-touching cycle, ahead of its own item**: fix `publishablePair`
  (`tools/probe/probes.mjs:74-78`) to use a pinned floor instead of a shape inference — ~5 lines,
  logged as instance 23 in `PROJECT_MAP.md` §6. It did **not** jump the queue: A4 is a Tier A S1
  blocker on the plan's own priority order, the leak has no active exposure (0 unknown pairs
  observed), and a decide phase re-ordering the owner's plan unilaterally is a worse failure than a
  latent fail-open carried one cycle. Stated plainly so the choice is the owner's to overrule.
- Also unfixed and more important than the rider, per cycle 1's own review: `rate_limit_event` is
  classified `escalate` and fires on **every healthy session** — the one-class-per-pair artifact
  schema cannot express a value-conditional class. Reproduced independently by the gate. Fix before
  any renderer reads `stream-surface.json`.
