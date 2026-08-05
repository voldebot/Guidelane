import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { runCommand, startCommand, stopCommand } from '../src/command.ts'

const PORTABLE_CONTEXT = {
  PATH: '/test/portable-bin',
  HOME: '/test/portable-home',
  LANG: 'tr_TR.UTF-8',
  LC_ALL: 'tr_TR.UTF-8',
  TMPDIR: '/test/portable-tmp',
  TMP: '/test/portable-tmp',
  TEMP: '/test/portable-tmp',
} as const

const SENTINELS = {
  GUIDELANE_TEST_SENTINEL_SECRET: 'harmless-test-sentinel',
  AWS_SECRET_ACCESS_KEY: 'harmless-test-sentinel',
  DATABASE_URL: 'postgres://harmless-test-sentinel',
  ANTHROPIC_API_KEY: 'harmless-test-sentinel',
  NODE_TEST_CONTEXT: 'harmless-test-sentinel',
} as const

const childEnvironmentWriter = "require('node:fs').writeFileSync(process.argv[1], JSON.stringify(process.env))"

function detachedProcessGroupForPid(pid: number): number | null {
  const observation = spawnSync('/bin/ps', ['-o', 'pid=', '-o', 'pgid=', '-p', String(pid)], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: 100,
  })
  if (observation.status !== 0) return null
  const match = /^\s*(\d+)\s+(\d+)\s*$/.exec(observation.stdout)
  if (!match || Number(match[1]) !== pid) return null
  const pgid = Number(match[2])
  return Number.isSafeInteger(pgid) ? pgid : null
}

function exactProcessGroupIsAbsent(pgid: number): boolean {
  const observation = spawnSync('/usr/bin/pgrep', ['-g', String(pgid)], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: 100,
  })
  if (observation.status === 1) return true
  if (observation.status === 0) return false
  throw new Error(`could not probe the test-owned process group ${pgid}; status=${observation.status}`)
}

async function eventually<T>(read: () => Promise<T>, predicate: (value: T) => boolean, label: string): Promise<T> {
  const deadline = Date.now() + 2_000
  let last: T | undefined
  while (Date.now() < deadline) {
    last = await read()
    if (predicate(last)) return last
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`timed out waiting for ${label}; last=${JSON.stringify(last)}`)
}

async function readEnvironment(path: string): Promise<Record<string, string> | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as Record<string, string>
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

async function withSentinelParentEnvironment<T>(fn: () => Promise<T>): Promise<T> {
  const values = { ...PORTABLE_CONTEXT, ...SENTINELS }
  const previous = new Map(Object.keys(values).map((key) => [key, process.env[key]]))
  try {
    Object.assign(process.env, values)
    return await fn()
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

function assertPortableChildEnvironment(environment: Record<string, string>, explicit: Record<string, string>): void {
  for (const [key, value] of Object.entries(PORTABLE_CONTEXT)) assert.equal(environment[key], value, `${key} must cross the child boundary`)
  for (const [key, value] of Object.entries(explicit)) assert.equal(environment[key], value, `${key} is an explicit per-gate variable`)
  assert.equal(environment.CI, '1')
  assert.equal(environment.NEXT_TELEMETRY_DISABLED, '1')
  for (const key of Object.keys(SENTINELS)) assert.equal(environment[key], undefined, `${key} must not cross the child boundary`)
  assert.deepEqual(
    Object.keys(environment).filter((key) => key !== '__CF_USER_TEXT_ENCODING').sort(),
    [...Object.keys(PORTABLE_CONTEXT), ...Object.keys(explicit), 'CI', 'NEXT_TELEMETRY_DISABLED'].sort(),
    'children must receive only the explicit portable allowlist and per-gate variables'
  )
}

test('bounded Local Web commands receive only portable context and explicit gate environment', async () => {
  const root = await mkdtemp(join(tmpdir(), 'guidelane-local-web-env-command-'))
  try {
    await withSentinelParentEnvironment(async () => {
    const output = join(root, 'environment.json')
    const explicit = { LOCAL_WEB_BASE_URL: 'http://127.0.0.1:4173' }
    const result = await runCommand(root, process.execPath, ['-e', childEnvironmentWriter, output], explicit, 2_000)
    assert.equal(result.exitCode, 0)
    const environment = await readEnvironment(output)
    assert.notEqual(environment, null)
    assertPortableChildEnvironment(environment!, explicit)
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('long-lived Local Web server commands receive the same bounded child environment and reap their owned group', async () => {
  const root = await mkdtemp(join(tmpdir(), 'guidelane-local-web-env-server-'))
  let childGroupAbsent = false
  try {
    await withSentinelParentEnvironment(async () => {
    const output = join(root, 'environment.json')
    const explicit = { LOCAL_WEB_BASE_URL: 'http://127.0.0.1:4174' }
    const child = startCommand(root, process.execPath, ['-e', `${childEnvironmentWriter}; setInterval(() => {}, 1000)`, output], explicit)
    assert.notEqual(child.pid, undefined, 'long-lived fixture must expose its fresh detached leader PID')
    const childPid = child.pid!
    try {
      const environment = await eventually(() => readEnvironment(output), (value) => value !== null, 'long-lived child environment')
      if (environment === null) throw new Error('long-lived child environment unexpectedly missing')
      assertPortableChildEnvironment(environment, explicit)
      const childPgid = await eventually(
        async () => detachedProcessGroupForPid(childPid),
        (pgid) => pgid === childPid,
        'long-lived fixture detached process group',
      )
      assert.equal(childPgid, childPid, 'long-lived fixture must still be running as its own detached process-group leader')

      const cleanup = await stopCommand(child)
      assert.deepEqual(cleanup, { ownershipVerified: true, childProcessesReaped: true }, 'cleanup must verify the fresh child identity and reap its owned process group')
      await eventually(
        async () => exactProcessGroupIsAbsent(childPgid),
        (absent) => absent,
        `absence of the exact test-owned process group ${childPgid}`,
      )
      childGroupAbsent = true
    } finally {
      if (!childGroupAbsent) await stopCommand(child)
    }
    })
  } finally {
    if (childGroupAbsent) await rm(root, { recursive: true, force: true })
  }
})

test('FINAL-35-LOCAL-WEB stopCommand settles when the owned child closes during cleanup listener attachment', async () => {
  const root = await mkdtemp(join(tmpdir(), 'guidelane-local-web-final-35-close-race-'))
  const child = startCommand(root, process.execPath, ['-e', 'setInterval(() => {}, 1_000)'])
  assert.notEqual(child.pid, undefined, 'the race fixture must expose its own detached group leader')
  const pid = child.pid!
  const pgid = await eventually(
    async () => detachedProcessGroupForPid(pid),
    (value) => value === pid,
    'the exact test-owned detached group before cleanup',
  )
  assert.equal(pgid, pid)

  const originalOnce = child.once.bind(child) as (event: string | symbol, listener: (...args: unknown[]) => void) => ChildProcess
  let closeWasDeliveredBeforeRegistration = false
  child.once = ((event: string | symbol, listener: (...args: unknown[]) => void) => {
    if (event === 'close' && !closeWasDeliveredBeforeRegistration) {
      closeWasDeliveredBeforeRegistration = true
      // stopCommand has already sent SIGTERM to this test-owned group. Emit the
      // corresponding close notification in the one gap before it registers its
      // cleanup listener; an event listener added afterwards cannot observe it.
      child.emit('close', 0, null)
      return child
    }
    return originalOnce(event, listener)
  }) as typeof child.once

  const cleanup = await stopCommand(child, 75)
  assert.equal(closeWasDeliveredBeforeRegistration, true, 'the fixture must force close delivery before cleanup listener registration')
  assert.deepEqual(cleanup, { ownershipVerified: true, childProcessesReaped: true }, 'a pre-delivered owned close must settle cleanup after the exact group is gone')
})
