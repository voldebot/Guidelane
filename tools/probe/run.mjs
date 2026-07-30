#!/usr/bin/env node
// MAP: CLI entry for the Guidelane S0 engine-conformance probe.
// USAGE: node tools/probe/run.mjs [--live] [--only id,id] [--kind k,k] [--model m] [--out dir]
// EXIT: 0 green · 1 the engine's contract changed · 2 the harness broke ·
//       3 inconclusive (stall/capacity — says nothing about the engine).
// WHY: ADR-001 makes this a standing obligation — it runs nightly against the
//      latest CLI so engine breakage is discovered by the project, not by a user.

import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

import {
  parseArgs, runSuite, renderMarkdown, spawnCapture, scrubbedChildEnv, killAllChildren,
} from './lib/runner.mjs'
import { redactDeep, redactString } from './lib/redact.mjs'
import { probes } from './probes.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '..', '..')
const FIXTURES = join(HERE, 'fixtures')

const USAGE = `
Guidelane S0 — engine conformance probe

  node tools/probe/run.mjs [options]

Options:
  --live               Run probes that make real engine calls (spends subscription quota).
                       Without it, only help-text and observational probes run.
  --only <ids>         Comma-separated probe ids.
  --kind <kinds>       Comma-separated: help-text, live-call, fixture-call, observational.
  --model <alias>      Model for live probes (default: haiku — cheap; the model is not what is under test).
  --timeout <seconds>  Per-probe timeout (default: 120).
  --out <dir>          Where to write the report (default: docs/research).
  --keep-workspaces    Leave temp workspaces on disk for inspection.
  --list               List probes and exit.
  -h, --help           This text.

Safety: live probes run with cwd inside a disposable temp directory, with the
parent session's Claude Code environment markers scrubbed, DISABLE_AUTOUPDATER=1,
and a hard timeout. No probe uses --bare or --safe-mode, and none deliberately
provokes a rate limit.
`

async function main() {
  let opts
  try {
    opts = parseArgs(process.argv.slice(2))
  } catch (err) {
    process.stderr.write(`${(err && err.message) || err}\n${USAGE}`)
    process.exit(2)
  }

  if (opts.help) {
    process.stdout.write(USAGE)
    return 0
  }

  if (opts.listOnly) {
    for (const p of probes) {
      process.stdout.write(`${p.id.padEnd(32)} ${p.kind.padEnd(14)} ${p.loadBearing.padEnd(9)} ${p.title}\n`)
    }
    return 0
  }

  const claudeBin = process.env.GUIDELANE_CLAUDE_BIN || 'claude'
  const versionRes = await spawnCapture(claudeBin, ['--version'], {
    cwd: REPO_ROOT,
    env: scrubbedChildEnv().env,
    timeoutMs: 30_000,
  })
  if (versionRes.spawnFailed || versionRes.code !== 0) {
    process.stderr.write(
      `Cannot run: \`${claudeBin} --version\` failed. Install the CLI or set GUIDELANE_CLAUDE_BIN.\n${versionRes.stderr}\n`
    )
    return 2
  }
  const version = versionRes.stdout.trim()

  const liveCount = probes.filter((p) => p.kind === 'live-call' || p.kind === 'fixture-call').length
  process.stderr.write(
    `Engine: ${version}\n` +
      `Probes: ${probes.length} total, ${liveCount} need a live call — ${opts.live ? 'RUNNING (real quota)' : 'skipped (pass --live to run)'}\n\n`
  )

  const report = await runSuite({ probes, opts, fixturesDir: FIXTURES })

  const generatedAt = new Date().toISOString()
  const outDir = opts.outDir ? resolve(opts.outDir) : join(REPO_ROOT, 'docs', 'research')
  // --out is an unvalidated write path today and this file seeds an adapter that
  // will one day take paths from a UI. Confine it now, while it costs nothing.
  // RUNNER_TEMP is GitHub Actions' scratch dir and is NOT os.tmpdir() there
  // (/home/runner/work/_temp vs /tmp) — CI writes its report outside the working
  // tree so the committed baseline cannot be clobbered, and that is legitimate.
  const allowedRoots = [REPO_ROOT, resolve(tmpdir())]
  if (process.env.RUNNER_TEMP) allowedRoots.push(resolve(process.env.RUNNER_TEMP))
  if (!allowedRoots.some((root) => outDir === root || outDir.startsWith(root + sep))) {
    process.stderr.write(`--out must be inside the repo or the temp dir (got ${outDir})\n`)
    return 2
  }
  mkdirSync(outDir, { recursive: true })

  // A filtered or free-tier run is NOT the conformance baseline. It used to
  // overwrite the committed report with a one-probe file that read "1 pass ·
  // 0 fail" and carried no marker saying it was filtered — an audit-evidence
  // integrity failure in the document that ADR-007 and ADR-008 both cite.
  const suffix = report.runScope.complete ? '' : '.partial'
  const jsonPath = join(outDir, `S0-conformance-results${suffix}.json`)
  const mdPath = join(outDir, `S0-conformance-report${suffix}.md`)

  // The single redaction boundary. Everything a child process said passes
  // through here before it can reach a file destined for a public repository.
  const safe = redactDeep({ version, generatedAt, ...report })
  writeFileSync(jsonPath, JSON.stringify(safe, null, 2))
  writeFileSync(mdPath, redactString(renderMarkdown(report, { version, generatedAt })))

  const c = report.counts
  for (const r of report.results) {
    const mark = { pass: ' ok ', fail: 'FAIL', partial: 'part', skip: 'skip', error: ' ERR', inconclusive: 'INCO' }[r.status]
    process.stderr.write(`[${mark}] ${r.id.padEnd(32)} ${String(r.detail || '').split('\n')[0].slice(0, 110)}\n`)
  }
  process.stderr.write(
    `\n${c.pass} pass · ${c.fail} fail · ${c.partial} partial · ${c.inconclusive} inconclusive · ${c.error} error · ${c.skip} skipped\n` +
      `Report: ${mdPath}\nRaw:    ${jsonPath}\n`
  )
  if (!report.runScope.complete) {
    process.stderr.write(
      `\nPartial run — wrote *${suffix}* files, left the canonical report untouched.\n` +
        `Finish with a full \`--live\` run before committing.\n`
    )
  }

  // Three distinct exit codes, because a nightly job that cannot tell "the
  // engine changed" from "my laptop slept" earns alarm fatigue and then gets
  // ignored — and it is the project's only automated drift detector.
  //   0 = green · 1 = the engine's contract changed · 2 = the harness broke
  //   3 = inconclusive; this run says nothing about the engine
  if (c.fail + c.error > 0) return 1
  if (c.inconclusive > 0) return 3
  return 0
}

// Reap the tree on every exit route. Children are spawned detached (their own
// process group) so they no longer receive the terminal's Ctrl-C; without these
// handlers a cancelled run leaves an authenticated `claude` burning quota.
let shuttingDown = false
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(sig, () => {
    if (shuttingDown) process.exit(130)
    shuttingDown = true
    process.stderr.write(`\nReceived ${sig} — killing engine children.\n`)
    killAllChildren()
    process.exit(130)
  })
}
process.on('uncaughtException', (err) => {
  killAllChildren()
  process.stderr.write(`Harness crashed: ${(err && err.stack) || err}\n`)
  process.exit(2)
})

main().then(
  (code) => process.exit(code),
  (err) => {
    killAllChildren()
    process.stderr.write(`Harness crashed: ${(err && err.stack) || err}\n`)
    process.exit(2)
  }
)
