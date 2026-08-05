import { lstat, mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { relative, resolve } from 'node:path'
import { artifactsArgument, ensureSourceManifest, readSourceManifest, rejectAmbientSourceRoot, sha256 } from './lib.mjs'

const requiredBeforeArtifacts = ['offline/result.json', 'inventory/result.json', 'orchestrator/result.json', 'cockpit-build/result.json', 'e2e-chromium/result.json', 'e2e-webkit/result.json', 'local-web/result.json', 'local-web-seeded/result.json']
const finalRequired = [...requiredBeforeArtifacts, 'result.json', 'changed-paths/result.json']
async function walk(directory) {
  const info = await lstat(directory)
  if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('evidence root must be a real directory, not a symlink')
  const found = []
  async function visit(path) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const next = resolve(path, entry.name)
      if (entry.isSymbolicLink()) throw new Error(`evidence tree contains a symlink: ${relative(directory, next)}`)
      if (entry.isDirectory()) await visit(next)
      else if (entry.isFile()) found.push(next)
      else throw new Error(`evidence tree contains a non-regular entry: ${relative(directory, next)}`)
    }
  }
  await visit(directory)
  return found
}

const artifacts = artifactsArgument()
const startedAt = new Date().toISOString()
async function publishIndex(root, payload, sourceManifestDigest) {
  await mkdir(root, { recursive: true })
  const directory = await lstat(root)
  if (directory.isSymbolicLink() || !directory.isDirectory()) throw new Error('evidence root must be a real directory, not a symlink')
  const boundPayload = { ...payload, ...(sourceManifestDigest ? { sourceManifestDigest } : {}) }
  const unsigned = { schemaVersion: 1, identity: 'evidence-index', payload: boundPayload }
  const wrapper = { ...unsigned, digest: sha256(JSON.stringify(boundPayload, null, 2) + '\n') }
  const target = resolve(root, 'index.json')
  const temporary = `${target}.${process.pid}.tmp`
  await writeFile(temporary, JSON.stringify(wrapper, null, 2) + '\n', 'utf8')
  await rename(temporary, target)
}
try {
  if (!artifacts) throw new Error('--artifacts must name the S2 evidence root')
  rejectAmbientSourceRoot()
  await mkdir(artifacts, { recursive: true })
  const artifactDirectory = await lstat(artifacts)
  if (artifactDirectory.isSymbolicLink() || !artifactDirectory.isDirectory()) throw new Error('evidence root must be a real directory, not a symlink')
  if (process.argv.includes('--source-only')) {
    const identity = await ensureSourceManifest(artifacts)
    console.log(`evidence-source: captured ${identity.wrapper.payload.sources.length} source files`)
    process.exitCode = 0
  } else {
    const sourceIdentity = await ensureSourceManifest(artifacts, { create: false })
    const sourceBytes = sourceIdentity.bytes
    const files = await walk(artifacts)
    const paths = files.map((file) => relative(artifacts, file)).filter((path) => path !== 'index.json').sort()
    const required = process.argv.includes('--final') ? finalRequired : requiredBeforeArtifacts
    const missing = required.filter((path) => !paths.includes(path))
    if (missing.length) throw new Error(`missing required result files: ${missing.join(', ')}`)
    const results = []
    for (const path of paths) results.push({ path, sha256: sha256(await readFile(resolve(artifacts, path))) })
    // index.json is deliberately not included: indexing itself would be recursive.
    await publishIndex(artifacts, { schemaVersion: 1, identity: 'evidence-index', command: ['evidence-index', '--artifacts', '[artifact-dir]'], startedAt, endedAt: new Date().toISOString(), exitStatus: 0, status: 'passed', results }, sourceIdentity.digest)
    const after = await readSourceManifest(artifacts)
    if (!after.bytes.equals(sourceBytes)) throw new Error('source manifest changed during evidence indexing')
    console.log(`evidence-index: indexed ${paths.length} files (${process.argv.includes('--final') ? 'final' : 'pre-artifacts'})`)
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  if (artifacts) {
    try {
      const sourceIdentity = await readSourceManifest(artifacts, { verifyCurrent: false }).catch(() => undefined)
      await publishIndex(artifacts, { schemaVersion: 1, identity: 'evidence-index', command: ['evidence-index', '--artifacts', '[artifact-dir]'], startedAt, endedAt: new Date().toISOString(), exitStatus: 1, status: 'failed', failureSummary: message.replace(/\/[A-Za-z][^\s]*/g, '[redacted-path]'), results: [] }, sourceIdentity?.digest)
    } catch { /* A hostile evidence root must not be followed merely to publish its failure. */ }
  }
  console.error(`evidence-index: ${message}`)
  process.exitCode = 1
}
