import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { link, lstat, mkdir, open, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, relative, resolve } from 'node:path'
import { spawn } from 'node:child_process'

export const ROOT = resolve(new URL('../..', import.meta.url).pathname)
export const LIVE_ENV_KEYS = /^(GUIDELANE_LIVE|CLAUDE|ANTHROPIC|ANTHROPIC_API_KEY|API_KEY|OPENAI_API_KEY)$/i
export const sha256 = (value) => createHash('sha256').update(value).digest('hex')
export const changedPathAllowed = [
  /^package(?:-lock)?\.json$/, /^tsconfig\.json$/, /^(README|STATUS|PROJECT_MAP)\.md$/, /^packages\/(engine|orchestrator)\//, /^apps\/cockpit\//,
  /^profiles\/local-web\//, /^docs\/research\/sprint-03-novice-pilot\//, /^docs\/decisions\/ADR-010-s2-pilot-safety-spine\.md$/, /^\.github\/workflows\/(?:product-offline\.ya?ml|engine-conformance\.yml)$/, /^tools\/gates\//,
]
const changedPathForbidden = /(^|\/)(benchmark|benchmarks|rulesets?|vendor-inquiry|inquiry-delivery|generated-projects?)(\/|$)/i
export function isInChangedPathScope(path) { return !changedPathForbidden.test(path) && changedPathAllowed.some((rule) => rule.test(path)) }
function contained(root, path) { return path === root || path.startsWith(`${root}/`) }
const evidenceSuiteDirectories = new Set(['offline', 'inventory', 'orchestrator', 'cockpit-build', 'e2e-chromium', 'e2e-webkit', 'local-web', 'local-web-seeded', 'changed-paths'])
function sourceIdentityRoot(artifacts) {
  const selected = resolve(artifacts)
  return evidenceSuiteDirectories.has(basename(selected)) ? dirname(selected) : selected
}
export function rejectAmbientSourceRoot() {
  if (Object.prototype.hasOwnProperty.call(process.env, 'GUIDELANE_SOURCE_ROOT')) throw new Error('GUIDELANE_SOURCE_ROOT is forbidden; source identity is fixed to the repository root')
}
export function gitSourcePaths(sourceRoot) {
  const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: sourceRoot, encoding: 'utf8' }).split('\0').filter(Boolean)
  const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard', '-z'], { cwd: sourceRoot, encoding: 'utf8' }).split('\0').filter(Boolean)
  const paths = [...tracked, ...untracked]
  const unique = new Set(paths)
  if (unique.size !== paths.length) throw new Error('Git source enumeration contains duplicate paths')
  return paths.sort((left, right) => left < right ? -1 : left > right ? 1 : 0)
}
export async function sourceManifestForArtifacts(artifacts, sourceRoot = ROOT) {
  sourceRoot = resolve(sourceRoot)
  const rootInfo = await lstat(sourceRoot)
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) throw new Error('source root must be a real directory, not a symlink')
  const excluded = artifacts && contained(sourceRoot, artifacts) ? artifacts : undefined
  if (sourceRoot === ROOT) {
    const sources = []
    for (const path of gitSourcePaths(sourceRoot)) {
      const target = resolve(sourceRoot, path)
      if (!contained(sourceRoot, target)) throw new Error(`source path escapes repository root: ${path}`)
      if (excluded && contained(excluded, target)) continue
      let info
      try { info = await lstat(target) } catch { throw new Error(`source path is missing or unreadable: ${path}`) }
      if (info.isSymbolicLink() || !info.isFile()) throw new Error(`source path must be a regular file, not a symlink: ${path}`)
      let bytes
      try { bytes = await readFile(target) } catch { throw new Error(`source path is unreadable: ${path}`) }
      sources.push({ path, sha256: sha256(bytes) })
    }
    return { sources }
  }
  const sources = []
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const target = resolve(directory, entry.name)
      if (!contained(sourceRoot, target)) throw new Error('source path escapes selected root')
      if (excluded && (target === excluded || target.startsWith(`${excluded}/`))) continue
      if (entry.isSymbolicLink()) throw new Error(`source tree contains a symlink: ${relative(sourceRoot, target)}`)
      if (entry.isDirectory()) {
        if (entry.name === '.git') continue
        await visit(target)
      } else if (entry.isFile()) {
        const path = relative(sourceRoot, target)
        let bytes
        try { bytes = await readFile(target) } catch { throw new Error(`source path is unreadable: ${path}`) }
        sources.push({ path, sha256: sha256(bytes) })
      } else throw new Error(`source tree contains a non-regular entry: ${relative(sourceRoot, target)}`)
    }
  }
  await visit(sourceRoot)
  return { sources: sources.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0) }
}

function validateSourceManifestWrapper(wrapper) {
  if (wrapper?.schemaVersion !== 1 || wrapper.identity !== 'source-manifest' || typeof wrapper.digest !== 'string' || !Array.isArray(wrapper.payload?.sources)) throw new Error('source manifest has invalid wrapper identity or schema')
  if (sha256(JSON.stringify(wrapper.payload, null, 2) + '\n') !== wrapper.digest) throw new Error('source manifest has invalid digest')
  if (!wrapper.payload.sources.every((entry) => entry && typeof entry.path === 'string' && entry.path.length > 0 && typeof entry.sha256 === 'string' && /^[a-f0-9]{64}$/.test(entry.sha256))) throw new Error('source manifest has invalid source entries')
  const paths = wrapper.payload.sources.map((entry) => entry.path)
  if (new Set(paths).size !== paths.length) throw new Error('source manifest contains duplicate source paths')
  return wrapper
}

export async function readSourceManifest(artifacts, { sourceRoot = ROOT, verifyCurrent = true } = {}) {
  if (!artifacts) throw new Error('an artifact directory is required for source identity')
  const identityRoot = sourceIdentityRoot(artifacts)
  const target = resolve(identityRoot, 'source-manifest.json')
  let info
  try { info = await lstat(target) } catch { throw new Error('source manifest is required and must be readable') }
  if (info.isSymbolicLink() || !info.isFile()) throw new Error('source manifest must be a regular file, not a symlink')
  let bytes; let wrapper
  try { bytes = await readFile(target); wrapper = validateSourceManifestWrapper(JSON.parse(bytes.toString('utf8'))) } catch (error) {
    if (error instanceof SyntaxError) throw new Error('source manifest is required and must be readable')
    throw error
  }
  if (verifyCurrent) {
    const current = await sourceManifestForArtifacts(identityRoot, sourceRoot)
    if (JSON.stringify(wrapper.payload) !== JSON.stringify(current)) throw new Error('source manifest does not match current in-scope source bytes')
  }
  return { bytes, digest: wrapper.digest, wrapper }
}

async function writeSourceManifestOnce(target, bytes) {
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`
  let handle
  try {
    handle = await open(temporary, 'wx')
    await handle.writeFile(bytes)
    await handle.sync()
    await handle.close(); handle = undefined
    await link(temporary, target)
    return true
  } catch (error) {
    if (error?.code === 'EEXIST') return false
    throw error
  } finally {
    if (handle) await handle.close().catch(() => {})
    await unlink(temporary).catch(() => {})
  }
}

export async function ensureSourceManifest(artifacts, { create = true, sourceRoot = ROOT } = {}) {
  rejectAmbientSourceRoot()
  if (!artifacts) throw new Error('an artifact directory is required for source identity')
  const identityRoot = sourceIdentityRoot(artifacts)
  await mkdir(identityRoot, { recursive: true })
  const directory = await lstat(identityRoot)
  if (directory.isSymbolicLink() || !directory.isDirectory()) throw new Error('artifact directory must be a real directory, not a symlink')
  try { return await readSourceManifest(artifacts, { sourceRoot }) } catch (error) {
    if (!create || error?.message !== 'source manifest is required and must be readable') throw error
  }
  const payload = await sourceManifestForArtifacts(identityRoot, sourceRoot)
  const wrapper = { schemaVersion: 1, identity: 'source-manifest', digest: sha256(JSON.stringify(payload, null, 2) + '\n'), payload }
  const target = resolve(identityRoot, 'source-manifest.json')
  await writeSourceManifestOnce(target, JSON.stringify(wrapper, null, 2) + '\n')
  return await readSourceManifest(artifacts, { sourceRoot })
}
const OFFLINE_PORTABLE_ENV_KEYS = ['PATH', 'HOME', 'LANG', 'LC_ALL', 'TMPDIR', 'TMP', 'TEMP']

export function artifactsArgument(argv = process.argv.slice(2)) {
  const index = argv.indexOf('--artifacts')
  if (index < 0 || !argv[index + 1]) return undefined
  return resolve(argv[index + 1])
}

/** Require a TAP evidence selector to be an opaque, verbatim test-source value. */
export function assertTapExecutionSelectorInSource(source, selector) {
  if (typeof source !== 'string') throw new Error('TAP test source must be text')
  if (typeof selector !== 'string' || selector.length === 0) throw new Error('TAP execution selector must be a non-empty string')
  if (!source.includes(selector)) throw new Error(`TAP execution selector is absent from declared test source: ${selector}`)
}

/** Require a new native selector to be one static, top-level test declaration. */
export function assertStaticTopLevelTapExecutionSelectorInSource(source, selector) {
  assertTapExecutionSelectorInSource(source, selector)
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const declarations = source.match(new RegExp(`^test\\(\\s*(['\"])${escaped}\\1\\s*,`, 'gm')) ?? []
  if (declarations.length !== 1) throw new Error(`TAP execution selector must occur exactly once as a static top-level test title in declared source: ${selector}`)
}

export async function publishResult(artifacts, name, result) {
  if (!artifacts) return
  let sourceIdentity
  try { sourceIdentity = await ensureSourceManifest(artifacts) } catch (error) {
    if (result?.status !== 'failed') throw error
    try { sourceIdentity = await readSourceManifest(artifacts, { verifyCurrent: false }) } catch { /* A malformed or absent manifest cannot safely identify a failed wrapper. */ }
  }
  await mkdir(artifacts, { recursive: true })
  const directory = await lstat(artifacts)
  if (directory.isSymbolicLink() || !directory.isDirectory()) throw new Error('artifact directory must be a real directory, not a symlink')
  const file = resolve(artifacts, 'result.json')
  const body = JSON.stringify({ schemaVersion: 1, identity: name, ...result, ...(sourceIdentity ? { sourceManifestDigest: sourceIdentity.digest } : {}) }, null, 2) + '\n'
  const value = JSON.stringify({ schemaVersion: 1, identity: name, digest: sha256(body), payload: JSON.parse(body) }, null, 2) + '\n'
  await mkdir(dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.tmp`
  await writeFile(temporary, value, 'utf8')
  await rename(temporary, file)
}

export async function main(name, work, { prepareArtifacts = true, publishResults = true } = {}) {
  const startedAt = new Date().toISOString()
  const artifacts = artifactsArgument()
  const evidenceCommand = [name, ...process.argv.slice(2).map((value, index, values) => values[index - 1] === '--artifacts' ? '[artifact-dir]' : value.replace(/(?:\/[A-Za-z][^\s]*)/g, '[redacted-path]'))]
  try {
    rejectAmbientSourceRoot()
    if (artifacts && prepareArtifacts) await ensureSourceManifest(artifacts)
    const result = await work()
    const { __skipPublish, ...payload } = result ?? {}
    if (publishResults && !__skipPublish) await publishResult(artifacts, name, { command: evidenceCommand, startedAt, endedAt: new Date().toISOString(), exitStatus: 0, status: 'passed', ...payload })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (publishResults) await publishResult(artifacts, name, { command: evidenceCommand, startedAt, endedAt: new Date().toISOString(), exitStatus: 1, status: 'failed', failureSummary: message.replace(/\/[A-Za-z][^\s]*/g, '[redacted-path]') })
    console.error(`${name}: ${message}`)
    process.exitCode = 1
  }
}

/** Run an offline command in a clean, fail-closed child environment. */
export function runOffline(command, args, options = {}) {
  if (!command || /(^|[/\\])claude(?:\.exe)?$/i.test(command) || args.some((arg) => /\bclaude\b/i.test(arg))) {
    return Promise.reject(new Error('offline runner refuses to invoke Claude'))
  }
  // Never inherit the parent environment: it may carry credentials or an
  // agent-specific runtime setting that changes offline test behaviour.
  const env = {}
  for (const key of OFFLINE_PORTABLE_ENV_KEYS) if (process.env[key] !== undefined) env[key] = process.env[key]
  Object.assign(env, options.env ?? {})
  env.CI = '1'
  for (const key of Object.keys(env)) if (LIVE_ENV_KEYS.test(key)) delete env[key]
  return new Promise((resolvePromise, reject) => {
    const capture = options.capture === true
    const child = spawn(command, args, { ...options, capture: undefined, cwd: ROOT, stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit', env })
    let stdout = ''; let stderr = ''
    if (capture) {
      child.stdout.on('data', (chunk) => { stdout += chunk; process.stdout.write(chunk) })
      child.stderr.on('data', (chunk) => { stderr += chunk; process.stderr.write(chunk) })
    }
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0 && signal === null) resolvePromise({ code, signal, stdout, stderr })
      else reject(new Error(`offline child failed: ${command} ${args.join(' ')} (exit=${code ?? 'null'}, signal=${signal ?? 'none'})`))
    })
  })
}
