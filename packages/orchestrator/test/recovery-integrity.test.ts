import assert from 'node:assert/strict'
import { chmod, mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { ArtifactStore, Orchestrator } from '../src/index.ts'
import { digest, launchIntentForTest, phaseRun, projectId, snapshot, testGitHead, withTempDir } from './helpers.ts'

type PersistedAttempt = {
  schemaVersion: number
  projectId: string
  attemptId: string
  phase: string
  receipt: Record<string, unknown>
  status: string
  sha256: string
}

type UnsignedAttempt = Omit<PersistedAttempt, 'sha256'>
const ALLOWED_ATTEMPT_STATUSES = ['running', 'interrupted', 'recovery-required'] as const

const canonicalAttempt = (attempt: UnsignedAttempt): string => `${JSON.stringify({ ...attempt, sha256: undefined })}\n`
const signedAttempt = (attempt: UnsignedAttempt): PersistedAttempt => ({ ...attempt, sha256: digest(canonicalAttempt(attempt)) })
const persistedAttempt = (overrides: Partial<UnsignedAttempt> = {}): PersistedAttempt => signedAttempt({
  schemaVersion: 1,
  projectId,
  attemptId: 'persisted-attempt',
  phase: 'build',
  receipt: { pid: 12345, pgid: 12345, startIdentity: 'recorded-start-identity' },
  status: 'running',
  ...overrides,
})

const writeAttempt = async (path: string, attempt: unknown): Promise<void> => {
  const attempts = dirname(path)
  await mkdir(attempts, { recursive: true, mode: 0o700 })
  await chmod(dirname(attempts), 0o700)
  await chmod(attempts, 0o700)
  await writeFile(path, `${JSON.stringify(attempt)}\n`, 'utf8')
}

async function assertDurableRecovery(orchestrator: Orchestrator): Promise<void> {
  const snapshot = await orchestrator.snapshot()
  assert.equal(snapshot.runState, 'recovery-required', 'unsafe attempt state must durably recover the canonical snapshot')
  assert.equal(snapshot.pendingDecision, null, 'recovery must not offer a stale decision')
  await assert.rejects(
    orchestrator.launchAttempt({ phase: 'build', command: process.execPath, args: [], cwd: process.cwd(), env: { PATH: process.env.PATH ?? '' } }),
    /recovery|required|attempt|unsafe/i,
    'new work must remain blocked while recovery is required'
  )
}

for (const [name, writeCorruptAttempt] of [
  ['malformed JSON', async (path: string) => writeFile(path, '{not-json', 'utf8')],
  ['unknown attempt schema', async (path: string) => writeAttempt(path, persistedAttempt({ schemaVersion: 999 }))],
  ['filename and attempt identity mismatch', async (path: string) => writeAttempt(path, persistedAttempt({ attemptId: 'different-attempt' }))],
  ['project identity mismatch', async (path: string) => writeAttempt(path, persistedAttempt({ projectId: 'other-project' }))],
] as const) {
  test(`S2-ATTEMPT-RECOVERY ${name} opens a locked canonical recovery snapshot without signalling a process`, async () => {
    await withTempDir(async (root) => {
      const attempts = join(root, projectId, 'attempts')
      await mkdir(attempts, { recursive: true })
      await writeCorruptAttempt(join(attempts, 'persisted-attempt.json'))
      await chmod(join(root, projectId), 0o700)
      await chmod(attempts, 0o700)

      const realKill = process.kill
      let signals = 0
      process.kill = ((...args: Parameters<typeof process.kill>) => { signals += 1; return realKill(...args) }) as typeof process.kill
      let orchestrator: Orchestrator | undefined
      try {
        orchestrator = await Orchestrator.open({ root, projectId, gitHead: testGitHead })
        await assertDurableRecovery(orchestrator)
        await assert.rejects(Orchestrator.open({ root, projectId, gitHead: testGitHead }), /lock|locked|active|already/i, 'the recovery owner must retain the project lock')
        assert.equal(signals, 0, 'invalid persisted attempts must not signal any process')
      } finally {
        process.kill = realKill
        await orchestrator?.close()
      }
    })
  })
}

for (const [name, record] of [
  ['a status tampered without recomputing its digest', () => ({ ...persistedAttempt(), status: 'interrupted' })],
  ['a missing digest', () => { const { sha256: _digest, ...unsigned } = persistedAttempt(); return unsigned }],
  ['a malformed digest', () => ({ ...persistedAttempt(), sha256: 'not-a-sha256' })],
  ['an unknown status with a recomputed digest', () => persistedAttempt({ status: 'successful' })],
] as const) {
  test(`S2-ATTEMPT-DIGEST ${name} yields locked durable recovery and blocks new work`, async () => {
    await withTempDir(async (root) => {
      const attempts = join(root, projectId, 'attempts')
      await mkdir(attempts, { recursive: true })
      await writeAttempt(join(attempts, 'persisted-attempt.json'), record())

      let orchestrator: Orchestrator | undefined
      try {
        orchestrator = await Orchestrator.open({ root, projectId, gitHead: testGitHead })
        await assertDurableRecovery(orchestrator)
        await assert.rejects(Orchestrator.open({ root, projectId, gitHead: testGitHead }), /lock|locked|active|already/i)
      } finally {
        await orchestrator?.close()
      }
    })
  })
}

test('S2-ATTEMPT-DIGEST accepts only the explicit persisted status union', () => {
  assert.deepEqual(ALLOWED_ATTEMPT_STATUSES, ['running', 'interrupted', 'recovery-required'])
})

function wrapperBoundRunningAttempt(attemptId: string, processIdentity: number): PersistedAttempt {
  const nonce = digest(`final-29-test-only-receipt-${processIdentity}`)
  return persistedAttempt({
    attemptId,
    receipt: {
      pid: processIdentity,
      pgid: processIdentity,
      startIdentity: `test-owned-distinct-process-${processIdentity}`,
      nonce,
      wrapperCommand: `${process.cwd()}/packages/orchestrator/src/attempt-wrapper.mjs`,
    },
    intent: launchIntentForTest(nonce),
  } as Partial<UnsignedAttempt>)
}

async function assertRunningMultiplicityLatch(count: 2 | 3): Promise<void> {
  await withTempDir(async (root) => {
    const store = await ArtifactStore.open({ root, projectId, gitHead: testGitHead })
    await store.publish({
      snapshot: snapshot({ revision: 1, stage: 'G4', runState: 'running', pendingDecision: null }),
      run: phaseRun({ attemptId: `multiplicity-${count}-g4`, phase: 'build', status: 'running' }),
      artifacts: {},
    })
    const attempts = join(root, projectId, 'attempts')
    await mkdir(attempts, { recursive: true })
    for (const index of Array.from({ length: count }, (_, value) => value)) {
      const attemptId = `attempt-${String.fromCharCode('a'.charCodeAt(0) + index)}`
      // These structurally valid receipts name deliberately non-existent,
      // test-only process groups. The test spies on non-zero signals, so it
      // never authorizes a signal toward any ambient process.
      await writeAttempt(join(attempts, `${attemptId}.json`), wrapperBoundRunningAttempt(attemptId, 900_001 + index))
    }

    const realKill = process.kill
    const nonZeroSignals: Array<{ target: number; signal: NodeJS.Signals | number | undefined }> = []
    process.kill = ((target: number, signal?: NodeJS.Signals | number) => {
      if (signal !== 0) nonZeroSignals.push({ target, signal })
      return realKill(target, signal!)
    }) as typeof process.kill
    let orchestrator: Orchestrator | undefined
    try {
      orchestrator = await Orchestrator.open({ root, projectId, gitHead: testGitHead })
      const recovered = await orchestrator.snapshot()
      assert.equal(recovered.stage, 'G4', 'valid active-attempt ambiguity must preserve the build-stage recovery context')
      assert.equal(recovered.runState, 'recovery-required', 'more than one valid running attempt must durably latch recovery')
      assert.equal(recovered.pendingDecision, null, 'ambiguous recovery cannot advertise a replacement decision')
      assert.equal(recovered.recoveryReason?.includes('multiple persisted attempts are active'), true, 'the durable latch must record multiplicity rather than schema corruption')

      const reconciled = await orchestrator.reconcile()
      assert.deepEqual(reconciled, { interruptedAttemptIds: [] }, 'ambiguous receipts have no exact authority for reconciliation')
      const afterReconcile = await orchestrator.snapshot()
      assert.equal(afterReconcile.runState, 'recovery-required', 'reconcile() must not resolve an ambiguous active-attempt latch')
      await assert.rejects(
        orchestrator.command({ type: 'startBuild' }),
        /recovery|required|active|attempt/i,
        'a new build must remain blocked while no unique active authority exists',
      )
      await assert.rejects(
        orchestrator.launchAttempt({ phase: 'build', command: process.execPath, args: [], cwd: process.cwd(), env: { PATH: process.env.PATH ?? '' } }),
        /recovery|required|active|attempt/i,
        'a replacement launch must remain blocked while recovery ambiguity is latched',
      )
      assert.deepEqual(nonZeroSignals, [], 'ambiguous valid receipts must never signal a process group or PID')
    } finally {
      process.kill = realKill
      await orchestrator?.close()
    }
  })
}

test('S2-ATTEMPT-RUNNING-MULTIPLICITY 2 individually digest-valid wrapper-bound running attempts latch recovery without signalling or selecting an active authority', async () => {
  await assertRunningMultiplicityLatch(2)
})

test('S2-ATTEMPT-RUNNING-MULTIPLICITY 3 individually digest-valid wrapper-bound running attempts latch recovery without signalling or selecting an active authority', async () => {
  await assertRunningMultiplicityLatch(3)
})
