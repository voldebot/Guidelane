import assert from 'node:assert/strict'
import { readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import { ArtifactStore, Orchestrator } from '../src/index.ts'
import type { GateResult } from '../src/index.ts'
import { advanceToG4, digest, ownerPrivateDirectory, phaseRun, projectId, snapshot, testGitHead, withTempDir, writeSignedAttempt } from './helpers.ts'

type LifecyclePublisher = {
  advancePhase(input: {
    stage: 'G5'
    runState: 'waiting' | 'recovery-required'
    pendingDecision: 'acceptResult' | null
    gates?: GateResult[]
  }): Promise<unknown>
}

type Manifest = { run: { evidence: unknown; gitSnapshot: unknown } }

const gitHeadA = '0123456789abcdef0123456789abcdef01234567'
const gitHeadB = 'fedcba9876543210fedcba9876543210fedcba98'
const requiredMachineGateNames = ['lint', 'type', 'unit', 'build', 'boot', 'axe', 'smoke'] as const

async function atBuildResultGate(root: string, evidence: Record<string, string> = {}): Promise<Orchestrator> {
  if (Object.keys(evidence).length > 0) {
    const store = await ArtifactStore.open({ root, projectId, gitHead: testGitHead })
    await store.publish({
      snapshot: snapshot({ revision: 1, stage: 'G0', pendingDecision: 'submitIdea' }),
      run: phaseRun({ attemptId: 'seed-review-evidence', evidence: Object.entries(evidence).map(([path, contents]) => ({ path, sha256: digest(contents) })) }),
      artifacts: evidence,
    })
  }
  const orchestrator = await Orchestrator.open({ root, projectId, gitHead: testGitHead })
  await orchestrator.command({ type: 'submitIdea', idea: 'Review blocker coverage' })
  await orchestrator.command({ type: 'approveBlueprint' })
  await orchestrator.command({ type: 'approvePlan' })
  await orchestrator.command({ type: 'startBuild' })
  return orchestrator
}

function publisher(orchestrator: Orchestrator): LifecyclePublisher {
  return orchestrator as Orchestrator & LifecyclePublisher
}

test('S2-REVIEW-G5-01 canonical acceptance rejects an empty gate set before G5 or G6 can be published', async () => {
  await withTempDir(async (root) => {
    const orchestrator = await atBuildResultGate(root)
    try {
      await assert.rejects(
        publisher(orchestrator).advancePhase({ stage: 'G5', runState: 'waiting', pendingDecision: 'acceptResult', gates: [] }),
        /gate|required|passed|evidence/i,
      )
      const state = await orchestrator.snapshot()
      assert.equal(state.stage, 'G4')
      assert.equal(state.runState, 'running')
    } finally {
      await orchestrator.close()
    }
  })
})

for (const status of ['pending', 'running', 'failed', 'blocked', 'needs_user'] as const) {
  test(`S2-REVIEW-G5-02-${status} canonical acceptance rejects a non-passing machine gate`, async () => {
    await withTempDir(async (root) => {
      const evidence = 'machine gate receipt\n'
      const evidenceReference = { path: 'evidence/non-passing-machine-gate.txt', sha256: digest(evidence) }
      const orchestrator = await atBuildResultGate(root, { [evidenceReference.path]: evidence })
      try {
        await assert.rejects(
          publisher(orchestrator).advancePhase({
            stage: 'G5', runState: 'waiting', pendingDecision: 'acceptResult',
            gates: [{ name: `machine-${status}`, status, authority: 'machine', evidence: [evidenceReference] }],
          }),
          /gate|required|passed|accept/i,
        )
        assert.equal((await orchestrator.snapshot()).stage, 'G4')
      } finally {
        await orchestrator.close()
      }
    })
  })
}

for (const [mutation, mutate] of [
  ['deletion', async (path: string) => rm(path)],
  ['corruption', async (path: string) => writeFile(path, 'mutated after acceptance\n', 'utf8')],
] as const) {
  test(`S2-REVIEW-G6-03-${mutation} G6 retains every accepted evidence reference and reopens recovery-required when evidence is ${mutation}`, async () => {
    await withTempDir(async (root) => {
      const first = 'first accepted machine receipt\n'
      const second = 'second accepted machine receipt\n'
      const firstReference = { path: 'evidence/accepted-first.txt', sha256: digest(first) }
      const secondReference = { path: 'evidence/accepted-second.txt', sha256: digest(second) }
      const acceptedGates = requiredMachineGateNames.map((name, index) => ({
        name,
        status: 'passed' as const,
        authority: 'machine' as const,
        evidence: [index % 2 === 0 ? firstReference : secondReference],
      }))
      const acceptedEvidence = acceptedGates.flatMap((gate) => gate.evidence)
      const orchestrator = await atBuildResultGate(root, {
        [firstReference.path]: first,
        [secondReference.path]: second,
      })
      try {
        await publisher(orchestrator).advancePhase({
          stage: 'G5', runState: 'waiting', pendingDecision: 'acceptResult',
          gates: acceptedGates,
        })
        const accepted = await orchestrator.command({ type: 'acceptResult' })
        assert.equal(accepted.stage, 'G6')
        assert.equal(accepted.runState, 'successful')
        const manifest = JSON.parse(await readFile(join(root, projectId, 'manifest.json'), 'utf8')) as Manifest
        assert.deepEqual(manifest.run.evidence, acceptedEvidence, 'the G6 manifest must carry every accepted required machine-gate evidence reference')
      } finally {
        await orchestrator.close()
      }

      await mutate(join(root, projectId, firstReference.path))
      const reopened = await Orchestrator.open({ root, projectId, gitHead: testGitHead })
      try {
        const recovered = await reopened.snapshot()
        assert.equal(recovered.runState, 'recovery-required')
        assert.equal(recovered.pendingDecision, null)
      } finally {
        await reopened.close()
      }
    })
  })
}

for (const [label, gates] of [
  ['empty gates', []],
  ['a passed machine gate without evidence', [{ name: 'build', status: 'passed', authority: 'machine' }]],
] as const) {
  test(`S2-REVIEW-G6-04-${label} cannot be accepted into G6`, async () => {
    await withTempDir(async (root) => {
      const store = await ArtifactStore.open({ root, projectId, gitHead: testGitHead })
      await store.publish({
        snapshot: snapshot({ revision: 1, stage: 'G5', runState: 'waiting', pendingDecision: 'acceptResult', gates }),
        run: phaseRun({ attemptId: `preexisting-g5-${label.replaceAll(' ', '-')}` }),
        artifacts: {},
      })
      const orchestrator = await Orchestrator.open({ root, projectId, gitHead: testGitHead })
      try {
        await assert.rejects(orchestrator.command({ type: 'acceptResult' }), /gate|required|passed|evidence|accept/i)
        const state = await orchestrator.snapshot()
        assert.equal(state.stage, 'G5')
        assert.equal(state.runState, 'waiting')
      } finally {
        await orchestrator.close()
      }
    })
  })
}

test('S2-REVIEW-GIT-04 supplied gitHead is persisted by every published run, accepts an equal restart, and recovers on mismatch', async () => {
  await withTempDir(async (root) => {
    const first = await Orchestrator.open({ root, projectId, gitHead: gitHeadA })
    try {
      await first.command({ type: 'submitIdea', idea: 'Git identity must be durable' })
      await first.command({ type: 'approveBlueprint' })
      const runPaths = await readdir(join(root, projectId, 'runs'))
      assert.equal(runPaths.length, 2)
      for (const path of runPaths) {
        const run = JSON.parse(await readFile(join(root, projectId, 'runs', path), 'utf8')) as { gitSnapshot: unknown }
        assert.equal(run.gitSnapshot, gitHeadA, `${path} must retain the supplied gitHead`)
      }
    } finally {
      await first.close()
    }

    const sameHead = await Orchestrator.open({ root, projectId, gitHead: gitHeadA })
    try {
      assert.notEqual((await sameHead.snapshot()).runState, 'recovery-required')
    } finally {
      await sameHead.close()
    }

    const mismatch = await Orchestrator.open({ root, projectId, gitHead: gitHeadB })
    try {
      const recovered = await mismatch.snapshot()
      assert.equal(recovered.runState, 'recovery-required')
      assert.match(recovered.recoveryReason ?? '', /git|manifest|snapshot/i)
    } finally {
      await mismatch.close()
    }
  })
})

test('S2-REVIEW-CONCURRENCY-05 concurrent launchAttempt calls have exactly one durable winner', async () => {
  await withTempDir(async (root) => {
    const orchestrator = await Orchestrator.open({ root, projectId, gitHead: testGitHead })
    const generatedProject = join(root, 'generated-project')
    const engine = join(process.cwd(), 'packages/orchestrator/test-fixtures/final-22-launch-engine.mjs')
    try {
      await ownerPrivateDirectory(generatedProject)
      await advanceToG4(orchestrator, 'Concurrent launch attempts')
      const outcomes = await Promise.allSettled(['attempt-alpha', 'attempt-beta'].map((attemptId) => orchestrator.launchAttempt({
        phase: 'build', attemptId, command: process.execPath, args: [engine], cwd: generatedProject, env: { PATH: process.env.PATH ?? '', GUIDELANE_FINAL_22_ENGINE_MARKER: join(root, `${attemptId}.started`) }, receiptTimeoutMs: 500,
      })))
      assert.equal(outcomes.filter((outcome) => outcome.status === 'fulfilled').length, 1)
      assert.equal(outcomes.filter((outcome) => outcome.status === 'rejected').length, 1)
      assert.equal((await readdir(join(root, projectId, 'attempts'))).filter((name) => name.endsWith('.json')).length, 1)
    } finally {
      await orchestrator.reconcile().catch(() => undefined)
      await orchestrator.close()
    }
  })
})

test('S2-REVIEW-CONCURRENCY-06 concurrent same-revision commands have exactly one winner and preserve its revision', async () => {
  await withTempDir(async (root) => {
    const orchestrator = await Orchestrator.open({ root, projectId, gitHead: testGitHead })
    try {
      const outcomes = await Promise.allSettled([
        orchestrator.command({ type: 'submitIdea', idea: 'first concurrent command' }),
        orchestrator.command({ type: 'submitIdea', idea: 'second concurrent command' }),
      ])
      assert.equal(outcomes.filter((outcome) => outcome.status === 'fulfilled').length, 1)
      assert.equal(outcomes.filter((outcome) => outcome.status === 'rejected').length, 1)
      const state = await orchestrator.snapshot()
      assert.equal(state.revision, 1)
      assert.equal(state.stage, 'G1')
      assert.equal((await readdir(join(root, projectId, 'runs'))).length, 1)
    } finally {
      await orchestrator.close()
    }
  })
})

for (const [label, attemptId] of [
  ['traversal', '../outside-attempt'],
  ['slash separator', 'nested/attempt'],
  ['backslash separator', 'nested\\attempt'],
  ['dot identifier', '.'],
  ['whitespace identifier', 'attempt id'],
] as const) {
  test(`S2-REVIEW-ATTEMPT-ID-07-${label} rejects unsafe identity before creating an attempt file`, async () => {
    await withTempDir(async (root) => {
      const orchestrator = await Orchestrator.open({ root, projectId, gitHead: testGitHead })
      try {
        await advanceToG4(orchestrator, `Reject unsafe attempt ${label}`)
        await assert.rejects(
          orchestrator.launchAttempt({ phase: 'build', attemptId, command: process.execPath, args: [], cwd: root, env: { PATH: process.env.PATH ?? '' } }),
          /attempt|id|identity|path|invalid/i,
        )
        assert.deepEqual((await readdir(join(root, projectId))).filter((name) => name === 'attempts'), [], 'an invalid attempt identity must not create an attempt file or directory')
      } finally {
        await orchestrator.close()
      }
    })
  })
}

test('S2-REVIEW-ATTEMPT-RECOVERY-08 reopening retains the sole running attempt without replacing it', async () => {
  await withTempDir(async (root) => {
    await writeSignedAttempt(root, 'durable-running-attempt', { receipt: { pid: 1, pgid: 1, startIdentity: 'durable-receipt', nonce: 'a'.repeat(64) } })
    const reopened = await Orchestrator.open({ root, projectId, gitHead: testGitHead })
    try {
      const attempt = await reopened.attempt('durable-running-attempt')
      assert.equal(attempt.status, 'running')
      assert.equal(attempt.attemptId, 'durable-running-attempt')
    } finally {
      await reopened.close()
    }
  })
})
