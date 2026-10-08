import type { Evidence, Hypothesis, Review, Criticism, Checkpoint, DomainEvent, Timestamp, BudgetLedger } from '../domain/types.ts'
import type { RunId } from '../domain/ids.ts'
import type { GapDiscoveryInput, GapDiscoveryResult, M4AOrchestrationInput, Generation0Hypothesis } from '../milestone4a/index.ts'
import type { M4BArtifacts } from '../milestone4b/index.ts'
import type { EvaluationRequest, M4CArtifacts, EvaluationRecord } from '../milestone4c/index.ts'
import type { ResearchGap } from '../milestone4a/types.ts'

export type M4DFixtureM4AInput = M4AOrchestrationInput & Pick<GapDiscoveryInput, 'explicitLimitations' | 'explicitOpenQuestions' | 'explicitAssumptions' | 'explicitFailureCases'> & {
  readonly runId: RunId
  readonly budget: BudgetLedger
  readonly gapDiscovery: GapDiscoveryResult
}

export interface M4DLifecycleInput {
  readonly m4a: M4DFixtureM4AInput
  readonly reviewFor: (hypothesis: Generation0Hypothesis, evidence: readonly Evidence[]) => Review
  readonly criticismFor: (hypothesis: Generation0Hypothesis, review: Review, evidence: readonly Evidence[]) => Criticism
  /** Evaluation values are supplied by the caller; M4D never derives or scores them. */
  readonly evaluationFor: (hypothesis: Hypothesis, evidence: readonly Evidence[]) => EvaluationRequest
  readonly selectionLimit?: number
}

export interface M4DEvidenceChainItem {
  readonly evidenceId: string
  readonly claimIds: readonly string[]
  readonly claim: string
  readonly polarity: string
  readonly sourceId: string
}

export interface M4DMutationExplanation {
  readonly mutationEdgeId: string
  readonly parentHypothesisId: string
  readonly childHypothesisId: string
  readonly criticReviewId: string
  readonly criticismIds: readonly string[]
  readonly evidenceIds: readonly string[]
  readonly mutationType: string
  readonly changedFields: readonly string[]
  readonly reason: string
}

export interface M4DCriticismExplanation {
  readonly criticismId: string
  readonly reviewId?: string
  readonly statement: string
  readonly severity: string
  readonly evidenceIds: readonly string[]
}

export interface M4DParetoExplanation {
  readonly state: string
  readonly rationale: string
  readonly dominatedBy: readonly string[]
  readonly dimensions: Readonly<Record<string, unknown>>
}

export interface M4DExplainabilityProjection {
  readonly hypothesisId: string
  readonly originatingProblem: readonly { readonly nodeId: string; readonly label: string }[]
  readonly evidenceChain: readonly M4DEvidenceChainItem[]
  readonly mutations: readonly M4DMutationExplanation[]
  readonly criticismsSurvived: readonly M4DCriticismExplanation[]
  readonly evaluation: EvaluationRecord
  readonly pareto: M4DParetoExplanation
}

export interface M4DAuditChecks {
  readonly gapProvenanceValidated: boolean
  readonly generation0ProvenanceValidated: boolean
  readonly mutationLineagePreserved: boolean
  readonly mutationCausalityPreserved: boolean
  readonly evaluationCoverageComplete: boolean
  readonly frontierDeterministic: boolean
  readonly populationPreserved: boolean
}

export interface M4DLifecycleArtifacts {
  readonly schemaVersion: 'm4d.lifecycle.v1'
  readonly runId: RunId
  readonly generatedAt: Timestamp
  readonly validatedGap: ResearchGap
  readonly generation0: readonly Generation0Hypothesis[]
  readonly mutation: M4BArtifacts
  readonly evaluation: M4CArtifacts
  readonly finalFrontierHypothesisIds: readonly string[]
  readonly genealogy: readonly { readonly hypothesisId: string; readonly parentIds: readonly string[]; readonly mutationEdgeIds: readonly string[] }[]
  readonly explainability: readonly M4DExplainabilityProjection[]
  readonly report: string
  readonly events: readonly DomainEvent[]
  readonly checkpoint: Checkpoint
  readonly audit: M4DAuditChecks
}
