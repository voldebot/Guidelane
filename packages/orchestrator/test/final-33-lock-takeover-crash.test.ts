import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import { Orchestrator } from '../src/index.ts'
import { projectId, testGitHead, withTempDir } from './helpers.ts'

type LockReceipt = { pid: number; startIdentity: string; nonce: string }
type ReadyOwner = { pid: number }
type TakeoverGuard = {
  schemaVersion: 1
  predecessor: LockReceipt & { lockDigest: string }
  successor: LockReceipt
  guardNonce: string
  sha256: string
}
type OwnerFixture = { child: ChildProcess; lockPath: string; lockBytes: Buffer; receipt: LockReceipt }

const digest = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
const canonicalJson = (value: unknown): Buffer => Buffer.from(`${JSON.stringify(value)}\n`, 'utf8')

function lockReceipt(bytes: Buffer): LockReceipt {
  const value = JSON.parse(bytes.toString('utf8')) as Partial<LockReceipt>
  assert.equal(Number.isInteger(value.pid) && value.pid! > 0, true, 'the production lock fixture must name a positive owner PID')
  assert.equal(typeof value.startIdentity, 'string')
  assert.notEqual(value.startIdentity?.length, 0)
  assert.match(value.nonce ?? '', /^[a-f0-9]{64}$/i, 'the production lock fixture must retain its release nonce')
  return value as LockReceipt
}

function isAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true } catch { return false }
}

function signedGuard(predecessor: OwnerFixture, successor: OwnerFixture, lockDigest = digest(predecessor.lockBytes)): Buffer {
  const unsigned = {
    schemaVersion: 1 as const,
    predecessor: { ...predecessor.receipt, lockDigest },
    successor: successor.receipt,
    guardNonce: randomBytes(32).toString('hex'),
  }
  return canonicalJson({ ...unsigned, sha256: digest(canonicalJson(unsigned)) })
}

function assertSignedGuard(bytes: Buffer, predecessor: OwnerFixture, successor: OwnerFixture): void {
  const guard = JSON.parse(bytes.toString('utf8')) as TakeoverGuard
  const { sha256, ...unsigned } = guard
  assert.equal(guard.schemaVersion, 1)
  assert.deepEqual(guard.predecessor, { ...predecessor.receipt, lockDigest: digest(predecessor.lockBytes) }, 'the signed guard must bind the exact predecessor lock bytes')
  assert.deepEqual(guard.successor, successor.receipt, 'the signed guard must identify a real production successor receipt')
  assert.match(guard.guardNonce, /^[a-f0-9]{64}$/i)
  assert.equal(sha256, digest(canonicalJson(unsigned)), 'the signed guard digest must cover the canonical unsigned guard')
}

async function waitForOwner(path: string): Promise<ReadyOwner> {
  const deadline = Date.now() + 1_000
  while (Date.now() < deadline) {
    try {
      const ready = JSON.parse(await readFile(path, 'utf8')) as Partial<ReadyOwner>
      if (Number.isInteger(ready.pid) && ready.pid! > 0) return ready as ReadyOwner
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 10))
  }
  throw new Error('timed out waiting for the production project-lock fixture to become ready')
}

async function waitForExit(child: ChildProcess, label: string): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  const exited = new Promise<void>((resolvePromise) => child.once('exit', () => resolvePromise()))
  await Promise.race([exited, new Promise<void>((_, reject) => setTimeout(() => reject(new Error(`timed out waiting for ${label} to exit`)), 1_000))])
}

function startOwner(root: string, id: string, readyPath: string): ChildProcess {
  const fixture = join(process.cwd(), 'packages/orchestrator/test-fixtures/project-lock-owner.mjs')
  const child = spawn(process.execPath, ['--experimental-strip-types', fixture, root, id, readyPath], { stdio: 'ignore' })
  if (child.pid === undefined) throw new Error('the production project-lock fixture did not start')
  child.unref()
  return child
}

async function createOwner(root: string, id: string, label: string): Promise<OwnerFixture> {
  const child = startOwner(root, id, join(root, `${label}-ready.json`))
  const ready = await waitForOwner(join(root, `${label}-ready.json`))
  const lockPath = join(root, id, '.project.lock')
  const lockBytes = await readFile(lockPath)
  const receipt = lockReceipt(lockBytes)
  assert.equal(receipt.pid, ready.pid, 'each guard identity must come from a production-created lock receipt')
  assert.equal(isAlive(receipt.pid), true, 'a fixture receipt must name a currently live test owner before it is armed')
  return { child, lockPath, lockBytes, receipt }
}

async function killOwner(owner: OwnerFixture, label: string): Promise<void> {
  const { child, receipt } = owner
  if (child.pid !== undefined && child.exitCode === null && child.signalCode === null) {
    try { process.kill(child.pid, 'SIGKILL') } catch { /* the test-owned owner may already have exited */ }
  }
  await waitForExit(child, label)
  assert.equal(isAlive(receipt.pid), false, `${label} must be verifiably gone before stale-guard reclamation`)
}

async function installGuard(path: string, bytes: Buffer): Promise<void> {
  await writeFile(path, bytes, { flag: 'wx', mode: 0o600 })
  assert.deepEqual(await readFile(path), bytes)
}

const posixOnly = { skip: process.platform === 'win32' ? 'the production project-lock fixture requires POSIX owner death checks' : false }

test('ORCH-CRASH-FINAL-33 reclaims only a signed guard bound to unchanged dead predecessor and gone successor', posixOnly, async () => {
  await withTempDir(async (root) => {
    const predecessor = await createOwner(root, projectId, 'reclaim-predecessor')
    const successor = await createOwner(root, `${projectId}-reclaim-successor`, 'reclaim-successor')
    let reopened: Orchestrator | undefined
    try {
      await killOwner(predecessor, 'the exact predecessor owner')
      await killOwner(successor, 'the exact crashed successor owner')
      const guardPath = `${predecessor.lockPath}.takeover`
      const guardBytes = signedGuard(predecessor, successor)
      assertSignedGuard(guardBytes, predecessor, successor)
      await installGuard(guardPath, guardBytes)

      reopened = await Orchestrator.open({ root, projectId, gitHead: testGitHead })
      const replacement = lockReceipt(await readFile(predecessor.lockPath))
      assert.notEqual(replacement.nonce, predecessor.receipt.nonce, 'reclamation must atomically install a distinct successor lock receipt')
      await assert.rejects(readFile(guardPath), { code: 'ENOENT' }, 'only the verified stale signed guard may be removed')
      assert.deepEqual(
        { stage: (await reopened.snapshot()).stage, runState: (await reopened.snapshot()).runState },
        { stage: 'G0', runState: 'idle' },
        'verified stale guard recovery must permit a normal production open',
      )
    } finally {
      await reopened?.close()
      await killOwner(predecessor, 'predecessor cleanup')
      await killOwner(successor, 'successor cleanup')
    }
  })
})

test('ORCH-CRASH-FINAL-33 preserves a signed takeover guard while its bound successor is live', posixOnly, async () => {
  await withTempDir(async (root) => {
    const id = `${projectId}-live-successor`
    const predecessor = await createOwner(root, id, 'live-predecessor')
    const successor = await createOwner(root, `${id}-receipt`, 'live-successor')
    try {
      await killOwner(predecessor, 'the exact predecessor owner')
      const guardPath = `${predecessor.lockPath}.takeover`
      const guardBytes = signedGuard(predecessor, successor)
      assertSignedGuard(guardBytes, predecessor, successor)
      await installGuard(guardPath, guardBytes)
      await assert.rejects(Orchestrator.open({ root, projectId: id, gitHead: testGitHead }), /locked|active|already|recovery/i)
      assert.deepEqual(await readFile(predecessor.lockPath), predecessor.lockBytes, 'a live successor guard must not replace its predecessor lock')
      assert.deepEqual(await readFile(guardPath), guardBytes, 'a live successor guard must never be deleted')
      assert.equal(isAlive(successor.receipt.pid), true, 'the bound successor remains live throughout the fail-closed path')
    } finally {
      await killOwner(predecessor, 'predecessor cleanup')
      await killOwner(successor, 'live successor cleanup')
    }
  })
})

test('ORCH-CRASH-FINAL-33 an unobservable predecessor or successor probe keeps its signed guard fail-closed', posixOnly, async () => {
  await withTempDir(async (root) => {
    for (const errorCode of ['EPERM', 'EACCES'] as const) {
      for (const probe of ['predecessor', 'successor'] as const) {
        const id = `${projectId}-${probe}-${errorCode.toLowerCase()}-guard`
        const predecessor = await createOwner(root, id, `${probe}-${errorCode}-predecessor`)
        const successor = await createOwner(root, `${id}-receipt`, `${probe}-${errorCode}-successor`)
        const realKill = process.kill
        try {
          await killOwner(predecessor, `${probe} ${errorCode} predecessor`)
          await killOwner(successor, `${probe} ${errorCode} successor`)
          const guardPath = `${predecessor.lockPath}.takeover`
          const guardBytes = signedGuard(predecessor, successor)
          assertSignedGuard(guardBytes, predecessor, successor)
          await installGuard(guardPath, guardBytes)
          const unobservablePid = probe === 'predecessor' ? predecessor.receipt.pid : successor.receipt.pid
          process.kill = ((pid: number, signal?: NodeJS.Signals | number) => {
            if (pid === unobservablePid && signal === 0) throw Object.assign(new Error(`test-owned ${probe} identity probe is unobservable`), { code: errorCode })
            return realKill(pid, signal!)
          }) as typeof process.kill
          await assert.rejects(
            Orchestrator.open({ root, projectId: id, gitHead: testGitHead }),
            /recovery|required|unverifiable|identity/i,
            `${probe} ${errorCode} must remain unobservable rather than be treated as a dead owner`,
          )
          assert.deepEqual(await readFile(predecessor.lockPath), predecessor.lockBytes, `${probe} ${errorCode} must not replace the exact predecessor lock bytes`)
          assert.deepEqual(await readFile(guardPath), guardBytes, `${probe} ${errorCode} must not delete the signed guard bytes`)
        } finally {
          process.kill = realKill
          await killOwner(predecessor, `${probe} ${errorCode} predecessor cleanup`)
          await killOwner(successor, `${probe} ${errorCode} successor cleanup`)
        }
      }
    }
  })
})

test('ORCH-CRASH-FINAL-33 preserves opaque, malformed, and unbound guards beside a dead predecessor', posixOnly, async () => {
  await withTempDir(async (root) => {
    const variants: Array<{ label: string; bytes: (predecessor: OwnerFixture, successor: OwnerFixture) => Buffer }> = [
      { label: 'opaque', bytes: () => randomBytes(16) },
      { label: 'malformed', bytes: () => Buffer.from('{not-json', 'utf8') },
      { label: 'unbound', bytes: (predecessor, successor) => signedGuard(predecessor, successor, '0'.repeat(64)) },
    ]
    for (const variant of variants) {
      const id = `${projectId}-${variant.label}-guard`
      const predecessor = await createOwner(root, id, `${variant.label}-predecessor`)
      const successor = await createOwner(root, `${id}-receipt`, `${variant.label}-successor`)
      try {
        await killOwner(predecessor, `${variant.label} predecessor`)
        await killOwner(successor, `${variant.label} successor`)
        const guardPath = `${predecessor.lockPath}.takeover`
        const guardBytes = variant.bytes(predecessor, successor)
        await installGuard(guardPath, guardBytes)
        await assert.rejects(Orchestrator.open({ root, projectId: id, gitHead: testGitHead }), /locked|active|already|recovery/i, `${variant.label} guards must fail closed`)
        assert.deepEqual(await readFile(predecessor.lockPath), predecessor.lockBytes, `${variant.label} guard recovery must not replace the predecessor lock`)
        assert.deepEqual(await readFile(guardPath), guardBytes, `${variant.label} guard recovery must not delete unverified guard bytes`)
      } finally {
        await killOwner(predecessor, `${variant.label} predecessor cleanup`)
        await killOwner(successor, `${variant.label} successor cleanup`)
      }
    }
  })
})
