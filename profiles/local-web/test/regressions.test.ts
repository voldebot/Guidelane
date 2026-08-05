import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { generateProjectForTest } from './test-helpers.ts'

async function generatedProject<T>(fn: (directory: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), 'guidelane-local-web-regression-'))
  const directory = join(root, 'project')
  try {
    await generateProjectForTest(directory)
    return await fn(directory)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

async function commandExit(cwd: string, command: string, args: string[]): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'ignore' })
    child.once('error', reject)
    child.once('close', (code) => resolve(code))
  })
}

test('generated package-lock is a resolved npm v3 lock with transitive package entries', async () => {
  await generatedProject(async (directory) => {
    const lock = JSON.parse(await readFile(join(directory, 'package-lock.json'), 'utf8')) as {
      lockfileVersion: number
      packages: Record<string, { resolved?: unknown; integrity?: unknown }>
    }
    assert.equal(lock.lockfileVersion, 3)
    const entries = Object.entries(lock.packages).filter(([path]) => path !== '')
    assert.ok(entries.length > 20, 'a real npm lock contains resolved transitive packages, not only the root package')
    assert.ok(entries.some(([path, entry]) => path === 'node_modules/next' && typeof entry.resolved === 'string' && typeof entry.integrity === 'string'))
    for (const playwrightPackage of ['node_modules/playwright', 'node_modules/playwright-core']) {
      const entry = lock.packages[playwrightPackage]
      assert.equal(typeof entry?.resolved, 'string', `${playwrightPackage} must be resolved in the generated lock`)
      assert.equal(typeof entry?.integrity, 'string', `${playwrightPackage} must carry npm integrity metadata`)
    }
  })
})

test('generated lock passes npm clean-install integrity validation without lifecycle scripts', async () => {
  await generatedProject(async (directory) => {
    assert.equal(await commandExit(directory, 'npm', ['ci', '--ignore-scripts', '--dry-run']), 0)
  })
})

test('normal harness cannot install local tool shims and records commands backed by real generated scripts', async () => {
  const harness = await readFile(new URL('../src/harness.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(harness, /installHarnessShims|\.\/shims\.ts/)
  assert.doesNotMatch(harness, /GUIDELANE_PROFILE_FIXTURE|GUIDELANE_HEALTH_FILE/)

  await generatedProject(async (directory) => {
    const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8')) as { scripts: Record<string, string> }
    for (const script of ['lint', 'typecheck', 'unit', 'build', 'start', 'health', 'axe', 'smoke']) {
      assert.equal(typeof manifest.scripts[script], 'string', `${script} must be an executable generated npm script`)
      assert.doesNotMatch(manifest.scripts[script]!, /gate-|guidelane|fixture|shim/i, `${script} must invoke its real toolchain, not a harness substitute`)
    }
    assert.match(manifest.scripts.lint!, /(?:^|\s)eslint(?:\s|$)/)
    assert.match(manifest.scripts.typecheck!, /(?:^|\s)tsc(?:\s|$)/)
    assert.match(manifest.scripts.build!, /(?:^|\s)next(?:\s|$)/)
    assert.match(manifest.scripts.start!, /(?:^|\s)next(?:\s|$)/)
  })
})

test('each seeded failure is a targeted isolated source/config mutation, never a marker file or fixed synthetic exit', async () => {
  const harness = await readFile(new URL('../src/harness.ts', import.meta.url), 'utf8')
  const generator = await readFile(new URL('../src/generator.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(harness, /\.guidelane-seed\.json|writeSeed|SEED_EXIT_CODE|seed-fixture/i)
  assert.doesNotMatch(generator, /\.guidelane-seed\.json|seedGate|failIfSeeded|process\.exit\(73\)|GUIDELANE_PROFILE_FIXTURE/i)

  // A mutation map is an auditable public harness contract: each gate names the
  // isolated project file/config it changes and the real command that observes it.
  for (const gate of ['lint', 'type', 'unit', 'build', 'boot', 'axe', 'smoke']) {
    assert.match(harness, new RegExp(`(?:seedMutations|mutations)[\\s\\S]*${gate}`, 'i'), `${gate} needs a real mutation recipe`)
  }
})

test('a clean generated project exposes all real release scripts without a Guidelane runtime dependency', async () => {
  await generatedProject(async (directory) => {
    const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>
      devDependencies: Record<string, string>
      scripts: Record<string, string>
    }
    for (const script of ['lint', 'typecheck', 'unit', 'build', 'start', 'health', 'axe', 'smoke']) assert.ok(manifest.scripts[script])
    for (const dependency of [...Object.keys(manifest.dependencies), ...Object.keys(manifest.devDependencies)]) {
      assert.equal(dependency.toLowerCase().includes('guidelane'), false, `generated project must not carry Guidelane runtime: ${dependency}`)
    }
  })
})
