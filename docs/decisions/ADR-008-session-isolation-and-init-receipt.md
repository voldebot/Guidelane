# ADR-008: Session Isolation and the Init Receipt

- **Status**: Accepted
- **Date**: 2026-07-30
- **Deciders**: Talha (owner), Claude (technical lead), independent 7-agent plan audit (REVIEW-02)
- **Extends**: [ADR-007](ADR-007-headless-engine-contract.md). Does not supersede it.

## Context

ADR-007 fixed the permission model, Atlas delivery, and rate-limit handling from
the first S0 run. An independent 7-agent audit of the plan documents (139 raw
assumptions, distilled to a 24-probe matrix plus a completeness critique — see
`REVIEW-02-runtime-gaps.md`) then found that the first S0 suite was a strong
*static/configuration* conformance suite and a weak *runtime protocol* one. Three
of its findings were measured immediately; they change the session contract.

## Options considered

### Finding 1 — ambient configuration leaks into every spawned session

The plan's whole drift-control thesis (RESEARCH-02 §3: "a fresh stage session
receives a defined context package and never the chat history") assumed a spawned
session is a blank slate. Measured on the owner's machine via the init event:

| Isolation flags | plugins | skills | agents | mcp_servers | permissionMode |
|---|---|---|---|---|---|
| none | 4 | 24 | 10 | 1 (`MCP_DOCKER`, pending) | `bypassPermissions` (from operator settings) |
| `--strict-mcp-config` | 4 | 24 | 10 | 0 | `bypassPermissions` |
| `--strict-mcp-config` + `--setting-sources ''` | 0 | 16 | 5 | 0 | `default` |

So the flag the plan already used isolates MCP only. Everything else — the
operator's plugins, their skills and agents, **and their permission default** —
was still inherited. On this machine that includes a 16 KB personal constitution
and a `PostToolUse` hook that writes `docs/FILEMAP.md` into whatever directory
the session runs in.

- **Option A — accept inheritance**: "the friend's own setup enriches the run."
  It also makes runs irreproducible, imports unknown hooks into generated
  projects, and silently changes the permission posture per machine.
- **Option B — isolate with both flags on every spawn.**

### Finding 2 — `system/init` is an unused conformance receipt

Every session's first stream event carries `session_id`, `cwd`, `tools[]`,
`mcp_servers[]` **with status**, `plugins[]`, `skills[]`, `agents[]`, `model`,
`permissionMode`, `apiKeySource`, `memory_paths`, `claude_code_version`,
`slash_commands`, `output_style`, `capabilities`. The plan never used it.

This matters because the CLI's own `-p` help states that settings files failing
validation are **silently ignored** in print mode — meaning one typo in generated
settings JSON could remove the entire hook layer, including the destructive-op
guard, with no error anywhere. Without a positive confirmation channel, the
orchestrator would believe it is protected while it is not.

### Finding 3 — does a `MessageDisplay` rewrite reach what Guidelane reads?

R3 mechanism 4 assumes a hook can rewrite assistant text into plain language.
Guidelane renders `stream-json`, never the terminal, so a terminal-only rewrite
would be worthless. Measured: a hook returning
`{"hookSpecificOutput":{"hookEventName":"MessageDisplay","displayContent":"…"}}`
**replaced the assistant text block and the terminal `result` field in the
stream.** Mechanism 4 is real on the product surface.

## Decision

**1. The isolation pair is mandatory.** Every Guidelane-spawned session runs with
**both** `--strict-mcp-config` **and** `--setting-sources ''`, plus the scrubbed
child environment. Atlas and the behaviour pack are then added back explicitly
via `--mcp-config` and `--plugin-dir`. Nothing **of the operator's** reaches a
stage session that the orchestrator did not put there.

> **AMENDMENT 2026-07-30 (same day, sprint close).** As first written this clause
> said "nothing reaches a stage session that the orchestrator did not put there."
> That is false and an independent review caught it. See §"Amendment: the
> built-in floor" below — the isolation pair removes the operator's
> configuration, not the CLI's own.

**Corollary — the ban on `--bare`/`--safe-mode` is restated as a STATE ban, not a
flag ban.** Both flags document that they *set an environment variable*
(`CLAUDE_CODE_SIMPLE=1`, `CLAUDE_CODE_SAFE_MODE=1`), and environment variables
are inherited by child processes: a friend's shell profile, or a parent Claude
Code session, can put a child into the forbidden state with no forbidden flag
anywhere. The engine adapter therefore scrubs an explicit deny-list
(`CLAUDECODE`, `CLAUDE_CODE_ENTRYPOINT`, `CLAUDE_CODE_SSE_PORT`,
`CLAUDE_CODE_SIMPLE`, `CLAUDE_CODE_SAFE_MODE`) and asserts the resulting state on
the init receipt. The probe harness already does this; the product rule in
`CLAUDE.md` §3 is updated to match.

**2. The init receipt is a gate, not telemetry.** Before a stage session is
allowed to do any work, the orchestrator asserts on its init event:
Atlas present in `mcp_servers` with a connected status; expected plugin(s) in
`plugins`; `permissionMode` as requested; `model` as routed; `claude_code_version`
inside the tested range; `apiKeySource` consistent with the detected auth mode.
Any mismatch fails the phase **before** tokens are spent, with a plain-language
cause. This single mechanism closes the silently-ignored-settings hazard, the
silently-absent-Atlas hazard, and the stale-CLI hazard at once.

**3. `MessageDisplay` rewriting is adopted as a real mechanism — with its fail-open
caveat stated.** The engine emits the original text when a MessageDisplay hook
fails, so the rewrite is best-effort. The cockpit's whitelist renderer remains
the guarantee; the hook is the second net, now known to actually reach the
surface.

**4. `apiKeySource` is the auth-mode discriminator.** Observed `none` on the
owner's subscription session. Combined with `claude auth status --json`
(`apiProvider`, `subscriptionType`), Guidelane can report auth mode without ever
touching a credential, and must project only `{isSubscription, provider}` —
never the email/org fields that sit beside them. Consequence: the earlier
`--max-budget-usd` result was measured **under subscription auth**
(`apiKeySource: none`), which settles REVIEW-01's open hypothesis — the flag is
enforced, not inert. It is promoted from "secondary guardrail" to "usable
ceiling", while timeouts and cycle caps remain primary because no engine-side
timeout flag exists at all.

## Amendment: the built-in floor (measured at sprint close, 2026-07-30)

An architecture review of the probe harness pointed out that
`p-ambient-isolation` asserted a *relative* inequality — "is the isolated run
smaller than the leaky one?" — and therefore could never falsify this ADR's
*absolute* claim. It passed green while its own committed evidence recorded
`skills: 16, agents: 5` still present under the isolation pair.

Measured directly, by name rather than by count:

```
plugins      = []          mcp_servers = []      permissionMode = default
skills  (16) = batch, claude-api, code-review, dataviz, debug, deep-research,
               design-sync, doctor, fewer-permission-prompts, loop, run,
               run-skill-generator, schedule, simplify, update-config, verify
agents   (5) = Explore, Plan, claude, general-purpose, statusline-setup
```

None of these are the operator's; the operator's set was 24 skills and 10
agents, including personal ones. **The isolation pair works — it removes the
operator's configuration completely. What remains is the CLI's own built-in
floor, which no flag removes.**

Three consequences, all of which are decisions:

1. **The guarantee is restated**: the isolation pair gives a session free of
   *operator* configuration, not an empty session. Prose that said otherwise
   (this ADR §1, PROJECT_MAP §7 glossary) is corrected.
2. **The floor is pinned by name, not by count.** `p-ambient-isolation` now
   fails if the isolated run contains anything outside the enumerated baseline
   above. A 17th skill appearing in a CLI release is a red build, which is the
   only way a silent context change gets noticed.
3. **The built-ins are reachable, so the allow-list must account for them.**
   `loop`, `deep-research` and `run` are exactly the kind of open-ended
   behaviour a gated pipeline must not have available mid-stage, and
   `Explore` / `Plan` / `general-purpose` are dispatchable. Stage sessions
   therefore do **not** receive `Task` or `Skill` in `--allowedTools` unless a
   stage's design explicitly calls for it. This is now part of the per-stage
   allow-list contract from ADR-007, not an afterthought.

A fourth consequence surfaced when the isolation pair was applied to every probe
spawn: **`InstructionsLoaded` stops firing.** With `--setting-sources ''` there
is no settings-sourced `CLAUDE.md` to load, so the hook that announces it never
runs (7 lifecycle events instead of 8). Nothing depends on it today, and it is
the correct behaviour — but it confirms that the behaviour pack's instructions
must reach a stage session through `--append-system-prompt` and `--plugin-dir`,
never through a settings-sourced memory file.

The general lesson, recorded because it will recur: **a relative assertion can
never falsify an absolute claim.** The init-receipt gate this ADR introduces is
the single most tempting place to repeat the mistake — assert equality against a
pinned expectation, never "better than before".

## Consequences

### Positive
- Reproducible sessions: a friend's machine and the owner's machine now produce
  the same context package.
- Whole classes of silent failure (bad settings, missing Atlas, stale CLI, wrong
  permission mode) become loud, cheap, pre-flight failures.
- The non-engineer surface keeps a working in-engine net.

### Negative / accepted trade-offs
- Every spawn carries more flags, and the behaviour pack must supply everything
  the session needs, since nothing is inherited any more.
- Init assertion adds a failure mode of its own: too strict, and a harmless CLI
  change blocks all work. Assertions are therefore scoped to fields the product
  genuinely depends on, and the nightly conformance probe is what detects drift.

### Follow-up work required
- [ ] S1/S2: implement `assertInitReceipt(expected)` in the engine adapter; make
      it the first thing every stage does.
- [ ] S1: env deny-list scrub in the adapter (already prototyped in
      `tools/probe/lib/runner.mjs`).
- [ ] Track the remaining REVIEW-02 runtime gaps (control channel,
      `request_user_dialog`, dropped `permission_denied` frames, in-stage
      auto-compaction, thinking deltas, orphaned child processes, stall
      baseline, `interrupt` for the cockpit's stop button) as S1 blockers.

## References

- `docs/research/REVIEW-02-runtime-gaps.md` — the audit that surfaced these.
- `tools/probe/probes.mjs` — `p-init-receipt`, `p-ambient-isolation`,
  `p-messagedisplay-rewrite`; results in `docs/research/S0-conformance-report.md`.
