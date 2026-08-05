---
sprint_id: sprint-03-novice-pilot
opened: 2026-08-03
status: closed
branch: codex/s2-novice-pilot
base_commit: 952cdf52dffb3acc47fc3918c97183b456eb0cf3
---

# Sprint 03 — Novice Pilot Safety Spine

## Outcome

Deliver the first owner-installed, single-user, single-project Guidelane pilot
slice: a fail-closed orchestrator with durable append-only evidence, one Local
Web profile, and a Turkish-first localhost cockpit that never exposes raw engine
output, reasoning, file paths, diffs, or terminal output.

## Opening Context

- S0 measured 36 Claude CLI probes: 14 offline/free and 22 live-only.
- S1 shipped `packages/engine` with 58 passing offline tests and 2 opt-in live
  tests at base commit `952cdf5`.
- The source worktree contains staged and untracked benchmark/research work. It
  is a protected unrelated-work boundary and must remain unchanged.
- This sprint runs only in its dedicated sibling worktree on
  `codex/s2-novice-pilot`; it must not commit, push, publish, deploy, or change
  repository rulesets.
- The Anthropic headless-subscription inquiry remains an unchanged owner action.
  Friends-pilot distribution is blocked until a written response is recorded.

## Frozen Scope

### In scope

- Truthful repository documentation and S2 project map.
- Minimal-environment, orphan-recovery, UTF-8, atomic-artifact, and localhost
  trust-boundary spikes.
- `packages/orchestrator` as the sole project-state authority, with immutable
  records, atomic manifest publication, one-project locking, one active phase,
  explicit transitions, process receipts, restart reconciliation, and semantic
  redacted events.
- Same-origin loopback HTTP/WebSocket API with a one-use 128-bit launch token,
  strict Origin checks, SameSite session cookie, command schemas, snapshot-first
  reconnect, and monotonic revisions.
- `profiles/local-web` scaffold and seeded gate-failure harness for Next.js,
  Tailwind v4, SQLite/Drizzle, with no auth, deployment, or external APIs.
- `apps/cockpit`: React 19, Vite, strict TypeScript, Tailwind v4, Zustand only
  for view state, complete Turkish/English i18n keys, and desktop novice flow.
- `product-offline` CI and deterministic redaction/changed-path checks.

### Non-goals

- Night Shift, multiple projects, crew controls, Atlas, public installer,
  desktop packaging, deployment, mobile claims, accounts, payments, or external
  APIs.
- Live Claude calls before all offline gates pass.
- Sending the Anthropic inquiry or modifying GitHub protection/rulesets.
- Using an artifact-store directory as a second engine-writable root.

## Accepted Decisions and Invariants

1. Files, not SQLite, are the S2 persistence boundary. Immutable records carry
   `schemaVersion`, identity, previous revision, creation time, and SHA-256.
   `manifest.json` advances only through same-filesystem temp write + rename.
2. Unknown schema, missing evidence, digest mismatch, or git/manifest divergence
   becomes `recovery-required`; it is never rounded to success.
3. Raw engine events are never persisted or sent to the cockpit. One semantic
   serialization boundary redacts paths, credentials, stderr, diffs, reasoning,
   and unknown payloads.
4. Each supervisor owns one `SessionRegistry`. A process-group receipt is bound
   to an immutable attempt before work is accepted. Stop/failure reaps the group
   before publishing the terminal result. Restart never resumes an old attempt.
5. Engine children receive an explicit environment allow-list. If a supervised
   authenticated init smoke cannot preserve subscription auth with
   `apiKeySource: none`, build remains blocked; there is no silent deny-list
   fallback.
6. Production binds only to `127.0.0.1`. Commands require same Origin and an
   authenticated SameSite session established by exchanging a single-use launch
   token supplied in a URL fragment. CORS is not enabled.
7. Browser state is not a resume authority. Reopen and revision gaps always
   recover from the canonical snapshot.
8. Every successful gate result references immutable machine evidence and its
   digest. Isolated review remains capped judgment, not proof.
9. Generated projects use a repository-local `Guidelane
   <guidelane@local.invalid>` identity and accepted git snapshots. Rollback moves
   only the generated project to the prior accepted snapshot and never deletes
   artifact history.

## Public Contract

- `ProjectSnapshot`: schema version, project ID, revision, stage, run state,
  language, blueprint revision, gate summaries, pending decision.
- `PhaseRun`: immutable phase/attempt identity, input digests, engine receipt,
  timestamps, status, evidence references, and git snapshot.
- `GateResult`: `pending | running | passed | failed | blocked | needs_user` and
  authority `machine | isolated_review | user`.
- `RunFailureCode`: receipt, denial, hook, stall, framing, IO, rate-limit,
  interrupted, recovery, and unknown-event categories.
- HTTP routes: `POST /api/v1/projects`, `GET /api/v1/projects/current`,
  `POST /api/v1/projects/current/commands`, `GET /api/v1/health`.
- WebSocket route: `/api/v1/events`, semantic revisioned events only.
- Commands: `submitIdea`, `approveBlueprint`, `requestBlueprintChange`,
  `approvePlan`, `startBuild`, `acceptResult`, `requestChange`, `rollback`.

## Acceptance Criteria

1. Every offline scenario listed in the approved novice-pilot plan has an
   executable deterministic test or is explicitly deferred with a reason and
   owner; B1 orphan recovery and minimal environment are not deferrable.
2. The canonical state survives close/reopen, partial writes, stale receipts,
   revision gaps, malformed inputs, and UTF-8 Turkish text without guessing.
3. A fake-engine G0-to-G6 journey works in Chromium and WebKit at 1280x800 and
   at the 1024x768 support floor without exposing forbidden technical data.
4. The Local Web profile is ejectable and its harness demonstrably catches
   seeded lint, type, unit, build, boot, axe, and smoke failures.
5. Repository-native engine tests and free probes remain green; live evidence is
   run only after offline acceptance and never waived when red.
6. Security audit and fresh Sol review leave no unresolved blocking finding.

## Independent Test Intent

- Artifact atomicity: killed temp write, missing evidence, corrupt digest,
  unknown schema, git-ahead/manifest-behind, and a second lock holder.
- Recovery: real detached fake-engine process group, supervisor SIGKILL,
  restart/reap, interrupted terminal state, and a distinct next attempt.
- Protocol: invalid Origin/token/cookie/command, token replay, semantic-only
  payloads, UTF-8 byte identity, WebSocket disconnect/revision gap/snapshot.
- Engine mapping: receipt, denial, hook, stall, framing, IO, rate-limit windows,
  interruption, recovery, and unknown event.
- UI: Turkish-first G0-G6 journey, all explicit run states, reopen, no forbidden
  technical strings, keyboard/focus/accessibility, Chromium and WebKit.
- Profile: standard dependency/scripts contract, local git identity, rollback,
  and individually seeded lint/type/unit/build/boot/axe/smoke failures.

## Deterministic Gate Contract (opening draft)

The independent gate author will freeze exact commands before implementation.
The intended top-level contract is: clean install; format/lint; strict typecheck;
all offline tests; free probe; orchestrator safety/recovery; cockpit production
build; Chromium and WebKit fake-orchestrator E2E; Local Web seeded-failure
harness; committed-artifact redaction; protected-path/HEAD check. Every command
must exit `0`, except seeded-failure subcases which must prove the targeted gate
returns non-zero.

Live evidence is excluded until offline acceptance: minimal-env authenticated
init, Turkish structured-output round trip, and one supervised G0-to-G6 Local
Web smoke. Lack of Anthropic written approval blocks friends-pilot distribution,
not offline implementation.

## Lightweight Impact Map

| Path | Relationship | Stable boundary |
| --- | --- | --- |
| `packages/engine/src/{env,registry,session,index}.ts` | Child environment, process ownership, receipt and stream source | Existing S1 engine contract |
| `packages/orchestrator/**` | Sole state/API/process/persistence authority | New S2 server boundary |
| `apps/cockpit/**` | Same-origin semantic client and novice trust flow | Browser/UI boundary |
| `profiles/local-web/**` | Generated-project template and gate harness | Ejectable project boundary |
| `package*.json`, `tsconfig.json` | Workspace dependency and strict compiler graph | Repository build boundary |
| `.github/workflows/**` | Offline acceptance and compatibility signals | CI boundary |
| `README.md`, `STATUS.md`, `PROJECT_MAP.md`, `docs/**` | Public claims and durable decisions | Documentation boundary |
| source-worktree benchmark paths | Unrelated staged user work | Must not change |

## Risk Classification and Roles

- Classification: high risk, defined complex, cross-package implementation.
- Material triggers: secrets/environment trust boundary, localhost command
  authentication, detached process ownership and concurrency, strict protocol.
- Pre-implementation advisor: read-only `security_auditor` (Terra Max).
- Independent acceptance: `independent_test_author` and
  `independent_gate_author`.
- Implementers: one writer per overlapping surface, sequentially assigned.
- Gate runner: root deterministic shell.
- Closure: bounded blindspot audit, fresh Sol High review, and Sol Max
  adversarial review because auth/trust, concurrency, and strict protocol apply.

## Checkpoints

### 2026-08-03 — Opening

- Decisions: accepted the supplied pilot plan as the implementation contract;
  selected an isolated worktree at the exact base commit; no external mutations.
- Plan state: context and impact map loaded; pre-implementation contracts next.
- Changed paths: this sprint record only.
- Evidence: source worktree `git status --short --branch`; isolated worktree
  creation; base `git rev-parse HEAD`; current engine/package/doc inspection.
- Unknowns: minimal allow-list needed by local Claude auth; exact orphan receipt
  mechanics on macOS; browser dependency availability in the current machine.
- Next action: obtain bounded security advice and freeze independent tests and
  deterministic gates before production edits.

### 2026-08-03 — Baseline and gate contract

- Decisions: the independent gate contract is frozen in `GATE_CONTRACT.md`;
  its 58-scenario inventory floor and B1/minimal-env pre-build ordering are
  acceptance authority and cannot be weakened by an implementer.
- Plan state: baseline verified; independent tests and security advice remain
  in progress; production implementation has not started.
- Changed paths: sprint research and independent test-owned paths only.
- Exact evidence: `npm ci` exit 0; `npm run typecheck` exit 0 before failing-first
  tests landed; `npm test` exit 0 with 58 passed and 2 live skipped; free probe
  exit 0 with 14 passed and 22 live-only skipped. Probe artifacts and raw output
  were kept outside the repository; only this redacted result summary persists.
- Unknowns: whether the independent test API needs a narrow process-receipt
  extension in `packages/engine`; the exact allow-list required by a real local
  authenticated CLI remains a live-only measurement.
- Next action: reconcile security advice, test-owned API, and the frozen gate
  contract, then assign the orchestrator/engine/root-manifest writer.

### 2026-08-03 — Pre-implementation freeze

- Accepted security decisions: runtime engine spawn starts from an explicit
  allow-list rather than clone-and-deny; no arbitrary extra environment merge;
  the resolved executable path is explicit; missing or mismatched init receipt
  blocks work. Exact authenticated bootstrap remains a live-only unknown.
- Accepted recovery decisions: every spawn uses durable intent then observed
  receipt records; a receipt binds attempt/project/config digest plus PID, PGID,
  and an OS-observed process identity. Missing, corrupt, stale, or mismatched
  identity never triggers a signal and yields `recovery-required`. A terminal
  interruption publishes only after the matching group is observed reaped.
- Accepted localhost decisions: canonical server-held 127.0.0.1 origin; exact
  Host and Origin on every protected HTTP/WS path; fragment-only CSPRNG launch
  token, in-memory hashed verifier, atomic one-use and expiry; server-side
  bounded session; event-only WebSocket; semantic serializer is the only path
  from engine events to browser/persistence.
- Independent tests: 16 failing-first tests in
  `packages/orchestrator/test/**` plus a deterministic detached-grandchild
  fixture. The missing production module produced the expected initial red.
- Plan state: acceptance, security constraints, and independent test API are
  frozen; orchestrator/engine/root-manifest implementation may begin.
- Next action: assign one implementation writer for
  `packages/orchestrator/src/**`, the narrow engine environment/receipt extension,
  and root workspace dependency wiring without editing independent tests.

### 2026-08-03 — Orchestrator hard pre-build gate

- Outcome: the orchestrator safety spine, minimal engine environment, durable
  attempt/recovery model, loopback session boundary, and semantic WebSocket are
  implemented. Two failing-first rounds found and closed nine production bugs,
  including evidence ENOENT fail-open, identity-less group kill, symlink escape,
  non-durable attempts, token replay/expiry, and absent WebSocket/create routes.
- Exact independent root run: `npm ci` exit 0; `npm run typecheck` exit 0;
  `npm run test --workspace=@guidelane/engine` exit 0 (58 passed, 2 live
  skipped); `npm run test --workspace=@guidelane/orchestrator` exit 0 (25/25).
- Plan state: B1 and offline minimal-environment pre-build gates are green.
  Profile and cockpit production phases may now begin sequentially.
- Changed/owned paths: `packages/orchestrator/**`, narrow
  `packages/engine/src/{env,session,index}.ts`, root lockfile, sprint research.
- Remaining risks: authenticated minimal environment remains a live-only gate;
  RFC6455 implementation intentionally supports the small semantic text-frame
  surface only; same-user artifact tampering is not claimed to be prevented.
- Next action: assign the Local Web profile writer, then freeze the cockpit
  design direction before its separate writer begins.

### 2026-08-03 — Local Web profile acceptance checkpoint

- Outcome: the ejectable Local Web generator now emits a pinned Next.js 15,
  React 19, Tailwind v4, SQLite/Drizzle project with real lint, strict type,
  unit, build, loopback boot/health, axe, and Chromium smoke scripts. It has no
  Guidelane runtime dependency and uses a repo-local Guidelane git identity.
- Safety revisions found by execution: replaced fake lock/shim gates with a
  complete npm v3 transitive lock and real commands; moved Next to patched
  `15.5.22`; aligned Playwright at `1.62.1`; added the SQLite declaration pin;
  fixed string URL and explicit browser-context contracts; made the lint seed a
  real error rather than a warning.
- Exact evidence: profile narrow tests exit 0 (8/8) and strict typecheck exit 0;
  normal harness exit 0 with all seven gates in
  `/tmp/guidelane-s2-profile-normal-evidence-03`; seeded harness exit 0 with all
  seven isolated, attributable failures and complete cleanup in
  `/tmp/guidelane-s2-profile-seeded-evidence-02`.
- Ownership/evidence: source runs are recorded under the external Luna run
  directory; root mechanically regenerated only the profile lockfile. No source
  worktree, HEAD, commit, push, or PR state changed.
- Plan state: profile implementation is accepted. Cockpit design is frozen in
  `DESIGN_DIRECTION.md`; independent cockpit tests precede cockpit production.
- Remaining risk: the generated native SQLite package emits an upstream
  deprecation warning for its installer helper; deterministic install and all
  runtime gates pass, but supply-chain audit remains part of sprint close.
- Next action: independent cockpit behavior/E2E tests, then the isolated cockpit
  production writer.

### 2026-08-03 — Cockpit and public lifecycle checkpoint

- Outcome: the Turkish-first React/Vite cockpit implements the G0–G6 novice
  lane, fragment-token exchange, snapshot-first restore, semantic WebSocket
  recovery, complete English keys, explicit waiting/retrying/stopped/rate-limit/
  recovery states, and evidence/acceptance views without a technical-detail
  surface. Zustand remains view-state only.
- Independent UI revisions: the first visual review found stale decision
  controls during running/retrying/recovery and ambiguous old machine evidence.
  Failing-first tests now require wait-only running/retrying, exactly one
  recovery refresh action, and a clear distinction between current
  reconciliation and previously verified evidence in Turkish and English.
- Exact browser evidence: cockpit build exit 0; the complete fake-orchestrator
  suite passed 52/52 across Chromium and WebKit at 1280×800 and 1024×768. The
  follow-up English recovery assertion was added afterward and its narrow
  Chromium run passed 4/4 after the localized label correction. Final full
  browser gates remain in the sprint-close sequence.
- Orchestrator contract revision: canonical public state now starts at
  G0/idle/`submitIdea`, moves through explicit G0–G6 transitions, exposes typed
  `GateResult` and non-success `RunFailureCode` mappings, and clears pending
  decisions during running and recovery. Independent lifecycle tests pass 3/3;
  the complete orchestrator suite passes 32/32.
- Same-origin production boundary: optional cockpit assets are served on the
  exact loopback API origin with restrictive response headers and fail-closed
  path handling. The launch URL helper accepts only an exact loopback origin and
  carries the 128-bit token only in the fragment. Independent static-boundary
  tests pass 3/3; no browser-launch command was invoked.
- Plan state: production surfaces are implemented for offline acceptance.
  Deterministic root script/evidence wiring, CI, redaction/path gates, audits,
  and final reviews remain.
- Remaining risk: no real engine build or owner live journey has been run; the
  offline cockpit uses a fake orchestrator by design. Real Safari/Chrome smoke
  and the written Anthropic response remain friends-pilot blockers.
- Next action: wire and execute the frozen offline gate sequence, then perform
  the bounded security and fresh independent reviews.

### 2026-08-03 — Gate wiring and supply-chain checkpoint

- Outcome: the root acceptance vocabulary, 58-ID executable inventory,
  fail-closed offline dispatcher, browser evidence wrappers, native Local Web
  evidence validation, complete evidence index, changed-path policy, source and
  evidence redaction, and `product-offline` workflow are implemented. The
  evidence index was amended to avoid self-reference and is validated again
  after artifact and changed-path results exist.
- CI compatibility: the existing `packages` job now selects engine and
  orchestrator explicitly and sums their TAP pass counts; the heavy cockpit and
  generated-project gates remain owned by `product-offline`. Required-check
  configuration is still an external owner action and was not changed.
- Source-worktree protection: the original worktree remains on `main` with its
  staged benchmark and untracked sprint research unchanged. Its complete
  porcelain-status fingerprint remains
  `5a3d40162f11541fa7be9dd07ac30baaf0f446bc1b3fb73df42d3dfe185ef675`.
- Security finding: the generated-project lock reported four high-severity
  dependency findings. The routine profile worker partially pinned patched
  Drizzle, PostCSS, and Sharp versions but exceeded the bounded run with
  duplicate heavy harnesses; root stopped and reaped only that recorded worker
  process tree. The concrete XHigh gate failure triggered the prescribed deep
  profile worker with the same path ownership. No audit waiver is allowed.
- Plan state: documentation, CI, and gate tooling are ready. The full offline
  sequence waits for the profile lock/audit correction, after which all gates
  run once in the canonical order.

### 2026-08-03 — Canonical offline acceptance checkpoint

- Outcome: the complete mandatory offline sequence in `GATE_CONTRACT.md`
  passed from a clean root `npm ci`. The canonical evidence root is
  `/tmp/guidelane-s2-gates-final-10.rsNVLO`; its final index covers 114 files
  and the final artifact validator passed without mutating the tree.
- Local Web corrections: the generated dependency lock now pins
  `drizzle-orm@0.45.2`, `postcss@8.5.18`, and `sharp@0.35.1`; both the root and
  generated-project lock audits report zero vulnerabilities. A deterministic
  regression exposed inherited `NODE_TEST_CONTEXT` causing nested Node tests
  to skip with exit zero. The harness now removes that runner-only variable,
  the unit script discovers `tests/*.test.mjs`, and the unit seed is a separate
  real failing test file. The serialized profile suite passes 11/11.
- Exact mandatory evidence: `npm ci`, format, lint, strict typecheck,
  repository tests, evidence-backed offline tests, 58-ID inventory,
  orchestrator safety, cockpit build, Chromium and WebKit journeys, normal and
  seeded Local Web harnesses, pre-index, artifact/redaction gate, changed-path
  gate, final index, and final validate-only gate all exited zero. Chromium and
  WebKit each passed 28/28 tests across 1280x800 and 1024x768. Engine passed
  58 offline tests with two live skips; orchestrator passed 34 with one live
  skip; cockpit unit tests passed 6; Local Web passed 11.
- Supplemental evidence: the free probe exited zero with 14 offline passes and
  22 live-only skips under
  `$TMPDIR/guidelane-s2-free-probe-final-10.6rPBW7`.
  An earlier `/tmp` probe output target was rejected by the harness path policy
  with exit two and was not treated as acceptance. Root and nested profile
  `npm audit --package-lock-only --audit-level=high --workspaces=false` both
  exited zero with no findings.
- Plan state: offline acceptance is green. Security blind-spot review, fresh
  Sol review, and the adversarial concurrency/protocol review remain before
  sprint close.
- Deliberate non-pass: authenticated minimal-environment and supervised G0-G6
  live evidence were not run because no quota-spend authorization was given;
  the live journey runner remains fail-closed. Real Safari/Chrome smoke,
  Anthropic's written response, required GitHub checks, and three observed
  owner-installed sessions remain friends-pilot blockers.
- Next action: run the bounded security audit against the final diff and
  canonical evidence, then obtain fresh independent reviews and close the
  sprint without committing, pushing, or changing repository rules.

### 2026-08-03 — Security audit remediation checkpoint

- Audit outcome: the bounded blind-spot review found one high-severity issue:
  Local Web generated-project commands inherited the supervisor's complete
  environment. It also found a digest-less manifest fail-open. Independent
  failing-first tests reproduced both before production changes.
- Remediation: Local Web short- and long-lived children now start from an
  explicit portable environment allow-list plus explicit per-gate variables.
  Secret-like sentinels and `NODE_TEST_CONTEXT` do not cross the boundary.
  macOS's process-launch-injected `__CF_USER_TEXT_ENCODING` is the only
  platform key excluded from the exact-key assertion. Canonical manifests now
  require a non-empty, well-formed, matching SHA-256 digest.
- Exact post-fix evidence: child-environment tests pass 2/2; artifact tests
  pass 10/10; the complete orchestrator suite passes 36 with one live skip;
  the complete Local Web suite passes 13/13; repository and evidence-backed
  offline test runs both exit zero; normal and seeded profile wrappers both
  exit zero. The security follow-up marked both findings resolved and reported
  no remaining blocker or high finding in the rechecked scope.
- Residuals for adversarial review: same-UID artifact path substitution remains
  outside the engine-writable-root boundary but cannot be eliminated with the
  current path-based Node filesystem API; PID/PGID reuse retains an irreducible
  verification-to-signal race on macOS; raw engine events remain confined to
  the engine adapter and must never bypass the semantic orchestrator boundary.
  CI action SHA pinning and least-privilege workflow permissions remain a
  repository-hardening follow-up, not a friends-pilot acceptance waiver.
- Next action: republish the final evidence digest chain, run fresh Sol High
  review and the triggered Sol Max adversarial review, then record sprint-close
  status without performing any external repository action.

### 2026-08-03 — Final executable-ledger and recovery-integrity checkpoint

- Outcome: the canonical final-16 offline run passed from a clean `npm ci`
  install. The evidence root is
  `$TMPDIR/guidelane-s2-gates-final-16.<run>`; its completed index covers 126
  files, and validate-only rechecked the indexed artifact-gate result without
  rewriting the tree.
- Recovery hardening: persisted phase attempts now carry a canonical SHA-256
  digest and a closed `running | interrupted | recovery-required` status.
  Missing, malformed, tampered, unknown-status, identity-mismatched, or
  multiply-running records produce durable recovery. Reconciliation binds the
  OS-observed PID start identity to the recorded process group before any
  signal; a crossed PID/PGID receipt signals neither group.
- Executable inventory: all 58 scenario IDs declare a unique source/selector
  pair. Canonical wrappers reconciled 11 offline TAP selectors, 25
  orchestrator TAP selectors, 7 normal profile gates, 7 attributable seeded
  rejections, and 8 browser scenario aggregates. Chromium and WebKit each
  published 34 passed executions, for 68 browser/viewport records. The final
  artifact gate reconciled exactly 58 declared and 58 executed mappings.
- Evidence-boundary hardening: Playwright attachment paths must realpath within
  the runner-owned raw directory; final validation verifies the indexed digest
  of the artifact result; the cockpit build no longer claims unrelated TAP
  evidence. The diagnostic-flood test retains its behavior under a semantic
  selector so strict artifact redaction does not need an exception.
- Exact deterministic result: root format, lint, strict typecheck, workspace
  tests, evidence-backed offline and orchestrator suites, inventory, cockpit
  build, Chromium, WebKit, Local Web normal and seeded harnesses, pre-index,
  artifact/redaction, changed-path, final index, and final validate-only all
  exited zero. Engine passed 58 offline tests with two opt-in live skips;
  orchestrator passed 56 with one opt-in live skip. Root and generated-project
  lock audits reported zero vulnerabilities.
- Deliberate non-pass: no live Claude call, real Safari/Chrome smoke, GitHub
  ruleset change, Anthropic inquiry, commit, push, PR, publication, deployment,
  or friend pilot occurred. Those owner-authorized live and external gates
  remain hard blockers rather than offline waivers.
- Next action: obtain fresh bounded security, Sol High, and triggered Sol Max
  reviews against final-16, then close the offline sprint records if no blocker
  or high finding remains.

### 2026-08-03 — Final review remediation and final-18 checkpoint

- Review result and response: the final-16 reviews correctly blocked closure.
  They reproduced acceptance of failed gates, loss of G6 evidence binding,
  same-process mutation races, unsafe attempt paths, missing git-head
  persistence, inherited gate-runner secrets, stale Local Web process handles,
  incomplete inventory coverage, misleading cockpit verification copy, raw
  Playwright retention, and weaker archive/evidence validation. None was
  waived; independent failing-first tests preceded the production fixes.
- Orchestrator remediation: all mutations share one async writer queue;
  concurrent commands and attempt starts have exactly one durable winner.
  Attempt IDs are narrow identifiers. G5/G6 require a non-empty fully passing
  gate set, passed machine gates require evidence, and G6 retains every accepted
  evidence reference. The supplied git head is persisted and verified. Process
  reconciliation requires `pid === pgid` plus start-identity/group binding.
  Immutable run files are digest-bound and verified against the latest manifest
  on reopen.
- Boundary remediation: gate subprocesses receive only an explicit portable
  environment and explicit per-suite values. Playwright raw directories are
  removed in `finally`; TAP outcomes are same-indent, non-SKIP, non-TODO
  matches. Artifact/index traversal rejects symlinks, required wrappers must be
  successful, and staged plus unstaged whitespace is checked. Local Web process
  receipts use PATH-independent OS observation, signal only a verified group
  leader, and publish measured cleanup instead of a literal success flag. The
  cockpit verifies only a non-empty, fully passed set with machine evidence.
- Executable contract: the inventory now has 70 unique scenario IDs and 61
  explicit behavior keys. Canonical wrappers reconciled 11 offline TAP
  selectors, 37 orchestrator TAP selectors, 7 normal gates, 7 attributable
  seeded rejections, and 8 browser aggregates. Chromium and WebKit each
  published 34 passed browser/viewport executions. The final artifact result
  reconciled exactly 70 declared and 70 executed mappings.
- Exact final-18 evidence: a clean `npm ci`, format, lint, strict typecheck,
  workspace tests, evidence-backed offline and orchestrator suites, inventory,
  cockpit build, Chromium, WebKit, Local Web normal and seeded harnesses,
  pre-index, artifact/redaction, changed paths, final index, and final
  validate-only all exited zero. The final index covers 126 files. Root and
  generated-project lock audits reported zero vulnerabilities. Receipt fixture
  atomicity was separately stressed for 20 sequential iterations (60/60 B1
  variants).
- Evidence location: `$TMPDIR/guidelane-s2-gates-final-18.<run>`. Raw command
  logs remain outside the evidence tree; raw browser reports are deleted after
  canonical extraction.
- Deliberate non-pass: no live Claude call, real Safari/Chrome smoke, GitHub
  ruleset change, Anthropic inquiry, commit, push, PR, publication, deployment,
  or friend pilot occurred.
- Next action: repeat bounded security, fresh Sol High, and triggered Sol Max
  review against final-18. Close only if no blocker or high finding remains.

### 2026-08-03 — Final-21 evidence and review-reopen checkpoint

- Deterministic result: final-21 completed the full clean-install offline chain
  without interruption. Its evidence root is
  `/tmp/guidelane-s2-gates-final-21.G4QmJW`; the final index contains 127
  entries and is internally consistent with 71/71 declared/executed mappings,
  38 orchestrator mappings, 7 normal profile gates, 7 attributable seeded
  failures, and 34 Chromium plus 34 WebKit executions. Root and Local Web lock
  audits reported zero vulnerabilities.
- Final-21 also closed the prior exact-gate, immutable run-chain, mandatory
  git-head, all-failure-code publication, uncertain-signal, and current-byte
  comparison defects. A deterministic project-lock test race was corrected by
  retrying transient partial JSON within its existing bounded readiness loop;
  the ownership assertions passed ten consecutive runs.
- Review verdict: offline closure remains blocked. Fresh Sol review proved that
  final indexing could remint the source manifest after substantive gates and
  that the public receipt-after-spawn API has a no-receipt orphan window. It
  also found that real failure publication can strand the novice in a generic
  waiting state. The adversarial review additionally reproduced an active
  attempt becoming unreconcilable after failure publication.
- Security follow-up added three bounded hardening requirements: production
  acceptance must not honor an ambient source-root override; direct
  `ArtifactStore.open` must validate project identity before filesystem access;
  and the HTTP snapshot must omit internal recovery text and evidence paths.
- Accepted launch decision: use a durable pre-spawn intent plus a detached,
  exec-gated wrapper. A plain prepare/attach sequence and direct
  orchestrator-owned spawn both retain the spawn-to-receipt crash window. The
  wrapper may not start an engine until its testable process receipt is durable;
  restart must either reap that verified group or retain a cleanup-capable
  recovery state that blocks replacement work.
- Frozen next action: independent final-22 failing-first tests, followed by
  separated production ownership for orchestrator launch/recovery, public
  protocol/cockpit semantics, and immutable source-evidence tooling. Final-21
  remains diagnostic history, not acceptance. No live call or external
  repository action is authorized.

### 2026-08-03 — Final-22 remediation and pre-canonical checkpoint

- Immutable evidence: `evidence:source` now captures the repository-root source
  manifest exactly once before substantive gates. Every result wrapper carries
  that digest; pre-index, final index, and validate-only preserve and verify the
  original bytes. Production rejects ambient `GUIDELANE_SOURCE_ROOT`.
- Launch and recovery: attempts persist a durable intent before spawn. A
  detached, nonce-bound wrapper proves `pid === pgid` and OS start identity,
  receives a durable receipt, and cannot start the engine before `GO`. Active
  failure publication reaps first or preserves a cleanup-capable recovery state.
- Public boundary: unsafe project identities fail before filesystem mutation.
  Public snapshots are allow-list projections with boolean gate verification;
  recovery reasons, evidence paths/digests, and raw failure material remain
  private. All eleven `RunFailureCode` values have bounded cockpit states and
  real-orchestrator browser coverage.
- Browser contract: the frozen inventory contains `S2-CPT-01..19` and 29 unique
  title/variant cases. Chromium and WebKit must each execute both supported
  viewports, producing 58 results per browser and 116 exact browser executions.
  WebKit requires inline styles for its stylesheet handling; scripts remain
  restricted to same-origin and CORS remains disabled.
- Process-leak evidence: four older test-owned fake-engine groups were observed
  with deleted temporary receipt directories and were explicitly reaped only
  after their exact fixture paths and group identities were checked. Independent
  tests now persist per-run process ledgers and cover success, assertion failure,
  runner `SIGKILL` plus separate recovery, and unverifiable/PID-reuse refusal.
  Two subsequent full orchestrator runs passed with empty exact-fixture process
  scans before and after; the accepted result was 124 pass, zero fail, and one
  opt-in live skip.
- Narrow deterministic evidence: inventory validation, all gate contract tests,
  strict typecheck, cockpit build, 22 WebKit Final-22 failure executions, and
  the full orchestrator suite are green. The inventory now declares 86 unique
  scenarios, including the four process-leak selectors.
- Current state: this is a pre-canonical checkpoint, not offline acceptance. A
  new clean-install immutable-source evidence chain, bounded security audit,
  fresh Sol review, and triggered adversarial review remain required. No live
  Claude call or external repository action occurred.

### 2026-08-03 — Final-22 review remediation, second pre-canonical checkpoint

- Review outcome: the first Final-22 canonical tree was rejected, not waived.
  Its source manifest omitted two unchanged stream-surface files used at test
  runtime, and the wrapper accepted an exact target without a mandatory `GO`
  digest. Review also found destructive existing-target behavior in Local Web
  generation and a project-root symlink escape in the exported artifact store.
- Source identity remediation: production enumeration now matches all 157 Git
  tracked plus untracked-nonignored regular files in deterministic order; no
  changed-path heuristic filters identity. Missing, duplicate, unreadable,
  symlinked, changed, or digest-mismatched entries fail closed. The four source
  regressions and all 27 gate tests pass.
- Intent remediation: durable intent validation covers schema, canonical paths,
  command and payload digests, nonce, and intent digest. `armed`, mandatory
  `GO`, and `started` messages carry the same nonce/digest; the wrapper recomputes
  the exact target intent before spawn. Omitted digest and A-intent/B-target
  tests start no marker. Receipt/intent nonce mismatch reopens in recovery.
- Filesystem remediation: `ArtifactStore.open` rejects the project-root symlink
  before writes. Local Web generation accepts only an absent or real empty
  directory and rejects any existing entry before writes or Git initialization.
  Its external Luna routine run initially failed the owned-path post-check
  because a concurrent Terra writer changed `tools/gates/lib.mjs`; after writers
  were serialized, the rerun passed with no outside-owned-path change.
- UX remediation: five-hour and seven-day rate-limit failures now have distinct,
  truthful Turkish and English wait-only copy; targeted Chromium and WebKit
  tests retain action absence and redaction.
- Executable evidence before the next canonical run: root `npm test` now includes
  all gate tests and passes 245/248 with three intentional live/platform skips
  and zero failures. Orchestrator passes 133/134 with one platform skip, the
  affected intent/recovery set passed five consecutive runs, Local Web target
  tests pass 4/4, gate tests pass 27/27, and no exact test-fixture process remains.
  Inventory now declares 101 unique scenarios.
- Current state: all named review findings have deterministic regressions and
  green narrow/full feedback, but the prior canonical evidence is stale. A new
  immutable-source full chain and fresh security, Sol High, UI/UX follow-up,
  and triggered Sol Max review remain required before offline closure.

### 2026-08-03 — Final-23 interrupted process-gate checkpoint

- Rejected run: the first Final-23 canonical attempt passed clean install,
  Playwright installation, immutable source capture, both lock audits, format,
  lint, strict typecheck, and root workspace/gate tests. Its nested offline
  suite then remained open indefinitely and is not acceptance evidence.
- Root cause: the independent process-leak test discarded direct supervisor
  handles and swallowed cleanup errors in `finally`. In the observed failure,
  the detached engine group was absent but a supervisor remained alive after
  its temporary ledger directory was removed, pinning the Node test process.
  The canonical process group was interrupted; an exact fixture scan afterward
  was empty.
- Test-only remediation: supervisor and failure-harness handles are retained,
  their close waits are bounded, cleanup refusal or error fails the test, and a
  ledger root is removed only after every ledger-owned PID is absent. An
  unverifiable ledger grants no signal authority and leaves the run failed.
- Independent stability evidence: all four selectors passed five consecutive
  executions under a 15-second external timeout, approximately 0.62 seconds per
  run. Exact fixture-process and temporary-ledger scans were empty after each
  execution.
- Current state: production code was unchanged by this remediation. A complete
  replacement immutable-source chain must start from the beginning; the
  interrupted Final-23 artifacts cannot be promoted or repaired.

### 2026-08-03 — Final-24 review rejection and Final-25 pre-canonical checkpoint

- Rejected evidence: Final-24 completed the deterministic offline chain at
  `/tmp/guidelane-s2-gates-final-24.CKcXSL`, bound 157 source files, reconciled
  101 inventory rows, and published 58 Chromium plus 58 WebKit executions.
  Fresh review nevertheless rejected closure: its browser failure proof called
  failure publication directly from an invalid G0 setup, successful recovery
  reconciliation retained the active marker, snapshot-to-WebSocket upgrade had
  a revision race, and committed-source redaction excluded whole protocol and
  hardening test files. The tree remains diagnostic history, not acceptance.
- Attempt and recovery remediation: public direct failure publication was
  removed. `publishAttemptFailure` accepts only the exact active G4 attempt and
  reaps before publishing. Exact reconciliation archives append-only resolution
  history and clears active recovery only after durable resolution. Wrapper
  identity mismatch sends no signal; a locally owned wrapper exit is boundedly
  observed and its exact group is rechecked before interrupted publication.
- Protocol and evidence remediation: every canonical revision has a semantic
  event. WebSocket handoff uses `afterRevision`, contiguous replay or
  `snapshot_required`; the cockpit reloads canonical state on any gap. Source
  redaction now scans every regular source file with truthful totals and only
  the exact hostile-payload fixture exception. The inventory has 110 unique
  rows, including attempt-bound browser failure and the Local Web ownership
  stress test.
- Local Web remediation: readiness is nonce-bound to the exact spawned boot
  child, and detached receipt acquisition is bounded after spawn. Health, axe,
  and smoke cannot be satisfied by a foreign listener. Twenty immediate
  start/stop cycles and repeated cleanup tests leave no owned process alive.
- Independent test remediation: real-orchestrator browser tests now resolve
  repository paths from `import.meta.url`, supply and observe the long-lived
  fake-engine marker, and publish complete Playwright evidence. All intended
  live-attempt fixture calls use unique test-owned markers; one-shot file checks
  use bounded polling.
- Pre-canonical evidence: root `npm test` passed after the production and test
  remediations. A fresh full browser wrapper run built the cockpit and published
  60/60 Chromium plus 60/60 WebKit executions at 1280x800 and 1024x768. The
  Final-24 attempt test passed 20 consecutive runs, and the full orchestrator
  suite passed five consecutive runs with empty exact-fixture process scans.
- Current state: this is not canonical acceptance. The next action is a complete
  clean-install, immutable-source Final-25 evidence chain with no source edits,
  followed by bounded security, UI/UX, fresh Sol High, and triggered Sol Max
  reviews. Live Claude, real Safari/Chrome, GitHub rulesets, inquiry delivery,
  commit, push, PR, publication, deployment, and friend pilot remain unrun.

### 2026-08-03 — Final-25 B1 evidence failure and Final-26 pre-canonical checkpoint

- Rejected run: Final-25 bound 161 source files at
  `/tmp/guidelane-s2-gates-final-25.rB1AA0` and passed clean install, browser
  installation, both lock audits, format, lint, typecheck, root tests, and the
  behavior portion of the evidence-backed offline/orchestrator suites. The
  orchestrator wrapper then stopped because `S2-B1-03` had no exact passed TAP
  record. No later Final-25 gate is acceptance evidence.
- Root cause: the inventory row retained a deleted selector while its separate
  `testName` still appeared in the file, so the preflight inventory validator
  passed. The surviving test only proved durable recovery for an invalid old
  receipt; it did not prove an interrupted terminal record. No existing unique
  selector truthfully discharged the required behavior.
- Independent behavior proof: a new top-level B1-03 launches through the real
  production wrapper, closes/reopens the orchestrator, exactly reaps the owned
  group, and verifies the interrupted snapshot and attempt across a second
  restart. Reconcile then becomes a no-op and the immutable attempt ID cannot be
  reused. The test passed 20 consecutive runs after implementation.
- Production correction: normal exact reconciliation now publishes a failed
  append-only terminal run bound to the source attempt and receipt. Marker-based
  recovery uses the same terminal semantics. If terminal publication fails, no
  event/success result is emitted and the attempt remains durably recoverable.
- Crash correction: `S2-F25-B1` models a process death after terminal manifest
  commit but before marker deletion. Exact reopen finalization validates the
  marker, prior digest, history, referenced attempt, manifest, run, receipt, and
  revision before removing only the stale marker; divergence stays blocked. It
  passed 10 consecutive fresh-process runs. The full orchestrator suite passed
  five consecutive runs with clean exact process scans.
- Gate correction: TAP selectors must now be verbatim-declared in their source.
  Seventeen dynamic titles were migrated to static title tables used by their
  actual tests; the stale-selector regression and all 29 gate tests pass.
- Current state: Final-25 remains rejected and cannot be resumed. Final-26 must
  rerun the complete clean-install immutable-source chain, then receive bounded
  security, UI/UX, fresh Sol High, and triggered Sol Max review. All live and
  external pilot blockers remain unchanged.

### 2026-08-03 — Final-26 review rejection and Final-27 pre-canonical checkpoint

- Rejected evidence: Final-26 completed its immutable-source offline chain at
  `/tmp/guidelane-s2-gates-final-26.jRSn0z`: 162 source files, 110/110 declared
  executions, 140 orchestrator passes with one live-auth skip, 60 Chromium and
  60 WebKit executions, seven clean Local Web gates, seven seeded rejections,
  and a 179-file final evidence index. Fresh review nevertheless found three
  high-severity state/process defects, two material trust-boundary defects, and
  several deterministic UX/evidence gaps. The tree was later invalidated by a
  failed validate-only command that exposed a mutation bug; it is diagnostic
  history and may not be reused.
- Orchestrator remediation: launch environment filtering now occurs before the
  intent or wrapper spawn and is independently repeated at wrapper GO. Only the
  finite portable keys and enumerated internal test markers cross; updater
  disabling is forced. Darwin may add only its measured
  `__CF_USER_TEXT_ENCODING` locale variable after spawn, and a caller cannot
  control its value. Complete snapshot/gate schemas are validated before a
  manifest becomes authoritative. Hostile fields produce a canonical,
  publicly projectable recovery snapshot. Legacy reads publish only canonical
  G0-G6 states. A failure after exact G4 stop but before terminal publication
  durably enters attempt-bound recovery and blocks replacement work.
- Cockpit remediation: allowed semantic activity is localized instead of
  rendered raw; the seven machine gates have distinct novice-safe Turkish and
  English purpose labels; the focus token meets 3:1 contrast against supported
  adjacent surfaces; and overlapping recovery responses cannot lower the
  accepted revision or revive a stale action.
- CI/evidence remediation: validate-only is byte-immutable on success and
  failure. The product workflow grants read-only contents permission, does not
  persist checkout credentials, and uploads the evidence tree only after the
  final validator succeeds. Final-27 adds exact executable coverage for these
  contracts.
- Local Web remediation: every existing target component from the canonical
  anchor is checked before mutation and again before the first write. Symlinks,
  non-directories, foreign ownership where UID metadata is available, and
  group/world-writable components are rejected. The independent suite passes
  11 path-security cases; the foreign-UID fixture is an explicit platform skip
  on an unprivileged owner machine. Same-UID concurrent substitution remains
  outside the pilot threat model.
- Pre-canonical feedback: the new orchestrator contract passes 4/4 and the full
  orchestrator suite passes 144 with one opt-in live-auth skip. Cockpit unit,
  lint, typecheck, build, and eight targeted cross-browser executions pass.
  Gate tests pass 31/31. Local Web path security, the complete profile suite,
  normal harness, and seeded harness pass. The inventory now contains 124
  rows; each browser must publish 64 executions across two viewports.
- Current state: Final-27 must start from a clean install and a new source
  manifest, followed by bounded security/UI review, fresh Sol High, and the
  triggered Sol Max adversarial review. No live Claude call, real Safari/Chrome
  smoke, GitHub ruleset action, inquiry delivery, commit, push, PR, publication,
  deployment, or friend pilot has occurred.

### 2026-08-03 — Final-27 evidence-selector rejection and Final-28 checkpoint

- Rejected run: Final-27 passed clean install, browser installation, both lock
  audits, format, lint, typecheck, and the complete root workspace test. Its
  evidence-backed offline wrapper then stopped before later gates because the
  new `S2-F27-LOCAL-WEB-TARGET-05` inventory selector was a source template
  string rather than one exact runtime TAP title. The two generator/CLI
  executions therefore could not satisfy the exactly-one evidence rule. The
  partial tree and all later absent gates are not acceptance evidence.
- Correction: TARGET-05, TARGET-06, and TARGET-07 now use static top-level
  umbrella titles that execute every prior generator/CLI and group/world mode
  case as awaited subtests. The inventory points to those exact runtime titles;
  no selector expression or duplicate top-level execution remains. TARGET-09
  stays static. Inventory validation, all 31 gate tests, and a complete
  evidence-backed offline wrapper now pass with 124 rows.
- Current state: Final-28 must start from a new source manifest and rerun the
  unchanged complete chain. Final-27 cannot be resumed. All live/external pilot
  blocks and the required fresh security, UI/UX, Sol High, and Sol Max reviews
  remain unchanged.

### 2026-08-03 — Final-28 review rejection and Final-29 checkpoint

- Rejected evidence: Final-28 completed the canonical offline chain at
  `/tmp/guidelane-s2-gates-final-28.g9e5hG`, bound 168 source files at digest
  `69476971bab1b2eddcd442fe806ac0c1e58efb77ed15970cd557a266e4647e73`,
  reconciled 124/124 inventory rows, published 64 Chromium and 64 WebKit
  executions, and produced a 187-file final index. Fresh review still rejected
  closure, so the tree is immutable diagnostic evidence rather than
  acceptance.
- Lifecycle blockers: an exact launched G4 attempt had no trusted successful
  terminalizer; direct G5 publication could leave the process active and then
  prevent G6 acceptance. Separately, three individually valid running-attempt
  records could overwrite the ambiguous recovery state with a later unique
  authority. Independent tests require one explicit exact-attempt completion
  operation, durable evidence-bound completed history, exact reap before G5,
  and a multiplicity latch that never selects or signals any ambiguous record.
- Path-trust findings: the artifact data root, same-origin cockpit static root,
  and Local Web `cwd`/`TMPDIR` anchors did not validate all caller-controlled
  existing ancestors. Independent tests require rejection before mutation or
  static serving while preserving legitimate private owner roots, root-owned
  non-writable OS ancestors, and necessary sticky OS temporary roots.
- Cockpit finding: the language control preceded the current decision in
  natural DOM and keyboard order. Independent cross-language tests require the
  idea input and primary submit, the active approval, or recovery refresh to
  precede the secondary language control without positive `tabindex`.
- Current state: Local Web anchor hardening passes 21 tests with one privileged
  foreign-UID fixture skip. Cockpit keyboard order passes 12/12 in Chromium and
  12/12 in WebKit. The independent gate author expanded the inventory from 124
  to 137 rows and the per-browser matrix from 64 to 76 executions; all 32
  gate-tool assertions pass. Independent root reruns pass 13/13 lifecycle and
  ambiguity tests, 25 artifact/static-root tests with two privileged-fixture
  skips, and 21 Local Web path tests with one privileged-fixture skip. The full
  orchestrator package passes 154 tests with three environment/live skips. A
  complete new immutable-source chain plus bounded
  security, UI/UX, fresh Sol High, and triggered Sol Max reviews remains
  mandatory. Live Claude, real Safari/Chrome, GitHub rulesets, inquiry delivery,
  commit, push, PR, publication, deployment, and friend pilot remain unrun.

### 2026-08-03 — Final-29 pre-canonical checkpoint

- Implemented state: exact successful attempt completion, persistent
  multiplicity recovery latching, artifact/static/generator root ancestry
  validation, and natural cockpit keyboard priority are implemented on their
  disjoint production surfaces. The frozen independent tests were not weakened.
- Independent root feedback: Final-29 lifecycle/recovery passes 13/13;
  artifact/static-root passes 25 with two privileged foreign-UID skips; Local
  Web target paths pass 21 with one privileged foreign-UID skip; Chromium and
  WebKit keyboard journeys each pass 12/12; gate tools pass 32/32. Root format,
  lint, strict typecheck, and workspace tests pass. Workspace totals include
  engine 58 pass with two opt-in live skips, orchestrator 154 pass with three
  environment/live skips, cockpit 10 pass, and Local Web 42 pass with one
  privileged fixture skip.
- Canonical paths: evidence is isolated at
  `/tmp/guidelane-s2-gates-final-29.AONhOX`; command logs are isolated at
  `/tmp/guidelane-s2-gates-final-29-logs.U8YWA8`. HEAD remains
  `952cdf52dffb3acc47fc3918c97183b456eb0cf3`.
- Next action: capture a new immutable source manifest, then run the unchanged
  clean-install, audit, static, workspace, offline, inventory, orchestrator,
  build, cross-browser, Local Web, redaction, changed-path, indexing, and
  validate-only chain without source edits. Any source change rejects the
  entire Final-29 tree.

### 2026-08-03 — Final-29 platform-skip rejection and Final-30 checkpoint

- Rejected run: Final-29 captured 169 source files at digest
  `ea6d0e97c6c7649ebfdbc61ea796c0a3eb4d0b11b573ad4207362e97c1b6beb6`
  and passed clean install, browser installation, both dependency audits,
  format, lint, strict typecheck, workspace tests, the complete offline wrapper,
  and inventory validation. The orchestrator behavior suite then passed 154
  tests with three declared skips, but evidence reconciliation rejected
  `S2-F29-ARTIFACT-ROOT-02` because the inventory incorrectly required a
  privileged foreign-owner fixture to be `passed` on an unprivileged machine.
  The later cockpit build is not acceptance evidence. The entire tree at
  `/tmp/guidelane-s2-gates-final-29.AONhOX` is rejected and cannot be resumed.
- Gate correction: only `S2-F29-ARTIFACT-ROOT-02` and
  `S2-F29-COCKPIT-ROOT-03` may reconcile as platform skips, and only with their
  exact static selector and exact privileged-account reason. Missing, failed,
  TODO, empty or arbitrary skip reasons, duplicates, and every other skipped
  row fail closed. The same rule is enforced by final artifact validation.
  Gate tools pass 33/33, and a fresh orchestrator evidence wrapper passes with
  154 tests plus the three expected environment/live/platform skips.
- Cleanup audit: a post-run process scan found four exact Local Web environment
  fixtures started approximately two hours before Final-29. Their PID, PGID,
  start time, command, and fixture path were verified before exact `TERM`; all
  exited without `KILL`. Current runs did not reproduce the old leak. The
  independent long-lived environment test now requires the exact cleanup result
  and bounded absence of its retained PGID. It passes 20/20 consecutive runs,
  followed by an empty exact fixture scan.
- Final-30 paths: replacement evidence is isolated at
  `/tmp/guidelane-s2-gates-final-30.pnbxf4`; logs are isolated at
  `/tmp/guidelane-s2-gates-final-30-logs.Bz2GWt`. The next action is a complete
  new immutable-source chain with no source edits, followed by bounded security,
  UI/UX, fresh Sol High, and triggered Sol Max review.

### 2026-08-03 — Final-30 review rejection and Final-31 checkpoint

- Rejected evidence: Final-30 completed all 22 canonical offline steps, bound
  170 source files at digest
  `861bc1ff2461ce34d498de22e02b64fb8de29600413e1d924921b063acccc25b`,
  reconciled 137/137 inventory rows, published 76 Chromium and 76 WebKit
  executions, scanned 170 source files plus 210 evidence files, and produced a
  211-entry final index at digest
  `3cff084a62e8f41ccbec70aa03bf5ad84c8db6d73d40ef1d411001aaef3ea169`.
  Fresh close review nevertheless rejected the candidate, so those artifacts
  remain diagnostic evidence only.
- UI/UX rejection: CSS grid auto-placement put the language control in the
  upper-left cell, the persistent rail in the upper-right cell, and the current
  decision below both at 1024×768. Four independent Turkish/English idea and
  recovery layout journeys first reproduced the failure in both browsers.
  Explicit rail/main grid coordinates now preserve the rail on the left and
  the decision pane on the right. The focused Chromium and WebKit preflight
  each pass 20/20 selected executions, and the full replacement browser
  wrappers each pass 84/84.
- Security rejection: successful exact completion committed its immutable G5
  run and manifest before removing `recovery.json`, but reopen could not
  distinguish an exact crash-stranded success marker from corruption. The
  independent crash test now builds its fixture only from production-generated
  durable bytes. Production appends exact-completion history before publishing
  G5; reopen finalizes only an exact marker/history/manifest/run/receipt/evidence
  chain, creates no revision or event, signals no process, reaches G6, and keeps
  a corrupt history fail-closed. The focused test passes 1/1, related recovery
  contracts pass 19/19, root strict typecheck passes, and the orchestrator suite
  passes 155 tests with three declared platform/live skips.
- Frozen next contract: the inventory contains 139 exact rows. Browser evidence
  remains 42 titles at two viewports, or exactly 84 executions per browser.
  Final-31 must recapture the full 22-step immutable-source chain with no source
  edits, then receive a fresh bounded security audit, UI/UX review, Sol High
  review, and risk-triggered Sol Max adversarial review. Any later source edit
  rejects that evidence and requires a new capture.

### 2026-08-03 — Final-31 review rejection and Final-32 checkpoint

- Rejected evidence: Final-31 completed all 22 canonical offline steps at
  `/tmp/guidelane-s2-gates-final-31.qjmen4`, bound 171 source files at digest
  `a476c35a4c33588a9de7feb1a6f5693f7559455abefb7bcc6cee0dcb1de6b179`,
  reconciled 139/139 inventory rows, published 84 Chromium and 84 WebKit
  executions, scanned 171 source files plus 226 evidence files, and produced a
  227-entry final index at digest
  `c9b83583133033efeaa25ae8c7064e011a2acc6a7586e952151631c45d1982e8`.
  Fresh security and Sol review rejected closure, so the tree remains
  diagnostic evidence only.
- Environment and process identity: the S1 engine scrubber still admitted
  arbitrary caller `GUIDELANE_*` variables, and the orchestrator parsed a
  wrapper command line whose source pathname could contain spaces. The engine
  now starts from a finite portable allow-list plus five explicitly named test
  markers. The attempt wrapper publishes a nonce-bound, whitespace-free process
  title and recovery requires exact `ps` command equality. Independent engine
  and path-with-spaces regressions pass.
- Completion crash protocol: exact-completion history is now explicitly a
  prepared intent until the G5 manifest commits. Five production-byte crash
  cuts prove that a missing run reconciles to interrupted recovery; an exact
  durable run with either a still-present fixture but absent process group or an
  already archived fixture publishes G5 once; an already committed G5 only
  removes its exact stale marker; and corrupt history, receipt, or evidence
  remains locked in recovery without a process signal or G5/G6 publication.
- Cockpit recovery: a valid canonical response now clears transient unavailable
  and loading state even when its revision equals the current revision, while
  the existing monotonic guard still rejects older responses. The independent
  real-Vite/Chromium regression and the full cockpit unit suite pass.
- Frozen next contract: the inventory contains 143 exact rows. Browser evidence
  remains 42 titles at two viewports, or exactly 84 executions per browser.
  Root feedback passes engine 58 tests with two opt-in live skips,
  orchestrator 157 tests with three declared platform/live skips, cockpit 11
  tests, and strict workspace typecheck. Final-32 must recapture the complete
  immutable-source chain, then receive bounded security and UI/UX review, fresh
  Sol High review, and the risk-triggered Sol Max adversarial review. No live
  Claude call or external repository action is authorized.

### 2026-08-04 — Final-32 canonical rejection and Final-33 checkpoint

- Rejected evidence: Final-32 completed all 22 canonical offline steps at
  `/tmp/guidelane-s2-gates-final-32.8Btdf3`, with command logs at
  `/tmp/guidelane-s2-gates-final-32-logs.07gOQT`. It bound 174 source files at
  digest `42c95b8f07599b7f8a8410ad401f1f4ec6a6e2a3f350c36b3e9e3db1fe7ebd99`,
  reconciled 143/143 inventory rows, published 84 Chromium and 84 WebKit
  executions, and produced a 227-entry final index at digest
  `fe118e62369e7adba7c03d83e4c4c9752465bf7203d023c48cefdff766288a92`.
  Fresh security, Sol High, and triggered Sol Max review rejected closure, so
  the tree remains immutable diagnostic evidence only.
- Recovery and lock rejection: a second crash after exact interruption history
  but before prepared completion finalization could leave a permanent recovery
  marker; a canonical completed G5 manifest restored beside its exact running
  fixture could remain stranded; and an opaque takeover guard could permanently
  strand a verifiably dead lock. Final-33 adds exact nested reconciliation,
  exact no-signal archival of a crash-stranded completed attempt, and a signed
  takeover guard bound to the unchanged predecessor lock digest and successor
  receipt. Only confirmed `ESRCH` means gone; `EPERM`, `EACCES`, unknown probe
  errors, malformed guards, changed locks, and live identities remain
  fail-closed. Mutable marker deletion is parent-directory synced.
- Cockpit and engine rejection: an equal-revision canonical recovery response
  could clear transient unavailability without replacing a stale action, while
  the engine receipt reported `inherited: 0` despite crossing finite allow-listed
  operator entries. Final-33 compares equal-revision canonical state before
  deciding whether to replace it and reports exact inherited versus omitted
  environment counts without including forced internal updater state.
- Independent feedback: the three focused orchestrator crash files pass 6/6;
  root strict typecheck passes; the full orchestrator package passes 163 tests
  with three declared platform/live skips; the serialized cockpit suite passes
  12/12. The frozen inventory contains 151 exact rows, including eight Final-33
  regressions. Browser evidence remains 42 titles at two viewports, or exactly
  84 executions per browser. The next action is a complete new immutable-source
  chain followed by bounded security and UI/UX review, fresh Sol High review,
  and risk-triggered Sol Max adversarial review. No live Claude call or external
  repository action is authorized.

### 2026-08-04 — Final-33 canonical rejection and Final-34 checkpoint

- Rejected evidence: Final-33 completed all 22 canonical offline steps at
  `/tmp/guidelane-s2-gates-final-33.yjIgRE`, with command logs at
  `/tmp/guidelane-s2-gates-final-33-logs.Hp2kEl`. It bound 178 source files at
  digest `98aa7f456de4ce8e6ba6de22bbfd2a6609d69b25c8362e77e494e6ab211b05de`,
  reconciled 151/151 inventory rows, published 84 Chromium and 84 WebKit
  executions, and produced a 227-entry final index at digest
  `196efd28f7bb6f94ff459f5d286ee7bc3be22b2e614a5a557da2b7a394ecc721`.
  Fresh Sol and security review rejected closure, so that evidence remains
  immutable diagnostic material only.
- Project-lock and process-identity rejection: a crash after replacement lock
  rename but before takeover-guard removal left a guard that recognized only
  its dead predecessor and permanently blocked acquisition. Separately, every
  production `ps` inspection resolved through ambient `PATH`, allowing a hostile
  launcher to substitute a binary. Final-34 accepts only a stable, exact,
  guard-bound dead successor receipt as the additional reclamation state, keeps
  all malformed/live/unobservable cases fail-closed, and uses `/bin/ps` on the
  macOS/Linux policy targets. Unsupported hosts fail before a process-ownership
  decision.
- Engine and cockpit rejection: `EngineSession.start()` treated a failed
  liveness probe as absence and could continue after detached spawn without a
  registry-bound receipt; an equal-revision canonical recovery could still show
  an earlier semantic activity message. Final-34 takes provisional ownership of
  only the just-spawned group before receipt observation, reaps and rejects it
  on `EPERM`, `EACCES`, or unknown observation, and never falls back to a bare
  pid. Cockpit canonical equality now includes schema and blueprint revisions;
  a differing canonical snapshot clears old activity before rendering state.
- Independent preflight: all four Final-34 regressions pass. The engine
  unobservable-receipt fixture uses atomic marker publication and passed three
  consecutive runs across `EPERM`, `EACCES`, and unknown arms. Root format,
  lint, strict typecheck, workspace tests, and the inventory contract pass.
  Current package totals are engine 60 passed with two opt-in live skips,
  orchestrator 165 passed with three declared platform/live skips, cockpit 13
  passed, and Local Web 42 passed with one privileged-fixture skip. The frozen
  inventory contains 155 exact rows; browser evidence remains 42 titles at two
  viewports, or exactly 84 executions per browser. Final-34 must now capture a
  new complete immutable-source chain, then receive bounded security and UI/UX
  review, fresh Sol High review, and risk-triggered Sol Max adversarial review.
  No live Claude call or external repository action is authorized.

### 2026-08-04 — Final-34 canonical rejection and Final-35 checkpoint

- Rejected evidence: Final-34 began a new canonical chain at
  `/tmp/guidelane-s2-gates-final-34.VZoPU7`, with command logs at
  `/tmp/guidelane-s2-gates-final-34-logs.QeAi25`. It captured 182 source files
  at digest `1f4801dca91224c46819e830c135189d26f7ae5fec344adfa278a7088c640a6c`
  and passed clean installation, browser installation, both dependency audits,
  format, lint, and strict typecheck. The workspace-test step was then red, so
  no later wrapper, browser, profile, or final-index result may be reused.
- Failure: the Local Web long-lived command test received its owned child's
  `close` event in the small interval before `stopCommand()` attached its
  cleanup listener. The only timeout in that await path was unreferenced, so
  Node observed a pending promise with no live handle and cancelled the test.
  This was reproduced by an independent deterministic close-before-listener
  fixture three consecutive times; the failure is not waived as a timing flake.
- Final-35 remediation: all Local Web close/timeout races now use a referenced,
  bounded `waitForChildClose` helper with a post-registration terminal-state
  check. Receipt and group-absence timers no longer disappear while their
  results are awaited. Exact group ownership, negative-PGID-only signalling,
  and fail-closed cleanup remain unchanged. The focused regression passes three
  consecutive independent runs; the full Local Web package passes 43 tests with
  one declared privileged-fixture skip, and strict root typecheck passes.
- Frozen next contract: `S2-F35-LOCAL-WEB-CLEANUP-RACE` raises the inventory to
  156 exact rows; `recovery-b1` is 36 rows with a minimum of 9. Browser evidence
  remains 42 titles at two viewports, or exactly 84 executions per browser.
  Final-35 must capture a complete new immutable-source chain and then receive
  bounded security and UI/UX review, fresh Sol High review, and risk-triggered
  Sol Max adversarial review. No live Claude call or external repository action
  is authorized.

### 2026-08-04 — Final-35 canonical rejection and Final-36 checkpoint

- Rejected evidence: Final-35 began a fresh source-bound chain at
  `/tmp/guidelane-s2-gates-final-35.BVKZ3r`, with command logs at
  `/tmp/guidelane-s2-gates-final-35-logs.dAoGkR`. Its prior successful steps
  remain diagnostic only: the Chromium journey step was red for
  `CPT-E2E-G0-G6` and `CPT-E2E-FINAL-27-I18N-ACTIVITY-20` at both required
  viewports. A valid semantic phase event was followed by its matching canonical
  recovery, but the cockpit showed the generic waiting state. No partial
  browser, profile, or final-index evidence is carried forward.
- Cause and bounded remediation: activity had been stored as unbound display
  text, so a command/event recovery race could clear it. Final-36 stores the
  semantic event revision, validates every displayable message against a fixed
  local stage/run/decision meaning, retains it only when the canonical snapshot
  proves the same meaning, and derives a missed compatible activity only from
  that fixed mapping. A genuinely contradictory or unknown canonical state
  clears activity. The change does not add an engine event, raw payload field,
  file path, reasoning, diff, or terminal disclosure to the cockpit contract.
- Independent feedback: `apps/cockpit/test/final-36-semantic-activity-recovery.test.ts`
  passes five deterministic browser-integration scenarios: matching recovery,
  legitimate transition, equal-revision event after recovery, missed-event
  fallback, and contradictory same-revision recovery. The existing Final-33/34
  monotonicity and stale-activity regressions also pass. After a fresh cockpit
  build, the two affected novice-journey titles pass at both 1280×800 and
  1024×768 Chromium viewports (4/4). An ad-hoc replay was explicitly rebuilt
  because its fake server serves the ignored `dist` directory; this did not
  alter the rejected source-bound Final-35 outcome.
- Frozen next contract: `S2-F36-CPT-MATCHING-SNAPSHOT`,
  `S2-F36-CPT-PHASE-TRANSITION`, `S2-F36-CPT-EQUAL-REVISION-EVENT`,
  `S2-F36-CPT-MISSED-EVENT-FALLBACK`, and
  `S2-F36-CPT-CONTRADICTORY-SNAPSHOT` raise the inventory from 156 to **161**
  exact rows. They add no browser title, viewport, or execution: the browser
  matrix remains 42 titles and exactly 84 Chromium plus 84 WebKit executions.
  Final-36 must now capture a complete new immutable-source chain and then
  receive bounded security and UI/UX review, fresh Sol High review, and
  risk-triggered Sol Max adversarial review. No live Claude call or external
  repository action is authorized.

### 2026-08-04 — Final-36 canonical run rejection and Final-37 checkpoint

- Immutable evidence: Final-36 ran its complete 22-step offline chain in
  `/tmp/guidelane-s2-final36.gPYxai`, with command logs in
  `/tmp/guidelane-s2-final36-logs.pxAs2D`. It captured 183 source files at
  SHA-256 `2d662c7be5e987e5e9cfebb15cb5e71aee4fcc495eac29ab1c88682f904aab10`.
  The final index contained 227 results at SHA-256
  `7570f3b6a96390d850fafa7e5ed4850b7e34cc38166d6e82d77c367faab0294b`.
  All 22 commands passed, including the 161-row inventory, 84 Chromium and 84
  WebKit executions, and final validate-only artifact verification. This
  evidence is diagnostic only after subsequent source changes.
- Review rejection: the bounded security audit found that `cwd`/`TMPDIR`
  trusted-anchor selection validated only a private leaf, not its unsafe
  existing parent, and that product-offline invoked mutable GitHub Action tags
  before source-manifest capture. A separate fresh read-only review found that
  an event at revision R could be followed by a browser-cached canonical
  snapshot at R-1, restoring stale controls while the semantic event was newer.
  The rendered Final-36 UI/UX review found no blocker within the automated
  desktop scope. Native Sol reviewers could not be scheduled because completed
  native review threads exhausted the runtime slot limit; the independent
  read-only review is explicitly a degraded external fallback, not a substitute
  for the required fresh Sol roles at close.
- Frozen Final-37 contract: independent tests must precede production edits.
  `FINAL-37-LOCAL-WEB-ANCHOR-04` requires fresh direct-generator and CLI
  children to reject a `0700` private ambient leaf beneath a current-user
  `0777` existing parent. `CPT-FINAL-37` requires a newer event to establish a
  canonical revision floor, hide controls for a stale R-1 response, and recover
  only when canonical R arrives. `ORCH-FINAL-37` requires authenticated
  canonical GET `Cache-Control: no-store` while preserving the missing-Origin
  read exception. `S2-F37-WORKFLOW` requires every product-offline Action
  reference to use a full immutable commit SHA. No browser title or viewport is
  added; the matrix remains 42 titles and 84 executions per browser.

### 2026-08-04 — Final-37 R4 diagnostic rejection and safe refresh contract

- Rejected evidence: Final-37 R4 captured 183 source files at
  `/tmp/guidelane-s2-final37r4.XYAskR`, then passed clean installation,
  browser installation, both high-severity audit gates, formatting, lint, and
  strict typecheck. `npm test` is red, so the source capture and all preceding
  command results are diagnostic only and no later evidence may be combined
  with them. The root audit reported no vulnerabilities. The Local Web profile
  audit exits at the frozen high-severity threshold but reports two moderate
  `postcss` advisories; that residual is not waived or hidden.
- Cause: Final-37 correctly hides mutating controls while `unavailable` is
  true, but the older Final-32 and Final-33 browser fixtures retried a
  transient canonical GET by clicking the now-hidden mutating control. With
  their intentionally idle WebSocket, this also exposed a real novice escape
  hatch gap: a user could not issue a non-mutating canonical refresh. Final-34
  additionally supplied a revision-34 canonical snapshot after emitting a
  revision-35 semantic event; the Final-37 floor correctly rejects it as
  stale. These are compatibility and test-contract failures, not a reason to
  weaken the revision floor.
- Accepted client decision, after bounded independent client-architecture
  advice: while `unavailable` is true, render one localized, non-mutating
  `messages.recovery` action that invokes only canonical snapshot GET recovery.
  It must not call `send` or reveal any mutating decision action. A successful
  eligible canonical snapshot clears `unavailable`; a failed or stale snapshot
  keeps it set. Final-32/33 must exercise this read-only action and prove no
  additional command POST occurs; Final-34 must offer canonical revision 35
  after the revision-35 event, followed by revision 34 as the stale fixture.
  The frozen Final-37 selector continues to prove that the decision controls,
  not the read-only refresh, remain suppressed before canonical revision R.
- Next ownership and verification: an independent test author owns only the
  three affected cockpit test files and must retain their scenario identities
  while strengthening the non-mutating refresh assertion. A separate
  implementer owns only `apps/cockpit/src/main.tsx`. After focused red/green,
  Final-38 must start a wholly fresh immutable-source chain, retain the 165-row
  inventory and frozen 42-title / 84-per-browser matrix, then repeat security,
  UI/UX, fresh Sol, and adversarial review before any closure claim. No live
  Claude call or external repository action is authorized.

### 2026-08-04 — Final-38 safe refresh RED/GREEN checkpoint

- Independent test ownership: the test author changed only
  `apps/cockpit/test/final-32-recovery.test.ts`,
  `apps/cockpit/test/final-33-equal-revision-state-change.test.ts`, and
  `apps/cockpit/test/final-34-canonical-activity.test.ts`. Before production
  changes, the three-selector command was intentionally red only because the
  localized safe-refresh control did not exist in Final-32/33; Final-34 was
  green after its revision-35 canonical fixture correction. Lint and
  `git diff --check` were green, and test-owned Vite/browser processes were
  confirmed absent.
- Separate production ownership: the implementation changed only
  `apps/cockpit/src/main.tsx`. Its mutually exclusive workflow branch renders
  `messages.recovery` when `unavailable` or canonical `recovery-required` is
  true, and calls only `recover()`. Decision actions remain derived from
  `!loading && !unavailable`, so the refresh cannot submit a command or restore
  a stale decision. It does not change revision floors, server cache headers,
  WebSocket semantics, i18n catalogs, or the public protocol.
- Independent deterministic focused GREEN: root reran Final-32, Final-33,
  Final-34, all five Final-36 cases, and Final-37 in one serialized browser
  command: 9/9 passed. `CPT-RECOVERY-MONOTONIC-27`, Cockpit lint, strict
  Cockpit typecheck, and `git diff --check` also passed. The updated Final-32
  and Final-33 fixtures prove that Refresh status causes a canonical GET but
  no additional command POST. Final-37 still proves that stale R-1 does not
  expose Share idea or Approve blueprint before canonical R is accepted.
- Frozen next action: start Final-38 from a new artifact root; do not reuse
  any R4 source capture, test, browser, profile, or index result. The inventory
  stays at 165 rows and the browser matrix remains 42 titles / 84 executions
  per browser. No live Claude call or external repository action is authorized.

### 2026-08-04 — Final-38 canonical acceptance and Final-39 Git-boundary checkpoint

- Immutable diagnostic evidence: Final-38 completed the full source-bound
  offline chain at `/tmp/guidelane-s2-final38.oD5qR6`. It captured 183 source
  files at SHA-256
  `0f772678a08ad00a643fcdb4d824ebaa42465f67831193b5dd158ffd306cd693`,
  reconciled all 165 inventory scenarios, published 84 Chromium and 84 WebKit
  executions, and produced a 227-entry final index at SHA-256
  `d29d545e2945936c0d62c85fb89f7d82406b508bea6d4ea0e3e989035f852128`.
  Every frozen offline command passed. Root audit found no vulnerabilities;
  the profile audit met its high-severity threshold but still reported two
  moderate upstream `postcss` advisories. No live Claude/authentication call
  was made; expected live and privileged-fixture skips remain explicit.
- Review result: rendered UI/UX review found no material issue inside the
  automated desktop evidence boundary. The bounded security audit found a
  medium-confidence Git child-process boundary: `profiles/local-web/src/git.ts`
  resolves `git` through ambient `PATH` and inherits the complete supervisor
  environment. An attacker-influenced executable, Git configuration, template,
  or hook could run during generated-project initialization. Final-38 cannot
  close the sprint and its evidence is diagnostic after remediation begins.
- Accepted Final-39 decision: use a trusted absolute Git executable plus a
  finite explicit child environment. Parent `PATH`, Git control variables,
  templates/hooks/configuration, and secret-like variables must not cross.
  Unsupported or unavailable trusted Git fails closed before repository
  mutation. Generation, repository-local identity, accepted snapshots, and
  rollback must remain supported. The low-confidence EngineSession stale-PGID
  observation remains a residual for the later risk-triggered Sol Max review;
  it is not widened into this confirmed Local Web defect.
- Independent ownership: gate-author advice froze
  `S2-F39-LOCAL-WEB-GIT-01`, a new `local-web-git-security` category minimum,
  exact static selector validation, and a required coverage mapping. The
  independent test author owns the failing-first regression in
  `profiles/local-web/test/git.test.ts`; a separate production implementer
  will own only `profiles/local-web/src/git.ts`; the gate author will own only
  the inventory and validator amendment. No actor may modify another role's
  surface.
- Next action: author and run the hostile inherited-environment regression
  before production code changes, then implement the narrow Git boundary and
  rerun the complete Final-39 source-bound offline chain followed by fresh
  security, Sol High, and risk-triggered Sol Max review. No live Claude call or
  external repository action is authorized.

### 2026-08-04 — Final-39 Git-boundary RED/GREEN checkpoint

- Independent contract: the gate author added one additive scenario,
  `S2-F39-LOCAL-WEB-GIT-01`, a `local-web-git-security` minimum of one, an
  exact required-coverage mapping, and static top-level selector validation.
  The executable inventory now contains 166 rows; `npm run test:s2-contract`
  passes after the test exists.
- Independent RED: before production changes, the test author ran
  `node --test --test-concurrency=1 --experimental-strip-types
  profiles/local-web/test/git.test.ts` once. It exited one because the current
  helper resolved ambient `PATH` and selected the harmless counterfeit Git.
  The final test fixture keeps that counterfeit, hostile `GIT_CONFIG_*`,
  template, hook, and harmless secret sentinel inputs, but makes the
  counterfeit delegate to `/usr/bin/git` so the final assertions cover all
  inherited-control paths. It also proves unavailable trusted Git preserves a
  caller sentinel and creates no `.git` metadata.
- Separate production ownership: only `profiles/local-web/src/git.ts` changed.
  Git now uses an absolute `/usr/bin/git` policy, a finite literal environment,
  fresh fixed `/tmp` HOME/config/template/hook runtime, no inherited Git
  controls, command-scoped hook/template overrides, and `finally` cleanup.
  Missing or unavailable trusted Git fails before `git init`; a lexical,
  restored test-only unavailability seam is not re-exported from the public
  profile entry point.
- Focused GREEN: the Final-39 test passes 2/2 after implementation; strict
  Local Web typecheck, its complete serialized workspace suite, the inventory
  validator, and `git diff --check` pass. The test author repaired a strict
  test-only marker type after the first feedback run; no production behavior or
  gate was weakened.
- Next action: update final documentation before a new source capture, then
  run the complete Final-39 immutable offline chain. It must be followed by a
  fresh bounded security audit, Sol High review, and risk-triggered Sol Max
  review before governed close. No live Claude call or external repository
  action is authorized.

### 2026-08-04 — Final-40 canonical acceptance and review checkpoint

- Immutable acceptance evidence: the complete source-bound offline chain passed
  at `/tmp/guidelane-s2-final40.7TyraS`. Its source manifest contains 183
  files with SHA-256
  `54f2ff6ceef6a8fd3c5ccd6f5f9fed47d69df4078f0fec3d029de37664bbb179`.
  The final immutable index contains 227 records with SHA-256
  `5ee997a8c0b1e24b3cb9a6ba6acd0ec6023ac847798a0eb1970df78880456a35`.
  `npm ci`, root and generated-profile high-severity audit thresholds,
  formatting, linting, strict type checks, repository tests, all offline and
  orchestrator safety suites, the 166-row inventory, Cockpit build, 84
  Chromium and 84 WebKit browser executions, normal and seeded Local Web
  harnesses, evidence/redaction validation, and changed-path validation all
  exited zero. The profile audit still reports two moderate transitive
  `postcss` advisories; they are recorded rather than waived.
- Bounded security audit: no inherited-environment bypass was confirmed after
  the Final-39 Git boundary. It identified a conditional Medium risk only if a
  caller supplies or later tampers with an existing Git repository: local
  `.git/config` remains a Git input. S2 generation accepts only absent or
  verified empty targets and creates the repository itself; importing or
  managing an existing repository is outside the frozen product path. This is
  a scope boundary, not a claim that arbitrary existing repositories are safe.
- Fresh Sol High review found no material defect in the bounded Git/profile
  surface and judged the fresh-generated-project boundary enforceable for S2.
  Fresh risk-triggered Sol Max review likewise found no confirmed blocker or
  High finding. It retained two explicit limits: existing or subsequently
  tampered repositories require generated-project attestation or Git-config
  neutralization before they may be supported, and PID/PGID verification to
  signalling retains a low-probability macOS race under the single-user,
  single-active-phase threat model.
- Expected omissions remain explicit: two engine live tests, one live
  orchestrator auth test, two privileged orchestrator foreign-owner fixtures,
  and one privileged Local Web foreign-owner fixture are skipped; no live
  Claude/authentication command, real Safari/Chrome smoke, Anthropic inquiry,
  GitHub ruleset action, commit, push, pull request, publication, or deployment
  occurred.
- Next action: persist the governed close records, then run a fresh complete
  source-bound offline sequence. This checkpoint changes source documentation,
  so Final-40 evidence must not be presented as evidence for the post-checkpoint
  source state.

### 2026-08-04 — Final-41 governed offline close

- Outcome: S2's offline novice-pilot safety spine is closed. The delivered
  scope remains a single-user, single-project, Local Web implementation slice;
  it is not a friends-pilot distribution approval or a live-engine claim.
- Final source-bound acceptance: `/tmp/guidelane-s2-final41.Ss0se7` captured
  183 source files at SHA-256
  `a1d9ce026570991624c002338e2289a26efb16a33a0ccf268fc50e90a66175bd`.
  Its 227-record immutable final index passed at SHA-256
  `036d4240d0cd2c83c7ab82210d0eda7ca30b604f1c6e2eb4191e983718187cb3`.
  The exact frozen command sequence passed from clean install through final
  `gate:artifacts --validate-only`: root/package high-severity audit thresholds,
  format, lint, type checks, repository tests, 48 offline execution records,
  166 inventory scenarios, 79 orchestrator execution records (three explicit
  skips), Cockpit build, 84 Chromium and 84 WebKit browser results, eight
  normal Local Web records, seven seeded-failure rejections, redaction, and
  changed-path validation.
- Independent review separation remained intact. The Final-39 Git regression
  was authored independently, the Git boundary was implemented by a separate
  writer, and the inventory amendment was owned separately. The bounded
  security audit, fresh Sol High review, and risk-triggered Sol Max review all
  reported no confirmed blocker or High finding for the frozen fresh-generation
  scope.
- Deferred/non-passing-by-design evidence: two engine live tests, one live
  orchestrator auth test, and three privileged foreign-owner fixtures remain
  skipped; the profile dependency audit still reports two moderate transitive
  `postcss` advisories. Real Safari/Chrome, authenticated minimal-environment,
  supervised live G0–G6, Anthropic written approval, GitHub required checks,
  and observed owner-installed novice sessions remain hard prerequisites for a
  friends pilot.
- Final close checkpoint: the duplicate validation ran from the documented
  close state at `/tmp/guidelane-s2-final42.7jcrWk` and passed. It captured 183
  sources at SHA-256
  `dcf1574d0ea54edbc44219d844fa02e0c005cfbd4cbd822ee74ce59ecda2f7f1` and
  published a passed 227-record index at SHA-256
  `bb667d8b89d43258b34adfc3f000a87d6a0e62e71da767e81d60981c3ac82820`.
  It adds no production behavior or scope.

### 2026-08-04 — Final-44 Local Web orphan-cleanup remediation

- Closure is reopened. A read-only post-close process inspection found a
  test-owned normal-harness Local Web server group still alive after the
  harness had returned. The exact group and its temporary generated-project
  provenance were verified before it was terminated. This invalidates the
  previous close claim for the current source state; it does not rewrite or
  waive the historical Final-41/42 evidence.
- Root cause: `npm run start` can lose or reparent the child originally used as
  the detached group leader. The old cleanup logic correctly refused to signal
  a stale leader, but that left a verified descendant group without a safe
  final kill authority.
- Independent contract: `S2-F44-LOCAL-WEB-ORPHAN-CLEANUP` is an additive
  inventory scenario. Its test uses one test-owned loopback port and a fresh
  process receipt, proves a real generated Next health response while live,
  and proves both the exact port and exact owned group are absent after the
  normal harness returns. The pre-implementation test was red without starting
  a server because the required narrow observer boundary did not yet exist.
- Implementation direction: only Local Web live-server startup receives a
  durable detached supervisor leader. The leader remains identity-verifiable
  through TERM grace, allowing the existing stale-receipt rule to authorize a
  final group kill only while that identity remains exact. Observer and health
  failures must clean their locally held server before returning a redacted,
  failed gate result. Cleanup summaries contain stage, ownership, reap result,
  and an opaque receipt digest only; they do not persist paths, ports, nonces,
  commands, or environments.
- Next action: complete the independent observer-failure regression, run the
  full source-bound offline acceptance from a new artifact root, then repeat
  the bounded security audit and fresh Sol High/Max reviews. No live Claude
  call or external repository action is authorized during remediation.

### 2026-08-04 — Final-44 review-reopened checkpoint

- The first fresh source-bound Final-44 offline chain is diagnostic, not
  closing evidence. It passed against 184 captured source files at SHA-256
  `eff8da5364980089dfd496dd0a08f084faae993a6804a4fdacaaa2e0d860041a` and
  a 227-record final index at SHA-256
  `4955c5179e75558fad83c94a1ad77e015f3da9ead6e3668a216a5d32ed31a510`.
  The normal and observer-failure regressions passed, but post-gate independent
  review found lifecycle contracts not covered by that green result.
- Confirmed closure blockers: the stored process identity uses second-granular
  `ps lstart`, so a same-second PID/PGID reuse can be indistinguishable before
  a negative-PGID signal; the old stale-receipt test bypasses the stored receipt
  path instead of exercising that comparison. The observer-failure and
  stale-receipt regressions also lack their own immutable inventory selectors.
- Confirmed security-lifecycle gaps: the durable supervisor intentionally
  ignores TERM without a parent-liveness lease or bounded self-reap fallback;
  a controller crash can leave the group alive. Ownership is transferred before
  boot evidence is persisted, so an evidence-write failure can strand the live
  server. A receipt-acquisition failure can also report an incomplete cleanup
  state. These findings reopen implementation; no close claim is authorized.
- Frozen next decision: retain the single-user fail-closed contract. A new
  design must establish a non-reusable supervisor identity, support bounded
  controller-loss cleanup, retain cleanup ownership through evidence
  publication, fail honestly when identity cannot be established, and freeze
  all new failure paths in the immutable inventory before a separate writer
  changes production code. No live Claude call or external repository action
  is authorized.

### 2026-08-04 — Final-45 lease-supervision decision

- Accepted architecture: use one internal lease supervisor for every detached
  Local Web command, not only the persistent generated server. The parent owns
  a private pipe endpoint but never signals a negative PGID. EOF, authenticated
  STOP, supervisor TERM, control failure, and unexpected child completion make
  the live detached supervisor reap its own current group with bounded
  TERM-to-KILL escalation. This removes the stale PID/PGID/start-time receipt
  from parent signal authority.
- The protocol uses a random per-launch readiness correlation value and a
  parent-held lease. PID, PGID, and start time remain diagnostic/test evidence
  only. A missing, malformed, or late readiness/control result closes the
  lease, blocks transfer, and reports cleanup as unverified unless absence is
  directly observed. It does not claim restart reconciliation or cross-platform
  support.
- State order is fixed: `SPAWNING -> LEASED -> READY -> BOOT_VERIFIED ->
  BOOT_EVIDENCE_DURABLE -> TRANSFERRED -> STOPPING -> REAPED | REAP_FAILED`.
  For finite commands, terminal output is accepted only after descendant
  cleanup. For the persistent server, boot evidence must succeed before the
  normal harness receives ownership; a boot-evidence write failure remains in
  the boot frame until it has attempted cleanup.
- Scope and non-goals: macOS/Linux POSIX group support only; no durable recovery
  daemon, restart-time Local Web signalling, Windows support, arbitrary
  descendant enumeration, or raw lifecycle identifiers in artifacts. A process
  killed outside the supervisor's own orderly control boundary is not declared
  recoverable after restart.
- Independent next work: the gate author owns immutable selectors for
  controller loss, evidence persistence failure, control failure, stale-parent
  signal refusal, finite command cleanup, and the existing normal/observer
  paths. A separate test author will make them RED before a separate production
  writer changes the command, supervisor, harness, and type surfaces.

### 2026-08-04 — Final-45 frozen gate and RED-test checkpoint

- Independent gate ownership changed only `tools/gates/s2-test-inventory.json`
  and `tools/gates/validate-inventory.mjs`. The inventory now requires 173
  scenarios: two durable Final-44 orphan-cleanup selectors and six additive
  `local-web-lease-supervisor` selectors. The contract first failed because
  the new test file was absent; after the independent test author supplied the
  exact static selectors, `npm run test:s2-contract` passed without weakening
  an existing scenario.
- Independent test ownership changed only
  `profiles/local-web/test/lease-supervisor.test.ts`. It binds a test-owned
  controller through nonce/cwd IPC, then requires controller TERM to release
  the authenticated generated-server port and group. It also requires a
  boot-evidence persistence fault after health, malformed supervisor control,
  stale diagnostic refusal, finite completion and timeout descendant cleanup,
  and source-level absence of parent negative-PGID signalling.
- Genuine pre-implementation RED evidence: the source regression finds the
  existing `kill(-receipt.pgid, signal)` parent route, and the finite lifecycle
  regression observes the old durable supervisor remain alive until a parent
  timeout. Strict Local Web type checking and `git diff --check` passed for the
  independent test addition. The real generated-server controller-loss and
  evidence-fault cases are deliberately deferred to post-implementation so
  their red run cannot leave an unattended server.
- Required production seam: an optional, in-memory-only
  `testFaults.failBootEvidencePersistence` input to `runNormalHarness`, applied
  only after authenticated health and before boot evidence publication or
  ownership transfer. It must not enter public profile exports, generated
  project output, or persisted evidence.

### 2026-08-04 — Final-46 security reopen and frozen resolution

- Final-45 source-bound evidence is diagnostic only after the fresh bounded
  security audit confirmed two Medium fail-closed gaps. A post-start `/bin/ps`
  observation outage made the live supervisor exit without signalling its
  target group, and an existing `gates/boot.json` `passed` record could survive
  a later failed replacement write. Neither issue is waived by the Final-45
  green suite.
- Accepted containment decision: before target start, the detached supervisor
  must establish that its *currently executing* PID is its own process-group
  leader. That non-transferable, in-memory self-containment capability remains
  valid while that same supervisor process lives; later diagnostic-observation
  outages must not remove its authority to signal `-process.pid`. A failed
  self-signal syscall is fail-stop: the supervisor remains alive and retries
  cleanup rather than voluntarily exiting while containment is unproved. The
  parent retains no negative-PGID authority.
- Accepted boot-evidence decision: each boot uses a fresh attempt ID and a
  durable `pending` authority before a target starts. Candidate gate detail is
  attempt-scoped and cannot alone grant a pass. Only a matching durable
  terminal authority can represent a passed boot attempt; missing, pending,
  malformed, unreadable, mismatched, or failed authority is fail-closed. A
  later failure-record write may leave `pending`, but it may never make a prior
  attempt's pass authoritative for the new run. The terminal harness result
  must bind its invocation identity to the consumed boot attempt.
- Independent next work is frozen: the gate author owns new immutable
  Final-46 selectors and inventory semantics; the test author makes the
  post-proof observation, self-signal, and attempt-authority regressions RED;
  a separate production writer owns only Local Web command, supervisor,
  evidence, harness, and type surfaces. Final-46 requires a new complete
  source-bound offline capture, a fresh bounded security audit, fresh Sol High
  review, and risk-triggered Sol Max review before any close record is updated.

### 2026-08-04 — Final-47 artifact-authority classification reopen

- The Final-46 source-bound acceptance chain reached the global artifact gate
  after Chromium, WebKit, normal Local Web, and seeded Local Web evidence had
  passed. It then failed closed because the global validator classified the
  newly durable `attempt-authority` record as an unknown native evidence kind.
  The incomplete Final-46 artifact root is diagnostic only and cannot be used
  as closing evidence.
- Accepted compatibility decision: a normal passed Local Web harness result
  now requires exactly one attempt-scoped authority triplet beneath
  `local-web/native/attempts/<attemptId>`. The authoritative native result and
  its three signed records must bind one exact attempt ID, candidate digest,
  and terminal result identity. Legacy/missing Final-46 authority records are
  intentionally rejected for a normal passed run; accepting them would permit
  a pre-authority pass to stand in for a current attempt.
- The global artifact gate must retain its existing treatment of ordinary
  Local Web native records. It may not merely add the three new kind strings to
  a generic allow-list: it must enforce canonical paths, exact schemas,
  SHA-256 digests, passed statuses, one-triplet cardinality, and cross-binding
  to `local-web/native/result.json`. Unknown, pending, failed, malformed,
  stale, duplicate, extra, or misplaced attempt records remain red.
- Independent roles are re-opened narrowly: a gate author has frozen the
  contract, a test author owns the validator regression fixture, and a separate
  implementation writer will own only `tools/gates/gate-artifacts.mjs` after
  the test is green. The full source-bound acceptance chain, fresh security
  audit, and fresh Sol reviews repeat after this gate repair. No live Claude
  call or external repository action is authorized.

### 2026-08-04 — Final-48 artifact-index hardening reopen

- A bounded post-Final-47 security audit found two fail-closed gaps in the
  global artifact validator. A payload-bearing JSON record could advertise an
  attempt kind outside the canonical Local Web attempt tree because generic
  wrapper acceptance returned before attempt-path classification. Separately,
  digest collection used a plain object, so an unindexed root file named
  `__proto__` could evade the ordinary-file completeness loop; duplicate index
  paths were silently collapsed by a `Map`.
- The accepted Final-48 decision is deliberately narrow. Attempt-kind
  classification and canonical-path rejection happen before generic wrapper
  acceptance. Digest collection preserves every filename, and the index must
  be an exact one-to-one map: every indexed path is a unique string, every
  ordinary file has exactly one matching digest row, and the existing final
  index exclusions remain explicit. Final-47's canonical normal-harness
  triplet binding is unchanged.
- Cross-principal signing is not silently introduced. The current immutable
  source/index hashes are integrity checks within the documented single-owner
  artifact-root trust model, not a cryptographic attestation against a hostile
  artifact writer. A future cross-principal CI/release-attestation scope must
  add a trusted coordinator-bound nonce or signer and a replay regression.
- Independent Final-48 work is limited to the artifact-validator contract,
  its regression fixture, and `tools/gates/gate-artifacts.mjs`. A fresh
  source-bound acceptance, bounded security re-audit, and final reviews remain
  mandatory after the repair. No live or external action is authorized.

### 2026-08-04 — Final-49 exact index-row schema reopen

- A fresh Final-48 security re-audit found one remaining fail-closed index
  schema gap. A phantom index row with a string path and no `sha256` could
  compare `undefined` to `undefined` during extra-row reconciliation and enter
  an otherwise valid index. It cannot omit a real artifact, but it violates the
  required one-to-one index contract.
- Accepted Final-49 decision: every index row has exactly two own keys,
  `path` and `sha256`; paths are non-empty strings and hashes are lowercase
  64-hex SHA-256 values. Rows are unique by path and bind an existing regular
  artifact byte-for-byte, subject only to the pre-existing `index.json` and
  non-final self-result exclusions. Missing, duplicate, extra, malformed, or
  phantom rows are all red.
- Deliberately deferred residuals remain explicit: JSON duplicate-key
  rejection and cross-principal evidence attestation exceed the documented
  single-owner, Node-only artifact-root trust model. Any cross-parser or
  hostile-artifact-source scope must add a strict parser and trusted
  coordinator-bound signing rather than treating self-hashes as signatures.
- Final-49 is limited to the independent artifact-index regression and the
  validator implementation. A new source-bound acceptance and final review
  sequence is required after this repair; no live or external action is
  authorized.

### 2026-08-04 — Final-49 provisional offline closure (superseded)

- Outcome at the time: the S2 offline novice-pilot safety spine was reported
  closed for the implemented owner-installed, single-user, single-project Local
  Web slice. The later evidence correction supersedes Final-49 as the complete
  closure contract because its recorded command sequence omitted the required
  Playwright provisioning command.
- Final source-bound implementation evidence is retained at
  `/tmp/guidelane-s2-final49.QfnX8G` with logs at
  `/tmp/guidelane-s2-final49-logs.vpalfa`. It captured 186 source files at
  SHA-256 `c59a58650a6882aa9e1c46172631311250d3dfe3b23bddeb76c949fb9d72a76d`.
  The 230-record final index passed at SHA-256
  `2f870305ec8cfba7e0288f946c89df78df30ba9228a12ff567c2a5168fc8d29b`; the
  final artifact result passed at SHA-256
  `7c408a536d835dbbc8c689ab6f37084aace92ab35563ecd5ef467db42bd24307`.
- The Final-49 implementation sequence otherwise passed from clean install through final
  validate-only artifact validation. It includes high-severity dependency
  audit thresholds, formatting, lint, strict types, all offline suites,
  recovery and minimal-environment safety, Cockpit build, Chromium and WebKit
  journeys, normal and seeded Local Web gates, redaction, changed-path checks,
  evidence indexing, and final non-mutating validation. The independently
  authored Final-49 index contract passed 18/18 and the broader artifact gate
  suite passed 47/47. The normal Local Web record contains one canonical passed
  authority triplet, seven completed gates, and verified reaping; no test-owned
  profile process remained after the run.
- Review separation remained intact for the code surface. The bounded security re-audit found no
  material Final-49 delta. Fresh Sol High found no material finding, and the
  risk-triggered Sol Max review found no blocker, High, or Moderate issue. The
  existing rendered UI/UX review remains clear within its Chromium/WebKit
  evidence boundary.
- Deferred, non-passing-by-design evidence remains explicit: two opt-in engine
  live tests, one live orchestrator auth test, and three privileged
  foreign-owner fixtures were skipped. The Local Web dependency audit passes
  the high-severity threshold but reports two moderate transitive `postcss`
  advisories. Duplicate JSON-key rejection, cross-principal evidence
  attestation, and same-owner filesystem races remain documented trust-model
  residuals rather than waived guarantees.
- Friends-pilot distribution remains hard-blocked on the written Anthropic
  response, owner-operated authenticated minimal-environment and supervised
  G0–G6 live proof, real Safari and Chrome smoke, active required GitHub checks,
  and three observed owner-installed novice sessions. No live Claude call,
  inquiry delivery, commit, push, PR, ruleset change, publication, or deployment
  is authorized by this closure.
- Later correction: this historical record is retained for its remediation and
  review trail only. Final-54 is the first complete frozen contract, and
  Final-55 binds the corrected durable documentation without reopening the
  reviewed production surface or weakening a live or friends-pilot prerequisite.

### 2026-08-04 — Final closure evidence correction

- A fresh documentation review found that Final-49 and Final-50 retained 21
  command logs but not the `npx playwright install --with-deps chromium webkit`
  command required by `GATE_CONTRACT.md`. Browser execution proves that the
  pinned browsers worked; it does not substitute for recording the exact frozen
  provisioning step. Those runs remain valid implementation and
  documentation-binding evidence, but are not by themselves the complete final
  contract.
- The current engine surface has 60 offline tests and two opt-in live tests;
  current README, project-map, and engine-package claims were corrected from
  the historical 58-test count. Historical S1 checkpoints retain their original
  measured counts.
- Required closure action: rerun the complete source-bound sequence from a
  clean install with the Playwright provisioning command recorded between
  `npm ci` and source-manifest capture, then obtain one fresh documentation
  review. No production behavior, security boundary, or live/pilot prerequisite
  changes in this correction.

### 2026-08-04 — Final closure log-capture correction

- Final-51 executed the required browser provisioning command, but its no-op
  success produced a zero-byte log. A filename establishes ordering, not the
  exact command or its exit status, so the record remains insufficient for the
  frozen contract.
- The final rerun records every gate command as a shell-escaped argument list
  followed by an explicit `exit_status` line. The Playwright record must contain
  `npx playwright install --with-deps chromium webkit` and `exit_status: 0`
  between clean install and source-manifest capture. This changes only external
  acceptance-log capture, not tracked production behavior.

### 2026-08-04 — Final-53 transient gate rejection

- The first command-recording full run is rejected, not waived. Its offline
  workspace test reached the seeded Local Web build baseline, where the clean
  `npm run build` timed out after 369402 ms before mutation. The seed therefore
  correctly reported non-attributable failure, the aggregate seeded harness
  returned non-zero, and the frozen sequence stopped at the offline gate.
- The failure left no owned server process; the same seed harness in a fresh
  artifact root immediately passed, and a fresh root `npm test` passed with 47
  tests. This isolates the observed timeout to that rejected run's execution
  conditions; it does not convert it into acceptance evidence or justify a
  timeout relaxation.
- Required closure action remains an entirely new clean source-bound run with
  the exact command-and-exit log format. A second failure of the same baseline
  would return the harness timeout behavior to independent test and production
  ownership rather than being retried as an environmental flake.

### 2026-08-04 — Final-54 complete offline acceptance

- Outcome: Final-54 is the first complete execution of the frozen offline gate
  contract. It is accepted implementation evidence for the owner-installed,
  single-user, single-project Local Web safety spine, not a live-engine,
  release, or friends-pilot approval. Final-53 remains a rejected run and is
  not waived by this result.
- Evidence is retained at `/tmp/guidelane-s2-final54.o4SUGX`, with exact
  command records at `/tmp/guidelane-s2-final54-logs.Kw5GGS`. The source
  manifest contains 186 files at SHA-256
  `9b8b527483ee07ade0b8436feec16ee89f30fcaa5af9a14341e32c262925aa36`; the
  final evidence index contains 230 rows at SHA-256
  `3def6778008e29a3a4107a4c2fa940493bfc21fd7c6c5f8aeec5484b6e8fdd87`; and
  the final artifact result passed at SHA-256
  `72b363b060f692e262c7d87de624afd4373a4def58bd7f246b60dd96ab012d61`.
- All 22 required commands recorded an exact shell-escaped command and
  `exit_status: 0`. The second record is `npx playwright install --with-deps
  chromium webkit`, between `npm ci` and source-manifest capture, satisfying
  the previously missing frozen-contract prerequisite.
- The acceptance run passed clean install, both high-severity audit thresholds,
  formatting, lint, strict type checking, 47 root tests, all offline suites,
  the independent S2 contract, orchestrator safety, Cockpit build, 84 Chromium
  and 84 WebKit executions, normal and seeded Local Web harnesses, final
  evidence indexing, artifact validation, and changed-path validation. No
  test-owned Local Web process remained after the run.
- Expected non-passing-by-design limits remain unchanged: two opt-in engine
  live tests, one live orchestrator-auth test, and three privileged
  foreign-owner fixtures were skipped; two moderate transitive `postcss`
  advisories remain below the high-severity audit threshold. Duplicate JSON-key
  rejection, cross-principal evidence attestation, and same-owner filesystem
  races remain documented trust-model residuals.
- Final-55 binds this corrected documentation to an otherwise identical full
  frozen-contract replay. It adds no production behavior, changes no reviewed
  security boundary, and cannot weaken any live or friends-pilot prerequisite.
