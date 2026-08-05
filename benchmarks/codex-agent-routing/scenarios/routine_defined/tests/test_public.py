from __future__ import annotations

import os
import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path


CANDIDATE_ROOT = Path(
    os.environ.get("CANDIDATE_WORKSPACE", Path(__file__).resolve().parents[1])
).resolve()
sys.path.insert(0, str(CANDIDATE_ROOT / "src"))

from retry_after import MAX_RETRY_AFTER_SECONDS, parse_retry_after


class RetryAfterPublicTests(unittest.TestCase):
    def setUp(self) -> None:
        self.now = datetime(2024, 1, 1, tzinfo=timezone.utc)

    def test_none_and_http_whitespace_are_absent(self) -> None:
        self.assertIsNone(parse_retry_after(None, self.now))
        self.assertIsNone(parse_retry_after(" \t ", self.now))

    def test_ascii_decimal_accepts_padding_and_leading_zeroes(self) -> None:
        self.assertEqual(parse_retry_after("\t 00042 \t", self.now), 42)

    def test_decimal_bounds_are_enforced(self) -> None:
        self.assertEqual(parse_retry_after(str(MAX_RETRY_AFTER_SECONDS), self.now), MAX_RETRY_AFTER_SECONDS)
        with self.assertRaises(ValueError):
            parse_retry_after(str(MAX_RETRY_AFTER_SECONDS + 1), self.now)

    def test_non_ascii_decimal_is_not_delay_seconds(self) -> None:
        with self.assertRaises(ValueError):
            parse_retry_after("\u0661\u0662", self.now)

    def test_imf_fixdate_uses_ceiling_and_utc_instants(self) -> None:
        now = datetime(2024, 1, 1, 0, 0, 0, 250_000, tzinfo=timezone.utc)
        self.assertEqual(parse_retry_after("Mon, 01 Jan 2024 00:00:02 GMT", now), 2)

    def test_past_date_returns_zero(self) -> None:
        self.assertEqual(parse_retry_after("Sun, 31 Dec 2023 23:59:59 GMT", self.now), 0)

    def test_naive_now_precedes_absent_value(self) -> None:
        with self.assertRaises(ValueError):
            parse_retry_after(None, datetime(2024, 1, 1))
        with self.assertRaises(ValueError):
            parse_retry_after("\t", datetime(2024, 1, 1))

    def test_non_string_value_raises_type_error(self) -> None:
        with self.assertRaises(TypeError):
            parse_retry_after(5, self.now)  # type: ignore[arg-type]


if __name__ == "__main__":
    unittest.main()
