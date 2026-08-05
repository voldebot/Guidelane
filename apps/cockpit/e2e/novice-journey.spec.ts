import { expect, test, type Locator, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { Buffer } from 'node:buffer'
import { resolve } from 'node:path'
import { createFakeCockpitServer, type FakeCockpitServer, type FakeRunState } from '../test/fake-orchestrator.ts'

const cockpitDist = process.env.COCKPIT_DIST ?? resolve(process.cwd(), 'dist')
const forbidden = ['engine output', ['rea', 'soning'].join(''), ['std', 'err'].join(''), ['term', 'inal'].join(''), ['diff'].join(''), ['gh', 'p_'].join('')]
const homePath = new RegExp(['/', '(?:Users|home)', '/'].join(''))
const pendingAction = /fikir|taslak.*onay|plan.*onay|inşa.*başlat|sonuç.*kabul|share.*idea|approve.*(?:blueprint|plan)|start.*build|accept.*result/i

let server: FakeCockpitServer
let consoleErrors: string[]
let browserRequests: string[]

test.beforeEach(async ({ page }) => {
  server = await createFakeCockpitServer(cockpitDist)
  consoleErrors = []
  browserRequests = []
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()) })
  page.on('request', (request) => browserRequests.push(request.url()))
})

test.afterEach(async ({ page }, testInfo) => {
  const body = await page.locator('body').textContent().catch(() => '')
  const accessibility = await page.locator('body').ariaSnapshot().catch(() => '')
  const bodyText = body ?? ''
  const forbiddenAbsent = forbidden.every((value) => !bodyText.toLowerCase().includes(value) && !accessibility.toLowerCase().includes(value)) && !homePath.test(bodyText) && !homePath.test(accessibility)
  const allBrowserRequestsSameOrigin = browserRequests.every((request) => request.startsWith(server.origin))
  const allServerPathsRelative = server.requests().every((request) => request.path.startsWith('/'))
  const axe = await new AxeBuilder({ page }).analyze()
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
        browserRequestCount: browserRequests.length,
        serverRequestCount: server.requests().length,
        boundedServerRequests: server.requests().slice(0, 32).map((request) => ({ method: request.method, path: request.path })),
        sameOrigin: allBrowserRequestsSameOrigin,
        relativeServerPaths: allServerPathsRelative,
      },
      assertions: {
        zeroConsoleErrors: consoleErrors.length === 0,
        forbiddenMaterialAbsent: forbiddenAbsent,
      },
      accessibility: { captured: accessibility.length > 0, characterCount: accessibility.length },
      axe: { completed: true, violationCount: axe.violations.length },
      screenshotAttachment: 'guidelane-screenshot',
    }), 'utf8'),
  })
  expect(forbiddenAbsent, 'forbidden material must be absent from body and accessibility output').toBe(true)
  expect(consoleErrors, 'every scenario must have zero console errors').toEqual([])
  expect(allBrowserRequestsSameOrigin, 'browser requests must remain same-origin').toBe(true)
  expect(allServerPathsRelative, 'server request paths must be relative').toBe(true)
  expect(axe.violations, 'axe must report no accessibility violations').toEqual([])
  await server.close()
})

async function open(page: Page): Promise<void> {
  await page.goto(`${server.origin}/#launchToken=${server.launchToken}`)
  await expect(page).toHaveURL(`${server.origin}/`)
  expect(server.requests().some((request) => request.path === '/api/v1/session' && request.method === 'POST')).toBe(true)
  await expect(page.getByRole('heading', { level: 1 })).toContainText(/Guidelane|Güvenli/i)
}

const snapshotRequests = (): number => server.requests().filter((request) => request.path === '/api/v1/projects/current' && request.method === 'GET').length

test('CPT-E2E-REDACTION-02 unsafe WebSocket material never renders and instead reloads the canonical snapshot', async ({ page }) => {
  await open(page)
  await expect.poll(() => server.requests().filter((request) => request.path === '/api/v1/events' && request.method === 'WS').length).toBe(1)

  let snapshots = snapshotRequests()
  for (const message of [
    './private/project.ts',
    'C:\\Users\\alice\\private\\project.ts',
    'ENOENT: no such file or directory, open private/project.ts',
    'Error: engine failed\n    at runBuild (src/build.ts:14:3)',
  ]) {
    server.emitWebSocketEvent({ type: 'phase_update', revision: 1, message })
    await expect.poll(snapshotRequests).toBeGreaterThan(snapshots)
    snapshots = snapshotRequests()
    expect(await page.locator('body').textContent()).not.toContain(message)
    expect(await page.locator('body').ariaSnapshot()).not.toContain(message)
    await expect(page.getByTestId('run-state')).toContainText(/başlamaya hazırsınız|ready to begin/i)
  }
})

test('CPT-E2E-LAUNCH-04 exchanges a fragment token once, removes it, stays same-origin, and starts from the canonical snapshot', async ({ page }) => {
  const launch = `${server.origin}/#launchToken=${server.launchToken}`
  await page.goto(launch)
  await expect(page).toHaveURL(`${server.origin}/`)
  await expect(page.getByRole('heading', { level: 1 })).toContainText(/Guidelane|Güvenli/i)
  await expect.poll(() => server.requests().filter((request) => request.path === '/api/v1/events' && request.method === 'WS').length).toBe(1)

  const requests = server.requests()
  const sessionIndex = requests.findIndex((request) => request.path === '/api/v1/session' && request.method === 'POST')
  const snapshotIndex = requests.findIndex((request) => request.path === '/api/v1/projects/current' && request.method === 'GET')
  const socketIndex = requests.findIndex((request) => request.path === '/api/v1/events' && request.method === 'WS')
  expect(requests.filter((request) => request.path === '/api/v1/session' && request.method === 'POST')).toHaveLength(1)
  assertOrder(sessionIndex, snapshotIndex, socketIndex)
  expect(browserRequests.some((request) => request.includes(server.launchToken))).toBe(false)
  for (const request of browserRequests) expect(request.startsWith(server.origin)).toBe(true)
  for (const request of requests) expect(request.host).toBe(new URL(server.origin).host)
  await expect(page.getByTestId('run-state')).toContainText(/başlamaya hazırsınız|ready to begin/i)
})

function assertOrder(sessionIndex: number, snapshotIndex: number, socketIndex: number): void {
  expect(sessionIndex).toBeGreaterThanOrEqual(0)
  expect(snapshotIndex).toBeGreaterThan(sessionIndex)
  expect(socketIndex).toBeGreaterThan(snapshotIndex)
}

test('CPT-E2E-G0-G6 Turkish novice journey uses semantic activity and canonical reopen', async ({ page }) => {
  await open(page)
  await expect(page.getByRole('button', { name: /fikir/i })).toBeVisible()
  await page.getByRole('button', { name: /fikir/i }).press('Enter')
  await expect(page.getByRole('heading', { level: 1 })).toBeFocused()
  await page.getByRole('button', { name: /taslak.*onay/i }).click()
  await page.getByRole('button', { name: /plan.*onay/i }).click()
  await page.getByRole('button', { name: /inşa.*başlat/i }).click()
  await expect(page.getByRole('status')).toContainText(/ilerliyor|kontrol/i)
  expect(server.requests().some((request) => request.path === '/api/v1/events' && request.method === 'WS')).toBe(true)
  await expect(page.getByRole('button', { name: /sonuç.*kabul/i })).toBeVisible()
  expect(server.snapshot().gates).toEqual([
    'lint', 'type', 'unit', 'build', 'boot', 'axe', 'smoke',
  ].map((name) => expect.objectContaining({
    name,
    status: 'passed',
    authority: 'machine',
    verified: true,
  })))
  await page.getByRole('button', { name: /sonuç.*kabul/i }).click()
  await expect(page.getByText(/kabul edildi/i)).toBeVisible()
  const snapshotsBefore = server.requests().filter((request) => request.path === '/api/v1/projects/current').length
  server.setRunState('recovery-required')
  await page.reload()
  await expect(page.getByTestId('run-state')).toContainText(/kurtarma|recovery/i)
  expect(server.requests().filter((request) => request.path === '/api/v1/projects/current').length).toBeGreaterThan(snapshotsBefore)
  expect(server.snapshot().stage).toBe('G6')
})

test('CPT-E2E-I18N-05 Turkish defaults and English switch preserves the canonical state', async ({ page }) => {
  await open(page)
  await expect(page.getByText(/Türkçe/i)).toBeVisible()
  await page.getByRole('button', { name: /English/i }).click()
  await expect(page.getByRole('button', { name: /share.*idea/i })).toBeVisible()
  await expect(page.getByRole('status')).toBeVisible()
})

test('CPT-E2E-FINAL-27-I18N-ACTIVITY-20 localizes an existing semantic activity after switching from Turkish to English', async ({ page }) => {
  await open(page)
  await page.getByRole('button', { name: /fikir/i }).click()
  await expect(page.getByRole('status')).toHaveText('Taslak hazır; onayınızı bekliyor.')

  await page.getByRole('button', { name: /English/i }).click()
  await expect(page.getByRole('status')).toHaveText(/blueprint.*awaiting.*approval/i)
  await expect(page.getByRole('status')).not.toContainText(/Taslak hazır|onayınızı bekliyor/i)
})

test('CPT-E2E-FINAL-27-GATE-PURPOSES-21 presents every public machine gate with a distinct localized purpose and clear mixed state', async ({ page }) => {
  let snapshot = {
    schemaVersion: 1,
    projectId: 'cockpit-novice',
    revision: 27,
    stage: 'G5',
    runState: 'waiting' as const,
    language: 'tr' as const,
    blueprintRevision: 1,
    pendingDecision: 'acceptResult',
    gates: [
      { name: 'lint', status: 'passed', authority: 'machine' as const, verified: true },
      { name: 'type', status: 'failed', authority: 'machine' as const, verified: false },
      { name: 'unit', status: 'pending', authority: 'machine' as const, verified: false },
      { name: 'build', status: 'running', authority: 'machine' as const, verified: false },
      { name: 'boot', status: 'blocked', authority: 'machine' as const, verified: false },
      { name: 'axe', status: 'needs_user', authority: 'machine' as const, verified: false },
      { name: 'smoke', status: 'passed', authority: 'machine' as const, verified: true },
    ],
  }
  await page.route('**/api/v1/projects/current', async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(snapshot) })
  })
  await open(page)

  const rows = page.locator('.evidence dl > div')
  const gatePurposePatterns = {
    tr: [/yazım|düzen/i, /tür|uyumluluk/i, /davranış|işlev/i, /kurul|oluştur/i, /açıl|başla/i, /erişilebilir/i, /temel kullanım|kullanım denetimi/i],
    en: [/style|format/i, /type|compatib/i, /behavio[u]?r|function/i, /build|assembl/i, /start|open/i, /accessib/i, /basic use|use check/i],
  } as const
  const gateStatePatterns = {
    tr: [/kontrol geçti/i, /kontrol başarısız oldu/i, /kontrol bekliyor/i, /kontrol sürüyor/i, /kontrol engellendi/i, /sizin işleminiz gerekiyor/i, /kontrol geçti/i],
    en: [/gate passed/i, /gate failed/i, /gate is pending/i, /gate is running/i, /gate is blocked/i, /gate needs user action/i, /gate passed/i],
  } as const
  const forbidden = /(?:^|[^a-z])(lint|type|unit|build|boot|axe|smoke)(?:$|[^a-z])|\/(?:Users|home)\/|\bdiff\b|\bcommand\b/i

  await expect(rows).toHaveCount(7)
  for (const [index, purpose] of gatePurposePatterns.tr.entries()) {
    await expect(rows.nth(index).locator('dt')).toHaveText(purpose)
    await expect(rows.nth(index).locator('dd')).toHaveText(gateStatePatterns.tr[index])
  }
  const turkishPurposes = await rows.locator('dt').allTextContents()
  expect(new Set(turkishPurposes).size).toBe(7)
  expect((await rows.allTextContents()).join('\n')).not.toMatch(forbidden)

  await page.getByRole('button', { name: /English/i }).click()
  for (const [index, purpose] of gatePurposePatterns.en.entries()) {
    await expect(rows.nth(index).locator('dt')).toHaveText(purpose)
    await expect(rows.nth(index).locator('dd')).toHaveText(gateStatePatterns.en[index])
  }
  const englishPurposes = await rows.locator('dt').allTextContents()
  expect(new Set(englishPurposes).size).toBe(7)
  expect((await rows.allTextContents()).join('\n')).not.toMatch(forbidden)
})

test('CPT-E2E-GATES-17 each gate card renders its own state rather than the overall run state', async ({ page }) => {
  let snapshot = {
    schemaVersion: 1,
    projectId: 'cockpit-novice',
    revision: 8,
    stage: 'G5',
    runState: 'waiting',
    language: 'en',
    blueprintRevision: 1,
    pendingDecision: 'acceptResult',
    gates: [
      { name: 'lint', status: 'failed', authority: 'machine', verified: false },
      { name: 'review', status: 'blocked', authority: 'isolated_review', verified: false },
      { name: 'approval', status: 'needs_user', authority: 'user', verified: false },
      { name: 'test', status: 'pending', authority: 'machine', verified: false },
      { name: 'build', status: 'running', authority: 'machine', verified: false },
    ],
  }
  await page.route('**/api/v1/projects/current', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(snapshot),
    })
  })
  await open(page)
  const cards = page.locator('.evidence dl > div')
  await expect(cards).toHaveCount(5)
  for (const [index, expected] of ['failed', 'blocked', 'needs user', 'pending', 'running'].entries()) {
    await expect(cards.nth(index)).toContainText(new RegExp(expected, 'i'))
  }

  const disqualifyingGateSets = [
    { language: 'en', gates: [] },
    { language: 'tr', gates: [{ name: 'lint', status: 'passed', authority: 'machine', verified: true }, { name: 'type', status: 'pending', authority: 'machine', verified: false }] },
    { language: 'en', gates: [{ name: 'approval', status: 'passed', authority: 'user', verified: false }] },
    ...(['pending', 'running', 'failed', 'blocked', 'needs_user'] as const).map((status) => ({ language: status === 'blocked' ? 'tr' : 'en', gates: [{ name: 'build', status, authority: 'machine', verified: false }] })),
    { language: 'tr', gates: [{ name: 'build', status: 'passed', authority: 'machine', verified: false }] },
    { language: 'en', gates: [{ name: 'build', status: 'passed', authority: 'machine', verified: false }] },
  ]
  for (const [index, candidate] of disqualifyingGateSets.entries()) {
    snapshot = { ...snapshot, revision: 9 + index, language: candidate.language, gates: candidate.gates }
    await page.reload()
    await expect(page.locator('#evidence-heading')).not.toHaveText(/^(?:Makine kontrolü doğrulandı\.|Machine check verified\.)$/)
  }
})

const stateCases: readonly FakeRunState[] = ['running', 'waiting', 'retrying', 'stopped', 'interrupted', 'needs-user', 'rate-limit', 'recovery-required']
for (const state of stateCases) {
  test(`CPT-E2E-STATE-${state} has text, not color-only, novice status`, async ({ page }) => {
    server.setRunState(state)
    await open(page)
    await expect(page.getByTestId('run-state')).toContainText(/.+/)
    await expect(page.getByRole('status')).toContainText(/.+/)
  })
}

for (const state of ['running', 'retrying'] as const) {
  test(`CPT-E2E-WAIT-${state}-14 running work is wait-only and has no stale decision control`, async ({ page }) => {
    server.setRunState(state)
    await open(page)
    await expect(page.getByRole('status')).toContainText(/[İi]lerliyor|bekleniyor|tekrar.*deneniyor|yeniden|wait|progress|retry/i)
    await expect(page.locator('textarea')).toHaveCount(0)
    await expect(page.getByRole('button', { name: pendingAction })).toHaveCount(0)
  })
}

test('CPT-E2E-RECOVERY-15 recovery replaces stale decisions with one refresh action and labels prior evidence honestly', async ({ page }) => {
  server.setRunState('recovery-required')
  await open(page)
  await expect(page.getByRole('status')).toContainText(/(?:mevcut|güncel).*durum.*(?:yenileniyor|yeniden.*alın)|current.*state.*refreshing/i)
  await expect(page.locator('textarea')).toHaveCount(0)
  await expect(page.getByRole('button', { name: pendingAction })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /durumu yenile|refresh status/i })).toHaveCount(1)
  await expect(page.getByText(/önceden.*doğrulanmış.*makine.*kanıt|previously.*verified.*machine.*evidence/i)).toBeVisible()
  await expect(page.getByText(/^Makine kontrolü doğrulandı$/)).toHaveCount(0)
  await expect(page.getByText(/^Machine check verified$/)).toHaveCount(0)
})

test('CPT-E2E-RECOVERY-EN-16 English recovery keeps one refresh action and separates previous evidence from current state', async ({ page }) => {
  server.setRunState('recovery-required')
  await open(page)
  await page.getByRole('button', { name: /English/i }).click()
  await expect(page.getByRole('status')).toContainText(/current.*state.*refreshing|getting.*current.*state.*again/i)
  await expect(page.locator('textarea')).toHaveCount(0)
  await expect(page.getByRole('button', { name: pendingAction })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /refresh status/i })).toHaveCount(1)
  await expect(page.getByText(/previously.*verified.*machine.*evidence/i)).toBeVisible()
  await expect(page.getByText(/^Machine check verified$/)).toHaveCount(0)
})

test('CPT-E2E-A11Y-13 keyboard order and axe are clean at the desktop support floor', async ({ page }) => {
  await open(page)
  await page.keyboard.press('Tab')
  await expect(page.locator(':focus')).toBeVisible()
  const results = await new AxeBuilder({ page }).analyze()
  expect(results.violations).toEqual([])
})

const keyboardLanguages = [
  {
    id: 'TR',
    language: 'tr' as const,
    idea: /fikriniz/i,
    submit: /fikir paylaş/i,
    approve: /taslak.*onay/i,
    refresh: /durumu yenile/i,
    secondary: /türkçe.*english/i,
    evidence: /makine kontrolü doğrulanmayı bekliyor/i,
  },
  {
    id: 'EN',
    language: 'en' as const,
    idea: /your idea/i,
    submit: /share idea/i,
    approve: /approve blueprint/i,
    refresh: /refresh status/i,
    secondary: /english.*türkçe/i,
    evidence: /machine check is awaiting verification/i,
  },
] as const

const keyboardDecisionStates = [
  { id: 'IDEA', pendingDecision: 'submitIdea' as const, runState: 'idle' as const, hasIdeaField: true },
  { id: 'APPROVAL', pendingDecision: 'approveBlueprint' as const, runState: 'waiting' as const, hasIdeaField: false },
] as const

const keyboardSnapshot = (language: 'tr' | 'en', pendingDecision: 'submitIdea' | 'approveBlueprint' | null, runState: 'idle' | 'waiting' | 'recovery-required') => ({
  schemaVersion: 1,
  projectId: 'cockpit-novice',
  revision: 29,
  stage: runState === 'recovery-required' ? 'G5' : pendingDecision === 'approveBlueprint' ? 'G1' : 'G0',
  runState,
  language,
  blueprintRevision: pendingDecision === 'approveBlueprint' ? 1 : 0,
  pendingDecision,
  gates: runState === 'recovery-required'
    ? [{ name: 'lint', status: 'passed', authority: 'machine', verified: true }]
    : [],
})

async function openKeyboardSnapshot(page: Page, snapshot: ReturnType<typeof keyboardSnapshot>): Promise<void> {
  await page.route('**/api/v1/projects/current', async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(snapshot) })
  })
  await open(page)
  await expect(page.getByRole('heading', { level: 1 })).toBeFocused()
}

async function beginSequentialKeyboardNavigation(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.body.tabIndex = -1
    document.body.focus()
  })
  await expect(page.locator('body')).toBeFocused()
}

async function expectVisibleFocus(control: ReturnType<Page['getByRole']>): Promise<void> {
  await expect(control).toBeVisible()
  await expect(control).toBeFocused()
  await expect(control).toHaveCSS('outline-width', '3px')
}

async function expectDecisionEvidenceSecondaryDomOrder(
  decisionControl: ReturnType<Page['getByRole']>,
  evidence: ReturnType<Page['getByRole']>,
  secondaryControl: ReturnType<Page['getByRole']>,
): Promise<void> {
  await expect(decisionControl).toHaveJSProperty('tabIndex', 0)
  await expect(secondaryControl).toHaveJSProperty('tabIndex', 0)
  const decisionElement = await decisionControl.elementHandle()
  const evidenceElement = await evidence.elementHandle()
  const secondaryElement = await secondaryControl.elementHandle()
  if (!decisionElement || !evidenceElement || !secondaryElement) throw new Error('keyboard contract controls must be rendered')
  await expect(evidence).toHaveJSProperty('tabIndex', -1)
  expect(await decisionControl.evaluate((control, evidenceElement) => Boolean(control.compareDocumentPosition(evidenceElement) & Node.DOCUMENT_POSITION_FOLLOWING), evidenceElement)).toBe(true)
  expect(await evidence.evaluate((evidenceElement, secondaryElement) => Boolean(evidenceElement.compareDocumentPosition(secondaryElement) & Node.DOCUMENT_POSITION_FOLLOWING), secondaryElement)).toBe(true)
}

async function assertDecisionKeyboardContract(
  page: Page,
  locale: (typeof keyboardLanguages)[number],
  decisionState: (typeof keyboardDecisionStates)[number],
): Promise<void> {
  await openKeyboardSnapshot(page, keyboardSnapshot(locale.language, decisionState.pendingDecision, decisionState.runState))

  const idea = page.getByRole('textbox', { name: locale.idea })
  const submit = page.getByRole('button', { name: locale.submit })
  const approve = page.getByRole('button', { name: locale.approve })
  const decision = decisionState.hasIdeaField ? submit : approve
  const evidence = page.getByRole('heading', { name: locale.evidence })
  const secondary = page.getByRole('button', { name: locale.secondary })
  await beginSequentialKeyboardNavigation(page)
  await page.keyboard.press('Tab')
  if (decisionState.hasIdeaField) {
    await expectVisibleFocus(idea)
    await page.keyboard.press('Tab')
  }
  await expectVisibleFocus(decision)
  await page.keyboard.press('Tab')
  await expectVisibleFocus(secondary)
  await expectDecisionEvidenceSecondaryDomOrder(decision, evidence, secondary)
}

async function assertRecoveryKeyboardContract(page: Page, locale: (typeof keyboardLanguages)[number]): Promise<void> {
  await openKeyboardSnapshot(page, keyboardSnapshot(locale.language, null, 'recovery-required'))

  const refresh = page.getByRole('button', { name: locale.refresh })
  const evidence = page.getByRole('heading', { name: /önceden.*doğrulanmış.*makine.*kanıt|previously.*verified.*machine.*evidence/i })
  const secondary = page.getByRole('button', { name: locale.secondary })
  await beginSequentialKeyboardNavigation(page)
  await page.keyboard.press('Tab')
  await expectVisibleFocus(refresh)
  await page.keyboard.press('Tab')
  await expectVisibleFocus(secondary)
  await expectDecisionEvidenceSecondaryDomOrder(refresh, evidence, secondary)
}

test('CPT-E2E-FINAL-29-TAB-DECISION-IDEA-TR reaches the current decision before the secondary language control at every supported Chromium desktop viewport', async ({ page }) => {
  await assertDecisionKeyboardContract(page, keyboardLanguages[0], keyboardDecisionStates[0])
})

test('CPT-E2E-FINAL-29-TAB-DECISION-IDEA-EN reaches the current decision before the secondary language control at every supported Chromium desktop viewport', async ({ page }) => {
  await assertDecisionKeyboardContract(page, keyboardLanguages[1], keyboardDecisionStates[0])
})

test('CPT-E2E-FINAL-29-TAB-DECISION-APPROVAL-TR reaches the current decision before the secondary language control at every supported Chromium desktop viewport', async ({ page }) => {
  await assertDecisionKeyboardContract(page, keyboardLanguages[0], keyboardDecisionStates[1])
})

test('CPT-E2E-FINAL-29-TAB-DECISION-APPROVAL-EN reaches the current decision before the secondary language control at every supported Chromium desktop viewport', async ({ page }) => {
  await assertDecisionKeyboardContract(page, keyboardLanguages[1], keyboardDecisionStates[1])
})

test('CPT-E2E-FINAL-29-TAB-RECOVERY-TR reaches refresh before the secondary language control at every supported Chromium desktop viewport', async ({ page }) => {
  await assertRecoveryKeyboardContract(page, keyboardLanguages[0])
})

test('CPT-E2E-FINAL-29-TAB-RECOVERY-EN reaches refresh before the secondary language control at every supported Chromium desktop viewport', async ({ page }) => {
  await assertRecoveryKeyboardContract(page, keyboardLanguages[1])
})

type LayoutBox = { x: number; y: number; width: number; height: number }

const overlaps = (first: LayoutBox, second: LayoutBox): boolean => first.x < second.x + second.width
  && first.x + first.width > second.x
  && first.y < second.y + second.height
  && first.y + first.height > second.y

async function assertPersistentRailLayout(page: Page, currentDecisionControls: readonly Locator[], secondary: Locator): Promise<void> {
  const viewport = page.viewportSize()
  if (!viewport) throw new Error('desktop viewport is required for the cockpit layout contract')
  const rail = page.locator('.rail')
  const main = page.locator('main')
  const [railBox, mainBox, languageBox] = await Promise.all([rail.boundingBox(), main.boundingBox(), secondary.boundingBox()])
  if (!railBox || !mainBox || !languageBox) throw new Error('persistent cockpit layout regions must be rendered')

  await expect(rail).toBeVisible()
  await expect(main).toBeVisible()
  await expect(secondary).toBeVisible()
  expect(railBox.x).toBe(0)
  expect(railBox.y).toBe(0)
  expect(railBox.width).toBeGreaterThanOrEqual(250)
  expect(railBox.width).toBeLessThanOrEqual(274)
  expect(railBox.height).toBeGreaterThanOrEqual(viewport.height - 1)
  expect(mainBox.x).toBeGreaterThanOrEqual(railBox.x + railBox.width - 1)
  expect(mainBox.y).toBeLessThanOrEqual(1)
  expect(languageBox.x).toBeGreaterThanOrEqual(railBox.x)
  expect(languageBox.x + languageBox.width).toBeLessThanOrEqual(railBox.x + railBox.width)
  expect(languageBox.y).toBeGreaterThanOrEqual(railBox.y + railBox.height - 180)
  expect(languageBox.y + languageBox.height).toBeLessThanOrEqual(railBox.y + railBox.height)
  expect(overlaps(railBox, mainBox)).toBe(false)
  expect(overlaps(mainBox, languageBox)).toBe(false)

  for (const control of currentDecisionControls) {
    await expect(control).toBeVisible()
    const controlBox = await control.boundingBox()
    if (!controlBox) throw new Error('the current decision control must be rendered')
    expect(controlBox.x).toBeGreaterThanOrEqual(mainBox.x)
    expect(controlBox.y).toBeGreaterThanOrEqual(0)
    expect(controlBox.x + controlBox.width).toBeLessThanOrEqual(viewport.width)
    expect(controlBox.y + controlBox.height).toBeLessThanOrEqual(viewport.height)
    expect(overlaps(railBox, controlBox)).toBe(false)
    expect(overlaps(languageBox, controlBox)).toBe(false)
  }
}

async function assertIdeaRailLayout(page: Page, locale: (typeof keyboardLanguages)[number]): Promise<void> {
  await openKeyboardSnapshot(page, keyboardSnapshot(locale.language, 'submitIdea', 'idle'))
  const idea = page.getByRole('textbox', { name: locale.idea })
  const submit = page.getByRole('button', { name: locale.submit })
  const evidence = page.getByRole('heading', { name: locale.evidence })
  const secondary = page.getByRole('button', { name: locale.secondary })
  await assertPersistentRailLayout(page, [idea, submit], secondary)
  await beginSequentialKeyboardNavigation(page)
  await page.keyboard.press('Tab')
  await expectVisibleFocus(idea)
  await page.keyboard.press('Tab')
  await expectVisibleFocus(submit)
  await page.keyboard.press('Tab')
  await expectVisibleFocus(secondary)
  await expectDecisionEvidenceSecondaryDomOrder(submit, evidence, secondary)
}

async function assertRecoveryRailLayout(page: Page, locale: (typeof keyboardLanguages)[number]): Promise<void> {
  await openKeyboardSnapshot(page, keyboardSnapshot(locale.language, null, 'recovery-required'))
  const refresh = page.getByRole('button', { name: locale.refresh })
  const evidence = page.getByRole('heading', { name: /önceden.*doğrulanmış.*makine.*kanıt|previously.*verified.*machine.*evidence/i })
  const secondary = page.getByRole('button', { name: locale.secondary })
  await assertPersistentRailLayout(page, [refresh], secondary)
  await beginSequentialKeyboardNavigation(page)
  await page.keyboard.press('Tab')
  await expectVisibleFocus(refresh)
  await page.keyboard.press('Tab')
  await expectVisibleFocus(secondary)
  await expectDecisionEvidenceSecondaryDomOrder(refresh, evidence, secondary)
}

test('CPT-E2E-FINAL-30-LAYOUT-IDEA-TR keeps the persistent rail left and the current decision visible', async ({ page }) => {
  await assertIdeaRailLayout(page, keyboardLanguages[0])
})

test('CPT-E2E-FINAL-30-LAYOUT-IDEA-EN keeps the persistent rail left and the current decision visible', async ({ page }) => {
  await assertIdeaRailLayout(page, keyboardLanguages[1])
})

test('CPT-E2E-FINAL-30-LAYOUT-RECOVERY-TR keeps the persistent rail left and refresh visible', async ({ page }) => {
  await assertRecoveryRailLayout(page, keyboardLanguages[0])
})

test('CPT-E2E-FINAL-30-LAYOUT-RECOVERY-EN keeps the persistent rail left and refresh visible', async ({ page }) => {
  await assertRecoveryRailLayout(page, keyboardLanguages[1])
})
