import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { access, readFile, realpath, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { Orchestrator } from '../src/index.ts'
import { advanceToG4, digest, projectId, testGitHead, withTempDir, writeSignedAttempt } from './helpers.ts'

const wrapper = resolve(process.cwd(), 'packages/orchestrator/src/attempt-wrapper.mjs')
const marker = resolve(process.cwd(), 'packages/orchestrator/test-fixtures/intent-binding-marker.mjs')
const nonce = 'a'.repeat(64)

type WrapperMessage = { kind: 'armed' | 'started' }

function canonicalIntent(input: { phase: string; command: string; args: string[]; cwd: string; env: Record<string, string> }, intentNonce = nonce) {
  const unsigned = {
    schemaVersion: 1,
    phase: input.phase,
    command: input.command,
    commandDigest: digest(input.command),
    argsDigest: digest(JSON.stringify(input.args)),
    cwd: input.cwd,
    envDigest: digest(JSON.stringify(Object.entries(input.env).sort(([left], [right]) => left.localeCompare(right)))),
    nonce: intentNonce,
  }
  return { ...unsigned, intentDigest: digest(JSON.stringify(unsigned)) }
}

async function waitForMessage(child: ChildProcess, kind: WrapperMessage['kind']): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const timeout = setTimeout(() => finish(() => reject(new Error(`timed out waiting for wrapper ${kind}`))), 1_000)
    const finish = (action: () => void) => {
      clearTimeout(timeout)
      child.off('message', onMessage)
      child.off('exit', onExit)
      child.off('error', onError)
      action()
    }
    const onMessage = (message: unknown) => { if ((message as WrapperMessage | undefined)?.kind === kind) finish(resolvePromise) }
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => finish(() => reject(new Error(`wrapper exited before ${kind}: ${code ?? signal ?? 'unknown'}`)))
    const onError = (error: Error) => finish(() => reject(error))
    child.on('message', onMessage)
    child.once('exit', onExit)
    child.once('error', onError)
  })
}

async function wrapperExit(child: ChildProcess): Promise<number | null> {
  if (child.exitCode !== null) return child.exitCode
  return await new Promise((resolvePromise) => child.once('exit', (code) => resolvePromise(code)))
}

async function assertMissing(path: string): Promise<void> {
  await assert.rejects(access(path), /ENOENT|no such file/i)
}

async function waitForFile(path: string, label: string): Promise<string> {
  const deadline = Date.now() + 1_000
  while (Date.now() < deadline) {
    try {
      const value = await readFile(path, 'utf8')
      if (value.length > 0) return value
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 10))
  }
  throw new Error(`timed out waiting for ${label}`)
}

async function waitForProcessGroupExit(pgid: number): Promise<void> {
  const deadline = Date.now() + 1_000
  while (Date.now() < deadline) {
    try {
      process.kill(-pgid, 0)
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 10))
    } catch {
      return
    }
  }
  throw new Error('timed out waiting for the test-owned wrapper process group to exit')
}

async function stopOwnedWrapper(child: ChildProcess): Promise<void> {
  if (child.exitCode === null && child.pid !== undefined) {
    try { process.kill(child.pid, 'SIGKILL') } catch { /* test-owned wrapper already exited */ }
    await wrapperExit(child)
  }
}

test('INTENT-BINDING-01 persists one canonical launch intent digest and nonce before the wrapper may start the target', async () => {
  await withTempDir(async (root) => {
    const cwd = join(root, 'cwd')
    await import('node:fs/promises').then(({ mkdir }) => mkdir(cwd))
    const targetMarker = join(root, 'started')
    const release = join(root, 'release-target')
    const env = { PATH: process.env.PATH ?? '', GUIDELANE_INTENT_MARKER: targetMarker }
    const args = [marker, targetMarker, 'matching', release]
    const orchestrator = await Orchestrator.open({ root, projectId, gitHead: testGitHead })
    let launched: { attemptId: string; receipt: { pgid: number; nonce: string } } | undefined
    try {
      await advanceToG4(orchestrator, 'Intent binding production launch')
      launched = await orchestrator.launchAttempt({ phase: 'build', attemptId: 'canonical-intent', command: process.execPath, args, cwd, env, receiptTimeoutMs: 500 })
      const attempt = await orchestrator.attempt(launched.attemptId)
      assert.ok(attempt.intent, 'the durable attempt must persist its launch intent before GO')
      const expected = canonicalIntent({ phase: 'build', command: process.execPath, args, cwd: await realpath(cwd), env }, attempt.intent.nonce)
      assert.deepEqual(attempt.intent, expected, 'intent bytes must have one canonical digest over the exact launch fields')
      assert.equal(launched.receipt.nonce, attempt.intent.nonce, 'receipt and durable intent must bind the same release nonce')
      assert.equal(await waitForFile(targetMarker, 'matching target marker'), 'matching')
      await writeFile(release, 'release\n', 'utf8')
      await waitForProcessGroupExit(launched.receipt.pgid)
    } finally {
      await writeFile(release, 'release\n', 'utf8').catch(() => {})
      if (launched) await waitForProcessGroupExit(launched.receipt.pgid)
      await orchestrator.close()
    }
  })
})

test('INTENT-BINDING-02 accepts only an armed GO whose exact payload agrees with the canonical intent', async () => {
  await withTempDir(async (root) => {
    const targetMarker = join(root, 'matching-marker')
    const release = join(root, 'release-target')
    const env = { PATH: process.env.PATH ?? '' }
    const args = [marker, targetMarker, 'matching', release]
    const intent = canonicalIntent({ phase: 'build', command: process.execPath, args, cwd: root, env })
    const child = spawn(process.execPath, [wrapper, `--guidelane-attempt-nonce=${nonce}`], { cwd: root, env, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] })
    try {
      child.send({ kind: 'prepare', nonce, intentDigest: intent.intentDigest, ttlMs: 500 })
      await waitForMessage(child, 'armed')
      child.send({ kind: 'go', nonce, intentDigest: intent.intentDigest, command: process.execPath, args, cwd: root, env })
      await waitForMessage(child, 'started')
      assert.equal(await waitForFile(targetMarker, 'matching target marker'), 'matching')
      await writeFile(release, 'release\n', 'utf8')
      assert.equal(await wrapperExit(child), 0)
    } finally {
      await writeFile(release, 'release\n', 'utf8').catch(() => {})
      await stopOwnedWrapper(child)
    }
  })
})

test('INTENT-BINDING-03 rejects a GO payload for intent B after arming intent A and starts no marker', async (t) => {
  await t.test('an otherwise exact GO without intentDigest fails closed before the target starts', async () => {
    await withTempDir(async (root) => {
      const markerA = join(root, 'intent-a-marker')
      const env = { PATH: process.env.PATH ?? '' }
      const args = [marker, markerA, 'A']
      const intentA = canonicalIntent({ phase: 'build', command: process.execPath, args, cwd: root, env })
      const child = spawn(process.execPath, [wrapper, `--guidelane-attempt-nonce=${nonce}`], { cwd: root, env, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] })
      try {
        child.send({ kind: 'prepare', nonce, intentDigest: intentA.intentDigest, ttlMs: 500 })
        await waitForMessage(child, 'armed')
        child.send({ kind: 'go', nonce, command: process.execPath, args, cwd: root, env })
        assert.notEqual(await wrapperExit(child), 0, 'GO must explicitly repeat the armed intent digest before target spawn')
        await assertMissing(markerA)
      } finally {
        await stopOwnedWrapper(child)
      }
    })
  })

  await t.test('a GO payload for intent B fails closed even when it claims intent A', async () => {
    await withTempDir(async (root) => {
      const markerA = join(root, 'intent-a-marker')
      const markerB = join(root, 'intent-b-marker')
      const env = { PATH: process.env.PATH ?? '' }
      const intentA = canonicalIntent({ phase: 'build', command: process.execPath, args: [marker, markerA, 'A'], cwd: root, env })
      const child = spawn(process.execPath, [wrapper, `--guidelane-attempt-nonce=${nonce}`], { cwd: root, env, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] })
      try {
        child.send({ kind: 'prepare', nonce, intentDigest: intentA.intentDigest, ttlMs: 500 })
        await waitForMessage(child, 'armed')
        child.send({ kind: 'go', nonce, intentDigest: intentA.intentDigest, command: process.execPath, args: [marker, markerB, 'B'], cwd: root, env })
        assert.notEqual(await wrapperExit(child), 0, 'a mismatched GO must fail closed before target spawn')
        await assertMissing(markerA)
        await assertMissing(markerB)
      } finally {
        await stopOwnedWrapper(child)
      }
    })
  })
})

test('INTENT-BINDING-04 reopen rejects malformed and digest-mismatched persisted intents', async () => {
  for (const [attemptId, intent] of [
    ['malformed-intent', { schemaVersion: 1, nonce }],
    ['digest-mismatch-intent', { ...canonicalIntent({ phase: 'build', command: process.execPath, args: [], cwd: process.cwd(), env: { PATH: process.env.PATH ?? '' } }), intentDigest: 'b'.repeat(64) }],
  ] as const) {
    await withTempDir(async (root) => {
      await writeSignedAttempt(root, attemptId, { status: 'interrupted', intent })
      const orchestrator = await Orchestrator.open({ root, projectId, gitHead: testGitHead })
      try {
        const state = await orchestrator.snapshot()
        assert.equal(state.runState, 'recovery-required', `${attemptId} must be rejected on reopen rather than accepted as historical state`)
        assert.equal(state.pendingDecision, null)
      } finally {
        await orchestrator.close()
      }
    })
  }
})

test('INTENT-BINDING-05 reopen rejects a persisted receipt whose nonce differs from its intent nonce', async () => {
  await withTempDir(async (root) => {
    const intent = canonicalIntent({ phase: 'build', command: process.execPath, args: [], cwd: process.cwd(), env: { PATH: process.env.PATH ?? '' } }, 'b'.repeat(64))
    await writeSignedAttempt(root, 'receipt-nonce-mismatch', { status: 'interrupted', intent, receipt: { pid: 1, pgid: 1, startIdentity: 'test-only-recorded-identity', nonce } })
    const orchestrator = await Orchestrator.open({ root, projectId, gitHead: testGitHead })
    try {
      const state = await orchestrator.snapshot()
      assert.equal(state.runState, 'recovery-required', 'receipt/intent nonce mismatch must never reopen as trusted historical state')
      assert.equal(state.pendingDecision, null)
    } finally {
      await orchestrator.close()
    }
  })
})
