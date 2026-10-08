import type { EvidenceAssessmentSummary } from '../evaluation/evidence-completeness.ts'
import type { Claim, Evidence, ResearchProblemGraph, Timestamp, Hypothesis, DomainEvent, Checkpoint, BudgetLedger } from '../domain/types.ts'
import type { RunId } from '../domain/ids.ts'
import type { ModelGateway, ModelRoute } from '../domain/extraction.ts'

/** Scientific gap categories that can, with an explicit provenance chain, seed a hypothesis. */
export type ResearchGapKind =
  | 'OPEN_QUESTION'
  | 'KNOWN_LIMITATION'
  | 'UNTESTED_ASSUMPTION'
  | 'CONTRADICTORY_EVIDENCE'
  | 'UNEXPLAINED_FAILURE'
  | 'METHOD_INCOMPATIBILITY'
  | 'MISSING_COMPARISON'
  | 'UNRESOLVED_MECHANISM'

/** Coverage states are deliberately separate from scientific gap kinds. */
export type CoverageGapKind =
  | 'INCOMPLETE_EVIDENCE_COVERAGE'
  | 'DEFERRED_EVIDENCE_WORK'
  | 'FAILED_RETRIEVAL'
  | 'NO_RESULTS_RETRIEVAL'
  | 'ABSTRACT_ONLY_EVIDENCE'
  | 'MISSING_QUANTITATIVE_EVIDENCE'
  | 'BUDGET_EXHAUSTION'

export type GapKind = ResearchGapKind | CoverageGapKind
export type GapCoverageState = 'SCIENTIFIC' | 'COVERAGE_ONLY' | 'MIXED'
export type GapEpistemicStatus = 'OBSERVED' | 'MODEL_INTERPRETATION' | 'UNRESOLVED'
export type GenerationEligibilityCode = 'ELIGIBLE_RESEARCH_GAP' | 'COVERAGE_FOLLOWUP_REQUIRED' | 'MIXED_RESEARCH_COMPONENT_REQUIRED'

export interface GapGenerationEligibility {
  readonly eligible: boolean
  readonly code: GenerationEligibilityCode
  readonly reason: string
}

export interface GapUncertainty {
  readonly level: number
  readonly reasons: readonly string[]
}

export interface ResearchGap {
  readonly gapId: string
  readonly kind: GapKind
  readonly statement: string
  readonly coverageState: GapCoverageState
  readonly epistemicStatus: GapEpistemicStatus
  readonly sourceProblemNodeIds: readonly string[]
  readonly sourceClaimIds: readonly string[]
  /** Only direct/source evidence may appear here; model interpretations are separate. */
  readonly sourceEvidenceIds: readonly string[]
  readonly interpretationEvidenceIds: readonly string[]
  readonly supportingEvidenceIds: readonly string[]
  readonly contradictingEvidenceIds: readonly string[]
  readonly originatingLimitations: readonly string[]
  readonly originatingOpenQuestions: readonly string[]
  readonly originatingAssumptions: readonly string[]
  readonly originatingFailureCases: readonly string[]
  readonly eligibility: GapGenerationEligibility
  readonly uncertainty: GapUncertainty
  readonly rationale: string
}

export interface M4ACompletenessSnapshot {
  readonly status?: 'EXHAUSTIVE' | 'INCOMPLETE'
  readonly exhaustive?: boolean
  readonly scientificallyComplete?: boolean
  readonly deferredOperations?: number | readonly string[]
  readonly failedOperations?: number | readonly string[]
  readonly unexecutedPlannedOperations?: number
  readonly emptyEvidenceOperations?: number
  readonly retrievalCoverage?: Readonly<Partial<Record<'COMPLETE' | 'PARTIAL' | 'FAILED' | 'NO_RESULTS', number>>>
  readonly evidenceItems?: number
  readonly limitations?: readonly string[]
  readonly [key: string]: unknown
}

export type M4ACompleteness = EvidenceAssessmentSummary | M4ACompletenessSnapshot

export interface EvidenceGraphSnapshot {
  readonly claims?: readonly Claim[]
  readonly evidence?: readonly (Evidence & Record<string, unknown>)[]
  readonly links?: readonly {
    readonly evidenceLinkId?: string
    readonly evidenceId?: string
    readonly claimId?: string
    readonly targetType?: string
    readonly targetId?: string
    readonly relation?: string
    readonly rationale?: string
  }[]
}

export interface GapDiscoveryInput {
  readonly problemGraph: ResearchProblemGraph
  readonly evidenceGraph?: EvidenceGraphSnapshot
  readonly claims?: readonly Claim[]
  readonly evidence?: readonly (Evidence & Record<string, unknown>)[]
  readonly completeness: M4ACompleteness
  readonly explicitLimitations?: readonly string[]
  readonly explicitOpenQuestions?: readonly string[]
  readonly explicitAssumptions?: readonly string[]
  readonly explicitFailureCases?: readonly string[]
  readonly now: Timestamp
  readonly candidateBudget?: number
}

export interface GapDiscoveryRejection {
  readonly signature: string
  readonly reason: string
  readonly source?: string
}

export interface GapDuplicateDecision {
  readonly keptGapId: string
  readonly duplicateSignature: string
  readonly rejectedStatement: string
  readonly reason: string
}

export interface GapDiscoveryResult {
  readonly schemaVersion: 'm4a.gap-discovery.v1'
  readonly generatedAt: Timestamp
  readonly gaps: readonly ResearchGap[]
  readonly rejected: readonly GapDiscoveryRejection[]
  readonly duplicates: readonly GapDuplicateDecision[]
  readonly completeness: M4ACompleteness
  readonly limitations: readonly string[]
  readonly sourceIds: readonly string[]
  readonly inputSummary: {
    readonly problemNodeIds: readonly string[]
    readonly edgeIds: readonly string[]
    readonly claimIds: readonly string[]
    readonly evidenceIds: readonly string[]
  }
}

export type GenerationOperator =
  | 'REMOVE_ASSUMPTION'
  | 'COMBINE_METHODS'
  | 'TRANSFER_MECHANISM'
  | 'REPLACE_COMPONENT'
  | 'RELAX_CONSTRAINT'
  | 'EXPLAIN_FAILURE'
  | 'NEW_OBJECTIVE'
  | 'NEW_REPRESENTATION'
  | 'NEW_EVALUATION'
  | 'CROSS_DOMAIN_TRANSFER'

export type Generation0EpistemicStatus = 'PROVISIONAL_UNVERIFIED'
export type NoveltyStatus = 'UNVERIFIED'

export interface Generation0Hypothesis extends Hypothesis {
  readonly generation: 0
  readonly originatingGapIds: readonly string[]
  readonly sourceProblemNodeIds: readonly string[]
  readonly sourceClaimIds: readonly string[]
  readonly sourceEvidenceIds: readonly string[]
  readonly proposedMechanism: string
  readonly expectedMechanism: string
  readonly falsificationConditions: readonly string[]
  readonly expectedObservableResult: string
  readonly discriminativeExperimentIdea: string
  readonly generationOperator: GenerationOperator
  readonly epistemicStatus: Generation0EpistemicStatus
  readonly noveltyStatus: NoveltyStatus
  readonly uncertainty: GapUncertainty
  readonly inputCompleteness: M4ACompleteness
}

export interface HypothesisGeneratorCandidate {
  readonly candidateId?: string
  readonly originatingGapIds: readonly string[]
  readonly sourceProblemNodeIds?: readonly string[]
  readonly sourceClaimIds?: readonly string[]
  readonly sourceEvidenceIds?: readonly string[]
  readonly statement: string
  readonly motivation: string
  readonly proposedMechanism: string
  readonly expectedMechanism: string
  readonly assumptions?: readonly string[]
  readonly evidenceFor?: readonly string[]
  readonly evidenceAgainst?: readonly string[]
  readonly falsificationConditions: readonly string[]
  readonly expectedObservableResult: string
  readonly discriminativeExperimentIdea: string
  readonly generationOperator?: GenerationOperator
}

export interface HypothesisGeneratorOutput {
  readonly hypotheses: readonly HypothesisGeneratorCandidate[]
}

export interface M4AModelAttempt {
  readonly attemptId: string
  readonly ok: boolean
  readonly validationErrors: readonly string[]
  readonly diagnostic?: unknown
  readonly request?: unknown
}

export interface HypothesisDuplicateDecision {
  readonly keptHypothesisId: string
  readonly duplicateSignature: string
  readonly rejectedCandidateId?: string
  readonly reason: string
}

export interface HypothesisGenerationRejection {
  readonly candidateId?: string
  readonly originatingGapIds: readonly string[]
  readonly reason: string
}

export interface Generation0Population {
  readonly schemaVersion: 'm4a.generation-0.v1'
  readonly generation: 0
  readonly generatedAt: Timestamp
  readonly hypotheses: readonly Generation0Hypothesis[]
  readonly candidateBudget: number
  readonly skillVersion: string
  readonly inputCompleteness: M4ACompleteness
  readonly inputSummary: {
    readonly problemNodeIds: readonly string[]
    readonly claimIds: readonly string[]
    readonly evidenceIds: readonly string[]
  }
  readonly limitations: readonly string[]
  readonly rejected: readonly HypothesisGenerationRejection[]
  readonly duplicates: readonly HypothesisDuplicateDecision[]
  readonly modelAttempts: readonly M4AModelAttempt[]
  readonly provenance: readonly {
    readonly hypothesisId: string
    readonly gapIds: readonly string[]
    readonly problemNodeIds: readonly string[]
    readonly claimIds: readonly string[]
    readonly evidenceIds: readonly string[]
  }[]
  /** Extension coordinator outcome; legacy M4A callers may omit these fields. */
  readonly generationStatus?: 'COMPLETE' | 'COMPLETE_EMPTY' | 'NO_ELIGIBLE_GAPS' | 'GAP_MODEL_FAILED' | 'GENERATION_FAILED'
  readonly acceptedHypothesisCount?: number
  readonly failureReason?: string
}

export interface HypothesisGeneratorOptions {
  readonly candidateBudget?: number
  readonly gateway?: ModelGateway
  readonly route?: ModelRoute
  /** Stable source/run identities supplied by the composition boundary. */
  readonly inputArtifactIds?: readonly string[]
  /** Validation errors from the prior bounded structural attempt, if retrying. */
  readonly previousValidationErrors?: readonly string[]
  readonly skillVersion?: string
  readonly now?: Timestamp
}

export interface HypothesisGenerationInput {
  readonly gapDiscovery: GapDiscoveryResult
  readonly problemGraph: ResearchProblemGraph
  readonly claims?: readonly Claim[]
  readonly evidence?: readonly (Evidence & Record<string, unknown>)[]
}

export interface M4AArtifacts {
  readonly gapDiscovery: GapDiscoveryResult
  readonly generation0: Generation0Population
  readonly events: readonly DomainEvent[]
  readonly checkpoint: Checkpoint
}

export interface M4AOrchestrationInput extends HypothesisGenerationInput {
  readonly runId: RunId
  readonly startingSequence?: number
  readonly budget: BudgetLedger
  readonly now: Timestamp
  readonly completeness: M4ACompleteness
}
