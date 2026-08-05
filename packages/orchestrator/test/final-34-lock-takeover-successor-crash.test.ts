import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import { Orchestrator } from '../src/index.ts'
import { projectId, testGitHead, withTempDir } from './helpers.ts'

type Receipt = { pid: number; startIdentity: string; nonce: string }
type Owner = { child: ChildProcess; path: string; bytes: Buffer; receipt: Receipt }

const digest = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
const canonical = (value: unknown): Buffer => Buffer.from(`${JSON.stringify(value)}\n`, 'utf8')

function receipt(bytes: Buffer): Receipt {
  const value = JSON.parse(bytes.toString('utf8')) as Partial<Receipt>
  assert.equal(Number.isSafeInteger(value.pid) && value.pid! > 0, true)
  assert.equal(typeof value.startIdentity, 'string')
  assert.match(value.nonce ?? '', /^[a-f0-9]{64}$/i)
  return value as Receipt
}

function signedGuard(predecessor: Owner, successor: Owner): Buffer {
  const unsigned = {
    schemaVersion: 1,
    predecessor: { ...predecessor.receipt, lockDigest: digest(predecessor.bytes) },
    successor: successor.receipt,
    guardNonce: randomBytes(32).toString('hex'),
  }
  return canonical({ ...unsigned, sha256: digest(canonical(unsigned)) })
}

async function waitForReady(path: string): Promise<number> {
  const deadline = Date.now() + 1_000
  while (Date.now() < deadline) {
    try {
      const value = JSON.parse(await readFile(path, 'utf8')) as { pid?: unknown }
      if (Number.isSafeInteger(value.pid) && (value.pid as number) > 0) return value.pid as number
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('timed out waiting for the production lock owner fixture')
}

async function waitForExit(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  await Promise.race([
    new Promise<void>((resolve) => child.once('exit', () => resolve())),
    new Promise<void>((_, reject) => setTimeout(() => reject(new Error('test-owned project lock owner did not exit')), 1_000)),
  ])
}

async function owner(root: string, id: string, label: string): Promise<Owner> {
  const ready = join(root, `${label}.json`)
  const fixture = join(process.cwd(), 'packages/orchestrator/test-fixtures/project-lock-owner.mjs')
  const child = spawn(process.execPath, ['--experimental-strip-types', fixture, root, id, ready], { stdio: 'ignore' })
  if (child.pid === undefined) throw new Error('production lock owner fixture did not start')
  child.unref()
  const readyPid = await waitForReady(ready)
  const lockPath = join(root, id, '.project.lock')
  const bytes = await readFile(lockPath)
  const value = receipt(bytes)
  assert.equal(value.pid, readyPid, 'the guard must use production-created owner receipts')
  return { child, path: lockPath, bytes, receipt: value }
}

async function kill(owner: Owner): Promise<void> {
  if (owner.child.exitCode === null && owner.child.signalCode === null) {
    try { process.kill(owner.child.pid!, 'SIGKILL') } catch { /* test-owned owner may have already exited */ }
  }
  await waitForExit(owner.child)
  assert.throws(() => process.kill(owner.receipt.pid, 0), { code: 'ESRCH' })
}

const posixOnly = { skip: process.platform === 'win32' ? 'POSIX process identity receipts are unavailable on Windows' : false }

test('ORCH-FINAL-34 reclaims one exact dead successor lock and its signed predecessor takeover guard without signalling', posixOnly, async () => {
  await withTempDir(async (root) => {
    const id = `${projectId}-successor-crash`
    const predecessor = await owner(root, id, 'predecessor')
    const successor = await owner(root, `${id}-successor-receipt`, 'successor')
    let reopened: Orchestrator | undefined
    const realKill = process.kill
    const signals: Array<{ pid: number; signal: NodeJS.Signals | number | undefined }> = []
    try {
      await kill(predecessor)
      await kill(successor)
      const guardPath = `${predecessor.path}.takeover`
      const guard = signedGuard(predecessor, successor)
      await writeFile(guardPath, guard, { flag: 'wx', mode: 0o600 })
      // This is the exact on-disk crash window: rename installed the successor
      // receipt, but the old predecessor-bound guard was not yet unlinked.
      await rename(successor.path, predecessor.path)
      assert.deepEqual(await readFile(predecessor.path), successor.bytes)
      assert.deepEqual(await readFile(guardPath), guard)

      process.kill = ((pid: number, signal?: NodeJS.Signals | number) => {
        if (signal !== 0 && signal !== undefined) signals.push({ pid, signal })
        return realKill(pid, signal!)
      }) as typeof process.kill
      reopened = await Orchestrator.open({ root, projectId: id, gitHead: testGitHead })

      const replacement = receipt(await readFile(predecessor.path))
      assert.notEqual(replacement.nonce, predecessor.receipt.nonce)
      assert.notEqual(replacement.nonce, successor.receipt.nonce, 'recovery must install a new exact owner, not reuse the crashed successor')
      await assert.rejects(readFile(guardPath), { code: 'ENOENT' }, 'the stale exact guard must be reclaimed exactly once')
      assert.deepEqual(signals, [], 'stale lock takeover must not signal either dead identity')
    } finally {
      process.kill = realKill
      await reopened?.close()
      await kill(predecessor)
      await kill(successor)
    }
  })
})
