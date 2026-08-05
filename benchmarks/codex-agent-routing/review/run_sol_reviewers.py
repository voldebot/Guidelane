#!/usr/bin/env python3
from __future__ import annotations

import argparse
import concurrent.futures
import hashlib
import json
import os
import shutil
import signal
import subprocess
import tempfile
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any


REVIEW_ROOT = Path(__file__).resolve().parent
PACKET_PATH = REVIEW_ROOT / "REVIEW_PACKET.md"
PROMPT_PATH = REVIEW_ROOT / "reviewer_prompt.txt"
DEFAULT_RESULTS = REVIEW_ROOT / "results" / "sol-blind-v2"
EFFORTS = ("medium", "high", "xhigh", "max")
TOOL_PATH = "/opt/homebrew/bin:/Library/Frameworks/Python.framework/Versions/3.11/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
REQUIRED_SCENARIOS = {"routine_defined", "complex_defined", "complex_underdefined"}
TEMP_PREFIXES = ("codex-sol-review-workspace-", "codex-sol-review-home-", "codex-sol-review-candidate-home-")


class ReviewError(RuntimeError):
    pass


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def sanitized_environment(codex_home: Path, candidate_home: Path) -> dict[str, str]:
    inherited = {
        "PATH",
        "TMPDIR",
        "TMP",
        "TEMP",
        "LANG",
        "TERM",
        "USER",
        "LOGNAME",
        "SSL_CERT_FILE",
        "SSL_CERT_DIR",
        "REQUESTS_CA_BUNDLE",
        "CURL_CA_BUNDLE",
    }
    environment = {key: value for key, value in os.environ.items() if key in inherited}
    environment["CODEX_HOME"] = str(codex_home)
    environment["HOME"] = str(candidate_home)
    return environment


def make_temp(prefix: str) -> Path:
    return Path(tempfile.mkdtemp(prefix=prefix))


def remove_temp(path: Path, expected_prefix: str) -> None:
    temp_root = Path(tempfile.gettempdir()).resolve()
    if path.is_symlink() or path.name.startswith(expected_prefix) is False or path.resolve().parent != temp_root:
        raise ReviewError(f"refusing to remove unexpected temporary path: {path}")
    shutil.rmtree(path)


def create_codex_home() -> Path:
    codex_home = make_temp(TEMP_PREFIXES[1])
    auth_source = Path.home() / ".codex" / "auth.json"
    if auth_source.is_file():
        (codex_home / "auth.json").symlink_to(auth_source)
    return codex_home


def initialize_workspace(workspace: Path) -> None:
    commands = (
        ("git", "init", "--quiet"),
        ("git", "config", "user.email", "review-benchmark.local.invalid"),
        ("git", "config", "user.name", "Blind Review Harness"),
        ("git", "add", "REVIEW_PACKET.md"),
        ("git", "commit", "--quiet", "--message", "Frozen blinded review packet"),
    )
    for command in commands:
        subprocess.run(command, cwd=workspace, capture_output=True, check=True)


def build_command(
    codex_bin: str,
    effort: str,
    workspace: Path,
    final_message: Path,
    candidate_home: Path,
    prompt: str,
) -> list[str]:
    return [
        codex_bin,
        "exec",
        "--ignore-user-config",
        "--ignore-rules",
        "--strict-config",
        "--ephemeral",
        "--json",
        "--color",
        "never",
        "--sandbox",
        "read-only",
        "--cd",
        str(workspace),
        "--output-last-message",
        str(final_message),
        "--model",
        "gpt-5.6-sol",
        "--config",
        f'model_reasoning_effort="{effort}"',
        "--config",
        'service_tier="default"',
        "--config",
        "features.multi_agent=false",
        "--config",
        "features.multi_agent_v2=false",
        "--config",
        "agents.enabled=false",
        "--config",
        "project_doc_max_bytes=0",
        "--config",
        "skills.include_instructions=false",
        "--config",
        "skills.bundled.enabled=false",
        "--config",
        "allow_login_shell=false",
        "--config",
        'shell_environment_policy.inherit="none"',
        "--config",
        f'shell_environment_policy.set.PATH="{TOOL_PATH}"',
        "--config",
        f"shell_environment_policy.set.HOME={json.dumps(str(candidate_home))}",
        prompt,
    ]


def terminate(process: subprocess.Popen[bytes]) -> None:
    if os.name == "posix":
        os.killpg(process.pid, signal.SIGKILL)
    else:
        process.kill()


def parse_usage(raw: bytes) -> dict[str, int | str]:
    terminal: dict[str, Any] | None = None
    for line in raw.decode("utf-8", "strict").splitlines():
        event = json.loads(line)
        if event.get("type") == "turn.completed" and isinstance(event.get("usage"), dict):
            terminal = event["usage"]
    if terminal is None:
        return {key: "unavailable" for key in ("input_tokens", "cached_input_tokens", "output_tokens", "reasoning_tokens")}
    reasoning = terminal.get("reasoning_output_tokens", terminal.get("reasoning_tokens", "unavailable"))
    return {
        "input_tokens": terminal.get("input_tokens", "unavailable"),
        "cached_input_tokens": terminal.get("cached_input_tokens", "unavailable"),
        "output_tokens": terminal.get("output_tokens", "unavailable"),
        "reasoning_tokens": reasoning,
    }


def validate_review(review: Any) -> None:
    if not isinstance(review, dict) or review.get("schema_version") != "sol-blind-review/v1":
        raise ReviewError("review has an invalid schema version")
    if review.get("overall_verdict") not in {"valid", "valid_with_caveats", "invalid"}:
        raise ReviewError("review has an invalid overall verdict")
    if review.get("confidence") not in {"high", "medium", "low"}:
        raise ReviewError("review has invalid confidence")
    for field in ("scenario_audits", "rankings"):
        values = review.get(field)
        if (
            not isinstance(values, list)
            or len(values) != len(REQUIRED_SCENARIOS)
            or {item.get("scenario_id") for item in values if isinstance(item, dict)} != REQUIRED_SCENARIOS
        ):
            raise ReviewError(f"review field {field} must cover every scenario exactly once")
    routing = review.get("routing")
    if (
        not isinstance(routing, list)
        or len(routing) != len(REQUIRED_SCENARIOS)
        or {item.get("workload") for item in routing if isinstance(item, dict)} != REQUIRED_SCENARIOS
    ):
        raise ReviewError("review field routing must cover every workload exactly once")


def write_exclusive(path: Path, content: bytes) -> None:
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o444)
    with os.fdopen(descriptor, "wb") as target:
        target.write(content)
        target.flush()
        os.fsync(target.fileno())


def run_one(effort: str, results_root: Path, codex_bin: str, timeout_seconds: int) -> dict[str, Any]:
    result_dir = results_root / effort
    result_dir.mkdir(parents=True, exist_ok=False)
    final_message = result_dir / "final_message.json"
    workspace = make_temp(TEMP_PREFIXES[0])
    codex_home = create_codex_home()
    candidate_home = make_temp(TEMP_PREFIXES[2])
    started = datetime.now(UTC).isoformat().replace("+00:00", "Z")
    started_monotonic = time.monotonic()
    timed_out = False
    try:
        shutil.copy2(PACKET_PATH, workspace / "REVIEW_PACKET.md")
        (workspace / "REVIEW_PACKET.md").chmod(0o444)
        initialize_workspace(workspace)
        prompt = PROMPT_PATH.read_text(encoding="utf-8")
        command = build_command(codex_bin, effort, workspace, final_message.resolve(), candidate_home, prompt)
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
        except subprocess.TimeoutExpired:
            timed_out = True
            terminate(process)
            stdout, stderr = process.communicate()
        wall_time_ms = round((time.monotonic() - started_monotonic) * 1_000)
        write_exclusive(result_dir / "raw.jsonl", stdout)
        write_exclusive(result_dir / "stderr.txt", stderr)
        validation_error: str | None = None
        parsed_review: dict[str, Any] | None = None
        try:
            parsed = json.loads(final_message.read_text(encoding="utf-8"))
            validate_review(parsed)
            parsed_review = parsed
            write_exclusive(
                result_dir / "review.json",
                (json.dumps(parsed, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode("utf-8"),
            )
        except (OSError, UnicodeDecodeError, json.JSONDecodeError, ReviewError) as error:
            validation_error = (
                f"{error.__class__.__name__}: {error.strerror or 'review output unavailable'}"
                if isinstance(error, OSError)
                else str(error)
            )
        record = {
            "schema_version": "sol-blind-review-record/v1",
            "model": "gpt-5.6-sol",
            "reasoning_effort": effort,
            "service_tier": "default",
            "started_at_utc": started,
            "finished_at_utc": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
            "wall_time_ms": wall_time_ms,
            "exit_code": process.returncode,
            "timed_out": timed_out,
            "packet_sha256": sha256_file(PACKET_PATH),
            "prompt_sha256": sha256_file(PROMPT_PATH),
            "usage": parse_usage(stdout),
            "review_valid": parsed_review is not None,
            "validation_error": validation_error,
        }
        write_exclusive(
            result_dir / "record.json",
            (json.dumps(record, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode("utf-8"),
        )
        return record
    finally:
        remove_temp(candidate_home, TEMP_PREFIXES[2])
        remove_temp(codex_home, TEMP_PREFIXES[1])
        remove_temp(workspace, TEMP_PREFIXES[0])


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run four isolated blinded Sol benchmark reviews.")
    parser.add_argument("--results-dir", type=Path, default=DEFAULT_RESULTS)
    parser.add_argument("--codex-bin", default="codex")
    parser.add_argument("--jobs", type=int, default=4)
    parser.add_argument("--timeout-seconds", type=int, default=900)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.jobs < 1 or args.timeout_seconds < 1:
        raise ReviewError("jobs and timeout must be positive")
    if args.results_dir.exists():
        raise ReviewError(f"results directory already exists: {args.results_dir}")
    args.results_dir.mkdir(parents=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=min(args.jobs, len(EFFORTS))) as executor:
        futures = {
            executor.submit(run_one, effort, args.results_dir.resolve(), args.codex_bin, args.timeout_seconds): effort
            for effort in EFFORTS
        }
        records = []
        for future in concurrent.futures.as_completed(futures):
            effort = futures[future]
            record = future.result()
            records.append(record)
            print(json.dumps({"effort": effort, "review_valid": record["review_valid"], "wall_time_ms": record["wall_time_ms"]}), flush=True)
    summary = {
        "schema_version": "sol-blind-review-batch/v1",
        "packet_sha256": sha256_file(PACKET_PATH),
        "prompt_sha256": sha256_file(PROMPT_PATH),
        "records": sorted(records, key=lambda item: EFFORTS.index(item["reasoning_effort"])),
    }
    write_exclusive(
        args.results_dir / "batch-record.json",
        (json.dumps(summary, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode("utf-8"),
    )
    return 0 if all(record["review_valid"] and record["exit_code"] == 0 for record in records) else 2


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except ReviewError as error:
        print(f"error: {error}", file=os.sys.stderr)
        raise SystemExit(2) from error
