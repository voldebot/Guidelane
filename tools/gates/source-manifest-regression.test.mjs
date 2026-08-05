import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, symlink, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { ensureSourceManifest, readSourceManifest } from './lib.mjs'

const root = resolve(new URL('../..', import.meta.url).pathname)
const wrapper = resolve(root, 'tools/gates/test-fixtures/source-manifest-read-wrapper.mjs')
const sha256 = (value) => createHash('sha256').update(value).digest('hex')

async function temporary(fn) {
  const directory = await mkdtemp(join(tmpdir(), 'guidelane-source-manifest-test-'))
  try { return await fn(directory) } finally { await rm(directory, { recursive: true, force: true }) }
}

async function sourceFixture(directory) {
  const sourceRoot = join(directory, 'source')
  const artifacts = join(directory, 'artifacts')
  await mkdir(sourceRoot)
  await writeFile(join(sourceRoot, 'tracked-source.mjs'), 'export const source = "before"\n', 'utf8')
  await writeFile(join(sourceRoot, 'untracked-source.mjs'), 'export const source = "before"\n', 'utf8')
  await ensureSourceManifest(artifacts, { sourceRoot })
  return { sourceRoot, artifacts }
}

async function runManifestWrapper(artifacts, sourceRoot) {
  return await new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [wrapper, artifacts, sourceRoot], { cwd: root, stdio: 'ignore' })
    child.once('error', reject)
    child.once('exit', (code) => resolvePromise(code))
  })
}

test('SOURCE-MANIFEST-01 captures every tracked and nonignored untracked source, including the stream probe schema and surface', async () => {
  await temporary(async (artifacts) => {
    const manifest = await ensureSourceManifest(artifacts)
    const paths = new Set(manifest.wrapper.payload.sources.map((entry) => entry.path))
    assert.ok(paths.has('tools/probe/lib/stream-surface-schema.mjs'), 'the stream surface schema is executable source and must bind final evidence')
    assert.ok(paths.has('tools/probe/stream-surface.json'), 'the stream surface data contract is executable source and must bind final evidence')
  })
})

test('SOURCE-MANIFEST-02 a gate wrapper rejects a tracked source byte mutation after capture', async () => {
  await temporary(async (directory) => {
    const { sourceRoot, artifacts } = await sourceFixture(directory)
    await writeFile(join(sourceRoot, 'tracked-source.mjs'), 'export const source = "after"\n', 'utf8')
    assert.notEqual(await runManifestWrapper(artifacts, sourceRoot), 0, 'post-capture source bytes must fail the wrapper before its substantive gate')
  })
})

test('SOURCE-MANIFEST-03 a gate wrapper rejects an untracked nonignored source byte mutation after capture', async () => {
  await temporary(async (directory) => {
    const { sourceRoot, artifacts } = await sourceFixture(directory)
    await writeFile(join(sourceRoot, 'untracked-source.mjs'), 'export const source = "after"\n', 'utf8')
    assert.notEqual(await runManifestWrapper(artifacts, sourceRoot), 0, 'untracked nonignored source bytes must remain bound after capture')
  })
})

test('SOURCE-MANIFEST-04 rejects missing, duplicate, unreadable, symlinked, and digest-mismatched source manifests', async () => {
  await temporary(async (directory) => {
    const { sourceRoot, artifacts } = await sourceFixture(directory)
    const manifestPath = join(artifacts, 'source-manifest.json')
    const valid = JSON.parse(await readFile(manifestPath, 'utf8'))
    await unlink(manifestPath)
    await assert.rejects(readSourceManifest(artifacts, { sourceRoot }), /required|readable/i)
    await writeFile(manifestPath, `${JSON.stringify({ ...valid, digest: '0'.repeat(64) })}\n`, 'utf8')
    await assert.rejects(readSourceManifest(artifacts, { sourceRoot }), /digest/i)
    await writeFile(manifestPath, '{not-json', 'utf8')
    await assert.rejects(readSourceManifest(artifacts, { sourceRoot }), /required|readable/i)
    await unlink(manifestPath)
    const external = join(directory, 'external-manifest.json')
    await writeFile(external, JSON.stringify(valid), 'utf8')
    await symlink(external, manifestPath)
    await assert.rejects(readSourceManifest(artifacts, { sourceRoot }), /regular|symlink/i)
    await unlink(manifestPath)
    const duplicate = { ...valid, payload: { ...valid.payload, sources: [...valid.payload.sources, valid.payload.sources[0]] } }
    duplicate.digest = sha256(JSON.stringify(duplicate.payload, null, 2) + '\n')
    await writeFile(manifestPath, `${JSON.stringify(duplicate)}\n`, 'utf8')
    await assert.rejects(readSourceManifest(artifacts, { sourceRoot }), /duplicate|current|source/i)
  })
})
