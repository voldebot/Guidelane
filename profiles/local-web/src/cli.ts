import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { generateProject } from './generator.ts'
import { runNormalHarness, runSeededHarness } from './harness.ts'

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  const value = index >= 0 ? process.argv[index + 1] : undefined
  return value && !value.startsWith('--') ? value : undefined
}

async function main(): Promise<number> {
  const [mode, requestedDirectory] = process.argv.slice(2)
  if (mode === 'generate') {
    const directory = resolve(requestedDirectory && !requestedDirectory.startsWith('--') ? requestedDirectory : option('--directory') ?? './generated-local-web')
    const generated = await generateProject(directory)
    process.stdout.write(`${JSON.stringify({ directory: generated.directory, packageName: generated.packageName, initialSnapshot: generated.initialSnapshot })}\n`)
    return 0
  }
  if (mode === 'normal' || mode === 'seeded') {
    const artifacts = resolve(option('--artifacts') ?? './.local-web-evidence')
    await mkdir(artifacts, { recursive: true })
    return mode === 'normal' ? runNormalHarness(artifacts) : runSeededHarness(artifacts)
  }
  process.stderr.write('usage: cli.ts generate [directory] | normal [--artifacts path] | seeded [--artifacts path]\n')
  return 2
}

main().then((exitCode) => process.exitCode = exitCode).catch((error: unknown) => {
  process.stderr.write(error instanceof Error ? `${error.name}: ${error.message}\n` : 'profile command failed\n')
  process.exitCode = 1
})
