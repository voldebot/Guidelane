import assert from 'node:assert/strict'
import { chromium, expect } from '@playwright/test'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { createServer } from 'vite'

const cockpitRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const initial = {
  schemaVersion: 1,
  projectId: 'cockpit-final-34',
  revision: 34,
  stage: 'G4',
  runState: 'running',
  language: 'en',
  blueprintRevision: 3,
  gates: [],
  pendingDecision: null,
}
const canonicalRecovery = {
  ...initial,
  revision: 35,
  schemaVersion: 2,
  blueprintRevision: 4,
  runState: 'recovery-required',
}
const older = { ...canonicalRecovery, revision: 34, stage: 'G0', runState: 'idle', pendingDecision: 'submitIdea' }

test('CPT-FINAL-34 a differing equal-revision canonical recovery clears prior semantic activity and rejects an older snapshot', { timeout: 15_000 }, async () => {
  const vite = await createServer({ root: cockpitRoot, logLevel: 'error', server: { host: '127.0.0.1', port: 0, strictPort: true } })
  const browser = await chromium.launch({ headless: true })
  try {
    await vite.listen()
    const origin = vite.resolvedUrls?.local?.[0]
    assert.ok(origin, 'the test-owned Vite server must expose a local origin')
    const page = await browser.newPage()
    await page.addInitScript(() => {
      class TestWebSocket {
        static readonly CONNECTING = 0
        static readonly OPEN = 1
        static readonly CLOSING = 2
        static readonly CLOSED = 3
        static latest: TestWebSocket | null = null
        readonly readyState = TestWebSocket.OPEN
        onclose: ((event: Event) => void) | null = null
        onmessage: ((event: MessageEvent) => void) | null = null
        constructor() { TestWebSocket.latest = this }
        close(): void { /* recovery messages are dispatched explicitly by this fixture */ }
        static send(value: unknown): void { TestWebSocket.latest?.onmessage?.({ data: JSON.stringify(value) } as MessageEvent) }
      }
      Object.defineProperty(window, 'WebSocket', { configurable: true, value: TestWebSocket })
      Object.defineProperty(window, '__final34SnapshotRequired', { configurable: true, value: () => TestWebSocket.send({ type: 'snapshot_required' }) })
      Object.defineProperty(window, '__final34Semantic', { configurable: true, value: () => TestWebSocket.send({ type: 'phase_update', revision: 35, message: 'İnşa güvenle ilerliyor.' }) })
    })

    let phase: 'initial' | 'canonical' | 'older' = 'initial'
    let gets = 0
    let canonicalRecoveryOffered = false
    let olderSnapshotOffered = false
    await page.route('**/api/v1/projects/current', async (route) => {
      gets += 1
      const body = phase === 'canonical' ? canonicalRecovery : phase === 'older' ? older : initial
      if (phase === 'canonical') canonicalRecoveryOffered = true
      if (phase === 'older') olderSnapshotOffered = true
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
    })

    await page.goto(origin)
    await expect(page.getByTestId('run-state')).toHaveText('Progressing; checks are underway.')
    phase = 'canonical'
    const beforeCanonical = gets
    await page.evaluate(() => (window as typeof window & { __final34Semantic(): void }).__final34Semantic())
    await expect.poll(() => gets).toBeGreaterThan(beforeCanonical)
    assert.equal(canonicalRecoveryOffered, true, 'the revision-35 semantic event must recover with canonical revision 35')
    await expect(page.getByTestId('run-state')).toHaveText('Recovery is needed; getting the current state again.')
    await expect(page.getByRole('status')).toHaveText('Recovery is needed; getting the current state again.')

    phase = 'older'
    const beforeOlder = gets
    await page.evaluate(() => (window as typeof window & { __final34SnapshotRequired(): void }).__final34SnapshotRequired())
    await expect.poll(() => gets).toBeGreaterThan(beforeOlder)
    assert.equal(olderSnapshotOffered, true, 'the post-recovery snapshot must be stale revision 34')
    await expect(page.getByTestId('run-state')).toHaveText('Recovery is needed; getting the current state again.')
    await expect(page.getByRole('button', { name: 'Share idea' })).toHaveCount(0)
  } finally {
    await browser.close()
    await vite.close()
  }
})
