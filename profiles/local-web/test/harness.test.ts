import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile } from 'node:fs/promises'
import { createServer, type AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { runNormalHarness, runSeededHarness } from '../src/harness.ts'

interface ProcessReceipt {
  pid: number
  pgid: number
  startedAt: string
}

interface LiveServerObservation {
  baseUrl: string
  port: number
  bootInstanceNonce: string
  receipt: ProcessReceipt
}

interface NormalHarnessTestLifecycleObserver {
  port: number
  onLiveServerReady: (server: LiveServerObservation) => void | Promise<void>
}

interface NormalHarnessTestOptions {
  testLifecycleObserver: NormalHarnessTestLifecycleObserver
}

type NormalHarnessWithTestLifecycleObserver = (artifacts: string, options: NormalHarnessTestOptions) => Promise<number>

const supportsPosixOwnedGroupObservation = (process.platform === 'darwin' || process.platform === 'linux')
  && spawnSync('/bin/ps', ['-o', 'pid=', '-o', 'pgid=', '-o', 'lstart=', '-p', String(process.pid)], { stdio: 'ignore' }).status === 0
  && spawnSync('/usr/bin/pgrep', ['-g', String(process.pid)], { stdio: 'ignore' }).error === undefined

async function selectTestOwnedLoopbackPort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen({ host: '127.0.0.1', port: 0 }, () => resolve())
  })
  const port = (server.address() as AddressInfo | null)?.port
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
  })
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
  if (bound) {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve())
    })
  }
  return bound
}

function receiptIsWellFormed(receipt: ProcessReceipt): boolean {
  return Number.isSafeInteger(receipt.pid)
    && receipt.pid > 0
    && receipt.pgid === receipt.pid
    && typeof receipt.startedAt === 'string'
    && receipt.startedAt.length > 0
}

function escapedForRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function receiptStillOwnsItsLeader(receipt: ProcessReceipt): boolean {
  const observation = spawnSync('/bin/ps', ['-o', 'pid=', '-o', 'pgid=', '-o', 'lstart=', '-p', String(receipt.pid)], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: 100,
  })
  if (observation.status !== 0) return false
  const match = /^\s*(\d+)\s+(\d+)\s+(.+?)\s*$/.exec(observation.stdout)
  return match !== null
    && Number(match[1]) === receipt.pid
    && Number(match[2]) === receipt.pgid
    && match[3]?.trim() === receipt.startedAt
}

function verifiedOwnedGroupIsAbsent(receipt: ProcessReceipt): boolean {
  const observation = spawnSync('/usr/bin/pgrep', ['-g', String(receipt.pgid)], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: 100,
  })
  if (observation.status === 1) return true
  if (observation.status === 0) return false
  throw new Error('could not inspect the verified test-owned process group')
}

async function waitForVerifiedOwnedGroupAbsence(receipt: ProcessReceipt, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (verifiedOwnedGroupIsAbsent(receipt)) return true
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  return verifiedOwnedGroupIsAbsent(receipt)
}

async function reapVerifiedOwnedGroupForTest(receipt: ProcessReceipt | undefined): Promise<void> {
  if (!receipt || !receiptIsWellFormed(receipt) || verifiedOwnedGroupIsAbsent(receipt)) return
  if (!receiptStillOwnsItsLeader(receipt)) return
  try {
    process.kill(-receipt.pgid, 'SIGTERM')
  } catch {
    return
  }
  if (await waitForVerifiedOwnedGroupAbsence(receipt, 1_000)) return
  // Never signal after the recorded leader has exited: a stale receipt has no
  // authority over a potentially reused process group.
  if (!receiptStillOwnsItsLeader(receipt)) return
  try {
    process.kill(-receipt.pgid, 'SIGKILL')
  } catch {
    return
  }
  await waitForVerifiedOwnedGroupAbsence(receipt, 500)
}

test('normal profile harness passes seven individually addressable gates', async () => {
  const artifacts = await mkdtemp(join(tmpdir(), 'guidelane-local-web-normal-evidence-'))
  assert.equal(await runNormalHarness(artifacts), 0)
  const result = JSON.parse(await readFile(join(artifacts, 'result.json'), 'utf8')) as { status: string; completedGates: string[] }
  assert.equal(result.status, 'passed')
  assert.deepEqual(result.completedGates, ['lint', 'type', 'unit', 'build', 'boot', 'axe', 'smoke'])
})

test('S2-F44-LOCAL-WEB-ORPHAN-CLEANUP normal harness reaps its real generated Next server and verified group before returning', {
  skip: supportsPosixOwnedGroupObservation ? false : 'requires explicit POSIX process-group observation support',
  timeout: 480_000,
}, async () => {
  const port = await selectTestOwnedLoopbackPort()
  const artifacts = await mkdtemp(join(tmpdir(), 'guidelane-local-web-normal-orphan-cleanup-'))
  let observedServer: LiveServerObservation | undefined
  try {
    // This guard intentionally makes the test RED before invoking the current
    // one-argument harness, so missing observer support cannot create a server.
    assert.equal(runNormalHarness.length, 2, 'normal harness must require the narrow test lifecycle observer parameter')
    const runWithObserver = runNormalHarness as unknown as NormalHarnessWithTestLifecycleObserver
    const result = await runWithObserver(artifacts, {
      testLifecycleObserver: {
        port,
        onLiveServerReady: async (server) => {
          assert.equal(observedServer === undefined, true, 'the normal harness must report one owned live server')
          observedServer = server
          assert.equal(server.port === port && server.baseUrl === `http://127.0.0.1:${port}`, true, 'the observer must receive the supplied test-owned loopback endpoint')
          assert.equal(receiptIsWellFormed(server.receipt), true, 'the observer must receive a verified detached ownership receipt')

          const response = await fetch(new URL('/api/health', server.baseUrl), { signal: AbortSignal.timeout(2_000) })
          const body = await response.json() as { ok?: unknown; service?: unknown; bootInstanceNonce?: unknown }
          assert.equal(response.ok && body.ok === true && body.service === 'local-web' && body.bootInstanceNonce === server.bootInstanceNonce, true, 'the live generated health endpoint must authenticate its unique server nonce')
        },
      },
    })

    assert.equal(result, 0, 'a normal harness with verified cleanup must pass')
    assert.notEqual(observedServer, undefined, 'the test observer must see the real generated Next server while live')
    assert.equal(await canBindTestOwnedLoopbackPort(port), true, 'the test-owned loopback port must no longer listen when the harness returns')
    assert.equal(verifiedOwnedGroupIsAbsent(observedServer!.receipt), true, 'the verified test-owned server group must be absent when the harness returns')
  } finally {
    await reapVerifiedOwnedGroupForTest(observedServer?.receipt)
  }
})

test('S2-F44-LOCAL-WEB-OBSERVER-FAILURE rejects the observer and reaps its verified generated Next group', {
  skip: supportsPosixOwnedGroupObservation ? false : 'requires explicit POSIX process-group observation support',
  timeout: 480_000,
}, async () => {
  const port = await selectTestOwnedLoopbackPort()
  const artifacts = await mkdtemp(join(tmpdir(), 'guidelane-local-web-normal-observer-failure-'))
  let observedServer: LiveServerObservation | undefined
  try {
    const runWithObserver = runNormalHarness as unknown as NormalHarnessWithTestLifecycleObserver
    const result = await runWithObserver(artifacts, {
      testLifecycleObserver: {
        port,
        onLiveServerReady: async (server) => {
          assert.equal(observedServer === undefined, true, 'the observer rejection fixture must see one owned live server')
          observedServer = server
          assert.equal(server.port === port && server.baseUrl === `http://127.0.0.1:${port}`, true, 'the observer must receive the supplied test-owned loopback endpoint')
          assert.equal(receiptIsWellFormed(server.receipt), true, 'the observer must receive a verified detached ownership receipt')

          const response = await fetch(new URL('/api/health', server.baseUrl), { signal: AbortSignal.timeout(2_000) })
          const body = await response.json() as { ok?: unknown; service?: unknown; bootInstanceNonce?: unknown }
          assert.equal(response.ok && body.ok === true && body.service === 'local-web' && body.bootInstanceNonce === server.bootInstanceNonce, true, 'the observer must reject only after authenticating the live server nonce')
          throw new Error('intentional test observer rejection')
        },
      },
    })

    assert.notEqual(result, 0, 'an observer rejection must make the normal harness fail closed')
    assert.notEqual(observedServer, undefined, 'the observer rejection fixture must capture the live generated server')
    assert.equal(await canBindTestOwnedLoopbackPort(port), true, 'the test-owned loopback port must no longer listen after observer rejection returns')
    assert.equal(verifiedOwnedGroupIsAbsent(observedServer!.receipt), true, 'the verified test-owned server group must be absent after observer rejection returns')

    const serializedSummary = await readFile(join(artifacts, 'result.json'), 'utf8')
    const summary = JSON.parse(serializedSummary) as {
      status?: unknown
      cleanup?: { lifecycleStage?: unknown; ownershipVerified?: unknown; reaped?: unknown; receiptDigest?: unknown }
    }
    assert.equal(summary.status, 'failed', 'observer rejection must persist a failed normal summary')
    assert.equal(summary.cleanup?.lifecycleStage, 'reaped', 'the summary must record semantic reaped lifecycle cleanup')
    assert.equal(summary.cleanup?.ownershipVerified, true, 'the summary must record verified cleanup ownership')
    assert.equal(summary.cleanup?.reaped, true, 'the summary must record successful process-group reaping')
    assert.match(typeof summary.cleanup?.receiptDigest === 'string' ? summary.cleanup.receiptDigest : '', /^[a-f0-9]{64}$/, 'the summary must retain only an opaque receipt digest')

    for (const rawValue of [String(port), String(observedServer!.receipt.pid), String(observedServer!.receipt.pgid)]) {
      assert.equal(new RegExp(`\\b${escapedForRegex(rawValue)}\\b`).test(serializedSummary), false, 'the serialized summary must not expose raw lifecycle numeric identity')
    }
    assert.equal(serializedSummary.includes(observedServer!.bootInstanceNonce), false, 'the serialized summary must not expose the live server nonce')
    assert.equal(serializedSummary.includes(observedServer!.receipt.startedAt), false, 'the serialized summary must not expose the receipt start time')
  } finally {
    await reapVerifiedOwnedGroupForTest(observedServer?.receipt)
  }
})

test('workspace test runner serializes profile files so generated harness projects do not overlap', async () => {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as { scripts: { test: string } }
  assert.match(manifest.scripts.test, /--test-concurrency=1\b/)
})

test('seeded profile harness rejects every named gate in an isolated project', async () => {
  const artifacts = await mkdtemp(join(tmpdir(), 'guidelane-local-web-seeded-evidence-'))
  assert.equal(await runSeededHarness(artifacts), 0)
  const result = JSON.parse(await readFile(join(artifacts, 'result.json'), 'utf8')) as { status: string; artifactPaths: string[] }
  assert.equal(result.status, 'passed')
  assert.equal(result.artifactPaths.length, 7)
})
