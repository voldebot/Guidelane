import { spawn } from 'node:child_process'
import { writeFile } from 'node:fs/promises'

const marker = process.env.GUIDELANE_FINAL_22_GRANDCHILD_MARKER
if (!marker) throw new Error('GUIDELANE_FINAL_22_GRANDCHILD_MARKER is required')

const grandchild = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1_000)'], { stdio: 'ignore' })
await writeFile(marker, JSON.stringify({ enginePid: process.pid, grandchildPid: grandchild.pid }), 'utf8')
setInterval(() => {}, 1_000)
