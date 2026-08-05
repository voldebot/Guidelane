import assert from 'node:assert/strict'
import { chromium, expect } from '@playwright/test'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { createServer } from 'vite'

const cockpitRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const revisionR = {
  schemaVersion: 1,
  projectId: 'cockpit-novice',
  revision: 33,
  stage: 'G5',
  runState: 'waiting',
  language: 'en',
  blueprintRevision: 0,
  gates: [],
  pendingDecision: 'acceptResult',
}
const sameRevisionRecovery = {
  ...revisionR,
  runState: 'recovery-required',
  pendingDecision: null,
}
const olderRevision = {
  ...revisionR,
  revision: 32,
  stage: 'G0',
  runState: 'idle',
  pendingDecision: 'submitIdea',
}

test('CPT-STATE-FINAL-33 a same-revision canonical recovery overlay replaces a stale action, while an older snapshot cannot replace it', { timeout: 15_000 }, async () => {
  const vite = await createServer({ root: cockpitRoot, logLevel: 'error', server: { host: '127.0.0.1', port: 0, strictPort: true } })
  const browser = await chromium.launch({ headless: true })
  try {
    await vite.listen()
    const origin = vite.resolvedUrls?.local?.[0]
    assert.ok(origin, 'the test-owned Vite server must expose one local origin')
    const page = await browser.newPage()
    await page.addInitScript(() => {
      class IdleWebSocket {
        static readonly CONNECTING = 0
        static readonly OPEN = 1
        static readonly CLOSING = 2
        static readonly CLOSED = 3
        readonly readyState = IdleWebSocket.OPEN
        onclose: ((event: Event) => void) | null = null
        onmessage: ((event: MessageEvent) => void) | null = null
        close(): void { /* keep this recovery test free of reconnect timers */ }
      }
      Object.defineProperty(window, 'WebSocket', { configurable: true, value: IdleWebSocket })
    })

    let snapshotGets = 0
    let commandPosts = 0
    let snapshotPhase: 'initial' | 'transient-failure' | 'same-revision-recovery' | 'older-revision' = 'initial'
    let olderRevisionOffered = false
    await page.route('**/api/v1/projects/current', async (route) => {
      snapshotGets += 1
      if (snapshotPhase === 'transient-failure') {
        snapshotPhase = 'same-revision-recovery'
        await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'transient' }) })
        return
      }
      if (snapshotPhase === 'same-revision-recovery') {
        snapshotPhase = 'older-revision'
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(sameRevisionRecovery) })
        return
      }
      if (snapshotPhase === 'older-revision') {
        olderRevisionOffered = true
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(olderRevision) })
        return
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(revisionR) })
    })
    await page.route('**/api/v1/projects/current/commands', async (route) => {
      commandPosts += 1
      if (commandPosts === 1) snapshotPhase = 'transient-failure'
      await route.fulfill({ status: 204 })
    })

    await page.goto(origin)
    const accept = page.getByRole('button', { name: 'Accept result' })
    const unavailable = page.getByRole('alert')
    await expect(accept).toBeVisible()
    await expect(unavailable).toHaveCount(0)
    await expect.poll(() => snapshotGets).toBeGreaterThan(0)

    const beforeTransientFailure = snapshotGets
    await accept.click()
    await expect(unavailable).toBeVisible()
    await expect.poll(() => snapshotGets).toBeGreaterThan(beforeTransientFailure)
    const refresh = page.getByRole('button', { name: 'Refresh status' })
    await expect(accept).toHaveCount(0)
    await expect(refresh).toBeVisible()

    const beforeSameRevisionRecovery = snapshotGets
    const initialCommandPosts = commandPosts
    await refresh.click()
    await expect.poll(() => snapshotGets).toBeGreaterThan(beforeSameRevisionRecovery)
    assert.equal(commandPosts, initialCommandPosts, 'refresh status must not submit another command')

    await expect(accept).toHaveCount(0)
    await expect(page.getByTestId('run-state')).toHaveText('Recovery is needed; getting the current state again.')
    await expect(page.getByRole('status')).toHaveText('Recovery is needed; getting the current state again.')
    await expect(refresh).toBeVisible()
    await expect(unavailable).toHaveCount(0)
    await expect(page.getByText('Loading safe state.', { exact: true })).toHaveCount(0)

    const beforeOlderRevision = snapshotGets
    await refresh.click()
    await expect.poll(() => snapshotGets).toBeGreaterThan(beforeOlderRevision)
    assert.equal(commandPosts, initialCommandPosts, 'recovery refresh must remain read-only')
    assert.equal(olderRevisionOffered, true, 'the recovery refresh must receive an older canonical snapshot for the monotonicity assertion')
    await expect(accept).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Share idea' })).toHaveCount(0)
    await expect(page.getByTestId('run-state')).toHaveText('Recovery is needed; getting the current state again.')
    await expect(refresh).toBeVisible()
    await expect(unavailable).toHaveCount(0)
  } finally {
    await browser.close()
    await vite.close()
  }
})
