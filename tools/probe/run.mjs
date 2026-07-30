#!/usr/bin/env node
// MAP: CLI entry for the Guidelane S0 engine-conformance probe.
// USAGE: node tools/probe/run.mjs [--live] [--only id,id] [--kind k,k] [--model m] [--out dir]
// EXIT: 0 green · 1 the engine's contract changed · 2 the harness broke ·
//       3 inconclusive (stall/capacity — says nothing about the engine) ·
//       4 an expected operator condition (another run holds the lock).
// WHY: ADR-001 makes this a standing obligation — it runs nightly against the
//      latest CLI so engine breakage is discovered by the project, not by a user.

import { writeFileSync, readFileSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

import {
  parseArgs, runSuite, renderMarkdown, spawnCapture, scrubbedChildEnv, killAllChildren,
  activeLock,
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
  --update-baseline    Rewrite tools/probe/baseline.json from this run (full --live only).
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
  // (a path under the runner's work tree, not /tmp) — CI writes its report outside the working
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
  report.exercisedVersion = version
  const safe = redactDeep({ version, generatedAt, ...report })
  writeFileSync(jsonPath, JSON.stringify(safe, null, 2))
  // Render from the REDACTED object, not the raw one. `redactString` over the
  // finished markdown applies the value-shaped rules but not the key-name
  // deny-list — and orgName is an arbitrary string with no regex shape. Safe
  // today only because renderMarkdown never prints evidence; the moment it does
  // (e.g. to show a human the stream-union table) that becomes a live leak.
  writeFileSync(mdPath, redactString(renderMarkdown(safe, { version, generatedAt })))

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
    const why = [
      !opts.live ? 'no --live' : null,
      opts.only ? `--only ${opts.only.join(',')}` : null,
      opts.kinds ? `--kind ${opts.kinds.join(',')}` : null,
      ...(report.runScope.nonDefault || []),
    ].filter(Boolean)
    process.stderr.write(
      `\nPartial run (${why.join('; ')}) — wrote *${suffix}* files, left the canonical report untouched.\n` +
        `Finish with a full \`--live\` run before committing.\n`
    )
  }

  // Baseline gate. Gating only on fail+error means the suite's steady state
  // (two standing PARTIALs) hides any third probe degrading PASS -> PARTIAL.
  // Drift is checked in BOTH directions: a probe improving is also news, because
  // it means a documented limitation lifted and the ADR text is now stale.
  const drift = checkBaseline(report, opts)
  if (drift.length) {
    process.stderr.write('\nBASELINE DRIFT — expected status changed:\n')
    for (const d of drift) process.stderr.write(`  ${d.id}: ${d.expected} -> ${d.actual}\n`)
    process.stderr.write(
      `\nIf this is a real regression, fix it. If the new status is correct, re-run with\n` +
      `--update-baseline and commit ${BASELINE_REL} on its own so the change is reviewable.\n`
    )
  }

  // Distinct exit codes, because a nightly job that cannot tell "the engine
  // changed" from "my laptop slept" earns alarm fatigue and then gets ignored —
  // and it is the project's only automated drift detector.
  //   0 = green · 1 = the engine's contract changed (or drifted from baseline)
  //   2 = the harness broke · 3 = inconclusive; says nothing about the engine
  if (c.fail + c.error > 0) return 1
  if (drift.length) return 1
  if (c.inconclusive > 0) return 3
  return 0
}

const BASELINE_REL = 'tools/probe/baseline.json'

/**
 * Compare this run's statuses against the committed expectation.
 *
 * Only a COMPLETE run may rewrite the baseline: a filtered run knows nothing
 * about the probes it skipped, and letting it write would silently shrink the
 * expectation set. Skipped and inconclusive probes are ignored — they carry no
 * verdict about the engine.
 */
function checkBaseline(report, opts) {
  const path = join(REPO_ROOT, BASELINE_REL)
  const judged = report.results.filter((r) => r.status !== 'skip' && r.status !== 'inconclusive')

  if (opts.updateBaseline) {
    if (!report.runScope.complete) {
      process.stderr.write('Refusing to update the baseline from a partial run — use a full `--live` run.\n')
      return []
    }
    const next = {
      _comment:
        'Expected probe statuses. Regenerate ONLY with `node tools/probe/run.mjs --live --update-baseline`, ' +
        'and commit this file on its own so the change is reviewable. Editing it by hand to silence a red ' +
        'build defeats the point.',
      // ONE baseline, asserted in BOTH environments — deliberately, not by
      // omission. This file is generated on macOS with the owner signed in and
      // then asserted by CI on a logged-out Linux runner, and the free tier has
      // agreed across both from the start. Splitting it (baseline.free.json /
      // baseline.live.json) or adding a per-tier expectation would sanction a
      // divergence that does not exist, and would leave each environment
      // unchecked by the other — a free probe regressing on macOS would be
      // caught nowhere.
      //
      // THE RULE: a probe whose STATUS depends on the environment is measuring
      // the environment, not the engine. Fix the probe, never the baseline.
      // `p-auth-mode-visibility` is the worked example — it branches on
      // `loggedIn` and asserts something different but equally meaningful in
      // each case, so its status is stable while its assertion is not.
      //
      // `generatedOn` exists so that IF the two ever disagree, the report can
      // say which environment produced the expectation instead of leaving
      // someone to guess.
      // Derived from a probe that already measured it, rather than spending a
      // second `auth status` call to learn something the run already knows.
      generatedOn: {
        platform: process.platform,
        loggedIn: (() => {
          const p = report.results.find((r) => r.id === 'p-auth-mode-visibility')
          const v = p && p.evidence && p.evidence.loggedIn
          return v === true || v === false ? v : null
        })(),
      },
      engineVersion: report.exercisedVersion || null,
      expected: Object.fromEntries(judged.map((r) => [r.id, r.status])),
    }
    writeFileSync(path, JSON.stringify(next, null, 2) + '\n')
    process.stderr.write(`Baseline updated: ${BASELINE_REL} (${judged.length} probes)\n`)
    return []
  }

  let baseline
  try {
    baseline = JSON.parse(readFileSync(path, 'utf8'))
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      process.stderr.write(`No ${BASELINE_REL} yet — run with --update-baseline after a full --live run.\n`)
      return []
    }
    // Unreadable or corrupt is NOT "absent". One catch used to cover ENOENT,
    // EACCES and a SyntaxError alike, so a merge conflict left in this file
    // printed "No baseline yet", returned no drift, and exited 0 green — the
    // one file whose job is to make a red build unshippable, silently inert.
    throw new Error(
      `${BASELINE_REL} is unreadable (${err.code || err.name}: ${err.message}). ` +
      `The drift gate cannot run; refusing to report a gated result.`
    )
  }
  if (!baseline || typeof baseline.expected !== 'object' || baseline.expected === null) {
    throw new Error(`${BASELINE_REL} has no \`expected\` map — the drift gate cannot run.`)
  }

  const drift = []
  // REVIEW-02 C4: a version change with no re-run is a CI failure. The baseline
  // recorded engineVersion from the start and nothing ever compared it, so an
  // auto-update could move the engine under a clean-diffing baseline.
  // Compare the semver triple, not the whole `--version` line. A cosmetic
  // change to the parenthetical ("(Claude Code)" -> "(Claude Code CLI)") would
  // otherwise fire the loudest gate the suite has, for a version that did not
  // change — which is exactly the alarm fatigue the exit codes exist to avoid.
  const semverOf = (s) => (String(s || '').match(/(\d+\.\d+\.\d+)/) || [])[1] || null
  const expectedV = semverOf(baseline.engineVersion)
  const actualV = semverOf(report.exercisedVersion)
  if (expectedV && actualV && expectedV !== actualV) {
    drift.push({ id: '(engine version)', expected: expectedV, actual: actualV })
  }
  // Informational, NOT drift. Asserting across environments is the design; the
  // note exists so a future disagreement is attributable on sight rather than
  // debugged from scratch.
  const gen = baseline.generatedOn
  if (gen && gen.platform && gen.platform !== process.platform) {
    process.stderr.write(
      `Note: this baseline was generated on ${gen.platform}` +
      `${gen.loggedIn === false ? ' (logged out)' : gen.loggedIn === true ? ' (signed in)' : ''}` +
      `; asserting it on ${process.platform}. That is intended — a probe whose status differs by ` +
      `environment is measuring the environment, so any drift below is a probe bug, not a tiering problem.\n`
    )
  }
  for (const r of judged) {
    const expected = baseline.expected[r.id]
    // An unrecorded probe IS drift. The previous `continue` here meant a newly
    // added probe was exempt from the gate — so the way to ship a red probe was
    // to add one, and the baseline's whole purpose is to make that impossible.
    // Recording an expectation must be a deliberate act, including the first
    // time.
    if (expected === undefined) {
      drift.push({ id: r.id, expected: '(unrecorded)', actual: r.status })
      continue
    }
    if (expected !== r.status) drift.push({ id: r.id, expected, actual: r.status })
  }
  // A probe that vanished from the run is only drift on a complete run.
  if (report.runScope.complete) {
    for (const id of Object.keys(baseline.expected)) {
      if (!report.results.some((r) => r.id === id)) drift.push({ id, expected: baseline.expected[id], actual: 'missing' })
    }
  }
  return drift
}

// Reap the tree on every exit route. Children are spawned detached (their own
// process group) so they no longer receive the terminal's Ctrl-C; without these
// handlers a cancelled run leaves an authenticated `claude` burning quota.
let shuttingDown = false

// Every hard exit bypasses runSuite's `finally`, so Ctrl-C used to leave the
// cross-process lockfile behind on every single interrupt. It only ever
// self-healed because the lock ALSO used to steal from a live holder past its
// TTL — two defects propping each other up, where fixing either alone would
// have exposed the other.
const bail = (code) => {
  try { activeLock?.release() } catch { /* best effort */ }
  killAllChildren()
  process.exit(code)
}

for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(sig, () => {
    if (shuttingDown) process.exit(130)
    shuttingDown = true
    process.stderr.write(`\nReceived ${sig} — killing engine children.\n`)
    bail(130)
  })
}
process.on('uncaughtException', (err) => {
  process.stderr.write(`Harness crashed: ${(err && err.stack) || err}\n`)
  bail(2)
})

main().then(
  // killAllChildren() was justified in a comment as running "at exit" and had
  // no normal-path caller at all: a retained child on the SIGKILL_NO_CLOSE path
  // survived a green run, still authenticated, still spending quota.
  (code) => bail(code),
  (err) => {
    // An expected operator condition is not a harness fault. Printing it as
    // `Harness crashed:` + a stack under exit 2 made the launchd job unable to
    // tell "someone else is running" from "the suite is broken", and buried the
    // guidance the message carries.
    if (err && err.name === 'ProbeUsageError') {
      process.stderr.write(`${err.message}\n`)
      bail(err.exitCode || 4)
    }
    process.stderr.write(`Harness crashed: ${(err && err.stack) || err}\n`)
    bail(2)
  }
)
