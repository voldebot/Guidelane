from __future__ import annotations

import json
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[3]
BENCHMARK_ROOT = ROOT / "benchmarks" / "codex-agent-routing"
RESULTS_ROOT = BENCHMARK_ROOT / "runner" / "results" / "primary-v12-20260802"
BATCH_PATH = RESULTS_ROOT / "evaluation-v1" / "batch-score.json"
IDENTITY_MAP_PATH = Path(__file__).with_name("identity-map.json")
OUTPUT_PATH = Path(__file__).with_name("REVIEW_PACKET.md")
SCENARIOS = ("routine_defined", "complex_defined", "complex_underdefined")
SOURCE_PATHS = {
    "routine_defined": "candidate_snapshot/src/retry_after/parser.py",
    "complex_defined": "candidate_snapshot/src/dependency_scheduler/scheduler.py",
    "complex_underdefined": "candidate_snapshot/candidate-output/ambiguity-decision.json",
}


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def fenced(language: str, value: str) -> str:
    return f"```{language}\n{value.rstrip()}\n```"


def alias_by_candidate() -> dict[str, str]:
    identity_map = load_json(IDENTITY_MAP_PATH)
    if set(identity_map) != {f"A{index:02d}" for index in range(1, 10)}:
        raise ValueError("identity map must contain A01 through A09")
    if len(set(identity_map.values())) != 9:
        raise ValueError("identity map candidate values must be unique")
    return {candidate: alias for alias, candidate in identity_map.items()}


def records_by_key(batch: dict[str, Any]) -> dict[tuple[str, str], tuple[dict[str, Any], Path]]:
    records: dict[tuple[str, str], tuple[dict[str, Any], Path]] = {}
    for run in batch["runs"]:
        record_dir = RESULTS_ROOT / "records" / run["run_id"]
        records[(run["scenario_id"], run["candidate_id"])] = (run, record_dir)
    if len(records) != 27:
        raise ValueError(f"expected 27 unique records, found {len(records)}")
    return records


def metric_table(
    scenario_id: str,
    aliases: dict[str, str],
    records: dict[tuple[str, str], tuple[dict[str, Any], Path]],
) -> str:
    header = (
        "| Candidate | Deterministic pass | Gates | Public | Held-out | Scope | "
        "Time (s) | Input | Cached | Output | Reasoning | Diff | Disqualifications |"
    )
    separator = "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|"
    rows = [header, separator]
    for candidate, alias in sorted(aliases.items(), key=lambda item: item[1]):
        run, _ = records[(scenario_id, candidate)]
        metrics = run["metric_vector"]
        disqualifications = ", ".join(run["disqualifications"]) or "none"
        rows.append(
            "| {alias} | {passed} | {gates}/{gate_count} | {public} | {heldout} | {scope} | "
            "{seconds:.3f} | {input_tokens} | {cached_tokens} | {output_tokens} | "
            "{reasoning_tokens} | {diff_size} | {disqualifications} |".format(
                alias=alias,
                passed=str(run["scenario_passed"]).lower(),
                gates=run["applicable_gates_passed"],
                gate_count=run["applicable_gate_count"],
                public=metrics["public_correctness"],
                heldout=metrics["heldout_correctness"],
                scope=metrics["scope_compliance"],
                seconds=metrics["wall_time_ms"] / 1_000,
                input_tokens=metrics["input_tokens"],
                cached_tokens=metrics["cached_input_tokens"],
                output_tokens=metrics["output_tokens"],
                reasoning_tokens=metrics["reasoning_tokens"],
                diff_size=metrics["diff_size"],
                disqualifications=disqualifications,
            )
        )
    return "\n".join(rows)


def candidate_outputs(
    scenario_id: str,
    aliases: dict[str, str],
    records: dict[tuple[str, str], tuple[dict[str, Any], Path]],
) -> str:
    language = "json" if scenario_id == "complex_underdefined" else "python"
    sections: list[str] = []
    for candidate, alias in sorted(aliases.items(), key=lambda item: item[1]):
        run, record_dir = records[(scenario_id, candidate)]
        source = (record_dir / SOURCE_PATHS[scenario_id]).read_text(encoding="utf-8")
        sections.extend(
            [
                f"### {alias}",
                "",
                f"Deterministic verdict: `{'pass' if run['scenario_passed'] else 'fail'}`.",
                "",
                fenced(language, source),
                "",
            ]
        )
    return "\n".join(sections).rstrip()


def external_event_evidence(
    aliases: dict[str, str],
    records: dict[tuple[str, str], tuple[dict[str, Any], Path]],
) -> str:
    evidence: list[str] = []
    for scenario_id in SCENARIOS:
        for candidate, alias in sorted(aliases.items(), key=lambda item: item[1]):
            run, record_dir = records[(scenario_id, candidate)]
            if "external_path_access>0" not in run["disqualifications"]:
                continue
            score = load_json(record_dir / "score.json")
            raw_events = [json.loads(line) for line in (record_dir / "raw.jsonl").read_text(encoding="utf-8").splitlines()]
            commands = [
                event["item"]["command"]
                for event in raw_events
                if event.get("type") == "item.completed"
                and isinstance(event.get("item"), dict)
                and event["item"].get("type") == "command_execution"
                and "/.git/**" in event["item"].get("command", "")
            ]
            evidence.append(
                "- `{alias}` / `{scenario}`: evaluator events `{events}`; completed command `{command}`.".format(
                    alias=alias,
                    scenario=scenario_id,
                    events=json.dumps(score["audit"]["external_access_events"], sort_keys=True),
                    command=commands[0] if commands else "unavailable",
                )
            )
    return "\n".join(evidence) or "- No run was flagged for external path access."


def render() -> str:
    batch = load_json(BATCH_PATH)
    aliases = alias_by_candidate()
    records = records_by_key(batch)
    contract = load_json(BENCHMARK_ROOT / "evaluation" / "gate_contract.json")
    manifest = load_json(BENCHMARK_ROOT / "evaluation" / "scenario_manifests.json")
    lines = [
        "# Blinded Sol Review Packet",
        "",
        "## Review objective",
        "",
        "Audit a one-run-per-cell benchmark of nine anonymous model/reasoning candidates on three isolated coding scenarios. Determine what the evidence supports, identify invalid or weak gates, rank only when justified, and recommend workload routing without guessing model identities.",
        "",
        "Correctness and scope discipline are primary. Efficiency is a secondary tie-breaker. The original deterministic outputs are immutable historical evidence; a reviewer may propose explicitly labeled sensitivity corrections.",
        "",
        "## Method",
        "",
        "- Nine candidates each ran all three scenarios once: 27 primary records.",
        "- Standard service tier, three concurrent candidates, isolated temporary repositories, no delegation, no network, and fixed timeouts.",
        "- An independent test author created public and held-out tests before primary execution.",
        "- An independent gate author froze the evaluator and manifests before primary execution.",
        "- An independent pipeline reviewer approved the final frozen harness before primary execution.",
        "- Every primary process completed; no runner timeout or runner error occurred.",
        "- Single samples do not establish repeatability or statistical significance.",
        f"- Contract SHA-256: `{contract['integrity']['contract_sha256']}`.",
        f"- Manifest SHA-256: `{manifest['integrity']['manifest_sha256']}`.",
        "",
        "## Known gate evidence requiring audit",
        "",
        "### Underdefined hidden criterion",
        "",
        "The held-out test required exactly these unresolved policy categories to be covered: `cache_semantics`, `consistency`, `invalidation`, `capacity`, `availability`, and `security_isolation`. Every candidate safely deferred implementation and preserved source/configuration. Eight candidates asked the same first five categories but omitted `security_isolation`; one candidate also asked `latency`. Judge whether the task text supports treating `security_isolation` as a mandatory unresolved decision.",
        "",
        "### External-access telemetry",
        "",
        "The evaluator tokenized command text and flagged two commands because their ripgrep exclusion glob contained the textual pattern `/.git/**`. Audit whether this proves external filesystem access:",
        "",
        external_event_evidence(aliases, records),
        "",
    ]

    for scenario_id in SCENARIOS:
        task = (BENCHMARK_ROOT / "scenarios" / scenario_id / "task.md").read_text(encoding="utf-8")
        lines.extend(
            [
                f"## Scenario: `{scenario_id}`",
                "",
                "### Candidate task",
                "",
                fenced("markdown", task),
                "",
                "### Deterministic metrics",
                "",
                metric_table(scenario_id, aliases, records),
                "",
                "### Retained candidate output",
                "",
                candidate_outputs(scenario_id, aliases, records),
                "",
            ]
        )

    packet = "\n".join(lines).rstrip() + "\n"
    leaked = [candidate for candidate in aliases if candidate in packet]
    if leaked:
        raise ValueError(f"candidate identities leaked into review packet: {leaked}")
    return packet


def main() -> None:
    if OUTPUT_PATH.exists():
        raise FileExistsError(f"refusing to overwrite {OUTPUT_PATH}")
    OUTPUT_PATH.write_text(render(), encoding="utf-8")


if __name__ == "__main__":
    main()
