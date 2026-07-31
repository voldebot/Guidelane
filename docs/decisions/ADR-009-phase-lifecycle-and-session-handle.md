# ADR-009: The Phase Lifecycle and the Engine Session Handle

- **Status**: Accepted
- **Date**: 2026-07-31
- **Deciders**: Talha (owner), Claude (technical lead)
- **Extends**: [ADR-007](ADR-007-headless-engine-contract.md), [ADR-008](ADR-008-session-isolation-and-init-receipt.md). Supersedes neither.
- **Evidence**: REVIEW-02 §§16–20 (S1 Tier A), `tools/probe/` probes
  `p-phase-terminator`, `p-backpressure-lossless`, `p-no-headless-dialog`,
  `p-hook-failure-detectable`, `p-stream-surface-union`, `p-stream-surface-artifact`.

## Context

ADR-007 and ADR-008 settled how a session is **configured** — permissions, MCP
delivery, isolation, the init receipt. Neither says anything about how a phase
**runs and ends**, because at the time nothing had measured it. The S0 primitive
`spawnCapture` is run-to-completion by construction: it buffers everything,
closes stdin immediately, and times out on wall-clock. It cannot answer a
question mid-stream, cannot be cancelled, and cannot tell a slow phase from a
dead one. The S0 close named its replacement as debt.

REVIEW-02 listed seven Tier A unknowns, four of which could make a run go silent
with no terminal event — the worst available outcome in front of a non-coder.
S1 answered all seven, and answering them turned up two hazards **REVIEW-02 never
listed**, both found by running the engine rather than reading about it:

1. **A `-p` session with stdin open never exits, and `result` is per-turn.** An
   adapter that waits for process exit after `result` waits forever. This is
   exactly the silent-stall class Tier A exists to prevent, and it was produced
   by accident while measuring something else.
2. **The engine BLOCKS under stdout backpressure rather than dropping.** A slow
   consumer loses nothing, but it stalls the engine and the stream goes
   legitimately quiet — so a naive stall detector fires on a session that the
   consumer itself paused.

This ADR fixes the runtime half of the contract, as `packages/engine`.

## Decision

**1. A phase is one engine session, and the phase boundary is `stdin.end()`.**
Measured (`p-phase-terminator`): closing stdin ends the session, exit 0 arriving
~530 ms later. Waiting 10 s before closing gives the same latency, so it is the
*close* that terminates and not any elapsed-time rule; with stdin left open the
session was still alive at 75 s. Neither `result` nor process exit may be used as
the boundary — `result` is per-turn and process exit is downstream of the close
this decision owns.

**2. The handle keeps draining after `finish()`, until the process `close`
event.** Measured: 6,243 bytes arrived *after* stdin was closed. A closer that
stops reading truncates the phase, possibly losing the assistant text or the
terminal result itself. "The session ended" is the process `close`, not the last
byte the caller felt like reading.

**3. The stall signal is "no exit within a bounded window after the input was
closed", and inter-event silence is only a stall while output is EXPECTED.**
Because the engine blocks under backpressure, and because a session between turns
is idle *on purpose*, a continuously-armed watchdog fires on healthy sessions.
The watchdog is therefore armed on `send()` and on `finish()`, disarmed on the
turn's `result`, and suspended while the consumer holds the stream. Baseline for
the window: drained inter-event silence measured p50 207 ms, p95 385 ms, max
1,227 ms — so a threshold in the tens of seconds sits far above jitter rather
than being a guess.

**4. A watchdog that reports a stop must perform the stop, in that order.**
It reaps the process group first and emits the failure second. A stalled phase
left running is an authenticated process spending the user's quota with nobody
reading its output, and prose that promises an action the code does not take is
the same defect class as a guard that cannot fire.

**5. Each supervisor owns its own `SessionRegistry`; kills are group kills.**
Replaces the probe harness's process-wide `LIVE_CHILDREN` singleton, which was
adequate for a suite that runs one thing at a time and wrong for Night Shift.
An engine session spawns grandchildren (stdio MCP servers, Bash tools), so
killing the direct pid leaves them running and authenticated. `kill()` returns
"the signal was delivered", never "the process is gone" — those are different
moments, and CI caught that exact race once already.

**6. Every stream event is classified before it reaches a human, and an
unrecognised one ESCALATES.** `tools/probe/stream-surface.json` is a hand-authored
product decision — `render | ignore | escalate` per `type`/`subtype` pair, with
value-conditional rules where the class depends on a field. `packages/engine`
reads it and refuses to start on any artifact whose `defaultForUnknown` is not
`escalate`. The artifact is a sample of one flag configuration on one model, so
its incompleteness is a certainty to be survived, not a risk to be managed: a
renderer that drops what it does not recognise goes silent, and silent is worse
than noisy because noise is a bug report.

**7. Raw thinking content is ignored BY NAME, never by omission.** Measured: on
haiku with no reasoning flag, `content_block.type=thinking`,
`delta.type=thinking_delta` and `delta.type=signature_delta` reach `-p`
stream-json by default. ADR-006's language dial is a `MessageDisplay` hook that
provably does not touch them (same-run differential: the assistant text block
came back rewritten while the thinking block kept its original characters). A
whitelist that excluded them by omission would fail open the first time it was
rewritten.

**8. A denied tool is detected on `tool_result.is_error` and on nothing else.**
The `permission_denied` advisory frame is droppable under load — the binary logs
`dropping oldest permission_denied advisory frames` — so neither its presence nor
its absence is evidence. Measured (A3b): `tool_result.is_error` survives
backpressure intact, so a gate may depend on it.

**9. The orchestrator validates hook stdout itself, because the engine will
not.** Measured (A7): a hook that exits non-zero reports `outcome: "error"` and
one that outruns its timeout reports `outcome: "cancelled"` — both loud. A hook
that emits an **unparseable payload and exits 0** is reported
`exit_code: 0, outcome: "success"` with the garbage sitting in `stdout`, and its
intended effect silently did not happen. Since ADR-006's dial *is* a
`MessageDisplay` hook, "the engine said success" is not evidence the dial ran.

**10. No control-channel responder is required.** Measured (A4/A1): the engine
never asks headlessly. With an unapproved tool present, `auto`, `manual`,
`dontAsk` and `plan` all deny structurally with zero dialog or control frames —
`manual`, which literally means "ask the user", is byte-for-byte indistinguishable
from `auto`. No `control_request` appeared in any S1 configuration. The
REVIEW-02 §3 A1-vs-A2 contradiction about which subtypes live where is therefore
moot for the orchestrator, and is left unresolved deliberately rather than
answered for its own sake.

## Consequences

- **The adapter is a live handle, not a call.** `packages/engine` exposes
  `start / send / finish / stop / setDraining` with events, which is what the
  cockpit's feed, Night Shift's supervisor, and the gate layer all need. The
  probe harness keeps `spawnCapture` — it is the right primitive for a
  run-to-completion conformance check and the wrong one for a phase.
- **`setDraining` is part of the contract, not an optimisation.** The consumer is
  the only party that knows it stopped reading, so it has to say so or the
  watchdog will blame the engine for silence the consumer caused.
- **The cockpit cannot be built against this artifact and then run on another
  model.** `_modelDependence` is measured: identical flags on sonnet produced no
  thinking surface at all where haiku produces three types. ADR-004 routes roles
  to different models, so the artifact is haiku's universe and every other model
  is unvalidated until measured.
- **An unclassified pair is a CI failure, not a warning** — but the union probe
  is a `fixture-call`, so CI runs the artifact *validity* probe and not the union
  probe. Validity is not obedience: a well-formed artifact can still classify raw
  chain-of-thought as `render`. Exactly one classification is pinned in code
  against that; every other class stays an unguarded judgement call, by design.
- **Night Shift's rate-limit rule is now window-typed** (ADR-007 correction of
  the same date): sleep to `resetsAt` only when the wait fits the run's remaining
  budget. A `seven_day` window is days out and must stop the run and tell the
  user, not sleep through it.
- **`--effort` remains unverifiable.** It has no init-receipt field on any surface
  this suite has found, so ADR-004's second routing lever is unasserted by
  construction. `p-effort-model-fallback` publishes `effortAssertable: false`
  rather than letting a green result imply otherwise.
- **What this ADR does not settle**: Windows (the group kill is POSIX-only, K5),
  concurrency across supervisors sharing `~/.claude.json` (Tier B7), orphan
  recovery after `kill -9` (Tier B1, the S2 exit gate), and in-stage
  auto-compaction against always-pushed invariants (Tier B3).

## References

- `docs/research/REVIEW-02-runtime-gaps.md` §§16–20 — the Tier A measurements
- `tools/probe/stream-surface.json` — the classification artifact this decision
  makes load-bearing
- `packages/engine/src/session.ts` — the lifecycle, with each measurement quoted
  at the line it constrains
- [ADR-002](ADR-002-gated-production-line.md) — why the classification is a
  product decision and not something the engine can be asked
