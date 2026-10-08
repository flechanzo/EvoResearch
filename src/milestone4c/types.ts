import type { BudgetLedger, Checkpoint, Hypothesis, Timestamp, Uncertainty } from '../domain/types.ts'
import type { RunId } from '../domain/ids.ts'

export const EVALUATION_DIMENSION_NAMES = [
  'evidenceSupport', 'feasibility', 'expectedImpact', 'reproducibility', 'noveltyPotential',
  'uncertainty', 'experimentalCost', 'priorArtOverlap',
] as const

export type EvaluationDimensionName = typeof EVALUATION_DIMENSION_NAMES[number]
export type EvaluationDirection = 'maximize' | 'minimize'

export const EVALUATION_DIMENSION_DIRECTIONS: Readonly<Record<EvaluationDimensionName, EvaluationDirection>> = {
  evidenceSupport: 'maximize',
  feasibility: 'maximize',
  expectedImpact: 'maximize',
  reproducibility: 'maximize',
  noveltyPotential: 'maximize',
  uncertainty: 'minimize',
  experimentalCost: 'minimize',
  priorArtOverlap: 'minimize',
}

export interface EvaluationDimension {
  readonly name: EvaluationDimensionName
  readonly direction: EvaluationDirection
  readonly value: number
  readonly uncertainty: number
}

export type EvaluationDimensions = Readonly<Record<EvaluationDimensionName, EvaluationDimension>>

export type EvaluationDimensionInput = number | {
  readonly value: number
  readonly uncertainty?: number
  readonly name?: string
  readonly direction?: string
}

export type EvaluationDimensionInputs = Readonly<Record<EvaluationDimensionName, EvaluationDimensionInput>>

export interface EvaluationRecord {
  readonly schemaVersion: 'm4c.evaluation.v1'
  readonly evaluationId: string
  readonly hypothesisId: string
  readonly evaluator: string
  readonly evaluationDimensions: EvaluationDimensions
  readonly evidenceReferences: readonly string[]
  readonly uncertainty: Uncertainty
  readonly timestamp: Timestamp
  readonly confidence: number
  readonly rationale: string
}

export interface EvaluationRequest {
  readonly hypothesis: Hypothesis
  readonly evaluator: string
  readonly evaluationDimensions: EvaluationDimensionInputs
  readonly evidenceReferences: readonly string[]
  readonly uncertainty: Uncertainty
  readonly timestamp: Timestamp
  readonly confidence: number
  readonly rationale: string
}

export type SelectionState = 'CREATED' | 'EVALUATED' | 'FRONTIER' | 'DOMINATED' | 'SELECTED' | 'ARCHIVED'

export interface SelectionTransition {
  readonly from: SelectionState | null
  readonly to: SelectionState
  readonly reason: string
}

export interface DominanceExplanation {
  readonly dominatorHypothesisId: string
  readonly dimensions: readonly EvaluationDimensionName[]
}

export interface DominanceReason {
  readonly hypothesisId: string
  readonly dominatedBy: readonly string[]
  readonly explanations: readonly DominanceExplanation[]
  readonly rationale: string
}

export interface SelectionStateRecord {
  readonly hypothesisId: string
  readonly state: SelectionState
  readonly history: readonly SelectionTransition[]
  readonly reason: string
  readonly evaluationId: string
  readonly timestamp: Timestamp
}

export interface ParetoSelectionResult {
  readonly schemaVersion: 'm4c.pareto-selection.v1'
  readonly generatedAt: Timestamp
  readonly population: readonly Hypothesis[]
  readonly evaluations: readonly EvaluationRecord[]
  readonly frontierHypothesisIds: readonly string[]
  readonly dominatedHypothesisIds: readonly string[]
  readonly selectedHypothesisIds: readonly string[]
  readonly dominanceReasons: readonly DominanceReason[]
  readonly states: readonly SelectionStateRecord[]
}

export interface M4CInput {
  readonly runId?: RunId
  readonly hypotheses: readonly Hypothesis[]
  readonly evaluations: readonly EvaluationRecord[]
  readonly now: Timestamp
  readonly selectionLimit?: number
  readonly budget?: BudgetLedger
  readonly previousCheckpoint?: Checkpoint
  readonly startingSequence?: number
}

export interface M4CArtifacts {
  readonly selection: ParetoSelectionResult
  readonly checkpoint: Checkpoint
}
