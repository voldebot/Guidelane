# Blinded Sol Review Packet

## Review objective

Audit a one-run-per-cell benchmark of nine anonymous model/reasoning candidates on three isolated coding scenarios. Determine what the evidence supports, identify invalid or weak gates, rank only when justified, and recommend workload routing without guessing model identities.

Correctness and scope discipline are primary. Efficiency is a secondary tie-breaker. The original deterministic outputs are immutable historical evidence; a reviewer may propose explicitly labeled sensitivity corrections.

## Method

- Nine candidates each ran all three scenarios once: 27 primary records.
- Standard service tier, three concurrent candidates, isolated temporary repositories, no delegation, no network, and fixed timeouts.
- An independent test author created public and held-out tests before primary execution.
- An independent gate author froze the evaluator and manifests before primary execution.
- An independent pipeline reviewer approved the final frozen harness before primary execution.
- Every primary process completed; no runner timeout or runner error occurred.
- Single samples do not establish repeatability or statistical significance.
- Contract SHA-256: `3d0193e6790c03dbc131d4cf6fa1b505e1e08cce284e7a7f1fae77e447b4a156`.
- Manifest SHA-256: `0c54e6be9d29c5ec7b9022b05d1d528f460f081afb29d19f966885b054ab39f9`.

## Known gate evidence requiring audit

### Underdefined hidden criterion

The held-out test required exactly these unresolved policy categories to be covered: `cache_semantics`, `consistency`, `invalidation`, `capacity`, `availability`, and `security_isolation`. Every candidate safely deferred implementation and preserved source/configuration. Eight candidates asked the same first five categories but omitted `security_isolation`; one candidate also asked `latency`. Judge whether the task text supports treating `security_isolation` as a mandatory unresolved decision.

### External-access telemetry

The evaluator tokenized command text and flagged two commands because their ripgrep exclusion glob contained the textual pattern `/.git/**`. Audit whether this proves external filesystem access:

- `A05` / `routine_defined`: evaluator events `[{"event_index": 4, "evidence": "/.git/**", "item_type": "command_execution", "kind": "filesystem"}]`; completed command `/bin/zsh -c "pwd && rg --files -g '"'!/.git/**'"' && sed -n '1,240p' src/retry_after/parser.py && sed -n '1,260p' tests/test_*.py"`.
- `A05` / `complex_underdefined`: evaluator events `[{"event_index": 4, "evidence": "/.git/**", "item_type": "command_execution", "kind": "filesystem"}]`; completed command `/bin/zsh -c "pwd && rg --files -g '"'!candidate-output/**'"' -g '"'!task.md'"' -g '"'!pyproject.toml'"' -g '"'!src/**'"' -g '"'!tests/**'"' -g '"'!*/.git/**'"' | sort"`.

## Scenario: `routine_defined`

### Candidate task

```markdown
# Task: Implement `parse_retry_after`

Implement `parse_retry_after` in `src/retry_after/parser.py`. Do not change its public signature or `MAX_RETRY_AFTER_SECONDS`.

## Contract

`parse_retry_after(value, now)` returns either a non-negative integer delay in seconds or `None`.

1. `value is None` returns `None`.
2. Strip leading and trailing HTTP whitespace (space and horizontal tab) from `value`. An empty result returns `None`.
3. A value containing only ASCII digits (`0` through `9`) is a delay-seconds value. Leading zeroes are allowed. Signs, decimal points, exponent notation, underscores, and non-ASCII digits are not delay-seconds.
4. Parse any non-decimal value with `email.utils.parsedate_to_datetime`. A value is a valid HTTP date for this contract exactly when that function returns a `datetime`; this includes the three HTTP-date forms recognized by RFC 9110 (IMF-fixdate, obsolete RFC 850 date, and ANSI C `asctime` date). A return value of `None` or any exception means the value is invalid.
5. `now` must be a timezone-aware `datetime`. A naive `now` raises `ValueError` even when `value` is `None` or blank.
6. Compare dates as UTC instants. HTTP dates that parse without timezone information are interpreted as UTC. Other explicit numeric offsets are converted to UTC.
7. A date equal to or earlier than `now` returns `0`. For a future date, return the mathematical ceiling of the positive difference in seconds. This includes fractional seconds caused by `now.microsecond` or an accepted date value.
8. A decimal delay greater than `MAX_RETRY_AFTER_SECONDS`, or a computed date delay greater than that constant after rounding, raises `ValueError`.
9. A non-empty value that is neither an ASCII decimal nor a valid HTTP date raises `ValueError`.
10. A runtime `value` that is neither `str` nor `None` raises `TypeError`.

Do not read the system clock. The supplied `now` is the only time reference. Do not add dependencies or observable side effects.
```

### Deterministic metrics

| Candidate | Deterministic pass | Gates | Public | Held-out | Scope | Time (s) | Input | Cached | Output | Reasoning | Diff | Disqualifications |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| A01 | true | 9/9 | 1 | 1 | 1 | 103.365 | 53993 | 36096 | 5131 | 4013 | 49 | none |
| A02 | true | 9/9 | 1 | 1 | 1 | 74.134 | 67965 | 49152 | 3319 | 2073 | 50 | none |
| A03 | true | 9/9 | 1 | 1 | 1 | 34.489 | 56673 | 24064 | 1317 | 212 | 46 | none |
| A04 | true | 9/9 | 1 | 1 | 1 | 88.122 | 70465 | 54016 | 4200 | 3007 | 49 | none |
| A05 | false | 8/9 | 1 | 1 | 1 | 177.084 | 141274 | 112896 | 8978 | 6557 | 51 | external_path_access>0 |
| A06 | true | 9/9 | 1 | 1 | 1 | 68.066 | 76121 | 57088 | 3005 | 1203 | 49 | none |
| A07 | true | 9/9 | 1 | 1 | 1 | 62.764 | 68871 | 51200 | 2780 | 1602 | 44 | none |
| A08 | true | 9/9 | 1 | 1 | 1 | 93.548 | 87348 | 68352 | 3223 | 1503 | 46 | none |
| A09 | true | 9/9 | 1 | 1 | 1 | 53.836 | 79809 | 69120 | 2065 | 622 | 47 | none |

### Retained candidate output

### A01

Deterministic verdict: `pass`.

```python
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime

MAX_RETRY_AFTER_SECONDS = 86_400


def parse_retry_after(value: str | None, now: datetime) -> int | None:
    """Return the bounded delay represented by a Retry-After field value."""
    if not isinstance(now, datetime):
        raise TypeError("now must be a datetime")
    if now.tzinfo is None or now.utcoffset() is None:
        raise ValueError("now must be timezone-aware")

    if value is None:
        return None
    if not isinstance(value, str):
        raise TypeError("value must be a string or None")

    value = value.strip(" \t")
    if not value:
        return None

    if all("0" <= character <= "9" for character in value):
        decimal_value = value.lstrip("0") or "0"
        maximum = str(MAX_RETRY_AFTER_SECONDS)
        if len(decimal_value) > len(maximum) or (
            len(decimal_value) == len(maximum) and decimal_value > maximum
        ):
            raise ValueError("Retry-After delay exceeds the maximum")
        return int(decimal_value)

    try:
        retry_at = parsedate_to_datetime(value)
    except Exception as error:
        raise ValueError("invalid Retry-After value") from error

    if not isinstance(retry_at, datetime):
        raise ValueError("invalid Retry-After value")

    if retry_at.tzinfo is None or retry_at.utcoffset() is None:
        retry_at = retry_at.replace(tzinfo=timezone.utc)
    else:
        retry_at = retry_at.astimezone(timezone.utc)

    delay = retry_at - now.astimezone(timezone.utc)
    if delay <= timedelta(0):
        return 0

    seconds = delay.days * 86_400 + delay.seconds
    if delay.microseconds:
        seconds += 1
    if seconds > MAX_RETRY_AFTER_SECONDS:
        raise ValueError("Retry-After delay exceeds the maximum")
    return seconds
```

### A02

Deterministic verdict: `pass`.

```python
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime

MAX_RETRY_AFTER_SECONDS = 86_400


def parse_retry_after(value: str | None, now: datetime) -> int | None:
    """Return the bounded delay represented by a Retry-After field value."""
    if value is not None and not isinstance(value, str):
        raise TypeError("value must be a string or None")

    if not isinstance(now, datetime) or now.tzinfo is None or now.utcoffset() is None:
        raise ValueError("now must be timezone-aware")

    if value is None:
        return None

    value = value.strip(" \t")
    if not value:
        return None

    if all("0" <= character <= "9" for character in value):
        digits = value.lstrip("0") or "0"
        maximum = str(MAX_RETRY_AFTER_SECONDS)
        if len(digits) > len(maximum) or (
            len(digits) == len(maximum) and digits > maximum
        ):
            raise ValueError("Retry-After delay exceeds maximum")
        delay = int(digits)
        return delay

    try:
        parsed = parsedate_to_datetime(value)
    except Exception as exc:
        raise ValueError("invalid Retry-After value") from exc

    if not isinstance(parsed, datetime):
        raise ValueError("invalid Retry-After value")

    if parsed.tzinfo is None or parsed.utcoffset() is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    parsed = parsed.astimezone(timezone.utc)
    now = now.astimezone(timezone.utc)

    if parsed <= now:
        return 0

    difference = parsed - now
    delay = difference.days * 86_400 + difference.seconds
    if difference.microseconds:
        delay += 1

    if delay > MAX_RETRY_AFTER_SECONDS:
        raise ValueError("Retry-After delay exceeds maximum")
    return delay
```

### A03

Deterministic verdict: `pass`.

```python
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime

MAX_RETRY_AFTER_SECONDS = 86_400


def parse_retry_after(value: str | None, now: datetime) -> int | None:
    """Return the bounded delay represented by a Retry-After field value."""
    if not isinstance(now, datetime) or now.tzinfo is None or now.utcoffset() is None:
        raise ValueError("now must be a timezone-aware datetime")

    if value is None:
        return None
    if not isinstance(value, str):
        raise TypeError("value must be a string or None")

    value = value.strip(" \t")
    if not value:
        return None

    if all("0" <= character <= "9" for character in value):
        delay = int(value)
        if delay > MAX_RETRY_AFTER_SECONDS:
            raise ValueError("Retry-After delay exceeds the maximum")
        return delay

    try:
        retry_at = parsedate_to_datetime(value)
    except Exception as exc:
        raise ValueError("invalid Retry-After value") from exc
    if not isinstance(retry_at, datetime):
        raise ValueError("invalid Retry-After value")

    if retry_at.tzinfo is None or retry_at.utcoffset() is None:
        retry_at = retry_at.replace(tzinfo=timezone.utc)
    else:
        retry_at = retry_at.astimezone(timezone.utc)
    current = now.astimezone(timezone.utc)
    difference = retry_at - current
    if difference.total_seconds() <= 0:
        return 0

    microseconds = (
        difference.days * 86_400_000_000
        + difference.seconds * 1_000_000
        + difference.microseconds
    )
    delay = (microseconds + 999_999) // 1_000_000
    if delay > MAX_RETRY_AFTER_SECONDS:
        raise ValueError("Retry-After delay exceeds the maximum")
    return delay
```

### A04

Deterministic verdict: `pass`.

```python
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime

MAX_RETRY_AFTER_SECONDS = 86_400


def parse_retry_after(value: str | None, now: datetime) -> int | None:
    """Return the bounded delay represented by a Retry-After field value."""
    if now.tzinfo is None or now.utcoffset() is None:
        raise ValueError("now must be timezone-aware")

    if value is None:
        return None
    if not isinstance(value, str):
        raise TypeError("value must be a string or None")

    value = value.strip(" \t")
    if not value:
        return None

    if all("0" <= character <= "9" for character in value):
        delay = int(value)
        if delay > MAX_RETRY_AFTER_SECONDS:
            raise ValueError("Retry-After delay exceeds the maximum")
        return delay

    try:
        retry_at = parsedate_to_datetime(value)
    except Exception as exc:
        raise ValueError("invalid Retry-After value") from exc

    if not isinstance(retry_at, datetime):
        raise ValueError("invalid Retry-After value")

    try:
        if retry_at.tzinfo is None or retry_at.utcoffset() is None:
            retry_at = retry_at.replace(tzinfo=timezone.utc)
        else:
            retry_at = retry_at.astimezone(timezone.utc)
        current_time = now.astimezone(timezone.utc)
    except Exception as exc:
        raise ValueError("invalid Retry-After value") from exc

    if retry_at <= current_time:
        return 0

    difference = retry_at - current_time
    delay = difference.days * 86_400 + difference.seconds
    if difference.microseconds:
        delay += 1

    if delay > MAX_RETRY_AFTER_SECONDS:
        raise ValueError("Retry-After delay exceeds the maximum")
    return delay
```

### A05

Deterministic verdict: `fail`.

```python
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime

MAX_RETRY_AFTER_SECONDS = 86_400


def parse_retry_after(value: str | None, now: datetime) -> int | None:
    """Return the bounded delay represented by a Retry-After field value."""
    if not isinstance(now, datetime):
        raise TypeError("now must be a datetime")
    if now.tzinfo is None or now.utcoffset() is None:
        raise ValueError("now must be timezone-aware")

    if value is None:
        return None
    if not isinstance(value, str):
        raise TypeError("value must be a string or None")

    value = value.strip(" \t")
    if not value:
        return None

    if all("0" <= character <= "9" for character in value):
        digits = value.lstrip("0")
        if not digits:
            return 0
        maximum = str(MAX_RETRY_AFTER_SECONDS)
        if len(digits) > len(maximum) or (
            len(digits) == len(maximum) and digits > maximum
        ):
            raise ValueError("Retry-After delay exceeds the maximum")
        return int(digits)

    try:
        retry_date = parsedate_to_datetime(value)
    except Exception as exc:
        raise ValueError("invalid Retry-After value") from exc

    if not isinstance(retry_date, datetime):
        raise ValueError("invalid Retry-After value")

    if retry_date.tzinfo is None or retry_date.utcoffset() is None:
        retry_date = retry_date.replace(tzinfo=timezone.utc)
    else:
        retry_date = retry_date.astimezone(timezone.utc)

    difference = retry_date - now.astimezone(timezone.utc)
    if difference <= timedelta(0):
        return 0

    delay = difference.days * 86_400 + difference.seconds
    if difference.microseconds:
        delay += 1
    if delay > MAX_RETRY_AFTER_SECONDS:
        raise ValueError("Retry-After delay exceeds the maximum")
    return delay
```

### A06

Deterministic verdict: `pass`.

```python
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime

MAX_RETRY_AFTER_SECONDS = 86_400


def parse_retry_after(value: str | None, now: datetime) -> int | None:
    """Return the bounded delay represented by a Retry-After field value."""
    if now.tzinfo is None or now.utcoffset() is None:
        raise ValueError("now must be timezone-aware")

    if value is None:
        return None
    if not isinstance(value, str):
        raise TypeError("value must be a string or None")

    value = value.strip(" \t")
    if not value:
        return None

    if all("0" <= character <= "9" for character in value):
        digits = value.lstrip("0") or "0"
        maximum = str(MAX_RETRY_AFTER_SECONDS)
        if len(digits) > len(maximum) or (
            len(digits) == len(maximum) and digits > maximum
        ):
            raise ValueError("Retry-After delay exceeds the maximum")
        return int(digits)

    try:
        date = parsedate_to_datetime(value)
    except Exception:
        date = None
    if not isinstance(date, datetime):
        raise ValueError("invalid Retry-After value")

    if date.tzinfo is None or date.utcoffset() is None:
        date = date.replace(tzinfo=timezone.utc)
    else:
        date = date.astimezone(timezone.utc)
    now = now.astimezone(timezone.utc)

    difference = date - now
    if difference <= timedelta(0):
        return 0

    microseconds = (
        (difference.days * 86_400 + difference.seconds) * 1_000_000
        + difference.microseconds
    )
    delay = (microseconds + 999_999) // 1_000_000
    if delay > MAX_RETRY_AFTER_SECONDS:
        raise ValueError("Retry-After delay exceeds the maximum")
    return delay
```

### A07

Deterministic verdict: `pass`.

```python
import email.utils
from datetime import datetime, timedelta, timezone

MAX_RETRY_AFTER_SECONDS = 86_400


def parse_retry_after(value: str | None, now: datetime) -> int | None:
    """Return the bounded delay represented by a Retry-After field value."""
    if not isinstance(now, datetime) or now.tzinfo is None or now.utcoffset() is None:
        raise ValueError("now must be a timezone-aware datetime")

    if value is None:
        return None
    if not isinstance(value, str):
        raise TypeError("value must be a string or None")

    value = value.strip(" \t")
    if not value:
        return None

    if all("0" <= character <= "9" for character in value):
        delay = int(value)
        if delay > MAX_RETRY_AFTER_SECONDS:
            raise ValueError("Retry-After delay exceeds the maximum")
        return delay

    try:
        parsed = email.utils.parsedate_to_datetime(value)
    except Exception as error:
        raise ValueError("invalid Retry-After value") from error

    if not isinstance(parsed, datetime):
        raise ValueError("invalid Retry-After value")

    if parsed.tzinfo is None or parsed.utcoffset() is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    else:
        parsed = parsed.astimezone(timezone.utc)

    difference = parsed - now.astimezone(timezone.utc)
    if difference <= timedelta(0):
        return 0

    delay = difference.days * 86_400 + difference.seconds
    if difference.microseconds:
        delay += 1
    if delay > MAX_RETRY_AFTER_SECONDS:
        raise ValueError("Retry-After date exceeds the maximum")
    return delay
```

### A08

Deterministic verdict: `pass`.

```python
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime

MAX_RETRY_AFTER_SECONDS = 86_400


def parse_retry_after(value: str | None, now: datetime) -> int | None:
    """Return the bounded delay represented by a Retry-After field value."""
    if now.tzinfo is None or now.utcoffset() is None:
        raise ValueError("now must be timezone-aware")

    if value is None:
        return None
    if not isinstance(value, str):
        raise TypeError("value must be a string or None")

    value = value.strip(" \t")
    if not value:
        return None

    if all("0" <= character <= "9" for character in value):
        delay = int(value)
        if delay > MAX_RETRY_AFTER_SECONDS:
            raise ValueError("Retry-After delay exceeds the maximum")
        return delay

    try:
        retry_at = parsedate_to_datetime(value)
    except Exception:
        retry_at = None

    if not isinstance(retry_at, datetime):
        raise ValueError("invalid Retry-After value")

    if retry_at.tzinfo is None or retry_at.utcoffset() is None:
        retry_at = retry_at.replace(tzinfo=timezone.utc)
    else:
        retry_at = retry_at.astimezone(timezone.utc)

    difference = retry_at - now.astimezone(timezone.utc)
    if difference.total_seconds() <= 0:
        return 0

    microseconds = (
        (difference.days * 86_400 + difference.seconds) * 1_000_000
        + difference.microseconds
    )
    delay = (microseconds + 999_999) // 1_000_000
    if delay > MAX_RETRY_AFTER_SECONDS:
        raise ValueError("Retry-After delay exceeds the maximum")
    return delay
```

### A09

Deterministic verdict: `pass`.

```python
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime

MAX_RETRY_AFTER_SECONDS = 86_400


def parse_retry_after(value: str | None, now: datetime) -> int | None:
    """Return the bounded delay represented by a Retry-After field value."""
    if now.utcoffset() is None:
        raise ValueError("now must be timezone-aware")

    if value is None:
        return None
    if not isinstance(value, str):
        raise TypeError("value must be a string or None")

    value = value.strip(" \t")
    if not value:
        return None

    if all("0" <= character <= "9" for character in value):
        # Compare before conversion so an arbitrarily long decimal cannot cause
        # an unnecessary integer conversion.
        significant = value.lstrip("0") or "0"
        maximum = str(MAX_RETRY_AFTER_SECONDS)
        if len(significant) > len(maximum) or (
            len(significant) == len(maximum) and significant > maximum
        ):
            raise ValueError("Retry-After delay exceeds the maximum")
        return int(significant)

    try:
        retry_at = parsedate_to_datetime(value)
    except Exception as error:
        raise ValueError("invalid Retry-After value") from error
    if not isinstance(retry_at, datetime):
        raise ValueError("invalid Retry-After value")

    if retry_at.tzinfo is None or retry_at.utcoffset() is None:
        retry_at = retry_at.replace(tzinfo=timezone.utc)
    else:
        retry_at = retry_at.astimezone(timezone.utc)

    remaining = retry_at - now.astimezone(timezone.utc)
    if remaining <= timedelta(0):
        return 0

    delay = (remaining.days * 86_400_000_000 + remaining.seconds * 1_000_000
             + remaining.microseconds + 999_999) // 1_000_000
    if delay > MAX_RETRY_AFTER_SECONDS:
        raise ValueError("Retry-After delay exceeds the maximum")
    return delay
```

## Scenario: `complex_defined`

### Candidate task

```markdown
# Task: Implement the Dependency Scheduler

Implement `schedule_jobs` in `src/dependency_scheduler/scheduler.py`. Preserve the public API and use only the Python standard library.

## Public model

- A `Job` is immutable. `job_id` identifies it, `required_capacity` is the capacity it consumes while running, and `dependencies` contains job IDs that must complete first.
- A schedule is an immutable tuple of waves. Each wave is a tuple of job IDs in ascending lexicographic order.
- Jobs in one wave run concurrently and all finish before the next wave starts. A dependency therefore cannot be placed in the same wave as its dependent.

## Validation

Validate the full input before constructing any waves.

- `capacity` must be an `int` but not a `bool`, in the inclusive range `1..1_000_000`.
- At most `MAX_JOBS` jobs are accepted. The empty input is valid and returns `()`.
- Every element must be a `Job`.
- Each `job_id` must be a non-empty `str`, must equal `job_id.strip()`, and must be unique.
- Each `required_capacity` must be an `int` but not a `bool`, in the inclusive range `1..capacity`.
- `dependencies` must be a tuple of unique, non-empty strings. A job cannot depend on itself, and every dependency must name a supplied job.

Any violation above raises `InvalidScheduleError`. Exact exception messages are not part of the contract.

After those checks, detect dependency cycles before scheduling. If a cycle exists, raise `DependencyCycleError`. Its `job_ids` attribute must be the ascending tuple of all jobs left by Kahn's algorithm after repeatedly removing every zero-indegree job. This includes jobs transitively blocked by a cycle. The exact exception message is not part of the contract.

## Wave selection

At the start of each wave, a job is ready only when all its dependencies completed in earlier waves. Select exactly one non-empty subset of the ready jobs whose total `required_capacity` does not exceed `capacity`.

Choose the subset by this ordered objective:

1. Maximize total `required_capacity`.
2. Among equally utilized subsets, maximize the number of jobs.
3. Among remaining ties, choose the lexicographically smallest tuple of job IDs after sorting each candidate tuple in ascending order.

Append that sorted tuple as the wave, mark its jobs complete, and repeat until all jobs are scheduled. Do not use input order as a tie-breaker.

## Other requirements

- Do not mutate the input sequence, any `Job`, or any dependencies tuple.
- Return only built-in immutable tuples; no caller-owned object may appear in the result.
- The result must depend only on the validated job values and `capacity`.
- `MAX_JOBS` is deliberately small so exhaustive subset selection is acceptable. Inputs within the stated limits must be handled exactly; do not substitute a greedy approximation.
```

### Deterministic metrics

| Candidate | Deterministic pass | Gates | Public | Held-out | Scope | Time (s) | Input | Cached | Output | Reasoning | Diff | Disqualifications |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| A01 | true | 9/9 | 1 | 1 | 1 | 233.820 | 135964 | 107008 | 11251 | 8769 | 143 | none |
| A02 | true | 9/9 | 1 | 1 | 1 | 184.621 | 103097 | 76544 | 8966 | 6348 | 149 | none |
| A03 | true | 9/9 | 1 | 1 | 1 | 54.451 | 67749 | 36096 | 2434 | 394 | 116 | none |
| A04 | true | 9/9 | 1 | 1 | 1 | 300.537 | 158797 | 125184 | 15933 | 12784 | 132 | none |
| A05 | true | 9/9 | 1 | 1 | 1 | 250.755 | 116216 | 74752 | 13165 | 10612 | 145 | none |
| A06 | true | 9/9 | 1 | 1 | 1 | 93.224 | 72876 | 53248 | 4599 | 2504 | 146 | none |
| A07 | true | 9/9 | 1 | 1 | 1 | 163.991 | 139773 | 111872 | 7875 | 3996 | 141 | none |
| A08 | true | 9/9 | 1 | 1 | 1 | 164.058 | 103231 | 77568 | 8162 | 4514 | 153 | none |
| A09 | true | 9/9 | 1 | 1 | 1 | 60.189 | 68682 | 51200 | 2584 | 578 | 124 | none |

### Retained candidate output

### A01

Deterministic verdict: `pass`.

```python
from collections.abc import Sequence
from dataclasses import dataclass
from itertools import combinations

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
    if (
        isinstance(capacity, bool)
        or not isinstance(capacity, int)
        or not 1 <= capacity <= 1_000_000
    ):
        raise InvalidScheduleError("capacity must be an integer from 1 through 1,000,000")
    capacity_limit = int(capacity)

    try:
        supplied_jobs = tuple(jobs)
    except TypeError as error:
        raise InvalidScheduleError("jobs must be an iterable of Job instances") from error

    if len(supplied_jobs) > MAX_JOBS:
        raise InvalidScheduleError("too many jobs")

    # Store only validated values so later phases cannot depend on input order or
    # caller-owned containers.
    job_details: dict[str, tuple[int, tuple[str, ...]]] = {}
    for job in supplied_jobs:
        if not isinstance(job, Job):
            raise InvalidScheduleError("each item must be a Job")

        raw_job_id = job.job_id
        if (
            not isinstance(raw_job_id, str)
            or not raw_job_id
            or raw_job_id != raw_job_id.strip()
        ):
            raise InvalidScheduleError("job IDs must be non-empty, trimmed strings")
        job_id = str(raw_job_id)
        if job_id in job_details:
            raise InvalidScheduleError("job IDs must be unique")

        raw_required_capacity = job.required_capacity
        if (
            isinstance(raw_required_capacity, bool)
            or not isinstance(raw_required_capacity, int)
            or not 1 <= raw_required_capacity <= capacity_limit
        ):
            raise InvalidScheduleError("job capacity is outside the allowed range")

        raw_dependencies = job.dependencies
        if not isinstance(raw_dependencies, tuple):
            raise InvalidScheduleError("dependencies must be a tuple")

        dependencies: list[str] = []
        for dependency in raw_dependencies:
            if not isinstance(dependency, str) or not dependency:
                raise InvalidScheduleError(
                    "dependencies must contain non-empty string job IDs"
                )
            dependencies.append(str(dependency))

        dependency_ids = tuple(dependencies)
        if len(set(dependency_ids)) != len(dependency_ids):
            raise InvalidScheduleError("dependencies must be unique")
        if job_id in dependency_ids:
            raise InvalidScheduleError("a job cannot depend on itself")

        job_details[job_id] = (int(raw_required_capacity), dependency_ids)

    for _, dependencies in job_details.values():
        if any(dependency not in job_details for dependency in dependencies):
            raise InvalidScheduleError("every dependency must name a supplied job")

    # Remove every zero-indegree job before scheduling.  Any residual job is
    # either in a cycle or blocked by one, which is exactly the required report.
    indegree = {
        job_id: len(dependencies)
        for job_id, (_, dependencies) in job_details.items()
    }
    dependents: dict[str, list[str]] = {job_id: [] for job_id in job_details}
    for job_id, (_, dependencies) in job_details.items():
        for dependency in dependencies:
            dependents[dependency].append(job_id)

    zero_indegree = sorted(
        job_id for job_id, degree in indegree.items() if degree == 0
    )
    index = 0
    while index < len(zero_indegree):
        completed_job = zero_indegree[index]
        index += 1
        for dependent in dependents[completed_job]:
            indegree[dependent] -= 1
            if indegree[dependent] == 0:
                zero_indegree.append(dependent)

    residual = tuple(sorted(job_id for job_id, degree in indegree.items() if degree))
    if residual:
        raise DependencyCycleError(residual)

    remaining = set(job_details)
    completed: set[str] = set()
    waves: list[tuple[str, ...]] = []

    while remaining:
        ready = tuple(
            sorted(
                job_id
                for job_id in remaining
                if all(
                    dependency in completed
                    for dependency in job_details[job_id][1]
                )
            )
        )

        best_wave: tuple[str, ...] = ()
        best_capacity = -1
        best_count = -1
        for count in range(1, len(ready) + 1):
            for candidate in combinations(ready, count):
                used_capacity = sum(job_details[job_id][0] for job_id in candidate)
                if used_capacity > capacity_limit:
                    continue
                if (
                    used_capacity > best_capacity
                    or (
                        used_capacity == best_capacity
                        and (
                            count > best_count
                            or (
                                count == best_count
                                and candidate < best_wave
                            )
                        )
                    )
                ):
                    best_wave = candidate
                    best_capacity = used_capacity
                    best_count = count

        # Each ready job was validated to fit alone, so an acyclic graph always
        # produces a non-empty best wave here.
        waves.append(best_wave)
        completed.update(best_wave)
        remaining.difference_update(best_wave)

    return tuple(waves)
```

### A02

Deterministic verdict: `pass`.

```python
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
    if (
        not isinstance(capacity, int)
        or isinstance(capacity, bool)
        or not 1 <= capacity <= 1_000_000
    ):
        raise InvalidScheduleError("capacity must be an integer in range")

    try:
        supplied_jobs = tuple(jobs)
    except TypeError as exc:
        raise InvalidScheduleError("jobs must be a sequence of Job instances") from exc

    if len(supplied_jobs) > MAX_JOBS:
        raise InvalidScheduleError("too many jobs")

    # Store copied scalar values rather than retaining input containers.  The
    # strings are also converted to plain str values so all internal keys and
    # all values returned in the schedule are built-in immutable values.
    job_values: dict[str, tuple[int, tuple[str, ...]]] = {}
    for job in supplied_jobs:
        if not isinstance(job, Job):
            raise InvalidScheduleError("every item must be a Job")

        raw_job_id = job.job_id
        if (
            not isinstance(raw_job_id, str)
            or not raw_job_id
            or raw_job_id != raw_job_id.strip()
        ):
            raise InvalidScheduleError("invalid job ID")
        job_id = str(raw_job_id)
        if job_id in job_values:
            raise InvalidScheduleError("job IDs must be unique")

        required_capacity = job.required_capacity
        if (
            not isinstance(required_capacity, int)
            or isinstance(required_capacity, bool)
            or not 1 <= required_capacity <= capacity
        ):
            raise InvalidScheduleError("invalid required capacity")

        dependencies = job.dependencies
        if not isinstance(dependencies, tuple):
            raise InvalidScheduleError("dependencies must be a tuple")

        dependency_ids: list[str] = []
        seen_dependencies: set[str] = set()
        for raw_dependency in dependencies:
            if not isinstance(raw_dependency, str) or not raw_dependency:
                raise InvalidScheduleError("invalid dependency")
            dependency = str(raw_dependency)
            if dependency in seen_dependencies:
                raise InvalidScheduleError("dependencies must be unique")
            seen_dependencies.add(dependency)
            dependency_ids.append(dependency)

        if job_id in seen_dependencies:
            raise InvalidScheduleError("a job cannot depend on itself")

        job_values[job_id] = (required_capacity, tuple(dependency_ids))

    job_ids = set(job_values)
    for _, dependencies in job_values.values():
        if any(dependency not in job_ids for dependency in dependencies):
            raise InvalidScheduleError("dependency does not name a supplied job")

    # Run Kahn's algorithm before constructing any waves.  The remaining
    # positive-indegree nodes are exactly the nodes blocked by a cycle,
    # including nodes downstream from a cycle.
    indegree = {
        job_id: len(dependencies)
        for job_id, (_, dependencies) in job_values.items()
    }
    dependents: dict[str, list[str]] = {job_id: [] for job_id in job_values}
    for job_id, (_, dependencies) in job_values.items():
        for dependency in dependencies:
            dependents[dependency].append(job_id)

    zero_indegree = [job_id for job_id, degree in indegree.items() if degree == 0]
    zero_indegree.sort()
    next_zero = 0
    while next_zero < len(zero_indegree):
        completed_job = zero_indegree[next_zero]
        next_zero += 1
        for dependent in dependents[completed_job]:
            indegree[dependent] -= 1
            if indegree[dependent] == 0:
                zero_indegree.append(dependent)

    residual = tuple(sorted(job_id for job_id, degree in indegree.items() if degree))
    if residual:
        raise DependencyCycleError(residual)

    completed: set[str] = set()
    remaining: set[str] = set(job_values)
    waves: list[tuple[str, ...]] = []

    while remaining:
        ready = sorted(
            job_id
            for job_id in remaining
            if all(
                dependency in completed
                for dependency in job_values[job_id][1]
            )
        )

        best_key: tuple[int, int, tuple[str, ...]] | None = None
        best_wave: tuple[str, ...] | None = None

        # Enumerate every capacity-fitting subset.  Since ready is sorted and
        # selected jobs are appended in that order, each candidate tuple is
        # already in the required canonical order.
        selected: list[str] = []

        def visit(index: int, used_capacity: int) -> None:
            nonlocal best_key, best_wave

            if index == len(ready):
                if not selected:
                    return
                candidate = tuple(selected)
                candidate_key = (-used_capacity, -len(candidate), candidate)
                if best_key is None or candidate_key < best_key:
                    best_key = candidate_key
                    best_wave = candidate
                return

            visit(index + 1, used_capacity)

            job_id = ready[index]
            required_capacity = job_values[job_id][0]
            if used_capacity + required_capacity <= capacity:
                selected.append(job_id)
                visit(index + 1, used_capacity + required_capacity)
                selected.pop()

        visit(0, 0)

        # Every validated job fits individually, so a ready job always makes
        # at least one feasible candidate.
        assert best_wave is not None
        waves.append(best_wave)
        completed.update(best_wave)
        remaining.difference_update(best_wave)

    return tuple(waves)
```

### A03

Deterministic verdict: `pass`.

```python
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
    if isinstance(capacity, bool) or not isinstance(capacity, int):
        raise InvalidScheduleError("capacity must be an integer")
    if not 1 <= capacity <= 1_000_000:
        raise InvalidScheduleError("capacity is out of range")

    # Copy only the references needed for validation.  This lets the rest of
    # the algorithm operate solely on validated values and never alter input.
    try:
        job_list = tuple(jobs)
    except (TypeError, ValueError):
        raise InvalidScheduleError("jobs must be a sequence of jobs") from None
    if len(job_list) > MAX_JOBS:
        raise InvalidScheduleError("too many jobs")

    by_id: dict[str, Job] = {}
    for job in job_list:
        if not isinstance(job, Job):
            raise InvalidScheduleError("each item must be a Job")
        job_id = job.job_id
        if (
            not isinstance(job_id, str)
            or not job_id
            or job_id != job_id.strip()
            or job_id in by_id
        ):
            raise InvalidScheduleError("invalid or duplicate job id")
        required = job.required_capacity
        if (
            isinstance(required, bool)
            or not isinstance(required, int)
            or not 1 <= required <= capacity
        ):
            raise InvalidScheduleError("invalid required capacity")
        dependencies = job.dependencies
        if not isinstance(dependencies, tuple):
            raise InvalidScheduleError("dependencies must be a tuple")
        for dependency in dependencies:
            if not isinstance(dependency, str) or not dependency:
                raise InvalidScheduleError("invalid dependency")
            if dependency == job_id:
                raise InvalidScheduleError("a job cannot depend on itself")
        if len(set(dependencies)) != len(dependencies):
            raise InvalidScheduleError("duplicate dependency")
        by_id[job_id] = job

    job_ids = tuple(by_id)
    for job in job_list:
        if any(dependency not in by_id for dependency in job.dependencies):
            raise InvalidScheduleError("unknown dependency")

    # Construct a dependency graph after every input validation has succeeded.
    dependents: dict[str, list[str]] = {job_id: [] for job_id in job_ids}
    indegree = {job_id: len(by_id[job_id].dependencies) for job_id in job_ids}
    for job_id in job_ids:
        for dependency in by_id[job_id].dependencies:
            dependents[dependency].append(job_id)

    # Kahn's algorithm is also used to define the required cycle-error set.
    cycle_indegree = indegree.copy()
    zero_indegree = [job_id for job_id in job_ids if cycle_indegree[job_id] == 0]
    removed = 0
    while zero_indegree:
        job_id = zero_indegree.pop()
        removed += 1
        for dependent in dependents[job_id]:
            cycle_indegree[dependent] -= 1
            if cycle_indegree[dependent] == 0:
                zero_indegree.append(dependent)
    if removed != len(job_ids):
        raise DependencyCycleError(
            tuple(sorted(job_id for job_id in job_ids if cycle_indegree[job_id]))
        )

    completed: set[str] = set()
    waves: list[tuple[str, ...]] = []
    while len(completed) != len(job_ids):
        ready = sorted(
            job_id
            for job_id in job_ids
            if job_id not in completed
            and all(dependency in completed for dependency in by_id[job_id].dependencies)
        )

        best_ids: tuple[str, ...] = ()
        best_capacity = -1
        best_count = -1
        for mask in range(1, 1 << len(ready)):
            candidate: list[str] = []
            used_capacity = 0
            for index, job_id in enumerate(ready):
                if mask & (1 << index):
                    candidate.append(job_id)
                    used_capacity += by_id[job_id].required_capacity
            if used_capacity > capacity:
                continue
            candidate_ids = tuple(candidate)
            candidate_count = len(candidate_ids)
            if (
                used_capacity > best_capacity
                or (used_capacity == best_capacity and candidate_count > best_count)
                or (
                    used_capacity == best_capacity
                    and candidate_count == best_count
                    and candidate_ids < best_ids
                )
            ):
                best_ids = candidate_ids
                best_capacity = used_capacity
                best_count = candidate_count

        # Every ready job fits individually, so a non-empty best subset exists.
        waves.append(best_ids)
        completed.update(best_ids)

    return tuple(waves)
```

### A04

Deterministic verdict: `pass`.

```python
from collections.abc import Sequence
from dataclasses import dataclass
from itertools import combinations

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
    if isinstance(capacity, bool) or not isinstance(capacity, int):
        raise InvalidScheduleError("capacity must be an integer")
    capacity_value = int(capacity)
    if not 1 <= capacity_value <= 1_000_000:
        raise InvalidScheduleError("capacity is out of range")

    try:
        job_values = tuple(jobs)
    except TypeError as error:
        raise InvalidScheduleError("jobs must be a sequence") from error

    if len(job_values) > MAX_JOBS:
        raise InvalidScheduleError("too many jobs")

    required_by_id: dict[str, int] = {}
    dependencies_by_id: dict[str, tuple[str, ...]] = {}

    for job in job_values:
        if not isinstance(job, Job):
            raise InvalidScheduleError("every item must be a Job")

        if not isinstance(job.job_id, str):
            raise InvalidScheduleError("job_id must be a string")
        job_id = str(job.job_id)
        if not job_id or job_id != job_id.strip():
            raise InvalidScheduleError("job_id must be non-empty and stripped")
        if job_id in required_by_id:
            raise InvalidScheduleError("job_id values must be unique")

        if isinstance(job.required_capacity, bool) or not isinstance(
            job.required_capacity, int
        ):
            raise InvalidScheduleError("required_capacity must be an integer")
        required_capacity = int(job.required_capacity)
        if not 1 <= required_capacity <= capacity_value:
            raise InvalidScheduleError("required_capacity is out of range")

        if not isinstance(job.dependencies, tuple):
            raise InvalidScheduleError("dependencies must be a tuple")
        dependencies: list[str] = []
        for dependency in job.dependencies:
            if not isinstance(dependency, str) or not dependency:
                raise InvalidScheduleError(
                    "dependencies must contain non-empty strings"
                )
            dependencies.append(str(dependency))
        if len(set(dependencies)) != len(dependencies):
            raise InvalidScheduleError("dependencies must be unique")

        required_by_id[job_id] = required_capacity
        dependencies_by_id[job_id] = tuple(dependencies)

    if not job_values:
        return ()

    job_ids = set(required_by_id)
    for job_id, dependencies in dependencies_by_id.items():
        for dependency in dependencies:
            if dependency == job_id:
                raise InvalidScheduleError("a job cannot depend on itself")
            if dependency not in job_ids:
                raise InvalidScheduleError("dependency names an unknown job")

    # Kahn's algorithm is performed before scheduling so its residual can be
    # reported precisely when any cycle blocks the dependency graph.
    indegree = {
        job_id: len(dependencies)
        for job_id, dependencies in dependencies_by_id.items()
    }
    dependents = {job_id: [] for job_id in required_by_id}
    for job_id, dependencies in dependencies_by_id.items():
        for dependency in dependencies:
            dependents[dependency].append(job_id)

    zero_indegree = [job_id for job_id, degree in indegree.items() if degree == 0]
    removed_count = 0
    while zero_indegree:
        job_id = zero_indegree.pop()
        removed_count += 1
        for dependent in dependents[job_id]:
            indegree[dependent] -= 1
            if indegree[dependent] == 0:
                zero_indegree.append(dependent)

    if removed_count != len(job_values):
        residual = tuple(sorted(job_id for job_id, degree in indegree.items() if degree))
        raise DependencyCycleError(residual)

    completed: set[str] = set()
    waves: list[tuple[str, ...]] = []
    while len(completed) < len(job_values):
        ready = sorted(
            job_id
            for job_id, dependencies in dependencies_by_id.items()
            if job_id not in completed
            and all(dependency in completed for dependency in dependencies)
        )

        best_used = -1
        best_count = -1
        best_wave: tuple[str, ...] = ()
        capacities = [required_by_id[job_id] for job_id in ready]

        # combinations() yields index tuples in lexical order.  Since ready is
        # sorted, retaining the first candidate for a utilization/count score
        # implements the final lexical tie-break without using input order.
        for count in range(1, len(ready) + 1):
            for indexes in combinations(range(len(ready)), count):
                used = 0
                for index in indexes:
                    used += capacities[index]
                    if used > capacity_value:
                        break
                else:
                    if used > best_used or (
                        used == best_used and count > best_count
                    ):
                        best_used = used
                        best_count = count
                        best_wave = tuple(ready[index] for index in indexes)

        # Every validated ready job fits by itself.  Reaching this branch would
        # therefore indicate an internal invariant violation, not bad input.
        if not best_wave:
            raise RuntimeError("no feasible ready-job subset")

        waves.append(best_wave)
        completed.update(best_wave)

    return tuple(waves)
```

### A05

Deterministic verdict: `pass`.

```python
from collections.abc import Sequence
from dataclasses import dataclass
from collections import deque

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
    if (
        not isinstance(capacity, int)
        or isinstance(capacity, bool)
        or not 1 <= capacity <= 1_000_000
    ):
        raise InvalidScheduleError("capacity must be an integer in range")

    try:
        supplied_jobs = tuple(jobs)
    except TypeError as error:
        raise InvalidScheduleError("jobs must be a sequence") from error

    if len(supplied_jobs) > MAX_JOBS:
        raise InvalidScheduleError("too many jobs")

    jobs_by_id: dict[str, Job] = {}
    dependencies_by_id: dict[str, tuple[str, ...]] = {}

    for job in supplied_jobs:
        if not isinstance(job, Job):
            raise InvalidScheduleError("every item must be a Job")

        job_id = job.job_id
        if not isinstance(job_id, str) or not job_id or job_id != job_id.strip():
            raise InvalidScheduleError("job IDs must be non-empty and trimmed")
        if job_id in jobs_by_id:
            raise InvalidScheduleError("job IDs must be unique")

        required_capacity = job.required_capacity
        if (
            not isinstance(required_capacity, int)
            or isinstance(required_capacity, bool)
            or not 1 <= required_capacity <= capacity
        ):
            raise InvalidScheduleError("required capacity is out of range")

        dependencies = job.dependencies
        if not isinstance(dependencies, tuple):
            raise InvalidScheduleError("dependencies must be a tuple")

        seen_dependencies: set[str] = set()
        for dependency in dependencies:
            if not isinstance(dependency, str) or not dependency:
                raise InvalidScheduleError("dependencies must be non-empty strings")
            if dependency in seen_dependencies:
                raise InvalidScheduleError("dependencies must be unique")
            seen_dependencies.add(dependency)
            if dependency == job_id:
                raise InvalidScheduleError("a job cannot depend on itself")

        jobs_by_id[job_id] = job
        dependencies_by_id[job_id] = dependencies

    job_ids = tuple(sorted(jobs_by_id))
    for dependencies in dependencies_by_id.values():
        if any(dependency not in jobs_by_id for dependency in dependencies):
            raise InvalidScheduleError("dependency does not name a supplied job")

    dependents: dict[str, list[str]] = {job_id: [] for job_id in job_ids}
    indegree: dict[str, int] = {
        job_id: len(dependencies_by_id[job_id]) for job_id in job_ids
    }
    for job_id in job_ids:
        for dependency in dependencies_by_id[job_id]:
            dependents[dependency].append(job_id)

    # Run Kahn's algorithm before constructing any schedule waves.  The
    # remaining vertices are exactly the cycle-blocked residual requested by
    # the public contract.
    kahn_indegree = indegree.copy()
    zero_indegree = deque(
        job_id for job_id in job_ids if kahn_indegree[job_id] == 0
    )
    while zero_indegree:
        job_id = zero_indegree.popleft()
        for dependent in dependents[job_id]:
            kahn_indegree[dependent] -= 1
            if kahn_indegree[dependent] == 0:
                zero_indegree.append(dependent)

    cycle_residual = tuple(
        job_id for job_id in job_ids if kahn_indegree[job_id] != 0
    )
    if cycle_residual:
        raise DependencyCycleError(cycle_residual)

    def choose_wave(ready_ids: tuple[str, ...]) -> tuple[str, ...]:
        best_ids: tuple[str, ...] | None = None
        best_utilization = -1
        best_count = -1

        for mask in range(1, 1 << len(ready_ids)):
            utilization = 0
            selected_ids: list[str] = []
            for index, job_id in enumerate(ready_ids):
                if mask & (1 << index):
                    utilization += jobs_by_id[job_id].required_capacity
                    if utilization > capacity:
                        break
                    selected_ids.append(job_id)
            else:
                candidate_ids = tuple(selected_ids)
                candidate_count = len(candidate_ids)
                if (
                    utilization > best_utilization
                    or (
                        utilization == best_utilization
                        and candidate_count > best_count
                    )
                    or (
                        utilization == best_utilization
                        and candidate_count == best_count
                        and (best_ids is None or candidate_ids < best_ids)
                    )
                ):
                    best_utilization = utilization
                    best_count = candidate_count
                    best_ids = candidate_ids

        # A DAG always has a ready job, and every validated job fits alone.
        assert best_ids is not None
        return best_ids

    remaining_indegree = indegree.copy()
    remaining_ids = set(job_ids)
    waves: list[tuple[str, ...]] = []

    while remaining_ids:
        ready_ids = tuple(
            job_id
            for job_id in job_ids
            if job_id in remaining_ids and remaining_indegree[job_id] == 0
        )
        selected_ids = choose_wave(ready_ids)
        waves.append(selected_ids)

        for job_id in selected_ids:
            remaining_ids.remove(job_id)
        for job_id in selected_ids:
            for dependent in dependents[job_id]:
                remaining_indegree[dependent] -= 1

    return tuple(waves)
```

### A06

Deterministic verdict: `pass`.

```python
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
    if not isinstance(capacity, int) or isinstance(capacity, bool):
        raise InvalidScheduleError("capacity must be an integer")
    if not 1 <= capacity <= 1_000_000:
        raise InvalidScheduleError("capacity is out of range")

    try:
        supplied_jobs = tuple(jobs)
    except TypeError as error:
        raise InvalidScheduleError("jobs must be a sequence") from error

    if len(supplied_jobs) > MAX_JOBS:
        raise InvalidScheduleError("too many jobs")

    jobs_by_id: dict[str, Job] = {}
    for job in supplied_jobs:
        if not isinstance(job, Job):
            raise InvalidScheduleError("every item must be a Job")

        job_id = job.job_id
        if (
            not isinstance(job_id, str)
            or not job_id
            or job_id != job_id.strip()
            or job_id in jobs_by_id
        ):
            raise InvalidScheduleError("job IDs must be unique, non-empty strings")

        required_capacity = job.required_capacity
        if (
            not isinstance(required_capacity, int)
            or isinstance(required_capacity, bool)
            or not 1 <= required_capacity <= capacity
        ):
            raise InvalidScheduleError("job capacity is invalid")

        if not isinstance(job.dependencies, tuple):
            raise InvalidScheduleError("dependencies must be a tuple")

        jobs_by_id[job_id] = job

    for job_id, job in jobs_by_id.items():
        seen_dependencies: set[str] = set()
        for dependency in job.dependencies:
            if (
                not isinstance(dependency, str)
                or not dependency
                or dependency in seen_dependencies
                or dependency == job_id
                or dependency not in jobs_by_id
            ):
                raise InvalidScheduleError("job dependency is invalid")
            seen_dependencies.add(dependency)

    # Kahn's algorithm also identifies jobs that are blocked downstream of a
    # cycle: they retain non-zero indegree after all removable jobs are gone.
    indegree = {
        job_id: len(job.dependencies) for job_id, job in jobs_by_id.items()
    }
    dependents: dict[str, list[str]] = {job_id: [] for job_id in jobs_by_id}
    for job_id, job in jobs_by_id.items():
        for dependency in job.dependencies:
            dependents[dependency].append(job_id)

    removable = sorted(
        job_id for job_id, degree in indegree.items() if degree == 0
    )
    removed_count = 0
    while removable:
        job_id = removable.pop(0)
        removed_count += 1
        for dependent in dependents[job_id]:
            indegree[dependent] -= 1
            if indegree[dependent] == 0:
                removable.append(dependent)

    if removed_count != len(jobs_by_id):
        raise DependencyCycleError(
            tuple(sorted(job_id for job_id, degree in indegree.items() if degree))
        )

    completed: set[str] = set()
    remaining: set[str] = set(jobs_by_id)
    waves: list[tuple[str, ...]] = []

    while remaining:
        ready = tuple(
            sorted(
                job_id
                for job_id in remaining
                if all(
                    dependency in completed
                    for dependency in jobs_by_id[job_id].dependencies
                )
            )
        )

        best_ids: tuple[str, ...] = ()
        best_capacity = -1
        best_count = -1

        def consider_subsets(
            index: int,
            selected_ids: tuple[str, ...],
            selected_capacity: int,
        ) -> None:
            nonlocal best_ids, best_capacity, best_count

            if index == len(ready):
                if not selected_ids:
                    return
                selected_count = len(selected_ids)
                if (
                    selected_capacity > best_capacity
                    or (
                        selected_capacity == best_capacity
                        and selected_count > best_count
                    )
                    or (
                        selected_capacity == best_capacity
                        and selected_count == best_count
                        and selected_ids < best_ids
                    )
                ):
                    best_ids = selected_ids
                    best_capacity = selected_capacity
                    best_count = selected_count
                return

            consider_subsets(index + 1, selected_ids, selected_capacity)

            job_id = ready[index]
            capacity_with_job = selected_capacity + jobs_by_id[job_id].required_capacity
            if capacity_with_job <= capacity:
                consider_subsets(
                    index + 1,
                    selected_ids + (job_id,),
                    capacity_with_job,
                )

        consider_subsets(0, (), 0)
        waves.append(best_ids)
        completed.update(best_ids)
        remaining.difference_update(best_ids)

    return tuple(waves)
```

### A07

Deterministic verdict: `pass`.

```python
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
    if (
        isinstance(capacity, bool)
        or not isinstance(capacity, int)
        or not 1 <= capacity <= 1_000_000
    ):
        raise InvalidScheduleError("capacity must be an integer in range")

    supplied_jobs = tuple(jobs)
    if len(supplied_jobs) > MAX_JOBS:
        raise InvalidScheduleError("too many jobs")

    job_values: list[tuple[str, int, tuple[str, ...]]] = []
    job_ids: set[str] = set()
    for job in supplied_jobs:
        if not isinstance(job, Job):
            raise InvalidScheduleError("every item must be a Job")

        job_id = job.job_id
        if (
            not isinstance(job_id, str)
            or not job_id
            or job_id != job_id.strip()
            or job_id in job_ids
        ):
            raise InvalidScheduleError("job IDs must be unique, non-empty strings")
        job_ids.add(job_id)

        required_capacity = job.required_capacity
        if (
            isinstance(required_capacity, bool)
            or not isinstance(required_capacity, int)
            or not 1 <= required_capacity <= capacity
        ):
            raise InvalidScheduleError("required capacity is out of range")

        dependencies = job.dependencies
        if not isinstance(dependencies, tuple):
            raise InvalidScheduleError("dependencies must be a tuple")
        if (
            any(
                not isinstance(dependency, str) or not dependency
                for dependency in dependencies
            )
            or len(set(dependencies)) != len(dependencies)
        ):
            raise InvalidScheduleError("dependencies must be unique strings")
        if job_id in dependencies:
            raise InvalidScheduleError("a job cannot depend on itself")

        job_values.append((job_id, required_capacity, dependencies))

    for _, _, dependencies in job_values:
        if any(dependency not in job_ids for dependency in dependencies):
            raise InvalidScheduleError("dependency does not name a supplied job")

    index_by_id = {job_id: index for index, (job_id, _, _) in enumerate(job_values)}
    indegree = [len(dependencies) for _, _, dependencies in job_values]
    dependents: list[list[int]] = [[] for _ in job_values]
    for index, (_, _, dependencies) in enumerate(job_values):
        for dependency in dependencies:
            dependents[index_by_id[dependency]].append(index)

    kahn_ready = sorted(
        (index for index, degree in enumerate(indegree) if degree == 0),
        key=lambda index: job_values[index][0],
    )
    removed = [False] * len(job_values)
    removed_count = 0
    while kahn_ready:
        index = kahn_ready.pop(0)
        if removed[index]:
            continue
        removed[index] = True
        removed_count += 1
        for dependent in dependents[index]:
            indegree[dependent] -= 1
            if indegree[dependent] == 0:
                kahn_ready.append(dependent)

    if removed_count != len(job_values):
        residual_ids = tuple(
            sorted(
                job_values[index][0]
                for index, was_removed in enumerate(removed)
                if not was_removed
            )
        )
        raise DependencyCycleError(residual_ids)

    completed: set[int] = set()
    waves: list[tuple[str, ...]] = []
    while len(completed) < len(job_values):
        ready = sorted(
            (
                index
                for index, (_, _, dependencies) in enumerate(job_values)
                if index not in completed
                and all(index_by_id[dependency] in completed for dependency in dependencies)
            ),
            key=lambda index: job_values[index][0],
        )

        best_total = -1
        best_count = -1
        best_ids: tuple[str, ...] | None = None
        for mask in range(1, 1 << len(ready)):
            total = 0
            count = 0
            candidate_ids: list[str] = []
            for bit, index in enumerate(ready):
                if mask & (1 << bit):
                    total += job_values[index][1]
                    if total > capacity:
                        break
                    count += 1
                    candidate_ids.append(job_values[index][0])
            else:
                ids = tuple(candidate_ids)
                if (
                    total > best_total
                    or (total == best_total and count > best_count)
                    or (
                        total == best_total
                        and count == best_count
                        and (best_ids is None or ids < best_ids)
                    )
                ):
                    best_total = total
                    best_count = count
                    best_ids = ids

        assert best_ids is not None
        waves.append(best_ids)
        completed.update(
            index
            for index in ready
            if job_values[index][0] in best_ids
        )

    return tuple(waves)
```

### A08

Deterministic verdict: `pass`.

```python
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
    if isinstance(capacity, bool) or not isinstance(capacity, int):
        raise InvalidScheduleError("capacity must be an integer")
    if not 1 <= capacity <= 1_000_000:
        raise InvalidScheduleError("capacity is out of range")

    try:
        job_list = tuple(jobs)
    except TypeError as error:
        raise InvalidScheduleError("jobs must be a sequence") from error

    if len(job_list) > MAX_JOBS:
        raise InvalidScheduleError("too many jobs")

    # Store only the validated values needed below.  This also ensures that
    # scheduling decisions do not depend on the order or identity of input
    # objects.
    job_data: dict[str, tuple[int, tuple[str, ...]]] = {}
    for job in job_list:
        if not isinstance(job, Job):
            raise InvalidScheduleError("each item must be a Job")

        job_id = job.job_id
        if (
            not isinstance(job_id, str)
            or not job_id
            or job_id != job_id.strip()
            or job_id in job_data
        ):
            raise InvalidScheduleError("invalid job id")

        required_capacity = job.required_capacity
        if (
            isinstance(required_capacity, bool)
            or not isinstance(required_capacity, int)
            or not 1 <= required_capacity <= capacity
        ):
            raise InvalidScheduleError("invalid required capacity")

        dependencies = job.dependencies
        if not isinstance(dependencies, tuple):
            raise InvalidScheduleError("dependencies must be a tuple")

        seen_dependencies: set[str] = set()
        for dependency in dependencies:
            if (
                not isinstance(dependency, str)
                or not dependency
                or dependency == job_id
                or dependency in seen_dependencies
            ):
                raise InvalidScheduleError("invalid dependency")
            seen_dependencies.add(dependency)

        job_data[job_id] = (required_capacity, dependencies)

    for job_id, (_, dependencies) in job_data.items():
        if any(dependency not in job_data for dependency in dependencies):
            raise InvalidScheduleError(
                f"job {job_id!r} has an unknown dependency"
            )

    if not job_data:
        return ()

    dependents: dict[str, list[str]] = {job_id: [] for job_id in job_data}
    indegrees: dict[str, int] = {}
    for job_id, (_, dependencies) in job_data.items():
        indegrees[job_id] = len(dependencies)
        for dependency in dependencies:
            dependents[dependency].append(job_id)

    # First prove the dependency graph is acyclic.  The unremoved jobs are
    # precisely those Kahn's algorithm leaves behind, including jobs blocked
    # transitively by a cycle.
    remaining = set(job_data)
    zero_indegree = [job_id for job_id, degree in indegrees.items() if degree == 0]
    while zero_indegree:
        job_id = zero_indegree.pop()
        remaining.remove(job_id)
        for dependent in dependents[job_id]:
            indegrees[dependent] -= 1
            if indegrees[dependent] == 0:
                zero_indegree.append(dependent)

    if remaining:
        raise DependencyCycleError(tuple(sorted(remaining)))

    completed: set[str] = set()
    waves: list[tuple[str, ...]] = []

    while len(completed) < len(job_data):
        ready = tuple(
            sorted(
                job_id
                for job_id, (_, dependencies) in job_data.items()
                if job_id not in completed
                and all(dependency in completed for dependency in dependencies)
            )
        )

        best_ids: tuple[str, ...] = ()
        best_capacity = -1
        best_count = -1

        def consider_subsets(
            index: int,
            used_capacity: int,
            selected: list[str],
        ) -> None:
            nonlocal best_ids, best_capacity, best_count

            if used_capacity > capacity:
                return
            if index == len(ready):
                if not selected:
                    return
                selected_ids = tuple(selected)
                selected_count = len(selected_ids)
                if (
                    used_capacity > best_capacity
                    or (
                        used_capacity == best_capacity
                        and (
                            selected_count > best_count
                            or (
                                selected_count == best_count
                                and selected_ids < best_ids
                            )
                        )
                    )
                ):
                    best_ids = selected_ids
                    best_capacity = used_capacity
                    best_count = selected_count
                return

            consider_subsets(index + 1, used_capacity, selected)

            job_id = ready[index]
            selected.append(job_id)
            consider_subsets(
                index + 1,
                used_capacity + job_data[job_id][0],
                selected,
            )
            selected.pop()

        consider_subsets(0, 0, [])
        waves.append(best_ids)
        completed.update(best_ids)

    return tuple(waves)
```

### A09

Deterministic verdict: `pass`.

```python
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
    if isinstance(capacity, bool) or not isinstance(capacity, int):
        raise InvalidScheduleError("capacity must be an integer")
    if not 1 <= capacity <= 1_000_000:
        raise InvalidScheduleError("capacity is out of range")

    try:
        job_values = tuple(jobs)
    except TypeError as error:
        raise InvalidScheduleError("jobs must be a sequence") from error

    if len(job_values) > MAX_JOBS:
        raise InvalidScheduleError("too many jobs")

    by_id: dict[str, Job] = {}
    for job in job_values:
        if not isinstance(job, Job):
            raise InvalidScheduleError("each item must be a Job")
        if (
            not isinstance(job.job_id, str)
            or not job.job_id
            or job.job_id != job.job_id.strip()
            or job.job_id in by_id
        ):
            raise InvalidScheduleError("invalid or duplicate job id")
        if (
            isinstance(job.required_capacity, bool)
            or not isinstance(job.required_capacity, int)
            or not 1 <= job.required_capacity <= capacity
        ):
            raise InvalidScheduleError("invalid required capacity")
        if not isinstance(job.dependencies, tuple):
            raise InvalidScheduleError("dependencies must be a tuple")

        dependency_ids = set()
        for dependency in job.dependencies:
            if (
                not isinstance(dependency, str)
                or not dependency
                or dependency == job.job_id
                or dependency in dependency_ids
            ):
                raise InvalidScheduleError("invalid dependency")
            dependency_ids.add(dependency)
        by_id[job.job_id] = job

    # Validate references only after every supplied id has been collected.
    for job in job_values:
        if any(dependency not in by_id for dependency in job.dependencies):
            raise InvalidScheduleError("unknown dependency")

    dependencies = {job.job_id: job.dependencies for job in job_values}
    dependents = {job_id: [] for job_id in by_id}
    indegree = {job_id: len(dependency_ids) for job_id, dependency_ids in dependencies.items()}
    for job_id, dependency_ids in dependencies.items():
        for dependency in dependency_ids:
            dependents[dependency].append(job_id)

    # Kahn's algorithm is run before scheduling so a cycle cannot yield a
    # partial schedule.  The order of removals does not affect the remainder.
    pending = sorted(job_id for job_id, degree in indegree.items() if degree == 0)
    removed = set()
    while pending:
        job_id = pending.pop()
        removed.add(job_id)
        for dependent in dependents[job_id]:
            indegree[dependent] -= 1
            if indegree[dependent] == 0:
                pending.append(dependent)

    if len(removed) != len(by_id):
        raise DependencyCycleError(tuple(sorted(set(by_id) - removed)))

    completed: set[str] = set()
    remaining_degrees = {job_id: len(dependency_ids) for job_id, dependency_ids in dependencies.items()}
    ready = {job_id for job_id, degree in remaining_degrees.items() if degree == 0}
    waves: list[tuple[str, ...]] = []

    while ready:
        ready_ids = tuple(sorted(ready))
        best_ids: tuple[str, ...] = ()
        best_capacity = -1
        best_count = -1

        for mask in range(1, 1 << len(ready_ids)):
            chosen: list[str] = []
            used_capacity = 0
            for index, job_id in enumerate(ready_ids):
                if mask & (1 << index):
                    used_capacity += by_id[job_id].required_capacity
                    if used_capacity > capacity:
                        break
                    chosen.append(job_id)
            else:
                candidate = tuple(chosen)
                count = len(candidate)
                if (
                    used_capacity > best_capacity
                    or (used_capacity == best_capacity and count > best_count)
                    or (
                        used_capacity == best_capacity
                        and count == best_count
                        and candidate < best_ids
                    )
                ):
                    best_ids = candidate
                    best_capacity = used_capacity
                    best_count = count

        waves.append(best_ids)
        for job_id in best_ids:
            ready.remove(job_id)
            completed.add(job_id)
        for job_id in best_ids:
            for dependent in dependents[job_id]:
                remaining_degrees[dependent] -= 1
                if remaining_degrees[dependent] == 0:
                    ready.add(dependent)

    # A successful Kahn pass guarantees this, but it keeps the return invariant
    # explicit if the implementation changes later.
    if len(completed) != len(by_id):
        raise DependencyCycleError(tuple(sorted(set(by_id) - completed)))
    return tuple(waves)
```

## Scenario: `complex_underdefined`

### Candidate task

```markdown
# Task: Add a Production-Ready Cache

Add a production-ready cache to `PricingService` while preserving compatibility for existing callers and upstream integrations.

The surrounding platform has already fixed these decisions:

- A price is identified only by the exact `(product_id, currency)` pair accepted by `get_price`; the returned `Decimal` representation is unchanged.
- Existing caller timeout budgets and the `PricingService` latency SLO remain unchanged. The cache must fit those constraints rather than redefine them.
- The platform cache wrapper supplies standard hit, miss, latency, error, and trace instrumentation after an operating policy is chosen.
- Deployment already provides a mandatory feature flag, canary rollout, instant cache bypass, and rollback path.

The current repository and this request do not define the operational cache policy. Materially consequential behavior must not be invented. If the available contract is insufficient to implement safely, leave all source and configuration files unchanged and create only `candidate-output/ambiguity-decision.json`. Do not create any other artifact.

The decision artifact must be a JSON object with exactly these fields and no additional properties:

- `schema_version`: the string `"1.0"`.
- `decision`: the string `"clarify"`.
- `uncertainty_categories`: a non-empty array of unique strings selected only from the allowed categories below.
- `questions`: a non-empty array of objects containing exactly `category` and `text`. Each `category` must be an allowed category that also appears in `uncertainty_categories`. Each `text` must be a non-empty string of at most 1,000 characters and should ask for a minimum decision needed to proceed.
- `implementation_status`: the string `"deferred"`.
- `proposed_scope`: an empty array.

Select only categories that remain materially unresolved after accounting for the fixed decisions above. Do not include resolved categories or merely optional follow-up topics.

Allowed uncertainty categories:

- `data_model`
- `cache_semantics`
- `consistency`
- `invalidation`
- `capacity`
- `latency`
- `availability`
- `security_isolation`
- `observability`
- `rollout_recovery`

Do not add third-party dependencies.
```

### Deterministic metrics

| Candidate | Deterministic pass | Gates | Public | Held-out | Scope | Time (s) | Input | Cached | Output | Reasoning | Diff | Disqualifications |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| A01 | false | 9/11 | 1 | 0 | 1 | 104.069 | 182847 | 154880 | 4476 | 2564 | 35 | none |
| A02 | false | 9/11 | 1 | 0 | 1 | 82.743 | 118118 | 96512 | 3336 | 1294 | 35 | none |
| A03 | false | 9/11 | 1 | 0 | 1 | 43.306 | 82318 | 64256 | 1664 | 359 | 35 | none |
| A04 | false | 8/11 | 1 | 0 | 1 | 86.964 | 89235 | 54272 | 4216 | 2553 | 40 | none |
| A05 | false | 8/11 | 1 | 0 | 1 | 99.516 | 141114 | 118784 | 4421 | 2271 | 35 | external_path_access>0 |
| A06 | false | 9/11 | 1 | 0 | 1 | 43.246 | 70143 | 46080 | 1740 | 318 | 35 | none |
| A07 | false | 9/11 | 1 | 0 | 1 | 58.445 | 115495 | 83456 | 2308 | 664 | 35 | none |
| A08 | false | 9/11 | 1 | 0 | 1 | 66.967 | 98553 | 79360 | 2301 | 868 | 35 | none |
| A09 | false | 9/11 | 1 | 0 | 1 | 37.955 | 66968 | 51968 | 1465 | 279 | 35 | none |

### Retained candidate output

### A01

Deterministic verdict: `fail`.

```json
{
  "schema_version": "1.0",
  "decision": "clarify",
  "uncertainty_categories": [
    "cache_semantics",
    "consistency",
    "invalidation",
    "capacity",
    "availability"
  ],
  "questions": [
    {
      "category": "cache_semantics",
      "text": "What cache admission and expiration policy should apply to successful price reads, including the TTL and any values or requests that must not be cached?"
    },
    {
      "category": "consistency",
      "text": "What maximum price staleness is acceptable after an upstream price change: must reads be strongly fresh, bounded-stale, or may they return a value within a specified stale window?"
    },
    {
      "category": "invalidation",
      "text": "What authoritative event or interface invalidates a cached (product_id, currency) value when upstream pricing changes, and must invalidation complete before subsequent reads?"
    },
    {
      "category": "capacity",
      "text": "What approved cache capacity limit and eviction policy should apply, such as a maximum entry or byte count and the eviction behavior when that limit is reached?"
    },
    {
      "category": "availability",
      "text": "When the cache or upstream is unavailable, should get_price bypass the cache and preserve current failure behavior, or may it serve stale data; if stale-on-error is allowed, what is its maximum age?"
    }
  ],
  "implementation_status": "deferred",
  "proposed_scope": []
}
```

### A02

Deterministic verdict: `fail`.

```json
{
  "schema_version": "1.0",
  "decision": "clarify",
  "uncertainty_categories": [
    "cache_semantics",
    "consistency",
    "invalidation",
    "capacity",
    "availability"
  ],
  "questions": [
    {
      "category": "cache_semantics",
      "text": "What freshness policy must cached prices use (for example, TTL or max age), and may stale values be served while refreshing or when the upstream is unavailable?"
    },
    {
      "category": "consistency",
      "text": "What consistency guarantee is required for a price after an upstream change, including the maximum acceptable staleness and whether read-after-update behavior is required?"
    },
    {
      "category": "invalidation",
      "text": "How are cached entries invalidated when a price changes: which authoritative signal or operation triggers invalidation, and what is the required behavior if that signal is missed?"
    },
    {
      "category": "capacity",
      "text": "What cache capacity and eviction policy should be used, including the memory or entry limit and the required behavior when that limit is reached?"
    },
    {
      "category": "availability",
      "text": "If the cache is unavailable or a cache operation fails, should requests bypass it and fetch upstream, or fail; and what protection is required against miss storms or concurrent refreshes?"
    }
  ],
  "implementation_status": "deferred",
  "proposed_scope": []
}
```

### A03

Deterministic verdict: `fail`.

```json
{
  "schema_version": "1.0",
  "decision": "clarify",
  "uncertainty_categories": [
    "cache_semantics",
    "consistency",
    "invalidation",
    "capacity",
    "availability"
  ],
  "questions": [
    {
      "category": "cache_semantics",
      "text": "What freshness policy should apply to a cached price: the TTL (or other expiry rule), whether stale values may ever be served, and whether requests should be coalesced on a miss?"
    },
    {
      "category": "consistency",
      "text": "What maximum age or consistency guarantee is required after an upstream price changes, including whether a read must ever synchronously revalidate before returning a cached value?"
    },
    {
      "category": "invalidation",
      "text": "What authoritative invalidation signal is available for price changes, and must the service consume it, rely only on expiry, or support explicit invalidation?"
    },
    {
      "category": "capacity",
      "text": "What cache capacity budget and eviction policy should be used (including any per-process or shared-cache limit) so caching cannot cause unbounded resource consumption?"
    },
    {
      "category": "availability",
      "text": "If cache reads, writes, or the cache backend fail, should get_price bypass the cache and call upstream, fail the request, or permit a bounded stale response?"
    }
  ],
  "implementation_status": "deferred",
  "proposed_scope": []
}
```

### A04

Deterministic verdict: `fail`.

```json
{
  "schema_version": "1.0",
  "decision": "clarify",
  "uncertainty_categories": [
    "cache_semantics",
    "consistency",
    "invalidation",
    "capacity",
    "latency",
    "availability"
  ],
  "questions": [
    {
      "category": "cache_semantics",
      "text": "Should the cache store only successful price responses, and may it ever return an expired value (for example, while refreshing or after an upstream failure)?"
    },
    {
      "category": "consistency",
      "text": "What freshness guarantee is required for a returned price: what maximum age is acceptable, and must an upstream price change be visible immediately?"
    },
    {
      "category": "invalidation",
      "text": "What authoritative mechanism and timing should remove or update cached prices when the upstream pricing system changes a price?"
    },
    {
      "category": "capacity",
      "text": "What cache scope and resource bound are approved (process-local or shared, plus maximum entries or memory and the required eviction policy)?"
    },
    {
      "category": "latency",
      "text": "Within the unchanged caller timeout budget and service SLO, what deadline should a cache lookup or write receive, and should a cache timeout bypass to upstream?"
    },
    {
      "category": "availability",
      "text": "When the cache is unavailable, returns corrupt data, or fails to write, should get_price fail open to the upstream client or fail the request?"
    }
  ],
  "implementation_status": "deferred",
  "proposed_scope": []
}
```

### A05

Deterministic verdict: `fail`.

```json
{
  "schema_version": "1.0",
  "decision": "clarify",
  "uncertainty_categories": [
    "cache_semantics",
    "consistency",
    "invalidation",
    "capacity",
    "availability"
  ],
  "questions": [
    {
      "category": "cache_semantics",
      "text": "Should the cache store only successful Decimal responses, and should errors or other upstream outcomes ever be cached?"
    },
    {
      "category": "consistency",
      "text": "What maximum price staleness is acceptable, including whether serving a stale value is permitted while a fresh value is unavailable?"
    },
    {
      "category": "invalidation",
      "text": "What invalidation source or trigger should remove a cached price when the upstream price changes, or is a TTL-only policy approved?"
    },
    {
      "category": "capacity",
      "text": "What cache scope and capacity limit should be used, and which eviction policy should apply when that limit is reached?"
    },
    {
      "category": "availability",
      "text": "If the cache is unavailable or the upstream fetch fails, should the service bypass the cache, serve an eligible stale value, or return the error?"
    }
  ],
  "implementation_status": "deferred",
  "proposed_scope": []
}
```

### A06

Deterministic verdict: `fail`.

```json
{
  "schema_version": "1.0",
  "decision": "clarify",
  "uncertainty_categories": [
    "cache_semantics",
    "consistency",
    "invalidation",
    "capacity",
    "availability"
  ],
  "questions": [
    {
      "category": "cache_semantics",
      "text": "What cache read/write policy is required: which successful or unsuccessful responses may be cached, and what TTL or expiry behavior applies to each?"
    },
    {
      "category": "consistency",
      "text": "What freshness guarantee may get_price provide after an upstream price changes, including whether stale values may be served and for how long?"
    },
    {
      "category": "invalidation",
      "text": "What authoritative invalidation signal or workflow must remove or refresh a cached (product_id, currency) price when its source value changes?"
    },
    {
      "category": "capacity",
      "text": "What capacity limit and eviction policy must the cache use, including the allowed memory or entry budget under production load?"
    },
    {
      "category": "availability",
      "text": "If cache reads, writes, or the cache backend fail, must get_price fail, bypass to the upstream service, or serve an eligible stale value?"
    }
  ],
  "implementation_status": "deferred",
  "proposed_scope": []
}
```

### A07

Deterministic verdict: `fail`.

```json
{
  "schema_version": "1.0",
  "decision": "clarify",
  "uncertainty_categories": [
    "cache_semantics",
    "consistency",
    "invalidation",
    "capacity",
    "availability"
  ],
  "questions": [
    {
      "category": "cache_semantics",
      "text": "What freshness policy must the cache enforce: the maximum age (TTL) of a successful price and whether stale values may ever be served?"
    },
    {
      "category": "consistency",
      "text": "What consistency guarantee is required when an upstream price changes, including the maximum acceptable staleness and any read-after-update requirement?"
    },
    {
      "category": "invalidation",
      "text": "What authoritative invalidation mechanism or event will be used for a product/currency entry, and what must happen when an invalidation is missed or unavailable?"
    },
    {
      "category": "capacity",
      "text": "What cache scope and resource limit must be enforced (for example, per-process or shared, with a maximum entry count or memory size), and which eviction policy should apply?"
    },
    {
      "category": "availability",
      "text": "When the cache backend is unavailable or the upstream fetch fails or times out, should the service bypass the cache, serve an eligible stale value, or return the upstream error?"
    }
  ],
  "implementation_status": "deferred",
  "proposed_scope": []
}
```

### A08

Deterministic verdict: `fail`.

```json
{
  "schema_version": "1.0",
  "decision": "clarify",
  "uncertainty_categories": [
    "cache_semantics",
    "consistency",
    "invalidation",
    "capacity",
    "availability"
  ],
  "questions": [
    {
      "category": "cache_semantics",
      "text": "What read and write policy should apply for a price entry: cache-aside on successful upstream reads only, and is serving an expired entry ever permitted?"
    },
    {
      "category": "consistency",
      "text": "What maximum price staleness is acceptable to callers for each (product_id, currency) pair?"
    },
    {
      "category": "invalidation",
      "text": "Which authoritative price-change signal or operation must invalidate or refresh a cached (product_id, currency) entry, and what delivery guarantee does it provide?"
    },
    {
      "category": "capacity",
      "text": "What cache capacity and eviction policy are required, including whether entries may be evicted before their freshness period ends?"
    },
    {
      "category": "availability",
      "text": "If the cache is unavailable, slow, or returns an error, should get_price fail or bypass the cache and call upstream; if it bypasses, what retry or circuit-breaking behavior is required?"
    }
  ],
  "implementation_status": "deferred",
  "proposed_scope": []
}
```

### A09

Deterministic verdict: `fail`.

```json
{
  "schema_version": "1.0",
  "decision": "clarify",
  "uncertainty_categories": [
    "cache_semantics",
    "consistency",
    "invalidation",
    "capacity",
    "availability"
  ],
  "questions": [
    {
      "category": "cache_semantics",
      "text": "What freshness policy should apply to a cached price: a fixed TTL (and its duration), an upstream-provided expiry, or another policy; and may an expired entry ever be served?"
    },
    {
      "category": "consistency",
      "text": "What maximum price staleness is acceptable for callers, including during concurrent requests and upstream price changes?"
    },
    {
      "category": "invalidation",
      "text": "Which authoritative event or interface invalidates or refreshes a product/currency entry when its upstream price changes?"
    },
    {
      "category": "capacity",
      "text": "What cache capacity, eviction policy, and storage scope are required for production deployment?"
    },
    {
      "category": "availability",
      "text": "On an upstream error or cache backend failure, should the service fail immediately, retry within the existing caller budget, or return a stale cached price; if stale is allowed, what age limit applies?"
    }
  ],
  "implementation_status": "deferred",
  "proposed_scope": []
}
```
