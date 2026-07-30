# Running the conformance probe on a schedule

Two tiers, two homes. This split falls out of ADR-001, not out of convenience:
Guidelane never holds a credential, so the tier that makes real engine calls can
only run where a human is already signed in.

| Tier | Probes | Needs a login? | Where it runs | Catches |
|---|---|---|---|---|
| free | 10 | no | GitHub Actions (`.github/workflows/engine-conformance.yml`) | a CLI release changing a flag, a subcommand, or a help-text contract |
| `--live` | +17 | **yes** | the owner's laptop, on a local schedule | a change in what the engine actually *does* |

## The live tier, locally (macOS, launchd)

`launchd` is the right tool here rather than `cron`: it survives sleep by running
the job at the next wake, which matters on a laptop that is closed at 04:00.

Write `~/Library/LaunchAgents/com.guidelane.conformance.plist`:

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
