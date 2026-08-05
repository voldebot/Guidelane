import assert from 'node:assert/strict'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { ArtifactStore, Orchestrator } from '../src/index.ts'
import type { ProjectSnapshot, RunFailureCode } from '../src/index.ts'
import { digest, phaseRun, projectId, snapshot, testGitHead, withTempDir } from './helpers.ts'

type AttemptFailurePublisher = {
  publishAttemptFailure(input: { attemptId: string; failureCode: RunFailureCode }): Promise<ProjectSnapshot>
}

const engine = resolve(process.cwd(), 'packages/orchestrator/test-fixtures/final-22-launch-engine.mjs')
const productionEnvironmentNames = new Set([
  'PATH', 'HOME', 'USER', 'LOGNAME', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL', 'LC_CTYPE', 'SHELL', 'DISABLE_AUTOUPDATER',
])
const platformGeneratedTargetEnvironmentNames = process.platform === 'darwin' ? new Set(['__CF_USER_TEXT_ENCODING']) : new Set<string>()
const forbiddenEnvironmentNames = ['GITHUB_TOKEN', 'NPM_TOKEN', 'DATABASE_URL', 'ANTHROPIC_API_KEY', 'FINAL27_ARBITRARY_SECRET'] as const

async function waitForFile(path: string): Promise<void> {
  const deadline = Date.now() + 1_000
  while (Date.now() < deadline) {
    try { await access(path); return } catch { await new Promise((resolvePromise) => setTimeout(resolvePromise, 20)) }
  }
  throw new Error(`timed out waiting for test-owned marker: ${path}`)
}

async function advanceToG4(orchestrator: Orchestrator): Promise<void> {
  await orchestrator.command({ type: 'submitIdea', idea: 'Final-27 contract journey' })
  await orchestrator.command({ type: 'approveBlueprint' })
  await orchestrator.command({ type: 'approvePlan' })
  await orchestrator.command({ type: 'startBuild' })
}

test('S2-F27-A launchAttempt applies the production environment allow-list at the detached wrapper-to-target boundary', async () => {
  await withTempDir(async (root) => {
    const cwd = join(root, 'target')
    const observedPath = join(root, 'observed-target-environment.json')
    const target = join(root, 'inspect-environment.mjs')
    const orchestrator = await Orchestrator.open({ root, projectId, gitHead: testGitHead })
    await mkdir(cwd, { mode: 0o700 })
    await writeFile(target, [
      "import { writeFile } from 'node:fs/promises'",
      "await writeFile(process.argv[2], JSON.stringify(process.env), 'utf8')",
      'setInterval(() => undefined, 1_000)',
    ].join('\n'), { mode: 0o600 })
    const suppliedEnvironment = {
      PATH: process.env.PATH ?? '', HOME: root, USER: 'guidelane-user', LOGNAME: 'guidelane-login', TMPDIR: root, TMP: root, TEMP: root,
      LANG: 'tr_TR.UTF-8', LC_ALL: 'tr_TR.UTF-8', LC_CTYPE: 'tr_TR.UTF-8', SHELL: '/bin/zsh', DISABLE_AUTOUPDATER: '1',
      GUIDELANE_FINAL_27_MARKER: 'allowed-product-marker',
      __CF_USER_TEXT_ENCODING: 'caller-controlled-locale-sentinel',
      GITHUB_TOKEN: 'github-token-must-not-reach-target', NPM_TOKEN: 'npm-token-must-not-reach-target', DATABASE_URL: 'postgres://must-not-reach-target',
      ANTHROPIC_API_KEY: 'anthropic-key-must-not-reach-target', FINAL27_ARBITRARY_SECRET: 'arbitrary-secret-must-not-reach-target',
    }
    try {
      await advanceToG4(orchestrator)
      await orchestrator.launchAttempt({ phase: 'build', attemptId: 'final27-env-boundary', command: process.execPath, args: [target, observedPath], cwd, env: suppliedEnvironment })
      await waitForFile(observedPath)
      const observed = JSON.parse(await readFile(observedPath, 'utf8')) as Record<string, string | undefined>
      for (const name of forbiddenEnvironmentNames) assert.equal(observed[name], undefined, `${name} must never cross the real wrapper-to-target boundary`)
      assert.notEqual(observed.__CF_USER_TEXT_ENCODING, 'caller-controlled-locale-sentinel', 'the Darwin locale key may be platform-generated but must not preserve a caller-controlled value')
      assert.equal(observed.GUIDELANE_FINAL_27_MARKER, 'allowed-product-marker')
      for (const name of Object.keys(observed)) assert.equal(productionEnvironmentNames.has(name) || name.startsWith('GUIDELANE_') || platformGeneratedTargetEnvironmentNames.has(name), true, `${name} is not an approved production target environment key`)
    } finally {
      await orchestrator.reconcile().catch(() => undefined)
      await orchestrator.close()
    }
  })
})

test('S2-F27-B a digest-valid manifest with non-array snapshot.gates reopens only as canonical recovery and remains publicly projectable', async () => {
  await withTempDir(async (root) => {
    const store = await ArtifactStore.open({ root, projectId, gitHead: testGitHead })
    await store.publish({
      snapshot: snapshot({ revision: 1, stage: 'G1', runState: 'waiting', pendingDecision: 'approveBlueprint', gates: [] }),
      run: phaseRun({ attemptId: 'final27-valid-manifest' }),
      artifacts: {},
    })
    const manifestPath = join(root, projectId, 'manifest.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>
    const persistedSnapshot = manifest.snapshot as Record<string, unknown>
    persistedSnapshot.gates = 'not-an-array'
    manifest.sha256 = digest(`${JSON.stringify({ ...manifest, sha256: undefined })}\n`)
    await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`, 'utf8')

    const orchestrator = await Orchestrator.open({ root, projectId, gitHead: testGitHead })
    try {
      const recovered = await orchestrator.snapshot()
      assert.equal(recovered.runState, 'recovery-required', 'invalid complete snapshot schema must never be accepted')
      assert.equal(recovered.pendingDecision, null)
      assert.equal(Array.isArray(recovered.gates), true, 'recovery snapshots must retain the canonical gates array schema')
      assert.ok(recovered.recoveryReason)
      const publicState = await orchestrator.publicSnapshot()
      assert.equal(publicState.runState, 'recovery-required', 'invalid complete snapshot schema must never be projected as ordinary state')
      assert.equal(Array.isArray(publicState.gates), true, 'publicSnapshot() must remain callable after corruption')
    } finally {
      await orchestrator.close()
    }
  })
})

test('S2-F27-C submitIdea from a valid persisted legacy R1 idea snapshot publishes canonical G1 or fails closed, never legacy blueprint_review/null', async () => {
  await withTempDir(async (root) => {
    const store = await ArtifactStore.open({ root, projectId, gitHead: testGitHead })
    await store.publish({
      snapshot: snapshot({ revision: 1, stage: 'idea', runState: 'idle', pendingDecision: 'submitIdea' }),
      run: phaseRun({ attemptId: 'final27-legacy-r1' }),
      artifacts: {},
    })
    const orchestrator = await Orchestrator.open({ root, projectId, gitHead: testGitHead })
    try {
      const published = await orchestrator.command({ type: 'submitIdea', idea: 'Migrate the durable R1 idea state' })
      if (published.runState === 'recovery-required') {
        assert.equal(published.pendingDecision, null)
      } else {
        assert.deepEqual(
          { stage: published.stage, runState: published.runState, pendingDecision: published.pendingDecision },
          { stage: 'G1', runState: 'waiting', pendingDecision: 'approveBlueprint' },
          'a legacy read must not publish an obsolete stage label or erase its next decision',
        )
      }
    } finally {
      await orchestrator.close()
    }
  })
})

test('S2-F27-D an immutable terminal-run collision after exact G4 stop fails closed durably and blocks a replacement attempt', async () => {
  await withTempDir(async (root) => {
    const cwd = join(root, 'generated')
    const marker = join(root, 'engine-started')
    const attemptId = 'final27-terminal-collision'
    const orchestrator = await Orchestrator.open({ root, projectId, gitHead: testGitHead })
    await mkdir(cwd, { mode: 0o700 })
    try {
      await advanceToG4(orchestrator)
      await orchestrator.launchAttempt({ phase: 'build', attemptId, command: process.execPath, args: [engine], cwd, env: { PATH: process.env.PATH ?? '', GUIDELANE_FINAL_22_ENGINE_MARKER: marker } })
      await waitForFile(marker)
      await writeFile(join(root, projectId, 'runs', `${attemptId}.json`), '{"test":"immutable collision"}\n', { mode: 0o600 })

      await assert.rejects(
        (orchestrator as Orchestrator & AttemptFailurePublisher).publishAttemptFailure({ attemptId, failureCode: 'io' }),
        /immutable|exists|collision/i,
        'the forced immutable run collision must model the stop-to-terminal-publication failure window',
      )
      const recovered = await orchestrator.snapshot()
      assert.equal(recovered.runState, 'recovery-required', 'a reaped attempt with no durable terminal publication must not remain G4/running')
      assert.equal(recovered.pendingDecision, null)
      await assert.rejects(
        orchestrator.launchAttempt({ phase: 'build', attemptId: 'final27-replacement-blocked', command: process.execPath, args: [engine], cwd, env: { PATH: process.env.PATH ?? '', GUIDELANE_FINAL_22_ENGINE_MARKER: join(root, 'replacement-started') } }),
        /recovery|required|active|reconcile/i,
        'replacement launch must stay blocked until the failed terminal publication is exactly reconciled',
      )
    } finally {
      await orchestrator.reconcile().catch(() => undefined)
      await orchestrator.close()
    }
  })
})
