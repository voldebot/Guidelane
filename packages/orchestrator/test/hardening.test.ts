import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { connect } from 'node:net'
import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import { promisify } from 'node:util'
import { ArtifactStore, createLoopbackServer, Orchestrator, redactEvent } from '../src/index.ts'
import { advanceToG4, digest, launchIntentForTest, ownerPrivateDirectory, phaseRun, projectId, snapshot, testGitHead, withTempDir, writeSignedAttempt } from './helpers.ts'

type ServerOptions = Parameters<typeof createLoopbackServer>[0] & { launchTokenTtlMs?: number }
type OpenServer = Awaited<ReturnType<typeof createLoopbackServer>>

const execFileAsync = promisify(execFile)

const delay = (milliseconds: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, milliseconds))

async function waitForEngineMarker(path: string): Promise<{ pid: number }> {
  const deadline = Date.now() + 1_000
  while (Date.now() < deadline) {
    try {
      const marker = JSON.parse(await readFile(path, 'utf8')) as { pid?: unknown }
      if (typeof marker.pid === 'number' && Number.isInteger(marker.pid) && marker.pid > 0) return { pid: marker.pid }
      throw new Error('test-owned engine marker has no valid PID')
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error
      await delay(20)
    }
  }
  throw new Error('timed out waiting for the test-owned long-lived engine marker')
}

async function waitForProcessScanClean(pids: readonly number[], pgid: number, label: string): Promise<void> {
  const deadline = Date.now() + 2_000
  while (Date.now() < deadline) {
    const { stdout } = await execFileAsync('ps', ['-ax', '-o', 'pid=,pgid=,stat='])
    const live = stdout.split('\n').flatMap((line) => {
      const [pidText, pgidText, state] = line.trim().split(/\s+/, 3)
      const pid = Number(pidText)
      const observedPgid = Number(pgidText)
      return (pids.includes(pid) || observedPgid === pgid) && !state?.startsWith('Z') ? [{ pid, pgid: observedPgid, state }] : []
    })
    if (live.length === 0) return
    await delay(20)
  }
  throw new Error(`timed out reaping ${label}; process scan still found live members`)
}

async function reapTestOwnedProcessGroup(receipt: { pid: number; pgid: number } | undefined, enginePid: number | undefined): Promise<void> {
  if (!receipt) return
  try {
    process.kill(-receipt.pgid, 'SIGKILL')
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
  }
  await waitForProcessScanClean([receipt.pid, ...(enginePid === undefined ? [] : [enginePid])], receipt.pgid, 'test-owned wrapper and engine group')
}

async function startServer(options: ServerOptions): Promise<OpenServer> {
  return createLoopbackServer(options)
}

async function exchange(origin: string, launchToken: string): Promise<Response> {
  return fetch(`${origin}/api/v1/session`, {
    method: 'POST',
    headers: { Origin: origin, 'content-type': 'application/json' },
    body: JSON.stringify({ launchToken }),
  })
}

function websocket(origin: string, cookie: string): Promise<{ socket: ReturnType<typeof connect>; nextJson(timeoutMs?: number): Promise<unknown> }> {
  return new Promise((resolve, reject) => {
    const target = new URL(origin)
    const socket = connect({ host: target.hostname, port: Number(target.port) })
    let bytes = Buffer.alloc(0)
    let upgraded = false
    const nextWaiters: Array<(value: unknown) => void> = []
    const values: unknown[] = []
    const deliver = (value: unknown): void => {
      const waiter = nextWaiters.shift()
      if (waiter) waiter(value)
      else values.push(value)
    }
    const consume = (): void => {
      while (bytes.length >= 2) {
        const opcode = bytes[0]! & 0x0f
        const length = bytes[1]! & 0x7f
        if (length >= 126 || bytes.length < length + 2) return
        const payload = bytes.subarray(2, length + 2)
        bytes = bytes.subarray(length + 2)
        if (opcode === 0x8) { socket.destroy(); return }
        if (opcode === 0x1) deliver(JSON.parse(payload.toString('utf8')) as unknown)
      }
    }
    socket.once('error', reject)
    socket.on('data', (chunk: Buffer) => {
      bytes = Buffer.concat([bytes, chunk])
      if (!upgraded) {
        const boundary = bytes.indexOf('\r\n\r\n')
        if (boundary === -1) return
        const header = bytes.subarray(0, boundary).toString('ascii')
        if (!header.startsWith('HTTP/1.1 101')) {
          socket.destroy()
          reject(new Error(`websocket upgrade rejected: ${header.split('\r\n')[0]}`))
          return
        }
        upgraded = true
        bytes = bytes.subarray(boundary + 4)
        socket.removeAllListeners('error')
        socket.on('error', () => undefined)
        consume()
        resolve({
          socket,
          nextJson: (timeoutMs = 1_000) => values.length > 0 ? Promise.resolve(values.shift()) : new Promise((nextResolve, nextReject) => {
            const timeout = setTimeout(() => nextReject(new Error('timed out waiting for semantic WebSocket event')), timeoutMs)
            nextWaiters.push((value) => { clearTimeout(timeout); nextResolve(value) })
          }),
        })
        return
      }
      consume()
    })
    socket.on('connect', () => {
      socket.write([
        'GET /api/v1/events HTTP/1.1',
        `Host: ${target.host}`,
        `Origin: ${origin}`,
        `Cookie: ${cookie}`,
        'Connection: Upgrade',
        'Upgrade: websocket',
        'Sec-WebSocket-Version: 13',
        'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
        '',
        '',
      ].join('\r\n'))
    })
  })
}

function maskedTextFrame(value: unknown): Buffer {
  const payload = Buffer.from(JSON.stringify(value), 'utf8')
  if (payload.length >= 126) throw new Error('test frame must remain small')
  const mask = Buffer.from([1, 2, 3, 4])
  const body = Buffer.from(payload.map((byte, index) => byte ^ mask[index % mask.length]!))
  return Buffer.concat([Buffer.from([0x81, 0x80 | payload.length]), mask, body])
}

test('artifact reads reject an in-root symlink that escapes the project data root', async () => {
  await withTempDir(async (root) => {
    const store = await ArtifactStore.open({ root, projectId, gitHead: testGitHead })
    const outside = join(root, 'outside.txt')
    await writeFile(outside, 'do not expose', 'utf8')
    await symlink(outside, join(root, projectId, 'escaped.txt'))
    await assert.rejects(store.artifactBytes('escaped.txt'), /symlink|escape|artifact path/i)
  })
})

test('artifact writes reject an in-root symlink that escapes the project data root', async () => {
  await withTempDir(async (root) => {
    const store = await ArtifactStore.open({ root, projectId, gitHead: testGitHead })
    const outside = join(root, 'outside')
    await mkdir(outside)
    await symlink(outside, join(root, projectId, 'evidence'))
    const content = 'machine evidence'
    await assert.rejects(
      store.publish({
        snapshot: snapshot({ revision: 1 }),
        run: phaseRun({ evidence: [{ path: 'evidence/result.txt', sha256: digest(content) }] }),
        artifacts: { 'evidence/result.txt': content },
      }),
      /symlink|escape|artifact path/i
    )
    await assert.rejects(readFile(join(outside, 'result.txt'), 'utf8'), /ENOENT/)
  })
})

test('an old receipt without exact wrapper command identity is excluded from reconciliation and opens durable recovery', async () => {
  await withTempDir(async (root) => {
    const receipt = { pgid: 0, pid: 0, startIdentity: 'not-a-live-process', nonce: 'a'.repeat(64) }
    const intent = launchIntentForTest(receipt.nonce)
    await writeSignedAttempt(root, 'durable-attempt', { receipt, intent })

    const reopened = await Orchestrator.open({ root, projectId, gitHead: testGitHead })
    try {
      assert.equal((await reopened.snapshot()).runState, 'recovery-required')
      assert.equal((await reopened.attempt('durable-attempt')).status, 'running')
    } finally {
      await reopened.close()
    }

    const reopenedAgain = await Orchestrator.open({ root, projectId, gitHead: testGitHead })
    try {
      assert.equal((await reopenedAgain.snapshot()).runState, 'recovery-required')
    } finally {
      await reopenedAgain.close()
    }
  })
})

test('B1-03 a reconciled interruption remains a durable terminal record across restart and does not re-begin its attempt', {
  skip: process.platform === 'win32' ? 'POSIX process-group reconciliation is unavailable on Windows' : false,
}, async () => {
  await withTempDir(async (root) => {
    const attemptId = `b1-03-${process.pid}-${Date.now()}`
    const ownerPrivateRoot = join(root, 'owner-private', attemptId)
    const engine = join(ownerPrivateRoot, 'long-lived-fake-engine.mjs')
    const marker = join(ownerPrivateRoot, 'engine-marker.json')
    const launchInput = {
      phase: 'build',
      attemptId,
      command: process.execPath,
      args: [engine],
      cwd: ownerPrivateRoot,
      env: { PATH: process.env.PATH ?? '', GUIDELANE_B1_03_ENGINE_MARKER: marker },
      receiptTimeoutMs: 1_000,
    }
    let first: Orchestrator | undefined
    let reopened: Orchestrator | undefined
    let reopenedAgain: Orchestrator | undefined
    let receipt: { pid: number; pgid: number } | undefined
    let enginePid: number | undefined
    const cleanupFailures: unknown[] = []
    try {
      await ownerPrivateDirectory(ownerPrivateRoot)
      await writeFile(engine, [
        "import { writeFile } from 'node:fs/promises'",
        "const marker = process.env.GUIDELANE_B1_03_ENGINE_MARKER",
        "if (!marker) throw new Error('missing test-owned marker path')",
        "await writeFile(marker, JSON.stringify({ pid: process.pid }), { mode: 0o600 })",
        'setInterval(() => undefined, 1_000)',
      ].join('\n'), { mode: 0o600 })

      first = await Orchestrator.open({ root, projectId, gitHead: testGitHead })
      await advanceToG4(first, 'B1-03 durable reconciliation')
      const launched = await first.launchAttempt(launchInput)
      receipt = launched.receipt
      enginePid = (await waitForEngineMarker(marker)).pid

      await first.close()
      first = undefined
      reopened = await Orchestrator.open({ root, projectId, gitHead: testGitHead })
      assert.deepEqual(await reopened.reconcile(), { interruptedAttemptIds: [attemptId] })
      assert.equal((await reopened.snapshot()).runState, 'interrupted')
      assert.equal((await reopened.attempt(attemptId)).status, 'interrupted')

      await reopened.close()
      reopened = undefined
      reopenedAgain = await Orchestrator.open({ root, projectId, gitHead: testGitHead })
      assert.equal((await reopenedAgain.snapshot()).runState, 'interrupted')
      assert.equal((await reopenedAgain.attempt(attemptId)).status, 'interrupted')
      assert.deepEqual(await reopenedAgain.reconcile(), { interruptedAttemptIds: [] })

      await reopenedAgain.command({ type: 'startBuild' })
      await assert.rejects(reopenedAgain.launchAttempt(launchInput), /immutable|attempt|exists/i)
    } finally {
      for (const orchestrator of [reopenedAgain, reopened, first]) {
        if (!orchestrator) continue
        try {
          await orchestrator.reconcile()
        } catch (error: unknown) {
          cleanupFailures.push(error)
        }
        try {
          await orchestrator.close()
        } catch (error: unknown) {
          cleanupFailures.push(error)
        }
      }
      try {
        await reapTestOwnedProcessGroup(receipt, enginePid)
      } catch (error: unknown) {
        cleanupFailures.push(error)
      }
      if (cleanupFailures.length > 0) throw new AggregateError(cleanupFailures, 'B1-03 test-owned cleanup failed')
    }
  })
})

test('launch-token exchange is single-winner under concurrency, expires, and old server sessions do not survive restart', async () => {
  await withTempDir(async (root) => {
    const orchestrator = await Orchestrator.open({ root, projectId, gitHead: testGitHead })
    const token = '11111111111111111111111111111111'
    const first = await startServer({ orchestrator, port: 0, launchToken: token, launchTokenTtlMs: 60_000 })
    let cookie = ''
    try {
      const concurrent = await Promise.all([exchange(first.origin, token), exchange(first.origin, token)])
      assert.deepEqual(concurrent.map((response) => response.status).sort(), [204, 401])
      cookie = concurrent.find((response) => response.status === 204)?.headers.get('set-cookie') ?? ''
      assert.ok(cookie)
    } finally {
      await first.close()
    }

    const restarted = await startServer({ orchestrator, port: 0, launchToken: '22222222222222222222222222222222', launchTokenTtlMs: 1 })
    try {
      const oldSession = await fetch(`${restarted.origin}/api/v1/projects/current`, {
        headers: { Origin: restarted.origin, Cookie: cookie },
      })
      assert.equal(oldSession.status, 401)
      await new Promise((resolve) => setTimeout(resolve, 25))
      assert.equal((await exchange(restarted.origin, '22222222222222222222222222222222')).status, 401)
    } finally {
      await restarted.close()
    }
  })
})

test('an authenticated WebSocket emits only semantic revisioned events and ignores inbound command frames', async () => {
  await withTempDir(async (root) => {
    const orchestrator = await Orchestrator.open({ root, projectId, gitHead: testGitHead })
    const server = await startServer({ orchestrator, port: 0, launchToken: '33333333333333333333333333333333' })
    try {
      const session = await exchange(server.origin, '33333333333333333333333333333333')
      const socket = await websocket(server.origin, session.headers.get('set-cookie') ?? '')
      await orchestrator.command({ type: 'submitIdea', idea: 'Yerel ve güvenli' })
      const event = await socket.nextJson() as Record<string, unknown>
      assert.deepEqual(event, { type: 'phase_update', revision: 1, message: 'Durum güncellendi.' })
      socket.socket.write(maskedTextFrame({ type: 'submitIdea', idea: 'WebSocket komutu olmamalı' }))
      await new Promise((resolve) => setTimeout(resolve, 25))
      assert.equal((await orchestrator.snapshot()).revision, 1)
      socket.socket.destroy()
    } finally {
      await server.close()
    }
  })
})

for (const [expiry, options] of [
  ['idle', { sessionIdleMs: 20, sessionAbsoluteMs: 500 }],
  ['absolute', { sessionIdleMs: 500, sessionAbsoluteMs: 20 }],
] as const) {
  test(`an already-open WebSocket stops receiving semantic events after ${expiry} session expiry`, async () => {
    await withTempDir(async (root) => {
      const orchestrator = await Orchestrator.open({ root, projectId, gitHead: testGitHead })
      const token = expiry === 'idle' ? '55555555555555555555555555555555' : '66666666666666666666666666666666'
      const server = await startServer({ orchestrator, port: 0, launchToken: token, ...options })
      let socket: Awaited<ReturnType<typeof websocket>> | undefined
      try {
        const session = await exchange(server.origin, token)
        socket = await websocket(server.origin, session.headers.get('set-cookie') ?? '')
        await new Promise((resolve) => setTimeout(resolve, 45))
        const next = socket.nextJson(150).then(() => 'delivered', () => 'silent')
        await orchestrator.command({ type: 'submitIdea', idea: 'Semantic expiry regression' })
        assert.equal(await next, 'silent', `an expired ${expiry} session must not retain an event subscription`)
      } finally {
        socket?.socket.destroy()
        await server.close()
      }
    })
  })
}

test('snapshot reads accept omitted Origin with a session while commands and project creation remain strict', async () => {
  await withTempDir(async (root) => {
    const orchestrator = await Orchestrator.open({ root, projectId, gitHead: testGitHead })
    const server = await startServer({ orchestrator, port: 0, launchToken: '44444444444444444444444444444444' })
    try {
      const session = await exchange(server.origin, '44444444444444444444444444444444')
      const cookie = session.headers.get('set-cookie') ?? ''
      assert.equal((await fetch(`${server.origin}/api/v1/projects/current`, { headers: { Origin: server.origin } })).status, 401)
    assert.equal((await fetch(`${server.origin}/api/v1/projects/current`, { headers: { Cookie: cookie } })).status, 200)
      assert.equal((await fetch(`${server.origin}/api/v1/projects/current/commands`, {
        method: 'POST', headers: { Origin: 'http://evil.example', Cookie: cookie, 'content-type': 'application/json' }, body: JSON.stringify({ type: 'submitIdea', idea: 'x' }),
      })).status, 403)

      const create = () => fetch(`${server.origin}/api/v1/projects`, {
        method: 'POST', headers: { Origin: server.origin, Cookie: cookie, 'content-type': 'application/json' }, body: JSON.stringify({ projectId }),
      })
      assert.equal((await create()).status, 201)
      assert.equal((await create()).status, 409)
    } finally {
      await server.close()
    }
  })
})

test('semantic serialization rejects paths, raw diagnostic output, and unclassified engine prose', async () => {
  const hostile = JSON.parse(await readFile(new URL('../test-fixtures/redaction-hostile-payloads.json', import.meta.url), 'utf8')) as { messages: string[] }
  for (const message of hostile.messages) {
    assert.throws(() => redactEvent({ type: 'stream_event', revision: 4, message }), /redact|unsafe|semantic|engine/i)
  }
})
