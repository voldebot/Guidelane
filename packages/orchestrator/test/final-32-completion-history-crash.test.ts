import assert from 'node:assert/strict'
import { access, chmod, cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { ArtifactStore, Orchestrator } from '../src/index.ts'
import type { EvidenceReference, GateResult, ProjectSnapshot } from '../src/index.ts'
import { advanceToG4, digest, ownerPrivateDirectory, phaseRun, projectId, snapshot, testGitHead, withTempDir } from './helpers.ts'

const engine = resolve(process.cwd(), 'packages/orchestrator/test-fixtures/final-22-launch-engine.mjs')
const requiredMachineGateNames = ['lint', 'type', 'unit', 'build', 'boot', 'axe', 'smoke'] as const

type RecoveryMarker = { markerId: string }
type CompletionBytes = { marker: Buffer; history: Buffer; run: Buffer; manifest: Buffer; attemptId: string }
type StableState = Pick<ProjectSnapshot, 'stage' | 'runState' | 'pendingDecision' | 'revision'>

async function waitForFile(path: string): Promise<void> {
  const deadline = Date.now() + 1_000
  while (Date.now() < deadline) {
    try { await access(path); return } catch { await new Promise((resolvePromise) => setTimeout(resolvePromise, 10)) }
  }
  throw new Error(`timed out waiting for test-owned recovery marker: ${path}`)
}

async function seedEvidence(root: string): Promise<GateResult[]> {
  const artifacts: Record<string, string> = {}
  const gates = requiredMachineGateNames.map((name) => {
    const path = `evidence/final32-history-crash-${name}.txt`
    const contents = `${name} passed by the final-32 crash reconstruction\n`
    artifacts[path] = contents
    return { name, status: 'passed' as const, authority: 'machine' as const, evidence: [{ path, sha256: digest(contents) }] }
  })
  const store = await ArtifactStore.open({ root, projectId, gitHead: testGitHead })
  await store.publish({
    snapshot: snapshot({ revision: 1, stage: 'G0', runState: 'idle', pendingDecision: 'submitIdea' }),
    run: phaseRun({ attemptId: 'final32-history-crash-evidence-seed', evidence: gates.flatMap((gate) => gate.evidence) }),
    artifacts,
  })
  return gates
}

async function runRevisions(root: string): Promise<number[]> {
  const paths = (await readdir(join(root, projectId, 'runs'))).filter((name) => name.endsWith('.json')).sort()
  return await Promise.all(paths.map(async (name) => {
    const run = JSON.parse(await readFile(join(root, projectId, 'runs', name), 'utf8')) as { previousRevision: number }
    return run.previousRevision + 1
  }))
}

async function assertNoDuplicateRevisions(root: string): Promise<void> {
  const revisions = await runRevisions(root)
  assert.equal(new Set(revisions).size, revisions.length, 'recovery must not duplicate an immutable run revision')
}

async function assertSafeG4(snapshot: ProjectSnapshot): Promise<void> {
  assert.equal(snapshot.stage, 'G4', 'without an exact G5 manifest, completion intent must not publish G5 or G6')
  assert.ok(snapshot.runState === 'interrupted' || snapshot.runState === 'recovery-required', 'the incomplete completion must remain terminally safe')
  assert.equal(snapshot.pendingDecision, snapshot.runState === 'interrupted' ? 'startBuild' : null)
}

async function installVariant(input: {
  root: string
  baselineProject: string
  completion: CompletionBytes
  exactRun?: boolean
  exactManifest?: boolean
  archiveAttempt?: boolean
  corruptCompletion?: boolean
}): Promise<void> {
  await ownerPrivateDirectory(input.root)
  const destination = join(input.root, projectId)
  await cp(input.baselineProject, destination, { recursive: true })
  await rm(join(destination, '.project.lock'), { force: true })
  const marker = JSON.parse(input.completion.marker.toString('utf8')) as RecoveryMarker
  await mkdir(join(destination, 'recovery-history'), { recursive: true, mode: 0o700 })
  await chmod(join(destination, 'recovery-history'), 0o700)
  let history = input.completion.history
  let run = input.completion.run
  if (input.corruptCompletion) {
    const corruptHistory = JSON.parse(history.toString('utf8')) as { priorMarkerDigest: string }
    corruptHistory.priorMarkerDigest = '0'.repeat(64)
    history = Buffer.from(`${JSON.stringify(corruptHistory)}\n`, 'utf8')
    const corruptRun = JSON.parse(run.toString('utf8')) as { receipt: { nonce: string }; evidence: Array<{ sha256: string }> }
    corruptRun.receipt.nonce = '0'.repeat(64)
    corruptRun.evidence[0]!.sha256 = '0'.repeat(64)
    run = Buffer.from(`${JSON.stringify(corruptRun)}\n`, 'utf8')
  }
  await writeFile(join(destination, 'recovery.json'), input.completion.marker, { mode: 0o600 })
  await writeFile(join(destination, 'recovery-history', `${marker.markerId}.json`), history, { mode: 0o600 })
  if (input.exactRun) await writeFile(join(destination, 'runs', `${input.completion.attemptId}.json`), run, { mode: 0o600 })
  if (input.exactManifest) await writeFile(join(destination, 'manifest.json'), input.completion.manifest, { mode: 0o600 })
  if (input.archiveAttempt) await rm(join(destination, 'attempts', `${input.completion.attemptId}.json`), { force: false })
}

test('ORCH-CRASH-FINAL-32 exact-completion history stranded before active-fixture removal reconciles twice to a stable safe terminal', async () => {
  await withTempDir(async (root) => {
    const sourceRoot = join(root, 'production source')
    const baselineRoot = join(root, 'old-g4-manifest')
    const target = join(sourceRoot, 'target')
    const markerPath = join(sourceRoot, 'engine started')
    const attemptId = 'final32-stranded-completion-history'
    await ownerPrivateDirectory(sourceRoot)
    await ownerPrivateDirectory(baselineRoot)
    await ownerPrivateDirectory(target)

    const gates = await seedEvidence(sourceRoot)
    const source = await Orchestrator.open({ root: sourceRoot, projectId, gitHead: testGitHead })
    let completion: CompletionBytes | undefined
    try {
      await advanceToG4(source, 'Final-32 exact completion crash cuts')
      const launched = await source.launchAttempt({
        phase: 'build', attemptId, command: process.execPath, args: [engine], cwd: target,
        env: { PATH: process.env.PATH ?? '', GUIDELANE_FINAL_22_ENGINE_MARKER: markerPath },
      })
      await waitForFile(markerPath)
      for (const gate of gates) await source.recordGate(gate as GateResult & { evidence: EvidenceReference[] })

      // These raw bytes are the production state before completion publication:
      // old G4 manifest and the exact live-attempt fixture, with no G5 run.
      await cp(join(sourceRoot, projectId), join(baselineRoot, projectId), { recursive: true })
      await rm(join(baselineRoot, projectId, '.project.lock'), { force: true })

      const recoveryPath = join(sourceRoot, projectId, 'recovery.json')
      const capturedMarker = (async (): Promise<Buffer> => { await waitForFile(recoveryPath); return readFile(recoveryPath) })()
      const g5 = await source.completeAttempt({ attemptId: launched.attemptId })
      assert.deepEqual(
        { stage: g5.stage, runState: g5.runState, pendingDecision: g5.pendingDecision },
        { stage: 'G5', runState: 'waiting', pendingDecision: 'acceptResult' },
        'the source journey must create the only completion bytes used by every variant',
      )
      const marker = await capturedMarker
      const markerValue = JSON.parse(marker.toString('utf8')) as RecoveryMarker
      completion = {
        marker,
        history: await readFile(join(sourceRoot, projectId, 'recovery-history', `${markerValue.markerId}.json`)),
        run: await readFile(join(sourceRoot, projectId, 'runs', `${attemptId}.json`)),
        manifest: await readFile(join(sourceRoot, projectId, 'manifest.json')),
        attemptId,
      }
    } finally {
      await source.close()
    }
    assert.ok(completion, 'all crash variants require production-created completion marker, history, run, and manifest bytes')

    const signals: Array<{ pid: number; signal: NodeJS.Signals | number | undefined }> = []
    const realKill = process.kill
    process.kill = ((pid: number, signal?: NodeJS.Signals | number) => {
      if (signal !== 0) signals.push({ pid, signal })
      return realKill(pid, signal!)
    }) as typeof process.kill
    try {
      const intentOnlyRoot = join(root, 'history-intent-old-g4-active')
      await installVariant({ root: intentOnlyRoot, baselineProject: join(baselineRoot, projectId), completion })
      const intentOnly = await Orchestrator.open({ root: intentOnlyRoot, projectId, gitHead: testGitHead })
      let intentStable: StableState | undefined
      try {
        await assert.doesNotReject(intentOnly.reconcile(), 'history intent without an exact completed run must reconcile to a safe G4 terminal instead of conflicting permanently')
        const recovered = await intentOnly.snapshot()
        await assertSafeG4(recovered)
        await assert.rejects(intentOnly.command({ type: 'acceptResult' }), /recovery|transition|stage|active/i)
        intentStable = { stage: recovered.stage, runState: recovered.runState, pendingDecision: recovered.pendingDecision, revision: recovered.revision }
        await assertNoDuplicateRevisions(intentOnlyRoot)
      } finally { await intentOnly.close() }
      const intentReopened = await Orchestrator.open({ root: intentOnlyRoot, projectId, gitHead: testGitHead })
      try {
        await assert.doesNotReject(intentReopened.reconcile(), 'the safe old-G4 reconciliation must be idempotent on the second reopen')
        const recoveredAgain = await intentReopened.snapshot()
        assert.deepEqual({ stage: recoveredAgain.stage, runState: recoveredAgain.runState, pendingDecision: recoveredAgain.pendingDecision, revision: recoveredAgain.revision }, intentStable)
        await assertNoDuplicateRevisions(intentOnlyRoot)
      } finally { await intentReopened.close() }

      const runAndActiveRoot = join(root, 'completed-run-old-g4-active')
      await installVariant({ root: runAndActiveRoot, baselineProject: join(baselineRoot, projectId), completion, exactRun: true })
      const runAndActive = await Orchestrator.open({ root: runAndActiveRoot, projectId, gitHead: testGitHead })
      let g5Stable: StableState | undefined
      try {
        await assert.doesNotReject(runAndActive.reconcile(), 'an exact completed run plus absent exact group may finish the prepared G5 commit')
        const converged = await runAndActive.snapshot()
        assert.deepEqual({ stage: converged.stage, runState: converged.runState, pendingDecision: converged.pendingDecision }, { stage: 'G5', runState: 'waiting', pendingDecision: 'acceptResult' })
        await assert.rejects(runAndActive.command({ type: 'acceptResult', extra: true }), /schema|invalid/i, 'recovery convergence never grants an unvalidated G6 transition')
        g5Stable = { stage: converged.stage, runState: converged.runState, pendingDecision: converged.pendingDecision, revision: converged.revision }
        await assertNoDuplicateRevisions(runAndActiveRoot)
      } finally { await runAndActive.close() }
      const runAndActiveReopened = await Orchestrator.open({ root: runAndActiveRoot, projectId, gitHead: testGitHead })
      try {
        const convergedAgain = await runAndActiveReopened.snapshot()
        assert.deepEqual({ stage: convergedAgain.stage, runState: convergedAgain.runState, pendingDecision: convergedAgain.pendingDecision, revision: convergedAgain.revision }, g5Stable)
        await assertNoDuplicateRevisions(runAndActiveRoot)
      } finally { await runAndActiveReopened.close() }

      const runArchivedRoot = join(root, 'completed-run-old-g4-archived')
      await installVariant({ root: runArchivedRoot, baselineProject: join(baselineRoot, projectId), completion, exactRun: true, archiveAttempt: true })
      const runArchived = await Orchestrator.open({ root: runArchivedRoot, projectId, gitHead: testGitHead })
      try {
        await assert.doesNotReject(runArchived.reconcile(), 'an already archived exact fixture must converge the same completed G5 state without manufacturing a second run')
        const converged = await runArchived.snapshot()
        assert.deepEqual({ stage: converged.stage, runState: converged.runState, pendingDecision: converged.pendingDecision }, { stage: 'G5', runState: 'waiting', pendingDecision: 'acceptResult' })
        await assertNoDuplicateRevisions(runArchivedRoot)
      } finally { await runArchived.close() }

      const committedRoot = join(root, 'g5-manifest-run-history-marker')
      await installVariant({ root: committedRoot, baselineProject: join(baselineRoot, projectId), completion, exactRun: true, exactManifest: true, archiveAttempt: true })
      const committed = await Orchestrator.open({ root: committedRoot, projectId, gitHead: testGitHead })
      let committedStable: StableState | undefined
      try {
        const converged = await committed.snapshot()
        assert.deepEqual({ stage: converged.stage, runState: converged.runState, pendingDecision: converged.pendingDecision }, { stage: 'G5', runState: 'waiting', pendingDecision: 'acceptResult' })
        committedStable = { stage: converged.stage, runState: converged.runState, pendingDecision: converged.pendingDecision, revision: converged.revision }
        await assertNoDuplicateRevisions(committedRoot)
      } finally { await committed.close() }
      const committedReopened = await Orchestrator.open({ root: committedRoot, projectId, gitHead: testGitHead })
      try {
        const convergedAgain = await committedReopened.snapshot()
        assert.deepEqual({ stage: convergedAgain.stage, runState: convergedAgain.runState, pendingDecision: convergedAgain.pendingDecision, revision: convergedAgain.revision }, committedStable)
        await assertNoDuplicateRevisions(committedRoot)
      } finally { await committedReopened.close() }

      const corruptRoot = join(root, 'corrupt-completion-record')
      await installVariant({ root: corruptRoot, baselineProject: join(baselineRoot, projectId), completion, exactRun: true, corruptCompletion: true })
      const corrupt = await Orchestrator.open({ root: corruptRoot, projectId, gitHead: testGitHead })
      try {
        const recovered = await corrupt.snapshot()
        assert.equal(recovered.runState, 'recovery-required', 'a corrupt prepared completion record must fail closed rather than publish G5 or G6')
        assert.equal(recovered.pendingDecision, null)
        await assert.ok(await readFile(join(corruptRoot, projectId, 'recovery.json')), 'the corrupt completion marker must remain durable for manual recovery')
        await assert.rejects(corrupt.command({ type: 'acceptResult' }), /recovery|transition|stage|active/i)
      } finally { await corrupt.close() }
    } finally {
      process.kill = realKill
    }
    assert.deepEqual(signals, [], 'no completion crash cut may issue a non-zero signal after the exact process group is absent')
  })
})
