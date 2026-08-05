import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { access, chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import test from 'node:test'

const root = resolve(new URL('../..', import.meta.url).pathname)
const browser = 'chromium'
const viewports = ['1280x800', '1024x768']
const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63600000020001e221bc330000000049454e44ae426082', 'hex')
const digest = createHash('sha256').update(png).digest('hex')

// This is deliberately frozen independently of the inventory. It is the
// contract the gate must reconcile against, not a projection of mutable input.
const scenarios = Object.freeze([
  { id: 'S2-CPT-01', executions: [{ variant: 'g0-g6', title: 'CPT-E2E-G0-G6 Turkish novice journey uses semantic activity and canonical reopen' }] },
  { id: 'S2-CPT-02', executions: [{ variant: 'i18n', title: 'CPT-E2E-I18N-05 Turkish defaults and English switch preserves the canonical state' }] },
  { id: 'S2-CPT-03', executions: [
    { variant: 'state-running', title: 'CPT-E2E-STATE-running has text, not color-only, novice status' },
    { variant: 'state-waiting', title: 'CPT-E2E-STATE-waiting has text, not color-only, novice status' },
    { variant: 'state-retrying', title: 'CPT-E2E-STATE-retrying has text, not color-only, novice status' },
    { variant: 'state-stopped', title: 'CPT-E2E-STATE-stopped has text, not color-only, novice status' },
    { variant: 'state-interrupted', title: 'CPT-E2E-STATE-interrupted has text, not color-only, novice status' },
    { variant: 'state-needs-user', title: 'CPT-E2E-STATE-needs-user has text, not color-only, novice status' },
    { variant: 'state-rate-limit', title: 'CPT-E2E-STATE-rate-limit has text, not color-only, novice status' },
    { variant: 'state-recovery-required', title: 'CPT-E2E-STATE-recovery-required has text, not color-only, novice status' },
    { variant: 'gate-card-status', title: 'CPT-E2E-GATES-17 each gate card renders its own state rather than the overall run state' },
  ] },
  { id: 'S2-CPT-04', executions: [
    { variant: 'wait-running', title: 'CPT-E2E-WAIT-running-14 running work is wait-only and has no stale decision control' },
    { variant: 'wait-retrying', title: 'CPT-E2E-WAIT-retrying-14 running work is wait-only and has no stale decision control' },
  ] },
  { id: 'S2-CPT-05', executions: [
    { variant: 'recovery-tr', title: 'CPT-E2E-RECOVERY-15 recovery replaces stale decisions with one refresh action and labels prior evidence honestly' },
    { variant: 'recovery-en', title: 'CPT-E2E-RECOVERY-EN-16 English recovery keeps one refresh action and separates previous evidence from current state' },
  ] },
  { id: 'S2-CPT-06', executions: [{ variant: 'a11y', title: 'CPT-E2E-A11Y-13 keyboard order and axe are clean at the desktop support floor' }] },
  { id: 'S2-CPT-07', executions: [{ variant: 'redaction', title: 'CPT-E2E-REDACTION-02 unsafe WebSocket material never renders and instead reloads the canonical snapshot' }] },
  { id: 'S2-CPT-08', executions: [{ variant: 'launch', title: 'CPT-E2E-LAUNCH-04 exchanges a fragment token once, removes it, stays same-origin, and starts from the canonical snapshot' }] },
  { id: 'S2-CPT-09', executions: [{ variant: 'failure-receipt', title: 'CPT-E2E-FINAL-22-FAILURE-receipt renders the real receipt failure safely' }] },
  { id: 'S2-CPT-10', executions: [{ variant: 'failure-denial', title: 'CPT-E2E-FINAL-22-FAILURE-denial renders the real denial failure safely' }] },
  { id: 'S2-CPT-11', executions: [{ variant: 'failure-hook', title: 'CPT-E2E-FINAL-22-FAILURE-hook renders the real hook failure safely' }] },
  { id: 'S2-CPT-12', executions: [{ variant: 'failure-stall', title: 'CPT-E2E-FINAL-22-FAILURE-stall renders the real stall failure safely' }] },
  { id: 'S2-CPT-13', executions: [{ variant: 'failure-framing', title: 'CPT-E2E-FINAL-22-FAILURE-framing renders the real framing failure safely' }] },
  { id: 'S2-CPT-14', executions: [{ variant: 'failure-io', title: 'CPT-E2E-FINAL-22-FAILURE-io renders the real io failure safely' }] },
  { id: 'S2-CPT-15', executions: [{ variant: 'failure-rate-limit-five-hour', title: 'CPT-E2E-FINAL-22-FAILURE-rate_limit_five_hour renders the real rate_limit_five_hour failure safely' }] },
  { id: 'S2-CPT-16', executions: [{ variant: 'failure-rate-limit-seven-day', title: 'CPT-E2E-FINAL-22-FAILURE-rate_limit_seven_day renders the real rate_limit_seven_day failure safely' }] },
  { id: 'S2-CPT-17', executions: [{ variant: 'failure-interrupted', title: 'CPT-E2E-FINAL-22-FAILURE-interrupted renders the real interrupted failure safely' }] },
  { id: 'S2-CPT-18', executions: [{ variant: 'failure-recovery', title: 'CPT-E2E-FINAL-22-FAILURE-recovery renders the real recovery failure safely' }] },
  { id: 'S2-CPT-19', executions: [{ variant: 'failure-unknown-event', title: 'CPT-E2E-FINAL-22-FAILURE-unknown_event renders the real unknown_event failure safely' }] },
  { id: 'S2-F27-CPT-ACTIVITY-20', executions: [{ variant: 'localized-existing-activity', title: 'CPT-E2E-FINAL-27-I18N-ACTIVITY-20 localizes an existing semantic activity after switching from Turkish to English' }] },
  { id: 'S2-F27-CPT-GATE-PURPOSES-21', executions: [{ variant: 'localized-gate-purposes', title: 'CPT-E2E-FINAL-27-GATE-PURPOSES-21 presents every public machine gate with a distinct localized purpose and clear mixed state' }] },
  { id: 'S2-F29-CPT-TAB', executions: [
    { variant: 'final29-tab-idea-tr', title: 'CPT-E2E-FINAL-29-TAB-DECISION-IDEA-TR reaches the current decision before the secondary language control at every supported Chromium desktop viewport' },
    { variant: 'final29-tab-idea-en', title: 'CPT-E2E-FINAL-29-TAB-DECISION-IDEA-EN reaches the current decision before the secondary language control at every supported Chromium desktop viewport' },
    { variant: 'final29-tab-approval-tr', title: 'CPT-E2E-FINAL-29-TAB-DECISION-APPROVAL-TR reaches the current decision before the secondary language control at every supported Chromium desktop viewport' },
    { variant: 'final29-tab-approval-en', title: 'CPT-E2E-FINAL-29-TAB-DECISION-APPROVAL-EN reaches the current decision before the secondary language control at every supported Chromium desktop viewport' },
    { variant: 'final29-tab-recovery-tr', title: 'CPT-E2E-FINAL-29-TAB-RECOVERY-TR reaches refresh before the secondary language control at every supported Chromium desktop viewport' },
    { variant: 'final29-tab-recovery-en', title: 'CPT-E2E-FINAL-29-TAB-RECOVERY-EN reaches refresh before the secondary language control at every supported Chromium desktop viewport' },
  ] },
  { id: 'S2-F30-CPT-LAYOUT', executions: [
    { variant: 'final30-layout-idea-tr', title: 'CPT-E2E-FINAL-30-LAYOUT-IDEA-TR keeps the persistent rail left and the current decision visible' },
    { variant: 'final30-layout-idea-en', title: 'CPT-E2E-FINAL-30-LAYOUT-IDEA-EN keeps the persistent rail left and the current decision visible' },
    { variant: 'final30-layout-recovery-tr', title: 'CPT-E2E-FINAL-30-LAYOUT-RECOVERY-TR keeps the persistent rail left and refresh visible' },
    { variant: 'final30-layout-recovery-en', title: 'CPT-E2E-FINAL-30-LAYOUT-RECOVERY-EN keeps the persistent rail left and refresh visible' },
  ] },
  { id: 'S2-F24-A-BROWSER', executions: [{ variant: 'attempt-bound-g4-failure', title: 'CPT-E2E-FINAL-24-A browser loopback projects an attempt-bound G4 failure and exposes only the retry action' }] },
])

const expectedExecutions = scenarios.flatMap(({ id, executions }) => executions.flatMap(({ variant, title }) => viewports.map((viewport) => ({ id, variant, title, viewport }))))
assert.equal(scenarios.length, 24, 'the frozen browser contract must name all S2-CPT-01..19 scenarios, both Final-27 cases, Final-29 keyboard order, Final-30 layout, and Final-24 attempt failure')
assert.equal(expectedExecutions.length, 84, 'the frozen browser contract must require 42 titles across both viewports per browser')

function evidence(execution) {
  return {
    schemaVersion: 1,
    scenarioId: execution.id,
    variant: execution.variant,
    requests: {
      origin: 'http://127.0.0.1:4317',
      maxEntries: 3,
      entries: [{ method: 'POST', url: 'http://127.0.0.1:4317/api/v1/session' }, { method: 'GET', url: 'http://127.0.0.1:4317/api/v1/projects/current' }],
    },
    console: { errorCount: 0 },
    accessibility: { axeViolations: [], ariaSnapshotChecked: true },
    forbiddenMaterial: { absent: true, checks: ['engine-output', 'paths', 'secrets'] },
    capture: { reference: `captures/${browser}-${execution.id}-${execution.variant}-${execution.viewport}.png`, digest },
  }
}

function attachment(name, contentType, value) { return { name, contentType, body: Buffer.from(JSON.stringify(value)).toString('base64') } }
function captureAttachment(execution) { return { name: `guidelane-capture:${execution.id}:${execution.variant}`, contentType: 'image/png', body: png.toString('base64') } }

function playwrightReport(executions) {
  return { suites: [{ title: 'novice-journey.spec.ts', specs: executions.map((execution) => ({
    title: execution.title,
    tests: [{ projectName: `${browser}-${execution.viewport}`, results: [{ status: execution.status ?? 'passed', attachments: execution.attachments ?? [
      attachment('guidelane-evidence', 'application/json', evidence(execution)),
      captureAttachment(execution),
    ] }] }],
  })) }] }
}

async function runSuite(report, { rawDirectoryRecord, reportBody = JSON.stringify(report) } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'guidelane-browser-evidence-contract-'))
  const bin = join(directory, 'bin')
  const artifacts = join(directory, 'artifacts')
  await mkdir(bin)
  const npm = join(bin, 'npm')
  await writeFile(npm, `#!${process.execPath}\nimport { mkdir, writeFile } from 'node:fs/promises'\nimport { join } from 'node:path'\nconst raw = process.env.COCKPIT_ARTIFACTS\nawait mkdir(raw, { recursive: true })\n${rawDirectoryRecord ? `await writeFile(${JSON.stringify(rawDirectoryRecord)}, raw, 'utf8')\n` : ''}await writeFile(join(raw, 'playwright-report.json'), ${JSON.stringify(reportBody)}, 'utf8')\n`, 'utf8')
  await chmod(npm, 0o755)
  return await new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, ['tools/gates/run-suite.mjs', 'e2e-chromium', '--artifacts', artifacts], { cwd: root, env: { ...process.env, PATH: `${bin}:${process.env.PATH}` }, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''; let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.once('error', reject)
    child.once('exit', async (code, signal) => {
      let result
      try { result = JSON.parse(await readFile(join(artifacts, 'result.json'), 'utf8')) } catch { result = undefined }
      resolvePromise({ code, signal, stdout, stderr, result })
    })
  })
}

test('inventory declares every browser scenario variant as an executable e2e mapping', async () => {
  const inventory = JSON.parse(await readFile(join(root, 'tools/gates/s2-test-inventory.json'), 'utf8'))
  const actual = inventory.scenarios.filter(({ id }) => scenarios.some((scenario) => scenario.id === id)).map(({ id, layer, browserEvidence }) => ({ id, layer, browserEvidence })).sort(({ id: left }, { id: right }) => left.localeCompare(right))
  const expected = scenarios.map(({ id, executions }) => ({ id, layer: 'e2e', browserEvidence: executions })).sort(({ id: left }, { id: right }) => left.localeCompare(right))
  assert.deepEqual(actual, expected, 'all CPT browser evidence must declare its exact executable title and stable variant')
})

test('browser suite removes raw Playwright artifacts after canonical extraction succeeds', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'guidelane-browser-raw-cleanup-pass-'))
  const rawDirectoryRecord = join(temporary, 'raw-directory.txt')
  try {
    const result = await runSuite(playwrightReport(expectedExecutions), { rawDirectoryRecord })
    assert.equal(result.code, 0, `fixture-backed browser extraction must pass: ${result.stderr}`)
    const rawDirectory = await readFile(rawDirectoryRecord, 'utf8')
    await assert.rejects(access(rawDirectory), { code: 'ENOENT' }, 'the raw Playwright directory must be removed after canonical capture extraction')
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
})

test('browser suite removes raw Playwright artifacts after report extraction fails', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'guidelane-browser-raw-cleanup-fail-'))
  const rawDirectoryRecord = join(temporary, 'raw-directory.txt')
  try {
    const result = await runSuite(null, { rawDirectoryRecord, reportBody: '{malformed-report' })
    assert.notEqual(result.code, 0, 'a malformed fake Playwright report must fail closed')
    const rawDirectory = await readFile(rawDirectoryRecord, 'utf8')
    await assert.rejects(access(rawDirectory), { code: 'ENOENT' }, 'the raw Playwright directory must be removed after a failed report extraction')
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
})

test('browser evidence is derived from each complete passed execution and its attachments', async () => {
  const result = await runSuite(playwrightReport(expectedExecutions))
  assert.equal(result.code, 0, `complete browser evidence must pass: ${result.stderr}`)
  const browserResults = result.result?.payload?.browserResults
  assert.ok(Array.isArray(browserResults), 'passed suite must publish browserResults')
  assert.deepEqual(browserResults, expectedExecutions.map(({ id: scenarioId, variant, viewport }) => ({
    scenarioId, variant, browser, viewport, status: 'passed',
    requestEvidence: { origin: 'http://127.0.0.1:4317', entryCount: 2, maxEntries: 3, sameOrigin: true },
    consoleAssertion: { errorCount: 0 },
    accessibilityAssertion: { axeViolations: 0, ariaSnapshotChecked: true },
    forbiddenAssertion: { absent: true, checkCount: 3 },
    capture: { reference: `captures/${browser}-${scenarioId}-${variant}-${viewport}.png`, digest },
  })))
})

test('browser evidence fails closed for incomplete, untrusted, or ambiguous Playwright output', async (t) => {
  await t.test('skipped execution', async () => {
    const executions = expectedExecutions.map((execution) => ({ ...execution }))
    executions[0].status = 'skipped'
    assert.notEqual((await runSuite(playwrightReport(executions))).code, 0)
  })
  await t.test('not-collected execution', async () => {
    const executions = expectedExecutions.slice(1)
    assert.notEqual((await runSuite(playwrightReport(executions))).code, 0)
  })
  await t.test('duplicate execution', async () => {
    const executions = [...expectedExecutions, { ...expectedExecutions[0] }]
    assert.notEqual((await runSuite(playwrightReport(executions))).code, 0)
  })
  await t.test('unknown test title', async () => {
    const executions = [...expectedExecutions, { ...expectedExecutions[0], title: 'CPT-E2E-UNRECOGNIZED-99', variant: 'unknown' }]
    assert.notEqual((await runSuite(playwrightReport(executions))).code, 0)
  })
  await t.test('missing structured evidence attachment', async () => {
    const executions = expectedExecutions.map((execution) => ({ ...execution }))
    executions[0].attachments = [captureAttachment(executions[0])]
    assert.notEqual((await runSuite(playwrightReport(executions))).code, 0)
  })
  await t.test('corrupt structured evidence attachment', async () => {
    const executions = expectedExecutions.map((execution) => ({ ...execution }))
    executions[0].attachments = [
      { name: 'guidelane-evidence', contentType: 'application/json', body: Buffer.from('{not-json').toString('base64') },
      captureAttachment(executions[0]),
    ]
    assert.notEqual((await runSuite(playwrightReport(executions))).code, 0)
  })
  await t.test('missing scenario-linked PNG attachment', async () => {
    const executions = expectedExecutions.map((execution) => ({ ...execution }))
    executions[0].attachments = [attachment('guidelane-evidence', 'application/json', evidence(executions[0]))]
    assert.notEqual((await runSuite(playwrightReport(executions))).code, 0)
  })
  await t.test('PNG attachment path outside the Playwright raw artifact directory', async () => {
    const external = join(await mkdtemp(join(tmpdir(), 'guidelane-forged-browser-capture-')), 'valid.png')
    await writeFile(external, png)
    const executions = expectedExecutions.map((execution) => ({ ...execution }))
    executions[0].attachments = [
      attachment('guidelane-evidence', 'application/json', evidence(executions[0])),
      { name: `guidelane-capture:${executions[0].id}:${executions[0].variant}`, contentType: 'image/png', path: external },
    ]
    assert.notEqual((await runSuite(playwrightReport(executions))).code, 0, 'a valid PNG outside COCKPIT_ARTIFACTS must not become browser evidence')
  })
})
