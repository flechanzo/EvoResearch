import type { EvaluationDimensionName, EvaluationRecord, DominanceExplanation, DominanceReason, ParetoSelectionResult, SelectionStateRecord, SelectionTransition } from './types.ts'
import type { Hypothesis } from '../domain/types.ts'
import { ValidationError } from '../domain/validation.ts'
import { validateM4CInputs, transitionSelectionState } from './validation.ts'

function compare(left: EvaluationRecord['evaluationDimensions'][EvaluationDimensionName], right: EvaluationRecord['evaluationDimensions'][EvaluationDimensionName]): number {
  const delta = left.direction === 'maximize' ? left.value - right.value : right.value - left.value
  const tolerance = Math.max(left.uncertainty, right.uncertainty)
  if (delta > tolerance) return 1
  if (delta < -tolerance) return -1
  return 0
}

function dimensionWins(left: EvaluationRecord, right: EvaluationRecord): EvaluationDimensionName[] {
  return (Object.keys(left.evaluationDimensions) as EvaluationDimensionName[]).filter(name => compare(left.evaluationDimensions[name], right.evaluationDimensions[name]) > 0).sort()
}

export function dominates(left: EvaluationRecord, right: EvaluationRecord): boolean {
  const comparisons = (Object.keys(left.evaluationDimensions) as EvaluationDimensionName[]).map(name => compare(left.evaluationDimensions[name], right.evaluationDimensions[name]))
  return comparisons.every(value => value >= 0) && comparisons.some(value => value > 0)
}

function stateRecord(hypothesisId: string, evaluationId: string, timestamp: string, transitions: readonly SelectionTransition[], reason: string): SelectionStateRecord {
  return { hypothesisId, evaluationId, timestamp, state: transitions[transitions.length - 1].to, history: transitions, reason }
}

export function selectParetoFrontier(input: { readonly hypotheses: readonly Hypothesis[]; readonly evaluations: readonly EvaluationRecord[]; readonly now: string; readonly selectionLimit?: number }): ParetoSelectionResult {
  const { hypotheses, evaluations } = validateM4CInputs({ hypotheses: input.hypotheses, evaluations: input.evaluations, now: input.now })
  if (input.selectionLimit !== undefined && (!Number.isSafeInteger(input.selectionLimit) || input.selectionLimit < 0)) throw new ValidationError('selectionLimit must be a non-negative integer', '$.selectionLimit', 'INVALID_M4C_RECORD')
  const byId = new Map(evaluations.map(evaluation => [evaluation.hypothesisId, evaluation]))
  const sortedHypotheses = [...hypotheses].sort((a, b) => a.hypothesisId.localeCompare(b.hypothesisId))
  const frontier: string[] = []
  const dominated: string[] = []
  const dominanceReasons: DominanceReason[] = []
  for (const hypothesis of sortedHypotheses) {
    const candidate = byId.get(hypothesis.hypothesisId)!
    const dominators = sortedHypotheses.filter(other => other.hypothesisId !== hypothesis.hypothesisId && dominates(byId.get(other.hypothesisId)!, candidate))
    if (!dominators.length) frontier.push(hypothesis.hypothesisId)
    else {
      const explanations: DominanceExplanation[] = dominators.map(other => ({ dominatorHypothesisId: other.hypothesisId, dimensions: dimensionWins(byId.get(other.hypothesisId)!, candidate) }))
      dominated.push(hypothesis.hypothesisId)
      dominanceReasons.push({ hypothesisId: hypothesis.hypothesisId, dominatedBy: dominators.map(item => item.hypothesisId), explanations, rationale: `Dominated by ${dominators.map(item => item.hypothesisId).join(', ')} on the recorded evaluation dimensions.` })
    }
  }
  const selected = frontier.slice(0, input.selectionLimit ?? frontier.length)
  const states: SelectionStateRecord[] = []
  for (const hypothesis of sortedHypotheses) {
    const evaluation = byId.get(hypothesis.hypothesisId)!
    const transitions: SelectionTransition[] = [
      transitionSelectionState(null, 'CREATED', 'Hypothesis entered the M4C selection population.'),
      transitionSelectionState('CREATED', 'EVALUATED', 'A complete deterministic evaluation record was accepted.'),
    ]
    if (dominated.includes(hypothesis.hypothesisId)) {
      transitions.push(transitionSelectionState('EVALUATED', 'DOMINATED', dominanceReasons.find(reason => reason.hypothesisId === hypothesis.hypothesisId)!.rationale))
      states.push(stateRecord(hypothesis.hypothesisId, evaluation.evaluationId, input.now, transitions, 'Dominated by one or more hypotheses.'))
    } else if (selected.includes(hypothesis.hypothesisId)) {
      transitions.push(transitionSelectionState('EVALUATED', 'FRONTIER', 'No hypothesis deterministically dominates this candidate.'))
      transitions.push(transitionSelectionState('FRONTIER', 'SELECTED', 'Selected from the reproducible Pareto frontier.'))
      states.push(stateRecord(hypothesis.hypothesisId, evaluation.evaluationId, input.now, transitions, 'Selected Pareto-frontier candidate.'))
    } else {
      transitions.push(transitionSelectionState('EVALUATED', 'FRONTIER', 'No hypothesis deterministically dominates this candidate.'))
      transitions.push(transitionSelectionState('FRONTIER', 'ARCHIVED', 'Frontier candidate exceeded the deterministic selection limit.'))
      states.push(stateRecord(hypothesis.hypothesisId, evaluation.evaluationId, input.now, transitions, 'Archived after deterministic frontier limit.'))
    }
  }
  return { schemaVersion: 'm4c.pareto-selection.v1', generatedAt: input.now, population: sortedHypotheses, evaluations: [...evaluations].sort((a, b) => a.hypothesisId.localeCompare(b.hypothesisId)), frontierHypothesisIds: frontier, dominatedHypothesisIds: dominated, selectedHypothesisIds: selected, dominanceReasons, states }
}

export const paretoSelect = selectParetoFrontier
