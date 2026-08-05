from __future__ import annotations

import importlib.util
import json
import os
import shutil
import stat
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


RUNNER_PATH = Path(__file__).with_name("runner.py")
SPEC = importlib.util.spec_from_file_location("benchmark_runner", RUNNER_PATH)
assert SPEC and SPEC.loader
runner = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = runner
SPEC.loader.exec_module(runner)


def make_writable(path: Path) -> None:
    for child in sorted(path.rglob("*"), reverse=True):
        if not child.is_symlink():
            child.chmod(stat.S_IWUSR | stat.S_IRUSR | (stat.S_IXUSR if child.is_dir() else 0))
    path.chmod(stat.S_IWUSR | stat.S_IRUSR | stat.S_IXUSR)


class RunnerIntegrationTests(unittest.TestCase):
    def test_codex_command_contains_exact_hardening_overrides(self) -> None:
        benchmark_root = RUNNER_PATH.parent.parent
        _contract, manifest = runner.verify_preflight(benchmark_root)
        scenario = runner.discover_scenarios(benchmark_root, manifest, {"routine_defined"})[0]
        spec = runner.build_run_specs([scenario], ["luna"], ["high"])[0]
        command = runner.build_codex_command(spec, Path("/candidate"), Path("/final"), "prompt", "codex")

        for value in (
            "--ignore-user-config", "--ignore-rules", "--strict-config", "--ephemeral",
            "--config", "features.multi_agent=false", "features.multi_agent_v2=false", "agents.enabled=false",
            "project_doc_max_bytes=0", "skills.include_instructions=false", "skills.bundled.enabled=false",
            "allow_login_shell=false", 'shell_environment_policy.inherit="none"', 'service_tier="default"',
        ):
            self.assertIn(value, command)

    def test_codex_command_sets_exact_candidate_tool_path(self) -> None:
        benchmark_root = RUNNER_PATH.parent.parent
        _contract, manifest = runner.verify_preflight(benchmark_root)
        scenario = runner.discover_scenarios(benchmark_root, manifest, {"routine_defined"})[0]
        spec = runner.build_run_specs([scenario], ["luna"], ["high"])[0]
        command = runner.build_codex_command(spec, Path("/candidate"), Path("/final"), "prompt", "codex")

        config_values = [command[index + 1] for index, value in enumerate(command[:-1]) if value == "--config"]
        self.assertEqual(
            [value for value in config_values if value.startswith("shell_environment_policy.")],
            [
                'shell_environment_policy.inherit="none"',
                'shell_environment_policy.set.PATH="/opt/homebrew/bin:/Library/Frameworks/Python.framework/Versions/3.11/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"',
            ],
        )

    def test_candidate_tool_home_is_explicit_and_resolves_in_python_and_zsh(self) -> None:
        codex_home, _codex_evidence = runner.create_isolated_codex_home()
        candidate_home, _candidate_evidence = runner.create_candidate_home()
        try:
            environment = runner.sanitized_environment(codex_home, candidate_home)
            self.assertEqual(Path(environment["HOME"]), candidate_home)
            self.assertNotEqual(Path(environment["HOME"]), Path(environment["CODEX_HOME"]))
            python_probe = subprocess.run(
                [sys.executable, "-c", "import os; from pathlib import Path; print(Path.home()); print(os.path.expanduser('~'))"],
                env=environment, capture_output=True, text=True, check=True,
            )
            self.assertEqual(python_probe.stdout.splitlines(), [str(candidate_home), str(candidate_home)])
            if shutil.which("zsh"):
                zsh_probe = subprocess.run(
                    ["zsh", "-fc", "print -r -- $HOME; print -r -- ~"],
                    env=environment, capture_output=True, text=True, check=True,
                )
                self.assertEqual(zsh_probe.stdout.splitlines(), [str(candidate_home), str(candidate_home)])
        finally:
            runner.remove_isolated_codex_home(codex_home)
            runner.remove_candidate_home(candidate_home)
        self.assertFalse(codex_home.exists())
        self.assertFalse(candidate_home.exists())

    def test_sanitized_environment_removes_secret_sentinels_and_proxy_values(self) -> None:
        sentinel_environment = {
            "OPENAI_API_KEY": "SECRET_SENTINEL",
            "CODEX_TOKEN": "SECRET_SENTINEL",
            "CHATGPT_PASSWORD": "SECRET_SENTINEL",
            "OAI_SECRET": "SECRET_SENTINEL",
            "HTTPS_PROXY": "http://SECRET_SENTINEL.invalid",
            "CUSTOM_API_TOKEN": "SECRET_SENTINEL",
        }
        with patch.dict(os.environ, sentinel_environment, clear=False):
            environment = runner.sanitized_environment(Path("/tmp/isolated-codex-home"))

        self.assertEqual(environment["CODEX_HOME"], "/tmp/isolated-codex-home")
        self.assertNotIn("SECRET_SENTINEL", environment.values())
        self.assertFalse(any("PROXY" in key.upper() for key in environment))
        self.assertFalse(any(key.startswith(("OPENAI_", "CODEX_", "CHATGPT_", "OAI_")) for key in environment if key != "CODEX_HOME"))

    def test_isolated_codex_home_links_auth_without_reading_and_cleans_up(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            source_root = Path(temporary_directory) / "source"
            auth_path = source_root / ".codex" / "auth.json"
            auth_path.parent.mkdir(parents=True)
            auth_path.write_text("AUTH_CONTENT_SENTINEL", encoding="utf-8")

            with patch.object(runner.Path, "home", return_value=source_root):
                codex_home, evidence = runner.create_isolated_codex_home()
                try:
                    self.assertEqual(os.readlink(codex_home / "auth.json"), str(auth_path))
                    self.assertEqual(evidence["initial_entries"], ["auth.json"])
                    self.assertNotIn("AUTH_CONTENT_SENTINEL", json.dumps(evidence))
                    self.assertFalse((codex_home / "AGENTS.md").exists())
                    self.assertFalse((codex_home / "skills").exists())
                    self.assertFalse((codex_home / "config.toml").exists())
                    self.assertFalse((codex_home / "history.jsonl").exists())
                finally:
                    runner.remove_isolated_codex_home(codex_home)

            self.assertFalse(codex_home.exists())

    def test_started_and_completed_actions_are_deduplicated_by_item_id(self) -> None:
        contract, _manifest = runner.verify_preflight(RUNNER_PATH.parent.parent)
        allowlist = contract["measurement"]["collection_rules"]["external_access_allowlist"]
        events = [
            {"type": "item.started", "item": {"id": "command-1", "type": "command_execution", "command": "curl https://example.invalid"}},
            {"type": "item.completed", "item": {"id": "command-1", "type": "command_execution", "command": "curl https://example.invalid"}},
            {"type": "item.started", "item": {"id": "delegation-1", "type": "subagent_call", "action": "delegate"}},
            {"type": "item.completed", "item": {"id": "delegation-1", "type": "subagent_call", "action": "delegate"}},
        ]

        actions = runner.command_actions(events)
        self.assertEqual(actions, [(1, "command_execution", "curl https://example.invalid")])
        self.assertEqual(len(runner.external_access_events(actions, Path.cwd(), external_access_allowlist=allowlist)), 1)
        self.assertEqual(len(runner.delegation_events(events)), 1)
        self.assertEqual(runner.delegation_events(events)[0]["event_type"], "item.completed")

    def test_delegation_evidence_matches_v12_schema_and_latest_completed_item(self) -> None:
        events = [
            {"type": "item.started", "item": {"id": "delegate-1", "type": "tool_call", "name": "Spawn_Agent", "action": "spawn_agent"}},
            {"type": "item.completed", "item": {"id": "delegate-1", "type": "tool_call", "name": "Spawn_Agent", "action": "spawn_agent", "status": "blocked"}},
        ]
        self.assertEqual(
            runner.delegation_events(events),
            [{
                "event_index": 1,
                "event_type": "item.completed",
                "item_type": "tool_call",
                "action": "spawn_agent",
                "tool_name": "spawn_agent",
                "outcome": "denied",
            }],
        )

    def test_preflight_retains_the_exact_frozen_external_access_allowlist(self) -> None:
        benchmark_root = RUNNER_PATH.parent.parent
        contract, manifest = runner.verify_preflight(benchmark_root)
        expected = contract["measurement"]["collection_rules"]["external_access_allowlist"]

        preflight = runner.preflight_record(contract, manifest)

        self.assertEqual(preflight["external_access_allowlist"], expected)

    def test_external_access_uses_frozen_exact_and_prefix_boundaries(self) -> None:
        benchmark_root = RUNNER_PATH.parent.parent
        contract, _manifest = runner.verify_preflight(benchmark_root)
        allowlist = contract["measurement"]["collection_rules"]["external_access_allowlist"]
        paths = [
            "/dev/null",
            "/dev/null-lookalike",
            "/usr/lib",
            "/usr/lib/example.py",
            "/usr/lib-lookalike/example.py",
            "/usr/library/example.py",
            "/lib/example.py",
        ]
        actions = [
            (index, "command_execution", f"python3 -c pass >{path}")
            for index, path in enumerate(paths)
        ]

        events = runner.external_access_events(
            actions,
            Path("/tmp/codex-routing-allowlist-test-workspace"),
            external_access_allowlist=allowlist,
        )

        self.assertEqual(
            {event["evidence"] for event in events},
            {
                "/dev/null-lookalike",
                "/usr/lib-lookalike/example.py",
                "/usr/library/example.py",
                "/lib/example.py",
            },
        )

    def test_preflight_rechecks_bound_heldout_and_fixture_hashes_without_manifest_change(self) -> None:
        benchmark_root = RUNNER_PATH.parent.parent
        original_manifest_hash = runner.load_json(benchmark_root / "evaluation/scenario_manifests.json")["integrity"]["manifest_sha256"]
        for relative in ("evaluation/heldout/routine_defined/test_heldout.py", "scenarios/routine_defined/task.md"):
            with self.subTest(path=relative), tempfile.TemporaryDirectory() as temporary_directory:
                copied_root = Path(temporary_directory)
                shutil.copytree(benchmark_root / "evaluation", copied_root / "evaluation")
                shutil.copytree(benchmark_root / "scenarios", copied_root / "scenarios")
                (copied_root / "runner").mkdir()
                shutil.copy2(benchmark_root / "runner/runner.py", copied_root / "runner/runner.py")
                target = copied_root / relative
                target.write_text(target.read_text(encoding="utf-8") + "\ntampered\n", encoding="utf-8")
                with self.assertRaisesRegex(runner.BenchmarkError, "[Ff]rozen (control|fixture) file SHA-256 mismatch"):
                    runner.verify_preflight(copied_root)

        _contract, manifest = runner.verify_preflight(benchmark_root)
        self.assertEqual(manifest["integrity"]["manifest_sha256"], original_manifest_hash)

    def test_fake_codex_retains_auditable_candidate_artifacts(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            temporary_root = Path(temporary_directory)
            fake_codex = temporary_root / "fake_codex.py"
            fake_codex.write_text(
                "#!/usr/bin/env python3\n"
                "import json, pathlib, sys\n"
                "workspace = pathlib.Path(sys.argv[sys.argv.index('--cd') + 1])\n"
                "final = pathlib.Path(sys.argv[sys.argv.index('--output-last-message') + 1])\n"
                "(workspace / 'src/retry_after/parser.py').write_text('# candidate change\\n')\n"
                "(workspace / 'task.md').write_text('tampered task\\n')\n"
                "(workspace / 'candidate-untracked.txt').write_text('retain me\\n')\n"
                "final.write_text('fake final response\\n')\n"
                "print(json.dumps({'type': 'thread.started'}))\n"
                "print(json.dumps({'type': 'turn.started'}))\n"
                "print(json.dumps({'type': 'item.completed', 'item': {'type': 'command_execution', 'command': 'python3 -m unittest'}}))\n"
                "print(json.dumps({'type': 'turn.completed', 'usage': {'input_tokens': 10, 'cached_input_tokens': 4, 'output_tokens': 3, 'reasoning_output_tokens': 2}}))\n",
                encoding="utf-8",
            )
            fake_codex.chmod(0o755)
            benchmark_root = RUNNER_PATH.parent.parent
            contract, manifest = runner.verify_preflight(benchmark_root)
            scenario = runner.discover_scenarios(benchmark_root, manifest, {"routine_defined"})[0]
            spec = runner.build_run_specs([scenario], ["luna"], ["high"])[0]
            results_dir = temporary_root / "results"
            config = runner.RunConfig(
                results_dir=results_dir,
                codex_bin=str(fake_codex),
                timeout_override=None,
                preflight=runner.preflight_record(contract, manifest),
                codex_version="fake",
            )
            record = runner.run_one(spec, config, runner.time.monotonic(), runner.utc_now(), runner.BatchState())
            record_dir = results_dir / "records" / spec.run_id

            self.assertEqual(record["status"], "completed", record.get("error"))
            self.assertEqual(
                record["role_assignments"],
                {
                    "writer": "candidate-model-under-test",
                    "test_author": "independent-test-author",
                    "gate_author": "independent-gate-author",
                    "runner": "independent-runner",
                    "reviewer": "independent-pipeline-reviewer",
                },
            )
            self.assertEqual(record["command"]["timeout_seconds"], 240)
            self.assertEqual(record["derived_usage"]["reasoning_tokens"], 2)
            self.assertEqual(record["derived_usage"]["uncached_input_tokens"], 6)
            self.assertEqual(record["record_version"], "codex-agent-routing-run-record/v1")
            self.assertEqual(record["scenario_manifest_sha256"], config.preflight["manifest_sha256"])
            self.assertIsInstance(record["candidate_wall_time_ms"], int)
            self.assertFalse(record["timeout_controller_terminated"])
            self.assertTrue(record["baseline_precedes_candidate_changes"])
            self.assertEqual(record["candidate_snapshot"]["path"], "candidate_snapshot")
            self.assertEqual(record["candidate_snapshot"]["manifest"], record["final_manifest"])
            self.assertEqual(record["candidate_snapshot"]["manifest"], runner.filesystem_manifest(record_dir / "candidate_snapshot"))
            self.assertEqual(record["baseline_snapshot_manifest"], record["baseline_manifest"])
            self.assertTrue(record["raw_tool_telemetry"]["complete"])
            self.assertTrue(record["candidate_home_isolation"]["credential_free"])
            self.assertTrue(record["candidate_home_isolation"]["cleaned_up"])
            self.assertTrue(any(
                value.startswith("shell_environment_policy.set.HOME=")
                for value in record["command"]["argv"]
            ))
            self.assertEqual(record["raw_tool_telemetry"]["path"], "raw.jsonl")
            self.assertEqual(record["raw_tool_telemetry"]["format"], "jsonl")
            self.assertEqual(record["raw_tool_telemetry"]["sha256"], runner.sha256_file(record_dir / "raw.jsonl"))
            self.assertTrue(record["telemetry"]["candidate_interval_complete"])
            self.assertTrue(record["telemetry_completeness"]["complete"])
            self.assertEqual(record["telemetry_completeness"]["raw_event_count"], 4)
            self.assertTrue(record["telemetry_completeness"]["parse"]["object_jsonl"])
            self.assertEqual(record["raw_provider_usage"]["reasoning_output_tokens"], 2)
            self.assertNotIn("reasoning_tokens", record["raw_provider_usage"])
            for change in record["changed_paths"]:
                self.assertEqual(set(change), {"path", "operation", "baseline_type", "candidate_type"})
                self.assertFalse(change["path"].startswith(".git/"))
            self.assertTrue(record["metric_vector"]["test_or_gate_tampering"])
            self.assertGreater(record["metric_vector"]["forbidden_file_edits"], 0)
            self.assertTrue((record_dir / "candidate_snapshot/candidate-untracked.txt").is_file())
            self.assertTrue((record_dir / "untracked_files/candidate-untracked.txt").is_file())
            self.assertFalse((record_dir / "candidate_snapshot/.git").exists())
            self.assertTrue((record_dir / "raw.jsonl").is_file())
            self.assertTrue(json.loads((record_dir / "record.json").read_text())["telemetry_completeness"]["complete"])

            for immutable_directory in (record_dir / "candidate_snapshot", record_dir / "untracked_files"):
                if immutable_directory.exists():
                    make_writable(immutable_directory)
            shutil.rmtree(results_dir)

    def test_prose_does_not_create_delegation_or_external_access_evidence(self) -> None:
        contract, _manifest = runner.verify_preflight(RUNNER_PATH.parent.parent)
        allowlist = contract["measurement"]["collection_rules"]["external_access_allowlist"]
        events = [
            {"type": "thread.started"},
            {"type": "turn.started"},
            {"type": "item.completed", "item": {"type": "agent_message", "text": "Do not delegate; the orchestrator is disabled. curl https://example.invalid"}},
            {"type": "turn.completed"},
        ]

        self.assertEqual(runner.delegation_events(events), [])
        self.assertEqual(runner.command_actions(events), [])
        self.assertEqual(
            runner.external_access_events(
                runner.command_actions(events),
                Path.cwd(),
                external_access_allowlist=allowlist,
            ),
            [],
        )

        delegated = events[:2] + [{"type": "item.completed", "item": {"type": "subagent_call", "action": "delegate"}}, events[-1]]
        self.assertEqual(len(runner.delegation_events(delegated)), 1)

    def test_fake_codex_timeout_is_recorded(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            temporary_root = Path(temporary_directory)
            fake_codex = temporary_root / "slow_fake_codex.py"
            fake_codex.write_text("#!/usr/bin/env python3\nimport time\ntime.sleep(2)\n", encoding="utf-8")
            fake_codex.chmod(0o755)
            benchmark_root = RUNNER_PATH.parent.parent
            contract, manifest = runner.verify_preflight(benchmark_root)
            scenario = runner.discover_scenarios(benchmark_root, manifest, {"routine_defined"})[0]
            spec = runner.build_run_specs([scenario], ["luna"], ["high"])[0]
            results_dir = temporary_root / "results"
            config = runner.RunConfig(results_dir, str(fake_codex), 1, runner.preflight_record(contract, manifest), "fake")
            record = runner.run_one(spec, config, runner.time.monotonic(), runner.utc_now(), runner.BatchState())

            self.assertEqual(record["status"], "timed_out")
            self.assertTrue(record["process"]["timed_out"])
            self.assertEqual(record["command"]["timeout_seconds"], 1)
            snapshot = results_dir / "records" / spec.run_id / "candidate_snapshot"
            make_writable(snapshot)
            shutil.rmtree(results_dir)


if __name__ == "__main__":
    unittest.main()
