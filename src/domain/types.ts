import type {
  ArtifactId, CheckpointId, ClaimId, CriticismId, DomainEventId, EvidenceId,
  EvidenceLinkId, ExperimentDesignId, GraphEdgeId, GraphNodeId, HypothesisId,
  MutationEdgeId, PaperId, PriorArtReportId, ProblemId, ReviewId, RunId,
} from './ids.ts'

export type Timestamp = string

export type ProvenanceSourceType = 'paper' | 'artifact' | 'claim' | 'url' | 'tool' | 'model' | 'human' | 'experiment'

export interface Provenance {
  readonly sourceType: ProvenanceSourceType
  readonly sourceId: string
  readonly locator?: string
  readonly quotedText?: string
  readonly contentHash?: string
  readonly retrievedAt?: Timestamp
  readonly provider?: string
  readonly query?: string
  readonly provenancePath?: EvidenceProvenancePath
}

export type CoverageStatus = 'COMPLETE' | 'PARTIAL' | 'FAILED' | 'NO_RESULTS'

export interface EvidenceProvenancePath {
  readonly originProblemNodeIds: readonly GraphNodeId[]
  readonly retrievalNeedId: string
  readonly queryId: string
  readonly searchCoverageId: string
  readonly searchCoverageStatus: CoverageStatus
  readonly corpusCutoff?: string
}

export interface Paper {
  readonly paperId: PaperId
  readonly title: string
  readonly authors: readonly string[]
  readonly publicationYear?: number
  readonly identifiers: Readonly<Record<string, string>>
  readonly sourceUrls: readonly string[]
  readonly artifactIds: readonly ArtifactId[]
  readonly retrievedAt?: Timestamp
}

export type PaperArtifactKind = 'pdf' | 'text' | 'html' | 'other'

export interface PaperArtifact {
  readonly artifactId: ArtifactId
  readonly paperId: PaperId
  readonly kind: PaperArtifactKind
  readonly contentHash: string
  readonly byteLength: number
  readonly uri?: string
  readonly createdAt: Timestamp
}

export type ClaimKind = 'observation' | 'interpretation' | 'result' | 'method' | 'limitation' | 'open-question'

export interface Claim {
  readonly claimId: ClaimId
  readonly paperId?: PaperId
  readonly statement: string
  readonly kind: ClaimKind
  readonly provenance: Provenance
  readonly artifactId?: ArtifactId
}

export type EvidencePolarity = 'SUPPORT' | 'CONTRADICT' | 'WEAKEN' | 'MOTIVATE'
export type EvidenceKind = 'quote' | 'observation' | 'table' | 'result' | 'tool-result' | 'interpretation'

export interface Evidence {
  readonly evidenceId: EvidenceId
  readonly kind: EvidenceKind
  readonly claim: string
  readonly polarity: EvidencePolarity
  readonly provenance: Provenance
  readonly claimIds: readonly ClaimId[]
  readonly limitations: readonly string[]
  readonly confidence: number
  readonly createdAt: Timestamp
}

export type EvidenceTargetType = 'problem' | 'hypothesis' | 'graph-edge' | 'claim'

export interface EvidenceLink {
  readonly evidenceLinkId: EvidenceLinkId
  readonly evidenceId: EvidenceId
  readonly targetType: EvidenceTargetType
  readonly targetId: string
  readonly relation: EvidencePolarity
  readonly rationale: string
}

export type ResearchNodeType = 'paper' | 'problem' | 'method' | 'assumption' | 'dataset' | 'metric' | 'limitation' | 'failure-case' | 'open-question' | 'claim'

export interface ResearchProblem {
  readonly problemId: ProblemId
  readonly statement: string
  readonly evidenceIds: readonly EvidenceId[]
  readonly methodIds: readonly GraphNodeId[]
  readonly assumptionIds: readonly GraphNodeId[]
  readonly limitationIds: readonly GraphNodeId[]
  readonly failureCaseIds: readonly GraphNodeId[]
  readonly openQuestionIds: readonly GraphNodeId[]
}

export interface ResearchGraphNode {
  readonly nodeId: GraphNodeId
  readonly type: ResearchNodeType
  readonly label: string
  readonly evidenceIds: readonly EvidenceId[]
}

export interface ResearchGraphEdge {
  readonly edgeId: GraphEdgeId
  readonly from: string
  readonly to: string
  readonly relation: string
  readonly evidenceIds: readonly EvidenceId[]
}

export interface ResearchProblemGraph {
  readonly problems: readonly ResearchProblem[]
  readonly nodes: readonly ResearchGraphNode[]
  readonly edges: readonly ResearchGraphEdge[]
}

export type HypothesisStatus = 'candidate' | 'challenged' | 'mutated' | 'surviving' | 'rejected' | 'tested' | 'superseded'

export type MutationType =
  | 'REMOVE_ASSUMPTION' | 'REPLACE_COMPONENT' | 'COMBINE_MECHANISM' | 'NARROW_SCOPE'
  | 'GENERALIZE_SCOPE' | 'CHANGE_OBJECTIVE' | 'CHANGE_REPRESENTATION' | 'ADD_CONSTRAINT'
  | 'REMOVE_CONSTRAINT' | 'ADDRESS_COUNTEREXAMPLE' | 'INCORPORATE_PRIOR_ART' | 'CHANGE_EVALUATION'

export interface SearchQuery {
  readonly query: string
  readonly provider: string
  readonly resultCount: number
  readonly executedAt: Timestamp
}

export interface SearchCoverage {
  readonly queries: readonly SearchQuery[]
  readonly sourcesConsidered: number
  readonly sourcesFound: number
  readonly corpusDescription: string
  readonly completed: boolean
}

export interface Uncertainty {
  readonly level: number
  readonly reasons: readonly string[]
}

export interface PriorArtReference {
  readonly sourceId: string
  readonly title: string
  readonly url?: string
  readonly overlapDimensions: readonly string[]
  readonly differenceDimensions: readonly string[]
  readonly provenance: Provenance
}

export type NoveltyAssessment = 'unresolved' | 'possible-difference' | 'overlap-found' | 'insufficient-search'

export interface NoveltyEvidence {
  readonly closestPriorArt: readonly PriorArtReference[]
  readonly overlapDimensions: readonly string[]
  readonly differenceDimensions: readonly string[]
  readonly searchQueries: readonly SearchQuery[]
  readonly searchCoverage: SearchCoverage
  readonly unresolvedOverlap: readonly string[]
  readonly uncertainty: Uncertainty
  readonly assessment: NoveltyAssessment
}

export interface PriorArtReport {
  readonly priorArtReportId: PriorArtReportId
  readonly hypothesisId: HypothesisId
  readonly noveltyEvidence: NoveltyEvidence
  readonly closestPriorArt: readonly PriorArtReference[]
  readonly overlapDimensions: readonly string[]
  readonly differenceDimensions: readonly string[]
  readonly searchCoverage: SearchCoverage
  readonly uncertainty: Uncertainty
  readonly createdAt: Timestamp
}

export type ScientificDimensionName = 'novelty' | 'prior_art_distance' | 'empirical_support' | 'theoretical_consistency' | 'feasibility' | 'expected_impact' | 'experimental_cost' | 'uncertainty' | 'reproducibility'

export interface ScientificDimension {
  readonly name: ScientificDimensionName
  readonly value: number
  readonly direction: 'maximize' | 'minimize'
  readonly uncertainty: number
  readonly evidenceIds: readonly EvidenceId[]
  readonly evaluator: 'deterministic' | 'model-estimate' | 'human'
  readonly assessedAt: Timestamp
}

export interface Hypothesis {
  readonly hypothesisId: HypothesisId
  readonly generation: number
  readonly parentIds: readonly HypothesisId[]
  readonly statement: string
  readonly motivation: string
  readonly method: string
  readonly assumptions: readonly string[]
  readonly evidenceFor: readonly EvidenceId[]
  readonly evidenceAgainst: readonly EvidenceId[]
  readonly priorArtReportIds: readonly PriorArtReportId[]
  readonly criticismIds: readonly CriticismId[]
  readonly experimentIds: readonly ExperimentDesignId[]
  readonly resultEvidenceIds: readonly EvidenceId[]
  readonly mutationEdgeIds: readonly MutationEdgeId[]
  readonly dimensions: Readonly<Partial<Record<ScientificDimensionName, ScientificDimension>>>
  readonly noveltyEvidence?: NoveltyEvidence
  readonly noveltyEstimate?: { readonly value: number; readonly rationale: string; readonly evaluator: 'model-estimate' | 'human' }
  readonly status: HypothesisStatus
  readonly createdAt: Timestamp
  readonly updatedAt: Timestamp
}

export type CriticismSeverity = 'low' | 'medium' | 'high' | 'fatal'

export interface Criticism {
  readonly criticismId: CriticismId
  readonly hypothesisId: HypothesisId
  readonly reviewerRole: string
  readonly reviewId?: ReviewId
  readonly statement: string
  readonly severity: CriticismSeverity
  readonly evidenceIds: readonly EvidenceId[]
  readonly createdAt: Timestamp
}

export interface MutationEdge {
  readonly mutationEdgeId: MutationEdgeId
  readonly parentHypothesisId: HypothesisId
  readonly childHypothesisId: HypothesisId
  readonly mutationType: MutationType
  readonly reason: string
  readonly criticReviewId: ReviewId
  readonly evidenceIds: readonly EvidenceId[]
  readonly changedFields: readonly string[]
  readonly timestamp: Timestamp
}

export interface Review {
  readonly reviewId: ReviewId
  readonly hypothesisId: HypothesisId
  readonly role: string
  readonly summary: string
  readonly criticismIds: readonly CriticismId[]
  readonly evidenceIds: readonly EvidenceId[]
  readonly dimensions: readonly ScientificDimension[]
  readonly createdAt: Timestamp
}

export interface ExperimentDesign {
  readonly experimentDesignId: ExperimentDesignId
  readonly hypothesisId: HypothesisId
  readonly objective: string
  readonly variables: readonly string[]
  readonly baselines: readonly string[]
  readonly datasets: readonly string[]
  readonly metrics: readonly string[]
  readonly expectedOutcomes: readonly string[]
  readonly falsificationConditions: readonly string[]
  readonly discriminativeRationale: string
  readonly estimatedCost: number
  readonly evidenceIds: readonly EvidenceId[]
  readonly createdAt: Timestamp
}

export interface BudgetLimits {
  readonly maxModelCalls: number
  readonly maxSearchCalls: number
  readonly maxCandidates: number
  readonly maxMutations: number
  readonly maxTokens: number
}

export interface BudgetUsage extends BudgetLimits {}

export interface BudgetLedger {
  readonly limits: BudgetLimits
  readonly usage: BudgetUsage
}

/** Append-only lifecycle events emitted by a persisted run. */
export type DomainEventType = 'run.created' | 'paper.ingested' | 'evidence.added' | 'hypothesis.created' | 'review.created' | 'hypothesis.mutated' | 'frontier.selected' | 'checkpoint.created' | 'stage.started' | 'stage.completed' | 'stage.failed' | 'model.attempt'

export interface DomainEvent {
  readonly eventId: DomainEventId
  readonly runId: RunId
  readonly sequence: number
  readonly type: DomainEventType
  readonly occurredAt: Timestamp
  readonly payload: Readonly<Record<string, unknown>>
}

export interface Checkpoint {
  readonly checkpointId: CheckpointId
  readonly runId: RunId
  readonly sequence: number
  readonly stateHash: string
  readonly populationIds: readonly HypothesisId[]
  readonly budget: BudgetLedger
  readonly corpusCutoff?: string
  readonly createdAt: Timestamp
}
