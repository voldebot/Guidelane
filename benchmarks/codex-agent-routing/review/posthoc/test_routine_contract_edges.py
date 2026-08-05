"""Post-hoc diagnostics for contract-defined routine edges."""

from __future__ import annotations

import os
import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path


ZERO_PADDING_LENGTH = 5_000


def candidate_root() -> Path:
    value = os.environ.get("CANDIDATE_WORKSPACE")
    if value:
        return Path(value).resolve()
    if len(sys.argv) == 2 and not sys.argv[1].startswith("-"):
        return Path(sys.argv.pop(1)).resolve()
    raise RuntimeError("set CANDIDATE_WORKSPACE or pass the candidate workspace path")


sys.dont_write_bytecode = True
CANDIDATE_ROOT = candidate_root()
sys.path.insert(0, str(CANDIDATE_ROOT / "src"))

from retry_after import parse_retry_after


class RetryAfterPosthocTests(unittest.TestCase):
    def test_arbitrarily_padded_ascii_decimal_is_a_valid_delay(self) -> None:
        value = "0" * ZERO_PADDING_LENGTH + "42"
        now = datetime(2024, 1, 1, tzinfo=timezone.utc)

        self.assertEqual(parse_retry_after(value, now), 42)


if __name__ == "__main__":
    unittest.main()
