import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { lstat, realpath, stat } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual, promisify } from 'node:util'
import { ArtifactStore, ProjectLock, assertSafeProjectId, assertValidGitHead } from './artifacts.ts'
import { sanitizeLaunchEnvironment, withForcedAutoUpdater } from './environment.ts'
import { REQUIRED_MACHINE_GATES, RUN_FAILURE_CODES, RUN_FAILURE_STATES } from './types.ts'
import type { EvidenceReference, GateResult, PhaseRun, ProjectSnapshot, PublicGateResult, PublicProjectSnapshot, RunFailureCode } from './types.ts'

const exec = promisify(execFile)
const SAFE_ATTEMPT_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/
const SAFE_NONCE = /^[a-f0-9]{64}$/i
const DEFAULT_RECEIPT_TIMEOUT_MS = 1_000
const MIN_RECEIPT_TIMEOUT_MS = 25
const MAX_RECEIPT_TIMEOUT_MS = 5_000
const TRUSTED_PS_PATH = process.platform === 'darwin' || process.platform === 'linux' ? '/bin/ps' : null
const TRUSTED_PS_ENVIRONMENT = Object.freeze({ LC_ALL: 'C' })
const WRAPPER_PATH = fileURLToPath(new URL('./attempt-wrapper.mjs', import.meta.url))
const wrapperProcessTitle = (nonce: string): string => `guidelane-attempt-wrapper-${nonce}`
const sources: Record<string, readonly string[]> = {
  submitIdea: ['idea'], approveBlueprint: ['blueprint_review'], requestBlueprintChange: ['blueprint_review'], approvePlan: ['plan_review'], startBuild: ['ready_to_build'], acceptResult: ['result_review'], requestChange: ['result_review'], rollback: ['accepted'],
}
const next: Record<string, string> = {
  submitIdea: 'blueprint_review', approveBlueprint: 'plan_review', requestBlueprintChange: 'blueprint_review', approvePlan: 'ready_to_build', startBuild: 'result_review', acceptResult: 'accepted', requestChange: 'plan_review', rollback: 'result_review',
}
const lifecycle: Record<Command['type'], { from: string; stage: string; runState: ProjectSnapshot['runState']; pendingDecision: ProjectSnapshot['pendingDecision'] }> = {
  submitIdea: { from: 'G0', stage: 'G1', runState: 'waiting', pendingDecision: 'approveBlueprint' },
  approveBlueprint: { from: 'G1', stage: 'G2', runState: 'waiting', pendingDecision: 'approvePlan' },
  requestBlueprintChange: { from: 'G1', stage: 'G1', runState: 'waiting', pendingDecision: 'approveBlueprint' },
  approvePlan: { from: 'G2', stage: 'G3', runState: 'waiting', pendingDecision: 'startBuild' },
  startBuild: { from: 'G3', stage: 'G4', runState: 'running', pendingDecision: null },
  acceptResult: { from: 'G5', stage: 'G6', runState: 'successful', pendingDecision: null },
  requestChange: { from: 'G5', stage: 'G2', runState: 'waiting', pendingDecision: 'approvePlan' },
  rollback: { from: 'G6', stage: 'G5', runState: 'waiting', pendingDecision: 'acceptResult' },
}
export type Command = { type: keyof typeof sources; idea?: string }
export interface LaunchReceipt extends Record<string, unknown> { pid: number; pgid: number; startIdentity: string; nonce: string; wrapperCommand: string }
export interface LaunchIntent {
  schemaVersion: 1
  phase: string
  command: string
  commandDigest: string
  argsDigest: string
  cwd: string
  envDigest: string
  nonce: string
  intentDigest: string
}
export interface Attempt { schemaVersion: 1; projectId: string; attemptId: string; phase: string; receipt: Record<string, unknown>; intent: LaunchIntent; status: 'prepared' | 'running' | 'interrupted' | 'recovery-required'; sha256?: string }
export interface LaunchAttemptInput { phase: string; attemptId?: string; command: string; args: string[]; cwd: string; env: Record<string, string>; receiptTimeoutMs?: number }
export interface LaunchAttempt { attemptId: string; receipt: LaunchReceipt }
type SemanticEvent = { type: 'phase_update'; revision: number; message: string }
const PRODUCT_SEMANTIC_MESSAGES = new Set([
  'Durum güncellendi.',
  'Taslak hazır; onayınızı bekliyor.',
  'Plan hazır; onayınızı bekliyor.',
  'Plan hazır; devam etmek için onayınızı bekliyorum.',
  'Taslak değişikliği bekleniyor.',
  'İnşa başlatılmaya hazır.',
  'İnşa güvenle ilerliyor.',
  'Kontroller tamamlandı; sonucu inceleyin.',
  'Sonuç kabul edildi.',
  'Değişiklik planı bekleniyor.',
  'Önceki güvenli sonuca dönüldü.',
])

async function runTrustedPs(args: string[]): Promise<{ stdout: string }> {
  if (TRUSTED_PS_PATH === null) throw new Error('trusted process inspection is unavailable on this platform')
  return exec(TRUSTED_PS_PATH, args, { env: TRUSTED_PS_ENVIRONMENT })
}

export function validateCommand(value: unknown): Command {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid command schema')
  const command = value as Record<string, unknown>
  if (typeof command.type !== 'string' || !(command.type in sources)) throw new Error('unknown command')
  const allowed = command.type === 'submitIdea' ? ['type', 'idea'] : ['type']
  if (Object.keys(command).some((key) => !allowed.includes(key))) throw new Error('invalid command schema')
  if (command.type === 'submitIdea' && (typeof command.idea !== 'string' || command.idea.length === 0 || command.idea.length > 20_000)) throw new Error('invalid command schema')
  return command as Command
}

export function redactEvent(value: unknown): { type: 'phase_update'; revision: number; message: string } {
  if (!value || typeof value !== 'object') throw new Error('unknown engine event')
  const event = value as Record<string, unknown>
  if (typeof event.revision !== 'number' || !Number.isSafeInteger(event.revision) || event.revision < 0 || typeof event.message !== 'string') throw new Error('unknown engine event')
  if (!PRODUCT_SEMANTIC_MESSAGES.has(event.message)) throw new Error('unsafe engine material cannot cross the semantic redaction boundary')
  return { type: 'phase_update', revision: event.revision, message: event.message }
}

function assertSafeAttemptId(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !SAFE_ATTEMPT_ID.test(value)) throw new Error('invalid attempt identity')
}

function cloneGateList(value: GateResult[] | undefined): GateResult[] | undefined {
  return value === undefined ? undefined : structuredClone(value)
}

type ResolvedLaunchInput = {
  phase: string
  attemptId?: string
  command: string
  args: string[]
  cwd: string
  env: Record<string, string>
  receiptTimeoutMs: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function assertCanonicalAbsolutePath(value: unknown, label: 'command' | 'cwd'): asserts value is string {
  if (typeof value !== 'string' || value.includes('\0') || !isAbsolute(value) || value !== resolve(value)) throw new Error(`launch ${label} must be an unambiguous absolute path`)
}

async function resolveRegularCommand(value: unknown): Promise<string> {
  assertCanonicalAbsolutePath(value, 'command')
  if ((await lstat(value)).isSymbolicLink()) throw new Error('launch command symlink ambiguity is not allowed')
  const canonical = await realpath(value)
  if (!(await stat(canonical)).isFile()) throw new Error('launch command must identify a real file')
  return canonical
}

async function resolveWorkingDirectory(value: unknown): Promise<string> {
  assertCanonicalAbsolutePath(value, 'cwd')
  if ((await lstat(value)).isSymbolicLink()) throw new Error('launch cwd symlink ambiguity is not allowed')
  const canonical = await realpath(value)
  if (!(await stat(canonical)).isDirectory()) throw new Error('launch cwd must identify a real directory')
  return canonical
}

function explicitEnvironment(value: unknown): Record<string, string> {
  return sanitizeLaunchEnvironment(value)
}

async function resolveLaunchInput(value: unknown): Promise<ResolvedLaunchInput> {
  if (!isRecord(value) || typeof value.phase !== 'string' || !value.phase || value.phase.length > 128 || !Array.isArray(value.args) || value.args.some((item) => typeof item !== 'string' || item.includes('\0'))) throw new Error('invalid launch attempt schema')
  const attemptId = value.attemptId
  if (attemptId !== undefined) assertSafeAttemptId(attemptId)
  const resolvedAttemptId: string | undefined = attemptId === undefined ? undefined : attemptId as string
  const suppliedReceiptTimeout = value.receiptTimeoutMs
  const receiptTimeoutMs = suppliedReceiptTimeout === undefined ? DEFAULT_RECEIPT_TIMEOUT_MS : suppliedReceiptTimeout
  if (typeof receiptTimeoutMs !== 'number' || !Number.isInteger(receiptTimeoutMs) || receiptTimeoutMs < MIN_RECEIPT_TIMEOUT_MS || receiptTimeoutMs > MAX_RECEIPT_TIMEOUT_MS) throw new Error('receipt timeout must be bounded')
  return {
    phase: value.phase,
    ...(resolvedAttemptId === undefined ? {} : { attemptId: resolvedAttemptId }),
    command: await resolveRegularCommand(value.command),
    args: [...value.args] as string[],
    cwd: await resolveWorkingDirectory(value.cwd),
    env: explicitEnvironment(value.env),
    receiptTimeoutMs,
  }
}

function launchIntent(input: ResolvedLaunchInput, nonce: string): LaunchIntent {
  const unsigned = {
    schemaVersion: 1 as const,
    phase: input.phase,
    command: input.command,
    commandDigest: digest(input.command),
    argsDigest: digest(JSON.stringify(input.args)),
    cwd: input.cwd,
    envDigest: digest(JSON.stringify(Object.entries(input.env).sort(([left], [right]) => left.localeCompare(right)))),
    nonce,
  }
  return { ...unsigned, intentDigest: digest(JSON.stringify(unsigned)) }
}

function isLaunchReceipt(value: unknown): value is LaunchReceipt {
  if (!isRecord(value)) return false
  return Number.isInteger(value.pid) && typeof value.pid === 'number' && value.pid > 0
    && Number.isInteger(value.pgid) && typeof value.pgid === 'number' && value.pgid > 0
    && value.pid === value.pgid && typeof value.startIdentity === 'string' && value.startIdentity.length > 0
    && typeof value.nonce === 'string' && SAFE_NONCE.test(value.nonce) && value.wrapperCommand === WRAPPER_PATH
}

function sendWrapperMessage(child: ChildProcess, value: Record<string, unknown>): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    if (!child.connected) { reject(new Error('attempt wrapper IPC is unavailable')); return }
    child.send(value, (error) => error ? reject(error) : resolvePromise())
  })
}

function waitForWrapperMessage(child: ChildProcess, expected: 'armed' | 'started', binding: Pick<LaunchIntent, 'nonce' | 'intentDigest'>, timeoutMs: number): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    let settled = false
    const settle = (callback: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      child.removeListener('message', onMessage)
      child.removeListener('error', onError)
      child.removeListener('exit', onExit)
      callback()
    }
    const onMessage = (message: unknown): void => {
      if (!isRecord(message)) return
      if (message.kind === expected) {
        if (message.nonce !== binding.nonce || message.intentDigest !== binding.intentDigest) settle(() => reject(new Error(`attempt wrapper ${expected} acknowledgement did not bind the prepared intent`)))
        else settle(resolvePromise)
      }
      else if (message.kind === 'error') settle(() => reject(new Error('attempt wrapper could not launch the target')))
    }
    const onError = (error: Error): void => settle(() => reject(error))
    const onExit = (): void => settle(() => reject(new Error('attempt wrapper exited before launch handshake completed')))
    const timeout = setTimeout(() => settle(() => reject(new Error('attempt wrapper handshake timed out'))), timeoutMs)
    child.on('message', onMessage)
    child.once('error', onError)
    child.once('exit', onExit)
  })
}

/** Allow-list projection for all browser-facing snapshot paths. */
export function publicSnapshot(snapshot: ProjectSnapshot): PublicProjectSnapshot {
  const gates: PublicGateResult[] = snapshot.gates.map((gate) => ({
    name: gate.name,
    status: gate.status,
    authority: gate.authority,
    verified: gate.authority === 'machine' && gate.status === 'passed' && Array.isArray(gate.evidence) && gate.evidence.length > 0,
  }))
  return {
    schemaVersion: snapshot.schemaVersion,
    projectId: snapshot.projectId,
    revision: snapshot.revision,
    stage: snapshot.stage,
    runState: snapshot.runState,
    language: snapshot.language,
    blueprintRevision: snapshot.blueprintRevision,
    gates,
    pendingDecision: snapshot.pendingDecision,
    ...(snapshot.failureCode === undefined ? {} : { failureCode: snapshot.failureCode }),
  }
}

export class Orchestrator {
  readonly #store: ArtifactStore
  readonly #lock: ProjectLock
  readonly #projectId: string
  #active: Attempt | null = null
  #activeAmbiguity = false
  #attempts = new Map<string, Attempt>()
  #events: SemanticEvent[] = []
  #listeners = new Set<(event: SemanticEvent) => void>()
  #ownedChildren = new Map<string, ChildProcess>()
  #mutation: Promise<void> = Promise.resolve()
  #closed = false
  private constructor(store: ArtifactStore, lock: ProjectLock, projectId: string) { this.#store = store; this.#lock = lock; this.#projectId = projectId }
  static async open(options: { root: string; projectId: string; gitHead?: string }): Promise<Orchestrator> {
    assertSafeProjectId(options.projectId)
    const gitHead = options.gitHead
    assertValidGitHead(gitHead)
    const immutableOptions = { ...options, gitHead }
    const lock = await ProjectLock.acquire(immutableOptions)
    try {
      const result = new Orchestrator(await ArtifactStore.open(immutableOptions), lock, immutableOptions.projectId)
      try {
        // This must happen before a persisted running record is allowed to
        // regain in-memory authority. The store only archives an exact G5
        // completion whose wrapper group is already absent.
        const archivedCompletion = await result.#store.archiveCompletedAttemptFixtureIfExact()
        if (archivedCompletion) {
          result.#active = null
          result.#attempts.delete(archivedCompletion.attemptId)
          result.#ownedChildren.delete(archivedCompletion.attemptId)
        }
        const activeCandidates: Attempt[] = []
        let recoveryReason: string | null = null
        let recoveryAttemptId: string | undefined
        const interrupted: Attempt[] = []
        for (const raw of await result.#store.attempts()) {
          const attempt = raw as Attempt
          result.#attempts.set(attempt.attemptId, attempt)
          if (attempt.status === 'prepared') {
            recoveryReason ??= 'persisted prepared attempt requires recovery before any replacement launch'
            recoveryAttemptId ??= attempt.attemptId
            continue
          }
          if (attempt.status === 'interrupted') {
            interrupted.push(attempt)
            continue
          }
          if (attempt.status === 'running' || attempt.status === 'recovery-required') {
            if (!isLaunchReceipt(attempt.receipt) || attempt.receipt.nonce !== attempt.intent.nonce) {
              recoveryReason ??= 'persisted active attempt receipt is invalid or cannot be cleaned up'
              recoveryAttemptId ??= attempt.attemptId
              continue
            }
            activeCandidates.push(attempt)
            if (attempt.status === 'recovery-required') {
              recoveryReason ??= 'persisted active attempt requires recovery cleanup'
              recoveryAttemptId ??= attempt.attemptId
            }
          }
        }
        let active: Attempt | null = null
        if (activeCandidates.length > 1) {
          // Once two individually valid active records exist, no later record
          // can regain authority in this process. Reconciliation must never
          // select or signal a member of an ambiguous durable set.
          result.#activeAmbiguity = true
          recoveryReason = 'multiple persisted attempts are active and cannot be safely cleaned up'
          recoveryAttemptId = undefined
        } else if (activeCandidates.length === 1) {
          active = activeCandidates[0]!
        }
        result.#active = active
        // A signed exact-completion history is only a prepared intent. Its
        // G5 commit may be resumed on reopen only when ArtifactStore has
        // revalidated the old G4 manifest, immutable R+1 run, gates/evidence,
        // and (if present) the exact active fixture with an absent group.
        let finalizedPreparedReconciliation = false
        if (!recoveryReason && !result.#activeAmbiguity && !result.#active) {
          // Do not auto-finalize ordinary exact-reconciliation history: its
          // explicit reconcile() path remains the recovery boundary. Only a
          // completion intent that subsequently reached the exact interrupted
          // terminal can be marker-finalized during reopen.
          finalizedPreparedReconciliation = await result.#store.finalizePreparedCompletionReconciliationMarker()
        }
        if (!recoveryReason && !result.#activeAmbiguity && !finalizedPreparedReconciliation) {
          const prepared = await result.#store.preparedCompletionRecovery()
          if (prepared) {
            if (prepared.hasActiveFixture && (!result.#active || result.#active.attemptId !== prepared.attemptId || !isDeepStrictEqual(result.#active.receipt, prepared.receipt))) {
              recoveryReason = 'prepared completion active fixture no longer matches the exact recovery authority'
              recoveryAttemptId = prepared.attemptId
            } else {
              const resumed = await result.#store.resumePreparedCompletion()
              if (resumed?.hasActiveFixture && result.#active) result.#clearCompletedActive(result.#active)
            }
          }
        }
        const persistedSnapshot = await result.snapshot()
        if (persistedSnapshot.stage === 'G4' && persistedSnapshot.runState === 'running' && interrupted.length > 0) {
          recoveryReason ??= 'interrupted attempt has no durable terminal publication'
          recoveryAttemptId = interrupted.length === 1 ? interrupted[0]!.attemptId : undefined
        }
        if (recoveryReason) await result.#store.requireRecovery(recoveryReason, recoveryAttemptId)
        else if (!result.#activeAmbiguity && !result.#active) await result.#store.finalizeExactRecoveryMarker('exact-completion')
      } catch (error: unknown) {
        await result.#store.requireRecovery(`persisted attempt recovery required: ${error instanceof Error ? error.message : 'invalid attempt'}`)
      }
      return result
    } catch (error) {
      await lock.release()
      throw error
    }
  }
  async close(): Promise<void> {
    await this.#mutate(async () => {
      if (this.#closed) return
      this.#closed = true
      await this.#lock.release()
    })
  }
  static transitionSources(command: string): readonly string[] { return sources[command] ?? [] }
  async snapshot(): Promise<ProjectSnapshot> { return this.#store.snapshot() }
  async publicSnapshot(): Promise<PublicProjectSnapshot> { return publicSnapshot(await this.snapshot()) }
  async command(value: unknown): Promise<ProjectSnapshot> {
    const parsed = validateCommand(value)
    let command: Command
    if (parsed.type === 'submitIdea') {
      if (parsed.idea === undefined) throw new Error('invalid command schema')
      command = { type: 'submitIdea', idea: parsed.idea }
    } else {
      command = { type: parsed.type }
    }
    return this.#mutate(async () => {
      this.#assertOpen()
      const before = await this.snapshot()
      this.#assertSafe(before)
      if (command.type === 'startBuild' && before.stage === 'G4' && (before.runState === 'stopped' || before.runState === 'interrupted') && before.pendingDecision === 'startBuild') {
        if (this.#active) throw new Error('startBuild retry requires the active attempt to be fully reaped')
        const { failureCode: _failureCode, ...withoutFailure } = before
        const after: ProjectSnapshot = { ...withoutFailure, revision: before.revision + 1, stage: 'G4', runState: 'running', pendingDecision: null }
        await this.#publish(after, `command-${after.revision}`, 'command')
        this.#emit(after.revision, 'Durum güncellendi.')
        return after
      }
      if (this.#active) throw new Error('an active attempt must be reaped or recovered before another state transition')
      const rule = lifecycle[command.type]!
      // Legacy manifests retain their original stage labels only for a controlled
      // migration read; newly published state is exclusively canonical G0–G6.
      if (before.stage !== rule.from && !sources[command.type]!.includes(before.stage)) throw new Error('transition is not allowed from the current stage')
      const evidence = command.type === 'acceptResult' ? this.#acceptedEvidence(before) : []
      const after: ProjectSnapshot = { ...before, revision: before.revision + 1, stage: before.stage === rule.from ? rule.stage : next[command.type]!, runState: before.stage === rule.from ? rule.runState : 'waiting', pendingDecision: before.stage === rule.from ? rule.pendingDecision : (command.type === 'submitIdea' ? null : before.pendingDecision) }
      await this.#publish(after, `command-${after.revision}`, 'command', evidence)
      this.#emit(after.revision, 'Durum güncellendi.')
      return after
    })
  }
  subscribe(listener: (event: SemanticEvent) => void): () => void { this.#listeners.add(listener); return () => this.#listeners.delete(listener) }
  /** Trusted supervisor-only phase publication; browser commands cannot call it. */
  async advancePhase(input: { stage: 'G5'; runState: 'waiting' | 'recovery-required'; pendingDecision: 'acceptResult' | null; gates?: GateResult[] }): Promise<ProjectSnapshot> {
    const requested = { stage: input.stage, runState: input.runState, pendingDecision: input.pendingDecision, gates: cloneGateList(input.gates) }
    return this.#mutate(async () => {
      this.#assertOpen()
      const before = await this.snapshot()
      this.#assertSafe(before)
      if (before.stage !== 'G4') throw new Error('transition is not allowed from the current stage')
      if (requested.runState === 'waiting' && this.#active) throw new Error('G5 publication requires the active attempt to be terminalized and reaped')
      if (requested.runState === 'recovery-required' && requested.pendingDecision !== null) throw new Error('running or recovery state cannot retain a pending decision')
      if (requested.runState === 'waiting' && requested.pendingDecision !== 'acceptResult') throw new Error('G5 waiting state requires acceptResult eligibility')
      const gates = requested.gates ?? structuredClone(before.gates)
      const evidence = requested.runState === 'waiting' ? this.#acceptedEvidence({ ...before, gates, runState: requested.runState, pendingDecision: requested.pendingDecision }) : this.#machineGateEvidence(gates)
      const after: ProjectSnapshot = {
        ...before,
        revision: before.revision + 1,
        stage: requested.stage,
        runState: requested.runState,
        pendingDecision: requested.pendingDecision,
        gates,
        ...(requested.runState === 'recovery-required' ? { recoveryReason: 'trusted phase publication requires recovery' } : {}),
      }
      await this.#publish(after, `advance-${after.revision}`, 'build', evidence)
      this.#emit(after.revision, 'Durum güncellendi.')
      return after
    })
  }
  /** Trusted supervisor-only failure publication for the exact active G4 attempt. */
  async publishAttemptFailure(input: { attemptId: string; failureCode: RunFailureCode }): Promise<ProjectSnapshot> {
    const attemptId = input && typeof input === 'object' ? (input as { attemptId?: unknown }).attemptId : undefined
    const failureCode = input && typeof input === 'object' ? (input as { failureCode?: unknown }).failureCode : undefined
    assertSafeAttemptId(attemptId)
    if (typeof failureCode !== 'string' || !RUN_FAILURE_CODES.includes(failureCode as RunFailureCode)) throw new Error('invalid run failure code')
    const state = RUN_FAILURE_STATES[failureCode as RunFailureCode]
    return this.#mutate(async () => {
      this.#assertOpen()
      const before = await this.snapshot()
      if (before.stage !== 'G4' || before.runState !== 'running' || before.pendingDecision !== null || !this.#active || this.#active.attemptId !== attemptId) throw new Error('failure publication requires the exact active G4 running attempt')
      const active = this.#active
      await this.#beginTerminalRecovery(active, 'active attempt terminal failure publication is pending exact reconciliation')
      if (await this.#stopActive(active) !== 'absent') return this.snapshot()
      const after: ProjectSnapshot = {
        ...before,
        revision: before.revision + 1,
        runState: state,
        pendingDecision: state === 'stopped' || state === 'interrupted' ? 'startBuild' : null,
        failureCode: failureCode as RunFailureCode,
        ...(state === 'recovery-required' ? { recoveryReason: `attempt failure requires recovery: ${failureCode}` } : {}),
      }
      try {
        await this.#publishRecoveryResolution(after, active, 'failure', failureCode as RunFailureCode)
      } catch (error: unknown) {
        await this.#recoverActive(active, `terminal failure publication failed after the exact attempt stop: ${error instanceof Error ? error.message : 'unknown error'}`).catch(() => undefined)
        throw error
      }
      this.#emit(after.revision, 'Durum güncellendi.')
      return after
    })
  }
  /** Trusted supervisor-only success terminalizer for the exact live G4 attempt. */
  async completeAttempt(input: { attemptId: string }): Promise<ProjectSnapshot> {
    const requestedAttemptId = isRecord(input) && Object.keys(input).length === 1 ? input.attemptId : undefined
    return this.#mutate(async () => {
      this.#assertOpen()
      const before = await this.snapshot()
      this.#assertSafe(before)
      const active = this.#active
      if (typeof requestedAttemptId !== 'string' || !SAFE_ATTEMPT_ID.test(requestedAttemptId)) return this.#failCompletion(active, 'completeAttempt requires one valid exact active attempt identity')
      if (this.#activeAmbiguity || !active || active.attemptId !== requestedAttemptId || before.stage !== 'G4' || before.runState !== 'running' || before.pendingDecision !== null) return this.#failCompletion(active, 'completeAttempt requires the exact active G4 running attempt')

      let evidence: EvidenceReference[]
      try {
        evidence = this.#acceptedEvidence({ ...before, stage: 'G5', runState: 'waiting', pendingDecision: 'acceptResult' })
        await this.#store.verifyEvidenceReferences(evidence)
        await this.#assertExactCompletionAuthority(active)
      } catch (error: unknown) {
        return this.#failCompletion(active, `completeAttempt requires durable required machine evidence and one exact authority: ${error instanceof Error ? error.message : 'invalid completion authority'}`)
      }

      await this.#beginTerminalRecovery(active, 'active attempt successful terminal publication is pending exact completion')
      if (await this.#stopActive(active, 'completed') !== 'absent') throw new Error('completeAttempt could not reap the exact wrapper-bound group; recovery is required')

      const after: ProjectSnapshot = {
        ...before,
        revision: before.revision + 1,
        stage: 'G5',
        runState: 'waiting',
        pendingDecision: 'acceptResult',
      }
      const run: PhaseRun = {
        schemaVersion: 1,
        projectId: this.#projectId,
        phase: active.phase,
        attemptId: active.attemptId,
        previousRevision: before.revision,
        createdAt: new Date().toISOString(),
        status: 'completed',
        inputDigests: {},
        receipt: structuredClone(active.receipt),
        evidence: structuredClone(evidence),
        gitSnapshot: this.#store.gitSnapshot(),
      }
      try {
        await this.#store.completeAttemptExact({
          snapshot: after,
          run,
          artifacts: {},
          attemptId: active.attemptId,
          receipt: structuredClone(active.receipt),
          onAttemptArchived: () => this.#clearCompletedActive(active),
        })
      } catch (error: unknown) {
        await this.#recoverActive(active, `successful terminal publication failed after the exact attempt stop: ${error instanceof Error ? error.message : 'unknown error'}`).catch(() => undefined)
        throw error
      }
      this.#emit(after.revision, 'Kontroller tamamlandı; sonucu inceleyin.')
      return after
    })
  }
  async recordGate(gate: GateResult & { evidence: EvidenceReference[] }): Promise<void> {
    const candidate = structuredClone(gate)
    await this.#mutate(async () => {
      this.#assertOpen()
      if (!candidate.name || (candidate.status === 'passed' && candidate.authority === 'machine' && candidate.evidence.length === 0)) throw new Error('successful machine gate requires immutable evidence and digest')
      const before = await this.snapshot()
      this.#assertSafe(before)
      const after = { ...before, revision: before.revision + 1, gates: [...before.gates, candidate] }
      await this.#publish(after, `gate-${after.revision}`, 'gate', candidate.evidence)
      this.#emit(after.revision, 'Durum güncellendi.')
    })
  }
  async eventsSince(revision: number): Promise<{ kind: 'snapshot'; snapshot: PublicProjectSnapshot } | { kind: 'events'; events: SemanticEvent[] }> {
    const snapshot = await this.snapshot()
    if (!Number.isSafeInteger(revision) || revision < 0 || revision > snapshot.revision) return { kind: 'snapshot', snapshot: publicSnapshot(snapshot) }
    const events = this.#events.filter((event) => event.revision > revision && event.revision <= snapshot.revision).sort((left, right) => left.revision - right.revision)
    if (events.length !== snapshot.revision - revision || events.some((event, index) => event.revision !== revision + index + 1)) return { kind: 'snapshot', snapshot: publicSnapshot(snapshot) }
    return { kind: 'events', events }
  }
  async beginAttempt(_input: unknown): Promise<Attempt> {
    throw new Error('production attempts require Orchestrator.launchAttempt; receipt-from-caller creation is not permitted')
  }
  /**
   * Create the only production attempt boundary. The target stays behind the
   * wrapper's IPC GO gate until a nonce-bound receipt is durable.
   */
  async launchAttempt(input: LaunchAttemptInput): Promise<LaunchAttempt> {
    const requested = await resolveLaunchInput(input)
    if (await this.#store.containsProjectPath(requested.cwd)) throw new Error('launch cwd must not be the artifact project directory or a descendant')
    return this.#mutate(async () => {
      this.#assertOpen()
      const snapshot = await this.snapshot()
      this.#assertSafe(snapshot)
      if (snapshot.stage !== 'G4' || snapshot.runState !== 'running' || snapshot.pendingDecision !== null) throw new Error('launchAttempt requires exactly G4 running state with no pending decision')
      if (this.#active) throw new Error('one active attempt is already running or requires recovery')
      const attemptId = requested.attemptId ?? `attempt-${Date.now()}-${randomBytes(16).toString('hex')}`
      assertSafeAttemptId(attemptId)
      if (this.#attempts.has(attemptId)) throw new Error('immutable attempt already exists')

      const nonce = randomBytes(32).toString('hex')
      const intent = launchIntent(requested, nonce)
      const prepared: Attempt = { schemaVersion: 1, projectId: this.#projectId, attemptId, phase: requested.phase, receipt: {}, intent, status: 'prepared' }
      let active = await this.#store.saveAttempt(prepared, attemptId)
      this.#attempts.set(attemptId, active)
      this.#active = active
      let wrapper: ChildProcess | null = null
      try {
        wrapper = spawn(process.execPath, [WRAPPER_PATH, `--guidelane-attempt-nonce=${nonce}`], {
          cwd: requested.cwd,
          env: withForcedAutoUpdater(requested.env),
          detached: true,
          stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
        })
        if (wrapper.pid === undefined) throw new Error('attempt wrapper did not expose a process identity')
        this.#ownedChildren.set(attemptId, wrapper)

        const binding = { nonce, intentDigest: intent.intentDigest }
        const armed = waitForWrapperMessage(wrapper, 'armed', binding, requested.receiptTimeoutMs)
        await sendWrapperMessage(wrapper, { kind: 'prepare', nonce, intentDigest: intent.intentDigest, ttlMs: requested.receiptTimeoutMs })
        await armed

        const receipt = await this.#wrapperReceipt(wrapper, nonce)
        active = await this.#store.saveAttempt({ ...active, receipt, status: 'running' as const }, attemptId)
        this.#attempts.set(attemptId, active)
        this.#active = active

        const started = waitForWrapperMessage(wrapper, 'started', binding, requested.receiptTimeoutMs)
        await sendWrapperMessage(wrapper, { kind: 'go', nonce, intentDigest: intent.intentDigest, phase: requested.phase, command: requested.command, args: requested.args, cwd: requested.cwd, env: requested.env })
        await started
        return { attemptId, receipt }
      } catch (error: unknown) {
        if (wrapper && !isLaunchReceipt(active.receipt)) await this.#terminateWrapper(wrapper)
        else if (this.#active?.attemptId === attemptId) await this.#stopActive(this.#active)
        const persisted = this.#attempts.get(attemptId)
        if (persisted) await this.#recoverActive(persisted, 'attempt launch handshake failed before a safely attributable execution receipt was confirmed')
        throw error
      }
    })
  }
  async attempt(id: string): Promise<Attempt> { const attempt = this.#attempts.get(id); if (!attempt) throw new Error('unknown attempt'); return structuredClone(attempt) }
  async reconcile(): Promise<{ interruptedAttemptIds: string[] }> {
    return this.#mutate(async () => {
      this.#assertOpen()
      if (this.#activeAmbiguity) return { interruptedAttemptIds: [] }
      const active = this.#active
      if (!active) { await this.#store.finalizeExactRecoveryMarker(); return { interruptedAttemptIds: [] } }
      const before = await this.snapshot()
      if (before.stage === 'G4' && before.runState === 'running') await this.#beginTerminalRecovery(active, 'active attempt terminal interruption publication is pending exact reconciliation')
      if (await this.#stopActive(active) !== 'absent') return { interruptedAttemptIds: [] }
      if (before.stage !== 'G4' || (before.runState !== 'running' && before.runState !== 'recovery-required')) throw new Error('exact reconciliation requires a G4 active attempt state')
      const { recoveryReason: _reason, failureCode: _failure, ...base } = before
      const after: ProjectSnapshot = { ...base, revision: before.revision + 1, stage: 'G4', runState: 'interrupted', pendingDecision: 'startBuild', failureCode: 'interrupted' }
      try {
        await this.#publishRecoveryResolution(after, active, 'reconcile', 'interrupted')
      } catch (error: unknown) {
        await this.#recoverActive(active, `exact reconciliation terminal publication failed: ${error instanceof Error ? error.message : 'unknown error'}`).catch(() => undefined)
        throw error
      }
      this.#emit(after.revision, 'Durum güncellendi.')
      return { interruptedAttemptIds: [active.attemptId] }
    })
  }
  async #mutate<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.#mutation
    let release!: () => void
    this.#mutation = new Promise<void>((resolve) => { release = resolve })
    await previous
    try { return await operation() } finally { release() }
  }
  #assertOpen(): void { if (this.#closed) throw new Error('orchestrator is closed') }
  #emit(revision: number, message: string): void { const event = { type: 'phase_update' as const, revision, message }; this.#events.push(event); for (const listener of this.#listeners) listener(event) }
  #assertSafe(snapshot: ProjectSnapshot): void { if (snapshot.runState === 'recovery-required') throw new Error('recovery-required: project must be recovered before work can continue') }
  async #failCompletion(active: Attempt | null, reason: string): Promise<never> {
    if (active) await this.#recoverActive(active, reason)
    else await this.#store.requireRecovery(reason)
    throw new Error(reason)
  }
  async #assertExactCompletionAuthority(active: Attempt): Promise<void> {
    const candidates = (await this.#store.attempts()).filter((value): value is Record<string, unknown> => isRecord(value) && (value.status === 'prepared' || value.status === 'running' || value.status === 'recovery-required'))
    if (candidates.length !== 1) throw new Error('multiple or missing durable active attempt fixtures prevent completion')
    const persisted = candidates[0]! as unknown as Attempt
    if (persisted.attemptId !== active.attemptId || persisted.status !== 'running' || !isDeepStrictEqual(persisted.receipt, active.receipt) || !isDeepStrictEqual(persisted.intent, active.intent)) throw new Error('durable active attempt fixture no longer matches the exact in-memory authority')
  }
  #clearCompletedActive(active: Attempt): void {
    if (this.#active?.attemptId !== active.attemptId) throw new Error('completed attempt authority changed before canonical publication')
    this.#active = null
    this.#attempts.delete(active.attemptId)
    this.#ownedChildren.delete(active.attemptId)
  }
  #machineGateEvidence(gates: readonly GateResult[]): EvidenceReference[] {
    const evidence: EvidenceReference[] = []
    for (const gate of gates) {
      if (gate.status === 'passed' && gate.authority === 'machine') {
        if (!Array.isArray(gate.evidence) || gate.evidence.length === 0) throw new Error('passed machine gate requires immutable evidence digest')
        evidence.push(...structuredClone(gate.evidence))
      }
    }
    return evidence
  }
  #acceptedEvidence(snapshot: ProjectSnapshot): EvidenceReference[] {
    if (snapshot.runState !== 'waiting' || snapshot.pendingDecision !== 'acceptResult') throw new Error('acceptResult requires a waiting G5 acceptance decision')
    if (!Array.isArray(snapshot.gates) || snapshot.gates.length !== REQUIRED_MACHINE_GATES.length) throw new Error('acceptResult requires exactly the complete required machine gate set with immutable evidence')
    const evidence: EvidenceReference[] = []
    for (const [index, name] of REQUIRED_MACHINE_GATES.entries()) {
      const gate = snapshot.gates[index]
      if (!gate || gate.name !== name || gate.status !== 'passed' || gate.authority !== 'machine') throw new Error('acceptResult requires each required machine gate exactly once and passed')
      const gateEvidence = gate.evidence
      if (!Array.isArray(gateEvidence) || gateEvidence.length === 0) throw new Error('acceptResult requires immutable evidence for every required machine gate')
      for (const reference of gateEvidence) {
        if (!reference || typeof reference.path !== 'string' || !reference.path || typeof reference.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(reference.sha256)) throw new Error('acceptResult requires valid immutable evidence references')
        evidence.push(structuredClone(reference))
      }
    }
    return evidence
  }
  async #interruptActive(active: Attempt): Promise<void> {
    active.status = 'interrupted'
    Object.assign(active, await this.#store.saveAttempt(active, active.attemptId))
    this.#attempts.set(active.attemptId, active)
    this.#active = null
    this.#ownedChildren.delete(active.attemptId)
  }
  async #recoverActive(active: Attempt, reason: string): Promise<void> {
    // Recovery retains the receipt: it is the only safe handle for a later
    // reconciliation attempt, so ambiguity must not erase it.
    active.status = 'recovery-required'
    this.#attempts.set(active.attemptId, active)
    this.#active = active
    const failures: unknown[] = []
    try { await this.#store.requireRecovery(reason, active.attemptId) } catch (error: unknown) { failures.push(error) }
    try { Object.assign(active, await this.#store.saveAttempt(active, active.attemptId)) } catch (error: unknown) { failures.push(error) }
    this.#attempts.set(active.attemptId, active)
    this.#active = active
    if (failures.length === 1) throw failures[0]
    if (failures.length > 1) throw new AggregateError(failures, 'attempt recovery could not be durably recorded')
  }
  /**
   * Establish a durable recovery record before reaping an attributed group.
   * This closes the crash window in which an interrupted attempt could otherwise
   * be paired with the old G4/running manifest.
   */
  async #beginTerminalRecovery(active: Attempt, reason: string): Promise<void> {
    try {
      await this.#store.requireRecovery(reason, active.attemptId)
    } catch (error: unknown) {
      await this.#recoverActive(active, reason).catch(() => undefined)
      throw error
    }
  }
  async #stopActive(active: Attempt, terminal: 'interrupted' | 'completed' = 'interrupted'): Promise<'absent' | 'recovery'> {
    const markAbsent = async (): Promise<'absent'> => {
      if (terminal === 'interrupted') await this.#interruptActive(active)
      return 'absent'
    }
    if (active.status === 'prepared') {
      await this.#recoverActive(active, 'prepared attempt has no durable process receipt and requires recovery')
      return 'recovery'
    }
    if (!isLaunchReceipt(active.receipt) || active.receipt.nonce !== active.intent.nonce) {
      await this.#recoverActive(active, 'attempt receipt coordinates, identity, or nonce are invalid')
      return 'recovery'
    }
    const receipt = active.receipt
    const owned = this.#ownedChildren.get(active.attemptId)
    if (await this.#processGroupIsAbsent(receipt.pgid)) {
      return markAbsent()
    }
    if (!await this.#identityMatches(receipt)) {
      // A just-exited wrapper can disappear between the group probe above and
      // identity observation. Never signal after an identity mismatch; only
      // accept its local exit if the exact recorded group is then absent.
      if (owned && await this.#ownedGroupEnded(owned, receipt.pgid)) {
        return markAbsent()
      }
      await this.#recoverActive(active, 'attempt process identity is invalid or unverifiable')
      return 'recovery'
    }
    if (!await this.#processGroupMatches(receipt)) {
      await this.#recoverActive(active, 'attempt process group is invalid or unverifiable')
      return 'recovery'
    }
    try {
      process.kill(-receipt.pgid, 'SIGKILL')
    } catch (error: unknown) {
      if (!isConfirmedAbsent(error)) {
        await this.#recoverActive(active, 'attempt process group could not be signalled with certainty')
        return 'recovery'
      }
      return markAbsent()
    }
    if (owned && owned.exitCode === null && owned.signalCode === null) await Promise.race([new Promise<void>((resolvePromise) => owned.once('exit', () => resolvePromise())), new Promise<void>((resolvePromise) => setTimeout(resolvePromise, 250))])
    if (owned && (owned.exitCode !== null || owned.signalCode !== null)) {
      return markAbsent()
    }
    const deadline = Date.now() + 2_000
    while (Date.now() < deadline) {
      if (await this.#processGroupIsAbsent(receipt.pgid)) {
        return markAbsent()
      }
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 20))
    }
    await this.#recoverActive(active, 'attempt process group could not be reaped before timeout')
    return 'recovery'
  }
  async #wrapperReceipt(wrapper: ChildProcess, nonce: string): Promise<LaunchReceipt> {
    const pid = wrapper.pid
    if (pid === undefined || !Number.isInteger(pid) || pid <= 0) throw new Error('attempt wrapper did not expose a process identity')
    const startIdentity = await this.#observedStartIdentity(pid)
    if (!startIdentity) throw new Error('attempt wrapper identity could not be verified')
    const pgid = await this.#observedProcessGroup(pid)
    if (pgid !== pid) throw new Error('attempt wrapper must be the detached process-group leader')
    if (!await this.#wrapperIdentityMatches(pid, nonce)) throw new Error('attempt wrapper command identity could not be verified')
    return { pid, pgid, startIdentity, nonce, wrapperCommand: WRAPPER_PATH }
  }
  async #terminateWrapper(wrapper: ChildProcess): Promise<void> {
    if (wrapper.exitCode !== null) return
    const exited = new Promise<void>((resolvePromise) => wrapper.once('exit', () => resolvePromise()))
    try { wrapper.kill('SIGKILL') } catch { /* it may have already exited before GO */ }
    await Promise.race([exited, new Promise<void>((resolvePromise) => setTimeout(resolvePromise, 250))])
  }
  async #identityMatches(receipt: Record<string, unknown>): Promise<boolean> {
    const expected = receipt.startIdentity
    if (expected === undefined) return false
    if (typeof expected !== 'string' || expected.length === 0 || typeof receipt.pid !== 'number') return false
    return (await this.#observedStartIdentity(receipt.pid)) === expected && await this.#wrapperIdentityMatches(receipt.pid, receipt.nonce)
  }
  async #processGroupMatches(receipt: Record<string, unknown>): Promise<boolean> {
    if (typeof receipt.pid !== 'number' || typeof receipt.pgid !== 'number') return false
    return (await this.#observedProcessGroup(receipt.pid)) === receipt.pgid
  }
  async #processGroupIsAbsent(pgid: number): Promise<boolean> {
    if (TRUSTED_PS_PATH === null) return false
    try {
      process.kill(-pgid, 0)
      // POSIX keeps a process group observable while its only member is a
      // zombie. That is no longer executable work, so reconciliation may
      // safely record interruption without sending a second signal.
      const { stdout } = await runTrustedPs(['-ax', '-o', 'pgid=,stat='])
      const members = stdout.split('\n').map((line) => line.trim().split(/\s+/, 2)).filter(([observed]) => Number(observed) === pgid)
      return members.length > 0 && members.every(([, state]) => state?.startsWith('Z'))
    } catch (error: unknown) { return isConfirmedAbsent(error) }
  }
  async #ownedGroupEnded(owned: ChildProcess, pgid: number): Promise<boolean> {
    if (owned.exitCode === null && owned.signalCode === null) {
      await new Promise<void>((resolvePromise) => {
        let settled = false
        const settle = (): void => {
          if (settled) return
          settled = true
          clearTimeout(timeout)
          owned.removeListener('exit', settle)
          owned.removeListener('close', settle)
          resolvePromise()
        }
        const timeout = setTimeout(settle, 250)
        owned.once('exit', settle)
        owned.once('close', settle)
      })
    }
    return (owned.exitCode !== null || owned.signalCode !== null) && await this.#processGroupIsAbsent(pgid)
  }
  async #observedStartIdentity(pid: number): Promise<string | null> {
    try { const { stdout } = await runTrustedPs(['-o', 'lstart=', '-p', String(pid)]); const identity = stdout.trim(); return identity || null } catch { return null }
  }
  async #observedProcessGroup(pid: number): Promise<number | null> {
    try { const { stdout } = await runTrustedPs(['-o', 'pgid=', '-p', String(pid)]); const pgid = Number(stdout.trim()); return Number.isInteger(pgid) && pgid > 0 ? pgid : null } catch { return null }
  }
  async #wrapperIdentityMatches(pid: number, nonce: unknown): Promise<boolean> {
    if (typeof nonce !== 'string' || !SAFE_NONCE.test(nonce)) return false
    try { const { stdout } = await runTrustedPs(['-o', 'command=', '-p', String(pid)]); return stdout.trim() === wrapperProcessTitle(nonce) } catch { return false }
  }
  async #publish(snapshot: ProjectSnapshot, attemptId: string, phase: string, evidence: EvidenceReference[] = [], failureCode?: RunFailureCode, receipt: Record<string, unknown> = {}): Promise<void> {
    const run: PhaseRun = { schemaVersion: 1, projectId: this.#projectId, phase, attemptId, previousRevision: snapshot.revision - 1, createdAt: new Date().toISOString(), status: failureCode === undefined ? 'completed' : 'failed', inputDigests: {}, receipt: structuredClone(receipt), evidence: structuredClone(evidence), gitSnapshot: this.#store.gitSnapshot(), ...(failureCode === undefined ? {} : { failureCode }) }
    await this.#store.publish({ snapshot, run, artifacts: {} })
  }
  async #publishRecoveryResolution(snapshot: ProjectSnapshot, active: Attempt, phase: 'failure' | 'reconcile' | 'recovery', failureCode: RunFailureCode): Promise<void> {
    const run: PhaseRun = { schemaVersion: 1, projectId: this.#projectId, phase, attemptId: active.attemptId, previousRevision: snapshot.revision - 1, createdAt: new Date().toISOString(), status: 'failed', inputDigests: {}, receipt: structuredClone(active.receipt), evidence: [], gitSnapshot: this.#store.gitSnapshot(), failureCode }
    await this.#store.resolveRecoveryExact({ snapshot, run, artifacts: {} })
  }
}

function isConfirmedAbsent(error: unknown): boolean {
  return Boolean(error) && typeof error === 'object' && (error as NodeJS.ErrnoException).code === 'ESRCH'
}
