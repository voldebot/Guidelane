#!/usr/bin/env node
// A process that refuses to die politely, so the harness's kill path can be
// tested against something that actually behaves like a stuck engine session.
//
// WHY THIS EXISTS: `spawnCapture` gained a process-group kill and a settle
// watchdog during the S0 sprint-close review. Both were verified only in the
// negative sense — the suite stayed green — which proves they do not break the
// happy path and says nothing about whether they work. This fixture is the
// positive test, and it is the cheap half of REVIEW-02 B1 (orphan reaping):
// no engine call, no quota, runs in CI.
//
// MODES
//   grouped  — fork a child that inherits stdout and stays in OUR process group.
//              A correct group kill reaps it; killing only the direct pid does not.
//   escaped  — fork a child into its OWN process group (detached) that still
//              holds the stdout write end. A group kill CANNOT reach it, so
//              'close' never fires on the parent side. This is the exact
//              "nightly job hangs forever with no output" scenario, and the only
//              thing that can save the harness is the settle watchdog.
//
// Both modes write their own pid and the child's pid to $GUIDELANE_HANG_PIDFILE
// so the probe can check liveness precisely with kill(pid, 0) instead of
// grepping a process table.

import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'

const mode = process.argv[2] === 'escaped' ? 'escaped' : 'grouped'
const pidfile = process.env.GUIDELANE_HANG_PIDFILE || ''

// `cat` with no input holds the inherited stdout write end open forever without
// producing output — exactly the shape that keeps a pipe from closing.
const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1e9)'], {
  stdio: ['ignore', 'inherit', 'ignore'],
  detached: mode === 'escaped',
})
if (mode === 'escaped') child.unref()

if (pidfile) {
  try {
    writeFileSync(pidfile, `${process.pid}\n${child.pid}\n`)
  } catch {
    /* the probe treats a missing pidfile as its own failure signal */
  }
}

// Announce liveness once so the probe can tell "started" from "never spawned",
// then never exit and never say anything again.
process.stdout.write(`HANG_FIXTURE_READY ${mode}\n`)
setInterval(() => {}, 1e9)
