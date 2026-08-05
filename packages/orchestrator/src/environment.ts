/** Portable operating context that may cross the supervisor-to-engine boundary. */
export const PORTABLE_ENGINE_ENVIRONMENT_NAMES = Object.freeze([
  'PATH', 'HOME', 'USER', 'LOGNAME', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL', 'LC_CTYPE', 'SHELL',
] as const)

/**
 * Test-only phase markers are intentionally finite. A GUIDELANE_* prefix is
 * not a capability grant: arbitrary names could carry secrets across the
 * detached process boundary.
 */
export const ENGINE_ENVIRONMENT_MARKER_NAMES = Object.freeze([
  'GUIDELANE_FINAL_22_ENGINE_MARKER',
  'GUIDELANE_FINAL_22_GRANDCHILD_MARKER',
  'GUIDELANE_B1_03_ENGINE_MARKER',
  'GUIDELANE_INTENT_MARKER',
  'GUIDELANE_FINAL_27_MARKER',
] as const)

const portableNames = new Set<string>(PORTABLE_ENGINE_ENVIRONMENT_NAMES)
const markerNames = new Set<string>(ENGINE_ENVIRONMENT_MARKER_NAMES)

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function validText(value: unknown): value is string {
  return typeof value === 'string' && !value.includes('\0')
}

/**
 * Remove every caller-controlled key outside the exact launch allow-list.
 * DISABLE_AUTOUPDATER is deliberately omitted here so its forced value is not
 * caller-controlled or part of a caller-authored launch intent.
 */
export function sanitizeLaunchEnvironment(value: unknown): Record<string, string> {
  if (!isRecord(value)) throw new Error('launch env must be an explicit string record')
  const environment: Record<string, string> = {}
  for (const [name, item] of Object.entries(value)) {
    if (!portableNames.has(name) && !markerNames.has(name) && name !== 'DISABLE_AUTOUPDATER') continue
    if (name === 'DISABLE_AUTOUPDATER') continue
    if (!validText(item)) throw new Error('launch env contains an invalid allowed entry')
    environment[name] = item
  }
  return environment
}

/** The wrapper and its target always receive this non-negotiable value. */
export function withForcedAutoUpdater(environment: Record<string, string>): Record<string, string> {
  return { ...environment, DISABLE_AUTOUPDATER: '1' }
}

/** Exact process environment allowed to cross from the supervisor to an engine. */
export function buildEngineEnv(source: NodeJS.ProcessEnv = process.env, markers: Record<string, string> = {}): NodeJS.ProcessEnv {
  const supplied: Record<string, unknown> = {}
  for (const key of PORTABLE_ENGINE_ENVIRONMENT_NAMES) if (source[key] !== undefined) supplied[key] = source[key]
  for (const [key, value] of Object.entries(markers)) supplied[key] = value
  return withForcedAutoUpdater(sanitizeLaunchEnvironment(supplied))
}
