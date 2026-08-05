import assert from 'node:assert/strict'
import { access, readdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { ArtifactStore, Orchestrator } from '../src/index.ts'
import type { EvidenceReference, GateResult, ProjectSnapshot } from '../src/index.ts'
import { advanceToG4, digest, ownerPrivateDirectory, phaseRun, projectId, snapshot, testGitHead, withTempDir } from './helpers.ts'

const engine = resolve(process.cwd(), 'packages/orchestrator/test-fixtures/final-22-launch-engine.mjs')
const requiredMachineGateNames = ['lint', 'type', 'unit', 'build', 'boot', 'axe', 'smoke'] as const

type CompletionPublisher = {
  /** The trusted supervisor-only success terminalizer for the exact G4 attempt. */
  completeAttempt(input: { attemptId: string }): Promise<ProjectSnapshot>
}

type LifecyclePublisher = {
  advancePhase(input: {
    stage: 'G5'
    runState: 'waiting'
    pendingDecision: 'acceptResult'
    gates: GateResult[]
  }): Promise<ProjectSnapshot>
}

async function waitForFile(path: string, label: string): Promise<void> {
  const deadline = Date.now() + 1_000
  while (Date.now() < deadline) {
    try { await access(path); return } catch { await new Promise((resolvePromise) => setTimeout(resolvePromise, 20)) }
  }
  throw new Error(`timed out waiting for test-owned ${label}`)
}

async function waitForExactGroupAbsence(pgid: number): Promise<void> {
  const deadline = Date.now() + 2_000
  while (Date.now() < deadline) {
    try {
      // Signal 0 is an existence probe only. pgid came directly from this
      // test's freshly launched wrapper receipt, never process discovery.
      process.kill(-pgid, 0)
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') return
      throw error
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 20))
  }
  throw new Error(`test-owned wrapper process group ${pgid} remained observable after completion`)
}

async function seedEvidence(root: string): Promise<{ gates: GateResult[]; evidence: EvidenceReference[] }> {
  const artifacts: Record<string, string> = {}
  const gates = requiredMachineGateNames.map((name) => {
    const path = `evidence/final29-${name}.txt`
    const contents = `${name} passed by final-29 durable receipt\n`
    artifacts[path] = contents
    return { name, status: 'passed' as const, authority: 'machine' as const, evidence: [{ path, sha256: digest(contents) }] }
  })
  const evidence = gates.flatMap((gate) => gate.evidence)
  const store = await ArtifactStore.open({ root, projectId, gitHead: testGitHead })
  await store.publish({
    snapshot: snapshot({ revision: 1, stage: 'G0', runState: 'idle', pendingDecision: 'submitIdea' }),
    run: phaseRun({ attemptId: 'final29-evidence-seed', evidence }),
    artifacts,
  })
  return { gates, evidence }
}

test('S2-FINAL-29-G5 advancePhase cannot publish G5 while the real launched attempt remains active', async () => {
  await withTempDir(async (root) => {
    const target = join(root, 'target')
    const marker = join(root, 'engine-started')
    const { gates } = await seedEvidence(root)
    const orchestrator = await Orchestrator.open({ root, projectId, gitHead: testGitHead })
    try {
      await ownerPrivateDirectory(target)
      await advanceToG4(orchestrator, 'Final-29 active gate publication regression')
      const launched = await orchestrator.launchAttempt({
        phase: 'build', attemptId: 'final29-active-g5', command: process.execPath, args: [engine], cwd: target,
        env: { PATH: process.env.PATH ?? '', GUIDELANE_FINAL_22_ENGINE_MARKER: marker },
      })
      await waitForFile(marker, 'long-lived engine marker')
      for (const gate of gates) await orchestrator.recordGate(gate as GateResult & { evidence: EvidenceReference[] })

      await assert.rejects(
        (orchestrator as Orchestrator & LifecyclePublisher).advancePhase({ stage: 'G5', runState: 'waiting', pendingDecision: 'acceptResult', gates }),
        /active|attempt|reap|complete|running/i,
        'G5 cannot be published until the exact live G4 attempt has been terminalized',
      )
      const stillRunning = await orchestrator.snapshot()
      assert.deepEqual(
        { stage: stillRunning.stage, runState: stillRunning.runState, pendingDecision: stillRunning.pendingDecision },
        { stage: 'G4', runState: 'running', pendingDecision: null },
      )
      assert.equal((await orchestrator.attempt(launched.attemptId)).status, 'running')
    } finally {
      await orchestrator.reconcile().catch(() => undefined)
      await orchestrator.close()
    }
  })
})

test('S2-FINAL-29-G6 completeAttempt terminalizes an exact live attempt, then publishes durable G5-to-G6 success', async () => {
  await withTempDir(async (root) => {
    const target = join(root, 'target')
    const marker = join(root, 'engine-started')
    const { gates, evidence } = await seedEvidence(root)
    const orchestrator = await Orchestrator.open({ root, projectId, gitHead: testGitHead })
    try {
      await ownerPrivateDirectory(target)
      await advanceToG4(orchestrator, 'Final-29 successful real wrapper lifecycle')
      const launched = await orchestrator.launchAttempt({
        phase: 'build', attemptId: 'final29-real-success', command: process.execPath, args: [engine], cwd: target,
        env: { PATH: process.env.PATH ?? '', GUIDELANE_FINAL_22_ENGINE_MARKER: marker },
      })
      await waitForFile(marker, 'long-lived engine marker')
      for (const gate of gates) await orchestrator.recordGate(gate as GateResult & { evidence: EvidenceReference[] })
      assert.deepEqual((await orchestrator.snapshot()).gates, gates, 'all seven valid machine gates must be durable before success terminalization')

      const completion = orchestrator as Orchestrator & CompletionPublisher
      assert.equal(typeof completion.completeAttempt, 'function', 'the public trusted success terminalizer must be explicit')
      const g5 = await completion.completeAttempt({ attemptId: launched.attemptId })
      assert.deepEqual(
        { stage: g5.stage, runState: g5.runState, pendingDecision: g5.pendingDecision },
        { stage: 'G5', runState: 'waiting', pendingDecision: 'acceptResult' },
      )
      assert.deepEqual(g5.gates, gates, 'success publication must retain every required machine gate')
      await waitForExactGroupAbsence(launched.receipt.pgid)

      const runPath = join(root, projectId, 'runs', `${launched.attemptId}.json`)
      const run = JSON.parse(await readFile(runPath, 'utf8')) as { status: unknown; receipt: unknown; evidence: unknown; sha256: unknown }
      assert.equal(run.status, 'completed', 'the exact terminal run must durably record completed success')
      assert.deepEqual(run.receipt, launched.receipt, 'the immutable success run must retain the exact wrapper-bound receipt')
      assert.deepEqual(run.evidence, evidence, 'the immutable success run must retain all seven gate evidence references')
      assert.match(String(run.sha256), /^[a-f0-9]{64}$/i, 'the completed run must be immutable')
      assert.deepEqual(await readdir(join(root, projectId, 'attempts')), [], 'terminalized attempts must leave no active-attempt fixture behind')

      const g6 = await orchestrator.command({ type: 'acceptResult' })
      assert.deepEqual(
        { stage: g6.stage, runState: g6.runState, pendingDecision: g6.pendingDecision },
        { stage: 'G6', runState: 'successful', pendingDecision: null },
      )
    } finally {
      await orchestrator.reconcile().catch(() => undefined)
      await orchestrator.close()
    }

    const reopened = await Orchestrator.open({ root, projectId, gitHead: testGitHead })
    try {
      const persisted = await reopened.snapshot()
      assert.deepEqual(
        { stage: persisted.stage, runState: persisted.runState, pendingDecision: persisted.pendingDecision },
        { stage: 'G6', runState: 'successful', pendingDecision: null },
      )
      const run = JSON.parse(await readFile(join(root, projectId, 'runs', 'final29-real-success.json'), 'utf8')) as { status: unknown; evidence: unknown }
      assert.equal(run.status, 'completed', 'reopen must preserve the exact completed attempt run')
      assert.deepEqual(run.evidence, evidence)
      assert.deepEqual(await readdir(join(root, projectId, 'attempts')), [], 'reopen must scan no active-attempt fixtures after successful completion')
    } finally {
      await reopened.close()
    }
  })
})
