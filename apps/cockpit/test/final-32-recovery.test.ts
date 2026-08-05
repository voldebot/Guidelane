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
  revision: 32,
  stage: 'G0',
  runState: 'idle',
  language: 'tr',
  blueprintRevision: 0,
  gates: [],
  pendingDecision: 'submitIdea',
}

test('CPT-RECOVERY-FINAL-32 a successful same-revision recovery clears unavailable and loading after a transient snapshot GET failure', { timeout: 15_000 }, async () => {
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
        close(): void { /* keep the recovery test free of reconnect timers */ }
      }
      Object.defineProperty(window, 'WebSocket', { configurable: true, value: IdleWebSocket })
    })

    let snapshotGets = 0
    let transientFailureRequested = false
    let commandPosts = 0
    await page.route('**/api/v1/projects/current', async (route) => {
      snapshotGets += 1
      if (transientFailureRequested) {
        transientFailureRequested = false
        await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'transient' }) })
        return
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(revisionR) })
    })
    await page.route('**/api/v1/projects/current/commands', async (route) => {
      commandPosts += 1
      transientFailureRequested = commandPosts === 1
      await route.fulfill({ status: 204 })
    })

    await page.goto(origin)
    const action = page.getByRole('button', { name: /fikir/i })
    await expect(action).toBeVisible()
    await expect.poll(() => snapshotGets).toBeGreaterThan(0)
    const initialGets = snapshotGets

    await action.click()
    const unavailable = page.getByRole('alert')
    await expect(unavailable).toBeVisible()
    await expect.poll(() => snapshotGets).toBeGreaterThan(initialGets)
    const refresh = page.getByRole('button', { name: 'Durumu yenile' })
    await expect(action).toHaveCount(0)
    await expect(refresh).toBeVisible()

    const beforeRefreshGets = snapshotGets
    const initialCommandPosts = commandPosts
    await refresh.click()
    await expect.poll(() => snapshotGets).toBeGreaterThan(beforeRefreshGets)
    assert.equal(commandPosts, initialCommandPosts, 'refresh status must not submit another command')
    await expect(unavailable).toHaveCount(0)
    await expect(action).toBeVisible()
  } finally {
    await browser.close()
    await vite.close()
  }
})
