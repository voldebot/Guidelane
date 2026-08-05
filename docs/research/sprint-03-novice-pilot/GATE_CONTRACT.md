# S2 Deterministic Gate Contract — Novice Pilot

Status: frozen before S2 implementation
Scope: `codex/s2-novice-pilot` at base `952cdf52dffb3acc47fc3918c97183b456eb0cf3`

This is an acceptance contract, not a test plan. A command is green only when
it has the stated exit status and produces the stated evidence. A missing
script, missing evidence, missing browser, unavailable fixture, or incomplete
inventory is red or explicitly **NOT RUN**; it is never silently treated as
success. The implementer does not change this document to accommodate a red
gate. Any contract amendment needs a separate, reviewed decision.

## Preconditions

Offline acceptance requires:

- Node `>=22.6` (the repository uses native TypeScript stripping) and the
  committed `package-lock.json`; use npm, not pnpm or a global test runner.
- A clean dependency install: `npm ci` from the repository root.
- POSIX process-group semantics for the B1 process-recovery gate. The supported
  pilot platform is macOS. Linux CI may run the same gate only where its
  process-table probe is supported. Windows is **NOT RUN / unsupported**, not
  a passing substitute.
- For browser gates, the Playwright browser revisions pinned by the lockfile,
  including both Chromium and WebKit. On Linux, install the Playwright system
  dependencies before the browser install.
- A loopback port available to the E2E process. Tests must use a test-selected
  port and test-owned artifact directory, never a developer's existing server
  or project directory.

Live evidence additionally requires an owner-operated macOS session with the
official `claude` binary available on `PATH`, an already authenticated owner
subscription, and explicit operator consent to spend quota. No CI secret,
credential export, copied cookie, or token is permitted.

## Command Vocabulary Required From S2

S2 must add these root scripts with exactly these names. They must be
non-interactive, write evidence beneath the supplied test artifact directory,
and return a non-zero status for any failed assertion. A script absent at
acceptance is a failed gate, not a deferred pass.

| Script | Required purpose |
| --- | --- |
| `format:check` | Verify formatting only; do not rewrite files. |
| `lint` | Run all repository lint rules. |
| `test:offline` | Run every offline workspace test, excluding all authenticated/live calls even if `GUIDELANE_LIVE=1` is inherited. |
| `test:s2-contract` | Run the manifest/inventory guard below. |
| `test:orchestrator-safety` | Run the deterministic fake-engine persistence, protocol, recovery, minimal-environment, and B1 suites. |
| `build:cockpit` | Produce the production cockpit bundle without starting a long-lived server. |
| `test:e2e:chromium` | Run the novice journey and Final-22 real-orchestrator public failure-state projections in Chromium, using only offline test engines. |
| `test:e2e:webkit` | Run the identical journey and failure-state projections in WebKit. |
| `test:profile:local-web` | Run the Local Web profile's normal clean-template gate harness. |
| `test:profile:local-web:seeded` | Inject each named failure into a disposable generated project and prove the corresponding normal profile gate rejects it. |
| `evidence:source` | Atomically capture the repository-root source manifest exactly once before substantive gates; reject ambient source-root overrides. |
| `evidence:index` | Atomically index canonical evidence and digests without modifying a gate result or recreating the source manifest. `--final` also requires artifact and changed-path results. |
| `gate:artifacts` | Validate S2 generated evidence and committed-artifact redaction. |
| `gate:changed-paths` | Validate the S2 diff against the approved path policy. |
| `test:live:auth` | Opt-in only; verify authenticated init under the production minimal environment. It must not be called by any offline script. |
| `test:live:journey` | Opt-in only; run one supervised Local Web G0–G6 smoke after `test:live:auth` is green. |

The scripts may delegate to package-local scripts, but the root entry points are
the acceptance interface. `npm test` and `npm run typecheck` remain repository
native gates and are not replaced by these aliases.

## Mandatory Offline Gate Sequence

Set the evidence directory once per run. It must be outside the worktree so
test output cannot be accidentally committed.

```bash
export S2_EVIDENCE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/guidelane-s2-gates.XXXXXX")"
export CI=1
npm ci
npx playwright install --with-deps chromium webkit
unset GUIDELANE_LIVE
unset GUIDELANE_SOURCE_ROOT
npm run evidence:source -- --artifacts "$S2_EVIDENCE_DIR"
npm audit --package-lock-only --audit-level=high
npm audit --prefix profiles/local-web --package-lock-only --audit-level=high --workspaces=false
npm run format:check
npm run lint
npm run typecheck
npm test
npm run test:offline -- --artifacts "$S2_EVIDENCE_DIR/offline"
npm run test:s2-contract -- --artifacts "$S2_EVIDENCE_DIR/inventory"
npm run test:orchestrator-safety -- --artifacts "$S2_EVIDENCE_DIR/orchestrator"
npm run build:cockpit -- --artifacts "$S2_EVIDENCE_DIR/cockpit-build"
npm run test:e2e:chromium -- --artifacts "$S2_EVIDENCE_DIR/e2e-chromium"
npm run test:e2e:webkit -- --artifacts "$S2_EVIDENCE_DIR/e2e-webkit"
npm run test:profile:local-web -- --artifacts "$S2_EVIDENCE_DIR/local-web"
npm run test:profile:local-web:seeded -- --artifacts "$S2_EVIDENCE_DIR/local-web-seeded"
npm run evidence:index -- --artifacts "$S2_EVIDENCE_DIR"
npm run gate:artifacts -- --artifacts "$S2_EVIDENCE_DIR"
S2_BASE=952cdf52dffb3acc47fc3918c97183b456eb0cf3 npm run gate:changed-paths -- --base "$S2_BASE" --artifacts "$S2_EVIDENCE_DIR/changed-paths"
npm run evidence:index -- --final --artifacts "$S2_EVIDENCE_DIR"
npm run gate:artifacts -- --validate-only --artifacts "$S2_EVIDENCE_DIR"
```

Every command above must exit `0`. A command must neither start nor contact a
real engine. `npm test` must retain S1's opt-in live-test skip behaviour; the
separate `test:offline` command proves that new S2 suites have the same
property.

The browser commands are non-waivable acceptance gates. If Chromium or WebKit
cannot be installed or launched, record `NOT RUN — prerequisite unavailable`
with its command output and do not declare offline acceptance complete.

The evidence-index steps amend the opening contract after implementation
exposed a self-reference trap: an index cannot include its own digest, and a
validator cannot rewrite the result it is validating. This strengthens the
evidence requirement without changing a scenario or threshold. The pre-index
covers the eight mandatory core result wrappers plus the immutable source
manifest; the final index retains that manifest byte-for-byte while adding the
artifact and changed-path results; `--validate-only` proves the final tree
without mutation.

## Required Offline Invariants

`test:s2-contract` reads a committed, versioned S2 inventory (for example
`tools/gates/s2-test-inventory.json`) and fails closed if it is unreadable,
contains duplicate IDs, maps an ID to no executable test, or reports fewer
than the following scenarios. The inventory must name the test file, test ID,
layer, and authority for every row; a count alone is insufficient.

| Area | Minimum executable scenarios | Non-negotiable coverage |
| --- | ---: | --- |
| Artifact/state authority | 8 | atomic temp-write interruption; missing evidence; corrupt digest; unknown schema; manifest/git divergence in both directions; stale revision; second lock holder; UTF-8 Turkish byte identity. |
| Recovery / B1 | 6 | detached fake-engine process group; supervisor SIGKILL; process-table reap proof; interrupted terminal record; restart reconciliation; distinct next attempt with no resume of old work. |
| Minimal environment | 4 | explicit allow-list only; secret-like inherited variables absent; required locale preserved/pinned; fake-engine init receipt proves `apiKeySource: none` contract without a live credential. |
| HTTP/WebSocket protocol | 9 | loopback-only binding; invalid/missing Origin; token replay; invalid cookie; malformed command; semantic-only serialization; revision gap snapshot recovery; disconnect/reconnect; UTF-8 command payload. |
| Engine failure mapping | 9 | receipt, denial, hook, stall, framing, IO, rate-limit, interruption, recovery/unknown mapping each yields a defined non-success state. |
| Cockpit novice journey | 8 | Turkish-first G0–G6, pending/running/passed/failed/blocked/needs-user states, reopen from snapshot, forbidden-data assertions, keyboard/focus, and axe assertion. Both browser projects execute this same inventory. |
| Local Web profile normal harness | 7 | lint, type, unit, build, boot/health, axe, and smoke all pass on a clean generated project. |
| Local Web seeded harness | 7 | One isolated seed for each normal harness component: lint, type, unit, build, boot, axe, smoke. |

The minimum is **58 unique offline scenario IDs**. Each cockpit journey ID must
be marked `cross-browser` and produce two independent browser results. The
inventory guard must reject a run that reports fewer than one Chromium and one
WebKit result at each required viewport (`1280x800`, `1024x768`).

The exact test names may differ from this prose, but all listed behaviours must
be individually addressable in machine-readable evidence. Combining several
failure cases into one opaque "safety test" does not satisfy the contract.

### B1 and minimal-environment hard pre-build rule

`test:orchestrator-safety` contains the B1 and minimal-environment scenarios
above. It runs before `build:cockpit`; no cockpit bundle or E2E result can
compensate for its failure. B1 uses a real detached **fake-engine** process
tree, records only test-created PIDs, kills the supervisor with `SIGKILL`, and
proves every recorded descendant has left the process table within the declared
bounded settle time. Cleanup runs even on assertion failure; cleanup success
does not erase a failed assertion.

The offline minimal-environment gate is intentionally credential-free: it
checks the exact environment construction and fake-engine init receipt. This
is a pre-build safety assertion, not a claim that a subscription can authenticate.

## Seeded-Failure Semantics

`test:profile:local-web:seeded` owns a fresh temporary generated project for
each seed. It must execute the normal profile command for that seed, observe a
non-zero exit from that command, and verify the failure is attributable to the
targeted gate. The outer seeded harness exits `0` only if all seven expected
rejections occurred and cleanup completed. It exits non-zero for a seed that
passes, triggers the wrong gate, cannot be injected, contaminates another
seed, or leaves a child process alive.

The harness must emit a JSON result per seed containing `seedId`, normal command,
observed exit code, expected gate, artifact paths, and cleanup status. A raw
non-zero process status with no attribution is not evidence.

## Artifact, Redaction, and Path Policy

`gate:artifacts` must scan both committed tracked text and the complete
`$S2_EVIDENCE_DIR` tree. It must use a single-process recursive scanner (or
`git grep` for tracked files) with explicit tri-state handling: no match is
clean, a match is failure, and any scanner error is failure. It must enforce:

- no absolute home path, macOS temporary-root salt, email address, token shape,
  credential-like environment value, raw stderr, diff, terminal output, engine
  event, reasoning/thinking text, or source-file path in cockpit/API evidence;
- every persisted S2 artifact carries schema version, identity, digest, and
  digest-valid content; an unclassified or unreadable payload fails;
- no S2 test artifact is written under tracked project paths; and
- evidence indexes list every required gate result and its digest. Missing or
  extra unindexed evidence is failure.

The committed-file scan inherits the existing S0 exclusions only where the
excluded file is itself a redaction rule or deliberately hostile fixture. New
S2 source, tests, documentation, browser snapshots, fixtures, and generated
evidence receive no blanket exclusion. Pattern changes require a named reason
and a regression fixture.

`gate:changed-paths` computes `git diff --name-only "$S2_BASE"...HEAD` plus
the working-tree diff when invoked before commit. It fails for an empty base,
unresolvable base, merge-base ambiguity, untracked generated evidence, or a
path outside the sprint-approved implementation/doc/CI/test/gate surfaces.
It must specifically reject changes to source-worktree benchmark paths,
repository rulesets, vendor inquiry delivery state, and any generated-project
directory outside the test artifact root. It also runs `git diff --check` and
records the full changed-path list as an evidence artifact.

## Browser Evidence Requirements

Each browser/viewport result contains a machine-readable scenario inventory,
console-error assertion, request log proving only loopback/test resources were
used, accessibility result, and a screenshot or DOM capture of the terminal
novice state. Assertions must demonstrate that forbidden technical data is
absent: raw engine output, reasoning, file paths, diffs, terminal output, and
credentials. Screenshots are supporting evidence, not a substitute for DOM/API
assertions.

The standard novice journey may use a fake orchestrator and deterministic
clock/fixtures. Final-22 stopped, interrupted, rate-limit, and recovery browser
evidence must instead consume the public projection produced by the real
orchestrator running against an offline test engine. Neither browser path may
spawn `claude`, contact a real engine, or rely on a logged-in browser profile.

## Opt-In Live Tier (After Offline Acceptance Only)

Live is not part of CI and is not an offline escape hatch. Run only after every
offline gate above is green, from an owner-controlled macOS machine:

```bash
export S2_EVIDENCE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/guidelane-s2-live.XXXXXX")"
GUIDELANE_LIVE=1 npm run test:live:auth -- --artifacts "$S2_EVIDENCE_DIR/auth"
GUIDELANE_LIVE=1 npm run test:live:journey -- --artifacts "$S2_EVIDENCE_DIR/journey"
```

Both commands exit `0` only on a successful, supervised run. `test:live:auth`
must prove the production minimal allow-list still establishes the official
subscription mode with `apiKeySource: none`, without recording a credential or
raw init payload. An unavailable login, unexpected API-key source, timeout,
inconclusive result, or rate limit is non-zero and leaves live acceptance
**NOT ACCEPTED**. `test:live:journey` proves one supervised G0–G6 Local Web
smoke and performs the same artifact redaction check.

Absence of the owner’s written Anthropic response blocks distribution to a
friend; it does not change the exit semantics of offline gates or authorize a
waiver of a red live gate.

## Expected Evidence Layout

Before any gate result, `source-manifest.json` is written once at
`$S2_EVIDENCE_DIR` and binds the repository-root source bytes. At minimum, each
gate writes `$S2_EVIDENCE_DIR/<gate>/result.json` with that manifest digest,
command, start/end timestamps, exit status, suite version, inventory IDs,
artifact digest map, and redacted failure summary. B1 adds its test-owned PID
ledger and reap timing; browser gates add per-project/per-viewport results;
seeded Local Web adds one result per seed. Evidence must be atomic-published,
preserve the source manifest through both indexes, and be readable without a
local application database.

## Current Baseline and Deliberate Non-Pass

At the time this contract was frozen, S2 packages, scripts, browser projects,
profile harness, and S2 gate tooling do not exist. Therefore the S2-specific
commands above are expected to be unavailable until their responsible owners
add them; that is a pre-implementation fact, not a green result. Existing
repository-native evidence remains:

```bash
npm ci
npm run typecheck
npm test
node tools/probe/run.mjs --out "$(mktemp -d "${TMPDIR:-/tmp}/guidelane-s0-free.XXXXXX")"
```

For the S0 probe, exit `0` is green, `1` is contract/baseline drift, `2` is a
harness error, `3` is inconclusive, and `4` means another probe owns the lock.
Only `0` is acceptable as offline evidence. `node tools/probe/run.mjs --live`
remains an opt-in S0 engine-conformance action and does not replace S2 live
acceptance.

## Final-22 Review Addendum

Fresh review of final-21 invalidated offline closure. The following requirements
are additive and cannot be waived by the earlier green evidence:

- One immutable source manifest is captured before the first substantive gate.
  Every evidence wrapper carries its digest. Pre-final and final indexing must
  verify and preserve that manifest rather than recreate it. Production
  acceptance rejects any ambient source-root override.
- Engine launch uses a durable intent and an exec-gated wrapper. The wrapper
  cannot start the engine until its own `pid === pgid`, start identity, launch
  nonce, and intent binding are durable. Supervisor `SIGKILL` before wrapper
  spawn, before receipt attachment, after attachment, and after engine start
  must never permit a second attempt or leave an untracked quota-consuming
  process.
- Failure publication with active work proves process-group absence before the
  immutable failure result is published. An indeterminate signal preserves a
  cleanup-capable receipt, and reconciliation remains callable from recovery.
- Every `RunFailureCode` produces a bounded semantic public state. Rate-limit,
  stopped, interrupted, and recovery states must be produced by the real
  orchestrator and rendered by the cockpit; fake-only browser states are not
  acceptance evidence.
- `ArtifactStore.open` and `Orchestrator.open` reject unsafe project identities
  before filesystem mutation. Public snapshots are allow-list projections:
  recovery diagnostics and evidence paths/digests remain server-side, while a
  boolean verified summary may cross the cockpit boundary.

Required deterministic test titles use the prefixes
`S2-FINAL-22-SOURCE`, `S2-FINAL-22-INTENT`, `S2-FINAL-22-FAILURE`,
`S2-FINAL-22-COCKPIT-FAILURE`, `S2-FINAL-22-PROJECT`, and
`S2-FINAL-22-PUBLIC`. Every kill-point test records only test-owned PIDs and
performs bounded cleanup even after assertion failure. All are offline.

## Final-22 Process-Leak Addendum

The process-safety gate owns only processes recorded in a durable per-test
ledger. The ledger binds a unique run ID, exact fixture realpath and argument
marker, PID, PGID, parent relationship, and OS start identity for the
supervisor, engine, and descendants. PID, command-name, PPID, or PGID matching
alone never authorizes a signal.

The required tests are:

- `S2-FINAL-22-PROCESS-LEAK-01`: successful reconciliation leaves every
  ledger-owned PID absent within the bounded settle interval;
- `S2-FINAL-22-PROCESS-LEAK-02`: an injected assertion failure stays visible
  while a separate parent probe verifies and reaps the durable ledger;
- `S2-FINAL-22-PROCESS-LEAK-03`: a `SIGKILL`ed test-owned runner is recoverable
  only through a separate durable-ledger probe; and
- `S2-FINAL-22-PROCESS-LEAK-04`: an unverifiable or PID-reused identity fails
  closed and receives no signal.

`test:orchestrator-safety` may pass only when all four selectors pass and every
ledger-owned process is proven absent. Cleanup success never erases the
original assertion failure. If the entire gate runner is killed before any
independent recovery probe can run, that run is interrupted and not accepted;
no in-process design can truthfully claim cleanup after its own `SIGKILL`.

## Final-22 Review-Remediation Addendum

Fresh review after the first Final-22 canonical run rejected its source scope
and intent binding. The following requirements are additive:

- `SOURCE-MANIFEST-01..04` prove that source identity contains every Git tracked
  and untracked-nonignored regular file, including the two stream-surface probe
  inputs; changed-path policy is not a source-identity filter. Duplicate,
  missing, unreadable, symlinked, changed, or digest-mismatched entries fail.
- `INTENT-BINDING-01..05` bind the durable canonical intent, nonce, wrapper
  `armed` acknowledgement, mandatory `GO` digest, exact target payload, and
  `started` acknowledgement. Omitted digest or A-intent/B-payload starts no
  target. Reopen rejects malformed intent and receipt/intent nonce mismatch.
- `LOCAL-WEB-TARGET-01..04` accept only a missing target or a real empty target
  directory. Existing content, dotfiles, symlinks, or a non-directory target
  are rejected before writes or Git initialization and retain their bytes.
- `PROJECT-ROOT-SYMLINK-01..02` reject a project-root symlink before lock,
  manifest, run, attempt, recovery, or external-target mutation.

Root `npm test` executes all workspace suites and every
`tools/gates/*.test.mjs` test. The executable inventory maps the new source,
intent, Local Web target, and symlink selectors; prose-only invocation is not
acceptance evidence.

## Final-23 Process-Gate Fail-Closed Addendum

The first Final-23 canonical attempt is rejected evidence: its nested offline
suite exposed a cleanup error that had been swallowed after the detached engine
group was reaped. The still-open supervisor `ChildProcess` handle pinned the
test runner indefinitely even though the temporary durable-ledger directory had
already been removed.

Every process-leak test must therefore retain each directly spawned supervisor
or harness handle, bound the wait for its close, and treat cleanup refusal or
error as a test failure. A ledger directory may be removed only after all
ledger-owned PIDs are proven absent. If no durable ledger can be verified, the
test must not infer signal authority; it must fail visibly, preserve diagnostic
state, release its local handle so the test runner can terminate, and leave the
run unaccepted. The forged or PID-reused identity test continues to require
zero signals.

Before a replacement canonical run, the four process-leak selectors must pass
at least five consecutive executions under an external 15-second command
timeout, with an empty exact-fixture process scan after every execution.

## Final-24 Review-Remediation Addendum

The complete Final-24 offline evidence tree is rejected evidence. Its
deterministic commands passed, but fresh review found that the browser failure
journey bypassed production launch authority, successful reconciliation left a
durable recovery marker active, the snapshot-to-WebSocket handoff could lose a
revision, and committed-source redaction excluded whole hardening/protocol test
files. Security review also required stronger local process, static-file, and
generated-server identity binding. None of these findings may be waived by the
prior green command result.

The replacement canonical run is additive to the frozen contract and requires:

- `S2-F24-A` and `S2-F24-A-BROWSER`: failures originate only from the exact
  active G4 attempt after the production launcher has persisted its receipt;
  direct G0 failure publication is unavailable, and a retry creates a distinct
  attempt. The browser test must prove the offline engine is live before
  publishing the failure and must emit complete browser evidence.
- `S2-F24-B`: exact reconciliation appends immutable recovery-resolution
  history, clears the active marker only after durable resolution, reopens in a
  normal interrupted state, and leaves ambiguous identity blocked.
- `S2-F24-C`: WebSocket upgrade carries `afterRevision`; the server supplies a
  contiguous suffix or `snapshot_required`, while the cockpit accepts only the
  exact next revision and reloads canonical state on a gap.
- `S2-F24-D`: committed-source redaction scans hardening and protocol files.
  Only the exact hostile-payload fixture may be treated as test data; scanned
  file and byte totals must match exhaustive deterministic enumeration.
- `S2-F24-E`: application-data and test roots are owner-private. Same-UID
  malicious concurrent path substitution is explicitly outside the
  owner-installed pilot threat model and remains a documented residual.
- `S2-F24-F`: Local Web boot, health, axe, and smoke bind a cryptographically
  random nonce to the exact spawned child; a foreign listener on the selected
  port cannot satisfy readiness.
- `S2-F24-G`: wrapper receipts bind the wrapper command identity and nonce;
  identity mismatch grants no signal authority. A locally owned wrapper that
  exits during observation is boundedly awaited and its exact PGID is
  re-observed before an absent/all-zombie group may be marked interrupted.
- `S2-F24-H`: twenty immediate detached Local Web start/stop cycles prove
  bounded post-spawn ownership acquisition and exact child reaping.

The executable inventory contains 110 unique scenario IDs. The browser matrix
contains the 29 frozen Final-22 variants plus one Final-24 attempt-failure
variant, so Chromium and WebKit must each publish exactly 60 passed executions
across the two supported viewports. Every intended-live use of the long-lived
offline launch fixture supplies and observes its test-owned marker before a
failure claim; an immediately exiting fixture is not accepted as an active
attempt proof.

## Final-25 B1 and TAP-Evidence Addendum

Final-25 is rejected evidence. Its source manifest bound 161 files and its
behavior suite passed, but the orchestrator evidence wrapper correctly stopped
because `S2-B1-03` pointed to a deleted TAP selector. Investigation proved that
the surviving mapped test did not cover the required interrupted terminal
record, so remapping without a new test is forbidden.

- `B1-03 a reconciled interruption remains a durable terminal record across
  restart and does not re-begin its attempt` is a top-level POSIX test. It uses
  public `launchAttempt`, exact process reconciliation, two reopen cycles, a
  durable `G4/interrupted/startBuild` snapshot, an interrupted attempt, an empty
  second reconcile, and immutable attempt-ID rejection.
- A normal exact reap without an active recovery marker publishes one immutable
  failed reconcile run bound to the source attempt/receipt. With a marker, the
  same terminal semantics use exact recovery resolution. Publication failure
  emits no event or success result and leaves a retryable recovery marker.
- `S2-F25-B1` models process death after terminal manifest publication but
  before marker removal. Reopen may clear only a marker whose digest, history,
  referenced interrupted attempt, terminal manifest, immutable run, receipt,
  and revision chain agree exactly. It creates no new revision/run/event;
  divergence remains recovery-required.
- Inventory validation requires every `offline-tap` and `orchestrator-tap`
  execution selector to appear verbatim in its declared test source. Dynamic
  tests obtain their actual titles from static selector tables; a separate dead
  registry is not evidence. Browser and native receipt selectors retain their
  source-specific validation rules.

The failed Final-25 tree may not be resumed after source changes. A replacement
canonical run starts from clean install and a new immutable source manifest.

## Final-27 Review-Remediation Addendum

Final-26 is rejected diagnostic evidence even though its original offline
sequence completed. The replacement contract adds fourteen independently
addressable scenarios and requires 124 inventory rows in total:

- the real detached wrapper/target receives only the exact portable launch
  environment, internally forced updater setting, and finite internal markers;
  caller secrets and arbitrary `GUIDELANE_*` names never cross;
- a digest-valid malformed complete snapshot cannot become authoritative, and
  recovery remains schema-valid and publicly projectable;
- legacy reads either migrate to exact canonical G0-G6 publication or fail
  closed; they never publish obsolete stage labels;
- terminal failure-publication collision after exact G4 stop creates durable,
  attempt-bound recovery and blocks replacement work;
- localized activity, distinct novice-safe machine-gate purposes, focus
  contrast, and monotonic snapshot recovery are executable cockpit contracts;
- validate-only preserves every evidence byte on both pass and failure, while
  the offline workflow is read-only, does not persist checkout credentials, and
  uploads evidence only after successful final validation; and
- Local Web rejects symlinked, group/world-writable, and foreign-owned existing
  target components before mutation. The foreign-UID fixture may be skipped
  only where an unprivileged runner cannot create a different-owner fixture;
  executable mode and symlink cases remain mandatory.

The browser inventory preserves every prior variant and adds two Final-27
journeys. Chromium and WebKit must each publish exactly 64 passed executions:
32 test titles across `1280x800` and `1024x768`. A validate-only failure must
return non-zero without publishing a replacement failure receipt into the tree
it is validating. Failed or pre-redaction evidence is never uploaded.

Final-27 is rejected because its first Local Web target-security selector was
a source template expression, not one runtime TAP title. Final-28 requires
static top-level TARGET-05/06/07 titles that each await all of their variant
subtests and appear verbatim in the inventory. One inventory row must reconcile
to exactly one passed top-level execution; a dynamic expression, zero matches,
or multiple top-level matches fails the wrapper.

## Final-29 Review-Remediation Addendum

Final-28 is rejected diagnostic evidence despite completing the prior
deterministic chain. Its fresh close reviews add these immutable contracts:

- `S2-FINAL-29-G5` forbids publishing G5 while the exact G4 attempt remains
  active. `S2-FINAL-29-G6` requires a public trusted success terminalizer that
  accepts only that attempt, requires evidence-bound passing `lint`, `type`,
  `unit`, `build`, `boot`, `axe`, and `smoke` gates, durably enters conservative
  terminal recovery, exactly reaps the wrapper-bound group, appends one
  completed run retaining the receipt and evidence, removes the active fixture,
  publishes G5 waiting for `acceptResult`, reaches G6, and survives reopen.
- Two or three individually digest-valid wrapper-bound running attempts latch
  `recovery-required`. No later record becomes active authority; reconciliation
  selects and signals none, and replacement work remains blocked.
- Artifact data roots, cockpit static roots, and Local Web `cwd`/`TMPDIR`
  anchors validate their caller-controlled existing leaf and ancestors before
  mutation or same-origin serving. Symlinked, foreign-owned, or group/world-
  writable caller components fail closed. Private current-owner roots,
  root-owned non-writable OS ancestors, and required sticky OS temporary roots
  remain accepted. Same-UID concurrent substitution remains a documented local
  pilot residual rather than an asserted descriptor-anchored guarantee.
- `CPT-E2E-FINAL-29-TAB` executes in Turkish and English at both supported
  viewports and in both browser engines. Natural DOM and keyboard order places
  the current decision before the secondary language control: idea input then
  submit, primary approval, or recovery refresh. Positive `tabindex` cannot be
  used to conceal inconsistent DOM or visual order.

Every new row must use one static, verbatim, top-level selector and reconcile to
exactly one execution. The frozen inventory contains 139 rows. The browser
matrix contains 42 titles across `1280x800` and `1024x768`; Chromium and WebKit
must each publish exactly 84 passed executions. Final-28 cannot be resumed or
amended after source changes.

## Final-30 Platform-Skip and Cleanup Addendum

Final-29 is rejected because its orchestrator behavior passed but the evidence
wrapper did not encode the two explicitly privileged foreign-owner fixtures.
Only `S2-F29-ARTIFACT-ROOT-02` and `S2-F29-COCKPIT-ROOT-03` may reconcile from
an exact TAP skip. Each requires its exact static selector and exact documented
reason that a privileged test account is required. Missing, failed, TODO,
duplicate, empty-reason, arbitrary-reason, and every non-platform skip remain
hard failures. Final artifact validation applies the identical rule.

The long-lived Local Web environment test also treats cleanup as behavior, not
a best-effort `finally`: it retains the fresh detached leader identity, requires
`ownershipVerified` and `childProcessesReaped`, and boundedly proves that exact
PGID absent before removing its temporary directory. Twenty consecutive focused
runs and a final exact fixture scan must remain green before canonical capture.

## Final-30 Success-Marker Crash Boundary

`S2-F30-SUCCESS-MARKER` freezes success finalization across a crash after
the G5 manifest commit. Production must generate exact-completion history before
that manifest transition. On reopen, only an exact stale success marker may be
finalized; a corrupt, mismatched, or otherwise non-exact marker fails closed,
signals no process, and publishes no new revision.

## Final-32 Regression Inventory Addendum

Final-32 adds four non-browser, independently executable regression selectors.
The inventory validator must find each title verbatim in the stated source and
the matching evidence wrapper must reconcile exactly one passed TAP execution.
Missing, duplicated, skipped, TODO, or failed executions are red.

| Scenario ID | Static title | Evidence command and source |
| --- | --- | --- |
| `S2-F32-ENV` | `ENGINE-ENV-FINAL-32 scrubbedEnv admits only finite supported internal keys and omits an arbitrary caller GUIDELANE sentinel` | `npm run test:offline` / `offline-tap` |
| `S2-F32-WRAPPER-PATH` | `ORCH-PATH-FINAL-32 production wrapper identity and completeAttempt work from a source path containing spaces` | `npm run test:orchestrator-safety` / `orchestrator-tap` |
| `S2-F32-COMPLETION-HISTORY-CRASH` | `ORCH-CRASH-FINAL-32 exact-completion history stranded before active-fixture removal reconciles twice to a stable safe terminal` | `npm run test:orchestrator-safety` / `orchestrator-tap` |
| `S2-F32-CPT-RECOVERY` | `CPT-RECOVERY-FINAL-32 a successful same-revision recovery clears unavailable and loading after a transient snapshot GET failure` | `npm run test:offline` / `offline-tap` |

These rows increase the static inventory from 139 to 143 scenario IDs. They
are not Playwright browser-evidence rows: the frozen browser title count remains
42 and Chromium and WebKit must each publish exactly 84 executions across the
two required viewports.

## Final-32 Rejection and Final-33 Regression Inventory Addendum

Final-32 evidence is rejected for acceptance after the subsequent Final-33
source changes. Its recorded green commands are diagnostic only and cannot be
reused, partially amended, or combined with later results. Final-33 must begin
a new immutable-source capture and rerun the complete mandatory offline gate
sequence above.

Final-33 adds eight non-browser, independently executable static top-level TAP
selectors. The inventory validator may establish only that each selector is
present exactly once as a static top-level title in its declared source; outcome
acceptance remains the responsibility of the named TAP evidence command. Every
row must reconcile exactly one passed execution. Missing, duplicate, skipped,
TODO, or failed executions are red. The four lock takeover safety titles are
separate scenario IDs and may not be collapsed into one aggregate result. The
existing platform-skip policy is unchanged: no Final-33 row has a permitted
platform skip; Windows remains **NOT RUN / unsupported** for the POSIX lock
fixture rather than a substitute passing result.

| Scenario ID | Static title | Evidence command and source |
| --- | --- | --- |
| `S2-F33-ENV-METADATA` | `ENGINE-ENV-FINAL-33 scrubbedEnv metadata counts exactly the operator entries that cross and reports omitted entries` | `npm run test:offline` / `offline-tap` |
| `S2-F33-CPT-EQUAL-REVISION-STATE` | `CPT-STATE-FINAL-33 a same-revision canonical recovery overlay replaces a stale action, while an older snapshot cannot replace it` | `npm run test:offline` / `offline-tap` |
| `S2-F33-NESTED-COMPLETION-RECONCILE-CRASH` | `ORCH-CRASH-FINAL-33 a stale exact-completion marker from a reconciled G4 interruption finalizes once after supervisor death` | `npm run test:orchestrator-safety` / `orchestrator-tap` |
| `S2-F33-COMPLETION-ARCHIVE-DURABILITY` | `ORCH-CRASH-FINAL-33 an exact running fixture stranded beside a completed G5 manifest is archived once without signalling` | `npm run test:orchestrator-safety` / `orchestrator-tap` |
| `S2-F33-LOCK-TAKEOVER-RECLAIM` | `ORCH-CRASH-FINAL-33 reclaims only a signed guard bound to unchanged dead predecessor and gone successor` | `npm run test:orchestrator-safety` / `orchestrator-tap` |
| `S2-F33-LOCK-TAKEOVER-LIVE-SUCCESSOR` | `ORCH-CRASH-FINAL-33 preserves a signed takeover guard while its bound successor is live` | `npm run test:orchestrator-safety` / `orchestrator-tap` |
| `S2-F33-LOCK-TAKEOVER-UNOBSERVABLE-PROBE` | `ORCH-CRASH-FINAL-33 an unobservable predecessor or successor probe keeps its signed guard fail-closed` | `npm run test:orchestrator-safety` / `orchestrator-tap` |
| `S2-F33-LOCK-TAKEOVER-UNVERIFIED-GUARDS` | `ORCH-CRASH-FINAL-33 preserves opaque, malformed, and unbound guards beside a dead predecessor` | `npm run test:orchestrator-safety` / `orchestrator-tap` |

These eight rows increase the static inventory from 143 to **151** scenario
IDs. Category totals are `minimal-environment: 7`, `recovery-b1: 33`, and
`cockpit-final-33: 1`; all other categories are unchanged. They add no browser
row, title, viewport, or execution: the frozen browser matrix remains 42 titles
and exactly 84 Chromium plus 84 WebKit executions. The cockpit workspace test
command is serialized with Node's `--test-concurrency=1`, because Final-32 and
Final-33 each start a programmatic Vite server and Vite resolves both `port: 0`
requests to 5173 when test files run concurrently. Serialization is mandatory
for deterministic execution and does not skip or filter any test.

## Final-33 Rejection and Final-34 Regression Inventory Addendum

Final-33 evidence is rejected for acceptance after the subsequent Final-34
source changes. Its recorded green commands are diagnostic only and cannot be
reused, partially amended, or combined with later results. Final-34 requires a
complete new immutable-source capture and a rerun of the complete mandatory
offline gate sequence above.

Final-34 adds four non-browser, independently executable static top-level TAP
selectors. The inventory validator may establish only that each selector is
present exactly once in its declared source; outcome acceptance remains the
responsibility of the named TAP evidence command. Every row must reconcile
exactly one passed execution. Missing, duplicate, skipped, TODO, or failed
executions are red. No Final-34 row has a permitted platform skip; Windows
remains **NOT RUN / unsupported** for the POSIX process-identity fixtures and
is not a passing substitute.

| Scenario ID | Static title | Evidence command and source |
| --- | --- | --- |
| `S2-F34-LOCK-TAKEOVER-SUCCESSOR-RECLAIM` | `ORCH-FINAL-34 reclaims one exact dead successor lock and its signed predecessor takeover guard without signalling` | `npm run test:orchestrator-safety` / `orchestrator-tap` |
| `S2-F34-HOSTILE-PATH-PS` | `ORCH-FINAL-34 hostile PATH ps is never executed by production open, recovery, or completion identity checks` | `npm run test:orchestrator-safety` / `orchestrator-tap` |
| `S2-F34-UNOBSERVABLE-DETACHED-START` | `ENGINE-FINAL-34 rejects every unobservable detached start and reaps its exact receipt-less group` | `npm run test:offline` / `offline-tap` |
| `S2-F34-CPT-CANONICAL-ACTIVITY` | `CPT-FINAL-34 a differing equal-revision canonical recovery clears prior semantic activity and rejects an older snapshot` | `npm run test:offline` / `offline-tap` |

These four rows increase the static inventory from 151 to **155** scenario
IDs. Category totals are `recovery-b1: 35`, `process-identity-security: 1`,
and `cockpit-final-34: 1`; all other category totals are unchanged. The
inventory category minima are `recovery-b1: 8`,
`process-identity-security: 1`, and `cockpit-final-34: 1`; all other minima are
unchanged. They add no browser row, title, viewport, or execution: the frozen
browser matrix remains 42 titles and exactly 84 Chromium plus 84 WebKit
executions.

## Final-34 Rejection and Final-35 Regression Inventory Addendum

Final-34 canonical evidence is rejected because the Final-35 Local Web cleanup
gate failed. Its recorded results are diagnostic only and cannot be reused,
partially amended, or combined with later results. After remediation, Final-35
requires a fresh immutable-source capture and a complete rerun of the mandatory
offline gate sequence above.

Final-35 adds one non-browser, independently executable static top-level TAP
selector. The inventory validator may establish only that the selector is
present exactly once in its declared source; outcome acceptance remains the
responsibility of the named TAP evidence command. The row must reconcile
exactly one passed execution. A missing, duplicate, skipped, TODO, or failed
execution is red.

| Scenario ID | Static title | Evidence command and source |
| --- | --- | --- |
| `S2-F35-LOCAL-WEB-CLEANUP-RACE` | `FINAL-35-LOCAL-WEB stopCommand settles when the owned child closes during cleanup listener attachment` | `npm run test:offline` / `offline-tap` |

This row increases the static inventory from 155 to **156** scenario IDs.
The `recovery-b1` category total is 36 and its minimum is 9; all other
category totals and minima are unchanged. It adds no browser row, title,
viewport, or execution: the frozen browser matrix remains 42 titles and
exactly 84 Chromium plus 84 WebKit executions.

## Final-35 Rejection and Final-36 Cockpit Activity Recovery Addendum

Final-35 canonical evidence is rejected after the Chromium journey exposed a
semantic activity race. The baseline implementation cleared activity while its
matching canonical snapshot was being installed; successive deterministic
regressions also covered a real G0-to-G1 transition, an event delivered after
its equal-revision snapshot, and a WebSocket event missed before connection.
Final-36 requires a fresh immutable-source capture and the complete mandatory
offline gate sequence. No earlier source manifest, browser result, or final
index may be combined with Final-36 evidence.

Final-36 adds five non-browser, independently executable static top-level TAP
selectors. The inventory validator may establish only that every selector is
present exactly once in its declared source; outcome acceptance remains the
responsibility of `npm run test:offline`. Every row must reconcile exactly one
passed offline execution. Missing, duplicate, skipped, TODO, or failed
executions are red.

| Scenario ID | Static title | Evidence command and source |
| --- | --- | --- |
| `S2-F36-CPT-MATCHING-SNAPSHOT` | `CPT-FINAL-36 the newest valid semantic activity remains displayed when recovery obtains its matching canonical snapshot` | `npm run test:offline` / `offline-tap` |
| `S2-F36-CPT-PHASE-TRANSITION` | `CPT-FINAL-36 a legitimate phase transition preserves localized semantic activity after the matching canonical fetch` | `npm run test:offline` / `offline-tap` |
| `S2-F36-CPT-EQUAL-REVISION-EVENT` | `CPT-FINAL-36 a same-revision blueprint-ready semantic event remains displayed after snapshot-required recovery` | `npm run test:offline` / `offline-tap` |
| `S2-F36-CPT-MISSED-EVENT-FALLBACK` | `CPT-FINAL-36 a missed blueprint-ready semantic event falls back to localized activity from the canonical phase snapshot` | `npm run test:offline` / `offline-tap` |
| `S2-F36-CPT-CONTRADICTORY-SNAPSHOT` | `CPT-FINAL-36 a genuinely contradictory canonical snapshot clears stale semantic activity at the event revision` | `npm run test:offline` / `offline-tap` |

These five rows increase the static inventory from 156 to **161** scenario
IDs. The new `cockpit-final-36` category total and minimum are both 5; all
other category totals and minima are unchanged. The rows run through the
serialized cockpit workspace test command inside the offline gate and add no
browser inventory title, viewport, or frozen browser execution. The existing
42-title / 84-Chromium / 84-WebKit browser matrix remains mandatory.

## Final-36 Rejection and Final-37 Security/Canonical Recovery Addendum

Final-36 completed the full immutable-source offline chain but is rejected for
acceptance after fresh security and independent read-only reviews found three
new boundaries. No Final-36 source manifest, result, browser capture, or final
index may be combined with Final-37 evidence. The four Final-37 tests are
independent, non-browser selectors and must be authored before production
remediation. Missing, duplicate, skipped, TODO, malformed, or failed
executions are red.

| Scenario ID | Static title | Evidence command and source |
| --- | --- | --- |
| `S2-F37-LOCAL-WEB-ANCHOR-LEAF` | `FINAL-37-LOCAL-WEB-ANCHOR-04 fresh generator and CLI reject private cwd and TMPDIR leaves below unsafe existing parents before package or Git mutation` | `npm run test:offline` / `offline-tap` |
| `S2-F37-CPT-STALE-RECOVERY` | `CPT-FINAL-37 an event at revision R keeps stale R-1 recovery fail-closed and suppresses user controls until the matching canonical snapshot arrives` | `npm run test:offline` / `offline-tap` |
| `S2-F37-HTTP-NOSTORE` | `ORCH-FINAL-37 authenticated canonical snapshot GET returns no-store and preserves the read-only Origin exception` | `npm run test:orchestrator-safety` / `orchestrator-tap` |
| `S2-F37-WORKFLOW-SHA` | `S2-F37-WORKFLOW every product-offline GitHub Action use is pinned to a full immutable commit SHA before successful evidence upload` | `npm run test:offline` / `offline-tap` |

The Local Web test must create only a current-user `0777` unsafe parent and a
private `0700` child. It must use fresh direct-generator and CLI processes for
both relative `cwd` and absolute `TMPDIR` targets, preserve a sentinel, and
prove that no `package.json` or `.git` appears. The cockpit test must observe a
real event at R followed by a stale R-1 canonical response, keep a recovery
floor at R, suppress every decision control, and restore canonical UI only on a
matching R snapshot. Canonical GET fetches explicitly use `cache: 'no-store'`;
the server emits `Cache-Control: no-store` while retaining the Origin-less
authenticated read exception. The workflow contract rejects every non-40-hex
`uses:` reference, including tags and short SHAs. These rows raise the static
inventory from 161 to **165**. The new `cockpit-final-37` category minimum is
one; the existing browser matrix remains 42 titles and exactly 84 executions
for each browser.

## Final-39 Local Web Git Execution Boundary Addendum

Final-38 completed the full immutable offline chain, but bounded security
review found that the Local Web Git helper resolved `git` through inherited
`PATH` and passed the supervisor environment unchanged. Its source manifest,
gate results, browser evidence, and final index are diagnostic only after this
contract amendment. No earlier evidence may be combined with Final-39.

`S2-F39-LOCAL-WEB-GIT-01` must be a unique, static, top-level offline TAP
selector in `profiles/local-web/test/git.test.ts`. It must prove that every
Git invocation used by normal generation, local identity, accepted snapshots,
and rollback is bound to a trusted absolute executable and a finite explicit
environment. Inherited `PATH`, Git configuration/template/hook controls, and
secret-like parent variables must not select, configure, or reach Git. Failure
to establish the trusted executable boundary must be fail-closed before
repository mutation. Normal generated-project identity, accepted snapshots,
and rollback remain required.

| Scenario ID | Static title | Evidence command and source |
| --- | --- | --- |
| `S2-F39-LOCAL-WEB-GIT-01` | `FINAL-39-LOCAL-WEB-GIT-01 generated repository Git execution uses a trusted absolute executable and finite environment, rejecting PATH, Git-control, and secret-like inheritance` | `npm run test:offline` / `offline-tap` |

The inventory gains one `local-web-git-security` scenario and its category
minimum is one. It also gains the required behavior key
`final39-local-web-trusted-git-boundary`. The inventory validator must require
the exact static top-level selector; ordinary source substring matching is not
sufficient. This is additive to, and does not replace, the existing Local Web
normal harness or minimal-environment requirements. It adds no browser title,
viewport, or execution: the frozen browser matrix remains 42 titles and
exactly 84 Chromium plus 84 WebKit executions.

## Final-46 Local Web Supervisor Authority Addendum

Final-45 evidence is rejected for post-Final-46 source acceptance. No
Final-45 source manifest, candidate gate result, terminal harness result, or
artifact index may be combined with a Final-46 result. Final-46 must capture a
new source manifest and rerun the complete source-bound offline chain from
`evidence:source` through the final `gate:artifacts -- --validate-only` step.
Candidate gate evidence alone is never pass authority.

Production Local Web code must not be modified for Final-46 until the five
selectors below exist as immutable inventory rows and behavior tests, and have
first demonstrated RED against the prior behavior where a safe RED run is
possible. The observation-outage and prior-attempt cases may use only
test-owned fake processes, test-selected loopback ports, and offline fixtures.
The self-group-signal failure case is safety-limited: its RED demonstration
must use bounded, external test-owned cleanup and must not leave a deliberately
unreaped group or rely on an unbounded signal retry. If that setup cannot be
made safe on the runner, record `NOT RUN — safety-limited RED setup` with the
setup evidence; it is not a passing substitute for the eventual GREEN test.

Every Final-46 row is a unique static top-level native TAP title in
`profiles/local-web/test/lease-supervisor.test.ts` and reconciles exactly one
passed `offline-tap` execution through `npm run test:offline`. Missing,
duplicate, skipped, TODO, failed, malformed, or non-static selectors are red.
The inventory validator fixes the title, file, layer, authority, command, and
execution source for every row; an inventory-only remap cannot weaken this
contract.

| Scenario ID | Static title | Required invariant |
| --- | --- | --- |
| `S2-F46-OBSERVATION-OUTAGE-01` | `S2-F46-OBSERVATION-OUTAGE-01 post-initial-proof ps outage during STOP and lease EOF keeps supervisor self-authority in-memory and reaps the target without parent signalling` | Before target start, the detached supervisor proves its executing PID equals its own PGID. After that proof, a diagnostic `/bin/ps` outage during STOP and separately during lease EOF cannot make it abandon the target; it must reap the test-owned target/server from its own in-memory authority. The parent never gains negative-PGID authority. |
| `S2-F46-SELF-GROUP-SIGNAL-02` | `S2-F46-SELF-GROUP-SIGNAL-02 supervisor self-group signal failure remains fail-stopped and retries instead of taking a voluntary cleanup exit` | If the supervisor's self-group signal syscall fails, it stays fail-stopped in cleanup and retries while target/group absence is unproved. The old voluntary 150-ms cleanup exit is forbidden. |
| `S2-F46-ATTEMPT-AUTHORITY-03` | `S2-F46-ATTEMPT-AUTHORITY-03 prior boot pass cannot authorize a current attempt after candidate terminal or replacement failure` | Each boot starts with a fresh attempt ID and durable pending authority before target start. An earlier attempt's durable pass cannot accept the current attempt after post-candidate terminal failure or replacement failure. |
| `S2-F46-AUTHORITY-BINDING-04` | `S2-F46-AUTHORITY-BINDING-04 missing pending malformed or mismatched authority and terminal binding fail closed with exact attempt candidate digest and result identity` | Missing, pending, failed, malformed, unreadable, or mismatched authority fails closed. Acceptance requires one matching terminal passed authority and one matching terminal harness-result binding for the current attempt, exact candidate digest, and exact terminal result identity. |
| `S2-F46-SOURCE-STRUCTURAL-05` | `S2-F46-SOURCE-STRUCTURAL-05 all scoped Local Web sources forbid parent negative-PGID signalling and persist no raw runtime identity authority` | Structural source coverage spans all scoped Local Web production sources and permits the only negative-PGID route solely inside the supervisor's self-group cleanup implementation. New authority/results persist no raw PID, PGID, start time, port, or nonce. |

These five rows raise `local-web-lease-supervisor` from 6 to **11** required
scenarios and raise the frozen static inventory from 174 to **179** scenario
IDs. The five required behavior keys are
`final46-observation-outage-reap-without-parent-authority`,
`final46-self-group-signal-failure-fail-stop`,
`final46-attempt-authority-is-fresh-and-terminal`,
`final46-authority-and-terminal-binding-fail-closed`, and
`final46-source-structural-signal-and-redaction-boundary`. Existing Final-44
and Final-45 rows, browser counts, browser matrix, and platform-skip policy
remain unchanged.

## Final-56 Supervisor-Leader-Loss Addendum

Final-56 closes the remaining detached Local Web supervisor-leader loss
boundary. Production edits are accepted only with the complete selector set
below, a supervisor-owned guardian liveness lease, and a relay state machine
that invalidates any terminal success after protocol or lease failure. The
controller must not be the only cleanup trigger: guardian EOF on the original
supervisor's liveness pipe must self-reap the guardian target group even while
the controller event loop is stalled.

Every row is a unique static top-level native TAP title in
`profiles/local-web/test/lease-supervisor.test.ts` and reconciles exactly one
passed `offline-tap` execution through `npm run test:offline`. Missing,
duplicate, skipped, TODO, failed, malformed, or non-static selectors are red.
The inventory validator fixes the title, file, layer, authority, command, and
execution source for every row; an inventory-only remap cannot weaken this
contract.

| Scenario ID | Static title | Required invariant |
| --- | --- | --- |
| `S2-F56-LEADER-KILL-01` | `S2-F56-LEADER-KILL-01 SIGKILL of the original persistent supervisor leaves neither its exact target nor its recorded group running after the public stop path` | Killing only the original supervisor and then using the public cleanup path must reap the exact target PID and authenticated guardian process group. |
| `S2-F56-SOURCE-STRUCTURAL-02` | `S2-F56-SOURCE-STRUCTURAL-02 every Local Web negative-PGID signal route is limited to the proven detached supervisor self-group` | Parent and target sources contain no negative-PGID route; only a locally proven detached self-group may signal itself. |
| `S2-F56-SPAWN-FAILURE-03` | `S2-F56-SPAWN-FAILURE-03 synchronous persistent launch failure leaves no private guardian lease directory` | Synchronous launch failure removes the per-launch private lease directory and creates no transferable authority. |
| `S2-F56-GUARDIAN-ACK-STOP-RACE-04` | `S2-F56-GUARDIAN-ACK-STOP-RACE-04 authenticated same-chunk ACK and STOP reaps the real guardian target group` | Same-chunk ACK/STOP ordering must authenticate, start, and clean the actual guardian target group. |
| `S2-F56-GUARDIAN-ACK-STOP-ORDERING-05` | `S2-F56-GUARDIAN-ACK-STOP-ORDERING-05 guardian claims spawn ownership before async readiness and self-cleans post-spawn control failures` | Any post-spawn control failure must self-reap after ownership is claimed, including before asynchronous readiness. |
| `S2-F56-GUARDIAN-FD3-RELAY-ISOLATION-06` | `S2-F56-GUARDIAN-FD3-RELAY-ISOLATION-06 authenticated target cannot inject a forged semantic frame into the guardian relay` | The target receives no relay writer and cannot inject semantic frames into the guardian result plane. |
| `S2-F56-GUARDIAN-RESULT-PLANE-07` | `S2-F56-GUARDIAN-RESULT-PLANE-07 guardian lease control rejects terminal result frames` | Guardian UDS lease control accepts no terminal `RESULT`; terminal frames stay on the supervisor relay. |
| `S2-F56-GUARDIAN-LEASE-PERMISSIONS-08` | `S2-F56-GUARDIAN-LEASE-PERMISSIONS-08 persistent guardian lease has private modes and is removed after public cleanup` | The lease directory/socket are private and are removed after public cleanup. |
| `S2-F56-LEADER-CLOSE-AUTOREAP-09` | `S2-F56-LEADER-CLOSE-AUTOREAP-09 original supervisor close alone revokes the guardian lease and reaps its target group` | Supervisor close revokes the lease and reaps the target without requiring an additional public STOP. |
| `S2-F56-LEASE-REVOCATION-10` | `S2-F56-LEASE-REVOCATION-10 verified receipt becomes unavailable before group absence after public STOP` | Public STOP revokes diagnostic receipt authority before group absence is observed. |
| `S2-F56-REGRESSION-LIVENESS-PIPE-11` | `S2-F56-REGRESSION-LIVENESS-PIPE-11 guardian reaps after only its original supervisor closes while the controller event loop is stalled` | Guardian liveness EOF must reap the target while the controller remains alive and stalled. |
| `S2-F56-REGRESSION-RESULT-RELAY-12` | `S2-F56-REGRESSION-RESULT-RELAY-12 missing or unterminated RESULT relay data cannot report a successful runCommand after cleanup` | A missing, unterminated, or otherwise rejected relay frame clears terminal success; successful child cleanup cannot convert protocol failure into a passed command. |

These twelve rows raise `local-web-lease-supervisor` from 11 to **23**
required scenarios and raise the frozen static inventory from 179 to **191**
scenario IDs. The twelve required behavior keys are
`final56-leader-loss-cleanup`, `final56-supervisor-close-auto-reap`,
`final56-lease-revocation`, `final56-spawn-failure-cleanup`,
`final56-ack-stop-race`, `final56-ack-stop-ordering`,
`final56-fd3-relay-isolation`, `final56-result-plane`,
`final56-lease-permissions`, `final56-source-structural-signal`,
`final56-liveness-pipe`, and `final56-result-relay-fail-closed`. Existing
Final-44 and Final-45 rows, browser counts, browser matrix, and
platform-skip policy remain unchanged.
