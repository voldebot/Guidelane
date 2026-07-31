// Types for the shared stream-surface validator.
//
// Hand-written rather than generated: the implementation is dependency-free
// plain ESM so that `probes.mjs` (run by bare node, no build step) and the
// TypeScript engine package can import THE SAME code. This file is the price of
// that, and it is the cheap half — a second validator would have been the
// expensive one.

export type StreamSurfaceClass = 'render' | 'ignore' | 'escalate'

export declare const SURFACE_CLASSES: readonly StreamSurfaceClass[]
export declare const SURFACE_REQUIRED_FLOOR: readonly string[]
export declare const SURFACE_REQUIRED_INNER_FLOOR: readonly string[]

export interface StreamSurfaceValidation {
  /** Empty means usable. Every entry names the key and what is wrong with it. */
  problems: string[]
  pairsMap: Record<string, unknown> | null
  innerMap: Record<string, unknown> | null
  requiredPairs: string[] | null
  requiredInner: string[] | null
}

/** Validate the artifact as an EXPECTATION. Never throws; returns problems. */
export declare function validateStreamSurface(surface: unknown): StreamSurfaceValidation
