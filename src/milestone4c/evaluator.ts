import { deterministicId } from '../domain/ids.ts'
import { ValidationError } from '../domain/validation.ts'
import type { EvaluationDimension, EvaluationDimensionInput, EvaluationRecord, EvaluationRequest, EvaluationDimensions } from './types.ts'
import { EVALUATION_DIMENSION_DIRECTIONS, EVALUATION_DIMENSION_NAMES } from './types.ts'
import { validateEvaluationRecord } from './validation.ts'

function normalizeDimension(input: EvaluationDimensionInput, name: EvaluationDimension['name']): EvaluationDimension {
  if (typeof input !== 'number') {
    if (input.name !== undefined && input.name !== name) throw new ValidationError('evaluation dimension name must match its key', `$.evaluationDimensions.${name}.name`, 'INVALID_M4C_DIMENSION')
    if (input.direction !== undefined && input.direction !== EVALUATION_DIMENSION_DIRECTIONS[name]) throw new ValidationError('evaluation dimension direction is not canonical', `$.evaluationDimensions.${name}.direction`, 'INVALID_M4C_DIMENSION')
  }
  const value = typeof input === 'number' ? input : input.value
  const uncertainty = typeof input === 'number' ? 0 : (input.uncertainty ?? 0)
  const direction = EVALUATION_DIMENSION_DIRECTIONS[name]
  return { name, direction, value, uncertainty }
}

export function createEvaluationRecord(request: EvaluationRequest): EvaluationRecord {
  for (const name of EVALUATION_DIMENSION_NAMES) if (!request.evaluationDimensions || request.evaluationDimensions[name] === undefined) throw new ValidationError('all canonical evaluation dimensions are required', `$.evaluationDimensions.${name}`, 'MISSING_EVALUATION_DIMENSION')
  if (JSON.stringify(Object.keys(request.evaluationDimensions).sort()) !== JSON.stringify([...EVALUATION_DIMENSION_NAMES].sort())) throw new ValidationError('all and only the canonical evaluation dimensions are required', '$.evaluationDimensions', 'INVALID_M4C_DIMENSION')
  const evaluationDimensions = Object.fromEntries(EVALUATION_DIMENSION_NAMES.map(name => [name, normalizeDimension(request.evaluationDimensions[name], name)])) as EvaluationDimensions
  const signature = { hypothesisId: request.hypothesis.hypothesisId, evaluator: request.evaluator, evaluationDimensions, evidenceReferences: [...request.evidenceReferences], uncertainty: request.uncertainty, timestamp: request.timestamp, confidence: request.confidence, rationale: request.rationale }
  const record: EvaluationRecord = { schemaVersion: 'm4c.evaluation.v1', evaluationId: deterministicId('evaluation', signature), hypothesisId: request.hypothesis.hypothesisId, evaluator: request.evaluator, evaluationDimensions, evidenceReferences: [...request.evidenceReferences], uncertainty: request.uncertainty, timestamp: request.timestamp, confidence: request.confidence, rationale: request.rationale }
  return validateEvaluationRecord(record)
}

export const evaluateHypothesis = createEvaluationRecord
export const createEvaluation = createEvaluationRecord
