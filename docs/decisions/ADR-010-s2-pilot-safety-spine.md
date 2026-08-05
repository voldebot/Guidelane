# ADR-010: S2 Novice-Pilot Safety Spine

- **Status**: Accepted — offline implementation closed; live and friends-pilot validation remain open
- **Date**: 2026-08-03
- **Deciders**: Talha (owner), Codex (technical lead)
- **Extends**: ADR-002, ADR-006, ADR-008, ADR-009. Supersedes none.
- **Evidence**: `docs/research/sprint-03-novice-pilot/`

## Context

S1 delivered a tested engine session handle, but not a product boundary. The
first novice pilot adds persistence, process recovery, a localhost command
surface, one ejectable project profile, and a cockpit. Those surfaces introduce
three risks that cannot be delegated to the engine: an orphaned authenticated
process can keep spending quota, an inherited environment can expose unrelated
secrets, and a browser on another origin can target a localhost API.

The product also needs to survive supervisor death without treating a partial
write or an abandoned phase as success. A database would add migration and
transaction scope before the pilot needs queries, while browser storage would
make the cockpit a competing state authority.

## Decision

1. `packages/orchestrator` is the sole state authority for one project and one
   active phase. Cockpit memory is view state only; reopen starts from a
   canonical snapshot.
2. S2 persists immutable, append-only JSON records beneath the injected project
   data root. Each record carries schema and identity fields plus a SHA-256
   reference. A small manifest advances by same-filesystem temporary write,
   sync, and atomic rename only after referenced evidence is verified. The
   project root itself must be a real directory; a project-root symlink is
   rejected before lock acquisition or any artifact write.
3. Unknown schema, missing evidence, digest mismatch, stale revision,
   manifest/git divergence, and unsafe paths become `recovery-required`. They
   never become a warning attached to a successful state.
4. Every attempt persists an immutable launch intent before spawn. A detached,
   nonce-bound wrapper must prove that it is its process-group leader and attach
   its OS start identity before the orchestrator sends `GO`; only then may it
   start the engine. Restart validates that durable receipt before signalling
   the group, proves bounded absence, marks the old attempt interrupted, and
   opens any later work as a distinct attempt. Unverifiable identity remains a
   cleanup-capable recovery state and blocks replacement work.
   The wrapper assigns a whitespace-free, nonce-bound process-title sentinel;
   restart requires exact `ps` command equality rather than parsing a source
   pathname. Successful completion is also an exact-attempt terminal operation:
   all seven machine gates and their evidence must already be durable, the
   wrapper-bound group is reaped before G5 is published, and one immutable
   completed run keeps the receipt and evidence. Exact-completion recovery
   history is a prepared intent until the exact G5 manifest exists. If a crash
   leaves no completed run, exact interruption may consume that intent. If the
   exact completed run is durable while the old G4 manifest remains, reopen
   verifies the receipt, evidence, run, attempt, and process-absence boundary
   before publishing G5 exactly once. If the supervisor dies after the G5
   manifest commit but before removing the recovery marker, reopen removes only
   an exact stale marker. Any divergence remains fail-closed without a new
   revision, event, or process signal. More than one valid active record permanently
   latches ambiguous recovery for that open; no record is selected or signalled.
   If reconciliation itself is interrupted after publishing an exact
   interruption, a later reopen may finalize only the prepared completion
   intent bound to that terminal history, receipt, attempt, evidence, and absent
   process group. A canonical completed G5 run may archive only its exact
   crash-stranded running fixture, without a signal or a new revision. Mutable
   marker removal is followed by a parent-directory sync.
   Project-lock takeover is recoverable only through a digest-valid signed guard
   bound to the unchanged dead predecessor receipt and a confirmed-gone
   successor identity. Opaque, malformed, unbound, live, or unobservable
   (`EPERM`, `EACCES`, or an unknown probe result) guards remain fail-closed.
   A crash after the atomic successor-lock rename but before guard removal is a
   second exact durable state: reopen may remove the guard only when the current
   lock bytes are the guard-bound canonical dead successor receipt, both owner
   identities remain confirmed gone across stable rereads, and no signal is
   sent. Process inspection never resolves `ps` through inherited `PATH`; on
   supported macOS/Linux hosts it uses `/bin/ps`, and unsupported platforms fail
   closed before a process-ownership decision.
5. Engine children receive an explicit environment allow-list built from an
   empty object. The orchestrator enforces it before durable intent/spawn and
   the wrapper enforces it again before GO. Internal markers are finite rather
   than prefix-authorized, and updater disabling is internally forced. There is
   no deny-list fallback. Authenticated build work stays disabled unless the
   owner-operated smoke preserves subscription mode with `apiKeySource: none`
   under that environment. Engine receipts count the exact finite operator
   entries that crossed the allow-list and separately count omitted entries;
   forced internal entries are not misreported as inherited operator state.
   Immediately after a detached engine pid exists, the session holds only local
   provisional group ownership while it observes the start identity. It adds a
   durable receipt and registry entry only after an exact identity succeeds. An
   absent, `EPERM`, `EACCES`, or unknown observation failure rejects startup and
   reaps only that provisional process group; it never continues with a
   receipt-less detached child or bare-pid fallback.
   Local Web command cleanup likewise treats process lifecycle observation as a
   state machine: a bounded close wait registers its listener, immediately
   rechecks terminal state, and uses a referenced timer while awaited. A close
   that races listener attachment must settle to verified cleanup or an explicit
   fail-closed cleanup result; it may never leave an unattended pending promise.
   Every detached Local Web command is lease-supervised. The parent retains a
   private control-pipe write end; the detached supervisor owns its current
   process group and self-reaps on lease EOF, authenticated STOP, supervisor
   TERM, control failure, or unexpected child exit. It performs bounded
   TERM-to-KILL escalation only against its own live group. The parent never
   authorizes a negative-PGID signal from a PID/PGID/start-time receipt.
   Process observations are diagnostic only and cannot substitute for lease
   ownership. A missing or malformed readiness/control protocol closes the
   lease, blocks work, and reports unverified cleanup unless group absence is
   directly observed. Finite commands publish their terminal result only after
   the supervisor has reaped descendants. A persistent server may transfer to
   later browser gates only after its boot evidence is atomically durable; an
   observer, health, or evidence-write failure retains local ownership through
   cleanup. A normal-harness cleanup record is semantic and redacted: it
   records only lifecycle stage, ownership verification, reap result, and an
   opaque receipt digest. Neither path nor port, nonce, command, receipt, or
   environment enters that cleanup record.
6. Production HTTP and WebSocket traffic binds only to `127.0.0.1` and uses one
   origin. A single-use 128-bit launch token arrives in the URL fragment and is
   exchanged for an HttpOnly, SameSite session. Mutations and WebSocket upgrades
   require the exact Host, Origin, and session. The canonical read-only snapshot
   also requires exact Host and session; it alone permits a missing Origin
   because Chromium omits Origin on same-origin GET fetches. An Origin that is
   present must still be exact. Its response is explicitly `Cache-Control:
   no-store`. CORS is disabled.
7. Only semantic, revisioned events cross the cockpit boundary. Raw engine
   events, reasoning, tool calls, stderr, paths, diffs, terminal output, and
   credentials are neither persisted nor serialized to the client.
8. The only S2 project profile is Local Web: Next.js, Tailwind v4, and
   SQLite/Drizzle; one local user; no auth, deployment, payment, or external API.
   Generated projects have no Guidelane runtime dependency and use repository-
   local git identity and accepted snapshots for rollback. Generation accepts
   only an absent target or an existing real empty directory beneath a verified
   canonical anchor. Ambient `cwd` and `TMPDIR` anchors enter that set only
   after every existing ancestor to the filesystem root passes the same policy.
   Existing components must be real, current-UID-owned where POSIX metadata
   exists, and not group/world-writable. It rejects symlinks, unsafe
   permissions, foreign ownership, or existing content before writing or
   initializing Git.
   Every Local Web Git operation is a separate child-process trust boundary.
   On supported macOS/Linux hosts it invokes only the fixed `/usr/bin/git`
   executable after checking that it is executable; an unavailable boundary
   fails before `git init` can create repository metadata. Each invocation
   starts from a finite literal environment with a fixed PATH and a fresh,
   application-controlled `/tmp` runtime for HOME, XDG configuration, global
   configuration, templates, and hooks. System/global/parent Git configuration
   and terminal prompts are disabled, while command-scoped template and hook
   locations prevent a repository-local setting from re-enabling an external
   hook. No inherited `PATH`, `GIT_*` control, template, hook, or secret-like
   parent value crosses this boundary. The test-only unavailable-executable
   seam is lexical and deliberately absent from the public profile entry point.
   This boundary applies only to a repository that S2 has just created in an
   absent or verified empty target. S2 does not import, adopt, or manage an
   existing or subsequently tampered repository. A future scope that does so
   must either attest generated-project provenance and reject unsafe local Git
   configuration or neutralize every configuration-driven external helper
   before mutation; the finite parent environment alone is not that guarantee.
   Artifact, static cockpit, and generator roots validate every caller-
   controlled existing leaf and ancestor. Private current-owner roots,
   root-owned non-writable OS ancestors, and required sticky OS temporary roots
   are trusted; arbitrary writable or foreign anchors are not.
9. A normal Local Web success has one exact attempt-scoped authority triplet:
   pending, candidate, and terminal records beneath
   `local-web/native/attempts/<attemptId>`. The candidate, terminal,
   `local-web/native/result.json`, and `local-web/result.json` bind the same
   attempt, candidate digest, and terminal result identity. The global artifact
   validator checks canonical paths, schemas, status, cardinality, and every
   cross-binding. Its final evidence index is a one-to-one map of regular
   artifact bytes: each row has exactly own `path` and lowercase SHA-256
   `sha256` fields; missing, duplicate, malformed, phantom, or unindexed rows
   fail closed. These self-hashes are single-owner integrity checks, not
   cross-principal signatures.
10. The novice flow is Turkish-first with complete English keys and explicit
   G0–G6 states. Chromium and WebKit execute the deterministic journey plus all
   eleven real-orchestrator public failure projections at 1280×800 and
   1024×768 before any live engine journey is attempted. Test engines remain
   offline and never invoke a real Claude session.
   Natural keyboard order prioritizes the current decision over the secondary
   language control without positive `tabindex` overrides. At the minimum
   1024×768 viewport, explicit grid placement keeps the persistent rail on the
   left and the current decision in the main pane rather than relying on CSS
   auto-placement. A successful canonical snapshot response clears transient
   unavailable/loading state when its revision equals the last accepted
   revision and its canonical state differs; an identical equal-revision
   response only clears transient unavailability. It never replaces a newer
   snapshot. Canonical equality includes schema version and blueprint revision;
   installing a differing canonical state clears stale semantic activity so the
   displayed state cannot contradict the canonical recovery action. Semantic
   activity is retained only when its allow-listed source message, event
   revision, and mapped stage/run/decision exactly agree with the canonical
   snapshot. A newly received event establishes a minimum canonical revision:
   a lower recovery response is fail-closed, does not install a snapshot, and
   suppresses decision controls until an equal-or-newer canonical snapshot
   arrives. A missed activity may be reconstructed only from that fixed local
   map; unknown or contradictory state clears it and can never become an API
   disclosure route.

### Final-56 amendment — supervisor-leader-loss containment (2026-08-05)

The persistent Local Web mode separates the controller, detached guardian, and
target process into explicit ownership boundaries. The original supervisor
provides the guardian with a dedicated fd4 liveness lease; the guardian treats
EOF, error, or close on that lease as autonomous cleanup authority and reaps
only its own proven process group. The target receives neither the fd4 lease nor
the fd3 result relay. The controller and guardian each enforce the authenticated
relay sequence `READY -> LEASED -> RESULT` with the per-launch nonce. Any
duplicate, out-of-order, malformed, or nonce-mismatched relay invalidates
terminal success and propagates a non-success result even when the child exits
zero. This closes the prior supervisor-SIGKILL orphan and early-success relay
gaps without granting a parent process negative-PGID signaling authority.

The containment claim remains bounded to POSIX hosts and trusted same-UID
targets. A hostile same-UID process that can interfere with the private socket
or guardian is outside this single-user pilot guarantee and remains an explicit
residual.

## Consequences

- SQLite and Atlas are unnecessary for S2 state. A later need for queries or
  concurrency requires a new ADR and a forward migration from append-only
  exports; no destructive in-place migration is implied.
- An incomplete or ambiguous recovery can stop the pilot even when the previous
  UI looked successful. This is intentional fail-closed behavior.
- WebKit automation is evidence for the protocol and novice flow, not a claim
  that real Safari has been tested. Safari and Chrome support remains blocked
  until owner-machine smoke checks are recorded.
- Offline fake-engine and browser evidence cannot prove authenticated
  subscription compatibility. Live auth and one supervised journey are a
  separate, opt-in tier and consume quota only with owner consent.
- Friends-pilot distribution remains blocked until Anthropic's written
  headless-subscription response is recorded, required GitHub checks are active,
  the limited live tier is green, and security/final reviews have no blocker.
- Darwin may add `__CF_USER_TEXT_ENCODING` to a launched process after the
  canonical environment is supplied. Tests prove a caller cannot control that
  value. Same-UID concurrent filesystem substitution remains an explicit local
  pilot residual; broader path/permission ambiguity fails closed.
- Duplicate JSON-key rejection and cross-principal evidence attestation are
  deliberately outside the single-owner, Node-only artifact-root trust model.
  A future cross-parser or hostile-artifact scope must add a strict parser and
  trusted coordinator-bound signing with replay coverage.

## References

- `docs/research/sprint-03-novice-pilot/RESEARCH.md`
- `docs/research/sprint-03-novice-pilot/GATE_CONTRACT.md`
- `docs/research/sprint-03-novice-pilot/DESIGN_DIRECTION.md`
- `packages/orchestrator/`
- `profiles/local-web/`
- `apps/cockpit/`
