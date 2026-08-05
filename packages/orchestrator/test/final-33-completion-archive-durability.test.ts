import assert from 'node:assert/strict'
import { access, cp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { ArtifactStore, Orchestrator } from '../src/index.ts'
import type { EvidenceReference, GateResult, ProjectSnapshot } from '../src/index.ts'
import { advanceToG4, digest, ownerPrivateDirectory, phaseRun, projectId, snapshot, testGitHead, withTempDir } from './helpers.ts'

const engine = resolve(process.cwd(), 'packages/orchestrator/test-fixtures/final-22-launch-engine.mjs')
const requiredMachineGateNames = ['lint', 'type', 'unit', 'build', 'boot', 'axe', 'smoke'] as const

type RecoveryMarker = { markerId: string }
type RecoveryHistory = { markerId: string; resolution: string; priorMarkerDigest: string }
type Attempt = { attemptId: string; status: string; receipt: Record<string, unknown> }
type Run = { attemptId: string; previousRevision: number; status: string; receipt: Record<string, unknown> }
type Manifest = { snapshot: ProjectSnapshot; run: Run }

async function waitForFile(path: string): Promise<void> {
  const deadline = Date.now() + 1_000
  while (Date.now() < deadline) {
    try { await access(path); return } catch { await new Promise((resolvePromise) => setTimeout(resolvePromise, 10)) }
  }
  throw new Error(`timed out waiting for test-owned file: ${path}`)
}

async function captureRecoveryMarker(path: string): Promise<Buffer> {
  const deadline = Date.now() + 1_000
  while (Date.now() < deadline) {
    try { return await readFile(path) } catch { await new Promise((resolvePromise) => setTimeout(resolvePromise, 5)) }
  }
  throw new Error('production completion did not expose its pre-removal recovery marker')
}

async function seedEvidence(root: string): Promise<GateResult[]> {
  const artifacts: Record<string, string> = {}
  const gates = requiredMachineGateNames.map((name) => {
    const path = `evidence/final33-archive-${name}.txt`
    const contents = `${name} passed by final-33 completion archive durability reconstruction\n`
    artifacts[path] = contents
    return { name, status: 'passed' as const, authority: 'machine' as const, evidence: [{ path, sha256: digest(contents) }] }
  })
  const store = await ArtifactStore.open({ root, projectId, gitHead: testGitHead })
  await store.publish({
    snapshot: snapshot({ revision: 1, stage: 'G0', runState: 'idle', pendingDecision: 'submitIdea' }),
    run: phaseRun({ attemptId: 'final33-archive-evidence-seed', evidence: gates.flatMap((gate) => gate.evidence) }),
    artifacts,
  })
  return gates
}

async function runRevisions(root: string): Promise<number[]> {
  const names = (await readdir(join(root, projectId, 'runs'))).filter((name) => name.endsWith('.json'))
  return Promise.all(names.map(async (name) => {
    const run = JSON.parse(await readFile(join(root, projectId, 'runs', name), 'utf8')) as Run
    return run.previousRevision + 1
  }))
}

async function assertGroupAbsent(pgid: number): Promise<void> {
  try {
    process.kill(-pgid, 0)
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return
    throw error
  }
  throw new Error(`production completion left the test-owned process group ${pgid} alive`)
}

test('ORCH-CRASH-FINAL-33 an exact running fixture stranded beside a completed G5 manifest is archived once without signalling', async () => {
  await withTempDir(async (root) => {
    const sourceRoot = join(root, 'production-source')
    const crashRoot = join(root, 'completed-manifest-with-stale-running-fixture')
    const target = join(sourceRoot, 'target')
    const engineMarker = join(sourceRoot, 'engine-started')
    const attemptId = 'final33-completion-archive-durability'
    await ownerPrivateDirectory(sourceRoot)
    await ownerPrivateDirectory(crashRoot)
    await ownerPrivateDirectory(target)

    const gates = await seedEvidence(sourceRoot)
    const source = await Orchestrator.open({ root: sourceRoot, projectId, gitHead: testGitHead })
    let runningAttemptBytes: Buffer | undefined
    let completionMarker: Buffer | undefined
    let completionHistory: Buffer | undefined
    let completedSnapshot: ProjectSnapshot | undefined
    try {
      await advanceToG4(source, 'Final-33 stale completion archive journey')
      const launched = await source.launchAttempt({
        phase: 'build', attemptId, command: process.execPath, args: [engine], cwd: target,
        env: { PATH: process.env.PATH ?? '', GUIDELANE_FINAL_22_ENGINE_MARKER: engineMarker },
      })
      await waitForFile(engineMarker)
      runningAttemptBytes = await readFile(join(sourceRoot, projectId, 'attempts', `${attemptId}.json`))
      const runningAttempt = JSON.parse(runningAttemptBytes.toString('utf8')) as Attempt
      assert.deepEqual(runningAttempt.receipt, launched.receipt, 'the retained fixture must be the exact production running attempt bytes')
      for (const gate of gates) await source.recordGate(gate as GateResult & { evidence: EvidenceReference[] })

      const captured = captureRecoveryMarker(join(sourceRoot, projectId, 'recovery.json'))
      completedSnapshot = await source.completeAttempt({ attemptId })
      completionMarker = await captured
      const marker = JSON.parse(completionMarker.toString('utf8')) as RecoveryMarker
      completionHistory = await readFile(join(sourceRoot, projectId, 'recovery-history', `${marker.markerId}.json`))
      const history = JSON.parse(completionHistory.toString('utf8')) as RecoveryHistory
      assert.equal(history.markerId, marker.markerId)
      assert.equal(history.resolution, 'exact-completion')
      await assertGroupAbsent(launched.receipt.pgid)
    } finally {
      await source.close()
    }

    assert.ok(runningAttemptBytes, 'the crash reconstruction requires the exact production running fixture')
    assert.ok(completionMarker, 'the worst credible marker state requires production-created marker bytes')
    assert.ok(completionHistory, 'the worst credible marker state requires production-created history bytes')
    assert.ok(completedSnapshot)
    await cp(join(sourceRoot, projectId), join(crashRoot, projectId), { recursive: true })
    await rm(join(crashRoot, projectId, '.project.lock'), { force: true })
    const marker = JSON.parse(completionMarker.toString('utf8')) as RecoveryMarker
    await writeFile(join(crashRoot, projectId, 'attempts', `${attemptId}.json`), runningAttemptBytes, { mode: 0o600 })
    await writeFile(join(crashRoot, projectId, 'recovery.json'), completionMarker, { mode: 0o600 })
    await writeFile(join(crashRoot, projectId, 'recovery-history', `${marker.markerId}.json`), completionHistory, { mode: 0o600 })

    const manifestBytes = await readFile(join(crashRoot, projectId, 'manifest.json'))
    const completedRunBytes = await readFile(join(crashRoot, projectId, 'runs', `${attemptId}.json`))
    const persistedAttempt = JSON.parse(runningAttemptBytes.toString('utf8')) as Attempt
    const manifest = JSON.parse(manifestBytes.toString('utf8')) as Manifest
    const completedRun = JSON.parse(completedRunBytes.toString('utf8')) as Run
    assert.deepEqual(manifest.snapshot, completedSnapshot, 'the retained fixture must sit beside the exact production G5 manifest')
    assert.equal(manifest.run.attemptId, attemptId)
    assert.equal(manifest.run.status, 'completed')
    assert.deepEqual(manifest.run, completedRun, 'the manifest must bind the exact immutable completed run')
    assert.equal(persistedAttempt.attemptId, completedRun.attemptId)
    assert.equal(persistedAttempt.status, 'running')
    assert.deepEqual(persistedAttempt.receipt, completedRun.receipt, 'the stale fixture may be archived only because it binds the exact completed receipt')

    const signals: Array<{ pid: number; signal: NodeJS.Signals | number | undefined }> = []
    const realKill = process.kill
    process.kill = ((pid: number, signal?: NodeJS.Signals | number) => {
      if (signal !== 0) signals.push({ pid, signal })
      return realKill(pid, signal!)
    }) as typeof process.kill
    let first: Orchestrator | undefined
    let second: Orchestrator | undefined
    try {
      first = await Orchestrator.open({ root: crashRoot, projectId, gitHead: testGitHead })
      assert.deepEqual(
        { stage: (await first.snapshot()).stage, runState: (await first.snapshot()).runState, pendingDecision: (await first.snapshot()).pendingDecision },
        { stage: 'G5', runState: 'waiting', pendingDecision: 'acceptResult' },
        'the exact stale fixture must converge to the already-durable successful completion rather than recovery or a new revision',
      )
      await assert.rejects(readFile(join(crashRoot, projectId, 'attempts', `${attemptId}.json`)), { code: 'ENOENT' }, 'the exact stale fixture must be archived after the durable completed run is verified')
      await assert.rejects(readFile(join(crashRoot, projectId, 'recovery.json')), { code: 'ENOENT' }, 'the matching stale completion marker must be finalized with the archived fixture')
      assert.deepEqual(await readFile(join(crashRoot, projectId, 'manifest.json')), manifestBytes, 'stale-fixture cleanup must not publish another manifest revision')
      assert.deepEqual(await readFile(join(crashRoot, projectId, 'runs', `${attemptId}.json`)), completedRunBytes, 'stale-fixture cleanup must not replace the immutable completed run')
      await first.close()
      first = undefined

      second = await Orchestrator.open({ root: crashRoot, projectId, gitHead: testGitHead })
      assert.deepEqual(
        { stage: (await second.snapshot()).stage, runState: (await second.snapshot()).runState, pendingDecision: (await second.snapshot()).pendingDecision },
        { stage: 'G5', runState: 'waiting', pendingDecision: 'acceptResult' },
        'the G5 completion must remain stable across a second reopen',
      )
      const revisions = await runRevisions(crashRoot)
      assert.equal(new Set(revisions).size, revisions.length, 'reopen must not create a duplicate immutable run revision')
      assert.deepEqual(signals, [], 'stale completed-fixture recovery must not send a non-zero signal')
    } finally {
      process.kill = realKill
      await first?.close()
      await second?.close()
    }
  })
})
