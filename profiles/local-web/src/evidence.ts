import { createHash, randomUUID } from 'node:crypto'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export function evidenceIdentity(prefix: string): string {
  return `${prefix}-${randomUUID()}`
}

export function digestJson(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

export async function writeEvidence<T extends object>(root: string, relativePath: string, value: T): Promise<string> {
  const target = join(root, relativePath)
  const temporary = `${target}.${randomUUID()}.tmp`
  await mkdir(dirname(target), { recursive: true })
  const payload = Object.prototype.hasOwnProperty.call(value, 'digest')
    ? value
    : { ...value, digest: digestJson(value) }
  const serialized = `${JSON.stringify(payload, null, 2)}\n`
  await writeFile(temporary, serialized, { encoding: 'utf8', mode: 0o600 })
  await rename(temporary, target)
  return relativePath
}

export function redactedFailureCode(gate: string, result: { exitCode: number | null; timedOut: boolean }): string {
  if (result.timedOut) return `${gate}:timeout`
  if (result.exitCode === null) return `${gate}:signal`
  return `${gate}:command-failed`
}
