# Project Status

Updated: 2026-08-04

Active sprint: **none — S2 offline safety spine closed; owner-pilot validation remains deferred**

Authority: `CLAUDE.md`, `PROJECT_MAP.md`, and
`docs/research/sprint-03-novice-pilot/`

## Current Result

S1 is closed. It delivered the tested engine adapter and the 36-probe engine
conformance surface; its former overnight runbook is historical research, not
an active instruction surface.

S2 implements the first owner-installed, single-user, single-project Local Web
pilot slice:

- `packages/orchestrator` is the append-only project-state authority with
  atomic evidence publication, one-project locking, durable process-receipt
  recovery, explicit child environments, and a semantic loopback HTTP/WebSocket
  boundary.
- `profiles/local-web` generates an ejectable Next.js, Tailwind v4,
  SQLite/Drizzle project with normal and individually seeded lint, type, unit,
  build, boot, axe, and smoke harnesses. Its Git operations use a checked
  absolute executable and finite child environment; inherited `PATH`, `GIT_*`,
  templates, hooks, and secret-like values do not cross that boundary.
- `apps/cockpit` is a Turkish-first React/Vite desktop flow with semantic-only
  activity, G0–G6 states, strict loopback session handling, and no raw engine
  output, reasoning, paths, diffs, or terminal surface.

Final-21 through Final-53 are diagnostic, remediation, or explicitly rejected
evidence only. Their independent tests and reviews drove the implemented
recovery, artifact, environment, filesystem-anchor, session, workflow, Git,
browser-state, and Local Web process-ownership boundaries. Final-54 is the
first complete frozen-contract offline acceptance: a 186-file source manifest
at SHA-256 `9b8b527483ee07ade0b8436feec16ee89f30fcaa5af9a14341e32c262925aa36`,
a 230-record final evidence index at SHA-256
`3def6778008e29a3a4107a4c2fa940493bfc21fd7c6c5f8aeec5484b6e8fdd87`, and a
passed final artifact result at SHA-256
`72b363b060f692e262c7d87de624afd4373a4def58bd7f246b60dd96ab012d61`.
It records all 22 required commands, including Playwright provisioning, with
an explicit zero exit status for every command. Final-55 is the final
documentation-binding replay for these durable records; it changes no
production behavior or pilot prerequisite.

S2 is deliberately not a distributable friends pilot. The closing record is
included in its documentation-bound acceptance capture; live-engine,
real-browser, policy, GitHub, and observed-user prerequisites remain below.

## Accepted Offline Evidence

The exact deterministic contract is
`docs/research/sprint-03-novice-pilot/GATE_CONTRACT.md`. Final-54's complete
immutable-source sequence, repeated for the final documentation-binding
capture, includes:

1. Clean install, high-severity dependency audit thresholds, formatting,
   linting, strict type checking, and repository tests.
2. Offline persistence, recovery, minimal-environment, UTF-8, protocol, and
   localhost session/origin evidence.
3. Cockpit production build plus the novice journey and public failure
   projections in Chromium and WebKit at 1280×800 and 1024×768.
4. Normal Local Web gates and every matching seeded failure.
5. Evidence-index, redaction, and changed-path validation against the exact
   captured source bytes.

Expected limits remain explicit: two opt-in engine live tests, one live
orchestrator auth test, and three privileged foreign-owner fixtures were
skipped by design, not treated as passes. The generated-profile audit meets the
high-severity threshold but reports two moderate transitive `postcss` advisories.
No live Claude/authentication command has been run.

## Hard Blocks Before a Friends Pilot

- Record Anthropic's written response to the drafted headless-subscription
  inquiry. The inquiry remains an owner action and is not sent by automation.
- Pass the authenticated minimal-environment smoke with `apiKeySource: none`
  and one supervised G0–G6 Local Web journey on the owner machine.
- Complete real current macOS Safari and Chrome smoke checks.
- Enable successful `free-tier`, `packages`, and `product-offline` GitHub
  checks as required checks through an explicitly authorized repository action.
- Complete at least three owner-installed observed novice sessions without a
  terminal, path, or diff exposure.
- Before any project import, existing-repository management, or automatic
  post-edit snapshot feature, add generated-project provenance or reject and
  neutralize unsafe repository-local Git configuration.

No commit, push, pull request, ruleset change, publication, deployment, or
inquiry delivery is authorized by this status file.

## Deferred

Night Shift, multiple projects, crew controls, Atlas, public installation,
desktop packaging, responsive/mobile claims, deployment, accounts, payments,
and external APIs remain outside S2.
