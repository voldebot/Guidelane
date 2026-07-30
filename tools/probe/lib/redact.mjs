// @MAP
// redactString (57) | redactDeep (77) | REDACTION_RULES (24)
// @END-MAP
//
// MAP: The serialization boundary between child-process output and a file that
//      goes into a public repository.
// REFS: applied once in ../run.mjs, immediately before every write.
// INVARIANTS:
//   - Redaction is enforced at the boundary, never opted into per probe. A new
//     probe must not be able to leak by forgetting something.
//   - Rules are ordered longest-match-first: /private/var/folders/... must be
//     replaced before /private/var, or the tail survives.
//   - This runs on the whole object graph, keys included, after the report is
//     assembled — so `detail`, `evidence`, error stacks and spawn messages are
//     all covered by construction.
//
// WHY THIS FILE EXISTS: the S0 report committed on 2026-07-30 contained the
// operator's home path, their username, and the macOS confstr temp-directory
// salt (a stable per-account+volume fingerprint). None of that is a credential,
// but all of it was headed for a public repo. Truncation is not redaction; the
// previous design relied on a display truncator (`clip`) as if it were one.

import { homedir, tmpdir, userInfo } from 'node:os'

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function buildRules() {
  const home = homedir()
  const tmp = tmpdir()
  // macOS reports /var/folders/... from tmpdir() but the kernel resolves cwd to
  // /private/var/folders/..., so both spellings appear in captured output.
  const tmpReal = tmp.startsWith('/var/') ? `/private${tmp}` : tmp
  const user = (() => {
    try { return userInfo().username } catch { return '' }
  })()

  const rules = [
    [new RegExp(escapeRe(tmpReal), 'g'), '<TMP>'],
    [new RegExp(escapeRe(tmp), 'g'), '<TMP>'],
    [/\/private\/var\/folders\/[^\s"'`)\]]*/g, '<TMP>'],
    [/\/var\/folders\/[^\s"'`)\]]*/g, '<TMP>'],
    [new RegExp(escapeRe(home), 'g'), '<HOME>'],
    [/\/Users\/[^/\s"'`)\]]+/g, '/Users/<USER>'],
    [/\/home\/[^/\s"'`)\]]+/g, '/home/<USER>'],
    [/C:\\Users\\[^\\\s"'`)\]]+/gi, 'C:\\Users\\<USER>'],
    // Identity and secret shapes, matched by value rather than by key name, so
    // an unexpected payload shape cannot smuggle one through under a new key.
    [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '<EMAIL>'],
    [/sk-[A-Za-z0-9_-]{16,}/g, '<REDACTED_KEY>'],
    [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, '<REDACTED_JWT>'],
    [/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/g, '<REDACTED_TOKEN>'],
  ]
  if (user && user.length > 2) {
    rules.push([new RegExp(`\\b${escapeRe(user)}\\b`, 'g'), '<USER>'])
  }
  return rules
}

export const REDACTION_RULES = buildRules()

export function redactString(value) {
  let out = String(value)
  for (const [re, to] of REDACTION_RULES) out = out.replace(re, to)
  return out
}

// Key names that must never carry a value into the report, whatever the value
// looks like. ADR-008: `claude auth status --json` returns these beside the
// three fields Guidelane is allowed to project.
//
// `apiProvider` is here and NOT in the ADR's cockpit projection, which reads
// like a contradiction and is not: this list is ARTIFACT-scoped. The cockpit
// runs on the owner's machine and may show the provider; this report is
// committed to a public repo, where the provider describes the owner's account
// and says nothing about engine conformance. See ADR-008 §4, scope note.
const DENY_KEYS = /^(email|orgId|orgName|apiProvider|token|apiKey|accessToken|refreshToken|authorization|password|secret)$/i

export function redactDeep(value, seen = new WeakSet()) {
  if (typeof value === 'string') return redactString(value)
  if (value === null || typeof value !== 'object') return value
  if (seen.has(value)) return '<CYCLE>'
  seen.add(value)
  if (Array.isArray(value)) return value.map((v) => redactDeep(v, seen))
  const out = {}
  for (const [k, v] of Object.entries(value)) {
    out[redactString(k)] = DENY_KEYS.test(k) ? '<REDACTED>' : redactDeep(v, seen)
  }
  return out
}
