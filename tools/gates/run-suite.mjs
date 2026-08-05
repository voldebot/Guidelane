import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { artifactsArgument, main, runOffline } from './lib.mjs'

const suite = process.argv[2]
const artifacts = artifactsArgument()
const simple = { offline: ['npm', ['test']], orchestrator: ['npm', ['run', 'test', '--workspace=@guidelane/orchestrator']], 'cockpit-build': ['npm', ['run', 'build', '--workspace=@guidelane/cockpit']] }
const profile = { 'local-web': 'normal', 'local-web-seeded': 'seeded' }
const browserSuites = { 'e2e-chromium': 'chromium', 'e2e-webkit': 'webkit' }
const inventoryPath = new URL('./s2-test-inventory.json', import.meta.url)
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
const final22CockpitScenarioIds = Object.freeze([
  'S2-CPT-01', 'S2-CPT-02', 'S2-CPT-03', 'S2-CPT-04', 'S2-CPT-05', 'S2-CPT-06', 'S2-CPT-07', 'S2-CPT-08', 'S2-CPT-09', 'S2-CPT-10',
  'S2-CPT-11', 'S2-CPT-12', 'S2-CPT-13', 'S2-CPT-14', 'S2-CPT-15', 'S2-CPT-16', 'S2-CPT-17', 'S2-CPT-18', 'S2-CPT-19',
])
const final24BrowserScenarioId = 'S2-F24-A-BROWSER'
const final27CockpitScenarioIds = Object.freeze(['S2-F27-CPT-ACTIVITY-20', 'S2-F27-CPT-GATE-PURPOSES-21'])
const final29CockpitScenarioIds = Object.freeze(['S2-F29-CPT-TAB'])
const final30CockpitScenarioIds = Object.freeze(['S2-F30-CPT-LAYOUT'])
const browserScenarioIds = Object.freeze([...final22CockpitScenarioIds, ...final27CockpitScenarioIds, ...final29CockpitScenarioIds, ...final30CockpitScenarioIds, final24BrowserScenarioId])
const browserScenarioSet = new Set(browserScenarioIds)
const requiredBrowserNames = Object.freeze(['chromium', 'webkit'])
const requiredBrowserCommands = Object.freeze(requiredBrowserNames.map((browser) => `npm run test:e2e:${browser}`))
const requiredCockpitViewports = Object.freeze(['1280x800', '1024x768'])
const exactArray = (value, expected) => Array.isArray(value) && value.length === expected.length && value.every((entry, index) => entry === expected[index])
const exactSet = (actual, expected) => actual.size === expected.size && [...expected].every((entry) => actual.has(entry))
const browserExecutionKey = ({ scenarioId, variant, browser, viewport }) => `${scenarioId}:${variant}:${browser}:${viewport}`

async function cockpitInventory() {
  let inventory
  try { inventory = JSON.parse(await readFile(inventoryPath, 'utf8')) } catch { throw new Error('browser evidence inventory is unreadable') }
  if (!Array.isArray(inventory?.scenarios)) throw new Error('browser evidence inventory scenarios are invalid')
  const rows = inventory.scenarios.filter((row) => final22CockpitScenarioIds.includes(row?.id) || final27CockpitScenarioIds.includes(row?.id) || final29CockpitScenarioIds.includes(row?.id) || final30CockpitScenarioIds.includes(row?.id) || row?.id === final24BrowserScenarioId)
  const rowIds = new Set(); const titles = new Set(); const variants = new Set(); const byTitle = new Map(); const executions = []
  for (const row of rows) {
    if (!row || typeof row.id !== 'string' || rowIds.has(row.id) || !browserScenarioSet.has(row.id) || row.layer !== 'e2e' || row.crossBrowser !== true) throw new Error('browser evidence inventory must contain unique required cross-browser rows')
    if ((row.id === final24BrowserScenarioId && row.category !== 'engine-failure-mapping') || (row.id !== final24BrowserScenarioId && row.category !== 'cockpit-novice-journey')) throw new Error(`${row.id} has an invalid frozen browser category`)
    if (!exactArray(row.browserCommands, requiredBrowserCommands)) throw new Error(`${row.id} must declare exactly Chromium and WebKit browser commands`)
    if (!exactArray(row.viewports, requiredCockpitViewports)) throw new Error(`${row.id} must declare exactly the required browser viewports`)
    if (row.executionEvidence?.source !== 'browser' || row.executionEvidence?.selector !== row.id) throw new Error(`${row.id} must declare its browser execution selector`)
    if (!Array.isArray(row.browserEvidence) || row.browserEvidence.length === 0) throw new Error(`${row.id} must declare browserEvidence`)
    rowIds.add(row.id)
    for (const execution of row.browserEvidence) {
      if (!execution || typeof execution.title !== 'string' || !execution.title.startsWith('CPT-E2E-') || typeof execution.variant !== 'string' || !/^[a-z0-9-]+$/.test(execution.variant) || titles.has(execution.title) || variants.has(execution.variant)) throw new Error(`${row.id} has duplicate or invalid browserEvidence mapping`)
      titles.add(execution.title); variants.add(execution.variant)
      const mapped = { scenarioId: row.id, ...execution }
      byTitle.set(execution.title, mapped)
      for (const browser of requiredBrowserNames) for (const viewport of requiredCockpitViewports) executions.push({ ...mapped, browser, viewport })
    }
  }
  if (!exactSet(rowIds, browserScenarioSet) || rows.length !== browserScenarioIds.length) throw new Error('browser evidence inventory must contain the frozen Final-22, Final-27, Final-29, Final-30, and Final-24 browser scenario set')
  if (titles.size === 0 || titles.size !== variants.size || executions.length !== titles.size * requiredBrowserNames.length * requiredCockpitViewports.length) throw new Error('browser evidence inventory does not define a complete unique browser execution matrix')
  return { rows, browsers: requiredBrowserNames, viewports: requiredCockpitViewports, byTitle, executions }
}

async function attachmentBytes(attachment, rawArtifacts) {
  if (!attachment || typeof attachment !== 'object') throw new Error('Playwright report has malformed attachment')
  if (typeof attachment.body === 'string') return Buffer.from(attachment.body, 'base64')
  if (typeof attachment.path === 'string') {
    let raw; let target
    try { raw = await realpath(rawArtifacts); target = await realpath(attachment.path) } catch { throw new Error('Playwright report attachment is unreadable') }
    if (target === raw || !target.startsWith(`${raw}/`)) throw new Error('Playwright report attachment escapes the raw artifact directory')
    try { return await readFile(target) } catch { throw new Error('Playwright report attachment is unreadable') }
  }
  throw new Error('Playwright report attachment has no readable content')
}

function isSameOrigin(origin, url) {
  try { return new URL(url).origin === new URL(origin).origin } catch { return false }
}

function directEvidence(value, expected, canonicalReference, captureDigest) {
  const requests = value?.requests
  if (value?.schemaVersion !== 1 || value?.scenarioId !== expected.scenarioId || value?.variant !== expected.variant || !requests || typeof requests.origin !== 'string' || !Array.isArray(requests.entries) || !Number.isInteger(requests.maxEntries) || requests.maxEntries < 0 || requests.entries.length > requests.maxEntries || !requests.entries.every((entry) => entry && typeof entry.method === 'string' && typeof entry.url === 'string' && isSameOrigin(requests.origin, entry.url))) throw new Error('structured browser request evidence is invalid')
  if (value?.console?.errorCount !== 0) throw new Error('browser evidence must assert zero console errors')
  if (value?.accessibility?.axeViolations?.length !== 0 || value.accessibility.ariaSnapshotChecked !== true) throw new Error('browser evidence must assert clean axe and aria snapshot')
  if (value?.forbiddenMaterial?.absent !== true || !Array.isArray(value.forbiddenMaterial.checks) || value.forbiddenMaterial.checks.length === 0) throw new Error('browser evidence must assert forbidden material is absent')
  if (value?.capture?.reference !== canonicalReference || value.capture.digest !== captureDigest) throw new Error('browser evidence capture reference or digest is invalid')
  return { requestEvidence: { origin: requests.origin, entryCount: requests.entries.length, maxEntries: requests.maxEntries, sameOrigin: true }, consoleAssertion: { errorCount: 0 }, accessibilityAssertion: { axeViolations: 0, ariaSnapshotChecked: true }, forbiddenAssertion: { absent: true, checkCount: value.forbiddenMaterial.checks.length } }
}

function legacyEvidence(value, expected) {
  const requestLog = value?.requestLog
  if (value?.schemaVersion !== 1 || value?.scenario !== expected.title || value?.project !== `${expected.browser}-${expected.viewport}` || !requestLog || requestLog.sameOrigin !== true || requestLog.relativeServerPaths !== true || !Number.isInteger(requestLog.browserRequestCount) || !Number.isInteger(requestLog.serverRequestCount) || !Array.isArray(requestLog.boundedServerRequests) || requestLog.boundedServerRequests.length > 32 || !requestLog.boundedServerRequests.every((entry) => entry && typeof entry.method === 'string' && typeof entry.path === 'string' && entry.path.startsWith('/'))) throw new Error('structured browser request evidence is invalid')
  if (value?.assertions?.zeroConsoleErrors !== true || value.assertions.forbiddenMaterialAbsent !== true) throw new Error('browser assertions are invalid')
  if (value?.accessibility?.captured !== true || !Number.isInteger(value.accessibility.characterCount) || value.accessibility.characterCount < 1 || value?.axe?.completed !== true || value.axe.violationCount !== 0) throw new Error('browser accessibility evidence is invalid')
  if (value.screenshotAttachment !== 'guidelane-screenshot') throw new Error('browser screenshot attachment is not scenario-linked')
  return { requestEvidence: { origin: 'same-origin', entryCount: requestLog.boundedServerRequests.length, maxEntries: 32, sameOrigin: true }, consoleAssertion: { errorCount: 0 }, accessibilityAssertion: { axeViolations: 0, ariaSnapshotChecked: true }, forbiddenAssertion: { absent: true, checkCount: 1 } }
}

async function executionEvidence(result, expected, artifactsDirectory, rawArtifacts) {
  if (!Array.isArray(result.attachments)) throw new Error('Playwright report execution has no attachments')
  const jsonAttachments = result.attachments.filter((attachment) => attachment?.name === 'guidelane-evidence' && attachment.contentType === 'application/json')
  if (jsonAttachments.length !== 1) throw new Error('Playwright report execution must have exactly one structured evidence attachment')
  let evidence
  try { evidence = JSON.parse((await attachmentBytes(jsonAttachments[0], rawArtifacts)).toString('utf8')) } catch { throw new Error('structured browser evidence is not valid JSON') }
  const linkedCapture = typeof evidence?.capture?.reference === 'string' ? `guidelane-capture:${expected.scenarioId}:${expected.variant}` : evidence?.screenshotAttachment
  const captures = result.attachments.filter((attachment) => attachment?.name === linkedCapture && attachment.contentType === 'image/png')
  if (captures.length !== 1) throw new Error('Playwright report execution must have exactly one scenario-linked PNG attachment')
  const bytes = await attachmentBytes(captures[0], rawArtifacts)
  if (bytes.length < 8 || !bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) throw new Error('scenario-linked capture is not a PNG')
  const reference = `captures/${expected.browser}-${expected.scenarioId}-${expected.variant}-${expected.viewport}.png`
  const digest = sha256(bytes)
  const assertions = evidence?.capture ? directEvidence(evidence, expected, reference, digest) : legacyEvidence(evidence, expected)
  const destination = resolve(artifactsDirectory, reference)
  await mkdir(resolve(destination, '..'), { recursive: true })
  await writeFile(destination, bytes)
  return { scenarioId: expected.scenarioId, variant: expected.variant, browser: expected.browser, viewport: expected.viewport, status: 'passed', ...assertions, capture: { reference, digest } }
}

async function completeBrowserEvidence(report, browser, inventory, artifactsDirectory, rawArtifacts) {
  if (!report || !Array.isArray(report.suites)) throw new Error('Playwright JSON report is malformed')
  if (!inventory.browsers.includes(browser)) throw new Error(`browser ${browser} is not declared by the cockpit inventory`)
  const expectedExecutions = inventory.executions.filter((execution) => execution.browser === browser)
  const expectedByKey = new Map(expectedExecutions.map((execution) => [browserExecutionKey(execution), execution]))
  const expectedProjects = new Set(expectedExecutions.map(({ viewport }) => `${browser}-${viewport}`)); const seen = new Map(); const browserResults = []
  const visit = async (suites) => {
    if (!Array.isArray(suites)) throw new Error('Playwright JSON report suites are malformed')
    for (const suite of suites) {
      if (!suite || typeof suite !== 'object') throw new Error('Playwright JSON report contains an invalid suite')
      if (suite.suites) await visit(suite.suites)
      if (!suite.specs) continue
      if (!Array.isArray(suite.specs)) throw new Error('Playwright JSON report specs are malformed')
      for (const spec of suite.specs) for (const test of spec.tests ?? []) {
        const mapping = inventory.byTitle.get(spec?.title)
        if (!mapping || !expectedProjects.has(test?.projectName) || !Array.isArray(test?.results) || test.results.length !== 1 || test.results[0]?.status !== 'passed') throw new Error('Playwright report contains unknown, skipped, or non-passing execution')
        const expected = { ...mapping, browser, viewport: test.projectName.slice(`${browser}-`.length) }
        const key = browserExecutionKey(expected)
        if (!expectedByKey.has(key)) throw new Error('Playwright report contains an execution outside the declared browser matrix')
        if (seen.has(key)) throw new Error(`Playwright report contains duplicate execution for ${key}`)
        seen.set(key, true); browserResults.push(await executionEvidence(test.results[0], expected, artifactsDirectory, rawArtifacts))
      }
    }
  }
  await visit(report.suites)
  if (seen.size !== expectedByKey.size || [...expectedByKey.keys()].some((key) => !seen.has(key))) throw new Error('Playwright report is missing required browser execution')
  return browserResults
}

function tapExecutionTitles(stdout, source) {
  const titles = []
  const lines = stdout.split(/\r?\n/)
  const subtests = /^([ \t]*)# Subtest:\s+(.+)$/
  const outcomes = /^([ \t]*)(ok|not ok)\s+\d+\s+-\s+(.+?)(?:\s+#\s*(.*))?$/i
  for (let index = 0; index < lines.length; index += 1) {
    const subtest = subtests.exec(lines[index])
    if (!subtest) continue
    const [, indent, selector] = subtest
    let outcome
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const nested = subtests.exec(lines[cursor])
      const candidate = outcomes.exec(lines[cursor])
      if (candidate && candidate[1] === indent) { outcome = candidate; break }
      // A sibling (or parent) starts before this subtest reported an outcome.
      if (nested && nested[1].length <= indent.length) break
    }
    if (!outcome) continue
    const [, , status, outcomeTitle, directive = ''] = outcome
    if (status.toLowerCase() !== 'ok' || outcomeTitle !== selector) continue
    if (/^SKIP\b/i.test(directive)) {
      const skip = /^SKIP\s+(.+)$/i.exec(directive)
      titles.push({ source, selector, status: 'skipped', ...(skip?.[1] === undefined ? {} : { skipReason: skip[1] }) })
      continue
    }
    // A TODO directive is never acceptance evidence.
    if (/\bTODO\b/i.test(directive)) { titles.push({ source, selector, status: 'todo' }); continue }
    titles.push({ source, selector, status: 'passed' })
  }
  return titles
}

async function declaredRows(source) {
  const inventory = JSON.parse(await readFile(inventoryPath, 'utf8'))
  return inventory.scenarios.filter((row) => row.executionEvidence?.source === source)
}

function reconcile(rows, evidence) {
  const declared = new Set()
  for (const row of rows) {
    const selector = row.executionEvidence?.selector
    if (typeof selector !== 'string' || !selector || declared.has(selector)) throw new Error('inventory execution evidence selectors must be unique')
    declared.add(selector)
    const matches = evidence.filter((entry) => entry.selector === selector)
    const platformSkip = row.platformSkip
    const accepted = matches.length === 1 && (matches[0].status === 'passed' || (platformSkip?.reason && matches[0].status === 'skipped' && matches[0].skipReason === platformSkip.reason))
    if (!accepted) throw new Error(`${row.id} lacks exactly one passed execution evidence record or its exact platform skip`)
  }
  return evidence.filter((entry) => declared.has(entry.selector))
}

async function profileEvidence(nativeDirectory, source) {
  const proof = JSON.parse(await readFile(join(nativeDirectory, 'result.json'), 'utf8'))
  const rows = await declaredRows(source)
  const evidence = []
  for (const row of rows) {
    const selector = row.executionEvidence.selector
    if (source === 'native-gate' && selector === 'final24:boot-instance-nonce') {
      const receipt = JSON.parse(await readFile(join(nativeDirectory, 'gates', 'boot.json'), 'utf8'))
      if (proof.status === 'passed' && Array.isArray(proof.completedGates) && proof.completedGates.includes('boot') && receipt.kind === 'guidelane.local-web.gate' && receipt.gate === 'boot' && receipt.status === 'passed') evidence.push({ source, selector, status: 'passed' })
      continue
    }
    const gate = selector.replace(/^(?:gate|seed):/, '')
    if (source === 'native-gate') {
      const receipt = JSON.parse(await readFile(join(nativeDirectory, 'gates', `${gate}.json`), 'utf8'))
      if (proof.status === 'passed' && Array.isArray(proof.completedGates) && proof.completedGates.includes(gate) && receipt.kind === 'guidelane.local-web.gate' && receipt.gate === gate && receipt.status === 'passed') evidence.push({ source, selector, status: 'passed' })
    } else {
      const receipt = JSON.parse(await readFile(join(nativeDirectory, `seed-${gate}.json`), 'utf8'))
      if (proof.status === 'passed' && receipt.kind === 'guidelane.local-web.seed' && receipt.expectedGate === gate && receipt.status === 'passed' && receipt.attributable === true && receipt.observedExitCode !== null && receipt.observedExitCode !== 0 && receipt.cleanup?.projectRemoved === true && receipt.cleanup?.childProcessesReaped === true) evidence.push({ source, selector, status: 'passed' })
    }
  }
  return reconcile(rows, evidence)
}

await main(suite ?? 'unknown-suite', async () => {
  if (!suite || !artifacts) throw new Error('usage: run-suite.mjs <suite> --artifacts DIR')
  if (simple[suite]) {
    const [command, args] = simple[suite]
    if (suite === 'cockpit-build') {
      await runOffline(command, args)
      return { suite, command: `${command} ${args.join(' ')}` }
    }
    const output = await runOffline(command, args, { capture: true }); const source = suite === 'offline' ? 'offline-tap' : 'orchestrator-tap'
    const executionEvidence = reconcile(await declaredRows(source), tapExecutionTitles(output.stdout, source))
    return { suite, command: `${command} ${args.join(' ')}`, executionEvidence }
  }
  if (suite in profile) { const native = resolve(artifacts, 'native'); await runOffline('npm', ['run', profile[suite], '--workspace=@guidelane/local-web-profile', '--', '--artifacts', native]); const proof = JSON.parse(await readFile(join(native, 'result.json'), 'utf8')); const source = suite === 'local-web' ? 'native-gate' : 'native-seed-rejection'; return { suite, nativeEvidence: 'native/result.json', nativeKind: proof.kind, nativeDigest: proof.digest, executionEvidence: await profileEvidence(native, source) } }
  if (suite in browserSuites) {
    const browser = browserSuites[suite]; const raw = await mkdtemp(join(tmpdir(), `guidelane-${browser}-playwright-`)); const inventory = await cockpitInventory()
    try {
      await runOffline('npm', ['exec', '--workspace=@guidelane/cockpit', '--', 'playwright', 'test', '--config', 'playwright.config.ts', ...inventory.viewports.flatMap((viewport) => ['--project', `${browser}-${viewport}`])], { env: { COCKPIT_ARTIFACTS: raw } })
      let report; try { report = JSON.parse(await readFile(join(raw, 'playwright-report.json'), 'utf8')) } catch { throw new Error('Playwright JSON report is unreadable') }
      const browserResults = await completeBrowserEvidence(report, browser, inventory, artifacts, raw)
      const executionEvidence = reconcile(inventory.rows, inventory.rows.map((row) => ({ source: 'browser', selector: row.executionEvidence.selector, status: browserResults.filter((entry) => entry.scenarioId === row.id).length === inventory.executions.filter((entry) => entry.browser === browser && entry.scenarioId === row.id).length ? 'passed' : 'failed' })))
      return { suite, browserResults, executionEvidence }
    } finally {
      await rm(raw, { recursive: true, force: true })
    }
  }
  throw new Error(`unknown suite ${suite}`)
})
