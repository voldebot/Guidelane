import assert from 'node:assert/strict'
import { access, chmod, cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { ArtifactStore, Orchestrator } from '../src/index.ts'
import type { EvidenceReference, GateResult, ProjectSnapshot } from '../src/index.ts'
import { advanceToG4, digest, ownerPrivateDirectory, phaseRun, projectId, snapshot, testGitHead, withTempDir } from './helpers.ts'

const engine = resolve(process.cwd(), 'packages/orchestrator/test-fixtures/final-22-launch-engine.mjs')
const requiredMachineGateNames = ['lint', 'type', 'unit', 'build', 'boot', 'axe', 'smoke'] as const

type CompletionPublisher = {
  completeAttempt(input: { attemptId: string }): Promise<ProjectSnapshot>
}

type RecoveryMarker = {
  schemaVersion: 1
  projectId: string
  markerId: string
  reason: string
  attemptId: string
  snapshot: ProjectSnapshot
  sha256: string
}

type CompletionHistory = {
  schemaVersion: 1
  projectId: string
  markerId: string
  resolution: 'exact-completion'
  reason: string
  attemptId: string
  resolvedAt: string
  priorMarkerDigest: string
}

async function waitForFile(path: string, label: string): Promise<void> {
  const deadline = Date.now() + 1_000
  while (Date.now() < deadline) {
    try { await access(path); return } catch { await new Promise((resolvePromise) => setTimeout(resolvePromise, 10)) }
  }
  throw new Error(`timed out waiting for test-owned ${label}`)
}

async function captureRecoveryMarker(path: string): Promise<Buffer> {
  const deadline = Date.now() + 1_000
  while (Date.now() < deadline) {
    try { return await readFile(path) } catch { await new Promise((resolvePromise) => setTimeout(resolvePromise, 5)) }
  }
  throw new Error('the successful completion did not expose its test-owned pre-removal recovery marker')
}

async function seedEvidence(root: string): Promise<{ gates: GateResult[]; evidence: EvidenceReference[] }> {
  const artifacts: Record<string, string> = {}
  const gates = requiredMachineGateNames.map((name) => {
    const path = `evidence/final30-${name}.txt`
    const contents = `${name} passed by final-30 durable receipt\n`
    artifacts[path] = contents
    return { name, status: 'passed' as const, authority: 'machine' as const, evidence: [{ path, sha256: digest(contents) }] }
  })
  const evidence = gates.flatMap((gate) => gate.evidence)
  const store = await ArtifactStore.open({ root, projectId, gitHead: testGitHead })
  await store.publish({
    snapshot: snapshot({ revision: 1, stage: 'G0', runState: 'idle', pendingDecision: 'submitIdea' }),
    run: phaseRun({ attemptId: 'final30-evidence-seed', evidence }),
    artifacts,
  })
  return { gates, evidence }
}

async function installSuccessCrashMarker(root: string, markerBytes: Buffer, historyBytes: Buffer): Promise<void> {
  const marker = JSON.parse(markerBytes.toString('utf8')) as RecoveryMarker
  const history = JSON.parse(historyBytes.toString('utf8')) as CompletionHistory
  assert.match(marker.sha256, /^[a-f0-9]{64}$/i, 'the captured marker must retain its durable digest')
  assert.equal(marker.projectId, projectId)
  assert.equal(marker.snapshot.stage, 'G4')
  assert.equal(marker.snapshot.runState, 'recovery-required')
  assert.deepEqual(Object.keys(history).sort(), ['attemptId', 'markerId', 'priorMarkerDigest', 'projectId', 'reason', 'resolution', 'resolvedAt', 'schemaVersion'])
  assert.equal(history.schemaVersion, 1)
  assert.equal(history.projectId, projectId)
  assert.equal(history.markerId, marker.markerId)
  assert.equal(history.resolution, 'exact-completion')
  assert.equal(history.reason, marker.reason)
  assert.equal(history.attemptId, marker.attemptId)
  assert.match(history.resolvedAt, /^\d{4}-\d{2}-\d{2}T/)
  assert.equal(history.priorMarkerDigest, marker.sha256)
  const historyDirectory = join(root, projectId, 'recovery-history')
  await mkdir(historyDirectory, { recursive: true, mode: 0o700 })
  await chmod(historyDirectory, 0o700)
  await writeFile(join(root, projectId, 'recovery.json'), markerBytes, { mode: 0o600 })
  await writeFile(join(historyDirectory, `${marker.markerId}.json`), historyBytes, { mode: 0o600 })
}

test('S2-FINAL-30 successful completion crash after G5 manifest commit finalizes only an exact stale success marker on reopen', async () => {
  await withTempDir(async (root) => {
    const sourceRoot = join(root, 'source')
    const crashRoot = join(root, 'post-g5-manifest-pre-success-marker-removal')
    const corruptRoot = join(root, 'corrupt-success-marker-history')
    const target = join(sourceRoot, 'target')
    const markerPath = join(sourceRoot, 'engine-started')
    const attemptId = 'final30-success-crash-window'
    await ownerPrivateDirectory(sourceRoot)
    await ownerPrivateDirectory(target)
    const { gates, evidence } = await seedEvidence(sourceRoot)
    const source = await Orchestrator.open({ root: sourceRoot, projectId, gitHead: testGitHead })
    let capturedMarker: Buffer | undefined
    let capturedHistory: Buffer | undefined
    let g5: ProjectSnapshot | undefined
    try {
      await advanceToG4(source, 'Final-30 successful marker crash journey')
      const launched = await source.launchAttempt({
        phase: 'build', attemptId, command: process.execPath, args: [engine], cwd: target,
        env: { PATH: process.env.PATH ?? '', GUIDELANE_FINAL_22_ENGINE_MARKER: markerPath },
      })
      await waitForFile(markerPath, 'long-lived engine marker')
      for (const gate of gates) await source.recordGate(gate as GateResult & { evidence: EvidenceReference[] })

      const recoveryPath = join(sourceRoot, projectId, 'recovery.json')
      const captured = captureRecoveryMarker(recoveryPath)
      g5 = await (source as Orchestrator & CompletionPublisher).completeAttempt({ attemptId: launched.attemptId })
      capturedMarker = await captured
      const marker = JSON.parse(capturedMarker.toString('utf8')) as RecoveryMarker
      capturedHistory = await readFile(join(sourceRoot, projectId, 'recovery-history', `${marker.markerId}.json`))
      assert.deepEqual(
        { stage: g5.stage, runState: g5.runState, pendingDecision: g5.pendingDecision },
        { stage: 'G5', runState: 'waiting', pendingDecision: 'acceptResult' },
      )
      assert.deepEqual(g5.gates, gates)
      assert.deepEqual(await readdir(join(sourceRoot, projectId, 'attempts')), [], 'the source completion must archive its active-attempt fixture before the manifest is committed')
    } finally {
      await source.reconcile().catch(() => undefined)
      await source.close()
    }

    assert.ok(capturedMarker)
    assert.ok(capturedHistory, 'normal successful completion must durably append exact-completion history before clearing its marker')
    assert.ok(g5)
    for (const destination of [crashRoot, corruptRoot]) {
      await ownerPrivateDirectory(destination)
      await cp(join(sourceRoot, projectId), join(destination, projectId), { recursive: true })
      await installSuccessCrashMarker(destination, capturedMarker, capturedHistory)
    }

    const expectedManifest = await readFile(join(crashRoot, projectId, 'manifest.json'))
    const expectedRun = await readFile(join(crashRoot, projectId, 'runs', `${attemptId}.json`))
    const expectedRuns = (await readdir(join(crashRoot, projectId, 'runs'))).filter((name) => name.endsWith('.json')).sort()
    const realKill = process.kill
    const signals: Array<{ target: number; signal: NodeJS.Signals | number | undefined }> = []
    process.kill = ((targetPid: number, signal?: NodeJS.Signals | number) => {
      if (signal !== 0) signals.push({ target: targetPid, signal })
      return realKill(targetPid, signal!)
    }) as typeof process.kill
    let reopened: Orchestrator | undefined
    try {
      reopened = await Orchestrator.open({ root: crashRoot, projectId, gitHead: testGitHead })
      assert.deepEqual(
        { stage: (await reopened.snapshot()).stage, runState: (await reopened.snapshot()).runState, pendingDecision: (await reopened.snapshot()).pendingDecision },
        { stage: 'G5', runState: 'waiting', pendingDecision: 'acceptResult' },
        'an exact stale success marker must finalize during reopen without a recovery-only round trip',
      )
      assert.deepEqual(await reopened.eventsSince(g5.revision), { kind: 'events', events: [] }, 'marker-only recovery must not invent a lifecycle event')
      assert.deepEqual(await readFile(join(crashRoot, projectId, 'manifest.json')), expectedManifest, 'marker-only recovery must not add a revision')
      assert.deepEqual(await readFile(join(crashRoot, projectId, 'runs', `${attemptId}.json`)), expectedRun, 'marker-only recovery must not replace the immutable completed run')
      assert.deepEqual((await readdir(join(crashRoot, projectId, 'runs'))).filter((name) => name.endsWith('.json')).sort(), expectedRuns, 'marker-only recovery must not add a duplicate run')
      assert.deepEqual(await readdir(join(crashRoot, projectId, 'attempts')), [], 'the completed exact marker must not restore an active fixture')
      assert.deepEqual(signals, [], 'reopening a completed marker must not signal any process')

      const g6 = await reopened.command({ type: 'acceptResult' })
      assert.deepEqual(
        { stage: g6.stage, runState: g6.runState, pendingDecision: g6.pendingDecision },
        { stage: 'G6', runState: 'successful', pendingDecision: null },
      )
    } finally {
      process.kill = realKill
      await reopened?.close()
    }

    const stable = await Orchestrator.open({ root: crashRoot, projectId, gitHead: testGitHead })
    try {
      assert.deepEqual(
        { stage: (await stable.snapshot()).stage, runState: (await stable.snapshot()).runState, pendingDecision: (await stable.snapshot()).pendingDecision },
        { stage: 'G6', runState: 'successful', pendingDecision: null },
        'the finalized successful state must remain stable across another reopen',
      )
    } finally {
      await stable.close()
    }

    const corruptMarker = JSON.parse(await readFile(join(corruptRoot, projectId, 'recovery.json'), 'utf8')) as RecoveryMarker
    const corruptHistoryPath = join(corruptRoot, projectId, 'recovery-history', `${corruptMarker.markerId}.json`)
    const corruptHistory = JSON.parse(await readFile(corruptHistoryPath, 'utf8')) as { priorMarkerDigest: string }
    corruptHistory.priorMarkerDigest = '0'.repeat(64)
    await writeFile(corruptHistoryPath, `${JSON.stringify(corruptHistory)}\n`, { mode: 0o600 })

    const corruptSignals: Array<{ target: number; signal: NodeJS.Signals | number | undefined }> = []
    process.kill = ((targetPid: number, signal?: NodeJS.Signals | number) => {
      if (signal !== 0) corruptSignals.push({ target: targetPid, signal })
      return realKill(targetPid, signal!)
    }) as typeof process.kill
    const corrupt = await Orchestrator.open({ root: corruptRoot, projectId, gitHead: testGitHead })
    try {
      const recovered = await corrupt.snapshot()
      assert.equal(recovered.runState, 'recovery-required', 'a mismatched success recovery history must remain fail-closed')
      assert.equal(recovered.pendingDecision, null)
      await assert.rejects(corrupt.command({ type: 'acceptResult' }), /recovery|required|marker|history/i)
      assert.ok(await readFile(join(corruptRoot, projectId, 'recovery.json')), 'a mismatched marker/history must remain durable for manual recovery')
      assert.deepEqual(corruptSignals, [], 'a corrupt stale success marker must not acquire authority to signal a process')
    } finally {
      process.kill = realKill
      await corrupt.close()
    }

    const completedRun = JSON.parse(expectedRun.toString('utf8')) as { status: unknown; evidence: unknown }
    assert.equal(completedRun.status, 'completed')
    assert.deepEqual(completedRun.evidence, evidence)
  })
})
