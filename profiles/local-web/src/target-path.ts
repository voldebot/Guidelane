import { lstat, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

interface TrustedAnchor {
  lexical: string
  canonical: string
}

function hasErrorCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code
}

function isWithin(anchor: string, target: string): boolean {
  const pathFromAnchor = relative(anchor, target)
  return pathFromAnchor === '' || (!pathFromAnchor.startsWith(`..${sep}`) && pathFromAnchor !== '..' && !isAbsolute(pathFromAnchor))
}

function assertSafeDirectory(path: string, metadata: Awaited<ReturnType<typeof lstat>>): void {
  if (metadata.isSymbolicLink()) throw new Error(`generation target path must not contain a symbolic link: ${path}`)
  if (!metadata.isDirectory()) throw new Error(`generation target path must be a directory: ${path}`)

  const mode = Number(metadata.mode)
  const writableByOthers = (mode & 0o022) !== 0

  if (typeof process.getuid === 'function') {
    const currentUid = process.getuid()
    const ownerUid = Number(metadata.uid)
    if (!Number.isInteger(ownerUid)) throw new Error(`generation target path must be owned by the current user: ${path}`)

    if (ownerUid === currentUid) {
      if (writableByOthers) throw new Error(`generation target path must not be group- or world-writable: ${path}`)
      return
    }

    // Root-owned, non-writable directories are normal operating-system ancestors.
    // A root-owned sticky directory is the standard shared temporary-root shape.
    if (ownerUid === 0 && (!writableByOthers || (mode & 0o1000) !== 0)) return

    throw new Error(`generation target path must be owned by the current user: ${path}`)
  }

  if (writableByOthers) throw new Error(`generation target path must not be group- or world-writable: ${path}`)
}

async function trustedAnchors(): Promise<TrustedAnchor[]> {
  const lexicalAnchors = [...new Set([resolve(process.cwd()), resolve(tmpdir())])]
  const anchors: TrustedAnchor[] = []
  for (const lexical of lexicalAnchors) {
    try {
      const canonical = await realpath(lexical)
      await validateExistingAncestors(canonical)
      anchors.push({ lexical, canonical })
    } catch {
      // Ambient process locations are not trusted when their anchor itself is unsafe.
    }
  }
  return anchors.sort((left, right) => right.lexical.length - left.lexical.length)
}

async function validateFromTrustedAnchor(target: string, anchor: TrustedAnchor): Promise<string> {
  const pathFromAnchor = relative(anchor.lexical, target)
  const canonicalTarget = pathFromAnchor === '' ? anchor.canonical : join(anchor.canonical, pathFromAnchor)

  if (canonicalTarget === anchor.canonical) {
    assertSafeDirectory(canonicalTarget, await lstat(canonicalTarget))
    return canonicalTarget
  }

  let currentPath = anchor.canonical
  for (const part of pathFromAnchor.split(sep)) {
    currentPath = join(currentPath, part)
    let metadata: Awaited<ReturnType<typeof lstat>>
    try {
      metadata = await lstat(currentPath)
    } catch (error: unknown) {
      if (hasErrorCode(error, 'ENOENT')) return canonicalTarget
      throw error
    }
    assertSafeDirectory(currentPath, metadata)
  }
  return canonicalTarget
}

async function validateFromNearestExistingAncestor(target: string): Promise<string> {
  await validateExistingAncestors(target)
  return target
}

async function validateExistingAncestors(target: string): Promise<void> {
  let nearestExisting = target
  const existingComponents: Array<{ path: string; metadata: Awaited<ReturnType<typeof lstat>> }> = []
  while (true) {
    try {
      const metadata = await lstat(nearestExisting)
      const canonical = await realpath(nearestExisting)
      if (canonical !== nearestExisting) {
        throw new Error(`generation target path must not contain a symbolic link: ${nearestExisting}`)
      }
      existingComponents.push({ path: nearestExisting, metadata })
    } catch (error: unknown) {
      if (!hasErrorCode(error, 'ENOENT')) throw error
    }

    const parent = dirname(nearestExisting)
    if (parent === nearestExisting) {
      for (const component of existingComponents.reverse()) assertSafeDirectory(component.path, component.metadata)
      return
    }
    nearestExisting = parent
  }
}

/**
 * Resolves a generation target through a canonical process-provided anchor and
 * validates all existing components before any generation mutation.
 */
export async function validateSafeGenerationTarget(directory: string): Promise<string> {
  const target = resolve(directory)
  const anchors = await trustedAnchors()
  const anchor = anchors.find((candidate) => isWithin(candidate.lexical, target))
  return anchor ? validateFromTrustedAnchor(target, anchor) : validateFromNearestExistingAncestor(target)
}
