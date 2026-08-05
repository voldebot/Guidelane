# Codex Agent Routing Benchmark

## Goal

Measure the correctness, efficiency, and escalation behavior of GPT-5.6 Luna and Terra reasoning levels on identical isolated coding tasks.

## Tasks

- [x] Define routine-defined, complex-defined, and complex-underdefined task contracts. Verify: each contract has fixed scope and independent acceptance criteria.
- [x] Build seed repositories and a matrix runner. Verify: every run starts from the same Git commit in an isolated directory.
- [x] Create an immutable quality-gate contract with a separate agent assignment. Verify: the contract is frozen before candidate runs.
- [x] Create public and held-out tests with a separate test-author assignment. Verify: candidate workspaces cannot inspect held-out tests.
- [x] Calibrate one frozen Luna run before primary execution. Verify: code, final response, timing, token usage, diff, and tool trace are captured.
- [x] Run Luna High/XHigh/Max across all scenarios. Verify: nine complete records exist.
- [x] Run Terra Low/Medium/High/XHigh/Max/Ultra across all scenarios. Verify: eighteen complete records exist.
- [x] Score all runs and perform an independent benchmark review. Verify: every recommendation distinguishes measured evidence from extrapolation.

## Done When

- [x] All 27 runs are reproducible and scored by the same deterministic harness.
- [x] No candidate writes its own tests, gate contract, or review verdict.
- [x] The final routing recommendation includes correctness, latency, token use, scope discipline, and ambiguity handling.

## Notes

- Use Standard service tier and strict external timeouts.
- Disable recursive delegation during single-model capability runs.
- Keep candidate workspaces isolated and preserve raw JSONL traces for audit.
- Final report: `benchmarks/codex-agent-routing/RESULTS.md`.
