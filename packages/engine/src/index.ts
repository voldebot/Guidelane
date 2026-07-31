// MAP: the engine adapter's public surface.
// REFS: ADR-001 (official CLI subprocess), ADR-007 (headless contract),
//       ADR-008 (isolation pair + init receipt), REVIEW-02 §15–§19 (the
//       runtime measurements every rule in here cites).
//
// Guidelane never holds, sees, or stores a subscription credential. This package
// spawns the user's own `claude` binary under the user's own login and reads
// what it emits. There is no auth path here, by construction and on purpose.

export { EngineSession, assertInitReceipt } from './session.ts'
export type {
  SessionOptions,
  InitExpectation,
  StreamEvent,
  Denial,
  SessionFailure,
} from './session.ts'

export { SessionRegistry } from './registry.ts'

export { loadSurface, classify, classifyInner, pairKeyOf } from './surface.ts'
export type { StreamClass, Classification } from './surface.ts'

export { applyIsolation, assertIsolated, isSessionInvocation, ISOLATION_PAIR } from './isolation.ts'

export { scrubbedEnv, DENIED_ENV_KEYS, FORBIDDEN_STATE_KEYS, BACKEND_ROUTING_KEYS } from './env.ts'
export type { ScrubbedEnv } from './env.ts'
