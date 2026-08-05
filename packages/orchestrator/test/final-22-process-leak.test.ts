import assert from 'node:assert/strict'
import { type ChildProcess, execFile, spawn } from 'node:child_process'
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { test } from 'node:test'

const exec = promisify(execFile)
const fixture = resolve(process.cwd(), 'packages/orchestrator/test-fixtures/final-22-process-leak.mjs')
const failureHarness = resolve(process.cwd(), 'packages/orchestrator/test-fixtures/final-22-process-leak-failure-harness.mjs')
const PROCESS_CLOSE_TIMEOUT_MS = 2_000

type LedgerProcess = { pid: number; pgid: number; startIdentity: string; parentPid: number }
type LeakLedger = {
  schemaVersion: 1
  runId: string
  fixtureRealpath: string
  engineMarker: '--engine'
  supervisor: LedgerProcess
  engine: (LedgerProcess & { fixtureRealpath: string; argvMarker: '--engine' }) | null
  descendants: Array<LedgerProcess & { kind: 'grandchild' }>
}

type ObservedProcess = { pid: number; pgid: number; startIdentity: string; command: string }

async function observe(pid: number): Promise<ObservedProcess | null> {
  try {
    const [identity, pgid, command] = await Promise.all([
      exec('ps', ['-o', 'lstart=', '-p', String(pid)]),
      exec('ps', ['-o', 'pgid=', '-p', String(pid)]),
      exec('ps', ['-o', 'command=', '-p', String(pid)]),
    ])
    const startIdentity = identity.stdout.trim()
    const processGroup = Number(pgid.stdout.trim())
    const observedCommand = command.stdout.trim()
    if (!startIdentity || !Number.isInteger(processGroup) || processGroup <= 0 || !observedCommand) return null
    return { pid, pgid: processGroup, startIdentity, command: observedCommand }
  } catch {
    return null
  }
}

async function eventuallyAbsent(pid: number, label: string): Promise<void> {
  const deadline = Date.now() + 1_000
  while (Date.now() < deadline) {
    if (await observe(pid) === null) return
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 20))
  }
  throw new Error(`timed out waiting for ${label} to exit`)
}

async function waitForLedger(path: string, runId: string): Promise<LeakLedger> {
  const deadline = Date.now() + 1_000
  while (Date.now() < deadline) {
    try {
      const ledger = JSON.parse(await readFile(path, 'utf8')) as LeakLedger
      if (ledger.schemaVersion === 1 && ledger.runId === runId && ledger.engine !== null && ledger.descendants.length === 1) return ledger
    } catch { /* the fixture has not atomically completed its durable ledger */ }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 20))
  }
  throw new Error('timed out waiting for a complete test-owned durable process ledger')
}

function entries(ledger: LeakLedger): Array<{ label: string; value: LedgerProcess }> {
  if (ledger.engine === null) throw new Error('process ledger has no engine entry')
  return [
    { label: 'supervisor', value: ledger.supervisor },
    { label: 'engine', value: ledger.engine },
    ...ledger.descendants.map((value, index) => ({ label: `descendant-${index}`, value })),
  ]
}

async function verifyLedger(ledger: LeakLedger, allowAbsentSupervisor: boolean): Promise<{ verified: true } | { verified: false; reason: string }> {
  if (ledger.engine === null || ledger.fixtureRealpath !== await realpath(fixture) || ledger.engine.argvMarker !== '--engine' || ledger.engine.fixtureRealpath !== ledger.fixtureRealpath) return { verified: false, reason: 'ledger fixture identity is invalid' }
  if (ledger.engine.parentPid !== ledger.supervisor.pid || ledger.descendants.length !== 1 || ledger.descendants[0]!.parentPid !== ledger.engine.pid || ledger.descendants[0]!.pgid !== ledger.engine.pgid) return { verified: false, reason: 'ledger ancestry or group membership is invalid' }
  for (const { label, value } of entries(ledger)) {
    const observed = await observe(value.pid)
    if (observed === null && label === 'supervisor' && allowAbsentSupervisor) continue
    if (observed === null) return { verified: false, reason: `${label} is absent before cleanup` }
    if (observed.startIdentity !== value.startIdentity || observed.pgid !== value.pgid) return { verified: false, reason: `${label} PID identity or group changed` }
    if (label === 'supervisor' && (!observed.command.includes(ledger.fixtureRealpath) || !observed.command.includes('--supervisor'))) return { verified: false, reason: 'supervisor command is not the recorded fixture' }
    if (label === 'engine' && (!observed.command.includes(ledger.fixtureRealpath) || !observed.command.includes(ledger.engineMarker))) return { verified: false, reason: 'engine command is not the recorded fixture --engine process' }
  }
  return { verified: true }
}

async function cleanupLedger(ledger: LeakLedger, options: { allowAbsentSupervisor?: boolean } = {}): Promise<{ signalled: boolean; reason?: string }> {
  const verification = await verifyLedger(ledger, options.allowAbsentSupervisor === true)
  if (!verification.verified) return { signalled: false, reason: verification.reason }
  const engine = ledger.engine!
  // Signal only the newly detached, ledger-verified engine group. No ambient
  // process lookup or name/pattern matching participates in test cleanup.
  process.kill(-engine.pgid, 'SIGKILL')
  const supervisor = await observe(ledger.supervisor.pid)
  if (supervisor !== null) process.kill(ledger.supervisor.pid, 'SIGKILL')
  await Promise.all(entries(ledger).map(({ label, value }) => eventuallyAbsent(value.pid, `test-owned ${label}`)))
  return { signalled: true }
}

function spawnSupervisor(ledgerPath: string, runId: string): ReturnType<typeof spawn> {
  return spawn(process.execPath, [fixture, '--supervisor', ledgerPath, runId], { stdio: 'ignore' })
}

type ManagedChild = {
  child: ChildProcess
  closed: Promise<{ code: number | null; signal: NodeJS.Signals | null }>
}

function manageChild(child: ChildProcess): ManagedChild {
  const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolvePromise, reject) => {
    child.once('error', reject)
    child.once('close', (code, signal) => resolvePromise({ code, signal }))
  })
  // The caller still awaits `closed`; this handler prevents a spawn error from
  // becoming an unrelated unhandled rejection before its bounded observation.
  void closed.catch(() => undefined)
  return { child, closed }
}

async function waitForClose(managed: ManagedChild, label: string): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return await new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for ${label} ChildProcess handle to close`)), PROCESS_CLOSE_TIMEOUT_MS)
    managed.closed.then(
      (outcome) => {
        clearTimeout(timer)
        resolvePromise(outcome)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

async function assertLedgerAbsent(ledger: LeakLedger): Promise<void> {
  for (const { label, value } of entries(ledger)) {
    assert.equal(await observe(value.pid), null, `test-owned ${label} must be absent before its durable ledger directory is removed`)
  }
}

function releaseUnverifiedChild(managed: ManagedChild | undefined): void {
  // A missing or rejected ledger never authorizes a signal. Releasing the
  // Node handle still lets this test fail promptly instead of pinning the
  // test-runner indefinitely; the durable evidence is deliberately retained.
  managed?.child.unref()
}

async function reapAndClose(ledger: LeakLedger, supervisor: ManagedChild | undefined, options: { allowAbsentSupervisor?: boolean } = {}): Promise<void> {
  let cleanup: { signalled: boolean; reason?: string }
  try {
    cleanup = await cleanupLedger(ledger, options)
  } catch (error) {
    releaseUnverifiedChild(supervisor)
    throw error
  }
  if (!cleanup.signalled) releaseUnverifiedChild(supervisor)
  assert.equal(cleanup.signalled, true, cleanup.reason ?? 'durable-ledger cleanup must signal its exact verified process group')
  await assertLedgerAbsent(ledger)
  try {
    if (supervisor !== undefined) await waitForClose(supervisor, 'test-owned supervisor')
  } catch (error) {
    releaseUnverifiedChild(supervisor)
    throw error
  }
}

function ledgerPidReport(ledger: LeakLedger, phase: 'before' | 'after'): string {
  return `${phase} ledger-owned pids only: ${entries(ledger).map(({ label, value }) => `${label}=${value.pid}/pgid=${value.pgid}`).join(', ')}`
}

test('S2-FINAL-22-PROCESS-LEAK-01 durable spawn ledger reaps only its recorded engine group and descendants', {
  skip: process.platform === 'win32' ? 'POSIX ps and detached process groups are unavailable on Windows' : false,
  timeout: 8_000,
}, async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'guidelane-final-22-process-leak-'))
  const ledgerPath = join(root, 'ledger.json')
  const runId = 'process-leak-01'
  let ledger: LeakLedger | undefined
  let supervisor: ManagedChild | undefined
  let reaped = false
  try {
    supervisor = manageChild(spawnSupervisor(ledgerPath, runId))
    ledger = await waitForLedger(ledgerPath, runId)
    t.diagnostic(ledgerPidReport(ledger, 'before'))
    assert.equal(ledger.fixtureRealpath, await realpath(fixture))
    assert.equal(ledger.engineMarker, '--engine')
    assert.equal(ledger.engine!.parentPid, ledger.supervisor.pid)
    assert.equal(ledger.descendants[0]!.parentPid, ledger.engine!.pid)
    await reapAndClose(ledger, supervisor)
    reaped = true
    t.diagnostic(ledgerPidReport(ledger, 'after'))
  } finally {
    if (!reaped && ledger !== undefined) await reapAndClose(ledger, supervisor)
    if (supervisor !== undefined && ledger === undefined) {
      releaseUnverifiedChild(supervisor)
      throw new Error('refusing to remove a process-leak ledger directory before the spawned supervisor has a verified durable ledger')
    }
    await rm(root, { recursive: true, force: true })
  }
})

test('S2-FINAL-22-PROCESS-LEAK-02 injected assertion failure remains observable and the parent recovery probe reaps its durable ledger', {
  skip: process.platform === 'win32' ? 'POSIX ps and detached process groups are unavailable on Windows' : false,
  timeout: 8_000,
}, async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'guidelane-final-22-process-leak-'))
  const ledgerPath = join(root, 'ledger.json')
  const runId = 'process-leak-02'
  let ledger: LeakLedger | undefined
  let harness: ManagedChild | undefined
  let reaped = false
  try {
    harness = manageChild(spawn(process.execPath, [failureHarness, fixture, ledgerPath, runId], { stdio: 'ignore' }))
    const outcome = await waitForClose(harness, 'injected-failure harness')
    assert.notEqual(outcome.code, 0, 'the injected assertion failure must be visible to the parent harness')
    ledger = await waitForLedger(ledgerPath, runId)
    t.diagnostic(ledgerPidReport(ledger, 'before'))
    await reapAndClose(ledger, undefined)
    reaped = true
    t.diagnostic(ledgerPidReport(ledger, 'after'))
  } finally {
    if (!reaped && ledger !== undefined) await reapAndClose(ledger, undefined)
    if (harness !== undefined) await waitForClose(harness, 'injected-failure harness')
    if (harness !== undefined && ledger === undefined) {
      releaseUnverifiedChild(harness)
      throw new Error('refusing to remove a process-leak ledger directory before the injected-failure harness has a verified durable ledger')
    }
    await rm(root, { recursive: true, force: true })
  }
})

test('S2-FINAL-22-PROCESS-LEAK-04 an unverifiable or PID-reused ledger identity is never signalled', {
  skip: process.platform === 'win32' ? 'POSIX ps and detached process groups are unavailable on Windows' : false,
  timeout: 8_000,
}, async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'guidelane-final-22-process-leak-'))
  const ledgerPath = join(root, 'ledger.json')
  const runId = 'process-leak-03'
  let ledger: LeakLedger | undefined
  let supervisor: ManagedChild | undefined
  let reaped = false
  const realKill = process.kill
  try {
    supervisor = manageChild(spawnSupervisor(ledgerPath, runId))
    ledger = await waitForLedger(ledgerPath, runId)
    t.diagnostic(ledgerPidReport(ledger, 'before'))
    const forged = structuredClone(ledger)
    forged.engine!.startIdentity = 'pid-reused-or-unverifiable-identity'
    const signals: Array<{ pid: number; signal: NodeJS.Signals | number | undefined }> = []
    process.kill = ((pid: number, signal?: NodeJS.Signals | number) => {
      if (signal !== 0) signals.push({ pid, signal })
      return realKill(pid, signal!)
    }) as typeof process.kill
    const refused = await cleanupLedger(forged)
    process.kill = realKill
    assert.deepEqual(refused, { signalled: false, reason: 'engine PID identity or group changed' })
    assert.deepEqual(signals, [], 'no recorded group or PID may receive a signal after identity verification fails')
    assert.notEqual(await observe(ledger.engine!.pid), null, 'the real test-owned engine remains alive because the forged identity was not signalled')
    assert.notEqual(await observe(ledger.descendants[0]!.pid), null, 'the real test-owned descendant remains alive because the forged identity was not signalled')
  } finally {
    process.kill = realKill
    if (!reaped && ledger !== undefined) {
      await reapAndClose(ledger, supervisor)
      reaped = true
    }
    if (ledger !== undefined) t.diagnostic(ledgerPidReport(ledger, 'after'))
    if (supervisor !== undefined && ledger === undefined) {
      releaseUnverifiedChild(supervisor)
      throw new Error('refusing to remove a process-leak ledger directory before the spawned supervisor has a verified durable ledger')
    }
    await rm(root, { recursive: true, force: true })
  }
})

test('S2-FINAL-22-PROCESS-LEAK-03 a SIGKILLed test runner is recoverable only through a separate durable-ledger probe', {
  skip: process.platform === 'win32' ? 'POSIX ps and detached process groups are unavailable on Windows' : false,
  timeout: 8_000,
}, async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'guidelane-final-22-process-leak-'))
  const ledgerPath = join(root, 'ledger.json')
  const runId = 'process-leak-04'
  let ledger: LeakLedger | undefined
  let runner: ManagedChild | undefined
  let reaped = false
  try {
    runner = manageChild(spawnSupervisor(ledgerPath, runId))
    ledger = await waitForLedger(ledgerPath, runId)
    t.diagnostic(ledgerPidReport(ledger, 'before'))
    assert.equal(runner.child.pid, ledger.supervisor.pid, 'the exact SIGKILL target must be the ledger-recorded test-owned runner')
    process.kill(runner.child.pid!, 'SIGKILL')
    await eventuallyAbsent(ledger.supervisor.pid, 'test-owned killed runner')
    assert.notEqual(await observe(ledger.engine!.pid), null, 'the engine remains until the separate recovery probe verifies the durable ledger')
    assert.notEqual(await observe(ledger.descendants[0]!.pid), null, 'the descendant remains until the separate recovery probe verifies the durable ledger')
    await reapAndClose(ledger, runner, { allowAbsentSupervisor: true })
    reaped = true
    t.diagnostic(ledgerPidReport(ledger, 'after'))
  } finally {
    if (!reaped && ledger !== undefined) await reapAndClose(ledger, runner, { allowAbsentSupervisor: true })
    if (runner !== undefined && ledger === undefined) {
      releaseUnverifiedChild(runner)
      throw new Error('refusing to remove a process-leak ledger directory before the spawned runner has a verified durable ledger')
    }
    await rm(root, { recursive: true, force: true })
  }
})
