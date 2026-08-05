import { writeFile } from 'node:fs/promises'
import { ProjectLock } from '../src/index.ts'

const [root, projectId, readyPath] = process.argv.slice(2)
if (!root || !projectId || !readyPath) throw new Error('root, project id, and readiness path are required')

await ProjectLock.acquire({ root, projectId })
await writeFile(readyPath, JSON.stringify({ pid: process.pid }), 'utf8')
setInterval(() => {}, 1_000)
