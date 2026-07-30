# ADR-004: Crew — Per-Role Model + Effort Routing with Reasoned Recommendations

- **Status**: Accepted
- **Date**: 2026-07-30
- **Deciders**: Talha (owner), Claude (technical lead)
- **Supersedes**: none

## Context

Owner directive: "running Fable on everything wastes tokens; everything on
Sonnet loses quality; the user must be able to choose which model does which job
— and the product should *recommend* a model **and effort level** per role."
On subscriptions, right-sizing converts directly into more work per rate-limit
window. The owner's own measured rule (per-phase effort tuning, 30–50% saving)
is prior art.

## Options considered

### Option A — Single model everywhere
- **Pros**: zero complexity.
- **Cons**: the exact waste/quality trade the owner rejected.

### Option B — Hardcoded per-stage mapping (no user control)
- **Pros**: simple, captures most savings.
- **Cons**: violates the explicit "user must choose" directive; can't adapt to plan/model availability.

### Option C — Role table with reasoned recommendation badges, presets, user override
- **Pros**: honors the directive; conservative defaults keep quality where it matters; degrades gracefully; telemetry can tune it over time.
- **Cons**: a settings surface non-coders may never touch (mitigated: presets + defaults; full dashboard deferred).

## Decision

**Chosen**: Option C, v1-simplified per REVIEW-01 (§2): role table + one-click
presets + per-role recommendation badges + a per-run cost line; the full
telemetry dashboard is v1.1.

Default routing (Balanced preset) — each row shown in the UI as
"Önerilen: model · effort" with its reason:

| Role | Recommended | Reason |
|---|---|---|
| Planner (architecture) | Fable · xhigh | Architecture decisions compound for the product's lifetime |
| Plan auditor (G2) | Opus · high | Verification is cheaper than generation |
| Builder / fixer | Opus · xhigh | Vendor-recommended coding default |
| Reviewer — security lens | Fable · xhigh | Security is the named top-effort exception |
| Reviewer — other lenses | Opus · high | — |
| Reviewer — cross-vendor (optional, gated) | Codex | Different model family = uncorrelated blind spots; requires S6 confirmation + second subscription (marked in UI) |
| Design critic | Opus · high | — |
| Interviewer | Sonnet · high | Conversation quality, not deep reasoning |
| Night scanner | Sonnet · medium | Item-picking is file discovery |
| Reporter / translator | Haiku · low–medium | Frequent, cheap, mechanical |

Presets: **Balanced** (default) · **Economy** (Opus plans, Sonnet builds, Haiku
utility; security lens stays Opus·xhigh) · **Max quality** · **Single model**.
Change-class `small` auto-routes to the Economy row (data/auth exempt).
Unavailable models degrade via `--fallback-model` with a visible note — never a
silent swap.

**Honesty clause**: no optimal mapping is established anywhere; presets are
informed defaults; per-role cost + gate-failure telemetry exists precisely so
routing becomes the user's own measured data.

## Consequences

### Positive
- Token/limit budget stretches (biggest single economy lever); quality stays
  pinned where it matters; the user's explicit control requirement is met with
  recommendations, not homework.

### Negative / accepted trade-offs
- Routing efficacy unproven (risk #13); one more config surface to maintain.

### Follow-up work required
- [ ] S2: routing core in session profiles
- [ ] S4: preset picker UI + recommendation badges + per-run cost line

## References

- `docs/research/RESEARCH-02-product-architecture.md` §13.4
- `~/.claude/global-rules/feedback_effort_level_strategy.md` (owner's measured prior art)
- `docs/research/REVIEW-01-independent-findings.md` §2
