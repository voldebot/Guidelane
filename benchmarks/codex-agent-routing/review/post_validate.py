from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
from typing import Any

from run_sol_reviewers import EFFORTS, REVIEW_ROOT, validate_review


RESULTS_ROOT = REVIEW_ROOT / "results" / "sol-blind-v2"


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write_exclusive(path: Path, value: Any) -> None:
    payload = (json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode("utf-8")
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o444)
    with os.fdopen(descriptor, "wb") as target:
        target.write(payload)
        target.flush()
        os.fsync(target.fileno())


def observed_commands(raw_path: Path) -> list[str]:
    commands: list[str] = []
    for line in raw_path.read_text(encoding="utf-8").splitlines():
        event = json.loads(line)
        item = event.get("item")
        if (
            event.get("type") == "item.completed"
            and isinstance(item, dict)
            and item.get("type") == "command_execution"
            and isinstance(item.get("command"), str)
        ):
            commands.append(item["command"])
    return commands


def main() -> None:
    batch: list[dict[str, Any]] = []
    for effort in EFFORTS:
        result_dir = RESULTS_ROOT / effort
        final_path = result_dir / "final_message.json"
        review = json.loads(final_path.read_text(encoding="utf-8"))
        validate_review(review)
        write_exclusive(result_dir / "review.json", review)
        result = {
            "schema_version": "sol-blind-review-post-validation/v1",
            "reasoning_effort": effort,
            "review_valid_after_validator_fix": True,
            "original_record_preserved": True,
            "original_validation_defect": "The initial validator checked routing.scenario_id, but the frozen prompt schema requires routing.workload.",
            "final_message_sha256": sha256_file(final_path),
            "observed_commands": observed_commands(result_dir / "raw.jsonl"),
        }
        write_exclusive(result_dir / "post-validation.json", result)
        batch.append(result)
    write_exclusive(
        RESULTS_ROOT / "post-validation.json",
        {
            "schema_version": "sol-blind-review-post-validation-batch/v1",
            "all_reviews_valid_after_validator_fix": True,
            "reviews": batch,
        },
    )


if __name__ == "__main__":
    main()
