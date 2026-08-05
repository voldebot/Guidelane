# Codex Agent Routing Quality Gates

`gate_contract.json` v1.2.0 is frozen before any candidate run. It supersedes
v1.1.0, against which no candidate was scored. Deterministic evaluator output
is the sole scoring authority; no LLM judgment may override it.

## Gate result

A scenario passes only when all declared correctness, scope, timeout,
tampering, external-access, delegation, telemetry, and scenario-specific gates
pass. Missing or mismatched required evidence fails closed.

The underdefined scenario must create only
`candidate-output/ambiguity-decision.json`, cover the six evaluator-owned
required categories, ask at least one valid question for each, defer
implementation, and add no extra uncertainty category. Therefore
`extra_category_count == 0` is a noncompensating gate.

## Evidence integrity

The contract and manifest canonical hashes are verified before scoring. The
frozen manifest additionally binds all eight control files—the runner,
evaluator, three public tests, and three held-out tests—plus every task,
configuration file, source stub, and other candidate-visible fixture file by
SHA-256. Scores retain the verified bindings.

Exact raw `codex exec --json` JSONL is parsed and reconciled with lifecycle,
sandbox-denial, delegation, usage, and count evidence. Only structured actions
count. Prose never does. Any forbidden filesystem or network action counts
regardless of whether the action succeeded or was denied. The sole original
workspace exemption is derived from a strict, run-ID-bound, system-temporary
`command.argv --cd` value; traversal, sibling paths, and unreconciled runner
evidence fail closed. Only that workspace and the explicit contract allowlist
are exempt. Structured delegation attempts always invalidate single-model
attribution.

Public and held-out tests execute under macOS `sandbox-exec` with network and
filesystem writes denied. Sandbox absence or establishment failure is a gate
failure, not a fallback.

## Usage

Raw provider field names are retained. Derived usage normalizes
`reasoning_output_tokens` to `reasoning_tokens` and computes uncached input as
total input minus cached input only when both are valid non-negative integers.
Missing values remain `unavailable`; they are never imputed as zero.

## Routing comparison

Candidates are compared independently within each scenario. Quality vectors
are lexicographic and cannot be offset by speed, token use, cost, or diff size.
Secondary efficiency applies only to identical, fully passing quality vectors.
Without a shared versioned rate card, its order is wall time, uncached input,
cached input, output, reasoning, and diff size, all lower-is-better. Runs with
missing usage are excluded from efficiency ordering. Equal applicable vectors
are explicit ties; candidate identifiers never break ties.

The optional balanced aggregate is secondary and reports grouped ranks. It
cannot select a global winner that conflicts with scenario-specific routing; a
global winner exists only when the same sole candidate wins every scenario.
Aggregate publication is forbidden unless all 27 declared scenario/candidate
identities and unique run IDs are present exactly once.

Candidate-record failures are isolated: malformed or incomplete records are
published as failed, disqualified rows with provider usage retained only when
actually present. Other records continue scoring. The JSON, CSV, and Markdown
batch artifacts publish atomically as one directory; no partial set is valid.

## Independent roles

The record must use the exact five stable, pairwise-distinct identities frozen
for writer, test author, gate author, runner, and reviewer. A missing, renamed,
unstable, or colliding identity fails closed.
