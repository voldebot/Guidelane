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

