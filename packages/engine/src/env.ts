// MAP: FORBIDDEN_STATE_KEYS, BACKEND_ROUTING_KEYS, scrubbedEnv() → the child
//      environment every engine spawn gets. There is no unscrubbed path.
// REFS: consumed by session.ts; measured twin in tools/probe/lib/runner.mjs.
// INVARIANTS:
//   - Every key here is removed on EVERY spawn, with no opt-out.
//   - A caller supplying `extra` may add variables but can never re-introduce a
//     denied one: the scrub runs after the merge, not before.

/**
 * The five keys that put a child into a mode Guidelane must never run in.
 *
 * ADR-008 states this as a ban on a STATE, not on the `--bare` / `--safe-mode`
 * flags: both flags merely SET these variables, and a parent shell — or a parent
 * Claude Code session, which is how Guidelane is developed — can set them with
 * no flag present anywhere. Banning the flags would have been a ban on the one
 * spelling nobody was going to use.
 */
export const FORBIDDEN_STATE_KEYS = [
  'CLAUDECODE',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_SSE_PORT',
  'CLAUDE_CODE_SIMPLE',
  'CLAUDE_CODE_SAFE_MODE',
] as const

/**
 * The variables that change WHICH BACKEND ANSWERS.
 *
 * Not a hygiene measure. `ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN` is
 * exactly how z.ai's coding plan points `claude` at GLM — a plan this project
 * intends to support — so leaving them inherited means a session can be answered
 * by a different model entirely while `claude --version` still prints the
 * expected number. The S0 suite nearly committed GLM measurements as evidence
 * about Anthropic's engine for this reason.
 *
 * Deliberate use of a non-subscription backend is a decision the caller states
 * explicitly and the init receipt then asserts (`apiKeySource`) — never a
 * variable that leaks in from a shell.
 */
export const BACKEND_ROUTING_KEYS = [
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_MODEL',
  'ANTHROPIC_SMALL_FAST_MODEL',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'AWS_BEARER_TOKEN_BEDROCK',
  'CLAUDE_CODE_SKIP_BEDROCK_AUTH',
] as const

/**
 * Whole namespaces that may not reach a stage session.
 *
 * WHY THIS IS A PREFIX RULE AND NOT A LONGER LIST. The nine names above were
 * written from an inspection of the docs and they were not enough — a sprint-
 * close audit asked whether `CLAUDE_CODE_OAUTH_TOKEN` was covered, and
 * extracting every auth-or-routing-shaped variable *from the binary itself*
 * (2.1.220) returned about a hundred names, of which the list caught nine.
 * Missed, among others: `CLAUDE_CODE_OAUTH_TOKEN`,
 * `CLAUDE_CODE_OAUTH_REFRESH_TOKEN`, `CLAUDE_CODE_SESSION_ACCESS_TOKEN`,
 * `CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR`, `CLAUDE_CODE_CLIENT_KEY`,
 * `CLAUDE_CODE_HFI_BEARER_TOKEN`, `ANTHROPIC_IDENTITY_TOKEN`,
 * `ANTHROPIC_FOUNDRY_AUTH_TOKEN`, `ANTHROPIC_AWS_API_KEY`, the whole `AWS_*`
 * credential family, and `GOOGLE_APPLICATION_CREDENTIALS`.
 *
 * That is the enumeration failing, measured rather than argued: a deny-list of
 * literal names has to be maintained against a vendor who ships new variables
 * on their schedule, and every one they add inherits by default. Per
 * PROJECT_MAP Principle 8 a binary string is evidence a code path exists, not
 * that it fires — but for a DENY-list that is exactly enough, because the cost
 * of denying an unused variable is zero and the cost of missing a live one is a
 * session answered by a backend the receipt then certifies as Anthropic's.
 *
 * These namespaces are safe to deny wholesale: nothing in them should ever
 * influence a Guidelane stage session, and ADR-005's v1 profile (Next.js +
 * Tailwind + SQLite) is deliberately zero-vendor, so no generated project needs
 * a cloud credential to build.
 *
 * This is NOT the end state. The correct design is an allow-list — see the
 * `withheld` count below and the PROJECT_MAP §6 row: a deny-list cannot protect
 * `GITHUB_TOKEN`, `NPM_TOKEN` or `DATABASE_URL` from an unattended agent with
 * `Bash`, and that decision needs the owner plus a live measurement that the
 * engine still authenticates under a minimal environment.
 */
export const DENIED_ENV_PREFIXES = [
  'ANTHROPIC_',
  'AWS_',
  'GOOGLE_',
  'GCLOUD_',
  'CLOUD_ML_',
] as const

/**
 * Auth and routing variables in the `CLAUDE_CODE_` namespace.
 *
 * Named individually rather than by prefix, because `CLAUDE_CODE_` also holds
 * benign configuration (`CLAUDE_CODE_MAX_OUTPUT_TOKENS` and friends) that a
 * stage may legitimately want. Extracted from the 2.1.220 binary; re-extract on
 * a version bump, and treat a new name as a deny-list gap rather than a
 * surprise. The five nesting markers above are denied separately.
 */
export const CLAUDE_CODE_AUTH_KEYS = [
  'CLAUDE_CODE_OAUTH_TOKEN',
  'CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR',
  'CLAUDE_CODE_OAUTH_REFRESH_TOKEN',
  'CLAUDE_CODE_OAUTH_CLIENT_ID',
  'CLAUDE_CODE_CUSTOM_OAUTH_URL',
  'CLAUDE_CODE_SESSION_ACCESS_TOKEN',
  'CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR',
  'CLAUDE_CODE_API_BASE_URL',
  'CLAUDE_CODE_GB_BASE_URL',
  'CLAUDE_CODE_ARTIFACTS_API_BASE_URL',
  'CLAUDE_CODE_CLIENT_KEY',
  'CLAUDE_CODE_CLIENT_KEY_PASSPHRASE',
  'CLAUDE_CODE_HFI_BEARER_TOKEN',
  'CLAUDE_CODE_HOST_AUTH_ENV_VAR',
  'CLAUDE_CODE_WEBSOCKET_AUTH_FILE_DESCRIPTOR',
  'CLAUDE_CODE_ENABLE_PROXY_AUTH_HELPER',
  'CLAUDE_CODE_PROXY_AUTHENTICATE',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_SKIP_BEDROCK_AUTH',
  'CLAUDE_CODE_SKIP_VERTEX_AUTH',
  'CLAUDE_CODE_SKIP_FOUNDRY_AUTH',
  'CLAUDE_CODE_SKIP_MANTLE_AUTH',
  'CLAUDE_CODE_SKIP_ANTHROPIC_AWS_AUTH',
  'CLAUDE_CODE_SKIP_ANTHROPIC_GOOGLE_CLOUD_AUTH',
] as const

export const DENIED_ENV_KEYS: readonly string[] = [
  ...FORBIDDEN_STATE_KEYS,
  ...BACKEND_ROUTING_KEYS,
  ...CLAUDE_CODE_AUTH_KEYS,
]

/** True if this variable may not reach a stage session, by name or namespace. */
export function isDeniedEnvKey(key: string): boolean {
  return DENIED_ENV_KEYS.includes(key) || DENIED_ENV_PREFIXES.some((p) => key.startsWith(p))
}

export interface ScrubbedEnv {
  env: NodeJS.ProcessEnv
  /** Which denied keys were actually present. Surfaced, never silently dropped. */
  removed: string[]
  /**
   * How many of the operator's variables the child DID inherit.
   *
   * Recorded because it is the honest measure of what this deny-list does not
   * do. A stage session inherits everything not denied — `GITHUB_TOKEN`,
   * `NPM_TOKEN`, `DATABASE_URL` — and it is an LLM agent with `Bash` running
   * unattended. A number in the run record makes that visible instead of
   * implicit; the fix is an allow-list, and that is an owner decision with a
   * live measurement attached (PROJECT_MAP §6).
   */
  inherited: number
}

/**
 * Build the environment for an engine child.
 *
 * `extra` is merged FIRST and scrubbed SECOND, on purpose. The reverse order
 * would let a caller re-introduce a denied key by passing it explicitly, which
 * is precisely the "a convention is not a constraint" shape this codebase keeps
 * producing — the deny-list has to be the last word, not the first.
 */
export function scrubbedEnv(extra: Record<string, string> = {}): ScrubbedEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...extra }
  const removed: string[] = []
  // Iterate the ENVIRONMENT, not the deny-list. Iterating the list can only ever
  // find the names somebody remembered to write down, which is the enumeration
  // failure the prefix rule exists to survive.
  for (const key of Object.keys(env)) {
    if (isDeniedEnvKey(key)) {
      removed.push(key)
      delete env[key]
    }
  }
  // Auto-update must not run inside a stage session: a version change
  // mid-sprint invalidates the conformance baseline the gates rely on. The
  // engine names this variable as the source when it honours it, which is how
  // p-autoupdate-governable proves the setting took effect.
  env.DISABLE_AUTOUPDATER = '1'
  return { env, removed, inherited: Object.keys(env).length }
}
