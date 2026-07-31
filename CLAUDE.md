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
  first `system/init`: Atlas **registered** in `mcp_servers`, expected plugin
  present, `permissionMode` and `model` as routed, CLI version in range,
  `apiKeySource` as expected. A mismatch fails the phase in plain language
  *before* tokens are spent — this is the only defence against `--settings`
  being silently ignored in `-p`.
- **Registration is not reachability.** `mcp_servers[].status` races the init
  emit — measured `pending` on one run and `connected` on the next, with no
  later event correcting it — so no gate may key on `connected` or it flakes.
  Atlas connectivity is proven by *calling* a cheap Atlas tool. Related, same
  measurement: `init.tools` never carries an `mcp__` name, so an MCP tool's
  allow-list entry cannot be discovered by inspection — it comes from the
  measured naming rule `mcp__plugin_<plugin>_<server>__<tool>`.
- **A denied tool is detected on `tool_result.is_error`** — measured, not
  assumed (REVIEW-02 A3a). On a denied write the `tool_result` block carries
  `is_error: true`; the `permission_denied` advisory frame did not appear at
  all, and the `PermissionDenied` hook did not fire. The advisory frame is
  droppable under load (`dropping oldest permission_denied advisory frames`), so
  no code may treat its presence — or absence — as evidence. A phase that
  produced no file changes and no `is_error` evidence fails as *unverified*,
  never as success. Still open (A3b): whether `is_error` itself survives
  backpressure, which needs the reactive rig.
- **Language dial** (ADR-006): user-facing output in the user's language;
  *everything else* — code, comments, artifacts, ADRs, commit messages — English.
  **Measured hole, 2026-07-31**: the dial is implemented by the `MessageDisplay`
  rewrite, and that rewrite provably does **not** reach thinking blocks. In one
  controlled same-run differential the assistant *text* block came back rewritten
  while the *thinking* block kept its original reasoning verbatim. Content-bearing
  thinking reaches `-p` stream-json by default on haiku with no reasoning flag, so
  the cockpit must ignore `thinking` / `thinking_delta` / `signature_delta`
  **by name** — ignoring them by omission fails open the first time the renderer
  is rewritten, and the classification is now pinned in code, not only in the
  artifact. **The exposure is per-model, not global**: five effort levels change
  only the volume, but `--model sonnet` emitted no thinking surface at all under
  identical flags. Since ADR-004 routes different roles to different models, "we
  tested the feed" is a claim about one model's stream. ADR-006 needs an
  amendment or a stated cockpit-side rule (S1).
- **Review/audit sessions are read-only by construction** (`--tools` scoping),
  not by request.
- **REVIEW-01 governs v1 scope; REVIEW-02 governs the S1 engine work list; a
  measured ADR beats both.** Where research prose conflicts with a probe result,
  the probe wins — including prose written confidently (ADR-007, ADR-008).
- **Gates scale, never skip**: two classes (`small`/`full`); doubt rounds up;
  data/auth always `full`. Invariants are always pushed (≤~300 tokens), exempt
  from proportionality.
- **Engine sessions run with auto-update disabled** in the child env; tested
  CLI version range maintained. The conformance probe is *designed* to run on a
  schedule in two places, and the split is an ADR-001 consequence rather than an
  oversight: the **free tier in GitHub Actions** (a runner has no subscription
  login) and the **`--live` tier locally** on a machine where the owner is
  signed in (`tools/probe/README-ci.md`).
  **Status, stated because this sentence used to overclaim**: the free tier
  genuinely runs — every push plus daily. The live tier is **NOT scheduled on
  any machine**; `tools/probe/install-nightly.sh install` sets it up in one
  command, and `… status` will tell you the truth at any time. It is not
  installed by default because a 04:00 job spending 17 real engine calls a night
  is a standing cost on the owner's subscription, which is the owner's call.
  Until it is installed, live conformance is whatever was last run by hand.

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

**Current sprint**: **S1 — cockpit + engine adapter. OPEN as of 2026-07-31.**
Sprint record: `docs/research/sprint-01-cockpit-engine-adapter/RESEARCH.md`
(numbered `01` to match the project's own S-number; S0 predates the folder
convention and lives in `docs/research/S0-conformance-report.md` + ADR-007/008).
**Stage 0 is done**: night run #1's three findings were verified in a separate
session, instance 23 was fixed, `stream-surface.json` went to schemaVersion 2
after a healthy session proved its `rate_limit_event` class would have escalated
every phase forever, and the branch landed on `main` at 31 probes / 31 pass.
Gated on REVIEW-02 Tier A, which is decomposed by *dependency* rather than into
seven equal parts: **S1-A** (A2, A4, A6, A7 — measurable on the existing harness,
~80% confidence), then **S1-B** (a ~40-line throwaway reactive rig, ~62%), then
**S1-C** (A1, A5, A3b — structurally unmeasurable with `spawnCapture`, ~58%).
S1-B carries a hard validation gate: the rig must observe an event mid-stream and
write a reply the engine visibly acts on. If it cannot, A1's exit criterion
becomes "prove the engine never asks" and S1 gets cheaper.

**S0 (engine conformance) — complete.** 30 probes on disk (13 free, 17 live),
last full live run **30 pass / 0 fail / 0 partial / 0 inconclusive / 0 error**
against CLI 2.1.220. ADR-007 and ADR-008 are its output; REVIEW-02 is its honest
gap list.
**The S0 lesson that outlives S0**: three review passes found the same defect
**22 times** — *the harness inferred where it should have asserted, and every
inference failed open*. A guard that cannot fire is decoration; a convention is
not a constraint; a counter with no pinned expectation falsifies nothing. The
22nd instance was a guard added and falsified by CI within the hour, on the last
day of the sprint. **The 23rd arrived on schedule** — found by the night run's
own quality gate, living *inside the helper written to prevent leaks*:
`publishablePair` shape-gated names against a character class containing the
underscore, so the two ADR-008 plugin shapes its own docstring named as its
reason to exist published verbatim. Fixed 2026-07-31 with an allow-list keyed on
a committed artifact. Expect the 24th.
**Last sprint close**: 2026-07-31 (S0, post-audit hardening). Shipped: `tools/probe/`
(30 probes, all green), ADR-007 + ADR-008 with two dated corrections, REVIEW-02
(+§13 free Tier A answers), CI wiring, LICENSE, THIRD-PARTY-NOTICES, the two
vendor inquiry drafts.

Memory: `~/.claude/projects/-Users-talhamac-Desktop-Projects-Guidelane/memory/`

## 6. Running locally

```bash
# S0 engine conformance probe (DONE — keep it green; it gates every CLI upgrade)
node tools/probe/run.mjs            # free tier: help-text + observational (13 probes)
node tools/probe/run.mjs --live     # + 17 live probes (uses --model haiku)
node tools/probe/run.mjs --list     # what it checks and why
node tools/probe/run.mjs --only p-init-receipt,p-ambient-isolation
node tools/probe/run.mjs --live --update-baseline   # after a deliberate status change
# Writes docs/research/S0-conformance-report.md (+ .json) — only on a FULL --live
# run; anything filtered writes *.partial.* and leaves the baseline report alone.
# Exit: 0 green · 1 contract changed or drifted from baseline · 2 harness broke
#       · 3 inconclusive (stall/capacity — says nothing about the engine).
# One run at a time: a lockfile stops a manual run from racing the 04:00 job.
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
  **S1-A progress (2026-07-31)**: A4 **CLOSED** (the engine never asks headlessly
  — `manual` is indistinguishable from `auto`, so Night Shift needs no
  control-channel responder), A6 **CLOSED**, A7 **ANSWERED** (a hook emitting a
  malformed payload is reported `outcome: "success"` — the orchestrator must
  validate hook stdout itself), A2 partly answered and now CI-gated for free.
  **Remaining: A1, A3b, A5** — all unblocked by the measured session handle.
  **And one hazard REVIEW-02 never listed**: with stdin held open a `-p` session
  **never exits** and `result` is a *per-turn* event, so an adapter that waits for
  process exit hangs forever — produced accidentally in 30 lines, and exactly the
  silent-stall class Tier A exists to prevent.
- **No probe may assert on model output.** Three probes were written that way and
  all three were wrong: two asked the model to describe its own tools (measures
  the model, not the engine), and the third asked whether the model *chose* to
  dispatch a subagent. Each now asserts on an engine-emitted field instead. The
  suite carries **zero standing PARTIALs** as of 2026-07-31; if one reappears,
  the first question is which surface it is reading.
- **A probe reading the wrong surface reports a confident absence.**
  `p-autoupdate-governable` sat at PARTIAL for its whole life because it grepped
  `--help`, and auto-update governance is an env var — the control was never
  going to be where it was looking. Its replacement runs a two-arm
  `claude doctor` differential and PASSES. Before believing an absence, check
  that the surface could have carried the thing.
- **One bug shape, found eleven times: the harness inferred where it should have
  asserted, and every inference failed open.** A sprint-close audit by two
  independent agents found seven more instances after the suite was already
  green. The generalisation worth carrying into S1: *a guard that cannot fail is
  decoration; a counter with no pinned expectation cannot falsify anything; and
  a convention is not a constraint.* Concretely — the env deny-list assertion was
  a tautology (same constant, same function, no path between); `ctx.spawnCapture`
  could spawn an un-isolated session while the report said otherwise;
  `--setting-sources` was checked by presence, not value; and both
  `p-permission-allowlist` and `p-max-budget-subscription` — the evidentiary
  basis for ADR-007 Finding 1 and for refuting REVIEW-01's budget hypothesis —
  returned PASS on a bare non-zero exit, so a session that broke before reaching
  the model looked identical to one the engine had denied.
- **The conformance suite must control which backend answers.** Nine
  backend-routing env vars are now scrubbed and `init.apiKeySource` is asserted,
  not merely recorded. `ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN` in the
  operator's shell — how z.ai's coding plan points `claude` at GLM, a plan this
  project intends to ship — would have made a full run measure GLM while
  `claude --version` still printed 2.1.220 and the report was committed as
  Anthropic evidence.
- **Names in the evidence are the operator's on exactly the failure the probe
  detects.** Skill, agent and MCP-server names beyond the pinned floor belong to
  the operator (employer, client, internal-project names); they are not
  path-shaped or email-shaped, so neither `redact.mjs` nor the CI grep can see
  them. Probes publish the floor by name and everything else as a count plus a
  short fingerprint.
- **`spawnCapture` is a probe primitive, not an adapter.** It buffers everything
  and closes stdin immediately, so it cannot answer a control request, cannot be
  cancelled, and times out on wall-clock rather than inter-event silence. The S1
  adapter needs a live session handle — a replacement, not an extension.
- **Anything written to `docs/research/` must go through `lib/redact.mjs`.** The
  first committed report carried the owner's home path and username; the fix is
  a boundary, and boundaries only hold if nothing writes around them. Two later
  gaps in that same boundary, both found by audit rather than by the boundary:
  its rules were case-**sensitive** while the CI backstop greps `-i` (so the
  boundary was strictly weaker than the thing backstopping it, on a
  case-insensitive filesystem), and stripping only `$HOME` published
  `Desktop/Projects/Guidelane` — harmless here, a client's name for a pilot user
  checked out under `~/work/<client>/`. Both fixed; the rule is that the
  boundary must be at least as strong as its backstop, always.
- **Vendor inquiries re-gated by the owner (2026-07-31): from S0/S1 exit criteria
  to a PILOT-INSTALL gate.** REVIEW-01 #1 made the Anthropic letter an S1 exit
  criterion; the owner's decision is to prove the system runs on this machine
  first — *"önceliğimiz claude code ve codex sistemin çalıştığını kanıtlamak"* —
  and send the letters afterwards. The reasoning holds while two conditions do:
  it is the **owner's own subscription** and **nothing is installed for anyone
  else**. The moment either changes — the first friend's pilot install — the
  pattern becomes "someone else's subscription driven by my software", which is
  exactly the question the letters ask, and they must be answered before that
  install. Both drafts sit unsent in `docs/inquiries/`. Nothing about ADR-001
  relaxes: no credential is ever read, and no workaround exists in the codebase
  regardless of what any vendor answers.
- **There is no drafted inquiry for OpenAI, and Codex needs one.** `codex` under
  a ChatGPT subscription raises the *same* headless-automation question as
  `claude` under a Max subscription, and only the Anthropic and z.ai letters
  exist. If Codex moves earlier in the roadmap, a third letter has to be written
  — cheap to draft, and easy to forget precisely because the other two are
  already sitting there looking complete.
- Calendar honesty: 2.5–4 months of steady work (REVIEW-01 #4), content track separate.
- **macOS only for now** (K5, decided 2026-07-30). The harness's process-group
  kill is POSIX-only; Windows needs a `taskkill /T /F` branch before S7. Do not
  claim cross-platform support anywhere until that exists.

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
