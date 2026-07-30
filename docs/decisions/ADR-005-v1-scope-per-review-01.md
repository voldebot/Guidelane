# ADR-005: v1 Scope Ratified per Independent Review (REVIEW-01)

- **Status**: Accepted
- **Date**: 2026-07-30
- **Deciders**: Talha (owner), Claude (technical lead), independent review agent
- **Supersedes**: the scope/stage figures of RESEARCH-02 §10–11 where they differ

## Context

A zero-context adversarial reviewer (Fable, read-only, CLI claims re-verified
against installed binaries) returned **REVISE-FIRST**: plan-as-written 55%,
~75% with its Top-5 revisions. Its C8 verdict: roughly a third of the design is
v2/v3 wearing v1 clothes, for a v1 whose real test is "a few non-coder friends
successfully build something." Three of its cut candidates collided with
explicit owner directives and needed modified remedies rather than deletion.

## Options considered

### Option A — Ship as planned
- **Pros**: no rework of documents.
- **Cons**: bakes in a compliance-undermining hedge, a distribution non-coders cannot execute, 2–3× optimistic calendar, oversized v1.
- **Cost / risk**: reviewer's 55%.

### Option B — Revise-first (adopt Top-5 + scope cuts, with owner-directive-preserving modifications)
- **Pros**: fixable in days; reviewer estimates ~75% after; keeps every owner directive alive in a v1-sized form.
- **Cons**: some features the owner asked for arrive in reduced v1 form.

### Option C — Rethink (change product direction)
- **Pros**: —
- **Cons**: the foundation was explicitly judged strong; rethinking discards verified work.

## Decision

**Chosen**: Option B. The ratified v1 delta (full dispositions in REVIEW-01):

1. **Compliance**: PTY = technical-availability fallback only; billing-split
   answer = Agent-SDK credit + honest notice; written inquiries to z.ai **and**
   Anthropic as S0/S1 exit criteria (→ ADR-001).
2. **Distribution**: v1 pilot = **owner-installed** on friends' machines;
   double-clickable desktop package pulled up from S7 to **post-S4** as the gate
   for any wider distribution; audience stated honestly: non-coders who already
   pay for an AI coding subscription.
3. **Verification**: three-grade no-self-certification (→ ADR-002).
4. **Calendar**: 1.5–2× buffer; re-plan checkpoints after S2 and S4; **separate
   content track** (28 seed entries ≈ 7–14 days, rate to be measured); honest
   total **2.5–4 months**; S2 = 5–7d, S5b re-based.
5. **Engine governance**: auto-update disabled in child env; tested version
   range; nightly CI conformance probe (→ ADR-001).
6. **v1 scope**: single **Local** profile (Next.js + Tailwind + SQLite);
   publishable profile + deploy adapters → v1.1. Proportionality = **2 classes**
   (small/full; doubt up; data/auth always full); invariants exempt and always
   pushed. Crew = simple picker + presets + badges + per-run cost line; full
   dashboard → v1.1. Offline mirror cut → <20 MB patterns tier + crawl-and-
   cache. Atlas graph v1 = TypeScript only. Deferred: contract-change tripwire,
   anchor re-verification, local-model engines, taste-skill G5 checklist
   migration. Kept: axe-core in G4; Night Shift (owner-mode) with backoff-poll
   resume; keep-awake honesty (visible sudo step or "plugged-in, lid open").
7. **UX additions**: acceptance scenarios from blueprint; G1 top-3-assumptions
   highlight; day-mode rate-limit pause UX; post-Ready = packaged local build +
   launcher; positioning note (Lovable-class competitors; dual surface as the
   vendor-moves survival strategy).

## Consequences

### Positive
- v1 is buildable and honest; every owner directive survives in v1-sized form;
  compliance story is coherent again.

### Negative / accepted trade-offs
- Friends see fewer features at first; some owner-requested capabilities
  (publishing, full crew dashboard, multi-language graph) arrive in v1.1;
  routing efficacy and ceremony tolerance remain empirical unknowns.

### Follow-up work required
- [ ] Apply stage re-base at sprint-01 open (S0 probe first)
- [ ] Owner answers K4 (GitHub account) and K5 (friends' OS)

## References

- `docs/research/REVIEW-01-independent-findings.md` (authoritative dispositions)
- `docs/research/RESEARCH-02-product-architecture.md` (base architecture)
