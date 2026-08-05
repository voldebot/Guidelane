# Codex Agent Routing Evaluator

`evaluator.py` is the deterministic, standard-library-only implementation of
the frozen v1.2.0 gate contract. It does not invoke a model or the network.

## Commands

```sh
python3 benchmarks/codex-agent-routing/evaluation/evaluator.py --record-dir /path/to/record
python3 benchmarks/codex-agent-routing/evaluation/evaluator.py --batch /path/to/results --output-dir /path/to/output --aggregate
python3 benchmarks/codex-agent-routing/evaluation/evaluator.py --self-test
python3 benchmarks/codex-agent-routing/evaluation/evaluator.py --baseline-check
```

Scores and batch artifacts are created exclusively with mode `0444`; existing
outputs are never overwritten.

## Frozen inputs

Before scoring, the evaluator verifies:

- the RFC 8785-style canonical SHA-256 of `gate_contract.json`;
- the documented canonical SHA-256 of `scenario_manifests.json`;
- all eight control-file hashes in `control_file_hashes`: the frozen runner and
  evaluator implementations plus the three public and three held-out tests;
- every candidate-visible task, configuration, source stub, and public test
  hash in `fixture_file_hashes`.

Any missing file, symlink, hash mismatch, or incomplete candidate-visible hash
coverage fails closed. Verified hashes are retained in the score audit.

## Runner record interface

The record uses `record_version: codex-agent-routing-run-record/v1` and binds
the frozen contract and scenario manifest hashes. Required evidence includes
the audited baseline manifest, retained candidate snapshot and manifest,
complete changed-path delta, candidate wall time and timeout evidence, raw
Codex JSONL metadata, raw provider usage, service-tier evidence, write policy,
and role assignments.

The record directory is resolved to an absolute real directory before any
artifact is read. `candidate_snapshot.path` and `raw_tool_telemetry.path` are
normalized POSIX paths relative to it; symlinks and path escapes fail closed.
Manifest entries are regular files, directories, or symlinks. File entries
carry SHA-256; symlink entries carry their target. The evaluator independently
rebuilds both manifests and their delta instead of trusting runner summaries.

Role assignments must contain exactly these distinct stable identities:

```json
{
  "writer": "candidate-model-under-test",
  "test_author": "independent-test-author",
  "gate_author": "independent-gate-author",
  "runner": "independent-runner",
  "reviewer": "independent-pipeline-reviewer"
}
```

## Raw Codex JSONL

`raw_tool_telemetry` points to the exact UTF-8 output of `codex exec --json`.
The evaluator parses top-level events directly. A complete lifecycle has one
leading `thread.started`, one later `turn.started`, typed
`item.started`/`item.completed` objects, and one terminal `turn.completed`
whose `usage` object exactly matches `raw_provider_usage`.

Blank, malformed, non-object, untyped, truncated, duplicated terminal, or
unreconciled evidence fails closed. Raw event count, sandbox denials,
delegation calls, terminal usage, lifecycle completeness, and the raw file hash
must agree with the record.

Only structured command, file-change, and tool-call items are action evidence.
Agent prose is never scanned. Forbidden filesystem and network actions count
whether their outcome is allowed or denied. The original workspace is accepted
only from the record's single absolute `command.argv` `--cd` value when it is a
direct system-temporary child named for the exact run ID and distinct from the
retained snapshot. Paths inside that workspace and the contract's exact
deterministic system/instruction allowlist are exempt; traversal and sibling
paths remain external. Computed external events must exactly match the record.
Delegation counts only structured delegation item types or exact tool names;
every attempt counts, including denied attempts.

Provider fields remain unchanged in `raw_provider_usage`. Derived usage maps
provider `reasoning_output_tokens` to `reasoning_tokens`, supports the declared
cached-token field variants, and derives uncached input only from valid totals.
Missing usage remains `unavailable` and is excluded from efficiency ordering.

## Controlled tests

Public and held-out evaluator-owned tests import the retained candidate under
macOS `/usr/bin/sandbox-exec`. The profile denies all network access and all
filesystem writes, and `PYTHONDONTWRITEBYTECODE=1` is set. Missing or unusable
`sandbox-exec` fails closed. Candidate-owned tests are never executed as gate
oracles.

## Scoring and comparison

Every scenario must pass every declared gate. The underdefined scenario also
requires exactly the six held-out-required uncertainty categories;
`extra_category_count` must be zero and cannot be compensated by another
metric.

Batch comparison is scenario-local. Quality is lexicographic and precedes
efficiency. Only identical, fully passing quality leaders enter secondary
ordering by wall time, uncached input, cached input, output, reasoning, and diff
size. Missing usage excludes that run from efficiency ordering. Equal vectors
produce an explicit tie without candidate-ID tie-breaking.

The optional balanced aggregate is labeled secondary. It reports rank groups
and may name a global winner only when the same sole candidate is preferred in
every scenario; otherwise it reports no global winner. Aggregate publication
requires the frozen 27-run matrix: every declared scenario/candidate identity
and every run ID must occur exactly once.

An invalid, timed-out, truncated, or incomplete candidate record becomes an
immutable failed score with its original raw usage retained when present and
all derived usage marked `unavailable`. It does not abort scoring of other
records. Contract, manifest, control-file, or fixture-file integrity failures
remain cohort-level failures.

`batch-score.json`, `batch-score.csv`, and `batch-score.md` are built in a
staging directory and published together by one directory rename. A publication
failure removes staging data and leaves no partial batch output directory.

## Local validation

`--self-test` covers real raw lifecycle parsing, allowed-outcome forbidden
access, structured delegation, role collision, oracle tampering, sandboxed
outside-write denial, reasoning-token mapping, explicit ties, and incomplete
telemetry. It also covers absolute original-workspace changes, relative record
directories, symlinked record-artifact rejection, traversal and sibling
rejection, mixed valid/incomplete batch continuation, all three batch artifacts,
atomic publication cleanup, lifecycle completion preference, and aggregate
cohort completeness. `--baseline-check` confirms the two defined baselines fail
only via
`NotImplementedError` and the underdefined baseline fails only because its
decision artifact is absent.
