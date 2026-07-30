# REVIEW-01 — Independent Adversarial Plan Review: Findings and Dispositions

**Date**: 2026-07-30 (late)
**Reviewer**: independent agent (Fable, zero conversation context, read-only), given
RESEARCH-01..04 and ten adversarial challenges. It re-verified the load-bearing CLI
claims against the installed binaries before judging — the factual base held; the
findings are design- and judgment-level.
**Reviewer verdict**: **REVISE-FIRST**. Plan-as-written confidence **55%**; with the
Top-5 revisions applied, reviewer estimates **~75%**.
**Main-thread position after synthesis**: the review is substantially correct. All
five top findings are **accepted** (one with a modified remedy). Dispositions below
are ratified design deltas; items marked ⚖ need the owner's sign-off because they
touch an explicit owner directive.

---

## 1. Top-5 findings and dispositions

| # | Finding (severity) | Disposition |
|---|---|---|
| 1 | **PTY hedge, framed as the billing-split answer, is ToS circumvention** — a robot driving the interactive TUI to keep drawing subscription quota after a split would be exactly the adversarial pattern that got tools banned; "unambiguously first-party" was authorial overclaim. Also technically hand-waved (real cost: ANSI/TUI parsing, loses stream-json/json-schema/hooks; 3–6 weeks to fragile parity) | **ACCEPT.** PTY is repositioned as a *technical-availability* fallback only (flag/protocol removal), explicitly **not** a billing-split workaround. Billing-split contingency = Agent-SDK credit + honest in-product notice. RESEARCH-01 §3.3/§9.1 corrected. **New action: send Anthropic the same written inquiry as z.ai; both become S0/S1 exit criteria** |
| 2 | **Non-coder journey fails at step zero** — Node + terminal + `npx` + Max subscription prerequisites; the doctor can only run after npx already worked; desktop packaging scheduled last | **ACCEPT.** v1 pilot re-scoped honestly: **owner-installed on friends' machines** (a handful of people; in-person install is fine and true to R1). Double-clickable desktop package (Tauri shell bundling the runtime) **moves up from S7 to immediately after S4** as the gate for any distribution beyond the pilot circle. Audience stated on the tin: *non-coders who already pay for an AI coding subscription*. R16's "npx" claim corrected |
| 3 | **No-self-certification has two structural holes**: G2/G5 verdicts are load-bearing model claims; G3 unit tests are authored by the session they certify | **ACCEPT.** Rule restated precisely (RESEARCH-02 §2): *no claim is accepted from the session that produced the work; functional claims must be machine-verified; judgment claims come from isolated sessions and are blocking-with-caps, not proofs.* Acceptance-scenario-derived checks (authored at Plan by a different session) become the **independent functional net**; author-written unit tests count as lint-grade; builder edits to existing test files are flagged by the scope tripwire |
| 4 | **Schedule math 2–3× optimistic; the corpus — "largest non-code cost" — appears in no stage budget**; ten stages at mean ~72% confidence implies ~3 replans with zero buffer | **ACCEPT.** Separate **content track** with its own calendar (28 seed entries ≈ 7–14 days at an honest 2–4 entries/day; rate to be measured); 1.5–2× calendar buffer; re-plan checkpoints after S2 and S4; S2 re-based 5–7d, S5b re-based (and descoped, see §2); honest total: **2.5–4 months** of steady work, not ~35 stage-days |
| 5 | **Ungoverned CLI auto-update is an unlisted SPOF** hitting every user simultaneously; version-check-at-startup detects but does not protect | **ACCEPT.** Spawned sessions run with auto-update disabled in the child environment; Guidelane maintains a tested-version range with graceful "engine updated, checking compatibility" degradation; the S0 conformance probe becomes a **nightly CI job** against the latest CLI so breakage is found by the project, not by a friend at midnight |

## 2. The C8 scope cuts — accepted, modified, or owner-gated

The reviewer: "roughly a third of RESEARCH-02 is v2/v3 wearing v1 clothes."
Assessment: mostly right, but three cut candidates collide with explicit owner
directives and are therefore ⚖ owner decisions, with main-thread recommendations:

| Cut proposal | Disposition |
|---|---|
| Crew routing UI + presets + telemetry dashboard → config file only | ⚖ **MODIFY** — routing with recommendation badges is an explicit owner directive (R15). v1 keeps the **role table + one-click presets + per-role recommendation badges**; the *telemetry dashboard* becomes a simple per-run cost line in v1, full dashboard v1.1 |
| Second stack profile + deploy adapters → one Local/SQLite profile | ⚖ **ACCEPT (recommended)** — v1 = Local profile only. Vendor freedom (R12) is satisfied *more* strongly by local-only + eject guarantee; "Publishable" profile + adapters = v1.1. Needs owner sign-off since it narrows K3 |
| Proportionality machinery (5 classes) → 2 classes | **ACCEPT** — v1 ships `small` / `full` with the fail-closed rule (data/auth/doubt ⇒ full). The 5-class system is v2. The owner's token directive survives intact — this is *less* machinery, same guarantee |
| Offline docs mirror (200–600 MB + weekly refresh) → patterns tier (<20 MB) + crawl-and-cache | **ACCEPT (recommended for K3)** — R5c demands no server, not offline docs; the engine needs network anyway. Kills the refresh treadmill |
| S5b multi-language generality → TS-only (tsc + import graph) + FILEMAP/@MAP writer | ⚖ **ACCEPT for v1** — the per-language adapter interface is preserved so the "all languages" goal (owner directive) remains the architecture; v1 depth is TS because v1 *generates only TS*. Python/Go structural support lands when a profile needs it |
| Contract-change tripwire + anchor re-verification → defer | **ACCEPT** — in-template `tsc` already catches TS consumer breakage at G3; tripwire and anchor re-verify move to v1.1 with the graph maturity they need |
| Atlas-standalone ambition → don't shape v1 APIs | **ACCEPT** — v2 goal, noted |
| Local-model engines "ship regardless" → defer | **ACCEPT** — weak local models inside a gate-heavy line = constant gate failures; defer until a low-gate "playground" mode exists |
| Night Shift → keep, but auto-resume = pause + poll-retry-with-backoff (+ morning resume button); parsed reset timestamps are an optimization, not the mechanism | **ACCEPT** — R9 survives; the fragile parsing dependency goes. "Close the lid" honesty: the preflight performs the keep-awake step *with* the user (visible sudo step, exactly as the owner's own night-mode-pre does) or falls back to "plugged in, lid open" guidance |
| axe-core in G4: keep; taste-skill G5 checklist migration: defer | **ACCEPT** |

## 3. Remaining accepted fixes (from C1–C10 bodies)

- `--max-budget-usd` **demoted**: S0 tests it under subscription auth; the real
  guardrails story = per-stage timeouts + cycle caps + retry ceilings (RESEARCH-01
  §4.1 corrected).
- **Invariants are always pushed** — the tag-gating in RESEARCH-02 §13.6 /
  RESEARCH-04 §5 contradicted "always present"; proportionality now applies to
  impact maps and ground-truth digests only. (Corrected in both docs.)
- **Translation floor vs rewriter** distinction made explicit: the deterministic
  floor is *whitelist-rendering of structured events* (guarantees no jargon, at
  blandness cost); the LLM rewriter buys quality on top and is never the guarantee.
- **R7 numbering hole resolved**: R7 was the owner's session-scoped instruction to
  delete the old WrongStack memories — executed 2026-07-30, intentionally absent
  from the product matrix. Footnote added to RESEARCH-01 §2.
- RESEARCH-03 "battle-tested" → **"shape-proven, scale-unproven"** (the document's
  own §1.3 said so; the headline now matches).
- **G5 context wording aligned**: reviewer receives diff + blueprint + impact map.
- **Day-mode rate-limit pause UX** added (same pause/backoff + expectation copy as
  night mode — a friend's first build stalling silently is a churn event).
- **Post-Ready lifecycle defined for the Local profile**: Ready = packaged local
  build + menu-bar/auto-start launcher, so "where is my app when Guidelane is
  closed?" has an answer.
- **G1 anti-rubber-stamp**: blueprint approval highlights the top-3 riskiest
  assumptions; approval is an act, not a click.
- **Positioning honesty (C9)**: a one-page competitive note is owed — Lovable/Bolt
  class builders own "describe → hosted app in minutes"; Guidelane's real niche is
  *local-first, quality-gated, zero-marginal-cost building for people already paying
  for AI subscriptions* — plus a "vendor moves" scenario: if Anthropic ships a
  consumer builder, the cockpit lane dies but the behaviour pack + Atlas survive as
  plugin/MCP (the §13.7 dual surface is the survival strategy).
- **Compliance posture doc** for Night Shift (respect limits, no retry-hammering,
  no multi-account rotation) — written and enforced in the supervisor.

## 4. Revised confidence

- Reviewer: 55% as-written → ~75% with Top-5 applied.
- Main thread, with all dispositions above ratified: **~74%** for v1 reaching its
  stated test (a few non-coders — installed by the owner — independently building
  something real) within the *revised* (buffered) calendar. The remaining spread is
  still the three empirical unknowns (gate-ceremony tolerance, funnel-after-pilot,
  Anthropic policy).

## 5. What changes on disk now vs at scaffold

Corrected immediately (dangerous if left): RESEARCH-01 §2/§3.3/§4.1/§9.1;
RESEARCH-02 §2 + §13.6 banner-level notes; RESEARCH-03 headline; RESEARCH-04 §5.
Everything else in this document is a **ratified delta** applied when the project
constitution is scaffolded (stage plan re-base, content track, packaging pull-up),
so RESEARCH-02 isn't rewritten twice in one night.
