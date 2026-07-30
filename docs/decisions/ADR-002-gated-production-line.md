# ADR-002: Gated Production Line — Process Is Code, Content Is Model

- **Status**: Accepted
- **Date**: 2026-07-30
- **Deciders**: Talha (owner), Claude (technical lead), independent review agent (REVIEW-01)
- **Supersedes**: none

## Context

The owner's defining requirement: the LLM must not work "however it feels like"
("llmlerin kafasına göre çalışmayıp belli bir patterni kalite kapılarını
tutacak şekilde"). The audience is non-coders who cannot catch confident garbage
in a diff — so process enforcement is the product, not an enhancement. The
target failure modes are the five in RESEARCH-04: impact blindness, product
amnesia, context rot, state hallucination, local-fix-global-damage.

## Options considered

### Option A — Chat wrapper + persona (prompt-level discipline)
- **Pros**: cheapest; ships in days.
- **Cons**: controls tone, not behavior; "done" stays model-asserted; fatal for non-coders.
- **Cost / risk**: the exact failure the owner named.

### Option B — Fixed production line with gates enforced by our own code
- **Pros**: stages and gates are deterministic; the model keeps its intelligence inside stages; every anti-amnesia measure becomes structure (gate/tripwire/always-pushed invariant).
- **Cons**: ceremony can reduce "vibecoding fun"; more code to build (~orchestrator).
- **Cost / risk**: ceremony tolerance is empirically unknown — managed by two-class scaling + pilot measurement.

### Option C — Full deterministic workflow engine, model as pure text generator
- **Pros**: maximal control.
- **Cons**: destroys the model-led thinking/questioning the owner explicitly wants (R3); over-constrains.

## Decision

**Chosen**: Option B.

The line: **Fikir → Tarif → Plan → Yapım → Kontrol → Hazır**, stations with
durable artifacts, fresh session per stage, gates G0–G6.

**The no-self-certification rule, precise form** (restated per REVIEW-01 #3):
*no claim is accepted from the session that produced the work.* Three grades:
1. **Functional claims → machine-verified**: G3 harness exit codes; G4 boot +
   Playwright smoke + axe-core + screenshots.
2. **Judgment claims → isolated second sessions** (G2 plan audit, G5 review
   lenses with the 7 blindspot questions + invariants + impact map): these are
   *blocking-with-caps* — honest checks, not proofs.
3. **Test-authorship graded**: builder-written unit tests count as lint-grade;
   the independent functional net is Plan-authored acceptance scenarios (a
   different session) + the profile's own smoke suite; builder edits to existing
   test files are flagged by the scope tripwire.

Attached mechanisms (RESEARCH-04): always-pushed invariants; pushed impact maps;
scope tripwire; ground-truth refresh; honest degradation (retry caps + plain
"I failed, let's simplify"); change-class scaling `small`/`full` (doubt rounds
up; data/auth always full); user gates at G1 (blueprint approval with top-3
riskiest assumptions highlighted) and G6 (scenario-driven acceptance).

## Consequences

### Positive
- Forgetting becomes non-fatal; "done" is evidence; non-coders get a safety net
  no prompt could provide; Night Shift becomes safe enough to run unattended.

### Negative / accepted trade-offs
- Real ceremony cost; G2/G5 remain model judgment (bounded, capped, isolated —
  but not proofs); two-class scaling may misclassify (rounds up by design).

### Follow-up work required
- [ ] S2: orchestrator skeleton + kill-9 resume gate
- [ ] S3: G4/G5 loop + honest-degradation UX; seeded-bug gate test
- [ ] Pilot: measure ceremony tolerance (drop-off)

## References

- `docs/research/RESEARCH-02-product-architecture.md` §2–§5, §13.5–13.6
- `docs/research/RESEARCH-04-context-problem.md`
- `docs/research/REVIEW-01-independent-findings.md` #3
