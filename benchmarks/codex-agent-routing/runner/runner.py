#!/usr/bin/env python3
"""Run isolated Codex benchmark candidates without executing evaluation tests."""

from __future__ import annotations

import argparse
import concurrent.futures
import difflib
import hashlib
import json
import os
import platform
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path, PurePosixPath
from typing import Any, Iterable


RUNNER_VERSION = "1.3.1"
RECORD_VERSION = "codex-agent-routing-run-record/v1"
UNAVAILABLE = "unavailable"
CANDIDATE_TOOL_PATH = "/opt/homebrew/bin:/Library/Frameworks/Python.framework/Versions/3.11/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
MODEL_EFFORTS = {
    "luna": ("gpt-5.6-luna", ("high", "xhigh", "max")),
    "terra": ("gpt-5.6-terra", ("low", "medium", "high", "xhigh", "max", "ultra")),
}
COMMAND_KEYS = {"command", "cmd", "command_line", "shell_command", "argv"}
PATH_TOKEN = re.compile(r"(?<![\w.-])(?:~/(?:[^\s'\"`|;&()<>]+)|/(?:[^\s'\"`|;&()<>]+)|\.\.?/(?:[^\s'\"`|;&()<>]+))")
URL_TOKEN = re.compile(r"\b(?:https?|wss?)://[^\s'\"`|;&()<>]+", re.IGNORECASE)
NETWORK_COMMAND = re.compile(r"\b(?:curl|wget|ssh|scp|sftp|nc|ncat|telnet|ftp|git\s+(?:clone|fetch|pull|ls-remote))\b", re.IGNORECASE)
CACHE_DIRECTORIES = {".git", "__pycache__", ".pytest_cache", ".mypy_cache", ".ruff_cache", ".cache"}
ITEM_EVENTS = {"item.started", "item.completed"}
DELEGATION_ITEM_TYPES = {"subagent_call", "subagent_message", "agent_spawn", "multi_agent_orchestration", "delegated_model_call"}
DELEGATION_ACTIONS = {"delegate", "delegate_model", "followup_task", "send_message", "spawn_agent", "spawn_subagent"}
DELEGATION_NAMES = DELEGATION_ACTIONS
SANDBOX_DENIAL_CODES = {"blocked", "forbidden", "permission_denied", "sandbox_denial", "sandbox_denied"}
CONCRETE_ACTION_ITEM_TYPES = {"command_execution", "file_change", "tool_call", "mcp_tool_call", *DELEGATION_ITEM_TYPES}


class BenchmarkError(RuntimeError):
    """Raised for invalid benchmark runner inputs."""


@dataclass(frozen=True)
class Scenario:
    name: str
    root: Path
    task_path: Path
    visible_exact: tuple[str, ...]
    visible_trees: tuple[str, ...]
    allowed_write_paths: tuple[str, ...]
    allowed_write_operations: dict[str, tuple[str, ...]]
    forbidden_write_paths: tuple[str, ...]
    timeout_seconds: int
    public_suite: dict[str, Any]
    parent_creation: dict[str, Any] | None


@dataclass(frozen=True)
class RunSpec:
    scenario: Scenario
    model_family: str
    model: str
    effort: str
    run_id: str
    submission_order: int


@dataclass(frozen=True)
class RunConfig:
    results_dir: Path
    codex_bin: str
    timeout_override: int | None
    preflight: dict[str, Any]
    codex_version: str
    external_access_allowlist: dict[str, Any] | None = None


@dataclass
class BatchState:
    next_start_order: int = 0
    lock: threading.Lock = field(default_factory=threading.Lock)


def utc_now() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_text(value: str) -> str:
    return sha256_bytes(value.encode("utf-8"))


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def canonical_json(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def load_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise BenchmarkError(f"Invalid JSON at {path}: {error}") from error
    if not isinstance(value, dict):
        raise BenchmarkError(f"Expected a JSON object at {path}")
    return value


def canonical_hash(value: dict[str, Any], pointer: tuple[str, str]) -> str:
    copied = json.loads(json.dumps(value))
    try:
        integrity = copied[pointer[0]]
        if not isinstance(integrity, dict):
            raise KeyError(pointer[0])
        del integrity[pointer[1]]
    except KeyError as error:
        raise BenchmarkError(f"Missing integrity field /{'/'.join(pointer)}") from error
    return sha256_bytes(canonical_json(copied))


def copy_json(value: Any) -> Any:
    return json.loads(json.dumps(value, ensure_ascii=False))


def validate_external_access_rule(rule: Any, kind: str) -> None:
    if not isinstance(rule, str) or not rule or "\\" in rule or "//" in rule or any(character in rule for character in "*?[]"):
        raise BenchmarkError(f"Invalid frozen external-access {kind} rule: {rule!r}")
    if not (rule.startswith("/") or rule.startswith("~/")):
        raise BenchmarkError(f"Invalid frozen external-access {kind} rule: {rule!r}")
    if kind == "prefix":
        if not rule.endswith("/") or rule in {"/", "~/"}:
            raise BenchmarkError(f"Invalid frozen external-access {kind} rule: {rule!r}")
        normalized = rule.rstrip("/")
    elif rule.endswith("/"):
        raise BenchmarkError(f"Invalid frozen external-access {kind} rule: {rule!r}")
    else:
        normalized = rule
    path_text = normalized[2:] if normalized.startswith("~/") else normalized
    if not path_text or any(part in {"", ".", ".."} for part in PurePosixPath(path_text).parts):
        raise BenchmarkError(f"Invalid frozen external-access {kind} rule: {rule!r}")


def validate_external_access_allowlist(contract: dict[str, Any]) -> dict[str, Any]:
    measurement = contract.get("measurement")
    collection_rules = measurement.get("collection_rules") if isinstance(measurement, dict) else None
    if not isinstance(collection_rules, dict):
        raise BenchmarkError("Frozen contract collection rules are missing")
    allowlist = collection_rules.get("external_access_allowlist")
    expected_keys = {"workspace_relative_paths", "filesystem_exact", "filesystem_prefixes", "network"}
    if not isinstance(allowlist, dict) or set(allowlist) != expected_keys:
        raise BenchmarkError("Frozen external-access allowlist has an unsupported shape")
    if allowlist["workspace_relative_paths"] is not True:
        raise BenchmarkError("Frozen external-access allowlist must allow workspace-relative paths")
    for key in ("filesystem_exact", "filesystem_prefixes"):
        rules = allowlist[key]
        if not isinstance(rules, list) or any(not isinstance(rule, str) for rule in rules) or len(rules) != len(set(rules)):
            raise BenchmarkError(f"Frozen external-access {key} must be a list of unique strings")
    if allowlist["network"] != []:
        raise BenchmarkError("Frozen external-access network allowlist must be empty")
    for rule in allowlist["filesystem_exact"]:
        validate_external_access_rule(rule, "exact")
    for rule in allowlist["filesystem_prefixes"]:
        validate_external_access_rule(rule, "prefix")
    return copy_json(allowlist)


def validate_rule(path: str) -> None:
    if not isinstance(path, str):
        raise BenchmarkError(f"Invalid manifest path rule: {path!r}")
    pure_path = PurePosixPath(path.rstrip("/"))
    if not path or "\\" in path or path.startswith("/") or "//" in path or any(part in {"", ".", ".."} for part in pure_path.parts):
        raise BenchmarkError(f"Invalid manifest path rule: {path!r}")
    if any(character in path for character in "*?[]"):
        raise BenchmarkError(f"Wildcard manifest path rule: {path!r}")


def validate_bound_path(path: Any, label: str) -> str:
    if not isinstance(path, str) or not path or "\\" in path or path.startswith("/"):
        raise BenchmarkError(f"Invalid {label} path: {path!r}")
    normalized = path.rstrip("/")
    parts = normalized.split("/")
    if (path != normalized and path != normalized + "/") or any(part in {"", ".", ".."} for part in parts) or PurePosixPath(normalized).as_posix() != normalized:
        raise BenchmarkError(f"Invalid {label} path: {path!r}")
    return normalized


def bound_file_path(benchmark_root: Path, relative: Any, label: str) -> Path:
    normalized = validate_bound_path(relative, label)
    path = benchmark_root
    for part in normalized.split("/"):
        path /= part
        if path.is_symlink():
            raise BenchmarkError(f"Frozen {label} path may not be a symlink: {normalized}")
    if not path.is_file():
        raise BenchmarkError(f"Missing frozen {label} file: {normalized}")
    return path


def verify_bound_file_hashes(benchmark_root: Path, bindings: Any, label: str) -> dict[str, str]:
    if not isinstance(bindings, dict) or not bindings:
        raise BenchmarkError(f"Frozen {label} file hashes are missing")
    verified: dict[str, str] = {}
    for relative, expected in sorted(bindings.items()):
        path = bound_file_path(benchmark_root, relative, f"{label}_file_hashes")
        if not isinstance(expected, str) or len(expected) != 64:
            raise BenchmarkError(f"Invalid frozen {label} hash: {relative}")
        actual = sha256_file(path)
        if actual != expected:
            raise BenchmarkError(f"Frozen {label} file SHA-256 mismatch: {relative}")
        verified[relative] = actual
    return verified


def verify_fixture_file_hashes(benchmark_root: Path, manifest: dict[str, Any]) -> dict[str, str]:
    verified = verify_bound_file_hashes(benchmark_root, manifest.get("fixture_file_hashes"), "fixture")
    scenarios = manifest.get("scenarios")
    if not isinstance(scenarios, dict):
        raise BenchmarkError("Scenario manifest has no scenarios")
    required: set[str] = set()
    for name, scenario in scenarios.items():
        if not isinstance(scenario, dict):
            raise BenchmarkError(f"Invalid scenario definition: {name}")
        root_relative = validate_bound_path(scenario.get("fixture_source_root"), f"scenario {name} fixture_source_root")
        root = benchmark_root / root_relative
        visible = scenario.get("candidate_visible_paths")
        if not isinstance(visible, dict):
            raise BenchmarkError(f"Invalid candidate-visible paths: {name}")
        for relative in visible.get("exact", []):
            validate_rule(relative)
            path = root / relative
            if path.is_symlink() or not path.exists():
                raise BenchmarkError(f"Missing candidate-visible fixture path: {name}/{relative}")
            if path.is_file():
                required.add(f"{root_relative}/{relative}")
        for relative in visible.get("trees", []):
            validate_rule(relative)
            if relative == ".git/":
                continue
            tree = root / relative.rstrip("/")
            if tree.is_symlink() or not tree.is_dir():
                raise BenchmarkError(f"Missing candidate-visible fixture tree: {name}/{relative}")
            for directory, _subdirectories, filenames in os.walk(tree, followlinks=False):
                for filename in filenames:
                    path = Path(directory) / filename
                    if path.is_symlink():
                        raise BenchmarkError(f"Candidate-visible fixture may not be a symlink: {path}")
                    required.add(path.relative_to(benchmark_root).as_posix())
    missing = sorted(required - set(verified))
    if missing:
        raise BenchmarkError("Candidate-visible fixture hashes are missing: " + ", ".join(missing))
    return verified


def verify_preflight(benchmark_root: Path) -> tuple[dict[str, Any], dict[str, Any]]:
    evaluation_root = benchmark_root / "evaluation"
    contract = load_json(evaluation_root / "gate_contract.json")
    manifest = load_json(evaluation_root / "scenario_manifests.json")
    contract_hash = canonical_hash(contract, ("integrity", "contract_sha256"))
    manifest_hash = canonical_hash(manifest, ("integrity", "manifest_sha256"))
    expected_contract_hash = contract.get("integrity", {}).get("contract_sha256")
    expected_manifest_hash = manifest.get("integrity", {}).get("manifest_sha256")
    if contract.get("contract_id") != "codex-agent-routing-quality-gates" or contract.get("contract_version") != "1.2.0":
        raise BenchmarkError("Unsupported gate contract identity or version")
    if manifest.get("manifest_id") != "codex-agent-routing-scenario-write-policy" or manifest.get("manifest_version") != "1.2.0":
        raise BenchmarkError("Unsupported scenario manifest identity or version")
    if contract.get("status") != "frozen" or manifest.get("status") != "frozen":
        raise BenchmarkError("Contract and manifest must be frozen")
    if contract_hash != expected_contract_hash or manifest_hash != expected_manifest_hash:
        raise BenchmarkError("Canonical contract or manifest hash mismatch")
    validate_external_access_allowlist(contract)
    verify_bound_file_hashes(benchmark_root, manifest.get("control_file_hashes"), "control")
    verify_fixture_file_hashes(benchmark_root, manifest)
    alignment = manifest.get("gate_contract_alignment", {})
    if alignment.get("contract_id") != contract["contract_id"] or alignment.get("contract_version") != contract["contract_version"]:
        raise BenchmarkError("Manifest gate contract identity mismatch")
    if alignment.get("contract_sha256") != contract_hash:
        raise BenchmarkError("Manifest gate contract hash mismatch")
    if manifest.get("candidate_capability_policy", {}).get("requested_cli_service_tier") != "default":
        raise BenchmarkError("Manifest must require Codex CLI service tier default")
    for scenario in manifest.get("scenarios", {}).values():
        for path in scenario.get("candidate_visible_paths", {}).get("exact", []):
            validate_rule(path)
        for path in scenario.get("candidate_visible_paths", {}).get("trees", []):
            validate_rule(path)
        for path in scenario.get("allowed_write_paths", []) + scenario.get("forbidden_write_paths", []):
            validate_rule(path)
    return contract, manifest


def discover_scenarios(benchmark_root: Path, manifest: dict[str, Any], selected_names: set[str]) -> list[Scenario]:
    scenario_definitions = manifest.get("scenarios")
    if not isinstance(scenario_definitions, dict):
        raise BenchmarkError("Scenario manifest has no scenarios")
    available = set(scenario_definitions)
    unknown = sorted(selected_names - available)
    if unknown:
        raise BenchmarkError(f"Unknown scenario filter: {', '.join(unknown)}")
    names = sorted(selected_names or available)
    scenarios: list[Scenario] = []
    for name in names:
        definition = scenario_definitions[name]
        if not isinstance(definition, dict):
            raise BenchmarkError(f"Invalid scenario definition: {name}")
        root = benchmark_root / definition["fixture_source_root"].rstrip("/")
        visible = definition["candidate_visible_paths"]
        task_path = root / "task.md"
        if not root.is_dir() or "task.md" not in visible["exact"] or not task_path.is_file():
            raise BenchmarkError(f"Scenario source layout does not match manifest: {name}")
        for relative_path in visible["exact"]:
            if not (root / relative_path).exists():
                raise BenchmarkError(f"Scenario visible path is missing: {name}/{relative_path}")
        for relative_path in visible["trees"]:
            if relative_path == ".git/":
                continue
            if not (root / relative_path.rstrip("/")).is_dir():
                raise BenchmarkError(f"Scenario visible tree is missing: {name}/{relative_path}")
        operations = {path: tuple(values) for path, values in definition["allowed_write_operations"].items()}
        scenarios.append(
            Scenario(
                name=name,
                root=root,
                task_path=task_path,
                visible_exact=tuple(visible["exact"]),
                visible_trees=tuple(visible["trees"]),
                allowed_write_paths=tuple(definition["allowed_write_paths"]),
                allowed_write_operations=operations,
                forbidden_write_paths=tuple(definition["forbidden_write_paths"]),
                timeout_seconds=int(definition["candidate_timeout_seconds"]),
                public_suite=definition["public_suite"],
                parent_creation=definition.get("candidate_output_parent_creation"),
            )
        )
    return scenarios


def select_model_efforts(models: list[str] | None, efforts: list[str] | None) -> list[tuple[str, str, str]]:
    selected_models = models or list(MODEL_EFFORTS)
    selections: list[tuple[str, str, str]] = []
    for family in selected_models:
        model, supported_efforts = MODEL_EFFORTS[family]
        requested_efforts = efforts or list(supported_efforts)
        invalid = sorted(set(requested_efforts) - set(supported_efforts))
        if invalid:
            raise BenchmarkError(f"{family} does not support effort(s): {', '.join(invalid)}")
        selections.extend((family, model, effort) for effort in requested_efforts)
    return selections


def build_run_specs(scenarios: Iterable[Scenario], models: list[str] | None, efforts: list[str] | None) -> list[RunSpec]:
    timestamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    combinations = select_model_efforts(models, efforts)
    return [
        RunSpec(scenario, family, model, effort, f"{timestamp}-{scenario.name}-{family}-{effort}-{uuid.uuid4().hex[:8]}", index)
        for index, (scenario, family, model, effort) in enumerate(
            ((scenario, family, model, effort) for scenario in scenarios for family, model, effort in combinations), start=1
        )
    ]


def build_prompt(scenario: Scenario, task_contract: str) -> str:
    command = scenario.public_suite["display_command"]
    write_policy = ", ".join(f"{path} ({'/'.join(scenario.allowed_write_operations[path])})" for path in scenario.allowed_write_paths)
    protected = ", ".join(scenario.forbidden_write_paths)
    return (
        "You are a single benchmark candidate working in the current repository.\n\n"
        "Rules:\n"
        "- Do not delegate work to subagents or other models.\n"
        "- Do not use network or web access.\n"
        "- Do not explore projects, files, or paths outside the current repository.\n"
        f"- Keep protected paths unchanged: {protected}.\n"
        f"- The only permitted write path and operation are: {write_policy}.\n"
        f"- Run this public test command before finishing: {command}\n\n"
        "Task contract:\n"
        f"{task_contract.rstrip()}\n"
    )


def build_codex_command(
    spec: RunSpec,
    workspace: Path,
    final_message_path: Path,
    prompt: str,
    codex_bin: str,
    candidate_home: Path | None = None,
) -> list[str]:
    command = [
        codex_bin, "exec", "--ignore-user-config", "--ignore-rules", "--strict-config", "--ephemeral", "--json",
        "--color", "never", "--sandbox", "workspace-write", "--cd", str(workspace),
        "--output-last-message", str(final_message_path), "--model", spec.model,
        "--config", f'model_reasoning_effort="{spec.effort}"', "--config", 'service_tier="default"',
        "--config", "features.multi_agent=false", "--config", "features.multi_agent_v2=false",
        "--config", "agents.enabled=false", "--config", "project_doc_max_bytes=0",
        "--config", "skills.include_instructions=false", "--config", "skills.bundled.enabled=false",
        "--config", "allow_login_shell=false", "--config", 'shell_environment_policy.inherit="none"',
        "--config", f'shell_environment_policy.set.PATH="{CANDIDATE_TOOL_PATH}"', prompt,
    ]
    if candidate_home is not None:
        command.insert(-1, "--config")
        command.insert(-1, f"shell_environment_policy.set.HOME={json.dumps(str(candidate_home))}")
    return command


def run_git(arguments: list[str], cwd: Path) -> subprocess.CompletedProcess[bytes]:
    return subprocess.run(["git", *arguments], cwd=cwd, capture_output=True, check=True)


def copy_entry(source: Path, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    if source.is_symlink():
        destination.symlink_to(os.readlink(source))
    elif source.is_dir():
        shutil.copytree(source, destination, symlinks=True)
    else:
        shutil.copy2(source, destination, follow_symlinks=False)


def copy_candidate_entry(source: Path, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    if source.is_symlink():
        raise BenchmarkError(f"Candidate-visible source may not be a symlink: {source}")
    if source.is_dir():
        shutil.copytree(
            source,
            destination,
            symlinks=False,
            ignore=lambda _directory, names: {name for name in names if name in CACHE_DIRECTORIES or name.endswith((".pyc", ".pyo"))},
        )
    else:
        shutil.copy2(source, destination, follow_symlinks=False)


def copy_visible_scenario(scenario: Scenario, workspace: Path) -> None:
    for relative_path in scenario.visible_exact:
        copy_candidate_entry(scenario.root / relative_path, workspace / relative_path)
    for tree in scenario.visible_trees:
        if tree != ".git/":
            copy_candidate_entry(scenario.root / tree.rstrip("/"), workspace / tree.rstrip("/"))


def initialize_repository(workspace: Path) -> str:
    run_git(["init", "--quiet"], workspace)
    run_git(["config", "user.email", "benchmark.local.invalid"], workspace)
    run_git(["config", "user.name", "Codex Benchmark Runner"], workspace)
    run_git(["add", "--all"], workspace)
    run_git(["commit", "--allow-empty", "--quiet", "--message", "Benchmark baseline"], workspace)
    return run_git(["rev-parse", "HEAD"], workspace).stdout.decode().strip()


def is_cache_path(relative_path: Path) -> bool:
    return any(part in CACHE_DIRECTORIES for part in relative_path.parts) or relative_path.suffix in {".pyc", ".pyo"}


def filesystem_manifest(root: Path, include_git: bool = False) -> list[dict[str, str]]:
    manifest: list[dict[str, str]] = []
    for directory, subdirectories, filenames in os.walk(root, followlinks=False):
        directory_path = Path(directory)
        filtered_directories: list[str] = []
        for name in sorted(subdirectories):
            path = directory_path / name
            relative_path = path.relative_to(root)
            if (not include_git and is_cache_path(relative_path)) or (include_git and relative_path.parts[:1] != (".git",)):
                continue
            if path.is_symlink():
                manifest.append({"path": relative_path.as_posix(), "type": "symlink", "target": os.readlink(path)})
            else:
                manifest.append({"path": relative_path.as_posix(), "type": "directory"})
                filtered_directories.append(name)
        subdirectories[:] = filtered_directories
        for name in sorted(filenames):
            path = directory_path / name
            relative_path = path.relative_to(root)
            if (not include_git and is_cache_path(relative_path)) or (include_git and relative_path.parts[:1] != (".git",)):
                continue
            if path.is_symlink():
                manifest.append({"path": relative_path.as_posix(), "type": "symlink", "target": os.readlink(path)})
            elif path.is_file():
                manifest.append({"path": relative_path.as_posix(), "type": "file", "sha256": sha256_file(path)})
    return sorted(manifest, key=lambda item: item["path"])


def manifest_hash(manifest: list[dict[str, str]]) -> str:
    return sha256_bytes(canonical_json(manifest))


def compare_manifests(baseline: list[dict[str, str]], final: list[dict[str, str]]) -> list[dict[str, str]]:
    before = {entry["path"]: entry for entry in baseline}
    after = {entry["path"]: entry for entry in final}
    changes: list[dict[str, str]] = []
    for path in sorted(set(before) | set(after)):
        old, new = before.get(path), after.get(path)
        if old is None:
            changes.append({"path": path, "operation": "create", "baseline_type": "absent", "candidate_type": new["type"]})
        elif new is None:
            changes.append({"path": path, "operation": "delete", "baseline_type": old["type"], "candidate_type": "absent"})
        elif old != new:
            operation = "modify" if old["type"] == new["type"] else "type_change"
            changes.append({"path": path, "operation": operation, "baseline_type": old["type"], "candidate_type": new["type"]})
    return changes


def path_matches(path: str, rule: str) -> bool:
    return path == rule.rstrip("/") or (rule.endswith("/") and path.startswith(rule))


def is_parent_creation(change: dict[str, str], scenario: Scenario) -> bool:
    policy = scenario.parent_creation
    if not policy or change["operation"] != "create" or change.get("candidate_type") != "directory":
        return False
    return change["path"] == policy["path"].rstrip("/")


def evaluate_write_policy(changes: list[dict[str, str]], scenario: Scenario) -> tuple[list[dict[str, str]], list[str], bool]:
    violations: list[dict[str, str]] = []
    protected: list[str] = []
    for change in changes:
        path = change["path"]
        if path_matches(path, ".git/") or any(path_matches(path, rule) for rule in scenario.forbidden_write_paths):
            protected.append(path)
        allowed_operations = scenario.allowed_write_operations.get(path, ())
        allowed = change["operation"] in allowed_operations or is_parent_creation(change, scenario)
        if not allowed:
            violations.append(change)
    tampering = any(path_matches(path, ".git/") or path_matches(path, "tests/") or path == "task.md" for path in protected)
    return violations, sorted(set(protected)), tampering


def text_diff_metrics(workspace: Path, baseline_store: Path, baseline: list[dict[str, str]], final: list[dict[str, str]]) -> tuple[int | str, int | str, str]:
    before = {entry["path"]: entry for entry in baseline if entry["type"] == "file"}
    after = {entry["path"]: entry for entry in final if entry["type"] == "file"}
    total = 0
    source_total = 0
    source_binary = False
    chunks: list[str] = []
    for path in sorted(set(before) | set(after)):
        old_path = workspace / path
        old_bytes = old_path.read_bytes() if path in before and path in after else b""
        # Baseline content is saved below before candidates run; the baseline manifest only carries hashes.
        baseline_path = baseline_store / path
        if baseline_path.exists() and baseline_path.is_file():
            old_bytes = baseline_path.read_bytes()
        new_bytes = (workspace / path).read_bytes() if path in after else b""
        if b"\0" in old_bytes or b"\0" in new_bytes:
            if path.startswith("src/"):
                source_binary = True
            chunks.append(f"Binary files differ: {path}\n")
            continue
        old_lines = old_bytes.decode("utf-8", "replace").splitlines(keepends=True)
        new_lines = new_bytes.decode("utf-8", "replace").splitlines(keepends=True)
        diff = list(difflib.unified_diff(old_lines, new_lines, fromfile=f"a/{path}", tofile=f"b/{path}"))
        chunks.extend(diff)
        changed = sum(1 for line in diff if line.startswith(("+", "-")) and not line.startswith(("+++", "---")))
        total += changed
        if path.startswith("src/"):
            source_total += changed
    return total, (UNAVAILABLE if source_binary else source_total), "".join(chunks)


def save_baseline_files(workspace: Path, destination: Path) -> None:
    for entry in filesystem_manifest(workspace):
        if entry["type"] == "file":
            copy_entry(workspace / entry["path"], destination / entry["path"])


def make_snapshot(source: Path, destination: Path, include_cache: bool = False) -> None:
    def ignore(directory: str, names: list[str]) -> set[str]:
        if include_cache:
            return {".git"}
        return {name for name in names if name in CACHE_DIRECTORIES or name.endswith((".pyc", ".pyo"))}

    shutil.copytree(source, destination, symlinks=True, ignore=ignore)
    for path in sorted(destination.rglob("*"), reverse=True):
        if path.is_symlink():
            continue
        path.chmod(0o555 if path.is_dir() else 0o444)
    destination.chmod(0o555)


def capture_untracked(workspace: Path, destination: Path, changes: list[dict[str, str]]) -> tuple[list[str], str]:
    try:
        output = run_git(["ls-files", "--others", "--exclude-standard", "-z"], workspace).stdout.decode("utf-8", "strict")
        paths = [path for path in output.split("\0") if path]
        source = "git"
    except (OSError, UnicodeDecodeError, subprocess.CalledProcessError):
        paths = [change["path"] for change in changes if change["operation"] == "create"]
        source = "python_manifest_fallback"
    for relative_path in paths:
        candidate = workspace / relative_path
        if candidate.exists() or candidate.is_symlink():
            copy_entry(candidate, destination / relative_path)
    if destination.exists():
        for path in sorted(destination.rglob("*"), reverse=True):
            if not path.is_symlink():
                path.chmod(0o555 if path.is_dir() else 0o444)
        destination.chmod(0o555)
    return sorted(paths), source


def terminate_process(process: subprocess.Popen[bytes]) -> None:
    if os.name == "posix":
        os.killpg(process.pid, signal.SIGKILL)
    else:
        process.kill()


def sanitized_environment(codex_home: Path | None = None, candidate_home: Path | None = None) -> dict[str, str]:
    fixed_names = {
        "PATH", "HOME", "TMPDIR", "TMP", "TEMP", "LANG", "TERM", "USER", "LOGNAME",
        "SSL_CERT_FILE", "SSL_CERT_DIR", "REQUESTS_CA_BUNDLE", "CURL_CA_BUNDLE",
    }
    environment = {key: value for key, value in os.environ.items() if key in fixed_names}
    if codex_home is not None:
        environment["CODEX_HOME"] = str(codex_home)
    if candidate_home is not None:
        environment["HOME"] = str(candidate_home)
    return environment


CODEX_HOME_PREFIX = "codex-routing-home-"
CANDIDATE_HOME_PREFIX = "codex-routing-candidate-home-"


def create_isolated_codex_home() -> tuple[Path, dict[str, Any]]:
    codex_home = Path(tempfile.mkdtemp(prefix=CODEX_HOME_PREFIX))
    auth_source = Path.home() / ".codex" / "auth.json"
    auth_linked = False
    try:
        if auth_source.is_file():
            (codex_home / "auth.json").symlink_to(auth_source)
            auth_linked = True
        evidence = {
            "location": "system_temp",
            "temporary": True,
            "auth_linked": auth_linked,
            "initial_entries": sorted(path.name for path in codex_home.iterdir()),
            "cleaned_up": False,
        }
        return codex_home, evidence
    except Exception:
        remove_isolated_codex_home(codex_home)
        raise


def remove_isolated_codex_home(codex_home: Path) -> None:
    temp_root = Path(tempfile.gettempdir()).resolve()
    if not codex_home.name.startswith(CODEX_HOME_PREFIX) or codex_home.resolve(strict=False).parent != temp_root:
        raise BenchmarkError("Refusing to remove an unexpected CODEX_HOME")
    if codex_home.is_symlink():
        codex_home.unlink()
    elif codex_home.is_dir():
        shutil.rmtree(codex_home)


def create_candidate_home() -> tuple[Path, dict[str, Any]]:
    candidate_home = Path(tempfile.mkdtemp(prefix=CANDIDATE_HOME_PREFIX))
    try:
        resolved = candidate_home.resolve()
        host_home = Path.home().resolve()
        if resolved == host_home or host_home in resolved.parents:
            raise BenchmarkError("Candidate HOME must be outside the host home")
        if any(candidate_home.iterdir()):
            raise BenchmarkError("Fresh candidate HOME is not empty")
        return candidate_home, {
            "location": "system_temp",
            "temporary": True,
            "credential_free": True,
            "auth_linked": False,
            "initial_entries": [],
            "cleaned_up": False,
        }
    except Exception:
        remove_candidate_home(candidate_home)
        raise


def remove_candidate_home(candidate_home: Path) -> None:
    temp_root = Path(tempfile.gettempdir()).resolve()
    if not candidate_home.name.startswith(CANDIDATE_HOME_PREFIX) or candidate_home.resolve(strict=False).parent != temp_root:
        raise BenchmarkError("Refusing to remove an unexpected candidate HOME")
    if candidate_home.is_symlink():
        candidate_home.unlink()
    elif candidate_home.is_dir():
        shutil.rmtree(candidate_home)


def execute_command(
    command: list[str],
    workspace: Path,
    timeout_seconds: int,
    codex_home: Path | None = None,
    candidate_home: Path | None = None,
) -> tuple[bytes, bytes, int | None, bool]:
    process = subprocess.Popen(
        command,
        cwd=workspace,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        start_new_session=True,
        env=sanitized_environment(codex_home, candidate_home),
    )
    try:
        stdout, stderr = process.communicate(timeout=timeout_seconds)
        return stdout, stderr, process.returncode, False
    except subprocess.TimeoutExpired:
        terminate_process(process)
        stdout, stderr = process.communicate()
        return stdout, stderr, process.returncode, True


def parse_jsonl(raw_jsonl: bytes) -> tuple[list[dict[str, Any]], list[str]]:
    try:
        text = raw_jsonl.decode("utf-8", "strict")
    except UnicodeDecodeError as error:
        return [], [f"invalid_utf8:{error.start}"]
    events: list[dict[str, Any]] = []
    errors: list[str] = []
    for number, line in enumerate(text.splitlines(), start=1):
        if not line.strip():
            errors.append(f"blank_jsonl_line:{number}")
            continue
        try:
            value = json.loads(line)
        except json.JSONDecodeError:
            errors.append(f"malformed_jsonl_line:{number}")
            continue
        if isinstance(value, dict):
            events.append(value)
        else:
            errors.append(f"non_object_jsonl_line:{number}")
    return events, errors


def event_type(event: dict[str, Any]) -> str:
    value = event.get("type")
    return value if isinstance(value, str) else ""


def tool_items(events: Iterable[dict[str, Any]]) -> Iterable[tuple[int, str, dict[str, Any]]]:
    selected: dict[str, tuple[int, str, dict[str, Any]]] = {}
    unkeyed: list[tuple[int, str, dict[str, Any]]] = []
    for event_index, event in enumerate(events):
        event_kind = event_type(event)
        item = event.get("item")
        if event_kind not in ITEM_EVENTS or not isinstance(item, dict):
            continue
        item_type = item.get("type")
        item_id = item.get("id")
        if item_type not in CONCRETE_ACTION_ITEM_TYPES or not isinstance(item_id, str) or not item_id:
            unkeyed.append((event_index, event_kind, item))
            continue
        previous = selected.get(item_id)
        if (
            previous is None
            or (event_kind == "item.completed" and previous[1] != "item.completed")
            or (event_kind == previous[1] and event_index > previous[0])
        ):
            selected[item_id] = (event_index, event_kind, item)
    yield from sorted((*unkeyed, *selected.values()), key=lambda value: value[0])


def command_actions(events: Iterable[dict[str, Any]]) -> list[tuple[int, str, str]]:
    actions: list[tuple[int, str, str]] = []
    for event_index, _event_kind, item in tool_items(events):
        if item.get("type") != "command_execution":
            continue
        for key in COMMAND_KEYS:
            value = item.get(key)
            if value is None:
                continue
            command = " ".join(map(str, value)) if isinstance(value, list) else str(value)
            if command:
                actions.append((event_index, "command_execution", command))
            break
    return actions


def command_strings(events: Iterable[dict[str, Any]]) -> list[str]:
    return list(dict.fromkeys(command for _index, _item_type, command in command_actions(events)))


def file_change_paths(events: Iterable[dict[str, Any]]) -> list[tuple[int, str, str]]:
    paths: list[tuple[int, str, str]] = []
    for event_index, _event_kind, item in tool_items(events):
        if item.get("type") != "file_change":
            continue
        for key in ("path", "file_path"):
            value = item.get(key)
            if isinstance(value, str):
                paths.append((event_index, "file_change", value))
        changes = item.get("changes")
        if isinstance(changes, list):
            for change in changes:
                if isinstance(change, dict) and isinstance(change.get("path"), str):
                    paths.append((event_index, "file_change", change["path"]))
    return paths


def lifecycle_metadata(events: list[dict[str, Any]]) -> dict[str, Any]:
    types = [event_type(event) for event in events]
    thread_index = types.index("thread.started") if "thread.started" in types else None
    turn_index = types.index("turn.started") if "turn.started" in types else None
    terminal_index = len(events) - 1 if types and types[-1] == "turn.completed" else None
    terminal_usage = terminal_index is not None and isinstance(events[terminal_index].get("usage"), dict)
    start_order_valid = thread_index is not None and turn_index is not None and thread_index < turn_index
    return {
        "thread_started": thread_index is not None,
        "turn_started": turn_index is not None,
        "terminal_turn_completed": terminal_index is not None,
        "terminal_usage": terminal_usage,
        "start_order_valid": start_order_valid,
        "terminal_event_index": terminal_index,
    }


def raw_usage(events: Iterable[dict[str, Any]]) -> dict[str, Any] | str:
    usages = [event["usage"] for event in events if event_type(event) == "turn.completed" and isinstance(event.get("usage"), dict)]
    return usages[-1] if usages else UNAVAILABLE


def effective_service_tier(events: Iterable[dict[str, Any]]) -> tuple[str, str]:
    for event_index, event in reversed(list(enumerate(events))):
        for key in ("effective_service_tier", "service_tier"):
            value = event.get(key)
            if isinstance(value, str):
                return value, f"raw.jsonl event {event_index} field {key}"
    return UNAVAILABLE, UNAVAILABLE


def integer_usage(value: Any) -> int | str:
    return value if isinstance(value, int) and not isinstance(value, bool) and value >= 0 else UNAVAILABLE


def usage_value(usage: dict[str, Any], *keys: str) -> int | str:
    for key in keys:
        value: Any = usage
        for part in key.split("."):
            if not isinstance(value, dict) or part not in value:
                break
            value = value[part]
        else:
            return integer_usage(value)
    return UNAVAILABLE


def derive_usage(usage: dict[str, Any] | str) -> tuple[dict[str, int | str], bool]:
    if not isinstance(usage, dict):
        return {key: UNAVAILABLE for key in ("input_tokens", "cached_input_tokens", "uncached_input_tokens", "output_tokens", "reasoning_tokens")}, False
    total = usage_value(usage, "input_tokens", "total_input_tokens")
    cached = usage_value(usage, "cached_input_tokens", "input_tokens_details.cached_tokens")
    output = usage_value(usage, "output_tokens")
    reasoning = usage_value(usage, "reasoning_output_tokens", "reasoning_tokens")
    valid_cache = total == UNAVAILABLE or cached == UNAVAILABLE or cached <= total
    uncached: int | str = total - cached if isinstance(total, int) and isinstance(cached, int) and valid_cache else UNAVAILABLE
    return {
        "input_tokens": total,
        "cached_input_tokens": cached,
        "uncached_input_tokens": uncached,
        "output_tokens": output,
        "reasoning_tokens": reasoning,
    }, valid_cache


def sandbox_denial_code(item: dict[str, Any]) -> str | None:
    values = [item.get(key) for key in ("outcome", "status", "error_code", "code")]
    error = item.get("error")
    if isinstance(error, dict):
        values.extend(error.get(key) for key in ("type", "code"))
    for value in values:
        if isinstance(value, str) and value.lower() in SANDBOX_DENIAL_CODES:
            return value
    return None


def sandbox_denials(events: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    denials: list[dict[str, Any]] = []
    for event_index, event_kind, item in tool_items(events):
        if item.get("type") not in CONCRETE_ACTION_ITEM_TYPES:
            continue
        if sandbox_denial_code(item) is not None:
            denials.append({"event_index": event_index, "event_type": event_kind, "item_type": item.get("type", "unknown"), "outcome": "denied"})
    return denials


def normalized_tool_name(item: dict[str, Any]) -> str:
    for key in ("name", "tool", "tool_name", "action"):
        value = item.get(key)
        if isinstance(value, str):
            return value.lower()
    return ""


def is_delegation_item(item: dict[str, Any]) -> bool:
    name = normalized_tool_name(item)
    return item.get("type") in DELEGATION_ITEM_TYPES or name in DELEGATION_NAMES or any(
        name.endswith(f"__{candidate}") for candidate in DELEGATION_NAMES
    )


def delegation_events(events: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    matches: list[dict[str, Any]] = []
    for event_index, event_kind, item in tool_items(events):
        if is_delegation_item(item):
            matches.append({
                "event_index": event_index,
                "event_type": event_kind,
                "item_type": item["type"],
                "action": item.get("action"),
                "tool_name": normalized_tool_name(item) or None,
                "outcome": "denied" if sandbox_denial_code(item) else "allowed",
            })
    return matches


def resolve_observed_path(token: str, workspace: Path) -> Path:
    if token.startswith("~/"):
        return Path.home() / token[2:]
    if token.startswith("/"):
        return Path(token)
    return (workspace / token).resolve(strict=False)


def expand_allowlist_path(rule: str) -> Path:
    if rule.startswith("~/"):
        return (Path.home() / rule[2:]).resolve(strict=False)
    return Path(rule).resolve(strict=False)


def is_allowlisted_path(path: Path, external_access_allowlist: dict[str, Any]) -> bool:
    if not isinstance(external_access_allowlist, dict):
        return False
    exact_rules = external_access_allowlist.get("filesystem_exact")
    prefix_rules = external_access_allowlist.get("filesystem_prefixes")
    if not isinstance(exact_rules, list) or not isinstance(prefix_rules, list):
        return False
    try:
        observed = path.resolve(strict=False)
        if any(observed == expand_allowlist_path(rule) for rule in exact_rules if isinstance(rule, str)):
            return True
        for rule in prefix_rules:
            if not isinstance(rule, str):
                continue
            prefix = expand_allowlist_path(rule.rstrip("/"))
            try:
                observed.relative_to(prefix)
                return True
            except ValueError:
                continue
    except (OSError, RuntimeError, ValueError):
        return False
    return False


def external_access_events(
    actions: Iterable[tuple[int, str, str]], workspace: Path, file_changes: Iterable[tuple[int, str, str]] = (),
    *, external_access_allowlist: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    workspace_root = workspace.resolve()
    for event_index, item_type, command in actions:
        evidence: list[tuple[str, str]] = []
        if URL_TOKEN.search(command) or NETWORK_COMMAND.search(command):
            evidence.append(("network", command))
        for token in PATH_TOKEN.findall(command):
            path = resolve_observed_path(token.rstrip(".,:"), workspace)
            try:
                path.resolve(strict=False).relative_to(workspace_root)
                continue
            except ValueError:
                pass
            if not is_allowlisted_path(path, external_access_allowlist or {}):
                evidence.append(("filesystem", token))
        if evidence:
            kind, value = evidence[0]
            events.append({"kind": kind, "event_index": event_index, "item_type": item_type, "evidence": value})
    grouped_file_changes: dict[tuple[int, str], list[str]] = {}
    for event_index, item_type, path_value in file_changes:
        grouped_file_changes.setdefault((event_index, item_type), []).append(path_value)
    for (event_index, item_type), path_values in grouped_file_changes.items():
        for path_value in path_values:
            path = resolve_observed_path(path_value, workspace)
            try:
                path.resolve(strict=False).relative_to(workspace_root)
                continue
            except ValueError:
                pass
            if not is_allowlisted_path(path, external_access_allowlist or {}):
                events.append({"kind": "filesystem", "event_index": event_index, "item_type": item_type, "evidence": path_value})
                break
    return events


def fallback_final_message(events: Iterable[dict[str, Any]]) -> str:
    candidates: list[str] = []
    for _event_index, _event_kind, item in tool_items(events):
        if item.get("type") in {"agent_message", "message", "final"}:
            text = item.get("text") or item.get("message") or item.get("content")
            if isinstance(text, str):
                candidates.append(text)
    return candidates[-1] if candidates else ""


def git_evidence(workspace: Path, record_dir: Path, baseline_commit: str) -> dict[str, Any]:
    evidence: dict[str, Any] = {"baseline_commit": baseline_commit, "status": UNAVAILABLE, "diff": "git.diff", "errors": []}
    try:
        status = run_git(["status", "--porcelain=v1", "--untracked-files=all"], workspace).stdout
        (record_dir / "git.status.txt").write_bytes(status)
        evidence["status"] = "git.status.txt"
    except (OSError, subprocess.CalledProcessError) as error:
        evidence["errors"].append(f"status:{type(error).__name__}")
    try:
        (record_dir / "git.diff").write_bytes(run_git(["diff", "--binary", "--no-ext-diff", baseline_commit], workspace).stdout)
    except (OSError, subprocess.CalledProcessError) as error:
        (record_dir / "git.diff").write_text("", encoding="utf-8")
        evidence["errors"].append(f"diff:{type(error).__name__}")
    return evidence


def dependency_names(root: Path) -> set[str]:
    names: set[str] = set()
    pyproject = root / "pyproject.toml"
    if pyproject.is_file():
        try:
            import tomllib
            values = tomllib.loads(pyproject.read_text(encoding="utf-8")).get("project", {}).get("dependencies", [])
            for value in values if isinstance(values, list) else []:
                if isinstance(value, str):
                    names.add(re.split(r"[<>=!~ ;\[]", value, 1)[0].lower())
        except (OSError, ValueError):
            pass
    for path in root.glob("requirements*.txt"):
        for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
            value = line.strip()
            if value and not value.startswith(("#", "-")):
                names.add(re.split(r"[<>=!~ ;\[]", value, 1)[0].lower())
    return names


def artifact_hashes(record_dir: Path) -> dict[str, str]:
    hashes: dict[str, str] = {}
    for path in sorted(record_dir.rglob("*")):
        if path.is_file() and path.name != "record.json":
            hashes[path.relative_to(record_dir).as_posix()] = sha256_file(path)
    return hashes


def environment_fingerprint() -> dict[str, str]:
    value = {"platform": platform.platform(), "python": sys.version.split()[0], "implementation": platform.python_implementation()}
    return {"sha256": sha256_bytes(canonical_json(value)), "fields": value}


def codex_version(codex_bin: str) -> str:
    try:
        result = subprocess.run([codex_bin, "--version"], capture_output=True, check=False, timeout=10, env=sanitized_environment())
    except (OSError, subprocess.TimeoutExpired):
        return UNAVAILABLE
    output = (result.stdout or result.stderr).decode("utf-8", "replace").strip()
    return output if result.returncode == 0 and output else UNAVAILABLE


def write_json(path: Path, value: dict[str, Any]) -> None:
    path.write_bytes(json.dumps(value, indent=2, sort_keys=True, ensure_ascii=False).encode("utf-8") + b"\n")


def run_one(spec: RunSpec, config: RunConfig, submitted_monotonic: float, submitted_at_utc: str, state: BatchState) -> dict[str, Any]:
    record_dir = config.results_dir / "records" / spec.run_id
    record_dir.mkdir(parents=True, exist_ok=False)
    started_monotonic = time.monotonic()
    with state.lock:
        state.next_start_order += 1
        start_order = state.next_start_order
    timeout_seconds = config.timeout_override or spec.scenario.timeout_seconds
    preflight = config.preflight
    external_access_allowlist = config.external_access_allowlist
    if external_access_allowlist is None:
        external_access_allowlist = preflight.get("external_access_allowlist")
    record: dict[str, Any] = {
        "record_version": RECORD_VERSION,
        "schema_version": 1,
        "run_id": spec.run_id,
        "candidate_id": f"{spec.model_family}-{spec.effort}",
        "scenario_id": spec.scenario.name,
        "contract_id": preflight["contract_id"], "contract_version": preflight["contract_version"], "contract_sha256": preflight["contract_sha256"],
        "manifest_id": preflight["manifest_id"], "manifest_version": preflight["manifest_version"], "manifest_sha256": preflight["manifest_sha256"],
        "scenario_manifest_sha256": preflight["manifest_sha256"],
        "runner_version": RUNNER_VERSION, "environment_fingerprint": environment_fingerprint(), "codex_version": config.codex_version,
        "submitted_at_utc": submitted_at_utc, "started_at_utc": utc_now(), "submission_order": spec.submission_order, "start_order": start_order,
        "queue_delay_ms": int((started_monotonic - submitted_monotonic) * 1000),
        "model_private": {"family": spec.model_family, "name": spec.model, "reasoning_effort": spec.effort},
        "requested_service_mode": "Standard", "requested_cli_service_tier": "default",
        "requested_service_tier_evidence": 'Codex CLI --config service_tier="default"',
        "effective_service_tier": UNAVAILABLE, "effective_service_tier_evidence": UNAVAILABLE,
        "allowed_write_paths": list(spec.scenario.allowed_write_paths), "forbidden_write_paths": list(spec.scenario.forbidden_write_paths),
        "external_access_allowlist": copy_json(external_access_allowlist),
        "role_assignments": {
            "writer": "candidate-model-under-test",
            "test_author": "independent-test-author",
            "gate_author": "independent-gate-author",
            "runner": "independent-runner",
            "reviewer": "independent-pipeline-reviewer",
        },
        "baseline_precedes_candidate_changes": False,
        "status": "runner_error", "artifacts": {"raw_jsonl": "raw.jsonl", "stderr": "stderr.txt", "final_response": "final_message.txt", "git_diff": "git.diff", "python_diff": "python.diff", "candidate_snapshot": "candidate_snapshot", "untracked_snapshot": "untracked_files"},
    }
    workspace: Path | None = None
    codex_home: Path | None = None
    candidate_home: Path | None = None
    try:
        task_contract = spec.scenario.task_path.read_text(encoding="utf-8")
        prompt = build_prompt(spec.scenario, task_contract)
        record["task_contract_sha256"] = sha256_text(task_contract)
        workspace = Path(tempfile.mkdtemp(prefix=f"codex-routing-{spec.run_id}-"))
        record["workspace"] = {"location": "system_temp", "temporary": True}
        copy_visible_scenario(spec.scenario, workspace)
        baseline_manifest = filesystem_manifest(workspace)
        baseline_store = record_dir / "baseline_files"
        save_baseline_files(workspace, baseline_store)
        baseline_commit = initialize_repository(workspace)
        baseline_git_manifest = filesystem_manifest(workspace, include_git=True)
        record["baseline_commit"] = baseline_commit
        record["baseline_snapshot_manifest"] = baseline_manifest
        record["baseline_manifest"] = baseline_manifest
        record["baseline_manifest_sha256"] = manifest_hash(baseline_manifest)
        record["baseline_git_metadata_manifest_sha256"] = manifest_hash(baseline_git_manifest)
        baseline_ready_at = time.monotonic()
        final_message_path = record_dir / "final_message.txt"
        codex_home, codex_home_evidence = create_isolated_codex_home()
        candidate_home, candidate_home_evidence = create_candidate_home()
        if candidate_home.resolve() == codex_home.resolve() or candidate_home.resolve() in codex_home.resolve().parents or codex_home.resolve() in candidate_home.resolve().parents:
            raise BenchmarkError("Candidate HOME must be distinct from CODEX_HOME")
        command = build_codex_command(spec, workspace, final_message_path, prompt, config.codex_bin, candidate_home)
        record["command"] = {"argv": command, "cwd": "candidate_workspace", "shell": False, "timeout_seconds": timeout_seconds, "timeout_source": "cli_override" if config.timeout_override else "scenario_manifest"}
        codex_environment = sanitized_environment(codex_home, candidate_home)
        record["codex_home_isolation"] = {
            **codex_home_evidence,
            "passed_to_parent_codex": True,
            "candidate_subprocess_environment": "CODEX_HOME only for auth transport",
            "parent_environment_names": sorted(codex_environment),
        }
        record["candidate_home_isolation"] = {
            **candidate_home_evidence,
            "passed_to_parent_codex": True,
            "passed_to_candidate_tools": True,
            "environment_variable": "HOME",
            "policy_evidence": "shell_environment_policy.set.HOME",
        }
        candidate_started = time.monotonic()
        record["candidate_started_at_utc"] = utc_now()
        record["candidate_started_monotonic"] = candidate_started
        record["baseline_precedes_candidate_changes"] = baseline_ready_at <= candidate_started
        stdout, stderr, exit_code, timed_out = execute_command(command, workspace, timeout_seconds, codex_home, candidate_home)
        (record_dir / "raw.jsonl").write_bytes(stdout)
        (record_dir / "stderr.txt").write_bytes(stderr)
        events, jsonl_errors = parse_jsonl(stdout)
        final_message = final_message_path.read_text(encoding="utf-8", errors="replace") if final_message_path.exists() else fallback_final_message(events)
        final_message_path.write_text(final_message, encoding="utf-8")
        final_manifest = filesystem_manifest(workspace)
        final_git_manifest = filesystem_manifest(workspace, include_git=True)
        changes = compare_manifests(baseline_manifest, final_manifest)
        git_metadata_changes = compare_manifests(baseline_git_manifest, final_git_manifest)
        violations, protected_paths, tampering = evaluate_write_policy(changes, spec.scenario)
        diff_size, source_diff_size, python_diff = text_diff_metrics(workspace, baseline_store, baseline_manifest, final_manifest)
        (record_dir / "python.diff").write_text(python_diff, encoding="utf-8")
        git_data = git_evidence(workspace, record_dir, baseline_commit)
        make_snapshot(workspace, record_dir / "candidate_snapshot")
        untracked_paths, untracked_source = capture_untracked(workspace, record_dir / "untracked_files", changes)
        actions = command_actions(events)
        commands = command_strings(events)
        changed_files = file_change_paths(events)
        denials = sandbox_denials(events)
        delegation = delegation_events(events)
        external = external_access_events(actions, workspace, changed_files, external_access_allowlist=external_access_allowlist)
        raw_provider_usage = raw_usage(events)
        derived_usage, valid_usage = derive_usage(raw_provider_usage)
        effective_tier, effective_tier_evidence = effective_service_tier(events)
        lifecycle = lifecycle_metadata(events)
        parseable_object_jsonl = not jsonl_errors
        lifecycle_complete = all(lifecycle[key] for key in ("thread_started", "turn_started", "terminal_turn_completed", "terminal_usage", "start_order_valid"))
        telemetry_complete = parseable_object_jsonl and lifecycle_complete and not timed_out
        telemetry_completeness = {
            "complete": telemetry_complete,
            "raw_event_count": len(events),
            "sandbox_denial_count": len(denials),
            "parse": {"object_jsonl": parseable_object_jsonl, "errors": jsonl_errors},
            "lifecycle": lifecycle,
            "timeout_controller_terminated": timed_out,
        }
        disqualifications: list[str] = []
        if not telemetry_complete:
            disqualifications.append("missing_or_truncated_raw_tool_telemetry")
        if delegation:
            disqualifications.append("delegation_event_count>0")
        if external:
            disqualifications.append("external_path_access>0")
        if violations:
            disqualifications.append("forbidden_file_edits>0")
        if tampering:
            disqualifications.append("test_or_gate_tampering=true")
        if not valid_usage:
            disqualifications.append("invalid_metric_value:cached_input_tokens")
        wall_time_ms = int((time.monotonic() - candidate_started) * 1000)
        record.update({
            "status": "timed_out" if timed_out else ("completed" if exit_code == 0 else "candidate_failed"),
            "finished_at_utc": utc_now(), "candidate_finished_monotonic": time.monotonic(), "wall_time_ms": wall_time_ms,
            "candidate_wall_time_ms": wall_time_ms, "timeout_controller_terminated": timed_out,
            "effective_service_tier": effective_tier, "effective_service_tier_evidence": effective_tier_evidence,
            "process": {"exit_code": exit_code, "timed_out": timed_out}, "final_response": final_message,
            "final_manifest": final_manifest, "final_manifest_sha256": manifest_hash(final_manifest),
            "candidate_snapshot": {"path": "candidate_snapshot", "manifest": final_manifest},
            "changed_paths": changes, "protected_paths_checked": protected_paths,
            "git_metadata_evidence": {**git_data, "post_manifest_sha256": manifest_hash(final_git_manifest), "changed_paths": git_metadata_changes},
            "untracked_paths": untracked_paths, "untracked_retention_source": untracked_source,
            "telemetry": {"candidate_interval_complete": telemetry_complete},
            "raw_tool_telemetry": {"path": "raw.jsonl", "format": "jsonl", "complete": telemetry_complete, "sha256": sha256_file(record_dir / "raw.jsonl")},
            "raw_tool_telemetry_hashes": {"raw.jsonl": sha256_file(record_dir / "raw.jsonl")},
            "telemetry_completeness": telemetry_completeness, "telemetry_complete": telemetry_complete,
            "tool_commands": commands, "tool_file_changes": changed_files, "sandbox_denials": denials,
            "external_access_events": external, "external_access_allowlist": copy_json(external_access_allowlist),
            "delegation_events": delegation, "raw_provider_usage": raw_provider_usage, "derived_usage": derived_usage,
            "metric_vector": {"public_correctness": UNAVAILABLE, "heldout_correctness": UNAVAILABLE, "scope_compliance": 1 if not violations else 0, "forbidden_file_edits": len(violations), "timed_out": timed_out, "wall_time_ms": wall_time_ms, "input_tokens": derived_usage["input_tokens"], "cached_input_tokens": derived_usage["cached_input_tokens"], "uncached_input_tokens": derived_usage["uncached_input_tokens"], "output_tokens": derived_usage["output_tokens"], "reasoning_tokens": derived_usage["reasoning_tokens"], "diff_size": diff_size, "changed_file_count": len(changes), "added_file_count": sum(1 for item in changes if item["operation"] == "create" and item.get("candidate_type") == "file"), "source_diff_size": source_diff_size, "added_dependency_count": len(dependency_names(workspace) - dependency_names(baseline_store)), "unauthorized_artifact_count": sum(1 for item in violations if item["operation"] == "create"), "test_or_gate_tampering": tampering, "external_path_access": len(external), "delegation_event_count": len(delegation), "telemetry_complete": telemetry_complete, "ambiguity_behavior": UNAVAILABLE},
            "diagnostic_vector": {}, "public_check_ids": [spec.scenario.public_suite["command_id"]], "heldout_check_ids": [UNAVAILABLE],
            "gate_results": UNAVAILABLE, "disqualifications": disqualifications,
        })
    except Exception as error:
        record.update({"finished_at_utc": utc_now(), "error": f"{type(error).__name__}: {error}", "failure": {"stage": "runner", "scorable": False}, "disqualifications": ["missing_required_run_data"]})
    finally:
        if codex_home is not None:
            try:
                remove_isolated_codex_home(codex_home)
                if "codex_home_isolation" in record:
                    record["codex_home_isolation"]["cleaned_up"] = not codex_home.exists()
            except Exception as error:
                if "codex_home_isolation" in record:
                    record["codex_home_isolation"]["cleanup_error"] = type(error).__name__
        if candidate_home is not None:
            try:
                remove_candidate_home(candidate_home)
                if "candidate_home_isolation" in record:
                    record["candidate_home_isolation"]["cleaned_up"] = not candidate_home.exists()
            except Exception as error:
                if "candidate_home_isolation" in record:
                    record["candidate_home_isolation"]["cleanup_error"] = type(error).__name__
        if workspace is not None and workspace.exists():
            shutil.rmtree(workspace, ignore_errors=True)
    record["artifact_hashes"] = artifact_hashes(record_dir)
    write_json(record_dir / "record.json", record)
    return record


def run_batch(specs: list[RunSpec], config: RunConfig, jobs: int) -> list[dict[str, Any]]:
    (config.results_dir / "records").mkdir(parents=True, exist_ok=True)
    state = BatchState()
    submitted_monotonic = time.monotonic()
    submitted_at_utc = utc_now()
    records: list[dict[str, Any]] = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=jobs) as executor:
        futures = [executor.submit(run_one, spec, config, submitted_monotonic, submitted_at_utc, state) for spec in specs]
        for future in concurrent.futures.as_completed(futures):
            record = future.result()
            records.append(record)
            print(json.dumps({"run_id": record["run_id"], "status": record["status"]}, sort_keys=True), flush=True)
    return records


def parse_args() -> argparse.Namespace:
    runner_dir = Path(__file__).resolve().parent
    parser = argparse.ArgumentParser(description="Run isolated Codex benchmark candidates.")
    parser.add_argument("--scenario", action="append", dest="scenarios", help="Scenario name to run; repeatable.")
    parser.add_argument("--model", action="append", choices=sorted(MODEL_EFFORTS), help="Model family to run; repeatable.")
    parser.add_argument("--effort", action="append", help="Reasoning effort to run; repeatable.")
    parser.add_argument("--results-dir", type=Path, default=runner_dir / "results", help="Directory for per-run records.")
    parser.add_argument("--codex-bin", default="codex", help="Codex executable to invoke.")
    parser.add_argument("--timeout-seconds", type=int, help="Override the manifest candidate timeout for every selected run.")
    parser.add_argument("--jobs", type=int, default=1, help="Maximum concurrently running candidates.")
    parser.add_argument("--dry-run", action="store_true", help="Verify inputs and print the planned runs without invoking Codex or writing records.")
    return parser.parse_args()


def preflight_record(contract: dict[str, Any], manifest: dict[str, Any]) -> dict[str, Any]:
    return {
        "contract_id": contract["contract_id"], "contract_version": contract["contract_version"], "contract_sha256": contract["integrity"]["contract_sha256"],
        "manifest_id": manifest["manifest_id"], "manifest_version": manifest["manifest_version"], "manifest_sha256": manifest["integrity"]["manifest_sha256"],
        "external_access_allowlist": validate_external_access_allowlist(contract),
    }


def main() -> int:
    args = parse_args()
    if (args.timeout_seconds is not None and args.timeout_seconds < 1) or args.jobs < 1:
        raise BenchmarkError("--timeout-seconds and --jobs must be positive")
    benchmark_root = Path(__file__).resolve().parent.parent
    contract, manifest = verify_preflight(benchmark_root)
    scenarios = discover_scenarios(benchmark_root, manifest, set(args.scenarios or []))
    specs = build_run_specs(scenarios, args.model, args.effort)
    preflight = preflight_record(contract, manifest)
    if args.dry_run:
        runs = [{"submission_order": spec.submission_order, "scenario": spec.scenario.name, "model": spec.model, "reasoning_effort": spec.effort, "timeout_seconds": args.timeout_seconds or spec.scenario.timeout_seconds} for spec in specs]
        print(json.dumps({"dry_run": True, "preflight": preflight, "run_count": len(runs), "runs": runs}, indent=2, sort_keys=True))
        return 0
    config = RunConfig(
        args.results_dir.resolve(), args.codex_bin, args.timeout_seconds, preflight, codex_version(args.codex_bin),
        copy_json(preflight["external_access_allowlist"]),
    )
    records = run_batch(specs, config, args.jobs)
    return 2 if any(record["status"] == "runner_error" for record in records) else 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except BenchmarkError as error:
        print(f"error: {error}", file=sys.stderr)
        raise SystemExit(2) from error
