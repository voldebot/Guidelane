import { spawn, spawnSync } from 'node:child_process'
import { writeSync } from 'node:fs'

const TERM_GRACE_MS = 150
const HANDSHAKE_TIMEOUT_MS = 2_000
const CONTROL_MAX_BYTES = 1_024

const [nonce, command, serializedArgs, cwd, mode = 'finite'] = process.argv.slice(2)

function invalidLaunch() {
  process.exitCode = 64
  process.exit(64)
}

function parseArguments() {
  if (!nonce || !command || !serializedArgs || !cwd || !/^[a-f0-9]{64}$/.test(nonce) || !['finite', 'persistent'].includes(mode)) return null
  try {
    const args = JSON.parse(serializedArgs)
    return Array.isArray(args) && args.every((value) => typeof value === 'string') ? args : null
  } catch {
    return null
  }
}

function parseFinal46Fixture() {
  const raw = process.env.GUIDELANE_F46_TEST_SUPERVISOR_FIXTURE
  if (typeof raw !== 'string') return null
  try {
    const value = JSON.parse(raw)
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 1) return null
    return value.scenario === 'observation-outage' || value.scenario === 'signal-fails-once' ? value : null
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

const targetArgs = parseArguments()
if (!targetArgs) invalidLaunch()

const fixture = parseFinal46Fixture()
const initialReceipt = observeSelf()
const selfContainmentCapability = initialReceipt !== null
  && initialReceipt.pid === process.pid
  && initialReceipt.pgid === process.pid
if (!selfContainmentCapability) invalidLaunch()

let observationOutageArmed = false
let signalFailurePending = false
let signalRetryAcknowledged = false

function observePostProofDiagnostic() {
  if (observationOutageArmed) return null
  return observeSelf()
}

function writeControl(message) {
  try {
    writeSync(3, `${message}\n`)
    return true
  } catch {
    return false
  }
}

function armFinal46FixtureAfterLease() {
  if (fixture?.scenario === 'observation-outage') {
    observationOutageArmed = true
    return writeControl(`F46 FIXTURE ${nonce} OBSERVATION-OUTAGE ARMED`)
  }
  if (fixture?.scenario === 'signal-fails-once') {
    signalFailurePending = true
    return writeControl(`F46 FIXTURE ${nonce} SIGNAL-FAIL-ONCE ARMED`)
  }
  return true
}

function acknowledgeObservationOutageControl(control) {
  if (fixture?.scenario !== 'observation-outage' || phase !== 'leased') return true
  return writeControl(`F46 FIXTURE ${nonce} OBSERVATION-OUTAGE ${control}-ARMED`)
}

function signalCurrentGroup(signal) {
  if (!selfContainmentCapability) return false
  if (signalFailurePending) {
    signalFailurePending = false
    return false
  }
  try {
    // This is the sole Local Web negative-PGID route. The initial detached
    // self-proof remains an in-memory capability even if later diagnostics fail.
    process.kill(-process.pid, signal)
    if (fixture?.scenario === 'signal-fails-once' && !signalRetryAcknowledged) {
      signalRetryAcknowledged = true
      writeControl(`F46 FIXTURE ${nonce} SIGNAL-FAIL-ONCE RETRIED`)
    }
    return true
  } catch {
    return false
  }
}

let cleanupStarted = false
let cleanupExitCode = 1
let terminalSent = false
let persistentPoll
let retryTimer
let killTimer

function exitOnlyAfterGroupAbsenceProof() {
  if (groupPeerCount() !== 0) return false
  process.exit(cleanupExitCode)
  return true
}

function retrySelfGroupSignal(signal, afterSuccess) {
  if (retryTimer !== undefined) return
  retryTimer = setTimeout(() => {
    retryTimer = undefined
    if (!cleanupStarted) return
    // Post-proof process observation remains diagnostic. A diagnostic outage
    // cannot revoke the private capability used by the next signal attempt.
    observePostProofDiagnostic()
    if (exitOnlyAfterGroupAbsenceProof()) return
    if (signalCurrentGroup(signal)) {
      afterSuccess()
      return
    }
    retrySelfGroupSignal(signal, afterSuccess)
  }, TERM_GRACE_MS)
}

function signalOrFailStop(signal, afterSuccess) {
  observePostProofDiagnostic()
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
  if (persistentPoll !== undefined) clearInterval(persistentPoll)
  // There is deliberately no voluntary cleanup-exit timer. When a self-group
  // syscall fails, retrying continues until either absence is proven or the
  // detached supervisor successfully signals its own group.
  signalOrFailStop('SIGTERM', () => scheduleKill(immediateKill))
}

function sendTerminal(code, signal) {
  if (terminalSent) return true
  terminalSent = true
  const exitValue = Number.isSafeInteger(code) && code >= 0 ? String(code) : '-'
  const signalValue = typeof signal === 'string' && /^SIG[A-Z0-9]+$/.test(signal) ? signal : '-'
  return writeControl(`RESULT ${nonce} ${exitValue} ${signalValue}`)
}

function finishPersistentChild(code, signal) {
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
  const target = spawn(command, targetArgs, { cwd, env: process.env, stdio: 'ignore' })
  target.once('error', () => {
    if (!sendTerminal(1, null)) beginCleanup(1)
    else beginCleanup(1)
  })
  target.once('close', (code, signal) => {
    if (!sendTerminal(code, signal)) {
      beginCleanup(code === 0 ? 1 : (code ?? 1))
      return
    }
    if (mode === 'persistent') finishPersistentChild(code, signal)
    else beginCleanup(code === 0 ? 0 : (code ?? 1))
  })
}

function malformedControl() {
  beginCleanup(64)
}

let phase = 'awaiting-ack'
let controlBuffer = ''
const handshakeTimer = setTimeout(() => malformedControl(), HANDSHAKE_TIMEOUT_MS)

process.on('SIGTERM', () => beginCleanup(1))
process.on('SIGINT', () => beginCleanup(1))
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
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
      phase = 'leased'
      clearTimeout(handshakeTimer)
      startTarget()
      if (!writeControl(`LEASED ${nonce}`) || !armFinal46FixtureAfterLease()) beginCleanup(1)
    } else if (phase === 'leased' && kind === 'STOP' && fields.length === 2) {
      if (!acknowledgeObservationOutageControl('STOP')) beginCleanup(1)
      else beginCleanup(0)
    } else {
      malformedControl()
    }
    if (cleanupStarted) return
    newline = controlBuffer.indexOf('\n')
  }
})
process.stdin.once('end', () => {
  if (!acknowledgeObservationOutageControl('EOF')) beginCleanup(1, true)
  else beginCleanup(1, true)
})
process.stdin.once('error', () => {
  if (!acknowledgeObservationOutageControl('EOF')) beginCleanup(1, true)
  else beginCleanup(1, true)
})
process.stdin.resume()

if (!writeControl(`READY ${nonce}`)) invalidLaunch()
