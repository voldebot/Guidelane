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
unmeasurable with it — not hard, impossible. That is what makes the throwaway
reactive rig a gate rather than a task.

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

**Stage S1-A — Tier A items measurable on the existing harness (~80%)**
5. [ ] A4 `request_user_dialog` — verify: an engine-emitted field pinned against an expectation, never model prose
6. [ ] A7 hook fail-open detectability — verify: a deliberately failing hook is distinguishable from a hook that did not run
7. [ ] A6 residuals: `redacted_thinking`, and variation by model/effort — verify: observed pairs classified in the artifact
8. [ ] A2 residual (a): a free `observational` probe for artifact validity so CI gates it — verify: red artifact turns CI red on a push

**Stage S1-B — the throwaway reactive rig (~62%) — HARD GATE**
9. [ ] ~40-line rig with a live session handle — verify: **it observes an event mid-stream and writes a reply the engine visibly acts on.** If it cannot, stop and re-scope S1-C

**Stage S1-C — rig-dependent Tier A (~58%, blocked on stage S1-B)**
10. [ ] A1 control channel — verify: an unanswered `control_request` is distinguishable from a stall
11. [ ] A5 stall baseline + stdout backpressure — verify: a measured inter-event silence threshold, not a wall-clock guess
12. [ ] A3b does `is_error` survive backpressure — verify: denial detected under load, not only when idle

**Stage S1-D — the adapter and the cockpit (unestimated until S1-C lands)**
13. [ ] `packages/engine`: live session handle replacing `spawnCapture`, per-supervisor `SessionRegistry` — verify: the init receipt gate fails a phase in plain language before tokens are spent
14. [ ] `apps/cockpit`: whitelist renderer that **imports** `stream-surface.json` — verify: the classification column finally has a consumer, and `defaultForUnknown: escalate` is exercised

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

## 9. Sprint close summary (filled by /sprint-close)

- **Status**: {{ closed | abandoned | superseded }}
- **ADRs written**: {{ }}
- **PROJECT_MAP.md updates**: {{ }}
- **FILEMAP.md changes**: {{ }}
- **Memory updates**: {{ }}
- **Closed by**: {{ /sprint-close on DATE }}
