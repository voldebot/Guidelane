import { lstat, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { gitSourcePaths } from './lib.mjs'

export const allowedIdentity = 'guidelane@local.invalid'

const sensitive = /\/Users\/[A-Za-z]|\/home\/[A-Za-z]|\/var\/folders\/|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}|\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/i
const credentialEnvironment = /\b(?:ANTHROPIC_API_KEY|OPENAI_API_KEY|DATABASE_URL|GH_TOKEN|GITHUB_TOKEN|GITHUB_PERSONAL_ACCESS_TOKEN|NPM_TOKEN)\b\s*=/
const hostileLiteralFixture = 'packages/orchestrator/test-fixtures/redaction-hostile-payloads.json'
const redactionPolicyTokens = Object.freeze([
  '/users/[a-z]', '/home/[a-z]', '/var/folders/',
  '/private/var/folders/...', '/var/folders/...', '/users/talhamac/...',
])
const identityToken = new RegExp(`(?<![A-Za-z0-9._%+@\\-])${allowedIdentity.replace('.', '\\.')}(?![A-Za-z0-9._%+@\\-])`, 'g')

// These are the only source locations where the non-personal generated-project
// identity is required. Every other source path must remain free of email-like
// literals, and a prefix/suffix of this value is never normalized.
export const expectedIdentityOccurrences = Object.freeze(new Map([
  ['docs/research/sprint-03-novice-pilot/RESEARCH.md', 1],
  ['profiles/local-web/src/git.ts', 1],
  ['profiles/local-web/test/git.test.ts', 2],
  ['tools/gates/source-redaction.mjs', 1],
]))

function countIdentityTokens(text) {
  return [...text.matchAll(identityToken)].length
}

function normalizedIdentity(text) {
  return text.replace(identityToken, '[required-local-identity]')
}

export function assertClean(text, label) {
  const normalized = normalizedIdentity(text)
  if (sensitive.test(normalized) || credentialEnvironment.test(normalized)) throw new Error(`redaction violation in ${label}`)
}

function assertExpectedIdentityOccurrences(text, label, expectedOccurrences) {
  const expected = expectedOccurrences.get(label) ?? 0
  const actual = countIdentityTokens(text)
  if (actual !== expected) throw new Error(`unexpected required local identity occurrence count in ${label}: expected ${expected}, saw ${actual}`)
}

function assertCleanSource(text, label, expectedOccurrences) {
  assertExpectedIdentityOccurrences(text, label, expectedOccurrences)
  let normalized = text
  for (const token of redactionPolicyTokens) normalized = normalized.replaceAll(token, '[redaction-policy-token]')
  assertClean(normalized, label)
}

export async function scanSourceInputs(root, {
  minimumSourceFiles = 20,
  expectedOccurrences = expectedIdentityOccurrences,
  onSourceText,
} = {}) {
  const paths = gitSourcePaths(root)
  if (paths.length < minimumSourceFiles) throw new Error(`source scan coverage is implausibly small (${paths.length})`)
  let scannedSourceFiles = 0
  let scannedSourceBytes = 0
  for (const file of paths) {
    const absolute = resolve(root, file)
    let info
    try { info = await lstat(absolute) } catch { throw new Error(`unreadable source path ${file}`) }
    if (info.isSymbolicLink() || !info.isFile()) throw new Error(`source scan path must be a regular file, not a symlink: ${file}`)
    if (info.size > 2_000_000) throw new Error(`source scan limit exceeded: ${file}`)
    let bytes
    try { bytes = await readFile(absolute) } catch { throw new Error(`unreadable source content ${file}`) }
    if (bytes.length !== info.size) throw new Error(`source scan byte count changed while reading: ${file}`)
    scannedSourceFiles += 1
    scannedSourceBytes += bytes.length
    const text = bytes.toString('utf8')
    if (file !== hostileLiteralFixture) assertCleanSource(text, file, expectedOccurrences)
    onSourceText?.(text, file)
  }
  return { scannedSourceFiles, scannedSourceBytes }
}
