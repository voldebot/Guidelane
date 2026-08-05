import { writeFile } from 'node:fs/promises'

const marker = process.env.GUIDELANE_FINAL_22_ENGINE_MARKER
if (!marker) throw new Error('GUIDELANE_FINAL_22_ENGINE_MARKER is required')

await writeFile(marker, 'engine-started\n', 'utf8')
setInterval(() => {}, 1_000)
