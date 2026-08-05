import { createHash, randomUUID } from 'node:crypto'
import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'

type AttemptStatus = 'pending' | 'passed' | 'failed'

interface AttemptInput {
  attemptId: string
  candidateDigest: string
}

interface TerminalAttemptInput extends AttemptInput {
  resultIdentity: string
  status: Exclude<AttemptStatus, 'pending'>
}

interface EvaluationInput extends AttemptInput {
  resultIdentity: string
}

interface StoredBase {
  schemaVersion: 1
  kind: string
  identity: string
  attemptId: string
  candidateDigest: string
  status: AttemptStatus
  digest: string
}

interface StoredCandidate extends StoredBase {
  kind: 'guidelane.local-web.attempt-candidate'
  status: 'passed'
}

interface StoredAuthority extends StoredBase {
  kind: 'guidelane.local-web.attempt-authority'
  resultIdentity?: string
}

interface StoredTerminal extends StoredBase {
  kind: 'guidelane.local-web.attempt-terminal'
  resultIdentity: string
  status: Exclude<AttemptStatus, 'pending'>
}

const attemptIdPattern = /^[a-z][a-z0-9-]{7,127}$/
const digestPattern = /^[a-f0-9]{64}$/
const statusValues = new Set<AttemptStatus>(['pending', 'passed', 'failed'])

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isAttemptId(value: unknown): value is string {
  return typeof value === 'string' && attemptIdPattern.test(value)
}

function isDigest(value: unknown): value is string {
  return typeof value === 'string' && digestPattern.test(value)
}

function isTerminalStatus(value: unknown): value is Exclude<AttemptStatus, 'pending'> {
  return value === 'passed' || value === 'failed'
}

function assertAttemptInput(input: AttemptInput): void {
  if (!isAttemptId(input.attemptId) || !isDigest(input.candidateDigest)) throw new Error('attempt authority input is invalid')
}

function assertTerminalInput(input: TerminalAttemptInput): void {
  assertAttemptInput(input)
  if (!isDigest(input.resultIdentity) || !isTerminalStatus(input.status)) throw new Error('attempt terminal input is invalid')
}

function attemptDirectory(artifacts: string, attemptId: string): string {
  if (typeof artifacts !== 'string' || artifacts.length === 0 || !isAttemptId(attemptId)) throw new Error('attempt authority path is invalid')
  const root = resolve(artifacts, 'attempts')
  const directory = resolve(root, attemptId)
  if (!directory.startsWith(`${root}${sep}`)) throw new Error('attempt authority path escaped its root')
  return directory
}

function candidateArtifactPath(artifacts: string, attemptId: string): string {
  return join(attemptDirectory(artifacts, attemptId), 'candidate.json')
}

export function authorityArtifactPath(artifacts: string, attemptId: string): string {
  return join(attemptDirectory(artifacts, attemptId), 'authority.json')
}

export function terminalResultArtifactPath(artifacts: string, attemptId: string): string {
  return join(attemptDirectory(artifacts, attemptId), 'terminal.json')
}

function unsignedDigest(value: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function withDigest<T extends Record<string, unknown>>(value: T): T & { digest: string } {
  return { ...value, digest: unsignedDigest(value) }
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value)
  return actual.length === keys.length && actual.every((key) => keys.includes(key))
}

function validCandidate(value: unknown): value is StoredCandidate {
  if (!isObject(value) || !hasOnlyKeys(value, ['schemaVersion', 'kind', 'identity', 'attemptId', 'candidateDigest', 'status', 'digest'])) return false
  if (value.schemaVersion !== 1 || value.kind !== 'guidelane.local-web.attempt-candidate' || value.status !== 'passed') return false
  if (!isAttemptId(value.attemptId) || !isDigest(value.candidateDigest) || !isDigest(value.digest)) return false
  if (value.identity !== `attempt-candidate-${value.attemptId}`) return false
  const unsigned = {
    schemaVersion: 1,
    kind: 'guidelane.local-web.attempt-candidate',
    identity: value.identity,
    attemptId: value.attemptId,
    candidateDigest: value.candidateDigest,
    status: 'passed',
  }
  return unsignedDigest(unsigned) === value.digest
}

function validAuthority(value: unknown): value is StoredAuthority {
  if (!isObject(value)) return false
  const baseKeys = ['schemaVersion', 'kind', 'identity', 'attemptId', 'candidateDigest', 'status', 'digest']
  const terminalKeys = [...baseKeys, 'resultIdentity']
  if (!hasOnlyKeys(value, value.status === 'pending' ? baseKeys : terminalKeys)) return false
  if (value.schemaVersion !== 1 || value.kind !== 'guidelane.local-web.attempt-authority' || !statusValues.has(value.status as AttemptStatus)) return false
  if (!isAttemptId(value.attemptId) || !isDigest(value.candidateDigest) || !isDigest(value.digest)) return false
  if (value.identity !== `attempt-authority-${value.attemptId}`) return false
  if (value.status === 'pending') {
    const unsigned = {
      schemaVersion: 1,
      kind: 'guidelane.local-web.attempt-authority',
      identity: value.identity,
      attemptId: value.attemptId,
      candidateDigest: value.candidateDigest,
      status: 'pending',
    }
    return unsignedDigest(unsigned) === value.digest
  }
  if (!isDigest(value.resultIdentity)) return false
  const unsigned = {
    schemaVersion: 1,
    kind: 'guidelane.local-web.attempt-authority',
    identity: value.identity,
    attemptId: value.attemptId,
    candidateDigest: value.candidateDigest,
    resultIdentity: value.resultIdentity,
    status: value.status,
  }
  return unsignedDigest(unsigned) === value.digest
}

function validTerminal(value: unknown): value is StoredTerminal {
  if (!isObject(value) || !hasOnlyKeys(value, ['schemaVersion', 'kind', 'identity', 'attemptId', 'candidateDigest', 'resultIdentity', 'status', 'digest'])) return false
  if (value.schemaVersion !== 1 || value.kind !== 'guidelane.local-web.attempt-terminal' || !isTerminalStatus(value.status)) return false
  if (!isAttemptId(value.attemptId) || !isDigest(value.candidateDigest) || !isDigest(value.resultIdentity) || !isDigest(value.digest)) return false
  if (value.identity !== value.resultIdentity) return false
  const unsigned = {
    schemaVersion: 1,
    kind: 'guidelane.local-web.attempt-terminal',
    identity: value.identity,
    attemptId: value.attemptId,
    candidateDigest: value.candidateDigest,
    resultIdentity: value.resultIdentity,
    status: value.status,
  }
  return unsignedDigest(unsigned) === value.digest
}

async function writeAtomic(path: string, value: Record<string, unknown>): Promise<void> {
  const directory = dirname(path)
  const temporary = join(directory, `.${randomUUID()}.tmp`)
  const serialized = `${JSON.stringify(withDigest(value), null, 2)}\n`
  await mkdir(directory, { recursive: true })
  try {
    await writeFile(temporary, serialized, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    await rename(temporary, path)
  } catch (error) {
    try { await rm(temporary, { force: true }) } catch { /* a failed cleanup cannot make a record valid */ }
    throw error
  }
}

async function readRecord(path: string): Promise<unknown | undefined> {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch {
    return undefined
  }
}

async function recordExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

export async function createPendingAttemptAuthority(artifacts: string, input: AttemptInput): Promise<void> {
  assertAttemptInput(input)
  const authorityPath = authorityArtifactPath(artifacts, input.attemptId)
  const paths = [authorityPath, candidateArtifactPath(artifacts, input.attemptId), terminalResultArtifactPath(artifacts, input.attemptId)]
  if ((await Promise.all(paths.map((path) => recordExists(path)))).some(Boolean)) throw new Error('attempt authority already exists')
  await writeAtomic(authorityPath, {
    schemaVersion: 1,
    kind: 'guidelane.local-web.attempt-authority',
    identity: `attempt-authority-${input.attemptId}`,
    attemptId: input.attemptId,
    candidateDigest: input.candidateDigest,
    status: 'pending',
  })
}

export async function stageAttemptCandidate(artifacts: string, input: AttemptInput): Promise<void> {
  assertAttemptInput(input)
  const authority = await readRecord(authorityArtifactPath(artifacts, input.attemptId))
  if (!validAuthority(authority) || authority.status !== 'pending' || authority.attemptId !== input.attemptId || authority.candidateDigest !== input.candidateDigest) {
    throw new Error('attempt candidate cannot be staged')
  }
  await writeAtomic(candidateArtifactPath(artifacts, input.attemptId), {
    schemaVersion: 1,
    kind: 'guidelane.local-web.attempt-candidate',
    identity: `attempt-candidate-${input.attemptId}`,
    attemptId: input.attemptId,
    candidateDigest: input.candidateDigest,
    status: 'passed',
  })
}

export async function writeTerminalAttemptResult(artifacts: string, input: TerminalAttemptInput): Promise<void> {
  assertTerminalInput(input)
  const authority = await readRecord(authorityArtifactPath(artifacts, input.attemptId))
  if (!validAuthority(authority) || authority.attemptId !== input.attemptId) throw new Error('attempt terminal has no pending authority')
  const existing = await readRecord(terminalResultArtifactPath(artifacts, input.attemptId))
  if (existing !== undefined && (!validTerminal(existing) || (existing.status === 'failed' && input.status === 'passed'))) {
    throw new Error('attempt terminal cannot become accepted after failure')
  }
  await writeAtomic(terminalResultArtifactPath(artifacts, input.attemptId), {
    schemaVersion: 1,
    kind: 'guidelane.local-web.attempt-terminal',
    identity: input.resultIdentity,
    attemptId: input.attemptId,
    candidateDigest: input.candidateDigest,
    resultIdentity: input.resultIdentity,
    status: input.status,
  })
}

export async function finalizeAttemptAuthority(artifacts: string, input: TerminalAttemptInput): Promise<void> {
  assertTerminalInput(input)
  const authority = await readRecord(authorityArtifactPath(artifacts, input.attemptId))
  if (!validAuthority(authority) || authority.attemptId !== input.attemptId) throw new Error('attempt authority cannot be finalized')
  if (authority.status === 'failed' && input.status === 'passed') throw new Error('attempt authority cannot become accepted after failure')
  await writeAtomic(authorityArtifactPath(artifacts, input.attemptId), {
    schemaVersion: 1,
    kind: 'guidelane.local-web.attempt-authority',
    identity: `attempt-authority-${input.attemptId}`,
    attemptId: input.attemptId,
    candidateDigest: input.candidateDigest,
    resultIdentity: input.resultIdentity,
    status: input.status,
  })
}

export async function evaluateAttemptAuthority(artifacts: string, input: EvaluationInput): Promise<{ accepted: boolean }> {
  try {
    assertAttemptInput(input)
    if (!isDigest(input.resultIdentity)) return { accepted: false }
    const [authority, terminal, candidate] = await Promise.all([
      readRecord(authorityArtifactPath(artifacts, input.attemptId)),
      readRecord(terminalResultArtifactPath(artifacts, input.attemptId)),
      readRecord(candidateArtifactPath(artifacts, input.attemptId)),
    ])
    const accepted = validAuthority(authority)
      && validTerminal(terminal)
      && validCandidate(candidate)
      && authority.status === 'passed'
      && terminal.status === 'passed'
      && candidate.status === 'passed'
      && authority.attemptId === input.attemptId
      && terminal.attemptId === input.attemptId
      && candidate.attemptId === input.attemptId
      && authority.candidateDigest === input.candidateDigest
      && terminal.candidateDigest === input.candidateDigest
      && candidate.candidateDigest === input.candidateDigest
      && authority.resultIdentity === input.resultIdentity
      && terminal.resultIdentity === input.resultIdentity
    return { accepted }
  } catch {
    return { accepted: false }
  }
}
