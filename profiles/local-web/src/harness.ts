import { createHash, randomBytes } from 'node:crypto'
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer, type AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ChildProcess } from 'node:child_process'
import {
  createPendingAttemptAuthority,
  evaluateAttemptAuthority,
  finalizeAttemptAuthority,
  stageAttemptCandidate,
  writeTerminalAttemptResult,
} from './attempt-authority.ts'
import { generateProject } from './generator.ts'
import { evidenceIdentity, redactedFailureCode, writeEvidence } from './evidence.ts'
import { runNpmCommand, runNpmScript, startPersistentCommand, stopCommand, verifiedProcessReceipt, waitForExit } from './command.ts'
import type { CleanupResult, ProcessReceipt } from './command.ts'
import { GATE_IDS } from './types.ts'
import type { AttemptAuthoritySummary, CommandResult, GateId, GateEvidence, HarnessSummary, MutationRecipe, SeedEvidence } from './types.ts'

const INSTALL_TIMEOUT_MS = 300_000
const BUILD_TIMEOUT_MS = 180_000
const GATE_TIMEOUT_MS = 120_000
const SERVER_START_TIMEOUT_MS = 30_000
const SERVER_STOP_TIMEOUT_MS = 3_000
const GATE_COMMANDS: Record<GateId, string> = {
  lint: 'npm run lint',
  type: 'npm run typecheck',
  unit: 'npm run unit',
  build: 'npm run build',
  boot: 'npm run start + npm run health',
  axe: 'npm run axe',
  smoke: 'npm run smoke',
}

type SimpleGateId = Exclude<GateId, 'boot'>

const SIMPLE_GATE_SCRIPTS: Record<SimpleGateId, string> = {
  lint: 'lint',
  type: 'typecheck',
  unit: 'unit',
  build: 'build',
  axe: 'axe',
  smoke: 'smoke',
}

interface LiveServer {
  child: ChildProcess
  baseUrl: string
  port: number
  bootInstanceNonce: string
  receipt: ProcessReceipt
}

interface NormalHarnessTestOptions {
  testLifecycleObserver: {
    port: number
    onLiveServerReady: (server: Pick<LiveServer, 'baseUrl' | 'port' | 'bootInstanceNonce' | 'receipt'>) => void | Promise<void>
  }
  // This deliberately remains an in-memory-only narrow seam for independent
  // lease tests. It is neither a profile entry-point option nor evidence data.
  testFaults?: {
    failBootEvidencePersistence?: true
    attemptAuthority?: {
      currentAttempt: {
        attemptId: string
        candidateDigest: string
        resultIdentity: string
      }
      afterCandidate: 'force-terminal-authority-failure'
    }
  }
}

interface LiveServerStart {
  ready: boolean
  result: CommandResult
  server?: LiveServer
}

interface GateRun {
  evidence: GateEvidence
  childProcessesReaped: boolean
  server?: LiveServer
  cleanup?: HarnessSummary['cleanup']
}

interface CurrentAttempt extends AttemptAuthoritySummary {
  candidateStaged: boolean
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function childHasExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function selectLoopbackPort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen({ host: '127.0.0.1', port: 0 }, () => resolve())
  })
  const address = server.address() as AddressInfo | null
  const port = address?.port
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
  })
  if (!port) throw new Error('loopback port allocation failed')
  return port
}

function buildGateEvidence(gate: GateId, result: GateEvidence['result']): GateEvidence {
  const status = result.exitCode === 0 && !result.timedOut && result.childProcessesReaped ? 'passed' : 'failed'
  return {
    schemaVersion: 1,
    kind: 'guidelane.local-web.gate',
    identity: evidenceIdentity(`gate-${gate}`),
    gate,
    status,
    command: GATE_COMMANDS[gate],
    result,
    artifactPaths: [`gates/${gate}.json`],
    ...(status === 'passed' ? {} : { failureCode: redactedFailureCode(gate, result) }),
  }
}

async function writeGateEvidence(artifacts: string, gate: GateId, result: GateEvidence['result']): Promise<GateEvidence> {
  const evidence = buildGateEvidence(gate, result)
  await writeEvidence(artifacts, `gates/${gate}.json`, evidence)
  return evidence
}

async function runSimpleGate(
  project: string,
  gate: SimpleGateId,
  artifacts: string,
  environment: Record<string, string> = {},
  timeoutMs = GATE_TIMEOUT_MS,
  server?: LiveServer,
): Promise<GateRun> {
  let result = await runNpmScript(project, SIMPLE_GATE_SCRIPTS[gate], environment, timeoutMs)
  if (server && childHasExited(server.child)) result = invalidateResultForExitedServer(result, server)
  return {
    evidence: await writeGateEvidence(artifacts, gate, result),
    childProcessesReaped: result.childProcessesReaped,
  }
}

function invalidateResultForExitedServer(result: CommandResult, server: LiveServer): CommandResult {
  if (!childHasExited(server.child)) return result
  return {
    ...result,
    exitCode: result.exitCode === 0 ? 1 : result.exitCode,
    signal: result.signal ?? server.child.signalCode,
  }
}

async function startLiveServer(project: string, port: number): Promise<LiveServerStart> {
  const started = Date.now()
  const bootInstanceNonce = randomBytes(32).toString('hex')
  const child = startPersistentCommand(project, 'npm', ['run', 'start'], {
    PORT: String(port),
    NEXT_TELEMETRY_DISABLED: '1',
    BOOT_INSTANCE_NONCE: bootInstanceNonce,
  })
  const baseUrl = `http://127.0.0.1:${port}`
  const deadline = Date.now() + SERVER_START_TIMEOUT_MS
  let ready = false
  while (Date.now() < deadline && !childHasExited(child)) {
    try {
      const response = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(750) })
      if (response.ok) {
        const body = await response.json() as { ok?: unknown; service?: unknown; bootInstanceNonce?: unknown }
        ready = body.ok === true
          && body.service === 'local-web'
          && body.bootInstanceNonce === bootInstanceNonce
        if (ready && !childHasExited(child)) break
      } else {
        await response.arrayBuffer()
      }
    } catch {
      // The generated Next server may need several bounded polling attempts.
    }
    await delay(50)
  }

  if (!ready) {
    const waitResult = await waitForExit(child, SERVER_STOP_TIMEOUT_MS)
    const cleanup = await stopCommand(child, SERVER_STOP_TIMEOUT_MS)
    return {
      ready: false,
      result: {
        command: 'npm',
        args: ['run', 'start'],
        exitCode: child.exitCode,
        signal: child.signalCode,
        timedOut: waitResult.timedOut || Date.now() >= deadline || !cleanup.childProcessesReaped,
        durationMs: Date.now() - started,
        childProcessesReaped: cleanup.childProcessesReaped,
      },
    }
  }

  const receipt = await verifiedProcessReceipt(child)
  if (!receipt) {
    const cleanup = await stopCommand(child, SERVER_STOP_TIMEOUT_MS)
    return {
      ready: false,
      result: {
        command: 'npm', args: ['run', 'start'], exitCode: child.exitCode, signal: child.signalCode,
        timedOut: true, durationMs: Date.now() - started, childProcessesReaped: cleanup.childProcessesReaped,
      },
    }
  }

  return {
    ready: true,
    result: {
      command: 'npm',
      args: ['run', 'start'],
      exitCode: null,
      signal: null,
      timedOut: false,
      durationMs: Date.now() - started,
      childProcessesReaped: false,
    },
    server: { child, baseUrl, port, bootInstanceNonce, receipt },
  }
}

async function stopLiveServer(server: LiveServer): Promise<CleanupResult> {
  return stopCommand(server.child, SERVER_STOP_TIMEOUT_MS)
}

function failedBootResult(result: CommandResult): CommandResult {
  return {
    ...result,
    exitCode: result.exitCode === null || result.exitCode === 0 ? 1 : result.exitCode,
    signal: null,
  }
}

function validAttemptId(value: string): boolean {
  return /^[a-z][a-z0-9-]{7,127}$/.test(value)
}

function validOpaqueDigest(value: string): boolean {
  return /^[a-f0-9]{64}$/.test(value)
}

function createCurrentAttempt(options?: NormalHarnessTestOptions): CurrentAttempt {
  const configured = options?.testFaults?.attemptAuthority?.currentAttempt
  if (configured
    && validAttemptId(configured.attemptId)
    && validOpaqueDigest(configured.candidateDigest)
    && validOpaqueDigest(configured.resultIdentity)) {
    return { ...configured, status: 'pending', accepted: false, candidateStaged: false }
  }
  const attemptId = `attempt-${randomBytes(24).toString('hex')}`
  const resultIdentity = randomBytes(32).toString('hex')
  const candidateDigest = createHash('sha256')
    .update(JSON.stringify({ schemaVersion: 1, kind: 'guidelane.local-web.boot-candidate', attemptId, resultIdentity }))
    .digest('hex')
  return { attemptId, candidateDigest, resultIdentity, status: 'pending', accepted: false, candidateStaged: false }
}

function isForcedTerminalAuthorityFailure(options: NormalHarnessTestOptions | undefined, attempt: CurrentAttempt): boolean {
  const fault = options?.testFaults?.attemptAuthority
  return fault?.afterCandidate === 'force-terminal-authority-failure'
    && fault.currentAttempt.attemptId === attempt.attemptId
    && fault.currentAttempt.candidateDigest === attempt.candidateDigest
    && fault.currentAttempt.resultIdentity === attempt.resultIdentity
}

async function markAttemptFailed(artifacts: string, attempt: CurrentAttempt): Promise<void> {
  attempt.status = 'failed'
  attempt.accepted = false
  const terminal = {
    attemptId: attempt.attemptId,
    candidateDigest: attempt.candidateDigest,
    resultIdentity: attempt.resultIdentity,
    status: 'failed' as const,
  }
  try { await writeTerminalAttemptResult(artifacts, terminal) } catch { /* an unreadable record remains non-accepted */ }
  try { await finalizeAttemptAuthority(artifacts, terminal) } catch { /* an unreadable record remains non-accepted */ }
}

async function authorizeBootTransfer(artifacts: string, attempt: CurrentAttempt, options?: NormalHarnessTestOptions): Promise<boolean> {
  try {
    await stageAttemptCandidate(artifacts, attempt)
    attempt.candidateStaged = true
    if (isForcedTerminalAuthorityFailure(options, attempt)) {
      await markAttemptFailed(artifacts, attempt)
      return false
    }
    const terminal = {
      attemptId: attempt.attemptId,
      candidateDigest: attempt.candidateDigest,
      resultIdentity: attempt.resultIdentity,
      status: 'passed' as const,
    }
    await writeTerminalAttemptResult(artifacts, terminal)
    await finalizeAttemptAuthority(artifacts, terminal)
    const decision = await evaluateAttemptAuthority(artifacts, attempt)
    attempt.status = decision.accepted ? 'passed' : 'failed'
    attempt.accepted = decision.accepted
    if (!decision.accepted) await markAttemptFailed(artifacts, attempt)
    return decision.accepted
  } catch {
    await markAttemptFailed(artifacts, attempt)
    return false
  }
}

async function runBootGate(
  project: string,
  artifacts: string,
  port: number,
  keepAlive: boolean,
  observer?: NormalHarnessTestOptions['testLifecycleObserver'],
  testFaults?: NormalHarnessTestOptions['testFaults'],
  authorizeTransfer?: () => Promise<boolean>,
): Promise<GateRun> {
  const started = await startLiveServer(project, port)
  let server = started.server
  let result = started.result
  let childProcessesReaped = started.result.childProcessesReaped
  let transferredToCaller = false
  let cleanupEvidence: HarnessSummary['cleanup'] | undefined
  let evidence: GateEvidence | undefined
  let evidencePersistenceFailed = false
  let bootEvidenceDurable = false

  try {
    if (!started.ready || !server) throw new Error('boot server did not reach an owned ready state')
    if (observer) await observer.onLiveServerReady(server)
    result = await runNpmScript(project, 'health', {
      LOCAL_WEB_BASE_URL: server.baseUrl,
      BOOT_INSTANCE_NONCE: server.bootInstanceNonce,
    }, GATE_TIMEOUT_MS)
    result = invalidateResultForExitedServer(result, server)
    if (result.exitCode !== 0 || result.timedOut || !result.childProcessesReaped || childHasExited(server.child)) {
      throw new Error('boot health did not produce a transferable live server')
    }
    if (testFaults?.failBootEvidencePersistence) {
      evidencePersistenceFailed = true
      throw new Error('injected boot evidence persistence failure')
    }
    evidence = await writeGateEvidence(artifacts, 'boot', result)
    if (evidence.status !== 'passed' || childHasExited(server.child)) {
      // Do not hand off a server that died while the durable evidence boundary
      // was being crossed. A later failed write atomically replaces this one.
      evidence = undefined
      throw new Error('boot evidence did not leave a transferable live server')
    }
    if (keepAlive && (!authorizeTransfer || !(await authorizeTransfer()))) {
      throw new Error('boot attempt authority did not accept the current transfer')
    }
    bootEvidenceDurable = true
    transferredToCaller = keepAlive
  } catch {
    // The observer, health check, and boot-evidence write are one ownership
    // frame. Diagnostics stay out of artifacts; failure is represented by the
    // redacted command result after local cleanup below.
    result = failedBootResult(result)
  } finally {
    if (!transferredToCaller && server) {
      try {
        const stopped = await stopLiveServer(server)
        childProcessesReaped = stopped.childProcessesReaped
        cleanupEvidence = {
          lifecycleStage: stopped.childProcessesReaped ? 'reaped' : 'failed',
          ownershipVerified: stopped.ownershipVerified,
          reaped: stopped.childProcessesReaped,
          receiptDigest: createHash('sha256').update(`${server.receipt.pid}:${server.receipt.pgid}:${server.receipt.startedAt}`).digest('hex'),
        }
      } catch {
        childProcessesReaped = false
        cleanupEvidence = {
          lifecycleStage: 'failed',
          ownershipVerified: false,
          reaped: false,
          receiptDigest: createHash('sha256').update(`${server.receipt.pid}:${server.receipt.pgid}:${server.receipt.startedAt}`).digest('hex'),
        }
      }
      if (!childProcessesReaped) result = { ...result, timedOut: true }
      if (!childProcessesReaped) {
        bootEvidenceDurable = false
        evidence = undefined
      }
      server = undefined
    } else if (!server) {
      cleanupEvidence = {
        lifecycleStage: childProcessesReaped ? 'reaped' : 'failed',
        ownershipVerified: false,
        reaped: childProcessesReaped,
      }
    }
  }

  if (!bootEvidenceDurable) {
    if (!childProcessesReaped) result = { ...result, timedOut: true }
    result = failedBootResult(result)
    // A failed atomic persistence operation is intentionally not retried: a
    // second write could turn the injected failure into a durable success.
    if (!evidencePersistenceFailed) {
      try {
        evidence = await writeGateEvidence(artifacts, 'boot', result)
      } catch {
        evidencePersistenceFailed = true
      }
    }
    evidence ??= buildGateEvidence('boot', result)
  }

  return {
    evidence: evidence ?? buildGateEvidence('boot', failedBootResult(result)),
    childProcessesReaped,
    ...(cleanupEvidence ? { cleanup: cleanupEvidence } : {}),
    ...(transferredToCaller && server ? { server } : {}),
  }
}

async function runBrowserGate(project: string, gate: 'axe' | 'smoke', artifacts: string, port: number): Promise<GateRun> {
  const started = await startLiveServer(project, port)
  const server = started.server
  let result = started.result
  let childProcessesReaped = !server
  try {
    result = started.ready && server
      ? await runNpmScript(project, SIMPLE_GATE_SCRIPTS[gate], {
        LOCAL_WEB_BASE_URL: server.baseUrl,
        BOOT_INSTANCE_NONCE: server.bootInstanceNonce,
      }, GATE_TIMEOUT_MS)
      : started.result
    if (server) result = invalidateResultForExitedServer(result, server)
  } finally {
    if (server) {
      const exitedBeforeCleanup = childHasExited(server.child)
      childProcessesReaped = (await stopLiveServer(server)).childProcessesReaped
      if (exitedBeforeCleanup) result = invalidateResultForExitedServer(result, server)
    }
  }
  if (!childProcessesReaped) result = { ...result, timedOut: true }
  return {
    evidence: await writeGateEvidence(artifacts, gate, result),
    childProcessesReaped,
  }
}

async function runInstall(project: string, artifacts: string): Promise<boolean> {
  const result = await runNpmCommand(project, ['ci'], {}, INSTALL_TIMEOUT_MS)
  const status = result.exitCode === 0 && !result.timedOut && result.childProcessesReaped ? 'passed' : 'failed'
  await writeEvidence(artifacts, 'install.json', {
    schemaVersion: 1,
    kind: 'guidelane.local-web.install',
    identity: evidenceIdentity('install'),
    command: 'npm ci',
    result,
    status,
    artifactPaths: ['install.json'],
    ...(status === 'passed' ? {} : { failureCode: redactedFailureCode('install', result) }),
  })
  return status === 'passed'
}

async function applyLintMutation(project: string): Promise<void> {
  await writeFile(join(project, 'app/lint-target.tsx'), `/* eslint no-undef: "error" */
export default function LintTarget() {
  return <span aria-hidden="true">{seededLintIdentifier}</span>
}
`, 'utf8')
}

async function applyTypeMutation(project: string): Promise<void> {
  await writeFile(join(project, 'app/type-target.tsx'), `export default function TypeTarget() {
  const value: string = 42
  return <span aria-hidden="true" data-testid="type-target">{value}</span>
}
`, 'utf8')
}

async function applyUnitMutation(project: string): Promise<void> {
  await writeFile(join(project, 'tests/seeded-unit.test.mjs'), `import assert from 'node:assert/strict'
import { test } from 'node:test'

test('the seeded unit mutation fails the real unit command', () => {
  assert.fail('seeded unit assertion failed')
})
`, 'utf8')
}

async function applyBuildMutation(project: string): Promise<void> {
  await writeFile(join(project, 'next.config.ts'), `export default {
`, 'utf8')
}

async function applyBootMutation(project: string): Promise<void> {
  await writeFile(join(project, 'scripts/health.mjs'), `const rawBaseUrl = process.env.LOCAL_WEB_BASE_URL
if (!rawBaseUrl) throw new Error('LOCAL_WEB_BASE_URL is required')
const baseUrl = new URL(rawBaseUrl)
const response = await fetch(new URL('/api/health', baseUrl))
if (!response.ok) throw new Error('health endpoint returned ' + response.status)
const body = await response.json()
if (body.ok !== true || body.service !== 'seeded-boot') throw new Error('seeded boot assertion failed')
`, 'utf8')
}

async function applyAxeMutation(project: string): Promise<void> {
  await writeFile(join(project, 'scripts/axe.mjs'), `import AxeBuilder from '@axe-core/playwright'
import { chromium } from 'playwright'

const rawBaseUrl = process.env.LOCAL_WEB_BASE_URL
if (!rawBaseUrl) throw new Error('LOCAL_WEB_BASE_URL is required')
const baseUrl = new URL(rawBaseUrl)
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage()
  const response = await page.goto(new URL('/', baseUrl), { waitUntil: 'networkidle' })
  if (!response || !response.ok()) throw new Error('axe page returned an unavailable response')
  await page.getByRole('heading', { name: 'Seeded axe target' }).waitFor({ timeout: 1_000 })
  const result = await new AxeBuilder({ page }).analyze()
  if (result.violations.length > 0) throw new Error('axe reported ' + result.violations.length + ' violations')
} finally {
  await browser.close()
}
`, 'utf8')
}

async function applySmokeMutation(project: string): Promise<void> {
  await writeFile(join(project, 'scripts/smoke.mjs'), `import { chromium } from 'playwright'

const rawBaseUrl = process.env.LOCAL_WEB_BASE_URL
if (!rawBaseUrl) throw new Error('LOCAL_WEB_BASE_URL is required')
const baseUrl = new URL(rawBaseUrl)
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage()
  const response = await page.goto(new URL('/', baseUrl), { waitUntil: 'networkidle' })
  if (!response || !response.ok()) throw new Error('smoke page returned an unavailable response')
  await page.getByRole('heading', { name: 'Local Web' }).waitFor()
  await page.getByRole('button', { name: 'Create a note' }).waitFor()
  await page.getByTestId('seeded-smoke-target').waitFor({ timeout: 1_000 })
} finally {
  await browser.close()
}
`, 'utf8')
}

export const seedMutations: Record<GateId, MutationRecipe> = {
  lint: {
    seedId: 'seed-lint',
    gate: 'lint',
    files: ['app/lint-target.tsx'],
    description: 'Enable no-undef at error severity and reference an undefined identifier in the TSX target.',
    requiresBuildBeforeMutation: false,
    apply: applyLintMutation,
  },
  type: {
    seedId: 'seed-type',
    gate: 'type',
    files: ['app/type-target.tsx'],
    description: 'Assign a number to a string annotation in a generated TypeScript component.',
    requiresBuildBeforeMutation: false,
    apply: applyTypeMutation,
  },
  unit: {
    seedId: 'seed-unit',
    gate: 'unit',
    files: ['tests/seeded-unit.test.mjs'],
    description: 'Add a distinct real failing test to the generated Node unit test discovery set.',
    requiresBuildBeforeMutation: false,
    apply: applyUnitMutation,
  },
  build: {
    seedId: 'seed-build',
    gate: 'build',
    files: ['next.config.ts'],
    description: 'Make the generated Next configuration syntactically invalid for the build tool.',
    requiresBuildBeforeMutation: false,
    apply: applyBuildMutation,
  },
  boot: {
    seedId: 'seed-boot',
    gate: 'boot',
    files: ['scripts/health.mjs'],
    description: 'Change the real loopback health assertion to reject the generated service response.',
    requiresBuildBeforeMutation: true,
    apply: applyBootMutation,
  },
  axe: {
    seedId: 'seed-axe',
    gate: 'axe',
    files: ['scripts/axe.mjs'],
    description: 'Add a real Playwright accessibility-page assertion for a heading absent from the running app.',
    requiresBuildBeforeMutation: true,
    apply: applyAxeMutation,
  },
  smoke: {
    seedId: 'seed-smoke',
    gate: 'smoke',
    files: ['scripts/smoke.mjs'],
    description: 'Change the real Playwright smoke assertion to require an absent test target.',
    requiresBuildBeforeMutation: true,
    apply: applySmokeMutation,
  },
}

async function prepareSeed(project: string, artifacts: string, recipe: MutationRecipe): Promise<boolean> {
  if (!recipe.requiresBuildBeforeMutation) return true
  const result = await runNpmScript(project, 'build', {}, BUILD_TIMEOUT_MS)
  const status = result.exitCode === 0 && !result.timedOut && result.childProcessesReaped ? 'passed' : 'failed'
  await writeEvidence(artifacts, 'preparation.json', {
    schemaVersion: 1,
    kind: 'guidelane.local-web.seed-preparation',
    identity: evidenceIdentity(`preparation-${recipe.gate}`),
    command: 'npm run build',
    result,
    status,
    artifactPaths: ['preparation.json'],
    ...(status === 'passed' ? {} : { failureCode: redactedFailureCode('build', result) }),
  })
  return status === 'passed'
}

async function writeMutationEvidence(artifacts: string, recipe: MutationRecipe): Promise<void> {
  await writeEvidence(artifacts, 'mutation.json', {
    schemaVersion: 1,
    kind: 'guidelane.local-web.mutation',
    identity: evidenceIdentity(recipe.seedId),
    seedId: recipe.seedId,
    expectedGate: recipe.gate,
    files: recipe.files,
    description: recipe.description,
  })
}

async function runSeedGate(project: string, gate: GateId, artifacts: string): Promise<GateRun> {
  if (gate === 'boot') return runBootGate(project, artifacts, await selectLoopbackPort(), false)
  if (gate === 'axe' || gate === 'smoke') return runBrowserGate(project, gate, artifacts, await selectLoopbackPort())
  return runSimpleGate(project, gate, artifacts)
}

export async function runNormalHarness(artifacts: string, options?: NormalHarnessTestOptions): Promise<number> {
  const projectRoot = await mkdtemp(join(tmpdir(), 'guidelane-local-web-normal-'))
  const project = join(projectRoot, 'project')
  const completedGates: GateId[] = []
  const artifactPaths: string[] = []
  let liveServer: LiveServer | undefined
  let failedGate: GateId | undefined
  let status: 'passed' | 'failed' = 'passed'
  let cleanup: HarnessSummary['cleanup'] = { lifecycleStage: 'not-started', ownershipVerified: false, reaped: true }
  let currentAttempt: CurrentAttempt | undefined

  try {
    await generateProject(project)
    const installed = await runInstall(project, artifacts)
    artifactPaths.push('install.json')
    if (!installed) {
      status = 'failed'
    } else {
      for (const gate of GATE_IDS) {
        let run: GateRun
        if (gate === 'boot') {
          currentAttempt = createCurrentAttempt(options)
          try {
            await createPendingAttemptAuthority(artifacts, currentAttempt)
            run = await runBootGate(
              project,
              artifacts,
              options?.testLifecycleObserver?.port ?? await selectLoopbackPort(),
              true,
              options?.testLifecycleObserver,
              options?.testFaults,
              async () => authorizeBootTransfer(artifacts, currentAttempt!, options),
            )
          } catch {
            await markAttemptFailed(artifacts, currentAttempt)
            run = {
              evidence: await writeGateEvidence(artifacts, 'boot', {
                command: 'npm',
                args: ['run', 'start'],
                exitCode: 1,
                signal: null,
                timedOut: false,
                durationMs: 0,
                childProcessesReaped: true,
              }),
              childProcessesReaped: true,
            }
          }
        } else if (gate === 'axe' || gate === 'smoke') {
          run = liveServer
            ? await runSimpleGate(project, gate, artifacts, {
                LOCAL_WEB_BASE_URL: liveServer.baseUrl,
                BOOT_INSTANCE_NONCE: liveServer.bootInstanceNonce,
              }, GATE_TIMEOUT_MS, liveServer)
            : {
                evidence: await writeGateEvidence(artifacts, gate, {
                  command: 'npm',
                  args: ['run', SIMPLE_GATE_SCRIPTS[gate]],
                  exitCode: null,
                  signal: null,
                  timedOut: true,
                  durationMs: 0,
                  childProcessesReaped: false,
                }),
                childProcessesReaped: true,
              }
        } else {
          run = await runSimpleGate(project, gate, artifacts, {}, gate === 'build' ? BUILD_TIMEOUT_MS : GATE_TIMEOUT_MS)
        }
        artifactPaths.push(`gates/${gate}.json`)
        if (run.cleanup) cleanup = run.cleanup
        if (run.server) {
          liveServer = run.server
          cleanup = {
            lifecycleStage: 'live-observed', ownershipVerified: true, reaped: false,
            receiptDigest: createHash('sha256').update(`${liveServer.receipt.pid}:${liveServer.receipt.pgid}:${liveServer.receipt.startedAt}`).digest('hex'),
          }
        }
        if (run.evidence.status === 'failed') {
          status = 'failed'
          failedGate = gate
          break
        }
        completedGates.push(gate)
      }
    }
  } catch {
    status = 'failed'
  } finally {
    if (liveServer) {
      try {
        const result = await stopLiveServer(liveServer)
        cleanup = { ...cleanup, lifecycleStage: result.childProcessesReaped ? 'reaped' : 'failed', ownershipVerified: result.ownershipVerified, reaped: result.childProcessesReaped }
        if (!result.childProcessesReaped) status = 'failed'
      } catch {
        cleanup = { ...cleanup, lifecycleStage: 'failed', reaped: false }
        status = 'failed'
      }
    }
    await rm(projectRoot, { recursive: true, force: true })
  }

  if (currentAttempt) {
    if (status === 'failed' || !cleanup.reaped) {
      await markAttemptFailed(artifacts, currentAttempt)
    } else {
      const decision = await evaluateAttemptAuthority(artifacts, currentAttempt)
      currentAttempt.status = decision.accepted ? 'passed' : 'failed'
      currentAttempt.accepted = decision.accepted
      if (!decision.accepted) {
        status = 'failed'
        await markAttemptFailed(artifacts, currentAttempt)
      }
    }
  }

  const buildNormalSummary = (): HarnessSummary => ({
    schemaVersion: 1,
    kind: 'guidelane.local-web.harness',
    identity: currentAttempt?.resultIdentity ?? evidenceIdentity('normal'),
    mode: 'normal',
    status,
    gates: [...GATE_IDS],
    completedGates,
    artifactPaths: [...artifactPaths, ...(failedGate && !artifactPaths.includes(`gates/${failedGate}.json`) ? [`gates/${failedGate}.json`] : [])],
    ...(currentAttempt
      ? {
          attemptAuthority: {
            attemptId: currentAttempt.attemptId,
            candidateDigest: currentAttempt.candidateDigest,
            resultIdentity: currentAttempt.resultIdentity,
            status: currentAttempt.status,
            accepted: currentAttempt.accepted,
          },
        }
      : {}),
    cleanup,
  })

  let summary = buildNormalSummary()
  try {
    await writeEvidence(artifacts, 'result.json', summary)
  } catch {
    status = 'failed'
    if (currentAttempt) await markAttemptFailed(artifacts, currentAttempt)
    summary = buildNormalSummary()
    try { await writeEvidence(artifacts, 'result.json', summary) } catch { /* an unwritable summary cannot report acceptance */ }
  }
  return summary.status === 'passed' ? 0 : 1
}

export async function runSeededHarness(artifacts: string): Promise<number> {
  let allPassed = true
  const seedResults: string[] = []

  for (const expectedGate of GATE_IDS) {
    const recipe = seedMutations[expectedGate]
    const seedRoot = await mkdtemp(join(tmpdir(), `guidelane-local-web-seed-${expectedGate}-`))
    const project = join(seedRoot, 'project')
    const seedArtifactRoot = join(artifacts, `seed-${expectedGate}`)
    const artifactPaths: string[] = []
    let observedExitCode: number | null = null
    let attributable = false
    let childProcessesReaped = true
    let projectRemoved = false

    try {
      await generateProject(project)
      if (!(await runInstall(project, seedArtifactRoot))) {
        artifactPaths.push('install.json')
        throw new Error('seed dependency installation failed')
      }
      artifactPaths.push('install.json')
      if (recipe.requiresBuildBeforeMutation) {
        const prepared = await prepareSeed(project, seedArtifactRoot, recipe)
        artifactPaths.push('preparation.json')
        if (!prepared) throw new Error('seed preparation failed')
      }
      const baselineArtifactRoot = join(seedArtifactRoot, 'baseline')
      const baseline = await runSeedGate(project, expectedGate, baselineArtifactRoot)
      artifactPaths.push(`baseline/gates/${expectedGate}.json`)
      if (baseline.evidence.status !== 'passed') throw new Error('clean baseline gate failed')
      await recipe.apply(project)
      await writeMutationEvidence(seedArtifactRoot, recipe)
      artifactPaths.push('mutation.json')
      const run = await runSeedGate(project, expectedGate, seedArtifactRoot)
      artifactPaths.push(`gates/${expectedGate}.json`)
      observedExitCode = run.evidence.result.exitCode
      childProcessesReaped = run.childProcessesReaped
      attributable = run.evidence.gate === expectedGate
        && run.evidence.status === 'failed'
        && run.evidence.result.exitCode !== null
        && run.evidence.result.exitCode !== 0
        && !run.evidence.result.timedOut
    } catch {
      allPassed = false
    } finally {
      try {
        await rm(seedRoot, { recursive: true, force: true })
        projectRemoved = !(await pathExists(seedRoot))
      } catch {
        projectRemoved = false
      }
      const passed = attributable && projectRemoved && childProcessesReaped
      if (!passed) allPassed = false
      const relative = `seed-${expectedGate}.json`
      await writeEvidence(artifacts, relative, {
        schemaVersion: 1,
        kind: 'guidelane.local-web.seed',
        identity: evidenceIdentity(`seed-${expectedGate}`),
        seedId: recipe.seedId,
        expectedGate,
        normalCommand: GATE_COMMANDS[expectedGate],
        observedExitCode,
        attributable,
        mutation: { files: recipe.files, description: recipe.description },
        artifactPaths,
        cleanup: { projectRemoved, childProcessesReaped },
        status: passed ? 'passed' : 'failed',
      } satisfies SeedEvidence)
      seedResults.push(relative)
    }
  }

  const summary: HarnessSummary = {
    schemaVersion: 1,
    kind: 'guidelane.local-web.harness',
    identity: evidenceIdentity('seeded'),
    mode: 'seeded',
    status: allPassed ? 'passed' : 'failed',
    gates: [...GATE_IDS],
    completedGates: allPassed ? [...GATE_IDS] : [],
    artifactPaths: seedResults,
  }
  await writeEvidence(artifacts, 'result.json', summary)
  return allPassed ? 0 : 1
}
