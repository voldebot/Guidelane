@PROJECT_MAP.md

# Guidelane — Project Constitution

> Project-level overrides for the global constitution at `~/.claude/CLAUDE.md`.
> Inherit everything from global; only what's specific to THIS project is here.

## 1. What this is

Guidelane is a local-first, open-source (MIT, non-commercial) **production line
that lets non-coders build real, working software**. The user describes what they
want; official vendor CLI binaries (`claude`, later `codex`) do the thinking and
the coding as subprocesses under the user's own subscription login; **Guidelane's
own code enforces the process** — staged pipeline, quality gates, no
self-certification, plain-language surface. It includes its own MCP server
(**Atlas**: architecture-first knowledge, project impact graph, decision ledger),
an unattended **Night Shift** mode, per-role **crew** model routing, and a
user-selectable **language dial**.

**Target users**: non-coders who already pay for an AI coding subscription
(launch circle: the owner + friends; pilot installs are done by the owner in
person).
**Out of scope** (intentionally not building): freeform stacks outside the
profiles; any gate-bypass mode; any subscription-ToS workaround (credential
extraction, PTY-as-billing-dodge, multi-account rotation); a hosted Guidelane
service; anything commercial.

## 2. Stack

| Layer | Choice | Why |
|---|---|---|
| Cockpit (UI) | Vite + React 19, localhost web app (SimpleUI-derived, MIT notice kept) | Fastest honest surface; desktop (Tauri) package pulled up to post-S4 per REVIEW-01 |
| Orchestrator | Plain TypeScript, Node 22 | State machine + gates + artifact store; no framework needed |
| Engine | Official `claude` CLI spawned as subprocess, stream-json protocol | The only ToS-clean subscription path (ADR-001) |
| Atlas MCP | TypeScript, official MCP SDK, stdio, SQLite + FTS5 | Local, no daemon, progressive-disclosure-shaped (ADR-003) |
| Generated projects (v1 profile) | Next.js + Tailwind v4 + SQLite (Drizzle) — "Local web app" | Zero accounts, zero vendors, zero cost; gates need a known harness (ADR-005) |
| Verify harness | Playwright + axe-core | Machine-checkable boot/smoke/a11y evidence |

**See `docs/architecture.md`** for the full picture and `docs/decisions/` for ADRs.

## 3. Non-negotiables (project-specific guardrails)

- **Zero credentials, zero workarounds.** Guidelane never sees/stores any auth
  token. `claude auth status --json` may be read for `{loggedIn, authMethod,
  subscriptionType}` only — `email`, `orgId`, `orgName` sit in the same payload
  and are never logged, persisted, or displayed (ADR-008). PTY transport exists
  only as a technical-availability fallback — **never** as a billing-policy
  workaround (ADR-001, REVIEW-01 #1). If the billing split lands: Agent-SDK
  credit + honest user notice.
- **The forbidden state, not the forbidden flag.** `--bare` and `--safe-mode`
  merely *set* `CLAUDE_CODE_SIMPLE` / `CLAUDE_CODE_SAFE_MODE`, which a parent
  shell or a parent Claude Code session can set with no flag present. The adapter
  scrubs the five-key env deny-list (`CLAUDECODE`, `CLAUDE_CODE_ENTRYPOINT`,
  `CLAUDE_CODE_SSE_PORT`, `CLAUDE_CODE_SIMPLE`, `CLAUDE_CODE_SAFE_MODE`) on every
  spawn and asserts the result (ADR-008).
- **No self-certification, three grades** (ADR-002): functional claims are
  machine-verified (exit codes, boot, screenshots); judgment claims come from
  isolated second sessions and are *blocking-with-caps, not proofs*; builder-
  authored unit tests count as lint-grade — the independent functional net is
  Plan-authored acceptance scenarios + the template smoke suite.
- **Every engine session follows the measured contract** (ADR-007 + ADR-008):
  `--permission-mode auto` **plus an explicit per-stage `--allowedTools`** (auto
  alone denies silently); Atlas via `--mcp-config`, never plugin-bundled; the
  **isolation pair `--strict-mcp-config` + `--setting-sources ''` on every
  spawn** (strict alone still inherits the operator's plugins, skills, agents and
  permission default); Night Shift sleeps to `rate_limit_event.resetsAt`.
- **The isolation pair removes the operator's config, not the CLI's.** A built-in
  floor survives every flag — 16 skills including `loop`, `deep-research` and
  `run`, and 5 agents including `general-purpose` (pinned by name in
  `p-ambient-isolation`, ADR-008 amendment). Because open-ended behaviour is
  exactly what a gated pipeline must not have available mid-stage, **stage
  allow-lists withhold `Task` and `Skill`** unless a stage's design explicitly
  calls for them.
- **Assert equality against a pinned expectation, never "better than before".**
  A relative check cannot falsify an absolute claim; `p-ambient-isolation`
  passed green for a day while its own evidence recorded the leak it was there
  to catch.
- **No stage does work before its init receipt passes** (ADR-008). Assert on the
  first `system/init`: Atlas connected, expected plugin present, `permissionMode`
  and `model` as routed, CLI version in range, `apiKeySource` as expected. A
  mismatch fails the phase in plain language *before* tokens are spent — this is
  the only defence against `--settings` being silently ignored in `-p`.
- **A denied tool must be detected on a lossless channel.** The engine's
  `permission_denied` advisory frames are droppable under load (`dropping oldest
  permission_denied advisory frames`), so no code may treat their presence — or
  absence — as evidence. Until REVIEW-02 A3 names the lossless signal (expected:
  `tool_result.is_error`), a phase that produced no file changes and no denial
  evidence fails as *unverified*, never as success.
- **Language dial** (ADR-006): user-facing output in the user's language;
  *everything else* — code, comments, artifacts, ADRs, commit messages — English.
- **Review/audit sessions are read-only by construction** (`--tools` scoping),
  not by request.
- **REVIEW-01 governs v1 scope; REVIEW-02 governs the S1 engine work list; a
  measured ADR beats both.** Where research prose conflicts with a probe result,
  the probe wins — including prose written confidently (ADR-007, ADR-008).
- **Gates scale, never skip**: two classes (`small`/`full`); doubt rounds up;
  data/auth always `full`. Invariants are always pushed (≤~300 tokens), exempt
  from proportionality.
- **Engine sessions run with auto-update disabled** in the child env; tested
  CLI version range maintained. The conformance probe runs on a schedule in two
  places, and the split is an ADR-001 consequence, not an oversight: the **free
  tier in GitHub Actions** (a runner has no subscription login), the **`--live`
  tier locally** on a machine where the owner is signed in
  (`tools/probe/README-ci.md`).

## 4. Folder convention

```
Guidelane/
├── .github/workflows/     # engine-conformance.yml — free tier on push + daily (EXISTS)
├── tools/probe/           # S0 engine conformance probe (EXISTS — see README-ci.md)
├── apps/cockpit/          # localhost UI (S1+)
├── packages/orchestrator/ # state machine, gates, artifact store, night shift
├── packages/engine/       # engine adapter (spawn, stream-json, session profiles)
├── packages/atlas/        # MCP server + corpus builder + graph indexer
├── packages/plugin/       # Guidelane behaviour pack (Claude Code plugin)
├── profiles/local-web/    # v1 stack profile: scaffold + gate harness
├── docs/
│   ├── architecture.md
│   ├── decisions/         # ADR-00N-*.md (immutable once accepted)
│   └── research/          # RESEARCH-01..04 + REVIEW-01 (the plan's source of truth)
└── CLAUDE.md              # this file
```

(No code exists yet — this layout is the agreed target, first created at S0/S1.)

## 5. Sprint state

**Current sprint**: S0 (engine conformance) — **complete**. 26 probes on disk,
last full live run 24 pass / 0 fail / 2 partial / 0 error against CLI 2.1.220.
ADR-007 and ADR-008 are its output; REVIEW-02 is its honest gap list.
**Next**: S1 — cockpit + engine adapter, **gated on REVIEW-02 Tier A** (7 runtime
unknowns; four of them can stall the activity feed silently).
**Last sprint close**: 2026-07-30 (S0). Shipped: `tools/probe/` (27 probes),
ADR-007 + ADR-008, REVIEW-02, CI wiring, LICENSE, the two vendor inquiry drafts.

Memory: `~/.claude/projects/-Users-talhamac-Desktop-Projects-Guidelane/memory/`

## 6. Running locally

```bash
# S0 engine conformance probe (DONE — keep it green; it gates every CLI upgrade)
node tools/probe/run.mjs            # free tier: help-text + observational (9 probes)
node tools/probe/run.mjs --live     # + 17 real engine calls (uses --model haiku)
node tools/probe/run.mjs --list     # what it checks and why
node tools/probe/run.mjs --only p-init-receipt,p-ambient-isolation
# Writes docs/research/S0-conformance-report.md (+ .json). Exit 1 on fail/error.
# Probes run SEQUENTIALLY on purpose: concurrent sessions race on the same
# rate-limit window and make a limit event indistinguishable from a failure.

# Next: S1 — localhost cockpit + engine adapter on the ADR-007/008 contract,
# preceded by the REVIEW-02 Tier A protocol probes.
```

Dev URL (reserved): `http://localhost:5180` (5173/5174 are used by other local projects)
Type check: `npx tsc --noEmit` (once packages exist)
Tests: per-package `npm test` (once packages exist)

## 7. Quality gates (project-specific additions)

In addition to global gates (`~/.claude/CLAUDE.md` §6):

- **The product's own G-gates apply to the product's development too**: every
  stage of RESEARCH-02 §11 has a named validation gate — do not advance without it.
- Re-plan checkpoints after S2 and S4 (REVIEW-01 #4) are mandatory stops.
- `claude plugin validate --strict` + `plugin eval` must pass before any plugin ship.

## 8. Known limitations / debt

- **The S0 suite is strong on configuration and weak on runtime protocol.** It
  would pass green on a machine where the activity feed is unrenderable. The 7
  Tier A + 10 Tier B unknowns in `docs/research/REVIEW-02-runtime-gaps.md` are
  the honest debt; four Tier A items can make a run go silent with no terminal
  event, which is the worst possible failure in front of a non-coder.
- `p-autoupdate-governable` is a standing PARTIAL: no auto-update control was
  found in help text, so `DISABLE_AUTOUPDATER=1` is defensive, not proven.
- `p-agents-inline` is a standing PARTIAL and deliberately low-stakes: review
  lenses run as separate top-level sessions (ADR-002), not inline subagents.
- **`spawnCapture` is a probe primitive, not an adapter.** It buffers everything
  and closes stdin immediately, so it cannot answer a control request, cannot be
  cancelled, and times out on wall-clock rather than inter-event silence. The S1
  adapter needs a live session handle — a replacement, not an extension.
- **Anything written to `docs/research/` must go through `lib/redact.mjs`.** The
  first committed report carried the owner's home path and username; the fix is
  a boundary, and boundaries only hold if nothing writes around them.
- Two written confirmations pending: z.ai (GLM allowlist) and Anthropic (headless
  subscription use) — both are S0/S1 exit criteria; GLM/Codex engines stay unshipped
  until answered/accepted.
- Calendar honesty: 2.5–4 months of steady work (REVIEW-01 #4), content track separate.
- Open: friends' OS mix (K5) and GitHub account for the public repo (K4).

## 9. Reference docs

- `docs/architecture.md` — full architecture
- `docs/decisions/` — ADR-001..008 (007 and 008 are measured, not reasoned)
- `docs/research/RESEARCH-01..04` — feasibility, product architecture, asset audit, context problem
- `docs/research/REVIEW-01-independent-findings.md` — **governs v1 scope**
- `docs/research/REVIEW-02-runtime-gaps.md` — **governs the S1 engine work list**
- `docs/research/S0-conformance-report.md` — what the engine actually does, per probe
- `docs/inquiries/` — drafted, unsent letters to Anthropic and z.ai (owner sends)
- `tools/probe/README-ci.md` — why the conformance gate runs in two places
- Product summary artifact (Turkish, for the owner): claude.ai/code/artifact/26a4eb34-fb53-43b9-911f-8e23533bc044

---

*Initialized: 2026-07-30. Update sprint state and known limitations each sprint close.*
