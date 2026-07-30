# Guidelane — Feasibility Research & Scope

**Date**: 2026-07-30
**Status**: research complete, awaiting owner decisions (see §8)
**Author**: Claude (technical lead), for Talha (product owner)

> Purpose: prove that every stated requirement can be met, name the mechanism for
> each, cite the evidence, size the work, and stage it. Nothing is assumed —
> where a requirement conflicts with a provider's terms or with another
> requirement, the conflict is stated and resolved explicitly.

---

## 1. What Guidelane is

Guidelane is a **local, open-source cockpit that lets people who cannot code
build working software by describing what they want.**

The user and their non-coding friends are the target users. They already pay for
AI coding subscriptions (Claude Max, ChatGPT/Codex, GLM). What they lack is a
surface that does not assume they are software engineers.

Guidelane is **not** a new AI coding agent. It is a layer that:

1. drives an official, vendor-shipped coding agent binary as its engine,
2. injects an opinionated non-engineer behaviour pack into that engine,
3. serves the engine curated, proven implementation knowledge from a local
   knowledge server, and
4. presents the whole thing through a surface with no engineering jargon.

The engine is replaceable. The behaviour pack, the knowledge server, and the
surface are the product.

---

## 2. Requirement traceability matrix

Every requirement the owner stated, the mechanism that satisfies it, and the
evidence. `R6`/`R8` were added in follow-up messages.

| # | Requirement (as stated) | Mechanism | Evidence / status |
|---|---|---|---|
| R1 | Product for me and my non-coding friends who want to vibecode | Guidelane cockpit + behaviour pack; see §3, §4 | Design decision |
| R2 | Built from the WrongStack GitHub repo mixed with my Claude skills/hooks/agents | WrongStack re-scoped to **code/design donor**, not runtime engine (§3.4). Skills/hooks/agents ship as a Claude Code **plugin** (§4.2) | WrongStack is MIT, third-party; skills/hooks/agents map 1:1 onto the plugin system |
| R3 | Must never behave like it works for a software engineer; the LLM handles thinking/deciding in detail; may ask product-design questions | 5 stacked mechanisms: system-prompt layer, permission mode, event→plain-language translation, `MessageDisplay` hook, question-forcing skills (§4.3) | All five are documented, supported extension points |
| R4 | A directly testable product | Stage 1 ships a working end-to-end path (§7); the engine already works, so the first testable build is days not months | See §6 scale |
| R5a | Use Claude's latest MCP settings | Tool Search + Code Mode / progressive disclosure. Guidelane's own server is authored for it (§5.4) | MCP spec `2026-07-28`; Tool Search cuts preloaded tool tokens ~85–95% |
| R5b | An MCP server for code examples / proven paths | **Guidelane Atlas** — own MCP server, designed in §5 | Buildable; `indexandria` is the closest prior art |
| R5c | Must run on everyone's own local machine, no extra server connection | Everything is a local process: engine binary, Atlas over stdio, cockpit on localhost. Zero Guidelane-operated infrastructure | Engine, MCP transport, and UI are all local by construction |
| R5d | Must work with subscriptions (Codex, GLM, Claude Max) **without ToS violation** | Guidelane never holds a credential. It spawns the vendor's own signed-in binary (§3.2). This is the only compliant path | **Resolved with evidence — §3.1, §3.2. This is the single most important finding.** |
| R5e | Examine alicankiraz1 for ideas/methods | Done. Three methods adopted (§4.5) | `ClaudeQB`, `CodexQB`, `indexandria` reviewed |
| R5f | Download a solid resource archive on every topic with a sensible model | `llms.txt` / `llms-full.txt` acquisition into a local corpus, served by Atlas (§5.3). **"Every topic" must be scoped — see §8 Q3** | `llms.txt` is now widely published, including by Anthropic |
| R6 | Non-commercial open source; don't hesitate to copy code/architecture | MIT-compatible. WrongStack is MIT — copying is permitted **with its copyright notice preserved** (§3.4) | Licence obligation noted |
| R7 | *(session-scoped, not a product requirement)* Delete the old WrongStack memories entirely | Executed 2026-07-30 — six memory files removed. Intentionally absent from the product matrix; noted here so the numbering gap is not mistaken for a lost requirement (REVIEW-01 §3) | Done |
| R8 | Build my own MCP server | Guidelane Atlas, fully specified in §5 | Core deliverable |

---

## 3. The engine and the terms-of-service problem

This section is the load-bearing one. It reverses part of the original plan.

### 3.1 What is actually forbidden

Anthropic enforced its terms against third-party agents using subscription
credentials, in two steps:

- **January 2026** — accounts were suspended for using Claude Pro/Max
  credentials in third-party tools. The banned mechanism was specific:
  intercepting the OAuth flow, extracting the access token, and making API calls
  while impersonating Claude Code. Named tools included OpenClaw, OpenCode,
  Roo Code, and Goose.
- **4 April 2026** — Claude Pro, Max, and Team subscriptions stopped covering
  usage through any third-party "harness" routing requests over OAuth. Anthropic
  issued one month's subscription credit as compensation.

Two further facts close off the obvious workarounds:

- **The Claude Agent SDK requires an API key.** OAuth credentials from
  Free/Pro/Max accounts are rejected. So the official SDK cannot be used to
  reach a subscription.
- **Being open-source and non-commercial is not a defence.** OpenCode is
  open-source and non-commercial and was banned anyway. The prohibition is about
  the credential path, not the business model.

The line Anthropic draws is between *lifting a credential* and *running their
program*:

> Calling the official `claude` CLI = allowed.
> Extracting subscription OAuth tokens for use in an unauthorized third-party
> client = banned.

Zed's own guidance to its users confirms the permitted side: when the official
`claude` CLI runs in a terminal, it draws on the subscription's limits.

### 3.2 The compliant architecture

**Guidelane must never see a subscription credential.** It spawns the vendor's
own binary, which the user has signed into themselves.

```
┌── GUIDELANE (what we build) ────────────────────────────┐
│  cockpit UI · behaviour pack · Atlas MCP · translator   │
│  holds ZERO credentials                                 │
└───────────────────────┬─────────────────────────────────┘
         spawns as subprocess, speaks stream-json JSONL
┌───────────────────────▼─────────────────────────────────┐
│  VENDOR-SHIPPED BINARY (user's own login)                │
│    claude    ← `claude auth login`   → Claude Max        │
│    codex     ← `codex login`         → ChatGPT Plus/Pro  │
│    claude + ANTHROPIC_BASE_URL=api.z.ai → GLM Coding Plan│
└─────────────────────────────────────────────────────────┘
```

Per provider:

| Subscription | Path | Compliance |
|---|---|---|
| **Claude Max** | spawn `claude`; user runs `claude auth login` | Running Anthropic's own program. Credential stays in Anthropic's keychain entry |
| **ChatGPT / Codex** | spawn `codex exec`; user runs `codex login` | Running OpenAI's own program. Codex CLI is Apache-2.0 and OpenAI has said forking is welcome |
| **GLM Coding Plan** | spawn `claude` with `ANTHROPIC_BASE_URL=https://api.z.ai/api/anthropic` | Claude Code is #1 on z.ai's 15-tool allowlist. Traffic genuinely originates from Claude Code |
| **API key** | any of the above with a key instead | Always permitted |
| **Local models** | Ollama / LM Studio via OpenAI-compatible base URL | No terms to violate |

Two engineering constraints discovered in the CLI itself, both of which would
silently break subscription auth if ignored:

- **`--bare` must never be used.** Its documented behaviour: *"Anthropic auth is
  strictly `ANTHROPIC_API_KEY` or `apiKeyHelper` … OAuth and keychain are never
  read."* It forces API-key-only auth.
- **`--safe-mode` must never be used** in normal operation — it disables
  plugins, skills, hooks, and MCP servers, i.e. all of Guidelane's behaviour pack.

### 3.3 Residual policy risk — stated plainly

I am not 100% confident, and here is exactly where the uncertainty sits.

- **Spawning the binary: ~85% confident this stays permitted.** The distinction
  is drawn explicitly in Anthropic's own enforcement communications and Zed
  publicly instructs its users to do it. The residual risk is *not* a ban — it
  is that Anthropic re-splits `claude -p` (headless) billing out of subscription
  limits into a separate Agent-SDK credit pool. That split was announced for
  15 June 2026, then **paused and put under revision**. If it lands, Guidelane
  users would need Agent-SDK credit rather than losing access.
  **Contingency (corrected 2026-07-30 after independent review — REVIEW-01 #1):**
  if the billing split lands, the honest answer is Agent-SDK credit plus a clear
  in-product notice — **not** a transport workaround. Driving the interactive TUI
  with a robot to keep drawing consumer-subscription quota after such a split
  would be circumvention of the split — exactly the adversarial pattern that got
  third-party tools banned — and the earlier "unambiguously first-party" framing
  here was authorial overclaim. The S2 adapter seam is still built, but the PTY
  transport behind it is a *technical-availability* fallback only (e.g. flag or
  protocol removal), never a billing-policy workaround. Additionally: Guidelane
  sends Anthropic the same written inquiry as z.ai; both answers are S0/S1 exit
  criteria.
- **GLM: ~80% confident.** The reading is strong — Claude Code is on the
  allowlist and Claude Code is what opens the connection to `api.z.ai`. But z.ai's
  restriction is worded around the *tools users use*, and Guidelane is not itself
  on the list. **Recommendation: email z.ai and get it in writing before shipping
  GLM support.** Cost of being wrong: GLM support is removed; nothing else breaks.
- **Codex: ~75% confident.** OpenAI staff confirmed forking the Apache-2.0 CLI is
  welcome, but explicitly declined to confirm that a modified/third-party client
  may use ChatGPT subscription auth, and did not answer follow-ups about
  distributing apps built on Codex. Note our position is *stronger* than the
  question that was asked — we run the unmodified binary. Still, this is the
  weakest of the three.

Consequence for planning: **Claude Max is the launch engine. GLM and Codex are
Stage 5, behind their own confirmations.** That ordering is deliberate.

### 3.4 What WrongStack actually contributes

`github.com/WrongStack/WrongStack` — third-party, MIT, org created 12 May 2026,
210 stars, 20 packages + 2 apps, TypeScript strict, actively pushed. Not the
owner's repo.

It cannot be the runtime engine, for a structural reason: its headline
subscription feature is OAuth sign-in with Claude Pro/Max, ChatGPT, and Copilot
— precisely the banned pattern. Using WrongStack with subscriptions violates R5d;
using it with API keys only violates R5d's intent (the friends' existing
subscriptions become useless). **It cannot satisfy both requirements at once.**

It remains genuinely valuable as a **donor**, which is what R6 explicitly
licenses us to do:

| Take from WrongStack | Use in Guidelane |
|---|---|
| `simpleui` — standalone Vite + React 19 chat surface | Starting point for the cockpit; already the right shape |
| `sage` — SQLite/FTS5 code-anchored memory design | Design reference for Atlas's index layer |
| Kernel contracts (Container · Pipeline · EventBus · RunController) | Shape of Guidelane's engine-adapter boundary |
| Permission policy + risk-tier tool contract | Model for the plain-language safety layer |
| Chimera auto-review, kanban lifecycle | Later-stage feature designs |

**Licence obligation:** MIT requires the copyright notice and permission notice
to be preserved in copies and substantial portions. Guidelane ships a
`THIRD-PARTY-NOTICES.md` carrying WrongStack's notice for any copied code. This
is a real obligation, not a courtesy.

The owner's own 22 July 2026 deck (`~/Downloads/wrongstacksunum.html`,
"WrongStack Mimari İncelemesi — Kendi AI Kod Ajanını İnşa Et") already reached
the same legitimacy conclusion on its final slide: *carrying a subscription
session into a third-party client violates the provider's terms — avoid that
path.* This research confirms that instinct and shows the compliant route.

---

## 4. The engine is already an embedding API

The reason this project is days-to-first-build rather than months: the vendor
binaries expose a complete programmatic surface. Verified locally against
`claude` 2.1.220 and `codex` 0.145.0.

### 4.1 Control surface

Bidirectional streaming JSON — a real protocol, not screen-scraping:

```bash
claude -p \
  --input-format stream-json --output-format stream-json \
  --include-partial-messages \      # token-level streaming for live UI
  --include-hook-events \           # hook lifecycle in the stream
  --forward-subagent-text \         # subagent visibility
  --replay-user-messages            # message acknowledgement
```

Everything Guidelane needs to inject, it can inject per session:

| Need | Flag |
|---|---|
| Ship the behaviour pack | `--plugin-dir <path>` (directory or `.zip`), `--plugin-url` |
| Ship Atlas + only Atlas | `--mcp-config <json>` + `--strict-mcp-config` |
| Non-engineer persona | `--append-system-prompt`, `--system-prompt` |
| Inject subagents inline | `--agents <json>` |
| Inject hooks/settings | `--settings <file-or-json>` |
| Remove permission jargon | `--permission-mode auto` (also `plan`, `acceptEdits`, `dontAsk`) |
| **Hard spend cap per session** | `--max-budget-usd <amount>` |
| Reasoning depth | `--effort low\|medium\|high\|xhigh\|max` |
| Constrain the toolset | `--tools`, `--allowedTools`, `--disallowedTools` |
| Structured output | `--json-schema` |
| Resume / fork / name sessions | `--session-id`, `--resume`, `--fork-session`, `--name` |
| Isolate risky work | `--worktree` |
| Model + graceful degradation | `--model`, `--fallback-model` |
| Background work | `--bg`, managed via `claude agents --json` |

`--max-budget-usd` caveat (corrected 2026-07-30, REVIEW-01): the flag caps
*API-dollar* spend and is likely **inert under subscription auth** — which is
every launch user. S0 tests it explicitly; the real guardrails for subscription
users are per-stage timeouts, cycle caps, and retry ceilings, all enforced by
the orchestrator. The flag remains useful for API-key users only.

Codex mirrors this: `codex exec` (non-interactive), `codex mcp-server` (**Codex
itself as an MCP server over stdio**), `codex app-server`, `codex plugin`,
`codex login`, and a three-level sandbox (`read-only`, `workspace-write`,
`danger-full-access`). `codex mcp-server` is notable: it lets one engine be
exposed as a tool to the other.

### 4.2 The behaviour pack is a Claude Code plugin

The owner's existing assets map onto the plugin system with no translation
layer. Current inventory: 7 skills, 5 agents, 4 hooks, 22 global rules.

Manifest — `.claude-plugin/plugin.json`; only `name` is required:

```json
{
  "name": "guidelane",
  "displayName": "Guidelane",
  "version": "0.1.0",
  "description": "Non-engineer behaviour pack for Guidelane",
  "license": "MIT",
  "skills": "./skills/",
  "agents": ["./agents/product-interviewer.md"],
  "hooks": "./hooks/hooks.json",
  "mcpServers": "./.mcp.json"
}
```

Layout rule (a documented failure mode): **only `plugin.json` lives in
`.claude-plugin/`.** `skills/`, `agents/`, `hooks/`, `.mcp.json` all sit at the
plugin root. Components placed inside `.claude-plugin/` are silently not
discovered.

33 hook lifecycle events are available. The ones Guidelane needs:

| Event | Guidelane use |
|---|---|
| `MessageDisplay` | Rewrite assistant text into plain language before display |
| `PermissionRequest` | Replace permission dialogs with a plain-language consent card |
| `PermissionDenied` | Explain the refusal in plain language; `{retry:true}` to let the model adapt |
| `PreToolUse` | Fail-closed guard: block destructive operations outright |
| `SessionStart` | Load the user's project state and preferences |
| `Notification` | Route to the cockpit instead of the terminal |
| `SubagentStart` / `SubagentStop` | Render fan-out as a progress view |
| `Stop` | Trigger the "here's what changed, want to see it?" step |

Hook types are not limited to shell commands: `command`, `http`, `mcp_tool`,
`prompt` (evaluate with an LLM), and `agent` (agentic verifier). The `prompt`
type is what makes plain-language translation cheap.

Distribution is solved too: `claude plugin marketplace add <github-repo>` +
`claude plugin install`. A marketplace is just a GitHub repo — so
`github.com/<owner>/guidelane` can be its own distribution channel with no
infrastructure. `claude plugin validate --strict` gates CI. `claude plugin eval`
runs scored eval cases against a plugin, which gives the behaviour pack real
regression tests rather than vibes.

### 4.3 How R3 is enforced — five stacked mechanisms

"Never behave like it works for a software engineer" is the hardest requirement,
because the engine's native surface is aggressively engineer-facing. One
mechanism is not enough; five stack:

1. **Persona layer** — `--append-system-prompt` carrying the Guidelane voice
   rules: no jargon without a plain-language gloss, lead with outcome, ask about
   product intent rather than technical implementation, never surface file paths
   or tool names unprompted.
2. **Permission mode** — ~~`--permission-mode auto` removes engineer-facing
   approval dialogs from the default path. Safety moves to a fail-closed
   `PreToolUse` hook plus `--disallowedTools`.~~
   **CORRECTED 2026-07-30 by measurement (S0 probe `p-permission-allowlist`,
   ratified in ADR-007):** in headless mode `--permission-mode auto` *alone*
   **denies** tool calls — there is no interactive grant to give — and the model
   may still claim success afterwards. The working form is
   **`--permission-mode auto` plus an explicit per-stage `--allowedTools` list**:
   the engine itself then denies everything unnamed, which makes the *engine*
   the fail-closed layer and demotes our `PreToolUse` guard to defence in depth.
   Read-only roles get allow-lists containing no mutating tools, so "review
   sessions are read-only by construction" becomes literally enforced.
3. **Event translation in the cockpit** — Guidelane consumes `stream-json` and
   renders semantic activity lines ("checking how the login page looks"), never
   raw tool calls, diffs, or paths. This is Guidelane's own code and the primary
   defence.
4. **`MessageDisplay` + `PermissionRequest` hooks** — a second net inside the
   engine for text that slips through, using `prompt`-type hooks.
5. **Question-forcing skills** — skills that make the engine ask *product*
   questions ("who is this for?", "what should happen when someone clicks
   this?") instead of technical ones, adapted from ClaudeQB's four-field intake.

Mechanisms 1, 4, and 5 are prompt-level and therefore probabilistic. Mechanisms
2 and 3 are deterministic. **The deterministic ones must carry the load** — that
is why the cockpit owns rendering rather than passing engine output through.

### 4.4 R5c — local by construction

| Component | Where it runs | Network |
|---|---|---|
| Cockpit UI | `localhost`, user's machine | none outbound |
| Engine binary | user's machine | vendor API only, with the user's own login |
| Atlas MCP | user's machine, stdio subprocess | none at query time |
| Knowledge corpus | user's disk | fetched at build/refresh time only |

No Guidelane-operated server exists at any point. Nothing to host, nothing to
pay for, nothing to breach.

### 4.5 R5e — methods adopted from alicankiraz1

Reviewed 27 public repos. Three directly relevant:

| Repo | What it does | Adopted |
|---|---|---|
| `indexandria` (43★) | Claude Code plugin: crawls web docs → clean markdown → straight into context. No DB, no server, no disk writes | **Closest prior art for Atlas.** We adopt the two-tier shape (`crawl` for 1–15 pages returning content; `index` for up to 100 pages returning a compact TOC, then `search`/`get_page`). We diverge by persisting to disk for offline use (R5f) |
| `ClaudeQB` (19★) | Vibecoding-first repo planning; four-field intake; durable planning docs; QA audit gate before implementation | **Gate discipline and intake shape.** Its four fields (`PROJECT_NAME`, `PROJECT_INTENT`, `TARGET_END_STATE`, `KNOWN_CONSTRAINTS`) become Guidelane's product-interview skill, reworded for non-coders |
| `CodexQB` (183★) | Same for Codex; controlled Goal/Apply handoff; planning ledger | **Ledger pattern** — decisions and implementation evidence persist across long sessions |

Method, not code: these are Python plugins with their own conventions. We take
the workflow shapes and write our own implementations.

---

## 5. Guidelane Atlas — the owner's own MCP server

R5b and R8. This is Guidelane's most differentiated component: the engine is
borrowed, the surface is a UI, but Atlas is original.

### 5.1 The problem it solves

A non-coder describing a product has no idea which of the model's many possible
implementations is the one that actually works in production. The model will
happily produce a plausible-but-fragile approach, and the user cannot tell the
difference. Atlas exists to bias the engine toward **proven paths**: patterns
that are known-good, current, and verified — not merely plausible.

This is different from a documentation search tool. Docs tell you what an API
does. Atlas tells you *the way this is actually done, and why the obvious
alternative fails.*

### 5.2 Interface — authored for MCP Tool Search

Under progressive disclosure, a server with many verbose tools is a liability:
tool descriptions are loaded lazily and searched, so **few tools with excellent
descriptions and resource-based detail** is the correct shape. Atlas exposes
five:

| Tool | Input | Returns |
|---|---|---|
| `atlas_find_pattern` | task description, optional stack | Ranked proven patterns: name, when-to-use, when-NOT-to-use, confidence, source |
| `atlas_get_pattern` | pattern id | Full pattern: working code, prerequisites, failure modes, verification steps |
| `atlas_search_docs` | query, optional package filter | Passages from the local corpus with citations |
| `atlas_check_current` | package + version | Whether the corpus entry is current; what changed if not |
| `atlas_record_outcome` | pattern id, worked/failed, notes | Appends to the local outcome ledger — Atlas learns per machine |

Design rules, each with a reason:

- **Detail behind resources, not tool output.** `atlas_find_pattern` returns
  summaries; full patterns arrive via `atlas_get_pattern` or an MCP resource.
  Two-stage retrieval keeps the context small.
- **Every answer carries provenance.** Source URL, fetch date, verification
  status. A pattern with no provenance is not a proven path.
- **`atlas_record_outcome` closes the loop.** This is the feature no
  documentation MCP has: over time, Atlas knows which patterns actually worked
  on *this* machine, for *these* users. It is also privacy-safe — the ledger
  never leaves the disk.
- **Explicit negative knowledge.** "When NOT to use" and "failure modes" are
  first-class fields. Steering away from a wrong path is worth more than
  confirming a right one, and it is exactly what a non-coder cannot supply.

### 5.3 Corpus and acquisition (R5f)

Acquisition uses `llms.txt` / `llms-full.txt` — a now-widely-published
convention where a project ships a clean, structured markdown view of its docs
for LLM consumption. `llms.txt` is the index; `llms-full.txt` is the complete
rendered documentation in a single file, explicitly intended for offline and
rate-limited environments. Anthropic publishes one at
`https://code.claude.com/docs/llms.txt`.

This makes the archive tractable: prefer `llms-full.txt` where published, fall
back to a bounded crawl where not.

Three tiers:

| Tier | Content | Refresh | Est. size |
|---|---|---|---|
| **Core** (offline, shipped) | The launch stack's full docs via `llms-full.txt` | weekly | 200–600 MB |
| **Patterns** (offline, hand-curated) | The proven-path corpus itself — written and reviewed by us, not scraped | per release | < 20 MB |
| **Reach** (on demand) | Anything outside core, crawled at query time and cached | on use | grows with use |

Storage: SQLite + FTS5, single file, no server — same choice WrongStack made for
SAGE, and it needs no daemon.

**"Every topic" is not implementable as stated** and I am not going to pretend
otherwise. An unbounded archive is unbounded disk, unbounded refresh cost, and
mostly bytes no one reads. The tiered model gives the *experience* of "everything
is available" while only paying to keep the launch stack offline. The core tier's
topic list is a decision the owner must make — §8 Q3.

### 5.4 Implementation

TypeScript on the official MCP SDK, stdio transport, shipped as `.mcp.json`
inside the Guidelane plugin so it starts automatically when the plugin is
enabled. Two independent processes: the **server** (queries only, never writes)
and a **builder CLI** (fetches, normalizes, indexes). Splitting them means a
corpus refresh can never corrupt a live session.

Current MCP specification is `2026-07-28` — stateless protocol core, Extensions
framework, Tasks, MCP Apps, authorization hardening, formal deprecation policy.
Target that, and progressive disclosure v2.x for the two-stage retrieval.

---

## 6. Scale

Component inventory, with honest sizing. Estimates assume the owner directs and
Claude implements, which is how the existing projects have run.

| Component | Build | Est. size | Risk |
|---|---|---|---|
| Engine adapter (spawn, stream-json codec, lifecycle, PTY-swap boundary) | new | ~1,200 LOC | Medium — protocol is documented but wide |
| Cockpit UI (chat, activity translation, consent cards, live preview) | SimpleUI-derived | ~2,500 LOC | Medium — this is where product quality lives |
| Guidelane plugin (skills, agents, hooks, persona) | new + port of 7 skills / 5 agents / 4 hooks | ~1,500 LOC + prompts | Low mechanically, **high on tuning** |
| Atlas MCP server | new | ~1,500 LOC | Low — well-understood shape |
| Atlas corpus builder | new | ~800 LOC | Low |
| Pattern corpus (content, not code) | hand-written | 40–80 patterns | **Highest-effort item. Content, not engineering** |
| Packaging / installer | new | ~400 LOC | Low at Stage 1 (npm), higher if desktop |
| Docs + third-party notices | new | — | Low |

Two honest observations about this table:

1. **Total new code is roughly 8,000 lines.** That is a real project but not a
   large one — because the agent engine, the provider transports, the permission
   system, the tool executor, and the security model are all borrowed from a
   vendor binary that is maintained by someone else. This is the entire argument
   for the architecture.
2. **The largest single cost is not code.** It is the pattern corpus and the
   behaviour-pack tuning. Those are judgement work, they cannot be parallelised
   away, and they are what determines whether the product is good. Plan for them
   accordingly.

---

## 7. Staged plan with validation gates

Per the incremental-foundations rule: each stage is one testable atomic change,
with a named validation gate and a stated confidence. High-confidence stages
first; fragile ones later, after evidence.

### Stage 0 — Prove the engine can be driven (half a day) · confidence 95%
Spawn `claude -p --input-format stream-json --output-format stream-json` from a
throwaway script. Send one prompt, parse the event stream, print the events.
**Gate:** a full turn round-trips and the JSONL parses cleanly.
*Why first: it is the cheapest possible test of the load-bearing assumption.*

### Stage 1 — Thinnest testable product (2–3 days) · confidence 85%
Minimal localhost web UI. One input, one activity stream, one result. Engine
spawned with `--permission-mode auto`, `--max-budget-usd`, and a persona
`--append-system-prompt`. No plugin, no Atlas, no translation layer yet.
**Gate:** a non-coding friend, on their own machine, with their own
`claude auth login`, describes something and gets a working result — without
being shown a file path or a tool name.
*This is R4. Everything after it is improvement on a thing that already works.*

### Stage 2 — Engine adapter boundary + PTY hedge (2 days) · confidence 80%
Extract the ad-hoc spawn into a real adapter with a single interface. Implement
the `stream-json` transport behind it, and stub the PTY transport.
**Gate:** the cockpit runs unchanged against the adapter; the stub is
swap-in-able.
*Buys insurance against the §3.3 billing-split risk at its cheapest moment.*

### Stage 3 — Guidelane plugin: behaviour pack (4–6 days) · confidence 70%
Author `.claude-plugin/plugin.json`. Port the 7 skills / 5 agents / 4 hooks.
Write the `MessageDisplay` and `PermissionRequest` translation hooks and the
fail-closed `PreToolUse` guard. Write the product-interview skill.
**Gates:** `claude plugin validate --strict` passes; `claude plugin eval` cases
pass; and a manual read-through of 10 transcripts finds no engineering jargon
reaching the user.
*Confidence drops here because this is prompt tuning — it converges by iteration,
not by being written correctly the first time.*

### Stage 4 — Atlas MCP: skeleton, then substance (5–7 days) · confidence 75%
Server with the five tools over stdio, wired via the plugin's `.mcp.json`.
Corpus builder ingesting `llms-full.txt` for the core tier. Ten seed patterns.
`atlas_record_outcome` ledger.
**Gates:** engine calls Atlas unprompted on a relevant task; a pattern retrieved
from Atlas measurably changes the generated implementation; offline query works
with networking disabled.
*The third gate is the one that proves R5c.*

### Stage 5 — Additional engines, behind confirmations (3–4 days) · confidence 60%
GLM via `ANTHROPIC_BASE_URL` — **only after written confirmation from z.ai.**
Codex via `codex exec` — **only after the owner accepts the §3.3 risk.**
Local models via Ollama/LM Studio, which carry no terms risk and should ship
regardless.
**Gate:** engine switch is a config change, no cockpit changes.
*Lowest confidence, and the reason is external and outside our control.*

### Stage 6 — Corpus depth and distribution (ongoing)
Grow the pattern corpus to 40–80. Publish as a plugin marketplace on GitHub.
Optional desktop packaging.
**Gate:** a friend installs from a published URL and reaches a working result
with no terminal.

Sequencing note: Stages 0–2 are foundations and should not be reordered.
Stages 3 and 4 are independent of each other and can run in parallel if desired.
Stage 5 is gated on external answers, so start seeking those now — the z.ai
email can be sent during Stage 1.

---

## 8. Decisions the owner must make

These change the work materially and I will not guess them.

**Q1 — Surface for the first testable build.** Localhost web UI (recommended:
fastest to a real test, no packaging), guided terminal (easiest to build,
terminal is still a barrier), or desktop app (best product feel, adds signing,
notarization, and per-platform builds before anything is testable).

**Q2 — Engine for launch.** Claude Max only (recommended: highest confidence,
§3.3), or Claude Max + local models (adds a zero-risk free tier for friends
without a subscription), or all three now (accepts the GLM and Codex
uncertainties up front).

**Q3 — Core offline topic list.** The corpus needs a bounded launch stack. My
proposal: React + Next.js, Tailwind, Supabase (Postgres + auth), Node/TypeScript,
Vercel — i.e. one coherent path a non-coder can actually ship on. Confirm,
replace, or extend, and set a disk budget.

**Q4 — Repo and licence.** `github.com/<owner>/guidelane`, public, MIT
(recommended: matches WrongStack's licence and R6, and lets the repo double as
the plugin marketplace). Confirm the owner account and whether it starts public.

---

## 9. Known risks and weak spots

Ordered by expected damage.

1. **Anthropic re-splits `claude -p` billing out of subscription limits.**
   Likelihood: moderate — it was announced, then paused and put under revision.
   Impact: users need Agent-SDK credit instead of subscription coverage.
   Mitigation (corrected 2026-07-30, REVIEW-01 #1): honest degradation — Agent-SDK
   credit + a clear in-product notice. The S2 adapter seam is still cheap
   insurance, but its PTY transport is a technical-availability fallback only,
   **never** a billing-policy workaround.
2. **The behaviour pack leaks engineering jargon anyway.** Likelihood: high on
   the first pass. Impact: R3 fails, which is the product's whole differentiator.
   Mitigation: the deterministic mechanisms (cockpit rendering, permission mode)
   carry the load; the prompt-level ones are backup, not primary. Budget real
   iteration time in Stage 3.
3. **z.ai's allowlist is read strictly and Guidelane is excluded.** Likelihood:
   moderate. Impact: GLM support removed. Mitigation: get it in writing before
   building it — cost of the confirmation is one email.
4. **The pattern corpus stays too thin to matter.** Likelihood: moderate — it is
   sustained content work with no shortcut. Impact: Atlas degrades into a
   documentation search tool, and Guidelane loses its most original component.
   Mitigation: ten *good* seed patterns beat forty shallow ones; use
   `atlas_record_outcome` data to decide what to write next.
5. **Non-coders hit environment problems the cockpit cannot hide.** Node
   versions, missing toolchains, port conflicts. Likelihood: high. Impact:
   friction exactly at first-run, the worst possible place. Mitigation: a
   preflight doctor check as part of Stage 1, not a later polish item.
6. **Upstream CLI flag churn.** The engine is someone else's program and its
   flags can change. Likelihood: low per release, certain over time. Impact:
   adapter breakage. Mitigation: the Stage 2 adapter is the only place that
   knows about flags, plus a version check at startup.
7. **Codex terms remain unconfirmed.** Likelihood: it stays unanswered. Impact:
   Codex support ships under owner-accepted risk or not at all. Mitigation:
   ship it last, make it opt-in, and state the risk in the UI.

**Local environment gaps** (blocking, cheap to fix): `pnpm` is 9.15.0 and
several toolchains in this space want ≥11.5.3; `uv` is not installed and is
needed to run `indexandria` for comparison. Node 22.22.2, `claude` 2.1.220, and
`codex` 0.145.0 are all fine.

---

## 10. Sources

Engine surface verified locally: `claude --help`, `claude mcp|plugin|agents|auth
--help` (v2.1.220); `codex --help`, `codex exec --help`, `codex mcp-server
--help` (v0.145.0).

- Claude Code plugins reference — https://code.claude.com/docs/en/plugins-reference
- Claude Code docs index (`llms.txt` example) — https://code.claude.com/docs/llms.txt
- Anthropic third-party subscription enforcement — https://kersai.com/anthropic-killed-third-party-claude-access-heres-every-workaround-that-still-works/ · https://marketingagent.blog/2026/04/04/anthropic-bans-third-party-ai-agents-from-claude-subscriptions/ · https://alternativeto.net/news/2026/2/anthropic-officially-bans-using-subscription-authentication-for-third-party-claude-use
- Permitted-vs-banned line, official CLI subprocess — https://autonomee.ai/blog/claude-code-terms-of-service-explained/
- Zed on subscription limits with the official CLI — https://zed.dev/blog/anthropic-subscription-changes
- OpenAI Codex fork/ToS discussion — https://github.com/openai/codex/discussions/8338
- GLM Coding Plan supported tools + endpoints — https://docs.z.ai/devpack/tool/others
- MCP spec 2026-07-28 — https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/
- MCP Tool Search / progressive disclosure — https://mcp.directory/blog/mcp-context-bloat-fix-2026-tool-search-code-mode-progressive-disclosure · https://www.aibase.com/news/24669
- `llms.txt` convention — https://llmstxt.org/
- WrongStack — https://github.com/WrongStack/WrongStack (MIT)
- alicankiraz1 — https://github.com/alicankiraz1/indexandria · `/ClaudeQB` · `/CodexQB`
