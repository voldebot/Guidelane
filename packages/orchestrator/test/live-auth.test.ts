import assert from 'node:assert/strict'
import { accessSync, constants, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { buildEngineEnv } from '../src/index.ts'
import { EngineSession, SessionRegistry, loadSurface } from '../../engine/src/index.ts'
import type { SessionFailure } from '../../engine/src/index.ts'

const LIVE = process.env.GUIDELANE_LIVE === '1'
const SURFACE_PATH = fileURLToPath(new URL('../../../tools/probe/stream-surface.json', import.meta.url))
let engineLaunches = 0

function resolvedClaudeBinary(): string {
  for (const directory of (process.env.PATH ?? '').split(delimiter)) {
    if (!directory) continue
    const candidate = join(directory, 'claude')
    try {
      accessSync(candidate, constants.X_OK)
      return candidate
    } catch {
      // Continue without revealing filesystem paths in test output.
    }
  }
  throw new Error('official Claude binary is unavailable')
}

function definedMinimalEnvironment(environment: NodeJS.ProcessEnv): Record<string, string> {
  const narrowed: Record<string, string> = {}
  for (const [key, value] of Object.entries(environment)) {
    if (typeof value !== 'string') throw new Error(`minimal environment contains an undefined ${key} entry`)
    narrowed[key] = value
  }
  assert.equal(Object.values(narrowed).some((value) => value === undefined), false, 'child environment must contain no undefined values')
  return narrowed
}

test('S2-LIVE-AUTH-01 production minimal environment reaches an authenticated init receipt', { skip: !LIVE }, async (t) => {
  const registry = new SessionRegistry()
  const cwd = mkdtempSync(join(tmpdir(), 'guidelane-live-auth-'))
  const session = new EngineSession({
    claudeBin: resolvedClaudeBinary(),
    args: [
      '-p',
      '--input-format', 'stream-json',
      '--output-format', 'stream-json',
      '--verbose',
      '--model', 'haiku',
      '--permission-mode', 'auto',
      '--tools', '',
      '--no-session-persistence',
    ],
    cwd,
    env: definedMinimalEnvironment(buildEngineEnv()),
    registry,
    surface: loadSurface(SURFACE_PATH),
    expect: {
      modelAlias: 'haiku',
      apiKeySource: 'none',
      versionRange: ['2.1.220', '2.1.999'],
      permissionMode: 'auto',
    },
    stallMs: 90_000,
    initMs: 30_000,
  })
  const failures: Array<Pick<SessionFailure, 'kind'>> = []
  session.on('failure', (failure) => failures.push({ kind: failure.kind }))
  t.after(() => {
    session.stop()
    registry.killAll()
    rmSync(cwd, { recursive: true, force: true })
  })

  const receipt = new Promise<'ready' | 'failure'>((resolve) => {
    session.once('ready', () => resolve('ready'))
    session.once('failure', () => resolve('failure'))
  })
  engineLaunches += 1
  session.start()
  assert.ok(session.spawnedArgv?.includes('--strict-mcp-config'), 'the real spawn must carry the isolation pair')
  // The engine emits init only after one input. Do not inspect or assert any assistant prose.
  session.send('Confirm readiness.')
  assert.equal(await receipt, 'ready', 'the authenticated init receipt must pass before any work')
  await session.close(20_000)
  assert.deepEqual(failures.filter((failure) => failure.kind === 'init-receipt'), [])
  assert.equal(registry.size, 0, 'every live child group must be reaped before reporting success')
})

test('S2-LIVE-AUTH-OFFLINE-02 without GUIDELANE_LIVE this file cannot resolve or start the engine', { skip: LIVE }, () => {
  assert.equal(LIVE, false)
  assert.equal(engineLaunches, 0, 'offline test evaluation must not reach the official binary')
})
