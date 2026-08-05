# Cockpit Design Direction — Calm Guided Confidence

Status: frozen before cockpit implementation

## Product read

The cockpit is a desktop localhost guide for novice Mac users. It must make the
current decision and the evidence behind it understandable without exposing
engine output, reasoning, terminal language, diffs, or file paths. The visual
promise is calm guided confidence: a user always knows where they are, what is
happening now, and what decision is safe to make next.

## Design dials

- Design variance: 6/10. Use a distinct continuous lane and editorial evidence
  sheet, while keeping controls conventional and predictable.
- Motion intensity: 3/10. Motion only explains state transition or focus; honor
  reduced-motion preferences and avoid ambient animation.
- Visual density: 5/10. Show the current decision prominently and keep secondary
  proof compact enough for a 1024x768 desktop viewport.

## Visual system

- Warm paper/sand background, ink navy text, saffron progress, and forest green
  for verified evidence. No gradients, glass effects, bento grids, or dashboard
  card wall.
- Use the macOS/system sans stack; do not add a remote font or network resource.
- The persistent left lane rail carries G0-G6 progress. The main canvas is the
  single “now” panel. Evidence appears as a restrained editorial sheet beneath
  the current action, not as technical logs.
- Hierarchy comes from typography, alignment, whitespace, and thin rules. Avoid
  decorative pills; reserve compact status labels for actual run/gate state.
- All visible strings are i18n keys with complete Turkish and English values.
  Turkish is the default.

## Interaction and accessibility

- Snapshot is authoritative on open and reconnect. Browser memory is never the
  resume source; a revision gap causes a fresh snapshot fetch.
- Primary actions are plain-language verbs. Every state has one clear next
  action or an explicit explanation that the system is waiting.
- Keyboard order follows lane, current decision, evidence, then secondary
  controls. Focus is visible and moves to the new main heading after a phase
  transition or snapshot recovery.
- State is never expressed by color alone. Live updates use a polite status
  region; decision-required messages use assertive announcement only when a
  user action is actually necessary.
- Minimum verified viewports are 1280x800 and 1024x768 in both Chromium and
  WebKit. No mobile or packaged-desktop claim is made.

## Forbidden surface

The DOM, accessibility tree, WebSocket handling, screenshots, and persisted
client state must not contain raw engine events, reasoning, tool calls, stderr,
terminal output, diffs, credentials, or source/file paths. The cockpit displays
only semantic activity and machine/user/isolated-review gate outcomes.
