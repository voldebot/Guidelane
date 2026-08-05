import assert from 'node:assert/strict'
import { access, chmod, cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { ArtifactStore, Orchestrator } from '../src/index.ts'
import type { EvidenceReference, GateResult } from '../src/index.ts'
import { advanceToG4, digest, ownerPrivateDirectory, phaseRun, projectId, snapshot, testGitHead, withTempDir } from './helpers.ts'

const engine = resolve(process.cwd(), 'packages/orchestrator/test-fixtures/final-22-launch-engine.mjs')
const requiredMachineGateNames = ['lint', 'type', 'unit', 'build', 'boot', 'axe', 'smoke'] as const

type RecoveryMarker = { markerId: string }
type RecoveryHistory = { resolution: string; markerId: string }
type TerminalRun = { previousRevision: number; status: string; failureCode?: string }

async function waitForFile(path: string): Promise<void> {
  const deadline = Date.now() + 1_000
  while (Date.now() < deadline) {
    try { await access(path); return } catch { await new Promise((resolvePromise) => setTimeout(resolvePromise, 10)) }
  }
  throw new Error(`timed out waiting for test-owned marker: ${path}`)
}

async function captureRecoveryMarker(path: string): Promise<Buffer> {
  const deadline = Date.now() + 1_000
  while (Date.now() < deadline) {
    try { return await readFile(path) } catch { await new Promise((resolvePromise) => setTimeout(resolvePromise, 5)) }
  }
  throw new Error('production completion did not expose a pre-removal recovery marker')
}

async function seedEvidence(root: string): Promise<GateResult[]> {
  const artifacts: Record<string, string> = {}
  const gates = requiredMachineGateNames.map((name) => {
    const path = `evidence/final33-nested-crash-${name}.txt`
    const contents = `${name} passed by final-33 nested completion/reconcile crash reconstruction\n`
    artifacts[path] = contents
    return { name, status: 'passed' as const, authority: 'machine' as const, evidence: [{ path, sha256: digest(contents) }] }
  })
  const store = await ArtifactStore.open({ root, projectId, gitHead: testGitHead })
  await store.publish({
    snapshot: snapshot({ revision: 1, stage: 'G0', runState: 'idle', pendingDecision: 'submitIdea' }),
    run: phaseRun({ attemptId: 'final33-evidence-seed', evidence: gates.flatMap((gate) => gate.evidence) }),
    artifacts,
  })
  return gates
}

async function runRevisions(root: string): Promise<number[]> {
  const names = (await readdir(join(root, projectId, 'runs'))).filter((name) => name.endsWith('.json'))
  return Promise.all(names.map(async (name) => {
    const run = JSON.parse(await readFile(join(root, projectId, 'runs', name), 'utf8')) as TerminalRun
    return run.previousRevision + 1
  }))
}

test('ORCH-CRASH-FINAL-33 a stale exact-completion marker from a reconciled G4 interruption finalizes once after supervisor death', async () => {
  await withTempDir(async (root) => {
    const sourceRoot = join(root, 'production-source')
    const oldG4Root = join(root, 'old-g4-running')
    const crashRoot = join(root, 'post-interruption-manifest-pre-marker-removal')
    const target = join(sourceRoot, 'target')
    const engineMarker = join(sourceRoot, 'engine-started')
    const attemptId = 'final33-nested-completion-reconcile'
    await ownerPrivateDirectory(sourceRoot)
    await ownerPrivateDirectory(oldG4Root)
    await ownerPrivateDirectory(crashRoot)
    await ownerPrivateDirectory(target)

    const gates = await seedEvidence(sourceRoot)
    const source = await Orchestrator.open({ root: sourceRoot, projectId, gitHead: testGitHead })
    let savedMarker: Buffer | undefined
    let savedHistory: Buffer | undefined
    let oldRevision: number | undefined
    try {
      await advanceToG4(source, 'Final-33 nested completion/reconcile crash journey')
      const launched = await source.launchAttempt({
        phase: 'build', attemptId, command: process.execPath, args: [engine], cwd: target,
        env: { PATH: process.env.PATH ?? '', GUIDELANE_FINAL_22_ENGINE_MARKER: engineMarker },
      })
      await waitForFile(engineMarker)
      for (const gate of gates) await source.recordGate(gate as GateResult & { evidence: EvidenceReference[] })

      const oldG4 = await source.snapshot()
      assert.deepEqual(
        { stage: oldG4.stage, runState: oldG4.runState, pendingDecision: oldG4.pendingDecision },
        { stage: 'G4', runState: 'running', pendingDecision: null },
      )
      oldRevision = oldG4.revision
      await cp(join(sourceRoot, projectId), join(oldG4Root, projectId), { recursive: true })
      await rm(join(oldG4Root, projectId, '.project.lock'), { force: true })

      const recoveryPath = join(sourceRoot, projectId, 'recovery.json')
      const captured = captureRecoveryMarker(recoveryPath)
      await source.completeAttempt({ attemptId: launched.attemptId })
      savedMarker = await captured
      const marker = JSON.parse(savedMarker.toString('utf8')) as RecoveryMarker
      savedHistory = await readFile(join(sourceRoot, projectId, 'recovery-history', `${marker.markerId}.json`))
      const history = JSON.parse(savedHistory.toString('utf8')) as RecoveryHistory
      assert.equal(history.markerId, marker.markerId)
      assert.equal(history.resolution, 'exact-completion', 'the reconstructed stale marker must be armed by production exact-completion history')
    } finally {
      await source.close()
    }

    assert.ok(savedMarker, 'the nested crash boundary requires production-created marker bytes')
    assert.ok(savedHistory, 'the nested crash boundary requires production-created exact-completion history bytes')
    assert.notEqual(oldRevision, undefined)
    await cp(join(oldG4Root, projectId), join(crashRoot, projectId), { recursive: true })
    await rm(join(crashRoot, projectId, '.project.lock'), { force: true })
    const marker = JSON.parse(savedMarker.toString('utf8')) as RecoveryMarker
    const recoveryPath = join(crashRoot, projectId, 'recovery.json')
    const historyPath = join(crashRoot, projectId, 'recovery-history', `${marker.markerId}.json`)
    await mkdir(join(crashRoot, projectId, 'recovery-history'), { recursive: true, mode: 0o700 })
    await chmod(join(crashRoot, projectId, 'recovery-history'), 0o700)
    await writeFile(recoveryPath, savedMarker, { mode: 0o600 })
    await writeFile(historyPath, savedHistory, { mode: 0o600 })
    await assert.rejects(readFile(join(crashRoot, projectId, 'runs', `${attemptId}.json`)), { code: 'ENOENT' }, 'the old G4 reconstruction must retain no completed exact run')

    const reconciler = await Orchestrator.open({ root: crashRoot, projectId, gitHead: testGitHead })
    try {
      assert.deepEqual(await reconciler.reconcile(), { interruptedAttemptIds: [attemptId] })
      const terminal = await reconciler.snapshot()
      assert.deepEqual(
        { revision: terminal.revision, stage: terminal.stage, runState: terminal.runState, pendingDecision: terminal.pendingDecision, failureCode: terminal.failureCode },
        { revision: oldRevision + 1, stage: 'G4', runState: 'interrupted', pendingDecision: 'startBuild', failureCode: 'interrupted' },
        'the old G4 completion intent must resolve through the production interruption terminal, never G5 or G6',
      )
      const terminalManifest = JSON.parse(await readFile(join(crashRoot, projectId, 'manifest.json'), 'utf8')) as { run: TerminalRun }
      assert.deepEqual(
        { status: terminalManifest.run.status, failureCode: terminalManifest.run.failureCode },
        { status: 'failed', failureCode: 'interrupted' },
        'the terminal R+1 manifest must be a failed interrupted reconciliation run',
      )
      await assert.rejects(readFile(recoveryPath), { code: 'ENOENT' }, 'normal reconciliation removes its active marker before the simulated supervisor death')
      await writeFile(recoveryPath, savedMarker, { mode: 0o600 })
      assert.deepEqual(await readFile(recoveryPath), savedMarker, 'the crash fixture must preserve the exact saved marker after the manifest atomic commit')
    } finally {
      await reconciler.close()
    }

    const signals: Array<{ pid: number; signal: NodeJS.Signals | number | undefined }> = []
    const realKill = process.kill
    process.kill = ((pid: number, signal?: NodeJS.Signals | number) => {
      if (signal !== 0) signals.push({ pid, signal })
      return realKill(pid, signal!)
    }) as typeof process.kill
    let firstReopen: Orchestrator | undefined
    let secondReopen: Orchestrator | undefined
    try {
      firstReopen = await Orchestrator.open({ root: crashRoot, projectId, gitHead: testGitHead })
      const firstTerminal = await firstReopen.snapshot()
      assert.deepEqual(
        { revision: firstTerminal.revision, stage: firstTerminal.stage, runState: firstTerminal.runState, pendingDecision: firstTerminal.pendingDecision, failureCode: firstTerminal.failureCode },
        { revision: oldRevision + 1, stage: 'G4', runState: 'interrupted', pendingDecision: 'startBuild', failureCode: 'interrupted' },
      )
      await assert.rejects(readFile(recoveryPath), { code: 'ENOENT' }, 'the exact stale marker must be removed after the first reopen')
      await firstReopen.close()
      firstReopen = undefined

      secondReopen = await Orchestrator.open({ root: crashRoot, projectId, gitHead: testGitHead })
      const secondTerminal = await secondReopen.snapshot()
      assert.deepEqual(
        { revision: secondTerminal.revision, stage: secondTerminal.stage, runState: secondTerminal.runState, pendingDecision: secondTerminal.pendingDecision, failureCode: secondTerminal.failureCode },
        { revision: oldRevision + 1, stage: 'G4', runState: 'interrupted', pendingDecision: 'startBuild', failureCode: 'interrupted' },
        'the interrupted terminal must remain stable after a second reopen',
      )
      await assert.rejects(readFile(recoveryPath), { code: 'ENOENT' })
      const revisions = await runRevisions(crashRoot)
      assert.equal(new Set(revisions).size, revisions.length, 'reopening must not manufacture a duplicate immutable run revision')
      assert.deepEqual(signals, [], 'stale-marker finalization must not send a non-zero process signal')
    } finally {
      process.kill = realKill
      await firstReopen?.close()
      await secondReopen?.close()
    }
  })
})
