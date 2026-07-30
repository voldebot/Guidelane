# ADR-006: The Language Dial — User-Facing in the User's Language, Everything Else in English

- **Status**: Accepted
- **Date**: 2026-07-30
- **Deciders**: Talha (owner), Claude (technical lead)
- **Supersedes**: none

## Context

Owner directive: the user picks a language; summaries and everything written
*for the user* appear in it; everything the system produces internally — plans,
ADRs, architecture docs, code comments, commit messages — stays in English, the
model's strongest working language and roughly half the token cost of Turkish
for the same content. This productizes the owner's own global language policy.

## Options considered

### Option A — Everything in the user's language
- **Pros**: simplest mental model.
- **Cons**: ~2× token cost on every artifact; weaker model output in low-resource languages; artifacts unusable by the global OSS community.

### Option B — Everything in English
- **Pros**: cheapest, strongest model output.
- **Cons**: fails the product's entire premise (non-coders must understand what they approve).

### Option C — The dial: user-facing surfaces in the user's language; all internal artifacts in English
- **Pros**: right language in the right place; token-efficient; OSS-friendly.
- **Cons**: one dual-form artifact (the blueprint) needs divergence control; translation quality risk.

## Decision

**Chosen**: Option C.

| Surface | Language |
|---|---|
| UI copy, activity feed, decision cards, morning report, blueprint approval view, user-made artifacts | **User's language** (setting; default = system locale; Turkish-first copy, i18n layer from day one) |
| Canonical blueprint JSON, plans, phase reports, review findings, ADR ledger, handoffs | **English, always** |
| Code, comments, commit messages, `@MAP` headers, FILEMAP | **English, always** |
| Atlas corpus and tool responses | **English, always** |

Rules:
- The **blueprint** is stored canonically in English and *rendered* into the
  user's language for G1; the rendered view is regenerated from canonical, never
  edited directly. Per REVIEW-01 (C3-low): invariants and acceptance criteria
  get a **back-translation spot-check** at G1 so the user cannot approve a
  mistranslation of the rules that will later gate their product.
- The deterministic guarantee is the cockpit's **whitelist rendering floor**
  (structured events → user-language templates); the LLM rewriter adds quality
  on top and is never the guarantee (REVIEW-01 C1 distinction).
- Session prompts pin the split: "think and write artifacts in English; address
  the user in <language>."

## Consequences

### Positive
- ~2× cheaper internal artifacts; strongest-language reasoning; community-usable
  repo; the owner's proven personal policy, productized.

### Negative / accepted trade-offs
- Translation layer is a real component with a quality bar; blueprint dual-form
  adds one regeneration rule to maintain.

### Follow-up work required
- [ ] i18n string layer in the cockpit from S1
- [ ] Back-translation spot-check at G1 (S2/S3)

## References

- `docs/research/RESEARCH-02-product-architecture.md` §8.3
- `~/.claude/global-rules/feedback_language_policy.md` (the personal policy this productizes)
- `docs/research/REVIEW-01-independent-findings.md` §3
