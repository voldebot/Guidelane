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
things with the code. No Guidelane server exists — everything runs on your
machine.

---

## Status: not usable yet

Read this part before anything else.

**What exists today**: research, eight architecture decisions, and one piece of
working code — `tools/probe/`, a 30-probe conformance suite that measures what
the engine actually does.

**What does not exist**: the cockpit, the orchestrator, the Atlas MCP server, the
behaviour pack, the stack profile. All of it. There is nothing to install and
nothing to run except the probe.

**Honest timeline**: 2.5–4 months of steady work, per an independent review of
the plan. macOS only for now.

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

The only thing here you can run today. Node 22, zero dependencies.

```bash
node tools/probe/run.mjs          # free tier: help-text + observational (13 probes)
node tools/probe/run.mjs --live   # + 17 live probes (spends your quota)
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
| [`docs/decisions/`](docs/decisions/) | ADR-001..008. **007 and 008 are measured, not reasoned** |
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
