import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { createServer, type AddressInfo, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { test, type TestContext } from 'node:test'
import { startPersistentCommand, startSupervisedCommand, stopCommand, verifiedProcessReceipt, waitForExit } from '../src/command.ts'
import type { ProcessReceipt } from '../src/command.ts'
import { runNormalHarness } from '../src/harness.ts'

const profileDirectory = new URL('..', import.meta.url)
const profileDirectoryPath = await realpath(fileURLToPath(profileDirectory))
const harnessModuleUrl = new URL('../src/harness.ts', import.meta.url).href
const privateGuardianLeaseRoot = '/tmp'
const supportsPosixGroupObservation = (process.platform === 'darwin' || process.platform === 'linux')
  && spawnSync('/bin/ps', ['-o', 'pid=', '-o', 'pgid=', '-o', 'lstart=', '-p', String(process.pid)], { stdio: 'ignore' }).status === 0
  && spawnSync('/usr/bin/pgrep', ['-g', String(process.pid)], { stdio: 'ignore' }).error === undefined

interface LiveServerObservation {
  baseUrl: string
  port: number
  bootInstanceNonce: string
  receipt: ProcessReceipt
}

interface ControllerReady {
  kind: 'ready'
  controllerNonce: string
  cwd: string
  port: number
  receipt: ProcessReceipt
  bootInstanceNonce: string
}

interface NormalHarnessLeaseTestOptions {
  testLifecycleObserver: {
    port: number
    onLiveServerReady: (server: LiveServerObservation) => Promise<void>
  }
  // This is deliberately a narrow, in-memory-only fault seam.  Production
  // must inject the atomic evidence-write failure after authenticated health
  // and before the boot gate can be published or the server is transferred.
  testFaults?: {
    failBootEvidencePersistence: true
  }
}

type NormalHarnessWithLeaseTestOptions = (artifacts: string, options: NormalHarnessLeaseTestOptions) => Promise<number>

interface Final46NormalHarnessTestOptions {
  testFaults: {
    attemptAuthority: {
      currentAttempt: { attemptId: string; candidateDigest: string; resultIdentity: string }
      afterCandidate: 'force-terminal-authority-failure'
    }
  }
}

type NormalHarnessWithFinal46AttemptTestOptions = (artifacts: string, options: Final46NormalHarnessTestOptions) => Promise<number>

/**
 * Deliberately private, in-memory-only Final46 fixture protocol.  It is passed
 * only to a directly-launched supervisor in this test file.  The production
 * protocol must not accept it from profile callers or persist its raw runtime
 * values.  The implementation may choose its internal wiring, but the
 * fixture's observable control frames make the fault setup unambiguous.
 */
interface Final46FixtureConfiguration {
  scenario: 'observation-outage' | 'signal-fails-once'
}

interface Final46SupervisorFixture {
  child: ChildProcess
  nonce: string
  lease: NodeJS.WritableStream
  receipt: ProcessReceipt
  controlLines: string[]
}

type AttemptAuthorityStatus = 'pending' | 'passed' | 'failed'

interface AttemptAuthorityFixtureModule {
  createPendingAttemptAuthority: (artifacts: string, input: { attemptId: string; candidateDigest: string }) => Promise<void>
  stageAttemptCandidate: (artifacts: string, input: { attemptId: string; candidateDigest: string }) => Promise<void>
  writeTerminalAttemptResult: (artifacts: string, input: { attemptId: string; candidateDigest: string; resultIdentity: string; status: Exclude<AttemptAuthorityStatus, 'pending'> }) => Promise<void>
  finalizeAttemptAuthority: (artifacts: string, input: { attemptId: string; candidateDigest: string; resultIdentity: string; status: Exclude<AttemptAuthorityStatus, 'pending'> }) => Promise<void>
  evaluateAttemptAuthority: (artifacts: string, input: { attemptId: string; candidateDigest: string; resultIdentity: string }) => Promise<{ accepted: boolean }>
  authorityArtifactPath: (artifacts: string, attemptId: string) => string
  terminalResultArtifactPath: (artifacts: string, attemptId: string) => string
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

async function waitUntil(predicate: () => boolean | Promise<boolean>, timeoutMs: number, label: string): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await predicate()) return
    await delay(25)
  }
  if (await predicate()) return
  throw new Error(`timed out waiting for ${label}`)
}

async function selectTestOwnedLoopbackPort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen({ host: '127.0.0.1', port: 0 }, resolve)
  })
  const port = (server.address() as AddressInfo | null)?.port
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  if (!port) throw new Error('test-owned loopback port allocation failed')
  return port
}

async function canBindTestOwnedLoopbackPort(port: number): Promise<boolean> {
  const server = createServer()
  const bound = await new Promise<boolean>((resolve, reject) => {
    server.once('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE') resolve(false)
      else reject(error)
    })
    server.listen({ host: '127.0.0.1', port }, () => resolve(true))
  })
  if (bound) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  return bound
}

function receiptStillOwnsLeader(receipt: ProcessReceipt): boolean {
  const observation = spawnSync('/bin/ps', ['-o', 'pid=', '-o', 'pgid=', '-o', 'lstart=', '-p', String(receipt.pid)], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 100,
  })
  const match = /^\s*(\d+)\s+(\d+)\s+(.+?)\s*$/.exec(observation.stdout)
  return observation.status === 0
    && match !== null
    && Number(match[1]) === receipt.pid
    && Number(match[2]) === receipt.pgid
    && match[3]?.trim() === receipt.startedAt
}

function observeReceipt(pid: number): ProcessReceipt | undefined {
  const observation = spawnSync('/bin/ps', ['-o', 'pid=', '-o', 'pgid=', '-o', 'lstart=', '-p', String(pid)], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 100,
  })
  const match = /^\s*(\d+)\s+(\d+)\s+(.+?)\s*$/.exec(observation.stdout)
  if (observation.status !== 0 || !match) return undefined
  return { pid: Number(match[1]), pgid: Number(match[2]), startedAt: match[3]!.trim() }
}

function groupIsAbsent(receipt: ProcessReceipt): boolean {
  const observation = spawnSync('/usr/bin/pgrep', ['-g', String(receipt.pgid)], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 100,
  })
  if (observation.status === 1) return true
  if (observation.status === 0) return false
  throw new Error('could not inspect the test-owned process group')
}

async function waitForGroupAbsence(receipt: ProcessReceipt, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (groupIsAbsent(receipt)) return true
    await delay(25)
  }
  return groupIsAbsent(receipt)
}

async function reapVerifiedTestGroup(receipt: ProcessReceipt | undefined): Promise<void> {
  if (!receipt || groupIsAbsent(receipt) || !receiptStillOwnsLeader(receipt)) return
  try {
    process.kill(-receipt.pgid, 'SIGTERM')
  } catch {
    return
  }
  if (await waitForGroupAbsence(receipt, 1_000)) return
  // The second signal is allowed only after a fresh, exact PID/PGID/start-time
  // observation.  A stale diagnostic receipt has no cleanup authority.
  if (!receiptStillOwnsLeader(receipt)) return
  try {
    process.kill(-receipt.pgid, 'SIGKILL')
  } catch {
    return
  }
  await waitForGroupAbsence(receipt, 500)
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error: unknown) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH'
  }
}

async function hasNumericPid(path: string): Promise<boolean> {
  try {
    return Number.isSafeInteger(Number(await readFile(path, 'utf8')))
  } catch {
    return false
  }
}

async function privateGuardianLeaseDirectories(): Promise<string[]> {
  const entries = await readdir(privateGuardianLeaseRoot, { withFileTypes: true })
  return entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('guidelane-local-web-lease-'))
    .map((entry) => entry.name)
    .sort()
}

async function authenticateGeneratedServer(server: LiveServerObservation): Promise<void> {
  const response = await fetch(new URL('/api/health', server.baseUrl), { signal: AbortSignal.timeout(2_000) })
  const body = await response.json() as { ok?: unknown; service?: unknown; bootInstanceNonce?: unknown }
  assert.equal(response.ok && body.ok === true && body.service === 'local-web' && body.bootInstanceNonce === server.bootInstanceNonce, true, 'the observed generated server must authenticate its boot nonce')
}

async function waitForControllerReady(controller: ChildProcess, expectedNonce: string, expectedPort: number): Promise<ControllerReady> {
  return new Promise<ControllerReady>((resolve, reject) => {
    const timer = setTimeout(() => settle(new Error('timed out waiting for the test controller readiness IPC')), 480_000)
    const onMessage = (message: unknown): void => {
      const candidate = message as Partial<ControllerReady>
      if (candidate.kind !== 'ready') return
      if (candidate.controllerNonce !== expectedNonce || candidate.cwd !== profileDirectoryPath || candidate.port !== expectedPort) {
        settle(new Error('controller readiness identity did not match the test-owned controller'))
        return
      }
      if (!candidate.receipt || typeof candidate.bootInstanceNonce !== 'string') {
        settle(new Error('controller readiness did not include a verified generated-server observation'))
        return
      }
      settle(undefined, candidate as ControllerReady)
    }
    const onExit = (): void => settle(new Error('controller exited before reporting readiness'))
    const settle = (error?: Error, value?: ControllerReady): void => {
      clearTimeout(timer)
      controller.removeListener('message', onMessage)
      controller.removeListener('exit', onExit)
      if (error) reject(error)
      else resolve(value!)
    }
    controller.on('message', onMessage)
    controller.once('exit', onExit)
  })
}

async function waitForExactControllerExit(controller: ChildProcess): Promise<void> {
  if (controller.exitCode !== null || controller.signalCode !== null) return
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 3_000)
    controller.once('exit', () => {
      clearTimeout(timer)
      resolve()
    })
  })
}

async function waitForFixtureControl(
  fixture: Final46SupervisorFixture,
  predicate: (line: string) => boolean,
  timeoutMs: number,
  label: string,
): Promise<void> {
  await waitUntil(() => fixture.controlLines.some(predicate), timeoutMs, label)
}

async function cleanupFinal46Fixture(fixture: Final46SupervisorFixture): Promise<void> {
  try { fixture.lease.end() } catch { /* test-owned lease may already be closed */ }
  await waitForExactControllerExit(fixture.child)
  await reapVerifiedTestGroup(fixture.receipt)
  if (fixture.child.exitCode === null && fixture.child.signalCode === null && fixture.child.pid !== undefined) {
    // This exact PID belongs only to the detached supervisor this test spawned.
    try { fixture.child.kill('SIGKILL') } catch { /* supervisor raced its cleanup */ }
  }
  assert.equal(await waitForGroupAbsence(fixture.receipt, 1_000), true, 'Final46 fixture cleanup must leave no test-owned process group')
}

async function launchFinal46SupervisorFixture(
  t: TestContext,
  configuration: Final46FixtureConfiguration,
): Promise<Final46SupervisorFixture> {
  const supervisorPath = new URL('../src/server-supervisor.mjs', import.meta.url)
  const nonce = randomBytes(32).toString('hex')
  const targetProgram = 'setInterval(() => {}, 1_000)'
  const child = spawn(process.execPath, [
    supervisorPath.pathname,
    nonce,
    process.execPath,
    JSON.stringify(['-e', targetProgram]),
    profileDirectoryPath,
    'persistent',
  ], {
    cwd: profileDirectoryPath,
    detached: true,
    stdio: ['pipe', 'ignore', 'ignore', 'pipe'],
    env: {
      ...process.env,
      // The fixture is intentionally absent from ordinary product launches.
      GUIDELANE_F46_TEST_SUPERVISOR_FIXTURE: JSON.stringify(configuration),
    },
  })
  assert.notEqual(child.pid, undefined, 'the Final46 fixture must expose its exact detached supervisor PID')
  const lease = child.stdin
  const control = child.stdio[3] as NodeJS.ReadableStream | null
  assert.notEqual(lease, null, 'the Final46 fixture must retain its private lease')
  assert.notEqual(control, null, 'the Final46 fixture must retain its private control channel')

  const controlLines: string[] = []
  let controlBuffer = ''
  control!.setEncoding('utf8')
  control!.on('data', (chunk: string) => {
    controlBuffer += chunk
    let newline = controlBuffer.indexOf('\n')
    while (newline >= 0) {
      controlLines.push(controlBuffer.slice(0, newline))
      controlBuffer = controlBuffer.slice(newline + 1)
      newline = controlBuffer.indexOf('\n')
    }
  })

  let receipt: ProcessReceipt | undefined
  await waitUntil(() => {
    receipt = observeReceipt(child.pid!)
    return receipt !== undefined
  }, 1_000, 'the Final46 fixture detached-group proof')
  const fixture: Final46SupervisorFixture = { child, nonce, lease: lease!, receipt: receipt!, controlLines }
  t.after(async () => cleanupFinal46Fixture(fixture))

  await waitForFixtureControl(fixture, (line) => line === `READY ${nonce}`, 2_000, 'the Final46 supervisor readiness frame')
  lease!.write(`ACK ${nonce}\n`)
  await waitForFixtureControl(fixture, (line) => line === `LEASED ${nonce}`, 2_000, 'the Final46 supervisor lease frame')
  return fixture
}

async function loadAttemptAuthorityFixtureModule(): Promise<AttemptAuthorityFixtureModule> {
  // Final46's authority decision must be exercised through the production
  // atomic-record consumer.  A URL import intentionally keeps this test file
  // typecheckable before the new internal module exists.
  return import(new URL('../src/attempt-authority.ts', import.meta.url).href) as Promise<AttemptAuthorityFixtureModule>
}

function assertNoRawRuntimeIdentity(serialized: string, label: string): void {
  assert.equal(/"(?:pid|pgid|startedAt|port|nonce)"\s*:/i.test(serialized), false, label)
}

test('S2-F45-LEASE-EOF-01 controller-loss lease EOF reaps the authenticated generated server group and releases its loopback port', {
  skip: supportsPosixGroupObservation ? false : 'requires POSIX process-group observation',
  timeout: 510_000,
}, async () => {
  const artifacts = await mkdtemp(join(tmpdir(), 'guidelane-f45-controller-artifacts-'))
  const port = await selectTestOwnedLoopbackPort()
  const controllerNonce = randomBytes(32).toString('hex')
  const controllerProgram = `
    import { runNormalHarness } from ${JSON.stringify(harnessModuleUrl)}
    const port = Number(process.env.GUIDELANE_F45_TEST_PORT)
    const controllerNonce = process.env.GUIDELANE_F45_TEST_CONTROLLER_NONCE
    const artifacts = process.env.GUIDELANE_F45_TEST_ARTIFACTS
    await runNormalHarness(artifacts, {
      testLifecycleObserver: {
        port,
        onLiveServerReady: async (server) => {
          process.send?.({ kind: 'ready', controllerNonce, cwd: process.cwd(), port: server.port, receipt: server.receipt, bootInstanceNonce: server.bootInstanceNonce })
          await new Promise(() => {})
        },
      },
    })
  `
  const controller = spawn(process.execPath, ['--experimental-strip-types', '--input-type=module', '--eval', controllerProgram], {
    cwd: profileDirectoryPath,
    env: {
      ...process.env,
      GUIDELANE_F45_TEST_PORT: String(port),
      GUIDELANE_F45_TEST_CONTROLLER_NONCE: controllerNonce,
      GUIDELANE_F45_TEST_ARTIFACTS: artifacts,
    },
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  })
  let observed: LiveServerObservation | undefined
  try {
    const ready = await waitForControllerReady(controller, controllerNonce, port)
    observed = { baseUrl: `http://127.0.0.1:${ready.port}`, port: ready.port, bootInstanceNonce: ready.bootInstanceNonce, receipt: ready.receipt }
    await authenticateGeneratedServer(observed)
    assert.equal(receiptStillOwnsLeader(observed.receipt), true, 'the controller must report a currently verified generated-server group before it is terminated')

    // This is an exact ChildProcess PID, bound by its private nonce and cwd via
    // IPC above; no process-group signal is sent by this outer controller test.
    assert.notEqual(controller.pid, undefined, 'the test-owned controller must expose an exact PID')
    controller.kill('SIGTERM')
    await waitForExactControllerExit(controller)

    assert.equal(await canBindTestOwnedLoopbackPort(port), true, 'controller loss must release the authenticated generated server loopback port')
    assert.equal(await waitForGroupAbsence(observed.receipt, 2_000), true, 'controller lease EOF must make the supervisor reap its own generated-server group')
  } finally {
    if (controller.exitCode === null && controller.signalCode === null) {
      try { controller.kill('SIGKILL') } catch { /* controller raced its own exit */ }
    }
    await reapVerifiedTestGroup(observed?.receipt)
    await rm(artifacts, { recursive: true, force: true })
  }
})

test('S2-F45-BOOT-EVIDENCE-02 boot-evidence persistence failure reaps the generated server before return and never publishes a passed boot gate', {
  skip: supportsPosixGroupObservation ? false : 'requires POSIX process-group observation',
  timeout: 510_000,
}, async () => {
  const artifacts = await mkdtemp(join(tmpdir(), 'guidelane-f45-boot-evidence-'))
  const port = await selectTestOwnedLoopbackPort()
  let observed: LiveServerObservation | undefined
  try {
    const runWithTestFault = runNormalHarness as unknown as NormalHarnessWithLeaseTestOptions
    const result = await runWithTestFault(artifacts, {
      testLifecycleObserver: {
        port,
        onLiveServerReady: async (server) => {
          observed = server
          await authenticateGeneratedServer(server)
        },
      },
      testFaults: { failBootEvidencePersistence: true },
    })

    assert.notEqual(observed, undefined, 'the evidence-write fault must be injected only after an authenticated generated server is live')
    assert.notEqual(result, 0, 'boot evidence persistence failure must fail the normal harness')
    assert.equal(await canBindTestOwnedLoopbackPort(port), true, 'boot evidence persistence failure must reap the generated server before returning')
    assert.equal(await waitForGroupAbsence(observed!.receipt, 2_000), true, 'the generated server group must be absent before the failed harness returns')

    const summaryText = await readFile(join(artifacts, 'result.json'), 'utf8')
    const summary = JSON.parse(summaryText) as { status?: unknown; completedGates?: unknown }
    assert.equal(summary.status, 'failed', 'boot evidence persistence failure must publish only a failed harness summary')
    assert.equal(Array.isArray(summary.completedGates) && summary.completedGates.includes('boot'), false, 'a boot gate may not be completed before its evidence is durable')

    try {
      const bootEvidence = JSON.parse(await readFile(join(artifacts, 'gates', 'boot.json'), 'utf8')) as { status?: unknown }
      assert.notEqual(bootEvidence.status, 'passed', 'a failed atomic boot-evidence write must never leave a passed boot gate')
    } catch (error: unknown) {
      assert.equal((error as NodeJS.ErrnoException).code, 'ENOENT', 'boot evidence may be absent after an atomic write failure, but no other read failure is acceptable')
    }

    for (const value of [String(port), String(observed!.receipt.pid), String(observed!.receipt.pgid), observed!.bootInstanceNonce, observed!.receipt.startedAt]) {
      assert.equal(summaryText.includes(value), false, 'persisted failure evidence must not expose a raw runtime identifier')
    }
  } finally {
    await reapVerifiedTestGroup(observed?.receipt)
    await rm(artifacts, { recursive: true, force: true })
  }
})

test('S2-F45-STALE-IDENTITY-03 stale or reused diagnostic identity never authorizes parent negative-PGID signalling', {
  skip: supportsPosixGroupObservation ? false : 'requires POSIX process-group observation',
}, async () => {
  const unrelated = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1_000)'], { detached: true, stdio: 'ignore' })
  assert.notEqual(unrelated.pid, undefined, 'test-owned unrelated process must expose an exact PID')
  const unrelatedPid = unrelated.pid!
  let unrelatedReceipt: ProcessReceipt | undefined
  const stale = { pid: unrelatedPid, exitCode: null, signalCode: null } as unknown as ChildProcess
  try {
    await waitUntil(() => {
      unrelatedReceipt = observeReceipt(unrelatedPid)
      return unrelatedReceipt !== undefined
    }, 1_000, 'test-owned unrelated group observation')
    const cleanup = await stopCommand(stale, 50)
    assert.deepEqual(cleanup, { ownershipVerified: false, childProcessesReaped: false }, 'diagnostic coordinates alone must provide no parent cleanup authority')
    assert.equal(isAlive(unrelatedPid), true, 'a stale or reused diagnostic PID must not signal the unrelated test-owned group')
  } finally {
    await reapVerifiedTestGroup(unrelatedReceipt)
  }
})

test('S2-F45-CONTROL-04 malformed or missing supervisor readiness and control fails closed and leaves no owned group', {
  skip: supportsPosixGroupObservation ? false : 'requires POSIX process-group observation',
}, async () => {
  const supervisorPath = new URL('../src/server-supervisor.mjs', import.meta.url)
  const malformed = spawn(process.execPath, [supervisorPath.pathname, process.execPath, '{', profileDirectoryPath], { detached: true, stdio: 'ignore' })
  assert.notEqual(malformed.pid, undefined, 'malformed-control fixture must expose its detached leader')
  const leader = malformed.pid!
  try {
    await waitUntil(() => malformed.exitCode !== null || malformed.signalCode !== null, 2_000, 'malformed supervisor control exit')
    assert.equal(malformed.exitCode, 64, 'malformed supervisor control must fail closed')
    assert.equal(spawnSync('/usr/bin/pgrep', ['-g', String(leader)], { stdio: 'ignore', timeout: 100 }).status, 1, 'malformed supervisor control must leave no owned process group')

    const commandSource = await readFile(new URL('../src/command.ts', import.meta.url), 'utf8')
    const supervisorSource = await readFile(supervisorPath, 'utf8')
    assert.match(commandSource, /lease/i, 'the parent must establish a real lease instead of treating a ps receipt as readiness')
    assert.match(supervisorSource, /lease/i, 'the supervisor must consume lease EOF as a fail-closed ownership boundary')
    assert.match(supervisorSource, /(?:ready|control)/i, 'the supervisor must authenticate readiness/control rather than assuming a detached PID is ready')
  } finally {
    const receipt = observeReceipt(leader)
    if (receipt) await reapVerifiedTestGroup(receipt)
    else if (isAlive(leader)) {
      try { malformed.kill('SIGKILL') } catch { /* malformed fixture raced its own exit */ }
    }
  }
})

test('S2-F45-FINITE-05 finite completion and timeout each reap their descendant through the lease supervisor', {
  skip: supportsPosixGroupObservation ? false : 'requires POSIX process-group observation',
  timeout: 12_000,
}, async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'guidelane-f45-finite-'))
  const finiteDescendant = join(temporary, 'finite-descendant.pid')
  const finiteProgram = `
    const { spawn } = require('node:child_process')
    const { writeFileSync } = require('node:fs')
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1_000)'], { stdio: 'ignore' })
    writeFileSync(process.argv[1], String(child.pid))
    setTimeout(() => process.exit(0), 25)
  `
  const finite = startSupervisedCommand(temporary, process.execPath, ['-e', finiteProgram, finiteDescendant])
  const timeoutDescendant = join(temporary, 'timeout-descendant.pid')
  const timeoutProgram = `
    const { spawn } = require('node:child_process')
    const { writeFileSync } = require('node:fs')
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1_000)'], { stdio: 'ignore' })
    writeFileSync(process.argv[1], String(child.pid))
    setInterval(() => {}, 1_000)
  `
  const timed = startSupervisedCommand(temporary, process.execPath, ['-e', timeoutProgram, timeoutDescendant])
  let finiteReceipt: ProcessReceipt | undefined
  let timedReceipt: ProcessReceipt | undefined
  try {
    finiteReceipt = await verifiedProcessReceipt(finite) ?? undefined
    timedReceipt = await verifiedProcessReceipt(timed) ?? undefined
    assert.notEqual(finiteReceipt, undefined, 'finite fixture must begin beneath an observed supervisor group')
    assert.notEqual(timedReceipt, undefined, 'timeout fixture must begin beneath an observed supervisor group')
    await waitUntil(() => hasNumericPid(finiteDescendant), 2_000, 'finite descendant start')
    await waitUntil(() => hasNumericPid(timeoutDescendant), 2_000, 'timeout descendant start')

    const finiteResult = await waitForExit(finite, 1_000)
    assert.equal(finiteResult.timedOut, false, 'finite child completion must make the lease supervisor reap descendants without a parent timeout signal')
    assert.equal(await waitForGroupAbsence(finiteReceipt!, 1_000), true, 'finite completion must leave no supervisor-owned descendant group')

    const timeoutResult = await waitForExit(timed, 250)
    assert.equal(timeoutResult.timedOut, true, 'the bounded timeout must be reported')
    assert.equal(await waitForGroupAbsence(timedReceipt!, 1_000), true, 'timeout must be fulfilled by supervisor-owned descendant reaping')
  } finally {
    await reapVerifiedTestGroup(finiteReceipt)
    await reapVerifiedTestGroup(timedReceipt)
    await rm(temporary, { recursive: true, force: true })
  }
})

test('S2-F45-SOURCE-06 production Local Web source has no parent negative-PGID signal route', async () => {
  for (const source of [
    await readFile(new URL('../src/command.ts', import.meta.url), 'utf8'),
    await readFile(new URL('../src/harness.ts', import.meta.url), 'utf8'),
  ]) {
    assert.doesNotMatch(source, /(?:\bkill|process\.kill)\s*\(\s*-\s*[A-Za-z0-9_.]+\s*,/, 'a Local Web parent must never signal a negative process group ID')
  }

  const supervisorSource = await readFile(new URL('../src/server-supervisor.mjs', import.meta.url), 'utf8')
  assert.match(supervisorSource, /(?:\bkill|process\.kill)\s*\(\s*-\s*[A-Za-z0-9_.]+\s*,/, 'only the detached supervisor may self-reap its own current group')
  assert.match(supervisorSource, /(?:lease|EOF|STOP)/i, 'the supervisor self-reap route must be bounded by lease/control lifecycle evidence')
})

test('S2-F46-OBSERVATION-OUTAGE-01 post-initial-proof ps outage during STOP and lease EOF keeps supervisor self-authority in-memory and reaps the target without parent signalling', {
  skip: supportsPosixGroupObservation ? false : 'requires POSIX process-group observation',
  timeout: 8_000,
}, async (t: TestContext) => {
  const stopFixture = await launchFinal46SupervisorFixture(t, { scenario: 'observation-outage' })
  // This fixture acknowledgement is the observable proof that the test has
  // disabled only post-initial diagnostic observation. It must not weaken the
  // supervisor's initial PID=PGID proof or grant the parent a signal route.
  await waitForFixtureControl(
    stopFixture,
    (line) => line === `F46 FIXTURE ${stopFixture.nonce} OBSERVATION-OUTAGE ARMED`,
    750,
    'the STOP-path post-proof diagnostic-outage fixture acknowledgement',
  )
  stopFixture.lease.write(`STOP ${stopFixture.nonce}\n`)
  assert.equal(await waitForGroupAbsence(stopFixture.receipt, 2_000), true, 'authenticated STOP under a post-proof ps outage must reap its exact test-owned target group while its lease remains open until cleanup')

  const eofFixture = await launchFinal46SupervisorFixture(t, { scenario: 'observation-outage' })
  await waitForFixtureControl(
    eofFixture,
    (line) => line === `F46 FIXTURE ${eofFixture.nonce} OBSERVATION-OUTAGE ARMED`,
    750,
    'the lease-EOF-path post-proof diagnostic-outage fixture acknowledgement',
  )
  eofFixture.lease.end()
  assert.equal(await waitForGroupAbsence(eofFixture.receipt, 2_000), true, 'lease EOF without STOP under a post-proof ps outage must reap its exact test-owned target group')
})

test('S2-F46-SELF-GROUP-SIGNAL-02 supervisor self-group signal failure remains fail-stopped and retries instead of taking a voluntary cleanup exit', {
  skip: supportsPosixGroupObservation ? false : 'requires POSIX process-group observation',
  timeout: 8_000,
}, async (t: TestContext) => {
  const fixture = await launchFinal46SupervisorFixture(t, { scenario: 'signal-fails-once' })
  await waitForFixtureControl(
    fixture,
    (line) => line === `F46 FIXTURE ${fixture.nonce} SIGNAL-FAIL-ONCE ARMED`,
    750,
    'the fail-once self-signal fixture acknowledgement',
  )
  fixture.lease.write(`STOP ${fixture.nonce}\n`)
  await waitForFixtureControl(
    fixture,
    (line) => line === `F46 FIXTURE ${fixture.nonce} SIGNAL-FAIL-ONCE RETRIED`,
    1_000,
    'the supervisor retry after its temporary self-group signal failure',
  )
  assert.equal(await waitForGroupAbsence(fixture.receipt, 2_000), true, 'a temporary self-group signal failure must be retried to an absent test-owned group, not converted into a voluntary supervisor-only exit')
})

test('S2-F56-LEADER-KILL-01 SIGKILL of the original persistent supervisor leaves neither its exact target nor its recorded group running after the public stop path', {
  skip: supportsPosixGroupObservation ? false : 'requires POSIX process-group observation',
  timeout: 8_000,
}, async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'guidelane-f56-leader-kill-'))
  const targetPidPath = join(temporary, 'persistent-target.pid')
  const targetProgram = `
    const { writeFileSync } = require('node:fs')
    writeFileSync(process.argv[1], String(process.pid))
    setInterval(() => {}, 1_000)
  `
  const leader = startPersistentCommand(temporary, process.execPath, ['-e', targetProgram, targetPidPath])
  let targetPid: number | undefined
  try {
    const receipt = await verifiedProcessReceipt(leader)
    assert.notEqual(receipt, null, 'the persistent command must publish an authenticated supervisor receipt before the leader is killed')
    assert.equal(receiptStillOwnsLeader(receipt!), true, 'the authenticated receipt must still prove the original detached supervisor identity before it is killed')

    await waitUntil(() => hasNumericPid(targetPidPath), 2_000, 'the test-owned persistent target PID')
    targetPid = Number(await readFile(targetPidPath, 'utf8'))
    assert.equal(Number.isSafeInteger(targetPid) && targetPid > 0, true, 'the persistent target must record its exact positive PID')
    assert.equal(isAlive(targetPid), true, 'the exact test-owned persistent target must be live before its supervisor is killed')

    const leaderClosed = new Promise<void>((resolve) => leader.once('close', resolve))
    leader.kill('SIGKILL')
    await Promise.race([
      leaderClosed,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timed out waiting for the SIGKILLed persistent supervisor to close')), 2_000)),
    ])

    const cleanup = await stopCommand(leader, 1_000)
    assert.equal(cleanup.childProcessesReaped, true, 'the public stop path must report that the killed leader\'s recorded process group was reaped')
    assert.equal(isAlive(targetPid), false, 'SIGKILL of the original persistent supervisor must not leave its exact test-owned target running after the public stop path')
    assert.equal(groupIsAbsent(receipt!), true, 'SIGKILL of the original persistent supervisor must not leave its recorded test-owned guardian group running after the public stop path')
  } finally {
    if (targetPid !== undefined && isAlive(targetPid)) {
      // This exact PID was written by the target launched solely for this test;
      // cleanup deliberately never signals a negative PGID.
      try { process.kill(targetPid, 'SIGKILL') } catch { /* target raced its exact-PID cleanup */ }
      await waitUntil(() => !isAlive(targetPid!), 1_000, 'exact test-owned persistent target cleanup')
    }
    if (leader.exitCode === null && leader.signalCode === null && leader.pid !== undefined) {
      // The supervisor PID is the direct ChildProcess this test started.
      try { leader.kill('SIGKILL') } catch { /* supervisor raced its exact-PID cleanup */ }
    }
    await rm(temporary, { recursive: true, force: true })
  }
})

test('S2-F56-LEADER-CLOSE-AUTOREAP-09 original supervisor close alone revokes the guardian lease and reaps its target group', {
  skip: supportsPosixGroupObservation ? false : 'requires POSIX process-group observation',
  timeout: 8_000,
}, async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'guidelane-f56-leader-autoreap-'))
  const targetPidPath = join(temporary, 'persistent-target.pid')
  const targetProgram = `
    const { writeFileSync } = require('node:fs')
    writeFileSync(process.argv[1], String(process.pid))
    setInterval(() => {}, 1_000)
  `
  const leader = startPersistentCommand(temporary, process.execPath, ['-e', targetProgram, targetPidPath])
  let targetPid: number | undefined
  try {
    const receipt = await verifiedProcessReceipt(leader)
    assert.notEqual(receipt, null, 'the persistent command must publish an authenticated guardian receipt before original-supervisor close is tested')
    await waitUntil(() => hasNumericPid(targetPidPath), 2_000, 'the autoreap fixture target PID')
    targetPid = Number(await readFile(targetPidPath, 'utf8'))
    assert.equal(Number.isSafeInteger(targetPid) && targetPid > 0, true, 'the autoreap fixture target must record its exact positive PID')

    const leaderClosed = new Promise<void>((resolve) => leader.once('close', resolve))
    leader.kill('SIGKILL')
    await Promise.race([
      leaderClosed,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timed out waiting for the autoreap fixture original supervisor to close')), 2_000)),
    ])

    await waitUntil(
      () => !isAlive(targetPid!) && groupIsAbsent(receipt!),
      2_000,
      'original supervisor close alone to revoke the guardian lease and reap its target group',
    )
    assert.equal(isAlive(targetPid), false, 'original supervisor close alone must not leave its exact test-owned target running')
    assert.equal(groupIsAbsent(receipt!), true, 'original supervisor close alone must not leave its recorded guardian group running')
  } finally {
    if (targetPid !== undefined && isAlive(targetPid)) {
      // This exact PID is written only by the autoreap fixture target; cleanup
      // deliberately never signals a negative PGID.
      try { process.kill(targetPid, 'SIGKILL') } catch { /* target raced its exact-PID cleanup */ }
      await waitUntil(() => !isAlive(targetPid!), 1_000, 'exact autoreap fixture target cleanup')
    }
    if (leader.exitCode === null && leader.signalCode === null && leader.pid !== undefined) {
      // The original supervisor PID is the direct ChildProcess this test started.
      try { leader.kill('SIGKILL') } catch { /* supervisor raced its exact-PID cleanup */ }
    }
    await rm(temporary, { recursive: true, force: true })
  }
})

test('S2-F56-REGRESSION-LIVENESS-PIPE-11 guardian reaps after only its original supervisor closes while the controller event loop is stalled', {
  skip: supportsPosixGroupObservation ? false : 'requires POSIX process-group observation',
  timeout: 10_000,
}, async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'guidelane-f56-liveness-pipe-'))
  const targetPidPath = join(temporary, 'persistent-target.pid')
  const commandModuleUrl = new URL('../src/command.ts', import.meta.url).href
  const targetProgram = `
    const { writeFileSync } = require('node:fs')
    writeFileSync(process.argv[1], String(process.pid))
    setInterval(() => {}, 1_000)
  `
  // This controller intentionally stops servicing its ChildProcess callbacks
  // immediately after publishing the original-supervisor and guardian
  // identities.  The only permitted cleanup trigger before it unstalls is the
  // supervisor-owned liveness pipe observed by the detached guardian.
  const stalledControllerProgram = `
    import { readFile } from 'node:fs/promises'
    import { startPersistentCommand, verifiedProcessReceipt } from ${JSON.stringify(commandModuleUrl)}
    const [cwd, targetPidPath] = process.argv.slice(1)
    const targetProgram = ${JSON.stringify(targetProgram)}
    const child = startPersistentCommand(cwd, process.execPath, ['-e', targetProgram, targetPidPath])
    const receipt = await verifiedProcessReceipt(child)
    if (!receipt || child.pid === undefined) process.exit(70)
    let targetPid
    for (let attempt = 0; attempt < 80; attempt += 1) {
      try {
        targetPid = Number(await readFile(targetPidPath, 'utf8'))
        if (Number.isSafeInteger(targetPid) && targetPid > 0) break
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    if (!Number.isSafeInteger(targetPid) || targetPid <= 0) process.exit(71)
    process.send?.({ kind: 'ready', supervisorPid: child.pid, guardianReceipt: receipt, targetPid })
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 4_000)
    process.send?.({ kind: 'unstalled' })
  `
  const controller = spawn(process.execPath, [
    '--experimental-strip-types',
    '--input-type=module',
    '-e',
    stalledControllerProgram,
    temporary,
    targetPidPath,
  ], {
    cwd: profileDirectoryPath,
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  })
  assert.notEqual(controller.pid, undefined, 'the stalled controller fixture must expose its exact PID')
  let ready: { supervisorPid: number; guardianReceipt: ProcessReceipt; targetPid: number } | undefined
  try {
    ready = await new Promise<{ supervisorPid: number; guardianReceipt: ProcessReceipt; targetPid: number }>((resolve, reject) => {
      const timer = setTimeout(() => settle(new Error('timed out waiting for the stalled controller fixture readiness')), 3_000)
      const onMessage = (message: unknown): void => {
        const candidate = message as Partial<{ kind: string; supervisorPid: number; guardianReceipt: ProcessReceipt; targetPid: number }>
        if (candidate.kind !== 'ready') return
        if (!Number.isSafeInteger(candidate.supervisorPid) || !candidate.guardianReceipt || !Number.isSafeInteger(candidate.targetPid)) {
          settle(new Error('stalled controller fixture returned malformed identities'))
          return
        }
        settle(undefined, candidate as { supervisorPid: number; guardianReceipt: ProcessReceipt; targetPid: number })
      }
      const onExit = (code: number | null, signal: NodeJS.Signals | null): void => settle(new Error(`stalled controller exited before readiness: code=${code} signal=${signal}`))
      const settle = (error?: Error, value?: { supervisorPid: number; guardianReceipt: ProcessReceipt; targetPid: number }): void => {
        clearTimeout(timer)
        controller.removeListener('message', onMessage)
        controller.removeListener('exit', onExit)
        if (error) reject(error)
        else resolve(value!)
      }
      controller.on('message', onMessage)
      controller.once('exit', onExit)
    })
    assert.equal(receiptStillOwnsLeader(ready.guardianReceipt), true, 'the guardian receipt must prove the exact detached guardian before only the original supervisor is killed')
    assert.equal(isAlive(ready.targetPid), true, 'the exact persistent target must be alive before its original supervisor liveness pipe closes')
    assert.equal(isAlive(controller.pid!), true, 'the controller must still be alive while its event loop is stalled')

    // Do not close the controller, its IPC channel, or its UDS endpoint.  This
    // exact PID is the original supervisor published by that controller.
    process.kill(ready.supervisorPid, 'SIGKILL')
    await waitUntil(
      () => !isAlive(ready!.targetPid) && groupIsAbsent(ready!.guardianReceipt),
      2_000,
      'guardian liveness-pipe EOF to reap the target before the controller can process its close callback',
    )
    assert.equal(isAlive(controller.pid!), true, 'the guardian cleanup must complete while the controller remains stalled, independent of a controller UDS close callback')
    assert.equal(isAlive(ready.targetPid), false, 'original-supervisor liveness EOF alone must reap the exact persistent target')
    assert.equal(groupIsAbsent(ready.guardianReceipt), true, 'original-supervisor liveness EOF alone must reap the recorded guardian group')
  } finally {
    if (ready && isAlive(ready.targetPid)) {
      // The exact target PID is written by this fixture alone; this fallback
      // cannot signal any group or widen cleanup authority.
      try { process.kill(ready.targetPid, 'SIGKILL') } catch { /* target raced guardian cleanup */ }
      await waitUntil(() => !isAlive(ready!.targetPid), 1_000, 'exact liveness-pipe fixture target cleanup')
    }
    if (controller.exitCode === null && controller.signalCode === null && controller.pid !== undefined) {
      // The controller PID belongs only to this test-owned stalled fixture.
      try { controller.kill('SIGKILL') } catch { /* controller exited after its bounded stall */ }
    }
    if (ready) await reapVerifiedTestGroup(ready.guardianReceipt)
    await rm(temporary, { recursive: true, force: true })
  }
})

test('S2-F56-REGRESSION-RESULT-RELAY-12 missing or unterminated RESULT relay data cannot report a successful runCommand after cleanup', {
  timeout: 8_000,
}, async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'guidelane-f56-result-relay-'))
  const commandSource = await readFile(new URL('../src/command.ts', import.meta.url), 'utf8')
  const fixtureCommandPath = join(temporary, 'command.ts')
  const fixtureSupervisorPath = join(temporary, 'server-supervisor.mjs')
  const rejectedRelaySupervisor = `
    import { writeSync } from 'node:fs'
    const [nonce, , argsJson] = process.argv.slice(2)
    const relayMode = JSON.parse(argsJson).includes('missing-result') ? 'missing' : 'unterminated'
    const emit = (line) => writeSync(3, line + '\\n')
    let buffer = ''
    process.stdin.setEncoding('utf8')
    emit('READY ' + nonce)
    process.stdin.on('data', (chunk) => {
      buffer += chunk
      let newline = buffer.indexOf('\\n')
      while (newline >= 0) {
        const line = buffer.slice(0, newline)
        buffer = buffer.slice(newline + 1)
        if (line === 'ACK ' + nonce) {
          emit('LEASED ' + nonce)
          if (relayMode === 'unterminated') {
            // The first terminal frame is syntactically valid success. The
            // trailing bytes are an unterminated relay frame and must fail on
            // stream EOF rather than allowing the earlier success to survive.
            emit('RESULT ' + nonce + ' 0 -')
            writeSync(3, 'BROKEN')
          }
          setTimeout(() => process.exit(0), 20)
          return
        }
        newline = buffer.indexOf('\\n')
      }
    })
  `
  try {
    // The copied command module is byte-for-byte production command behavior;
    // only its sibling detached supervisor is test-owned so the malformed
    // relay sequence can be produced without adding a production test seam.
    await writeFile(fixtureCommandPath, commandSource, 'utf8')
    await writeFile(fixtureSupervisorPath, rejectedRelaySupervisor, 'utf8')
    const fixtureCommand = await import(`${pathToFileURL(fixtureCommandPath).href}?f56-result-relay=${randomBytes(8).toString('hex')}`) as {
      runCommand: (cwd: string, command: string, args: string[], environment?: Record<string, string>, timeoutMs?: number) => Promise<{
        exitCode: number | null
        timedOut: boolean
        childProcessesReaped: boolean
      }>
    }
    const unterminated = await fixtureCommand.runCommand(temporary, process.execPath, ['-e', 'process.exit(0)'], {}, 2_000)
    assert.equal(unterminated.childProcessesReaped, true, 'the malformed relay fixture must complete detached-child cleanup so failure cannot be attributed to unreaped children')
    assert.notEqual(unterminated.exitCode, 0, 'unterminated relay bytes after an early valid RESULT success must invalidate that success for the public runCommand result')
    const missing = await fixtureCommand.runCommand(temporary, process.execPath, ['-e', 'process.exit(0)', 'missing-result'], {}, 2_000)
    assert.equal(missing.childProcessesReaped, true, 'the missing-result fixture must complete detached-child cleanup')
    assert.notEqual(missing.exitCode, 0, 'a clean supervisor exit without a RESULT frame must not become a successful public runCommand result')
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
})

test('S2-F56-LEASE-REVOCATION-10 verified receipt becomes unavailable before group absence after public STOP', {
  skip: supportsPosixGroupObservation ? false : 'requires POSIX process-group observation',
  timeout: 8_000,
}, async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'guidelane-f56-lease-revocation-'))
  const targetPidPath = join(temporary, 'term-resistant-target.pid')
  const targetProgram = `
    const { writeFileSync } = require('node:fs')
    process.on('SIGTERM', () => {})
    writeFileSync(process.argv[1], String(process.pid))
    setInterval(() => {}, 1_000)
  `
  const child = startPersistentCommand(temporary, process.execPath, ['-e', targetProgram, targetPidPath])
  let receipt: ProcessReceipt | undefined
  let targetPid: number | undefined
  let cleanupPromise: Promise<Awaited<ReturnType<typeof stopCommand>>> | undefined
  try {
    receipt = await verifiedProcessReceipt(child) ?? undefined
    assert.notEqual(receipt, undefined, 'the public persistent command must publish an authenticated guardian receipt before STOP')
    await waitUntil(() => hasNumericPid(targetPidPath), 2_000, 'the SIGTERM-resistant target PID')
    targetPid = Number(await readFile(targetPidPath, 'utf8'))
    assert.equal(Number.isSafeInteger(targetPid) && targetPid > 0, true, 'the SIGTERM-resistant target must record its exact positive PID')
    assert.equal(isAlive(targetPid), true, 'the SIGTERM-resistant target must be live before public STOP')

    cleanupPromise = stopCommand(child, 1_000)
    await waitUntil(async () => {
      const revoked = await verifiedProcessReceipt(child) === null
      return revoked && isAlive(targetPid!) && !groupIsAbsent(receipt!)
    }, 1_000, 'public STOP to revoke the verified receipt while the SIGTERM-resistant target group is still observable')
    assert.equal(await verifiedProcessReceipt(child), null, 'public STOP must revoke the diagnostic receipt before the target group is absent')
    assert.equal(isAlive(targetPid), true, 'the SIGTERM-resistant exact target must still be alive during the receipt-revocation interval')
    assert.equal(groupIsAbsent(receipt!), false, 'the guardian group must still be observable during the receipt-revocation interval')

    const cleanup = await cleanupPromise
    assert.equal(cleanup.childProcessesReaped, true, 'public STOP must eventually report the SIGTERM-resistant guardian group reaped')
    assert.equal(await waitForGroupAbsence(receipt!, 1_000), true, 'public STOP must eventually reap the SIGTERM-resistant guardian group')
    assert.equal(isAlive(targetPid), false, 'public STOP must eventually reap the exact SIGTERM-resistant target')
  } finally {
    if (cleanupPromise) {
      try { await cleanupPromise } catch { /* public cleanup raced fixture teardown */ }
    } else if (child.exitCode === null && child.signalCode === null) {
      try { await stopCommand(child, 1_000) } catch { /* public cleanup raced fixture teardown */ }
    }
    if (targetPid !== undefined && isAlive(targetPid)) {
      // This exact PID is written only by the receipt-revocation fixture target;
      // cleanup deliberately never signals a negative PGID.
      try { process.kill(targetPid, 'SIGKILL') } catch { /* target raced its exact-PID cleanup */ }
      await waitUntil(() => !isAlive(targetPid!), 1_000, 'exact receipt-revocation target cleanup')
    }
    if (child.exitCode === null && child.signalCode === null && child.pid !== undefined) {
      // The direct supervisor PID is the ChildProcess this test started.
      try { child.kill('SIGKILL') } catch { /* supervisor raced its exact-PID cleanup */ }
    }
    await rm(temporary, { recursive: true, force: true })
  }
})

test('S2-F56-SPAWN-FAILURE-03 synchronous persistent launch failure leaves no private guardian lease directory', {
  skip: supportsPosixGroupObservation ? false : 'requires the production POSIX /tmp guardian lease directory',
}, async () => {
  const before = await privateGuardianLeaseDirectories()
  assert.throws(
    () => startPersistentCommand(`guidelane-f56-invalid-cwd\0${randomBytes(8).toString('hex')}`, process.execPath, ['-e', 'process.exit(0)']),
    'a persistent launch with an invalid NUL cwd must throw synchronously before any child starts',
  )
  await waitUntil(async () => {
    const after = await privateGuardianLeaseDirectories()
    return after.length === before.length && after.every((name, index) => name === before[index])
  }, 1_000, 'synchronous persistent launch failure to leave no new private guardian lease directory')
  assert.deepEqual(await privateGuardianLeaseDirectories(), before, 'a synchronous persistent launch failure must leave the exact private guardian lease-directory set unchanged')
})

test('S2-F56-GUARDIAN-ACK-STOP-RACE-04 authenticated same-chunk ACK and STOP reaps the real guardian target group', {
  skip: supportsPosixGroupObservation ? false : 'requires POSIX process-group observation',
  timeout: 8_000,
}, async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'guidelane-f56-guardian-race-'))
  const socketPath = join(temporary, 'guardian.sock')
  const targetPidPath = join(temporary, 'target.pid')
  const nonce = randomBytes(32).toString('hex')
  const guardianPath = fileURLToPath(new URL('../src/server-guardian.mjs', import.meta.url))
  const targetProgram = `
    const { writeFileSync } = require('node:fs')
    writeFileSync(process.argv[1], String(process.pid))
    setInterval(() => {}, 1_000)
  `
  let leaseSocket: Socket | undefined
  const controlLines: string[] = []
  let controlBuffer = ''
  const server = createServer((socket) => {
    if (leaseSocket !== undefined) {
      socket.destroy()
      return
    }
    leaseSocket = socket
    socket.setEncoding('utf8')
    socket.on('data', (chunk: string) => {
      controlBuffer += chunk
      let newline = controlBuffer.indexOf('\n')
      while (newline >= 0) {
        controlLines.push(controlBuffer.slice(0, newline))
        controlBuffer = controlBuffer.slice(newline + 1)
        newline = controlBuffer.indexOf('\n')
      }
    })
  })
  let guardian: ChildProcess | undefined
  let guardianReceipt: ProcessReceipt | undefined
  let targetPid: number | undefined
  let guardianLiveness: NodeJS.WritableStream | null | undefined
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(socketPath, resolve)
    })
    guardian = spawn(process.execPath, [
      guardianPath,
      nonce,
      socketPath,
      process.execPath,
      JSON.stringify(['-e', targetProgram, targetPidPath]),
      temporary,
    ], {
      cwd: temporary,
      detached: true,
      // fd4 is the original-supervisor liveness lease. Keep the test-owned
      // writer open through ACK/STOP so this fixture exercises its control
      // sequence rather than an accidental early liveness EOF.
      stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'],
    })
    const guardianResult = guardian.stdio[3] as NodeJS.ReadableStream | null
    guardianLiveness = guardian.stdio[4] as NodeJS.WritableStream | null
    guardianResult?.resume()
    assert.notEqual(guardian.pid, undefined, 'the real guardian fixture must expose its exact detached PID')
    assert.notEqual(guardianLiveness, null, 'the real guardian fixture must retain the supervisor-liveness writer through STOP')

    await waitUntil(() => {
      guardianReceipt = observeReceipt(guardian!.pid!)
      return guardianReceipt !== undefined
    }, 1_000, 'the real guardian detached-group receipt')
    await waitUntil(
      () => leaseSocket !== undefined && controlLines.includes(`READY ${nonce} ${guardian!.pid}`),
      2_000,
      'the real guardian authenticated READY frame',
    )
    assert.equal(receiptStillOwnsLeader(guardianReceipt!), true, 'the recorded guardian receipt must prove the exact detached guardian identity before same-chunk control is sent')

    // One write deliberately forces both authenticated frames through one data
    // callback, exercising the ACK-to-STOP phase transition race directly.
    leaseSocket!.write(`ACK ${nonce}\nSTOP ${nonce}\n`)
    assert.equal(
      await waitForGroupAbsence(guardianReceipt!, 2_000),
      true,
      'the real guardian must reap its target group after same-chunk ACK and STOP without parent cleanup',
    )
  } finally {
    try { guardianLiveness?.end() } catch { /* liveness writer may already close with the guardian */ }
    try { leaseSocket?.destroy() } catch { /* test-owned lease socket may already be closed */ }
    if (guardianReceipt) await waitForGroupAbsence(guardianReceipt, 500)
    if (targetPid === undefined && await hasNumericPid(targetPidPath)) targetPid = Number(await readFile(targetPidPath, 'utf8'))
    if (targetPid !== undefined && isAlive(targetPid)) {
      // This exact PID is written only by this test's looping target; cleanup
      // deliberately never signals a negative PGID.
      try { process.kill(targetPid, 'SIGKILL') } catch { /* target raced its exact-PID cleanup */ }
      await waitUntil(() => !isAlive(targetPid!), 1_000, 'exact same-chunk guardian-race target cleanup')
    }
    if (guardian?.exitCode === null && guardian.signalCode === null && guardian.pid !== undefined) {
      // The guardian PID is the direct ChildProcess this test started.
      try { guardian.kill('SIGKILL') } catch { /* guardian raced its exact-PID cleanup */ }
    }
    await new Promise<void>((resolve) => {
      try { server.close(() => resolve()) } catch { resolve() }
    })
    await rm(temporary, { recursive: true, force: true })
  }
})

test('S2-F56-GUARDIAN-ACK-STOP-ORDERING-05 guardian claims spawn ownership before async readiness and self-cleans post-spawn control failures', async () => {
  const guardianSource = await readFile(new URL('../src/server-guardian.mjs', import.meta.url), 'utf8')
  assert.match(
    guardianSource,
    /target\s*=\s*spawn\([\s\S]*?\)\s*\n[\s\S]{0,500}?targetStarted\s*=\s*true\s*\n\s*phase\s*=\s*'launching'\s*\n[\s\S]{0,500}?target\.once\(\s*'spawn'/,
    'the guardian must claim spawn ownership and enter launching before asynchronous target readiness can race later control frames',
  )
  assert.match(
    guardianSource,
    /function malformedControl\(\)\s*\{\s*if \(targetStarted\) beginCleanup\([^)]*\)\s*else abortBeforeTarget\(/,
    'malformed control after a spawn attempt must self-clean the guardian group instead of taking the pre-spawn abort path',
  )
  assert.match(
    guardianSource,
    /function handleLeaseLoss\(\)\s*\{\s*if \(cleanupStarted\) return\s*if \(targetStarted\) beginCleanup\([^)]*\)\s*else abortBeforeTarget\(/,
    'lease loss after a spawn attempt must self-clean the guardian group instead of taking the pre-spawn abort path',
  )
})

test('S2-F56-GUARDIAN-FD3-RELAY-ISOLATION-06 authenticated target cannot inject a forged semantic frame into the guardian relay', {
  skip: supportsPosixGroupObservation ? false : 'requires POSIX process-group observation',
  timeout: 8_000,
}, async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'guidelane-f56-guardian-fd3-'))
  const socketPath = join(temporary, 'guardian.sock')
  const observationPath = join(temporary, 'target-fd3.json')
  const nonce = randomBytes(32).toString('hex')
  const forgedFrame = `FORGED ${nonce} ${randomBytes(16).toString('hex')}`
  const guardianPath = fileURLToPath(new URL('../src/server-guardian.mjs', import.meta.url))
  const targetProgram = `
    const { writeFileSync, writeSync } = require('node:fs')
    let writeAttempt
    try {
      writeSync(3, process.argv[2] + '\\n')
      writeAttempt = 'succeeded'
    } catch (error) {
      writeAttempt = error && error.code === 'EBADF' ? 'rejected' : 'other-error'
    }
    writeFileSync(process.argv[1], JSON.stringify({ pid: process.pid, writeAttempt }))
    setInterval(() => {}, 1_000)
  `
  let leaseSocket: Socket | undefined
  const controlLines: string[] = []
  let controlBuffer = ''
  const server = createServer((socket) => {
    if (leaseSocket !== undefined) {
      socket.destroy()
      return
    }
    leaseSocket = socket
    socket.setEncoding('utf8')
    socket.on('data', (chunk: string) => {
      controlBuffer += chunk
      let newline = controlBuffer.indexOf('\n')
      while (newline >= 0) {
        controlLines.push(controlBuffer.slice(0, newline))
        controlBuffer = controlBuffer.slice(newline + 1)
        newline = controlBuffer.indexOf('\n')
      }
    })
  })
  let guardian: ChildProcess | undefined
  let guardianReceipt: ProcessReceipt | undefined
  let targetPid: number | undefined
  const guardianRelayLines: string[] = []
  let guardianRelayBuffer = ''
  let guardianLiveness: NodeJS.WritableStream | null | undefined
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(socketPath, resolve)
    })
    guardian = spawn(process.execPath, [
      guardianPath,
      nonce,
      socketPath,
      process.execPath,
      JSON.stringify(['-e', targetProgram, observationPath, forgedFrame]),
      temporary,
    ], {
      cwd: temporary,
      detached: true,
      // Keep fd4 open until fixture teardown: it is the real supervisor-owned
      // liveness lease and must not turn this relay-isolation test into EOF
      // cleanup before its authenticated control sequence is exercised.
      stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'],
      // The target inherits only this constrained guardian environment; no
      // NODE_* or IPC control variables can manufacture a relay endpoint.
      env: {
        PATH: process.env.PATH ?? '/usr/bin:/bin',
        LANG: process.env.LANG ?? 'C',
      },
    })
    const guardianResult = guardian.stdio[3] as NodeJS.ReadableStream | null
    guardianLiveness = guardian.stdio[4] as NodeJS.WritableStream | null
    assert.notEqual(guardianResult, null, 'the fd3 fixture must capture the guardian result relay')
    assert.notEqual(guardianLiveness, null, 'the fd3 fixture must retain the supervisor-liveness writer through STOP')
    guardianResult!.setEncoding('utf8')
    guardianResult!.on('data', (chunk: string) => {
      guardianRelayBuffer += chunk
      let newline = guardianRelayBuffer.indexOf('\n')
      while (newline >= 0) {
        guardianRelayLines.push(guardianRelayBuffer.slice(0, newline))
        guardianRelayBuffer = guardianRelayBuffer.slice(newline + 1)
        newline = guardianRelayBuffer.indexOf('\n')
      }
    })
    assert.notEqual(guardian.pid, undefined, 'the fd3 fixture guardian must expose its exact detached PID')

    await waitUntil(() => {
      guardianReceipt = observeReceipt(guardian!.pid!)
      return guardianReceipt !== undefined
    }, 1_000, 'the fd3 fixture guardian detached-group receipt')
    await waitUntil(
      () => leaseSocket !== undefined && controlLines.includes(`READY ${nonce} ${guardian!.pid}`),
      2_000,
      'the fd3 fixture guardian authenticated READY frame',
    )
    assert.equal(receiptStillOwnsLeader(guardianReceipt!), true, 'the fd3 fixture receipt must prove the exact detached guardian before ACK')

    leaseSocket!.write(`ACK ${nonce}\n`)
    await waitUntil(async () => {
      try {
        const candidate = JSON.parse(await readFile(observationPath, 'utf8')) as { pid?: unknown }
        return Number.isSafeInteger(candidate.pid) && controlLines.includes(`LEASED ${nonce}`)
      } catch {
        return false
      }
    }, 2_000, 'the normal-ACK target fd3 observation and lease acknowledgement')
    const observation = JSON.parse(await readFile(observationPath, 'utf8')) as { pid?: unknown; writeAttempt?: unknown }
    assert.equal(Number.isSafeInteger(observation.pid) && (observation.pid as number) > 0, true, 'the normal-ACK target must report its exact positive PID')
    targetPid = observation.pid as number
    assert.equal(isAlive(targetPid), true, 'the exact target must be live while its private lease remains open')
    assert.equal(controlLines.includes(`LEASED ${nonce}`), true, 'the guardian must acknowledge a normal target lease before STOP cleanup is exercised')
    assert.equal(typeof observation.writeAttempt, 'string', 'the target must report that it attempted its forged fd3 write after ACK')

    // STOP is sent only after the target has authenticated normal-ACK launch
    // and recorded fd3, so it cannot be confused with the same-chunk race.
    leaseSocket!.write(`STOP ${nonce}\n`)
    await waitUntil(
      () => guardianRelayLines.some((line) => line.startsWith(`RESULT ${nonce} `)) && !isAlive(targetPid!) && groupIsAbsent(guardianReceipt!),
      2_000,
      'normal-ACK guardian STOP to drain the real relay and reap the exact target and guardian group',
    )
    assert.equal(guardianRelayLines.includes(`READY ${nonce}`), true, 'the captured guardian relay must contain its authentic READY frame')
    assert.equal(guardianRelayLines.includes(`LEASED ${nonce}`), true, 'the captured guardian relay must contain its authentic LEASED frame')
    assert.equal(guardianRelayLines.includes(forgedFrame), false, 'an authenticated target must not inject its forged semantic frame into the guardian relay')
    assert.equal(isAlive(targetPid), false, 'guardian STOP must not leave its exact fd3-observation target alive')
    assert.equal(groupIsAbsent(guardianReceipt!), true, 'guardian STOP must not leave the fd3 fixture recorded process group alive')
  } finally {
    try { guardianLiveness?.end() } catch { /* liveness writer may already close with the guardian */ }
    try { leaseSocket?.destroy() } catch { /* test-owned lease socket may already be closed */ }
    if (guardianReceipt) await waitForGroupAbsence(guardianReceipt, 500)
    if (targetPid !== undefined && isAlive(targetPid)) {
      // This exact PID comes from the target's own test-owned observation file;
      // cleanup deliberately never signals a negative PGID.
      try { process.kill(targetPid, 'SIGKILL') } catch { /* target raced its exact-PID cleanup */ }
      await waitUntil(() => !isAlive(targetPid!), 1_000, 'exact fd3-observation target cleanup')
    }
    if (guardian?.exitCode === null && guardian.signalCode === null && guardian.pid !== undefined) {
      // The guardian PID is the direct ChildProcess this test started.
      try { guardian.kill('SIGKILL') } catch { /* guardian raced its exact-PID cleanup */ }
    }
    await new Promise<void>((resolve) => {
      try { server.close(() => resolve()) } catch { resolve() }
    })
    await rm(temporary, { recursive: true, force: true })
  }
})

test('S2-F56-GUARDIAN-RESULT-PLANE-07 guardian lease control rejects terminal result frames', async () => {
  const commandSource = await readFile(new URL('../src/command.ts', import.meta.url), 'utf8')
  const controlStart = commandSource.indexOf('function consumeControlMessage')
  const controlEnd = commandSource.indexOf('function attachLeaseProtocol', controlStart)
  const guardianRelayStart = commandSource.indexOf('function attachGuardianResultRelay')
  const guardianRelayEnd = commandSource.indexOf('function startLeaseSupervisedCommand', guardianRelayStart)
  assert.notEqual(controlStart, -1, 'the guardian lease-control parser must remain a distinct production boundary')
  assert.notEqual(controlEnd, -1, 'the guardian lease-control parser boundary must be delimited before transport attachment')
  assert.notEqual(guardianRelayStart, -1, 'the direct-supervisor guardian-result relay must remain a distinct production boundary')
  assert.notEqual(guardianRelayEnd, -1, 'the direct-supervisor guardian-result relay boundary must be delimited before process launch')

  const guardianLeaseControl = commandSource.slice(controlStart, controlEnd)
  const guardianResultRelay = commandSource.slice(guardianRelayStart, guardianRelayEnd)
  assert.match(
    guardianLeaseControl,
    /(?:state\.transport\s*===\s*'supervisor'\s*&&\s*kind\s*===\s*'RESULT'|kind\s*===\s*'RESULT'\s*&&\s*state\.transport\s*===\s*'supervisor')/,
    'terminal RESULT parsing in shared lease control must be explicitly limited to the direct-supervisor transport, so guardian UDS control rejects it',
  )
  assert.match(guardianResultRelay, /kind\s*===\s*'RESULT'/, 'terminal RESULT parsing must remain available only through the direct-supervisor guardian-result relay')
})

test('S2-F56-GUARDIAN-LEASE-PERMISSIONS-08 persistent guardian lease has private modes and is removed after public cleanup', {
  skip: supportsPosixGroupObservation ? false : 'requires POSIX process-group observation',
  timeout: 8_000,
}, async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'guidelane-f56-lease-permissions-'))
  const targetPidPath = join(temporary, 'target.pid')
  const targetProgram = `
    const { writeFileSync } = require('node:fs')
    writeFileSync(process.argv[1], String(process.pid))
    setInterval(() => {}, 1_000)
  `
  const before = await privateGuardianLeaseDirectories()
  let child: ChildProcess | undefined
  let receipt: ProcessReceipt | undefined
  let targetPid: number | undefined
  let leaseDirectory: string | undefined
  try {
    child = startPersistentCommand(temporary, process.execPath, ['-e', targetProgram, targetPidPath])
    receipt = await verifiedProcessReceipt(child) ?? undefined
    assert.notEqual(receipt, undefined, 'the public persistent command must publish an authenticated guardian receipt before lease permissions are inspected')
    await waitUntil(() => hasNumericPid(targetPidPath), 2_000, 'the public persistent command target PID')
    targetPid = Number(await readFile(targetPidPath, 'utf8'))
    assert.equal(Number.isSafeInteger(targetPid) && targetPid > 0, true, 'the public persistent target must record its exact positive PID')

    await waitUntil(async () => {
      const after = await privateGuardianLeaseDirectories()
      const added = after.filter((name) => !before.includes(name))
      if (added.length !== 1) return false
      leaseDirectory = join(privateGuardianLeaseRoot, added[0]!)
      try {
        await stat(join(leaseDirectory, 'lease.sock'))
        return true
      } catch {
        return false
      }
    }, 2_000, 'exactly one new private guardian lease directory and its lease socket')

    const leaseSocketPath = join(leaseDirectory!, 'lease.sock')
    const leaseDirectoryMode = (await stat(leaseDirectory!)).mode & 0o777
    const leaseSocketMode = (await stat(leaseSocketPath)).mode & 0o777
    assert.equal(leaseDirectoryMode, 0o700, 'the exact new private guardian lease directory must be mode 0700')
    assert.equal(leaseSocketMode, 0o600, 'the exact new private guardian lease socket must be mode 0600')

    const cleanup = await stopCommand(child, 1_000)
    assert.equal(cleanup.childProcessesReaped, true, 'public persistent cleanup must report its guardian target group reaped')
    assert.equal(await waitForGroupAbsence(receipt!, 1_000), true, 'public persistent cleanup must remove the authenticated guardian target group')
    await waitUntil(async () => {
      try {
        await stat(leaseDirectory!)
        return false
      } catch (error) {
        return (error as NodeJS.ErrnoException).code === 'ENOENT'
      }
    }, 2_000, 'public persistent cleanup to remove its exact private guardian lease directory')
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      try { await stopCommand(child, 1_000) } catch { /* public cleanup raced the fixture terminal path */ }
    }
    if (targetPid !== undefined && isAlive(targetPid)) {
      // This exact PID is written only by this public-chain fixture target;
      // cleanup deliberately never signals a negative PGID.
      try { process.kill(targetPid, 'SIGKILL') } catch { /* target raced its exact-PID cleanup */ }
      await waitUntil(() => !isAlive(targetPid!), 1_000, 'exact public-chain target cleanup')
    }
    if (child?.exitCode === null && child.signalCode === null && child.pid !== undefined) {
      // The direct supervisor ChildProcess belongs only to this fixture.
      try { child.kill('SIGKILL') } catch { /* supervisor raced its exact-PID cleanup */ }
    }
    await rm(temporary, { recursive: true, force: true })
  }
})

test('S2-F56-SOURCE-STRUCTURAL-02 every Local Web negative-PGID signal route is limited to the proven detached supervisor self-group', async () => {
  const sourceEntries = [
    ['command.ts', new URL('../src/command.ts', import.meta.url)],
    ['harness.ts', new URL('../src/harness.ts', import.meta.url)],
    ['attempt-authority.ts', new URL('../src/attempt-authority.ts', import.meta.url)],
    ['server-supervisor.mjs', new URL('../src/server-supervisor.mjs', import.meta.url)],
    ['server-guardian.mjs', new URL('../src/server-guardian.mjs', import.meta.url)],
    ['evidence.ts', new URL('../src/evidence.ts', import.meta.url)],
    ['cli.ts', new URL('../src/cli.ts', import.meta.url)],
    ['generator.ts', new URL('../src/generator.ts', import.meta.url)],
    ['git.ts', new URL('../src/git.ts', import.meta.url)],
    ['index.ts', new URL('../src/index.ts', import.meta.url)],
    ['target-path.ts', new URL('../src/target-path.ts', import.meta.url)],
    ['types.ts', new URL('../src/types.ts', import.meta.url)],
  ] as const
  const sources = await Promise.all(sourceEntries.map(async ([name, url]) => {
    try {
      return [name, await readFile(url, 'utf8')] as const
    } catch (error) {
      if (name === 'server-guardian.mjs') assert.fail('the target-side detached guardian source must be present in the scoped Local Web inventory')
      throw error
    }
  }))
  const negativePgidSignal = /(?:\bkill|process\.kill)\s*\(\s*-\s*[^,\s)]+\s*,/g
  const escapeRegularExpression = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

  const assertSelfGroupSignalRoute = (name: string, source: string, required: boolean): void => {
    const routes = [...source.matchAll(negativePgidSignal)]
    assert.equal(routes.length === 1 || (!required && routes.length === 0), true, `${name} must ${required ? 'contain exactly one' : 'contain at most one'} negative-PGID signal route`)
    if (routes.length === 0) return
    const route = routes[0]![0]
    assert.match(route, /(?:\bkill|process\.kill)\s*\(\s*-\s*process\.pid\s*,/, `${name} may signal only its own current process group`)
    const capability = /const\s+([A-Za-z_$][\w$]*)\s*=\s*[\s\S]{0,300}?\.pid\s*===\s*process\.pid\s*&&\s*[\s\S]{0,120}?\.pgid\s*===\s*process\.pid/.exec(source)
    assert.notEqual(capability, null, `${name} must retain a local current-PID-equals-PGID capability`)
    const capabilityName = escapeRegularExpression(capability![1]!)
    assert.match(
      source,
      new RegExp(`function\\s+\\w+\\s*\\([^)]*\\)\\s*\\{\\s*if\\s*\\(\\s*!${capabilityName}\\s*\\)\\s*return false[\\s\\S]*?${escapeRegularExpression(route)}`),
      `${name} must guard its self-group signal with that local current-PID-equals-PGID capability`,
    )
  }

  for (const [name, source] of sources) {
    if (name === 'server-supervisor.mjs' || name === 'server-guardian.mjs') continue
    assert.deepEqual([...source.matchAll(negativePgidSignal)], [], `${name} must contain no parent negative-PGID signal route`)
  }

  const supervisorSource = sources.find(([name]) => name === 'server-supervisor.mjs')?.[1]
  const guardianSource = sources.find(([name]) => name === 'server-guardian.mjs')?.[1]
  assert.notEqual(supervisorSource, undefined, 'the detached supervisor source must be present in the scoped Local Web inventory')
  assert.notEqual(guardianSource, undefined, 'the target-side detached guardian source must be present in the scoped Local Web inventory')
  assertSelfGroupSignalRoute('server-supervisor.mjs', supervisorSource!, false)
  assertSelfGroupSignalRoute('server-guardian.mjs', guardianSource!, true)
})

test('S2-F46-ATTEMPT-AUTHORITY-03 prior boot pass cannot authorize a current attempt after candidate terminal or replacement failure', {
  timeout: 510_000,
}, async (t: TestContext) => {
  const artifacts = await mkdtemp(join(tmpdir(), 'guidelane-f46-attempt-authority-'))
  t.after(async () => rm(artifacts, { recursive: true, force: true }))
  const authority = await loadAttemptAuthorityFixtureModule()
  const prior = { attemptId: 'f46-prior-passed-attempt', candidateDigest: 'a'.repeat(64), resultIdentity: 'b'.repeat(64) }
  const current = { attemptId: 'f46-current-failed-attempt', candidateDigest: 'c'.repeat(64), resultIdentity: 'd'.repeat(64) }

  await authority.createPendingAttemptAuthority(artifacts, prior)
  await authority.stageAttemptCandidate(artifacts, prior)
  await authority.writeTerminalAttemptResult(artifacts, { ...prior, status: 'passed' })
  await authority.finalizeAttemptAuthority(artifacts, { ...prior, status: 'passed' })
  assert.equal((await authority.evaluateAttemptAuthority(artifacts, prior)).accepted, true, 'the older durable attempt must be a real accepted baseline before current-attempt isolation is tested')

  const harnessSource = await readFile(new URL('../src/harness.ts', import.meta.url), 'utf8')
  assert.equal(/from ['"]\.\/attempt-authority\.ts['"]/.test(harnessSource), true, 'the real normal harness must import the authority decision module')
  assert.equal(/evaluateAttemptAuthority/.test(harnessSource), true, 'the real normal harness must consume the authority decision before accepting a boot result')

  const runHarnessWithAuthorityFault = runNormalHarness as unknown as NormalHarnessWithFinal46AttemptTestOptions
  const harnessExitCode = await runHarnessWithAuthorityFault(artifacts, {
    testFaults: {
      attemptAuthority: {
        currentAttempt: current,
        // This narrow in-memory seam is reached only after the current boot
        // candidate is staged. It forces the real terminal-authority write
        // path to fail, rather than manufacturing a supervisor control frame.
        afterCandidate: 'force-terminal-authority-failure',
      },
    },
  })
  const summaryText = await readFile(join(artifacts, 'result.json'), 'utf8')
  const summary = JSON.parse(summaryText) as {
    status?: unknown
    attemptAuthority?: { attemptId?: unknown; candidateDigest?: unknown; resultIdentity?: unknown; accepted?: unknown; status?: unknown }
  }
  const currentAuthority = await readFile(authority.authorityArtifactPath(artifacts, current.attemptId), 'utf8')
  const currentTerminal = await readFile(authority.terminalResultArtifactPath(artifacts, current.attemptId), 'utf8')
  const authorityRecord = JSON.parse(currentAuthority) as { attemptId?: unknown; candidateDigest?: unknown; resultIdentity?: unknown; status?: unknown }
  const terminalRecord = JSON.parse(currentTerminal) as { attemptId?: unknown; candidateDigest?: unknown; resultIdentity?: unknown; status?: unknown }
  assert.notEqual(harnessExitCode, 0, 'the real normal harness must fail after the current terminal authority failure')
  assert.equal(summary.status, 'failed', 'the real normal harness must publish a failed result summary')
  assert.equal(summary.attemptAuthority?.attemptId, current.attemptId, 'the harness result must name the current attempt, never the prior pass')
  assert.equal(summary.attemptAuthority?.candidateDigest, current.candidateDigest, 'the harness result must bind the current staged candidate digest')
  assert.equal(summary.attemptAuthority?.resultIdentity, current.resultIdentity, 'the harness result must bind the current terminal result identity')
  assert.equal(summary.attemptAuthority?.accepted, false, 'the harness result must make current authority rejection explicit')
  assert.equal(summary.attemptAuthority?.status, 'failed', 'the harness result must retain the current terminal authority failure')
  assert.equal(authorityRecord.attemptId, current.attemptId, 'the durable current authority must name only the current attempt')
  assert.equal(authorityRecord.candidateDigest, current.candidateDigest, 'the durable current authority must bind its exact staged candidate digest')
  assert.equal(authorityRecord.resultIdentity, current.resultIdentity, 'the durable current authority must bind its exact terminal result identity')
  assert.equal(authorityRecord.status, 'failed', 'the current candidate terminal/replacement failure must be durable')
  assert.equal(terminalRecord.attemptId, current.attemptId, 'the terminal result must bind the same current attempt')
  assert.equal(terminalRecord.candidateDigest, current.candidateDigest, 'the terminal result must bind the same current candidate digest')
  assert.equal(terminalRecord.resultIdentity, current.resultIdentity, 'the terminal result must bind the same current result identity')
  assert.equal(terminalRecord.status, 'failed', 'the terminal result must retain its failure status')
  assertNoRawRuntimeIdentity(currentAuthority, 'durable current authority must not expose raw runtime identity')
  assertNoRawRuntimeIdentity(currentTerminal, 'durable current terminal result must not expose raw runtime identity')
  assertNoRawRuntimeIdentity(summaryText, 'the real harness result summary must not expose raw runtime identity')
  assert.equal((await authority.evaluateAttemptAuthority(artifacts, current)).accepted, false, 'a prior durable pass must not authorize the current failed candidate')
})

test('S2-F46-AUTHORITY-BINDING-04 missing pending malformed or mismatched authority and terminal binding fail closed with exact attempt candidate digest and result identity', {
  timeout: 18_000,
}, async (t: TestContext) => {
  const artifacts = await mkdtemp(join(tmpdir(), 'guidelane-f46-authority-binding-'))
  t.after(async () => rm(artifacts, { recursive: true, force: true }))
  const authority = await loadAttemptAuthorityFixtureModule()
  for (const authorityCase of ['missing', 'pending', 'malformed', 'candidate-mismatch', 'result-mismatch', 'terminal-mismatch'] as const) {
    const expected = { attemptId: `f46-${authorityCase}-attempt`, candidateDigest: 'e'.repeat(64), resultIdentity: 'f'.repeat(64) }
    if (authorityCase !== 'missing') {
      await authority.createPendingAttemptAuthority(artifacts, expected)
      await authority.stageAttemptCandidate(artifacts, expected)
    }
    if (authorityCase === 'malformed') {
      await writeFile(authority.authorityArtifactPath(artifacts, expected.attemptId), '{', 'utf8')
    } else if (authorityCase !== 'pending' && authorityCase !== 'missing') {
      const persisted = {
        attemptId: expected.attemptId,
        candidateDigest: authorityCase === 'candidate-mismatch' ? '0'.repeat(64) : expected.candidateDigest,
        resultIdentity: authorityCase === 'result-mismatch' ? '1'.repeat(64) : expected.resultIdentity,
      }
      await authority.writeTerminalAttemptResult(artifacts, { ...persisted, status: authorityCase === 'terminal-mismatch' ? 'failed' : 'passed' })
      await authority.finalizeAttemptAuthority(artifacts, { ...persisted, status: 'passed' })
      assertNoRawRuntimeIdentity(await readFile(authority.authorityArtifactPath(artifacts, expected.attemptId), 'utf8'), 'durable authority test fixture must remain redacted')
      assertNoRawRuntimeIdentity(await readFile(authority.terminalResultArtifactPath(artifacts, expected.attemptId), 'utf8'), 'durable terminal result test fixture must remain redacted')
    }
    assert.equal((await authority.evaluateAttemptAuthority(artifacts, expected)).accepted, false, `${authorityCase} authority/result binding must fail closed through the production authority consumer`)
  }
})

test('S2-F46-SOURCE-STRUCTURAL-05 all scoped Local Web sources forbid parent negative-PGID signalling and persist no raw runtime identity authority', async () => {
  const sourceEntries = [
    ['command.ts', new URL('../src/command.ts', import.meta.url)],
    ['harness.ts', new URL('../src/harness.ts', import.meta.url)],
    ['attempt-authority.ts', new URL('../src/attempt-authority.ts', import.meta.url)],
    ['server-supervisor.mjs', new URL('../src/server-supervisor.mjs', import.meta.url)],
    ['evidence.ts', new URL('../src/evidence.ts', import.meta.url)],
    ['cli.ts', new URL('../src/cli.ts', import.meta.url)],
    ['generator.ts', new URL('../src/generator.ts', import.meta.url)],
    ['git.ts', new URL('../src/git.ts', import.meta.url)],
    ['index.ts', new URL('../src/index.ts', import.meta.url)],
    ['target-path.ts', new URL('../src/target-path.ts', import.meta.url)],
    ['types.ts', new URL('../src/types.ts', import.meta.url)],
  ] as const
  const sources = await Promise.all(sourceEntries.map(async ([name, url]) => [name, await readFile(url, 'utf8')] as const))
  const negativePgidCall = /(?:\bkill|process\.kill)\s*\(\s*-\s*[A-Za-z0-9_.]+\s*,/g
  const negativePgidLocations = sources.flatMap(([name, source]) => [...source.matchAll(negativePgidCall)].map(() => name))
  assert.deepEqual(negativePgidLocations, ['server-supervisor.mjs'], 'the full Local Web production source scope permits exactly one negative-PGID call, in the detached supervisor only')

  const supervisorSource = sources.find(([name]) => name === 'server-supervisor.mjs')?.[1]
  assert.notEqual(supervisorSource, undefined, 'the scoped supervisor source must be present')
  assert.equal(/process\.kill\s*\(\s*-\s*process\.pid\s*,/.test(supervisorSource!), true, 'the sole negative-PGID route must target the supervisor current self group')
  const parentSources = sources.filter(([name]) => name !== 'server-supervisor.mjs').map(([, source]) => source).join('\n')
  assert.doesNotMatch(parentSources, /(?:\bkill|process\.kill)\s*\(\s*-\s*[A-Za-z0-9_.]+\s*,/, 'no parent or other Local Web source may signal a negative PGID')

  const authoritySource = sources.find(([name]) => name === 'attempt-authority.ts')?.[1]
  assert.notEqual(authoritySource, undefined, 'the scoped attempt-authority module must be present')
  assert.equal(/\battemptId\b/.test(authoritySource!), true, 'attempt authority must bind a fresh attempt identity')
  assert.equal(/\bcandidateDigest\b/.test(authoritySource!), true, 'attempt authority must bind the staged candidate digest')
  assert.equal(/\bresultIdentity\b/.test(authoritySource!), true, 'attempt authority must bind the terminal harness result identity')
  assert.equal(/\b(?:pid|pgid|startedAt|port|nonce)\b/i.test(authoritySource!), false, 'the authority module must not persist or otherwise carry raw runtime identity fields')
})
