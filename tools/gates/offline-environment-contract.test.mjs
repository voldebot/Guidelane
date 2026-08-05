import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { runOffline } from './lib.mjs'

const portable = {
  PATH: '/test/offline-bin',
  HOME: '/test/offline-home',
  LANG: 'tr_TR.UTF-8',
  LC_ALL: 'tr_TR.UTF-8',
  TMPDIR: '/test/offline-tmp',
  TMP: '/test/offline-tmp',
  TEMP: '/test/offline-tmp',
}

const sentinels = {
  GITHUB_TOKEN: 'harmless-github-token',
  NPM_TOKEN: 'harmless-npm-token',
  DATABASE_URL: 'postgres://harmless-sentinel',
  AWS_ACCESS_KEY_ID: 'harmless-aws-access-key',
  AWS_SECRET_ACCESS_KEY: 'harmless-aws-secret',
  CLAUDE_CODE_OAUTH_TOKEN: 'harmless-claude-code-token',
  UNRELATED_SECRET_LIKE_KEY: 'harmless-unrelated-secret',
}

async function withParentEnvironment(callback) {
  const values = { ...portable, ...sentinels }
  const before = new Map(Object.keys(values).map((key) => [key, process.env[key]]))
  try {
    Object.assign(process.env, values)
    await callback()
  } finally {
    for (const [key, value] of before) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

test('runOffline passes only portable context and explicit environment to its child', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'guidelane-offline-environment-'))
  const output = join(temporary, 'environment.json')
  const artifacts = join(temporary, 'cockpit-artifacts')
  try {
    await withParentEnvironment(async () => {
      await runOffline(process.execPath, ['-e', "require('node:fs').writeFileSync(process.argv[1], JSON.stringify(process.env))", output], { env: { COCKPIT_ARTIFACTS: artifacts } })
    })
    const childEnvironment = JSON.parse(await readFile(output, 'utf8'))
    for (const [key, value] of Object.entries(portable)) assert.equal(childEnvironment[key], value, `${key} must cross the offline child boundary`)
    assert.equal(childEnvironment.CI, '1')
    assert.equal(childEnvironment.COCKPIT_ARTIFACTS, artifacts, 'explicit runOffline environment must survive')
    for (const key of Object.keys(sentinels)) assert.equal(childEnvironment[key], undefined, `${key} must not cross the offline child boundary`)
    assert.deepEqual(
      Object.keys(childEnvironment).filter((key) => key !== '__CF_USER_TEXT_ENCODING').sort(),
      [...Object.keys(portable), 'CI', 'COCKPIT_ARTIFACTS'].sort(),
      'offline children must receive no inherited secret-like or unrelated context',
    )
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
})
