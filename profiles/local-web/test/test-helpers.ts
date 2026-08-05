import { generatedManifest, generateProject } from '../src/generator.ts'

export function generateManifestForTest(): Record<string, unknown> {
  return generatedManifest()
}

export async function generateProjectForTest(directory: string): Promise<void> {
  await generateProject(directory)
}
