import assert from 'node:assert/strict'
import { access, chmod, cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { connect } from 'node:net'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { ArtifactStore, createLoopbackServer, Orchestrator } from '../src/index.ts'
import type { ProjectSnapshot, RunFailureCode } from '../src/index.ts'
import { projectId, testGitHead, withTempDir } from './helpers.ts'

type AttemptFailurePublisher = {
  publishAttemptFailure(input: { attemptId: string; failureCode: RunFailureCode }): Promise<ProjectSnapshot>
}

const engine = resolve(process.cwd(), 'packages/orchestrator/test-fixtures/final-22-launch-engine.mjs')
async function waitForMarker(path: string): Promise<void> { const deadline = Date.now() + 1_000; while (Date.now() < deadline) { try { await access(path); return } catch { await new Promise((resolvePromise) => setTimeout(resolvePromise, 20)) } } throw new Error('test-owned live engine marker was not observed') }

async function reachG4(orchestrator: Orchestrator): Promise<void> {
  await orchestrator.command({ type: 'submitIdea', idea: 'Final-24 production failure journey' })
  await orchestrator.command({ type: 'approveBlueprint' })
  await orchestrator.command({ type: 'approvePlan' })
  await orchestrator.command({ type: 'startBuild' })
}

test('S2-F24-A production failures originate from a launched G4 attempt, never direct G0 publication, and stopped retry creates a distinct attempt', async () => {
  await withTempDir(async (root) => {
    const generated = join(root, 'generated')
    const marker = join(root, 'final24-a.started')
    await mkdir(generated)
    const orchestrator = await Orchestrator.open({ root, projectId, gitHead: testGitHead })
    try {
      assert.equal(typeof (orchestrator as unknown as { publishFailure?: unknown }).publishFailure, 'undefined', 'direct G0 publishFailure is not a public production boundary')
      await reachG4(orchestrator)
      const first = await orchestrator.launchAttempt({ phase: 'build', attemptId: 'final24-first', command: process.execPath, args: [engine], cwd: generated, env: { PATH: process.env.PATH ?? '', GUIDELANE_FINAL_22_ENGINE_MARKER: marker } })
      await waitForMarker(marker)
      const failed = await (orchestrator as Orchestrator & AttemptFailurePublisher).publishAttemptFailure({ attemptId: first.attemptId, failureCode: 'io' })
      assert.equal(failed.stage, 'G4')
      assert.equal(failed.runState, 'stopped')
      assert.equal(failed.failureCode, 'io')
      assert.equal(failed.pendingDecision, 'startBuild')
      await orchestrator.command({ type: 'startBuild' })
      const retryMarker = join(root, 'final24-retry.started')
      const retry = await orchestrator.launchAttempt({ phase: 'build', attemptId: 'final24-retry', command: process.execPath, args: [engine], cwd: generated, env: { PATH: process.env.PATH ?? '', GUIDELANE_FINAL_22_ENGINE_MARKER: retryMarker } })
      await waitForMarker(retryMarker)
      assert.notEqual(retry.attemptId, first.attemptId, 'a retry must create a new immutable attempt')
    } finally {
      await orchestrator.reconcile().catch(() => undefined)
      await orchestrator.close()
    }
  })
})

test('S2-F24-B exact reconciliation removes the recovery marker only after durable resolution history is appended', async () => {
  await withTempDir(async (root) => {
    const generated = join(root, 'generated')
    const marker = join(root, 'final24-b.started')
    await mkdir(generated)
    const orchestrator = await Orchestrator.open({ root, projectId, gitHead: testGitHead })
    const realKill = process.kill
    try {
      await reachG4(orchestrator)
      const launched = await orchestrator.launchAttempt({ phase: 'build', attemptId: 'final24-reconcile', command: process.execPath, args: [engine], cwd: generated, env: { PATH: process.env.PATH ?? '', GUIDELANE_FINAL_22_ENGINE_MARKER: marker } })
      await waitForMarker(marker)
      process.kill = ((pid: number, signal?: NodeJS.Signals | number) => {
        if (pid === -launched.receipt.pgid && signal === 'SIGKILL') throw Object.assign(new Error('deterministic indeterminate group signal'), { code: 'EPERM' })
        return realKill(pid, signal!)
      }) as typeof process.kill
      const recovered = await (orchestrator as Orchestrator & AttemptFailurePublisher).publishAttemptFailure({ attemptId: launched.attemptId, failureCode: 'io' })
      assert.equal(recovered.runState, 'recovery-required', 'an indeterminate signal must retain the recovery marker')
      process.kill = realKill
      assert.deepEqual(await orchestrator.reconcile(), { interruptedAttemptIds: [launched.attemptId] })
      assert.equal((await orchestrator.snapshot()).runState, 'interrupted')
    } finally { process.kill = realKill; await orchestrator.reconcile().catch(() => undefined); await orchestrator.close() }
    const store = await ArtifactStore.open({ root, projectId, gitHead: testGitHead })
    await assert.rejects(store.artifactBytes('recovery.json'), { code: 'ENOENT' }, 'an exact reconciliation must clear the active recovery marker')
    const historyName = (await readdir(join(root, projectId, 'recovery-history'))).find((name) => name.endsWith('.json'))
    assert.ok(historyName, 'recovery resolution must append durable history before clearing its active marker')
    const history = JSON.parse((await store.artifactBytes(`recovery-history/${historyName}`)).toString('utf8')) as { resolution?: string }
    assert.equal(history.resolution, 'exact-reconciliation', 'clearing recovery must preserve append-only durable resolution history')
  })
})

test('S2-F25-B1 a post-manifest pre-marker-removal crash reconciles exactly once and keeps divergent recovery history fail-closed', async () => {
  await withTempDir(async (root) => {
    const sourceRoot = join(root, 'source')
    const crashRoot = join(root, 'post-manifest-pre-marker-removal')
    const divergentRoot = join(root, 'divergent-recovery-history')
    const generated = join(sourceRoot, 'generated')
    const marker = join(sourceRoot, 'engine-started')
    const attemptId = 'final25-crash-window'
    let source: Orchestrator | undefined
    const realKill = process.kill
    let recoveryMarker: Buffer | undefined
    try {
      await mkdir(sourceRoot, { mode: 0o700 })
      await chmod(sourceRoot, 0o700)
      await mkdir(generated, { mode: 0o700 })
      await chmod(generated, 0o700)
      source = await Orchestrator.open({ root: sourceRoot, projectId, gitHead: testGitHead })
      await reachG4(source)
      const launched = await source.launchAttempt({ phase: 'build', attemptId, command: process.execPath, args: [engine], cwd: generated, env: { PATH: process.env.PATH ?? '', GUIDELANE_FINAL_22_ENGINE_MARKER: marker } })
      await waitForMarker(marker)
      process.kill = ((pid: number, signal?: NodeJS.Signals | number) => {
        if (pid === -launched.receipt.pgid && signal === 'SIGKILL') throw Object.assign(new Error('test-owned recovery marker setup'), { code: 'EPERM' })
        return realKill(pid, signal!)
      }) as typeof process.kill
      assert.equal((await (source as Orchestrator & AttemptFailurePublisher).publishAttemptFailure({ attemptId, failureCode: 'io' })).runState, 'recovery-required')
      process.kill = realKill
      recoveryMarker = await readFile(join(sourceRoot, projectId, 'recovery.json'))

      assert.deepEqual(await source.reconcile(), { interruptedAttemptIds: [attemptId] })
      const terminalSnapshot = await source.snapshot()
      assert.equal(terminalSnapshot.runState, 'interrupted')
      const [terminalHistory] = (await readdir(join(sourceRoot, projectId, 'recovery-history'))).filter((name) => name.endsWith('.json'))
      assert.ok(terminalHistory, 'normal exact reconciliation must produce one recovery history record')

      await source.close()
      source = undefined
      for (const destination of [crashRoot, divergentRoot]) {
        await mkdir(destination, { mode: 0o700 })
        await chmod(destination, 0o700)
        await cp(join(sourceRoot, projectId), join(destination, projectId), { recursive: true })
        await writeFile(join(destination, projectId, 'recovery.json'), recoveryMarker)
      }

      const crashed = await Orchestrator.open({ root: crashRoot, projectId, gitHead: testGitHead })
      try {
        assert.equal((await crashed.snapshot()).runState, 'recovery-required', 'the retained signed marker must make the crash window explicit before exact reconciliation')
        const beforeManifest = await readFile(join(crashRoot, projectId, 'manifest.json'))
        const beforeRun = await readFile(join(crashRoot, projectId, 'runs', `${attemptId}.json`))
        const beforeHistory = await readFile(join(crashRoot, projectId, 'recovery-history', terminalHistory))
        const beforeRuns = (await readdir(join(crashRoot, projectId, 'runs'))).sort()

        assert.deepEqual(await crashed.reconcile(), { interruptedAttemptIds: [] })
        assert.deepEqual(await crashed.snapshot(), terminalSnapshot, 'the retry must converge to the already-durable terminal snapshot without a new revision')
        await assert.rejects(readFile(join(crashRoot, projectId, 'recovery.json')), { code: 'ENOENT' }, 'the retry must remove only the stale active recovery marker')
        assert.deepEqual(await readFile(join(crashRoot, projectId, 'manifest.json')), beforeManifest)
        assert.deepEqual(await readFile(join(crashRoot, projectId, 'runs', `${attemptId}.json`)), beforeRun)
        assert.deepEqual(await readFile(join(crashRoot, projectId, 'recovery-history', terminalHistory)), beforeHistory)
        assert.deepEqual((await readdir(join(crashRoot, projectId, 'runs'))).sort(), beforeRuns, 'a marker-only retry must never create a duplicate immutable run')
        assert.deepEqual(await crashed.reconcile(), { interruptedAttemptIds: [] })
      } finally {
        await crashed.close()
      }

      const divergentHistoryPath = join(divergentRoot, projectId, 'recovery-history', terminalHistory)
      const divergentHistory = JSON.parse(await readFile(divergentHistoryPath, 'utf8')) as { reason: string }
      divergentHistory.reason = 'divergent test-owned recovery history'
      await writeFile(divergentHistoryPath, `${JSON.stringify(divergentHistory)}\n`, 'utf8')
      const divergent = await Orchestrator.open({ root: divergentRoot, projectId, gitHead: testGitHead })
      try {
        await assert.rejects(divergent.reconcile(), /recovery|history|diverge|exact/i)
        assert.equal((await divergent.snapshot()).runState, 'recovery-required', 'a terminal manifest/history/marker divergence must remain fail-closed')
        assert.ok(await readFile(join(divergentRoot, projectId, 'recovery.json')), 'a failed exact retry must retain the active marker')
      } finally {
        await divergent.close()
      }
    } finally {
      process.kill = realKill
      await source?.reconcile().catch(() => undefined)
      await source?.close()
    }
  })
})

test('S2-F24-C an upgrade afterRevision boundary either emits the exact next revision or forces canonical GET convergence', async () => {
  await withTempDir(async (root) => {
    const orchestrator = await Orchestrator.open({ root, projectId, gitHead: testGitHead })
    const token = 'f24c0000000000000000000000000000'
    const server = await createLoopbackServer({ orchestrator, launchToken: token })
    try {
      const session = await fetch(`${server.origin}/api/v1/session`, { method: 'POST', headers: { Origin: server.origin, 'content-type': 'application/json' }, body: JSON.stringify({ launchToken: token }) })
      const cookie = session.headers.get('set-cookie') ?? ''
      await orchestrator.command({ type: 'submitIdea', idea: 'revision boundary' })
      const target = new URL(server.origin)
      const observed = await new Promise<string>((resolvePromise, reject) => {
        const socket = connect(Number(target.port), target.hostname)
        let received = ''
        const timeout = setTimeout(() => { socket.destroy(); reject(new Error('upgrade sent neither the exact N+1 frame nor snapshot_required')) }, 250)
        socket.once('error', (error) => { clearTimeout(timeout); reject(error) })
        socket.on('data', (chunk: Buffer) => {
          received += chunk.toString('utf8')
          const boundary = received.indexOf('\r\n\r\n')
          if (boundary >= 0 && received.length > boundary + 4) { clearTimeout(timeout); socket.destroy(); resolvePromise(received.slice(boundary + 4)) }
        })
        socket.once('connect', () => socket.write(`GET /api/v1/events?afterRevision=0 HTTP/1.1\r\nHost: ${target.host}\r\nOrigin: ${server.origin}\r\nCookie: ${cookie}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: ZmluYWwyNC1yZXZpc2lvbi1rZXk=\r\n\r\n`))
      })
      assert.match(observed, /snapshot_required|"revision":1/, 'the real loopback upgrade must converge without waiting for a later mutation')
    } finally { await server.close(); await orchestrator.close() }
  })
})

test('S2-F24-E unsafe group-writable data root is rejected before ArtifactStore reads or writes; same-UID concurrent directory swap is intentionally out of scope', async () => {
  await withTempDir(async (root) => {
    await chmod(root, 0o777)
    try {
      await assert.rejects(ArtifactStore.open({ root, projectId, gitHead: testGitHead }), /owner|private|writable|permission/i)
    } finally {
      await chmod(root, 0o700)
    }
  })
})

test('S2-F24-G a process receipt persists the exact wrapper command identity and nonce so an unobservable provider command can never be signalled', async () => {
  await withTempDir(async (root) => {
    const generated = join(root, 'generated')
    await mkdir(generated)
    const orchestrator = await Orchestrator.open({ root, projectId, gitHead: testGitHead })
    try {
      await reachG4(orchestrator)
      const launched = await orchestrator.launchAttempt({ phase: 'build', attemptId: 'final24-command-identity', command: process.execPath, args: [engine], cwd: generated, env: { PATH: process.env.PATH ?? '' } })
      const persisted = JSON.parse(await readFile(join(root, projectId, 'attempts', `${launched.attemptId}.json`), 'utf8')) as { receipt?: Record<string, unknown> }
      assert.equal(persisted.receipt?.wrapperCommand, resolve(process.cwd(), 'packages/orchestrator/src/attempt-wrapper.mjs'))
      assert.equal(persisted.receipt?.nonce, launched.receipt.nonce)
    } finally {
      await orchestrator.reconcile().catch(() => undefined)
      await orchestrator.close()
    }
  })
})
