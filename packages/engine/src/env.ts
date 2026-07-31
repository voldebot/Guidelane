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

export const DENIED_ENV_KEYS: readonly string[] = [
  ...FORBIDDEN_STATE_KEYS,
  ...BACKEND_ROUTING_KEYS,
]

export interface ScrubbedEnv {
  env: NodeJS.ProcessEnv
  /** Which denied keys were actually present. Surfaced, never silently dropped. */
  removed: string[]
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
  for (const key of DENIED_ENV_KEYS) {
    if (key in env) {
      removed.push(key)
      delete env[key]
    }
  }
  // Auto-update must not run inside a stage session: a version change
  // mid-sprint invalidates the conformance baseline the gates rely on. The
  // engine names this variable as the source when it honours it, which is how
  // p-autoupdate-governable proves the setting took effect.
  env.DISABLE_AUTOUPDATER = '1'
  return { env, removed }
}
