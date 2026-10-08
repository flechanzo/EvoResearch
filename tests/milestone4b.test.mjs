import assert from 'node:assert/strict'
import test from 'node:test'
import { contentHash, deterministicId, parseCheckpoint, parseDomainEvent, parseHypothesis, parseMutationEdge, ValidationError } from '../src/domain/index.ts'
import { buildM4BArtifacts, evolveHypotheses } from '../src/milestone4b/index.ts'

const now = '2026-10-07T00:00:00.000Z'
const runId = deterministicId('run', 'm4b-test')
const evidenceId = deterministicId('evidence', 'm4b-direct')
const gapId = deterministicId('research_gap', 'm4b-gap')
const parentId = deterministicId('hypothesis', 'm4b-parent')
const reviewId = deterministicId('review', 'm4b-review')
const criticismId = deterministicId('criticism', 'm4b-criticism')

function directEvidence() {
  return { evidenceId, kind: 'observation', claim: 'The baseline fails on the boundary case', polarity: 'WEAKEN', provenance: { sourceType: 'paper', sourceId: 'paper_m4b' }, claimIds: [], limitations: [], confidence: 0.8, createdAt: now }
}

function parent() {
  return {
    hypothesisId: parentId, generation: 0, parentIds: [], statement: 'The method should handle the boundary case.', motivation: 'A structured limitation remains unresolved.', method: 'Apply the baseline method.', assumptions: ['the input distribution is stable'], evidenceFor: [evidenceId], evidenceAgainst: [], priorArtReportIds: [], criticismIds: [], experimentIds: [], resultEvidenceIds: [], mutationEdgeIds: [], dimensions: {}, status: 'candidate', createdAt: now, updatedAt: now,
    originatingGapIds: [gapId], sourceProblemNodeIds: ['graph_node_m4b'], sourceClaimIds: [], sourceEvidenceIds: [evidenceId], proposedMechanism: 'The baseline mechanism should transfer.', expectedMechanism: 'The boundary behavior should improve.', falsificationConditions: ['the boundary behavior remains unchanged'], expectedObservableResult: 'The boundary error decreases.', discriminativeExperimentIdea: 'Compare baseline and intervention on the boundary case.', generationOperator: 'REPLACE_COMPONENT', epistemicStatus: 'PROVISIONAL_UNVERIFIED', noveltyStatus: 'UNVERIFIED', uncertainty: { level: 0.5, reasons: ['unresolved limitation'] }, inputCompleteness: { status: 'INCOMPLETE', exhaustive: false, scientificallyComplete: false },
  }
}

function review() {
  return { reviewId, hypothesisId: parentId, role: 'Reviewer2', summary: 'The proposed mechanism leaves the boundary case unexplained.', criticismIds: [criticismId], evidenceIds: [evidenceId], dimensions: [], createdAt: now }
}

function criticism() {
  return { criticismId, hypothesisId: parentId, reviewId, reviewerRole: 'Reviewer2', statement: 'The method has no bounded response to the observed boundary failure.', severity: 'high', evidenceIds: [evidenceId], createdAt: now }
}

function budget() {
  return { limits: { maxModelCalls: 0, maxSearchCalls: 0, maxCandidates: 10, maxMutations: 3, maxTokens: 0 }, usage: { maxModelCalls: 0, maxSearchCalls: 0, maxCandidates: 0, maxMutations: 0, maxTokens: 0 } }
}

function input(overrides = {}) {
  return { runId, hypotheses: [parent()], reviews: [review()], criticisms: [criticism()], evidence: [directEvidence()], now, budget: budget(), ...overrides }
}

test('M4B mutation is deterministic and preserves immutable M4A genealogy', () => {
  const request = input()
  const before = structuredClone(request.hypotheses[0])
  const first = evolveHypotheses(request)
  const second = evolveHypotheses(request)
  assert.deepEqual(second, first)
  assert.deepEqual(request.hypotheses[0], before)
  assert.equal(first.children.length, 1)
  assert.equal(first.mutations.length, 1)
  const child = first.children[0]
  const edge = first.mutations[0].edge
  assert.deepEqual(child.parentIds, [parentId])
  assert.equal(child.generation, 1)
  assert.equal(child.status, 'mutated')
  assert.equal(child.reevaluationRequired, true)
  assert.deepEqual(child.dimensions, {})
  assert.deepEqual(child.originatingGapIds, request.hypotheses[0].originatingGapIds)
  assert.deepEqual(child.sourceProblemNodeIds, request.hypotheses[0].sourceProblemNodeIds)
  assert.deepEqual(child.sourceClaimIds, request.hypotheses[0].sourceClaimIds)
  assert.deepEqual(child.sourceEvidenceIds, request.hypotheses[0].sourceEvidenceIds)
  assert.ok(child.criticismIds.includes(criticismId))
  assert.ok(child.mutationEdgeIds.includes(edge.mutationEdgeId))
  assert.equal(edge.parentHypothesisId, parentId)
  assert.equal(edge.childHypothesisId, child.hypothesisId)
  assert.equal(edge.criticReviewId, reviewId)
  assert.deepEqual(edge.criticismIds, [criticismId])
  assert.deepEqual(edge.evidenceIds, [evidenceId])
  assert.deepEqual(edge.changedFields, ['method', 'statement'])
  assert.notEqual(child.statement, request.hypotheses[0].statement)
  assert.notEqual(child.method, request.hypotheses[0].method)
  assert.equal(edge.mutationType, 'ADDRESS_COUNTEREXAMPLE')
  assert.doesNotThrow(() => parseMutationEdge(edge, new Set([parentId, child.hypothesisId])))
  assert.doesNotThrow(() => parseHypothesis(child, new Set([evidenceId])))
})

test('M4B validates parent, review, criticism, and evidence links before materialization', () => {
  assert.throws(() => evolveHypotheses(input({ mutationProposals: [{ parentHypothesisId: 'hypothesis_missing', criticReviewId: reviewId, criticismIds: [criticismId], mutationType: 'NARROW_SCOPE', reason: 'bad parent', evidenceIds: [evidenceId], changedFields: ['method'] }] })), error => error instanceof ValidationError && error.code === 'INVALID_MUTATION_PARENT')
  assert.throws(() => evolveHypotheses(input({ mutationProposals: [{ parentHypothesisId: parentId, criticReviewId: reviewId, criticismIds: [criticismId], mutationType: 'NARROW_SCOPE', reason: 'missing evidence', evidenceIds: [], changedFields: ['method'] }] })), error => error instanceof ValidationError && error.code === 'INVALID_M4B_PROVENANCE')
  const modelEvidence = { ...directEvidence(), evidenceId: deterministicId('evidence', 'm4b-model'), modelInterpretation: true, evidenceLevel: 'MODEL_INTERPRETATION' }
  assert.doesNotThrow(() => evolveHypotheses(input({ evidence: [directEvidence(), modelEvidence] })))
  const modelSourcedEvidence = { ...directEvidence(), evidenceId: deterministicId('evidence', 'm4b-model-source'), provenance: { sourceType: 'model', sourceId: 'model_m4b' } }
  assert.throws(() => evolveHypotheses(input({ evidence: [modelSourcedEvidence], hypotheses: [parentWithEvidence(modelSourcedEvidence.evidenceId)], reviews: [reviewWithEvidence(modelSourcedEvidence.evidenceId)], criticisms: [criticismWithEvidence(modelSourcedEvidence.evidenceId)] })), error => error instanceof ValidationError && error.code === 'INVALID_PROVENANCE')
})

test('M4B rejects a mutation without a specific criticism', () => {
  assert.throws(() => evolveHypotheses(input({ mutationProposals: [{ parentHypothesisId: parentId, criticReviewId: reviewId, criticismIds: [], mutationType: 'NARROW_SCOPE', reason: 'unlinked', evidenceIds: [evidenceId], changedFields: ['method'] }] })), error => error instanceof ValidationError && error.code === 'INVALID_M4B_PROVENANCE')
})

test('M4B rejects MODEL_INTERPRETATION evidence as mutation evidence', () => {
  const modelId = deterministicId('evidence', 'm4b-model-only')
  const modelEvidence = { ...directEvidence(), evidenceId: modelId, modelInterpretation: true, evidenceLevel: 'MODEL_INTERPRETATION' }
  assert.throws(() => evolveHypotheses(input({ evidence: [directEvidence(), modelEvidence], reviews: [reviewWithEvidence(modelId)], criticisms: [criticismWithEvidence(modelId)] })), error => error instanceof ValidationError && error.code === 'INVALID_PROVENANCE')
})

test('M4B rejects an unknown mutation operator and preserves reevaluation state', () => {
  assert.throws(() => evolveHypotheses(input({ mutationProposals: [{ parentHypothesisId: parentId, criticReviewId: reviewId, criticismIds: [criticismId], mutationType: 'AMBIGUOUS_OPERATOR', reason: 'unknown operator', evidenceIds: [evidenceId], changedFields: ['method'] }] })), error => error instanceof ValidationError)
  const evaluated = { ...parent(), dimensions: { novelty: { name: 'novelty', value: 0.9, direction: 'maximize', uncertainty: 0.1, evidenceIds: [evidenceId], evaluator: 'human', assessedAt: now } } }
  const result = evolveHypotheses(input({ hypotheses: [evaluated] }))
  assert.equal(result.children[0].reevaluationRequired, true)
  assert.deepEqual(result.children[0].dimensions, {})
  assert.equal(result.children[0].status, 'mutated')
})

function parentWithEvidence(id) { return { ...parent(), evidenceFor: [id], sourceEvidenceIds: [id] } }
function reviewWithEvidence(id) { return { ...review(), evidenceIds: [id] } }
function criticismWithEvidence(id) { return { ...criticism(), evidenceIds: [id] } }

test('M4B rejects resumed mutation edges with unrelated evidence', () => {
  const request = input()
  const first = evolveHypotheses(request)
  const edge = { ...first.mutationEdges[0], evidenceIds: [deterministicId('evidence', 'unrelated')] }
  assert.throws(() => evolveHypotheses({ ...request, hypotheses: first.hypotheses, existingMutations: [{ ...first.mutations[0], edge }], mutationProposals: [] }), error => error instanceof ValidationError && error.code === 'INVALID_PROVENANCE')
})

test('M4B artifacts replay from a compatible checkpoint without duplicate genealogy', () => {
  const request = input()
  const previousCheckpoint = { checkpointId: deterministicId('checkpoint', 'm4a-before-m4b'), runId, sequence: 4, stateHash: contentHash('m4a-state'), populationIds: [parentId], budget: budget(), createdAt: now }
  const first = buildM4BArtifacts({ ...request, previousCheckpoint })
  const replay = buildM4BArtifacts({ ...request, previousCheckpoint })
  assert.deepEqual(replay, first)
  assert.deepEqual(replay.evolution.hypotheses.map(item => [item.hypothesisId, item.parentIds]), first.evolution.hypotheses.map(item => [item.hypothesisId, item.parentIds]))
  assert.deepEqual(replay.evolution.mutationEdges.map(edge => [edge.mutationEdgeId, edge.parentHypothesisId, edge.childHypothesisId]), first.evolution.mutationEdges.map(edge => [edge.mutationEdgeId, edge.parentHypothesisId, edge.childHypothesisId]))
  assert.equal(first.events.length, 2)
  assert.equal(first.events[0].type, 'hypothesis.mutated')
  assert.equal(first.events[1].type, 'checkpoint.created')
  assert.deepEqual(new Set(first.evolution.mutationEdges.map(edge => edge.mutationEdgeId)).size, first.evolution.mutationEdges.length)
  assert.ok(first.checkpoint.populationIds.includes(parentId))
  assert.equal(first.checkpoint.populationIds.length, 2)
  assert.doesNotThrow(() => parseCheckpoint(first.checkpoint))
  first.events.forEach(event => assert.doesNotThrow(() => parseDomainEvent(event)))
})

test('M4B resumes from its own checkpoint without re-emitting a mutation', () => {
  const request = input()
  const first = buildM4BArtifacts(request)
  const resumed = buildM4BArtifacts({ ...request, hypotheses: first.evolution.hypotheses, existingMutations: first.evolution.mutations, previousCheckpoint: first.checkpoint, budget: first.checkpoint.budget })
  assert.equal(resumed.evolution.newMutationEdges.length, 0)
  assert.equal(resumed.events.length, 1)
  assert.equal(resumed.events[0].type, 'checkpoint.created')
  assert.deepEqual(resumed.evolution.hypotheses, first.evolution.hypotheses)
  assert.deepEqual(resumed.evolution.mutationEdges, first.evolution.mutationEdges)
  assert.equal(resumed.checkpoint.budget.usage.maxMutations, first.checkpoint.budget.usage.maxMutations)
})

