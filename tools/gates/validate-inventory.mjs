import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { assertStaticTopLevelTapExecutionSelectorInSource, assertTapExecutionSelectorInSource, main } from './lib.mjs'

const inventoryPath = resolve(new URL('./s2-test-inventory.json', import.meta.url).pathname)
const requiredBehaviorKeys = new Set([
  'artifact-atomic-temp-write-interruption', 'artifact-missing-evidence', 'artifact-corrupt-digest', 'artifact-unknown-schema',
  'artifact-manifest-ahead-git-behind', 'artifact-git-ahead-manifest-behind', 'artifact-stale-revision', 'artifact-second-lock-holder', 'artifact-turkish-utf8-byte-identity',
  'failure-denial', 'failure-hook', 'failure-rate-limit-five-hour', 'failure-rate-limit-seven-day', 'failure-interruption', 'failure-framing', 'failure-io', 'failure-receipt', 'failure-recovery', 'failure-unknown',
  'failure-stall',
  'b1-detached-fake-engine-process-group', 'b1-supervisor-sigkill', 'b1-process-table-reap-proof', 'b1-interrupted-terminal-record', 'b1-restart-reconciliation', 'b1-distinct-next-attempt',
  'environment-explicit-allow-list', 'environment-secret-like-variables-absent', 'environment-locale-preserved', 'environment-api-key-source-none',
  'http-loopback-only', 'http-origin-validation', 'http-token-replay', 'http-invalid-cookie', 'http-malformed-command', 'http-semantic-only-serialization', 'http-revision-gap-snapshot', 'http-disconnect-reconnect', 'http-utf8-command-payload',
  'cockpit-g0-g6-turkish-first', 'cockpit-statuses', 'cockpit-reopen-snapshot', 'cockpit-forbidden-data-absent', 'cockpit-keyboard-focus', 'cockpit-axe', 'cockpit-wait-controls', 'cockpit-recovery-state',
  'local-web-normal-lint', 'local-web-normal-type', 'local-web-normal-unit', 'local-web-normal-build', 'local-web-normal-boot-health', 'local-web-normal-axe', 'local-web-normal-smoke',
  'local-web-seeded-lint', 'local-web-seeded-type', 'local-web-seeded-unit', 'local-web-seeded-build', 'local-web-seeded-boot', 'local-web-seeded-axe', 'local-web-seeded-smoke',
  'final29-g5-active-rejection', 'final29-g6-completion-reopen', 'final29-two-attempt-ambiguity', 'final29-three-attempt-ambiguity',
  'final29-artifact-safe-root-unsafe-ancestor', 'final29-artifact-foreign-ancestor', 'final29-cockpit-unsafe-static-leaf', 'final29-cockpit-unsafe-static-ancestor', 'final29-cockpit-foreign-static-owner',
  'final29-local-web-unsafe-cwd', 'final29-local-web-unsafe-tmpdir', 'final29-local-web-safe-anchors', 'final29-cockpit-keyboard-order',
  'final30-success-marker-crash', 'final39-local-web-trusted-git-boundary', 'final44-local-web-orphan-cleanup', 'final44-local-web-observer-rejection-cleanup',
  'final45-controller-loss-lease-eof-cleanup', 'final45-boot-evidence-persistence-cleanup', 'final45-stale-identity-no-parent-negative-pgid', 'final45-malformed-supervisor-control-fails-closed',
  'final45-finite-completion-and-timeout-cleanup', 'final45-production-source-no-parent-negative-pgid',
  'final46-observation-outage-reap-without-parent-authority', 'final46-self-group-signal-failure-fail-stop', 'final46-attempt-authority-is-fresh-and-terminal', 'final46-authority-and-terminal-binding-fail-closed', 'final46-source-structural-signal-and-redaction-boundary',
  'final56-leader-loss-cleanup', 'final56-supervisor-close-auto-reap', 'final56-lease-revocation', 'final56-spawn-failure-cleanup', 'final56-ack-stop-race', 'final56-ack-stop-ordering', 'final56-fd3-relay-isolation', 'final56-result-plane', 'final56-lease-permissions', 'final56-source-structural-signal', 'final56-liveness-pipe', 'final56-result-relay-fail-closed',
])
const final22CockpitScenarioIds = Object.freeze([
  'S2-CPT-01', 'S2-CPT-02', 'S2-CPT-03', 'S2-CPT-04', 'S2-CPT-05', 'S2-CPT-06', 'S2-CPT-07', 'S2-CPT-08', 'S2-CPT-09', 'S2-CPT-10',
  'S2-CPT-11', 'S2-CPT-12', 'S2-CPT-13', 'S2-CPT-14', 'S2-CPT-15', 'S2-CPT-16', 'S2-CPT-17', 'S2-CPT-18', 'S2-CPT-19',
])
const final24BrowserScenarioId = 'S2-F24-A-BROWSER'
const final27CockpitScenarioIds = Object.freeze(['S2-F27-CPT-ACTIVITY-20', 'S2-F27-CPT-GATE-PURPOSES-21'])
const final29CockpitScenarioIds = Object.freeze(['S2-F29-CPT-TAB'])
const final30CockpitScenarioIds = Object.freeze(['S2-F30-CPT-LAYOUT'])
const final44LocalWebOrphanCleanupId = 'S2-F44-LOCAL-WEB-ORPHAN-CLEANUP'
const final44LocalWebOrphanCleanupTitle = 'S2-F44-LOCAL-WEB-ORPHAN-CLEANUP normal harness reaps its real generated Next server and verified group before returning'
const final44LocalWebObserverRejectionId = 'S2-F44-LOCAL-WEB-OBSERVER-FAILURE'
const final44LocalWebObserverRejectionTitle = 'S2-F44-LOCAL-WEB-OBSERVER-FAILURE rejects the observer and reaps its verified generated Next group'
const final45LeaseSupervisorScenarios = Object.freeze([
  ['S2-F45-LEASE-EOF-01', 'S2-F45-LEASE-EOF-01 controller-loss lease EOF reaps the authenticated generated server group and releases its loopback port'],
  ['S2-F45-BOOT-EVIDENCE-02', 'S2-F45-BOOT-EVIDENCE-02 boot-evidence persistence failure reaps the generated server before return and never publishes a passed boot gate'],
  ['S2-F45-STALE-IDENTITY-03', 'S2-F45-STALE-IDENTITY-03 stale or reused diagnostic identity never authorizes parent negative-PGID signalling'],
  ['S2-F45-CONTROL-04', 'S2-F45-CONTROL-04 malformed or missing supervisor readiness and control fails closed and leaves no owned group'],
  ['S2-F45-FINITE-05', 'S2-F45-FINITE-05 finite completion and timeout each reap their descendant through the lease supervisor'],
  ['S2-F45-SOURCE-06', 'S2-F45-SOURCE-06 production Local Web source has no parent negative-PGID signal route'],
])
const final45LeaseSupervisorScenarioMap = new Map(final45LeaseSupervisorScenarios)
const final46LeaseSupervisorScenarios = Object.freeze([
  ['S2-F46-OBSERVATION-OUTAGE-01', 'S2-F46-OBSERVATION-OUTAGE-01 post-initial-proof ps outage during STOP and lease EOF keeps supervisor self-authority in-memory and reaps the target without parent signalling'],
  ['S2-F46-SELF-GROUP-SIGNAL-02', 'S2-F46-SELF-GROUP-SIGNAL-02 supervisor self-group signal failure remains fail-stopped and retries instead of taking a voluntary cleanup exit'],
  ['S2-F46-ATTEMPT-AUTHORITY-03', 'S2-F46-ATTEMPT-AUTHORITY-03 prior boot pass cannot authorize a current attempt after candidate terminal or replacement failure'],
  ['S2-F46-AUTHORITY-BINDING-04', 'S2-F46-AUTHORITY-BINDING-04 missing pending malformed or mismatched authority and terminal binding fail closed with exact attempt candidate digest and result identity'],
  ['S2-F46-SOURCE-STRUCTURAL-05', 'S2-F46-SOURCE-STRUCTURAL-05 all scoped Local Web sources forbid parent negative-PGID signalling and persist no raw runtime identity authority'],
])
const final46LeaseSupervisorScenarioMap = new Map(final46LeaseSupervisorScenarios)
const final56LeaseSupervisorScenarios = Object.freeze([
  ['S2-F56-LEADER-KILL-01', 'S2-F56-LEADER-KILL-01 SIGKILL of the original persistent supervisor leaves neither its exact target nor its recorded group running after the public stop path'],
  ['S2-F56-SOURCE-STRUCTURAL-02', 'S2-F56-SOURCE-STRUCTURAL-02 every Local Web negative-PGID signal route is limited to the proven detached supervisor self-group'],
  ['S2-F56-SPAWN-FAILURE-03', 'S2-F56-SPAWN-FAILURE-03 synchronous persistent launch failure leaves no private guardian lease directory'],
  ['S2-F56-GUARDIAN-ACK-STOP-RACE-04', 'S2-F56-GUARDIAN-ACK-STOP-RACE-04 authenticated same-chunk ACK and STOP reaps the real guardian target group'],
  ['S2-F56-GUARDIAN-ACK-STOP-ORDERING-05', 'S2-F56-GUARDIAN-ACK-STOP-ORDERING-05 guardian claims spawn ownership before async readiness and self-cleans post-spawn control failures'],
  ['S2-F56-GUARDIAN-FD3-RELAY-ISOLATION-06', 'S2-F56-GUARDIAN-FD3-RELAY-ISOLATION-06 authenticated target cannot inject a forged semantic frame into the guardian relay'],
  ['S2-F56-GUARDIAN-RESULT-PLANE-07', 'S2-F56-GUARDIAN-RESULT-PLANE-07 guardian lease control rejects terminal result frames'],
  ['S2-F56-GUARDIAN-LEASE-PERMISSIONS-08', 'S2-F56-GUARDIAN-LEASE-PERMISSIONS-08 persistent guardian lease has private modes and is removed after public cleanup'],
  ['S2-F56-LEADER-CLOSE-AUTOREAP-09', 'S2-F56-LEADER-CLOSE-AUTOREAP-09 original supervisor close alone revokes the guardian lease and reaps its target group'],
  ['S2-F56-LEASE-REVOCATION-10', 'S2-F56-LEASE-REVOCATION-10 verified receipt becomes unavailable before group absence after public STOP'],
  ['S2-F56-REGRESSION-LIVENESS-PIPE-11', 'S2-F56-REGRESSION-LIVENESS-PIPE-11 guardian reaps after only its original supervisor closes while the controller event loop is stalled'],
  ['S2-F56-REGRESSION-RESULT-RELAY-12', 'S2-F56-REGRESSION-RESULT-RELAY-12 missing or unterminated RESULT relay data cannot report a successful runCommand after cleanup'],
])
const final56LeaseSupervisorScenarioMap = new Map(final56LeaseSupervisorScenarios)
const browserScenarioIds = Object.freeze([...final22CockpitScenarioIds, ...final27CockpitScenarioIds, ...final29CockpitScenarioIds, ...final30CockpitScenarioIds, final24BrowserScenarioId])
const browserScenarioSet = new Set(browserScenarioIds)
const requiredBrowserNames = Object.freeze(['chromium', 'webkit'])
const requiredBrowserCommands = Object.freeze(requiredBrowserNames.map((browser) => `npm run test:e2e:${browser}`))
const requiredCockpitViewports = Object.freeze(['1280x800', '1024x768'])
const final29PlatformSkips = new Map([
  ['S2-F29-ARTIFACT-ROOT-02', 'creating a foreign-owned ancestor requires a privileged test account'],
  ['S2-F29-COCKPIT-ROOT-03', 'creating a foreign-owned cockpit root requires a privileged test account'],
])
const exactArray = (value, expected) => Array.isArray(value) && value.length === expected.length && value.every((entry, index) => entry === expected[index])
const exactSet = (actual, expected) => actual.size === expected.size && [...expected].every((entry) => actual.has(entry))
await main('inventory', async () => {
  let inventory
  try { inventory = JSON.parse(await readFile(inventoryPath, 'utf8')) } catch (error) { throw new Error(`inventory unreadable: ${error instanceof Error ? error.message : String(error)}`) }
  if (inventory.schemaVersion !== 1 || !Array.isArray(inventory.scenarios) || !inventory.minimumByCategory) throw new Error('inventory schema is invalid')
  const ids = new Set(); const executionSelectors = new Set(); const categoryCounts = {}; const browserE2eIds = new Set(); const cockpitTitles = new Set(); const cockpitVariants = new Set()
  for (const row of inventory.scenarios) {
    if (!row || typeof row.id !== 'string' || typeof row.category !== 'string' || typeof row.file !== 'string' || typeof row.testName !== 'string' || typeof row.layer !== 'string' || typeof row.authority !== 'string' || typeof row.command !== 'string') throw new Error('every inventory row requires id, category, file, testName, layer, authority, and command')
    if (ids.has(row.id)) throw new Error(`duplicate scenario ID: ${row.id}`)
    ids.add(row.id); categoryCounts[row.category] = (categoryCounts[row.category] ?? 0) + 1
    const expectedPlatformSkip = final29PlatformSkips.get(row.id)
    if (expectedPlatformSkip === undefined ? row.platformSkip !== undefined : row.platformSkip?.reason !== expectedPlatformSkip || Object.keys(row.platformSkip).length !== 1) throw new Error(`${row.id} has an invalid platformSkip contract`)
    const isFinal24Browser = row.id === final24BrowserScenarioId
    const isCockpitBrowser = final22CockpitScenarioIds.includes(row.id) || final27CockpitScenarioIds.includes(row.id) || final29CockpitScenarioIds.includes(row.id) || final30CockpitScenarioIds.includes(row.id)
    const expectedSource = isCockpitBrowser || isFinal24Browser ? 'browser' : row.category === 'local-web-normal' ? 'native-gate' : row.category === 'local-web-seeded' ? 'native-seed-rejection' : row.command === 'npm run test:offline' ? 'offline-tap' : 'orchestrator-tap'
    if (!row.executionEvidence || row.executionEvidence.source !== expectedSource || typeof row.executionEvidence.selector !== 'string' || !row.executionEvidence.selector) throw new Error(`${row.id} must declare category-appropriate executionEvidence`)
    if (row.id === final44LocalWebOrphanCleanupId && (row.category !== 'local-web-orphan-cleanup' || row.file !== 'profiles/local-web/test/harness.test.ts' || row.testName !== final44LocalWebOrphanCleanupTitle || row.layer !== 'process' || row.authority !== 'machine' || row.command !== 'npm run test:offline' || row.executionEvidence.selector !== final44LocalWebOrphanCleanupTitle)) throw new Error('S2-F44 local-web orphan cleanup inventory contract is invalid')
    if (row.id === final44LocalWebObserverRejectionId && (row.category !== 'local-web-orphan-cleanup' || row.file !== 'profiles/local-web/test/harness.test.ts' || row.testName !== final44LocalWebObserverRejectionTitle || row.layer !== 'process' || row.authority !== 'machine' || row.command !== 'npm run test:offline' || row.executionEvidence.selector !== final44LocalWebObserverRejectionTitle)) throw new Error('S2-F44 local-web observer-rejection cleanup inventory contract is invalid')
    const final45Title = final45LeaseSupervisorScenarioMap.get(row.id)
    if (final45Title !== undefined && (row.category !== 'local-web-lease-supervisor' || row.file !== 'profiles/local-web/test/lease-supervisor.test.ts' || row.testName !== final45Title || row.layer !== 'process' || row.authority !== 'machine' || row.command !== 'npm run test:offline' || row.executionEvidence.selector !== final45Title)) throw new Error(`${row.id} local-web lease-supervisor inventory contract is invalid`)
    const final46Title = final46LeaseSupervisorScenarioMap.get(row.id)
    if (final46Title !== undefined && (row.category !== 'local-web-lease-supervisor' || row.file !== 'profiles/local-web/test/lease-supervisor.test.ts' || row.testName !== final46Title || row.layer !== 'process' || row.authority !== 'machine' || row.command !== 'npm run test:offline' || row.executionEvidence.selector !== final46Title)) throw new Error(`${row.id} Final46 lease-supervisor inventory contract is invalid`)
    const final56Title = final56LeaseSupervisorScenarioMap.get(row.id)
    if (final56Title !== undefined && (row.category !== 'local-web-lease-supervisor' || row.file !== 'profiles/local-web/test/lease-supervisor.test.ts' || row.testName !== final56Title || row.layer !== 'process' || row.authority !== 'machine' || row.command !== 'npm run test:offline' || row.executionEvidence.selector !== final56Title)) throw new Error(`${row.id} Final56 lease-supervisor inventory contract is invalid`)
    const executionKey = `${expectedSource}:${row.executionEvidence.selector}`
    if (executionSelectors.has(executionKey)) throw new Error(`duplicate executionEvidence selector: ${executionKey}`)
    executionSelectors.add(executionKey)
    let source
    try { source = await readFile(resolve(new URL('../..', import.meta.url).pathname, row.file), 'utf8') } catch { throw new Error(`${row.id} names unreadable test file ${row.file}`) }
    if (expectedSource === 'offline-tap' || expectedSource === 'orchestrator-tap') {
      assertTapExecutionSelectorInSource(source, row.executionEvidence.selector)
      if (row.id.startsWith('S2-F29-') || row.id.startsWith('S2-F30-') || row.id === 'S2-F39-LOCAL-WEB-GIT-01' || row.id === final44LocalWebOrphanCleanupId || row.id === final44LocalWebObserverRejectionId || final45LeaseSupervisorScenarioMap.has(row.id) || final46LeaseSupervisorScenarioMap.has(row.id) || final56LeaseSupervisorScenarioMap.has(row.id)) assertStaticTopLevelTapExecutionSelectorInSource(source, row.executionEvidence.selector)
    }
    if (!source.includes(row.testName)) throw new Error(`${row.id} maps to no executable test name in ${row.file}: ${row.testName}`)
    if (isCockpitBrowser || isFinal24Browser) {
      if (row.layer !== 'e2e' || !browserScenarioSet.has(row.id)) throw new Error(`${row.id} must be a frozen e2e browser scenario`)
      if ((isFinal24Browser && row.category !== 'engine-failure-mapping') || (!isFinal24Browser && row.category !== 'cockpit-novice-journey')) throw new Error(`${row.id} has an invalid frozen browser category`)
      browserE2eIds.add(row.id)
      if (row.crossBrowser !== true) throw new Error(`${row.id} must be cross-browser`)
      if (!exactArray(row.browserCommands, requiredBrowserCommands)) throw new Error(`${row.id} must name exactly Chromium and WebKit browser commands`)
      if (!exactArray(row.viewports, requiredCockpitViewports)) throw new Error(`${row.id} must name exactly the required browser viewports`)
      if (row.executionEvidence.selector !== row.id) throw new Error(`${row.id} browser execution evidence must use its scenario ID selector`)
      if (!Array.isArray(row.browserEvidence) || row.browserEvidence.length === 0) throw new Error(`${row.id} must declare complete browserEvidence mappings`)
      for (const execution of row.browserEvidence) {
        if (!execution || typeof execution.title !== 'string' || typeof execution.variant !== 'string' || !execution.title.startsWith('CPT-E2E-') || !/^[a-z0-9-]+$/.test(execution.variant) || cockpitTitles.has(execution.title) || cockpitVariants.has(execution.variant)) throw new Error(`${row.id} has a duplicate or invalid browserEvidence mapping`)
        if (row.id === 'S2-F29-CPT-TAB' || row.id === 'S2-F30-CPT-LAYOUT') assertStaticTopLevelTapExecutionSelectorInSource(source, execution.title)
        cockpitTitles.add(execution.title); cockpitVariants.add(execution.variant)
      }
    }
  }
  if (![...final29PlatformSkips.keys()].every((id) => ids.has(id))) throw new Error('inventory omits a frozen Final-29 platformSkip row')
  if (![final44LocalWebOrphanCleanupId, final44LocalWebObserverRejectionId, ...final45LeaseSupervisorScenarioMap.keys(), ...final46LeaseSupervisorScenarioMap.keys(), ...final56LeaseSupervisorScenarioMap.keys()].every((id) => ids.has(id))) throw new Error('inventory omits a frozen Final-44, Final-45, Final-46, or Final-56 local-web cleanup row')
  if (!inventory.requiredBehaviorCoverage || typeof inventory.requiredBehaviorCoverage !== 'object' || Array.isArray(inventory.requiredBehaviorCoverage)) throw new Error('inventory must declare requiredBehaviorCoverage')
  const coverageKeys = Object.keys(inventory.requiredBehaviorCoverage)
  if (coverageKeys.length !== requiredBehaviorKeys.size || coverageKeys.some((key) => !requiredBehaviorKeys.has(key))) throw new Error('inventory required behavior keys must exactly match the frozen gate contract')
  for (const key of requiredBehaviorKeys) {
    const scenarioId = inventory.requiredBehaviorCoverage[key]
    if (typeof scenarioId !== 'string' || !ids.has(scenarioId)) throw new Error(`required behavior ${key} maps to no executable inventory scenario`)
  }
  if (!exactSet(browserE2eIds, browserScenarioSet) || categoryCounts['cockpit-novice-journey'] !== final22CockpitScenarioIds.length + final27CockpitScenarioIds.length + final29CockpitScenarioIds.length + final30CockpitScenarioIds.length || categoryCounts['engine-failure-mapping'] < 1) throw new Error('browser inventory must contain the frozen Final-22, Final-27, Final-29, Final-30, and Final-24 browser scenario set')
  if (cockpitTitles.size !== cockpitVariants.size || cockpitTitles.size === 0) throw new Error('cockpit inventory must map a unique browser title and variant for every browser case')
  for (const [category, minimum] of Object.entries(inventory.minimumByCategory)) if ((categoryCounts[category] ?? 0) < minimum) throw new Error(`${category} has ${categoryCounts[category] ?? 0}, requires ${minimum}`)
  const requiredScenarioMinimum = Object.values(inventory.minimumByCategory).reduce((total, minimum) => {
    if (!Number.isInteger(minimum) || minimum < 0) throw new Error('inventory category minimums must be non-negative integers')
    return total + minimum
  }, 0)
  if (ids.size < requiredScenarioMinimum) throw new Error(`inventory has ${ids.size} unique scenario IDs, requires ${requiredScenarioMinimum}`)
  return { inventoryPath: 'tools/gates/s2-test-inventory.json', scenarioCount: ids.size, categoryCounts, declaredExecutionEvidence: inventory.scenarios.map(({ id, executionEvidence }) => ({ id, ...executionEvidence })) }
})
