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
