# Running the conformance probe on a schedule

Two tiers, two homes. This split falls out of ADR-001, not out of convenience:
Guidelane never holds a credential, so the tier that makes real engine calls can
only run where a human is already signed in.

| Tier | Probes | Needs a login? | Where it runs | Catches |
|---|---|---|---|---|
| free | 13 | no | GitHub Actions (`.github/workflows/engine-conformance.yml`) | a CLI release changing a flag, a subcommand, or a help-text contract |
| `--live` | +17 | **yes** | the owner's laptop, on a local schedule | a change in what the engine actually *does* |

## The live tier, locally (macOS, launchd)

`launchd` is the right tool here rather than `cron`: it survives sleep by running
the job at the next wake, which matters on a laptop that is closed at 04:00.

**Use the installer, not the block below**: `./tools/probe/install-nightly.sh install`.
It derives the repo path from its own location and passes no flags the harness
does not already default to — the hand-copied plist hardcoded both, so the repo
path and the pinned `--model haiku` could drift away from reality without anyone
noticing. `… status` reports honestly whether anything is scheduled; `… uninstall`
removes it.

**Nothing is scheduled by default.** A 04:00 job makes 17 real engine calls a
night on the owner's subscription — a standing cost, and therefore an explicit
decision rather than a side effect of cloning the repo.

The plist it writes, for reference:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.guidelane.conformance</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string>
    <string>-lc</string>
    <!-- -l so the login shell puts node and claude on PATH; launchd's own
         environment is nearly empty and would fail with "command not found". -->
    <string>cd ~/Desktop/Projects/Guidelane &amp;&amp; node tools/probe/run.mjs --live --model haiku</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict><key>Hour</key><integer>4</integer><key>Minute</key><integer>0</integer></dict>
  <key>StandardOutPath</key><string>/tmp/guidelane-conformance.log</string>
  <key>StandardErrorPath</key><string>/tmp/guidelane-conformance.err</string>
</dict>
</plist>
```

```bash
launchctl load  ~/Library/LaunchAgents/com.guidelane.conformance.plist
launchctl start com.guidelane.conformance          # run it once now
launchctl unload ~/Library/LaunchAgents/com.guidelane.conformance.plist  # stop
```

## Exit codes

| Code | Meaning | What to do |
|---|---|---|
| 0 | green | nothing |
| 1 | a probe FAILED or ERRORED — **the engine's contract changed** | read the report; this is the signal the suite exists for |
| 2 | the harness itself broke (bad flag, no binary, crash) | fix the harness |
| 3 | **inconclusive** — a call stalled, or capacity ran out | says nothing about the engine; re-run later |

Codes 1 and 3 are separate on purpose. A nightly job that reports "engine broken"
every time a laptop sleeps mid-run teaches its owner to ignore it, and this is
the project's only automated drift detector.

## The baseline gate

`tools/probe/baseline.json` records the expected status of every probe. The run
compares against it and **fails on drift in either direction**.

Both directions matter. Gating only on `fail`+`error` lets any non-green steady
state quietly absorb a further probe degrading from PASS to PARTIAL — which is
exactly what the suite's two former standing PARTIALs would have done had they
survived (they were retired on 2026-07-31; the expectation is now 30 × `pass`,
and any PARTIAL entry appearing here again should be argued for in the commit
message, not absorbed). And a probe *improving* is news too: it means a
documented limitation lifted and the prose in `CLAUDE.md` §8 or an ADR is now
stale.

A probe with **no** baseline entry is also drift. Recording an expectation is a
deliberate act including the first time — otherwise "add a new probe" is the way
to ship a red one.

```bash
node tools/probe/run.mjs --live --update-baseline   # regenerate (full runs only)
```

A partial run may never rewrite it — it knows nothing about the probes it
skipped, and letting it write would silently shrink the expectation set. Commit
the file on its own so the diff is reviewable. Hand-editing it to silence a red
build defeats the entire mechanism; that failure mode is human, not technical,
and nothing in the code can stop it.

## One run at a time

The suite takes a lockfile at `~/.guidelane/probe.lock` — NOT in the temp dir,
because macOS gives launchd and each Terminal login session their own per-session
`TMPDIR`, so a lock there is invisible between exactly the two processes it exists
to serialise. A second run refuses to start and
names the pid holding it. This is not tidiness: concurrent engine sessions race
on the same five-hour rate-limit window, which makes a limit event
indistinguishable from a real failure — and REVIEW-02 B7 flags that concurrent
`claude -p` may contend on `~/.claude.json`, whose corruption a non-coder cannot
recover from.

A lock left behind by a crashed run is reclaimed automatically: the holder pid is
liveness-checked, and a dead holder loses the lock. A lock that can strand its
owner would be worse than no lock at all. **Liveness beats the TTL** — a holder
that is still alive keeps the lock at any age, because a slow run (rate-limit
pauses) is not a dead one, and the earlier form stole the lock at exactly the
moment contention hurts most.

## Things that will bite

- **The live tier spends real quota.** 17 engine calls on `--model haiku` is
  small, but it is not free, and it lands in the same five-hour window the owner
  works in. 04:00 is chosen for that reason.
- **The canonical report is only written by a full `--live` run.** Anything
  filtered (`--only`, `--kind`) or free-tier writes `*.partial.md` / `*.partial.json`
  instead, and those are gitignored. This used to be a footgun documented in
  prose; it is now enforced in code, because the report is the evidence ADR-007
  and ADR-008 both cite.
- **Everything written passes through `lib/redact.mjs`.** Home paths, usernames,
  the macOS temp-dir salt, addresses and token shapes are replaced at the
  serialization boundary — not per probe, so a new probe cannot leak by
  forgetting. CI greps the committed artifacts as a regression check. If you add
  a probe that captures child output, you do not need to do anything; if you
  bypass `run.mjs` to write a file yourself, you do.
- **Probes run sequentially on purpose.** Concurrent sessions race on the same
  rate-limit window and make a limit event indistinguishable from a genuine
  failure. Do not "speed it up" with parallelism.
- **Bumping the pinned CLI version in CI is a deliberate act.** Run `--live`
  locally against the new version first; if it is green, bump the pin in the
  workflow. A pin that drifts silently defeats the whole point (REVIEW-01 #5).
