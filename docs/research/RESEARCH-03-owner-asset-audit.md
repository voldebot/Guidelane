# Owner Asset Audit — What Exists in ~/.claude and Where It Lands in Guidelane

**Date**: 2026-07-30
**Status**: complete — every skill, agent, hook, script, rule, and template read in full
**Purpose**: R2 requires Guidelane to be built from "WrongStack + my skills, hooks, agents."
This document inventories the owner's actual assets, evaluates each honestly, and
assigns each a destination in the Guidelane architecture (RESEARCH-02).

The headline finding up front: **the owner already runs a working prototype of
Guidelane's hardest feature.** `overnight-orchestrator.sh` is a phased, headless,
overnight autonomous loop over `claude -p` — exactly the Night Shift capability the
owner asked for — in real use since May 2026: **shape-proven, scale-unproven**
(two E2E tests with a trivial task; production-scale runs unvalidated, per the
owner's own notes — wording corrected 2026-07-30, REVIEW-01), with its failure
modes documented by the owner's own research. Guidelane's job is not to invent this; it is to productize
it and fix its three documented gaps with deterministic gates.

---

## 1. Inventory

### 1.1 Skills (7)

| Skill | What it does | Quality read |
|---|---|---|
| `sprint-close` | The quality-gate ritual: task check → `/review` → parallel specialist review + blindspot audit → lint+type zero-error gate → `/verify` in a real runtime → ADR detection → PROJECT_MAP update → memory update → honest Turkish summary | **The most valuable asset in the whole set.** This IS a production line, run manually per sprint. Guidelane's pipeline is this ritual, automated per phase |
| `blindspot-audit` | 7-question adversarial audit (adversarial input, consistency, partial failure, secure-by-default, idempotency, abstraction promise, race) by a context-isolated reviewer that does not know author intent | Mature; the isolation principle ("reviewer gets no author context") is architecture-grade |
| `loophole-loop` | Forced visible confidence calibration: restate plan → list assumptions → what-if-wrong per assumption → 3 fragile links → fixes → per-stage confidence → known-risks output | Mature; the output structure is a ready-made "decision card" format |
| `night-mode-pre` | Overnight prep wizard: pick project → STATUS.md task list → WIP commit → charger check → `pmset` disable sleep → launch orchestrator under `caffeinate` → "Kapağı kapat, iyi geceler" | Simple and user-shaped; the checklist (power, WIP commit, task list, recovery anchor) is exactly a Night Shift preflight |
| `sprint-start` | Sprint open: read PROJECT_MAP/ADRs/Do-Not-Revisit, surface blockers, scaffold research MD, TaskCreate breakdown | The "consult decisions before building" discipline; maps to pipeline Plan stage inputs |
| `scaffold-project` | Project bootstrap: 5 questions → constitution files → memory entry | Personal workflow; the *idea* (a project starts with a durable charter) maps to Guidelane's blueprint |
| `taste-skill` | Third-party (Leonxlnx, MIT, 35k★, 1,211 lines): anti-slop frontend design for landing/marketing pages — brief inference, three dials (variance/motion/density), hard bans (AI-purple, beige+brass, fake screenshots, eyebrow spam), canonical GSAP skeletons, ~60-item pre-flight checklist | Extremely dense, contextual by design. The "mechanical pre-flight check" idea (count eyebrows, verify contrast) is gate-shaped |

### 1.2 Agents (5 — all Opus/xhigh, all read-only advisory per the owner's hard boundary)

| Agent | Doctrine it carries |
|---|---|
| `backend-architect` | Separation of concerns (no fat controllers), early-return, validate-everything, standardized response envelope, REST semantics, cursor pagination, versioning day-1, idempotency keys on critical mutations, statelessness, TDD-leaning (contract test first, integration tests on a real DB) |
| `database-expert` | N+1 strictly forbidden, `EXPLAIN ANALYZE` before optimizing, `SELECT *` banned, connection pooling mandatory, index philosophy per clause, zero-downtime 3-step migrations, every `up` has a tested `down`, JSONB+GIN, "an untested backup is not a backup" |
| `frontend-specialist` | React 19.2+ modern patterns (no forwardRef, RSC default, `use()`/`useActionState`/`useOptimistic`), strict TS (`any` banned), a11y non-negotiable (semantic HTML, 44px targets, reduced-motion), compiler-aware perf, anti-div-soup |
| `security-pentester` | Zero-trust/assume-breach, OWASP API Top 10 (BOLA/IDOR hunting), JWT discipline (short expiry, `none` banned), secrets never hardcoded, severity-bucketed findings with remediation + post-fix validation command |
| `ui-ux-critic` | Evidence-based review: NN Group F-pattern/left bias, Fitts (44px), Hick (choice limits), thumb zones, banner blindness; anti-generic bans; structured verdict format |

**Honest note:** these prompts are aspirational doctrines, not verified behaviors —
they push the model toward good defaults but nothing enforces them. That is exactly
the persona-vs-process gap RESEARCH-02 §1 named. Their value to Guidelane is as
**content**: review-lens prompts and Atlas quality-standard corpus entries.

### 1.3 Hooks and scripts

| Asset | What it does | Engineering quality |
|---|---|---|
| `filemap-update.sh` (239 lines) | Regenerates `docs/FILEMAP.md` on every Write/Edit + SessionStart: TS/JS export extraction, mutex, atomic rename, **validation sampling** (keeps the previous map if >2/5 sampled symbols mismatch), self-edit guard, scope-gated to managed projects, never blocks Claude | Genuinely battle-hardened (absolute tool paths, NUL-safe pipeline, BSD-compatible). Its stated limits: regex-only, TS/JS-only |
| `pre-compact-instructions.sh` | Injects summarizer steering before every compaction: keep-verbatim list (decisions, ADR refs, file:line, confidence %, task state, user rules, Do-Not-Revisit), compress list, drop list, fixed summary structure | The owner's context-survival doctrine, encoded. Directly reusable |
| `pre-compact-backup.sh` / `post-compact-snapshot.sh` | Transcript backup (keep 20) + recovery snapshot with files-touched + layered recovery checklist + append-only compaction event log | Solid; the "recovery layers" doctrine transfers to Night Shift run logs |
| `overnight-orchestrator.sh` (265 lines) | **See §2 — analyzed separately** | Working, twice E2E-tested (haiku trivial); prod-scale unvalidated by owner's own admission |
| `night-mode` start/stop wrappers, `session-start.sh` (constitution check), `statusline.sh` | Operational glue | Personal; not ported |

### 1.4 Global rules (22 files) — the doctrine layer

Grouped by what they mean for Guidelane:

- **Already productized in RESEARCH-02**: `quality_gates` (sprint done = review+verify+memory → the gate line), `blindspot_audit` (→ G5), `incremental_foundations` (→ the staged line itself), `brutal_honesty` + `confidence_calibration` (→ honest-degradation UX + decision cards), `coding_discipline` Checklist 1 (→ Atlas impact maps §7.2), `lint_before_done` (→ G3), `agent_boundaries` (→ reviewer sessions are read-only by `--tools` scoping, enforced not promised), `no_half_work` (→ state machine cannot abandon a phase silently), `no_forgotten_decisions` (→ Atlas project ADR ledger §7.3).
- **Productized in this update (R9–R11)**: `language_policy` (→ the language dial, §8.3), `inline_mapping` + `maps_over_searches` (→ code maps, §7.6), `effort_level_strategy` (→ per-stage `--effort` mapping: scan/report=medium, audit/review=high, build=xhigh — the owner's measured 30–50% token saving), `autonomy_guardrails` (→ Night Shift decision-deferral policy + the fail-closed guard baseline, mirroring the settings.json deny list).
- **Stays personal**: `reference_codex_workspace` (~/.agent boundary), `project_inventory`, `user_profile`, `workflow_sprint_chain` (superseded by the pipeline for Guidelane's purposes).

### 1.5 Templates (7)

`ADR.template.md` (options → decision → consequences; **immutable once accepted, supersede-only**) and `FILEMAP.spec.md` (format spec: multi-language symbol table, exclusion rules, `@MAP` in-file headers for >200-line files, **never overwrite with a failed-validation map**) are directly adopted as Guidelane data-format specs. `CLAUDE/PROJECT_MAP/architecture/RESEARCH` templates stay personal; their roles are played by Guidelane's blueprint/plan/ADR artifacts.

### 1.6 settings.json — the enforcement layer

- `permissions.deny` — concrete fail-closed list (`rm -rf` variants, force-push, hard resets on shared branches, publishes, `.env` edit). **This is the baseline content for Guidelane's PreToolUse guard + `--disallowedTools`.**
- `enabledPlugins`: `frontend-design`, `security-guidance`, `rust-analyzer-lsp`, `swift-lsp` (official) — confirms plugin-based delivery is the owner's already-working distribution mechanism.
- `effortLevel: xhigh` persistent — matches the effort-strategy rule.

---

## 2. The crown jewel: overnight-orchestrator.sh → Night Shift

The owner asked for "start it, close the lid, it works through the night." Their own
May-2026 research concluded `/loop` (as of then) was unsafe for this — wake bug
(#50920), silent tool-result pruning (#42542), false-completion risk (#54682) — and
chose **phased headless**: a fresh `claude -p` session per phase, communicating only
through a STATUS.md ledger. Cycle = scan (pick exactly ONE item, no bundling) →
implement (+ parallel advisors + tests) → decide (verifier agent → CONTINUE/STOP),
then a Turkish morning briefing. Loop control is a grep for the STOP line.

That decision is exactly RESEARCH-02's architecture: fresh session per stage,
disk artifacts as the only memory, deterministic loop control outside the model.
Independently arriving at the same shape is strong validation.

The owner's reference doc lists the prototype's gaps. Each maps to a Guidelane fix:

| Documented gap (owner's own words, May 2026) | Night Shift fix |
|---|---|
| "Verification agent is LLM-based — can declare VERIFIED without actually verifying" | G3/G4 are machine gates: exit codes, boot checks, smoke tests, screenshots. The model's verdict is never load-bearing (RESEARCH-02 §2) |
| "Parallel-agent rule is PROMPT-enforced, not code-enforced. Model can ignore" | The orchestrator *spawns* the review sessions itself; participation is not the model's choice |
| "No GNU timeout on macOS → only budget caps runaway phases" | The engine adapter owns per-stage timeouts natively (process supervision in our own code) |
| STATUS.md is free-text; "Next steps not pruned"; state via grep | Structured artifact store + real state machine replace ledger-by-convention |
| Sleep management via manual `sudo pmset` + `caffeinate` wrapper | Run supervisor manages keep-awake itself; preflight checks power (adopting `night-mode-pre`'s checklist: charger, WIP snapshot, task list, recovery anchor) |
| No rate-limit handling (Max plan 5-hour windows can exhaust mid-night) | **New requirement**: detect limit-reached from the CLI, pause, auto-resume at window reset, and report what was hit in the morning report |

Directly adopted without change: fresh-session-per-phase; one-item-per-cycle
(no bundling — enforced by G2's "one testable outcome per phase" rule); per-phase
effort mapping; hard-rules-in-every-prompt (now also enforced below the prompt);
STOP-honesty over silent retry; the morning briefing (now the user-language morning
report); compaction counting as a run-health metric.

---

## 3. Full mapping table — every asset, its Guidelane destination

| Owner asset | Guidelane destination |
|---|---|
| `sprint-close` chain | The production line itself (G1–G6); its Step 2.75 lint gate = G3; Step 3 verify = G4; Step 2.5 specialist+blindspot = G5 |
| `blindspot-audit` 7 questions + isolation principle | G5 reviewer checklist + reviewer-session context isolation |
| `loophole-loop` output structure | G2 audit ammunition + the plain-language "decision card" format shown to users |
| `night-mode-pre` + `overnight-orchestrator.sh` + reference doc | **Night Shift mode** (RESEARCH-02 §8.2): preflight, run supervisor, cycle discipline, morning report; gaps fixed per §2 above |
| `feedback_effort_level_strategy` | Per-stage `--effort` mapping in the orchestrator's session profiles |
| 5 agent doctrines | (a) G5 review-lens role prompts, dispatched per changed-file domain in parallel (as sprint-close 2.5b does); (b) seeded into Atlas as `quality-standard` entries (N+1 ban, SELECT * ban, 3-step migrations, JWT rules, RSC defaults, a11y minimums, NN Group layout evidence). Read-only boundary preserved by `--tools` scoping — enforced, not promised |
| `taste-skill` (third-party MIT) | Design guidance pushed into Build sessions for public-page phases of the web template + frontend `quality-standard` entries; its mechanical pre-flight checks (eyebrow count, contrast, CTA wrap) become G5 design-lens checks. MIT notice carried in THIRD-PARTY-NOTICES.md |
| `filemap-update.sh` + `FILEMAP.spec.md` + `inline_mapping` + `maps_over_searches` | **Code maps** (RESEARCH-02 §7.6): Atlas graph indexer generates FILEMAP + `@MAP` headers from its tree-sitter symbol table (deterministic, multi-language — upgrades the regex/TS-only hook); the spec's validation rule ("never overwrite with a wrong map") kept verbatim |
| `pre-compact-instructions.sh` | Shipped in the Guidelane plugin for long build phases: preserve decisions/file:line/gate results verbatim through any compaction |
| compact backup/snapshot hooks | Superseded by artifact store + git snapshots; the layered-recovery doctrine adopted in run logs |
| settings.json deny list + `autonomy_guardrails` | Baseline for the fail-closed PreToolUse guard + `--disallowedTools`; hard-confirm list becomes the user-gate catalogue (G1, G6, and Night Shift's defer-to-morning set) |
| `language_policy` | The language dial (RESEARCH-02 §8.3) — the owner's own policy, productized per user |
| ADR template (immutable, supersede-only) | Atlas project decision ledger entry format (§7.3) |
| `scaffold-project` / `sprint-start` / PROJECT_MAP templates | Concept-level: blueprint = charter; Plan stage reads the decision ledger the way sprint-start reads PROJECT_MAP |
| `reference_codex_workspace`, `project_inventory`, `user_profile`, statusline, session-start | Stay personal — not product material (Codex touches Guidelane only via the `codex` engine adapter in S6) |

**Licence status:** everything above is the owner's own work except `taste-skill`
(MIT, notice required) and the WrongStack donations already covered in RESEARCH-01/02.

---

## 4. What this audit changes in the plan

1. **Night Shift is de-risked.** It was going to be designed from scratch; it now
   has a working ancestor plus a failure-mode list paid for by real use. Stage S3b
   (RESEARCH-02 §11) builds on known ground.
2. **Atlas's standards corpus has a seed content source.** The five agent doctrines
   + taste-skill + the discipline rules are ~30 quality-standard entries that
   already reflect the owner's taste — the "content is the biggest cost" problem
   (RESEARCH-02 §10) starts warm, not cold.
3. **The G5 review design inherits a proven shape**: per-domain lenses dispatched in
   parallel + a blindspot pass, exactly as sprint-close 2.5 runs today.
4. **Code maps get a spec, not just an idea**: FILEMAP.spec.md's format, exclusions,
   thresholds (>200 lines → `@MAP`), and validation rule are adopted as written.
