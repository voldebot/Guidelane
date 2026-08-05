import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'

export const projectId = 'novice-pilot'
/** Stable valid Git object id supplied by every ordinary test open. */
export const testGitHead = '0123456789abcdef0123456789abcdef01234567'

export const snapshot = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  projectId,
  revision: 0,
  stage: 'idea',
  runState: 'idle',
  language: 'tr',
  blueprintRevision: 0,
  gates: [],
  pendingDecision: null,
  ...overrides,
})

export const phaseRun = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  projectId,
  phase: 'blueprint',
  attemptId: 'attempt-001',
  previousRevision: 0,
  createdAt: '2026-08-03T10:00:00.000Z',
  status: 'running',
  inputDigests: {},
  receipt: { pgid: 12345, pid: 12345 },
  evidence: [],
  gitSnapshot: testGitHead,
  ...overrides,
})

export const digest = (value: string | Uint8Array): string =>
  createHash('sha256').update(value).digest('hex')

/** Canonical test-only launch intent for persisted running-attempt fixtures. */
export function launchIntentForTest(nonce = 'a'.repeat(64), phase = 'build'): Record<string, unknown> {
  const unsigned = {
    schemaVersion: 1,
    phase,
    command: resolve(process.execPath),
    commandDigest: digest(resolve(process.execPath)),
    argsDigest: digest('[]'),
    cwd: resolve(process.cwd()),
    envDigest: digest(JSON.stringify([['PATH', process.env.PATH ?? '']])),
    nonce,
  }
  return { ...unsigned, intentDigest: digest(JSON.stringify(unsigned)) }
}

export async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'guidelane-orchestrator-test-'))
  await chmod(dir, 0o700)
  try {
    return await fn(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/** Establish the only normal public command journey that permits a production launch. */
export async function advanceToG4(orchestrator: { command(value: unknown): Promise<unknown> }, idea = 'test build journey'): Promise<void> {
  await orchestrator.command({ type: 'submitIdea', idea })
  await orchestrator.command({ type: 'approveBlueprint' })
  await orchestrator.command({ type: 'approvePlan' })
  await orchestrator.command({ type: 'startBuild' })
}

/** Test launch directories are explicitly owner-private, independent of umask. */
export async function ownerPrivateDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 })
  await chmod(path, 0o700)
}

export async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value)}\n`, 'utf8')
}

export async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8')) as unknown
}

/** Test-only persisted-attempt fixture for corrupt or mismatched recovery cases. */
export async function writeSignedAttempt(root: string, attemptId: string, overrides: Record<string, unknown> = {}): Promise<void> {
  const base = {
    schemaVersion: 1,
    projectId,
    attemptId,
    phase: 'build',
    receipt: { pid: 1, pgid: 1, startIdentity: 'test-only-recorded-identity', nonce: 'a'.repeat(64), wrapperCommand: resolve(process.cwd(), 'packages/orchestrator/src/attempt-wrapper.mjs') },
    status: 'running',
  }
  const supplied = { ...base, ...overrides, receipt: { ...base.receipt, ...(overrides.receipt as Record<string, unknown> | undefined) } }
  const receipt = supplied.receipt as Record<string, unknown>
  const receiptNonce = typeof receipt.nonce === 'string' && /^[a-f0-9]{64}$/i.test(receipt.nonce) ? receipt.nonce : 'a'.repeat(64)
  const attempt = { ...supplied, intent: overrides.intent ?? launchIntentForTest(receiptNonce, supplied.phase as string) }
  const unsigned = { ...attempt, sha256: undefined }
  const signed = { ...attempt, sha256: digest(`${JSON.stringify(unsigned)}\n`) }
  const directory = join(root, projectId, 'attempts')
  await mkdir(directory, { recursive: true, mode: 0o700 })
  await chmod(join(root, projectId), 0o700)
  await chmod(directory, 0o700)
  await writeFile(join(directory, `${attemptId}.json`), `${JSON.stringify(signed)}\n`, 'utf8')
}
