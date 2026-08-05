# Benchmark Infrastructure Verification

This independent suite verifies the current runner against the current frozen evaluator, contract, and manifest. It loads frozen hashes through production preflight rather than duplicating versioned constants. It uses real `runner.run_one()` records, real evaluator scoring paths, temporary candidate snapshots, and a fake Codex executable. It makes no API, model, or network calls and never places synthetic solutions in scenario sources.

Coverage includes passing defined and underdefined runs, ambiguity-category restraint, timeouts, protected-file tampering, malformed telemetry, workspace-relative and absolute-path classification, frozen exact-path and path-prefix allowlist boundaries, validated original-workspace `--cd` evidence, relative record-directory evaluation, symlink escape rejection for `record.json`, external actions, allowed-path denials, role separation, runner and evaluator frozen-input integrity, evaluator sandboxing, credential-free candidate `HOME` behavior in actual zsh and Python processes, distinct auth-bearing `CODEX_HOME` isolation, lifecycle deduplication, provider usage mapping, explicit ties, the 27-run matrix, structured delegation reconciliation, fail-closed mixed batches, atomic batch publication, and aggregate-cohort identity validation.

Run from the repository root:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover \
  -s benchmarks/codex-agent-routing/verification \
  -p 'test_*.py' -v
```

The suite is intentionally fail-closed. An acceptance failure is retained when production runner and evaluator schemas disagree; verification code does not repair production benchmark code.
