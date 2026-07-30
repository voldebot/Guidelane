#!/usr/bin/env bash
# Install (or remove) the nightly LIVE conformance run as a launchd agent.
#
# WHY THIS IS A SCRIPT AND NOT A CODE BLOCK IN A README
# -----------------------------------------------------
# The README's plist had to be retyped by hand, which meant two things could
# drift apart silently: the repo path (hardcoded to ~/Desktop/Projects/Guidelane)
# and the flags (it pinned `--model haiku`, so if the harness default ever moved,
# the nightly job would keep measuring the old model and nobody would notice).
# This script derives the path from its own location and passes no flags the
# harness does not default to.
#
# WHAT YOU ARE AGREEING TO BY RUNNING THIS
# ----------------------------------------
# A run at 04:00 every day that makes 17 real engine calls under YOUR
# subscription. That is a standing, recurring cost on your account. It is the
# only way the live tier gets scheduled at all — ADR-001 forbids putting a login
# on a CI runner — but it is your call, not the harness's.
#
# Side effect worth knowing: a run regenerates docs/research/S0-conformance-*,
# so if the engine's behaviour changes you will wake up to a dirty working tree.
# That is the signal working, not a bug.
#
#   ./tools/probe/install-nightly.sh install     # load the agent
#   ./tools/probe/install-nightly.sh status      # is it loaded? when did it last run?
#   ./tools/probe/install-nightly.sh uninstall   # remove it
#   ./tools/probe/install-nightly.sh run-now     # trigger one run immediately

set -euo pipefail

LABEL="com.guidelane.conformance"
PLIST="${HOME}/Library/LaunchAgents/${LABEL}.plist"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT_LOG="${HOME}/.guidelane/conformance.log"
ERR_LOG="${HOME}/.guidelane/conformance.err"

if [ "$(uname -s)" != "Darwin" ]; then
  echo "launchd is macOS-only. On Linux use a systemd timer; on Windows, Task Scheduler." >&2
  echo "The harness itself is macOS-only for now anyway (K5) — its process-group kill is POSIX." >&2
  exit 2
fi

cmd="${1:-status}"

case "$cmd" in
  install)
    mkdir -p "${HOME}/Library/LaunchAgents" "${HOME}/.guidelane"
    # `zsh -lc` so the LOGIN shell puts node and claude on PATH: launchd's own
    # environment is nearly empty and the job would die with "command not found".
    cat > "$PLIST" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string>
    <string>-lc</string>
    <string>cd '${REPO}' &amp;&amp; node tools/probe/run.mjs --live</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict><key>Hour</key><integer>4</integer><key>Minute</key><integer>0</integer></dict>
  <key>StandardOutPath</key><string>${OUT_LOG}</string>
  <key>StandardErrorPath</key><string>${ERR_LOG}</string>
  <key>ProcessType</key><string>Background</string>
</dict>
</plist>
PLISTEOF
    launchctl unload "$PLIST" 2>/dev/null || true
    launchctl load "$PLIST"
    echo "Installed ${LABEL} — 04:00 daily, live tier, repo: ${REPO}"
    echo "Logs: ${OUT_LOG} / ${ERR_LOG}"
    echo
    echo "This now spends subscription quota every night. Remove with:"
    echo "  $0 uninstall"
    ;;
  uninstall)
    launchctl unload "$PLIST" 2>/dev/null || true
    rm -f "$PLIST"
    echo "Removed ${LABEL}. Nothing schedules the live tier any more —"
    echo "update CLAUDE.md §3 if it claims otherwise."
    ;;
  run-now)
    launchctl start "$LABEL"
    echo "Triggered ${LABEL}. Follow it with:  tail -f ${OUT_LOG}"
    ;;
  status)
    if [ ! -f "$PLIST" ]; then
      echo "NOT INSTALLED — nothing schedules the live tier on this machine."
      echo "The free tier still runs in GitHub Actions on every push and daily."
      exit 0
    fi
    echo "plist: $PLIST"
    launchctl list | grep -F "$LABEL" || echo "  (plist exists but the agent is not loaded)"
    [ -f "$ERR_LOG" ] && echo "last stderr: $(tail -n 3 "$ERR_LOG" 2>/dev/null || true)"
    ;;
  *)
    echo "usage: $0 [install|uninstall|run-now|status]" >&2
    exit 2
    ;;
esac
