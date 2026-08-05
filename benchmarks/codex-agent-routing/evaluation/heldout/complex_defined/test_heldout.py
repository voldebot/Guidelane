from __future__ import annotations

import os
import sys
import unittest
from decimal import Decimal
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

from dependency_scheduler import (
    MAX_JOBS,
    DependencyCycleError,
    InvalidScheduleError,
    Job,
    schedule_jobs,
)


class SchedulerHeldoutTests(unittest.TestCase):
    def assert_invalid(self, jobs: object, capacity: object) -> None:
        with self.assertRaises(InvalidScheduleError):
            schedule_jobs(jobs, capacity)  # type: ignore[arg-type]

    def test_every_capacity_validation_class(self) -> None:
        for capacity in (True, False, 0, -1, 1_000_001, 1.0, Decimal("1"), "1", None):
            with self.subTest(capacity=capacity):
                self.assert_invalid((), capacity)

    def test_job_count_and_element_type_validation(self) -> None:
        self.assert_invalid(tuple(Job(f"j{i}", 1) for i in range(MAX_JOBS + 1)), 1)
        self.assert_invalid((Job("a", 1), object()), 1)

    def test_all_job_id_validation_classes(self) -> None:
        cases = (
            (Job("", 1),),
            (Job(" a", 1),),
            (Job("a ", 1),),
            (Job(" ", 1),),
            (Job(1, 1),),
            (Job([], 1),),
            (Job("a", 1), Job("a", 1)),
        )
        for jobs in cases:
            with self.subTest(jobs=jobs):
                self.assert_invalid(jobs, 2)

    def test_all_required_capacity_validation_classes(self) -> None:
        for required in (True, False, 0, -1, 3, 1.5, Decimal("1"), "1", None):
            with self.subTest(required=required):
                self.assert_invalid((Job("a", required),), 2)  # type: ignore[arg-type]

    def test_all_dependency_validation_classes(self) -> None:
        cases = (
            (Job("a", 1, []),),
            (Job("a", 1, ()), Job("b", 1, ("a", "a"))),
            (Job("a", 1, ("",)),),
            (Job("a", 1, (1,)),),
            (Job("a", 1, ([],)),),
            (Job("a", 1, ("a",)),),
            (Job("a", 1, ("missing",)),),
        )
        for jobs in cases:
            with self.subTest(jobs=jobs):
                self.assert_invalid(jobs, 2)

    def test_validation_finishes_before_cycle_detection(self) -> None:
        jobs = (
            Job("a", 1, ("b",)),
            Job("b", 1, ("a",)),
            Job("invalid", 0),
        )
        self.assert_invalid(jobs, 2)

    def test_kahn_residual_includes_transitively_blocked_jobs_only(self) -> None:
        jobs = (
            Job("root", 1),
            Job("done", 1, ("root",)),
            Job("a", 1, ("b",)),
            Job("b", 1, ("c",)),
            Job("c", 1, ("a",)),
            Job("downstream", 1, ("b",)),
        )
        with self.assertRaises(DependencyCycleError) as raised:
            schedule_jobs(jobs, 3)
        self.assertEqual(raised.exception.job_ids, ("a", "b", "c", "downstream"))

    def test_capacity_objective_beats_greedy_largest_first(self) -> None:
        jobs = (Job("a", 8), Job("b", 6), Job("c", 4), Job("d", 3), Job("e", 3))
        self.assertEqual(schedule_jobs(jobs, 12), (("b", "d", "e"), ("a", "c")))

    def test_job_count_objective_precedes_lexical_order(self) -> None:
        jobs = (Job("a", 6), Job("b", 2), Job("c", 2), Job("d", 2))
        self.assertEqual(schedule_jobs(jobs, 6), (("b", "c", "d"), ("a",)))

    def test_lexical_objective_compares_sorted_identifier_tuples(self) -> None:
        jobs = (Job("z", 3), Job("aa", 3), Job("b", 2), Job("c", 2))
        self.assertEqual(schedule_jobs(jobs, 5), (("aa", "b"), ("c", "z")))

    def test_ready_set_is_recomputed_after_each_complete_wave(self) -> None:
        jobs = (
            Job("a", 3),
            Job("b", 2),
            Job("c", 3, ("a",)),
            Job("d", 2, ("b",)),
            Job("e", 5, ("c", "d")),
        )
        self.assertEqual(schedule_jobs(jobs, 5), (("a", "b"), ("c", "d"), ("e",)))

    def test_maximum_bounded_tie_case_is_exact(self) -> None:
        jobs = tuple(Job(f"j{i:02d}", 1) for i in reversed(range(MAX_JOBS)))
        expected = (
            tuple(f"j{i:02d}" for i in range(10)),
            tuple(f"j{i:02d}" for i in range(10, MAX_JOBS)),
        )
        self.assertEqual(schedule_jobs(jobs, 10), expected)

    def test_result_is_independent_of_input_order_and_inputs_stay_unchanged(self) -> None:
        jobs = [
            Job("c", 2, ("a",)),
            Job("a", 2),
            Job("d", 2, ("b",)),
            Job("b", 2),
        ]
        snapshot = list(jobs)
        forward = schedule_jobs(jobs, 4)
        reverse = schedule_jobs(tuple(reversed(jobs)), 4)
        self.assertEqual(forward, (("a", "b"), ("c", "d")))
        self.assertEqual(reverse, forward)
        self.assertEqual(jobs, snapshot)
        self.assertIsInstance(forward, tuple)
        self.assertTrue(all(type(wave) is tuple for wave in forward))


if __name__ == "__main__":
    unittest.main()
