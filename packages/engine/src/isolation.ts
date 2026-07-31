// MAP: ISOLATION_PAIR, applyIsolation(), assertIsolated() → argv every session
//      spawn is given. REFS: session.ts. INVARIANTS: applied at ONE chokepoint;
//      `--setting-sources` is checked by VALUE, never by presence.

/**
 * The ADR-008 isolation pair.
 *
 * `--strict-mcp-config` alone isolates MCP and nothing else: measured, it still
 * inherited 4 plugins, 24 skills, 10 agents and the operator's
 * `bypassPermissions` default. Both flags, or the session is not isolated.
 *
 * What it does NOT remove is the CLI's built-in floor — 16 skills and 5 agents
 * on 2.1.220, including `loop`, `deep-research` and `general-purpose`. Because
 * open-ended behaviour is exactly what a gated pipeline must not have available
 * mid-stage, stage allow-lists withhold `Task` and `Skill` unless a stage's
 * design explicitly calls for them.
 */
export const ISOLATION_PAIR = ['--strict-mcp-config', '--setting-sources', ''] as const

/** Flags that only ever appear on a session invocation. */
const SESSION_ONLY_FLAGS = [
  '--output-format',
  '--input-format',
  '--permission-mode',
  '--allowedTools',
  '--append-system-prompt',
]

export function isSessionInvocation(args: readonly string[]): boolean {
  return args.includes('-p') || args.includes('--print')
}

/**
 * Add the isolation pair to a session invocation.
 *
 * Lives on the single spawn path rather than at each call site. When isolation
 * was a per-call-site convention, 14 of 19 spawns were missing at least one flag
 * and one of them published a paraphrase of the operator's private global
 * configuration — while the report claimed every session was isolated.
 *
 * `ambient` is the one opt-out. It exists for measuring inherited configuration
 * on purpose, it is explicit, and callers are expected to record it.
 */
export function applyIsolation(
  args: readonly string[],
  { ambient = false }: { ambient?: boolean } = {}
): string[] {
  if (!isSessionInvocation(args)) {
    // The sniff is an inference and a silent miss fails open. These flags exist
    // only on session invocations, so seeing one here means the classifier is
    // wrong — stop rather than run a contaminated session.
    const leaked = SESSION_ONLY_FLAGS.filter((f) => args.includes(f))
    if (leaked.length > 0) {
      throw new Error(
        `session classifier failed: ${leaked.join(', ')} present without -p/--print. ` +
          'Isolation would have been skipped silently — widen the sniff, do not work around this.'
      )
    }
    return [...args]
  }
  if (ambient) return [...args]

  const out = [...args]
  if (!out.includes(ISOLATION_PAIR[0])) out.push(ISOLATION_PAIR[0])
  const at = out.indexOf(ISOLATION_PAIR[1])
  if (at === -1) {
    out.push(ISOLATION_PAIR[1], ISOLATION_PAIR[2])
  } else if (out[at + 1] !== '') {
    // Presence is not isolation. An `includes()` check let
    // `--setting-sources user` pass as isolated while the session loaded the
    // operator's settings and nothing counted it as ambient.
    throw new Error(
      `--setting-sources must be '' on an isolated session (got ${JSON.stringify(out[at + 1])}). ` +
        'Pass ambient:true if measuring inherited configuration is the point.'
    )
  }
  return out
}

/**
 * Assert, on the argv that was actually passed, that a session is isolated.
 *
 * Deliberately separate from `applyIsolation`: an assertion placed immediately
 * after the code that satisfies it, over the same data, cannot fail — that is
 * the tautology this codebase shipped once already. This one is meant to be
 * called at the boundary, by a caller that did not build the args.
 */
export function assertIsolated(args: readonly string[]): void {
  if (!args.includes(ISOLATION_PAIR[0])) {
    throw new Error(`session argv is missing ${ISOLATION_PAIR[0]} — it would inherit the operator's MCP servers`)
  }
  const at = args.indexOf(ISOLATION_PAIR[1])
  if (at === -1 || args[at + 1] !== '') {
    throw new Error(
      `session argv must carry ${ISOLATION_PAIR[1]} '' (got ${at === -1 ? 'nothing' : JSON.stringify(args[at + 1])}) — ` +
        "it would inherit the operator's plugins, skills, agents and permission default"
    )
  }
}
