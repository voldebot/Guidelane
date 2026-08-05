import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import test from 'node:test'
import { ensureSourceManifest } from './lib.mjs'

const root = resolve(new URL('../..', import.meta.url).pathname)
const sha256 = (value) => createHash('sha256').update(value).digest('hex')
const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63600000020001e221bc330000000049454e44ae426082', 'hex')
const wrapper = (identity, payload) => JSON.stringify({ schemaVersion: 1, identity, digest: sha256(JSON.stringify(payload, null, 2) + '\n'), payload }, null, 2) + '\n'
const wrapperWithKind = (kind, identity, payload) => JSON.stringify({ schemaVersion: 1, kind, identity, digest: sha256(JSON.stringify(payload, null, 2) + '\n'), payload }, null, 2) + '\n'
const native = (unsigned) => JSON.stringify({ ...unsigned, digest: sha256(JSON.stringify(unsigned)) }, null, 2) + '\n'
const normalAttemptId = 'attempt-final47-normal'
const normalCandidateDigest = sha256('final47 normal candidate')
const normalResultIdentity = sha256('final47 normal result')
async function put(base, path, value) { const target = join(base, path); await mkdir(resolve(target, '..'), { recursive: true }); await writeFile(target, value); }
async function run(artifacts) {
  return await new Promise((done, reject) => {
    const child = spawn(process.execPath, ['tools/gates/gate-artifacts.mjs', '--evidence-only', '--validate-only', '--artifacts', artifacts], {
      cwd: root,
      env: process.env,
      stdio: 'ignore',
    })
    child.once('error', reject); child.once('exit', (code) => done(code))
  })
}

async function runWithStderr(artifacts) {
  return await new Promise((done, reject) => {
    const child = spawn(process.execPath, ['tools/gates/gate-artifacts.mjs', '--evidence-only', '--validate-only', '--artifacts', artifacts], {
      cwd: root,
      env: process.env,
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    let stderr = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.once('error', reject); child.once('exit', (code) => done({ code, stderr }))
  })
}

async function fixtureSourceManifest(sourceRoot) {
  const sources = []
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) await visit(path)
      else if (entry.isFile()) sources.push({ path: relative(sourceRoot, path), sha256: sha256(await readFile(path)) })
      else throw new Error('fixture source tree must contain only regular files and directories')
    }
  }
  await visit(sourceRoot)
  return { sources: sources.sort((left, right) => left.path.localeCompare(right.path)) }
}

async function writeAttemptTriplet(artifacts, { attemptId, candidateDigest, resultIdentity }) {
  const path = `local-web/native/attempts/${attemptId}`
  await put(artifacts, `${path}/candidate.json`, native({
    schemaVersion: 1,
    kind: 'guidelane.local-web.attempt-candidate',
    identity: `attempt-candidate-${attemptId}`,
    attemptId,
    candidateDigest,
    status: 'passed',
  }))
  await put(artifacts, `${path}/authority.json`, native({
    schemaVersion: 1,
    kind: 'guidelane.local-web.attempt-authority',
    identity: `attempt-authority-${attemptId}`,
    attemptId,
    candidateDigest,
    resultIdentity,
    status: 'passed',
  }))
  await put(artifacts, `${path}/terminal.json`, native({
    schemaVersion: 1,
    kind: 'guidelane.local-web.attempt-terminal',
    identity: resultIdentity,
    attemptId,
    candidateDigest,
    resultIdentity,
    status: 'passed',
  }))
}

async function evidencePaths(artifacts, directory = artifacts) {
  const paths = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = join(directory, entry.name)
    if (entry.isDirectory()) paths.push(...await evidencePaths(artifacts, absolute))
    else if (entry.isFile() && relative(artifacts, absolute) !== 'index.json') paths.push(relative(artifacts, absolute))
    else if (!entry.isFile()) throw new Error('fixture evidence tree must contain only regular files and directories')
  }
  return paths.sort((left, right) => left.localeCompare(right))
}

async function refreshIndex(artifacts) {
  const index = JSON.parse(await readFile(join(artifacts, 'index.json'), 'utf8'))
  index.payload.results = await Promise.all((await evidencePaths(artifacts)).map(async (path) => ({ path, sha256: sha256(await readFile(join(artifacts, path))) })))
  await put(artifacts, 'index.json', wrapper('evidence-index', index.payload))
}

async function finalFixture(artifacts) {
  const sourceIdentity = await ensureSourceManifest(artifacts)
  const bound = (payload) => ({ ...payload, sourceManifestDigest: sourceIdentity.digest })
  const inventory = JSON.parse(await readFile(join(root, 'tools/gates/s2-test-inventory.json'), 'utf8'))
  const simple = ['offline', 'inventory', 'orchestrator', 'cockpit-build', 'local-web', 'local-web-seeded', 'changed-paths']
  const sourceByResult = { offline: 'offline-tap', orchestrator: 'orchestrator-tap', 'local-web': 'native-gate', 'local-web-seeded': 'native-seed-rejection' }
  for (const name of simple) {
    const source = sourceByResult[name]
    const executionEvidence = source === undefined ? [] : inventory.scenarios.filter((row) => row.executionEvidence?.source === source).map((row) => ({ source, selector: row.executionEvidence.selector, status: 'passed' }))
    await put(artifacts, `${name}/result.json`, wrapper(name, bound({ status: 'passed', exitStatus: 0, ...(executionEvidence.length === 0 ? {} : { executionEvidence }) })))
  }
  const browserRows = inventory.scenarios.filter((row) => row.category === 'cockpit-novice-journey' || row.id === 'S2-F24-A-BROWSER')
  for (const browser of ['chromium', 'webkit']) {
    const results = []
    for (const row of browserRows) for (const { variant } of row.browserEvidence) for (const viewport of ['1280x800', '1024x768']) {
      const reference = `captures/${browser}-${row.id}-${variant}-${viewport}.png`
      await put(artifacts, `e2e-${browser}/${reference}`, png)
      results.push({ scenarioId: row.id, variant, browser, viewport, status: 'passed', requestEvidence: { sameOrigin: true, entryCount: 1, maxEntries: 1 }, consoleAssertion: { errorCount: 0 }, accessibilityAssertion: { axeViolations: 0, ariaSnapshotChecked: true }, forbiddenAssertion: { absent: true, checkCount: 1 }, capture: { reference, digest: sha256(png) } })
    }
    await put(artifacts, `e2e-${browser}/result.json`, wrapper(`e2e-${browser}`, bound({ status: 'passed', exitStatus: 0, browserResults: results })))
  }
  await writeAttemptTriplet(artifacts, { attemptId: normalAttemptId, candidateDigest: normalCandidateDigest, resultIdentity: normalResultIdentity })
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
  const localWebEvidence = inventory.scenarios.filter((row) => row.executionEvidence?.source === 'native-gate').map((row) => ({ source: 'native-gate', selector: row.executionEvidence.selector, status: 'passed' }))
  await put(artifacts, 'local-web/result.json', wrapper('local-web', bound({ status: 'passed', exitStatus: 0, nativeEvidence: 'native/result.json', nativeKind: 'guidelane.local-web.harness', nativeDigest: sha256(JSON.stringify(nativeResult)), executionEvidence: localWebEvidence })))
  await put(artifacts, 'result.json', wrapper('artifacts', bound({ status: 'passed', exitStatus: 0, revision: 1 })))
  const paths = ['offline/result.json', 'inventory/result.json', 'orchestrator/result.json', 'cockpit-build/result.json', 'e2e-chromium/result.json', 'e2e-webkit/result.json', 'local-web/result.json', 'local-web-seeded/result.json', 'changed-paths/result.json', 'local-web/native/result.json', `local-web/native/attempts/${normalAttemptId}/authority.json`, `local-web/native/attempts/${normalAttemptId}/candidate.json`, `local-web/native/attempts/${normalAttemptId}/terminal.json`, 'result.json']
  for (const browser of ['chromium', 'webkit']) for (const row of browserRows) for (const { variant } of row.browserEvidence) for (const viewport of ['1280x800', '1024x768']) paths.push(`e2e-${browser}/captures/${browser}-${row.id}-${variant}-${viewport}.png`)
  paths.push('source-manifest.json')
  const results = []; for (const path of paths.sort()) results.push({ path, sha256: sha256(await readFile(join(artifacts, path))) })
  await put(artifacts, 'index.json', wrapper('evidence-index', { results, sourceManifestDigest: sourceIdentity.digest }))
  return sourceIdentity
}

test('S2-F47 artifact validation accepts exactly one indexed, accepted normal attempt triplet', async () => {
  const artifacts = await mkdtemp(join(tmpdir(), 'guidelane-final47-attempt-valid-'))
  try {
    await finalFixture(artifacts)
    assert.equal(await run(artifacts), 0, 'the signed native normal result and its one accepted attempt triplet must validate')
  } finally {
    await rm(artifacts, { recursive: true, force: true })
  }
})

test('S2-F47 artifact validation rejects a missing indexed attempt triplet member', async () => {
  const artifacts = await mkdtemp(join(tmpdir(), 'guidelane-final47-attempt-missing-'))
  try {
    await finalFixture(artifacts)
    await rm(join(artifacts, `local-web/native/attempts/${normalAttemptId}/candidate.json`))
    await refreshIndex(artifacts)
    assert.notEqual(await run(artifacts), 0, 'a fully reindexed native attempt without its candidate record must fail closed')
  } finally {
    await rm(artifacts, { recursive: true, force: true })
  }
})

test('S2-F47 artifact validation rejects a reindexed candidate whose digest no longer binds the normal result', async () => {
  const artifacts = await mkdtemp(join(tmpdir(), 'guidelane-final47-attempt-candidate-mismatch-'))
  try {
    await finalFixture(artifacts)
    const candidatePath = `local-web/native/attempts/${normalAttemptId}/candidate.json`
    const candidate = JSON.parse(await readFile(join(artifacts, candidatePath), 'utf8'))
    const { digest, ...unsigned } = candidate
    await put(artifacts, candidatePath, native({ ...unsigned, candidateDigest: sha256('final47 mismatched candidate') }))
    await refreshIndex(artifacts)
    assert.notEqual(await run(artifacts), 0, 'a digest-consistent candidate/result binding mismatch must fail rather than pass through a refreshed index')
  } finally {
    await rm(artifacts, { recursive: true, force: true })
  }
})

test('S2-F47 artifact validation rejects a reindexed pending authority record', async () => {
  const artifacts = await mkdtemp(join(tmpdir(), 'guidelane-final47-attempt-pending-'))
  try {
    await finalFixture(artifacts)
    const authorityPath = `local-web/native/attempts/${normalAttemptId}/authority.json`
    const authority = JSON.parse(await readFile(join(artifacts, authorityPath), 'utf8'))
    await put(artifacts, authorityPath, native({
      schemaVersion: authority.schemaVersion,
      kind: authority.kind,
      identity: authority.identity,
      attemptId: authority.attemptId,
      candidateDigest: authority.candidateDigest,
      status: 'pending',
    }))
    await refreshIndex(artifacts)
    assert.notEqual(await run(artifacts), 0, 'a digest-consistent pending authority must not authorize a passed normal result')
  } finally {
    await rm(artifacts, { recursive: true, force: true })
  }
})

test('S2-F47 artifact validation rejects reindexed failed terminal authority records', async () => {
  const artifacts = await mkdtemp(join(tmpdir(), 'guidelane-final47-attempt-failed-'))
  try {
    await finalFixture(artifacts)
    for (const name of ['authority', 'terminal']) {
      const path = `local-web/native/attempts/${normalAttemptId}/${name}.json`
      const record = JSON.parse(await readFile(join(artifacts, path), 'utf8'))
      const { digest, ...unsigned } = record
      await put(artifacts, path, native({ ...unsigned, status: 'failed' }))
    }
    await refreshIndex(artifacts)
    assert.notEqual(await run(artifacts), 0, 'a digest-consistent failed terminal attempt must not authorize a passed normal result')
  } finally {
    await rm(artifacts, { recursive: true, force: true })
  }
})

test('S2-F47 artifact validation rejects a second fully signed and indexed attempt directory', async () => {
  const artifacts = await mkdtemp(join(tmpdir(), 'guidelane-final47-attempt-duplicate-'))
  try {
    await finalFixture(artifacts)
    await writeAttemptTriplet(artifacts, {
      attemptId: 'attempt-final47-duplicate',
      candidateDigest: sha256('final47 duplicate candidate'),
      resultIdentity: sha256('final47 duplicate result'),
    })
    await refreshIndex(artifacts)
    assert.notEqual(await run(artifacts), 0, 'a second complete and reindexed attempt directory must be rejected')
  } finally {
    await rm(artifacts, { recursive: true, force: true })
  }
})

test('S2-F47 artifact validation rejects an extra reindexed attempt record outside the exact triplet', async () => {
  const artifacts = await mkdtemp(join(tmpdir(), 'guidelane-final47-attempt-extra-'))
  try {
    await finalFixture(artifacts)
    await put(artifacts, `local-web/native/attempts/${normalAttemptId}/extra.json`, native({
      schemaVersion: 1,
      kind: 'guidelane.local-web.attempt-candidate',
      identity: `attempt-candidate-${normalAttemptId}`,
      attemptId: normalAttemptId,
      candidateDigest: normalCandidateDigest,
      status: 'passed',
    }))
    await refreshIndex(artifacts)
    assert.notEqual(await run(artifacts), 0, 'an extra signed and indexed attempt record must fail the exact triplet contract')
  } finally {
    await rm(artifacts, { recursive: true, force: true })
  }
})

test('S2-F48 artifact validation rejects a digest-valid payload wrapper that advertises an attempt kind outside the canonical path', async () => {
  const artifacts = await mkdtemp(join(tmpdir(), 'guidelane-final48-misplaced-attempt-wrapper-'))
  try {
    await finalFixture(artifacts)
    await put(artifacts, 'misplaced-attempt-authority.json', wrapperWithKind('guidelane.local-web.attempt-authority', 'misplaced-attempt-authority', { status: 'passed' }))
    await refreshIndex(artifacts)
    assert.notEqual(await run(artifacts), 0, 'an attempt-kind payload wrapper outside local-web/native/attempts must not bypass attempt-path validation')
  } finally {
    await rm(artifacts, { recursive: true, force: true })
  }
})

test('S2-F48 artifact validation accepts an indexed ordinary payload wrapper with no attempt kind', async () => {
  const artifacts = await mkdtemp(join(tmpdir(), 'guidelane-final48-ordinary-wrapper-'))
  try {
    await finalFixture(artifacts)
    await put(artifacts, 'ordinary-wrapper.json', wrapper('ordinary-wrapper', { status: 'passed', note: 'ordinary wrapper evidence' }))
    await refreshIndex(artifacts)
    assert.equal(await run(artifacts), 0, 'a normal digest-valid payload wrapper without an attempt kind remains valid outside native paths')
  } finally {
    await rm(artifacts, { recursive: true, force: true })
  }
})

test('S2-F48 artifact validation rejects an unindexed root __proto__ evidence file', async () => {
  const artifacts = await mkdtemp(join(tmpdir(), 'guidelane-final48-proto-root-'))
  try {
    await finalFixture(artifacts)
    await put(artifacts, '__proto__', 'ordinary root evidence\n')
    assert.notEqual(await run(artifacts), 0, 'a root __proto__ file must remain an own evidence path and require an index row')
  } finally {
    await rm(artifacts, { recursive: true, force: true })
  }
})

test('S2-F48 artifact validation rejects identical duplicate index rows', async () => {
  const artifacts = await mkdtemp(join(tmpdir(), 'guidelane-final48-duplicate-index-'))
  try {
    await finalFixture(artifacts)
    const index = JSON.parse(await readFile(join(artifacts, 'index.json'), 'utf8'))
    const duplicate = index.payload.results.find((entry) => entry.path === 'offline/result.json')
    assert.ok(duplicate, 'the fixture must contain an ordinary indexed result to duplicate')
    index.payload.results.push({ ...duplicate })
    await put(artifacts, 'index.json', wrapper('evidence-index', index.payload))
    assert.notEqual(await run(artifacts), 0, 'two byte-identical rows for one evidence path must fail rather than collapse in a map')
  } finally {
    await rm(artifacts, { recursive: true, force: true })
  }
})

test('S2-F49 artifact validation rejects a digest-valid index wrapper with a phantom incomplete row', async () => {
  const artifacts = await mkdtemp(join(tmpdir(), 'guidelane-final49-phantom-index-row-'))
  try {
    await finalFixture(artifacts)
    assert.equal(await run(artifacts), 0, 'the baseline fixture must validate before adding an unbound index row')
    const index = JSON.parse(await readFile(join(artifacts, 'index.json'), 'utf8'))
    index.payload.results.push({ path: 'phantom-unbound-index-row.json' })
    await put(artifacts, 'index.json', wrapper('evidence-index', index.payload))
    assert.notEqual(await run(artifacts), 0, 'a digest-valid index wrapper must reject a phantom row with no sha256 or evidence file')
  } finally {
    await rm(artifacts, { recursive: true, force: true })
  }
})

test('S2-F48 artifact validation rejects an index missing an ordinary non-required artifact row', async () => {
  const artifacts = await mkdtemp(join(tmpdir(), 'guidelane-final48-missing-ordinary-index-'))
  try {
    await finalFixture(artifacts)
    const index = JSON.parse(await readFile(join(artifacts, 'index.json'), 'utf8'))
    const removable = index.payload.results.find((entry) => entry.path.endsWith('.png'))
    assert.ok(removable, 'the fixture must contain a non-required browser capture')
    index.payload.results = index.payload.results.filter((entry) => entry.path !== removable.path)
    await put(artifacts, 'index.json', wrapper('evidence-index', index.payload))
    assert.notEqual(await run(artifacts), 0, 'every ordinary artifact, including captures, must have exactly one index row')
  } finally {
    await rm(artifacts, { recursive: true, force: true })
  }
})

test('validate-only rejects a valid replacement of the artifact gate result after final indexing', async () => {
  const artifacts = await mkdtemp(join(tmpdir(), 'guidelane-final-index-contract-'))
  try {
    const sourceIdentity = await finalFixture(artifacts)
    assert.equal(await run(artifacts), 0, 'the final indexed fixture must validate before tampering')
    await put(artifacts, 'result.json', wrapper('artifacts', { status: 'passed', exitStatus: 0, revision: 2, sourceManifestDigest: sourceIdentity.digest }))
    assert.notEqual(await run(artifacts), 0, 'final validate-only must verify the indexed digest of result.json')
  } finally {
    await rm(artifacts, { recursive: true, force: true })
  }
})

test('test-only source-manifest helper detects source mutation without authorizing a production source-root override', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'guidelane-final-source-binding-'))
  const sourceRoot = join(temporary, 'source')
  const sourcePath = join(sourceRoot, 'allowed-source.txt')
  try {
    await mkdir(sourceRoot, { recursive: true })
    await writeFile(sourcePath, 'first source byte\n', 'utf8')
    const captured = await fixtureSourceManifest(sourceRoot)
    assert.deepEqual(captured, await fixtureSourceManifest(sourceRoot), 'the test-only fixture manifest must bind unmodified source bytes')
    await writeFile(sourcePath, 'second source byte\n', 'utf8')
    assert.notDeepEqual(captured, await fixtureSourceManifest(sourceRoot), 'source mutation after a gate result must invalidate its captured source manifest')
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
})

test('validate-only treats source-manifest paths as bound metadata while rejecting technical evidence content', async () => {
  const artifacts = await mkdtemp(join(tmpdir(), 'guidelane-final-source-manifest-metadata-'))
  try {
    const sourceIdentity = await finalFixture(artifacts)
    assert.ok(sourceIdentity.wrapper.payload.sources.some((entry) => entry.path === 'packages/engine/test/fixtures/surface-thinking-render.json'), 'the canonical source manifest must include the in-scope thinking-named fixture path')
    const baseline = await runWithStderr(artifacts)
    assert.equal(baseline.code, 0, `a source-manifest must accept an in-scope source path containing "thinking": ${baseline.stderr}`)

    await put(artifacts, 'offline/result.json', wrapper('offline', { status: 'passed', exitStatus: 0, detail: 'thinking', sourceManifestDigest: sourceIdentity.digest }))
    const index = JSON.parse(await readFile(join(artifacts, 'index.json'), 'utf8'))
    const offlineDigest = sha256(await readFile(join(artifacts, 'offline/result.json')))
    index.payload.results = index.payload.results.map((entry) => entry.path === 'offline/result.json' ? { ...entry, sha256: offlineDigest } : entry)
    await put(artifacts, 'index.json', wrapper('evidence-index', index.payload))
    assert.notEqual(await run(artifacts), 0, 'ordinary evidence containing raw technical content must still be rejected')
  } finally {
    await rm(artifacts, { recursive: true, force: true })
  }
})

test('validate-only rejects a digest-consistent failed required wrapper', async () => {
  const artifacts = await mkdtemp(join(tmpdir(), 'guidelane-failed-wrapper-contract-'))
  try {
    const sourceIdentity = await finalFixture(artifacts)
    await put(artifacts, 'offline/result.json', wrapper('offline', { status: 'failed', exitStatus: 1, sourceManifestDigest: sourceIdentity.digest }))
    const result = JSON.parse(await readFile(join(artifacts, 'index.json'), 'utf8'))
    const failedWrapperDigest = sha256(await readFile(join(artifacts, 'offline/result.json')))
    result.payload.results = result.payload.results.map((entry) => entry.path === 'offline/result.json' ? { ...entry, sha256: failedWrapperDigest } : entry)
    await put(artifacts, 'index.json', wrapper('evidence-index', result.payload))
    assert.notEqual(await run(artifacts), 0, 'a failed required wrapper must be rejected even when its wrapper and index digests agree')
  } finally {
    await rm(artifacts, { recursive: true, force: true })
  }
})

test('validate-only rejects an evidence-tree symlink before reading its target', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'guidelane-evidence-symlink-contract-'))
  const artifacts = join(temporary, 'artifacts')
  const external = join(temporary, 'external-evidence.txt')
  try {
    await finalFixture(artifacts)
    await writeFile(external, 'outside evidence tree\n', 'utf8')
    await symlink(external, join(artifacts, 'forged-evidence-link.txt'))
    assert.notEqual(await run(artifacts), 0, 'an evidence-tree symlink must be rejected without following an external target')
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
})
