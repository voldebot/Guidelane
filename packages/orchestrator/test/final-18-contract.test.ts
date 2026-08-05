import assert from 'node:assert/strict'
import { access, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import { ArtifactStore, Orchestrator } from '../src/index.ts'
import type { GateResult, ProjectSnapshot, RunFailureCode } from '../src/index.ts'
import { advanceToG4, digest, ownerPrivateDirectory, phaseRun, projectId, snapshot, testGitHead, withTempDir } from './helpers.ts'

const requiredMachineGates = ['lint', 'type', 'unit', 'build', 'boot', 'axe', 'smoke'] as const

async function waitForMarker(path: string): Promise<void> {
  const deadline = Date.now() + 1_000
  while (Date.now() < deadline) {
    try { await access(path); return } catch { await new Promise((resolvePromise) => setTimeout(resolvePromise, 20)) }
  }
  throw new Error('test-owned live engine marker was not observed before failure publication')
}

type LifecyclePublisher = {
  advancePhase(input: {
    stage: 'G5'
    runState: 'waiting'
    pendingDecision: 'acceptResult'
    gates: GateResult[]
  }): Promise<ProjectSnapshot>
}

type FailurePublisher = { publishAttemptFailure(input: { attemptId: string; failureCode: RunFailureCode }): Promise<ProjectSnapshot> }

function signedRun(overrides: Record<string, unknown>): Record<string, unknown> {
  const unsigned = { ...phaseRun(overrides), sha256: undefined }
  return { ...unsigned, sha256: digest(`${JSON.stringify(unsigned)}\n`) }
}

async function publishContiguousChain(root: string): Promise<void> {
  const store = await ArtifactStore.open({ root, projectId, gitHead: testGitHead })
  await store.publish({
    snapshot: snapshot({ revision: 1, stage: 'G1', runState: 'waiting', pendingDecision: 'approveBlueprint' }),
    run: phaseRun({ attemptId: 'final18-revision-one', previousRevision: 0 }),
    artifacts: {},
  })
  await store.publish({
    snapshot: snapshot({ revision: 2, stage: 'G2', runState: 'waiting', pendingDecision: 'approvePlan' }),
    run: phaseRun({ attemptId: 'final18-revision-two', previousRevision: 1 }),
    artifacts: {},
  })
}

async function assertReopensRecovery(root: string): Promise<void> {
  const reopened = await Orchestrator.open({ root, projectId, gitHead: testGitHead })
  try {
    const recovered = await reopened.snapshot()
    assert.equal(recovered.runState, 'recovery-required')
    assert.equal(recovered.pendingDecision, null)
  } finally {
    await reopened.close()
  }
}

async function atBuildResultGate(root: string): Promise<{ orchestrator: Orchestrator; gates: GateResult[] }> {
  const artifacts: Record<string, string> = {}
  const gates: GateResult[] = requiredMachineGates.map((name) => {
    const contents = `${name} passed\n`
    const path = `evidence/final18-${name}.txt`
    artifacts[path] = contents
    return { name, status: 'passed', authority: 'machine', evidence: [{ path, sha256: digest(contents) }] }
  })
  const store = await ArtifactStore.open({ root, projectId, gitHead: testGitHead })
  await store.publish({
    snapshot: snapshot({ revision: 1, stage: 'G0', runState: 'idle', pendingDecision: 'submitIdea' }),
    run: phaseRun({ attemptId: 'final18-gate-evidence', evidence: gates.flatMap((gate) => gate.evidence ?? []) }),
    artifacts,
  })
  const orchestrator = await Orchestrator.open({ root, projectId, gitHead: testGitHead })
  await orchestrator.command({ type: 'submitIdea', idea: 'Final 18 required machine gates' })
  await orchestrator.command({ type: 'approveBlueprint' })
  await orchestrator.command({ type: 'approvePlan' })
  await orchestrator.command({ type: 'startBuild' })
  return { orchestrator, gates }
}

test('S2-FINAL-18-GATE-01 acceptance requires exactly the evidence-bound lint type unit build boot axe smoke machine gates', async () => {
  await withTempDir(async (root) => {
    const { orchestrator, gates } = await atBuildResultGate(root)
    try {
      const publisher = orchestrator as Orchestrator & LifecyclePublisher
      const g5 = await publisher.advancePhase({ stage: 'G5', runState: 'waiting', pendingDecision: 'acceptResult', gates })
      assert.deepEqual(g5.gates.map((gate) => gate.name), requiredMachineGates)
      const accepted = await orchestrator.command({ type: 'acceptResult' })
      assert.equal(accepted.runState, 'successful')
    } finally {
      await orchestrator.close()
    }
  })
})

for (const [label, gates] of [
  ['missing axe', (gates: GateResult[]) => gates.filter((gate) => gate.name !== 'axe')],
  ['substituted review', (gates: GateResult[]) => gates.map((gate) => gate.name === 'axe' ? { ...gate, name: 'review' } : gate)],
  ['user-only approval', (gates: GateResult[]) => [{ name: 'approval', status: 'passed', authority: 'user', evidence: gates[0]?.evidence }]],
  ['extra isolated review', (gates: GateResult[]) => [...gates, { name: 'review', status: 'passed', authority: 'isolated_review' }]],
  ['non-passing smoke', (gates: GateResult[]) => gates.map((gate) => gate.name === 'smoke' ? { ...gate, status: 'failed' } : gate)],
] as const) {
  test(`S2-FINAL-18-GATE-02-${label} rejects a noncanonical acceptance gate set`, async () => {
    await withTempDir(async (root) => {
      const { orchestrator, gates: canonical } = await atBuildResultGate(root)
      try {
        const publisher = orchestrator as Orchestrator & LifecyclePublisher
        const before = await orchestrator.snapshot()
        await assert.rejects(
          publisher.advancePhase({ stage: 'G5', runState: 'waiting', pendingDecision: 'acceptResult', gates: gates(canonical) as GateResult[] }),
          /gate|required|machine|passed|evidence|accept/i,
        )
        assert.deepEqual(await orchestrator.snapshot(), before, 'a rejected gate set must not publish or advance the canonical snapshot')
      } finally {
        await orchestrator.close()
      }
    })
  })
}

test('S2-FINAL-18-RECOVERY-03 a signed orphan run in the real runs layout without a manifest advance requires recovery', async () => {
  await withTempDir(async (root) => {
    await publishContiguousChain(root)
    const orphan = signedRun({ attemptId: 'final18-crash-window-orphan', previousRevision: 2 })
    await writeFile(join(root, projectId, 'runs', 'final18-crash-window-orphan.json'), `${JSON.stringify(orphan)}\n`, 'utf8')
    assert.equal((await readdir(join(root, projectId, 'runs'))).length, 3, 'the crash-window run must use the durable runs layout')
    await assertReopensRecovery(root)
  })
})

for (const [label, mutate] of [
  ['missing historical revision', async (root: string) => rm(join(root, projectId, 'runs', 'final18-revision-one.json'))],
  ['tampered historical revision', async (root: string) => writeFile(join(root, projectId, 'runs', 'final18-revision-one.json'), '{"tampered":true}\n', 'utf8')],
] as const) {
  test(`S2-FINAL-18-RECOVERY-04-${label} breaks the full contiguous immutable revision chain`, async () => {
    await withTempDir(async (root) => {
      await publishContiguousChain(root)
      await mutate(root)
      await assertReopensRecovery(root)
    })
  })
}

for (const [surface, open] of [
  ['ArtifactStore', (root: string, gitHead: string | undefined) => ArtifactStore.open(gitHead === undefined ? { root, projectId } : { root, projectId, gitHead })],
  ['Orchestrator', (root: string, gitHead: string | undefined) => Orchestrator.open(gitHead === undefined ? { root, projectId } : { root, projectId, gitHead })],
] as const) {
  for (const [label, gitHead] of [
    ['omitted', undefined],
    ['empty', ''],
    ['short', 'a'.repeat(39)],
    ['long', 'a'.repeat(41)],
    ['non-hex', `${'a'.repeat(39)}g`],
  ] as const) {
    test(`S2-FINAL-18-GIT-05-${surface}-${label} rejects an invalid gitHead before mutating the project directory`, async () => {
      await withTempDir(async (root) => {
        await assert.rejects(open(root, gitHead), /git|head|40|hex|required|invalid/i)
        assert.deepEqual(await readdir(root), [], 'an invalid opening identity must not create a project, lock, manifest, or recovery marker')
      })
    })
  }
}

const failureReceiptCases = [
  { code: 'receipt', title: 'S2-FINAL-18-FAILURE-06-receipt publishes an immutable non-success failure receipt that survives reopen' },
  { code: 'denial', title: 'S2-FINAL-18-FAILURE-06-denial publishes an immutable non-success failure receipt that survives reopen' },
  { code: 'hook', title: 'S2-FINAL-18-FAILURE-06-hook publishes an immutable non-success failure receipt that survives reopen' },
  { code: 'stall', title: 'S2-FINAL-18-FAILURE-06-stall publishes an immutable non-success failure receipt that survives reopen' },
  { code: 'framing', title: 'S2-FINAL-18-FAILURE-06-framing publishes an immutable non-success failure receipt that survives reopen' },
  { code: 'io', title: 'S2-FINAL-18-FAILURE-06-io publishes an immutable non-success failure receipt that survives reopen' },
  { code: 'rate_limit_five_hour', title: 'S2-FINAL-18-FAILURE-06-rate_limit_five_hour publishes an immutable non-success failure receipt that survives reopen' },
  { code: 'rate_limit_seven_day', title: 'S2-FINAL-18-FAILURE-06-rate_limit_seven_day publishes an immutable non-success failure receipt that survives reopen' },
  { code: 'interrupted', title: 'S2-FINAL-18-FAILURE-06-interrupted publishes an immutable non-success failure receipt that survives reopen' },
  { code: 'recovery', title: 'S2-FINAL-18-FAILURE-06-recovery publishes an immutable non-success failure receipt that survives reopen' },
  { code: 'unknown_event', title: 'S2-FINAL-18-FAILURE-06-unknown_event publishes an immutable non-success failure receipt that survives reopen' },
] as const satisfies readonly { code: RunFailureCode; title: string }[]

for (const { code, title } of failureReceiptCases) {
  test(title, async () => {
    await withTempDir(async (root) => {
      const orchestrator = await Orchestrator.open({ root, projectId, gitHead: testGitHead })
      let published: ProjectSnapshot
      try {
        const cwd = join(root, 'final18-generated')
        await ownerPrivateDirectory(cwd)
        await advanceToG4(orchestrator, `Final-18 failure ${code}`)
        const marker = join(root, `final18-${code}.started`)
        const launched = await orchestrator.launchAttempt({ phase: 'build', attemptId: `final18-${code}`, command: process.execPath, args: [join(process.cwd(), 'packages/orchestrator/test-fixtures/final-22-launch-engine.mjs')], cwd, env: { PATH: process.env.PATH ?? '', GUIDELANE_FINAL_22_ENGINE_MARKER: marker } })
        await waitForMarker(marker)
        published = await (orchestrator as Orchestrator & FailurePublisher).publishAttemptFailure({ attemptId: launched.attemptId, failureCode: code })
        assert.notEqual(published.runState, 'successful')
      } finally {
        await orchestrator.reconcile().catch(() => undefined)
        await orchestrator.close()
      }

      const run = JSON.parse(await readFile(join(root, projectId, 'runs', `final18-${code}.json`), 'utf8')) as { failureCode?: unknown; status?: unknown }
      assert.equal(run.failureCode, code)
      assert.notEqual(run.status, 'successful')

      const reopened = await Orchestrator.open({ root, projectId, gitHead: testGitHead })
      try {
        const afterReopen = await reopened.snapshot()
        assert.equal(afterReopen.runState, published!.runState)
        assert.notEqual(afterReopen.runState, 'successful')
      } finally {
        await reopened.close()
      }
    })
  })
}
