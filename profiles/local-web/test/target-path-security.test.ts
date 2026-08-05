import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { chmod, chown, lstat, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { test } from 'node:test'
import { generateProjectForTest } from './test-helpers.ts'

type Generate = (directory: string) => Promise<unknown>

const cliPath = fileURLToPath(new URL('../src/cli.ts', import.meta.url))
const generatorPath = fileURLToPath(new URL('../src/generator.ts', import.meta.url))

const directGenerate: Generate = async (directory) => generateProjectForTest(directory)

const cliGenerate: Generate = async (directory) => {
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    const child = spawn(process.execPath, ['--experimental-strip-types', cliPath, 'generate', directory], { stdio: 'ignore' })
    child.once('error', reject)
    child.once('exit', (code) => resolve(code))
  })
  if (exitCode !== 0) throw new Error(`Local Web CLI rejected target with exit code ${exitCode}`)
}

async function attempt(generate: Generate, directory: string): Promise<unknown | undefined> {
  try {
    await generate(directory)
    return undefined
  } catch (error: unknown) {
    return error
  }
}

async function assertAbsent(path: string, message: string): Promise<void> {
  await assert.rejects(lstat(path), /ENOENT|no such file/i, message)
}

async function assertRefusesBeforeMutation(generate: Generate, target: string, protectedFile: string, protectedBytes: Buffer): Promise<void> {
  const rejection = await attempt(generate, target)
  assert.deepEqual(await readFile(protectedFile), protectedBytes, 'a refusal must preserve the exact protected bytes')
  await assertAbsent(join(target, 'package.json'), 'a refusal must not create generated files')
  await assertAbsent(join(target, '.git'), 'a refusal must not initialize Git metadata')
  assert.notEqual(rejection, undefined, 'generation must refuse this unsafe target before it mutates it')
}

async function assertSymlinkedAncestorRejected(generate: Generate): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'guidelane-local-web-target-symlink-'))
  const externalDirectory = join(root, 'external-directory')
  const symlinkedAncestor = join(root, 'linked-ancestor')
  const target = join(symlinkedAncestor, 'project')
  const protectedFile = join(externalDirectory, 'external-sentinel.bin')
  const protectedBytes = Buffer.from([0, 255, 10, 71, 117, 105, 100, 101, 108, 97, 110, 101])
  try {
    await mkdir(externalDirectory, { mode: 0o700 })
    await writeFile(protectedFile, protectedBytes)
    await symlink(externalDirectory, symlinkedAncestor, 'dir')
    assert.equal((await lstat(symlinkedAncestor)).isSymbolicLink(), true, 'fixture must contain a symlinked existing ancestor')
    await assertRefusesBeforeMutation(generate, target, protectedFile, protectedBytes)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

async function assertWritableExistingTargetRejected(generate: Generate, label: string, mode: number): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'guidelane-local-web-target-mode-'))
  const target = join(root, 'unsafe-target')
  const protectedFile = join(root, 'root-sentinel.bin')
  const protectedBytes = Buffer.from(`target-${label}\n`, 'utf8')
  try {
    await mkdir(target, { mode: 0o700 })
    await chmod(target, mode)
    await writeFile(protectedFile, protectedBytes)
    await assertRefusesBeforeMutation(generate, target, protectedFile, protectedBytes)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

async function assertWritableExistingAncestorRejected(generate: Generate, label: string, mode: number): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'guidelane-local-web-ancestor-mode-'))
  const ancestor = join(root, 'unsafe-ancestor')
  const target = join(ancestor, 'new-project')
  const protectedFile = join(root, 'root-sentinel.bin')
  const protectedBytes = Buffer.from(`ancestor-${label}\n`, 'utf8')
  try {
    await mkdir(ancestor, { mode: 0o700 })
    await chmod(ancestor, mode)
    await writeFile(protectedFile, protectedBytes)
    await assertRefusesBeforeMutation(generate, target, protectedFile, protectedBytes)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

async function runGenerateInFreshProcess(options: { cwd: string; target: string; temporaryDirectory: string; useCli: boolean }): Promise<{ exitCode: number | null; output: string }> {
  const args = options.useCli
    ? ['--experimental-strip-types', cliPath, 'generate', options.target]
    : ['--experimental-strip-types', '--input-type=module', '--eval', `import { generateProject } from ${JSON.stringify(pathToFileURL(generatorPath).href)}; await generateProject(process.argv[1])`, options.target]
  return new Promise<{ exitCode: number | null; output: string }>((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: options.cwd,
      env: { ...process.env, TMPDIR: options.temporaryDirectory, TMP: options.temporaryDirectory, TEMP: options.temporaryDirectory },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    child.stdout?.setEncoding('utf8').on('data', (chunk: string) => { output += chunk })
    child.stderr?.setEncoding('utf8').on('data', (chunk: string) => { output += chunk })
    child.once('error', reject)
    child.once('exit', (exitCode) => resolve({ exitCode, output }))
  })
}

async function assertFreshChildRefusesBeforeMutation(options: { cwd: string; targetArgument: string; target: string; temporaryDirectory: string; useCli: boolean; sentinel: string; sentinelBytes: Buffer }): Promise<void> {
  const result = await runGenerateInFreshProcess({ cwd: options.cwd, target: options.targetArgument, temporaryDirectory: options.temporaryDirectory, useCli: options.useCli })
  assert.deepEqual(await readFile(options.sentinel), options.sentinelBytes, 'a refusal must preserve the external sentinel bytes')
  await assertAbsent(join(options.target, 'package.json'), 'a refusal must happen before package generation')
  await assertAbsent(join(options.target, '.git'), 'a refusal must happen before Git initialization')
  assert.notEqual(result.exitCode, 0, `a child process must reject an unsafe process-provided anchor: ${result.output}`)
}

async function assertFreshChildAcceptsPrivateAnchor(options: { cwd: string; targetArgument: string; target: string; temporaryDirectory: string }): Promise<void> {
  const result = await runGenerateInFreshProcess({ ...options, useCli: false })
  assert.equal(result.exitCode, 0, `a private current-user process-provided anchor must remain usable: ${result.output}`)
  await lstat(join(options.target, 'package.json'))
  await lstat(join(options.target, '.git'))
}

test('LOCAL-WEB-TARGET-05 generator and CLI refuse a symlinked existing ancestor before mutation', async (t) => {
  await t.test('generator subcase', async () => assertSymlinkedAncestorRejected(directGenerate))
  await t.test('CLI subcase', async () => assertSymlinkedAncestorRejected(cliGenerate))
})

test('LOCAL-WEB-TARGET-06 generator and CLI refuse group- or world-writable existing targets before mutation', async (t) => {
  await t.test('generator group-writable target subcase', async () => assertWritableExistingTargetRejected(directGenerate, 'group-writable', 0o770))
  await t.test('generator world-writable target subcase', async () => assertWritableExistingTargetRejected(directGenerate, 'world-writable', 0o707))
  await t.test('CLI group-writable target subcase', async () => assertWritableExistingTargetRejected(cliGenerate, 'group-writable', 0o770))
  await t.test('CLI world-writable target subcase', async () => assertWritableExistingTargetRejected(cliGenerate, 'world-writable', 0o707))
})

test('LOCAL-WEB-TARGET-07 generator and CLI refuse group- or world-writable nearest existing ancestors before mutation', async (t) => {
  await t.test('generator group-writable ancestor subcase', async () => assertWritableExistingAncestorRejected(directGenerate, 'group-writable', 0o770))
  await t.test('generator world-writable ancestor subcase', async () => assertWritableExistingAncestorRejected(directGenerate, 'world-writable', 0o707))
  await t.test('CLI group-writable ancestor subcase', async () => assertWritableExistingAncestorRejected(cliGenerate, 'group-writable', 0o770))
  await t.test('CLI world-writable ancestor subcase', async () => assertWritableExistingAncestorRejected(cliGenerate, 'world-writable', 0o707))
})

test('LOCAL-WEB-TARGET-08 generator and CLI reject foreign-owned existing targets and nearest ancestors where a test-owned fixture can create them', async (t) => {
  if (typeof process.getuid !== 'function') {
    t.skip('POSIX UID APIs are unavailable')
    return
  }
  if (process.getuid() !== 0) {
    t.skip('creating a foreign-owned fixture requires a privileged test account')
    return
  }

  const root = await mkdtemp(join(tmpdir(), 'guidelane-local-web-target-foreign-owner-'))
  const foreignUid = 1
  try {
    for (const [label, generate] of [['generator', directGenerate], ['CLI', cliGenerate]] as const) {
      for (const fixtureKind of ['target', 'ancestor'] as const) {
        const foreignPath = join(root, `${label}-${fixtureKind}`)
        const target = fixtureKind === 'target' ? foreignPath : join(foreignPath, 'new-project')
        const protectedFile = join(root, `${label}-${fixtureKind}-sentinel.bin`)
        const protectedBytes = Buffer.from(`foreign-owner-${label}-${fixtureKind}\n`, 'utf8')
        await mkdir(foreignPath, { mode: 0o700 })
        await writeFile(protectedFile, protectedBytes)
        await chown(foreignPath, foreignUid, 0)
        assert.notEqual((await lstat(foreignPath)).uid, process.getuid(), 'fixture must not be owned by the current UID')
        try {
          await assertRefusesBeforeMutation(generate, target, protectedFile, protectedBytes)
        } finally {
          await chown(foreignPath, 0, 0)
        }
      }
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('LOCAL-WEB-TARGET-09 generator and CLI accept private, current-user temporary targets', async () => {
  const root = await mkdtemp(join(tmpdir(), 'guidelane-local-web-target-private-'))
  try {
    for (const [label, generate] of [['generator', directGenerate], ['CLI', cliGenerate]] as const) {
      const target = join(root, `${label}-private-target`)
      await mkdir(target, { mode: 0o700 })
      await chmod(target, 0o700)
      await generate(target)
      await lstat(join(target, 'package.json'))
      await lstat(join(target, '.git'))
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('FINAL-29-LOCAL-WEB-ANCHOR-01 fresh generator and CLI children reject unsafe cwd anchors before package or Git mutation', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'guidelane-local-web-unsafe-cwd-anchor-'))
  const unsafeCwd = join(root, 'unsafe-cwd')
  const safeTemp = join(root, 'safe-temp')
  const sentinel = join(unsafeCwd, 'external-sentinel.bin')
  const sentinelBytes = Buffer.from([0, 255, 99, 119, 100])
  try {
    await mkdir(unsafeCwd, { mode: 0o700 })
    await mkdir(safeTemp, { mode: 0o700 })
    await writeFile(sentinel, sentinelBytes)
    await chmod(unsafeCwd, 0o777)
    const canonicalUnsafeCwd = await realpath(unsafeCwd)
    const canonicalSafeTemp = await realpath(safeTemp)
    for (const [label, useCli] of [['direct generator', false], ['CLI', true]] as const) {
      await t.test(label, async () => {
        const targetArgument = `${useCli ? 'cli' : 'direct'}-project`
        await assertFreshChildRefusesBeforeMutation({
          cwd: canonicalUnsafeCwd,
          targetArgument,
          target: join(canonicalUnsafeCwd, targetArgument),
          temporaryDirectory: canonicalSafeTemp,
          useCli,
          sentinel,
          sentinelBytes,
        })
      })
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('FINAL-29-LOCAL-WEB-ANCHOR-02 fresh generator and CLI children reject unsafe TMPDIR anchors before package or Git mutation', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'guidelane-local-web-unsafe-tmp-anchor-'))
  const safeCwd = join(root, 'safe-cwd')
  const unsafeTemporaryDirectory = join(root, 'unsafe-tmp')
  const sentinel = join(unsafeTemporaryDirectory, 'external-sentinel.bin')
  const sentinelBytes = Buffer.from([0, 255, 116, 109, 112])
  try {
    await mkdir(safeCwd, { mode: 0o700 })
    await mkdir(unsafeTemporaryDirectory, { mode: 0o700 })
    await writeFile(sentinel, sentinelBytes)
    await chmod(unsafeTemporaryDirectory, 0o777)
    const canonicalSafeCwd = await realpath(safeCwd)
    const canonicalUnsafeTemporaryDirectory = await realpath(unsafeTemporaryDirectory)
    for (const [label, useCli] of [['direct generator', false], ['CLI', true]] as const) {
      await t.test(label, async () => {
        const target = join(canonicalUnsafeTemporaryDirectory, `${useCli ? 'cli' : 'direct'}-project`)
        await assertFreshChildRefusesBeforeMutation({
          cwd: canonicalSafeCwd,
          targetArgument: target,
          target,
          temporaryDirectory: canonicalUnsafeTemporaryDirectory,
          useCli,
          sentinel,
          sentinelBytes,
        })
      })
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('FINAL-29-LOCAL-WEB-ANCHOR-03 fresh children accept private cwd and TMPDIR anchors', async () => {
  const root = await mkdtemp(join(tmpdir(), 'guidelane-local-web-safe-anchor-'))
  const privateCwd = join(root, 'private-cwd')
  const privateTemporaryDirectory = join(root, 'private-tmp')
  try {
    await mkdir(privateCwd, { mode: 0o700 })
    await mkdir(privateTemporaryDirectory, { mode: 0o700 })
    const canonicalPrivateCwd = await realpath(privateCwd)
    const canonicalPrivateTemporaryDirectory = await realpath(privateTemporaryDirectory)
    await assertFreshChildAcceptsPrivateAnchor({
      cwd: canonicalPrivateCwd,
      targetArgument: 'cwd-project',
      target: join(canonicalPrivateCwd, 'cwd-project'),
      temporaryDirectory: canonicalPrivateTemporaryDirectory,
    })
    const tmpTarget = join(canonicalPrivateTemporaryDirectory, 'tmp-project')
    await assertFreshChildAcceptsPrivateAnchor({
      cwd: canonicalPrivateCwd,
      targetArgument: tmpTarget,
      target: tmpTarget,
      temporaryDirectory: canonicalPrivateTemporaryDirectory,
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('FINAL-37-LOCAL-WEB-ANCHOR-04 fresh generator and CLI reject private cwd and TMPDIR leaves below unsafe existing parents before package or Git mutation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'guidelane-local-web-unsafe-anchor-leaf-'))
  const unsafeCwdParent = join(root, 'unsafe-cwd-parent')
  const privateCwd = join(unsafeCwdParent, 'private-cwd')
  const unsafeTemporaryParent = join(root, 'unsafe-tmp-parent')
  const privateTemporaryDirectory = join(unsafeTemporaryParent, 'private-tmp')
  const safeCwd = join(root, 'safe-cwd')
  const safeTemporaryDirectory = join(root, 'safe-tmp')
  const cwdSentinel = join(unsafeCwdParent, 'cwd-sentinel.bin')
  const temporarySentinel = join(unsafeTemporaryParent, 'tmp-sentinel.bin')
  const cwdSentinelBytes = Buffer.from([0, 255, 99, 119, 100, 45, 37])
  const temporarySentinelBytes = Buffer.from([0, 255, 116, 109, 112, 45, 37])
  try {
    await mkdir(unsafeCwdParent, { mode: 0o700 })
    await chmod(unsafeCwdParent, 0o777)
    await mkdir(privateCwd, { mode: 0o700 })
    await chmod(privateCwd, 0o700)
    await writeFile(cwdSentinel, cwdSentinelBytes)
    await mkdir(unsafeTemporaryParent, { mode: 0o700 })
    await chmod(unsafeTemporaryParent, 0o777)
    await mkdir(privateTemporaryDirectory, { mode: 0o700 })
    await chmod(privateTemporaryDirectory, 0o700)
    await writeFile(temporarySentinel, temporarySentinelBytes)
    await mkdir(safeCwd, { mode: 0o700 })
    await chmod(safeCwd, 0o700)
    await mkdir(safeTemporaryDirectory, { mode: 0o700 })
    await chmod(safeTemporaryDirectory, 0o700)

    if (typeof process.getuid === 'function') {
      assert.equal(Number((await lstat(unsafeCwdParent)).uid), process.getuid(), 'the unsafe cwd parent must be current-user owned')
      assert.equal(Number((await lstat(unsafeTemporaryParent)).uid), process.getuid(), 'the unsafe TMPDIR parent must be current-user owned')
    }

    const cases = [
      { label: 'direct generator relative cwd target', cwd: privateCwd, targetArgument: 'generator-cwd-project', target: join(privateCwd, 'generator-cwd-project'), temporaryDirectory: safeTemporaryDirectory, useCli: false, sentinel: cwdSentinel, sentinelBytes: cwdSentinelBytes },
      { label: 'CLI relative cwd target', cwd: privateCwd, targetArgument: 'cli-cwd-project', target: join(privateCwd, 'cli-cwd-project'), temporaryDirectory: safeTemporaryDirectory, useCli: true, sentinel: cwdSentinel, sentinelBytes: cwdSentinelBytes },
      { label: 'direct generator absolute TMPDIR target', cwd: safeCwd, targetArgument: join(privateTemporaryDirectory, 'generator-tmp-project'), target: join(privateTemporaryDirectory, 'generator-tmp-project'), temporaryDirectory: privateTemporaryDirectory, useCli: false, sentinel: temporarySentinel, sentinelBytes: temporarySentinelBytes },
      { label: 'CLI absolute TMPDIR target', cwd: safeCwd, targetArgument: join(privateTemporaryDirectory, 'cli-tmp-project'), target: join(privateTemporaryDirectory, 'cli-tmp-project'), temporaryDirectory: privateTemporaryDirectory, useCli: true, sentinel: temporarySentinel, sentinelBytes: temporarySentinelBytes },
    ] as const
    const failures: Array<{ label: string; error: unknown }> = []
    for (const fixture of cases) {
      try {
        await assertFreshChildRefusesBeforeMutation(fixture)
      } catch (error: unknown) {
        failures.push({ label: fixture.label, error })
      }
    }
    assert.equal(failures.length, 0, failures.map(({ label, error }) => `${label}: ${error instanceof Error ? error.message : String(error)}`).join('; '))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
