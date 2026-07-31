# Project Status

> Maintained by the overnight orchestrator. Morning briefing always appears at the top after a run.
> Sprint: **S1 (open 2026-07-31)**. This run covers **S1-A** (REVIEW-02 Tier A items measurable on
> the existing harness) and **S1-B** (the throwaway reactive rig).
> Authority: `CLAUDE.md` · `PROJECT_MAP.md` · `docs/research/REVIEW-02-runtime-gaps.md` §3 and §12–13.

---

## READ THIS BEFORE EVERY CYCLE — hard constraints for this run

These are not style notes. Each one exists because it was violated before.

**H1 — Never regenerate the baseline.**
`node tools/probe/run.mjs --live --update-baseline` is **FORBIDDEN this run.** A full re-baseline
costs ~25 minutes of real subscription quota and is the owner's supervised morning job. Validate a
new probe with a **filtered** run instead:

```bash
node tools/probe/run.mjs --live --only <new-probe-id>
```

A filtered run writes `docs/research/S0-conformance-report.partial.md` / `.partial.json` and leaves
the canonical report and `tools/probe/baseline.json` untouched. That is the designed escape hatch.

**H2 — A red suite is the EXPECTED state after you add a probe. Do not "fix" it.**
An unrecorded probe id counts as baseline drift, so `node tools/probe/run.mjs` will exit **1** once
you add one. That is correct behaviour, deliberately built (adding a probe used to be the way to ship
a red one). Record the drift in your `## Cycle N result` section and move on. Re-baselining to make
the red go away destroys the morning review.

**H3 — Assert on an engine-emitted field, against a pinned expectation. Never on model output.**
Three probes were written that asserted on generated prose; all three were wrong and two passed once
before flipping. Legal assertion surfaces: `system/init` fields, stream `type`/`subtype` pairs,
`tool_result.is_error`, `result.*`, exit codes from a structural channel, `claude doctor` output
diffs. Illegal: asking the model to describe its own configuration, its own tools, or its own choices.

**H4 — PROJECT_MAP Principle 9, applied to every guard you write.** Three questions, all three must
have a good answer before you ship an assertion:
1. **Can it fire?** (An assertion over the same constant its own setup loop just used cannot.)
2. **Is it a constraint or a convention?** (A comment saying "callers should…" stops nobody.)
3. **Does it have a pinned expectation?** (A counter nothing compares against falsifies nothing.)

The recurring defect in this repo, found **22 times across three review passes**, is exactly one
shape: *the harness inferred where it should have asserted, and every inference failed open.*
Expect to be instance 23. Write the probe so that it fails when the thing it names is false.

**H5 — Redaction is a boundary, not a discipline.** Anything written into `docs/research/` goes
through `tools/probe/lib/redact.mjs`. Never write a raw captured stream, env dump, or file path into
a committed artifact by hand. Operator-owned names (skills, agents, MCP servers beyond the pinned
built-in floor) are published as a count plus a short fingerprint, never verbatim — they are
employer/client names on exactly the failure the probe exists to detect.

**H6 — Commit locally, do NOT push.**
`git commit` per cycle is wanted (recovery anchors). `git push` is **not** — the drifted baseline
would turn CI red on a public repo before the owner has reviewed the night's work. The morning job
is: review probes → one full `--live --update-baseline` → single push.

**H7 — Nested sessions are expected and already handled.**
You are a `claude -p` child, and the probe harness spawns further `claude` children beneath you.
`tools/probe/lib/runner.mjs` already scrubs the 5-key nesting deny-list plus the 9 backend-routing
variables and applies the isolation pair (`--strict-mcp-config` + `--setting-sources ''`) at the
single `run()` chokepoint. Do **not** add environment workarounds, do not bypass `run()`, and do not
introduce a second spawn path. If a spawn seems to need one, that is a finding to report, not to fix.

**H8 — Probes run sequentially, one process at a time.**
`~/.guidelane/probe.lock` enforces this. Concurrent engine sessions race on the same rate-limit
window and make a limit event indistinguishable from a failure. Never run two probe processes.

**H9 — If you hit a rate limit, STOP the cycle honestly.**
The orchestrator has **no rate-limit handling** — a limited phase exits non-zero and the loop
continues regardless. If your session sees `rate_limit_event` or repeated auth/quota failures, write
`## Cycle N decision: STOP — rate limited [verdict=…]` so the loop breaks instead of burning the rest
of the night on empty calls.

**H10 — Existing probe style is the template.** Read 2–3 neighbours in `tools/probe/probes.mjs`
before writing a new one (`p-init-receipt`, `p-ambient-isolation`, `p-hook-events-headless` are the
closest in shape). Match the existing structure, outcome constants, and evidence projection. Do not
invent a new probe framework.

---

## Next steps (priority order)

### 1. A2 — probe the stream `type`/`subtype` union and emit it as a versioned artifact

**Gap**: REVIEW-02 §3 A2. The cockpit's only deterministic plain-language guarantee is
whitelist-rendering, and the whitelist has no enumerated universe. The binary carries at least 28
system subtypes the plan never names (`compact_boundary`, `model_fallback`, `permission_denied`,
`request_user_dialog`, `error_max_turns`, …). An unhandled subtype in front of a non-coder is a blank
card or a crash.

**Known seed** (REVIEW-02 §13, one short session): `system/init`, `system/hook_started`,
`system/hook_response`, `system/hook_progress`, `system/thinking_tokens`, `assistant` (no subtype),
`rate_limit_event` (no subtype), `result/success`. That is a sample from one configuration, **not**
the union.

**Build**: a probe (suggested id `p-stream-surface-union`) that
(a) harvests every `type`/`subtype` pair observed across the captured streams the suite already
produces, and (b) writes them to a committed, versioned artifact
(suggest `tools/probe/stream-surface.json`) that the S1 adapter will compile its whitelist from.
Each pair carries a classification: `render | ignore | escalate`.

**Exit criterion**: an unclassified pair is **FAIL**, not a warning. The probe must fail today if you
delete a classification from the artifact — verify that by actually deleting one and re-running
(H4 Q1).

**Do not**: extract subtypes by asking the model. Static string extraction from the binary is
acceptable as an *agenda setter* only (PROJECT_MAP Principle 8: a binary string is evidence a code
path exists, not that it fires) — the artifact's authority is observed pairs.

---

### 2. A4 — probe `request_user_dialog` degradation

**Gap**: REVIEW-02 §3 A4. An interactive prompt inside a supposedly non-interactive session, and the
failure mode is **silent**. The binary states: *"The CLI treats ABSENCE as 'cannot display' and fails
closed: without the kind declared here, a dialog-gated flow degrades to its no-dialog behavior"*,
plus `parked request_user_dialog request_id=` and `Ignoring late request_user_dialog answer`.
Guidelane declares nothing, so an unknown set of engine flows silently degrade — invisible to every
happy-path probe.

**Build**: a probe (suggested id `p-request-user-dialog`) that
(a) enumerates the `dialog_kind` values present in the shipped binary,
(b) runs a dialog-gated flow declaring no kinds, and
(c) records whether the stream shows the request at all, or the flow simply degrades.
Capture parking and lateness semantics if they surface.

**Exit criterion**: every enumerated kind is mapped to either "cockpit renders it" or "accepted
degraded behaviour, written down". No unmapped kind. The mapping is a committed artifact, and an
unmapped kind fails the probe.

**Honest expectation**: this one may return a *negative* result — the engine may never emit the
request under our profile. A negative result written down with its evidence is a **pass**, and it
retires the blocker just as well. Do not manufacture a positive.

---

### 3. A6 — probe the thinking surface with partial messages on

**Gap**: REVIEW-02 §3 A6. Raw chain-of-thought is the most engineer-facing text that exists, and the
crew table routes builder/planner/security at `xhigh` and `max`. The in-engine rewrite net
(`MessageDisplay`) fires on assistant text, **not** thinking.

**Known partial answer** (REVIEW-02 §13): `system/thinking_tokens` carries `estimated_tokens` and
`estimated_tokens_delta` and **no text** — a live "still thinking" signal with nothing to leak.
Still open: whether a session configured for visible reasoning also emits content blocks
(`thinking_delta`, `signature_delta`, `redacted_thinking`), and what the feed does then.

**Build**: a probe (suggested id `p-thinking-surface`) making one live call with
`--include-partial-messages` at high effort, enumerating **every** content-block type and delta type
that actually appears.

**Exit criterion**: thinking is provably in the renderer's ignore set, asserted in CI rather than
assumed. Pin the expected set by name; a new block type is a failure, not a warning.

**Cost note**: `--include-partial-messages` is chatty. Keep the prompt trivial and the model cheap
(`--model haiku` is the suite default for live probes) — you are measuring the *wire format*, not the
model's reasoning quality.

---

### 4. A7 — probe whether hook failure is *detectable*

**Gap**: REVIEW-02 §3 A7. The binary emits `MessageDisplay hook failed for completed message;
emitting original text:` with the taxonomy `hook_success | hook_non_blocking_error |
hook_error_during_execution | hook_cancelled`. `prompt`-type hooks are themselves LLM calls — slow,
rate-limitable, failable — and every failure leaks unrewritten engineer text to a non-coder. This is
a secure-by-default violation (blindspot Q4) on the product's **core promise**.

ADR-008 already states the fail-open caveat. This probe decides whether it is **detectable**.

**Build**: a probe (suggested id `p-hook-failure-detectable`) using a fixture hook under
`tools/probe/fixtures/` that fails three ways: (a) exits non-zero, (b) exceeds its timeout,
(c) returns malformed JSON. For each: record whether the original (unrewritten) text is emitted, and
whether any `hook_*` attachment marks the message as degraded. Run with `--include-hook-events`
(that is how `p-hook-events-headless` already gets the hook frames — read it first).

**Exit criterion**: every failure mode produces a signal the cockpit can use to suppress or
quarantine the message — **or** the finding is that mechanism 4 is undetectable, mechanism 4 gets
demoted to best-effort in writing, and the deterministic whitelist becomes the sole guarantee. Both
outcomes close the blocker. Only "we didn't check" leaves it open.

---

### 5. S1-B — build the ~40-line throwaway reactive rig and run its hard gate

**Why this exists**: A1, A5 and A3b's backpressure half are **structurally unmeasurable** with the
current primitive. `spawnCapture` buffers everything, closes stdin immediately, and times out on
wall-clock rather than inter-event silence — so it cannot answer a control request, cannot be
cancelled, and cannot hold a stream open. This is recorded as S1 debt (task #17) and as a known
limitation in `CLAUDE.md` §8.

**Build**: a throwaway rig — target **~40 lines**, not a framework, not the future adapter — at
`tools/rig/reactive.mjs`. It must: spawn `claude` with `--input-format stream-json
--output-format stream-json --verbose`, keep **stdin open**, parse events line-by-line as they
arrive, and be able to **write a reply mid-stream**. Nothing else. Resist every urge to generalise
it; its whole purpose is to be cheap enough to throw away if the gate fails.

**HARD VALIDATION GATE — this is the success criterion, and it is binary:**
> The rig must observe an event mid-stream and write a reply that the engine **visibly acts on**.

"Visibly acts on" means a subsequent engine-emitted event demonstrably caused by the reply — not the
model saying it received something (H3). If you cannot demonstrate that, the gate **FAILS**.

**A failed gate is a legitimate, valuable outcome — report it as such.** It means A1's exit criterion
collapses to the cheaper form ("prove the engine never emits `control_request` under our session
profile, asserted every run") and S1 gets less expensive. Learning that from 40 lines instead of from
an adapter built on a guess is the entire point. Do **not** keep iterating past a reasonable attempt
to force a pass; write down what you tried, what the engine did, and stop.

**Record the verdict explicitly** in your `## Cycle N result` as one of:
`RIG GATE: PASSED` or `RIG GATE: FAILED` — items 6–8 branch on this exact string.

**Confidence going in**: ~62%. Novel mechanism, never attempted in this repo. If your session's
honest confidence after building is lower, say the number.

---

### 6. Branch on the rig gate — A1 (control channel)

**Read the most recent `RIG GATE:` line in this file before picking this item.**

**If `RIG GATE: PASSED`** → build the A1 probe on the rig. Two arms, per REVIEW-02 §3 A1:
(a) deliberately never answer a `control_request`, and measure whether the run terminates within a
bound; (b) answer correctly, and confirm progress. *Exit*: the adapter ships a responder **and** a
hard stall timeout, both specified from measured numbers. "Silence with no terminal event" must be
provably impossible before a feed goes in front of anyone.

**If `RIG GATE: FAILED`** → take the cheap form instead: a probe that asserts the engine **never
emits** a `control_request` under the ADR-007/008 session profile, on every run. This is a weaker but
honest exit criterion, and it is assertable on the existing harness. Write down in the probe's own
comment that it is the fallback form and why, so nobody later mistakes it for the full answer.

---

### 7. Branch on the rig gate — A5 (stall baseline + stdout backpressure)

**Read the most recent `RIG GATE:` line in this file before picking this item.**

**If `RIG GATE: PASSED`** → A5, per REVIEW-02 §3 A5. No engine-side timeout flag exists, so the
orchestrator's per-stage timeout is the **only** guardrail, and nobody has measured the maximum
*legitimate* inter-event silence. Run a session whose Bash tool sleeps ~120 s; record the max
inter-event gap and whether `tool_progress` reaches `-p` at all. Then stop draining stdout for 30 s
and check for the classic Node spawn deadlock (which presents to a user as a frozen feed).
*Exit*: a **measured** max-silence figure the stall timeout derives from, a documented backpressure
answer, and a rule for what the feed shows during legitimate silence.

**If `RIG GATE: FAILED`** → do **C7** instead (`--add-dir` scope semantics, REVIEW-02 §5 C7). It was
deliberately parked to ride along with this Tier A batch precisely so it costs no extra re-baseline.
Unknown: whether `--add-dir` grants write as well as read, whether the added root appears on the init
receipt (so the receipt can assert it per ADR-008), and how it composes with a fail-closed
`--allowedTools`. *Exit*: a two-root session writes to both and both appear on the receipt — or the
adapter copies files instead of adding roots.

---

### 8. Consolidate the night's measurements into the authoritative documents

Unconditional, and valuable regardless of how far items 1–7 got. **A measurement nobody writes down
gets re-measured** — that is why REVIEW-02 §13 exists.

- Append a dated addendum to `docs/research/REVIEW-02-runtime-gaps.md` recording every measurement
  taken tonight, including the negative results and the failed attempts. Follow the existing addendum
  style (§12, §13): what was measured, on which CLI version, what it changes.
- Update the disposition of each Tier A item you touched (§3 and §9).
- Add ledger rows to `PROJECT_MAP.md` §6 for anything left open, and move resolved rows to RESOLVED
  with the date.
- Do **not** rewrite `CLAUDE.md` §5 sprint state or close the sprint — the owner reviews first.
- Do **not** write an ADR unless a decision was genuinely made from measurement; a probe result is
  evidence, not automatically a decision.

If earlier cycles were cut short, say so plainly here rather than implying the batch is complete.

---

## Morning checklist for the owner (NOT for the orchestrator)

The night deliberately leaves these undone:

1. **Read every new probe before trusting it.** The recurring failure is inferred-instead-of-asserted,
   and an unattended session is the profile most likely to reproduce it. For each new probe ask
   Principle 9's three questions (H4).
2. **One full re-baseline**, supervised: `node tools/probe/run.mjs --live --update-baseline`
   (~25 min of quota, all new probes at once — this is why H1 forbids doing it per cycle).
3. **Then one push.** Not before — the repo is public and CI would go red on the drifted baseline.

---

## UI follow-ups for morning
(empty — Guidelane has no UI code yet; `apps/cockpit/` does not exist. Backend/harness work only.)

## Cycle history
(populated by orchestrator, newest first)
