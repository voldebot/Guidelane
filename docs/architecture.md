# Guidelane — Architecture

> Source of truth for stack, system boundaries, and non-negotiables.
> `CLAUDE.md` is the summary; this is the detail; the research docs are the depth.
> Where this file and `docs/research/REVIEW-01-independent-findings.md` conflict, REVIEW-01 wins.

## 1. System overview

Guidelane is four cooperating local components wrapped around an official vendor
CLI engine. The user talks to the **cockpit**; the **orchestrator** moves their
project through fixed stages (Fikir → Tarif → Plan → Yapım → Kontrol → Hazır)
and enforces gates the model cannot open; the **engine adapter** spawns one
fresh, role-routed `claude` session per stage over the stream-json protocol; and
**Atlas** (our MCP server) supplies architecture knowledge, quality standards,
project impact maps, and the project's own decision ledger — pushed into every
session, not merely available. A **behaviour pack** (Claude Code plugin) carries
persona, hooks, and guards into the engine; it also works standalone inside
Claude Code (dual surface).

**Tier 1 (must work for the pilot):**
- Production line with G0–G6 gates; Local web-app profile; blueprint with
  invariants + acceptance scenarios; verify screen with screenshots; honest
  degradation UX; language dial; code maps; crew presets (simple picker);
  Night Shift (owner-mode); owner-installed pilot distribution.

**Tier 1.5 (pilot-exit gate):**
- Double-clickable desktop package (Tauri shell) — required before anyone
  outside the pilot circle installs it.

**Tier 2 (v1.1+):**
- Publishable profile (Postgres) + deploy adapters; GLM/Codex engines (behind
  written confirmations / owner-accepted risk); contract-change tripwire +
  anchor re-verification; full telemetry dashboard; 5-class proportionality;
  local-model playground; Windows.

**Out of scope:** freeform stacks; gate bypass; hosted service; ToS workarounds;
commercial features.

## 2. Stack decisions

### Cockpit (frontend)
- **Framework**: React 19 + Vite (SimpleUI-derived; MIT notice in THIRD-PARTY-NOTICES.md)
- **Language**: TypeScript strict
- **Styling**: Tailwind v4
- **State**: local state + one store for run/board state (Zustand)
- **Dev URL**: `http://localhost:5180`
- **Why**: fastest path to a real friend test; all strings behind an i18n layer from day one (ADR-006)

### Orchestrator + engine adapter (backend, local process)
- **Runtime**: Node 22 (present on owner's machine), plain TypeScript
- **Engine protocol**: `claude -p --input-format stream-json --output-format stream-json --include-partial-messages --include-hook-events`
- **Session profile (measured, ADR-007 + ADR-008)**: `--permission-mode auto` **plus** an explicit per-stage `--allowedTools` (auto alone denies), the isolation pair `--strict-mcp-config --setting-sources ''`, Atlas re-added via `--mcp-config`, behaviour pack via `--plugin-dir`, and a scrubbed child env (5-key deny-list + `DISABLE_AUTOUPDATER=1`)
- **Pre-flight**: no stage does work before its `system/init` receipt is asserted — Atlas **registered** in `mcp_servers`, plugin present, `permissionMode`/`model` as routed, version in range, `apiKeySource` as expected. This is the only defence against `--settings` being silently ignored in `-p`. The receipt cannot prove Atlas is *reachable*: `mcp_servers[].status` races the init emit (measured `pending` then `connected` across identical runs, with no correcting event), so connectivity is proven by calling a cheap Atlas tool, never by reading the field
- **Session profiles**: role → (engine, model, effort) per ADR-004; fresh session per stage; `--resume` session-reuse mode kept as the measured fallback
- **Hard rules**: the forbidden *state* (`CLAUDE_CODE_SIMPLE` / `CLAUDE_CODE_SAFE_MODE`) is scrubbed from the child env rather than the flags merely being avoided — env is inherited, flags are not the only door; auto-update disabled in child env; tested CLI version range enforced. Per-stage timeouts + cycle caps + retry ceilings remain the primary guardrails **because no engine-side timeout flag exists at all**; `--max-budget-usd` is measured as *enforced* under subscription auth (ADR-008) and serves as a secondary ceiling

### Atlas (MCP server)
- **Transport**: stdio, delivered per-session via `--mcp-config` — **never** bundled in the plugin, because `--strict-mcp-config` excludes plugin-bundled servers too (ADR-007). Tool naming: `mcp__<serverKey>__<tool>`
- **Storage**: single-file SQLite + FTS5; query path never writes
- **Subsystems**: knowledge (3 kinds, architecture-first) · project graph (v1: TypeScript — tsc + import graph; per-language adapter interface preserved) · ledger (outcomes + project auto-ADRs)
- **Serving**: pushed slices assembled by the orchestrator (invariants always; impact maps consumer-gated; ground-truth digest) + pulled tools under progressive disclosure

### Generated-project profile v1: `local-web`
- Next.js + Tailwind v4 + SQLite via Drizzle; zero external accounts
- **Gate harness** (ships inside the profile): eslint, `tsc --noEmit`, unit runner, build, boot + health, Playwright smoke, axe-core a11y
- **Ready (post-G6)**: packaged local build + launcher, so the product exists without Guidelane running; eject guarantee — a standard project with no Guidelane runtime dependency

### Infrastructure
- **Hosting**: none — everything is a local process (invariant)
- **CI**: GitHub Actions — lint/type/test + `claude plugin validate --strict` + nightly S0 conformance probe against latest CLI
- **Secrets**: none held; engines carry their own auth

## 3. Domain model (high-level)

```
Project ──1:1── Blueprint (canonical EN + rendered view; invariants[]; acceptance[])
   │ ──1:1── Plan (phases[], each: outcome, touch-set, handoff)
   │ ──1:N── PhaseRun (session-id, artifacts, gate results, waivers)
   │ ──1:N── DecisionCard (parked choices → morning/user)
   │ ──1:N── LedgerEntry (auto-ADRs, outcomes)   [Atlas SQLite]
   │ ──1:1── Graph (files, exports, imports, tests)[Atlas SQLite]
   └── git repo (snapshot per stage transition; "Geri al")
```

Canonical artifact shapes live in `packages/orchestrator/src/schemas/` once code exists.

## 4. Service boundaries

| Module | Responsibility | Talks to |
|---|---|---|
| `apps/cockpit` | Render board/chat/verify; translate events; language dial | orchestrator (localhost API/WS) |
| `packages/orchestrator` | Stages, gates, artifacts, snapshots, Night Shift, crew routing, pushed-slice assembly | engine adapter, Atlas, git, profile harness |
| `packages/engine` | Spawn/steer official CLIs; stream-json codec; init-receipt assertion; env scrub; version governance; rate-limit pause (sleep to `resetsAt`, backoff only as the unknown-error fallback) | `claude` binary (later `codex`) |
| `packages/atlas` | Knowledge/graph/ledger over stdio MCP; corpus builder; graph indexer; FILEMAP/@MAP writer | SQLite; consumed by engine sessions + orchestrator |
| `packages/plugin` | Persona, interviewer agent, translation + fail-closed hooks; dual surface | installed into engine sessions via `--plugin-dir` |
| `profiles/local-web` | Scaffold + gate harness + template docs | consumed by orchestrator |

## 5. Cross-cutting concerns

- **Language**: ADR-006 — user-facing in user language; internal always English; blueprint dual-form.
- **Error strategy**: honest degradation — retry caps, then plain-language escalation; never silent retries or fake success.
- **Validation**: schema-valid artifacts via `--json-schema` at the protocol level. The engine's internal retry is **bounded** — `error_max_structured_output_retries` is a terminal state G1 must map to a plain-language escalation, not an unhandled crash (REVIEW-02 B4).
- **Logging**: per-run artifact store + per-session JSONL; morning report includes rate-limit pauses. The per-run cost line shows token counts or a **labelled** figure — never a bare dollar amount, until it is known whether `total_cost_usd` is billed or an API-price estimate under subscription auth (REVIEW-02 C3).
- **PII**: none collected; everything stays on-disk locally. `claude auth status --json` returns `email`/`orgId`/`orgName` alongside the fields Guidelane needs — the adapter projects `{loggedIn, authMethod, subscriptionType}` and drops the rest at the boundary (ADR-008).
- **Compliance posture**: respect provider limits; no retry-hammering at window reset; no multi-account rotation; written inquiries to z.ai and Anthropic tracked in PROJECT_MAP §6.

## 6. Performance / economy budgets

| Metric | Target | Failure threshold |
|---|---|---|
| Pushed slice per session | ≤ 2–3K tokens (small class ≤ ~500) | > 4K |
| Trivial change cost | 2 light sessions, sub-1K pushed context | full-line machinery on a `small` job |
| Fresh-session premium | ≤ 1.3× long-session baseline (S2 benchmark) | > 1.3× ⇒ enable session-reuse mode |
| Night run integrity | crash loses ≤ 1 cycle; report truthfulness 100% | any silent loss or fake success |

## 7. Security posture

- The **engine** is the fail-closed layer (`auto` + explicit allow-list); the `PreToolUse` guard and `--disallowedTools` baseline are defence in depth, not the primary control. Review sessions read-only by `--tools` scoping.
- **Denied-tool detection runs on a lossless channel.** The engine's `permission_denied` advisory frames are droppable under load, so neither their presence nor their absence is evidence. A phase with no file changes and no lossless denial evidence fails as *unverified* (REVIEW-02 A3).
- **`--permission-mode auto` is not a constant across machines**: the classifier lives in per-machine user settings. G0 doctor asserts `auto-mode config == defaults` or reports the drift (REVIEW-02 C1).
- G5 security lens = the 7 blindspot questions; invariants asked per-diff.
- Generated profile ships secure defaults (no secrets in code; local SQLite file perms).

## 8. Open questions

Tracked in PROJECT_MAP §6 (single source): K4 repo account, K5 OS mix, z.ai +
Anthropic written replies, S0 probe outcomes, S2 cost benchmark, pilot ceremony
tolerance, crew efficacy telemetry.

## 9. Active ADRs

- [ADR-001](decisions/ADR-001-engine-official-cli-subprocess.md) — Engine = official vendor CLI subprocess
- [ADR-002](decisions/ADR-002-gated-production-line.md) — Gated production line; no self-certification
- [ADR-003](decisions/ADR-003-atlas-mcp.md) — Atlas MCP
- [ADR-004](decisions/ADR-004-crew-routing.md) — Crew routing
- [ADR-005](decisions/ADR-005-v1-scope-per-review-01.md) — v1 scope per REVIEW-01
- [ADR-006](decisions/ADR-006-language-dial.md) — Language dial
- [ADR-007](decisions/ADR-007-headless-engine-contract.md) — Headless engine contract, as measured
- [ADR-008](decisions/ADR-008-session-isolation-and-init-receipt.md) — Session isolation + the init receipt

---

*Created: 2026-07-30. Architecture changes require an ADR.*
