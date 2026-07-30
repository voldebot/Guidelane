#!/usr/bin/env bash
# Append one hook event name to $GUIDELANE_PROBE_LOG, then get out of the way.
#
# Contract with the probe harness:
#   - The event name is passed as $1 (never parsed from stdin) so the result is
#     unambiguous even if the hook payload shape changes between CLI versions.
#   - stdout stays EMPTY by default: for advisory hooks that means "no change".
#   - Always exits zero. A probe fixture must never block or fail a session.
#   - If GUIDELANE_PROBE_LOG is unset, do nothing at all (no stray files).

set -u

EVENT="${1:-UNKNOWN}"
LOG="${GUIDELANE_PROBE_LOG:-}"

# The log path arrives entirely from the environment, which makes this an
# append-to-arbitrary-file primitive at the operator's privilege if the variable
# is ever inherited from somewhere unexpected. Harmless inside the harness, but
# this file is copy-paste bait for the production behaviour pack — so it fails
# closed to temp roots only.
case "$LOG" in
  "") ;;
  /var/folders/*|/private/var/folders/*|/tmp/*) : ;;
  *) LOG="" ;;
esac

# Drain stdin so the caller never blocks on a full pipe.
if [ ! -t 0 ]; then cat >/dev/null 2>&1 || true; fi

if [ -n "$LOG" ]; then
  printf '%s\n' "$EVENT" >>"$LOG" 2>/dev/null || true
fi

# Rewrite branch (probe-only, opt-in). Answers the question R3 mechanism 4 rests
# on: does a MessageDisplay rewrite reach --output-format stream-json — which is
# what Guidelane actually renders — or does it only repaint the terminal?
# Measured 2026-07-30 on 2.1.220: it reaches the stream (ADR-008).
if [ -n "${GUIDELANE_PROBE_REWRITE:-}" ] && [ "$EVENT" = "MessageDisplay" ]; then
  printf '%s\n' '{"hookSpecificOutput":{"hookEventName":"MessageDisplay","displayContent":"REWRITTEN_BY_HOOK"}}'
fi

exit 0
