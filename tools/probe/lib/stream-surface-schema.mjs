// MAP: validateStreamSurface() + the pinned floors. THE ONLY implementation.
// REFS: imported by tools/probe/probes.mjs (two probes) AND by
//       packages/engine/src/surface.ts (the runtime loader).
// INVARIANTS: one copy, because two copies of a pinned expectation is how a pin
//   drifts — and the copies that existed drifted immediately: the probe checked
//   class-set membership, exactly-one-of class|when, `when.unknown === escalate`
//   and the thinking pin, while the engine's own loader checked
//   `defaultForUnknown` and nothing else. The strong copy ran in CI; the weak
//   one ran on the user's machine. Found by the S1 sprint-close audit.
//
// Plain ESM with no dependencies, so `probes.mjs` (run by bare node) and the
// TypeScript engine package can both import it. Types live in the sibling
// `.d.mts`.

const own = (map, k) => Object.prototype.hasOwnProperty.call(map, k)

export const SURFACE_CLASSES = ['render', 'ignore', 'escalate']
// Floors pinned in CODE and asserted as SUBSETS of the artifact's own required
// lists. Not a second source of truth — a shape constraint on the expectation,
// so the two cannot disagree; only the artifact can be caught shrinking.
// Without them, deleting entries from the artifact makes a session that died
// after two events satisfy the subset check and pass having measured nothing.
export const SURFACE_REQUIRED_FLOOR = ['system/init', 'assistant', 'result/success']
export const SURFACE_REQUIRED_INNER_FLOOR = ['event.type=content_block_delta', 'event.delta.type=text_delta']

/**
 * Validate `stream-surface.json` as an EXPECTATION, with no engine call.
 *
 * Extracted so the live probe (`p-stream-surface-union`) and the free probe
 * (`p-stream-surface-artifact`) share one implementation. Two copies of a
 * validator is how a pinned expectation drifts, and the free copy is the one CI
 * runs — so a divergence would mean CI gating something the live suite does not
 * assert, which is worse than no free gate at all.
 */
export const validateStreamSurface = (surface) => {
  const problems = []
  const pairsMap = surface && surface.pairs && typeof surface.pairs === 'object' ? surface.pairs : null
  const innerMap = surface && surface.innerPairs && typeof surface.innerPairs === 'object' ? surface.innerPairs : null
  const requiredPairs = surface && Array.isArray(surface.requiredPairs) ? surface.requiredPairs : null
  const requiredInner = surface && Array.isArray(surface.requiredInnerPairs) ? surface.requiredInnerPairs : null

  const validateMap = (map, label) => {
    if (!map) return problems.push(`${label} is missing or not an object`)
    const keys = Object.keys(map).filter((k) => !k.startsWith('_'))
    if (keys.length === 0) problems.push(`${label} is empty — an empty whitelist classifies nothing`)
    for (const k of keys) {
      const v = map[k]
      if (!v || typeof v !== 'object') { problems.push(`${label}["${k}"] is not an object`); continue }
      // schemaVersion 2: exactly one of `class` (unconditional) or `when`
      // (value-conditional). Accepting both would be two sources of truth for
      // one decision, which is how a pin drifts.
      const hasClass = own(v, 'class')
      const hasWhen = own(v, 'when')
      if (hasClass === hasWhen) {
        problems.push(`${label}["${k}"] must carry exactly one of class | when (has ${hasClass && hasWhen ? 'both' : 'neither'})`)
      } else if (hasClass) {
        if (!SURFACE_CLASSES.includes(v.class)) {
          problems.push(`${label}["${k}"] has class=${JSON.stringify(v.class)}, expected one of ${SURFACE_CLASSES.join(' | ')}`)
        }
      } else {
        const w = v.when
        if (!w || typeof w !== 'object') problems.push(`${label}["${k}"].when is not an object`)
        else {
          if (typeof w.path !== 'string' || !w.path.trim()) {
            problems.push(`${label}["${k}"].when.path is missing — nothing to read the value from`)
          }
          const vals = w.values && typeof w.values === 'object' ? Object.entries(w.values) : null
          if (!vals || vals.length === 0) {
            problems.push(`${label}["${k}"].when.values is empty — a conditional that matches nothing is the unconditional rule it replaced`)
          } else {
            for (const [val, cls] of vals) {
              if (!SURFACE_CLASSES.includes(cls)) problems.push(`${label}["${k}"].when.values["${val}"] = ${JSON.stringify(cls)}, expected one of ${SURFACE_CLASSES.join(' | ')}`)
            }
          }
          // Deliberately narrower than the class set. Discriminating by value is
          // a statement that the values matter, so an unrecognised one has to
          // reach a human; `unknown: ignore` would swallow exactly the case
          // nobody anticipated.
          if (w.unknown !== 'escalate') {
            problems.push(`${label}["${k}"].when.unknown = ${JSON.stringify(w.unknown)}, must be "escalate" — a value-conditional rule may not fail open on an unmodelled value`)
          }
        }
      }
      // An unexplained classification is a convention, not a constraint — the
      // next person cannot tell a decision from a placeholder.
      if (typeof v.why !== 'string' || v.why.trim().length < 10) {
        problems.push(`${label}["${k}"] carries no stated reason`)
      }
    }
  }
  validateMap(pairsMap, 'pairs')
  validateMap(innerMap, 'innerPairs')

  // The rule for a pair in NO list. The artifact enumerates a universe it also
  // states is a sample, so "what happens to the ones I did not enumerate" is not
  // an edge case, it is the guaranteed steady state. Pinned here rather than
  // left to each renderer, because a renderer that drops the unrecognised goes
  // silent, and silence is REVIEW-02's named worst outcome.
  if (!surface || surface.defaultForUnknown !== 'escalate') {
    problems.push(`defaultForUnknown = ${JSON.stringify(surface && surface.defaultForUnknown)}, must be "escalate" — an unenumerated pair may not be silently dropped`)
  }
  // Without a pinned minimum the live probe passes on an empty stream: it would
  // observe nothing, find nothing unclassified, and report green having measured
  // nothing at all. This is the guard that makes it able to fire.
  if (!requiredPairs || requiredPairs.length === 0) {
    problems.push('requiredPairs is missing or empty — the live probe would pass on a zero-event stream')
  }
  for (const k of SURFACE_REQUIRED_FLOOR) {
    if (requiredPairs && !requiredPairs.includes(k)) {
      problems.push(`requiredPairs omits "${k}", which is pinned in code — without it a session that died early satisfies the subset check and passes having measured nothing`)
    }
  }
  if (!requiredInner || requiredInner.length === 0) {
    problems.push('requiredInnerPairs is missing or empty — the live probe would pass on an envelope with no content')
  }
  for (const k of SURFACE_REQUIRED_INNER_FLOOR) {
    if (requiredInner && !requiredInner.includes(k)) {
      problems.push(`requiredInnerPairs omits "${k}", which is pinned in code — without it an envelope carrying no text satisfies the subset check`)
    }
  }
  for (const k of requiredPairs || []) {
    if (pairsMap && !own(pairsMap, k)) problems.push(`requiredPairs names "${k}", absent from pairs — that requirement can never be satisfied cleanly`)
  }
  for (const k of requiredInner || []) {
    if (innerMap && !own(innerMap, k)) problems.push(`requiredInnerPairs names "${k}", absent from innerPairs`)
  }

  // One CLASSIFICATION pinned in code, not just a shape.
  //
  // Everything above checks that the artifact is well-formed. Well-formed is not
  // safe: reclassifying a thinking block to `render` is a perfectly valid edit
  // that ships raw chain-of-thought to a non-coder. Measured 2026-07-31 — content
  // -bearing thinking reaches `-p` stream-json by default, and the MessageDisplay
  // rewrite that implements ADR-006's language dial provably does NOT touch it
  // (same-run differential: the text block came back rewritten, the thinking
  // block kept its original characters). So this is the one place where a
  // classification is a product invariant rather than a judgement call, and a
  // shape-only validator would wave it through.
  //
  // Deliberately NOT generalised into "check every class": the rest genuinely are
  // decisions, and pinning them would freeze the artifact against its own purpose.
  const THINKING_MUST_IGNORE = [
    'event.content_block.type=thinking',
    'event.delta.type=thinking_delta',
    'event.delta.type=signature_delta',
  ]
  for (const k of THINKING_MUST_IGNORE) {
    if (!innerMap || !own(innerMap, k)) {
      problems.push(`innerPairs omits "${k}", which is pinned in code — a renderer that ignores thinking BY OMISSION fails open the first time it is rewritten`)
    } else if (innerMap[k].class !== 'ignore') {
      problems.push(`innerPairs["${k}"].class = ${JSON.stringify(innerMap[k].class)}, must be "ignore" — this is raw chain-of-thought, it reaches the wire by default, and ADR-006's language dial does not touch it`)
    }
  }
  return { problems, pairsMap, innerMap, requiredPairs, requiredInner }
}

