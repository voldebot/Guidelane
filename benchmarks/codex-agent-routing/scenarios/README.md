# Agent Routing Scenarios

Each directory is an independent Python 3.11+ seed repository with no third-party dependencies.

- `routine_defined` exposes `parse_retry_after(value, now)` and specifies its complete parsing contract in `task.md`.
- `complex_defined` exposes immutable `Job` values and `schedule_jobs(jobs, capacity)` with a complete deterministic scheduling contract in `task.md`.
- `complex_underdefined` exposes an existing `PricingService` backed by an `UpstreamPricingClient`; its `task.md` contains a compatibility-sensitive cache request whose missing policy decisions require clarification.

