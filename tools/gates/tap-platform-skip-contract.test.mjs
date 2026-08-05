import assert from 'node:assert/strict'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import test from 'node:test'

const root = resolve(new URL('../..', import.meta.url).pathname)
const artifactSkip = 'S2-F29-ARTIFACT-ROOT-02'
const cockpitSkip = 'S2-F29-COCKPIT-ROOT-03'

async function runFixture(change = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'guidelane-platform-skip-contract-'))
  const bin = join(directory, 'bin')
  const artifacts = join(directory, 'artifacts')
  try {
    const inventory = JSON.parse(await readFile(join(root, 'tools/gates/s2-test-inventory.json'), 'utf8'))
    const rows = inventory.scenarios.filter((row) => row.executionEvidence?.source === 'orchestrator-tap')
    const lines = []
    for (const row of rows) {
      if (change.missing === row.id) continue
      const title = row.executionEvidence.selector
      const directive = change.skip?.[row.id] === undefined ? '' : ` # SKIP ${change.skip[row.id]}`
      const status = change.failed === row.id ? 'not ok' : 'ok'
      lines.push(`# Subtest: ${title}`, `${status} 1 - ${title}${directive}`)
      if (change.duplicate === row.id) lines.push(`# Subtest: ${title}`, `ok 1 - ${title}`)
    }
    await mkdir(bin)
    const npm = join(bin, 'npm')
    await writeFile(npm, `#!${process.execPath}\nprocess.stdout.write(${JSON.stringify(`${lines.join('\n')}\n`)})\n`, 'utf8')
    await chmod(npm, 0o755)
    const result = await new Promise((resolvePromise, reject) => {
      const child = spawn(process.execPath, ['tools/gates/run-suite.mjs', 'orchestrator', '--artifacts', artifacts], { cwd: root, env: { ...process.env, PATH: `${bin}:${process.env.PATH}` }, stdio: ['ignore', 'ignore', 'pipe'] })
      let stderr = ''
      child.stderr.setEncoding('utf8')
      child.stderr.on('data', (chunk) => { stderr += chunk })
      child.once('error', reject)
      child.once('exit', (code) => resolvePromise({ code, stderr }))
    })
    return result
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

test('only the two frozen Final-29 foreign-owner rows accept their exact privileged-account TAP skip', async () => {
  const accepted = await runFixture({ skip: {
    [artifactSkip]: 'creating a foreign-owned ancestor requires a privileged test account',
    [cockpitSkip]: 'creating a foreign-owned cockpit root requires a privileged test account',
  } })
  assert.equal(accepted.code, 0, `exact platform skips must reconcile: ${accepted.stderr}`)

  const arbitrary = await runFixture({ skip: { [artifactSkip]: 'fixture unavailable today' } })
  assert.notEqual(arbitrary.code, 0, 'an arbitrary skip reason must fail closed')

  const ordinary = await runFixture({ skip: { 'S2-F29-G5-ACTIVE': 'creating a foreign-owned ancestor requires a privileged test account' } })
  assert.notEqual(ordinary.code, 0, 'a skipped non-platform row must fail closed')

  const emptyReason = await runFixture({ skip: { [artifactSkip]: '' } })
  assert.notEqual(emptyReason.code, 0, 'a platform row without its exact skip reason must fail closed')

  const missing = await runFixture({ missing: artifactSkip })
  assert.notEqual(missing.code, 0, 'a missing platform row must fail closed')

  const failed = await runFixture({ failed: cockpitSkip })
  assert.notEqual(failed.code, 0, 'a failed platform row must fail closed')

  const duplicate = await runFixture({ duplicate: artifactSkip })
  assert.notEqual(duplicate.code, 0, 'a duplicate platform row must fail closed')
})
