# GPT-5.6 Agent Routing Benchmark

Date: 2026-08-02; Host: Apple M2, 8 CPU cores, 8 GiB RAM, macOS 26.5.2; Codex: `codex-cli 0.146.0`

## Executive conclusion

The measured implementation and review evidence is consistent with a Sol-orchestrated, role-separated workflow, but it does not support using maximum reasoning everywhere. Sol orchestration itself was not benchmarked; it remains a provisional workflow choice.

Recommended defaults:

| Role or workload | Default | Escalation | Why |
| --- | --- | --- | --- |
| Main orchestrator | Sol High, Standard, provisional | Sol Max only for high-consequence or adversarial decisions | Only review was measured: High and XHigh produced the same routing conclusions, while Max cost more than twice as much but found one real edge the others missed. |
| Routine, fully specified implementation | Luna XHigh; Fast only when latency matters | Terra Medium if the Luna worker fails a deterministic gate | Luna XHigh passed the primary suites and the post-hoc long-decimal contract edge. Luna Max added no measured quality. |
| Defined complex implementation | Terra Medium, Standard, as a time-cost preference | Luna XHigh for quota-first work; Terra High only after a gate failure or risk trigger | Every configuration passed. Terra Low was fastest; Medium was 5.7 seconds slower and used 24% fewer credits in one run. There was no measured quality separation. |
| Underdefined or consequential request | Block coding; provisional Sol clarification gate; Terra Medium as a read-only analyst | Sol High reviewer for disputed requirements | Every implementation candidate correctly deferred. The Sol clarification step is a workflow policy, not a measured benchmark cell. |
| Fresh code review | Sol High, read-only | Sol Max for strict contracts, security, money, migrations, concurrency, or release blockers | XHigh added no useful finding over High. Max discovered the only confirmed post-hoc defect. |
| Bounded retrieval or high-volume classification | Luna Medium or High, read-only, Standard | Terra Medium for synthesis | This is consistent with official model guidance, but Luna Medium was not part of the coding matrix and remains provisional. |

Directly measured cells cover Luna and Terra implementation plus Sol review. Orchestration, research, gate authorship, and test authorship model choices below are explicitly extrapolated workflow hypotheses.

The user's quota-stretch hypothesis is directionally correct. Under the current Codex credit rate card, Luna is exceptionally cheap. Across all three measured tasks, Luna XHigh consumed an estimated `0.915` credits versus Terra Medium's `4.854`, although Luna XHigh took `341.5` summed seconds versus Terra Medium's `152.0`.

The specific `Luna Max everywhere` proposal is not supported. Luna Max took `527.4` summed seconds and `1.411` estimated credits, versus Luna XHigh at `341.5` seconds and `0.915` credits, without passing any contract-supported diagnostic that XHigh failed.

The deterministic scorer originally named Terra Low as the global winner. That result should not be used as a cross-scenario routing policy: a post-hoc routine test confirmed that Terra Low violates an unbounded leading-zero requirement that the frozen suites missed. This does not disqualify Terra Low from the defined-complex cell, where it passed every gate and was fastest.

## What was measured

Nine model/reasoning configurations each ran three isolated tasks once, producing 27 primary records:

- Luna: High, XHigh, Max.
- Terra: Low, Medium, High, XHigh, Max, Ultra.
- Scenarios: routine fully defined, complex fully defined, and complex underdefined.

All candidates were explicitly invoked with the Standard/default requested service tier; provider telemetry did not expose a separate effective-tier value. Recursive delegation and network access were disabled. Three candidate processes ran concurrently. Every run used a fresh temporary repository and credential-free temporary `HOME`, with only authentication transported through a separate temporary `CODEX_HOME`.

The scenarios were:

1. `routine_defined`: exact `Retry-After` parsing with ten explicit rules.
2. `complex_defined`: exact dependency scheduling with validation, Kahn residual reporting, and exhaustive capacity-subset optimization.
3. `complex_underdefined`: a production cache request whose operational policy was deliberately unresolved; a safe candidate had to defer code and emit only a structured clarification artifact.

The benchmark used one run per cell. It is a local routing study, not a statistically powered model leaderboard.

## Independence and quality gates

The orchestration assigned separate authorship roles:

```text
scenario author
    -> independent gate author + independent test author
    -> frozen contract and held-out tests
    -> candidate model under test
    -> deterministic runner/evaluator
    -> independent pipeline reviewer
    -> four fresh blinded Sol reviewers
    -> independent post-hoc test author + different test reviewer
```

No candidate workspace contained the held-out tests, and no candidate output changed a test, gate, or review artifact. The four Sol reviewers' raw traces and packet hashes support their read-only isolation: they received one identical anonymous evidence packet, and model identities were joined only after review.

The provenance boundary is narrower for the pre-freeze test, gate, and pipeline-author assignments. The harness enforces distinct stable role labels, but labels alone do not authenticate the underlying agent identities or chronology. The post-hoc author/reviewer sequence is preserved in a [retrospective reviewer verdict](review/posthoc/REVIEW_VERDICT.md); that record is useful process evidence, not cryptographic proof of chronology. These limitations do not affect candidate/test isolation or deterministic score reproduction.

Final frozen infrastructure checks:

- Runner tests: `13/13`.
- Evaluator self-tests: `18/18`.
- Adversarial infrastructure verification: `26/26`.
- Dry-run cardinality: `27/27` unique planned runs.
- Bound control files: `8/8`.
- Final calibration: [retained immutable score](runner/results/calibration-final-v12-luna-high-routine-20260802/records/20260802T064323Z-routine_defined-luna-high-45ca5486/score.json) confirms `9/9` gates and public and held-out pass; its source record contains zero external-access and delegation events.
- Primary execution: `27/27` records completed, no runner timeout, no runner error.

Frozen hashes:

| Artifact | Hash type | SHA-256 |
| --- | --- | --- |
| Gate contract | Canonical integrity hash excluding its self-hash field | `3d0193e6790c03dbc131d4cf6fa1b505e1e08cce284e7a7f1fae77e447b4a156` |
| Scenario manifest | Canonical integrity hash excluding its self-hash field | `0c54e6be9d29c5ec7b9022b05d1d528f460f081afb29d19f966885b054ab39f9` |
| Runner | Raw file hash | `8d757070f8348cdb32fad16fedfee39c888c25ed3daea26eeb737b3b0199d08b` |
| Evaluator | Raw file hash | `15ff49b62c7d63014798f45c6762401ec21efe8dcb8ae42fed444ba0d5e6ba9e` |

Primary machine-readable and rendered scores are in:

- [batch-score.json](runner/results/primary-v12-20260802/evaluation-v1/batch-score.json)
- [batch-score.csv](runner/results/primary-v12-20260802/evaluation-v1/batch-score.csv)
- [batch-score.md](runner/results/primary-v12-20260802/evaluation-v1/batch-score.md)

## Primary result matrix

The credit estimates use the Codex rate card accessed on 2026-08-02:

- Sol: `125 / 12.5 / 750` credits per million uncached input / cached input / output tokens.
- Terra: `50 / 5 / 300`.
- Luna: `5 / 0.5 / 30`.

The formula uses the terminal usage recorded by Codex:

```text
((input - cached) * uncached_rate + cached * cached_rate + output * output_rate) / 1,000,000
```

Reasoning tokens are diagnostic subset metadata and are not charged a second time. Rates can change, so the raw token fields remain the authoritative evidence.

| Configuration | Routine frozen | Routine post-hoc | Defined complex | Underdefined behavior | Sum time (s) | Est. credits, all 3 |
| --- | --- | --- | --- | --- | ---: | ---: |
| Luna High | 9/9 pass | **Fail** | 9/9 pass | Safe defer; disputed hidden gate fail | 285.2 | **0.900** |
| Luna XHigh | 9/9 pass | **Pass** | 9/9 pass | Safe defer; disputed hidden gate fail | 341.5 | **0.915** |
| Luna Max | 8/9 published fail; telemetry false positive | **Pass** | 9/9 pass | Safe defer; disputed hidden gate fail; telemetry false positive | 527.4 | **1.411** |
| Terra Low | 9/9 pass | **Fail** | 9/9 pass | Safe defer; disputed hidden gate fail | **132.2** | 6.363 |
| Terra Medium | 9/9 pass | **Pass** | 9/9 pass | Safe defer; disputed hidden gate fail | 152.0 | **4.854** |
| Terra High | 9/9 pass | **Pass** | 9/9 pass | Safe defer; disputed hidden gate fail | 204.5 | 6.721 |
| Terra XHigh | 9/9 pass | **Fail** | 9/9 pass | Safe defer; disputed hidden gate fail | 324.6 | 8.425 |
| Terra Max | 9/9 pass | **Pass** | 9/9 pass | Safe defer; disputed hidden gate fail | 441.3 | 11.488 |
| Terra Ultra | 9/9 pass | **Fail** | 9/9 pass | Safe defer plus disputed latency question; hidden gate fail | 475.6 | 12.723 |

The 27-run primary matrix consumed an estimated `53.801` Codex credits under the current rate card. The four Sol reviews consumed another estimated `66.15` credits. Running four expensive reviewers on every ordinary task would therefore defeat the quota-saving goal.

## Scenario findings

### Routine fully defined

All nine implementations passed the frozen public and held-out functional suites. Luna Max's published fail came only from a telemetry false positive described below.

Sol Max then found an uncovered, contract-supported case: the contract allowed arbitrary leading zeroes, but several implementations called `int(value)` before removing insignificant zeroes. Python rejected a 5,002-digit string before the implementation could return `42`.

A separately assigned test author created a single bounded diagnostic. A different Sol High reviewer first issued `NO-GO` for contradictory documentation wording, the author corrected only that wording, and the reviewer then issued `GO`. The test was executed only after review. The [review verdict](review/posthoc/REVIEW_VERDICT.md) was persisted retrospectively and does not independently prove the sequence.

Post-hoc passes:

- Luna XHigh and Max.
- Terra Medium, High, and Max.

Post-hoc failures:

- Luna High.
- Terra Low, XHigh, and Ultra.

The [post-hoc test and results](review/posthoc/RESULTS.md) are sensitivity evidence. They do not rewrite the immutable primary scores.

Best measured routine choice: **Luna XHigh**. It is the cheapest robust Luna result and substantially outperformed Luna Max on time and credits. Terra Medium is the best measured Terra fallback.

### Complex fully defined

Every configuration passed all public and held-out tests and all nine gates. No measured quality separation justified Max or Ultra.

Efficiency highlights:

| Configuration | Time (s) | Est. credits | Output tokens | Reasoning tokens | Diff size |
| --- | ---: | ---: | ---: | ---: | ---: |
| Terra Low | **54.451** | 2.493 | **2,434** | **394** | **116** |
| Terra Medium | 60.189 | **1.905** | 2,584 | 578 | 124 |
| Terra High | 93.224 | 2.627 | 4,599 | 2,504 | 146 |
| Luna High | 163.991 | **0.432** | 7,875 | 3,996 | 141 |
| Luna XHigh | 184.621 | 0.440 | 8,966 | 6,348 | 149 |
| Terra XHigh | 164.058 | 4.120 | 8,162 | 4,514 | 153 |
| Terra Max | 233.820 | 5.358 | 11,251 | 8,769 | 143 |
| Luna Max | 250.755 | 0.640 | 13,165 | 10,612 | 145 |
| Terra Ultra | 300.537 | 7.086 | 15,933 | 12,784 | 132 |

Terra Low was the direct latency winner, and all four blinded reviewers selected it as the primary defined-complex route under the frozen evidence. Terra Medium was only 5.7 seconds slower and used about 24% fewer estimated credits in this single run. Choosing Medium as the operational default is therefore a time-cost preference plus a cross-task robustness hedge, not evidence that Medium produced higher-quality complex code. Terra Low remains the direct benchmark winner for this cell.

Luna High and XHigh were much cheaper in credits but substantially slower on Standard service. They remain valid quota-first alternatives when wall-clock latency is secondary.

### Complex underdefined

The most important behavioral result was positive: all nine candidates refused to invent a production cache policy, preserved every source and configuration file, and created only the allowed clarification artifact.

Eight candidates independently asked about the same five unresolved areas:

- Cache semantics.
- Consistency.
- Invalidation.
- Capacity.
- Availability.

The hidden test additionally required `security_isolation`. The public task fixed the cache key to `(product_id, currency)` but provided no tenant, authorization, trust-boundary, or data-isolation context. All four blinded Sol reviewers independently concluded that the mandatory hidden category was not entailed by the task. The published exact-category failures remain immutable, but this scenario cannot support a model-quality ranking on that gate.

Terra Ultra also asked about cache-operation latency inside the already fixed caller budget. Medium and Max reviewers considered that extra category less scope-disciplined; High and XHigh considered it permissible. This disagreement reinforces the conclusion that the scenario needs a human-rater rubric or a better-specified security boundary before reuse.

Descriptive efficiency favored Terra Medium at `37.955` seconds. Quota efficiency favored Luna: Luna XHigh used about `0.256` estimated credits, while Terra Medium used `1.449`.

## Two frozen-score defects

The original outputs were preserved. Corrections below are sensitivity analyses, not silent score edits.

### Unsupported hidden category

The underdefined held-out test required `security_isolation` without task evidence establishing a security boundary. This caused every candidate to fail despite universally safe deferral behavior. All four Sol reviewers agreed that the criterion should be removed or the task should explicitly introduce the missing boundary.

### False external-access event

The runner/evaluator tokenized command text and interpreted the negative ripgrep patterns `!/.git/**` and `!*/.git/**` as access to an absolute `/.git/**` path. Those patterns exclude Git paths from a repository-local file listing; they do not access the root filesystem.

This affected Luna Max in the routine and underdefined scenarios. Raw JSONL showed no external read command, network request, or external file change. All four Sol reviewers independently classified both events as false positives.

Future telemetry must parse shell syntax and glob intent, or consume sandbox-level filesystem events, instead of treating every absolute-looking substring as proof of access.

## Blinded Sol reviewer comparison

Four fresh GPT-5.6 Sol instances independently received the exact same 97 KB anonymous packet and exact same JSON output schema. Only reasoning effort changed. Reviewers had a read-only sandbox, no network, no delegation, and an isolated repository containing only the packet.

| Sol effort | Time (s) | Input | Cached | Output | Reasoning | Est. credits | Material result |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Medium | **146.093** | 227,134 | 186,112 | **4,773** | **2,476** | **11.03** | Found the telemetry and hidden-gate defects; proposed two additional qualitative tier splits, one of which was outside the exact contract. |
| High | 202.347 | **141,634** | **95,232** | 6,723 | 5,059 | 12.03 | Same core corrections and routing as XHigh; no new contract bug. |
| XHigh | 213.964 | 247,515 | 198,912 | 7,563 | 5,489 | 14.23 | Same routing and quality tiers as High; no material added value. |
| Max | 405.014 | 406,747 | 318,720 | 18,480 | 15,814 | 28.85 | Uniquely identified the arbitrary-zero-padding defect later confirmed by an independent test. |

All four returned `valid_with_caveats` with medium confidence. Consensus:

- `4/4`: the external-access events were false positives.
- `4/4`: mandatory `security_isolation` was unsupported.
- `4/4`: Terra Low was the efficiency leader for the defined complex task before post-hoc sensitivity.
- `4/4`: Terra Medium was the preferred underdefined analyst based on safe behavior and speed.
- `3/4`: Terra Low for routine based on frozen tests and speed.
- `1/4` (Max): Luna XHigh for routine based on stricter code-level contract analysis. The post-hoc test validated Max's objection and invalidated the frozen-test-only majority.

The evidence supports **Sol High as the normal fresh reviewer** and **Sol Max as a conditional adversarial reviewer**. XHigh was pure overhead in this packet. Medium is adequate for bounded result summarization but should not be the only reviewer for strict behavioral contracts.

Review artifacts:

- [Exact anonymous packet](review/REVIEW_PACKET.md)
- [Exact reviewer prompt](review/reviewer_prompt.txt)
- [Medium review](review/results/sol-blind-v2/medium/review.json)
- [High review](review/results/sol-blind-v2/high/review.json)
- [XHigh review](review/results/sol-blind-v2/xhigh/review.json)
- [Max review](review/results/sol-blind-v2/max/review.json)

## Fast mode assessment

Fast mode was not used in the candidate matrix. Official Codex documentation states that Fast mode provides approximately `1.5x` model speed and consumes `2.5x` Standard credits for GPT-5.6. It must not be described as a free latency improvement.

Nominal, unmeasured projection for the robust routine choices:

| Configuration | Measured Standard | Measured Standard credits | Nominal Fast time | Nominal Fast credits |
| --- | ---: | ---: | ---: | ---: |
| Luna XHigh | 74.1 s | 0.218 | about 49.4 s | about 0.546 |
| Luna Max | 177.1 s | 0.468 | about 118.1 s | about 1.169 |
| Terra Medium | 53.8 s | 1.500 | about 35.9 s | about 3.749 |

Even after the Fast multiplier, Luna XHigh remains much cheaper than Terra Medium in this projection and approaches its Standard latency. Luna Max remains slower and more expensive than Luna XHigh. This supports a dedicated Luna XHigh Fast routine worker, not a global Fast default and not a Luna Max default.

For defined complex work, nominal Luna XHigh Fast would be about `123` seconds and `1.10` credits, versus measured Terra Medium Standard at `60` seconds and `1.905` credits. The routing choice is therefore a real quota-versus-latency trade-off.

A controlled Standard-versus-Fast A/B test should precede permanent Fast configuration.

## Proposed agent architecture

This section is a recommendation only. Sol orchestration and the proposed gate/test-author model assignments were not directly benchmarked. No global Codex configuration, agent file, hook, or skill was changed during the benchmark.

### Global defaults

Use a modest concurrency ceiling and make role-specific files authoritative:

```toml
[features]
multi_agent_v2 = true

[agents]
enabled = true
max_concurrent_threads_per_session = 4
default_subagent_model = "gpt-5.6-luna"
default_subagent_reasoning_effort = "xhigh"
```

`multi_agent = true` is unnecessary when V2 is enabled; current Codex source says enabled V2 takes precedence. `agents.enabled` already defaults to true, but keeping it explicit is reasonable. The user's copied curly quotation marks are invalid TOML and must be replaced with ASCII quotes. A leading space in `name = " luna_worker"` must also be removed.

Ten concurrent subagent threads are not justified on this 8 GiB machine. Three tool-heavy candidates and four read-only reviewers were stable. A cap of four, plus explicit non-overlapping write ownership, is a safer starting point.

### Named agents

| Agent | Suggested model | Permissions | Responsibility |
| --- | --- | --- | --- |
| `luna_routine_worker` | Luna XHigh, optionally Fast | Workspace write in an isolated worktree | Small, explicit, repetitive implementation; no architecture decisions. |
| `luna_research_worker` | Luna Medium or High, Standard | Read-only plus approved web/docs tools | Bounded retrieval, extraction, inventory, and classification. Never broad Max exploration. |
| `terra_complex_worker` | Terra Medium, Standard | Workspace write in an isolated worktree | Defined multi-file or algorithmic implementation after contract and gates exist. |
| `terra_ambiguity_analyst` | Terra Medium, Standard | Read-only | Identify unresolved decisions and produce a decision artifact; never implement through ambiguity. |
| `independent_test_author` | Terra High, Standard | Separate worktree; tests only | Write public and held-out tests before candidate implementation. |
| `independent_gate_author` | Terra Medium, Standard | Gate artifacts only | Encode deterministic acceptance, scope, integrity, and failure behavior. |
| `sol_reviewer` | Sol High, Standard | Read-only | Fresh review after implementation and deterministic tests. |
| `sol_adversarial_reviewer` | Sol Max, Standard | Read-only | Conditional review for strict contracts and high-consequence changes. |

The model choices for test and gate authors are conservative workflow defaults, not direct outcomes of this coding matrix. Their quality must be benchmarked separately.

### Required orchestration protocol

1. The Sol orchestrator classifies scope and risk.
2. A gate author and test author work independently before implementation where practical.
3. The orchestrator assigns exactly one owner per overlapping write set.
4. The worker implements only the delegated contract.
5. A deterministic runner checks changed paths, dependencies, format/lint/type checks, public tests, held-out tests, and artifact integrity.
6. A fresh read-only Sol High reviewer inspects the diff and test evidence.
7. Sol Max is added only when a risk trigger fires or High and deterministic evidence disagree.
8. The orchestrator, not the writer, summarizes the result to the user.

Hard rules:

- A code writer never reviews its own work.
- A code writer never authors the hidden test or quality gate that scores it.
- A reviewer never edits the patch it reviews.
- Failed deterministic gates return to a fresh implementer turn; they are not waived by prose.
- An underdefined consequential request produces a clarification artifact, not speculative code.
- Parallel writers require disjoint path ownership or isolated worktrees.

### Hooks and skills

Claude Code's useful behaviors are lifecycle isolation, scoped tool permissions, fresh subagent contexts, worktree isolation, and deterministic hooks. Its documentation also warns indirectly about context inheritance: ordinary subagents can still load global/project instructions and preloaded skills. The behavior should be ported, not the entire Claude directory tree.

Recommended Codex hook boundaries:

- Before spawn: validate role, task contract, worktree, and allowed paths.
- Before edit: record Git state and reject overlapping write ownership.
- After worker: compute changed paths and dependency deltas.
- Before handoff: run deterministic gates and retain exact output.
- After review: verify the reviewer was read-only and distinct from the writer.

Hooks should execute deterministic commands. They should not use an LLM as the final quality gate.

Global instructions should retain only language policy, destructive-action safety, role separation, and deterministic gate requirements. Skills should be loaded on demand by the relevant named agent. Loading broad skill libraries into every worker increases context and encourages ritualized overengineering.

## DeepSeek through OpenCode

Native Codex subagent spawning in this environment exposes OpenAI model families, not DeepSeek. DeepSeek is feasible as an external worker through an adapter, not as a native `spawn_agent` target.

Official OpenCode documentation confirms:

- A DeepSeek provider can be connected.
- `opencode run` supports non-interactive execution.
- The CLI accepts explicit `--model`, `--agent`, `--format json`, and `--dir` arguments.
- Custom agents can deny edits, shell commands, web access, or other tools.

Safe integration design:

1. Codex creates an isolated worktree and a bounded English task envelope.
2. An adapter invokes `opencode run` with an explicit DeepSeek model and custom agent.
3. The adapter captures raw JSON, token/cost metadata, time, changed paths, and final output.
4. The adapter rejects writes outside the allowlist and strips credentials from the child environment.
5. Independent Codex-authored deterministic tests and gates score the result.
6. A fresh Codex reviewer reviews any retained patch.

DeepSeek should initially receive only routine transformations, inventories, fixtures, or documentation tasks. It should not author its own gate, merge its own patch, or handle secrets.

OpenCode is not currently installed on this Mac. Current official Go documentation lists an introductory first month at **USD 5**, then **USD 10/month**, with usage-value limits of USD 12 per five hours, USD 30 per week, and USD 60 per month. Its published typical-use estimates are very high for inexpensive models—about 8,550 weekly requests for DeepSeek V4 Pro and 79,050 for DeepSeek V4 Flash—but the service is not unlimited and the limits may change. The user's USD 5 figure is the promotional first-month price, not the ongoing price.

## External evidence

OpenAI describes Sol as the flagship, Terra as the balanced tier, and Luna as the fastest and most affordable tier. Its published Coding Agent Index results are close enough to make routing and effort selection important: Sol `80`, Terra `77.4`, Luna `74.6`. [OpenAI GPT-5.6 launch and pricing](https://openai.com/index/gpt-5-6/)

The current token-based Codex rate card gives Luna a much lower credit rate than Terra and notes that Fast mode consumes more credits. [Official Codex rate card](https://help.openai.com/en/articles/20001106-codex-rate-card.docx)

Official Fast mode documentation states the `1.5x` speed and `2.5x` GPT-5.6 credit multiplier and requires `service_tier = "fast"` plus `[features].fast_mode = true` for a persistent default. [Official Codex Speed documentation](https://developers.openai.com/codex/speed)

Official Codex subagent documentation supports standalone `~/.codex/agents/*.toml` files, per-agent model/reasoning/sandbox configuration, and global `[agents]` defaults. It specifically recommends Luna for clear repeatable work, Terra for efficient scans/supporting work, High for edge-focused reviewers, and Medium as the balanced agent default. [Official Codex Subagents documentation](https://learn.chatgpt.com/docs/agent-configuration/subagents)

Current Codex source confirms `max_concurrent_threads_per_session`, default subagent model/effort, custom roles, and V2 precedence. [OpenAI Codex configuration source](https://github.com/openai/codex/blob/main/codex-rs/config/src/config_toml.rs)

Artificial Analysis independently reports Luna and Sol ahead of Terra on its intelligence-versus-cost Pareto chart. That broad result agrees with Luna's quota efficiency here, while this local benchmark also shows Terra's wall-clock advantage on defined implementation. [Artificial Analysis GPT-5.6 cost comparison](https://artificialanalysis.ai/articles/gpt-5-6-intelligence-vs-cost-across-sol-terra-luna)

Claude Code's official documentation supports fresh subagent contexts, tool restrictions, per-agent effort, worktree isolation, memory, and scoped hooks. Those lifecycle concepts inform the proposed design. [Claude Code subagents](https://code.claude.com/docs/en/sub-agents), [Claude Code hooks](https://code.claude.com/docs/en/hooks)

OpenCode documents DeepSeek provider support, non-interactive CLI execution, custom agents, tool permissions, and the current Go plan limits. [OpenCode providers](https://opencode.ai/docs/providers), [OpenCode CLI](https://opencode.ai/docs/cli/), [OpenCode agents](https://opencode.ai/docs/agents/), [OpenCode Go](https://opencode.ai/docs/go/)

## Limitations

- One run per model/scenario cell is not statistically significant.
- Concurrent execution makes wall time descriptive rather than precise.
- The tasks are small Python standard-library fixtures, not repository-scale product changes.
- Fast mode was projected from official guidance, not measured.
- Research, frontend, database, security, and multi-file integration roles were not directly benchmarked.
- Sol orchestration, clarification, and gate/test-author roles were not directly benchmarked; their model assignments are workflow hypotheses.
- The underdefined hidden criterion was invalid for ranking and needs redesign.
- External-access telemetry had a lexical false positive and needs shell-aware parsing.
- The post-hoc routine test was created after the blinded reviews; it is valid sensitivity evidence but not part of the frozen primary score.
- Same-configuration variance is material: final Luna High routine calibration took `107.0` seconds and `157,062` input tokens, while the primary run took `62.8` seconds and `68,871` input tokens. Both passed. Efficiency rankings need replication.
- Model and credit rates are current as of 2026-08-02 and may change.

## Audit trail

An early pre-freeze calibration exposed two evaluator path-integration defects. Those defects were fixed before the final freeze, and that calibration was excluded. A fresh post-freeze calibration passed all gates.

The first Sol review harness attempt failed in about 0.12 seconds before any model call because the isolated directory was not a trusted Git repository. Its failed records were retained. The second attempt completed all model calls. Its local validator then checked `routing.scenario_id`, although the frozen output schema correctly required `routing.workload`; original records were preserved, the validator was fixed, and immutable post-validation records confirmed all four outputs. Review content was not changed.

These failures are included because benchmark infrastructure is code and must be audited with the same skepticism as candidate code.

## Decision

Proceed to the configuration redesign with these starting hypotheses, preserving the measured-versus-extrapolated distinction:

- Sol High as the provisional orchestrator and measured normal reviewer.
- Luna XHigh routine worker; Fast only in its dedicated urgent profile.
- Terra Medium as the operational time-cost default for defined-complex work and the measured ambiguity analyst; retain Terra Low as the direct defined-complex benchmark winner.
- Sol Max as an automatic risk-triggered reviewer, not a default worker.
- Four-thread subagent ceiling on this Mac.
- Separate test author, gate author, implementer, runner, and reviewer identities.
- Deterministic gates and isolated worktrees before model-based review.
- External DeepSeek/OpenCode adapter only after its own benchmark and permission hardening.
- Minimal global protocol; role-specific skills loaded selectively.

Do not install or modify the global configuration until the user approves the architecture phase.
