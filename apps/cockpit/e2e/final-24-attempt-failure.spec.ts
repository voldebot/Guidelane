import { expect, test, type TestInfo } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { Buffer } from 'node:buffer'
import { access, chmod, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Orchestrator, createLoopbackServer, launchUrl } from '../../../packages/orchestrator/src/index.ts'
import type { RunFailureCode } from '../../../packages/orchestrator/src/index.ts'

type AttemptFailurePublisher = { publishAttemptFailure(input: { attemptId: string; failureCode: RunFailureCode }): Promise<unknown> }
const projectRoot = fileURLToPath(new URL('../../../', import.meta.url))
const cockpitDist = join(projectRoot, 'apps/cockpit/dist')
const launchEngine = join(projectRoot, 'packages/orchestrator/test-fixtures/final-22-launch-engine.mjs')
async function waitForMarker(path: string): Promise<void> { const deadline = Date.now() + 1_000; while (Date.now() < deadline) { try { await access(path); return } catch { await new Promise((resolvePromise) => setTimeout(resolvePromise, 20)) } } throw new Error('test-owned live engine marker was not observed before failure publication') }

test('CPT-E2E-FINAL-24-A browser loopback projects an attempt-bound G4 failure and exposes only the retry action', async ({ page }, testInfo: TestInfo) => {
  const root = await mkdtemp(join(tmpdir(), 'guidelane-cockpit-final24-'))
  await chmod(root, 0o700)
  const generated = join(root, 'generated')
  const marker = join(root, 'engine.started')
  const token = 'f24a0000000000000000000000000000'
  const orchestrator = await Orchestrator.open({ root, projectId: 'cockpit-final-24', gitHead: '0123456789abcdef0123456789abcdef01234567' })
  let server: Awaited<ReturnType<typeof createLoopbackServer>> | undefined
  const requests: string[] = []; const consoleErrors: string[] = []
  page.on('request', (request) => requests.push(request.url())); page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()) })
  try {
    await mkdir(generated, { mode: 0o700 })
    await chmod(generated, 0o700)
    await orchestrator.command({ type: 'submitIdea', idea: 'attempt-bound browser failure' })
    await orchestrator.command({ type: 'approveBlueprint' })
    await orchestrator.command({ type: 'approvePlan' })
    await orchestrator.command({ type: 'startBuild' })
    const launched = await orchestrator.launchAttempt({ phase: 'build', attemptId: 'browser-final24', command: process.execPath, args: [launchEngine], cwd: generated, env: { PATH: process.env.PATH ?? '', GUIDELANE_FINAL_22_ENGINE_MARKER: marker } })
    await waitForMarker(marker)
    await (orchestrator as Orchestrator & AttemptFailurePublisher).publishAttemptFailure({ attemptId: launched.attemptId, failureCode: 'interrupted' })
    server = await createLoopbackServer({ orchestrator, cockpitRoot: cockpitDist, launchToken: token })
    await page.goto(launchUrl(server.origin, token))
    await expect(page.getByTestId('run-state')).toContainText(/kesildi|interrupted/i)
    await expect(page.getByRole('button', { name: /inşa.*başlat|start build/i })).toHaveCount(1)
    await expect(page.getByText(/failureCode|stderr|engine output|evidence\//i)).toHaveCount(0)
    const body = (await page.locator('body').textContent()) ?? ''; const aria = await page.locator('body').ariaSnapshot(); const axe = await new AxeBuilder({ page }).analyze()
    const screenshot = testInfo.outputPath(`${testInfo.project.name}-${testInfo.title}.png`)
    await page.screenshot({ path: screenshot, fullPage: true }); await testInfo.attach('guidelane-screenshot', { path: screenshot, contentType: 'image/png' })
    await testInfo.attach('guidelane-evidence', { contentType: 'application/json', body: Buffer.from(JSON.stringify({ schemaVersion: 1, scenario: testInfo.title, project: testInfo.project.name, requestLog: { browserRequestCount: requests.length, serverRequestCount: requests.length, boundedServerRequests: requests.slice(0, 32).map((url) => ({ method: 'GET', path: new URL(url).pathname })), sameOrigin: requests.every((url) => url.startsWith(server.origin)), relativeServerPaths: requests.every((url) => new URL(url).pathname.startsWith('/')) }, assertions: { zeroConsoleErrors: consoleErrors.length === 0, forbiddenMaterialAbsent: !/failureCode|stderr|engine output|evidence\//i.test(`${body}\n${aria}`) }, accessibility: { captured: aria.length > 0, characterCount: aria.length }, axe: { completed: true, violationCount: axe.violations.length }, screenshotAttachment: 'guidelane-screenshot' }), 'utf8') })
  } finally {
    await server?.close()
    await orchestrator.reconcile().catch(() => undefined)
    await orchestrator.close()
    await rm(root, { recursive: true, force: true })
  }
})
