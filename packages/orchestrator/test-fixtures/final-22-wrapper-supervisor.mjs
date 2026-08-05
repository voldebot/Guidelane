import { spawn } from 'node:child_process'

const [wrapperPath] = process.argv.slice(2)
const nonce = 'c'.repeat(64)
const ttlMs = 5_000

if (!wrapperPath || !process.connected || typeof process.send !== 'function') process.exit(64)

const wrapper = spawn(process.execPath, [wrapperPath, `--guidelane-attempt-nonce=${nonce}`], {
  cwd: process.cwd(),
  detached: true,
  stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
})

function send(message) {
  if (process.connected && typeof process.send === 'function') process.send(message)
}

wrapper.once('error', () => process.exit(1))
wrapper.on('message', (message) => {
  if (!message || message.kind !== 'armed') return
  // This fixture deliberately never sends GO. The outer test kills this
  // supervisor only after the production wrapper has acknowledged prepare.
  send({ kind: 'armed', wrapper: { pid: wrapper.pid, pgid: wrapper.pid } })
})

wrapper.send({ kind: 'prepare', nonce, intentDigest: 'd'.repeat(64), ttlMs })
