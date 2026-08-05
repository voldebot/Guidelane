import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { access, readFile, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { ArtifactStore, Orchestrator, createLoopbackServer } from '../src/index.ts'
import type { ProjectSnapshot, RunFailureCode } from '../src/index.ts'
import { advanceToG4, digest, ownerPrivateDirectory, phaseRun, projectId, snapshot, testGitHead, withTempDir, writeSignedAttempt } from './helpers.ts'

type LaunchAttempt = {
  attemptId: string
  receipt: { pid: number; pgid: number; startIdentity: string; nonce: string }
}

type LaunchingOrchestrator = Orchestrator & {
  launchAttempt(input: {
    phase: string
    attemptId?: string
    command: string
    args: string[]
    cwd: string
    env: Record<string, string>
    receiptTimeoutMs?: number
  }): Promise<LaunchAttempt>
}
type FailurePublisher = { publishAttemptFailure(input: { attemptId: string; failureCode: RunFailureCode }): Promise<ProjectSnapshot> }

type CockpitSnapshot = {
  failureCode?: RunFailureCode
  recoveryReason?: unknown
  gates: Array<{ name: string; status: string; authority: string; verified?: boolean; evidence?: unknown }>
}

type RecordedChild = { label: string; pid: number }

const failureStates: Readonly<Record<RunFailureCode, string>> = {
  receipt: 'recovery-required',
  denial: 'stopped',
  hook: 'stopped',
  stall: 'stopped',
  framing: 'stopped',
  io: 'stopped',
  rate_limit_five_hour: 'rate-limit',
  rate_limit_seven_day: 'rate-limit',
  interrupted: 'interrupted',
  recovery: 'recovery-required',
  unknown_event: 'recovery-required',
}

async function eventuallyAbsent(pid: number, label: string): Promise<void> {
  const deadline = Date.now() + 1_000
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0)
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 20))
    } catch {
      return
    }
  }
  throw new Error(`timed out waiting for ${label} to exit`)
}

async function eventuallyAccessible(path: string, label: string): Promise<void> {
  const deadline = Date.now() + 1_000
  while (Date.now() < deadline) {
    try {
      await access(path)
      return
    } catch {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 20))
    }
  }
  throw new Error(`timed out waiting for ${label}`)
}

async function waitForJsonFile<T>(path: string, label: string): Promise<T> {
  const deadline = Date.now() + 500
  while (Date.now() < deadline) {
    try { return JSON.parse(await readFile(path, 'utf8')) as T } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 20))
    }
  }
  throw new Error(`timed out waiting for ${label}`)
}

async function waitForSupervisorArmed(supervisor: ReturnType<typeof spawn>): Promise<{ pid: number; pgid: number }> {
  return await new Promise((resolvePromise, reject) => {
    const timeout = setTimeout(() => finish(() => reject(new Error('timed out waiting for test-owned supervisor to report armed wrapper'))), 1_000)
    const finish = (action: () => void) => {
      clearTimeout(timeout)
      supervisor.off('message', onMessage)
      supervisor.off('error', onError)
      supervisor.off('exit', onExit)
      action()
    }
    const onMessage = (message: unknown) => {
      const candidate = message as { kind?: unknown; wrapper?: { pid?: unknown; pgid?: unknown } }
      if (candidate.kind !== 'armed') return
      const wrapper = candidate.wrapper
      const pid = wrapper?.pid
      const pgid = wrapper?.pgid
      if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0 || typeof pgid !== 'number' || pgid !== pid) {
        finish(() => reject(new Error('test-owned supervisor reported an invalid wrapper receipt')))
        return
      }
      finish(() => resolvePromise({ pid, pgid }))
    }
    const onError = (error: Error) => finish(() => reject(error))
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => finish(() => reject(new Error(`test-owned supervisor exited before armed (${code ?? signal ?? 'unknown'})`)))
    supervisor.on('message', onMessage)
    supervisor.once('error', onError)
    supervisor.once('exit', onExit)
  })
}

async function reapRecordedChildren(children: readonly RecordedChild[]): Promise<void> {
  for (const child of children) {
    try { process.kill(child.pid, 'SIGKILL') } catch { /* already reaped */ }
  }
  await Promise.all(children.map((child) => eventuallyAbsent(child.pid, child.label)))
}

function spawnArmedSupervisor(cwd: string): ReturnType<typeof spawn> {
  const supervisor = resolve(process.cwd(), 'packages/orchestrator/test-fixtures/final-22-wrapper-supervisor.mjs')
  const wrapper = resolve(process.cwd(), 'packages/orchestrator/src/attempt-wrapper.mjs')
  return spawn(process.execPath, [supervisor, wrapper], { cwd, detached: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] })
}

function launchInput(_root: string, cwd: string, args: string[], env: Record<string, string>, attemptId?: string): Parameters<Orchestrator['launchAttempt']>[0] {
  return { phase: 'build', ...(attemptId === undefined ? {} : { attemptId }), command: process.execPath, args, cwd, env, receiptTimeoutMs: 500 }
}

test('S2-FINAL-22-IDENTITY unsafe projectId is rejected by ArtifactStore and Orchestrator before creating a project path', async () => {
  await withTempDir(async (root) => {
    const unsafeProjectId = 'nested/project'
    await assert.rejects(ArtifactStore.open({ root, projectId: unsafeProjectId, gitHead: testGitHead }), /project|identity|invalid|safe/i)
    await assert.rejects(Orchestrator.open({ root, projectId: unsafeProjectId, gitHead: testGitHead }), /project|identity|invalid|safe/i)
    assert.deepEqual(await readdir(root), [], 'unsafe project identity must not create a project directory, lock, manifest, or recovery marker')
  })
})

test('S2-FINAL-22-LAUNCH public launchAttempt owns receipt creation and binds a detached wrapper before its engine starts', async () => {
  await withTempDir(async (root) => {
    const orchestrator = await Orchestrator.open({ root, projectId, gitHead: testGitHead })
    const marker = join(root, 'engine-started')
    const generatedProject = join(root, 'generated-project')
    const engine = resolve(process.cwd(), 'packages/orchestrator/test-fixtures/final-22-launch-engine.mjs')
    const launcher = orchestrator as LaunchingOrchestrator
    try {
      await ownerPrivateDirectory(generatedProject)
      await advanceToG4(orchestrator, 'Final-22 launch boundary')
      assert.equal(typeof launcher.launchAttempt, 'function', 'receipt-from-caller beginAttempt must be replaced by the public launchAttempt boundary')
      await assert.rejects(
        orchestrator.beginAttempt({ phase: 'build', receipt: { pid: process.pid, pgid: process.pid, startIdentity: 'caller-supplied' } }),
        /launchAttempt|supervisor|receipt-from-caller|production/i,
        'callers must not be able to forge a production attempt receipt'
      )
      await assert.rejects(
        launcher.launchAttempt({
          phase: 'build',
          attemptId: 'artifact-root-must-not-launch',
          command: process.execPath,
          args: [engine],
          cwd: join(root, projectId),
          env: { PATH: process.env.PATH ?? '', GUIDELANE_FINAL_22_ENGINE_MARKER: marker },
          receiptTimeoutMs: 500,
        }),
        /cwd|artifact|project|data|writable/i,
        'the immutable artifact-store project root must never be an engine-writable launch cwd'
      )
      const launched = await launcher.launchAttempt({
        phase: 'build',
        attemptId: 'final22-launch',
        command: process.execPath,
        args: [engine],
        cwd: generatedProject,
        env: { PATH: process.env.PATH ?? '', GUIDELANE_FINAL_22_ENGINE_MARKER: marker },
        receiptTimeoutMs: 500,
      })
      assert.equal(launched.attemptId, 'final22-launch')
      assert.equal(launched.receipt.pid, launched.receipt.pgid, 'the receipt must identify the detached process-group leader')
      assert.ok(launched.receipt.startIdentity, 'the durable receipt must bind an observed process start identity')
      assert.ok(launched.receipt.nonce, 'the durable receipt must carry an unforgeable release nonce')
      await eventuallyAccessible(marker, 'test-owned engine marker after wrapper started')
      const failed = await (orchestrator as Orchestrator & FailurePublisher).publishAttemptFailure({ attemptId: launched.attemptId, failureCode: 'io' })
      assert.equal(failed.runState, 'stopped', 'ordinary execution failure must reap its active launch before publishing the retry state')
      const deadline = Date.now() + 500
      let groupAlive = true
      while (Date.now() < deadline && groupAlive) {
        try { process.kill(-launched.receipt.pgid, 0) } catch { groupAlive = false }
        if (groupAlive) await new Promise((resolvePromise) => setTimeout(resolvePromise, 20))
      }
      assert.equal(groupAlive, false, 'attempt-bound failure publication must reap every process in the recorded test-owned launch group')
      await assert.rejects(launcher.launchAttempt({ phase: 'build', command: process.execPath, args: [engine], cwd: root, env: { PATH: process.env.PATH ?? '' } }), /active|attempt|running|recovery/i)
      await launcher.reconcile()
    } finally {
      await launcher.reconcile().catch(() => undefined)
      await orchestrator.close()
    }
  })
})

test('S2-FINAL-22-INTENT-01 persisted prepared intent before wrapper spawn blocks replacement on reopen', async () => {
  await withTempDir(async (root) => {
    await writeSignedAttempt(root, 'prepared-before-wrapper', {
      status: 'prepared',
      receipt: {},
      intent: { schemaVersion: 1, phase: 'build', command: process.execPath, commandDigest: digest(process.execPath), argsDigest: digest('[]'), cwd: root, envDigest: digest('[]'), nonce: 'a'.repeat(64), intentDigest: 'b'.repeat(64) },
    })
    const orchestrator = await Orchestrator.open({ root, projectId, gitHead: testGitHead })
    try {
      assert.equal((await orchestrator.snapshot()).runState, 'recovery-required')
      await assert.rejects(
        orchestrator.launchAttempt(launchInput(root, root, [], { PATH: process.env.PATH ?? '' }, 'replacement-after-prepared')),
        /recovery|required|attempt/i,
        'a prepared durable intent must block a replacement launch until recovery is resolved'
      )
    } finally {
      await orchestrator.close()
    }
  })
})

test('S2-FINAL-22-INTENT-02 supervisor loss after armed prepare exits the production wrapper before GO and never starts a target', {
  skip: process.platform === 'win32' ? 'SIGKILL and detached POSIX process groups are unavailable on Windows' : false,
}, async () => {
  await withTempDir(async (root) => {
    const generatedProject = join(root, 'generated-project')
    const engineMarker = join(root, 'engine-started')
    const grandchildMarker = join(root, 'grandchild.json')
    await ownerPrivateDirectory(generatedProject)
    const supervisor = spawnArmedSupervisor(generatedProject)
    const ledger: RecordedChild[] = []
    try {
      assert.ok(supervisor.pid, 'the outer test must own a concrete supervisor PID before it can terminate it')
      ledger.push({ label: 'test-owned supervisor', pid: supervisor.pid! })
      const wrapper = await waitForSupervisorArmed(supervisor)
      ledger.push({ label: 'test-owned production wrapper', pid: wrapper.pid })
      assert.equal(wrapper.pgid, wrapper.pid, 'the fixture may report only the detached wrapper process group it created')

      process.kill(supervisor.pid!, 'SIGKILL')
      await eventuallyAbsent(supervisor.pid!, 'test-owned supervisor after SIGKILL')
      await eventuallyAbsent(wrapper.pid, 'production wrapper after supervisor IPC disconnect')
      await assert.rejects(access(engineMarker), { code: 'ENOENT' }, 'the target engine marker must remain absent because the fixture never sends GO')
      await assert.rejects(access(grandchildMarker), { code: 'ENOENT' }, 'a target grandchild marker must remain absent because the fixture never sends GO')
    } finally {
      // S2-FINAL-22-INTENT-04: this ledger contains every test-owned child
      // recorded by the outer test (supervisor plus production wrapper).
      await reapRecordedChildren(ledger)
    }
  })
})

test('S2-FINAL-22-INTENT-04 bounded finally cleanup reaps every recorded supervisor and wrapper child', {
  skip: process.platform === 'win32' ? 'SIGKILL and detached POSIX process groups are unavailable on Windows' : false,
}, async () => {
  await withTempDir(async (root) => {
    const generatedProject = join(root, 'generated-project')
    await ownerPrivateDirectory(generatedProject)
    const supervisor = spawnArmedSupervisor(generatedProject)
    const ledger: RecordedChild[] = []
    try {
      assert.ok(supervisor.pid)
      ledger.push({ label: 'test-owned supervisor', pid: supervisor.pid! })
      const wrapper = await waitForSupervisorArmed(supervisor)
      ledger.push({ label: 'test-owned production wrapper', pid: wrapper.pid })
      assert.deepEqual(ledger.map(({ label }) => label), ['test-owned supervisor', 'test-owned production wrapper'])
    } finally {
      await reapRecordedChildren(ledger)
    }
  })
})

test('S2-FINAL-22-INTENT-03 after GO and engine start, reopen reconciliation reaps the engine group and forbids attempt reuse', {
  skip: process.platform === 'win32' ? 'POSIX process-group reconciliation is unavailable on Windows' : false,
}, async () => {
  await withTempDir(async (root) => {
    const generatedProject = join(root, 'generated-project')
    const marker = join(root, 'grandchild.json')
    const engine = resolve(process.cwd(), 'packages/orchestrator/test-fixtures/final-22-grandchild-engine.mjs')
    await ownerPrivateDirectory(generatedProject)
    let first = await Orchestrator.open({ root, projectId, gitHead: testGitHead })
    let reopened: Orchestrator | undefined
    try {
      await advanceToG4(first, 'Final-22 orphan reconciliation')
      const launched = await first.launchAttempt(launchInput(root, generatedProject, [engine], { PATH: process.env.PATH ?? '', GUIDELANE_FINAL_22_GRANDCHILD_MARKER: marker }, 'go-engine-grandchild'))
      const children = await waitForJsonFile<{ enginePid: number; grandchildPid: number }>(marker, 'test-owned engine descendant receipt')
      await first.close()
      first = undefined as unknown as Orchestrator

      reopened = await Orchestrator.open({ root, projectId, gitHead: testGitHead })
      assert.deepEqual(await reopened.reconcile(), { interruptedAttemptIds: ['go-engine-grandchild'] })
      await eventuallyAbsent(children.enginePid, 'test-owned engine')
      await eventuallyAbsent(children.grandchildPid, 'test-owned engine grandchild')
      await assert.rejects(
        reopened.launchAttempt(launchInput(root, generatedProject, [engine], { PATH: process.env.PATH ?? '' }, launched.attemptId)),
        /immutable|attempt|exists/i,
      )
    } finally {
      await reopened?.reconcile().catch(() => undefined)
      await reopened?.close()
      await first?.reconcile().catch(() => undefined)
      await first?.close()
    }
  })
})

test('S2-FINAL-22-FAILURE-02 indeterminate cleanup retains a receipt, remains reconcilable in recovery, and blocks replacement launch', {
  skip: process.platform === 'win32' ? 'POSIX process-group reconciliation is unavailable on Windows' : false,
}, async () => {
  await withTempDir(async (root) => {
    const generatedProject = join(root, 'generated-project')
    const marker = join(root, 'engine-started')
    const engine = resolve(process.cwd(), 'packages/orchestrator/test-fixtures/final-22-launch-engine.mjs')
    await ownerPrivateDirectory(generatedProject)
    const orchestrator = await Orchestrator.open({ root, projectId, gitHead: testGitHead })
    const realKill = process.kill
    let launched: LaunchAttempt | undefined
    try {
      await advanceToG4(orchestrator, 'Final-22 indeterminate cleanup')
      launched = await orchestrator.launchAttempt(launchInput(root, generatedProject, [engine], { PATH: process.env.PATH ?? '', GUIDELANE_FINAL_22_ENGINE_MARKER: marker }, 'indeterminate-cleanup'))
      process.kill = ((pid: number, signal?: NodeJS.Signals | number) => {
        if (pid === -launched!.receipt.pgid && signal === 'SIGKILL') throw Object.assign(new Error('EPERM from the recorded test-owned group'), { code: 'EPERM' })
        return realKill(pid, signal!)
      }) as typeof process.kill
      const recovered = await (orchestrator as Orchestrator & FailurePublisher).publishAttemptFailure({ attemptId: launched.attemptId, failureCode: 'io' })
      assert.equal(recovered.runState, 'recovery-required')
      assert.equal((await orchestrator.attempt(launched.attemptId)).status, 'recovery-required')
      await assert.rejects(orchestrator.launchAttempt(launchInput(root, generatedProject, [engine], { PATH: process.env.PATH ?? '' }, 'replacement-after-indeterminate')), /recovery|required|active/i)
      process.kill = realKill
      assert.deepEqual(await orchestrator.reconcile(), { interruptedAttemptIds: [launched.attemptId] })
    } finally {
      process.kill = realKill
      await orchestrator.reconcile().catch(() => undefined)
      await orchestrator.close()
    }
  })
})

test('S2-FINAL-22-FAILURE-03 concurrent attempt-bound failure and launch cannot create two active groups or deadlock', async () => {
  await withTempDir(async (root) => {
    const generatedProject = join(root, 'generated-project')
    const marker = join(root, 'engine-started')
    const engine = resolve(process.cwd(), 'packages/orchestrator/test-fixtures/final-22-launch-engine.mjs')
    await ownerPrivateDirectory(generatedProject)
    const orchestrator = await Orchestrator.open({ root, projectId, gitHead: testGitHead })
    try {
      await advanceToG4(orchestrator, 'Final-22 concurrent failure')
      const first = await orchestrator.launchAttempt(launchInput(root, generatedProject, [engine], { PATH: process.env.PATH ?? '', GUIDELANE_FINAL_22_ENGINE_MARKER: marker }, 'concurrent-first'))
      const completed = await Promise.race([
        Promise.allSettled([
          (orchestrator as Orchestrator & FailurePublisher).publishAttemptFailure({ attemptId: first.attemptId, failureCode: 'io' }),
          orchestrator.launchAttempt(launchInput(root, generatedProject, [engine], { PATH: process.env.PATH ?? '' }, 'concurrent-second')),
        ]),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('attempt failure/launch deadlocked')), 1_000)),
      ])
      assert.equal(completed.filter((result) => result.status === 'fulfilled').length, 1)
      assert.equal((await readdir(join(root, projectId, 'attempts'))).filter((name) => name.endsWith('.json')).length, 1)
    } finally {
      await orchestrator.reconcile().catch(() => undefined)
      await orchestrator.close()
    }
  })
})

test('S2-FINAL-22-FAILURE every failure code publishes a safe cockpit state and retry eligibility', async () => {
  for (const [failureCode, runState] of Object.entries(failureStates) as Array<[RunFailureCode, string]>) {
    await withTempDir(async (root) => {
      const orchestrator = await Orchestrator.open({ root, projectId, gitHead: testGitHead })
      try {
        const cwd = join(root, 'final22-failure-generated')
        await ownerPrivateDirectory(cwd)
        await advanceToG4(orchestrator, `Final-22 failure ${failureCode}`)
        const marker = join(root, `final22-${failureCode}.started`)
        const launched = await orchestrator.launchAttempt(launchInput(root, cwd, [resolve(process.cwd(), 'packages/orchestrator/test-fixtures/final-22-launch-engine.mjs')], { PATH: process.env.PATH ?? '', GUIDELANE_FINAL_22_ENGINE_MARKER: marker }, `final22-${failureCode}`))
        await eventuallyAccessible(marker, `Final-22 ${failureCode} engine marker`)
        const published = await (orchestrator as Orchestrator & FailurePublisher).publishAttemptFailure({ attemptId: launched.attemptId, failureCode }) as ProjectSnapshot & { failureCode?: RunFailureCode }
        assert.equal(published.runState, runState, `${failureCode} must project its reviewed user-visible state`)
        assert.equal(published.failureCode, failureCode, 'the snapshot must retain only the safe failure-code enum')
        if (runState === 'stopped' || runState === 'interrupted') assert.equal(published.pendingDecision, 'startBuild', `${failureCode} must retain the existing startBuild retry action`)
        else assert.equal(published.pendingDecision, null, `${failureCode} must not advertise a stale action`)
      } finally {
        await orchestrator.reconcile().catch(() => undefined)
        await orchestrator.close()
      }
    })
  }
})

test('S2-FINAL-22-COCKPIT loopback snapshots project verified gates without recovery reasons or evidence references', async () => {
  await withTempDir(async (root) => {
    const store = await ArtifactStore.open({ root, projectId, gitHead: testGitHead })
    const evidence = 'verified machine evidence\n'
    await store.publish({
      snapshot: snapshot({ revision: 1, stage: 'G4', runState: 'running', pendingDecision: null, gates: [{ name: 'unit', status: 'passed', authority: 'machine', evidence: [{ path: 'evidence/final-22.txt', sha256: digest(evidence) }] }] }),
      run: phaseRun({ attemptId: 'final22-cockpit-projection', previousRevision: 0, evidence: [{ path: 'evidence/final-22.txt', sha256: digest(evidence) }] }),
      artifacts: { 'evidence/final-22.txt': evidence },
    })
    await store.requireRecovery('private recovery reason must stay on the loopback server')
    const orchestrator = await Orchestrator.open({ root, projectId, gitHead: testGitHead })
    const token = 'fedcba9876543210fedcba9876543210'
    const server = await createLoopbackServer({ orchestrator, port: 0, launchToken: token })
    try {
      const session = await fetch(`${server.origin}/api/v1/session`, { method: 'POST', headers: { Origin: server.origin, 'content-type': 'application/json' }, body: JSON.stringify({ launchToken: token }) })
      const response = await fetch(`${server.origin}/api/v1/projects/current`, { headers: { Cookie: session.headers.get('set-cookie') ?? '' } })
      assert.equal(response.status, 200)
      const body = await response.json() as CockpitSnapshot
      assert.equal(Object.hasOwn(body, 'recoveryReason'), false, 'recovery diagnostics must never cross the loopback snapshot boundary')
      assert.deepEqual(body.gates, [{ name: 'unit', status: 'passed', authority: 'machine', verified: true }], 'cockpit receives a verified summary, never evidence paths or hashes')
      const reconnect = await orchestrator.eventsSince(-1)
      assert.equal(reconnect.kind, 'snapshot', 'revision gaps must recover through the same canonical projection')
      if (reconnect.kind === 'snapshot') {
        const recovered = reconnect.snapshot as ProjectSnapshot & CockpitSnapshot
        assert.equal(Object.hasOwn(recovered, 'recoveryReason'), false, 'reconnect snapshots must not expose recovery diagnostics')
        assert.deepEqual(recovered.gates, [{ name: 'unit', status: 'passed', authority: 'machine', verified: true }])
      }
    } finally {
      await server.close()
      await orchestrator.close()
    }
  })
})
