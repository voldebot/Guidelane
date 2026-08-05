export const GATE_IDS = ['lint', 'type', 'unit', 'build', 'boot', 'axe', 'smoke'] as const

export type GateId = (typeof GATE_IDS)[number]

export type EvidenceStatus = 'passed' | 'failed'

export interface GeneratedProject {
  directory: string
  packageName: string
  initialSnapshot: string
}

export interface CommandResult {
  command: string
  args: string[]
  exitCode: number | null
  signal: string | null
  timedOut: boolean
  durationMs: number
  childProcessesReaped: boolean
}

export interface GateEvidence {
  schemaVersion: 1
  kind: 'guidelane.local-web.gate'
  identity: string
  gate: GateId
  status: EvidenceStatus
  command: string
  result: CommandResult
  artifactPaths: string[]
  failureCode?: string
}

export interface MutationRecipe {
  seedId: string
  gate: GateId
  files: string[]
  description: string
  requiresBuildBeforeMutation: boolean
  apply: (project: string) => Promise<void>
}

export interface SeedEvidence {
  schemaVersion: 1
  kind: 'guidelane.local-web.seed'
  identity: string
  seedId: string
  expectedGate: GateId
  normalCommand: string
  observedExitCode: number | null
  attributable: boolean
  mutation: {
    files: string[]
    description: string
  }
  artifactPaths: string[]
  cleanup: {
    projectRemoved: boolean
    childProcessesReaped: boolean
  }
  status: EvidenceStatus
}

export interface AttemptAuthoritySummary {
  attemptId: string
  candidateDigest: string
  resultIdentity: string
  status: 'pending' | 'passed' | 'failed'
  accepted: boolean
}

export interface HarnessSummary {
  schemaVersion: 1
  kind: 'guidelane.local-web.harness'
  identity: string
  mode: 'normal' | 'seeded'
  status: EvidenceStatus
  gates: GateId[]
  completedGates: GateId[]
  artifactPaths: string[]
  attemptAuthority?: AttemptAuthoritySummary
  cleanup?: {
    lifecycleStage: 'not-started' | 'live-observed' | 'reaped' | 'failed'
    ownershipVerified: boolean
    reaped: boolean
    receiptDigest?: string
  }
}
