---
sprint: "01"
slug: "cockpit-engine-adapter"
opened: "2026-07-31"
status: "open"
---

# Sprint 01 — Cockpit + engine adapter

> One sprint = one feature/initiative from research to delivery. This document lives at `docs/research/sprint-01-cockpit-engine-adapter/RESEARCH.md` until sprint close, then stays as the archived record.
>
> **Numbering note**: the project has called this sprint **S1** since 2026-07-31 (`CLAUDE.md` §5); S0 closed before this folder convention existed and has no folder. `sprint-01` is chosen to match the project's own S-number rather than to start a second numbering scheme. S0's record is `docs/research/S0-conformance-report.md` + ADR-007/008.

## 1. The ask (verbatim user request)

> `/sprint-start` — invoked with no slug. On being told S1 was already open with
> unreviewed overnight work on `s1-night-01`, the owner chose:
> **"S1'i resmen scaffold et"** (formalise the already-open S1 rather than open a
> new sprint number) and **"Önce review + push et"** (verify the night run, run a
> full live re-baseline, remove the overnight guard, and land the branch before
> the sprint is scaffolded).

The sprint's substance is unchanged from `CLAUDE.md` §5: **a localhost cockpit
that spawns one engine session on the ADR-007/008 contract**, gated on answering
the REVIEW-02 Tier A runtime unknowns first.

## 2. What we already know (from PROJECT_MAP.md)

Cross-references read at sprint open. Update if your understanding shifts during research.

**Relevant Active Decisions** (PROJECT_MAP §4):

- **ADR-001** — engine is the official `claude` CLI as a subprocess under the user's own login. Zero credentials. PTY is a technical fallback, never a billing workaround. *Constrains: the adapter may not authenticate, and the live conformance tier can only run where a human is signed in.*
- **ADR-002** — gated production line, no self-certification, three verification grades. *Constrains: nothing the cockpit displays as "done" may come from the session that did the work.*
- **ADR-006** — language dial: user-facing in the user's language, everything internal English. *Now known to be at risk — see §3.*
- **ADR-007** — headless engine contract, measured: `--permission-mode auto` **plus** an explicit per-stage `--allowedTools`; Atlas via `--mcp-config`; Night Shift sleeps to `rate_limit_event.resetsAt`.
- **ADR-008** — session isolation (`--strict-mcp-config` + `--setting-sources ''` on every spawn) and the `system/init` receipt asserted as a pre-flight gate. Plus the amendment: a **built-in floor** survives every flag (16 skills, 5 agents), so stage allow-lists withhold `Task`/`Skill` unless a stage deliberately needs them. And the §2 correction: **registration is not reachability**.

**Touched Domain contexts** (PROJECT_MAP §3):

| Context | Status | What this sprint does to it |
|---|---|---|
| Engine adapter (`packages/engine/`) | active (design) — no code | Created this sprint. Seeded by `tools/probe/lib/runner.mjs` spawn patterns |
| Cockpit (`apps/cockpit/`) | active (design) — no code | Created this sprint, but **not before Tier A answers** |
| Conformance probe (`tools/probe/`) | **active (built)** | Extended with the Tier A protocol probes; it is the only running code in the repo |
| Orchestrator, Atlas, Behaviour pack, local-web profile | active (design) | **Untouched.** Named here so scope creep is visible |

**Do-Not-Revisit checks** (PROJECT_MAP §5) — the entries this sprint could walk into:

- *`--permission-mode auto` alone* → replaced by `auto` + explicit per-stage `--allowedTools`. **Trigger not met.** The adapter must carry an allow-list per spawn; `auto` alone denies silently and the model may still claim success.
- *`--strict-mcp-config` alone as isolation* → replaced by the isolation pair. **Trigger not met.** Both flags, every spawn, applied at the single chokepoint — not typed per call site (14 of 19 spawns were missing one when it was a convention).
- *Treating `system/init` as telemetry* → replaced by init-as-gate. **Trigger not met.**
- *Gating the receipt on `mcp_servers[].status === 'connected'`* → replaced by gating on registration + calling a cheap Atlas tool. **Trigger not met.** The stricter-sounding gate was the flakier one.
- *Reading MCP inventory from `init.tools`* → **Trigger not met.** `init.tools` never carries an `mcp__` name.
- *Asserting on model output* → **Trigger not met, and this is the suite's central rule.** Three probes did it; all three were wrong.
- *A relative assertion ("better than before")* → replaced by equality against a pinned expectation. **Trigger not met.**
- *`/loop`-style single growing session for overnight runs* → replaced by phased headless, fresh session per phase. **Trigger not met** — and the S1 night run is a live reminder of why.

**Open questions this sprint may answer** (PROJECT_MAP §6):

- **Tier A — the 7 runtime unknowns that can stall the feed.** The sprint's gating item. Four of the seven can produce "the feed silently stops", the worst outcome in front of a non-coder.
- **What `total_cost_usd` actually is under subscription auth** (REVIEW-02 C3). Until answered, the cockpit shows token counts or a labelled figure — never a bare dollar amount.
- **Harness module boundaries will not survive extraction into `packages/engine`** — three named issues: `LIVE_CHILDREN` is a process-wide singleton (Night Shift needs a per-supervisor `SessionRegistry`); `audit` is shared mutable state; `spawnCapture` names two different functions depending on the importing module.
- **Auto-mode classifier drift across machines** — measured identical here, unknown on a friend's laptop; becomes a G0 doctor check.

## 3. Research findings

### A — Where S1 actually stands (measured, 2026-07-31)

The night run's cycle 1 shipped `p-stream-surface-union` and the
`tools/probe/stream-surface.json` artifact. The owner review pass verified all
three of its findings and found the artifact **unimplementable as written**.
Full record: [REVIEW-02 §15](../REVIEW-02-runtime-gaps.md).

- **A2 (stream type/subtype union)** — partly answered. The universe of one
  maximally verbose configuration is enumerated, classified and drift-gated.
  Residuals: the probe is a `fixture-call` so **CI never runs it**, and the
  classification column has **no consumer** until `apps/cockpit/` exists.
- **A6 (thinking deltas)** — central question answered, and the answer is bad for
  the product. Content-bearing thinking blocks reach `-p` stream-json by default
  on haiku with no reasoning flag. Measured as a same-run controlled differential:
  the `MessageDisplay` rewrite replaced the assistant **text** block while the
  **thinking** block passed through with 129 characters of original reasoning
  untouched. **ADR-006's language dial is implemented by that rewrite**, so
  thinking bypasses the dial entirely.
- **Still fully open**: A1 (control channel), A3b (does `is_error` survive
  backpressure), A4 (`request_user_dialog`), A5 (stall baseline + stdout
  backpressure), A7 (hook fail-open detectability).

### B — The one lesson S0 exported, and its 23rd instance

*The harness inferred where it should have asserted, and every inference failed
open.* Found 22 times across three S0 review passes. The 23rd was found by the
night run's own quality gate, **inside the helper written to prevent leaks**:
`publishablePair` published `mcp__plugin_<client>_<server>__<tool>` verbatim
because underscores are inside its "safe" character class. Fixed this pass.

Three tests before shipping any guard (PROJECT_MAP Principle 9): **can it fire?**
· **is it a constraint or a convention?** · **does it have a pinned expectation?**

### C — Why S1 is split by dependency, not into equal parts

`spawnCapture` buffers everything, closes stdin immediately, and times out on
wall-clock. A1, A5 and A3b's backpressure half are therefore **structurally**
unmeasurable with it — not hard, impossible. That is what makes the reactive rig
a gate rather than a task.

### D — The S1-B gate was measured before the plan was committed to (2026-07-31)

A `/loophole-loop` pass tested the plan's most expensive assumption instead of
honouring it. **30 lines, one engine call, and the gate passed.**

Spawned `-p --input-format stream-json --output-format stream-json` under the
isolation pair, wrote one message, and **deliberately did not close stdin**.
On observing `result #1` the harness wrote a *second* message in reaction to it.
The engine consumed it and answered with the marker that appears nowhere in the
first turn:

```
  +3206ms  result #1  subtype=success
  +3206ms  >>> wrote message 2 in reaction to result #1
  +9177ms  assistant: "RIG_SECOND_OK"
  +9326ms  result #2  subtype=success
```

So the S1-B exit criterion — *observe an event mid-stream and write a reply the
engine visibly acts on* — is **already satisfied**, and A1/A5/A3b are reachable
far sooner than the dependency split assumed.

**The unasked-for finding, which matters more.** After `result #2` the process
**did not exit**. It sat there until a 90-second timeout killed it (exit `null`,
SIGKILL). With stdin held open, `result` is a **per-turn** event, not a session
terminal event. Consequences the plan had not named:

- an adapter that waits for process exit after `result` **hangs forever** — which
  is precisely the "the run goes silent with no terminal event" class REVIEW-02
  Tier A exists to prevent, produced accidentally in 30 lines;
- an adapter that treats `result` as session-end while stdin is open **leaks a
  live engine process**, and `tools/probe/lib/runner.mjs`'s process-group kill is
  the only thing that has ever cleaned those up;
- phase lifecycle therefore needs an **explicit terminator** (close stdin, or a
  documented control message). Which one is correct is unmeasured.

Corollary for S2: two turns ran on one session, so the "fresh-session cost
premium vs long session" benchmark has a working mechanism ahead of schedule.

## 4. Options considered

Carried from the S1 decomposition already ratified in `CLAUDE.md` §5; recorded
here so the reasoning is in the sprint's own record.

### Option A — Build the adapter first, measure Tier A against it
- **What**: write `packages/engine` on the ADR-007/008 contract, discover the runtime protocol while building.
- **Pros**: one artifact instead of two; no throwaway code.
- **Cons**: the adapter's control-channel design would be a **guess**, and A1's answer could invalidate it wholesale. REVIEW-02's verdict is that the S0 suite "would pass green on a machine where S1's activity feed is unrenderable" — building on that is building on the thing already identified as unmeasured.
- **Cost / risk**: high. A wrong guess is discovered after the adapter has consumers.

### Option B — Answer Tier A first, in dependency order (**chosen**)
- **What**: S1-A (no new mechanism) → S1-B (~40-line throwaway reactive rig, hard gate) → S1-C (rig-dependent).
- **Pros**: each stage has a named validation gate; the rig costs 40 lines to falsify a design assumption that would otherwise cost an adapter.
- **Cons**: the rig is genuinely throwaway; two of seven Tier A items may come back "the engine never asks", making some of the work retroactively unnecessary.
- **Cost / risk**: moderate. Confidence is honest and uneven — see §6.

## 5. Chosen approach + rationale

**Chosen**: Option B — Tier A by dependency, then the adapter, then the cockpit.

**Why over the other**:
- The failure mode being avoided is *specific and named*: four Tier A unknowns can make a run go silent with no terminal event. A silent feed in front of a non-coder is the product's worst outcome, and it is invisible during development because the pair simply never appeared on the machine where the whitelist was written.
- The rig's hard gate converts an unknown into a decision either way: if it cannot observe an event mid-stream and write a reply the engine acts on, A1's exit criterion becomes *"prove the engine never asks"* and S1 gets cheaper. Learning that from 40 lines beats learning it from an adapter.

**Trade-offs accepted**:
- The reactive rig is thrown away by design.
- `p-stream-surface-union` stays outside CI this sprint unless residual (a) is picked up — the artifact's validity is gated only by local `--live` runs.
- The classification column stays unconsumed until `apps/cockpit/` exists. The universe is asserted; obedience is not.

## 6. Implementation plan

Atomic steps; each maps to a TaskCreate entry. Confidence is stated per stage per
the constitution's calibration rule, and it is deliberately uneven.

**Stage 0 — land the night run (DONE this session)**
1. [x] Verify the three cycle-1 findings independently — verify: measured, not read off the orchestrator's morning claim
2. [x] Fix instance 23 in `publishablePair` — verify: falsified against all five leaky shapes
3. [x] Fix the value-conditional schema flaw (schemaVersion 2 + `defaultForUnknown`) — verify: all five new guards falsified, then restored to green
4. [ ] Full `--live --update-baseline`, remove the overnight guard, land the branch — verify: exit 0, CI green after push

> **Revised by the `/loophole-loop` pass of 2026-07-31.** The original split was
> S1-A (~80%) → S1-B (~62%) → S1-C (~58%). Two of those numbers were wrong.
> S1-B's gate was measured and passed (§3 D), and S1-A's 80% was an **average
> hiding two items whose measurability is itself the unknown**. Both corrected
> below rather than left as a sound-looking number.

**Stage S1-A0 — the two items whose mechanism is already known (88%) — DONE**
*Batched into ONE `--live --update-baseline`, as planned: each new probe costs
~25 min and ~18 real calls, so adding them one at a time costs four re-baselines.*
5. [x] A7 hook fail-open detectability → `p-hook-failure-detectable`, 4 arms pinned by equality. **Answered, and the answer is bad in one mode**: a hook emitting a malformed payload with exit 0 is reported `outcome: "success"` — REVIEW-02 §16. Falsified twice; the first falsification attempt was itself broken (`join()` normalised the `..` away) and had to be redone, which is why the guard is now known to fire rather than assumed to
6. [x] A2 residual (a) → `p-stream-surface-artifact` (`observational`, free, CI-gated). Validator **extracted and shared** with the live probe rather than copied. Falsified eight ways; the ninth passed correctly and exposed that shape validation cannot see a bad *classification*, so `thinking`/`thinking_delta`/`signature_delta` are now pinned to `ignore` in code

**Stage S1-A1 — a measurability spike, NOT a probe (50% both measurable · 90% the spike answers decisively)**
*Written as a spike because I cannot name a headless trigger for either. Answer
"can this be triggered at all?" in ~30 minutes before committing probe code.*
7. [x] A4 → **the engine never asks.** All four permission modes deny structurally with zero dialog/control frames; `manual` is indistinguishable from `auto`. Became `p-no-headless-dialog`, pinned so the absence is only read after the decision point is *proven* reached. **A4 CLOSED** — Night Shift needs no control-channel responder
8. [x] A6 → **effort does not change the surface, the model does.** Five effort levels produce the same three thinking types on haiku; `--model sonnet` produced **none at all**. `redacted_thinking` did not appear in seven arms and is **recorded as unreachable by this method rather than probed** — the right outcome for a spike, and the one a probe-first approach would have turned into decoration. **A6 CLOSED**

**Tier A scoreboard after S1-A**: A2 partly answered · **A4 CLOSED** · **A6 CLOSED** · **A7 ANSWERED**. Remaining: A1, A3b, A5 — all in S1-C, all now unblocked by the measured session handle.

**Stage S1-B — the reactive session handle (95%) — GATE ALREADY PASSED**
9. [ ] Keep the 30-line feasibility harness (§3 D) as the **measurement rig for S1-C**, not as product code yet.

> **Correction to this plan's own first revision.** The `/loophole-loop` revision
> said "promote it into `packages/engine`" here *and* listed the same work in
> S1-D — the same code in two stages. Worse, building the adapter before A1/A5/A3b
> are measured is precisely the mistake the dependency split exists to prevent:
> the lifecycle terminator (step 13) is still unmeasured, and it is an adapter
> design input. So the rig stays a rig through S1-C, and `packages/engine` is
> built once, in S1-D, on measured facts. What was right in the revision stands:
> it is **not throwaway**, and it gets a design review rather than an imagined
> deletion.

**Stage S1-C — rig-dependent Tier A (72%, unblocked earlier than planned)**
10. [ ] A1 control channel — **already mostly answered as a side effect**: across ~12 sessions in the S1-A spikes (four permission modes, hook-failure arms, thinking arms) **no `control_request` frame has ever been emitted**, and A4 closed on the same evidence. What remains is narrow: confirm the engine never *initiates* one under a deliberately adversarial setup, at which point the REVIEW-02 §3 A1-vs-A2 subtype contradiction becomes **moot for the orchestrator** — you cannot mis-route a frame that is never sent. Verify: an adversarial arm that reaches a decision point and still emits nothing
11. [x] A5 → **the engine BLOCKS, it does not drop.** stdout undrained 55 s → a 99–122 KB burst against a 65,536-byte pipe with 83–135 KB still following: blocked with data queued, alive not finished. Stall baseline measured: p50 207 ms / p95 385 ms / max 1,227 ms. **A5 CLOSED**
12. [x] A3b → **`tool_result.is_error` is LOSSLESS under pressure.** 526/526 lines parsed, 0 damaged, denial and terminal both survived. Vindicates A3a's detector choice. **A3b CLOSED**

> **The measurement had to be redone.** The first attempt paused stdout for 20 s,
> saw a complete stream, and concluded "lossless" — without ever proving the
> buffers had filled. That is a confident claim about a session that may never
> have experienced backpressure, i.e. `p-autoupdate-governable` again. The proof
> that made it real: a burst larger than one pipe buffer can only mean the writer
> was blocked with data queued.

**Design consequence for S1-D, not in any table**: because the engine blocks, a
slow cockpit loses nothing but **stalls the engine**, and the stream goes
legitimately silent. An inter-event stall watchdog must not fire when the
consumer is itself the cause — knowable, since the consumer is us.

**Tier A COMPLETE**: A1 · A3b · A4 · A5 · A6 · A7 all closed or answered; A2
partly answered and CI-gated. The blocker list that gated S1's feed is done.

**Stage S1-D — the adapter and the cockpit (45%)**
13. [x] **Phase lifecycle terminator** → **`stdin.end()`, measured** (REVIEW-02 §19). Exit 0 in ~530 ms after the close, and the same latency whether the close comes immediately or 10 s later — so it is the close that terminates, not a timer. Never closing → alive at 75 s. **And 6,243 bytes arrive AFTER the close**, so a closer that stops reading truncates the output. Pinned by `p-phase-terminator`

> **The adapter lifecycle this settles, in four lines** — the reason this had to
> come before `packages/engine` rather than after:
> 1. keep stdin **open** for multi-turn work;
> 2. `stdin.end()` on the final turn's `result`;
> 3. **keep draining stdout until the process `close` event** (~0.5 s);
> 4. **no exit within a bounded window after closing stdin = the real stall
>    signal** — and the inter-event silence watchdog must not fire while the
>    consumer is itself the cause (§18).
14. [ ] `packages/engine`: session handle replacing `spawnCapture`, per-supervisor `SessionRegistry` — verify: the init receipt gate fails a phase in plain language before tokens are spent
15. [ ] `apps/cockpit` **first commit imports `stream-surface.json`** — verify: `defaultForUnknown: escalate` is exercised by a test. Until this lands, that key is a pinned decision with no consumer, which is decoration by this repo's own definition

## 7. Quality gates for this sprint

Beyond the global gates (`~/.claude/CLAUDE.md` §6):

- [ ] `/review` on the diff, plus `/blindspot-audit` — the sprint touches env handling and a public artifact boundary
- [ ] `node tools/probe/run.mjs --live` green before any claim about engine behaviour
- [ ] **Every new guard passes Principle 9** — can it fire? constraint or convention? pinned expectation? Falsify it in place before trusting it
- [ ] **No probe asserts on model output.** Engine-emitted fields only
- [ ] Anything written to `docs/research/` goes through `lib/redact.mjs`
- [ ] `/verify` in a browser once `apps/cockpit` renders anything

## 8. Open questions discovered during research

Add to PROJECT_MAP §6 at sprint close if not resolved.

- **The language dial does not cover thinking content.** ADR-006 is implemented by the `MessageDisplay` rewrite, and that rewrite provably does not touch thinking blocks. This is not a renderer detail — it is a gap in an accepted ADR, and it needs either an ADR-006 amendment or a stated cockpit-side rule.
- **`rate_limit_info` carries three fields ADR-007's recorded contract does not mention**: `overageStatus`, `overageDisabledReason`, `isUsingOverage`. Measured on a healthy session. Harmless today; ADR-007's contract is now known to be incomplete rather than wrong.
- **Only `rate_limit_info.status = "allowed"` has ever been observed.** The pause branch — the one Night Shift exists for — is still unmeasured and handled defensively.
- **`system/status` value set is enumerated to exactly one value** (`requesting`). `unknown: escalate` covers the rest, which is a safe default, not knowledge.
- **A `-p` session with stdin held open never exits, and `result` is per-turn.** Measured (§3 D). The phase lifecycle needs an explicit terminator and nobody has measured which one is correct — close stdin, or a control message. This is a Tier-A-class hazard that REVIEW-02 did not list.
- **`defaultForUnknown: escalate` has no consumer and therefore protects nothing today.** It is a pinned decision in a JSON file that no code reads. Named here because "a guard that cannot fire is decoration" is this repo's own rule and this one is mine.
- **The `--live` re-baseline cost is a planning constraint, not a footnote**: ~25 minutes and ~18 real engine calls on the owner's subscription per new probe, unless probes are batched.
- **The orchestrator must validate hook stdout itself.** Measured (REVIEW-02 §16): a hook that emits an unparseable payload and exits 0 is reported `outcome: "success"`. Since ADR-006's dial is a `MessageDisplay` hook, "the engine said success" is not evidence the dial ran. Nothing in the codebase does this validation yet.
- **Shape validation cannot see a wrong decision.** `p-stream-surface-artifact` proves the artifact is well-formed, and a well-formed artifact can still classify raw chain-of-thought as `render`. Exactly one classification is pinned in code against that; every other class remains an unguarded judgement call, by design.

## 9. Sprint close summary (filled by /sprint-close)

- **Status**: {{ closed | abandoned | superseded }}
- **ADRs written**: {{ }}
- **PROJECT_MAP.md updates**: {{ }}
- **FILEMAP.md changes**: {{ }}
- **Memory updates**: {{ }}
- **Closed by**: {{ /sprint-close on DATE }}
