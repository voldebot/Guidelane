import assert from 'node:assert/strict'
import { chmod, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import type { EvidenceReference, GateResult } from '../src/index.ts'
import { ArtifactStore, Orchestrator } from '../src/index.ts'
import { advanceToG4, digest, ownerPrivateDirectory, phaseRun, projectId, snapshot, testGitHead, withTempDir } from './helpers.ts'

const engine = resolve(process.cwd(), 'packages/orchestrator/test-fixtures/final-22-launch-engine.mjs')
const machineGates = ['lint', 'type', 'unit', 'build', 'boot', 'axe', 'smoke'] as const

async function seedEvidence(root: string): Promise<GateResult[]> {
  const artifacts: Record<string, string> = {}
  const gates = machineGates.map((name) => {
    const path = `evidence/final-34-${name}.txt`
    const contents = `${name} passed by a durable Final-34 receipt\n`
    artifacts[path] = contents
    return { name, status: 'passed' as const, authority: 'machine' as const, evidence: [{ path, sha256: digest(contents) }] }
  })
  const store = await ArtifactStore.open({ root, projectId, gitHead: testGitHead })
  await store.publish({
    snapshot: snapshot({ revision: 1, stage: 'G0', runState: 'idle', pendingDecision: 'submitIdea' }),
    run: phaseRun({ attemptId: 'final-34-hostile-path-evidence', evidence: gates.flatMap((gate) => gate.evidence) }),
    artifacts,
  })
  return gates
}

const posixOnly = { skip: process.platform === 'win32' ? 'the production process-identity paths require POSIX ps semantics' : false }

test('ORCH-FINAL-34 hostile PATH ps is never executed by production open, recovery, or completion identity checks', posixOnly, async () => {
  await withTempDir(async (root) => {
    const originalPath = process.env.PATH
    const hostileBin = join(root, 'hostile-bin')
    const marker = join(root, 'hostile-ps-ran')
    const ps = join(hostileBin, 'ps')
    const recoveryRoot = join(root, 'recovery-artifacts')
    const completionRoot = join(root, 'completion-artifacts')
    const launchRoot = join(root, 'launch')
    const engineMarker = join(root, 'engine-started')
    let recovery: Orchestrator | undefined
    let reopened: Orchestrator | undefined
    let completion: Orchestrator | undefined
    try {
      await ownerPrivateDirectory(hostileBin)
      await ownerPrivateDirectory(recoveryRoot)
      await ownerPrivateDirectory(completionRoot)
      await ownerPrivateDirectory(launchRoot)
      await writeFile(ps, `#!/bin/sh\nprintf hostile-ps-executed > ${JSON.stringify(marker)}\nexit 1\n`, { mode: 0o700 })
      await chmod(ps, 0o700)
      const gates = await seedEvidence(completionRoot)

      process.env.PATH = hostileBin
      recovery = await Orchestrator.open({ root: recoveryRoot, projectId, gitHead: testGitHead })
      await advanceToG4(recovery, 'Final-34 hostile PATH recovery journey')
      await recovery.launchAttempt({ phase: 'build', attemptId: 'final-34-hostile-recovery', command: process.execPath, args: [engine], cwd: launchRoot, env: { PATH: originalPath ?? '', GUIDELANE_FINAL_22_ENGINE_MARKER: engineMarker } })
      await recovery.close()
      recovery = undefined
      reopened = await Orchestrator.open({ root: recoveryRoot, projectId, gitHead: testGitHead })
      await reopened.reconcile()
      await reopened.close()
      reopened = undefined

      completion = await Orchestrator.open({ root: completionRoot, projectId, gitHead: testGitHead })
      await advanceToG4(completion, 'Final-34 hostile PATH completion journey')
      const launched = await completion.launchAttempt({ phase: 'build', attemptId: 'final-34-hostile-completion', command: process.execPath, args: [engine], cwd: launchRoot, env: { PATH: originalPath ?? '', GUIDELANE_FINAL_22_ENGINE_MARKER: engineMarker } })
      for (const gate of gates) await completion.recordGate(gate as GateResult & { evidence: EvidenceReference[] })
      await completion.completeAttempt({ attemptId: launched.attemptId })
      await assert.rejects(readFile(marker), { code: 'ENOENT' }, 'the hostile PATH executable must never be selected by a production identity operation')
    } finally {
      process.env.PATH = originalPath
      await completion?.close()
      await reopened?.close()
      await recovery?.close()
    }
  })
})
