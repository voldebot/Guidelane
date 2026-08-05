import assert from 'node:assert/strict'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { generateManifestForTest, generateProjectForTest } from './test-helpers.ts'

test('the generated manifest pins the Local Web contract without Guidelane runtime coupling', async () => {
  const manifest = generateManifestForTest()
  const dependencies = manifest.dependencies as Record<string, string>
  const devDependencies = manifest.devDependencies as Record<string, string>
  assert.equal(dependencies.next, '15.5.22')
  assert.equal(dependencies.react, '19.1.1')
  assert.equal(dependencies['drizzle-orm'], '0.45.2')
  assert.equal(dependencies['better-sqlite3'], '12.0.0')
  assert.equal(devDependencies.tailwindcss, '4.1.13')
  assert.equal(devDependencies.playwright, '1.62.1')
  assert.equal(devDependencies['eslint-config-next'], dependencies.next, 'eslint-config-next must track the exact Next pin')
  assert.equal(devDependencies['@axe-core/playwright'], '4.10.2')
  const overrides = manifest.overrides as Record<string, string>
  assert.deepEqual(overrides, { postcss: '8.5.18', sharp: '0.35.1' })
  assert.equal(Object.keys(dependencies).some((name) => name.includes('guidelane')), false)
})

test('generation writes a lock/template contract and ejectable app files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'guidelane-local-web-test-'))
  const project = join(root, 'project')
  try {
    await generateProjectForTest(project)
    const lock = JSON.parse(await readFile(join(project, 'package-lock.json'), 'utf8')) as { lockfileVersion: number; packages: Record<string, unknown> }
    assert.equal(lock.lockfileVersion, 3)
    assert.ok(lock.packages[''])
    for (const file of [
      'app/page.tsx',
      'app/globals.css',
      'app/api/health/route.ts',
      'drizzle/schema.ts',
      'next.config.ts',
      'scripts/health.mjs',
      'scripts/axe.mjs',
      'scripts/smoke.mjs',
    ]) {
      await readFile(join(project, file), 'utf8')
    }
  } finally {
    await import('node:fs/promises').then(({ rm }) => rm(root, { recursive: true, force: true }))
  }
})

test('S2-F24-F generated readiness binds health, axe, and smoke to a cryptographically random child BOOT_INSTANCE_NONCE', async () => {
  const root = await mkdtemp(join(tmpdir(), 'guidelane-local-web-final24-nonce-'))
  const project = join(root, 'project')
  try {
    await generateProjectForTest(project)
    const health = await readFile(join(project, 'scripts/health.mjs'), 'utf8')
    const route = await readFile(join(project, 'app/api/health/route.ts'), 'utf8')
    const axe = await readFile(join(project, 'scripts/axe.mjs'), 'utf8')
    const smoke = await readFile(join(project, 'scripts/smoke.mjs'), 'utf8')
    const foreign = createServer((_request, response) => { response.setHeader('content-type', 'application/json'); response.end(JSON.stringify({ ok: true, service: 'local-web', bootInstanceNonce: 'wrong-nonce' })) })
    await new Promise<void>((resolvePromise, reject) => { foreign.once('error', reject); foreign.listen(0, '127.0.0.1', () => resolvePromise()) })
    try {
      const address = foreign.address() as AddressInfo
      const exitCode = await new Promise<number | null>((resolvePromise, reject) => {
        const child = spawn(process.execPath, ['scripts/health.mjs'], { cwd: project, env: { PATH: process.env.PATH ?? '', LOCAL_WEB_BASE_URL: `http://127.0.0.1:${address.port}`, BOOT_INSTANCE_NONCE: 'expected-nonce' }, stdio: 'ignore' })
        child.once('error', reject); child.once('exit', (code) => resolvePromise(code))
      })
      assert.notEqual(exitCode, 0, 'a foreign loopback listener with a wrong nonce must fail health before axe and smoke can trust it')
    } finally { await new Promise<void>((resolvePromise, reject) => foreign.close((error) => error ? reject(error) : resolvePromise())) }
    for (const script of [health, axe, smoke]) assert.match(script, /BOOT_INSTANCE_NONCE/, 'every live readiness consumer must require the exact child nonce')
    assert.match(route, /BOOT_INSTANCE_NONCE/, 'the child health response must attest its own nonce')
    assert.match(route, /random|crypto|getRandomValues/i, 'the per-run child nonce must be cryptographically random, not a static template value')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('LOCAL-WEB-TARGET-01 generates a new target directory with an initial repository', async () => {
  const root = await mkdtemp(join(tmpdir(), 'guidelane-local-web-target-'))
  const project = join(root, 'new-project')
  try {
    await generateProjectForTest(project)
    await access(join(project, 'package.json'))
    await access(join(project, '.git'))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('LOCAL-WEB-TARGET-02 generates into an existing empty target directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'guidelane-local-web-target-'))
  const project = join(root, 'empty-project')
  try {
    await mkdir(project)
    await generateProjectForTest(project)
    await access(join(project, 'package.json'))
    await access(join(project, '.git'))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('LOCAL-WEB-TARGET-03 generator and CLI reject an existing non-empty target before writes or git init', async () => {
  const root = await mkdtemp(join(tmpdir(), 'guidelane-local-web-target-'))
  const generatorTarget = join(root, 'generator-target')
  const cliTarget = join(root, 'cli-target')
  const sentinel = 'do-not-overwrite\nexact-bytes:\u0000\u00ff'
  try {
    for (const target of [generatorTarget, cliTarget]) {
      await mkdir(target)
      await writeFile(join(target, 'sentinel.bin'), sentinel, 'utf8')
    }

    await assert.rejects(generateProjectForTest(generatorTarget), /empty|target|exist|directory/i)
    const cliExit = await new Promise<number | null>((resolvePromise, reject) => {
      const child = spawn(process.execPath, ['--experimental-strip-types', 'profiles/local-web/src/cli.ts', 'generate', cliTarget], { cwd: resolve(process.cwd()), stdio: 'ignore' })
      child.once('error', reject)
      child.once('exit', (code) => resolvePromise(code))
    })
    assert.notEqual(cliExit, 0, 'CLI generation must reject a non-empty destination')
    for (const target of [generatorTarget, cliTarget]) {
      assert.equal(await readFile(join(target, 'sentinel.bin'), 'utf8'), sentinel)
      await assert.rejects(access(join(target, 'package.json')), /ENOENT|no such file/i)
      await assert.rejects(access(join(target, '.git')), /ENOENT|no such file/i)
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('LOCAL-WEB-TARGET-04 rejected existing targets preserve exact user bytes and no repository metadata', async () => {
  const root = await mkdtemp(join(tmpdir(), 'guidelane-local-web-target-'))
  const project = join(root, 'preserved-project')
  const sentinel = Buffer.from([0, 255, 10, 13, 71, 117, 105, 100, 101, 108, 97, 110, 101])
  try {
    await mkdir(project)
    await writeFile(join(project, 'sentinel.bin'), sentinel)
    await assert.rejects(generateProjectForTest(project), /empty|target|exist|directory/i)
    assert.deepEqual(await readFile(join(project, 'sentinel.bin')), sentinel)
    await assert.rejects(access(join(project, '.git')), /ENOENT|no such file/i)
    await assert.rejects(access(join(project, 'package-lock.json')), /ENOENT|no such file/i)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
