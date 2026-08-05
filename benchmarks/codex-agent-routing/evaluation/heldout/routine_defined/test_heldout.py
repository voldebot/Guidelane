from __future__ import annotations

import os
import sys
import unittest
from datetime import datetime, timedelta, timezone, tzinfo
from pathlib import Path


def candidate_root() -> Path:
    value = os.environ.get("CANDIDATE_WORKSPACE")
    if value:
        return Path(value).resolve()
    if len(sys.argv) == 2 and not sys.argv[1].startswith("-"):
        value = sys.argv.pop(1)
        return Path(value).resolve()
    raise RuntimeError("set CANDIDATE_WORKSPACE or pass the candidate workspace path")


CANDIDATE_ROOT = candidate_root()
sys.path.insert(0, str(CANDIDATE_ROOT / "src"))

from retry_after import MAX_RETRY_AFTER_SECONDS, parse_retry_after


class IndeterminateTimezone(tzinfo):
    def utcoffset(self, value: datetime | None) -> None:
        return None

    def dst(self, value: datetime | None) -> None:
        return None


class RetryAfterHeldoutTests(unittest.TestCase):
    def setUp(self) -> None:
        self.now = datetime(2024, 1, 1, tzinfo=timezone.utc)

    def test_only_space_and_horizontal_tab_are_trimmed(self) -> None:
        for value in ("\n5", "5\r", "\v5\v"):
            with self.subTest(value=repr(value)):
                with self.assertRaises(ValueError):
                    parse_retry_after(value, self.now)

    def test_non_decimal_numeric_spellings_are_rejected(self) -> None:
        for value in ("+5", "-1", "1.0", "1e2", "1_0", "\uff11", "\u00b2"):
            with self.subTest(value=value):
                with self.assertRaises(ValueError):
                    parse_retry_after(value, self.now)

    def test_zero_and_leading_zeroes_are_valid(self) -> None:
        self.assertEqual(parse_retry_after("0", self.now), 0)
        self.assertEqual(parse_retry_after("000000", self.now), 0)

    def test_invalid_date_and_parser_none_result_raise_value_error(self) -> None:
        for value in ("not-a-date", "32 Nov 2024", "Mon"):
            with self.subTest(value=value):
                with self.assertRaises(ValueError):
                    parse_retry_after(value, self.now)

    def test_obsolete_rfc850_date_is_accepted(self) -> None:
        now = datetime(1994, 11, 6, 8, 49, 36, 500_000, tzinfo=timezone.utc)
        self.assertEqual(parse_retry_after("Sunday, 06-Nov-94 08:49:37 GMT", now), 1)

    def test_asctime_date_is_interpreted_as_utc(self) -> None:
        now = datetime(1994, 11, 6, 8, 49, 36, 1, tzinfo=timezone.utc)
        self.assertEqual(parse_retry_after("Sun Nov  6 08:49:37 1994", now), 1)

    def test_explicit_offset_is_converted_to_utc(self) -> None:
        now = datetime(2024, 1, 1, 0, 0, 0, 500_000, tzinfo=timezone.utc)
        self.assertEqual(parse_retry_after("Mon, 01 Jan 2024 02:00:03 +0200", now), 3)

    def test_equal_date_and_past_date_return_zero(self) -> None:
        self.assertEqual(parse_retry_after("Mon, 01 Jan 2024 00:00:00 GMT", self.now), 0)
        later_now = self.now + timedelta(microseconds=1)
        self.assertEqual(parse_retry_after("Mon, 01 Jan 2024 00:00:00 GMT", later_now), 0)

    def test_fractional_positive_difference_uses_mathematical_ceiling(self) -> None:
        now = datetime(2024, 1, 1, 0, 0, 0, 999_999, tzinfo=timezone.utc)
        self.assertEqual(parse_retry_after("Mon, 01 Jan 2024 00:00:01 GMT", now), 1)

    def test_computed_date_bound_is_checked_after_rounding(self) -> None:
        self.assertEqual(
            parse_retry_after("Tue, 02 Jan 2024 00:00:00 GMT", self.now),
            MAX_RETRY_AFTER_SECONDS,
        )
        fractional_now = datetime(2024, 1, 1, 0, 0, 0, 500_000, tzinfo=timezone.utc)
        with self.assertRaises(ValueError):
            parse_retry_after("Tue, 02 Jan 2024 00:00:01 GMT", fractional_now)

    def test_now_with_indeterminate_offset_is_naive(self) -> None:
        now = datetime(2024, 1, 1, tzinfo=IndeterminateTimezone())
        with self.assertRaises(ValueError):
            parse_retry_after("1", now)

    def test_all_non_string_runtime_values_raise_type_error(self) -> None:
        for value in (True, 1, 1.5, b"1", [], {}):
            with self.subTest(type=type(value).__name__):
                with self.assertRaises(TypeError):
                    parse_retry_after(value, self.now)  # type: ignore[arg-type]


if __name__ == "__main__":
    unittest.main()
