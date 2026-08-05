import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { allowedIdentity, scanSourceInputs } from './source-redaction.mjs'

async function scanFixture(files, expectedOccurrences = new Map()) {
  const root = await mkdtemp(join(tmpdir(), 'guidelane-source-redaction-'))
  try {
    execFileSync('git', ['init', '--quiet'], { cwd: root })
    for (const [relative, contents] of Object.entries(files)) {
      const target = join(root, relative)
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, contents, 'utf8')
    }
    return await scanSourceInputs(root, { minimumSourceFiles: 1, expectedOccurrences })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

test('source redaction accepts the exact local identity only at an expected source location and retains the hostile fixture exception', async () => {
  const hostilePath = ['', 'Users', 'alice', 'private.ts'].join('/')
  const result = await scanFixture({
    'identity.ts': allowedIdentity,
    'packages/orchestrator/test-fixtures/redaction-hostile-payloads.json': JSON.stringify({ hostilePath }),
  }, new Map([['identity.ts', 1]]))
  assert.equal(result.scannedSourceFiles, 2)
  assert.ok(result.scannedSourceBytes > 0)
})

test('source redaction rejects an unexpected occurrence of the local identity', async () => {
  await assert.rejects(
    scanFixture({ 'unexpected.txt': allowedIdentity }),
    /unexpected required local identity occurrence count/,
  )
})

test('source redaction rejects a prefix or suffix around the local identity instead of masking a substring', async () => {
  await assert.rejects(
    scanFixture({ 'prefix.txt': `alice-${allowedIdentity}` }),
    /redaction violation/,
  )
  await assert.rejects(
    scanFixture({ 'suffix.txt': `${allowedIdentity}.example` }),
    /redaction violation/,
  )
  await assert.rejects(
    scanFixture({ 'overlap-suffix.txt': `${allowedIdentity}@example.com` }),
    /redaction violation/,
  )
  await assert.rejects(
    scanFixture({ 'overlap-prefix.txt': `other@${allowedIdentity}` }),
    /redaction violation/,
  )
})

test('source redaction preserves other sensitive values on a line containing the allowed identity', async () => {
  const realAddress = ['alice', 'example.invalid'].join('@')
  await assert.rejects(
    scanFixture({ 'mixed.txt': `${allowedIdentity} ${realAddress}` }, new Map([['mixed.txt', 1]])),
    /redaction violation/,
  )
})

test('source redaction rejects a copied hostile payload fixture', async () => {
  const hostilePath = ['', 'Users', 'alice', 'private.ts'].join('/')
  await assert.rejects(
    scanFixture({ 'copied-fixture.json': JSON.stringify({ hostilePath }) }),
    /redaction violation/,
  )
})
