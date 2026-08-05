import { createHash, randomBytes } from 'node:crypto'
import { execFile } from 'node:child_process'
import { chmod, mkdir, open, readFile, rename, rm, stat, lstat, readdir, realpath } from 'node:fs/promises'
import { constants, type Stats } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual, promisify } from 'node:util'
import { GATE_AUTHORITIES, GATE_RESULT_STATUSES, REQUIRED_MACHINE_GATES, RUN_FAILURE_CODES, RUN_FAILURE_STATES } from './types.ts'
import type { EvidenceReference, GateResult, PhaseRun, ProjectSnapshot } from './types.ts'

const SCHEMA = 1
const sha256 = (value: Uint8Array): string => createHash('sha256').update(value).digest('hex')
const json = (value: unknown): Uint8Array => Buffer.from(`${JSON.stringify(value)}\n`, 'utf8')
const ATTEMPT_STATUSES = new Set(['prepared', 'running', 'interrupted', 'recovery-required'])
const SAFE_ATTEMPT_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/
const SAFE_PROJECT_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/
const GIT_HEAD = /^[a-f0-9]{40}$/i
const SHA256 = /^[a-f0-9]{64}$/i
const SAFE_NONCE = /^[a-f0-9]{64}$/i
const exec = promisify(execFile)
const TRUSTED_PS_PATH = process.platform === 'darwin' || process.platform === 'linux' ? '/bin/ps' : null
const TRUSTED_PS_ENVIRONMENT = Object.freeze({ LC_ALL: 'C' })
const WRAPPER_COMMAND = fileURLToPath(new URL('./attempt-wrapper.mjs', import.meta.url))
const CANONICAL_STAGES = new Set(['G0', 'G1', 'G2', 'G3', 'G4', 'G5', 'G6'])
const RUN_STATES = new Set(['idle', 'waiting', 'running', 'successful', 'recovery-required', 'stopped', 'rate-limit', 'interrupted'])
const LANGUAGES = new Set(['tr', 'en'])
const RECOVERY_REASON_LIMIT = 20_000
const GATE_NAME_LIMIT = 128
const LEGACY_STAGE_MIGRATIONS = Object.freeze({
  idea: { stage: 'G0', pendingDecision: 'submitIdea' },
  blueprint: { stage: 'G1', pendingDecision: 'approveBlueprint' },
  blueprint_review: { stage: 'G1', pendingDecision: 'approveBlueprint' },
  plan_review: { stage: 'G2', pendingDecision: 'approvePlan' },
  ready_to_build: { stage: 'G3', pendingDecision: 'startBuild' },
  result_review: { stage: 'G5', pendingDecision: 'acceptResult' },
  accepted: { stage: 'G6', pendingDecision: null },
} as const)
/** The earliest durable fixture represented a completed project as idea/successful. */
const LEGACY_TERMINAL_STAGE_MIGRATIONS = Object.freeze({
  idea: { stage: 'G6', pendingDecision: null },
} as const)

async function runTrustedPs(args: string[]): Promise<{ stdout: string }> {
  if (TRUSTED_PS_PATH === null) throw new Error('trusted process inspection is unavailable on this platform')
  return exec(TRUSTED_PS_PATH, args, { env: TRUSTED_PS_ENVIRONMENT })
}

interface Manifest { schemaVersion: number; projectId: string; revision: number; snapshot: ProjectSnapshot; run: PhaseRun; sha256: string }
interface RecoveryMarker { schemaVersion: number; projectId: string; markerId: string; reason: string; attemptId?: string; snapshot: ProjectSnapshot; sha256: string }
interface CompletionArchive { attemptId: string; receipt: Record<string, unknown>; phase?: string; intentNonce?: string; onAttemptArchived?: () => void }
interface RecoveryHistory { schemaVersion: number; projectId: string; markerId: string; resolution: 'exact-reconciliation' | 'exact-completion'; reason: string; attemptId: string; resolvedAt: string; priorMarkerDigest: string }
interface PreparedCompletion { marker: RecoveryMarker; manifest: Manifest; snapshot: ProjectSnapshot; run: PhaseRun; activeAttempt: Record<string, unknown> | null }
export interface PreparedCompletionRecovery { attemptId: string; receipt: Record<string, unknown>; hasActiveFixture: boolean }
export interface PublishInput { snapshot: ProjectSnapshot; run: PhaseRun; artifacts: Record<string, string | Uint8Array> }
export interface ArtifactStoreOptions { root: string; projectId: string; gitHead?: string }

/** Require a complete object id before any project path or lock can be touched. */
export function assertValidGitHead(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !GIT_HEAD.test(value)) throw new Error('a valid 40-hex gitHead is required')
}

/** Project storage is always one direct child of the configured root. */
export function assertSafeProjectId(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !SAFE_PROJECT_ID.test(value)) throw new Error('invalid safe project identity')
}

type TrustedDirectoryOptions = { create: boolean; label: string }

const currentUid = (): number | undefined => typeof process.getuid === 'function' ? process.getuid() : undefined
const hasUnsafeWriteBits = (mode: number): boolean => (mode & 0o022) !== 0
const isTrustedStickyOsAnchor = (info: Stats): boolean => info.uid === 0 && (info.mode & 0o1000) !== 0
const isTrustedOsSymlink = (info: Stats): boolean => info.uid === 0

function pathComponents(path: string): string[] {
  const components: string[] = []
  let cursor: string = sep
  for (const component of path.split(sep).filter(Boolean)) {
    cursor = join(cursor, component)
    components.push(cursor)
  }
  return components
}

async function assertSafeRawPath(path: string, options: TrustedDirectoryOptions): Promise<void> {
  for (const component of pathComponents(path)) {
    let info: Stats
    try {
      info = await lstat(component)
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' && options.create) return
      throw error
    }
    if (info.isSymbolicLink()) {
      // A caller-controlled symlink is never accepted. Root-owned OS aliases
      // such as /var are retained only as trusted anchors and are revalidated
      // through their canonical ancestry below.
      if (component === path || !isTrustedOsSymlink(info)) throw new Error(`${options.label} contains an unsafe symlink`)
      continue
    }
    if (!info.isDirectory()) throw new Error(`${options.label} contains a non-directory component`)
  }
}

function assertTrustedDirectoryComponent(info: Stats, path: string, leaf: boolean, label: string): void {
  if (info.isSymbolicLink() || !info.isDirectory()) throw new Error(`${label} must be a real directory: ${path}`)
  if (hasUnsafeWriteBits(info.mode) && !isTrustedStickyOsAnchor(info)) throw new Error(`${label} contains a group- or world-writable component: ${path}`)
  const uid = currentUid()
  if (uid !== undefined && info.uid !== uid && info.uid !== 0) throw new Error(`${label} contains a foreign-owned component: ${path}`)
  if (leaf && uid !== undefined && info.uid !== uid) throw new Error(`${label} must be owned by the current user`)
}

async function assertTrustedCanonicalDirectory(path: string, label: string): Promise<void> {
  for (const component of pathComponents(path)) {
    assertTrustedDirectoryComponent(await lstat(component), component, component === path, label)
  }
}

async function deepestExistingDirectory(path: string): Promise<{ path: string; missing: string[] }> {
  const missing: string[] = []
  let cursor = path
  while (true) {
    try {
      const info = await lstat(cursor)
      if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('configured directory ancestor is not a real directory')
      return { path: cursor, missing }
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      const parent = dirname(cursor)
      if (parent === cursor) throw new Error('configured directory has no existing safe anchor')
      missing.unshift(basename(cursor))
      cursor = parent
    }
  }
}

/**
 * Resolve a caller-supplied directory only after every existing ancestor is
 * safe. Same-UID substitutions between lstat and creation remain a documented
 * local-pilot residual; foreign ownership, writable ancestry, and symlinks
 * fail closed before a project lock or artifact file is created.
 */
export async function trustedCallerDirectory(value: unknown, options: TrustedDirectoryOptions): Promise<string> {
  if (typeof value !== 'string' || !value || value.includes('\0')) throw new Error(`${options.label} must be a valid directory path`)
  const requested = resolve(value)
  await assertSafeRawPath(requested, options)
  const existing = await deepestExistingDirectory(requested)
  const canonicalExisting = await realpath(existing.path)
  await assertTrustedCanonicalDirectory(canonicalExisting, options.label)
  const canonical = existing.missing.length === 0 ? canonicalExisting : resolve(canonicalExisting, ...existing.missing)
  if (existing.missing.length > 0) {
    if (!options.create) throw new Error(`${options.label} does not exist`)
    await mkdir(canonical, { recursive: true, mode: 0o700 })
  }
  await assertTrustedCanonicalDirectory(canonical, options.label)
  return canonical
}

/** Refuse unsafe project ancestry before any lock or artifact write can follow it. */
async function projectDirectory(root: string, projectId: string): Promise<string> {
  const base = await trustedCallerDirectory(root, { create: true, label: 'artifact data root' })
  const directory = await trustedCallerDirectory(join(base, projectId), { create: true, label: 'project artifact root' })
  const remainder = relative(base, directory)
  if (!remainder || remainder === '..' || remainder.startsWith(`..${sep}`) || isAbsolute(remainder)) throw new Error('project artifact root escapes its configured root')
  return directory
}

const textDigest = (value: string): string => createHash('sha256').update(value).digest('hex')
const canonicalAbsolutePath = (value: unknown): value is string => typeof value === 'string' && !value.includes('\0') && isAbsolute(value) && resolve(value) === value
function validLaunchIntent(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false
  const keys = ['schemaVersion', 'phase', 'command', 'commandDigest', 'argsDigest', 'cwd', 'envDigest', 'nonce', 'intentDigest']
  if (Object.keys(value).length !== keys.length || keys.some((key) => !(key in value))) return false
  if (value.schemaVersion !== SCHEMA || typeof value.phase !== 'string' || !value.phase || value.phase.length > 128 || !canonicalAbsolutePath(value.command) || typeof value.commandDigest !== 'string' || !SHA256.test(value.commandDigest) || typeof value.argsDigest !== 'string' || !SHA256.test(value.argsDigest) || !canonicalAbsolutePath(value.cwd) || typeof value.envDigest !== 'string' || !SHA256.test(value.envDigest) || typeof value.nonce !== 'string' || !SAFE_NONCE.test(value.nonce) || typeof value.intentDigest !== 'string' || !SHA256.test(value.intentDigest)) return false
  const unsigned = {
    schemaVersion: SCHEMA,
    phase: value.phase,
    command: value.command,
    commandDigest: value.commandDigest,
    argsDigest: value.argsDigest,
    cwd: value.cwd,
    envDigest: value.envDigest,
    nonce: value.nonce,
  }
  return value.commandDigest === textDigest(value.command) && value.intentDigest === textDigest(JSON.stringify(unsigned))
}

async function safePath(base: string, name: string): Promise<string> {
  if (!name || isAbsolute(name) || name.includes('\0')) throw new Error('invalid artifact path')
  const output = resolve(base, name)
  if (relative(base, output).startsWith('..')) throw new Error('invalid artifact path')
  let cursor = base
  for (const segment of relative(base, output).split('/').filter(Boolean)) {
    cursor = join(cursor, segment)
    try { if ((await lstat(cursor)).isSymbolicLink()) throw new Error('artifact path symlink escape') } catch (error: unknown) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  }
  return output
}

async function atomicWrite(path: string, bytes: Uint8Array): Promise<void> {
  const directory = dirname(path)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  await chmod(directory, 0o700)
  const temporary = join(directory, `.${Date.now()}-${process.pid}-${Math.random().toString(16).slice(2)}.tmp`)
  let handle: Awaited<ReturnType<typeof open>> | undefined
  try {
    handle = await open(temporary, 'wx', 0o600)
    await handle.writeFile(bytes)
    await handle.sync()
    await handle.close(); handle = undefined
    await rename(temporary, path)
    await syncDirectory(directory)
  } finally {
    await handle?.close()
    await rm(temporary, { force: true })
  }
}

async function syncDirectory(directory: string): Promise<void> {
  const directoryHandle = await open(directory, constants.O_RDONLY)
  try { await directoryHandle.sync() } finally { await directoryHandle.close() }
}

/** Durably remove a mutable record before a later recovery step may depend on its absence. */
async function unlinkAndSyncParent(path: string): Promise<void> {
  await rm(path, { force: false })
  await syncDirectory(dirname(path))
}

function assertSafeAttemptId(value: unknown, noun: 'attempt' | 'run' = 'attempt'): asserts value is string {
  if (typeof value !== 'string' || !SAFE_ATTEMPT_ID.test(value)) throw new Error(`invalid immutable ${noun} identity`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): boolean {
  const allowed = new Set([...required, ...optional])
  return required.every((key) => Object.hasOwn(value, key)) && Object.keys(value).every((key) => allowed.has(key))
}

function isExactWrapperReceipt(value: unknown): value is Record<string, unknown> {
  const keys = ['pid', 'pgid', 'startIdentity', 'nonce', 'wrapperCommand']
  return isRecord(value) && hasExactKeys(value, keys)
    && typeof value.pid === 'number' && Number.isSafeInteger(value.pid) && value.pid > 0
    && typeof value.pgid === 'number' && Number.isSafeInteger(value.pgid) && value.pgid > 0 && value.pid === value.pgid
    && typeof value.startIdentity === 'string' && value.startIdentity.length > 0
    && typeof value.nonce === 'string' && SAFE_NONCE.test(value.nonce)
    && value.wrapperCommand === WRAPPER_COMMAND
}

function validRecoveryReason(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= RECOVERY_REASON_LIMIT && !value.includes('\0')
}

function validEvidencePath(value: unknown): value is string {
  if (typeof value !== 'string' || !value || value.includes('\0') || value.includes('\\') || isAbsolute(value)) return false
  return value.split('/').every((segment) => segment.length > 0 && segment !== '.' && segment !== '..')
}

function normalizeEvidenceReference(value: unknown): EvidenceReference {
  if (!isRecord(value) || !hasExactKeys(value, ['path', 'sha256']) || !validEvidencePath(value.path) || typeof value.sha256 !== 'string' || !SHA256.test(value.sha256)) throw new Error('invalid snapshot gate evidence reference')
  return { path: value.path, sha256: value.sha256 }
}

function normalizeGate(value: unknown): GateResult {
  if (!isRecord(value) || !hasExactKeys(value, ['name', 'status', 'authority'], ['evidence'])) throw new Error('invalid snapshot gate schema')
  if (typeof value.name !== 'string' || !value.name || value.name.length > GATE_NAME_LIMIT || value.name.includes('\0') || typeof value.status !== 'string' || !GATE_RESULT_STATUSES.includes(value.status as typeof GATE_RESULT_STATUSES[number]) || typeof value.authority !== 'string' || !GATE_AUTHORITIES.includes(value.authority as typeof GATE_AUTHORITIES[number])) throw new Error('invalid snapshot gate fields')
  const evidence = value.evidence === undefined ? undefined : Array.isArray(value.evidence) ? value.evidence.map(normalizeEvidenceReference) : undefined
  if (value.evidence !== undefined && evidence === undefined) throw new Error('invalid snapshot gate evidence')
  return {
    name: value.name,
    status: value.status as GateResult['status'],
    authority: value.authority as GateResult['authority'],
    ...(evidence === undefined ? {} : { evidence }),
  }
}

type CanonicalStage = 'G0' | 'G1' | 'G2' | 'G3' | 'G4' | 'G5' | 'G6'
type PendingDecision = ProjectSnapshot['pendingDecision']

function requiredPendingDecision(stage: CanonicalStage, runState: string): PendingDecision | undefined {
  if (runState === 'recovery-required') return null
  if (stage === 'G0' && runState === 'idle') return 'submitIdea'
  if (stage === 'G1' && runState === 'waiting') return 'approveBlueprint'
  if (stage === 'G2' && runState === 'waiting') return 'approvePlan'
  if (stage === 'G3' && runState === 'waiting') return 'startBuild'
  if (stage === 'G4' && runState === 'running') return null
  if (stage === 'G4' && (runState === 'stopped' || runState === 'interrupted')) return 'startBuild'
  if (stage === 'G4' && runState === 'rate-limit') return null
  if (stage === 'G5' && runState === 'waiting') return 'acceptResult'
  if (stage === 'G6' && runState === 'successful') return null
  return undefined
}

interface SnapshotValidationOptions {
  projectId: string
  minimumRevision: number
  expectedRevision?: number
  allowLegacy: boolean
  requireRecovery?: boolean
}

/**
 * Parse the entire persisted snapshot before it can become canonical state.
 * Legacy labels are read-only input aliases; the returned shape is always G0–G6.
 */
function normalizeProjectSnapshot(value: unknown, options: SnapshotValidationOptions): ProjectSnapshot {
  if (!isRecord(value) || !hasExactKeys(value, ['schemaVersion', 'projectId', 'revision', 'stage', 'runState', 'language', 'blueprintRevision', 'gates', 'pendingDecision'], ['failureCode', 'recoveryReason'])) throw new Error('invalid complete project snapshot schema')
  if (value.schemaVersion !== SCHEMA || value.projectId !== options.projectId || !Number.isSafeInteger(value.revision) || (value.revision as number) < options.minimumRevision || (options.expectedRevision !== undefined && value.revision !== options.expectedRevision)) throw new Error('invalid project snapshot identity or revision')
  if (typeof value.stage !== 'string') throw new Error('invalid project snapshot stage')
  const ordinaryLegacy = Object.hasOwn(LEGACY_STAGE_MIGRATIONS, value.stage) ? LEGACY_STAGE_MIGRATIONS[value.stage as keyof typeof LEGACY_STAGE_MIGRATIONS] : undefined
  const terminalLegacy = value.runState === 'successful' && Object.hasOwn(LEGACY_TERMINAL_STAGE_MIGRATIONS, value.stage) ? LEGACY_TERMINAL_STAGE_MIGRATIONS[value.stage as keyof typeof LEGACY_TERMINAL_STAGE_MIGRATIONS] : undefined
  const legacy = terminalLegacy ?? ordinaryLegacy
  if (!CANONICAL_STAGES.has(value.stage) && (!options.allowLegacy || legacy === undefined)) throw new Error('unsupported project snapshot stage')
  const stage = (legacy?.stage ?? value.stage) as CanonicalStage
  if (typeof value.runState !== 'string' || !RUN_STATES.has(value.runState)) throw new Error('unknown project snapshot run state')
  if (!LANGUAGES.has(value.language as string) || !Number.isSafeInteger(value.blueprintRevision) || (value.blueprintRevision as number) < 0 || !Array.isArray(value.gates)) throw new Error('invalid project snapshot language, blueprint revision, or gates')
  if (value.pendingDecision !== null && value.pendingDecision !== 'submitIdea' && value.pendingDecision !== 'approveBlueprint' && value.pendingDecision !== 'approvePlan' && value.pendingDecision !== 'startBuild' && value.pendingDecision !== 'acceptResult') throw new Error('invalid project snapshot pending decision')
  const expectedPendingDecision = requiredPendingDecision(stage, value.runState)
  if (expectedPendingDecision === undefined || (value.pendingDecision !== expectedPendingDecision && !(legacy !== undefined && value.pendingDecision === null))) throw new Error('incompatible project snapshot stage, run state, and pending decision')
  const failureCode = value.failureCode
  if (failureCode !== undefined && !isRunFailureCode(failureCode)) throw new Error('invalid project snapshot failure code')
  if (failureCode !== undefined && value.runState !== 'recovery-required' && RUN_FAILURE_STATES[failureCode] !== value.runState) throw new Error('incompatible project snapshot failure code and run state')
  const recoveryReason = value.recoveryReason
  if (value.runState === 'recovery-required') {
    if (!validRecoveryReason(recoveryReason)) throw new Error('recovery project snapshot requires a valid recovery reason')
  } else if (recoveryReason !== undefined) throw new Error('ordinary project snapshot must not retain a recovery reason')
  if (options.requireRecovery && value.runState !== 'recovery-required') throw new Error('recovery marker must contain a recovery-required snapshot')
  const gates = value.gates.map(normalizeGate)
  return {
    schemaVersion: SCHEMA,
    projectId: options.projectId,
    revision: value.revision as number,
    stage,
    runState: value.runState,
    language: value.language as string,
    blueprintRevision: value.blueprintRevision as number,
    gates,
    pendingDecision: expectedPendingDecision,
    ...(failureCode === undefined ? {} : { failureCode }),
    ...(recoveryReason === undefined ? {} : { recoveryReason }),
  }
}

export class ArtifactStore {
  readonly #root: string
  readonly #projectId: string
  readonly #dir: string
  readonly #gitHead: string
  #recovery: ProjectSnapshot | null = null
  #recoveryMarker: RecoveryMarker | null = null
  #resolvingRecovery = false
  #manifest: Manifest | null = null
  /** Fully validated, canonical projection of the last attributable snapshot. */
  #safeSnapshot: ProjectSnapshot | null = null

  private constructor(options: ArtifactStoreOptions & { gitHead: string }) {
    this.#root = resolve(options.root); this.#projectId = options.projectId; this.#dir = join(this.#root, options.projectId); this.#gitHead = options.gitHead
  }
  static async open(options: ArtifactStoreOptions): Promise<ArtifactStore> {
    assertSafeProjectId(options.projectId)
    const gitHead = options.gitHead
    assertValidGitHead(gitHead)
    const root = await trustedCallerDirectory(options.root, { create: true, label: 'artifact data root' })
    const store = new ArtifactStore({ ...options, root, gitHead })
    await projectDirectory(store.#root, store.#projectId)
    await store.#load()
    try {
      await store.attempts()
    } catch (error: unknown) {
      await store.requireRecovery(`persisted attempt recovery required: ${error instanceof Error ? error.message : 'invalid attempt'}`)
    }
    return store
  }
  async #load(): Promise<void> {
    const path = join(this.#dir, 'manifest.json')
    let raw: Buffer
    try {
      raw = await readFile(path)
    } catch (error: unknown) {
      try {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        if ((await this.#runEntryNames()).length > 0) throw new Error('immutable runs exist without a canonical manifest')
      } catch (loadError: unknown) {
        this.#recovery = this.#recoverySnapshot(loadError instanceof Error ? loadError.message : 'artifact recovery required')
      }
      await this.#loadRecoveryMarker()
      return
    }
    let markerLoaded = false
    try {
      const parsed = JSON.parse(raw.toString('utf8')) as unknown
      if (!isRecord(parsed)) throw new Error('unknown or invalid artifact schema')
      const value = parsed as unknown as Manifest
      if (value.schemaVersion !== SCHEMA || value.projectId !== this.#projectId || !Number.isSafeInteger(value.revision) || value.revision < 1 || !isRecord(value.snapshot) || !isRecord(value.run)) throw new Error('unknown or invalid artifact schema')
      const snapshot = normalizeProjectSnapshot(value.snapshot, { projectId: this.#projectId, minimumRevision: 1, expectedRevision: value.revision, allowLegacy: true })
      if (value.run.projectId !== this.#projectId) throw new Error('manifest identity or revision mismatch')
      // A digest-valid schema projection may inform recovery, but no raw
      // manifest is assigned as canonical state until every integrity check
      // below has passed.
      this.#safeSnapshot = snapshot
      if (typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(value.sha256) || sha256(json({ ...value, sha256: undefined })) !== value.sha256) throw new Error('manifest digest missing or mismatched')
      // A completion crash can leave its immutable R+1 run beside the old R
      // manifest. Load the signed marker first so run-chain validation can
      // admit only that narrowly bound prepared completion.
      await this.#loadRecoveryMarker()
      markerLoaded = true
      await this.#verifyRunChain(value)
      this.#manifest = value
    } catch (error: unknown) {
      this.#recovery = this.#recoverySnapshot(error instanceof Error ? error.message : 'artifact recovery required')
    }
    if (!markerLoaded) await this.#loadRecoveryMarker()
  }
  async #loadRecoveryMarker(): Promise<void> {
    const path = await safePath(this.#dir, 'recovery.json')
    let raw: Buffer
    try { raw = await readFile(path) } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      this.#recovery = this.#recoverySnapshot('recovery marker could not be read')
      return
    }
    try {
      const marker = JSON.parse(raw.toString('utf8')) as RecoveryMarker
      if (!isRecord(marker) || !hasExactKeys(marker, ['schemaVersion', 'projectId', 'markerId', 'reason', 'snapshot', 'sha256'], ['attemptId']) || marker.schemaVersion !== SCHEMA || marker.projectId !== this.#projectId || !SAFE_ATTEMPT_ID.test(marker.markerId) || !validRecoveryReason(marker.reason) || (marker.attemptId !== undefined && !SAFE_ATTEMPT_ID.test(marker.attemptId)) || !marker.snapshot || typeof marker.sha256 !== 'string' || !SHA256.test(marker.sha256)) throw new Error('unknown or invalid recovery marker schema')
      if (sha256(json({ ...marker, sha256: undefined })) !== marker.sha256) throw new Error('recovery marker digest missing or mismatched')
      const snapshot = normalizeProjectSnapshot(marker.snapshot, { projectId: this.#projectId, minimumRevision: 0, allowLegacy: false, requireRecovery: true })
      if (!isDeepStrictEqual(snapshot, marker.snapshot) || snapshot.recoveryReason !== marker.reason) throw new Error('invalid recovery marker snapshot')
      this.#recovery = snapshot
      this.#recoveryMarker = marker
    } catch (error: unknown) {
      this.#recovery = this.#recoverySnapshot(error instanceof Error ? error.message : 'recovery marker is invalid')
    }
  }
  #recoverySnapshot(reason: string): ProjectSnapshot {
    const snapshot = this.#safeSnapshot
    const failureCode = snapshot?.failureCode
    const safeReason = validRecoveryReason(reason) ? reason : 'artifact recovery required'
    return {
      schemaVersion: SCHEMA,
      projectId: this.#projectId,
      revision: snapshot?.revision ?? 0,
      stage: snapshot?.stage ?? 'G0',
      runState: 'recovery-required',
      language: snapshot?.language ?? 'tr',
      blueprintRevision: snapshot?.blueprintRevision ?? 0,
      gates: snapshot === null ? [] : structuredClone(snapshot.gates),
      pendingDecision: null,
      recoveryReason: safeReason,
      ...(failureCode !== undefined && isRunFailureCode(failureCode) ? { failureCode } : {}),
    }
  }
  async #verifyEvidence(evidence: EvidenceReference): Promise<void> {
    if (!evidence || typeof evidence.path !== 'string' || !/^[a-f0-9]{64}$/i.test(evidence.sha256)) throw new Error('invalid evidence reference')
    const bytes = await readFile(await safePath(this.#dir, evidence.path))
    if (sha256(bytes) !== evidence.sha256) throw new Error(`evidence digest mismatch: ${evidence.path}`)
  }
  #validateRun(value: unknown, requireDigest: boolean, revision?: number): asserts value is PhaseRun {
    if (!isRecord(value)) throw new Error('invalid immutable run schema')
    const run = value as Record<string, unknown>
    if (run.schemaVersion !== SCHEMA || run.projectId !== this.#projectId || typeof run.phase !== 'string' || !run.phase || typeof run.createdAt !== 'string' || !run.createdAt || typeof run.status !== 'string' || !run.status || !Number.isSafeInteger(run.previousRevision) || (run.previousRevision as number) < 0 || !isRecord(run.inputDigests) || !isRecord(run.receipt) || !Array.isArray(run.evidence) || typeof run.gitSnapshot !== 'string') throw new Error('invalid immutable run schema or identity')
    assertSafeAttemptId(run.attemptId, 'run')
    assertValidGitHead(run.gitSnapshot)
    if (run.gitSnapshot !== this.#gitHead) throw new Error('git snapshot and supplied head diverge')
    if (run.failureCode !== undefined && !isRunFailureCode(run.failureCode)) throw new Error('invalid immutable run failure code')
    if (revision !== undefined && run.previousRevision !== revision - 1) throw new Error('immutable run revision identity mismatch')
    if (requireDigest && (typeof run.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(run.sha256) || sha256(json({ ...run, sha256: undefined })) !== run.sha256)) throw new Error('immutable run digest missing or mismatched')
  }
  #canonicalRun(run: PhaseRun): PhaseRun {
    this.#validateRun(run, false)
    const unsigned = { ...run, sha256: undefined }
    return { ...unsigned, sha256: sha256(json(unsigned)) } as PhaseRun
  }
  async #runEntryNames(): Promise<string[]> {
    const directory = await safePath(this.#dir, 'runs')
    try {
      if (!(await lstat(directory)).isDirectory()) throw new Error('immutable runs path is not a directory')
      return await readdir(directory)
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
  }
  #completionEvidence(snapshot: ProjectSnapshot): EvidenceReference[] {
    if (snapshot.gates.length !== REQUIRED_MACHINE_GATES.length) throw new Error('prepared completion requires the complete required machine gate set')
    const evidence: EvidenceReference[] = []
    for (const [index, name] of REQUIRED_MACHINE_GATES.entries()) {
      const gate = snapshot.gates[index]
      if (!gate || gate.name !== name || gate.status !== 'passed' || gate.authority !== 'machine' || !Array.isArray(gate.evidence) || gate.evidence.length === 0) throw new Error('prepared completion requires every required machine gate and evidence binding')
      evidence.push(...gate.evidence.map(normalizeEvidenceReference))
    }
    return evidence
  }
  async #completionHistory(marker: RecoveryMarker): Promise<RecoveryHistory> {
    if (marker.attemptId === undefined) throw new Error('prepared completion requires a marker-bound attempt')
    let parsed: unknown
    try { parsed = JSON.parse((await readFile(await safePath(this.#dir, `recovery-history/${marker.markerId}.json`))).toString('utf8')) } catch { throw new Error('prepared completion history is unreadable or malformed') }
    const keys = ['schemaVersion', 'projectId', 'markerId', 'resolution', 'reason', 'attemptId', 'resolvedAt', 'priorMarkerDigest']
    if (!isRecord(parsed) || !hasExactKeys(parsed, keys) || parsed.schemaVersion !== SCHEMA || parsed.projectId !== this.#projectId || parsed.markerId !== marker.markerId || parsed.reason !== marker.reason || parsed.attemptId !== marker.attemptId || parsed.priorMarkerDigest !== marker.sha256) throw new Error('prepared completion history identity diverges')
    const resolution = parsed.resolution
    const resolvedAt = parsed.resolvedAt
    if ((resolution !== 'exact-reconciliation' && resolution !== 'exact-completion') || typeof resolvedAt !== 'string' || !Number.isFinite(Date.parse(resolvedAt))) throw new Error('prepared completion history identity diverges')
    return { schemaVersion: SCHEMA, projectId: this.#projectId, markerId: marker.markerId, resolution, reason: marker.reason, attemptId: marker.attemptId, resolvedAt, priorMarkerDigest: marker.sha256 }
  }
  async #preparedCompletion(manifest: Manifest | null = this.#manifest, suppliedRun?: PhaseRun): Promise<PreparedCompletion | null> {
    const marker = this.#recoveryMarker
    if (!marker || !this.#recovery || !manifest || marker.attemptId === undefined) return null
    if (typeof manifest.sha256 !== 'string' || sha256(json({ ...manifest, sha256: undefined })) !== manifest.sha256) throw new Error('prepared completion old manifest digest diverges')
    const oldSnapshot = normalizeProjectSnapshot(manifest.snapshot, { projectId: this.#projectId, minimumRevision: 1, expectedRevision: manifest.revision, allowLegacy: false })
    // Final-30 owns an already committed exact G5 plus a stale marker. It is
    // not an orphaned R+1 run, so leave it to the marker-only finalizer.
    if (oldSnapshot.stage === 'G5' && oldSnapshot.runState === 'waiting' && oldSnapshot.pendingDecision === 'acceptResult') return null
    const markerSnapshot = normalizeProjectSnapshot(marker.snapshot, { projectId: this.#projectId, minimumRevision: 1, expectedRevision: manifest.revision, allowLegacy: false, requireRecovery: true })
    const expectedMarkerSnapshot: ProjectSnapshot = { ...oldSnapshot, runState: 'recovery-required', pendingDecision: null, recoveryReason: marker.reason }
    if (oldSnapshot.stage !== 'G4' || oldSnapshot.runState !== 'running' || oldSnapshot.pendingDecision !== null || !isDeepStrictEqual(markerSnapshot, expectedMarkerSnapshot)) throw new Error('prepared completion does not bind the exact old G4 manifest')
    const history = await this.#completionHistory(marker)
    if (history.resolution !== 'exact-completion') return null
    let rawRun: unknown = suppliedRun
    if (rawRun === undefined) {
      try { rawRun = JSON.parse((await readFile(await safePath(this.#dir, `runs/${marker.attemptId}.json`))).toString('utf8')) } catch { throw new Error('prepared completion run is unreadable or missing') }
    }
    this.#validateRun(rawRun, true, manifest.revision + 1)
    const run = rawRun as PhaseRun
    if (run.attemptId !== marker.attemptId || run.status !== 'completed' || run.failureCode !== undefined || !isExactWrapperReceipt(run.receipt) || !isDeepStrictEqual(run.evidence, this.#completionEvidence(oldSnapshot))) throw new Error('prepared completion run does not bind the exact gated result')
    for (const reference of run.evidence) await this.#verifyEvidence(normalizeEvidenceReference(reference))

    const attempts = await this.attempts()
    const matching = attempts.find((value) => isRecord(value) && value.attemptId === marker.attemptId) as Record<string, unknown> | undefined
    const active = attempts.filter((value) => isRecord(value) && (value.status === 'prepared' || value.status === 'running' || value.status === 'recovery-required')) as Record<string, unknown>[]
    if (active.some((value) => value.attemptId !== marker.attemptId) || active.length > 1) throw new Error('prepared completion retains another active attempt fixture')
    if (matching) {
      if (matching.status !== 'running' || matching.phase !== run.phase || !isDeepStrictEqual(matching.receipt, run.receipt) || !isRecord(matching.intent) || matching.intent.nonce !== run.receipt.nonce) throw new Error('prepared completion active fixture does not bind the exact run')
    }
    return { marker, manifest, snapshot: { ...oldSnapshot, revision: oldSnapshot.revision + 1, stage: 'G5', runState: 'waiting', pendingDecision: 'acceptResult' }, run, activeAttempt: matching ?? null }
  }
  async #verifyRunChain(manifest: Manifest): Promise<void> {
    this.#validateRun(manifest.run, true, manifest.revision)
    const runsByRevision = new Map<number, PhaseRun>()
    let preparedCompletionRun: PhaseRun | null = null
    for (const name of await this.#runEntryNames()) {
      if (!name.endsWith('.json')) throw new Error('unexpected immutable run entry')
      const attemptId = name.slice(0, -'.json'.length)
      assertSafeAttemptId(attemptId, 'run')
      const runPath = await safePath(this.#dir, `runs/${name}`)
      if (!(await lstat(runPath)).isFile()) throw new Error('immutable run entry is not a regular file')
      let persisted: unknown
      try {
        persisted = JSON.parse((await readFile(runPath)).toString('utf8'))
      } catch {
        throw new Error('immutable run is unreadable or malformed')
      }
      this.#validateRun(persisted, true)
      if (persisted.attemptId !== attemptId) throw new Error('immutable run filename and identity diverge')
      const revision = persisted.previousRevision + 1
      if (revision === manifest.revision + 1) {
        if (preparedCompletionRun) throw new Error('multiple prepared completion runs exist')
        preparedCompletionRun = persisted
        continue
      }
      if (revision < 1 || revision > manifest.revision) throw new Error('immutable run revision lies outside the canonical chain')
      if (runsByRevision.has(revision)) throw new Error('duplicate immutable run revision')
      runsByRevision.set(revision, persisted)
    }
    if (runsByRevision.size !== manifest.revision) throw new Error('immutable run chain is incomplete or has extra revisions')
    for (let revision = 1; revision <= manifest.revision; revision += 1) {
      const run = runsByRevision.get(revision)
      if (!run || run.previousRevision !== revision - 1) throw new Error('immutable run chain is not contiguous')
      for (const evidence of run.evidence) await this.#verifyEvidence(evidence)
    }
    const latest = runsByRevision.get(manifest.revision)
    if (!latest || !isDeepStrictEqual(latest, manifest.run)) throw new Error('latest immutable run and manifest identity diverge')
    if (preparedCompletionRun && !await this.#preparedCompletion(manifest, preparedCompletionRun)) throw new Error('immutable run is not an exact prepared completion')
  }
  async snapshot(): Promise<ProjectSnapshot> {
    if (this.#recovery) return structuredClone(this.#recovery)
    if (this.#manifest && this.#safeSnapshot) return structuredClone(this.#safeSnapshot)
    return { schemaVersion: 1, projectId: this.#projectId, revision: 0, stage: 'G0', runState: 'idle', language: 'tr', blueprintRevision: 0, gates: [], pendingDecision: 'submitIdea' }
  }
  async requireRecovery(reason: string, attemptId?: string): Promise<void> {
    if (attemptId !== undefined) assertSafeAttemptId(attemptId)
    const safeReason = validRecoveryReason(reason) ? reason : 'artifact recovery required'
    const snapshot = this.#recoverySnapshot(safeReason)
    // Fail closed in memory before a fallible marker write. If the filesystem
    // cannot record the marker, this supervisor still cannot issue a launch.
    this.#recovery = snapshot
    if (this.#recoveryMarker) return
    const unsigned: Omit<RecoveryMarker, 'sha256'> = { schemaVersion: SCHEMA, projectId: this.#projectId, markerId: `recovery-${randomBytes(16).toString('hex')}`, reason: safeReason, ...(attemptId === undefined ? {} : { attemptId }), snapshot: structuredClone(snapshot) }
    const marker: RecoveryMarker = { ...unsigned, sha256: sha256(json({ ...unsigned, sha256: undefined })) }
    await atomicWrite(await safePath(this.#dir, 'recovery.json'), json(marker))
    this.#recoveryMarker = marker
  }
  /**
   * A completion history entry is a prepared intent until its exact G5
   * manifest exists. If the run was never written, an exact interruption may
   * consume that intent without rewriting append-only history.
   */
  async #completionIntentCanYieldToReconciliation(marker: RecoveryMarker): Promise<boolean> {
    if (marker.attemptId === undefined || !this.#manifest) return false
    const manifest = this.#manifest
    if (typeof manifest.sha256 !== 'string' || sha256(json({ ...manifest, sha256: undefined })) !== manifest.sha256) return false
    const markerSnapshot = marker.snapshot
    const snapshot = manifest.snapshot
    if (markerSnapshot.revision !== manifest.revision || markerSnapshot.stage !== 'G4' || markerSnapshot.runState !== 'recovery-required' || markerSnapshot.pendingDecision !== null || snapshot.stage !== 'G4' || snapshot.runState !== 'running' || snapshot.pendingDecision !== null) return false
    try {
      await stat(await safePath(this.#dir, `runs/${marker.attemptId}.json`))
      return false
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return true
      throw error
    }
  }
  async #appendRecoveryHistory(marker: RecoveryMarker, resolution: 'exact-reconciliation' | 'exact-completion'): Promise<void> {
    if (marker !== this.#recoveryMarker || !this.#recovery) throw new Error('recovery marker is no longer current')
    if (resolution === 'exact-completion' && marker.attemptId === undefined) throw new Error('exact completion requires a marker-bound attempt')
    const historyPath = await safePath(this.#dir, `recovery-history/${marker.markerId}.json`)
    const keys = marker.attemptId === undefined
      ? ['schemaVersion', 'projectId', 'markerId', 'resolution', 'reason', 'resolvedAt', 'priorMarkerDigest']
      : ['schemaVersion', 'projectId', 'markerId', 'resolution', 'reason', 'attemptId', 'resolvedAt', 'priorMarkerDigest']
    try {
      let parsed: unknown
      try { parsed = JSON.parse((await readFile(historyPath)).toString('utf8')) } catch (error: unknown) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw error
        throw new Error('recovery resolution history is malformed')
      }
      if (!isRecord(parsed) || Object.keys(parsed).length !== keys.length || keys.some((key) => !(key in parsed)) || parsed.schemaVersion !== SCHEMA || parsed.projectId !== this.#projectId || parsed.markerId !== marker.markerId || (parsed.resolution !== 'exact-reconciliation' && parsed.resolution !== 'exact-completion') || parsed.reason !== marker.reason || parsed.attemptId !== marker.attemptId || typeof parsed.resolvedAt !== 'string' || !Number.isFinite(Date.parse(parsed.resolvedAt)) || parsed.priorMarkerDigest !== marker.sha256) throw new Error('recovery resolution history identity diverges')
      if (parsed.resolution === resolution) return
      if (resolution === 'exact-reconciliation' && parsed.resolution === 'exact-completion' && await this.#completionIntentCanYieldToReconciliation(marker)) return
      throw new Error('recovery resolution history identity diverges')
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      const archive = { schemaVersion: SCHEMA, projectId: this.#projectId, markerId: marker.markerId, resolution, reason: marker.reason, ...(marker.attemptId === undefined ? {} : { attemptId: marker.attemptId }), resolvedAt: new Date().toISOString(), priorMarkerDigest: marker.sha256 }
      await atomicWrite(historyPath, json(archive))
    }
  }
  async resolveRecoveryExact(input: PublishInput): Promise<void> {
    const marker = this.#recoveryMarker
    if (!marker || !this.#recovery) throw new Error('recovery marker is not eligible for exact reconciliation')
    await this.#appendRecoveryHistory(marker, 'exact-reconciliation')
    // A prior resolve can commit the manifest and then fail only while
    // removing its marker. Re-entering must finalize that exact commit rather
    // than attempting an impossible R+1 publication from an R+1 manifest.
    if (this.#manifest && isDeepStrictEqual(this.#manifest.snapshot, input.snapshot)) {
      const submitted = this.#canonicalRun(input.run)
      const { createdAt: _submittedCreatedAt, sha256: _submittedDigest, ...requestedRun } = submitted
      const { createdAt: _persistedCreatedAt, sha256: _persistedDigest, ...persistedRun } = this.#manifest.run
      if (!isDeepStrictEqual(requestedRun, persistedRun)) throw new Error('recovery terminal manifest and run diverge')
      await unlinkAndSyncParent(await safePath(this.#dir, 'recovery.json'))
      this.#recovery = null
      this.#recoveryMarker = null
      return
    }
    this.#recovery = null
    this.#resolvingRecovery = true
    try {
      await this.publish(input)
      await unlinkAndSyncParent(await safePath(this.#dir, 'recovery.json'))
      this.#recoveryMarker = null
    } catch (error) {
      this.#recovery = marker.snapshot
      throw error
    } finally {
      this.#resolvingRecovery = false
    }
  }
  async #finalizeExactReconciliationTerminal(marker: RecoveryMarker, snapshot: ProjectSnapshot, run: PhaseRun): Promise<boolean> {
    const failureCode = snapshot.failureCode
    const terminalPhaseMatches = run.phase === 'failure' || ((run.phase === 'reconcile' || run.phase === 'recovery') && failureCode === 'interrupted')
    if (snapshot.stage !== 'G4' || failureCode === undefined || (snapshot.runState !== 'recovery-required' && RUN_FAILURE_STATES[failureCode] !== snapshot.runState) || run.previousRevision !== marker.snapshot.revision || run.attemptId !== marker.attemptId || !terminalPhaseMatches || run.status !== 'failed' || run.failureCode !== failureCode || !isExactWrapperReceipt(run.receipt)) return false
    const attempts = await this.attempts()
    const active = attempts.filter((value) => isRecord(value) && (value.status === 'prepared' || value.status === 'running' || value.status === 'recovery-required'))
    if (active.length > 0) throw new Error('recovery terminal retains another active attempt fixture')
    const attempt = attempts.find((value) => isRecord(value) && value.attemptId === marker.attemptId) as Record<string, unknown> | undefined
    if (!attempt || attempt.status !== 'interrupted' || !isRecord(attempt.receipt) || !isDeepStrictEqual(attempt.receipt, run.receipt)) throw new Error('recovery terminal attempt diverges')
    await unlinkAndSyncParent(await safePath(this.#dir, 'recovery.json'))
    this.#recovery = null
    this.#recoveryMarker = null
    return true
  }
  /** Finalize only a crash-stranded marker whose exact terminal record is already durable. */
  async finalizeExactRecoveryMarker(resolution: 'exact-reconciliation' | 'exact-completion' = 'exact-reconciliation'): Promise<boolean> {
    const marker = this.#recoveryMarker
    if (!marker || !this.#recovery || marker.attemptId === undefined || marker.snapshot.runState !== 'recovery-required' || marker.snapshot.stage !== 'G4' || marker.snapshot.pendingDecision !== null || !this.#manifest) return false
    if (typeof this.#manifest.sha256 !== 'string' || sha256(json({ ...this.#manifest, sha256: undefined })) !== this.#manifest.sha256) throw new Error('recovery terminal manifest digest diverges')
    await this.#verifyRunChain(this.#manifest)
    const snapshot = normalizeProjectSnapshot(this.#manifest.snapshot, { projectId: this.#projectId, minimumRevision: 1, expectedRevision: marker.snapshot.revision + 1, allowLegacy: false })
    const run = this.#manifest.run
    const history = await this.#completionHistory(marker)

    if (history.resolution === 'exact-completion') {
      if (resolution === 'exact-reconciliation') return this.#finalizeExactReconciliationTerminal(marker, snapshot, run)
      if (resolution !== 'exact-completion') return false
      if (snapshot.stage !== 'G5' || snapshot.runState !== 'waiting' || snapshot.pendingDecision !== 'acceptResult' || snapshot.failureCode !== undefined || run.previousRevision !== marker.snapshot.revision || run.attemptId !== marker.attemptId || run.status !== 'completed' || run.failureCode !== undefined || !isExactWrapperReceipt(run.receipt)) return false
      const attempts = await this.attempts()
      const active = attempts.filter((value) => isRecord(value) && (value.status === 'prepared' || value.status === 'running' || value.status === 'recovery-required'))
      if (active.length > 0 || attempts.some((value) => isRecord(value) && value.attemptId === marker.attemptId)) throw new Error('completed recovery marker retains an active attempt fixture')
      await unlinkAndSyncParent(await safePath(this.#dir, 'recovery.json'))
      this.#recovery = null
      this.#recoveryMarker = null
      return true
    }

    if (resolution !== 'exact-reconciliation') return false
    if (history.resolution !== 'exact-reconciliation') throw new Error('recovery terminal history diverges')
    return this.#finalizeExactReconciliationTerminal(marker, snapshot, run)
  }
  /** Reopen may only auto-finalize a completion intent that was later reconciled. */
  async finalizePreparedCompletionReconciliationMarker(): Promise<boolean> {
    const marker = this.#recoveryMarker
    if (!marker || marker.attemptId === undefined) return false
    const history = await this.#completionHistory(marker)
    if (history.resolution !== 'exact-completion') return false
    // An old G4 manifest still needs the prepared-completion resume path. The
    // nested finalizer is only for the later R+1 interrupted terminal.
    if (!this.#manifest || this.#manifest.revision !== marker.snapshot.revision + 1) return false
    return this.finalizeExactRecoveryMarker('exact-reconciliation')
  }
  /** Describe a fully verified R+1 completion that is still waiting on its old G4 manifest. */
  async preparedCompletionRecovery(): Promise<PreparedCompletionRecovery | null> {
    const prepared = await this.#preparedCompletion()
    if (!prepared) return null
    return { attemptId: prepared.run.attemptId, receipt: structuredClone(prepared.run.receipt), hasActiveFixture: prepared.activeAttempt !== null }
  }
  async #processGroupIsAbsent(pgid: number): Promise<boolean> {
    if (TRUSTED_PS_PATH === null) return false
    try {
      process.kill(-pgid, 0)
      const { stdout } = await runTrustedPs(['-ax', '-o', 'pgid=,stat='])
      const members = stdout.split('\n').map((line) => line.trim().split(/\s+/, 2)).filter(([observed]) => Number(observed) === pgid)
      return members.length > 0 && members.every(([, state]) => state?.startsWith('Z'))
    } catch (error: unknown) { return Boolean(error) && typeof error === 'object' && (error as NodeJS.ErrnoException).code === 'ESRCH' }
  }
  async #canonicalG5CompletionContext(): Promise<{ manifest: Manifest; snapshot: ProjectSnapshot; run: PhaseRun; evidence: EvidenceReference[] } | null> {
    const manifest = this.#manifest
    if (!manifest) return null
    if (typeof manifest.sha256 !== 'string' || sha256(json({ ...manifest, sha256: undefined })) !== manifest.sha256) throw new Error('canonical completed manifest digest diverges')
    const snapshot = normalizeProjectSnapshot(manifest.snapshot, { projectId: this.#projectId, minimumRevision: 1, expectedRevision: manifest.revision, allowLegacy: false })
    if (snapshot.stage !== 'G5' || snapshot.runState !== 'waiting' || snapshot.pendingDecision !== 'acceptResult' || snapshot.failureCode !== undefined) return null
    await this.#verifyRunChain(manifest)
    const run = manifest.run
    const evidence = this.#completionEvidence(snapshot)
    if (run.previousRevision !== snapshot.revision - 1 || run.status !== 'completed' || run.failureCode !== undefined || !isExactWrapperReceipt(run.receipt) || !isDeepStrictEqual(run.evidence, evidence)) throw new Error('canonical completed run does not bind the exact G5 evidence')
    return { manifest, snapshot, run, evidence }
  }
  async #matchingCompletionMarker(context: { snapshot: ProjectSnapshot; run: PhaseRun; evidence: EvidenceReference[] }): Promise<RecoveryMarker | null> {
    const path = await safePath(this.#dir, 'recovery.json')
    let raw: Buffer
    try { raw = await readFile(path) } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        if (this.#recoveryMarker || this.#recovery) throw new Error('canonical completed fixture has an unobservable recovery marker')
        return null
      }
      throw error
    }
    const marker = this.#recoveryMarker
    if (!marker || !this.#recovery) throw new Error('canonical completed fixture recovery marker is invalid')
    let persisted: unknown
    try { persisted = JSON.parse(raw.toString('utf8')) } catch { throw new Error('canonical completed fixture recovery marker is malformed') }
    if (!isDeepStrictEqual(persisted, marker) || marker.attemptId !== context.run.attemptId || marker.snapshot.revision !== context.snapshot.revision - 1 || marker.snapshot.stage !== 'G4' || marker.snapshot.runState !== 'recovery-required' || marker.snapshot.pendingDecision !== null) throw new Error('canonical completed fixture recovery marker does not bind the exact completion')
    const { failureCode: _failureCode, recoveryReason: _recoveryReason, ...base } = context.snapshot
    const expectedMarkerSnapshot: ProjectSnapshot = { ...base, revision: context.snapshot.revision - 1, stage: 'G4', runState: 'recovery-required', pendingDecision: null, recoveryReason: marker.reason }
    if (!isDeepStrictEqual(marker.snapshot, expectedMarkerSnapshot) || context.run.previousRevision !== marker.snapshot.revision || !isDeepStrictEqual(context.run.evidence, context.evidence)) throw new Error('canonical completed fixture marker/run binding diverges')
    const history = await this.#completionHistory(marker)
    if (history.resolution !== 'exact-completion') throw new Error('canonical completed fixture recovery history diverges')
    return marker
  }
  async #removeMatchingCompletionMarker(marker: RecoveryMarker): Promise<void> {
    const path = await safePath(this.#dir, 'recovery.json')
    let persisted: unknown
    try { persisted = JSON.parse((await readFile(path)).toString('utf8')) } catch { throw new Error('canonical completed fixture recovery marker is unreadable') }
    if (!isDeepStrictEqual(persisted, marker)) throw new Error('canonical completed fixture recovery marker changed before removal')
    await unlinkAndSyncParent(path)
    this.#recovery = null
    this.#recoveryMarker = null
  }
  /**
   * A completed G5 may survive a crash with its exact running fixture still
   * present. It is never an active authority again once the completed run,
   * launch intent, gate evidence, and dead group bind exactly.
   */
  async archiveCompletedAttemptFixtureIfExact(): Promise<PreparedCompletionRecovery | null> {
    const attempts = await this.attempts()
    const active = attempts.filter((value) => isRecord(value) && (value.status === 'prepared' || value.status === 'running' || value.status === 'recovery-required')) as Record<string, unknown>[]
    if (active.length === 0) return null
    const context = await this.#canonicalG5CompletionContext()
    if (!context) return null
    if (active.length !== 1) throw new Error('canonical completed fixture retains multiple active attempt records')
    const fixture = active[0]!
    const receipt = context.run.receipt as Record<string, unknown> & { pid: number; pgid: number; startIdentity: string; nonce: string; wrapperCommand: string }
    if (fixture.status !== 'running' || fixture.attemptId !== context.run.attemptId || fixture.phase !== context.run.phase || !isDeepStrictEqual(fixture.receipt, receipt) || !isRecord(fixture.intent) || fixture.intent.nonce !== receipt.nonce) throw new Error('canonical completed fixture does not bind the exact completed run')
    const marker = await this.#matchingCompletionMarker(context)
    if (!await this.#processGroupIsAbsent(receipt.pgid)) throw new Error('canonical completed fixture process group is live or unverifiable')
    await this.#removeActiveAttemptExact({ attemptId: context.run.attemptId, receipt, phase: context.run.phase, intentNonce: receipt.nonce })
    if (marker) {
      const current = await this.#matchingCompletionMarker(context)
      if (current !== marker) throw new Error('canonical completed fixture recovery marker changed before archival')
      await this.#removeMatchingCompletionMarker(marker)
    }
    return { attemptId: context.run.attemptId, receipt: structuredClone(receipt), hasActiveFixture: true }
  }
  /**
   * Publish the already durable exact G5 commit. The only mutable portion is
   * the matching active fixture; it is removed only after its exact group is
   * absent, and the immutable run file is never rewritten.
   */
  async resumePreparedCompletion(): Promise<PreparedCompletionRecovery | null> {
    const prepared = await this.#preparedCompletion()
    if (!prepared || prepared.marker !== this.#recoveryMarker || prepared.manifest !== this.#manifest) return null
    const result: PreparedCompletionRecovery = { attemptId: prepared.run.attemptId, receipt: structuredClone(prepared.run.receipt), hasActiveFixture: prepared.activeAttempt !== null }
    if (prepared.activeAttempt && !await this.#processGroupIsAbsent((prepared.run.receipt as Record<string, unknown>).pgid as number)) return null
    try {
      if (prepared.activeAttempt) await this.#removeActiveAttemptExact({ attemptId: prepared.run.attemptId, receipt: prepared.run.receipt })
      const unsigned: Omit<Manifest, 'sha256'> = { schemaVersion: SCHEMA, projectId: this.#projectId, revision: prepared.snapshot.revision, snapshot: structuredClone(prepared.snapshot), run: structuredClone(prepared.run) }
      const manifest: Manifest = { ...unsigned, sha256: sha256(json({ ...unsigned, sha256: undefined })) }
      await atomicWrite(join(this.#dir, 'manifest.json'), json(manifest))
      this.#manifest = manifest
      this.#safeSnapshot = prepared.snapshot
      await unlinkAndSyncParent(await safePath(this.#dir, 'recovery.json'))
      this.#recovery = null
      this.#recoveryMarker = null
      return result
    } catch (error) {
      this.#recovery = prepared.marker.snapshot
      throw error
    }
  }
  /** Trusted launch-boundary check; the artifact directory itself is never exposed. */
  async containsProjectPath(resolvedPath: string): Promise<boolean> {
    const projectDirectory = await realpath(this.#dir)
    const remainder = relative(projectDirectory, resolvedPath)
    return remainder === '' || (!remainder.startsWith('..') && !isAbsolute(remainder))
  }
  async artifactBytes(path: string): Promise<Buffer> { return readFile(await safePath(this.#dir, path)) }
  /** Verify that each immutable evidence reference is already durable before a terminal signal. */
  async verifyEvidenceReferences(references: readonly EvidenceReference[]): Promise<void> {
    for (const reference of references) await this.#verifyEvidence(normalizeEvidenceReference(reference))
  }
  /** Every run is bound to the identity supplied when this store was opened. */
  gitSnapshot(): string { return this.#gitHead }
  /**
   * Complete a recovery-guarded attempt in the only safe durable order: write
   * its immutable run, remove the exact active fixture, clear in-memory
   * authority, and only then advance the canonical manifest.
   */
  async completeAttemptExact(input: PublishInput & CompletionArchive): Promise<void> {
    assertSafeAttemptId(input.attemptId)
    if (!isRecord(input.receipt) || input.run.attemptId !== input.attemptId || input.run.status !== 'completed' || !isDeepStrictEqual(input.run.receipt, input.receipt)) throw new Error('completed attempt archive must retain the exact active receipt')
    const marker = this.#recoveryMarker
    if (!marker || !this.#recovery || marker.attemptId !== input.attemptId) throw new Error('completed attempt requires an exact active recovery marker')
    try {
      await this.#appendRecoveryHistory(marker, 'exact-completion')
      this.#recovery = null
      this.#resolvingRecovery = true
      await this.#publish(input, input)
      await unlinkAndSyncParent(await safePath(this.#dir, 'recovery.json'))
      this.#recoveryMarker = null
    } catch (error) {
      this.#recovery = marker.snapshot
      throw error
    } finally {
      this.#resolvingRecovery = false
    }
  }
  async saveAttempt<T extends object>(attempt: T, id: string): Promise<T & { sha256: string }> {
    this.#validateAttempt(attempt, id, false)
    const unsigned = { ...(attempt as Record<string, unknown>), sha256: undefined }
    const signed = { ...unsigned, sha256: sha256(json(unsigned)) }
    await atomicWrite(await safePath(this.#dir, `attempts/${id}.json`), json(signed))
    return signed as T & { sha256: string }
  }
  #validateAttempt(value: unknown, filenameId: string, requireDigest: boolean): void {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid persisted attempt schema')
    const attempt = value as Record<string, unknown>
    assertSafeAttemptId(filenameId)
    if (attempt.schemaVersion !== SCHEMA || attempt.projectId !== this.#projectId || attempt.attemptId !== filenameId || typeof attempt.attemptId !== 'string' || !attempt.attemptId || typeof attempt.phase !== 'string' || !attempt.phase || !attempt.receipt || typeof attempt.receipt !== 'object' || Array.isArray(attempt.receipt) || typeof attempt.status !== 'string' || !ATTEMPT_STATUSES.has(attempt.status)) throw new Error('invalid persisted attempt schema, identity, or status')
    assertSafeAttemptId(attempt.attemptId)
    if (!validLaunchIntent(attempt.intent) || attempt.phase !== attempt.intent.phase) throw new Error('persisted attempt launch intent is invalid or mismatched')
    const receipt = attempt.receipt as Record<string, unknown>
    if (attempt.status !== 'prepared' && (receipt.nonce !== attempt.intent.nonce || receipt.wrapperCommand !== WRAPPER_COMMAND)) throw new Error('persisted attempt receipt identity does not match its launch intent')
    if (requireDigest && (typeof attempt.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(attempt.sha256) || sha256(json({ ...attempt, sha256: undefined })) !== attempt.sha256)) throw new Error('persisted attempt digest missing or mismatched')
  }
  async attempts(): Promise<unknown[]> {
    const directory = await safePath(this.#dir, 'attempts')
    try {
      return await Promise.all((await readdir(directory)).filter((name) => name.endsWith('.json')).map(async (name) => {
        const id = name.slice(0, -'.json'.length)
        assertSafeAttemptId(id)
        let value: unknown
        try { value = JSON.parse((await readFile(await safePath(this.#dir, `attempts/${name}`))).toString('utf8')) } catch { throw new Error(`invalid persisted attempt JSON: ${name}`) }
        this.#validateAttempt(value, id, true)
        return value
      }))
    } catch (error: unknown) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error }
  }
  async #removeActiveAttemptExact(input: CompletionArchive): Promise<void> {
    const path = await safePath(this.#dir, `attempts/${input.attemptId}.json`)
    let persisted: unknown
    try { persisted = JSON.parse((await readFile(path)).toString('utf8')) } catch { throw new Error('completed attempt fixture is unreadable or missing') }
    this.#validateAttempt(persisted, input.attemptId, true)
    const attempt = persisted as Record<string, unknown>
    if (attempt.status !== 'running' || !isDeepStrictEqual(attempt.receipt, input.receipt)) throw new Error('completed attempt fixture does not bind the exact running receipt')
    if (input.phase !== undefined && attempt.phase !== input.phase) throw new Error('completed attempt fixture phase does not bind the exact completed run')
    if (input.intentNonce !== undefined && (!isRecord(attempt.intent) || attempt.intent.nonce !== input.intentNonce)) throw new Error('completed attempt fixture intent does not bind the exact completed run')
    await unlinkAndSyncParent(path)
  }
  async publish(input: PublishInput): Promise<void> { await this.#publish(input) }
  async #publish(input: PublishInput, completion?: CompletionArchive): Promise<void> {
    if (this.#recovery) throw new Error('recovery-required artifacts cannot be advanced')
    const snapshot = normalizeProjectSnapshot(input.snapshot, { projectId: this.#projectId, minimumRevision: 1, allowLegacy: true })
    if (input.run.schemaVersion !== SCHEMA || input.run.projectId !== this.#projectId) throw new Error('invalid artifact schema or identity')
    let run = this.#canonicalRun(input.run)
    if (run.gitSnapshot !== this.#gitHead) throw new Error('git snapshot and supplied head diverge')
    const runPath = `runs/${run.attemptId}.json`
    try {
      await stat(await safePath(this.#dir, runPath))
      if (!this.#resolvingRecovery) throw new Error('immutable attempt already exists')
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    const current = this.#manifest?.revision ?? 0
    if (snapshot.revision !== current + 1 || run.previousRevision !== current) throw new Error('stale revision')
    try {
      const existing = JSON.parse((await readFile(await safePath(this.#dir, runPath))).toString('utf8')) as unknown
      this.#validateRun(existing, true, current + 1)
      const { createdAt: _submittedCreatedAt, sha256: _submittedDigest, ...submitted } = run
      const { createdAt: _existingCreatedAt, sha256: _existingDigest, ...persisted } = existing
      if (!isDeepStrictEqual(submitted, persisted)) throw new Error('immutable attempt already exists')
      run = existing
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    for (const [name, contents] of Object.entries(input.artifacts)) {
      const destination = await safePath(this.#dir, name)
      try { await stat(destination); throw new Error(`immutable artifact already exists: ${name}`) } catch (error: unknown) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
      await atomicWrite(destination, typeof contents === 'string' ? Buffer.from(contents, 'utf8') : contents)
    }
    for (const evidence of run.evidence) await this.#verifyEvidence(evidence)
    try { await stat(await safePath(this.#dir, runPath)); } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      await atomicWrite(await safePath(this.#dir, runPath), json(run))
    }
    if (completion) {
      await this.#removeActiveAttemptExact(completion)
      completion.onAttemptArchived?.()
    }
    const unsigned: Omit<Manifest, 'sha256'> = { schemaVersion: SCHEMA, projectId: this.#projectId, revision: snapshot.revision, snapshot: structuredClone(snapshot), run: structuredClone(run) }
    const manifest: Manifest = { ...unsigned, sha256: sha256(json({ ...unsigned, sha256: undefined })) }
    await atomicWrite(join(this.#dir, 'manifest.json'), json(manifest))
    this.#manifest = manifest
    this.#safeSnapshot = snapshot
  }
}

export class ProjectLock {
  readonly #path: string; readonly #receipt: LockReceipt; #released = false
  private constructor(path: string, receipt: LockReceipt) { this.#path = path; this.#receipt = receipt }
  static async acquire(options: { root: string; projectId: string }): Promise<ProjectLock> {
    assertSafeProjectId(options.projectId)
    const root = await trustedCallerDirectory(options.root, { create: true, label: 'artifact data root' })
    const directory = await projectDirectory(root, options.projectId)
    const path = join(directory, '.project.lock')
    const receipt = await lockReceiptForCurrentProcess()
    while (true) {
      try { await writeLock(path, receipt, true); return new ProjectLock(path, receipt) } catch (error: unknown) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      }
      const original = await readLock(path)
      if (await ownerIsVerifiedAlive(original)) throw new Error('project is already locked by an active supervisor')
      // A malformed, mismatched, or unobservable owner is not evidence of death.
      if (await ownerIdentityState(original) !== 'gone') throw new Error('project lock recovery required: owner receipt is invalid or unverifiable')
      const guardPath = `${path}.takeover`
      const ownGuard = signedTakeoverGuard(original, receipt)
      try {
        await writeFileExclusive(guardPath, ownGuard)
      } catch (error: unknown) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        await reclaimStaleTakeoverGuard(path, guardPath)
        continue
      }

      let candidate: string | null = null
      try {
        const unchanged = await readFile(path).catch(() => null)
        if (!original.raw || !unchanged || !unchanged.equals(original.raw)) throw new Error('project is already locked by an active supervisor')
        const stableOwner = await readLock(path)
        if (!stableOwner.raw || !stableOwner.raw.equals(original.raw) || !sameLockIdentity(stableOwner, original) || await ownerIdentityState(stableOwner) !== 'gone') throw new Error('project is already locked by an active supervisor')
        const stableGuard = await readFile(guardPath).catch(() => null)
        if (!stableGuard || !stableGuard.equals(ownGuard)) throw new Error('project is already locked by an active supervisor')
        candidate = `${path}.${receipt.nonce}.new`
        await writeLock(candidate, receipt, true)
        const finalOwner = await readLock(path)
        const finalGuard = await readFile(guardPath).catch(() => null)
        if (!finalOwner.raw || !finalOwner.raw.equals(original.raw) || !sameLockIdentity(finalOwner, original) || await ownerIdentityState(finalOwner) !== 'gone' || !finalGuard || !finalGuard.equals(ownGuard)) throw new Error('project is already locked by an active supervisor')
        await rename(candidate, path)
        candidate = null
        await syncDirectory(dirname(path))
        if (!await removeExactGuard(guardPath, ownGuard)) throw new Error('project lock recovery required: owned takeover guard changed before removal')
        return new ProjectLock(path, receipt)
      } finally {
        if (candidate) await rm(candidate, { force: true }).catch(() => undefined)
        await removeExactGuard(guardPath, ownGuard).catch(() => undefined)
      }
    }
  }
  async release(): Promise<void> {
    if (this.#released) return; this.#released = true
    try { const current = await readLock(this.#path); if (sameLockIdentity(current, this.#receipt)) await unlinkAndSyncParent(this.#path) } catch { /* stale owner must not remove a successor */ }
  }
}

function isRunFailureCode(value: unknown): value is typeof RUN_FAILURE_CODES[number] {
  return typeof value === 'string' && RUN_FAILURE_CODES.includes(value as typeof RUN_FAILURE_CODES[number])
}

interface LockReceipt { pid: number; startIdentity: string; nonce: string; raw?: Buffer }
interface TakeoverGuard {
  schemaVersion: 1
  predecessor: { pid: number; startIdentity: string; nonce: string; lockDigest: string }
  successor: { pid: number; startIdentity: string; nonce: string }
  guardNonce: string
  sha256: string
}

function lockReceiptValue(receipt: LockReceipt): { pid: number; startIdentity: string; nonce: string } { return { pid: receipt.pid, startIdentity: receipt.startIdentity, nonce: receipt.nonce } }
function sameLockIdentity(left: LockReceipt, right: LockReceipt): boolean { return left.pid === right.pid && left.startIdentity === right.startIdentity && left.nonce === right.nonce }
function validLockIdentity(value: unknown): value is { pid: number; startIdentity: string; nonce: string } {
  return isRecord(value) && hasExactKeys(value, ['pid', 'startIdentity', 'nonce'])
    && typeof value.pid === 'number' && Number.isSafeInteger(value.pid) && value.pid > 0
    && typeof value.startIdentity === 'string' && value.startIdentity.length > 0
    && typeof value.nonce === 'string' && SAFE_NONCE.test(value.nonce)
}
function canonicalLockReceiptBytes(receipt: LockReceipt): Buffer { return Buffer.from(json(lockReceiptValue(receipt))) }
function isEmptyPsOutput(value: unknown): boolean {
  if (value === undefined) return true
  if (typeof value === 'string') return value.trim().length === 0
  return Buffer.isBuffer(value) && value.length === 0
}
async function processIdentity(pid: number): Promise<string | null | undefined> {
  try {
    const { stdout } = await runTrustedPs(['-o', 'lstart=', '-p', String(pid)])
    const identity = stdout.trim()
    return identity || null
  } catch (error: unknown) {
    const result = error as { code?: unknown; stdout?: unknown; stderr?: unknown }
    if (result.code === 1 && isEmptyPsOutput(result.stdout) && isEmptyPsOutput(result.stderr)) return null
    return undefined
  }
}
async function lockReceiptForCurrentProcess(): Promise<LockReceipt> { const startIdentity = await processIdentity(process.pid); if (!startIdentity) throw new Error('project lock recovery required: cannot observe owner identity'); return { pid: process.pid, startIdentity, nonce: randomBytes(32).toString('hex') } }
async function writeFileExclusive(path: string, bytes: Uint8Array): Promise<void> { const handle = await open(path, 'wx', 0o600); try { await handle.writeFile(bytes); await handle.sync() } finally { await handle.close() }; await syncDirectory(dirname(path)) }
async function writeLock(path: string, receipt: LockReceipt, exclusive: boolean): Promise<void> { const bytes = json(lockReceiptValue(receipt)); if (exclusive) await writeFileExclusive(path, bytes); else await atomicWrite(path, bytes) }
async function readLock(path: string): Promise<LockReceipt> { const raw = await readFile(path); let value: unknown; try { value = JSON.parse(raw.toString('utf8')) } catch { throw new Error('project lock recovery required: malformed receipt') }; if (!value || typeof value !== 'object') throw new Error('project lock recovery required: invalid receipt'); const r = value as Partial<LockReceipt>; if (!Number.isSafeInteger(r.pid) || r.pid! <= 0 || typeof r.startIdentity !== 'string' || !r.startIdentity || typeof r.nonce !== 'string' || !SAFE_NONCE.test(r.nonce)) throw new Error('project lock recovery required: invalid receipt identity'); return { pid: r.pid!, startIdentity: r.startIdentity, nonce: r.nonce, raw } }
function signedTakeoverGuard(predecessor: LockReceipt, successor: LockReceipt): Buffer {
  if (!predecessor.raw) throw new Error('project lock recovery required: predecessor lock bytes are unavailable')
  const unsigned = {
    schemaVersion: 1 as const,
    predecessor: { ...lockReceiptValue(predecessor), lockDigest: sha256(predecessor.raw) },
    successor: lockReceiptValue(successor),
    guardNonce: randomBytes(32).toString('hex'),
  }
  return Buffer.from(json({ ...unsigned, sha256: sha256(json(unsigned)) }))
}
async function readTakeoverGuard(path: string): Promise<{ guard: TakeoverGuard; raw: Buffer }> {
  const raw = await readFile(path)
  let value: unknown
  try { value = JSON.parse(raw.toString('utf8')) } catch { throw new Error('project lock recovery required: takeover guard is malformed') }
  if (!isRecord(value) || !hasExactKeys(value, ['schemaVersion', 'predecessor', 'successor', 'guardNonce', 'sha256']) || value.schemaVersion !== SCHEMA || !isRecord(value.predecessor) || !hasExactKeys(value.predecessor, ['pid', 'startIdentity', 'nonce', 'lockDigest']) || !validLockIdentity(value.successor) || typeof value.predecessor.pid !== 'number' || !Number.isSafeInteger(value.predecessor.pid) || value.predecessor.pid <= 0 || typeof value.predecessor.startIdentity !== 'string' || value.predecessor.startIdentity.length === 0 || typeof value.predecessor.nonce !== 'string' || !SAFE_NONCE.test(value.predecessor.nonce) || typeof value.predecessor.lockDigest !== 'string' || !SHA256.test(value.predecessor.lockDigest) || typeof value.guardNonce !== 'string' || !SAFE_NONCE.test(value.guardNonce) || typeof value.sha256 !== 'string' || !SHA256.test(value.sha256)) throw new Error('project lock recovery required: takeover guard is invalid')
  const unsigned = { schemaVersion: 1 as const, predecessor: { pid: value.predecessor.pid, startIdentity: value.predecessor.startIdentity, nonce: value.predecessor.nonce, lockDigest: value.predecessor.lockDigest }, successor: lockReceiptValue(value.successor), guardNonce: value.guardNonce }
  if (sha256(json(unsigned)) !== value.sha256) throw new Error('project lock recovery required: takeover guard digest diverges')
  return { guard: { ...unsigned, sha256: value.sha256 }, raw }
}
async function removeExactGuard(path: string, expected: Buffer): Promise<boolean> {
  let current: Buffer
  try { current = await readFile(path) } catch (error: unknown) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error }
  if (!current.equals(expected)) return false
  await unlinkAndSyncParent(path)
  return true
}
async function reclaimStaleTakeoverGuard(lockPath: string, guardPath: string): Promise<void> {
  const first = await readTakeoverGuard(guardPath)
  const predecessor: LockReceipt = { pid: first.guard.predecessor.pid, startIdentity: first.guard.predecessor.startIdentity, nonce: first.guard.predecessor.nonce }
  const successor: LockReceipt = first.guard.successor
  if (await ownerIdentityState(predecessor) !== 'gone' || await ownerIdentityState(successor) !== 'gone') throw new Error('project lock recovery required: takeover owner identity is invalid or unverifiable')
  const current = await readLock(lockPath)
  if (!current.raw) throw new Error('project lock recovery required: takeover lock bytes are unavailable')
  const currentRaw = current.raw
  const predecessorBound = sha256(currentRaw) === first.guard.predecessor.lockDigest
    && sameLockIdentity(current, predecessor)
  const successorBytes = canonicalLockReceiptBytes(successor)
  const successorBound = currentRaw.equals(successorBytes)
    && sha256(canonicalLockReceiptBytes(predecessor)) === first.guard.predecessor.lockDigest
    && sameLockIdentity(current, successor)
  if ((!predecessorBound && !successorBound) || await ownerIdentityState(current) !== 'gone') throw new Error('project lock recovery required: takeover guard is not bound to the dead owner')
  const stable = await readTakeoverGuard(guardPath)
  const stableLock = await readLock(lockPath)
  if (!stable.raw.equals(first.raw) || !stableLock.raw || !stableLock.raw.equals(currentRaw)) throw new Error('project lock recovery required: takeover guard changed or became unverifiable')
  const stableRaw = stableLock.raw
  const stablePredecessorBound = predecessorBound
    && sha256(stableRaw) === first.guard.predecessor.lockDigest
    && sameLockIdentity(stableLock, predecessor)
  const stableSuccessorBound = successorBound
    && stableRaw.equals(successorBytes)
    && sha256(canonicalLockReceiptBytes(predecessor)) === first.guard.predecessor.lockDigest
    && sameLockIdentity(stableLock, successor)
  if ((!stablePredecessorBound && !stableSuccessorBound) || await ownerIdentityState(predecessor) !== 'gone' || await ownerIdentityState(successor) !== 'gone' || await ownerIdentityState(stableLock) !== 'gone') throw new Error('project lock recovery required: takeover guard changed or became unverifiable')
  if (!await removeExactGuard(guardPath, first.raw)) throw new Error('project lock recovery required: takeover guard changed before reclamation')
}
async function ownerIdentityState(receipt: LockReceipt): Promise<'alive' | 'gone' | 'mismatch'> {
  if (TRUSTED_PS_PATH === null) return 'mismatch'
  const observed = await processIdentity(receipt.pid)
  if (observed === receipt.startIdentity) return 'alive'
  if (observed !== null) return 'mismatch'
  try { process.kill(receipt.pid, 0); return 'mismatch' } catch (error: unknown) { return (error as NodeJS.ErrnoException).code === 'ESRCH' ? 'gone' : 'mismatch' }
}
async function ownerIsVerifiedAlive(receipt: LockReceipt): Promise<boolean> { try { return (await ownerIdentityState(receipt)) === 'alive' } catch { throw new Error('project lock recovery required: malformed receipt') } }
