import assert from 'node:assert/strict'
import { chmod, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import test from 'node:test'

const root = resolve(new URL('../..', import.meta.url).pathname)

test('cockpit-build publishes build evidence without reconciling unrelated TAP inventory selectors', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'guidelane-cockpit-build-contract-'))
  const bin = join(temporary, 'bin'); const artifacts = join(temporary, 'artifacts')
  await mkdir(bin)
  const npm = join(bin, 'npm')
  await writeFile(npm, `#!${process.execPath}\nconsole.log('fake cockpit build completed')\n`, 'utf8')
  await chmod(npm, 0o755)
  const result = await new Promise((done, reject) => {
    const child = spawn(process.execPath, ['tools/gates/run-suite.mjs', 'cockpit-build', '--artifacts', artifacts], { cwd: root, env: { ...process.env, PATH: `${bin}:${process.env.PATH}` }, stdio: ['ignore', 'pipe', 'pipe'] })
    let stderr = ''; child.stderr.on('data', (chunk) => { stderr += chunk })
    child.once('error', reject); child.once('exit', async (code) => {
      let evidence; try { evidence = JSON.parse(await readFile(join(artifacts, 'result.json'), 'utf8')) } catch { evidence = undefined }
      done({ code, stderr, evidence })
    })
  })
  assert.equal(result.code, 0, `a successful cockpit build must not reconcile orchestrator TAP selectors: ${result.stderr}`)
  assert.equal(result.evidence?.payload?.suite, 'cockpit-build')
  assert.equal(result.evidence?.payload?.command, 'npm run build --workspace=@guidelane/cockpit')
  assert.equal(result.evidence?.payload?.executionEvidence, undefined, 'executionEvidence is not a build claim')
})
