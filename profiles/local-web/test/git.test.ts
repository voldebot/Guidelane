import assert from 'node:assert/strict'
import { access, chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { acceptSnapshot, acceptedSnapshots, initializeRepository, readLocalIdentity } from '../src/git.ts'
import { generateProjectForTest } from './test-helpers.ts'

const FINAL_39_SECRET = 'final-39-harmless-secret'

interface TrustedGitTestSeam {
  withUnavailableTrustedGitForTest<T>(callback: () => T | Promise<T>): Promise<T>
}

interface HostileGitMarkers {
  counterfeit: string
  hook: string
  template: string
}

async function readOptionalBytes(path: string): Promise<Buffer | null> {
  try {
    return await readFile(path)
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

async function withHostileGitParentEnvironment<T>(root: string, callback: (markers: HostileGitMarkers) => Promise<T>): Promise<T> {
  const counterfeitDirectory = join(root, 'counterfeit-bin')
  const templateDirectory = join(root, 'hostile-template')
  const hooksDirectory = join(root, 'hostile-hooks')
  const configuration = join(root, 'hostile-gitconfig')
  const markers = {
    counterfeit: join(root, 'counterfeit-git-marker.bin'),
    hook: join(root, 'hostile-hook-marker.bin'),
    template: join(templateDirectory, 'FINAL-39-template-sentinel.bin'),
  }
  await mkdir(join(templateDirectory, 'hooks'), { recursive: true })
  await mkdir(hooksDirectory, { recursive: true })
  await mkdir(counterfeitDirectory, { recursive: true })
  await writeFile(markers.template, Buffer.from([0, 255, 70, 73, 78, 65, 76, 45, 51, 57, 10]))
  await writeFile(
    join(counterfeitDirectory, 'git'),
    `#!/bin/sh\nprintf 'FINAL-39 counterfeit git\\nsecret=%s\\nconfig=%s\\ntemplate=%s\\nhooks=%s\\n' "\${GUIDELANE_FINAL_39_SECRET-}" "\${GIT_CONFIG_GLOBAL-}" "\${GIT_TEMPLATE_DIR-}" "\${GIT_CONFIG_VALUE_0-}" > '${markers.counterfeit}'\nexec /usr/bin/git "$@"\n`,
    'utf8',
  )
  await writeFile(
    join(hooksDirectory, 'post-commit'),
    `#!/bin/sh\nprintf 'FINAL-39 hostile hook\\nsecret=%s\\n' "\${GUIDELANE_FINAL_39_SECRET-}" > '${markers.hook}'\n`,
    'utf8',
  )
  await chmod(join(counterfeitDirectory, 'git'), 0o755)
  await chmod(join(hooksDirectory, 'post-commit'), 0o755)
  await writeFile(configuration, `[init]\n\ttemplateDir = ${templateDirectory}\n[core]\n\thooksPath = ${hooksDirectory}\n`, 'utf8')

  const hostile = {
    PATH: `${counterfeitDirectory}:${process.env.PATH ?? ''}`,
    GIT_CONFIG_GLOBAL: configuration,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'core.hooksPath',
    GIT_CONFIG_VALUE_0: hooksDirectory,
    GIT_TEMPLATE_DIR: templateDirectory,
    GUIDELANE_FINAL_39_SECRET: FINAL_39_SECRET,
  }
  const previous = new Map(Object.keys(hostile).map((key) => [key, process.env[key]]))
  try {
    Object.assign(process.env, hostile)
    return await callback(markers)
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

test('accepted snapshots use only the repository-local Guidelane identity and rollback preserves artifact history', async () => {
  const root = await mkdtemp(join(tmpdir(), 'guidelane-local-web-git-'))
  try {
    const project = join(root, 'project')
    await generateProjectForTest(project)
    const identity = readLocalIdentity(project)
    assert.deepEqual(identity, { name: 'Guidelane', email: 'guidelane@local.invalid' })
    await writeFile(join(project, 'app', 'page.tsx'), 'export default function HomePage() { return <main>Changed</main> }\n', 'utf8')
    const second = acceptSnapshot(project, 'changed app')
    await mkdir(join(project, '.guidelane', 'artifacts'), { recursive: true })
    await writeFile(join(project, '.guidelane', 'artifacts', 'history.json'), '{"schemaVersion":1}\n', 'utf8')
    const module = await import('../src/git.ts')
    const rollback = module.rollbackToPreviousAcceptedSnapshot(project)
    assert.equal(rollback.previousSnapshot, acceptedSnapshots(project).find((snapshot) => snapshot.hash !== second)?.hash)
    assert.equal((await readFile(join(project, 'app', 'page.tsx'), 'utf8')).includes('Changed'), false)
    assert.equal((await readFile(join(project, '.guidelane', 'artifacts', 'history.json'), 'utf8')).includes('schemaVersion'), true)
  } finally {
    await import('node:fs/promises').then(({ rm }) => rm(root, { recursive: true, force: true }))
  }
})

test('FINAL-39-LOCAL-WEB-GIT-01 generated repository Git execution uses a trusted absolute executable and finite environment, rejecting PATH, Git-control, and secret-like inheritance', async () => {
  const root = await mkdtemp(join(tmpdir(), 'guidelane-local-web-final-39-git-'))
  const project = join(root, 'project')
  const unavailableProject = join(root, 'unavailable-project')
  try {
    await withHostileGitParentEnvironment(root, async (markers) => {
      let generationFailure: unknown
      try {
        await generateProjectForTest(project)
      } catch (error: unknown) {
        generationFailure = error
      }

      assert.deepEqual(await readOptionalBytes(markers.counterfeit), null, 'the counterfeit PATH git must not execute or receive the secret sentinel')
      assert.deepEqual(await readOptionalBytes(markers.hook), null, 'hostile Git configuration/hooks must not execute or receive the secret sentinel')
      assert.deepEqual(await readOptionalBytes(join(project, '.git', 'FINAL-39-template-sentinel.bin')), null, 'hostile Git template bytes must not reach the generated repository')
      assert.equal(generationFailure, undefined, 'generation must succeed after rejecting hostile parent Git controls')

      assert.deepEqual(readLocalIdentity(project), { name: 'Guidelane', email: 'guidelane@local.invalid' })
      const originalPage = await readFile(join(project, 'app', 'page.tsx'))
      const changedPage = Buffer.from('export default function HomePage() { return <main>FINAL-39 changed</main> }\n')
      await writeFile(join(project, 'app', 'page.tsx'), changedPage)
      const accepted = acceptSnapshot(project, 'FINAL-39 changed app')
      await mkdir(join(project, '.guidelane', 'artifacts'), { recursive: true })
      const artifact = Buffer.from([0, 255, 70, 73, 78, 65, 76, 45, 51, 57, 10])
      await writeFile(join(project, '.guidelane', 'artifacts', 'history.bin'), artifact)
      const gitModule = await import('../src/git.ts')
      const rollback = gitModule.rollbackToPreviousAcceptedSnapshot(project)
      assert.equal(rollback.previousSnapshot, acceptedSnapshots(project).find((snapshot) => snapshot.hash !== accepted)?.hash)
      assert.deepEqual(await readFile(join(project, 'app', 'page.tsx')), originalPage, 'rollback must restore the exact accepted project bytes')
      assert.deepEqual(await readFile(join(project, '.guidelane', 'artifacts', 'history.bin')), artifact, 'rollback must preserve ignored artifact bytes')

      const testSeam = gitModule as unknown as TrustedGitTestSeam
      assert.equal(typeof testSeam.withUnavailableTrustedGitForTest, 'function', 'Git must expose only a lexical test seam that forces trusted-executable unavailability without consulting environment input')
      await mkdir(unavailableProject)
      const unavailableSentinel = Buffer.from([0, 255, 117, 110, 97, 118, 97, 105, 108, 97, 98, 108, 101, 10])
      await writeFile(join(unavailableProject, 'sentinel.bin'), unavailableSentinel)
      await assert.rejects(
        testSeam.withUnavailableTrustedGitForTest(() => initializeRepository(unavailableProject)),
        /trusted.*git|git.*trusted|unavailable|executable/i,
        'unavailable trusted Git must fail closed',
      )
      assert.deepEqual(await readFile(join(unavailableProject, 'sentinel.bin')), unavailableSentinel, 'trusted Git resolution failure must preserve exact caller bytes')
      await assert.rejects(access(join(unavailableProject, '.git')), /ENOENT|no such file/i, 'trusted Git resolution failure must precede repository mutation')
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
