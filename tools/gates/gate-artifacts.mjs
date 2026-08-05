import { lstat, readdir, readFile } from 'node:fs/promises'
import { relative, resolve } from 'node:path'
import { artifactsArgument, ensureSourceManifest, main, sha256 } from './lib.mjs'
import { assertClean, scanSourceInputs } from './source-redaction.mjs'

const technicalUi = /(?:stderr|thinking|reasoning|terminal output|diff --git|\/Users\/|\/home\/|api[_ -]?key|password)/i
const root = resolve(new URL('../..', import.meta.url).pathname)
const attemptEvidenceKinds = new Set([
  'guidelane.local-web.attempt-authority',
  'guidelane.local-web.attempt-candidate',
  'guidelane.local-web.attempt-terminal',
])
const nativeEvidenceKinds = new Set([
  'guidelane.local-web.gate', 'guidelane.local-web.install', 'guidelane.local-web.seed-preparation',
  'guidelane.local-web.mutation', 'guidelane.local-web.harness', 'guidelane.local-web.seed',
  ...attemptEvidenceKinds,
])
const attemptIdPattern = /^[a-z][a-z0-9-]{7,127}$/
const digestPattern = /^[a-f0-9]{64}$/
const attemptRecordPathPattern = /^local-web\/native\/attempts\/([a-z][a-z0-9-]{7,127})\/(authority|candidate|terminal)\.json$/
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
const final29PlatformSkips = new Map([
  ['S2-F29-ARTIFACT-ROOT-02', 'creating a foreign-owned ancestor requires a privileged test account'],
  ['S2-F29-COCKPIT-ROOT-03', 'creating a foreign-owned cockpit root requires a privileged test account'],
])
const exactArray = (value, expected) => Array.isArray(value) && value.length === expected.length && value.every((entry, index) => entry === expected[index])
const exactSet = (actual, expected) => actual.size === expected.size && [...expected].every((entry) => actual.has(entry))
const browserExecutionKey = ({ scenarioId, variant, browser, viewport }) => `${scenarioId}:${variant}:${browser}:${viewport}`
async function filesUnder(directory) {
  const rootInfo = await lstat(directory)
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) throw new Error('evidence root must be a real directory, not a symlink')
  const results = []
  async function walk(path) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const next = resolve(path, entry.name)
      if (entry.isSymbolicLink()) throw new Error(`evidence tree contains a symlink: ${relative(directory, next)}`)
      if (entry.isDirectory()) await walk(next)
      else if (entry.isFile()) results.push(next)
      else throw new Error(`evidence tree contains a non-regular entry: ${relative(directory, next)}`)
    }
  }
  await walk(directory)
  return results
}
function isRecord(value) { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function hasExactKeys(value, keys) {
  if (!isRecord(value)) return false
  const actual = Object.keys(value)
  return actual.length === keys.length && actual.every((key) => keys.includes(key))
}
function assertDigest(value, label) {
  if (typeof value !== 'string' || !digestPattern.test(value)) throw new Error(`${label} must be a lowercase SHA-256 digest`)
}
function assertNativeRecordDigest(record, label) {
  if (!isRecord(record)) throw new Error(`${label} must be a JSON object`)
  assertDigest(record.digest, `${label} digest`)
  const { digest, ...unsigned } = record
  if (sha256(JSON.stringify(unsigned)) !== digest) throw new Error(`${label} has an invalid native evidence digest`)
}
function assertAttemptSummary(summary, label) {
  const keys = ['attemptId', 'candidateDigest', 'resultIdentity', 'status', 'accepted']
  if (!hasExactKeys(summary, keys)) throw new Error(`${label} must contain the exact Final-46 authority summary`)
  if (typeof summary.attemptId !== 'string' || !attemptIdPattern.test(summary.attemptId)) throw new Error(`${label} has an invalid attempt ID`)
  assertDigest(summary.candidateDigest, `${label} candidate digest`)
  assertDigest(summary.resultIdentity, `${label} result identity`)
  if (summary.status !== 'passed' || summary.accepted !== true) throw new Error(`${label} must be passed and accepted`)
}
function assertAttemptCandidate(record, attemptId, summary, label) {
  const keys = ['schemaVersion', 'kind', 'identity', 'attemptId', 'candidateDigest', 'status', 'digest']
  if (!hasExactKeys(record, keys)) throw new Error(`${label} has an invalid candidate schema`)
  if (record.schemaVersion !== 1 || record.kind !== 'guidelane.local-web.attempt-candidate' || record.identity !== `attempt-candidate-${attemptId}` || record.attemptId !== attemptId || record.candidateDigest !== summary.candidateDigest || record.status !== 'passed') throw new Error(`${label} does not bind the accepted candidate`)
  assertNativeRecordDigest(record, label)
}
function assertAttemptAuthority(record, attemptId, summary, label) {
  const keys = ['schemaVersion', 'kind', 'identity', 'attemptId', 'candidateDigest', 'resultIdentity', 'status', 'digest']
  if (!hasExactKeys(record, keys)) throw new Error(`${label} has an invalid authority schema`)
  if (record.schemaVersion !== 1 || record.kind !== 'guidelane.local-web.attempt-authority' || record.identity !== `attempt-authority-${attemptId}` || record.attemptId !== attemptId || record.candidateDigest !== summary.candidateDigest || record.resultIdentity !== summary.resultIdentity || record.status !== 'passed') throw new Error(`${label} does not bind the accepted authority`)
  assertNativeRecordDigest(record, label)
}
function assertAttemptTerminal(record, attemptId, summary, label) {
  const keys = ['schemaVersion', 'kind', 'identity', 'attemptId', 'candidateDigest', 'resultIdentity', 'status', 'digest']
  if (!hasExactKeys(record, keys)) throw new Error(`${label} has an invalid terminal schema`)
  if (record.schemaVersion !== 1 || record.kind !== 'guidelane.local-web.attempt-terminal' || record.identity !== summary.resultIdentity || record.attemptId !== attemptId || record.candidateDigest !== summary.candidateDigest || record.resultIdentity !== summary.resultIdentity || record.status !== 'passed') throw new Error(`${label} does not bind the accepted terminal result`)
  assertNativeRecordDigest(record, label)
}
async function readEvidenceJson(path, label) {
  try { return JSON.parse(await readFile(path, 'utf8')) } catch { throw new Error(`${label} must be readable JSON`) }
}
async function attemptTreeEntries(path, label) {
  let info
  try { info = await lstat(path) } catch { throw new Error(`${label} is required`) }
  if (info.isSymbolicLink() || !info.isDirectory()) throw new Error(`${label} must be a real directory`)
  return await readdir(path, { withFileTypes: true })
}
async function validateNormalLocalWebAttemptAuthority(artifacts) {
  const localWebResultPath = resolve(artifacts, 'local-web', 'result.json')
  const nativeResultPath = resolve(artifacts, 'local-web', 'native', 'result.json')
  const wrapper = await readEvidenceJson(localWebResultPath, 'local-web result wrapper')
  if (!isRecord(wrapper) || wrapper.schemaVersion !== 1 || wrapper.identity !== 'local-web' || !isRecord(wrapper.payload)) throw new Error('local-web result wrapper is invalid')
  const payload = wrapper.payload
  if (payload.status !== 'passed' || payload.exitStatus !== 0 || payload.nativeEvidence !== 'native/result.json' || payload.nativeKind !== 'guidelane.local-web.harness') throw new Error('local-web result wrapper must bind a passed normal native harness result')
  assertDigest(payload.nativeDigest, 'local-web native result digest')

  const nativeResult = await readEvidenceJson(nativeResultPath, 'local-web native result')
  if (!isRecord(nativeResult) || nativeResult.schemaVersion !== 1 || nativeResult.kind !== 'guidelane.local-web.harness' || nativeResult.mode !== 'normal' || nativeResult.status !== 'passed') throw new Error('local-web native result must be a passed normal harness record')
  assertNativeRecordDigest(nativeResult, 'local-web native result')
  if (payload.nativeDigest !== nativeResult.digest) throw new Error('local-web result wrapper does not bind the native harness digest')
  assertAttemptSummary(nativeResult.attemptAuthority, 'local-web native result attempt authority')
  const summary = nativeResult.attemptAuthority
  if (nativeResult.identity !== summary.resultIdentity) throw new Error('local-web native result identity does not bind its attempt authority')

  const attemptsRoot = resolve(artifacts, 'local-web', 'native', 'attempts')
  const attempts = await attemptTreeEntries(attemptsRoot, 'local-web native attempts directory')
  if (attempts.length !== 1) throw new Error('local-web normal evidence must contain exactly one attempt directory')
  const attempt = attempts[0]
  if (attempt.isSymbolicLink() || !attempt.isDirectory() || !attemptIdPattern.test(attempt.name) || attempt.name !== summary.attemptId) throw new Error('local-web native attempts directory does not match the accepted attempt')
  const attemptDirectory = resolve(attemptsRoot, attempt.name)
  const records = await attemptTreeEntries(attemptDirectory, 'local-web accepted attempt directory')
  const expectedNames = new Set(['authority.json', 'candidate.json', 'terminal.json'])
  if (records.length !== expectedNames.size || records.some((entry) => entry.isSymbolicLink() || !entry.isFile() || !expectedNames.has(entry.name))) throw new Error('local-web accepted attempt must contain exactly authority, candidate, and terminal records')

  const candidate = await readEvidenceJson(resolve(attemptDirectory, 'candidate.json'), 'local-web attempt candidate')
  const authority = await readEvidenceJson(resolve(attemptDirectory, 'authority.json'), 'local-web attempt authority')
  const terminal = await readEvidenceJson(resolve(attemptDirectory, 'terminal.json'), 'local-web attempt terminal')
  assertAttemptCandidate(candidate, attempt.name, summary, 'local-web attempt candidate')
  assertAttemptAuthority(authority, attempt.name, summary, 'local-web attempt authority')
  assertAttemptTerminal(terminal, attempt.name, summary, 'local-web attempt terminal')
}
function validateJsonEvidence(parsed, rel) {
  if (!parsed || typeof parsed !== 'object' || typeof parsed.schemaVersion !== 'number' || typeof parsed.identity !== 'string' || typeof parsed.digest !== 'string') throw new Error(`unclassified JSON evidence ${rel}`)
  const isAttemptEvidence = attemptEvidenceKinds.has(parsed.kind)
  if (isAttemptEvidence && !attemptRecordPathPattern.test(rel)) throw new Error(`attempt evidence is outside the canonical Local Web path in ${rel}`)
  if (Object.prototype.hasOwnProperty.call(parsed, 'payload') && !isAttemptEvidence) {
    const payload = JSON.stringify(parsed.payload, null, 2) + '\n'
    if (sha256(payload) !== parsed.digest) throw new Error(`invalid wrapper evidence digest ${rel}`)
    return
  }
  if (!nativeEvidenceKinds.has(parsed.kind)) throw new Error(`unknown native evidence kind in ${rel}`)
  const { digest, ...unsigned } = parsed
  if (sha256(JSON.stringify(unsigned)) !== digest) throw new Error(`invalid native evidence digest ${rel}`)
}
function requiredPassedWrapper(parsed, rel, identity, sourceManifestDigest) {
  if (parsed?.schemaVersion !== 1 || parsed.identity !== identity || typeof parsed.digest !== 'string' || !parsed.payload || typeof parsed.payload !== 'object') throw new Error(`required gate result has invalid wrapper identity or schema: ${rel}`)
  const payload = JSON.stringify(parsed.payload, null, 2) + '\n'
  if (sha256(payload) !== parsed.digest) throw new Error(`required gate result has invalid digest: ${rel}`)
  if (parsed.payload.sourceManifestDigest !== sourceManifestDigest) throw new Error(`required gate result has wrong source manifest identity: ${rel}`)
  if (parsed.payload.status !== 'passed' || parsed.payload.exitStatus !== 0) throw new Error(`required gate result did not pass: ${rel}`)
}
function cockpitInventory(inventory) {
  if (!inventory || !Array.isArray(inventory.scenarios)) throw new Error('browser evidence inventory scenarios are invalid')
  const rows = inventory.scenarios.filter((row) => final22CockpitScenarioIds.includes(row?.id) || final27CockpitScenarioIds.includes(row?.id) || final29CockpitScenarioIds.includes(row?.id) || final30CockpitScenarioIds.includes(row?.id) || row?.id === final24BrowserScenarioId)
  const rowIds = new Set(); const titles = new Set(); const variants = new Set(); const executions = []
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
      for (const browser of requiredBrowserNames) for (const viewport of requiredCockpitViewports) executions.push({ scenarioId: row.id, variant: execution.variant, browser, viewport })
    }
  }
  if (!exactSet(rowIds, browserScenarioSet) || rows.length !== browserScenarioIds.length) throw new Error('browser evidence inventory must contain the frozen Final-22, Final-27, Final-29, Final-30, and Final-24 browser scenario set')
  if (titles.size === 0 || titles.size !== variants.size || executions.length !== titles.size * requiredBrowserNames.length * requiredCockpitViewports.length) throw new Error('browser evidence inventory does not define a complete unique browser execution matrix')
  return { rows, executions }
}

const validateOnly = process.argv.includes('--validate-only')
const sourceOnly = process.argv.includes('--source-only')

await main('artifacts', async () => {
  let sourceScan = { scannedSourceFiles: 0, scannedSourceBytes: 0 }
  if (!process.argv.includes('--evidence-only')) {
    sourceScan = await scanSourceInputs(root, {
      onSourceText: (text, file) => {
        if (file.startsWith('apps/cockpit/src/') && /\.tsx?$/.test(file) && !file.endsWith('/protocol.ts') && technicalUi.test(text)) throw new Error(`forbidden technical UI contract text in ${file}`)
      },
    })
  }
  if (sourceOnly) {
    if (validateOnly || process.argv.includes('--evidence-only') || artifactsArgument()) throw new Error('--source-only cannot be combined with evidence arguments')
    console.log(`Source redaction scan passed: ${sourceScan.scannedSourceFiles} files, ${sourceScan.scannedSourceBytes} bytes.`)
    return sourceScan
  }
  const artifacts = artifactsArgument()
  if (!artifacts) throw new Error('--artifacts is required; no evidence tree is not a clean result')
  if (artifacts === root || artifacts.startsWith(`${root}/`)) throw new Error('evidence directory must be outside the worktree')
  const files = await filesUnder(artifacts)
  if (!files.length) throw new Error('evidence tree is empty')
  const sourceIdentity = await ensureSourceManifest(artifacts, { create: false })
  if (!files.some((file) => relative(artifacts, file) === 'source-manifest.json')) throw new Error('source manifest is required')
  const expected = [
    'offline/result.json', 'inventory/result.json', 'orchestrator/result.json', 'cockpit-build/result.json', 'e2e-chromium/result.json', 'e2e-webkit/result.json', 'local-web/result.json', 'local-web-seeded/result.json',
    ...(process.argv.includes('--validate-only') ? ['changed-paths/result.json', 'result.json'] : []),
  ]
  const missing = expected.filter((path) => !files.some((file) => relative(artifacts, file) === path))
  if (missing.length) throw new Error(`missing required gate evidence: ${missing.join(', ')}`)
  for (const path of expected) {
    let parsed
    try { parsed = JSON.parse(await readFile(resolve(artifacts, path), 'utf8')) } catch { throw new Error(`required gate result is unreadable: ${path}`) }
    requiredPassedWrapper(parsed, path, path === 'result.json' ? 'artifacts' : path.split('/')[0], sourceIdentity.digest)
  }
  const inventory = JSON.parse(await readFile(resolve(root, 'tools/gates/s2-test-inventory.json'), 'utf8'))
  const { rows: browserRows, executions: expectedBrowserExecutions } = cockpitInventory(inventory)
  const browserEvidence = []
  for (const browser of requiredBrowserNames) {
    const path = `e2e-${browser}/result.json`
    const result = JSON.parse(await readFile(resolve(artifacts, path), 'utf8'))
    if (!Array.isArray(result.payload?.browserResults)) throw new Error(`${path} must contain payload.browserResults`)
    if (result.payload.browserResults.some((entry) => entry?.browser !== browser)) throw new Error(`${path} must contain only ${browser} browser executions`)
    browserEvidence.push(...result.payload.browserResults)
  }
  const browserKeys = new Set()
  for (const expectedExecution of expectedBrowserExecutions) {
    const key = `${expectedExecution.scenarioId}:${expectedExecution.variant}:${expectedExecution.browser}:${expectedExecution.viewport}`
    const matches = browserEvidence.filter((result) => result?.scenarioId === expectedExecution.scenarioId && result?.variant === expectedExecution.variant && result?.browser === expectedExecution.browser && result?.viewport === expectedExecution.viewport)
    if (matches.length !== 1) throw new Error(`browser evidence must contain exactly one execution for ${key}`)
    const result = matches[0]
    const capture = result.capture
    const reference = `captures/${expectedExecution.browser}-${expectedExecution.scenarioId}-${expectedExecution.variant}-${expectedExecution.viewport}.png`
    if (result.status !== 'passed' || !result.requestEvidence || result.requestEvidence.sameOrigin !== true || !Number.isInteger(result.requestEvidence.entryCount) || !Number.isInteger(result.requestEvidence.maxEntries) || result.requestEvidence.entryCount < 0 || result.requestEvidence.entryCount > result.requestEvidence.maxEntries || result.consoleAssertion?.errorCount !== 0 || result.accessibilityAssertion?.axeViolations !== 0 || result.accessibilityAssertion?.ariaSnapshotChecked !== true || result.forbiddenAssertion?.absent !== true || !Number.isInteger(result.forbiddenAssertion?.checkCount) || result.forbiddenAssertion.checkCount < 1 || !capture || capture.reference !== reference || !/^[a-f0-9]{64}$/.test(capture.digest)) throw new Error(`browser evidence fields are invalid for ${key}`)
    const suiteDirectory = resolve(artifacts, `e2e-${expectedExecution.browser}`)
    const captureDirectory = resolve(suiteDirectory, 'captures')
    const capturePath = resolve(suiteDirectory, capture.reference)
    if (!capturePath.startsWith(`${captureDirectory}/`)) throw new Error(`browser capture reference escapes canonical suite directory for ${key}`)
    let captureBytes; try { captureBytes = await readFile(capturePath) } catch { throw new Error(`browser capture is missing for ${key}`) }
    if (sha256(captureBytes) !== capture.digest) throw new Error(`browser capture digest mismatch for ${key}`)
    browserKeys.add(key)
  }
  if (browserEvidence.length !== browserKeys.size || browserKeys.size !== expectedBrowserExecutions.length) throw new Error('browser evidence contains duplicate or unexpected executions')
  for (const row of browserRows) {
    const expected = expectedBrowserExecutions.filter((entry) => entry.scenarioId === row.id)
    const observed = browserEvidence.filter((entry) => entry?.scenarioId === row.id)
    if (observed.length !== expected.length || expected.some((entry) => !browserKeys.has(browserExecutionKey(entry)))) throw new Error(`browser evidence does not exactly reconcile declared scenario ${row.id}`)
  }
  const declaredExecutionEvidence = inventory.scenarios.map(({ id, executionEvidence, platformSkip }) => ({ id, source: executionEvidence?.source, selector: executionEvidence?.selector, platformSkip }))
  const executedEvidence = browserRows.map((row) => ({ source: 'browser', selector: row.executionEvidence?.selector, status: 'passed', executionCount: browserEvidence.filter((entry) => entry.scenarioId === row.id).length }))
  for (const path of ['offline/result.json', 'orchestrator/result.json', 'local-web/result.json', 'local-web-seeded/result.json']) {
    const result = JSON.parse(await readFile(resolve(artifacts, path), 'utf8'))
    if (Array.isArray(result.payload?.executionEvidence)) executedEvidence.push(...result.payload.executionEvidence.map(({ source, selector, status, skipReason }) => ({ source, selector, status, skipReason })))
  }
  for (const declared of declaredExecutionEvidence) {
    if (typeof declared.source !== 'string' || typeof declared.selector !== 'string') throw new Error(`inventory execution evidence is invalid for ${declared.id}`)
    const matches = executedEvidence.filter((entry) => entry.source === declared.source && entry.selector === declared.selector)
    const expectedPlatformSkip = final29PlatformSkips.get(declared.id)
    if (expectedPlatformSkip === undefined ? declared.platformSkip !== undefined : declared.platformSkip?.reason !== expectedPlatformSkip) throw new Error(`inventory platform skip contract is invalid for ${declared.id}`)
    const accepted = matches.length === 1 && (matches[0].status === 'passed' || (expectedPlatformSkip !== undefined && matches[0].status === 'skipped' && matches[0].skipReason === expectedPlatformSkip))
    if (!accepted) throw new Error(`execution evidence must contain exactly one passed mapping or exact platform skip for ${declared.id}`)
  }
  const indexPath = resolve(artifacts, 'index.json')
  let index
  try { index = JSON.parse(await readFile(indexPath, 'utf8')) } catch { throw new Error('evidence index.json is required and must be readable') }
  if (!Array.isArray(index.payload?.results)) throw new Error('evidence index wrapper must contain payload.results')
  if (index.payload.sourceManifestDigest !== sourceIdentity.digest) throw new Error('evidence index has wrong source manifest identity')
  const digests = new Map()
  for (const file of files) {
    const bytes = await readFile(file); const rel = relative(artifacts, file); digests.set(rel, sha256(bytes))
    if (file.endsWith('.json')) {
      let parsed; try { parsed = JSON.parse(bytes.toString('utf8')) } catch { throw new Error(`unreadable JSON evidence ${rel}`) }
      validateJsonEvidence(parsed, rel)
    }
    const text = bytes.toString('utf8')
    assertClean(text, `evidence/${rel}`)
    // Source paths are bound metadata, so a path such as "surface-thinking-render.json"
    // must not be mistaken for raw technical evidence. Its wrapper and source bytes are
    // validated separately below during final validation.
    if (rel !== 'source-manifest.json' && /(?:stderr|thinking|reasoning|terminal output|diff --git|engine event)/i.test(text)) throw new Error(`forbidden raw technical evidence in ${rel}`)
  }
  await validateNormalLocalWebAttemptAuthority(artifacts)
  const indexed = new Map()
  for (const entry of index.payload.results) {
    if (!hasExactKeys(entry, ['path', 'sha256']) || typeof entry.path !== 'string' || entry.path.length === 0) throw new Error('evidence index contains an invalid result row')
    assertDigest(entry.sha256, `evidence index digest for ${entry.path}`)
    if (indexed.has(entry.path)) throw new Error(`evidence index contains a duplicate result path: ${entry.path}`)
    indexed.set(entry.path, entry.sha256)
  }
  for (const path of expected) {
    if (indexed.get(path) !== digests.get(path)) throw new Error(`evidence index missing or has wrong digest for ${path}`)
  }
  for (const [path, digest] of indexed) {
    // During the pre-final write, this gate replaces its own result. Final
    // validate-only instead verifies that result against the completed index.
    if (path === 'result.json' && !process.argv.includes('--validate-only')) continue
    if (digests.get(path) !== digest) throw new Error(`evidence index has an extra or wrong digest for ${String(path)}`)
  }
  for (const path of digests.keys()) {
    if (path === 'index.json' || (path === 'result.json' && !process.argv.includes('--validate-only'))) continue
    if (!indexed.has(path)) throw new Error(`unindexed evidence file ${path}`)
  }
  return { ...sourceScan, evidenceFiles: files.length, declaredExecutionEvidence, executedEvidence }
}, { prepareArtifacts: !validateOnly && !sourceOnly, publishResults: !validateOnly && !sourceOnly })
