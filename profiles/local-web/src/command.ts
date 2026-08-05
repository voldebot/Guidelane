import { spawn, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import type { ChildProcess } from 'node:child_process'
import type { CommandResult } from './types.ts'

const DEFAULT_TIMEOUT_MS = 120_000
const PROCESS_GROUP_GRACE_MS = 150
const PROCESS_GROUP_KILL_WAIT_MS = 500
const PROCESS_GROUP_ABSENCE_WAIT_MS = PROCESS_GROUP_GRACE_MS + PROCESS_GROUP_KILL_WAIT_MS + 250
const LEASE_HANDSHAKE_TIMEOUT_MS = 2_000
const RECEIPT_ACQUISITION_TIMEOUT_MS = 500
const RECEIPT_ACQUISITION_RETRY_MS = 10
const PROCESS_STATUS_PROBE_TIMEOUT_MS = 100
const PORTABLE_ENVIRONMENT_KEYS = ['PATH', 'HOME', 'LANG', 'LC_ALL', 'TMPDIR', 'TMP', 'TEMP'] as const
const PROCESS_STATUS_COMMAND = process.platform === 'win32' ? null : '/bin/ps'
const PROCESS_GROUP_COMMAND = process.platform === 'win32' ? null : '/usr/bin/pgrep'
const PARENT_TERMINATION_REAP_TIMEOUT_MS = 1_000

export interface ProcessReceipt {
  pid: number
  pgid: number
  startedAt: string
}

export interface CleanupResult {
  ownershipVerified: boolean
  childProcessesReaped: boolean
}

interface TargetTerminal {
  exitCode: number | null
  signal: string | null
}

type LeasePhase = 'spawning' | 'ready' | 'acknowledging' | 'leased' | 'failed'

interface LeaseWritable extends NodeJS.WritableStream {
  destroyed?: boolean
  writableEnded?: boolean
  destroy: () => void
}

interface LeaseControl extends NodeJS.ReadableStream {
  destroy: () => void
}

interface ProcessReceiptState {
  receipt: ProcessReceipt | null
  receiptReady: Promise<ProcessReceipt | null>
  leaseReady: Promise<boolean>
  resolveLeaseReady: (ready: boolean) => void
  leaseSettled: boolean
  phase: LeasePhase
  nonce: string
  lease: LeaseWritable | null
  control: LeaseControl | null
  controlBuffer: string
  terminal: TargetTerminal | null
  protocolTimer: ReturnType<typeof setTimeout> | undefined
  closeObserved: boolean
  stopRequested: boolean
}

const processReceipts = new WeakMap<ChildProcess, ProcessReceiptState>()
const activeLeaseChildren = new Set<ChildProcess>()
let parentTerminationHandler: ((signal: NodeJS.Signals) => void) | undefined
let parentTerminationInProgress = false

function buildChildEnvironment(environment: Record<string, string>): Record<string, string> {
  const childEnvironment: Record<string, string> = {}
  for (const key of PORTABLE_ENVIRONMENT_KEYS) {
    const value = process.env[key]
    if (value !== undefined) childEnvironment[key] = value
  }
  childEnvironment.CI = '1'
  childEnvironment.NEXT_TELEMETRY_DISABLED = '1'
  return { ...childEnvironment, ...environment }
}

function hasExited(child: ChildProcess): boolean {
  return typeof child.exitCode === 'number' || (child.signalCode !== null && child.signalCode !== undefined)
}

function wait(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs))
}

function observeProcess(pid: number): ProcessReceipt | null {
  if (!PROCESS_STATUS_COMMAND) return null
  const observation = spawnSync(PROCESS_STATUS_COMMAND, ['-o', 'pid=', '-o', 'pgid=', '-o', 'lstart=', '-p', String(pid)], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: PROCESS_STATUS_PROBE_TIMEOUT_MS,
  })
  if (observation.status !== 0) return null
  const match = /^\s*(\d+)\s+(\d+)\s+(.+?)\s*$/.exec(observation.stdout)
  if (!match) return null
  const observedPid = Number(match[1])
  const pgid = Number(match[2])
  const startedAt = match[3]?.trim()
  if (!Number.isSafeInteger(observedPid) || !Number.isSafeInteger(pgid) || !startedAt) return null
  return { pid: observedPid, pgid, startedAt }
}

function createReceiptState(nonce: string, lease: LeaseWritable | null, control: LeaseControl | null): ProcessReceiptState {
  let resolveLeaseReady!: (ready: boolean) => void
  return {
    receipt: null,
    receiptReady: Promise.resolve(null),
    leaseReady: new Promise<boolean>((resolve) => { resolveLeaseReady = resolve }),
    resolveLeaseReady,
    leaseSettled: false,
    phase: 'spawning',
    nonce,
    lease,
    control,
    controlBuffer: '',
    terminal: null,
    protocolTimer: undefined,
    closeObserved: false,
    stopRequested: false,
  }
}

function settleLease(state: ProcessReceiptState, ready: boolean): void {
  if (state.leaseSettled) return
  state.leaseSettled = true
  if (state.protocolTimer !== undefined) clearTimeout(state.protocolTimer)
  state.resolveLeaseReady(ready)
}

function closeLease(state: ProcessReceiptState): void {
  const lease = state.lease
  state.lease = null
  if (!lease || lease.destroyed || lease.writableEnded) return
  try {
    lease.end()
  } catch {
    try { lease.destroy() } catch { /* the supervisor will observe control loss if it remains live */ }
  }
}

function removeParentTerminationLeaseGuard(): void {
  if (!parentTerminationHandler || activeLeaseChildren.size > 0 || parentTerminationInProgress) return
  process.removeListener('SIGTERM', parentTerminationHandler)
  process.removeListener('SIGINT', parentTerminationHandler)
  parentTerminationHandler = undefined
}

async function relinquishLeasesBeforeParentTermination(signal: NodeJS.Signals): Promise<void> {
  const states = [...activeLeaseChildren]
    .map((child) => processReceipts.get(child))
    .filter((state): state is ProcessReceiptState => state !== undefined)
  for (const state of states) closeLease(state)
  await Promise.all(states.map(async (state) => {
    const receipt = state.receipt ?? await state.receiptReady
    if (receipt) await waitForGroupAbsence(receipt.pgid, PARENT_TERMINATION_REAP_TIMEOUT_MS)
  }))
  process.exit(signal === 'SIGTERM' ? 143 : 130)
}

function installParentTerminationLeaseGuard(): void {
  if (parentTerminationHandler) return
  parentTerminationHandler = (signal) => {
    if (parentTerminationInProgress) return
    parentTerminationInProgress = true
    void relinquishLeasesBeforeParentTermination(signal)
  }
  process.on('SIGTERM', parentTerminationHandler)
  process.on('SIGINT', parentTerminationHandler)
}

function failLease(state: ProcessReceiptState): void {
  if (state.phase !== 'failed') state.phase = 'failed'
  settleLease(state, false)
  closeLease(state)
  try { state.control?.destroy() } catch { /* EOF on the lease remains the authoritative failure path */ }
  state.control = null
}

function recordProcessReceipt(child: ChildProcess, state: ProcessReceiptState): void {
  let resolveReceipt!: (receipt: ProcessReceipt | null) => void
  state.receiptReady = new Promise<ProcessReceipt | null>((resolve) => { resolveReceipt = resolve })

  let settled = false
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  let acquisitionTimer: ReturnType<typeof setTimeout> | undefined
  const settle = (receipt: ProcessReceipt | null): void => {
    if (settled) return
    settled = true
    if (retryTimer !== undefined) clearTimeout(retryTimer)
    if (acquisitionTimer !== undefined) clearTimeout(acquisitionTimer)
    child.removeListener('spawn', onSpawn)
    child.removeListener('close', onClose)
    child.removeListener('error', onError)
    state.receipt = receipt
    resolveReceipt(receipt)
  }
  const onClose = (): void => settle(null)
  const onError = (): void => settle(null)
  const onSpawn = (): void => {
    const pid = child.pid
    if (pid === undefined) {
      settle(null)
      return
    }
    const deadline = Date.now() + RECEIPT_ACQUISITION_TIMEOUT_MS
    const acquire = (): void => {
      if (hasExited(child)) {
        settle(null)
        return
      }
      const receipt = observeProcess(pid)
      if (receipt?.pid === pid && receipt.pgid === pid) {
        settle(receipt)
        return
      }
      if (Date.now() >= deadline) {
        settle(null)
        return
      }
      retryTimer = setTimeout(acquire, RECEIPT_ACQUISITION_RETRY_MS)
    }
    acquire()
  }
  child.once('spawn', onSpawn)
  child.once('close', onClose)
  child.once('error', onError)
  acquisitionTimer = setTimeout(() => settle(null), RECEIPT_ACQUISITION_TIMEOUT_MS)
  if (child.pid !== undefined) onSpawn()
}

function ownsDetachedGroup(child: ChildProcess, state: ProcessReceiptState): ProcessReceipt | null {
  const receipt = state.receipt
  if (!receipt || hasExited(child) || child.pid !== receipt.pid || receipt.pgid !== receipt.pid) return null
  const current = observeProcess(receipt.pid)
  if (!current || current.pid !== receipt.pid || current.pgid !== receipt.pgid || current.startedAt !== receipt.startedAt) return null
  return receipt
}

function groupIsAbsent(pgid: number): boolean {
  if (!PROCESS_GROUP_COMMAND) return false
  const observation = spawnSync(PROCESS_GROUP_COMMAND, ['-g', String(pgid)], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: PROCESS_STATUS_PROBE_TIMEOUT_MS,
  })
  return observation.status === 1
}

async function waitForGroupAbsence(pgid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  do {
    if (groupIsAbsent(pgid)) return true
    if (Date.now() >= deadline) break
    await wait(Math.min(25, Math.max(1, deadline - Date.now())))
  } while (true)
  return false
}

/**
 * Wait for a close notification without depending on it being observable.
 *
 * A ChildProcess can close after the caller's first terminal-state check and
 * before its listener is attached. Recheck after registration, then retain the
 * timer until this awaitable settles so a cleanup operation cannot leave a
 * dangling promise when a close races listener installation.
 */
function waitForChildClose(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (hasExited(child)) return Promise.resolve(true)
  return new Promise((resolve) => {
    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const onClose = (): void => settle(true)
    const settle = (closed: boolean): void => {
      if (settled) return
      settled = true
      if (timer !== undefined) clearTimeout(timer)
      child.removeListener('close', onClose)
      resolve(closed)
    }
    child.once('close', onClose)
    if (hasExited(child)) {
      settle(true)
      return
    }
    timer = setTimeout(() => settle(false), timeoutMs)
  })
}

function drainOutput(child: ChildProcess): void {
  child.stdout?.resume()
  child.stderr?.resume()
}

function releaseChildHandle(child: ChildProcess, state?: ProcessReceiptState): void {
  // A parent never has process-group signal authority.  Releasing its private
  // lease makes a still-live supervisor observe EOF and perform its own cleanup.
  if (state) closeLease(state)
  child.stdout?.destroy()
  child.stderr?.destroy()
  try { state?.control?.destroy() } catch { /* closing the lease is sufficient */ }
  child.unref?.()
}

function parseTerminal(exitValue: string, signalValue: string): TargetTerminal | null {
  const exitCode = exitValue === '-' ? null : Number(exitValue)
  if (exitCode !== null && (!Number.isSafeInteger(exitCode) || exitCode < 0)) return null
  const signal = signalValue === '-' ? null : signalValue
  if (signal !== null && !/^SIG[A-Z0-9]+$/.test(signal)) return null
  if (exitCode === null && signal === null) return null
  return { exitCode, signal }
}

async function acknowledgeReady(child: ChildProcess, state: ProcessReceiptState): Promise<void> {
  const receipt = await state.receiptReady
  if (state.phase !== 'ready' || !receipt || !ownsDetachedGroup(child, state)) {
    failLease(state)
    return
  }
  const lease = state.lease
  if (!lease || lease.destroyed || lease.writableEnded) {
    failLease(state)
    return
  }
  state.phase = 'acknowledging'
  try {
    lease.write(`ACK ${state.nonce}\n`, (error) => {
      if (error) failLease(state)
    })
  } catch {
    failLease(state)
  }
}

function consumeControlMessage(child: ChildProcess, state: ProcessReceiptState, line: string): void {
  const fields = line.split(' ')
  if (fields.some((field) => field.length === 0)) {
    failLease(state)
    return
  }
  const [kind, nonce, first, second] = fields
  if (nonce !== state.nonce) {
    failLease(state)
    return
  }
  if (kind === 'READY' && fields.length === 2 && state.phase === 'spawning') {
    state.phase = 'ready'
    void acknowledgeReady(child, state)
    return
  }
  if (kind === 'LEASED' && fields.length === 2 && state.phase === 'acknowledging') {
    if (!ownsDetachedGroup(child, state)) {
      failLease(state)
      return
    }
    state.phase = 'leased'
    settleLease(state, true)
    return
  }
  if (kind === 'RESULT' && fields.length === 4 && state.phase === 'leased' && first !== undefined && second !== undefined) {
    const terminal = parseTerminal(first, second)
    if (!terminal || state.terminal) {
      failLease(state)
      return
    }
    state.terminal = terminal
    return
  }
  failLease(state)
}

function attachLeaseProtocol(child: ChildProcess, state: ProcessReceiptState): void {
  const control = state.control
  if (!control || !state.lease) {
    failLease(state)
    return
  }
  state.protocolTimer = setTimeout(() => failLease(state), LEASE_HANDSHAKE_TIMEOUT_MS)
  control.setEncoding('utf8')
  control.on('data', (chunk: string) => {
    if (state.phase === 'failed') return
    state.controlBuffer += chunk
    if (state.controlBuffer.length > 1_024) {
      failLease(state)
      return
    }
    let newline = state.controlBuffer.indexOf('\n')
    while (newline >= 0) {
      const line = state.controlBuffer.slice(0, newline)
      state.controlBuffer = state.controlBuffer.slice(newline + 1)
      if (line.endsWith('\r') || !line) {
        failLease(state)
        return
      }
      consumeControlMessage(child, state, line)
      if (state.lease === null) return
      newline = state.controlBuffer.indexOf('\n')
    }
  })
  control.once('error', () => failLease(state))
  control.once('end', () => {
    if (!hasExited(child)) failLease(state)
  })
  state.lease.once('error', () => failLease(state))
}

function startLeaseSupervisedCommand(
  cwd: string,
  command: string,
  args: string[],
  environment: Record<string, string>,
  mode: 'finite' | 'persistent',
): ChildProcess {
  const supervisor = fileURLToPath(new URL('./server-supervisor.mjs', import.meta.url))
  const nonce = randomBytes(32).toString('hex')
  const child = spawn(process.execPath, [supervisor, nonce, command, JSON.stringify(args), cwd, mode], {
    cwd,
    detached: true,
    stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
    env: buildChildEnvironment(environment),
  })
  const state = createReceiptState(nonce, child.stdin as LeaseWritable | null, child.stdio[3] as LeaseControl | null)
  processReceipts.set(child, state)
  activeLeaseChildren.add(child)
  installParentTerminationLeaseGuard()
  child.once('close', () => {
    state.closeObserved = true
    if (state.phase !== 'leased') settleLease(state, false)
    if (state.protocolTimer !== undefined) clearTimeout(state.protocolTimer)
    activeLeaseChildren.delete(child)
    removeParentTerminationLeaseGuard()
  })
  child.once('error', () => failLease(state))
  recordProcessReceipt(child, state)
  attachLeaseProtocol(child, state)
  drainOutput(child)
  return child
}

function requestAuthenticatedStop(child: ChildProcess, state: ProcessReceiptState): void {
  if (hasExited(child)) {
    closeLease(state)
    return
  }
  const lease = state.lease
  if (state.phase !== 'leased' || !lease || lease.destroyed || lease.writableEnded) {
    failLease(state)
    return
  }
  state.stopRequested = true
  try {
    lease.write(`STOP ${state.nonce}\n`, (error) => {
      if (error) failLease(state)
    })
    // EOF is intentionally retained as an independent fail-closed cleanup
    // route if the STOP frame races a control failure.
    closeLease(state)
  } catch {
    failLease(state)
  }
}

async function waitForLease(state: ProcessReceiptState): Promise<boolean> {
  return state.leaseReady
}

async function reapObservation(state: ProcessReceiptState, timeoutMs: number): Promise<boolean> {
  const receipt = state.receipt ?? await state.receiptReady
  if (!receipt) return false
  return waitForGroupAbsence(receipt.pgid, timeoutMs)
}

/**
 * Return diagnostic process coordinates only while the original lease
 * supervisor is both live and currently proven to lead its own detached group.
 * Receipt data never gives a parent signal authority.
 */
export async function verifiedProcessReceipt(child: ChildProcess): Promise<ProcessReceipt | null> {
  const state = processReceipts.get(child)
  if (!state || !(await waitForLease(state)) || hasExited(child)) return null
  return ownsDetachedGroup(child, state)
}

export async function runCommand(
  cwd: string,
  command: string,
  args: string[],
  environment: Record<string, string> = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<CommandResult> {
  const started = Date.now()
  const child = startCommand(cwd, command, args, environment)
  const waitResult = await waitForExit(child, timeoutMs)
  const cleanup = await stopCommand(child, PROCESS_GROUP_ABSENCE_WAIT_MS)
  const terminal = processReceipts.get(child)?.terminal
  return {
    command,
    args,
    exitCode: terminal?.exitCode ?? waitResult.exitCode,
    signal: terminal?.signal ?? child.signalCode,
    timedOut: waitResult.timedOut || !cleanup.childProcessesReaped,
    durationMs: Date.now() - started,
    childProcessesReaped: cleanup.childProcessesReaped,
  }
}

/** Start a finite command beneath its own detached lease supervisor. */
export function startCommand(cwd: string, command: string, args: string[], environment: Record<string, string> = {}): ChildProcess {
  return startLeaseSupervisedCommand(cwd, command, args, environment, 'finite')
}

/**
 * Compatibility name for finite supervised starts.  It deliberately no longer
 * keeps a durable leader alive after a finite target exits: descendants must be
 * reaped before the returned ChildProcess can close.
 */
export function startSupervisedCommand(cwd: string, command: string, args: string[], environment: Record<string, string> = {}): ChildProcess {
  return startCommand(cwd, command, args, environment)
}

/**
 * Internal harness path for a server launcher that can hand a long-lived
 * descendant to later browser gates.  It still uses one lease supervisor; only
 * a clean launcher exit with a remaining group peer is retained as persistent.
 */
export function startPersistentCommand(cwd: string, command: string, args: string[], environment: Record<string, string> = {}): ChildProcess {
  return startLeaseSupervisedCommand(cwd, command, args, environment, 'persistent')
}

export async function waitForExit(child: ChildProcess, timeoutMs: number): Promise<{ exitCode: number | null; timedOut: boolean }> {
  const state = processReceipts.get(child)
  const closedBeforeTimeout = await waitForChildClose(child, timeoutMs)
  if (!closedBeforeTimeout && state) {
    const leased = await waitForLease(state)
    if (leased) requestAuthenticatedStop(child, state)
    else failLease(state)
    await waitForChildClose(child, PROCESS_GROUP_ABSENCE_WAIT_MS)
  }
  if (state) await reapObservation(state, PROCESS_GROUP_ABSENCE_WAIT_MS)
  const terminal = state?.terminal
  return { exitCode: terminal?.exitCode ?? child.exitCode, timedOut: !closedBeforeTimeout }
}

export async function stopCommand(child: ChildProcess, timeoutMs = 2_000): Promise<CleanupResult> {
  const state = processReceipts.get(child)
  if (!state) {
    releaseChildHandle(child)
    return { ownershipVerified: false, childProcessesReaped: false }
  }
  const leased = await waitForLease(state)
  const receipt = state.receipt ?? await state.receiptReady
  if (!leased || !receipt) {
    failLease(state)
    const childProcessesReaped = receipt ? await waitForGroupAbsence(receipt.pgid, Math.max(timeoutMs, PROCESS_GROUP_ABSENCE_WAIT_MS)) : false
    if (!childProcessesReaped) releaseChildHandle(child, state)
    return { ownershipVerified: false, childProcessesReaped }
  }

  const ownershipVerified = ownsDetachedGroup(child, state) !== null || (state.phase === 'leased' && state.receipt !== null)
  if (!hasExited(child)) requestAuthenticatedStop(child, state)
  else closeLease(state)
  await waitForChildClose(child, Math.max(timeoutMs, PROCESS_GROUP_GRACE_MS))
  const childProcessesReaped = await waitForGroupAbsence(receipt.pgid, Math.max(timeoutMs, PROCESS_GROUP_ABSENCE_WAIT_MS))
  if (!childProcessesReaped) releaseChildHandle(child, state)
  return { ownershipVerified, childProcessesReaped }
}

export async function runNpmScript(
  cwd: string,
  script: string,
  environment: Record<string, string> = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<CommandResult> {
  return runCommand(cwd, 'npm', ['run', script], environment, timeoutMs)
}

export async function runNpmCommand(
  cwd: string,
  args: string[],
  environment: Record<string, string> = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<CommandResult> {
  return runCommand(cwd, 'npm', args, environment, timeoutMs)
}
