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
# `/tmp/../Users/<user>/.zshrc` matches `/tmp/*`, so the allowlist has to reject
# traversal explicitly before matching prefixes.
#
# And the rejection is LOUD. Silently blanking LOG meant that on any machine
# whose TMPDIR sits outside these roots (a CI runner with a custom RUNNER_TEMP,
# a hardened image), no log file appeared and `p-hook-events-headless` reported
# FAIL — "hook lifecycle events do not fire in headless mode" — a confident,
# wrong claim about the ENGINE, manufactured by this fixture's own path policy.
# That is the p-autoupdate-governable bug verbatim: an absence reported from a
# surface that could never have carried the thing.
case "$LOG" in
  "") ;;
  *..*)
    printf 'log-event.sh: refusing log path containing .. (%s)\n' "$LOG" >&2
    LOG="" ;;
  /var/folders/*|/private/var/folders/*|/tmp/*|/private/tmp/*) : ;;
  *)
    printf 'log-event.sh: refusing log path outside the temp-root allowlist (%s)\n' "$LOG" >&2
    LOG="" ;;
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
