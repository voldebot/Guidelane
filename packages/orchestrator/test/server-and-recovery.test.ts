import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { request } from 'node:http'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { EngineSession, SessionRegistry, loadSurface } from '../../engine/src/index.ts'
import { createLoopbackServer, Orchestrator } from '../src/index.ts'
import { projectId, testGitHead, withTempDir, writeSignedAttempt } from './helpers.ts'

const launchToken = '0123456789abcdef0123456789abcdef'
const engineFixture = fileURLToPath(new URL('../../engine/test/fixtures/fake-engine.mjs', import.meta.url))
const streamSurface = loadSurface(fileURLToPath(new URL('../../../tools/probe/stream-surface.json', import.meta.url)))
type FakeReceipt = { attemptId: string; pgid: number; pid: number; grandchildPid: number; startIdentity: string }

async function eventually<T>(read: () => Promise<T>, predicate: (value: T) => boolean, label: string): Promise<T> {
  const deadline = Date.now() + 2_000
  let last: T | undefined
  while (Date.now() < deadline) {
    last = await read()
    if (predicate(last)) return last
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`timed out waiting for ${label}; last=${JSON.stringify(last)}`)
}

async function readReceipt(path: string): Promise<FakeReceipt | null> {
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch (error: unknown) {
    // The fixture may be observed while its receipt is being replaced. This is
    // not receipt evidence yet; eventually() remains bounded and retries.
    if (error instanceof SyntaxError) return null
    throw error
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('fake engine receipt schema mismatch')
  const receipt = value as Record<string, unknown>
  if (typeof receipt.attemptId !== 'string' || !receipt.attemptId || !Number.isInteger(receipt.pgid) || !Number.isInteger(receipt.pid) || !Number.isInteger(receipt.grandchildPid) || typeof receipt.startIdentity !== 'string' || !receipt.startIdentity) throw new Error('fake engine receipt schema mismatch')
  return receipt as FakeReceipt
}

async function waitForReceipt(path: string): Promise<FakeReceipt> {
  const receipt = await eventually(
    () => readReceipt(path),
    (value) => value !== null,
    'fake engine receipt'
  )
  if (receipt === null) throw new Error('fake engine receipt unexpectedly missing after successful wait')
  return receipt
}

function observedStartIdentity(pid: number): string {
  return execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8' }).trim()
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function rawStatus(url: string, path: string, headers: Record<string, string>): Promise<number> {
  return new Promise((resolve, reject) => {
    const target = new URL(url)
    const req = request({ hostname: target.hostname, port: target.port, path, headers }, (response) => {
      response.resume()
      resolve(response.statusCode ?? 0)
    })
    req.once('error', reject)
    req.end()
  })
}

test('S2-ENGINE-RECEIPT-01 an engine receipt without the production wrapper identity is never reconciled or signalled', {
  skip: process.platform === 'win32' ? 'POSIX process-group reconciliation is unavailable on Windows' : false,
}, async () => {
  const engine = new EngineSession({
    claudeBin: process.execPath,
    args: [engineFixture],
    ambient: true,
    cwd: process.cwd(),
    registry: new SessionRegistry(),
    surface: streamSurface,
    expect: { modelAlias: 'haiku', apiKeySource: 'none', versionRange: ['2.1.220', '2.1.999'] },
  })
  const stopped = new Promise<void>((resolve) => engine.once('closed', () => resolve()))
  engine.start()
  try {
    const receipt = engine.processReceipt as (NonNullable<typeof engine.processReceipt> & { startIdentity?: unknown }) | null
    assert.ok(receipt, 'a started EngineSession must expose a durable process receipt')
    assert.equal(typeof receipt.startIdentity, 'string', 'the public receipt must include an OS-observed start identity')
    assert.notEqual(receipt.startIdentity, '', 'the start identity must not be empty')
    assert.equal(receipt.startIdentity, observedStartIdentity(receipt.pid), 'the receipt must identify this exact spawned process, not only its PID')

    await withTempDir(async (root) => {
      await writeSignedAttempt(root, 'engine-session-receipt', { receipt: { ...receipt, nonce: 'a'.repeat(64) } })
      const orchestrator = await Orchestrator.open({ root, projectId, gitHead: testGitHead })
      try {
        assert.deepEqual(await orchestrator.reconcile(), { interruptedAttemptIds: [] })
        assert.equal((await orchestrator.snapshot()).runState, 'recovery-required')
        assert.equal((await orchestrator.attempt('engine-session-receipt')).status, 'recovery-required')
      } finally {
        await orchestrator.close()
      }
    })
  } finally {
    engine.stop()
    await Promise.race([stopped, new Promise<void>((resolve) => setTimeout(resolve, 1_000))])
  }
})

test('loopback API consumes one 128-bit launch token once and enforces Origin, Host, and SameSite session trust', async () => {
  await withTempDir(async (root) => {
    const orchestrator = await Orchestrator.open({ root, projectId, gitHead: testGitHead })
    const server = await createLoopbackServer({ orchestrator, port: 0, launchToken })
    try {
      assert.match(server.origin, /^http:\/\/127\.0\.0\.1:\d+$/)

      const badHost = await rawStatus(server.origin, '/api/v1/session', {
        Host: 'localhost:5173',
        Origin: server.origin,
      })
      assert.equal(badHost, 403)

      const badOrigin = await fetch(`${server.origin}/api/v1/session`, {
        method: 'POST',
        headers: { Origin: 'http://evil.example', 'content-type': 'application/json' },
        body: JSON.stringify({ launchToken }),
      })
      assert.equal(badOrigin.status, 403)

      const badToken = await fetch(`${server.origin}/api/v1/session`, {
        method: 'POST',
        headers: { Origin: server.origin, 'content-type': 'application/json' },
        body: JSON.stringify({ launchToken: 'not-a-128-bit-token' }),
      })
      assert.equal(badToken.status, 401)

      const exchange = await fetch(`${server.origin}/api/v1/session`, {
        method: 'POST',
        headers: { Origin: server.origin, 'content-type': 'application/json' },
        body: JSON.stringify({ launchToken }),
      })
      assert.equal(exchange.status, 204)
      const cookie = exchange.headers.get('set-cookie')
      assert.match(cookie ?? '', /HttpOnly/i)
      assert.match(cookie ?? '', /SameSite=Strict/i)
      assert.match(cookie ?? '', /Path=\//i)

      const replay = await fetch(`${server.origin}/api/v1/session`, {
        method: 'POST',
        headers: { Origin: server.origin, 'content-type': 'application/json' },
        body: JSON.stringify({ launchToken }),
      })
      assert.equal(replay.status, 401)

      const rejectedWebSocket = await rawStatus(server.origin, '/api/v1/events', {
        Host: new URL(server.origin).host,
        Origin: 'http://evil.example',
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Version': '13',
        'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
        Cookie: cookie ?? '',
      })
      assert.equal(rejectedWebSocket, 403)

      const rejectedCommand = await fetch(`${server.origin}/api/v1/projects/current/commands`, {
        method: 'POST',
        headers: { Origin: server.origin, Cookie: cookie ?? '', 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'startBuild', injected: 'not part of the schema' }),
      })
      assert.equal(rejectedCommand.status, 400)
    } finally {
      await server.close()
    }
  })
})

test('S2-HTTP-COMPAT-10 authenticated canonical snapshot GET permits omitted Origin but never relaxes mutating routes', async () => {
  await withTempDir(async (root) => {
    const orchestrator = await Orchestrator.open({ root, projectId, gitHead: testGitHead })
    const server = await createLoopbackServer({ orchestrator, port: 0, launchToken: 'abcdef0123456789abcdef0123456789' })
    try {
      const session = await fetch(`${server.origin}/api/v1/session`, {
        method: 'POST',
        headers: { Origin: server.origin, 'content-type': 'application/json' },
        body: JSON.stringify({ launchToken: 'abcdef0123456789abcdef0123456789' }),
      })
      assert.equal(session.status, 204)
      const cookie = session.headers.get('set-cookie') ?? ''

      // Chromium omits Origin on this read-only same-origin request. Exact Host
      // and the authenticated SameSite session still make it an allowed read.
      assert.equal((await fetch(`${server.origin}/api/v1/projects/current`, { headers: { Cookie: cookie } })).status, 200)
      assert.equal((await fetch(`${server.origin}/api/v1/projects/current`, {
        headers: { Cookie: cookie, Origin: 'http://evil.example' },
      })).status, 403)
      assert.equal((await fetch(`${server.origin}/api/v1/projects/current/commands`, {
        method: 'POST',
        headers: { Cookie: cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'submitIdea', idea: 'Güvenli fikir' }),
      })).status, 403)
      assert.equal((await fetch(`${server.origin}/api/v1/projects`, {
        method: 'POST',
        headers: { Cookie: cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ projectId }),
      })).status, 403)
    } finally {
      await server.close()
    }
  })
})

test('ORCH-FINAL-37 authenticated canonical snapshot GET returns no-store and preserves the read-only Origin exception', async () => {
  await withTempDir(async (root) => {
    const orchestrator = await Orchestrator.open({ root, projectId, gitHead: testGitHead })
    const server = await createLoopbackServer({ orchestrator, port: 0, launchToken: 'fedcba9876543210fedcba9876543210' })
    try {
      const session = await fetch(`${server.origin}/api/v1/session`, {
        method: 'POST',
        headers: { Origin: server.origin, 'content-type': 'application/json' },
        body: JSON.stringify({ launchToken: 'fedcba9876543210fedcba9876543210' }),
      })
      assert.equal(session.status, 204)
      const cookie = session.headers.get('set-cookie') ?? ''

      const originlessSnapshot = await fetch(`${server.origin}/api/v1/projects/current`, { headers: { Cookie: cookie } })
      assert.equal(originlessSnapshot.status, 200)
      assert.equal(originlessSnapshot.headers.get('cache-control'), 'no-store')

      const evilOriginSnapshot = await fetch(`${server.origin}/api/v1/projects/current`, {
        headers: { Cookie: cookie, Origin: 'http://evil.example' },
      })
      assert.equal(evilOriginSnapshot.status, 403)
    } finally {
      await server.close()
    }
  })
})

test('an unwrapped orphan receipt fails closed without signalling its engine group or allowing reuse', {
  skip: process.platform === 'win32' ? 'POSIX process groups are unavailable on Windows' : false,
}, async (t) => {
  await withTempDir(async (root) => {
    const receiptPath = join(root, 'receipt.json')
    const fixture = join(process.cwd(), 'packages/orchestrator/test-fixtures/fake-engine-grandchild.mjs')
    const supervisor = spawn(process.execPath, [fixture, receiptPath], { detached: true, stdio: 'ignore' })
    supervisor.unref()

    let receipt: FakeReceipt | null = null
    let orchestrator: Orchestrator | undefined
    try {
      const orphanedReceipt = await waitForReceipt(receiptPath)
      receipt = orphanedReceipt
      process.kill(supervisor.pid!, 'SIGKILL')
      assert.equal(orphanedReceipt.startIdentity, observedStartIdentity(orphanedReceipt.pid), 'receipt must bind the OS-observed process start identity')

      await writeSignedAttempt(root, orphanedReceipt.attemptId, { receipt: { ...orphanedReceipt, nonce: 'a'.repeat(64) } })
      orchestrator = await Orchestrator.open({ root, projectId, gitHead: testGitHead })
      await t.test('B1-01 rejects a receipt that lacks a live production wrapper identity', async () => {
        const reconciliation = await orchestrator!.reconcile()
        assert.deepEqual(reconciliation.interruptedAttemptIds, [])
        const first = await orchestrator!.attempt(orphanedReceipt.attemptId)
        assert.equal(first.status, 'recovery-required')
        assert.equal(isAlive(orphanedReceipt.grandchildPid), true, 'an unwrapped provider process must never be signalled')
      })

      await t.test('B1-06 interrupted work cannot resume and the next attempt has a distinct identity', async () => {
        await assert.rejects(
          orchestrator!.launchAttempt({ phase: 'build', attemptId: orphanedReceipt.attemptId, command: process.execPath, args: [], cwd: root, env: { PATH: process.env.PATH ?? '' } }),
          /immutable|attempt|exists|recovery/i,
          'an unattributable immutable attempt identity can never be reused'
        )
      })
    } finally {
      await orchestrator?.close()
      if (receipt !== null) {
        try {
          process.kill(-receipt.pgid, 'SIGKILL')
        } catch {
          // Reconciliation is expected to have already reaped it.
        }
      }
      try {
        process.kill(supervisor.pid!, 'SIGKILL')
      } catch {
        // The test intentionally kills this supervisor.
      }
    }
  })
})

test('B1 reconciliation refuses a receipt whose verified PID identity belongs to a different recorded process group', {
  skip: process.platform === 'win32' ? 'POSIX process groups are unavailable on Windows' : false,
}, async () => {
  await withTempDir(async (root) => {
    const fixture = join(process.cwd(), 'packages/orchestrator/test-fixtures/fake-engine-grandchild.mjs')
    const supervisorA = spawn(process.execPath, [fixture, join(root, 'receipt-a.json')], { detached: true, stdio: 'ignore' })
    const supervisorB = spawn(process.execPath, [fixture, join(root, 'receipt-b.json')], { detached: true, stdio: 'ignore' })
    supervisorA.unref(); supervisorB.unref()
    let receiptA: FakeReceipt | null = null
    let receiptB: FakeReceipt | null = null
    let orchestrator: Orchestrator | undefined
    try {
      receiptA = await waitForReceipt(join(root, 'receipt-a.json'))
      receiptB = await waitForReceipt(join(root, 'receipt-b.json'))
      process.kill(supervisorA.pid!, 'SIGKILL')
      process.kill(supervisorB.pid!, 'SIGKILL')
      assert.equal(receiptA.startIdentity, observedStartIdentity(receiptA.pid), 'receipt A must bind a live PID identity')
      assert.equal(receiptB.startIdentity, observedStartIdentity(receiptB.pid), 'receipt B must bind a live PID identity')

      await writeSignedAttempt(root, 'cross-group-receipt', { receipt: { pid: receiptA.pid, pgid: receiptB.pgid, startIdentity: receiptA.startIdentity, nonce: 'a'.repeat(64) } })
      orchestrator = await Orchestrator.open({ root, projectId, gitHead: testGitHead })
      assert.deepEqual(await orchestrator.reconcile(), { interruptedAttemptIds: [] })
      const recovery = await orchestrator.snapshot()
      assert.equal(recovery.runState, 'recovery-required')
      assert.equal(recovery.pendingDecision, null)
      assert.equal(isAlive(receiptA.pid), true, 'the verified PID group must not be signalled through a mismatched PGID')
      assert.equal(isAlive(receiptA.grandchildPid), true, 'the verified PID descendants must remain alive')
      assert.equal(isAlive(receiptB.pid), true, 'the recorded but mismatched PGID group must not be signalled')
      assert.equal(isAlive(receiptB.grandchildPid), true, 'the recorded PGID descendants must remain alive')
    } finally {
      await orchestrator?.close()
      for (const receipt of [receiptA, receiptB]) {
        if (receipt !== null) {
          try { process.kill(-receipt.pgid, 'SIGKILL') } catch { /* test-owned group cleanup */ }
        }
      }
      for (const supervisor of [supervisorA, supervisorB]) {
        try { process.kill(supervisor.pid!, 'SIGKILL') } catch { /* test-owned supervisor cleanup */ }
      }
    }
  })
})

const unverifiableReceiptCases = [
  {
    title: 'B1-02 invalid receipt coordinates durably recovers the canonical snapshot and never signals an unverifiable process group',
    isInvalidCoordinates: true,
    receiptTransform: (receipt: FakeReceipt): Record<string, unknown> => ({ ...receipt, pid: 0, pgid: 0 }),
  },
  {
    title: 'B1-04 missing start identity durably recovers the canonical snapshot and never signals an unverifiable process group',
    isInvalidCoordinates: false,
    receiptTransform: (receipt: FakeReceipt): Record<string, unknown> => {
    const { startIdentity: _startIdentity, ...withoutIdentity } = receipt
    return withoutIdentity
    },
  },
  {
    title: 'B1-05 mismatched start identity durably recovers the canonical snapshot and never signals an unverifiable process group',
    isInvalidCoordinates: false,
    receiptTransform: (receipt: FakeReceipt): Record<string, unknown> => ({ ...receipt, startIdentity: 'Thu Jan  1 00:00:00 1970' }),
  },
] as const
for (const { title, isInvalidCoordinates, receiptTransform } of unverifiableReceiptCases) {
  test(title, {
    skip: process.platform === 'win32' ? 'POSIX process groups are unavailable on Windows' : false,
  }, async () => {
    await withTempDir(async (root) => {
      const receiptPath = join(root, 'receipt.json')
      const fixture = join(process.cwd(), 'packages/orchestrator/test-fixtures/fake-engine-grandchild.mjs')
      const supervisor = spawn(process.execPath, [fixture, receiptPath], { detached: true, stdio: 'ignore' })
      supervisor.unref()
      let receipt: FakeReceipt | null = null
      try {
        receipt = await waitForReceipt(receiptPath)
        process.kill(supervisor.pid!, 'SIGKILL')
        assert.equal(receipt.startIdentity, observedStartIdentity(receipt.pid), 'fixture identity must be OS-observed')

        await writeSignedAttempt(root, receipt.attemptId, { receipt: receiptTransform({ ...receipt, nonce: 'a'.repeat(64) } as FakeReceipt) })
        const orchestrator = await Orchestrator.open({ root, projectId, gitHead: testGitHead })
        try {
          const reconciliation = await orchestrator.reconcile()
          assert.deepEqual(reconciliation.interruptedAttemptIds, [])
          assert.equal(
            (await orchestrator.attempt(receipt.attemptId)).status,
            isInvalidCoordinates ? 'running' : 'recovery-required',
            'the durable fixture must retain either its active cleanup receipt or the completed recovery transition'
          )
          const recovered = await orchestrator.snapshot()
          assert.equal(recovered.runState, 'recovery-required', 'an unverifiable receipt must durably recover the canonical snapshot')
          assert.equal(recovered.pendingDecision, null, 'recovery must not retain a stale user decision')
          await assert.rejects(
            orchestrator.launchAttempt({ phase: 'build', command: process.execPath, args: [], cwd: root, env: { PATH: process.env.PATH ?? '' } }),
            /recovery|required|attempt|unsafe/i,
            'new work must be blocked after unverified recovery'
          )
          assert.equal(isAlive(receipt.pid), true, 'unverified identity must not receive a group signal')
          assert.equal(isAlive(receipt.grandchildPid), true, 'unverified identity must not reap engine descendants')
        } finally {
          await orchestrator.close()
        }

        const reopened = await Orchestrator.open({ root, projectId, gitHead: testGitHead })
        try {
          const recoveredAfterRestart = await reopened.snapshot()
          assert.equal(recoveredAfterRestart.runState, 'recovery-required', 'the recovery state must survive close and reopen')
          assert.equal(recoveredAfterRestart.pendingDecision, null, 'reopened recovery must not revive a user decision')
          await assert.rejects(
            reopened.launchAttempt({ phase: 'build', command: process.execPath, args: [], cwd: root, env: { PATH: process.env.PATH ?? '' } }),
            /recovery|required|attempt|unsafe/i,
            'reopened recovery must still block new work'
          )
        } finally {
          await reopened.close()
        }
      } finally {
        if (receipt !== null) {
          try { process.kill(-receipt.pgid, 'SIGKILL') } catch { /* test cleanup */ }
        }
        try { process.kill(supervisor.pid!, 'SIGKILL') } catch { /* test cleanup */ }
      }
    })
  })
}

for (const code of ['EPERM', 'EACCES'] as const) {
  test(`S2-FINAL-18-SIGNAL-07-${code} an indeterminate group signal probe durably recovers without marking the test-owned group interrupted`, {
    skip: process.platform === 'win32' ? 'POSIX process groups are unavailable on Windows' : false,
  }, async () => {
    await withTempDir(async (root) => {
      const receiptPath = join(root, `signal-${code}.json`)
      const fixture = join(process.cwd(), 'packages/orchestrator/test-fixtures/fake-engine-grandchild.mjs')
      const supervisor = spawn(process.execPath, [fixture, receiptPath], { detached: true, stdio: 'ignore' })
      supervisor.unref()
      let receipt: FakeReceipt | null = null
      let orchestrator: Orchestrator | undefined
      const realKill = process.kill
      const intercepted: Array<{ pid: number; signal: NodeJS.Signals | number | undefined }> = []
      try {
        receipt = await waitForReceipt(receiptPath)
        process.kill(supervisor.pid!, 'SIGKILL')
        await writeSignedAttempt(root, `signal-${code.toLowerCase()}`, { receipt: { ...receipt, nonce: 'a'.repeat(64) } })
        orchestrator = await Orchestrator.open({ root, projectId, gitHead: testGitHead })
        process.kill = ((pid: number, signal?: NodeJS.Signals | number) => {
          if (pid === -receipt!.pgid && (signal === 'SIGKILL' || signal === 0)) {
            intercepted.push({ pid, signal })
            const error = Object.assign(new Error(`${code} from this test-owned process group`), { code })
            throw error
          }
          return realKill(pid, signal!)
        }) as typeof process.kill

        assert.deepEqual(await orchestrator.reconcile(), { interruptedAttemptIds: [] })
        assert.equal((await orchestrator.attempt(`signal-${code.toLowerCase()}`)).status, 'recovery-required')
        const recovered = await orchestrator.snapshot()
        assert.equal(recovered.runState, 'recovery-required')
        assert.equal(recovered.pendingDecision, null)
        assert.deepEqual(intercepted.map(({ signal }) => signal), [0], 'an unwrapped provider receipt must fail closed during identity verification before any destructive group signal')
      } finally {
        process.kill = realKill
        await orchestrator?.close()
        if (receipt !== null) {
          try { process.kill(-receipt.pgid, 'SIGKILL') } catch { /* test-owned group cleanup */ }
        }
        try { process.kill(supervisor.pid!, 'SIGKILL') } catch { /* test-owned supervisor cleanup */ }
      }
    })
  })
}
