from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path


CANDIDATE_ROOT = Path(
    os.environ.get("CANDIDATE_WORKSPACE", Path(__file__).resolve().parents[1])
).resolve()
sys.path.insert(0, str(CANDIDATE_ROOT / "src"))

from dependency_scheduler import (
    DependencyCycleError,
    InvalidScheduleError,
    Job,
    schedule_jobs,
)


class SchedulerPublicTests(unittest.TestCase):
    def test_empty_input_returns_empty_tuple(self) -> None:
        self.assertEqual(schedule_jobs((), 1), ())

    def test_dependencies_advance_only_between_waves(self) -> None:
        jobs = (
            Job("a", 2),
            Job("b", 2),
            Job("c", 4, ("a",)),
            Job("d", 1, ("a",)),
            Job("e", 3, ("b",)),
        )
        self.assertEqual(schedule_jobs(jobs, 4), (("a", "b"), ("d", "e"), ("c",)))

    def test_subset_objectives_are_applied_in_order(self) -> None:
        jobs = (Job("a", 6), Job("b", 5), Job("c", 5), Job("d", 4))
        self.assertEqual(schedule_jobs(jobs, 10), (("a", "d"), ("b", "c")))

        jobs = (Job("a", 4), Job("b", 1), Job("c", 1), Job("d", 2))
        self.assertEqual(schedule_jobs(jobs, 4), (("b", "c", "d"), ("a",)))

    def test_input_order_does_not_break_lexical_ties(self) -> None:
        jobs = [Job("d", 2), Job("c", 3), Job("b", 2), Job("a", 3)]
        expected = (("a", "b"), ("c", "d"))
        self.assertEqual(schedule_jobs(jobs, 5), expected)
        self.assertEqual(schedule_jobs(tuple(reversed(jobs)), 5), expected)

    def test_representative_invalid_inputs_raise_invalid_schedule(self) -> None:
        invalid_cases = [
            ((Job("a", 1),), True),
            ((Job("a", 2),), 1),
            ((Job(" a", 1),), 1),
            ((Job("a", 1), Job("a", 1)), 1),
            ((Job("a", 1, ("missing",)),), 1),
            ((Job("a", 1, ("a",)),), 1),
        ]
        for jobs, capacity in invalid_cases:
            with self.subTest(jobs=jobs, capacity=capacity):
                with self.assertRaises(InvalidScheduleError):
                    schedule_jobs(jobs, capacity)

    def test_cycle_error_reports_kahn_residual(self) -> None:
        jobs = (
            Job("a", 1, ("b",)),
            Job("b", 1, ("a",)),
            Job("blocked", 1, ("a",)),
            Job("free", 1),
        )
        with self.assertRaises(DependencyCycleError) as raised:
            schedule_jobs(jobs, 2)
        self.assertEqual(raised.exception.job_ids, ("a", "b", "blocked"))

    def test_input_sequence_is_not_mutated_and_result_is_immutable(self) -> None:
        jobs = [Job("b", 1), Job("a", 1)]
        snapshot = list(jobs)
        result = schedule_jobs(jobs, 2)
        self.assertEqual(jobs, snapshot)
        self.assertIsInstance(result, tuple)
        self.assertTrue(all(isinstance(wave, tuple) for wave in result))


if __name__ == "__main__":
    unittest.main()
