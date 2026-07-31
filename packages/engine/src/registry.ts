// MAP: SessionRegistry → per-supervisor tracking of live engine children.
// REFS: session.ts. INVARIANTS: kills the process GROUP, never a bare pid;
//       killAll() is idempotent and safe to call from a signal handler.

/**
 * Tracks the engine children one supervisor owns.
 *
 * Replaces the probe harness's `LIVE_CHILDREN`, which is a module-level Set —
 * i.e. process-wide. That was fine for a suite that runs one thing at a time and
 * wrong for Night Shift, where each supervisor must be able to reap its own
 * sessions without touching another's. Named as debt at the S0 close; this is it
 * paid.
 *
 * Group kill, not pid kill: an engine session spawns grandchildren (stdio MCP
 * servers, Bash tools). Killing the direct pid leaves them running,
 * authenticated, spending the user's quota with nobody reading their output.
 */
export class SessionRegistry {
  readonly #pgids = new Set<number>()

  add(pgid: number): void {
    this.#pgids.add(pgid)
  }

  remove(pgid: number): void {
    this.#pgids.delete(pgid)
  }

  get size(): number {
    return this.#pgids.size
  }

  /** Live pgids, for a supervisor that wants to report what it is holding. */
  list(): number[] {
    return [...this.#pgids]
  }

  /**
   * Kill one process group. Returns true if the signal was delivered.
   *
   * Not an assertion that the process is GONE: delivering SIGKILL and the entry
   * leaving the process table are different moments, and a caller that checks
   * liveness immediately will race. The conformance suite shipped exactly that
   * race and CI caught it on the fifth run.
   */
  kill(pgid: number, signal: NodeJS.Signals = 'SIGKILL'): boolean {
    let delivered = false
    try {
      process.kill(-pgid, signal)
      delivered = true
    } catch {
      // Already gone, or never had a group — either way there is nothing to reap.
    }
    this.#pgids.delete(pgid)
    return delivered
  }

  /**
   * Reap everything this registry owns.
   *
   * Safe to call twice and safe from a signal handler: it never throws, and the
   * set is drained as it goes. A supervisor that exits without calling this
   * leaves authenticated processes running — which is why the caller wires it to
   * every exit path rather than only the happy one.
   */
  killAll(signal: NodeJS.Signals = 'SIGKILL'): number {
    let killed = 0
    for (const pgid of [...this.#pgids]) {
      if (this.kill(pgid, signal)) killed += 1
    }
    return killed
  }
}
