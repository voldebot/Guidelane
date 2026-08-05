import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import * as orchestratorPublic from '../src/index.ts'
import type { GateResult, RunFailureCode } from '../src/index.ts'
import { ArtifactStore } from '../src/index.ts'
import { digest, phaseRun, projectId, snapshot, testGitHead, withTempDir } from './helpers.ts'

type LifecyclePublisher = {
  advancePhase(input: {
    stage: 'G5'
    runState: 'waiting' | 'recovery-required'
    pendingDecision: 'acceptResult' | null
    gates?: GateResult[]
  }): Promise<unknown>
}

const expectedFailureCodes = [
  'receipt',
  'denial',
  'hook',
  'stall',
  'framing',
  'io',
  'rate_limit_five_hour',
  'rate_limit_seven_day',
  'interrupted',
  'recovery',
  'unknown_event',
] as const satisfies readonly RunFailureCode[]
const requiredMachineGateNames = ['lint', 'type', 'unit', 'build', 'boot', 'axe', 'smoke'] as const

const snapshotShape = (snapshot: { stage: unknown; runState: unknown; pendingDecision: unknown }, stage: string, runState: string, pendingDecision: string | null): void => {
  assert.deepEqual(
    { stage: snapshot.stage, runState: snapshot.runState, pendingDecision: snapshot.pendingDecision },
    { stage, runState, pendingDecision }
  )
}

test('S2-LIFECYCLE-01 canonical snapshots progress G0 through G6 with one truthful pending decision at each user gate', async () => {
  await withTempDir(async (root) => {
    const evidenceByPath = Object.fromEntries(requiredMachineGateNames.map((name) => [`evidence/${name}-gate.txt`, `${name} gate passed with a durable test receipt\n`]))
    const evidenceReferences = Object.entries(evidenceByPath).map(([path, contents]) => ({ path, sha256: digest(contents) }))
    const store = await ArtifactStore.open({ root, projectId, gitHead: testGitHead })
    await store.publish({
      snapshot: snapshot({ revision: 1, stage: 'G0', pendingDecision: 'submitIdea' }),
      run: phaseRun({ attemptId: 'seed-build-evidence', evidence: evidenceReferences }),
      artifacts: evidenceByPath,
    })

    const orchestrator = await orchestratorPublic.Orchestrator.open({ root, projectId, gitHead: testGitHead })
    snapshotShape(await orchestrator.snapshot(), 'G0', 'idle', 'submitIdea')

    snapshotShape(await orchestrator.command({ type: 'submitIdea', idea: 'Türkçe bir yerel web uygulaması' }), 'G1', 'waiting', 'approveBlueprint')
    snapshotShape(await orchestrator.command({ type: 'approveBlueprint' }), 'G2', 'waiting', 'approvePlan')
    snapshotShape(await orchestrator.command({ type: 'approvePlan' }), 'G3', 'waiting', 'startBuild')
    snapshotShape(await orchestrator.command({ type: 'startBuild' }), 'G4', 'running', null)

    const publisher = orchestrator as orchestratorPublic.Orchestrator & LifecyclePublisher
    await assert.rejects(
      publisher.advancePhase({
        stage: 'G5',
        runState: 'waiting',
        pendingDecision: 'acceptResult',
        gates: [{ status: 'passed', authority: 'machine', name: 'build' }],
      }),
      /evidence|digest|immutable/i,
      'a passed machine gate with no evidence field must not publish G5'
    )
    await assert.rejects(
      publisher.advancePhase({
        stage: 'G5',
        runState: 'waiting',
        pendingDecision: 'acceptResult',
        gates: [{ status: 'passed', authority: 'machine', name: 'build', evidence: [] }],
      }),
      /evidence|digest|immutable/i,
      'a passed machine gate without evidence must not publish G5'
    )
    await publisher.advancePhase({
      stage: 'G5',
      runState: 'waiting',
      pendingDecision: 'acceptResult',
      gates: evidenceReferences.map((evidence, index) => ({ status: 'passed', authority: 'machine' as const, name: requiredMachineGateNames[index]!, evidence: [evidence] })),
    })
    snapshotShape(await orchestrator.snapshot(), 'G5', 'waiting', 'acceptResult')
    const manifest = JSON.parse(await readFile(join(root, projectId, 'manifest.json'), 'utf8')) as { run: { evidence: unknown } }
    assert.deepEqual(manifest.run.evidence, evidenceReferences, 'G5 must publish every required passed machine-gate evidence reference in its durable run receipt')
    assert.deepEqual(await (await ArtifactStore.open({ root, projectId, gitHead: testGitHead })).artifactBytes(evidenceReferences[0]!.path), Buffer.from(evidenceByPath[evidenceReferences[0]!.path]!))
    snapshotShape(await orchestrator.command({ type: 'acceptResult' }), 'G6', 'successful', null)
  })
})

test('S2-LIFECYCLE-02 running and recovery snapshots cannot advertise a stale user decision', async () => {
  await withTempDir(async (root) => {
    const orchestrator = await orchestratorPublic.Orchestrator.open({ root, projectId, gitHead: testGitHead })
    await orchestrator.command({ type: 'submitIdea', idea: 'Güvenli fikir' })
    await orchestrator.command({ type: 'approveBlueprint' })
    await orchestrator.command({ type: 'approvePlan' })
    const running = await orchestrator.command({ type: 'startBuild' })
    assert.equal(running.runState, 'running')
    assert.equal(running.pendingDecision, null)

    const publisher = orchestrator as orchestratorPublic.Orchestrator & LifecyclePublisher
    await publisher.advancePhase({ stage: 'G5', runState: 'recovery-required', pendingDecision: null })
    const recovery = await orchestrator.snapshot()
    assert.equal(recovery.runState, 'recovery-required')
    assert.equal(recovery.pendingDecision, null)
  })
})

test('S2-FAILURE-VOCAB-03 public gate and failure vocabularies remain exhaustive and no failure maps to success', () => {
  const api = orchestratorPublic as typeof orchestratorPublic & {
    GATE_RESULT_STATUSES: readonly GateResult['status'][]
    GATE_AUTHORITIES: readonly GateResult['authority'][]
    RUN_FAILURE_CODES: readonly RunFailureCode[]
    RUN_FAILURE_STATES: Readonly<Record<RunFailureCode, string>>
  }
  assert.deepEqual([...api.GATE_RESULT_STATUSES].sort(), ['blocked', 'failed', 'needs_user', 'passed', 'pending', 'running'])
  assert.deepEqual([...api.GATE_AUTHORITIES].sort(), ['isolated_review', 'machine', 'user'])
  assert.deepEqual([...api.RUN_FAILURE_CODES].sort(), [...expectedFailureCodes].sort())
  for (const code of expectedFailureCodes) {
    assert.equal(api.RUN_FAILURE_CODES.includes(code), true, `${code} must remain a distinct public failure code`)
    assert.notEqual(api.RUN_FAILURE_STATES[code], 'successful', `${code} must never collapse to success`)
  }
})

test('S2-FAIL-07 explicit recovery failure vocabulary can never be classified or published as success', () => {
  const api = orchestratorPublic as typeof orchestratorPublic & {
    RUN_FAILURE_CODES: readonly RunFailureCode[]
    RUN_FAILURE_STATES: Readonly<Record<RunFailureCode, string>>
  }
  for (const code of ['receipt', 'recovery', 'unknown_event'] as const) {
    assert.equal(api.RUN_FAILURE_CODES.includes(code), true, `${code} must remain an explicit public failure code`)
    assert.equal(api.RUN_FAILURE_STATES[code], 'recovery-required', `${code} must publish recovery-required, not an ambiguous terminal state`)
    assert.notEqual(api.RUN_FAILURE_STATES[code], 'successful', `${code} must never be classified or published as success`)
  }
})

test('S2-PROJECT-LOCK-OPEN-04 Orchestrator.open retains one project authority and rejects a concurrent opener', async () => {
  await withTempDir(async (root) => {
    const first = await orchestratorPublic.Orchestrator.open({ root, projectId, gitHead: testGitHead })
    try {
      await assert.rejects(
        orchestratorPublic.Orchestrator.open({ root, projectId, gitHead: testGitHead }),
        /lock|locked|active|already/i,
        'a second supervisor must fail deterministically while the first remains open'
      )
    } finally {
      const close = (first as typeof first & { close?: () => Promise<void> }).close
      if (typeof close === 'function') await close.call(first)
    }
  })
})
