export type RunState = 'idle' | 'waiting' | 'running' | 'successful' | 'recovery-required' | 'stopped' | 'rate-limit' | 'interrupted'
export const GATE_RESULT_STATUSES = Object.freeze(['pending', 'running', 'passed', 'failed', 'blocked', 'needs_user'] as const)
export const GATE_AUTHORITIES = Object.freeze(['machine', 'isolated_review', 'user'] as const)
export type GateResultStatus = typeof GATE_RESULT_STATUSES[number]
export type GateAuthority = typeof GATE_AUTHORITIES[number]
export interface GateResult { name: string; status: GateResultStatus; authority: GateAuthority; evidence?: EvidenceReference[] }
/** The complete, ordered machine evidence set required to reach G5 and G6. */
export const REQUIRED_MACHINE_GATES = Object.freeze(['lint', 'type', 'unit', 'build', 'boot', 'axe', 'smoke'] as const)
/** Compatibility name for consumers that describe the values as gate names. */
export const REQUIRED_MACHINE_GATE_NAMES = REQUIRED_MACHINE_GATES
export type RequiredMachineGate = typeof REQUIRED_MACHINE_GATES[number]
export const RUN_FAILURE_CODES = Object.freeze(['receipt', 'denial', 'hook', 'stall', 'framing', 'io', 'rate_limit_five_hour', 'rate_limit_seven_day', 'interrupted', 'recovery', 'unknown_event'] as const)
export type RunFailureCode = typeof RUN_FAILURE_CODES[number]
export const RUN_FAILURE_STATES: Readonly<Record<RunFailureCode, Exclude<RunState, 'successful'>>> = Object.freeze({
  receipt: 'recovery-required', denial: 'stopped', hook: 'stopped', stall: 'stopped', framing: 'stopped', io: 'stopped', rate_limit_five_hour: 'rate-limit', rate_limit_seven_day: 'rate-limit', interrupted: 'interrupted', recovery: 'recovery-required', unknown_event: 'recovery-required',
})

export interface ProjectSnapshot {
  schemaVersion: number
  projectId: string
  revision: number
  stage: string
  runState: RunState | string
  language: string
  blueprintRevision: number
  gates: GateResult[]
  pendingDecision: 'submitIdea' | 'approveBlueprint' | 'approvePlan' | 'startBuild' | 'acceptResult' | null
  failureCode?: RunFailureCode
  recoveryReason?: string
}

/** Browser-safe summary of a gate; durable evidence identifiers stay private. */
export interface PublicGateResult {
  name: string
  status: GateResultStatus | string
  authority: GateAuthority | string
  verified: boolean
}

/** Explicit allow-list projection for loopback and reconnect snapshot consumers. */
export interface PublicProjectSnapshot {
  schemaVersion: number
  projectId: string
  revision: number
  stage: string
  runState: RunState | string
  language: string
  blueprintRevision: number
  gates: PublicGateResult[]
  pendingDecision: ProjectSnapshot['pendingDecision']
  failureCode?: RunFailureCode
}

export interface EvidenceReference { path: string; sha256: string }
export interface PhaseRun {
  schemaVersion: number
  projectId: string
  phase: string
  attemptId: string
  previousRevision: number
  createdAt: string
  status: string
  inputDigests: Record<string, string>
  receipt: Record<string, unknown>
  evidence: EvidenceReference[]
  gitSnapshot: string
  failureCode?: RunFailureCode
  /** Digest of the immutable, canonical on-disk run receipt. */
  sha256?: string
}
