---
context_priority: high
project: "Guidelane"
created: "2026-07-30"
last_sprint_close: "2026-07-31 (S0 — engine conformance, post-audit hardening)"
current_sprint: "S1 — cockpit + engine adapter (opened 2026-07-31, gated on REVIEW-02 Tier A)"
---

# Guidelane — Project Map

> The cross-sprint memory atlas. Stays under 500 lines. Active decisions only — superseded items collapse to bottom. Deep dives live in `docs/decisions/` (ADRs) and `docs/research/`. Code structure index: `docs/FILEMAP.md` (will exist once code does).
>
> **Update trigger**: `/sprint-close` skill. Manual edits outside sprint close should be rare.

## 1. Charter (rarely changes)

**Mission**: Let non-coders who already pay for an AI coding subscription build
real, working software on their own machine — by enforcing, in code, the process
discipline that LLMs won't hold on their own: staged pipeline, machine-verified
quality gates, always-present product memory, plain-language surface. Open
source (MIT), non-commercial, zero Guidelane-operated servers.

**Non-negotiable invariants**:
- Guidelane never holds, sees, or stores any subscription credential; engines are official vendor binaries under the user's own login.
- No ToS workarounds, ever — including PTY-as-billing-dodge and multi-account rotation. Compliance is the product's identity.
- No claim is accepted from the session that produced the work (three-grade verification, ADR-002).
- Everything runs on the user's machine; no Guidelane server exists.
- User-facing = user's language; everything internal = English (ADR-006).
- Generated projects are standard, boring projects — the user can always leave (eject guarantee).
- Quality gates scale (small/full) but never skip; data/auth always full.

**Success criteria**:
- A non-coder friend (owner-installed) takes an idea to a running, machine-verified local product and accepts it at G6 — without seeing a file path, terminal, or diff.
- A Night Shift run completes ≥1 phase unattended and produces a truthful morning report including rate-limit pauses.
- The same behaviour pack works inside Claude Code as a plugin (dual surface).

**Intentionally out of scope**:
- Freeform stacks; gate-bypass modes; hosted service; commercial anything.
- v1: second stack profile, deploy adapters, local-model engines, 5-class proportionality, full telemetry dashboard, contract tripwire + anchor re-verify (all v1.1+ per ADR-005).

## 2. Principles & Conventions

1. **Process is code; content is model.** If a constraint matters, it is a gate, a tripwire, or an always-pushed invariant — never only a memory or a prompt.
2. **Evidence over claims.** "Works" = exit code, boot, screenshot, or the user's own click — in that order of preference.
3. **Honest degradation.** Retry caps + plain-language "I tried 3 times and failed; let's simplify" beat silent retries and fake success.
4. **Small jobs stay small.** Two change-classes; doubt rounds up; a button-color change never wakes the top model.
5. **Structure pays the token bill**: maps over searches, digests over transcripts, fresh sessions over drifting ones (with the S2 cost benchmark as the check).
6. **Credit donors, keep notices**: WrongStack and taste-skill are MIT — copied code carries THIRD-PARTY-NOTICES.md entries.
7. **The plan's authority chain**: measurement > REVIEW-01 > RESEARCH-02 > RESEARCH-01, where they conflict. An ADR backed by a probe (ADR-007, ADR-008) overrides any research prose about engine behaviour, including prose I wrote confidently.
8. **A binary string is evidence a code path exists, not that it fires.** Static extraction sets the probe agenda; only a live run sets a decision.
9. **Assert where the adversary is.** Three review passes over S0 found the same defect 22 times: *inferred where it should have asserted, and every inference failed open.* Three tests before shipping any guard — **can it fire?** (an assertion over the same constant its own delete loop just used cannot); **is it a constraint or a convention?** (a comment saying "for non-session tools" stops nobody); **does it have a pinned expectation?** (a counter nothing compares against falsifies nothing).

## 3. Domain Map (bounded contexts)

| Context | Responsibility | Key files | Status |
|---|---|---|---|
| Orchestrator | State machine Fikir→Hazır, gates G0–G6, artifact store, git snapshots, Night Shift supervisor, crew routing core | `packages/orchestrator/` (not yet created) | active (design) |
| Engine adapter | Spawn official CLIs, stream-json codec, session profiles (role→model+effort), version governance, rate-limit pause | `packages/engine/` (not yet created) | active (design) |
| Cockpit | Localhost UI: board, interview, blueprint approval, activity feed, verify screen, morning report, language dial | `apps/cockpit/` (not yet created) | active (design) |
| Atlas | MCP server: architecture-first knowledge, quality standards, task patterns; project graph + impact maps; decision ledger; corpus builder + graph indexer | `packages/atlas/` (not yet created) | active (design) |
| Behaviour pack | Claude Code plugin: persona, interviewer, translation hooks, fail-closed guards; dual surface | `packages/plugin/` (not yet created) | active (design) |
| Stack profile: local-web | Next.js + Tailwind + SQLite scaffold + gate harness (lint/type/test/build/smoke+axe) | `profiles/local-web/` (not yet created) | active (design) |
| Conformance probe | The engine-contract regression suite: 30 probes (13 free, 17 live), baseline gate, cross-process lock, report generator, CI wiring. Seeds `packages/engine`'s spawn layer | `tools/probe/` — **SHIPPED (S0)** | active (built) |

## 4. Active Decisions Index

| ADR | Title | Date | Sprint | One-line summary |
|---|---|---|---|---|
| [ADR-001](docs/decisions/ADR-001-engine-official-cli-subprocess.md) | Engine = official vendor CLI subprocess | 2026-07-30 | pre | Spawn `claude`/`codex` under the user's own login; zero credentials; PTY = technical fallback only, never a billing workaround |
| [ADR-002](docs/decisions/ADR-002-gated-production-line.md) | Gated production line; no self-certification | 2026-07-30 | pre | Fixed stages + gates the model cannot open; three-grade verification (machine / isolated-session / user) |
| [ADR-003](docs/decisions/ADR-003-atlas-mcp.md) | Atlas MCP: architecture-first knowledge + project graph + decision ledger | 2026-07-30 | pre | Own MCP server; pushed + pulled modes; SQLite; v1 graph depth = TypeScript |
| [ADR-004](docs/decisions/ADR-004-crew-routing.md) | Crew: per-role model+effort routing with recommendations | 2026-07-30 | pre | Role table with reasoned "Önerilen: model · effort" badges; presets; v1 = simple picker + per-run cost line |
| [ADR-005](docs/decisions/ADR-005-v1-scope-per-review-01.md) | v1 scope ratified per independent review | 2026-07-30 | pre | REVISE-FIRST accepted: single Local profile, owner-installed pilot, desktop package post-S4, 2-class proportionality, separate content track, 2.5–4 month honest calendar |
| [ADR-006](docs/decisions/ADR-006-language-dial.md) | Language dial | 2026-07-30 | pre | User-facing in user's language; all internal artifacts/code English; blueprint = English canonical + rendered approval view |
| [ADR-007](docs/decisions/ADR-007-headless-engine-contract.md) | Headless engine contract, as measured (S0) | 2026-07-30 | s0 | Permissions = `auto` + explicit per-stage allow-list (engine is fail-closed); Atlas ships via `--mcp-config` so `--strict-mcp-config` isolation survives; Night Shift sleeps to `rate_limit_event.resetsAt`. Corrects RESEARCH-01 §4.3 mech. 2 and ADR-003 delivery |
| [ADR-008](docs/decisions/ADR-008-session-isolation-and-init-receipt.md) | Session isolation + the init receipt | 2026-07-30 *(amended 2026-07-31)* | s0 | `--strict-mcp-config` **and** `--setting-sources ''` on every spawn (strict alone leaks the operator's plugins/skills/agents/permission mode); `system/init` asserted as a pre-flight gate, not telemetry; `--bare`/`--safe-mode` ban restated as a state ban with an env deny-list; MessageDisplay rewrite confirmed to reach stream-json; `apiKeySource` is the auth discriminator. **Two dated in-place corrections**: the built-in floor (§Amendment) and registration-vs-reachability (§2), the latter replacing a `status === 'connected'` gate that would have flaked |

## 5. Superseded & Rejected (Do-Not-Revisit)

- **Tried**: WrongStack as the runtime engine.
  **Switched to**: official CLI subprocess ([ADR-001](docs/decisions/ADR-001-engine-official-cli-subprocess.md)); WrongStack demoted to MIT code/architecture donor.
  **Revisit trigger**: WrongStack ships an engine mode that vendors bless in writing for subscription use.
- **Tried**: Claude Agent SDK as the subscription path.
  **Switched to**: official CLI subprocess (ADR-001).
  **Revisit trigger**: the SDK officially accepts subscription (non-API-key) auth.
- **Tried**: PTY transport framed as the billing-split hedge ("unambiguously first-party").
  **Switched to**: honest degradation — Agent-SDK credit + user notice; PTY kept only for technical removal of headless mode (ADR-001; REVIEW-01 #1).
  **Revisit trigger**: none for billing purposes — this is a compliance stance, not an engineering trade-off.
- **Tried**: `npx guidelane` as v1 distribution to non-coders.
  **Switched to**: owner-installed pilot + double-clickable desktop package pulled up to post-S4 (ADR-005; REVIEW-01 #2).
  **Revisit trigger**: npx stays fine for developers; non-coder distribution requires the desktop package, period.
- **Tried** (by the owner, May 2026): `/loop`-style single growing session for overnight runs.
  **Switched to**: phased headless — fresh session per phase, disk artifacts as memory (RESEARCH-03 §2).
  **Revisit trigger**: engine ships a native unattended loop with machine-verifiable gates and no compaction risk.
- **Tried**: 200–600 MB offline docs mirror with weekly refresh.
  **Switched to**: <20 MB curated patterns tier + crawl-and-cache (ADR-005).
  **Revisit trigger**: measured user demand for offline docs operation.
- **Tried**: 5-class proportionality machinery in v1.
  **Switched to**: 2 classes, small/full (ADR-005).
  **Revisit trigger**: v2, with real per-class telemetry to justify finer classes.
- **Tried**: `--max-budget-usd` as the headline safety guardrail.
  **Switched to**: per-stage timeouts + cycle caps + retry ceilings.
  **Status 2026-07-30 (S0, closed)**: observed *enforced* (~zero ceiling refused the call, exit 1) on a session whose init reported `apiKeySource: none` — i.e. under subscription auth. REVIEW-01's "inert under subscription" hypothesis is **refuted** ([ADR-008](docs/decisions/ADR-008-session-isolation-and-init-receipt.md)). Promoted to a usable ceiling; timeouts and cycle caps stay primary because **no engine-side timeout flag exists at all**.
  **Revisit trigger**: a user reports the flag being ignored on a machine whose init also reports `apiKeySource: none`.
- **Tried**: `--permission-mode auto` alone as the way to remove approval dialogs (RESEARCH-01 §4.3 mech. 2).
  **Switched to**: `auto` + explicit per-stage `--allowedTools` ([ADR-007](docs/decisions/ADR-007-headless-engine-contract.md)) — `auto` alone *denies* tool calls headlessly and the model may still claim success.
  **Revisit trigger**: a CLI release changes headless permission semantics (the nightly conformance probe would catch it).
- **Tried**: shipping Atlas as a plugin-bundled MCP server (ADR-003 as first written).
  **Switched to**: `--mcp-config` delivery with `--strict-mcp-config` always on (ADR-007) — `--strict-mcp-config` excludes plugin-bundled servers too, so bundling would have meant losing session hermeticity.
  **Revisit trigger**: the CLI gains a way to keep plugin-bundled servers under strict isolation.
- **Tried**: assuming no machine-readable rate-limit signal (blind backoff-poll as the mechanism).
  **Switched to**: parsing `rate_limit_event.resetsAt` and sleeping to the window boundary (ADR-007); backoff is now only the unknown-error fallback.
  **Revisit trigger**: the event disappears or changes shape in a CLI release.
- **Tried**: `--strict-mcp-config` alone as the session-isolation mechanism.
  **Switched to**: `--strict-mcp-config` **plus** `--setting-sources ''` on every spawn ([ADR-008](docs/decisions/ADR-008-session-isolation-and-init-receipt.md)) — strict alone isolates MCP only and still inherited 4 plugins, 24 skills, 10 agents and the operator's `bypassPermissions` default.
  **Revisit trigger**: the CLI merges the two isolation surfaces into one flag.
- **Tried**: treating the `system/init` event as telemetry (logged, never asserted).
  **Switched to**: init as a pre-flight **gate** — Atlas registered, plugin loaded, permission mode, model, CLI version and `apiKeySource` all asserted before a stage does any work (ADR-008). The `-p` help states settings failing validation are *silently ignored*, so without a positive receipt the whole hook layer can vanish without a signal.
  **Revisit trigger**: none — this is the cheapest failure detector the engine offers.
- **Tried**: gating that receipt on `mcp_servers[].status === 'connected'` (ADR-008 decision 2, as first written).
  **Switched to**: gating on **registration**, and proving connectivity with an actual Atlas tool call ([ADR-008](docs/decisions/ADR-008-session-isolation-and-init-receipt.md) §2 correction, measured 2026-07-31). The status field races the init emit: identical runs read `pending` and then `connected`, and no later event ever corrects it. The stricter-sounding gate was the flakier one.
  **Revisit trigger**: the stream gains an `mcp_status` event — then connectivity becomes assertable without a call.
- **Tried**: reading a session's MCP tool inventory out of `init.tools`.
  **Switched to**: `init.mcp_servers[].name` for registration, and the measured naming rule `mcp__plugin_<plugin>_<server>__<tool>` for the allow-list entry. `init.tools` carries the ~30 built-in names and **never** an `mcp__` name; no MCP tool name appears anywhere in the stream until the tool is actually called. A probe built on `init.tools` was structurally incapable of passing and nearly got baselined red.
  **Revisit trigger**: `init.tools` starts including MCP names — verify before trusting it.
- **Tried**: scrubbing only the five `CLAUDE_CODE_*` nesting markers from a child's environment.
  **Switched to**: also scrubbing the nine **backend-routing** variables (`ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_API_KEY`, `CLAUDE_CODE_USE_BEDROCK`, …), and **asserting `init.apiKeySource`** instead of merely recording it. Those variables change *which engine answers*, and `ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN` is precisely how z.ai's coding plan points `claude` at GLM — a plan this project intends to ship. Left in the owner's shell, a full `--live` run would have measured GLM, printed `2.1.220`, satisfied the version gate, and been committed as ADR-007/008 evidence about Anthropic's engine.
  **Revisit trigger**: probing a non-subscription auth path deliberately — set `GUIDELANE_EXPECT_API_KEY_SOURCE`, never widen the scrub.
- **Tried**: asserting the env deny-list inside `scrubbedChildEnv`, immediately after the delete loop.
  **Switched to**: asserting at the **spawn site**. The original was a tautology — it iterated the same constant the delete loop had just iterated, in the same function, with nothing in between; there was no execution path on which it could throw, while its comment claimed it would catch "a caller defeating the deny-list". The boundary with an adversary is `spawnCapture`, which accepted any `env` and asserted nothing (an omitted `env` inherits the parent's environment in full, forbidden state included).
  **Revisit trigger**: none. A guard that cannot fail is decoration.
- **Tried**: applying the isolation pair inside `claude()`, the intended session entry point.
  **Switched to**: applying it in `run()`, the single spawn chokepoint, with `--setting-sources` checked by **value** rather than presence. `ctx.spawnCapture` was documented "for non-session tools" — a convention, not a constraint — so a probe could spawn a fully un-isolated session that incremented no counter while the report still printed "Sessions spawned without the isolation pair: 4".
  **Revisit trigger**: none — this is the same fail-closed-by-construction principle as the env deny-list.
- **Tried**: three probes that asserted on the model's own output — "list your mcp__ tools", "describe your config", "did you dispatch the subagent?".
  **Switched to**: engine-emitted fields only (`init.mcp_servers`, `init.agents`, `tool_result.is_error`, a `claude doctor` differential). Every one of the three was wrong, and two of them passed once before flipping — an assertion on generated prose measures the model, not the engine, and it is non-deterministic by construction.
  **Revisit trigger**: none. This is the suite's central rule.
- **Tried**: banning `--bare` and `--safe-mode` as *flags*.
  **Switched to**: banning the *state* — both flags merely set `CLAUDE_CODE_SIMPLE` / `CLAUDE_CODE_SAFE_MODE`, which a parent shell or a parent Claude Code session can set with no flag present. The adapter scrubs a five-key env deny-list and asserts the result on the init receipt (ADR-008).
  **Revisit trigger**: the CLI stops exposing these modes via environment.
- **Tried**: asserting isolation with a *relative* check ("is the isolated session smaller than the leaky one?").
  **Switched to**: equality against a **named, pinned baseline** (ADR-008 amendment). The relative form passed green for a full day while its own committed evidence recorded 16 skills still present — a relative assertion can never falsify an absolute claim.
  **Revisit trigger**: a CLI release changes the built-in set — re-pin deliberately, never by widening the assertion.
- **Tried**: redaction as a per-probe discipline, with a display truncator (`clip`) standing in as the security control.
  **Switched to**: one enforced redaction boundary at serialization (`tools/probe/lib/redact.mjs`), plus a CI grep over the committed artifacts. The opt-in form had already published the owner's home path, username and the macOS temp-dir salt into a file destined for a public repo.
  **Revisit trigger**: none. Anything opt-in fails open for every probe written after it.
- **Tried**: typing the isolation flags into each probe's argument list.
  **Switched to**: the harness adds the pair to every session spawn, with an `ambient: true` opt-out recorded in the report. 14 of 19 spawns were missing at least one flag, and one of them published a paraphrase of the operator's private global constitution.
  **Revisit trigger**: none — this is the same fail-closed-by-construction principle as the env deny-list.
- **Tried**: running the full nightly conformance suite in GitHub Actions (ADR-001/ADR-007 both say "nightly in CI").
  **Switched to**: a two-tier split — free tier in Actions (pinned CLI, every push + daily), `--live` on the owner's machine via launchd (`tools/probe/README-ci.md`). A CI runner has no subscription login, and ADR-001 forbids putting one there, so the tier that makes real engine calls can only run where a human is already signed in. The invariant constrains its own CI story.
  **Revisit trigger**: a vendor ships a CI-legitimate auth path for subscription use — which is exactly what the pending Anthropic inquiry asks about.
- **Tried**: "a tool-denied stream event is a loud phase failure" as the denied-tool detector (CLAUDE.md §3, as first written).
  **Switched to**: a detector on a **lossless** channel — the binary logs `dropping oldest permission_denied advisory frames`, so the advisory frame is best-effort telemetry, not evidence (REVIEW-02 A3).
  **Revisit trigger**: A3 measurement names the lossless channel (expected: `tool_result.is_error`); until then no code may depend on the advisory frame.

## 6. Open Questions & Tech Debt Ledger

| Question / debt | Noted | Status | Owner | Notes |
|---|---|---|---|---|
| K5: friends' OS mix | 2026-07-30 | **DECIDED (2026-07-30)** | owner | **macOS only for now** — "önce bu mac'te çalışır hale getireceğiz". Windows is deferred, not dropped: the process-group kill in `tools/probe/lib/runner.mjs` is POSIX-only and needs a `taskkill /T /F` branch before S7 |
| K4: GitHub account for the public repo | 2026-07-30 | **DECIDED (2026-07-30)** | owner | `voldebot`, public. Repo doubles as the plugin marketplace |
| z.ai written confirmation (GLM allowlist covers Guidelane-driven Claude Code) | 2026-07-30 | **drafted, unsent — re-gated 2026-07-31** | owner | `docs/inquiries/zai-glm-coding-plan-allowlist.md`. Still gates the GLM engine (S6); no longer gates local proof |
| Anthropic written inquiry (headless subscription use at Guidelane's pattern) | 2026-07-30 | **drafted, unsent — RE-GATED 2026-07-31 to pilot-install** | owner | `docs/inquiries/anthropic-headless-subscription-use.md`. Was an S0/S1 exit criterion (REVIEW-01 #1); the owner moved it behind "prove the system runs on this machine first". Valid while it is the owner's own subscription and nothing is installed for anyone else — the first friend's pilot install is the hard gate. Also the revisit trigger for the CI tier split |
| **No OpenAI inquiry exists, and Codex needs one** | 2026-07-31 | **open — write before Codex ships** | owner | `codex` under a ChatGPT subscription raises the same headless-automation question as `claude` under Max. Only the Anthropic and z.ai letters are drafted, which makes `docs/inquiries/` look complete when it is not |
| `--max-budget-usd` under subscription auth | 2026-07-30 | **RESOLVED (S0)** | — | Enforced on a session reporting `apiKeySource: none`. Usable ceiling; timeouts stay primary (ADR-008) |
| Auth-mode detection (subscription vs API key) without reading credentials | 2026-07-30 | **RESOLVED (S0)** | — | `claude auth status --json` → `loggedIn, authMethod, apiProvider, subscriptionType` (+ `email/orgId/orgName`, which Guidelane must never log or display); `init.apiKeySource` is the in-session discriminator |
| **Tier A — 7 runtime unknowns that can stall the feed** (control channel, stream type/subtype union, lossless denial signal, `request_user_dialog`, stall baseline + stdout backpressure, thinking deltas, hook fail-open detectability) | 2026-07-30 | **open — S1 BLOCKERS** | S1 | [REVIEW-02](docs/research/REVIEW-02-runtime-gaps.md) §3. Four of the seven can produce "the feed silently stops", the worst outcome for a non-coder. S1 does not ship a feed before these are answered |
| **Tier B — 10 runtime unknowns** (orphans/resume after kill -9, `interrupt` as the stop button, in-stage auto-compaction, `--json-schema` retry ceiling, headless logged-out hang, model-fallback + effort clamping, concurrency, JSONL framing at size, long-idle survival, UTF-8/Turkish round-trip) | 2026-07-30 | open — S2/S3 | S2–S3 | [REVIEW-02](docs/research/REVIEW-02-runtime-gaps.md) §4. B1 is the S2 exit gate; B7 gates parallel review lenses; B10 is invisible to English-language tests |
| Auto-mode classifier drift across machines | 2026-07-30 | **measured here, open elsewhere** | S1 | `claude auto-mode config` == `defaults` byte-for-byte on the owner's machine, but the effective classifier is per-machine user settings — so what `auto` *means* can differ on a friend's laptop. Becomes a doctor check (REVIEW-02 C1) |
| What `total_cost_usd` actually is under subscription auth | 2026-07-30 | open — S1 | S1 | Estimated API-equivalent vs billed. Until answered, the cockpit shows token counts or a labelled figure — never a bare dollar amount (REVIEW-02 C3) |
| Fresh-session cost premium vs long session | 2026-07-30 | open — S2 benchmark | S2 | >1.3× ⇒ session-reuse mode for consecutive phases |
| Rate-limit signal shape from CLI | 2026-07-30 | **RESOLVED (S0)** | — | `rate_limit_event` carries `status`, `rateLimitType: five_hour`, `resetsAt` (epoch). Supervisor sleeps to the boundary (ADR-007). Only the healthy branch observed; rejected branch handled defensively |
| Auto-updater governance in spawned children | 2026-07-30 | **RESOLVED (2026-07-31)** | — | Two-arm `claude doctor` differential: `Auto-updates: enabled` → `disabled (set by env: DISABLE_AUTOUPDATER)`. The engine names the variable as the source. The earlier "unproven" verdict came from grepping `--help`, which documents flags, not env vars — the control was never going to be there |
| `PermissionRequest` hook behaviour when a tool is *not* pre-approved | 2026-07-30 | open — low priority | S4 | Did not fire under an allow-list (expected: nothing to decide). Only matters if a consent-card UX needs it |
| Gate-ceremony tolerance of real non-coders | 2026-07-30 | open — S3-era pilot | pilot | The product's biggest empirical unknown |
| Crew routing efficacy (quality vs token, per role) | 2026-07-30 | open — telemetry | ongoing | Presets are informed defaults, not measured optima |
| R5f corpus disk budget confirmation (~500 MB proposed, now largely moot after mirror cut) | 2026-07-30 | open | owner | Patterns tier <20 MB; confirm at K3 sign-off |
| `p-flag-surface` matched flags as substrings of the whole flattened help text | 2026-07-31 | **RESOLVED same day** | — | Two signals: substring (cheap, robust) plus an option-column parse, with FAIL when they disagree — present in the text, absent from the column, i.e. a flag that now exists only as prose about its own removal. `declaredCount` floored at 40 so a formatter change reports itself instead of libelling the engine. **The deferral's stated reason was wrong**: the column parser works (measured 69 declared, 0 of 33 required missed); the earlier throwaway found 0 because the line starts with two spaces and `split(/\s{2,}/)[0]` was the empty string. Test the worry before honouring it |
| One baseline asserted in two materially different environments | 2026-07-31 | **DECIDED — no split, no per-tier expectation** | — | The two environments *agree* today (6 green CI runs against a macOS-generated baseline; `run.mjs` exits 1 on any drift), and that agreement is the feature. Splitting would sanction a divergence that does not exist and leave each file unchecked by the other — a free probe regressing on macOS would be caught nowhere. **The rule instead: a probe whose STATUS depends on the environment is measuring the environment; fix the probe, never the baseline.** `p-auth-mode-visibility` is the worked example (branches on `loggedIn`, asserts something different but equally meaningful in each, stable status). `baseline.generatedOn` records platform + loggedIn so a future disagreement is attributable on sight. Named crack, then FALSIFIED by CI within the hour: I added a "vacuous pass" detector on the theory that a bare runner has no classifier rules — the runner in fact reports the same 17/65/1 as macOS, because `auto-mode config` returns the merged EFFECTIVE classifier, not an empty set. The branch could never fire and was removed. A guard that cannot fire is decoration; that is the third time this file produced that mistake |
| Harness module boundaries will not survive extraction into `packages/engine` as-is | 2026-07-31 | open — S1 | S1 | Three named issues: `LIVE_CHILDREN` is a process-wide singleton (Night Shift needs a per-supervisor `SessionRegistry`); `audit` is shared mutable state whose per-probe reset works only because every push site re-reads the property; and `spawnCapture` names two different functions depending on the importing module. Fold into task #17, not before |
| Two residual lifecycle nits accepted as unfixable-in-kind | 2026-07-31 | **accepted** | — | A freed pgid retained in `LIVE_CHILDREN` could in principle be reused before the exit-time group kill (POSIX will not recycle while the group has members, so the window is narrow and cannot be closed airtight). And `p-session-identity` deliberately omits `--no-session-persistence`, leaving two transcripts per `--live` run in `~/.claude` — bounded growth, cleanup is cosmetic |

## 7. Glossary

| Term | Definition | First used |
|---|---|---|
| **Gate (G0–G6)** | A stage-exit check the model cannot open: machine (exit codes, boot, screenshots), isolated second session (audit/review; blocking-with-caps), or the user (approval/acceptance) | RESEARCH-02 |
| **No-self-certification** | No claim is accepted from the session that produced the work; three verification grades | RESEARCH-02 §2 (restated per REVIEW-01) |
| **Atlas** | Guidelane's own MCP server: architecture-decision knowledge, quality standards, task patterns, project impact graph, decision ledger, outcome ledger | RESEARCH-01 §5, upgraded RESEARCH-02 §7 |
| **Crew (Kadro)** | Per-role engine/model/effort routing table with reasoned recommendation badges and presets | RESEARCH-02 §13.4 |
| **Night Shift (Gece Modu)** | Unattended overnight operation: preflight, backoff-poll rate-limit pausing, decision-card parking, truthful morning report | RESEARCH-02 §8.2 |
| **Blueprint (Tarif)** | Canonical English product spec (schema-valid) with invariants + acceptance criteria; rendered into the user's language for G1 approval | RESEARCH-02 §3 |
| **Invariants (Değişmezler)** | Plain-language product rules set at G1, always pushed to every session, asked one-by-one at G5 | RESEARCH-04 C3 |
| **Impact map (Etki haritası)** | Consumers + covering tests of files about to be touched; pushed before editing; given to the reviewer | RESEARCH-02 §7.2 |
| **Ground-truth refresh (Taze gerçek)** | Sessions open with regenerated state (FILEMAP digest, test status, gate results), never a prior session's claims | RESEARCH-04 C5 |
| **Change-class (İş sınıfı)** | `small`/`full`, classified from touched surface in code; doubt rounds up; data/auth always full | RESEARCH-02 §13.6 (simplified per REVIEW-01) |
| **Eject guarantee (Çıkış garantisi)** | Generated projects are standard projects with no Guidelane runtime dependency — the user can always leave | RESEARCH-02 §13.1 |
| **Dual surface (Çift yüzey)** | The behaviour pack works both under the cockpit and as a plain Claude Code plugin — also the vendor-moves survival strategy | RESEARCH-02 §13.7 |
| **Isolation pair** | `--strict-mcp-config` + `--setting-sources ''` on every spawn; nothing **of the operator's** reaches a stage session that the orchestrator did not put there. The CLI's built-in floor (16 skills, 5 agents on 2.1.220) remains and is pinned by name | ADR-008 + amendment |
| **Built-in floor** | The skills and agents no flag removes. Measured and pinned by name; a new entry in CI is a failure, not a warning. Because `loop`, `deep-research` and `general-purpose` are in it, stage allow-lists withhold `Task`/`Skill` unless a stage deliberately needs them | ADR-008 amendment |
| **Init receipt** | The session's first `system/init` event, asserted as a pre-flight gate (Atlas **registered**, plugin loaded, model, permission mode, version, `apiKeySource`) before any work. Carries registration, never reachability | ADR-008 |
| **Registration ≠ reachability** | An MCP server appearing in `init.mcp_servers` proves the engine was told about it, not that it answers. `status` races the init emit, so connectivity is proven by calling a tool | ADR-008 §2 correction |
| **Stream surface union** | The enumerated closed set of stream-json `type`/`subtype` values the cockpit whitelist must classify `render \| ignore \| escalate`; a new value in CI is a failure, not a warning | REVIEW-02 A2 |

---

## File pointers (read on demand, not auto-loaded)

- **ADRs**: `docs/decisions/ADR-00N-*.md`
- **Research**: `docs/research/RESEARCH-01..04`, **`docs/research/REVIEW-01-independent-findings.md` (governs v1 scope)**, **`docs/research/REVIEW-02-runtime-gaps.md` (governs the S1 engine work list)**
- **Measured engine behaviour**: `docs/research/S0-conformance-report.md` (+ `.json`) — 30 probes, regenerated by `node tools/probe/run.mjs --live`
- **Code structure index**: `docs/FILEMAP.md` (auto-generated once code exists)
- **Project constitution**: `./CLAUDE.md`

---

*Size watch: target <500 lines; archive oldest §4/§5 rows to `docs/atlas-archive/` at sprint close if needed.*
