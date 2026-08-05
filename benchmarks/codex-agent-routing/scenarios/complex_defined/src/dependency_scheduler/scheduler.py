from collections.abc import Sequence
from dataclasses import dataclass

MAX_JOBS = 20


@dataclass(frozen=True, slots=True)
class Job:
    job_id: str
    required_capacity: int
    dependencies: tuple[str, ...] = ()


class ScheduleError(ValueError):
    """Base class for scheduler input errors."""


class InvalidScheduleError(ScheduleError):
    """Raised when the scheduler input violates the public contract."""


class DependencyCycleError(ScheduleError):
    """Raised when jobs remain blocked by a dependency cycle."""

    job_ids: tuple[str, ...]

    def __init__(self, job_ids: tuple[str, ...]) -> None:
        self.job_ids = job_ids
        super().__init__("dependency cycle blocks: " + ", ".join(job_ids))


def schedule_jobs(
    jobs: Sequence[Job],
    capacity: int,
) -> tuple[tuple[str, ...], ...]:
    """Return deterministic capacity-limited execution waves."""
    raise NotImplementedError
