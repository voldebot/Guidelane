import assert from 'node:assert/strict'
import { chromium, expect } from '@playwright/test'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { createServer } from 'vite'

const cockpitRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const initial = {
  schemaVersion: 1,
  projectId: 'cockpit-final-36',
  revision: 34,
  stage: 'G4',
  runState: 'running',
  language: 'en',
  blueprintRevision: 4,
  gates: [],
  pendingDecision: null,
}

const matchingCanonical = { ...initial, revision: 35 }
const contradictoryCanonical = { ...initial, revision: 35, stage: 'G5', runState: 'recovery-required' }
const transitionInitial = {
  ...initial,
  projectId: 'cockpit-final-36-transition',
  stage: 'G0',
  runState: 'idle',
  blueprintRevision: 0,
  pendingDecision: 'submitIdea',
}
const transitionCanonical = {
  ...transitionInitial,
  revision: 35,
  stage: 'G1',
  runState: 'waiting',
  blueprintRevision: 1,
  pendingDecision: 'approveBlueprint',
}

function installIdleWebSocket(page: import('@playwright/test').Page): Promise<void> {
  return page.addInitScript(() => {
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
      close(): void { /* keep recovery deterministic and free of reconnect timers */ }
      static send(value: unknown): void { TestWebSocket.latest?.onmessage?.({ data: JSON.stringify(value) } as MessageEvent) }
    }
    Object.defineProperty(window, 'WebSocket', { configurable: true, value: TestWebSocket })
    Object.defineProperty(window, '__final36Semantic', { configurable: true, value: () => TestWebSocket.send({ type: 'phase_update', revision: 35, message: 'İnşa güvenle ilerliyor.' }) })
    Object.defineProperty(window, '__final36TransitionSnapshotRequired', { configurable: true, value: () => TestWebSocket.send({ type: 'snapshot_required' }) })
    Object.defineProperty(window, '__final36TransitionSemantic', { configurable: true, value: () => TestWebSocket.send({ type: 'phase_update', revision: 35, message: 'Taslak hazır; onayınızı bekliyor.' }) })
    })
}

function installFinal37WebSocket(page: import('@playwright/test').Page): Promise<void> {
  return page.addInitScript(() => {
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
      close(): void { /* keep recovery deterministic and free of reconnect timers */ }
      static send(value: unknown): void { TestWebSocket.latest?.onmessage?.({ data: JSON.stringify(value) } as MessageEvent) }
    }
    Object.defineProperty(window, 'WebSocket', { configurable: true, value: TestWebSocket })
    Object.defineProperty(window, '__final37RevisionEvent', { configurable: true, value: () => TestWebSocket.send({ type: 'phase_update', revision: 41, message: 'Taslak hazır; onayınızı bekliyor.' }) })
    Object.defineProperty(window, '__final37SnapshotRequired', { configurable: true, value: () => TestWebSocket.send({ type: 'snapshot_required' }) })
  })
}

test('CPT-FINAL-36 the newest valid semantic activity remains displayed when recovery obtains its matching canonical snapshot', { timeout: 15_000 }, async () => {
  const vite = await createServer({ root: cockpitRoot, logLevel: 'error', server: { host: '127.0.0.1', port: 0, strictPort: true } })
  const browser = await chromium.launch({ headless: true })
  try {
    await vite.listen()
    const origin = vite.resolvedUrls?.local?.[0]
    assert.ok(origin, 'the test-owned Vite server must expose a local origin')
    const page = await browser.newPage()
    await installIdleWebSocket(page)

    let semanticEmitted = false
    let matchingGets = 0
    let snapshotGets = 0
    await page.route('**/api/v1/projects/current', async (route) => {
      snapshotGets += 1
      if (semanticEmitted) matchingGets += 1
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(semanticEmitted ? matchingCanonical : initial) })
    })

    await page.goto(origin)
    await expect(page.getByTestId('run-state')).toHaveText('Progressing; checks are underway.')
    const initialGets = snapshotGets
    semanticEmitted = true
    await page.evaluate(() => (window as typeof window & { __final36Semantic(): void }).__final36Semantic())
    await expect.poll(() => snapshotGets).toBeGreaterThan(initialGets)
    assert.equal(matchingGets > 0, true, 'the semantic event must trigger a recovery fetch for the matching canonical snapshot')
    await expect(page.getByRole('status')).toHaveText('Build is progressing safely.')
  } finally {
    await browser.close()
    await vite.close()
  }
})

test('CPT-FINAL-36 a legitimate phase transition preserves localized semantic activity after the matching canonical fetch', { timeout: 15_000 }, async () => {
  const vite = await createServer({ root: cockpitRoot, logLevel: 'error', server: { host: '127.0.0.1', port: 0, strictPort: true } })
  const browser = await chromium.launch({ headless: true })
  try {
    await vite.listen()
    const origin = vite.resolvedUrls?.local?.[0]
    assert.ok(origin, 'the test-owned Vite server must expose a local origin')
    const page = await browser.newPage()
    await installIdleWebSocket(page)

    let semanticEmitted = false
    let matchingGets = 0
    let snapshotGets = 0
    await page.route('**/api/v1/projects/current', async (route) => {
      snapshotGets += 1
      if (semanticEmitted) matchingGets += 1
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(semanticEmitted ? transitionCanonical : transitionInitial) })
    })

    await page.goto(origin)
    await expect(page.getByTestId('run-state')).toHaveText('You are ready to begin.')
    const initialGets = snapshotGets
    semanticEmitted = true
    await page.evaluate(() => (window as typeof window & { __final36TransitionSemantic(): void }).__final36TransitionSemantic())
    await expect.poll(() => snapshotGets).toBeGreaterThan(initialGets)
    assert.equal(matchingGets > 0, true, 'the semantic event must trigger a recovery fetch for the transitioned canonical snapshot')
    await expect(page.getByRole('button', { name: 'Approve blueprint' })).toBeVisible()
    await expect(page.getByRole('status')).toHaveText('Blueprint is ready; awaiting your approval.')
  } finally {
    await browser.close()
    await vite.close()
  }
})

test('CPT-FINAL-36 a same-revision blueprint-ready semantic event remains displayed after snapshot-required recovery', { timeout: 15_000 }, async () => {
  const vite = await createServer({ root: cockpitRoot, logLevel: 'error', server: { host: '127.0.0.1', port: 0, strictPort: true } })
  const browser = await chromium.launch({ headless: true })
  try {
    await vite.listen()
    const origin = vite.resolvedUrls?.local?.[0]
    assert.ok(origin, 'the test-owned Vite server must expose a local origin')
    const page = await browser.newPage()
    await installIdleWebSocket(page)

    let recoveryRequested = false
    let snapshotGets = 0
    await page.route('**/api/v1/projects/current', async (route) => {
      snapshotGets += 1
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(recoveryRequested ? transitionCanonical : transitionInitial) })
    })

    await page.goto(origin)
    await expect(page.getByTestId('run-state')).toHaveText('You are ready to begin.')
    recoveryRequested = true
    const initialGets = snapshotGets
    await page.evaluate(() => (window as typeof window & { __final36TransitionSnapshotRequired(): void }).__final36TransitionSnapshotRequired())
    await expect.poll(() => snapshotGets).toBeGreaterThan(initialGets)
    await expect(page.getByRole('button', { name: 'Approve blueprint' })).toBeVisible()
    await page.evaluate(() => (window as typeof window & { __final36TransitionSemantic(): void }).__final36TransitionSemantic())
    await expect(page.getByRole('status')).toHaveText('Blueprint is ready; awaiting your approval.')
  } finally {
    await browser.close()
    await vite.close()
  }
})

test('CPT-FINAL-36 a missed blueprint-ready semantic event falls back to localized activity from the canonical phase snapshot', { timeout: 15_000 }, async () => {
  const vite = await createServer({ root: cockpitRoot, logLevel: 'error', server: { host: '127.0.0.1', port: 0, strictPort: true } })
  const browser = await chromium.launch({ headless: true })
  try {
    await vite.listen()
    const origin = vite.resolvedUrls?.local?.[0]
    assert.ok(origin, 'the test-owned Vite server must expose a local origin')
    const page = await browser.newPage()
    await installIdleWebSocket(page)

    let recoveryRequested = false
    let snapshotGets = 0
    await page.route('**/api/v1/projects/current', async (route) => {
      snapshotGets += 1
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(recoveryRequested ? transitionCanonical : transitionInitial) })
    })

    await page.goto(origin)
    await expect(page.getByTestId('run-state')).toHaveText('You are ready to begin.')
    recoveryRequested = true
    const initialGets = snapshotGets
    await page.evaluate(() => (window as typeof window & { __final36TransitionSnapshotRequired(): void }).__final36TransitionSnapshotRequired())
    await expect.poll(() => snapshotGets).toBeGreaterThan(initialGets)
    await expect(page.getByRole('button', { name: 'Approve blueprint' })).toBeVisible()
    await expect(page.getByRole('status')).toHaveText('Blueprint is ready; awaiting your approval.')
  } finally {
    await browser.close()
    await vite.close()
  }
})

test('CPT-FINAL-36 a genuinely contradictory canonical snapshot clears stale semantic activity at the event revision', { timeout: 15_000 }, async () => {
  const vite = await createServer({ root: cockpitRoot, logLevel: 'error', server: { host: '127.0.0.1', port: 0, strictPort: true } })
  const browser = await chromium.launch({ headless: true })
  try {
    await vite.listen()
    const origin = vite.resolvedUrls?.local?.[0]
    assert.ok(origin, 'the test-owned Vite server must expose a local origin')
    const page = await browser.newPage()
    await installIdleWebSocket(page)

    let semanticEmitted = false
    let snapshotGets = 0
    await page.route('**/api/v1/projects/current', async (route) => {
      snapshotGets += 1
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(semanticEmitted ? contradictoryCanonical : initial) })
    })

    await page.goto(origin)
    await expect(page.getByTestId('run-state')).toHaveText('Progressing; checks are underway.')
    const initialGets = snapshotGets
    semanticEmitted = true
    await page.evaluate(() => (window as typeof window & { __final36Semantic(): void }).__final36Semantic())
    await expect.poll(() => snapshotGets).toBeGreaterThan(initialGets)
    await expect(page.getByTestId('run-state')).toHaveText('Recovery is needed; getting the current state again.')
    await expect(page.getByRole('status')).toHaveText('Recovery is needed; getting the current state again.')
  } finally {
    await browser.close()
    await vite.close()
  }
})

test('CPT-FINAL-37 an event at revision R keeps stale R-1 recovery fail-closed and suppresses user controls until the matching canonical snapshot arrives', { timeout: 15_000 }, async () => {
  const vite = await createServer({ root: cockpitRoot, logLevel: 'error', server: { host: '127.0.0.1', port: 0, strictPort: true } })
  const browser = await chromium.launch({ headless: true })
  let releaseStaleResponse = () => undefined
  const staleResponseReleased = new Promise<void>((resolve) => { releaseStaleResponse = resolve })
  try {
    await vite.listen()
    const origin = vite.resolvedUrls?.local?.[0]
    assert.ok(origin, 'the test-owned Vite server must expose a local origin')
    const page = await browser.newPage()
    await installFinal37WebSocket(page)

    const canonicalRMinusOne = {
      schemaVersion: 1,
      projectId: 'cockpit-final-37',
      revision: 40,
      stage: 'G0',
      runState: 'waiting',
      language: 'en',
      blueprintRevision: 0,
      gates: [],
      pendingDecision: 'submitIdea',
    }
    const canonicalR = {
      ...canonicalRMinusOne,
      revision: 41,
      stage: 'G1',
      blueprintRevision: 1,
      pendingDecision: 'approveBlueprint',
    }
    let eventEmitted = false
    let staleResponseStarted = false
    let staleResponseCompleted = false
    let matchingResponseRequested = false
    const recoveryCacheControls: string[] = []
    await page.route('**/api/v1/projects/current', async (route) => {
      if (!eventEmitted) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(canonicalRMinusOne) })
        return
      }

      const cacheControl = route.request().headers()['cache-control']
      recoveryCacheControls.push(cacheControl ?? '')
      if (!staleResponseStarted) {
        staleResponseStarted = true
        await staleResponseReleased
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(canonicalRMinusOne) })
        staleResponseCompleted = true
        return
      }

      matchingResponseRequested = true
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(canonicalR) })
    })

    await page.goto(origin)
    await expect(page.getByRole('button', { name: 'Share idea', exact: true })).toBeVisible()
    const initialSnapshotGets = recoveryCacheControls.length

    eventEmitted = true
    await page.evaluate(() => (window as typeof window & { __final37RevisionEvent(): void }).__final37RevisionEvent())
    await expect.poll(() => staleResponseStarted).toBe(true)
    await expect(page.getByRole('button', { name: 'Share idea', exact: true })).toBeHidden()
    await expect(page.getByRole('button', { name: 'Approve blueprint', exact: true })).toBeHidden()

    releaseStaleResponse()
    await expect.poll(() => staleResponseCompleted).toBe(true)
    await expect(page.getByRole('button', { name: 'Share idea', exact: true })).toBeHidden()
    await expect(page.getByRole('button', { name: 'Approve blueprint', exact: true })).toBeHidden()

    await page.evaluate(() => (window as typeof window & { __final37SnapshotRequired(): void }).__final37SnapshotRequired())
    await expect.poll(() => matchingResponseRequested).toBe(true)
    await expect(page.getByRole('button', { name: 'Approve blueprint', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Share idea', exact: true })).toBeHidden()
    assert.equal(initialSnapshotGets, 0, 'the canonical R-1 bootstrap request is not a recovery request')
    assert.ok(recoveryCacheControls.length >= 2, 'event recovery and matching recovery must both be observable requests')
    for (const cacheControl of recoveryCacheControls) assert.match(cacheControl, /no-cache/i, 'canonical recovery fetches must opt out of the browser cache')
  } finally {
    releaseStaleResponse()
    await browser.close()
    await vite.close()
  }
})
