# @guidelane/engine

A live handle on one official `claude` CLI subprocess speaking stream-json.

Every rule in this package is a **measurement**, and the measurement is quoted in
a comment at the line it constrains. Where a comment says "MEASURED", there is a
probe in `tools/probe/` that produced the number. Where it says "found by the
audit", it was a defect in this code that an independent reader caught.

Read [ADR-009](../../docs/decisions/ADR-009-phase-lifecycle-and-session-handle.md)
first. This README is the short version.

## The five things a caller must know

**1. Send once, then wait for `ready`.** The engine emits no `system/init` until
it receives a user message — nothing at 8 s idle, receipt 86 ms after the first
turn. So the init receipt gate cannot be "no send before init"; that deadlocks.
Exactly one **priming turn** is allowed, and everything after it waits.

```ts
const session = new EngineSession({ args, cwd, registry, surface, expect })
session.on('ready', () => { /* the receipt passed */ })
session.start()
session.send('the first turn')          // allowed — this is what triggers init
// session.send('a second')             // throws until `ready`
```

**2. `result` is per turn, not the end of the session.** With stdin open the
process never exits. An adapter that waits for exit after `result` hangs forever;
one that treats `result` as session-end leaks a live, authenticated engine.

**3. `close()` is the terminator, and it keeps reading.** Closing stdin ends the
session (~530 ms), and **6,243 bytes still arrive after the close** — a closer
that stops reading truncates the phase.

```ts
const { code } = await session.close(30_000)
```

**4. Render on `effective`, never on the outer class.**

```ts
session.on('event', (event, outer, inner, effective) => {
  if (effective === 'render') feed.append(event)
})
```

`stream_event` is pinned `render` in the artifact, and the `stream_event`
envelope is exactly what carries `thinking_delta`. Rendering on `outer` streams
raw, unrewritten English chain-of-thought to the user — ADR-006's language dial
is a `MessageDisplay` hook and provably does not touch thinking blocks. This was
a real defect in this package, caught by the sprint-close audit after three other
mechanisms had been built to prevent it.

**5. Tell the session when you stop reading.** The engine **blocks** under
backpressure rather than dropping, so a paused consumer makes the stream go
legitimately quiet — and the stall watchdog would otherwise blame the engine.

```ts
session.setDraining(false)   // renderer paused
session.setDraining(true)    // and resumed
```

## What fails, and how it tells you

Every failure is a `failure` event with plain-language text intended for a
non-coder. Nothing is thrown at the top level, because an uncaught throw in an
unattended supervisor leaves `detached`, authenticated children spending quota.

| `kind` | Means |
|---|---|
| `init-receipt` | The session did not start in the expected state, **or no receipt arrived**. The session is already stopped and every later `send()` throws. |
| `stall` | No output for `stallMs` while output was expected. Carries `consumerPaused`, because a stall under a paused consumer is ours and not the engine's. |
| `hook` | A hook the engine reported as `success` did not do its job — see `validateHook`. |
| `framing` | One line exceeded 32 MiB. Separately, an unparseable line emits `dropped`, which is a report and not a phase failure. |
| `io` | A pipe to or from the engine errored (`EPIPE` after the engine exits). |
| `internal` | The adapter itself threw while reading. |
| `spawn` | The child never launched. |

## What this package deliberately does not do

- **It does not redact the raw `event` payload.** The orchestrator needs it
  intact; the artifact store owns redaction for anything it persists, the way
  `tools/probe/lib/redact.mjs` does. Engine-authored *prose* — spawn errors,
  denial text — **is** scrubbed, because it routinely carries absolute paths.
- **It does not install a process-exit reaper.** `registry.killAll()` exists and
  has no production caller, so a supervisor killed with `SIGKILL` still leaves
  children. That is Tier B1, the S2 exit gate.
- **It does not inherit the supervisor's environment.** `scrubbedEnv()` builds
  the child environment from an explicit portable allow-list and reports
  `inherited: 0`; backend-routing credentials and unrelated values such as
  `GITHUB_TOKEN`, `NPM_TOKEN`, or `DATABASE_URL` never cross this boundary.
  The owner-operated authenticated init smoke is still required to prove that
  the allow-list preserves subscription login with `apiKeySource: none`; a
  failed live check must not fall back to broad inheritance.

## Tests

```bash
npm test --workspace @guidelane/engine                    # 60 offline
GUIDELANE_LIVE=1 npm test --workspace @guidelane/engine   # + 2 real engine calls
```

The offline tier runs against `test/fixtures/fake-engine.mjs`, which speaks the
measured lifecycle and has explicit failure arms (`--no-init`, `--silent`,
`--garbage`, `--stderr-flood`, `--never-exit`, `--exit-early`). It exists because
the real engine cannot be asked to omit its receipt or flood stderr on demand,
and a failure path with no test is a guess.
