import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
const sessionModule = new URL('../src/index.ts', import.meta.url).href
const surfacePath = new URL('../../../tools/probe/stream-surface.json', import.meta.url).pathname

type Arm = 'EPERM' | 'EACCES' | 'unknown'
type HarnessResult = { rejected: boolean; error: string | null; registrySize: number; pid: number; descendant: number }

async function waitForGroupAbsence(pgid: number, pids: readonly number[]): Promise<void> {
  const deadline = Date.now() + 1_000
  while (Date.now() < deadline) {
    const { stdout } = await execFileAsync('/bin/ps', ['-ax', '-o', 'pid=,pgid=,stat='])
    const live = stdout.split('\n').flatMap((line) => {
      const [pidText, pgidText, state] = line.trim().split(/\s+/, 3)
      const pid = Number(pidText)
      return (pids.includes(pid) || Number(pgidText) === pgid) && !state?.startsWith('Z') ? [line] : []
    })
    if (live.length === 0) return
    await delay(20)
  }
  throw new Error(`the exact detached test group ${pgid} or one of its descendants remained live`)
}

const posixOnly = { skip: process.platform === 'win32' ? 'detached process-group reaping requires POSIX' : false }

test('ENGINE-FINAL-34 rejects every unobservable detached start and reaps its exact receipt-less group', posixOnly, async () => {
  const root = await mkdtemp(join(tmpdir(), 'guidelane-engine-final-34-'))
  const failures: string[] = []
  try {
    for (const arm of ['EPERM', 'EACCES', 'unknown'] as const satisfies readonly Arm[]) {
      const marker = join(root, `${arm}.json`)
      const engine = join(root, `${arm}-engine.mjs`)
      const preload = join(root, `${arm}-identity-preload.cjs`)
      const harness = join(root, `${arm}-harness.mjs`)
      await writeFile(engine, [
        "import { spawn } from 'node:child_process'",
        "import { rename, writeFile } from 'node:fs/promises'",
        "const marker = process.env.GUIDELANE_FINAL_22_ENGINE_MARKER",
        "const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })",
        'const pending = `${marker}.${process.pid}.pending`',
        'await writeFile(pending, JSON.stringify({ pid: process.pid, descendant: child.pid }))',
        'await rename(pending, marker)',
        'setInterval(() => {}, 1_000)',
      ].join('\n'))
      // This runs before the ESM session import. syncBuiltinESMExports makes
      // the injected execFileSync failure observable through production's named
      // import, independently of how production resolves its ps executable.
      await writeFile(preload, [
        "const childProcess = require('node:child_process')",
        "const { readFileSync } = require('node:fs')",
        "const { syncBuiltinESMExports } = require('node:module')",
        'const marker = process.env.GUIDELANE_FINAL_22_ENGINE_MARKER',
        'const arm = process.env.GUIDELANE_FINAL_34_ARM',
        'const pause = new Int32Array(new SharedArrayBuffer(4))',
        'const hasExactMarker = () => {',
        "  try { const value = JSON.parse(readFileSync(marker, 'utf8')); return Number.isSafeInteger(value.pid) && value.pid > 0 && Number.isSafeInteger(value.descendant) && value.descendant > 0 } catch { return false }",
        '}',
        'const originalExecFileSync = childProcess.execFileSync',
        'childProcess.execFileSync = (file, ...args) => {',
        "  if (file !== 'ps' && file !== '/bin/ps') return originalExecFileSync(file, ...args)",
        '  const deadline = Date.now() + 1000',
        '  while (!hasExactMarker() && Date.now() < deadline) Atomics.wait(pause, 0, 0, 10)',
        "  const error = new Error('test-owned process identity observation failure')",
        "  if (arm !== 'unknown') error.code = arm",
        '  throw error',
        '}',
        'syncBuiltinESMExports()',
        'const originalKill = process.kill',
        'process.kill = (pid, signal) => {',
        "  if (signal === 0 && pid > 0) { const error = new Error('test-owned identity liveness failure'); if (arm !== 'unknown') error.code = arm; throw error }",
        '  return originalKill(pid, signal)',
        '}',
      ].join('\n'))
      await writeFile(harness, [
        "import { readFile } from 'node:fs/promises'",
        'const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))',
        'const exactMarker = async (path) => {',
        '  const deadline = Date.now() + 1000',
        '  while (Date.now() < deadline) {',
        "    try { const value = JSON.parse(await readFile(path, 'utf8')); if (Number.isSafeInteger(value.pid) && value.pid > 0 && Number.isSafeInteger(value.descendant) && value.descendant > 0) return value } catch {}",
        '    await delay(10)',
        '  }',
        "  throw new Error('test-owned engine marker was not fully written')",
        '}',
        'const mod = await import(process.env.GUIDELANE_FINAL_34_SESSION_MODULE)',
        'const registry = new mod.SessionRegistry()',
        'const session = new mod.EngineSession({',
        '  claudeBin: process.execPath, args: [process.env.GUIDELANE_FINAL_34_ENGINE], ambient: true, cwd: process.env.GUIDELANE_FINAL_34_ROOT,',
        "  env: { PATH: process.env.PATH ?? '', GUIDELANE_FINAL_22_ENGINE_MARKER: process.env.GUIDELANE_FINAL_22_ENGINE_MARKER },",
        '  registry, surface: mod.loadSurface(process.env.GUIDELANE_FINAL_34_SURFACE), expect: { modelAlias: \'haiku\' },',
        '})',
        'let error = null',
        'try { session.start() } catch (caught) { error = caught instanceof Error ? caught.message : String(caught) }',
        'const owned = await exactMarker(process.env.GUIDELANE_FINAL_22_ENGINE_MARKER)',
        'const result = { rejected: error !== null, error, registrySize: registry.size, ...owned }',
        'process.stdout.write(JSON.stringify(result), () => process.exit(0))',
      ].join('\n'))

      const { stdout } = await execFileAsync(process.execPath, ['--require', preload, '--experimental-strip-types', harness], {
        env: {
          ...process.env,
          GUIDELANE_FINAL_34_ARM: arm,
          GUIDELANE_FINAL_34_ENGINE: engine,
          GUIDELANE_FINAL_34_ROOT: root,
          GUIDELANE_FINAL_34_SESSION_MODULE: sessionModule,
          GUIDELANE_FINAL_34_SURFACE: surfacePath,
          GUIDELANE_FINAL_22_ENGINE_MARKER: marker,
        },
      })
      const result = JSON.parse(stdout) as HarnessResult
      try {
        await waitForGroupAbsence(result.pid, [result.pid, result.descendant])
      } catch (error) {
        failures.push(`${arm}: ${error instanceof Error ? error.message : String(error)}`)
      } finally {
        try { process.kill(-result.pid, 'SIGKILL') } catch { /* only this exact test-owned group is eligible for cleanup */ }
        await waitForGroupAbsence(result.pid, [result.pid, result.descendant])
      }
      if (!result.rejected) failures.push(`${arm}: startup was accepted after an unobservable identity probe`)
      if (result.registrySize !== 0) failures.push(`${arm}: rejected startup retained a receipt-less registry entry`)
    }
    assert.deepEqual(failures, [], 'only ESRCH may establish absence; every unobservable identity arm must reject and reap')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
