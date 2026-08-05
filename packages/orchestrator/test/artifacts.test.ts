import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { access, chmod, chown, lstat, mkdir, readFile, readdir, rename, symlink, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { ArtifactStore, ProjectLock } from '../src/index.ts'
import { digest, phaseRun, projectId, snapshot, testGitHead, withTempDir, writeJson } from './helpers.ts'

type LockOwnerReady = { pid: number }
type LockReceipt = { pid: number; startIdentity: string; nonce: string }

async function eventually<T>(read: () => Promise<T>, predicate: (value: T) => boolean, label: string): Promise<T> {
  const deadline = Date.now() + 2_000
  let last: T | undefined
  while (Date.now() < deadline) {
    last = await read()
    if (predicate(last)) return last
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`timed out waiting for ${label}; last=${JSON.stringify(last)}`)
}

async function readJsonFile<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof SyntaxError) return null
    throw error
  }
}

async function waitForLockOwner(path: string): Promise<LockOwnerReady> {
  const ready = await eventually(() => readJsonFile<LockOwnerReady>(path), (value) => value !== null, 'project lock owner readiness')
  if (ready === null || !Number.isInteger(ready.pid) || ready.pid <= 0) throw new Error('invalid project lock owner readiness receipt')
  return ready
}

function lockReceipt(raw: string): LockReceipt {
  const parsed = JSON.parse(raw) as Partial<LockReceipt>
  assert.equal(Number.isInteger(parsed.pid) && parsed.pid! > 0, true, 'lock receipt must bind an owner PID')
  assert.equal(typeof parsed.startIdentity, 'string', 'lock receipt must bind the owner start identity')
  assert.notEqual(parsed.startIdentity?.length, 0, 'lock receipt start identity must be non-empty')
  assert.equal(typeof parsed.nonce, 'string', 'lock receipt must bind a release nonce')
  assert.notEqual(parsed.nonce?.length, 0, 'lock receipt nonce must be non-empty')
  return parsed as LockReceipt
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function killRecordedTestChild(child: ChildProcess): Promise<void> {
  const pid = child.pid
  if (pid === undefined || child.exitCode !== null) return
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()))
  try { process.kill(pid, 'SIGKILL') } catch { /* the recorded test child may already be gone */ }
  await Promise.race([exited, new Promise<void>((resolve) => setTimeout(resolve, 2_000))])
}

function startRecordedTestChild(args: string[]): ChildProcess {
  const child = spawn(process.execPath, args, { stdio: 'ignore' })
  if (child.pid === undefined) throw new Error('test-owned child failed to start')
  child.unref()
  return child
}

test('publishes an immutable run and atomically advances the canonical manifest', async () => {
  await withTempDir(async (root) => {
    const store = await ArtifactStore.open({ root, projectId, gitHead: testGitHead })
    const evidence = '{"gate":"unit","result":"passed"}\n'
    await store.publish({
      snapshot: snapshot({ revision: 1, stage: 'blueprint', runState: 'waiting' }),
      run: phaseRun({ status: 'completed', evidence: [{ path: 'evidence/unit.json', sha256: digest(evidence) }] }),
      artifacts: { 'evidence/unit.json': evidence },
    })

    const before = await store.snapshot()
    assert.equal(before.revision, 1)
    assert.equal(before.runState, 'waiting')

    // This represents a supervisor being killed before the same-filesystem
    // rename. It is not a new published revision and must never be guessed as
    // one on reopen.
    await mkdir(join(root, projectId, '.tmp'), { recursive: true })
    await writeFile(join(root, projectId, '.tmp', 'manifest.json'), '{partial', 'utf8')

    const reopened = await ArtifactStore.open({ root, projectId, gitHead: testGitHead })
    assert.deepEqual(await reopened.snapshot(), before)
  })
})

test('PROJECT-ROOT-SYMLINK-01 ArtifactStore.open rejects an existing projectId symlink before mutation', async () => {
  await withTempDir(async (root) => {
    const external = join(root, 'external')
    await mkdir(external)
    await symlink(external, join(root, projectId))

    await assert.rejects(
      ArtifactStore.open({ root, projectId, gitHead: testGitHead }),
      /symlink|project|artifact|root/i,
      'an existing project directory symlink is not a safe artifact root'
    )
  })
})

test('PROJECT-ROOT-SYMLINK-02 rejects without mutating the external target or creating lock or manifest metadata', async () => {
  await withTempDir(async (root) => {
    const external = join(root, 'external')
    const projectPath = join(root, projectId)
    await mkdir(external)
    await symlink(external, projectPath)

    await assert.rejects(ArtifactStore.open({ root, projectId, gitHead: testGitHead }), /symlink|project|artifact|root/i)
    assert.deepEqual(await readdir(external), [], 'open must not write manifest, recovery, attempts, runs, or lock files outside the configured root')
    assert.equal((await lstat(projectPath)).isSymbolicLink(), true, 'the existing symlink must remain untouched after rejection')
  })
})

test('FINAL-29-ARTIFACT-ROOT-01 accepts a private app-data root below the OS temp anchor but rejects group- or world-writable existing ancestors before metadata creation', async (t) => {
  await withTempDir(async (root) => {
    const appDataRoot = join(root, 'home-like', 'Library', 'Application Support', 'guidelane')
    await mkdir(appDataRoot, { recursive: true, mode: 0o700 })
    for (const directory of [join(root, 'home-like'), join(root, 'home-like', 'Library'), join(root, 'home-like', 'Library', 'Application Support'), appDataRoot]) {
      await chmod(directory, 0o700)
    }
    await ArtifactStore.open({ root: appDataRoot, projectId, gitHead: testGitHead })

    for (const [label, mode] of [['group-writable', 0o770], ['world-writable', 0o707]] as const) {
      await t.test(label, async () => {
        const unsafeAncestor = join(root, `caller-${label}-ancestor`)
        const artifactRoot = join(unsafeAncestor, 'private-artifacts')
        const sentinel = join(unsafeAncestor, 'external-sentinel.bin')
        const sentinelBytes = Buffer.from([0, 255, 10, 71, 117, 105, 100, 101, 108, 97, 110, 101])
        await mkdir(artifactRoot, { recursive: true, mode: 0o700 })
        await chmod(artifactRoot, 0o700)
        await writeFile(sentinel, sentinelBytes)
        await chmod(unsafeAncestor, mode)
        const before = await lstat(sentinel)

        const result = await ArtifactStore.open({ root: artifactRoot, projectId, gitHead: testGitHead }).then(() => null, (error: unknown) => error)
        assert.ok(result instanceof Error, 'an artifact root below a caller-writable ancestor must be rejected before lock, manifest, or run metadata is created')
        assert.deepEqual(await readFile(sentinel), sentinelBytes, 'rejection must preserve sentinel bytes outside the configured artifact root')
        const after = await lstat(sentinel)
        assert.deepEqual(
          { dev: after.dev, ino: after.ino, mode: after.mode, uid: after.uid, gid: after.gid, size: after.size, mtimeMs: after.mtimeMs },
          { dev: before.dev, ino: before.ino, mode: before.mode, uid: before.uid, gid: before.gid, size: before.size, mtimeMs: before.mtimeMs },
          'rejection must preserve sentinel metadata outside the configured artifact root'
        )
        assert.deepEqual(await readdir(artifactRoot), [], 'rejection must not create a project directory, lock, manifest, or run metadata below the unsafe ancestor')
      })
    }
  })
})

test('FINAL-29-ARTIFACT-ROOT-02 rejects a private current-user artifact root below a foreign-owned non-system ancestor when a fixture can create one', async (t) => {
  if (typeof process.getuid !== 'function' || process.getuid() !== 0) {
    t.skip('creating a foreign-owned ancestor requires a privileged test account')
    return
  }
  await withTempDir(async (root) => {
    const foreignAncestor = join(root, 'foreign-ancestor')
    const artifactRoot = join(foreignAncestor, 'private-artifacts')
    await mkdir(artifactRoot, { recursive: true, mode: 0o700 })
    await chmod(artifactRoot, 0o700)
    await chmod(foreignAncestor, 0o700)
    await chown(foreignAncestor, 1, 0)
    try {
      const result = await ArtifactStore.open({ root: artifactRoot, projectId, gitHead: testGitHead }).then(() => null, (error: unknown) => error)
      assert.ok(result instanceof Error, 'a private leaf must not make an arbitrary foreign-owned ancestor trustworthy')
      assert.deepEqual(await readdir(artifactRoot), [], 'foreign-ancestor rejection must happen before project metadata is written')
    } finally {
      await chown(foreignAncestor, 0, 0)
    }
  })
})

test('does not overwrite an immutable attempt when a caller reuses its identity', async () => {
  await withTempDir(async (root) => {
    const store = await ArtifactStore.open({ root, projectId, gitHead: testGitHead })
    const evidence = 'first evidence'
    const input = {
      snapshot: snapshot({ revision: 1 }),
      run: phaseRun({ evidence: [{ path: 'evidence/first.txt', sha256: digest(evidence) }] }),
      artifacts: { 'evidence/first.txt': evidence },
    }
    await store.publish(input)

    await assert.rejects(
      store.publish({ ...input, artifacts: { 'evidence/first.txt': 'rewritten evidence' } }),
      /immutable|attempt|exists/i
    )
  })
})

test('S2-ART-STALE-REVISION rejects a stale publish and leaves the canonical manifest at its prior revision', async () => {
  await withTempDir(async (root) => {
    const store = await ArtifactStore.open({ root, projectId, gitHead: testGitHead })
    await store.publish({
      snapshot: snapshot({ revision: 1, stage: 'G1', runState: 'waiting', pendingDecision: 'approveBlueprint' }),
      run: phaseRun({ attemptId: 'fresh-revision-one' }),
      artifacts: {},
    })
    const before = await store.snapshot()

    await assert.rejects(
      store.publish({
        snapshot: snapshot({ revision: 1, stage: 'G2', runState: 'waiting', pendingDecision: 'approvePlan' }),
        run: phaseRun({ attemptId: 'stale-revision-one', previousRevision: 0 }),
        artifacts: {},
      }),
      /stale|revision/i,
    )

    assert.deepEqual(await store.snapshot(), before, 'a stale publication must not replace the canonical in-memory manifest')
    const manifest = JSON.parse(await readFile(join(root, projectId, 'manifest.json'), 'utf8')) as { revision: unknown; snapshot: unknown }
    assert.equal(manifest.revision, 1)
    assert.deepEqual(manifest.snapshot, before, 'a stale publication must not atomically advance the durable manifest')
  })
})

for (const [name, mutateDigest] of [
  ['removed digest', (manifest: Record<string, unknown>) => { delete manifest.sha256 }],
  ['empty digest', (manifest: Record<string, unknown>) => { manifest.sha256 = '' }],
] as const) {
  test(`fails closed when an existing canonical manifest has a ${name}`, async () => {
    await withTempDir(async (root) => {
      const store = await ArtifactStore.open({ root, projectId, gitHead: testGitHead })
      const evidence = 'canonical evidence\n'
      await store.publish({
        snapshot: snapshot({ revision: 1 }),
        run: phaseRun({ evidence: [{ path: 'evidence/canonical.txt', sha256: digest(evidence) }] }),
        artifacts: { 'evidence/canonical.txt': evidence },
      })
      const manifestPath = join(root, projectId, 'manifest.json')
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>
      assert.equal(typeof manifest.sha256, 'string', 'the source manifest must begin as canonical and digest-bound')
      mutateDigest(manifest)
      await writeJson(manifestPath, manifest)

      const reopened = await ArtifactStore.open({ root, projectId, gitHead: testGitHead })
      const recovered = await reopened.snapshot()
      assert.equal(recovered.runState, 'recovery-required')
      assert.match(recovered.recoveryReason ?? '', /digest|hash|manifest/i)
      assert.notEqual(recovered.runState, 'successful')
    })
  })
}

const recoveryCorruptionCases = [
  {
    title: 'fails closed into recovery-required for missing machine evidence',
    corrupt: async (root: string) => {
    await mkdir(join(root, projectId), { recursive: true })
    await writeJson(join(root, projectId, 'manifest.json'), {
      schemaVersion: 1,
      projectId,
      revision: 1,
      snapshot: snapshot({ revision: 1 }),
      run: phaseRun({ status: 'completed', evidence: [{ path: 'evidence/missing.json', sha256: digest('missing') }] }),
    })
    },
  },
  {
    title: 'fails closed into recovery-required for corrupt evidence digest',
    corrupt: async (root: string) => {
    await mkdir(join(root, projectId, 'evidence'), { recursive: true })
    await writeFile(join(root, projectId, 'evidence', 'unit.json'), 'tampered', 'utf8')
    await writeJson(join(root, projectId, 'manifest.json'), {
      schemaVersion: 1,
      projectId,
      revision: 1,
      snapshot: snapshot({ revision: 1 }),
      run: phaseRun({ status: 'completed', evidence: [{ path: 'evidence/unit.json', sha256: digest('original') }] }),
    })
    },
  },
  {
    title: 'fails closed into recovery-required for unknown artifact schema',
    corrupt: async (root: string) => {
    await mkdir(join(root, projectId), { recursive: true })
    await writeJson(join(root, projectId, 'manifest.json'), {
      schemaVersion: 999,
      projectId,
      revision: 1,
      snapshot: snapshot({ revision: 1 }),
      run: phaseRun(),
    })
    },
  },
] as const

for (const { title, corrupt } of recoveryCorruptionCases) {
  test(title, async () => {
    await withTempDir(async (root) => {
      await corrupt(root)
      await chmod(join(root, projectId), 0o700)
      const store = await ArtifactStore.open({ root, projectId, gitHead: testGitHead })
      const recovered = await store.snapshot()
      assert.equal(recovered.runState, 'recovery-required')
      assert.ok(recovered.recoveryReason, 'the user needs a truthful recovery reason')
      assert.notEqual(recovered.runState, 'successful')
    })
  })
}

test('permits exactly one holder for a project lock', async () => {
  await withTempDir(async (root) => {
    const first = await ProjectLock.acquire({ root, projectId })
    try {
      await assert.rejects(ProjectLock.acquire({ root, projectId }), /locked|active|already/i)
    } finally {
      await first.release()
    }
    const second = await ProjectLock.acquire({ root, projectId })
    await second.release()
  })
})

test('retries a transient partial project lock owner readiness receipt', async () => {
  await withTempDir(async (root) => {
    const readinessPath = join(root, 'lock-owner-ready.json')
    await writeFile(readinessPath, '{"pid":', 'utf8')

    const publishReceipt = new Promise<void>((resolve, reject) => {
      setTimeout(() => {
        void writeFile(readinessPath, JSON.stringify({ pid: process.pid }), 'utf8').then(resolve, reject)
      }, 50)
    })

    try {
      const ready = await waitForLockOwner(readinessPath)
      assert.equal(ready.pid, process.pid)
    } finally {
      await publishReceipt
    }
  })
})

test('S2-PROJECT-LOCK-RECOVERY-01 takes over only a verifiably dead owner and never unlinks an unowned successor lock', {
  skip: process.platform === 'win32' ? 'POSIX SIGKILL is unavailable on Windows' : false,
}, async () => {
  await withTempDir(async (root) => {
    const children: ChildProcess[] = []
    try {
      const ownerReadyPath = join(root, 'lock-owner-ready.json')
      const fixture = join(process.cwd(), 'packages/orchestrator/test-fixtures/project-lock-owner.mjs')
      const owner = startRecordedTestChild(['--experimental-strip-types', fixture, root, projectId, ownerReadyPath])
      children.push(owner)
      const ownerReady = await waitForLockOwner(ownerReadyPath)
      assert.equal(ownerReady.pid, owner.pid, 'the lock owner readiness receipt must identify the spawned test child')

      const path = join(root, projectId, '.project.lock')
      const original = lockReceipt(await readFile(path, 'utf8'))
      assert.equal(original.pid, ownerReady.pid, 'the persisted lock receipt must identify its real owner')
      assert.equal(isAlive(original.pid), true, 'the recorded owner must still be alive before takeover is refused')
      await assert.rejects(ProjectLock.acquire({ root, projectId }), /locked|active|already/i)

      await killRecordedTestChild(owner)
      assert.equal(isAlive(original.pid), false, 'the test-owned lock owner must be gone before recovery')
      await access(path, constants.F_OK)

      const successor = await ProjectLock.acquire({ root, projectId })
      try {
        const successorReceipt = lockReceipt(await readFile(path, 'utf8'))
        assert.notEqual(successorReceipt.nonce, original.nonce, 'recovery must atomically install a distinct successor receipt')
        await assert.rejects(ProjectLock.acquire({ root, projectId }), /locked|active|already/i)
      } finally {
        await successor.release()
      }

      const oldOwner = await ProjectLock.acquire({ root, projectId: `${projectId}-release-ownership` })
      const ownershipPath = join(root, `${projectId}-release-ownership`, '.project.lock')
      const ownershipReceipt = lockReceipt(await readFile(ownershipPath, 'utf8'))
      const successorReceipt = { ...ownershipReceipt, nonce: `${ownershipReceipt.nonce}-successor` }
      const successorPath = `${ownershipPath}.successor`
      await writeFile(successorPath, `${JSON.stringify(successorReceipt)}\n`, 'utf8')
      await rename(successorPath, ownershipPath)
      await oldOwner.release()
      assert.deepEqual(lockReceipt(await readFile(ownershipPath, 'utf8')), successorReceipt, 'an old owner must not unlink a successor lock')

      const guard = startRecordedTestChild(['-e', 'setInterval(() => {}, 1000)'])
      children.push(guard)
      if (guard.pid === undefined) throw new Error('test-owned guard child failed to start')
      for (const [name, contents] of [
        ['malformed', '{not-json'],
        ['missing owner identity', `${JSON.stringify({ pid: guard.pid, nonce: 'test-nonce' })}\n`],
        ['mismatched owner identity', `${JSON.stringify({ pid: guard.pid, startIdentity: 'not-the-test-child', nonce: 'test-nonce' })}\n`],
      ] as const) {
        const invalidProjectId = `${projectId}-${name.replaceAll(' ', '-')}`
        const invalidPath = join(root, invalidProjectId, '.project.lock')
        await mkdir(join(root, invalidProjectId), { recursive: true })
        await chmod(join(root, invalidProjectId), 0o700)
        await writeFile(invalidPath, contents, 'utf8')
        await assert.rejects(
          ProjectLock.acquire({ root, projectId: invalidProjectId }),
          /recovery|required|receipt|identity/i,
          `${name} receipt must fail closed with an explicit recovery error`
        )
        assert.equal(isAlive(guard.pid), true, `${name} receipt must never signal an unverified test child PID`)
      }
    } finally {
      await Promise.all(children.map((child) => killRecordedTestChild(child)))
    }
  })
})

test('marks git-ahead / manifest-behind state recovery-required rather than claiming the old result succeeded', async () => {
  await withTempDir(async (root) => {
    const store = await ArtifactStore.open({ root, projectId, gitHead: '0123456789abcdef0123456789abcdef01234567' })
    const evidence = 'accepted machine output'
    await store.publish({
      snapshot: snapshot({ revision: 1, runState: 'successful' }),
      run: phaseRun({
        status: 'completed',
        evidence: [{ path: 'evidence/gate.txt', sha256: digest(evidence) }],
        gitSnapshot: '0123456789abcdef0123456789abcdef01234567',
      }),
      artifacts: { 'evidence/gate.txt': evidence },
    })

    const reopened = await ArtifactStore.open({ root, projectId, gitHead: 'fedcba9876543210fedcba9876543210fedcba98' })
    const state = await reopened.snapshot()
    assert.equal(state.runState, 'recovery-required')
    const recoveryReason = state.recoveryReason
    assert.ok(recoveryReason, 'git/manifest divergence needs a truthful recovery reason')
    assert.match(recoveryReason, /git|manifest|snapshot/i)
  })
})

test('S2-ART-MANIFEST-AHEAD fails closed when the durable manifest head is ahead of the supplied git head', async () => {
  await withTempDir(async (root) => {
    const manifestHead = 'fedcba9876543210fedcba9876543210fedcba98'
    const suppliedBehindHead = '0123456789abcdef0123456789abcdef01234567'
    const store = await ArtifactStore.open({ root, projectId, gitHead: manifestHead })
    await store.publish({
      snapshot: snapshot({ revision: 1, runState: 'successful' }),
      run: phaseRun({ attemptId: 'manifest-ahead-run', gitSnapshot: manifestHead }),
      artifacts: {},
    })

    const reopened = await ArtifactStore.open({ root, projectId, gitHead: suppliedBehindHead })
    const state = await reopened.snapshot()
    assert.equal(state.runState, 'recovery-required')
    assert.equal(state.pendingDecision, null)
    assert.match(state.recoveryReason ?? '', /git|manifest|snapshot/i)
  })
})
