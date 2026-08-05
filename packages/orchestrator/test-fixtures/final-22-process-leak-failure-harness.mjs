import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'

const [fixturePath, ledgerPath, runId] = process.argv.slice(2)
if (!fixturePath || !ledgerPath || !runId) throw new Error('fixture path, durable ledger path, and run ID are required')

const supervisor = spawn(process.execPath, [fixturePath, '--supervisor', ledgerPath, runId], { stdio: 'ignore' })
if (!supervisor.pid) throw new Error('test-owned supervisor did not expose a PID')
// The outer test retains the durable ledger and is the only recovery probe.
// Releasing this harness handle lets its injected failure be observed promptly
// instead of pinning a nested node:test process indefinitely.
supervisor.unref()

const deadline = Date.now() + 1_000
while (Date.now() < deadline) {
  try {
    const ledger = JSON.parse(await readFile(ledgerPath, 'utf8'))
    if (ledger.runId === runId && ledger.engine && Array.isArray(ledger.descendants) && ledger.descendants.length === 1) break
  } catch { /* the test-owned supervisor is still writing its durable ledger */ }
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 20))
}

throw new Error('injected assertion failure must remain observable by the parent harness')
