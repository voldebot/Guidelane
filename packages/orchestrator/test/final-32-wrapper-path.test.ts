import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { cp } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { test } from 'node:test'
import { promisify } from 'node:util'
import type { EvidenceReference, GateResult } from '../src/index.ts'
import { advanceToG4, digest, ownerPrivateDirectory, phaseRun, projectId, snapshot, testGitHead, withTempDir } from './helpers.ts'

const engine = resolve(process.cwd(), 'packages/orchestrator/test-fixtures/final-22-launch-engine.mjs')
const requiredMachineGateNames = ['lint', 'type', 'unit', 'build', 'boot', 'axe', 'smoke'] as const
const exec = promisify(execFile)

async function seedEvidence(module: typeof import('../src/index.ts'), root: string): Promise<GateResult[]> {
  const artifacts: Record<string, string> = {}
  const gates = requiredMachineGateNames.map((name) => {
    const path = `evidence/final32-wrapper-path-${name}.txt`
    const contents = `${name} passed by the final-32 wrapper path receipt\n`
    artifacts[path] = contents
    return { name, status: 'passed' as const, authority: 'machine' as const, evidence: [{ path, sha256: digest(contents) }] }
  })
  const store = await module.ArtifactStore.open({ root, projectId, gitHead: testGitHead })
  await store.publish({
    snapshot: snapshot({ revision: 1, stage: 'G0', runState: 'idle', pendingDecision: 'submitIdea' }),
    run: phaseRun({ attemptId: 'final32-wrapper-path-evidence-seed', evidence: gates.flatMap((gate) => gate.evidence) }),
    artifacts,
  })
  return gates
}

async function waitForExactGroupAbsence(pgid: number): Promise<void> {
  const deadline = Date.now() + 2_000
  while (Date.now() < deadline) {
    const { stdout } = await exec('ps', ['-ax', '-o', 'pgid=,stat='])
    const states = stdout.split('\n')
      .map((line) => line.trim().split(/\s+/, 2))
      .filter(([observed]) => Number(observed) === pgid)
      .map(([, state]) => state ?? '')
    if (states.length === 0 || states.every((state) => state.startsWith('Z'))) return
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 20))
  }
  throw new Error(`test-owned wrapper process group ${pgid} remained observable after exact cleanup`)
}

test('ORCH-PATH-FINAL-32 production wrapper identity and completeAttempt work from a source path containing spaces', {
  skip: process.platform === 'win32' ? 'POSIX ps command identity is unavailable on Windows' : false,
  timeout: 8_000,
}, async () => {
  await withTempDir(async (root) => {
    const copiedSource = join(root, 'production source with spaces')
    const artifactRoot = join(root, 'artifact root with spaces')
    const target = join(root, 'target directory')
    const marker = join(root, 'engine started')
    await cp(resolve(process.cwd(), 'packages/orchestrator/src'), copiedSource, { recursive: true })
    await ownerPrivateDirectory(artifactRoot)
    await ownerPrivateDirectory(target)

    const copiedModule = await import(pathToFileURL(join(copiedSource, 'index.ts')).href) as typeof import('../src/index.ts')
    const gates = await seedEvidence(copiedModule, artifactRoot)
    const orchestrator = await copiedModule.Orchestrator.open({ root: artifactRoot, projectId, gitHead: testGitHead })
    let pgid: number | undefined
    try {
      await advanceToG4(orchestrator, 'Final-32 wrapper path containing spaces')
      const launched = await orchestrator.launchAttempt({
        phase: 'build', attemptId: 'final32-wrapper-path', command: process.execPath, args: [engine], cwd: target,
        env: { PATH: process.env.PATH ?? '', GUIDELANE_FINAL_22_ENGINE_MARKER: marker },
      })
      pgid = launched.receipt.pgid
      assert.match(launched.receipt.wrapperCommand, /production source with spaces/, 'the real launched wrapper must come from the copied path with spaces')
      for (const gate of gates) await orchestrator.recordGate(gate as GateResult & { evidence: EvidenceReference[] })

      const g5 = await orchestrator.completeAttempt({ attemptId: launched.attemptId })
      assert.deepEqual(
        { stage: g5.stage, runState: g5.runState, pendingDecision: g5.pendingDecision },
        { stage: 'G5', runState: 'waiting', pendingDecision: 'acceptResult' },
      )
      await waitForExactGroupAbsence(launched.receipt.pgid)
    } finally {
      if (pgid !== undefined) {
        try { process.kill(-pgid, 'SIGKILL') } catch (error: unknown) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error }
        await waitForExactGroupAbsence(pgid)
      }
      await orchestrator.close()
    }
  })
})
