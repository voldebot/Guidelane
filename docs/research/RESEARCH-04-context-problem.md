# The Context Problem — Why LLMs Fail at Sustained Coding, What WrongStack Does About It, and What Guidelane Completes

**Date**: 2026-07-30
**Status**: analysis complete; five completion mechanisms proposed and folded into RESEARCH-02 §13.6
**Honesty note up front**: the WrongStack analysis below is based on a close read of
its README (492 lines, local copy) and earlier research — **not a source-code audit**
of its 20 packages. Where the README is ambiguous about a mechanism's nature, that
ambiguity is stated rather than resolved by guesswork. An optional deep audit of the
`sage` and `kanban` packages (MIT, cloneable) is recommended before ADR-time if any
completion below turns out to hinge on a contested reading.

---

## 1. The failure taxonomy — what actually goes wrong

The owner named the real problem precisely: not "the model writes bad code," but
these five, which compound over a project's life:

| # | Failure mode | What it looks like | Root cause |
|---|---|---|---|
| P1 | **Impact blindness** | Edits `types.ts`, misses the five files importing it; changes an API shape, doesn't update callers or tests; fixes one copy of duplicated logic | The model sees a window of text, not the dependency graph. Nothing enumerates consumers at edit time |
| P2 | **Product amnesia** | Mid-project, contradicts an early requirement; re-litigates a settled decision; builds the feature that was explicitly cut | Requirements live in decaying chat history; there is no always-present canonical spec |
| P3 | **Context rot** | Long sessions dilute instructions; compaction summarizes away constraints; the model drifts off-pattern | Context windows churn; salience decays with distance |
| P4 | **State hallucination** | Believes tests pass because they passed 40 turns ago; references files it planned to write but never did | The model's "project state" is memory of claims, not regenerated fact |
| P5 | **Local fix, global damage** | Silences the failing test by bypassing the auth check; patches the symptom against an invariant defined elsewhere | The invariant isn't in the working context; the failure is |

Every serious agent product is, at bottom, an answer to these five. The gates
architecture (RESEARCH-02) already answers P3–P5 structurally; P1–P2 are where the
detail matters most, and where the owner pressed.

---

## 2. WrongStack's arsenal — credited accurately

Verified against the README; line references from the local copy.

| Mechanism | What it does | Failure modes it targets |
|---|---|---|
| **SAGE memory** (L276–290) | Project-local SQLite/FTS5 long-term memory. **Code-anchored**: a memory binds to a file/dir/symbol/command/commit/test/package. **Re-verified**: anchors are hash- and existence-checked as targets change, so notes don't silently go stale. **Auto-injected**: relevant memories surface every turn, and anchored ones surface when you touch their location. Typed knowledge (decisions, conventions, anti-patterns, root causes) with importance + confidence, plus a knowledge graph with typed edges | P2, partially P1 (notes *about* a location surface on touch) |
| **CodeMap** (L360–362) | Interactive dependency/symbol graph, server-side cached, virtualized rendering | P1 — but as presented it is a **navigation UI for the human**; the README does not say the consumer set is fed to the agent before an edit |
| **Kanban + atomic verification** (L299–310) | Durable boards; cards carry success criteria; `verify_completion` gates a card into Done — failure sends it to Review, not Done. `/goal` "locks a verifiable contract" | P3 (bounded card scope), P4 (completion is checked, not asserted) |
| **Spec → acceptance criteria → dependency-linked tasks** (L314) | Decomposition with dependencies between tasks | P2 at task granularity |
| **Chimera auto-review** (L375–378) | Post-session review agent on every changed file; severity-ranked `file:line` findings; fixer agents follow up | P1 after the fact, P5 |
| **File timeline / audit** (L369–371) | Replay any file's history: which task, which session, which change | Forensics for all five |
| **Mailbox** (L268–271) | Typed inter-agent messages so parallel agents coordinate | Multi-agent collision (adjacent problem) |

This is a genuinely strong arsenal — stronger than RESEARCH-01 credited. Two of its
ideas are good enough that Guidelane should **adopt them outright** (see §4, A1–A2).

---

## 3. The gaps — where the arsenal falls short of the problem

**G1 — Memory is retrieval-ranked advice, not process law.** SAGE auto-injects
*relevant* memories; relevance is a ranking. If retrieval misses — wrong keywords,
crowded context, an unlucky turn — the constraint simply isn't there, and nothing
downstream notices its absence. A remembered decision is *advice in context*; no gate
asks "does this diff violate decision #7?" The failure mode isn't that SAGE forgets —
it's that **remembering is load-bearing and probabilistic at once**.

**G2 — Verification's nature is unclear, and unclear means model-mediated somewhere.**
"Atomic verification" and "verifiably done" are the README's words, but whether
`verify_completion` is an exit code or an agent's judgment is not visible from the
README. The owner's own overnight prototype documented exactly this hole ("the
verification agent can declare VERIFIED without verifying"). Any link in the done-chain
where a model's word is load-bearing inherits P4.

**G3 — The dependency graph exists, but isn't stitched into the edit loop.** CodeMap
renders the graph *for the human to navigate*. SAGE surfaces *notes about* a touched
location. Neither is: "you are about to change `X`; its exported contract is consumed
by A, B, C; tests T1–T2 cover it; they must appear in this change or be waived." The
graph and the editor exist in the same product without the graph governing the edit.

**G4 — Session discipline is conventional.** Kanban bounds the *work*, but the README
shows no fresh-context-per-phase policy with artifact handoffs; sessions live long and
compact like everyone's. P3 is mitigated by card scoping, not designed away.

**G5 — Product-level coherence rests on retrieval.** `/goal` contracts and per-task
acceptance criteria are task-granular. There is no single, small, canonical,
always-in-context product blueprint with named invariants. Cross-task coherence — the
thing P2 actually breaks — depends on SAGE surfacing the right memories at the right
time (see G1).

**G6 — All of it rides an engine subscription users cannot lawfully use** (settled in
RESEARCH-01; listed for completeness).

---

## 4. Guidelane's completions

Two adoptions from WrongStack, five mechanisms of our own. The design principle
running through all of them: **move each anti-amnesia measure from "advice the model
might heed" to "structure the model passes through."**

### Adoptions (credit where due)

- **A1 — Anchor re-verification** (from SAGE): Atlas knowledge and ledger entries
  that anchor to code (a pattern applied at `file:symbol`, a decision about a module)
  get content-hash checks from the graph indexer after every phase; stale anchors are
  flagged for re-verification rather than silently served. (Atlas §7.2/7.3 gain this.)
- **A2 — File timeline**: the artifact store + git already know which phase touched
  which file; impact maps now carry "last touched by phase NN" per file — cheap
  provenance that helps both the model and the reviewer.

### Completions (the gaps, closed structurally)

| # | Mechanism | Closes | How it works |
|---|---|---|---|
| C1 | **Contract-change tripwire** (G3 gate extension) | G3→P1 | The indexer diffs **exported contracts** (signatures, types, schemas) after each build phase. Any changed contract whose known consumers are absent from the change set fails the gate: fix them or file an explicit waiver, which the G5 reviewer sees. Deterministic — no memory or attention involved |
| C2 | **Pushed impact maps** (already §7.2, now explicitly the P1 answer) | G3→P1 | Consumer set + covering tests are *in the build session's opening context* before the first edit — the graph governs the edit, instead of decorating a UI |
| C3 | **Blueprint invariants** | G1/G5→P2/P5 | The blueprint schema gains a named `invariants` list ("no user can see another user's data"), written in plain language with the user at G1. Pushed into **every** session as part of the ADR digest — not retrieved, *always present* (small-N canonical beats large-N ranked). Each invariant is also a standing G5 review question: "does this diff violate invariant #N?" |
| C4 | **Scope tripwire** | P3/P5 | Each phase declares its expected touch-set (from plan + graph). Out-of-set edits don't block, but require a stated reason in the phase report, which the reviewer sees. The owner's surgical-edits rule, productized |
| C5 | **Ground-truth refresh** | P4 | Every session opens with *regenerated* state — FILEMAP digest, current test status, last gate results — produced by the indexer and harness, never carried forward from a previous session's claims. Beliefs are replaced by facts at every stage boundary |

Alongside the existing structural answers: fresh-session-per-stage + artifact diet
(P3), machine gates + no-self-certification (P4), fail-closed guards + security lens
(P5), the canonical English blueprint + G2 plan-vs-blueprint audit (P2).

### The one-line contrast

WrongStack's bet: *a good enough memory, injected often enough, keeps the model
coherent.* Guidelane's bet: *memory helps, but coherence must not depend on it —
every remembered constraint that matters is also a gate, a tripwire, or an
always-pushed invariant.* WrongStack fights forgetting; Guidelane makes forgetting
non-fatal.

---

## 5. Cost, placement, and the proportionality rule

- C2/C5 land in S2 (session context packages) and S5b (graph); C1 and A1 need the
  indexer → S5b (+~0.5 day); C3 is a schema + prompt change → S2; C4 is orchestrator
  logic → S2/S3. No new stage.
- Runtime token cost: invariants digest ≤ ~300 tokens; impact map ≤ ~500; ground-truth
  digest ≤ ~400 — all inside the existing 2–3K pushed-slice ceiling (§13.2).

### Proportionality — small jobs must stay small (owner directive, same evening)

The owner's constraint: none of this machinery may turn a trivial change into a
token bonfire. The answer is deterministic scaling, not judgment:

- **Change-class detection.** Every request/phase is classified from its touched
  surface — `content` / `style` / `logic` / `data` / `auth` — by file extension,
  directory, and schema-touch rules (code, not model opinion). When in doubt,
  classify **up**; anything touching data or auth always gets the full line
  (fail-closed).
- **Conditional push assembly.** Pushed slices are built per relevance, not
  flat-rate: impact map only when the touched files *have* consumers; ground-truth
  digest shrinks to a one-line status for small classes. **Invariants are exempt —
  always pushed** (≤~300 tokens): tag-gating them would reintroduce the
  retrieval-miss failure C3 exists to kill (contradiction caught by the
  independent review, REVIEW-01). Typical small-task pushed context: **≤ ~500
  tokens**, not the 2–3K ceiling.
- **Gate depth by class.** A style-only change runs lint + build + screenshot
  (G3-lite + G4-lite) — no G2 plan audit, no full G5 panel. Logic changes get the
  standard line. Data/auth changes get everything, always.
- **Crew downshift.** Small classes route to the Economy row of the crew table
  automatically (with the auth/data exception), so a button-color change never
  wakes the top model.
- **Anomaly telemetry.** The token dashboard flags "simple class, expensive run"
  outliers — the tuning signal for all of the above.

Target: a trivial change costs **two light sessions** (build + verify) and a
sub-1K pushed context — while a schema change still triggers the full machinery.

## 6. Residual weaknesses, stated

1. **The README-not-code caveat** (top of doc) — G2 in particular could be unfair to
   WrongStack if `verify_completion` turns out to shell real commands. The completion
   C-set does not depend on that reading; it depends on our own standard.
2. **Pushed maps assume the model uses them.** In-context consumer lists should
   change edit behavior; the S5b gate test (a deliberately-missed dependent must be
   caught) exists to prove it, and C1 backstops it deterministically even if the
   model ignores the map.
3. **Invariant checkability varies.** "No cross-user data access" is reviewable;
   subtler invariants ("feels fast") are not — those belong in acceptance scenarios,
   not the invariant list. The G1 flow must steer accordingly.
4. **Contract tripwire false positives** (intentional breaking changes) are handled
   by the waiver path; if waivers become routine, the tripwire's value decays —
   telemetry counts waiver rates.
