# Guidelane as a Real Product — The Gated Production Line

**Date**: 2026-07-30
**Status**: proposal for ratification — becomes ADR-0001 when the project constitution is scaffolded
**Relation to RESEARCH-01**: the engine choice, the ToS evidence chain, Atlas, and the plugin design all remain in force. This document **supersedes RESEARCH-01 Part D (scale) and Part E (stages)** where they differ, because the self-review below found the earlier architecture incomplete.
**Additions of 2026-07-30 (same day, after the owner asset audit — RESEARCH-03)**: §7.6 code maps (R11), §8.2 Night Shift unattended operation (R9), §8.3 the language dial (R10), plus provenance/scale/stage/risk updates flowing from them.
**⚠ Independent review, 2026-07-30 late (REVIEW-01)**: an adversarial zero-context reviewer returned **REVISE-FIRST** (55% as-written → ~75% with revisions). All Top-5 findings accepted; dispositions and ratified deltas live in `REVIEW-01-independent-findings.md`. Where this document conflicts with REVIEW-01, **REVIEW-01 wins** — notably: v1 scope cuts (§13 items), stage estimates in §11 superseded by REVIEW-01 §1 #4 (buffered, 2.5–4 months honest calendar, separate content track), v1 pilot distribution = owner-installed with the desktop package pulled up to post-S4.

> The owner's requirement, restated precisely: Guidelane must not be a chat
> wrapper where the model works however it feels like. It must be a controlled
> production system — the model supplies the *thinking and the content*; the
> *process, the order, and the quality bars* are enforced by Guidelane's own
> code, the way WrongStack's pipeline and ClaudeQB's gated phases do — but with
> zero terms-of-service violation. WrongStack's structure, without WrongStack's
> auth.

---

## 1. Self-review of RESEARCH-01 — four honest findings

The owner asked me to review my own plan. Here is what it gets wrong, stated
plainly.

**F1 — It confused persona with process.** RESEARCH-01 §4.3 stacks five
mechanisms to control how the model *sounds* (no jargon, plain language). None
of them control what the model *does*. Nothing prevented it from skipping
verification, under-asking at intake, drifting mid-task, or declaring victory
early. For engineers that is survivable — they read the diff. For non-coders it
is fatal, because they cannot tell confident garbage from a working product.
The audience makes process enforcement the core feature, not an enhancement.

**F2 — "Done" was model-asserted.** No mechanism in RESEARCH-01 checked the
model's claim that something works. Even the Stage-1 validation gate ("a friend
gets a working result") relied on the model's own word for "working." That is
exactly the failure mode the owner is pointing at.

**F3 — No session lifecycle policy.** One long conversation accumulates drift:
stale assumptions, forgotten constraints, context bloat. ClaudeQB's antidote —
fresh session per phase, fed a durable handoff document, producing a durable
artifact — was *reviewed* in RESEARCH-01 §4.5 and then never actually adopted
into the architecture.

**F4 — The orchestrator was missing from the component inventory.** WrongStack's
most valuable structure — Pipeline, RunController, kanban lifecycle, Chimera
auto-review — was listed as donor material, and then no component in Part D
actually received it. The heart of the donated architecture had nowhere to live.

Everything below exists to close these four gaps.

---

## 2. Core thesis: process is code, content is model

Guidelane is a **production line**. A project moves through fixed stations, and
between stations stand **gates that the model cannot open**. The division of
authority is absolute:

| Decided by Guidelane code (deterministic) | Decided by the model (intelligent) |
|---|---|
| Which stage the project is in, and when it advances | What questions to ask the user at intake |
| Which gates run, and their pass criteria (exit codes, schema validation, explicit user action) | The content of the blueprint and the plan |
| Session lifecycle: every stage gets a fresh engine session with a defined context package | The code itself, and how to fix a failing gate |
| Which tools each stage may use; its budget ceiling; its retry cap | How to explain things to the user (through the translation layer) |
| Whether "done" is accepted — never by model assertion | What to try next when an approach fails |

**The no-self-certification rule** (restated precisely on 2026-07-30 after the
independent review caught the original phrasing overclaiming — REVIEW-01 #3):
*no claim is accepted from the session that produced the work.* Three grades of
verification, by claim type: **functional claims are machine-verified** — "tests
pass" means Guidelane ran them and read the exit code; "the app works" means
Guidelane booted it and captured the screenshot. **Judgment claims** (plan
quality, review findings) come from **isolated second sessions** — these are
blocking-with-caps, and they are honest *checks*, not proofs: a second model can
still be wrong, which is why they gate alongside, never instead of, the machine
gates. **Test-authorship is graded too**: unit tests written by the builder
session count as lint-grade only; the independent functional net is the
acceptance-scenario checks authored at Plan by a *different* session, plus the
template's own smoke suite. Builder edits to existing test files are flagged by
the scope tripwire for the reviewer.

This is the productized version of two rules the owner already lives by:
brutal honesty (claims require evidence) and the blindspot audit (authors
cannot review themselves).

---

## 3. The production line

Seven stations. Each has a purpose, a fresh engine session profile, a durable
artifact written to disk, and an exit gate.

```
 IDEA        BLUEPRINT      PLAN         BUILD          VERIFY       REVIEW       READY
  │              │            │       (per phase)          │            │            │
  ▼              ▼            ▼            ▼               ▼            ▼            ▼
intake      product spec  phased plan  code + notes   running app   findings    accepted
interview   (plain lang)  (milestones)  per phase     + evidence    + fixes     snapshot
  │              │            │            │               │            │            │
  └── G1 ────────┴─── G2 ────┴─── G3 ─────┴──── G4 ───────┴─── G5 ─────┴─── G6 ─────┘
      user +         plan        machine        machine        second       user
      schema         audit       harness        boot+smoke     session      acceptance
```

User-facing kanban labels (product copy, Turkish-first):
**Fikir → Tarif → Plan → Yapım → Kontrol → Hazır**. A non-coder understands a
card moving right across a board; that *is* the product's mental model.

| Stage | Engine session gets | Durable artifact (on disk, canonical) |
|---|---|---|
| **Intake** | Interviewer agent + persona; product questions only | `project/blueprint-draft.json` |
| **Blueprint** | Draft + completeness-critic pass | `project/blueprint.md` (+ `.json`, schema-valid) |
| **Plan** | Blueprint + template docs + Atlas | `project/plan.md` — phases, each with a testable outcome |
| **Build** (×N phases) | Plan + phase handoff + pushed Atlas slice (ADR digest, house rules, impact map) + failure logs if retrying | code, commits, `project/phases/NN-report.md` |
| **Verify** | — (no session; Guidelane runs it) | screenshots, smoke results, boot log |
| **Review** | Diff + blueprint ONLY — no author context | `project/review/findings.json` |
| **Ready** | — | tagged git snapshot |

Session policy (closes F3): every stage spawns a **fresh** engine session. It
receives a defined context package — role prompt, stage instructions, the
relevant artifacts, Atlas, template docs — and **never the chat history**. The
artifacts on disk are the project's memory; sessions are disposable workers.
This is CodexQB's ledger pattern promoted to the architecture's backbone. It
also means a friend can close the laptop for a week and resume exactly where
they left off — state lives in files and git, not in a conversation.

---

## 4. The gates

| Gate | Checked by | What actually runs | Pass criteria | On fail |
|---|---|---|---|---|
| **G0 Doctor** | machine | env preflight: node version, ports, disk, engine binary present + logged in, template deps | all checks green | guided fix, plain language ("Claude kurulu değil — kuralım mı?") |
| **G1 Blueprint** | user + schema | blueprint emitted via `--json-schema` (CLI retries until valid); a second session runs a completeness critique ("what's missing?"); rendered in plain language | schema-valid AND explicit user approval | more interview questions; re-draft |
| **G2 Plan audit** | second session | an independent audit session — given the plan and blueprint, *no author context* — checks: every phase has a testable outcome; dependencies ordered; no scope creep beyond blueprint | audit verdict JSON = pass | planner revises; **cap 2 loops**, then the disagreement is shown to the user in plain terms |
| **G3 Build harness** | machine | per phase, after the build session stops: install → lint → type-check → unit tests → build. Template-defined commands, exit-code enforced | all exit 0 | failure log fed to a fixer session; **cap 3 loops**, then honest escalation |
| **G4 Verify** | machine + user | Guidelane boots the app, waits for health, runs the template's smoke script (key routes respond, no console errors, Playwright click-through), captures screenshots | smoke exit 0 | back to Build with the evidence attached |
| **G5 Independent review** | second session | reviewer session gets the diff + blueprint + the Atlas impact map (what the change touches and what depends on it) — no author context. Runs code review **plus the owner's 7 blindspot questions** (adversarial input, consistency, partial failure, secure-by-default, idempotency, abstraction promise, race conditions) | no critical findings | criticals → fix loop → G3/G4 re-run; non-criticals → backlog cards; **cap 2 loops** |
| **G6 Acceptance** | user | user actually uses the running product | explicit "kabul" | change requests → scoped mini-cycle |

**Honest degradation is part of the spec.** When a retry cap is hit, the
product says so in plain language: *"Bu kısmı 3 kez denedim ve başaramadım.
Şunu basitleştirmeyi öneriyorum: …"* — never silent infinite retries, never
fake success. Brutal honesty is product DNA, not just a working style.

**Change requests** after Ready run the same line, scaled: intake-lite ("neyi
değiştirelim?") → impact note → one build phase → G3 → G4 → G5-lite. Same
pattern, smaller loop — the user never meets a second, different process.

**Scaled depth is deterministic, not model whim.** Blueprint feature count
classifies the project S/M/L; a fixed rule table sets minimum interview
questions, plan phase count, review depth, and smoke breadth. A tiny "make me
one page" request flows through the same stations quickly; it does not skip
them.

---

## 5. Keeping the model on-pattern *inside* a stage

Between gates, the model still has working freedom. It is bounded by six
mechanisms, all per-session flags or plugin components from RESEARCH-01:

1. **Scoped context** — a stage session knows only its stage. The build session
   for phase 3 has phase 3's handoff, not the whole project saga.
2. **Structured artifacts** — `--json-schema` forces schema-valid output for
   blueprint/plan/review; the CLI itself retries until valid. Structure is
   enforced at the protocol level, not requested politely.
   **CORRECTED (REVIEW-02 B4)**: the retry is *bounded*, not unlimited — it
   terminates with result subtype `error_max_structured_output_retries`. G1 must
   map that terminal state to a plain-language escalation.
3. **Tool scoping** — `--tools` / `--disallowedTools` per stage: the planning
   session cannot edit files; the review session cannot write at all;
   `--permission-mode auto` plus a fail-closed `PreToolUse` hook blocks
   destructive commands outright.
4. **Budget and retry ceilings** — `--max-budget-usd` per stage; loop caps per
   gate. Runaway behavior is structurally impossible, not merely discouraged.
   **CONFIRMED (ADR-008)**: the budget flag is enforced under subscription auth
   (`apiKeySource: none`). But no engine-side *timeout* flag exists at all, so
   the orchestrator's per-stage timeout stays the primary guardrail — and its
   value must come from the measured max-silence baseline (REVIEW-02 A5), not
   from a guess.
5. **Atlas bias** — proven paths and "when NOT to use" knowledge in context,
   so the model's freedom is steered toward known-good patterns.
6. **Git snapshots** — every stage transition commits. "Geri al" is always one
   click, so no model action is irreversible from the user's seat.

---

## 6. Bounded stack templates make the gates deterministic

A quality gate is only as reliable as the harness it runs. `lint`, `tsc`,
`build`, and a smoke script all presuppose a project layout Guidelane
understands. Therefore:

**Guidelane always generates projects from its own stack templates.** A
template is: scaffold + pinned toolchain + **gate harness** (lint/type/test/
build/smoke commands, health endpoint, Playwright smoke skeleton) + template
docs for the model + an Atlas core corpus aligned to that stack.

This upgrades decision Q3 (core stack list) from "which docs to cache" to
**load-bearing**: the profile list defines what Guidelane can build *well*.
v1 ships two profiles (per R12, §13.1): **"Local web app"** as the default
(Next.js + Tailwind + SQLite — no accounts, no vendor, runs entirely on the
user's machine) and **"Publishable web app"** (Postgres) for multi-user
products, with deploy target chosen freely at Ready. Requests outside the
profiles get an honest answer — "bu v1'de yok" — plus Atlas's reach tier for
advisory help, rather than a gate-less freeform build that would silently drop
every quality guarantee.

---

## 7. Atlas v2 — the architecture and quality backbone

Owner's directive (2026-07-30, given during this review): **the architecture
part is the most important**; **affected files keep getting overlooked**; the
MCP must serve **all languages and architectures in general**; and the MCP's
**own architecture must itself be high quality**. This section upgrades
RESEARCH-01 §5 accordingly — content model, tool surface, and internal design.

### 7.1 Three knowledge kinds — architecture first

| Kind | Contains | Consumed at |
|---|---|---|
| **architecture-decision** (priority #1) | Language-agnostic trade-off guides: layering and boundaries, data flow, coupling, sync vs async, monolith vs services, caching, auth boundaries, storage choice, migration strategy — each as "when X vs Y" with context factors, consequences, and failure modes | Plan (pushed + pulled); G2 audit ammunition; Blueprint constraints |
| **quality-standard** | Short normative rules with rationale; house style; review checklists | Build (pushed house-rules pack); G5 checklist source |
| **task-pattern** | Proven implementation paths per stack (RESEARCH-01's original scope) | Build; fix loops |

The trick that makes one corpus serve "all languages and architectures" without
exploding: architecture entries are **language-agnostic at the core** (the
decision logic — "when do you need a queue" is universal) with **per-stack
implementation notes attached**. New stacks add notes, not new decision guides.

Standards compile to machine checks wherever possible: a rule that can be a
lint rule *becomes* a lint rule in the template's G3 harness, and Atlas keeps
its rationale. Only genuinely judgment-shaped rules (naming quality, module
boundaries, abstraction promises) stay as review guidance. "Quality code" is
therefore enforced in three layers: lint (machine), pushed house rules (always
in context), independent review (second session working from an Atlas-versioned
checklist — raising the quality bar becomes a corpus edit, not a code change).

### 7.2 The project graph — affected files can no longer slip

The owner named the classic failure: change one file, miss its dependents. The
fix cannot be "remind the model harder." Atlas gets a live **project graph
subsystem**:

- **What it builds** — per project: a dependency graph of files,
  imports/exports, symbols, and which tests cover what; persisted in SQLite;
  incrementally re-indexed after every build phase (orchestrator-triggered,
  deterministic — never dependent on the model remembering).
- **How it parses** — tree-sitter grammars for the general multi-language case
  (the same parsing technology editors use), plus compiler/LSP-grade resolution
  where available (TypeScript first). This is what makes the MCP *general
  across languages* while staying honest about per-language depth.
- **How it is consumed**:
  - **Pushed before editing** — the orchestrator computes the impact map for a
    phase's file scope and opens the Build session with it: "you are about to
    touch X; A, B, C import it; tests T1–T2 cover it." This is the owner's own
    pre-edit impact check (`feedback_coding_discipline.md` Checklist 1),
    productized and made deterministic.
  - **Pulled during work** — `atlas_impact(file|symbol)` for the model's own
    mid-task queries.
  - **At review** — G5's reviewer receives the impact map alongside the diff,
    so "did this change update everything it affects?" becomes a checkable
    question instead of a hope.
  - **At the gate** — G3's type-check already catches broken imports in typed
    stacks; the graph extends the net to test-coverage awareness and untyped
    stacks.

Honest per-language depth for v1: **TS/JS first-class** (tree-sitter + tsc +
LSP), **Python/Go structural** (imports and symbols, no type resolution),
**everything else reference-search fallback**. The per-language adapter
interface means depth grows without redesigning the server.

### 7.3 The project decision ledger — architecture decisions are enforced, not just made

An architecture chosen at Plan must not be silently re-litigated by a later
Build session. Atlas records the project's own decisions as auto-ADRs (chosen
boundaries, data model, rejected alternatives and why), and the orchestrator
pushes the ADR digest into **every** subsequent session's context. A phase that
wants to deviate must surface it to the user as a decision — drift is
structurally blocked. This is the owner's own PROJECT_MAP/ADR system,
productized.

### 7.4 Two consumption modes

- **Pushed (deterministic)** — the orchestrator queries Atlas itself at stage
  start and injects a curated slice: ADR digest + house rules + stage-relevant
  knowledge + impact map, kept small (~2–3K tokens). Whether the model reads
  the standards is not left to the model's discretion.
- **Pulled (model-driven)** — the tool surface for deep lookups mid-work,
  under progressive disclosure / Tool Search (RESEARCH-01 §5.2's design rules
  unchanged: few tools, resources for detail).

### 7.5 Atlas's own architecture

The owner asked for the MCP itself to be architected well:

```
┌─ Atlas MCP server (stdio; read-only in the query path) ───────┐
│  Tool layer — ~6 kind-aware tools, progressive disclosure     │
│  ├─ Knowledge subsystem     — curated corpus (SQLite + FTS5)  │
│  ├─ Project-graph subsystem — dep graph per project (SQLite)  │
│  └─ Ledger subsystem        — outcomes + project ADRs (append)│
└───────────────────────────────────────────────────────────────┘
   ▲ writes happen out-of-band, never in the query path:
   ├─ Corpus builder CLI — fetch / normalize / index knowledge
   └─ Graph indexer      — parse project, incremental updates
```

Design rules: the query path never writes (a refresh can never corrupt a live
session); every answer carries provenance; storage is single-file SQLite (local,
no daemon — R5c); the tool surface stays small. Current draft:
`atlas_find`, `atlas_get`, `atlas_impact`, `atlas_decisions`,
`atlas_check_current`, `atlas_record_outcome` — final surface fixed in the S5
design review.

**Standalone value:** Atlas is deliberately usable *outside* Guidelane — any
Claude Code user, or any MCP client, can add it as a general
architecture-knowledge + impact-analysis server. For an open-source,
community-benefit project, that makes Atlas a first-class deliverable in its
own right, not just an internal organ.

### 7.6 Code maps — token economy through structure (R11)

Owner's directive: files past a certain length carry a short guide header at the
top ("what is where"), so future reads don't re-scan whole files. This is the
owner's existing FILEMAP system (`filemap-update.sh` + `FILEMAP.spec.md` +
`feedback_inline_mapping` + `feedback_maps_over_searches`), upgraded and made
deterministic:

- **Per-file `@MAP` headers** — any generated file over ~200 lines gets a header
  block listing its symbols and line numbers. The Atlas **graph indexer writes
  and maintains these mechanically** from its tree-sitter symbol table after
  every build phase — the model never maintains maps by hand, so they cannot
  drift by forgetfulness. (The owner's current hook does this with regex for
  TS/JS only; the indexer generalizes it to every parsed language.)
- **Per-project FILEMAP** — the indexer also emits a project-wide
  file → exports → line-numbers index, adopted verbatim from the owner's
  `FILEMAP.spec.md`, including its exclusion rules and its validation law:
  **never overwrite a map that fails re-parse validation** — a stale-but-correct
  map beats a fresh-but-wrong one.
- **Pushed, not hoped for** — the orchestrator includes the FILEMAP slice and
  the relevant `@MAP` headers in every Build session's opening context, and the
  session instructions say: consult maps before reading whole files. Lookup
  drops from a Glob→Grep→Read→Read cycle (~3–5K tokens) to one map read.
- **Trust order** — if a map disagrees with the code, the code wins and the
  indexer re-runs (the owner's honesty rule, kept verbatim).

---

## 8. What the non-coder experiences

### 8.1 A project, start to finish

1. **Install** — one command (`npx guidelane`), browser opens to localhost.
   G0 doctor runs; if the `claude` binary or login is missing, it shows the
   official install/login step as a guided action (vendor's own installer and
   OAuth flow — Guidelane never touches the credential).
2. **Home** — project cards on the pipeline board: *Fikir → Tarif → Plan →
   Yapım → Kontrol → Hazır*.
3. **Interview** — product questions only: "Kimin için?", "Birisi bu butona
   basınca ne olmalı?" Never "which database?"
4. **Tarif (blueprint)** — a plain-language product description with concrete
   examples: "Bunu mu istiyorsun?" Approve or refine. This is G1, and it is the
   user's most important moment of control.
5. **Plan** — milestones in outcome language ("Önce giriş sayfası, sonra
   kayıt"), not technology language.
6. **Yapım** — a live plain-language activity feed ("giriş sayfası
   hazırlanıyor… kontrol ediliyor…") with progress. Raw tool calls, paths, and
   diffs never render — the cockpit owns the pixels (RESEARCH-01 §4.3's
   deterministic translation, now easier because pipeline events are semantic
   by construction).
7. **Kontrol** — screenshots plus an "Aç, kendin dene" button to the locally
   running app. Real evidence, not claims.
8. **Sonuçlar** — review outcome in honest plain language: "3 sorun bulundu ve
   düzeltildi. 1 karar sana kaldı: …"
9. **Hazır** — the product runs; change requests re-enter the small loop;
   "Geri al" is always visible.

UI copy is Turkish-first with an i18n string layer from day one (the audience
is the owner's circle; the open-source community will want English).

### 8.2 Night Shift — start it, close the lid (R9)

Owner's directive: the process must be able to run unattended, possibly a whole
night. The design descends directly from the owner's working
`overnight-orchestrator.sh` prototype (analyzed in RESEARCH-03 §2) — phased
headless sessions, a disk ledger, one item per cycle, honest STOP over silent
retry, a morning briefing — with its three documented gaps fixed by the
production line's deterministic gates.

**How a night run works:**

1. **Preflight (from `night-mode-pre`)** — before the user walks away: power
   check (charger in?), keep-awake armed (`caffeinate`-equivalent owned by the
   run supervisor), git WIP snapshot as the recovery anchor, and the work
   queue confirmed in plain language ("Bu gece şunları yapacağım: …").
2. **User gates move to the edges.** G1 (blueprint approval) happens before
   bed; G6 (acceptance) happens in the morning. Nothing overnight waits on a
   human.
3. **Mid-run decisions defer, not block.** When a phase hits its retry cap or
   needs a product decision, the orchestrator parks that item as a **decision
   card**, moves to the next independent item if one exists, or ends the run
   gracefully. A parked item is never silently retried forever and never
   silently dropped.
4. **Rate limits are a first-class event — and, as of S0, a precisely
   machine-readable one.** Measured 2026-07-30 (ADR-007): every stream-json
   session emits `{"type":"rate_limit_event","rate_limit_info":{"status":…,
   "resetsAt":<epoch seconds>,"rateLimitType":"five_hour",…}}`. The supervisor
   therefore **sleeps to `resetsAt`** rather than blind-polling, and the morning
   report and cockpit can state when capacity returns. Blind backoff remains
   the fallback for unknown non-zero exits only. Cycle caps still bound a run;
   `--max-budget-usd` was observed to be *enforced* on the owner's machine
   (contra the earlier assumption), but timeouts, cycle caps, and retry
   ceilings stay the primary guardrails since auth mode was not independently
   determined.
5. **Morning report** — in the user's language, at the top of the project:
   what was completed (with gate evidence: tests passed, screenshots), what
   was parked and why, which decision cards await, what was paused by rate
   limits, and an honest overall read. This is the prototype's Turkish
   "Sabah Brifingi", productized.
6. **Every cycle is resumable.** State lives in the artifact store and git
   snapshots (S2's kill-9 resume gate), so a crash or sleep event costs one
   cycle at most, never the night.

**Why not the engine's own `/loop`:** the owner's May-2026 research chose
phased-headless over `/loop` for unattended runs (fresh context per phase, no
compaction risk, loop control outside the model), and the production line is
already that shape. We adopt the loop *discipline* Claude Code's loop features
encode — bounded iterations, wake conditions, honest stop, budget ceilings —
but implement the loop in Guidelane's own supervisor where it is deterministic.
Scheduled runs ("her gece 02:00'de") use the OS scheduler locally; no server.

### 8.3 The language dial (R10)

Owner's directive, productized from their own global language policy: **the
user picks their language; summaries and everything written *for the user* are
in that language; everything else the system produces is English** — the
model's strongest working language, and roughly half the token cost for the
same content in Turkish.

| Surface | Language |
|---|---|
| UI copy, activity feed, decision cards, morning report, blueprint *as shown for approval*, artifacts made for the user to read | **User's language** (setting; default = system locale) |
| Internal artifacts: canonical blueprint JSON, plan, phase reports, review findings, ADR ledger entries, handoffs | **English, always** |
| Code, code comments, commit messages, `@MAP` headers, FILEMAP | **English, always** |
| Atlas corpus and tool responses | **English, always** |

The one artifact that is both user-facing and machine-consumed — the blueprint
— is stored canonically in English and **rendered** into the user's language
for the G1 approval view. The rendered view is regenerated from the canonical
form, never edited directly, so the two cannot diverge. Session prompts pin
this split explicitly ("think and write artifacts in English; address the user
in <language>"), and the cockpit's translation layer (§4.3 mechanism 3) is what
actually guarantees the user-facing side regardless of what the model emits.

---

## 9. Pattern provenance and legitimacy

Every adopted structure, its source, and its legal footing:

| Pattern | Source | Footing |
|---|---|---|
| Pipeline / stage lifecycle / run control / kanban board | WrongStack (MIT) | Pattern-level adoption; any copied code (e.g. simpleui fragments) carries the MIT notice in `THIRD-PARTY-NOTICES.md` |
| Auto-review loop after build | WrongStack "Chimera" | Pattern-level |
| Gated phases; QA audit before implementation; intake fields; fresh-session handoffs | alicankiraz1 ClaudeQB | Method adoption, own implementation |
| Durable planning ledger; controlled Goal/Apply handoff | alicankiraz1 CodexQB | Method adoption, own implementation |
| 7-question adversarial review | The owner's own `feedback_blindspot_audit.md` | Own methodology, productized |
| Honest degradation; evidence-over-claims | The owner's `feedback_brutal_honesty.md` + `feedback_confidence_calibration.md` | Own methodology, productized |
| Staged delivery with validation gates | The owner's `feedback_incremental_foundations.md` | The production line *is* this rule, applied to the product's users |
| Night Shift: phased headless overnight runs, preflight checklist, morning report | The owner's `overnight-orchestrator.sh` + `night-mode-pre` skill (working prototype since 2026-05) | Own work, productized; its 3 documented gaps fixed by deterministic gates (RESEARCH-03 §2) |
| Code maps: `@MAP` headers + FILEMAP + validation law | The owner's `filemap-update.sh` + `FILEMAP.spec.md` + mapping rules | Own work; indexer-maintained, generalized beyond TS/JS |
| Per-stage effort tuning (scan=medium, review=high, build=xhigh) | The owner's `feedback_effort_level_strategy.md` (measured 30–50% token saving) | Own work |
| G5 review lenses + Atlas quality-standard seeds | The owner's 5 specialist agent doctrines | Own work as content; read-only boundary now enforced by `--tools` scoping |
| Frontend anti-slop design checks for public pages | `taste-skill` (Leonxlnx, MIT) | Third-party — MIT notice carried in THIRD-PARTY-NOTICES.md |
| The language dial | The owner's `feedback_language_policy.md` | Own policy, productized as a per-user setting |

Engine legitimacy is unchanged from RESEARCH-01 §3 and governs everything here:
official `claude` / `codex` binaries spawned as subprocesses, user's own login,
Guidelane holds zero credentials, `--bare` and `--safe-mode` never used. The
orchestrator adds *more* subprocess sessions (plan, build, audit, review), all
through the same compliant path — nothing about gating changes the ToS
analysis.

---

## 10. Component inventory v2

Deltas against RESEARCH-01 Part D:

| Component | Status vs v1 | Est. size | Notes |
|---|---|---|---|
| **Orchestrator** — state machine, gates, artifact store, session profiles, retry caps, git snapshots, **Night Shift supervisor** (preflight, keep-awake, rate-limit pause/resume, decision-card parking, morning report) | **NEW — now the heart** | ~1,900 LOC | Closes F1–F4 + R9. Plain TypeScript; no framework needed |
| **Stack template(s) + gate harness** | **NEW — load-bearing** | ~800 LOC + template content | Per-template: scaffold, pinned tools, smoke skeleton, docs |
| Engine adapter (spawn, stream-json, session lifecycle, PTY hedge boundary) | unchanged | ~1,200 LOC | Now also multiplexes parallel stage sessions |
| Cockpit UI (pipeline board, interview, blueprint card, activity feed, verify screen, Night Shift start/morning-report screens, language setting) | grown | ~3,000 LOC | Was 2,500; board, verify, and night screens add real surface; all strings i18n from day one |
| Behaviour pack plugin (persona, interviewer agent, translation hooks, fail-closed guards) | unchanged | ~1,500 LOC + prompts | Stakes *lowered*: the pipeline now carries the process load; persona only carries tone |
| Atlas MCP server + corpus builder + **project graph subsystem** | **extended** | ~3,100 LOC | Per RESEARCH-01 §5 upgraded by §7 here: architecture-first knowledge, impact analysis, project ADR ledger, pushed mode |
| Doctor + installer | grown | ~500 LOC | Guided engine install/login added |
| **Crew routing + presets + token telemetry** | **NEW (R13/R15)** | ~400 LOC | Role table, recommendation badges, per-role usage stats from stream-json |
| **Deploy adapters** (local is free; Docker + Vercel first) | **NEW (R12)** | ~300 LOC | One interface, thin adapters, opt-in at Ready |
| Knowledge corpus (content) | **extended** | ~10 architecture guides + ~15 standards + 40–80 task patterns | Still the largest non-code cost; architecture guides are priority #1 per the owner |

Total ≈ **12,700 LOC** (was ~8,000). The increase buys the difference between
"a friendly chat over a CLI" and "a production system with an architecture
brain, a crew you can compose, and a night shift" — it is the cheapest 4,700
lines in the project.

---

## 11. Revised staged plan

Each stage remains one testable atomic change with a machine- or user-checkable
gate. Confidence stated per stage, per the calibration rule.

| # | Stage | Gate | Est. | Conf. |
|---|---|---|---|---|
| S0 | **Engine conformance probe**: stream-json round-trip + every depended-on flag/event exercised on the installed CLI (`--json-schema`, `--mcp-config`, `--agents`, `--settings`, effort/model/fallback, resume/fork, hook events in `-p`) + deliberate rate-limit signal capture | every depended-on behavior verified and recorded; gaps trigger the PTY contingency early | 1d | 90% |
| S1 | Thin product: minimal web UI + engine + persona + **minimal machine gate** (generated app must lint, build, and boot — no self-certified "done" even at v0) | a friend gets a *booted, machine-verified* result | 3–4d | 80% |
| S2 | **Orchestrator skeleton**: state machine, artifact store, fresh-session-per-stage (+ session-reuse mode, cost benchmarked), **crew routing core** (role → engine/model/effort per session profile), G1 + G3, git snapshots; adapter behind one interface with PTY stub | a project flows Fikir→Yapım with gates enforced; kill -9 mid-run, resume from disk; role routing switches models per stage | 4–5d | 72% |
| S3 | **Verify + review loop**: G4 (boot + Playwright smoke + screenshots), G5 (independent reviewer with the 7 questions — from a static checklist file that migrates into Atlas at S5), retry caps, honest-degradation UX | a seeded bug is caught by G5, fixed, and re-verified without human help | 3–4d | 70% |
| S3b | **Night Shift**: preflight (power, WIP snapshot, queue), keep-awake, decision-card parking, rate-limit pause/resume, cycle caps, morning report | a multi-phase build runs 4+ hours unattended (rate-limit pause included) and produces a truthful morning report; kill mid-run → resume loses ≤1 cycle | 3–4d | 70% |
| S4 | Behaviour pack deep pass: plugin packaging, translation hooks, interviewer agent, `claude plugin validate --strict` + `plugin eval` cases; **crew presets UI with recommendation badges** (per-role "Önerilen: model · effort" + reason); token telemetry dashboard | 10 transcripts read clean of jargon; eval cases pass; a user can switch presets and see per-role cost | 5–7d | 68% |
| S5 | Atlas v1 (knowledge + ledger): kind-aware tools over stdio, corpus builder, pushed house-rules pack, seed corpus (6 architecture guides + 12 standards + 10 task patterns), outcome ledger, G5 checklist served from Atlas | engine consults Atlas unprompted; offline query works with network off | 5–7d | 75% |
| S5b | Atlas project graph: tree-sitter indexer, `atlas_impact`, pushed impact maps into Build and G5, incremental re-index per phase | a change to a shared file yields an impact map naming every dependent; G5 catches a deliberately-missed dependent | 3–4d | 65% |
| S6 | Additional engines: local models (ship freely), GLM (only after written z.ai confirmation), Codex (opt-in, owner-accepted risk) | engine switch is config-only | 3–4d | 60% |
| S7 | Distribution + freedom: `npx` installer, GitHub marketplace publish, profile hardening, **deploy adapters** (Docker self-host, Vercel, others by demand), eject-guarantee docs | a friend installs from a URL and reaches Hazır with no terminal; the same project deploys to two different targets | ongoing | 70% |

Sequencing: S0→S1→S2 are strict foundations. S3 must precede real friend
pilots (a pilot without the verify/review gates would test the wrong product).
S3b follows S3 — an unattended run without machine gates would be the
prototype's LLM-self-certification gap all over again. S4 and S5 can run in
parallel after S2; S5b follows S5 (the graph subsystem builds on Atlas's
storage and tool layer). The z.ai confirmation email should be sent during S1
— it gates S6, not S1. Confidence for S3b starts higher than a from-scratch
feature normally would because the owner's overnight-orchestrator prototype
already proved the phased-headless shape (RESEARCH-03 §2).

---

## 12. Known risks / weak spots (updated, ranked)

1. **`claude -p` billing re-split** (unchanged from RESEARCH-01 §3.3, still #1).
   Announced, then paused under revision. Consequence if it lands: users need
   Agent-SDK credit, not a ban. Hedge: S2's PTY transport boundary. The
   orchestrator's fresh-session-per-stage design slightly *increases* exposure
   (more `-p` invocations), which makes the hedge more valuable, not less.
2. **Gate friction vs. vibecoding fun.** The line adds upfront questions and
   visible checking time. Too much ceremony and friends stop using it; too
   little and quality collapses — the entire product lives on this tension.
   Mitigation: deterministic scaled depth (S/M/L), interview-as-conversation,
   and measuring drop-off in the S3-era friend pilot. I flag honestly: the
   right depth settings are unknowable until real non-coders touch it.
3. **Template escape.** Users will ask for things outside the template ("bir
   mobil uygulama yap"). Freeform building would silently drop every gate
   guarantee. Mitigation: honest refusal with alternatives + Atlas reach tier;
   template #2 chosen by observed demand, not guesses.
4. **Review/fix ping-pong.** G5 findings → fix → new findings, forever. Caps
   (2 review loops, 3 build loops) + honest escalation are in the spec; the
   residual risk is that capped-out projects frustrate users. Measured in pilot.
5. **Fresh-session token cost.** Re-feeding artifacts per stage costs more per
   stage than one long chat, but each context is small and focused; net cost is
   *probably* lower and quality certainly higher. Honest status: unproven —
   measure during S2 with real numbers.
6. **Persona leakage** — downgraded from #2 in RESEARCH-01: the deterministic
   pipeline now carries the process load, so a leaked jargon word is a cosmetic
   bug, not a product failure.
7. **Corpus thinness** — now across three kinds, with architecture guides as
   the owner's stated priority. Ten good entries beat forty shallow ones; grow
   by `atlas_record_outcome` evidence and observed project demand.
8. **Windows.** Playwright, ports, PTY, and process handling all have Windows
   quirks. The friends' machines are unknown — this is decision Q5, not a
   guess I should make.
9. **Environment gaps**: `pnpm` 9.15.0 (several toolchains want ≥11.5.3), `uv`
   not installed (needed only to study indexandria locally).
10. **GLM / Codex confirmations pending** (unchanged; S6 is gated on them).
11. **Multi-language impact analysis is uneven by design.** TS/JS gets
    compiler-grade resolution; Python/Go get structural parsing; the rest get
    reference-search. The per-language capability matrix must be honest in the
    docs — claiming uniform depth across "all languages" would be the
    marketing-confidence pattern the owner has banned.
12. **Night throughput is bounded by the subscription itself.** Rolling usage
    windows and weekly caps mean a heavy night can spend hours paused, and
    Guidelane cannot (and must not) route around that. Mitigation: pause/resume
    is engineered in, the morning report states plainly how much of the night
    was rate-limited, and cycle caps keep expectations honest. A night that
    completes 3 of 6 items because of limits is a correct outcome, not a bug.
13. **Routing efficacy is unproven.** The Balanced preset is an informed
    default, not a measured optimum; a wrong mapping either wastes tokens or
    quietly drops quality. Mitigation: conservative defaults (top models stay
    on architecture and security review), per-role telemetry + gate-failure
    rates so the user's own data tunes it, and one-click preset switching.
    Residual risk accepted — this is empirical by nature.
14. **Two profiles = two harnesses to maintain.** Each stack profile carries
    its own gate toolchain; profile count grows only by observed demand, and
    v1 is capped at two.
15. **Fresh-session cost premium is unmeasured** (also §13.2). S2 benchmarks
    it; the session-reuse fallback exists if it exceeds ~1.3×.

---

## 13. Owner directives, 2026-07-30 evening — freedom, economy, anti-slop, crew (R12–R15)

Four directives given during the owner's review of this document, folded in below,
plus the revisions produced by the visible loophole-loop run on the whole plan.

### 13.1 R12 — Stack and vendor freedom

Directive: users must not be pushed into Vercel-like services.

- **Profiles, not one template.** The bounded-harness principle (§6) survives —
  gates still require a known toolchain — but v1 ships **two stack profiles**
  instead of one template: **"Local web app"** (default: Next.js + Tailwind +
  SQLite via Drizzle — zero accounts, zero cost, runs entirely on the user's
  machine) and **"Publishable web app"** (Postgres profile for multi-user,
  hosted products). Neither names a hosting vendor.
- **Deploy is an adapter, chosen at Ready — never a default.** Local-only is a
  fully legitimate end state (many friend-projects never need hosting). Opt-in
  adapters: self-host (Docker Compose), Vercel, Netlify/Cloudflare later —
  each a thin module behind one interface.
- **Eject guarantee.** Every generated project is a standard, boring project —
  normal package.json, normal framework layout, no Guidelane runtime
  dependency. The user can zip it, hand it to any developer, host it anywhere.
  Freedom's deepest form is "you can leave."
- **Honest boundary.** Freedom means vendor/deploy/model choice — NOT
  freeform stacks and NOT gate bypass. A fully free stack would dissolve the
  deterministic harness, which is the product's identity. Out-of-profile asks
  keep getting the honest "not in this version" plus advisory help.

### 13.2 R13 — Token economy as a named workstream

Directive: token economy deserves dedicated work, not scattered habits.
The levers, biggest first:

1. **Crew routing (R15)** — right-sizing the model per role is the single
   largest lever; on subscriptions it converts directly into "more work per
   rate-limit window."
2. **Per-stage effort mapping** (owner's measured 30–50% saving): scan/report =
   medium, audit/review = high, build = xhigh; max reserved for
   architecture-critical planning and security review only.
3. **Session-reuse fallback.** Fresh-session-per-stage is the default for
   drift control, but its cost premium is *unmeasured*. S2 benchmarks it; if
   overhead exceeds ~1.3× a long session, consecutive build phases within one
   milestone reuse a session via `--resume`. The adapter supports both modes
   from day one.
4. **Stable prompt prefixes.** Session profiles put invariant text (role
   prompt, house rules) first and project-varying artifacts last, maximizing
   provider-side prompt-cache hits across the many sessions a project spawns.
5. **Pushed-slice ceilings** (~2–3K tokens) and **artifact diet** — handoffs
   are digests referencing artifacts by id, never restated transcripts.
6. **Maps over re-reading** (§7.6) and **impact maps** (§7.2) — structure
   instead of exploration loops.
7. **Telemetry dashboard.** stream-json usage data per session → per-stage and
   per-role token/cost stats in the cockpit; the morning report includes the
   night's consumption. Unmeasured economy is a vibe; this makes it a number.

### 13.3 R14 — Frontend anti-slop, hardened

Directive: avoid AI-slop on the frontend as much as possible.

- **Design direction locks at Blueprint.** The blueprint stage sets the
  project's design tokens once (direction, palette family, type, density —
  taste-skill's dial model); every UI phase receives them pushed. Mid-project
  aesthetic drift is structurally blocked, mirroring taste-skill's palette/
  theme locks.
- **Machine-checkable tells move into gates.** G4's smoke harness gains
  axe-core (contrast, labels, focus — objective a11y failures fail the gate).
  G5's design lens runs taste-skill's mechanical pre-flight items (eyebrow
  count, CTA wrap, duplicate-CTA intent, palette-lock violations) as
  checklist items, not vibes.
- **Atlas frontend standards** seed from taste-skill + ui-ux-critic doctrine
  (banned defaults: AI-purple, beige+brass, fake div screenshots, Inter-by-
  default, emoji-as-icons).
- **Honest residual:** aesthetic quality is partly human judgment. Machines
  catch the mechanical tells; the design-lens session catches patterns; the
  final judge is the user at G6 looking at real screenshots.

### 13.4 R15 — The crew: user-selectable model routing per role

Directive: running the top model on everything is wasteful; everything on a
small model loses quality. The user must be able to choose which model does
which job — architecture on Fable, code by Opus, review by Codex, etc. — and
the product should **recommend** a model *and effort level* per role.

- **Roles.** Every session profile carries a role: interviewer, planner,
  plan-auditor, builder, fixer, reviewer (per lens), design critic, night
  scanner, reporter/translator.
- **Routing table.** Role → (engine, model, effort). Editable per project and
  globally. Each role displays a **recommendation badge with a reason** —
  "Önerilen: Fable · xhigh — mimari kararlar yılları bağlar" — and the user
  overrides freely. Defaults (Balanced preset):

| Role | Recommended | Why |
|---|---|---|
| Planner (architecture) | **Fable · xhigh** (max opt-in for large projects) | Architecture decisions compound for the product's lifetime — the one place the top model earns its cost |
| Plan auditor (G2) | Opus · high | Verification is cheaper than generation (owner's own effort rule) |
| Builder / fixer | Opus · xhigh | Anthropic's recommended coding default |
| Reviewer — security lens | Fable · xhigh | Security audits are a named exception in the owner's effort rule |
| Reviewer — other lenses | Opus · high | |
| Reviewer — cross-vendor (optional) | Codex (its own effort tiers) | A different model family has uncorrelated blind spots — the owner's own Codex-caught-11-findings experience is the proof |
| Design critic | Opus · high | |
| Interviewer | Sonnet · high | Conversation quality matters; hard reasoning doesn't |
| Night scanner | Sonnet · medium | Item picking = file discovery (prototype used medium) |
| Reporter / translator | Haiku · low–medium | Frequent, cheap, mechanical |

- **Presets**: Balanced (above, default) · Economy (Opus plans, Sonnet builds,
  Haiku utility — security lens stays Opus xhigh) · Max quality (Fable on
  planner+auditor+security, cross-vendor review on) · Single model (whatever
  the subscription offers).
- **Graceful degradation**: `--fallback-model` per session; if a routed model
  isn't available on the user's plan, the table degrades with a visible note,
  never a silent swap.
- **Honesty**: the optimal mapping is *not established anywhere* — presets are
  informed defaults, and the telemetry (per-role cost + per-role gate-failure
  rates) exists precisely so routing turns from opinion into the user's own
  measured data.

### 13.5 Loop-derived revisions (from the visible loophole-loop, same date)

1. **S0 grows into a conformance probe** (1 day): exercise every depended-on
   flag and event on the installed CLI version — `--json-schema`,
   `--mcp-config`+strict, `--agents`, `--settings`, `--append-system-prompt`,
   `--effort`/`--model`/`--fallback-model`, resume/fork, hook events in `-p`
   mode — plus a deliberate rate-limit capture to pin the limit signal's
   shape. Findings recorded; anything missing triggers the PTY contingency
   *before* the cockpit is built on sand.
2. **Acceptance scenarios are generated from the blueprint.** The G1 schema
   gains `acceptance_criteria`; G4/G6 render them as a plain-language
   try-this checklist ("Sepete ürün ekle → toplam değişmeli"). "Works" becomes
   user-checkable scenario by scenario — the strongest patch for the
   tests-pass-but-product-wrong gap.
3. **Serial-lens fallback.** Parallel review lenses drop to serial execution
   under rate-limit pressure (night runs especially).
4. **Session-reuse fallback** per §13.2 item 3 — measured, not assumed.

### 13.6 Context-problem completions + the proportionality rule (RESEARCH-04)

Owner's follow-up directive: the real LLM coding failure is impact blindness and
product amnesia — analyze how WrongStack prevents it, complete its gaps, and do it
**without letting token economy slip** ("küçük iş için tonlarca token yakılmasın").
Full analysis in RESEARCH-04; what lands in the architecture:

Adopted from WrongStack (credited): **A1** anchor re-verification (Atlas entries
hash-checked against the code they describe; stale → flagged, never silently
served); **A2** file timeline (impact maps carry "last touched by phase NN").

Completions of our own:
- **C1 Contract-change tripwire** — indexer diffs exported contracts per phase;
  changed contract + absent consumers = G3 failure or explicit waiver (reviewer
  sees waivers; telemetry counts them).
- **C2 Pushed impact maps** (§7.2) — the graph governs the edit, before it happens.
- **C3 Blueprint invariants** — named plain-language invariants set with the user
  at G1, pushed into *every* session (always present, never retrieval-ranked), and
  asked one-by-one at G5.
- **C4 Scope tripwire** — out-of-plan file touches require a stated reason the
  reviewer sees (the surgical-edits rule, productized).
- **C5 Ground-truth refresh** — every session opens with regenerated state
  (FILEMAP digest, test status, last gate results), never with a prior session's
  claims.

**Proportionality rule (token guard — simplified per REVIEW-01 §2):** v1 ships
**two classes, `small` / `full`**, classified from touched surface in code; doubt
rounds up; data/auth always `full` (fail-closed). Scaling applies to **impact maps
and ground-truth digests only — invariants are exempt and always pushed** (≤~300
tokens; tag-gating them would reintroduce the retrieval-miss failure this design
exists to kill — REVIEW-01 caught that contradiction). `small` = lint+build+
screenshot gates, Economy crew row, one-line ground truth, sub-1K pushed context,
two light sessions. Per-run cost line in v1; the 5-class system and full anomaly
dashboard are v2.

One-line contrast with WrongStack (RESEARCH-04 §4): *WrongStack fights forgetting;
Guidelane makes forgetting non-fatal.*

### 13.7 R16 — Ease of use: no code, no commands, no config

Owner directive: a product where you paste code, type terminal commands, or edit
config is dead on arrival; it must be as easy to use as invoking a skill.

- **One command to exist, zero after.** `npx guidelane` → browser opens → the
  doctor walks setup as guided buttons (engine install, login). No config files,
  no flags, no terminal from then on. The desktop wrapper (S7) later removes even
  that first command.
- **Conversation + board are the entire interface.** Every capability is reachable
  by plain talk. **Skill-style shortcuts** exist as optional accelerators in the
  cockpit input — `/gece`, `/geri-al`, `/değiştir`, `/kadro` — surfaced by a
  discoverable menu, never required, zero memorization.
- **Defaults everywhere.** Crew presets are one click; language auto-detects from
  the system; the stack profile is chosen by *describing the product* in the
  interview — users never name a stack.
- **Dual surface.** The behaviour pack already ships as a Claude Code plugin
  (§4.2), so the owner — a Claude Code power user — can invoke Guidelane's
  discipline as ordinary skills inside Claude Code itself. Friends only ever see
  the cockpit; the owner gets both.

---

## 14. Decisions needed from the owner

| # | Decision | Recommendation |
|---|---|---|
| Q1 | First testable surface | **Localhost web UI** — fastest to a real friend test; desktop packaging deferred to S7 |
| Q2 | Launch engine(s) | **Claude Max only** at launch; local models in S6 as the zero-risk free lane; GLM/Codex behind confirmations |
| Q3 | v1 stack profiles + corpus core (load-bearing — defines what Guidelane builds *well*) | **Two profiles (per R12): "Local web app" default (Next.js + Tailwind + SQLite/Drizzle — no accounts, no vendor) + "Publishable" (Postgres)**; deploy adapters opt-in at Ready; disk budget ~500 MB for the core corpus |
| Q4 | Repo + licence | `github.com/<owner>/guidelane`, **public, MIT**; repo doubles as the plugin marketplace |
| Q5 | OS support for v1 | **macOS first**, Windows in v1.1 — unless the friends' machines say otherwise; tell me what they run |
