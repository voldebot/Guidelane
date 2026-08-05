import { access, writeFile } from 'node:fs/promises'

const [marker, value = 'started', release] = process.argv.slice(2)
if (!marker) throw new Error('test-only marker path is required')
await writeFile(marker, value, 'utf8')
if (release) {
  const deadline = Date.now() + 1_000
  while (Date.now() < deadline) {
    try {
      await access(release)
      break
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
  }
}
