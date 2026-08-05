# Current Verification Result

Command:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover \
  -s benchmarks/codex-agent-routing/verification \
  -p 'test_*.py' -v
```

Observed on 2026-08-02: 26 tests ran in 15.104 seconds; all 26 passed.

## Blockers

None in the verified infrastructure boundaries.

## Verified boundaries

- Runner and evaluator reconcile the exact completed lifecycle delegation evidence schema, including tool name and denied outcome.
- Runner records the exact frozen external-access allowlist and reconciles exact-path, prefix-boundary, and lookalike classifications with the evaluator; `/dev/null` is allowed while `/lib/example.py` is external.
- Relative record-directory evaluation resolves the retained candidate snapshot and its `src` import path absolutely; defined public and held-out tests both pass.
- Completed absolute `file_change` telemetry below the exact validated original `--cd` workspace reconciles as internal.
- Workspace siblings, parent traversal, lookalike workspace prefixes, and unrelated system-temp paths remain external and disqualifying.
- Missing, duplicate, and relative `--cd` workspace evidence fails closed.
- A symlinked `record.json` escaping its record directory is rejected, and fail-closed scoring does not extract identity or hash evidence from the external target.
- A credential-free candidate `HOME` is empty, distinct from the auth-bearing `CODEX_HOME`, observed by actual zsh and Python subprocesses, and cleaned after the run.
- Runner preflight rejects content changes in both held-out controls and candidate-visible fixtures.
- A mixed valid and incomplete batch retains the incomplete row as fail-closed and leaves unknown measurements as `unavailable` instead of inferred zeroes.
- Batch JSON, CSV, and Markdown outputs publish together; forced serialization failure leaves neither a final directory nor staging residue.
- The required 27-run aggregate cohort accepts the exact dynamic policy set and rejects missing rows, duplicate scenario/candidate identities, and duplicate run IDs.
- Passing defined and exact-six underdefined outputs pass real scoring, while extra ambiguity categories fail the relevant gate.
- Timeouts, malformed telemetry, role violations, protected edits, external access, and frozen-input tampering fail closed.
- Evaluator sandboxing blocks import-time file writes and network connects.
- Provider usage mapping, action deduplication, explicit ties, and dry-run cardinality remain deterministic.

Only files under `verification/` were changed by this verification work.
