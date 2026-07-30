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
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// tools/probe/lib/redact.mjs -> the repository root.
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

function buildRules() {
  const home = homedir()
  const tmp = tmpdir()
  // macOS reports /var/folders/... from tmpdir() but the kernel resolves cwd to
  // /private/var/folders/..., so both spellings appear in captured output.
  const tmpReal = tmp.startsWith('/var/') ? `/private${tmp}` : tmp
  const user = (() => {
    try { return userInfo().username } catch { return '' }
  })()

  // EVERY path rule is case-insensitive. macOS filesystems are, so
  // `/users/talhamac/...` is a spelling tools echo back verbatim — and the CI
  // backstop greps with `-i` while this boundary did not, which made the
  // boundary strictly weaker than the thing backstopping it. That inversion is
  // the whole bug: a backstop is supposed to catch what the boundary misses,
  // not the reverse.
  const rules = []
  // Ordered longest-match-first, and the REPO ROOT comes before $HOME on
  // purpose. Stripping only the home prefix published `Desktop/Projects/
  // Guidelane` into the committed artifact — harmless for this owner, but for a
  // pilot user checked out at ~/work/acme-corp/ it ships a client's name to a
  // public repo, matched by no rule and no CI pattern.
  if (REPO_ROOT.length > 3) rules.push([new RegExp(escapeRe(REPO_ROOT), 'gi'), '<REPO>'])
  rules.push(
    [new RegExp(escapeRe(tmpReal), 'gi'), '<TMP>'],
    [new RegExp(escapeRe(tmp), 'gi'), '<TMP>'],
    [/\/private\/var\/folders\/[^\s"'`)\]]*/gi, '<TMP>'],
    [/\/var\/folders\/[^\s"'`)\]]*/gi, '<TMP>']
  )
  // Guard the length: an empty homedir() compiles to //gi, which interleaves
  // <HOME> between every character of the report.
  if (home && home.length > 3) rules.push([new RegExp(escapeRe(home), 'gi'), '<HOME>'])
  rules.push(
    [/\/Users\/[^/\s"'`)\]]+/gi, '/Users/<USER>'],
    [/\/home\/[^/\s"'`)\]]+/gi, '/home/<USER>'],
    [/C:\\Users\\[^\\\s"'`)\]]+/gi, 'C:\\Users\\<USER>'],
    // Identity and secret shapes, matched by value rather than by key name, so
    // an unexpected payload shape cannot smuggle one through under a new key.
    [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '<EMAIL>'],
    [/sk-[A-Za-z0-9_-]{16,}/g, '<REDACTED_KEY>'],
    [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, '<REDACTED_JWT>'],
    [/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/g, '<REDACTED_TOKEN>']
  )
  // `> 1`, not `> 2`: the old bound silently disabled username redaction for any
  // 1–2 character login, which is a real thing people have.
  if (user && user.length > 1) {
    rules.push([new RegExp(`\\b${escapeRe(user)}\\b`, 'gi'), '<USER>'])
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
// Snake_case spellings added: the old pattern was camelCase-only, so `api_key`,
// `access_token`, `client_secret`, `private_key` and `cookie` all passed. The
// value-shaped rules above catch prefixed tokens, so this is defence in depth
// rather than the only net — but a bearer token with no recognisable prefix
// under `access_token` used to ship.
const DENY_KEYS =
  /^(e-?mail|org_?id|org_?name|api_?provider|token|api_?key|access_?token|refresh_?token|session_?token|id_?token|authorization|password|passwd|secret|client_?secret|credentials?|cookie|private_?key)$/i

/**
 * Redact an entire object graph.
 *
 * Total over value shapes on purpose. `Object.entries` on a Buffer yields
 * `{"0":47,"1":85,...}` — the bytes of a home path published as numbers, which
 * no string rule can touch. Map/Set/Date flatten to `{}`, which is data loss
 * presented as empty evidence. BigInt and unbounded depth make `JSON.stringify`
 * throw, so the report is never written at all. None of these shapes reaches
 * the report today; every one of them is one probe author away.
 */
export function redactDeep(value, seen = new WeakSet()) {
  if (typeof value === 'string') return redactString(value)
  if (typeof value === 'bigint') return `${value}n`
  if (value === null || typeof value !== 'object') return value
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return `<BINARY ${value.byteLength} bytes>`
  if (value instanceof Date) return value.toISOString()
  if (value instanceof RegExp) return redactString(String(value))
  if (value instanceof Error) return redactString(value.stack || value.message || String(value))
  if (value instanceof Map) return redactDeep(Object.fromEntries(value), seen)
  if (value instanceof Set) return redactDeep([...value], seen)
  if (seen.has(value)) return '<CYCLE>'
  seen.add(value)
  try {
    if (Array.isArray(value)) return value.map((v) => redactDeep(v, seen))
    const out = {}
    for (const [k, v] of Object.entries(value)) {
      const key = redactString(k)
      // Two distinct keys can redact to the same name. Suffix rather than
      // silently overwrite — losing evidence is worse than an ugly key.
      const slot = key in out ? `${key}#${Object.keys(out).length}` : key
      out[slot] = DENY_KEYS.test(k) ? '<REDACTED>' : redactDeep(v, seen)
    }
    return out
  } finally {
    // An ANCESTOR set, not a visited set. Without the delete, the second
    // reference to a shared (non-cyclic) node became the string '<CYCLE>' —
    // turning an object into a string in the committed artifact, and the
    // corruption reads like a finding.
    seen.delete(value)
  }
}
