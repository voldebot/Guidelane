import { spawn, spawnSync } from 'node:child_process'
import { createReadStream, writeSync } from 'node:fs'
import { createConnection } from 'node:net'

const TERM_GRACE_MS = 150
const HANDSHAKE_TIMEOUT_MS = 2_000
const CONNECT_RETRY_MS = 20
const CONTROL_MAX_BYTES = 1_024

const [nonce, socketPath, command, serializedArgs, cwd] = process.argv.slice(2)

function invalidLaunch() {
  process.exitCode = 64
  process.exit(64)
}

function parseArguments() {
  if (!nonce || !socketPath || !command || !serializedArgs || !cwd || !/^[a-f0-9]{64}$/.test(nonce)) return null
  if (!socketPath.startsWith('/') || socketPath.includes('\0')) return null
  try {
    const args = JSON.parse(serializedArgs)
    return Array.isArray(args) && args.every((value) => typeof value === 'string') ? args : null
  } catch {
    return null
  }
}

function observeSelf() {
  if (process.platform !== 'darwin' && process.platform !== 'linux') return null
  const observation = spawnSync('/bin/ps', ['-o', 'pid=', '-o', 'pgid=', '-o', 'lstart=', '-p', String(process.pid)], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: 100,
  })
  if (observation.status !== 0) return null
  const match = /^\s*(\d+)\s+(\d+)\s+(.+?)\s*$/.exec(observation.stdout)
  if (!match) return null
  const pid = Number(match[1])
  const pgid = Number(match[2])
  const startedAt = match[3]?.trim()
  if (!Number.isSafeInteger(pid) || !Number.isSafeInteger(pgid) || !startedAt) return null
  return { pid, pgid, startedAt }
}

function groupPeerCount() {
  const observation = spawnSync('/usr/bin/pgrep', ['-g', String(process.pid)], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: 100,
  })
  if (observation.status === 1) return 0
  if (observation.status !== 0) return null
  const peers = observation.stdout
    .split('\n')
    .map((value) => Number(value.trim()))
    .filter((pid) => Number.isSafeInteger(pid) && pid > 0 && pid !== process.pid)
  return peers.length
}

let targetArgs = parseArguments()
if (!targetArgs) invalidLaunch()

let initialReceipt = observeSelf()
const selfContainmentCapability = initialReceipt !== null
  && initialReceipt.pid === process.pid
  && initialReceipt.pgid === process.pid
if (!selfContainmentCapability) invalidLaunch()

let leaseSocket = null
let supervisorLiveness
let phase = 'connecting'
let controlBuffer = ''
let cleanupStarted = false
let cleanupExitCode = 1
let terminalSent = false
let targetStarted = false
let persistentPoll
let cleanupRetryTimer
let killTimer
let connectRetryTimer
let connectDeadlineTimer
let handshakeTimer

function writeResult(message) {
  try {
    writeSync(3, `${message}\n`)
    return true
  } catch {
    return false
  }
}

function writeLease(message) {
  const socket = leaseSocket
  if (!socket || socket.destroyed || !socket.writable) return false
  try {
    socket.write(`${message}\n`, (error) => {
      if (error) handleLeaseLoss()
    })
    return true
  } catch {
    return false
  }
}

function clearLeaseTimers() {
  if (connectRetryTimer !== undefined) clearTimeout(connectRetryTimer)
  if (connectDeadlineTimer !== undefined) clearTimeout(connectDeadlineTimer)
  if (handshakeTimer !== undefined) clearTimeout(handshakeTimer)
  connectRetryTimer = undefined
  connectDeadlineTimer = undefined
  handshakeTimer = undefined
}

function signalCurrentGroup(signal) {
  if (!selfContainmentCapability) return false
  try {
    process.kill(-process.pid, signal)
    return true
  } catch {
    return false
  }
}

function exitOnlyAfterGroupAbsenceProof() {
  if (groupPeerCount() !== 0) return false
  process.exit(cleanupExitCode)
  return true
}

function retrySelfGroupSignal(signal, afterSuccess) {
  if (cleanupRetryTimer !== undefined) return
  cleanupRetryTimer = setTimeout(() => {
    cleanupRetryTimer = undefined
    if (!cleanupStarted) return
    if (exitOnlyAfterGroupAbsenceProof()) return
    if (signalCurrentGroup(signal)) {
      afterSuccess()
      return
    }
    retrySelfGroupSignal(signal, afterSuccess)
  }, TERM_GRACE_MS)
}

function signalOrFailStop(signal, afterSuccess) {
  if (signalCurrentGroup(signal)) {
    afterSuccess()
    return
  }
  retrySelfGroupSignal(signal, afterSuccess)
}

function scheduleKill(immediateKill) {
  if (immediateKill) {
    signalOrFailStop('SIGKILL', () => {})
    return
  }
  if (killTimer !== undefined) return
  killTimer = setTimeout(() => {
    killTimer = undefined
    signalOrFailStop('SIGKILL', () => {})
  }, TERM_GRACE_MS)
}

function beginCleanup(exitCode, immediateKill = false) {
  if (cleanupStarted) return
  cleanupStarted = true
  cleanupExitCode = Number.isSafeInteger(exitCode) && exitCode >= 0 ? exitCode : 1
  clearLeaseTimers()
  if (persistentPoll !== undefined) clearInterval(persistentPoll)
  signalOrFailStop('SIGTERM', () => scheduleKill(immediateKill))
}

function abortBeforeTarget(exitCode = 1) {
  if (cleanupStarted) return
  clearLeaseTimers()
  if (leaseSocket && !leaseSocket.destroyed) {
    try { leaseSocket.destroy() } catch { /* no target exists before a valid lease */ }
  }
  writeResult(`RESULT ${nonce} ${exitCode} -`)
  process.exit(exitCode)
}

function sendTerminal(code, signal) {
  if (terminalSent) return true
  terminalSent = true
  const exitValue = Number.isSafeInteger(code) && code >= 0 ? String(code) : '-'
  const signalValue = typeof signal === 'string' && /^SIG[A-Z0-9]+$/.test(signal) ? signal : '-'
  return writeResult(`RESULT ${nonce} ${exitValue} ${signalValue}`)
}

function finishPersistentTarget(code, signal) {
  if (code !== 0 || signal !== null) {
    beginCleanup(code === 0 ? 1 : code)
    return
  }
  const inspect = () => {
    const peers = groupPeerCount()
    if (peers === null) {
      beginCleanup(1)
      return
    }
    if (peers === 0) beginCleanup(0)
  }
  inspect()
  if (!cleanupStarted) persistentPoll = setInterval(inspect, 100)
}

function startTarget() {
  let target
  try {
    target = spawn(command, targetArgs, {
      cwd,
      env: process.env,
      // fd3 is the guardian-to-supervisor result relay.  Explicitly map the
      // target's fd3 to ignore so that writer can never cross this boundary.
      stdio: ['ignore', 'ignore', 'ignore', 'ignore'],
    })
  } catch {
    sendTerminal(1, null)
    beginCleanup(1, true)
    return
  }
  // `spawn` has now created a target handle, even though its asynchronous
  // `spawn` event has not yet confirmed readiness.  From this point every
  // control failure must self-reap the guardian group rather than exit alone.
  targetStarted = true
  phase = 'launching'
  target.once('spawn', () => {
    if (cleanupStarted) return
    phase = 'leased'
    if (!writeLease(`LEASED ${nonce}`) || !writeResult(`LEASED ${nonce}`)) beginCleanup(1, true)
  })
  target.once('error', () => {
    sendTerminal(1, null)
    beginCleanup(1, true)
  })
  target.once('close', (code, signal) => {
    if (!sendTerminal(code, signal)) {
      beginCleanup(code === 0 ? 1 : (code ?? 1), true)
      return
    }
    finishPersistentTarget(code, signal)
  })
}

function malformedControl() {
  if (targetStarted) beginCleanup(64, true)
  else abortBeforeTarget(64)
}

function handleLeaseLoss() {
  if (cleanupStarted) return
  if (targetStarted) beginCleanup(1, true)
  else abortBeforeTarget(1)
}

function handleSupervisorLivenessLoss() {
  // The liveness pipe is owned by the original supervisor, not the controller.
  // Its EOF remains observable even if the controller event loop is stalled.
  handleLeaseLoss()
}

function consumeControlLine(line) {
  if (!line || line.endsWith('\r')) {
    malformedControl()
    return
  }
  const fields = line.split(' ')
  if (fields.some((field) => field.length === 0)) {
    malformedControl()
    return
  }
  const [kind, receivedNonce] = fields
  if (receivedNonce !== nonce) {
    malformedControl()
    return
  }
  if (phase === 'awaiting-ack' && kind === 'ACK' && fields.length === 2) {
    clearLeaseTimers()
    startTarget()
    return
  }
  if ((phase === 'launching' || phase === 'leased') && kind === 'STOP' && fields.length === 2) {
    beginCleanup(0)
    return
  }
  malformedControl()
}

function attachLease(socket) {
  leaseSocket = socket
  phase = 'awaiting-ack'
  socket.setEncoding('utf8')
  socket.on('data', (chunk) => {
    if (cleanupStarted) return
    controlBuffer += chunk
    if (controlBuffer.length > CONTROL_MAX_BYTES) {
      malformedControl()
      return
    }
    let newline = controlBuffer.indexOf('\n')
    while (newline >= 0) {
      const line = controlBuffer.slice(0, newline)
      controlBuffer = controlBuffer.slice(newline + 1)
      consumeControlLine(line)
      if (cleanupStarted) return
      newline = controlBuffer.indexOf('\n')
    }
  })
  socket.once('end', handleLeaseLoss)
  socket.once('close', handleLeaseLoss)
  socket.once('error', handleLeaseLoss)
  handshakeTimer = setTimeout(() => malformedControl(), HANDSHAKE_TIMEOUT_MS)
  if (!writeLease(`READY ${nonce} ${process.pid}`) || !writeResult(`READY ${nonce}`)) abortBeforeTarget(1)
}

function attemptConnection() {
  if (cleanupStarted || leaseSocket) return
  let socket
  try {
    socket = createConnection(socketPath)
  } catch {
    scheduleConnectionRetry()
    return
  }
  let connected = false
  const onInitialError = () => {
    if (connected) return
    try { socket.destroy() } catch { /* the retry owns the connection lifecycle */ }
    scheduleConnectionRetry()
  }
  socket.once('error', onInitialError)
  socket.once('connect', () => {
    connected = true
    socket.removeListener('error', onInitialError)
    if (connectDeadlineTimer !== undefined) clearTimeout(connectDeadlineTimer)
    connectDeadlineTimer = undefined
    attachLease(socket)
  })
}

function scheduleConnectionRetry() {
  if (cleanupStarted || leaseSocket || connectRetryTimer !== undefined) return
  connectRetryTimer = setTimeout(() => {
    connectRetryTimer = undefined
    attemptConnection()
  }, CONNECT_RETRY_MS)
}

process.on('SIGTERM', () => beginCleanup(1, true))
process.on('SIGINT', () => beginCleanup(1, true))

try {
  supervisorLiveness = createReadStream(null, { fd: 4, autoClose: false })
  supervisorLiveness.on('error', handleSupervisorLivenessLoss)
  supervisorLiveness.on('end', handleSupervisorLivenessLoss)
  supervisorLiveness.on('close', handleSupervisorLivenessLoss)
  supervisorLiveness.resume()
} catch {
  abortBeforeTarget(1)
}

connectDeadlineTimer = setTimeout(() => abortBeforeTarget(1), HANDSHAKE_TIMEOUT_MS)
attemptConnection()
