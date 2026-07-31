// MAP: StreamClass, loadSurface(), classify() → render|ignore|escalate for any
//      stream-json event. REFS: tools/probe/stream-surface.json (the committed
//      artifact), session.ts. INVARIANTS: an unclassified pair ESCALATES; a
//      value-conditional rule falls back to escalate; nothing is ever dropped
//      silently.

import { readFileSync } from 'node:fs'

export type StreamClass = 'render' | 'ignore' | 'escalate'

interface WhenRule {
  path: string
  values: Record<string, StreamClass>
  unknown: StreamClass
}
interface SurfaceEntry {
  class?: StreamClass
  when?: WhenRule
  why: string
}
interface SurfaceArtifact {
  schemaVersion: number
  defaultForUnknown: StreamClass
  pairs: Record<string, SurfaceEntry>
  innerPairs: Record<string, SurfaceEntry>
}

export interface Classification {
  /** `type` or `type/subtype`, exactly as the artifact keys it. */
  pair: string
  class: StreamClass
  /** Why this class was chosen — `unclassified` is the one a human must act on. */
  reason: 'pinned' | 'conditional' | 'conditional-unknown-value' | 'unclassified'
}

const own = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k)

/**
 * Read the committed surface artifact.
 *
 * The engine package READS this file and never writes it. It is hand-maintained
 * and hand-classified, and `render | ignore | escalate` is a product decision
 * about what a non-coder is shown — not a fact the engine can report. A module
 * that generated its own expectation and then obeyed it would assert nothing.
 *
 * Until this function existed the classification column had no consumer at all,
 * which by this repo's own definition made it decoration (REVIEW-02 §14
 * residual b). This is that residual closed.
 */
export function loadSurface(path: string): SurfaceArtifact {
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`stream surface at ${path} is not an object — refusing to run with no whitelist`)
  }
  const a = parsed as Partial<SurfaceArtifact>
  // Fail CLOSED on a missing default. "Nothing is classified" is the maximally
  // unsafe state, and the whole point of this rule is that the artifact is
  // KNOWN to be incomplete: it enumerates one flag configuration on one model.
  if (a.defaultForUnknown !== 'escalate') {
    throw new Error(
      `stream surface defaultForUnknown must be "escalate" (got ${JSON.stringify(a.defaultForUnknown)}) — ` +
        'an unenumerated pair may not be silently dropped'
    )
  }
  if (!a.pairs || !a.innerPairs) throw new Error('stream surface is missing pairs or innerPairs')
  return a as SurfaceArtifact
}

/** Read a dot-separated path off an event without trusting any of it. */
function readPath(event: unknown, path: string): unknown {
  let cur: unknown = event
  for (const seg of path.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[seg]
  }
  return cur
}

export function pairKeyOf(event: { type: string; subtype?: unknown }): string {
  const sub = event.subtype
  return sub === undefined || sub === null ? event.type : `${event.type}/${String(sub)}`
}

function resolve(entry: SurfaceEntry, event: unknown): { cls: StreamClass; reason: Classification['reason'] } {
  if (entry.when) {
    const value = readPath(event, entry.when.path)
    if (value !== undefined && value !== null && own(entry.when.values, String(value))) {
      return { cls: entry.when.values[String(value)] as StreamClass, reason: 'conditional' }
    }
    // An unmodelled value — including a path that no longer resolves, which is
    // how a `when` rule silently stops matching — takes the rule's own
    // fail-closed branch rather than disappearing.
    return { cls: entry.when.unknown, reason: 'conditional-unknown-value' }
  }
  return { cls: entry.class ?? 'escalate', reason: 'pinned' }
}

/**
 * Classify a top-level stream event.
 *
 * An unknown pair does not throw and is not dropped: it takes
 * `defaultForUnknown`, which is `escalate`. A renderer that drops what it does
 * not recognise goes silent in front of a non-coder, and REVIEW-02 names a
 * silent feed as the worst available outcome. Noisy is a bug report; silent is
 * a user who thinks nothing is happening.
 */
export function classify(
  surface: SurfaceArtifact,
  // Real events carry arbitrary engine fields, and a `when` rule reads them by
  // path — so the parameter must accept them rather than force every caller to
  // launder a live event through a cast.
  event: { type: string; subtype?: unknown; [k: string]: unknown }
): Classification {
  const pair = pairKeyOf(event)
  if (!own(surface.pairs, pair)) {
    return { pair, class: surface.defaultForUnknown, reason: 'unclassified' }
  }
  const { cls, reason } = resolve(surface.pairs[pair] as SurfaceEntry, event)
  return { pair, class: cls, reason }
}

/**
 * Classify the inner shape of a `stream_event` envelope.
 *
 * Returns one classification per inner key the envelope carries — the block
 * type, the delta type, or both. This is where `thinking`, `thinking_delta` and
 * `signature_delta` are ignored BY NAME. They carry raw chain-of-thought, they
 * reach the wire by default on some models, and ADR-006's language dial is
 * implemented by a hook that provably does not touch them (measured: the
 * assistant text block came back rewritten in the same message where the
 * thinking block kept its original characters). A renderer that ignored them by
 * omission would fail open the first time it was rewritten.
 */
export function classifyInner(
  surface: SurfaceArtifact,
  envelope: Record<string, unknown>
): Classification[] {
  const inner = envelope.event
  if (inner === null || typeof inner !== 'object') return []
  const ev = inner as { type?: unknown; delta?: { type?: unknown }; content_block?: { type?: unknown } }
  const keys: string[] = []
  if (typeof ev.type === 'string') keys.push(`event.type=${ev.type}`)
  if (ev.delta && typeof ev.delta.type === 'string') keys.push(`event.delta.type=${ev.delta.type}`)
  if (ev.content_block && typeof ev.content_block.type === 'string') {
    keys.push(`event.content_block.type=${ev.content_block.type}`)
  }
  return keys.map((pair) => {
    if (!own(surface.innerPairs, pair)) {
      return { pair, class: surface.defaultForUnknown, reason: 'unclassified' as const }
    }
    const { cls, reason } = resolve(surface.innerPairs[pair] as SurfaceEntry, inner)
    return { pair, class: cls, reason }
  })
}
