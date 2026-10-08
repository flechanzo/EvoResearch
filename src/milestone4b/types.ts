import type {
  BudgetLedger, Checkpoint, Criticism, DomainEvent, Evidence, Hypothesis, MutationEdge,
  MutationType, Review, Timestamp,
} from '../domain/types.ts'
import type { RunId } from '../domain/ids.ts'

/** The provenance fields emitted by M4A and carried unchanged through evolution. */
export interface M4AProvenanceFields {
  readonly originatingGapIds: readonly string[]
  readonly sourceProblemNodeIds: readonly string[]
  readonly sourceClaimIds: readonly string[]
  readonly sourceEvidenceIds: readonly string[]
}

export type EvolvableHypothesis = Hypothesis & M4AProvenanceFields & Record<string, unknown>

/** M4B's durable edge projection adds the specific criticisms absent from the M1-M3 core edge schema. */
export type M4BMutationEdge = MutationEdge & {
  readonly criticismIds: readonly string[]
}

/** A deterministic, already-reviewed mutation request. No model call is implied. */
export interface MutationProposal {
  readonly parentHypothesisId: string
  readonly criticReviewId: string
  readonly criticismIds: readonly string[]
  readonly mutationType: MutationType
  readonly reason: string
  readonly evidenceIds: readonly string[]
  readonly changedFields: readonly string[]
  readonly statement?: string
  readonly motivation?: string
  readonly method?: string
  readonly assumptions?: readonly string[]
  readonly evidenceFor?: readonly string[]
  readonly evidenceAgainst?: readonly string[]
}

export interface HypothesisEvolutionInput {
  readonly runId?: RunId
  readonly hypotheses: readonly EvolvableHypothesis[]
  readonly reviews: readonly Review[]
  readonly criticisms: readonly Criticism[]
  readonly evidence: readonly (Evidence & Record<string, unknown>)[]
  readonly mutationProposals?: readonly MutationProposal[]
  readonly existingMutations?: readonly M4BMutation[]
  readonly now: Timestamp
  readonly budget?: BudgetLedger
  readonly previousCheckpoint?: Checkpoint
  readonly startingSequence?: number
}

export interface HypothesisEvolutionOptions {
  readonly mutationBudget?: number
}

export interface MutationRejection {
  readonly parentHypothesisId?: string
  readonly criticReviewId?: string
  readonly criticismIds: readonly string[]
  readonly reason: string
}

export interface M4BMutation {
  readonly edge: M4BMutationEdge
  /** Kept as a convenient projection and required to match edge.criticismIds. */
  readonly criticismIds: readonly string[]
}

export interface HypothesisEvolutionResult {
  readonly schemaVersion: 'm4b.hypothesis-evolution.v1'
  readonly generatedAt: Timestamp
  readonly generation: number
  readonly hypotheses: readonly EvolvableHypothesis[]
  readonly children: readonly EvolvableHypothesis[]
  readonly mutations: readonly M4BMutation[]
  readonly mutationEdges: readonly M4BMutationEdge[]
  readonly newMutations: readonly M4BMutation[]
  readonly newMutationEdges: readonly M4BMutationEdge[]
  readonly rejected: readonly MutationRejection[]
  readonly provenance: readonly {
    readonly childHypothesisId: string
    readonly parentHypothesisId: string
    readonly criticReviewId: string
    readonly criticismIds: readonly string[]
    readonly evidenceIds: readonly string[]
    readonly mutationEdgeId: string
  }[]
}

export interface M4BArtifacts {
  readonly evolution: HypothesisEvolutionResult
  readonly events: readonly DomainEvent[]
  readonly checkpoint: Checkpoint
}
