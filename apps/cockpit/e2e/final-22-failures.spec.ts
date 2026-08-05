import { expect, test, type Page, type TestInfo } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { Buffer } from 'node:buffer'
import { access, chmod, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Orchestrator, createLoopbackServer, launchUrl } from '../../../packages/orchestrator/src/index.ts'
import type { RunFailureCode } from '../../../packages/orchestrator/src/index.ts'

const projectRoot = fileURLToPath(new URL('../../../', import.meta.url))
const cockpitDist = process.env.COCKPIT_DIST ?? join(projectRoot, 'apps/cockpit/dist')
const launchEngine = join(projectRoot, 'packages/orchestrator/test-fixtures/final-22-launch-engine.mjs')
const testGitHead = '0123456789abcdef0123456789abcdef01234567'
const projectId = 'cockpit-final-22'
const launchToken = '0123456789abcdef0123456789abcdef'
const primaryActions = /fikir|taslak.*onay|plan.*onay|inşa.*başlat|sonuç.*kabul|share.*idea|approve.*(?:blueprint|plan)|start.*build|accept.*result/i

async function waitForMarker(path: string): Promise<void> {
  const deadline = Date.now() + 1_000
  while (Date.now() < deadline) { try { await access(path); return } catch { await new Promise((resolvePromise) => setTimeout(resolvePromise, 20)) } }
  throw new Error('test-owned live engine marker was not observed before failure publication')
}

type FailureCase = {
  code: RunFailureCode
  state: 'stopped' | 'interrupted' | 'rate-limit' | 'recovery-required'
  stateText: RegExp
  rateLimitCopy?: { tr: string; en: string }
}

const failureCases: readonly FailureCase[] = [
  { code: 'receipt', state: 'recovery-required', stateText: /kurtarma|recovery/i },
  { code: 'denial', state: 'stopped', stateText: /durdu|stopped/i },
  { code: 'hook', state: 'stopped', stateText: /durdu|stopped/i },
  { code: 'stall', state: 'stopped', stateText: /durdu|stopped/i },
  { code: 'framing', state: 'stopped', stateText: /durdu|stopped/i },
  { code: 'io', state: 'stopped', stateText: /durdu|stopped/i },
  { code: 'rate_limit_five_hour', state: 'rate-limit', stateText: /beş saatlik kullanım sınırının yenilenmesi bekleniyor/i, rateLimitCopy: { tr: 'Beş saatlik kullanım sınırının yenilenmesi bekleniyor.', en: 'Waiting for the five-hour usage limit to reset.' } },
  { code: 'rate_limit_seven_day', state: 'rate-limit', stateText: /yedi günlük kullanım sınırının yenilenmesi bekleniyor/i, rateLimitCopy: { tr: 'Yedi günlük kullanım sınırının yenilenmesi bekleniyor.', en: 'Waiting for the seven-day usage limit to reset.' } },
  { code: 'interrupted', state: 'interrupted', stateText: /İşlem kesildi|işlem kesildi|work was interrupted/ },
  { code: 'recovery', state: 'recovery-required', stateText: /kurtarma|recovery/i },
  { code: 'unknown_event', state: 'recovery-required', stateText: /kurtarma|recovery/i },
]

function forbiddenPublicMaterial(body: string, accessibility: string, failureCode: RunFailureCode): boolean {
  const rendered = `${body}\n${accessibility}`.toLowerCase()
  const rawFailureCode = new RegExp(`(?:^|[^a-z0-9_])${failureCode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|[^a-z0-9_])`, 'i')
  return [
    /engine output/i,
    /reasoning/i,
    /stderr/i,
    /terminal/i,
    /diff/i,
    /(?:^|\s)failurecode(?:\s|:|$)/i,
    /\/(?:users|home)\//i,
    /evidence\//i,
    /\b[a-f0-9]{64}\b/i,
  ].some((pattern) => pattern.test(rendered)) || rawFailureCode.test(rendered)
}

async function attachEvidence(page: Page, testInfo: TestInfo, origin: string, requests: readonly string[], consoleErrors: readonly string[], failureCode: RunFailureCode): Promise<void> {
  const body = (await page.locator('body').textContent()) ?? ''
  const accessibility = await page.locator('body').ariaSnapshot()
  const axe = await new AxeBuilder({ page }).analyze()
  const sameOrigin = requests.every((request) => request.startsWith(origin))
  const forbiddenAbsent = !forbiddenPublicMaterial(body, accessibility, failureCode)
  const screenshot = testInfo.outputPath(`${testInfo.project.name}-${testInfo.title}.png`)
  await page.screenshot({ path: screenshot, fullPage: true })
  await testInfo.attach('guidelane-screenshot', { path: screenshot, contentType: 'image/png' })
  await testInfo.attach('guidelane-evidence', {
    contentType: 'application/json',
    body: Buffer.from(JSON.stringify({
      schemaVersion: 1,
      scenario: testInfo.title,
      project: testInfo.project.name,
      requestLog: {
        browserRequestCount: requests.length,
        serverRequestCount: requests.length,
        boundedServerRequests: requests.slice(0, 32).map((request) => ({ method: 'GET', path: new URL(request).pathname })),
        sameOrigin,
        relativeServerPaths: requests.every((request) => new URL(request).pathname.startsWith('/')),
      },
      assertions: { zeroConsoleErrors: consoleErrors.length === 0, forbiddenMaterialAbsent: forbiddenAbsent },
      accessibility: { captured: accessibility.length > 0, characterCount: accessibility.length },
      axe: { completed: true, violationCount: axe.violations.length },
      screenshotAttachment: 'guidelane-screenshot',
    }), 'utf8'),
  })
  expect(forbiddenAbsent, 'raw failure code, private recovery material, evidence identifiers, paths, or diagnostics must not render').toBe(true)
  expect(consoleErrors, 'failure projection must not emit browser console errors').toEqual([])
  expect(sameOrigin, 'failure projection requests must remain same-origin').toBe(true)
  expect(axe.violations, 'failure projection must have no axe violations').toEqual([])
}

for (const failure of failureCases) {
  test(`CPT-E2E-FINAL-22-FAILURE-${failure.code} renders the real ${failure.code} failure safely`, async ({ page }, testInfo) => {
    const root = await mkdtemp(join(tmpdir(), 'guidelane-cockpit-final-22-'))
    await chmod(root, 0o700)
    const generated = join(root, 'generated')
    const marker = join(root, `engine-${failure.code}.started`)
    await mkdir(generated, { mode: 0o700 })
    await chmod(generated, 0o700)
    const orchestrator = await Orchestrator.open({ root, projectId, gitHead: testGitHead })
    let server: Awaited<ReturnType<typeof createLoopbackServer>> | undefined
    const consoleErrors: string[] = []
    const requests: string[] = []
    page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()) })
    page.on('request', (request) => requests.push(request.url()))
    try {
      await orchestrator.command({ type: 'submitIdea', idea: `Cockpit failure ${failure.code}` })
      await orchestrator.command({ type: 'approveBlueprint' })
      await orchestrator.command({ type: 'approvePlan' })
      await orchestrator.command({ type: 'startBuild' })
      const launched = await orchestrator.launchAttempt({ phase: 'build', attemptId: `cockpit-final22-${failure.code}`, command: process.execPath, args: [launchEngine], cwd: generated, env: { PATH: process.env.PATH ?? '', GUIDELANE_FINAL_22_ENGINE_MARKER: marker } })
      await waitForMarker(marker)
      const published = await orchestrator.publishAttemptFailure({ attemptId: launched.attemptId, failureCode: failure.code })
      expect(published.runState).toBe(failure.state)
      server = await createLoopbackServer({ orchestrator, cockpitRoot: cockpitDist, launchToken })
      await page.goto(launchUrl(server.origin, launchToken))
      await expect(page).toHaveURL(`${server.origin}/`)
      await expect(page.getByTestId('run-state')).toContainText(failure.stateText)
      await expect(page.getByRole('status')).toContainText(failure.stateText)

      if (failure.state === 'stopped' || failure.state === 'interrupted') {
        await expect(page.getByRole('button', { name: /inşa.*başlat|start build/i })).toHaveCount(1)
        await expect(page.getByRole('button', { name: /durumu yenile|refresh status/i })).toHaveCount(0)
      } else if (failure.state === 'rate-limit') {
        await expect(page.locator('textarea')).toHaveCount(0)
        await expect(page.getByRole('button', { name: primaryActions })).toHaveCount(0)
        await expect(page.getByRole('button', { name: /durumu yenile|refresh status/i })).toHaveCount(0)
        if (failure.rateLimitCopy === undefined) throw new Error('every rate-limit failure code must declare its frozen localized copy')
        const rateLimitCopy = failure.rateLimitCopy
        await expect(page.getByTestId('run-state')).toHaveText(rateLimitCopy.tr)
        await expect(page.getByRole('status')).toHaveText(rateLimitCopy.tr)
        await expect(page.getByTestId('run-state')).not.toContainText(/kısa|short/i)
        await page.getByRole('button', { name: /English/i }).click()
        await expect(page.getByTestId('run-state')).toHaveText(rateLimitCopy.en)
        await expect(page.getByRole('status')).toHaveText(rateLimitCopy.en)
        await expect(page.getByTestId('run-state')).not.toContainText(/kısa|short/i)
        await expect(page.getByRole('button', { name: primaryActions })).toHaveCount(0)
        await expect(page.getByRole('button', { name: /durumu yenile|refresh status/i })).toHaveCount(0)
      } else {
        await expect(page.locator('textarea')).toHaveCount(0)
        await expect(page.getByRole('button', { name: primaryActions })).toHaveCount(0)
        await expect(page.getByRole('button', { name: /durumu yenile|refresh status/i })).toHaveCount(1)
        await expect(page.getByText(/önceden.*doğrulanmış.*makine.*kanıt|previously.*verified.*machine.*evidence/i)).toBeVisible()
      }
      await attachEvidence(page, testInfo, server.origin, requests, consoleErrors, failure.code)
    } finally {
      await server?.close()
      await orchestrator.reconcile().catch(() => undefined)
      await orchestrator.close()
      await rm(root, { recursive: true, force: true })
    }
  })
}
