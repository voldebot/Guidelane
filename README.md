# Guidelane

**A local-first production line that lets non-coders build real, working software.**

You describe what you want. The official `claude` CLI — the same binary you
already installed, running under your own subscription login — does the thinking
and the coding. Guidelane's own code enforces the *process*: a staged pipeline,
quality gates the model cannot open, product memory that is always present, and a
plain-language surface with no file paths, terminals, or diffs in it.

MIT licensed, and run as a non-commercial project — no paid tiers, no hosted
service, nothing to sell you. That is a choice about how *this* project is run,
not a restriction in the licence: MIT lets anyone, including you, do commercial
things with the code. No Guidelane-operated remote server exists — the pilot
process and its loopback cockpit run only on your machine.

---

## Status: offline safety spine accepted, not a usable friends pilot yet

Read this part before anything else.

**What exists today**: the 36-probe engine conformance suite, the tested
`packages/engine` adapter (60 offline tests plus 2 opt-in live tests), and an
S2 offline safety spine: a fail-closed orchestrator, a Local Web profile
harness, and a Turkish-first localhost cockpit exercised against a fake
orchestrator in Chromium and WebKit. A post-close orphan finding in the Local
Web harness led to the Final-44–54 remediation sequence. Final-54 is the first
complete recorded frozen offline contract. The accepted offline surface now has
lease-supervised process cleanup, per-attempt boot authority, and exact
one-to-one artifact-index validation. Its source-bound offline evidence,
reviews, final documentation-binding replay, and deliberately separate
live/pilot blockers are recorded in `docs/research/sprint-03-novice-pilot/`;
this is not a live-engine or friends-pilot claim.

**What is deliberately unavailable**: a public installer, an enabled real build
phase, Atlas, Night Shift, multiple projects, deployment, accounts, payments,
and external APIs. The cockpit and profile are offline evidence surfaces, not a
claim that a friend can safely build an application today.

The intended pilot target is owner-installed macOS with current desktop Safari
or Chrome. Friends-pilot distribution remains blocked until the limited
owner-operated live gates, real Safari/Chrome smoke checks, required GitHub
checks, and the written Anthropic headless-subscription response are recorded.
The tested Claude CLI baseline remains `2.1.220`.

This repository is public because the reasoning should be auditable, not because
the product is ready.

---

## Why it exists

LLMs write plausible code and then report success. They lose the product's intent
across a long session, miss which files a change breaks, and certify their own
work. Existing tools either hand the whole problem to the model or require you to
be an engineer.

Guidelane's bet is that the discipline has to live in *code*, not in a prompt:

- **No self-certification.** No claim is accepted from the session that produced
  the work. Functional claims are machine-verified — exit codes, a booting app, a
  screenshot. Judgment claims come from a separate, isolated session and act as a
  brake, not a proof.
- **Gates that scale but never skip.** Two change-classes; when in doubt it rounds
  up; anything touching data or auth always gets the full treatment.
- **Evidence over claims.** "It works" means an exit code, a boot, a screenshot,
  or your own click — in that order.
- **Honest degradation.** "I tried three times and failed; let's simplify" beats
  a silent retry loop and a fake success.
- **An eject guarantee.** What gets built is a standard, boring project with no
  Guidelane runtime dependency. You can always leave.

## The compliance stance

Guidelane spawns the official vendor CLI under your own login. It never reads,
stores, or transmits a credential — not once, not anywhere. There are no ToS
workarounds in this codebase and there will not be: no credential extraction, no
PTY-as-billing-dodge, no multi-account rotation. When a limit is hit, it waits.

Two written inquiries are drafted and unsent, in `docs/inquiries/` — one to
Anthropic about headless use under a subscription, one to z.ai about their coding
plan's tool allowlist. They are in the open because the answers gate real
decisions here, and pretending the questions do not exist would be the dishonest
option. Engines stay unshipped until they are answered.

## What is measured, not assumed

The plan originally rested on assumptions about the engine. Several were wrong,
and the probe suite is what caught them:

| Assumption | What actually happens |
|---|---|
| `--permission-mode auto` lets a session write files | It **denies** the write headlessly — **and the model still reports success.** A live instance of the exact failure this product exists to catch. The contract is `auto` plus an explicit per-stage `--allowedTools`. |
| A spawned session starts clean | With `--strict-mcp-config` alone it inherited 4 plugins, 24 skills, 10 agents and a `bypassPermissions` default. Isolation needs `--setting-sources ''` too — and even then the CLI's built-in floor remains. |
| Rate limits must be handled by blind backoff | Every session emits `rate_limit_event.resetsAt`. Sleep to the boundary instead of guessing. |
| A spend ceiling is inert on a subscription | It is enforced. Measured on a session reporting `apiKeySource: none`. |
| The init receipt can confirm a tool server is connected | It cannot. `mcp_servers[].status` races the receipt — identical runs read `pending`, then `connected`, and nothing later corrects it. Registration is assertable; reachability needs an actual call. |

The suite is also audited against itself, because a conformance suite that is
wrong is worse than none. Two independent reviews of it in one sprint found
eleven instances of a single bug shape — **the harness inferred something where
it should have asserted it, and every inference failed open**. A guard that
could never throw; a session that could be spawned with no isolation while the
report said otherwise; two probes that reported "the engine denied it" from a
session that had crashed before reaching the engine. Those are fixed and named
in [`CLAUDE.md`](CLAUDE.md) §8 so the next one is recognised faster.

Details, per probe, in [`docs/research/S0-conformance-report.md`](docs/research/S0-conformance-report.md).

## Running the probe

The conformance suite remains the only owner-facing runtime command. Node 22 is
required; the free tier makes no authenticated engine call.

```bash
node tools/probe/run.mjs          # free tier: 14 probes, no quota use
node tools/probe/run.mjs --live   # + 22 opt-in live probes (spends your quota)
node tools/probe/run.mjs --list   # what each probe checks, and why it matters
```

Exit codes: `0` green · `1` the engine's contract changed · `2` the harness broke
· `3` inconclusive (a stall or a rate limit — says nothing about the engine).

Everything written to `docs/research/` passes through a redaction boundary first;
home paths, usernames and machine identifiers do not belong in a public repo.
See [`tools/probe/README-ci.md`](tools/probe/README-ci.md) for the scheduling
story, including why the live tier cannot run in CI.

## Reading order

| Document | What it is |
|---|---|
| [`PROJECT_MAP.md`](PROJECT_MAP.md) | The atlas: charter, principles, decisions, and a do-not-revisit list |
| [`docs/architecture.md`](docs/architecture.md) | Stack, module boundaries, budgets, security posture |
| [`docs/decisions/`](docs/decisions/) | ADR-001..010. **007–009 are engine-measurement-led; 010 is the offline S2 safety boundary** |
| [`docs/research/REVIEW-01-*.md`](docs/research/) | An independent adversarial review; governs v1 scope |
| [`docs/research/REVIEW-02-*.md`](docs/research/) | A second audit that found the runtime gaps; governs the S1 work list |
| [`CLAUDE.md`](CLAUDE.md) | The project constitution the AI agents working here must follow |

REVIEW-02 is the one worth reading if you only read one. It concluded that the
conformance suite was "strong on configuration and weak on runtime protocol" —
that it would pass green on a machine where the activity feed is unrenderable.
Seven of its findings block the next stage.

## Credits

Architecture and MIT-licensed code ideas from [WrongStack](https://github.com/wrongstack)
and the taste-skill work. Nothing is vendored from either yet — see
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md), which records the obligation
now so the first copy-paste cannot slip through unnoticed.

## License

MIT — see [LICENSE](LICENSE).
