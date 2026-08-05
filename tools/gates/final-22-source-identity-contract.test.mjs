import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import test from 'node:test'

const root = resolve(new URL('../..', import.meta.url).pathname)
const sha256 = (value) => createHash('sha256').update(value).digest('hex')
const sourceManifest = (payload) => {
  const digest = sha256(JSON.stringify(payload, null, 2) + '\n')
  return { schemaVersion: 1, identity: 'source-manifest', digest, payload }
}

async function runUnknownSuite(artifacts, ambientSourceRoot) {
  return await new Promise((done, reject) => {
    const child = spawn(process.execPath, ['tools/gates/run-suite.mjs', 'unknown-suite', '--artifacts', artifacts], {
      cwd: root,
      env: { ...process.env, GUIDELANE_SOURCE_ROOT: ambientSourceRoot },
      stdio: 'ignore',
    })
    child.once('error', reject)
    child.once('exit', (code) => done(code))
  })
}

async function runIndex(artifacts, ambientSourceRoot) {
  return await new Promise((done, reject) => {
    const child = spawn(process.execPath, ['tools/gates/write-evidence-index.mjs', '--artifacts', artifacts], {
      cwd: root,
      env: { ...process.env, GUIDELANE_SOURCE_ROOT: ambientSourceRoot },
      stdio: 'ignore',
    })
    child.once('error', reject)
    child.once('exit', (code) => done(code))
  })
}

test('S2-FINAL-22-SOURCE-IDENTITY captures a canonical manifest before a gate and binds its digest despite ambient source-root redirection', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'guidelane-final-22-source-identity-'))
  const artifacts = join(temporary, 'artifacts')
  const redirectedRoot = join(temporary, 'ambient-redirect')
  const manifest = sourceManifest({ sources: [{ path: 'packages/engine/test/fixtures/surface-thinking-render.json', sha256: sha256('canonical source bytes\n') }] })
  try {
    await mkdir(artifacts, { recursive: true })
    await writeFile(join(artifacts, 'source-manifest.json'), `${JSON.stringify(manifest)}\n`, 'utf8')
    await mkdir(redirectedRoot)
    await writeFile(join(redirectedRoot, 'redirected-source.txt'), 'ambient source bytes\n', 'utf8')

    assert.notEqual(await runUnknownSuite(artifacts, redirectedRoot), 0, 'the fixture suite intentionally fails after publishing its wrapper')
    const wrapper = JSON.parse(await readFile(join(artifacts, 'result.json'), 'utf8'))
    assert.equal(wrapper.payload.sourceManifestDigest, manifest.digest, 'every wrapper must bind the manifest captured before the substantive gate, never an ambient source root')
    assert.notEqual(await runIndex(artifacts, redirectedRoot), 0, 'the incomplete fixture intentionally prevents index publication')
    const afterIndex = JSON.parse(await readFile(join(artifacts, 'source-manifest.json'), 'utf8'))
    assert.equal(afterIndex.digest, manifest.digest, 'pre-final indexing must preserve the captured source manifest rather than recapturing from ambient state')
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
})
