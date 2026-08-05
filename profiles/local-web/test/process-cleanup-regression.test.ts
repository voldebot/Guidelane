import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { startCommand, stopCommand } from '../src/command.ts'

const intervalProgram = 'setInterval(() => {}, 1_000)'

async function eventually(predicate: () => boolean | Promise<boolean>, label: string): Promise<void> {
  const deadline = Date.now() + 2_000
  while (Date.now() < deadline) {
    if (await predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`timed out waiting for ${label}`)
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error: unknown) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH'
  }
}

function terminateOwnedGroup(child: ChildProcess): void {
  if (child.pid === undefined || !isAlive(child.pid)) return
  try { process.kill(-child.pid, 'SIGKILL') } catch { try { child.kill('SIGKILL') } catch {} }
}

test('stale Local Web cleanup receipt never signals an unrelated reused process group', async () => {
  const unrelated = spawn(process.execPath, ['-e', intervalProgram], { detached: true, stdio: 'ignore' })
  assert.notEqual(unrelated.pid, undefined, 'test-owned unrelated process must have a group leader PID')
  const unrelatedPid = unrelated.pid!
  const stale = Object.assign(new EventEmitter(), { pid: unrelatedPid, exitCode: null, signalCode: null }) as unknown as ChildProcess
  try {
    setTimeout(() => stale.emit('close'), 50)
    await stopCommand(stale, 25)
    assert.equal(isAlive(unrelatedPid), true, 'cleanup with no verifiable owner identity must not signal a reused PID/process group')
  } finally {
    terminateOwnedGroup(unrelated)
  }
})

test('Local Web cleanup still reaps a descendant in a genuine owned process group', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'guidelane-local-web-owned-group-'))
  const descendantPidFile = join(temporary, 'descendant.pid')
  const ownerProgram = `
    const { spawn } = require('node:child_process')
    const { writeFileSync } = require('node:fs')
    const descendant = spawn(process.execPath, ['-e', ${JSON.stringify(intervalProgram)}], { stdio: 'ignore' })
    writeFileSync(process.argv[1], String(descendant.pid))
    setInterval(() => {}, 1_000)
  `
  const owner = startCommand(temporary, process.execPath, ['-e', ownerProgram, descendantPidFile])
  try {
    await eventually(async () => {
      try { return Number.isSafeInteger(Number(await readFile(descendantPidFile, 'utf8'))) } catch { return false }
    }, 'owned descendant PID')
    const descendantPid = Number(await readFile(descendantPidFile, 'utf8'))
    assert.equal(Number.isSafeInteger(descendantPid), true, 'owned process must report its test-owned descendant PID')
    await stopCommand(owner, 100)
    await eventually(() => !isAlive(descendantPid), 'owned descendant cleanup')
  } finally {
    terminateOwnedGroup(owner)
    await rm(temporary, { recursive: true, force: true })
  }
})

test('S2-F24-H Local Web captures detached ownership after spawn without an unbounded receipt race', { timeout: 15_000 }, async () => {
  const deadline = Date.now() + 12_000
  for (let cycle = 0; cycle < 20; cycle += 1) {
    assert.ok(Date.now() < deadline, `receipt race stress exceeded its bounded overall deadline at cycle ${cycle}`)
    const child = startCommand(process.cwd(), process.execPath, ['-e', intervalProgram])
    assert.notEqual(child.pid, undefined, `cycle ${cycle} must expose a test-owned detached leader PID`)
    const pid = child.pid!
    try {
      const cleanup = await stopCommand(child, 500)
      assert.deepEqual(cleanup, { ownershipVerified: true, childProcessesReaped: true }, `cycle ${cycle} must retain a verified ownership receipt until its detached group is reaped`)
      await eventually(() => !isAlive(pid), `cycle ${cycle} detached owner group`)
    } finally {
      terminateOwnedGroup(child)
    }
  }
})
