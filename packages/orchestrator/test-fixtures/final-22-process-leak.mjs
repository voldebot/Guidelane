import { execFileSync, spawn } from 'node:child_process'
import { readFile, realpath, rename, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const [mode, ledgerPath, runId] = process.argv.slice(2)
const fixtureRealpath = await realpath(fileURLToPath(import.meta.url))

if ((mode !== '--supervisor' && mode !== '--engine') || !ledgerPath || !runId) throw new Error('mode, durable ledger path, and run ID are required')

function processInfo(pid) {
  const startIdentity = execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8' }).trim()
  const pgid = Number(execFileSync('ps', ['-o', 'pgid=', '-p', String(pid)], { encoding: 'utf8' }).trim())
  const parentPid = Number(execFileSync('ps', ['-o', 'ppid=', '-p', String(pid)], { encoding: 'utf8' }).trim())
  if (!startIdentity || !Number.isInteger(pgid) || pgid <= 0 || !Number.isInteger(parentPid) || parentPid <= 0) throw new Error('test fixture could not observe a process identity')
  return { pid, pgid, startIdentity, parentPid }
}

async function writeLedger(value) {
  const temporary = `${ledgerPath}.${process.pid}.tmp`
  await writeFile(temporary, `${JSON.stringify(value)}\n`, 'utf8')
  await rename(temporary, ledgerPath)
}

if (mode === '--supervisor') {
  const supervisor = processInfo(process.pid)
  const initial = {
    schemaVersion: 1,
    runId,
    fixtureRealpath,
    engineMarker: '--engine',
    supervisor,
    engine: null,
    descendants: [],
  }
  // The durable ledger exists before the engine is spawned.
  await writeLedger(initial)
  const engine = spawn(process.execPath, [fixtureRealpath, '--engine', ledgerPath, runId], { detached: true, stdio: 'ignore' })
  if (!engine.pid) throw new Error('test-owned engine did not expose a PID')
  const engineInfo = processInfo(engine.pid)
  // The engine group identity is durable at spawn, before it can report a descendant.
  await writeLedger({ ...initial, engine: { ...engineInfo, fixtureRealpath, argvMarker: '--engine' } })
  setInterval(() => {}, 1_000)
} else {
  const prior = JSON.parse(await readFile(ledgerPath, 'utf8'))
  if (prior.runId !== runId || prior.fixtureRealpath !== fixtureRealpath || prior.engineMarker !== '--engine') throw new Error('durable ledger identity mismatch')
  const engine = processInfo(process.pid)
  const grandchild = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1_000)'], { stdio: 'ignore' })
  if (!grandchild.pid) throw new Error('test-owned grandchild did not expose a PID')
  const descendant = { ...processInfo(grandchild.pid), kind: 'grandchild' }
  await writeLedger({
    ...prior,
    engine: { ...engine, fixtureRealpath, argvMarker: '--engine' },
    descendants: [descendant],
  })
  setInterval(() => {}, 1_000)
}
