import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { isAbsolute, resolve } from 'node:path'

const noncePattern = /^[a-f0-9]{64}$/i
const defaultTtlMs = 1_000
const minTtlMs = 25
const maxTtlMs = 5_000
const portableEnvironmentNames = new Set([
  'PATH', 'HOME', 'USER', 'LOGNAME', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL', 'LC_CTYPE', 'SHELL',
])
const markerEnvironmentNames = new Set([
  'GUIDELANE_FINAL_22_ENGINE_MARKER',
  'GUIDELANE_FINAL_22_GRANDCHILD_MARKER',
  'GUIDELANE_B1_03_ENGINE_MARKER',
  'GUIDELANE_INTENT_MARKER',
  'GUIDELANE_FINAL_27_MARKER',
])

let armed = null
let targetStarted = false
let expiry = null
const nonceArgument = process.argv.slice(2).find((argument) => argument.startsWith('--guidelane-attempt-nonce='))
const processNonce = nonceArgument?.slice('--guidelane-attempt-nonce='.length)

function send(kind, binding = {}) {
  if (process.connected && typeof process.send === 'function') process.send({ kind, ...binding })
}

function stopBeforeGo(code = 70) {
  if (!targetStarted) process.exit(code)
}

function armExpiry(ttlMs) {
  clearTimeout(expiry)
  expiry = setTimeout(() => stopBeforeGo(), ttlMs)
}

function validText(value) {
  return typeof value === 'string' && !value.includes('\0')
}

function validCanonicalAbsolutePath(value) {
  return validText(value) && isAbsolute(value) && value === resolve(value)
}

function validPhase(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 128 && !value.includes('\0')
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex')
}

function targetEnvironment(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const environment = {}
  for (const [key, item] of Object.entries(value)) {
    if ((!portableEnvironmentNames.has(key) && !markerEnvironmentNames.has(key) && key !== 'DISABLE_AUTOUPDATER') || !validText(item)) return null
    if (key === 'DISABLE_AUTOUPDATER' && item !== '1') return null
    if (key !== 'DISABLE_AUTOUPDATER') environment[key] = item
  }
  // Direct wrapper protocol tests predate the forced value in a GO payload.
  // The wrapper still guarantees that the spawned target receives it.
  environment.DISABLE_AUTOUPDATER = '1'
  return environment
}

function validTarget(message) {
  return validCanonicalAbsolutePath(message.command)
    && validCanonicalAbsolutePath(message.cwd)
    && Array.isArray(message.args) && message.args.every(validText)
    && targetEnvironment(message.env) !== null
}

function targetIntent(message, nonce) {
  const phase = message.phase === undefined ? 'build' : message.phase
  if (!validPhase(phase) || !validTarget(message)) return null
  const environment = targetEnvironment(message.env)
  if (environment === null) return null
  const unsigned = {
    schemaVersion: 1,
    phase,
    command: message.command,
    commandDigest: digest(message.command),
    argsDigest: digest(JSON.stringify(message.args)),
    cwd: message.cwd,
    envDigest: digest(JSON.stringify(Object.entries(message.env).sort(([left], [right]) => left.localeCompare(right)))),
    nonce,
  }
  return { ...unsigned, intentDigest: digest(JSON.stringify(unsigned)), environment }
}

const validWrapperNonce = Boolean(
  process.connected
  && typeof process.send === 'function'
  && processNonce
  && noncePattern.test(processNonce)
  && process.argv.slice(2).filter((argument) => argument.startsWith('--guidelane-attempt-nonce=')).length === 1,
)

if (!validWrapperNonce) stopBeforeGo()
else {
  // This is intentionally independent of the source pathname: `ps command=`
  // must have one exact, whitespace-free identity even when this module was
  // launched from a path containing spaces.
  process.title = `guidelane-attempt-wrapper-${processNonce}`
  armExpiry(defaultTtlMs)

  process.on('disconnect', () => stopBeforeGo())
  process.on('message', (message) => {
  if (!message || typeof message !== 'object' || Array.isArray(message)) return stopBeforeGo()
  if (message.kind === 'prepare') {
    if (armed !== null || typeof message.nonce !== 'string' || message.nonce !== processNonce || !noncePattern.test(message.nonce) || typeof message.intentDigest !== 'string' || !noncePattern.test(message.intentDigest) || !Number.isInteger(message.ttlMs) || message.ttlMs < minTtlMs || message.ttlMs > maxTtlMs) return stopBeforeGo()
    armed = { nonce: message.nonce, intentDigest: message.intentDigest }
    armExpiry(message.ttlMs)
    send('armed', armed)
    return
  }
  if (message.kind !== 'go' || armed === null || targetStarted || message.nonce !== armed.nonce || message.intentDigest !== armed.intentDigest) return stopBeforeGo()
  const intent = targetIntent(message, armed.nonce)
  if (!intent || intent.intentDigest !== armed.intentDigest) return stopBeforeGo()
  targetStarted = true
  clearTimeout(expiry)
  let target
  try {
    target = spawn(message.command, message.args, {
      cwd: message.cwd,
      env: intent.environment,
      detached: false,
      stdio: 'inherit',
    })
  } catch {
    send('error')
    process.exit(1)
    return
  }
  // The launch receipt is about wrapper attribution, not target longevity.
  // A target that exits immediately is reconciled through the same receipt.
  target.once('spawn', () => send('started', armed))
  target.once('error', () => {
    send('error')
    process.exit(1)
  })
  target.once('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)))
  })
}
