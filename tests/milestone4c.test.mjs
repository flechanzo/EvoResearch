import assert from 'node:assert/strict'
import test from 'node:test'
import { deterministicId, ValidationError } from '../src/domain/index.ts'
import { createEvaluationRecord, buildM4CArtifacts, selectParetoFrontier, transitionSelectionState, validateEvaluationRecord } from '../src/milestone4c/index.ts'

const now = '2026-10-08T00:00:00.000Z'
const evidenceId = deterministicId('evidence', 'm4c-evidence')

function hypothesis(hypothesisId, overrides = {}) {
  return {
    hypothesisId, generation: 0, parentIds: [], statement: `Hypothesis ${hypothesisId}`, motivation: 'A bounded scientific question.', method: 'Use a reproducible method.', assumptions: ['the input is fixed'], evidenceFor: [evidenceId], evidenceAgainst: [], priorArtReportIds: [], criticismIds: [], experimentIds: [], resultEvidenceIds: [], mutationEdgeIds: [], dimensions: {}, status: 'candidate', createdAt: now, updatedAt: now, ...overrides,
  }
}

function dimensions(values = {}) {
  const defaults = { evidenceSupport: 0.5, feasibility: 0.5, expectedImpact: 0.5, reproducibility: 0.5, noveltyPotential: 0.5, uncertainty: 0.5, experimentalCost: 0.5, priorArtOverlap: 0.5 }
  return { ...defaults, ...values }
}

function evaluation(forHypothesis, values = {}, overrides = {}) {
  return createEvaluationRecord({ hypothesis: forHypothesis, evaluator: 'deterministic-test', evaluationDimensions: dimensions(values), evidenceReferences: [evidenceId], uncertainty: { level: 0.2, reasons: ['bounded fixture uncertainty'] }, timestamp: now, confidence: 0.8, rationale: 'Recorded deterministic fixture evaluation.', ...overrides })
}

test('identical hypotheses and evaluation inputs produce deterministic EvaluationRecords', () => {
  const h = hypothesis('hypothesis_m4c_same')
  const first = evaluation(h, { evidenceSupport: 0.8, feasibility: 0.7 })
  const second = evaluation(h, { evidenceSupport: 0.8, feasibility: 0.7 })
  assert.deepEqual(second, first)
  assert.doesNotThrow(() => validateEvaluationRecord(first))
})

test('Pareto ties preserve both candidates and do not collapse dimensions', () => {
  const hypotheses = [hypothesis('hypothesis_m4c_a'), hypothesis('hypothesis_m4c_b')]
  const evaluations = hypotheses.map(item => evaluation(item, { evidenceSupport: 0.8, feasibility: 0.7, expectedImpact: 0.6, reproducibility: 0.9, noveltyPotential: 0.5, uncertainty: 0.2, experimentalCost: 0.4, priorArtOverlap: 0.3 }))
  const result = selectParetoFrontier({ hypotheses, evaluations, now })
  assert.deepEqual(result.frontierHypothesisIds, hypotheses.map(item => item.hypothesisId).sort())
  assert.deepEqual(result.dominatedHypothesisIds, [])
  assert.deepEqual(result.selectedHypothesisIds, result.frontierHypothesisIds)
  assert.equal(result.states.every(state => state.state === 'SELECTED'), true)
  assert.equal(Object.keys(result.evaluations[0].evaluationDimensions).length, 8)
})

test('dominated hypotheses remain present with deterministic explanations', () => {
  const strong = hypothesis('hypothesis_m4c_strong')
  const weak = hypothesis('hypothesis_m4c_weak')
  const evaluations = [evaluation(strong, { evidenceSupport: 0.9, feasibility: 0.9, expectedImpact: 0.9, reproducibility: 0.9, noveltyPotential: 0.9, uncertainty: 0.1, experimentalCost: 0.1, priorArtOverlap: 0.1 }), evaluation(weak, { evidenceSupport: 0.4, feasibility: 0.4, expectedImpact: 0.4, reproducibility: 0.4, noveltyPotential: 0.4, uncertainty: 0.8, experimentalCost: 0.8, priorArtOverlap: 0.8 })]
  const result = selectParetoFrontier({ hypotheses: [weak, strong], evaluations, now })
  const reason = result.dominanceReasons.find(item => item.hypothesisId === weak.hypothesisId)
  assert.ok(reason)
  assert.deepEqual(reason.dominatedBy, [strong.hypothesisId])
  assert.deepEqual(reason.explanations[0].dimensions, ['evidenceSupport', 'expectedImpact', 'experimentalCost', 'feasibility', 'noveltyPotential', 'priorArtOverlap', 'reproducibility', 'uncertainty'])
  assert.equal(result.states.find(item => item.hypothesisId === weak.hypothesisId).state, 'DOMINATED')
  assert.equal(result.population.some(item => item.hypothesisId === weak.hypothesisId), true)
})

test('replay produces identical frontier, explanations, states, and checkpoint', () => {
  const hypotheses = [hypothesis('hypothesis_m4c_replay_a'), hypothesis('hypothesis_m4c_replay_b')]
  const evaluations = [evaluation(hypotheses[0], { evidenceSupport: 0.7 }), evaluation(hypotheses[1], { evidenceSupport: 0.7 })]
  const request = { runId: 'run_m4c_replay', hypotheses, evaluations, now }
  const first = buildM4CArtifacts(request)
  const replay = buildM4CArtifacts(request)
  assert.deepEqual(replay, first)
  assert.deepEqual(replay.selection.frontierHypothesisIds, first.selection.frontierHypothesisIds)
  assert.equal(replay.checkpoint.stateHash, first.checkpoint.stateHash)
})

test('missing evaluation dimensions fail closed', () => {
  const h = hypothesis('hypothesis_m4c_missing')
  const incomplete = { ...dimensions(), priorArtOverlap: undefined }
  assert.throws(() => createEvaluationRecord({ hypothesis: h, evaluator: 'deterministic-test', evaluationDimensions: incomplete, evidenceReferences: [evidenceId], uncertainty: { level: 0.2, reasons: ['missing dimension fixture'] }, timestamp: now, confidence: 0.8, rationale: 'Incomplete.' }), error => error instanceof ValidationError && error.code === 'MISSING_EVALUATION_DIMENSION')
})

test('selection state machine rejects invalid transitions', () => {
  assert.doesNotThrow(() => transitionSelectionState(null, 'CREATED', 'start'))
  assert.doesNotThrow(() => transitionSelectionState('EVALUATED', 'FRONTIER', 'nondominated'))
  assert.doesNotThrow(() => transitionSelectionState('SELECTED', 'ARCHIVED', 'retired'))
  assert.throws(() => transitionSelectionState('DOMINATED', 'SELECTED', 'dominated cannot be selected'), error => error instanceof ValidationError && error.code === 'INVALID_SELECTION_TRANSITION')
})

test('M4B mutation status remains separate from M4C selection state', () => {
  const mutated = hypothesis('hypothesis_m4c_mutated', { status: 'mutated', reevaluationRequired: true })
  const result = selectParetoFrontier({ hypotheses: [mutated], evaluations: [evaluation(mutated)], now })
  assert.equal(result.population[0].status, 'mutated')
  assert.equal(result.states[0].state, 'SELECTED')
  assert.equal(result.population[0].reevaluationRequired, true)
})
