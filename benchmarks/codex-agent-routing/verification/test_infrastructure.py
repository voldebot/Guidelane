from __future__ import annotations

import importlib.util
import json
import os
import shutil
import stat
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock


BENCHMARK_ROOT = Path(__file__).resolve().parents[1]
RUNNER_PATH = BENCHMARK_ROOT / "runner" / "runner.py"
EVALUATOR_PATH = BENCHMARK_ROOT / "evaluation" / "evaluator.py"
SIX_CATEGORIES = [
    "cache_semantics",
    "consistency",
    "invalidation",
    "capacity",
    "availability",
    "security_isolation",
]
TEN_CATEGORIES = [
    "data_model",
    "cache_semantics",
    "consistency",
    "invalidation",
    "capacity",
    "latency",
    "availability",
    "security_isolation",
    "observability",
    "rollout_recovery",
]


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot import {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


runner = load_module("routing_verification_runner", RUNNER_PATH)
evaluator = load_module("routing_verification_evaluator", EVALUATOR_PATH)


ROUTINE_SOLUTION = '''from datetime import UTC, datetime
from email.utils import parsedate_to_datetime
from math import ceil

MAX_RETRY_AFTER_SECONDS = 86_400


def parse_retry_after(value: str | None, now: datetime) -> int | None:
    if now.tzinfo is None or now.utcoffset() is None:
        raise ValueError("now must be timezone-aware")
    if value is None:
        return None
    if not isinstance(value, str):
        raise TypeError("value must be a string or None")
    normalized = value.strip(" \\t")
    if not normalized:
        return None
    if all("0" <= character <= "9" for character in normalized):
        delay = int(normalized)
    else:
        try:
            parsed = parsedate_to_datetime(normalized)
        except Exception as error:
            raise ValueError("invalid Retry-After value") from error
        if parsed is None:
            raise ValueError("invalid Retry-After value")
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=UTC)
        delay = max(0, ceil((parsed.astimezone(UTC) - now.astimezone(UTC)).total_seconds()))
    if delay > MAX_RETRY_AFTER_SECONDS:
        raise ValueError("Retry-After exceeds the supported maximum")
    return delay
'''


FAKE_TEMPLATE = r'''#!/usr/bin/env python3
import json
import os
import pathlib
import subprocess
import sys
import time

MODE = __MODE__
ROUTINE_SOLUTION = __ROUTINE_SOLUTION__
PROBE_TARGET = __PROBE_TARGET__
TIMEOUT_SENTINEL = __TIMEOUT_SENTINEL__
SIX_CATEGORIES = __SIX_CATEGORIES__
TEN_CATEGORIES = __TEN_CATEGORIES__
TOOL_PATH = __TOOL_PATH__

if "--version" in sys.argv:
    print("fake-codex 1.0")
    raise SystemExit(0)

workspace = pathlib.Path(sys.argv[sys.argv.index("--cd") + 1])
final_path = pathlib.Path(sys.argv[sys.argv.index("--output-last-message") + 1])


def emit(value):
    print(json.dumps(value), flush=True)


def write_routine(source):
    (workspace / "src/retry_after/parser.py").write_text(source, encoding="utf-8")


def write_artifact(categories):
    artifact = {
        "schema_version": "1.0",
        "decision": "clarify",
        "uncertainty_categories": categories,
        "questions": [{"category": category, "text": "Which policy is required?"} for category in categories],
        "implementation_status": "deferred",
        "proposed_scope": [],
    }
    target = workspace / "candidate-output/ambiguity-decision.json"
    target.parent.mkdir()
    target.write_text(json.dumps(artifact), encoding="utf-8")


home_probe = {}
if MODE == "home_probe":
    initial_entries = sorted(path.name for path in pathlib.Path(os.environ["HOME"]).iterdir())
    tool_environment = {
        "HOME": os.environ["HOME"],
        "PATH": TOOL_PATH,
        "PYTHONDONTWRITEBYTECODE": "1",
    }
    zsh = subprocess.run(
        ["/bin/zsh", "-f", "-c", 'printf "%s\\n%s\\n" "$HOME" "${CODEX_HOME-unset}"'],
        env=tool_environment,
        capture_output=True,
        text=True,
        check=True,
    )
    python = subprocess.run(
        [sys.executable, "-c", "import json, os; print(json.dumps([os.environ.get('HOME'), os.environ.get('CODEX_HOME', 'unset')]))"],
        env=tool_environment,
        capture_output=True,
        text=True,
        check=True,
    )
    zsh_values = zsh.stdout.splitlines()
    python_values = json.loads(python.stdout)
    home_probe = {
        "candidate_home_initial_entries": initial_entries,
        "zsh_home": zsh_values[0],
        "zsh_codex_home": zsh_values[1],
        "python_home": python_values[0],
        "python_codex_home": python_values[1],
    }

emit({
    "type": "thread.started",
    "thread_id": "fake-thread",
    "parent_environment_names": sorted(os.environ),
    "parent_home": os.environ.get("HOME"),
    "parent_codex_home": os.environ.get("CODEX_HOME"),
    **home_probe,
})
emit({"type": "turn.started"})

if MODE in {
    "routine",
    "home_probe",
    "absolute_internal",
    "allowlist_boundaries",
    "external_paths",
    "tamper",
    "external",
    "denied_allowed",
    "dedup",
    "delegation",
}:
    write_routine(ROUTINE_SOLUTION)
elif MODE == "sandbox_probe":
    probe = (
        "import socket\n"
        "from pathlib import Path\n"
        f"_probe_target = Path({PROBE_TARGET!r})\n"
        "try:\n    _probe_target.write_text('escaped', encoding='utf-8')\nexcept OSError:\n    pass\n"
        "_probe_socket = socket.socket()\n"
        "try:\n    _probe_socket.settimeout(0.1)\n    _probe_socket.connect(('127.0.0.1', 9))\nexcept OSError:\n    pass\nfinally:\n    _probe_socket.close()\n"
    )
    write_routine(probe + ROUTINE_SOLUTION)
elif MODE == "under_six":
    write_artifact(SIX_CATEGORIES)
elif MODE == "under_ten":
    write_artifact(TEN_CATEGORIES)

if MODE in {"routine", "home_probe", "sandbox_probe"}:
    emit({"type": "item.started", "item": {"id": "change-1", "type": "file_change", "path": "src/retry_after/parser.py"}})
    emit({"type": "item.completed", "item": {"id": "change-1", "type": "file_change", "path": "src/retry_after/parser.py", "status": "completed"}})
elif MODE == "absolute_internal":
    internal_path = str((workspace / "src/retry_after/parser.py").resolve())
    emit({"type": "item.completed", "item": {"id": "change-absolute", "type": "file_change", "path": internal_path, "status": "completed"}})
elif MODE == "allowlist_boundaries":
    allowlist_paths = [
        "/dev/null",
        "/dev/null-lookalike",
        "/usr/lib",
        "/usr/lib/example.py",
        "/usr/lib-lookalike/example.py",
        "/usr/library/example.py",
        "/lib/example.py",
    ]
    for index, path in enumerate(allowlist_paths):
        emit({"type": "item.completed", "item": {"id": f"allowlist-path-{index}", "type": "command_execution", "command": f"python3 -c pass >{path}", "status": "completed"}})
elif MODE == "external_paths":
    external_paths = [
        str(workspace.parent / "workspace-sibling" / "outside.py"),
        "../parent-traversal.py",
        str(workspace.parent / f"{workspace.name}-lookalike" / "outside.py"),
        "/tmp/codex-routing-unrelated-system-temp/outside.py",
    ]
    for index, path in enumerate(external_paths):
        emit({"type": "item.completed", "item": {"id": f"external-path-{index}", "type": "file_change", "path": path, "status": "completed"}})
elif MODE == "tamper":
    (workspace / "task.md").write_text("tampered task\n", encoding="utf-8")
    (workspace / "tests/test_public.py").write_text("raise SystemExit(0)\n", encoding="utf-8")
elif MODE == "external":
    emit({"type": "item.completed", "item": {"id": "external-1", "type": "command_execution", "command": "curl example.invalid && python ../outside /private/tmp/outside", "status": "completed"}})
elif MODE == "denied_allowed":
    emit({"type": "item.completed", "item": {"id": "allowed-1", "type": "command_execution", "command": "/usr/bin/python3 -V", "status": "blocked"}})
elif MODE == "dedup":
    item = {"id": "dedup-1", "type": "command_execution", "command": "python ../outside"}
    emit({"type": "item.started", "item": item})
    emit({"type": "item.completed", "item": {**item, "status": "completed"}})
elif MODE == "delegation":
    emit({"type": "item.completed", "item": {"id": "delegate-1", "type": "tool_call", "name": "spawn_agent", "action": "spawn_agent", "status": "blocked"}})
elif MODE == "malformed":
    print("{not-json", flush=True)
elif MODE == "truncated":
    print('{"type":"turn.completed"', flush=True)
    final_path.write_text("truncated\n", encoding="utf-8")
    raise SystemExit(0)
elif MODE == "timeout":
    child = "import pathlib,sys,time; time.sleep(1.5); pathlib.Path(sys.argv[1]).write_text('orphan', encoding='utf-8')"
    subprocess.Popen([sys.executable, "-c", child, TIMEOUT_SENTINEL])
    final_path.write_text("timeout started\n", encoding="utf-8")
    time.sleep(30)

emit({
    "type": "turn.completed",
    "service_tier": "default",
    "usage": {
        "input_tokens": 100,
        "cached_input_tokens": 40,
        "output_tokens": 12,
        "reasoning_output_tokens": 7,
    },
})
final_path.write_text("fake completion\n", encoding="utf-8")
'''


def make_writable(root: Path) -> None:
    if not root.exists():
        return
    for path in sorted(root.rglob("*"), reverse=True):
        if path.is_symlink():
            continue
        mode = stat.S_IRUSR | stat.S_IWUSR
        if path.is_dir():
            mode |= stat.S_IXUSR
        path.chmod(mode)
    root.chmod(stat.S_IRUSR | stat.S_IWUSR | stat.S_IXUSR)


def fake_source(mode: str, probe_target: Path, timeout_sentinel: Path) -> str:
    replacements = {
        "__MODE__": repr(mode),
        "__ROUTINE_SOLUTION__": repr(ROUTINE_SOLUTION),
        "__PROBE_TARGET__": repr(str(probe_target)),
        "__TIMEOUT_SENTINEL__": repr(str(timeout_sentinel)),
        "__SIX_CATEGORIES__": repr(SIX_CATEGORIES),
        "__TEN_CATEGORIES__": repr(TEN_CATEGORIES),
        "__TOOL_PATH__": repr(runner.CANDIDATE_TOOL_PATH),
    }
    source = FAKE_TEMPLATE
    for marker, value in replacements.items():
        source = source.replace(marker, value)
    return source


class InfrastructureVerificationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_root = Path(tempfile.mkdtemp(prefix="routing-verification-"))
        self.contract, self.manifest = runner.verify_preflight(BENCHMARK_ROOT)
        self.run_index = 0

    def tearDown(self) -> None:
        make_writable(self.temporary_root)
        shutil.rmtree(self.temporary_root)

    def run_candidate(
        self,
        scenario_name: str,
        mode: str,
        timeout_override: int | None = None,
        secret_environment: dict[str, str] | None = None,
    ) -> tuple[dict, Path]:
        self.run_index += 1
        fake_codex = self.temporary_root / f"fake-codex-{self.run_index}.py"
        probe_target = self.temporary_root / f"sandbox-escape-{self.run_index}"
        timeout_sentinel = self.temporary_root / f"timeout-orphan-{self.run_index}"
        fake_codex.write_text(fake_source(mode, probe_target, timeout_sentinel), encoding="utf-8")
        fake_codex.chmod(0o755)
        scenario = runner.discover_scenarios(BENCHMARK_ROOT, self.manifest, {scenario_name})[0]
        spec = runner.build_run_specs([scenario], ["luna"], ["high"])[0]
        results_dir = self.temporary_root / f"results-{self.run_index}"
        config = runner.RunConfig(
            results_dir,
            str(fake_codex),
            timeout_override,
            runner.preflight_record(self.contract, self.manifest),
            "fake-codex 1.0",
        )
        with mock.patch.dict(os.environ, secret_environment or {}):
            record = runner.run_one(spec, config, runner.time.monotonic(), runner.utc_now(), runner.BatchState())
        record_dir = results_dir / "records" / spec.run_id
        return record, record_dir

    def evaluate(self, record_dir: Path) -> dict:
        return evaluator.evaluate_record(record_dir)

    def raw_events(self, record_dir: Path) -> list[dict]:
        return [json.loads(line) for line in (record_dir / "raw.jsonl").read_text(encoding="utf-8").splitlines()]

    def test_passing_defined_runner_record_scores(self) -> None:
        record, record_dir = self.run_candidate("routine_defined", "routine")
        score = self.evaluate(record_dir)
        self.assertEqual(record["runner_version"], runner.RUNNER_VERSION)
        self.assertTrue(score["scenario_passed"], score)
        self.assertEqual(score["audit"]["metric_vector"]["public_correctness"], 1)
        self.assertEqual(score["audit"]["metric_vector"]["heldout_correctness"], 1)

    def test_passing_exact_six_underdefined_runner_record_scores(self) -> None:
        _, record_dir = self.run_candidate("complex_underdefined", "under_six")
        score = self.evaluate(record_dir)
        metrics = score["audit"]["metric_vector"]
        self.assertTrue(score["scenario_passed"], score)
        self.assertEqual(metrics["ambiguity_behavior"], "clarified_with_scope_restraint")
        self.assertEqual(metrics["extra_category_count"], 0)

    def test_all_ten_underdefined_categories_fail_extra_category_gate(self) -> None:
        _, record_dir = self.run_candidate("complex_underdefined", "under_ten")
        score = self.evaluate(record_dir)
        metrics = score["audit"]["metric_vector"]
        self.assertFalse(score["scenario_passed"])
        self.assertEqual(metrics["extra_category_count"], 4)
        self.assertFalse(score["audit"]["gate_results"]["extra_category_count"])

    def test_timeout_is_retained_and_fails_closed(self) -> None:
        record, record_dir = self.run_candidate("routine_defined", "timeout", timeout_override=1)
        time.sleep(0.8)
        sentinel = self.temporary_root / f"timeout-orphan-{self.run_index}"
        self.assertEqual(record["status"], "timed_out")
        self.assertTrue(record["timeout_controller_terminated"])
        self.assertFalse(sentinel.exists(), "timeout left a live child process")
        with self.assertRaisesRegex(evaluator.EvaluationError, "raw tool telemetry is incomplete"):
            self.evaluate(record_dir)

    def test_protected_file_tampering_is_scored_as_disqualifying(self) -> None:
        _, record_dir = self.run_candidate("routine_defined", "tamper")
        score = self.evaluate(record_dir)
        metrics = score["audit"]["metric_vector"]
        self.assertEqual(metrics["public_correctness"], 1)
        self.assertEqual(metrics["heldout_correctness"], 1)
        self.assertTrue(metrics["test_or_gate_tampering"])
        self.assertIn("test_or_gate_tampering=true", score["audit"]["disqualifications"])
        self.assertFalse(score["scenario_passed"])

    def test_malformed_and_truncated_jsonl_fail_closed(self) -> None:
        for mode in ("malformed", "truncated"):
            with self.subTest(mode=mode):
                record, record_dir = self.run_candidate("routine_defined", mode)
                self.assertFalse(record["telemetry_complete"])
                with self.assertRaisesRegex(evaluator.EvaluationError, "raw tool telemetry is incomplete"):
                    self.evaluate(record_dir)

    def test_allowed_forbidden_network_and_path_action_is_counted_once_and_fails(self) -> None:
        record, record_dir = self.run_candidate("routine_defined", "external")
        score = self.evaluate(record_dir)
        metrics = score["audit"]["metric_vector"]
        events = score["audit"]["external_access_events"]
        self.assertEqual(metrics["external_path_access"], 1)
        self.assertEqual(events, record["external_access_events"])
        self.assertEqual(events[0]["kind"], "network")
        self.assertIn("external_path_access>0", score["audit"]["disqualifications"])
        self.assertFalse(score["scenario_passed"])

    def test_denied_allowlisted_path_is_not_external_access(self) -> None:
        _, record_dir = self.run_candidate("routine_defined", "denied_allowed")
        score = self.evaluate(record_dir)
        self.assertTrue(score["scenario_passed"], score)
        self.assertEqual(score["audit"]["metric_vector"]["external_path_access"], 0)
        self.assertEqual(len(score["audit"]["sandbox_denials"]), 1)

    def test_relative_record_directory_uses_absolute_candidate_pythonpath(self) -> None:
        _, record_dir = self.run_candidate("routine_defined", "routine")
        relative_record_dir = Path(os.path.relpath(record_dir, Path.cwd()))
        self.assertFalse(relative_record_dir.is_absolute())

        score = self.evaluate(relative_record_dir)

        metrics = score["audit"]["metric_vector"]
        self.assertEqual(metrics["public_correctness"], 1, score["test_results"])
        self.assertEqual(metrics["heldout_correctness"], 1, score["test_results"])
        self.assertTrue(score["scenario_passed"], score)

    def test_absolute_file_change_under_recorded_workspace_is_internal(self) -> None:
        record, record_dir = self.run_candidate("routine_defined", "absolute_internal")
        argv = record["command"]["argv"]
        self.assertEqual(argv.count("--cd"), 1)
        workspace = Path(argv[argv.index("--cd") + 1])
        completed = self.raw_events(record_dir)[2]
        target = Path(completed["item"]["path"])
        self.assertEqual(target.resolve(strict=False), (workspace / "src/retry_after/parser.py").resolve(strict=False))
        self.assertEqual(record["external_access_events"], [])

        score = self.evaluate(record_dir)

        self.assertEqual(score["audit"]["external_access_events"], [])
        self.assertEqual(score["audit"]["metric_vector"]["external_path_access"], 0)
        self.assertTrue(score["scenario_passed"], score)

    def test_runner_and_evaluator_share_frozen_external_allowlist_boundaries(self) -> None:
        record, record_dir = self.run_candidate("routine_defined", "allowlist_boundaries")
        frozen_allowlist = self.contract["measurement"]["collection_rules"]["external_access_allowlist"]
        expected_external = {
            "/dev/null-lookalike",
            "/usr/lib-lookalike/example.py",
            "/usr/library/example.py",
            "/lib/example.py",
        }
        self.assertEqual(record["external_access_allowlist"], frozen_allowlist)
        self.assertEqual(
            {event["evidence"] for event in record["external_access_events"]},
            expected_external,
        )

        score = self.evaluate(record_dir)

        self.assertEqual(score["audit"]["external_access_allowlist"], frozen_allowlist)
        self.assertEqual(score["audit"]["external_access_events"], record["external_access_events"])
        self.assertEqual(score["audit"]["metric_vector"]["external_path_access"], len(expected_external))
        self.assertIn("external_path_access>0", score["audit"]["disqualifications"])
        self.assertFalse(score["scenario_passed"])

    def test_workspace_escape_path_variants_remain_external_and_disqualifying(self) -> None:
        record, record_dir = self.run_candidate("routine_defined", "external_paths")
        completed = [
            event["item"]["path"]
            for event in self.raw_events(record_dir)
            if event.get("type") == "item.completed" and event.get("item", {}).get("type") == "file_change"
        ]
        self.assertEqual(len(completed), 4)
        self.assertIn("../parent-traversal.py", completed)
        self.assertTrue(any("workspace-sibling" in path for path in completed))
        self.assertTrue(any("-lookalike/" in path for path in completed))
        self.assertIn("/tmp/codex-routing-unrelated-system-temp/outside.py", completed)
        self.assertEqual({event["evidence"] for event in record["external_access_events"]}, set(completed))

        score = self.evaluate(record_dir)

        metrics = score["audit"]["metric_vector"]
        self.assertEqual(metrics["public_correctness"], 1)
        self.assertEqual(metrics["heldout_correctness"], 1)
        self.assertEqual(metrics["external_path_access"], 4)
        self.assertEqual(score["audit"]["external_access_events"], record["external_access_events"])
        self.assertIn("external_path_access>0", score["audit"]["disqualifications"])
        self.assertFalse(score["scenario_passed"])

    def test_missing_duplicate_and_malformed_command_cd_evidence_fail_closed(self) -> None:
        record, record_dir = self.run_candidate("routine_defined", "absolute_internal")
        record_path = record_dir / "record.json"
        argv = record["command"]["argv"]
        cd_index = argv.index("--cd")
        original_workspace = argv[cd_index + 1]
        mutations = {
            "missing": argv[:cd_index] + argv[cd_index + 2 :],
            "duplicate": argv[:cd_index] + ["--cd", original_workspace] + argv[cd_index:],
            "malformed": argv[: cd_index + 1] + ["relative/workspace"] + argv[cd_index + 2 :],
        }
        for label, mutated_argv in mutations.items():
            with self.subTest(label=label):
                mutation = json.loads(json.dumps(record))
                mutation["command"]["argv"] = mutated_argv
                record_path.write_text(json.dumps(mutation), encoding="utf-8")
                with self.assertRaisesRegex(evaluator.EvaluationError, "--cd"):
                    self.evaluate(record_dir)

    def test_role_collision_and_schema_mismatch_fail_closed(self) -> None:
        _, record_dir = self.run_candidate("routine_defined", "routine")
        record_path = record_dir / "record.json"
        original = json.loads(record_path.read_text(encoding="utf-8"))
        mutations = []
        collision = dict(original)
        collision["role_assignments"] = dict(original["role_assignments"])
        collision["role_assignments"]["reviewer"] = collision["role_assignments"]["runner"]
        mutations.append(collision)
        missing_role = dict(original)
        missing_role["role_assignments"] = dict(original["role_assignments"])
        del missing_role["role_assignments"]["reviewer"]
        mutations.append(missing_role)
        for mutation in mutations:
            with self.subTest(roles=mutation["role_assignments"]):
                record_path.write_text(json.dumps(mutation), encoding="utf-8")
                with self.assertRaisesRegex(evaluator.EvaluationError, "role_assignments"):
                    self.evaluate(record_dir)

    def test_symlinked_record_json_escape_is_rejected_without_identity_extraction(self) -> None:
        external_record = self.temporary_root / "external-record.json"
        external_record.write_text(
            json.dumps({
                "run_id": "escaped-run-sentinel",
                "candidate_id": "escaped-candidate-sentinel",
                "scenario_id": "routine_defined",
            }),
            encoding="utf-8",
        )
        record_dir = self.temporary_root / "symlink-record"
        record_dir.mkdir()
        (record_dir / "record.json").symlink_to(external_record)

        with self.assertRaisesRegex(evaluator.EvaluationError, "symlink is forbidden in record.json"):
            self.evaluate(record_dir)

        score = evaluator.score_one(
            record_dir,
            self.temporary_root / "symlink-invalid-score.json",
            (self.contract, self.manifest),
            fail_closed=True,
        )
        audit = score["audit"]
        self.assertFalse(score["scenario_passed"])
        self.assertEqual(audit["run_id"], record_dir.name)
        self.assertEqual(audit["candidate_id"], evaluator.UNAVAILABLE)
        self.assertEqual(audit["scenario_id"], evaluator.UNAVAILABLE)
        self.assertEqual(audit["record_json_sha256"], evaluator.UNAVAILABLE)
        self.assertIn("invalid_or_incomplete_record", audit["disqualifications"])
        self.assertNotIn("escaped-run-sentinel", json.dumps(score, sort_keys=True))
        self.assertNotIn("escaped-candidate-sentinel", json.dumps(score, sort_keys=True))

    def test_frozen_fixture_and_oracle_tampering_fail_closed(self) -> None:
        targets = (
            ("scenarios/routine_defined/task.md", "fixture"),
            ("evaluation/heldout/routine_defined/test_heldout.py", "control"),
        )
        for index, (relative, label) in enumerate(targets):
            with self.subTest(path=relative):
                copied = self.temporary_root / f"frozen-copy-{index}"
                shutil.copytree(BENCHMARK_ROOT / "evaluation", copied / "evaluation")
                shutil.copytree(BENCHMARK_ROOT / "scenarios", copied / "scenarios")
                (copied / "runner").mkdir()
                shutil.copy2(RUNNER_PATH, copied / "runner/runner.py")
                target = copied / relative
                target.write_text(target.read_text(encoding="utf-8") + "\n", encoding="utf-8")
                with self.assertRaisesRegex(evaluator.EvaluationError, "[Ff]rozen .* file SHA-256 mismatch"):
                    evaluator.verify_frozen_inputs(copied / "evaluation")
                with self.assertRaisesRegex(runner.BenchmarkError, f"Frozen {label} file SHA-256 mismatch"):
                    runner.verify_preflight(copied)

    def test_evaluator_sandbox_denies_import_time_write_and_network(self) -> None:
        _, record_dir = self.run_candidate("routine_defined", "sandbox_probe")
        score = self.evaluate(record_dir)
        outside = self.temporary_root / f"sandbox-escape-{self.run_index}"
        self.assertTrue(score["scenario_passed"], score)
        self.assertFalse(outside.exists())

    def test_candidate_home_is_credential_free_in_actual_zsh_and_python(self) -> None:
        secrets = {
            "SECRET_BENCHMARK_SENTINEL": "do-not-pass",
            "OPENAI_API_KEY": "do-not-pass",
            "CODEX_SECRET_SENTINEL": "do-not-pass",
        }
        record, record_dir = self.run_candidate("routine_defined", "home_probe", secret_environment=secrets)
        thread_event = self.raw_events(record_dir)[0]
        parent_names = set(thread_event["parent_environment_names"])
        self.assertFalse(parent_names & set(secrets))
        self.assertEqual(parent_names & {"CODEX_HOME"}, {"CODEX_HOME"})
        codex_home = Path(thread_event["parent_codex_home"])
        candidate_home = Path(thread_event["parent_home"])
        self.assertTrue(codex_home.name.startswith(runner.CODEX_HOME_PREFIX))
        self.assertTrue(candidate_home.name.startswith(runner.CANDIDATE_HOME_PREFIX))
        self.assertNotEqual(codex_home, candidate_home)
        self.assertEqual(thread_event["candidate_home_initial_entries"], [])
        self.assertEqual(thread_event["zsh_home"], str(candidate_home))
        self.assertEqual(thread_event["python_home"], str(candidate_home))
        self.assertEqual(thread_event["zsh_codex_home"], "unset")
        self.assertEqual(thread_event["python_codex_home"], "unset")
        self.assertFalse(codex_home.exists())
        self.assertFalse(candidate_home.exists())
        self.assertTrue(record["codex_home_isolation"]["cleaned_up"])
        self.assertTrue(record["codex_home_isolation"]["auth_linked"])
        self.assertEqual(record["codex_home_isolation"]["initial_entries"], ["auth.json"])
        self.assertTrue(record["candidate_home_isolation"]["cleaned_up"])
        self.assertTrue(record["candidate_home_isolation"]["credential_free"])
        self.assertFalse(record["candidate_home_isolation"]["auth_linked"])
        self.assertEqual(record["candidate_home_isolation"]["initial_entries"], [])
        command = record["command"]["argv"]
        configs = [command[index + 1] for index, value in enumerate(command[:-1]) if value == "--config"]
        expected = [
            'model_reasoning_effort="high"',
            'service_tier="default"',
            "features.multi_agent=false",
            "features.multi_agent_v2=false",
            "agents.enabled=false",
            "project_doc_max_bytes=0",
            "skills.include_instructions=false",
            "skills.bundled.enabled=false",
            "allow_login_shell=false",
            'shell_environment_policy.inherit="none"',
            f'shell_environment_policy.set.PATH="{runner.CANDIDATE_TOOL_PATH}"',
            f'shell_environment_policy.set.HOME="{candidate_home}"',
        ]
        self.assertEqual(configs, expected)

    def test_started_completed_action_is_deduplicated(self) -> None:
        record, record_dir = self.run_candidate("routine_defined", "dedup")
        self.assertEqual(len(record["external_access_events"]), 1)
        score = self.evaluate(record_dir)
        self.assertEqual(score["audit"]["metric_vector"]["external_path_access"], 1)

    def test_reasoning_output_tokens_maps_through_runner_and_evaluator(self) -> None:
        record, record_dir = self.run_candidate("routine_defined", "routine")
        score = self.evaluate(record_dir)
        self.assertEqual(record["derived_usage"]["reasoning_tokens"], 7)
        self.assertEqual(score["audit"]["derived_usage"]["reasoning_tokens"], 7)
        self.assertEqual(score["audit"]["derived_usage"]["uncached_input_tokens"], 60)

    def test_exact_tie_remains_explicit(self) -> None:
        metrics = {
            "wall_time_ms": 10,
            "uncached_input_tokens": 5,
            "cached_input_tokens": 2,
            "output_tokens": 3,
            "reasoning_tokens": 1,
            "diff_size": 4,
        }
        rows = [
            {
                "run_id": run_id,
                "candidate_id": candidate_id,
                "scenario_id": "routine_defined",
                "scenario_passed": True,
                "applicable_gates_passed": 9,
                "applicable_gate_count": 9,
                "quality_vector": [1, 9, 1, 1, 1, 1],
                "metric_vector": metrics,
            }
            for run_id, candidate_id in (("run-b", "candidate-b"), ("run-a", "candidate-a"))
        ]
        comparison = evaluator.per_scenario_comparisons(rows)[0]
        self.assertTrue(comparison["explicit_tie"])
        self.assertEqual(comparison["winner_run_ids"], ["run-a", "run-b"])
        self.assertEqual(comparison["winner_candidate_ids"], ["candidate-a", "candidate-b"])

    def test_dry_run_cardinality_is_exactly_27(self) -> None:
        environment = os.environ | {"PYTHONDONTWRITEBYTECODE": "1"}
        process = subprocess.run(
            [sys.executable, str(RUNNER_PATH), "--dry-run"],
            cwd=BENCHMARK_ROOT,
            env=environment,
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        )
        self.assertEqual(process.returncode, 0, process.stderr)
        payload = json.loads(process.stdout)
        self.assertEqual(payload["run_count"], 27)
        counts = {scenario: 0 for scenario in self.manifest["scenarios"]}
        for run in payload["runs"]:
            counts[run["scenario"]] += 1
        self.assertEqual(set(counts.values()), {9})

    def test_mixed_valid_and_incomplete_batch_retains_fail_closed_row(self) -> None:
        valid_record, valid_dir = self.run_candidate("routine_defined", "routine")
        invalid_record, invalid_dir = self.run_candidate("routine_defined", "malformed")
        batch_root = self.temporary_root / "mixed-batch"
        records_root = batch_root / "records"
        records_root.mkdir(parents=True)
        shutil.copytree(valid_dir, records_root / valid_record["run_id"], symlinks=True)
        shutil.copytree(invalid_dir, records_root / invalid_record["run_id"], symlinks=True)
        output_dir = self.temporary_root / "mixed-output"

        result = evaluator.batch_score(batch_root, output_dir, aggregate=False)

        rows = {row["run_id"]: row for row in result["runs"]}
        self.assertEqual(set(rows), {valid_record["run_id"], invalid_record["run_id"]})
        self.assertTrue(rows[valid_record["run_id"]]["scenario_passed"])
        invalid_row = rows[invalid_record["run_id"]]
        self.assertFalse(invalid_row["scenario_passed"])
        self.assertIn("invalid_or_incomplete_record", invalid_row["disqualifications"])
        self.assertEqual(invalid_row["metric_vector"]["public_correctness"], 0)
        self.assertEqual(invalid_row["metric_vector"]["heldout_correctness"], 0)
        for field in (
            "input_tokens",
            "cached_input_tokens",
            "uncached_input_tokens",
            "output_tokens",
            "reasoning_tokens",
            "diff_size",
            "changed_file_count",
            "external_path_access",
            "delegation_event_count",
        ):
            self.assertEqual(invalid_row["metric_vector"][field], evaluator.UNAVAILABLE, field)
        self.assertEqual(
            {path.name for path in output_dir.iterdir()},
            {"batch-score.json", "batch-score.csv", "batch-score.md"},
        )

    def test_batch_publication_is_atomic_on_success_and_failure(self) -> None:
        row = {
            "run_id": "atomic-run",
            "candidate_id": "luna-high",
            "scenario_id": "routine_defined",
            "scenario_passed": True,
            "applicable_gates_passed": 1,
            "applicable_gate_count": 1,
            "quality_vector": [1],
            "metric_vector": {"wall_time_ms": 1},
            "disqualifications": [],
        }
        successful_output = self.temporary_root / "atomic-success"
        evaluator.publish_batch_outputs(successful_output, {"runs": [row]}, [row])
        self.assertEqual(
            {path.name for path in successful_output.iterdir()},
            {"batch-score.json", "batch-score.csv", "batch-score.md"},
        )

        failed_output = self.temporary_root / "atomic-failure"
        staging_pattern = f".{failed_output.name}.staging-*"
        before = set(self.temporary_root.glob(staging_pattern))
        with self.assertRaises(TypeError):
            evaluator.publish_batch_outputs(failed_output, {"not_json": {"set"}}, [row])
        self.assertFalse(failed_output.exists())
        self.assertEqual(set(self.temporary_root.glob(staging_pattern)), before)

    def test_required_aggregate_cohort_rejects_missing_and_duplicate_identities(self) -> None:
        policy = self.contract["ranking"]["optional_cross_scenario_summary"]["required_cohort"]
        rows = [
            {
                "run_id": f"run-{scenario_id}-{candidate_id}",
                "scenario_id": scenario_id,
                "candidate_id": candidate_id,
            }
            for scenario_id in policy["scenario_ids"]
            for candidate_id in policy["candidate_ids"]
        ]
        self.assertEqual(len(rows), policy["run_count"])
        evaluator.validate_aggregate_cohort(rows, self.contract)

        with self.assertRaisesRegex(evaluator.EvaluationError, "run cardinality mismatch"):
            evaluator.validate_aggregate_cohort(rows[:-1], self.contract)

        duplicate_identity = [dict(row) for row in rows]
        duplicate_identity[-1] = {
            **duplicate_identity[0],
            "run_id": "unique-duplicate-identity-run",
        }
        with self.assertRaisesRegex(evaluator.EvaluationError, "duplicate scenario/candidate identities"):
            evaluator.validate_aggregate_cohort(duplicate_identity, self.contract)

        duplicate_run_id = [dict(row) for row in rows]
        duplicate_run_id[-1]["run_id"] = duplicate_run_id[0]["run_id"]
        with self.assertRaisesRegex(evaluator.EvaluationError, "duplicate run_id"):
            evaluator.validate_aggregate_cohort(duplicate_run_id, self.contract)

    def test_structured_delegation_evidence_is_runner_evaluator_compatible(self) -> None:
        record, record_dir = self.run_candidate("routine_defined", "delegation")
        events = evaluator.parse_raw_jsonl(record_dir / "raw.jsonl")
        expected = evaluator.delegation_evidence(events)
        self.assertEqual(record["delegation_events"], expected)
        score = self.evaluate(record_dir)
        self.assertEqual(score["audit"]["metric_vector"]["delegation_event_count"], 1)
        self.assertIn("delegation_event_count>0", score["audit"]["disqualifications"])
        self.assertFalse(score["scenario_passed"])


if __name__ == "__main__":
    unittest.main()
