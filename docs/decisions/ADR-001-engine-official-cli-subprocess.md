# ADR-001: Engine = Official Vendor CLI Spawned as Subprocess

- **Status**: Accepted
- **Date**: 2026-07-30
- **Deciders**: Talha (owner), Claude (technical lead), independent review agent (REVIEW-01)
- **Supersedes**: none

## Context

Guidelane must let users work through their existing subscriptions (Claude Max,
later GLM/Codex) **without any terms-of-service violation** — the owner's hard
constraint. Anthropic's 2026 enforcement (Jan suspensions; 4 Apr third-party
OAuth-harness cutoff) bans extracting subscription credentials into third-party
clients; the Claude Agent SDK requires API keys; open-source/non-commercial
status is no defence (OpenCode). The permitted line: running the vendor's own
program.

## Options considered

### Option A — WrongStack as runtime engine
- **Pros**: complete agent runtime exists today (kernel, tools, permissions, memory, surfaces); MIT.
- **Cons**: its headline subscription feature (OAuth sign-in with Claude/ChatGPT/Copilot) is precisely the banned pattern; unusable for R5d.
- **Cost / risk**: user account bans — disqualifying.

### Option B — Claude Agent SDK
- **Pros**: official, batteries-included harness.
- **Cons**: API-key auth only; subscription OAuth rejected — fails R5d by construction.
- **Cost / risk**: none technical; simply cannot serve the requirement.

### Option C — Spawn the official `claude` (later `codex`) binary as a subprocess
- **Pros**: the explicitly permitted pattern (Anthropic's own drawn distinction; Zed's guidance); full programmatic surface exists (`-p` + stream-json + per-session flags, verified on `claude` 2.1.220 and re-verified independently in REVIEW-01); user's credential stays in the vendor's keychain; Guidelane holds zero secrets.
- **Cons**: dependency on another program's CLI surface; billing policy for headless use announced-then-paused; auto-updates can break all users at once.
- **Cost / risk**: managed — see Decision.

## Decision

**Chosen**: Option C.

**Why this over the others**: it is the only path satisfying "subscriptions
without violation," and its control surface is sufficient for everything the
product needs (verified flag-by-flag, twice).

Binding rules attached to this decision:
1. Guidelane never sees, stores, or transmits any credential. Never `--bare`
   (breaks OAuth/keychain), never `--safe-mode` (kills the behaviour pack).
2. **PTY transport is a technical-availability fallback only** (e.g. headless
   mode/flags removed). It is **never** used to keep drawing subscription quota
   if Anthropic splits headless billing — that would be circumvention (REVIEW-01
   finding #1 corrected the earlier "unambiguously first-party" framing). The
   billing-split contingency is: Agent-SDK credit + honest in-product notice.
3. Spawned sessions run with auto-update disabled in the child environment; a
   tested CLI version range is maintained; the S0 conformance probe runs nightly
   in CI (REVIEW-01 finding #5).
4. Written inquiries go to **both** z.ai (GLM allowlist) and **Anthropic**
   (headless subscription use at Guidelane's pattern); both are S0/S1 exit
   criteria. GLM and Codex engines ship only behind their answers / explicit
   owner-accepted risk.
5. Compliance posture in operation: respect provider limits; backoff-poll on
   rate limits, no hammering at window reset; no multi-account rotation.

## Consequences

### Positive
- ToS-clean subscription use; ~zero engine maintenance (vendor maintains it);
  the entire agent-loop/permissions/tool stack is inherited, not built.

### Negative / accepted trade-offs
- Guidelane's fate is coupled to the `claude` CLI's stability and Anthropic's
  policy; throughput is bounded by the user's own plan limits (a correct
  outcome, reported honestly, not engineered around).

### Follow-up work required
- [ ] S0 conformance probe (all depended-on flags/events; `--max-budget-usd`
      under subscription auth; rate-limit signal capture)
- [ ] Send z.ai + Anthropic written inquiries; record answers in PROJECT_MAP §6

## References

- `docs/research/RESEARCH-01-feasibility.md` §3 (evidence chain), §4 (control surface)
- `docs/research/REVIEW-01-independent-findings.md` #1, #5, C6
