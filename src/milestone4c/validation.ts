import { deterministicId } from '../domain/ids.ts'
import { parseHypothesis, ValidationError } from '../domain/validation.ts'
import type { Hypothesis, Uncertainty } from '../domain/types.ts'
import { EVALUATION_DIMENSION_DIRECTIONS, EVALUATION_DIMENSION_NAMES, type EvaluationDimension, type EvaluationRecord, type M4CInput, type SelectionState } from './types.ts'

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ValidationError('expected object', path, 'INVALID_M4C_RECORD')
  return value as Record<string, unknown>
}

function string(value: unknown, path: string): asserts value is string {
  if (typeof value !== 'string' || !value.trim()) throw new ValidationError('expected non-empty string', path, 'INVALID_M4C_RECORD')
}

function strings(value: unknown, path: string): asserts value is readonly string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || !item.trim())) throw new ValidationError('expected string array', path, 'INVALID_M4C_RECORD')
  if (new Set(value).size !== value.length) throw new ValidationError('IDs must be unique', path, 'DUPLICATE_ID')
}

function finite(value: unknown, path: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) throw new ValidationError('expected finite number in [0, 1]', path, 'INVALID_M4C_DIMENSION')
}

function time(value: unknown, path: string): asserts value is string {
  string(value, path)
  if (Number.isNaN(Date.parse(value))) throw new ValidationError('expected ISO timestamp', path, 'INVALID_M4C_RECORD')
}

function validateUncertainty(value: unknown, path: string): asserts value is Uncertainty {
  const item = record(value, path)
  finite(item.level, `${path}.level`)
  strings(item.reasons, `${path}.reasons`)
}

function validateDimension(value: unknown, name: string, path: string): EvaluationDimension {
  const item = record(value, path)
  if (item.name !== name) throw new ValidationError('evaluation dimension name must match its key', `${path}.name`, 'INVALID_M4C_DIMENSION')
  if (item.direction !== EVALUATION_DIMENSION_DIRECTIONS[name as keyof typeof EVALUATION_DIMENSION_DIRECTIONS]) throw new ValidationError('evaluation dimension direction is not canonical', `${path}.direction`, 'INVALID_M4C_DIMENSION')
  finite(item.value, `${path}.value`)
  finite(item.uncertainty, `${path}.uncertainty`)
  return item as unknown as EvaluationDimension
}

export function validateEvaluationRecord(value: unknown): EvaluationRecord {
  const item = record(value, '$') as Partial<EvaluationRecord>
  string(item.schemaVersion, '$.schemaVersion')
  if (item.schemaVersion !== 'm4c.evaluation.v1') throw new ValidationError('unsupported evaluation schema version', '$.schemaVersion', 'INVALID_M4C_RECORD')
  string(item.evaluationId, '$.evaluationId'); string(item.hypothesisId, '$.hypothesisId'); string(item.evaluator, '$.evaluator'); string(item.rationale, '$.rationale')
  const dimensions = record(item.evaluationDimensions, '$.evaluationDimensions')
  const keys = Object.keys(dimensions).sort()
  const expected = [...EVALUATION_DIMENSION_NAMES].sort()
  if (JSON.stringify(keys) !== JSON.stringify(expected)) throw new ValidationError('all and only the canonical evaluation dimensions are required', '$.evaluationDimensions', 'INVALID_M4C_DIMENSION')
  for (const name of EVALUATION_DIMENSION_NAMES) validateDimension(dimensions[name], name, `$.evaluationDimensions.${name}`)
  strings(item.evidenceReferences, '$.evidenceReferences')
  validateUncertainty(item.uncertainty, '$.uncertainty')
  time(item.timestamp, '$.timestamp')
  finite(item.confidence, '$.confidence')
  const expectedEvaluationId = deterministicId('evaluation', { hypothesisId: item.hypothesisId, evaluator: item.evaluator, evaluationDimensions: item.evaluationDimensions, evidenceReferences: [...item.evidenceReferences!], uncertainty: item.uncertainty, timestamp: item.timestamp, confidence: item.confidence, rationale: item.rationale })
  if (item.evaluationId !== expectedEvaluationId) throw new ValidationError('evaluationId must be deterministic for the evaluation record contents', '$.evaluationId', 'INVALID_M4C_RECORD')
  return item as EvaluationRecord
}

export function validateM4CInputs(input: M4CInput): { hypotheses: readonly Hypothesis[]; evaluations: readonly EvaluationRecord[] } {
  if (!Array.isArray(input.hypotheses) || !Array.isArray(input.evaluations)) throw new ValidationError('hypotheses and evaluations must be arrays', '$', 'INVALID_M4C_RECORD')
  const seenHypotheses = new Set<string>()
  for (const [index, hypothesis] of input.hypotheses.entries()) {
    parseHypothesis(hypothesis, undefined)
    if (seenHypotheses.has(hypothesis.hypothesisId)) throw new ValidationError('duplicate hypothesis ID', `$.hypotheses[${index}].hypothesisId`, 'DUPLICATE_ID')
    seenHypotheses.add(hypothesis.hypothesisId)
  }
  const evaluations = input.evaluations.map((evaluation, index) => {
    const parsed = validateEvaluationRecord(evaluation)
    if (!seenHypotheses.has(parsed.hypothesisId)) throw new ValidationError('evaluation must reference an existing hypothesis', `$.evaluations[${index}].hypothesisId`, 'INVALID_PROVENANCE')
    return parsed
  })
  const seenEvaluations = new Set<string>()
  for (const [index, evaluation] of evaluations.entries()) {
    if (seenEvaluations.has(evaluation.evaluationId)) throw new ValidationError('duplicate evaluation ID', `$.evaluations[${index}].evaluationId`, 'DUPLICATE_ID')
    if (seenEvaluations.has(evaluation.hypothesisId)) throw new ValidationError('each hypothesis must have exactly one evaluation record', `$.evaluations[${index}].hypothesisId`, 'DUPLICATE_EVALUATION')
    seenEvaluations.add(evaluation.evaluationId)
    seenEvaluations.add(evaluation.hypothesisId)
  }
  if (evaluations.length !== input.hypotheses.length) throw new ValidationError('every hypothesis must have an evaluation record', '$.evaluations', 'MISSING_EVALUATION')
  return { hypotheses: input.hypotheses, evaluations }
}

const ALLOWED_TRANSITIONS: Readonly<Record<SelectionState, readonly SelectionState[]>> = {
  CREATED: ['EVALUATED'],
  EVALUATED: ['FRONTIER', 'DOMINATED'],
  FRONTIER: ['SELECTED', 'ARCHIVED'],
  DOMINATED: ['ARCHIVED'],
  SELECTED: ['ARCHIVED'],
  ARCHIVED: [],
}

export function transitionSelectionState(from: SelectionState | null, to: SelectionState, reason: string): { from: SelectionState | null; to: SelectionState; reason: string } {
  string(reason, '$.reason')
  if (from === null && to !== 'CREATED') throw new ValidationError('selection must begin in CREATED state', '$.to', 'INVALID_SELECTION_TRANSITION')
  if (from !== null && !ALLOWED_TRANSITIONS[from].includes(to)) throw new ValidationError(`selection state cannot transition from ${from} to ${to}`, '$.to', 'INVALID_SELECTION_TRANSITION')
  return { from, to, reason }
}
