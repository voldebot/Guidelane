# Codex Agent Routing Runner

Python 3.11+ standard-library harness for the frozen v1.2 benchmark (runner 1.3.1). It verifies the canonical contract and scenario-manifest hashes before planning or invoking Codex, then copies only the candidate-visible manifest paths from each direct `scenarios/<name>/` root into a system-temporary workspace.

```sh
python3 runner.py --dry-run
python3 runner.py --scenario routine_defined --model luna --effort high --jobs 2
python3 runner.py --results-dir /tmp/codex-routing-results --timeout-seconds 1200
```

Without `--timeout-seconds`, each scenario uses its manifest timeout. The matrix is Luna `high`, `xhigh`, `max`; Terra `low`, `medium`, `high`, `xhigh`, `max`, `ultra`.

Candidates receive the same shared policy prompt plus the scenario task, write policy, and public-test command. The invocation uses `--ignore-user-config`, `--ignore-rules`, `--strict-config`, an ephemeral JSONL session, `workspace-write`, `service_tier="default"` (logical Standard), explicit model/effort, disabled delegation features, zero project documentation, disabled skill instructions/bundled skills, disabled login shells, `shell_environment_policy.inherit="none"`, and the explicit non-secret candidate-tool PATH `/opt/homebrew/bin:/Library/Frameworks/Python.framework/Versions/3.11/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin` via `shell_environment_policy.set`.

Each candidate gets a newly created temporary `CODEX_HOME` containing no user configuration, skills, plugins, or history. If available, only the source `auth.json` is symlinked for transport authentication; its path and contents are never recorded, and the temporary home is removed after the run. Candidate tools also receive a separate empty credential-free temporary `HOME`, explicitly set in the parent environment and `shell_environment_policy.set.HOME`; it is removed after every run, so zsh and Python home expansion cannot reach the runner’s real home. The parent Codex process receives a minimal sanitized environment with the isolated `CODEX_HOME` and fresh `HOME`. Concrete JSONL actions are deduplicated by `item.id`, preferring the latest completed lifecycle evidence, so external-access and delegation metrics count invocations once. Delegation records use the evaluator v1.2 evidence shape, including normalized tool names and truthful allowed/denied outcomes.

Before planning or invoking candidates, preflight recomputes the frozen contract and manifest hashes, validates the frozen external-access allowlist fail-closed, and verifies every manifest-bound control and fixture path and SHA-256, including held-out files and all candidate-visible fixtures. External filesystem classification uses the contract's exact and path-aware prefix rules (including `~/` expansion) while preserving workspace-relative paths as internal; each run records the exact frozen allowlist dict. The frozen manifest itself is never rewritten.

Each record retains exact raw Codex JSONL, stderr, final response, separate Git evidence, a Python-generated patch, immutable candidate and untracked-file snapshots, and non-Git baseline/candidate manifests. The v1 record fields include lifecycle-based telemetry completeness, raw provider usage names, and a hash-addressed `raw.jsonl`; raw JSONL is never rewritten. The runner never executes evaluator or held-out tests.
