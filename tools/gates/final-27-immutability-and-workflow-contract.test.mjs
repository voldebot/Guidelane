import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import test from 'node:test'
import { ensureSourceManifest } from './lib.mjs'

const root = resolve(new URL('../..', import.meta.url).pathname)
const sha256 = (value) => createHash('sha256').update(value).digest('hex')
const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63600000020001e221bc330000000049454e44ae426082', 'hex')
const wrapper = (identity, payload) => JSON.stringify({ schemaVersion: 1, identity, digest: sha256(JSON.stringify(payload, null, 2) + '\n'), payload }, null, 2) + '\n'
const native = (unsigned) => JSON.stringify({ ...unsigned, digest: sha256(JSON.stringify(unsigned)) }, null, 2) + '\n'
const normalAttemptId = 'attempt-final47-final27'
const normalCandidateDigest = sha256('final27 fixture candidate')
const normalResultIdentity = sha256('final27 fixture result')

async function put(base, path, value) {
  const target = join(base, path)
  await mkdir(resolve(target, '..'), { recursive: true })
  await writeFile(target, value)
}

async function finalFixture(artifacts) {
  const sourceIdentity = await ensureSourceManifest(artifacts)
  const bound = (payload) => ({ ...payload, sourceManifestDigest: sourceIdentity.digest })
  const inventory = JSON.parse(await readFile(join(root, 'tools/gates/s2-test-inventory.json'), 'utf8'))
  const simple = ['offline', 'inventory', 'orchestrator', 'cockpit-build', 'local-web', 'local-web-seeded', 'changed-paths']
  const sourceByResult = { offline: 'offline-tap', orchestrator: 'orchestrator-tap', 'local-web': 'native-gate', 'local-web-seeded': 'native-seed-rejection' }
  for (const name of simple) {
    const source = sourceByResult[name]
    const executionEvidence = source === undefined ? [] : inventory.scenarios
      .filter((row) => row.executionEvidence?.source === source)
      .map((row) => ({ source, selector: row.executionEvidence.selector, status: 'passed' }))
    await put(artifacts, `${name}/result.json`, wrapper(name, bound({ status: 'passed', exitStatus: 0, ...(executionEvidence.length ? { executionEvidence } : {}) })))
  }
  const browserRows = inventory.scenarios.filter((row) => row.category === 'cockpit-novice-journey' || row.id === 'S2-F24-A-BROWSER')
  for (const browser of ['chromium', 'webkit']) {
    const browserResults = []
    for (const row of browserRows) for (const { variant } of row.browserEvidence) for (const viewport of ['1280x800', '1024x768']) {
      const reference = `captures/${browser}-${row.id}-${variant}-${viewport}.png`
      await put(artifacts, `e2e-${browser}/${reference}`, png)
      browserResults.push({ scenarioId: row.id, variant, browser, viewport, status: 'passed', requestEvidence: { sameOrigin: true, entryCount: 1, maxEntries: 1 }, consoleAssertion: { errorCount: 0 }, accessibilityAssertion: { axeViolations: 0, ariaSnapshotChecked: true }, forbiddenAssertion: { absent: true, checkCount: 1 }, capture: { reference, digest: sha256(png) } })
    }
    await put(artifacts, `e2e-${browser}/result.json`, wrapper(`e2e-${browser}`, bound({ status: 'passed', exitStatus: 0, browserResults })))
  }
  const attemptRoot = `local-web/native/attempts/${normalAttemptId}`
  await put(artifacts, `${attemptRoot}/candidate.json`, native({
    schemaVersion: 1,
    kind: 'guidelane.local-web.attempt-candidate',
    identity: `attempt-candidate-${normalAttemptId}`,
    attemptId: normalAttemptId,
    candidateDigest: normalCandidateDigest,
    status: 'passed',
  }))
  await put(artifacts, `${attemptRoot}/authority.json`, native({
    schemaVersion: 1,
    kind: 'guidelane.local-web.attempt-authority',
    identity: `attempt-authority-${normalAttemptId}`,
    attemptId: normalAttemptId,
    candidateDigest: normalCandidateDigest,
    resultIdentity: normalResultIdentity,
    status: 'passed',
  }))
  await put(artifacts, `${attemptRoot}/terminal.json`, native({
    schemaVersion: 1,
    kind: 'guidelane.local-web.attempt-terminal',
    identity: normalResultIdentity,
    attemptId: normalAttemptId,
    candidateDigest: normalCandidateDigest,
    resultIdentity: normalResultIdentity,
    status: 'passed',
  }))
  const nativeResult = {
    schemaVersion: 1,
    kind: 'guidelane.local-web.harness',
    identity: normalResultIdentity,
    mode: 'normal',
    status: 'passed',
    gates: ['lint', 'type', 'unit', 'build', 'boot', 'axe', 'smoke'],
    completedGates: ['lint', 'type', 'unit', 'build', 'boot', 'axe', 'smoke'],
    artifactPaths: [],
    attemptAuthority: { attemptId: normalAttemptId, candidateDigest: normalCandidateDigest, resultIdentity: normalResultIdentity, status: 'passed', accepted: true },
    cleanup: { lifecycleStage: 'reaped', ownershipVerified: true, reaped: true },
  }
  await put(artifacts, 'local-web/native/result.json', native(nativeResult))
  const localWebEvidence = inventory.scenarios
    .filter((row) => row.executionEvidence?.source === 'native-gate')
    .map((row) => ({ source: 'native-gate', selector: row.executionEvidence.selector, status: 'passed' }))
  await put(artifacts, 'local-web/result.json', wrapper('local-web', bound({ status: 'passed', exitStatus: 0, nativeEvidence: 'native/result.json', nativeKind: 'guidelane.local-web.harness', nativeDigest: sha256(JSON.stringify(nativeResult)), executionEvidence: localWebEvidence })))
  await put(artifacts, 'result.json', wrapper('artifacts', bound({ status: 'passed', exitStatus: 0 })))
  const paths = ['offline/result.json', 'inventory/result.json', 'orchestrator/result.json', 'cockpit-build/result.json', 'e2e-chromium/result.json', 'e2e-webkit/result.json', 'local-web/result.json', 'local-web-seeded/result.json', 'changed-paths/result.json', 'local-web/native/result.json', `${attemptRoot}/authority.json`, `${attemptRoot}/candidate.json`, `${attemptRoot}/terminal.json`, 'result.json', 'source-manifest.json']
  for (const browser of ['chromium', 'webkit']) for (const row of browserRows) for (const { variant } of row.browserEvidence) for (const viewport of ['1280x800', '1024x768']) paths.push(`e2e-${browser}/captures/${browser}-${row.id}-${variant}-${viewport}.png`)
  const results = []
  for (const path of paths.sort()) results.push({ path, sha256: sha256(await readFile(join(artifacts, path))) })
  await put(artifacts, 'index.json', wrapper('evidence-index', { results, sourceManifestDigest: sourceIdentity.digest }))
}

async function validate(artifacts) {
  return await new Promise((done, reject) => {
    const child = spawn(process.execPath, ['tools/gates/gate-artifacts.mjs', '--evidence-only', '--validate-only', '--artifacts', artifacts], { cwd: root, env: process.env, stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.once('error', reject)
    child.once('exit', (code) => done({ code, stderr }))
  })
}

async function bytesForImmutableCheck(artifacts) {
  return await Promise.all(['result.json', 'index.json'].map(async (path) => ({ path, bytes: await readFile(join(artifacts, path)) })))
}

async function assertBytesUnchanged(artifacts, before) {
  for (const entry of before) {
    const after = await readFile(join(artifacts, entry.path))
    assert.deepEqual(after, entry.bytes, `validate-only must not rewrite ${entry.path}`)
    assert.equal(sha256(after), sha256(entry.bytes), `validate-only must preserve the digest of ${entry.path}`)
  }
}

function workflowStepBlocks(workflow) {
  const lines = workflow.split('\n')
  const stepsIndex = lines.findIndex((line) => /^\s*steps:\s*(?:#.*)?$/.test(line))
  if (stepsIndex < 0) return []

  const stepsIndent = lines[stepsIndex].match(/^\s*/)?.[0].length ?? 0
  const firstStep = lines.findIndex((line, index) => {
    if (index <= stepsIndex || line.trim() === '' || line.trimStart().startsWith('#')) return false
    const match = line.match(/^(\s*)-[ \t]+/)
    return match !== null && match[1].length > stepsIndent
  })
  if (firstStep < 0) return []

  const stepIndent = lines[firstStep].match(/^\s*/)?.[0].length ?? 0
  const sectionEnd = lines.findIndex((line, index) => {
    if (index <= firstStep || line.trim() === '' || line.trimStart().startsWith('#')) return false
    return (line.match(/^\s*/)?.[0].length ?? 0) <= stepsIndent
  })
  const end = sectionEnd < 0 ? lines.length : sectionEnd
  const starts = []
  for (let index = firstStep; index < end; index += 1) {
    const match = lines[index].match(/^(\s*)-[ \t]+/)
    if (match?.[1].length === stepIndent) starts.push(index)
  }
  return starts.map((start, index) => lines.slice(start, starts[index + 1] ?? end).join('\n'))
}

function selectWorkflowStepByAction(workflow, action) {
  const lines = workflow.split('\n')
  const start = lines.findIndex((line) => {
    const match = line.match(/^([ \t]*)-[ \t]+uses:[ \t]*([^\s#]+)(?:[ \t]+#.*)?$/)
    return match?.[2].startsWith(`${action}@`)
  })
  if (start < 0) return ''

  const startMatch = lines[start].match(/^([ \t]*)-/)
  const stepIndent = startMatch?.[1]
  if (stepIndent === undefined) return ''
  const nextStep = lines.findIndex((line, index) => index > start && line.startsWith(`${stepIndent}- `))
  return lines.slice(start, nextStep < 0 ? lines.length : nextStep).join('\n')
}

test('S2-F27-GATE-IMMUTABLE validate-only leaves final result and index byte-identical on pass and mismatch failure', async () => {
  const artifacts = await mkdtemp(join(tmpdir(), 'guidelane-final-27-immutable-'))
  try {
    await finalFixture(artifacts)
    const passedBefore = await bytesForImmutableCheck(artifacts)
    const passed = await validate(artifacts)
    assert.equal(passed.code, 0, `the completed final evidence tree must validate: ${passed.stderr}`)
    await assertBytesUnchanged(artifacts, passedBefore)

    const indexPath = join(artifacts, 'index.json')
    const index = JSON.parse(await readFile(indexPath, 'utf8'))
    index.payload.results = index.payload.results.map((entry) => entry.path === 'result.json' ? { ...entry, sha256: '0'.repeat(64) } : entry)
    await writeFile(indexPath, wrapper('evidence-index', index.payload))
    const failedBefore = await bytesForImmutableCheck(artifacts)
    const failed = await validate(artifacts)
    assert.notEqual(failed.code, 0, 'a final index/result mismatch must remain a nonzero validation failure')
    assert.match(failed.stderr, /index.*(?:digest|wrong)|digest.*result\.json/i, 'the validation failure must report the final index mismatch')
    await assertBytesUnchanged(artifacts, failedBefore)
  } finally {
    await rm(artifacts, { recursive: true, force: true })
  }
})

test('S2-F27-WORKFLOW security permissions, checkout hardening, and evidence upload depend on successful final validation', async () => {
  const workflow = await readFile(new URL('../../.github/workflows/product-offline.yml', import.meta.url), 'utf8')
  const checkout = selectWorkflowStepByAction(workflow, 'actions/checkout')
  const immutableCheckoutReference = 'a'.repeat(40)
  const immutableWorkflow = workflow.replace(/actions\/checkout@[^\s#]+/, `actions/checkout@${immutableCheckoutReference}`)
  const immutableCheckout = selectWorkflowStepByAction(immutableWorkflow, 'actions/checkout')
  const finalValidate = workflow.indexOf('name: Validate final evidence tree')
  const upload = workflow.indexOf('name: Upload offline evidence')
  const uploadBlock = workflow.slice(upload, workflow.length)

  assert.match(immutableCheckout, new RegExp(`uses:\\s*actions/checkout@${immutableCheckoutReference}`), 'checkout selection must support a full immutable commit SHA reference')
  assert.match(workflow, /^(?:permissions:\n\s+contents:\s*read\s*$|  product-offline:[\s\S]*?\n    permissions:\n      contents:\s*read\s*$)/m, 'workflow or product-offline job must grant only read access to contents')
  assert.match(checkout, /persist-credentials:\s*false/, 'checkout must not persist the workflow token in local Git configuration')
  assert.ok(finalValidate >= 0 && upload > finalValidate, 'the evidence upload must be ordered after final validate-only')
  assert.doesNotMatch(uploadBlock, /if:\s*always\(\)|if:\s*\$\{\{\s*always\(\)\s*\}\}/i, 'evidence upload must never bypass failed final validation with always()')
  assert.match(uploadBlock, /if:\s*\$\{\{\s*success\(\)\s*\}\}/, 'evidence upload must be conditioned on successful final validation / job success')
})

test('S2-F37-WORKFLOW every product-offline GitHub Action use is pinned to a full immutable commit SHA before successful evidence upload', async () => {
  const workflow = await readFile(new URL('../../.github/workflows/product-offline.yml', import.meta.url), 'utf8')
  const uses = [...workflow.matchAll(/^\s*(?:-\s*)?uses:\s*([^\s#]+)/gm)]
  assert.ok(uses.length > 0, 'product-offline must declare at least one GitHub Action use')
  const uploadStep = workflowStepBlocks(workflow).find((step) => step.split('\n').some((line) => {
    const match = line.match(/^\s*(?:-\s*)?uses:\s*([^\s#]+)/)
    return match?.[1].startsWith('actions/upload-artifact@')
  })) ?? ''
  assert.ok(uploadStep, 'product-offline must declare an actions/upload-artifact evidence upload step')
  assert.match(uploadStep, /^\s*name:\s*Upload offline evidence\s*$/m, 'the upload action must be in the offline evidence upload step')
  assert.match(uploadStep, /^\s*if:\s*\$\{\{\s*success\(\)\s*\}\}\s*$/m, 'the upload action must be conditioned on successful final validation / job success')
  for (const match of uses) {
    const reference = match[1]
    assert.match(reference, /^[^@]+@[0-9a-f]{40}$/i, `GitHub Action reference must use a full immutable commit SHA: ${reference}`)
  }
})
