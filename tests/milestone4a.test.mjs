import assert from 'node:assert/strict'
import test from 'node:test'
import { deterministicId } from '../src/domain/ids.ts'
import { ValidationError } from '../src/domain/validation.ts'
import { buildM4AArtifacts } from '../src/milestone4a/coordinator.ts'
import { discoverResearchGaps } from '../src/milestone4a/gap-discovery.ts'
import { generateGeneration0Hypotheses } from '../src/milestone4a/hypothesis-generator.ts'
import { validateGeneration0Hypothesis, validateResearchGap } from '../src/milestone4a/validation.ts'

const now = '2026-10-07T00:00:00.000Z'
const budget = { limits: { maxModelCalls: 3, maxSearchCalls: 0, maxCandidates: 10, maxMutations: 0, maxTokens: 1000 }, usage: { maxModelCalls: 0, maxSearchCalls: 0, maxCandidates: 0, maxMutations: 0, maxTokens: 0 } }
const claimId = deterministicId('claim', 'm4a-claim')
const directEvidenceId = deterministicId('evidence', 'm4a-direct')
const abstractEvidenceId = deterministicId('evidence', 'm4a-abstract')
const modelEvidenceId = deterministicId('evidence', 'm4a-model')
const limitationNodeId = deterministicId('graph_node', 'm4a-limitation')
const openQuestionNodeId = deterministicId('graph_node', 'm4a-open-question')

function evidence(overrides = {}) {
  return {
    evidenceId: directEvidenceId, kind: 'observation', claim: 'The baseline fails on a boundary case', polarity: 'WEAKEN',
    provenance: { sourceType: 'paper', sourceId: 'paper_m4a' }, claimIds: [claimId], limitations: [], confidence: 0.8, createdAt: now, ...overrides,
  }
}

function state({ withCoverage = true, abstract = false, model = false } = {}) {
  const items = [evidence()]
  if (abstract) items.push(evidence({ evidenceId: abstractEvidenceId, evidenceLevel: 'ABSTRACT_EVIDENCE', limitations: ['full-text and quantitative verification unavailable'] }))
  if (model) items.push(evidence({ evidenceId: modelEvidenceId, kind: 'interpretation', provenance: { sourceType: 'model', sourceId: 'attempt_m4a' }, modelInterpretation: true, evidenceLevel: 'MODEL_INTERPRETATION' }))
  return {
    problemGraph: { problems: [], nodes: [
      { nodeId: limitationNodeId, type: 'limitation', label: 'The baseline fails on a boundary case', evidenceIds: [directEvidenceId] },
      { nodeId: openQuestionNodeId, type: 'open-question', label: 'Transfer to a new domain is unexamined', evidenceIds: [] },
    ], edges: [] },
    evidence: items,
    claims: [{ claimId, statement: 'The baseline fails on a boundary case', kind: 'limitation', provenance: { sourceType: 'paper', sourceId: 'paper_m4a' } }],
    completeness: withCoverage ? { status: 'INCOMPLETE', exhaustive: false, scientificallyComplete: false, deferredOperations: ['deferred_1'], retrievalCoverage: { COMPLETE: 1, FAILED: 1, NO_RESULTS: 1, PARTIAL: 0 }, evidenceItems: items.length } : { status: 'EXHAUSTIVE', exhaustive: true, scientificallyComplete: true, deferredOperations: [], retrievalCoverage: { COMPLETE: 1, FAILED: 0, NO_RESULTS: 0, PARTIAL: 0 }, evidenceItems: items.length },
  }
}

function discover(options = {}) { const input = state(options); return { input, result: discoverResearchGaps({ ...input, now }) } }

test('deferred operations become coverage-only and cannot seed hypotheses', async () => {
  const { input, result } = discover({ withCoverage: true })
  const deferred = result.gaps.find(gap => gap.kind === 'DEFERRED_EVIDENCE_WORK')
  assert.ok(deferred)
  assert.equal(deferred.eligibility.eligible, false)
  const population = await generateGeneration0Hypotheses({ gapDiscovery: result, problemGraph: input.problemGraph, claims: input.claims, evidence: input.evidence }, { now, candidateBudget: 20 })
  assert.ok(population.hypotheses.length > 0)
  assert.ok(population.hypotheses.every(hypothesis => hypothesis.originatingGapIds.every(id => result.gaps.find(gap => gap.gapId === id)?.coverageState === 'SCIENTIFIC')))
})

test('failed retrieval records coverage limitation without novelty or scientific gap', () => {
  const { result } = discover({ withCoverage: true })
  assert.ok(result.gaps.some(gap => gap.kind === 'FAILED_RETRIEVAL'))
  assert.equal(result.gaps.filter(gap => gap.kind === 'FAILED_RETRIEVAL')[0].eligibility.eligible, false)
  assert.equal(result.gaps.some(gap => gap.kind === 'NOVELTY'), false)
})

test('NO_RESULTS is represented as search coverage, never absence evidence', () => {
  const { result } = discover({ withCoverage: true })
  const noResults = result.gaps.find(gap => gap.kind === 'NO_RESULTS_RETRIEVAL')
  assert.ok(noResults)
  assert.match(noResults.statement, /NO_RESULTS/)
  assert.equal(noResults.sourceEvidenceIds.length, 0)
  assert.equal(noResults.eligibility.eligible, false)
})

test('abstract-only and quantitative boundaries stay coverage-only', () => {
  const { result } = discover({ abstract: true })
  assert.ok(result.gaps.some(gap => gap.kind === 'ABSTRACT_ONLY_EVIDENCE'))
  assert.ok(result.gaps.some(gap => gap.kind === 'MISSING_QUANTITATIVE_EVIDENCE'))
  const abstract = result.gaps.find(gap => gap.kind === 'ABSTRACT_ONLY_EVIDENCE')
  assert.equal(abstract.eligibility.eligible, false)
  assert.match(abstract.statement, /abstract-level only/)
})

test('successful-empty extraction is propagated as incomplete coverage, not negative evidence', () => {
  const input = state({ withCoverage: false })
  input.completeness = { status: 'INCOMPLETE', exhaustive: false, scientificallyComplete: false, deferredOperations: [], failedOperations: [], emptyEvidenceOperations: 1, retrievalCoverage: { COMPLETE: 1, FAILED: 0, NO_RESULTS: 0, PARTIAL: 0 } }
  const result = discoverResearchGaps({ ...input, now })
  assert.ok(result.gaps.some(gap => gap.kind === 'INCOMPLETE_EVIDENCE_COVERAGE'))
  assert.equal(result.gaps.filter(gap => gap.kind === 'INCOMPLETE_EVIDENCE_COVERAGE')[0].eligibility.eligible, false)
})

test('limitations and open questions produce eligible research gaps with graph provenance', () => {
  const { result } = discover({ withCoverage: false })
  const scientific = result.gaps.filter(gap => gap.coverageState === 'SCIENTIFIC')
  assert.ok(scientific.some(gap => gap.kind === 'KNOWN_LIMITATION' && gap.sourceProblemNodeIds.includes(limitationNodeId)))
  assert.ok(scientific.some(gap => gap.kind === 'OPEN_QUESTION' && gap.sourceProblemNodeIds.includes(openQuestionNodeId)))
  assert.ok(scientific.every(gap => gap.eligibility.eligible))
})

test('contradictory evidence is a research gap without truth or falsity inference', () => {
  const input = state({ withCoverage: false })
  input.problemGraph.edges = [{ edgeId: deterministicId('graph_edge', 'contradiction'), from: limitationNodeId, to: openQuestionNodeId, relation: 'CONTRADICTS', evidenceIds: [directEvidenceId] }]
  const result = discoverResearchGaps({ ...input, now })
  const gap = result.gaps.find(item => item.kind === 'CONTRADICTORY_EVIDENCE')
  assert.ok(gap)
  assert.equal(gap.eligibility.eligible, true)
  assert.equal(gap.sourceEvidenceIds.includes(directEvidenceId), true)
  assert.equal(Object.hasOwn(gap, 'truth'), false)
  assert.equal(Object.hasOwn(gap, 'falsity'), false)
})

test('EvidenceGraph claim links with support and contradiction create an investigable conflict gap', () => {
  const input = state({ withCoverage: false })
  input.evidence.push(evidence({ evidenceId: abstractEvidenceId, polarity: 'CONTRADICT' }))
  input.evidenceGraph = { claims: input.claims, evidence: input.evidence, links: [
    { claimId, evidenceId: directEvidenceId, relation: 'SUPPORTS' },
    { claimId, evidenceId: abstractEvidenceId, relation: 'CONTRADICTS' },
  ] }
  const result = discoverResearchGaps({ ...input, now })
  assert.ok(result.gaps.some(gap => gap.kind === 'CONTRADICTORY_EVIDENCE' && gap.sourceClaimIds.includes(claimId)))
})

test('dangling gap provenance is rejected', () => {
  const { result } = discover({ withCoverage: false })
  assert.throws(() => validateResearchGap({ ...result.gaps.find(gap => gap.kind === 'KNOWN_LIMITATION'), sourceEvidenceIds: ['missing_evidence'] }, { evidenceIds: new Set([directEvidenceId]) }), ValidationError)
})

test('HypothesisGenerator rejects a fabricated mixed gap before materialization', async () => {
  const { input, result } = discover({ withCoverage: false })
  const fabricated = {
    ...result.gaps.find(gap => gap.kind === 'KNOWN_LIMITATION'),
    gapId: 'research_gap_fabricated_mixed',
    coverageState: 'MIXED',
    epistemicStatus: 'MODEL_INTERPRETATION',
    sourceProblemNodeIds: [],
    sourceClaimIds: [],
    sourceEvidenceIds: [],
    eligibility: { eligible: true, code: 'ELIGIBLE_RESEARCH_GAP', reason: 'fabricated acceptance' },
  }
  const gapDiscovery = { ...result, gaps: [fabricated] }
  await assert.rejects(
    generateGeneration0Hypotheses({ gapDiscovery, problemGraph: input.problemGraph, claims: input.claims, evidence: input.evidence }, { now }),
    error => error instanceof ValidationError && /mixed gap requires independent scientific/i.test(error.message),
  )
})

test('HypothesisGenerator accepts a mixed gap with independent scientific provenance', async () => {
  const { input, result } = discover({ withCoverage: false })
  const source = result.gaps.find(gap => gap.kind === 'KNOWN_LIMITATION')
  const mixed = { ...source, coverageState: 'MIXED', epistemicStatus: 'OBSERVED', eligibility: { eligible: true, code: 'ELIGIBLE_RESEARCH_GAP', reason: 'mixed gap retains independent graph and direct evidence provenance' } }
  const gapDiscovery = { ...result, gaps: [mixed] }
  const population = await generateGeneration0Hypotheses({ gapDiscovery, problemGraph: input.problemGraph, claims: input.claims, evidence: input.evidence }, { now, candidateBudget: 1 })
  assert.equal(population.hypotheses.length, 1)
  assert.deepEqual(population.hypotheses[0].originatingGapIds, [source.gapId])
})

test('GapDiscovery rejects dangling graph, evidence, and claim references', () => {
  const input = state({ withCoverage: false })
  assert.throws(() => discoverResearchGaps({ ...input, problemGraph: { ...input.problemGraph, nodes: [{ ...input.problemGraph.nodes[0], evidenceIds: ['missing_evidence'] }] }, now }), /unknown evidence/)
  assert.throws(() => discoverResearchGaps({ ...input, problemGraph: { ...input.problemGraph, edges: [{ edgeId: 'edge_bad', from: limitationNodeId, to: 'missing_node', relation: 'CONTRADICTS', evidenceIds: [] }] }, now }), /unknown graph node/)
  assert.throws(() => discoverResearchGaps({ ...input, evidence: [evidence({ claimIds: ['missing_claim'] })], now }), /unknown claim/)
})

test('model interpretation evidence cannot be copied into source evidence', async () => {
  const { input, result } = discover({ withCoverage: false, model: true })
  const gap = result.gaps.find(item => item.kind === 'KNOWN_LIMITATION')
  const gateway = { structured: async () => ({ ok: true, value: { hypotheses: [{ originatingGapIds: [gap.gapId], statement: 'candidate', motivation: 'interpretation', proposedMechanism: 'mechanism', expectedMechanism: 'expected', sourceProblemNodeIds: [limitationNodeId], sourceEvidenceIds: [modelEvidenceId], falsificationConditions: ['fails if unchanged'], expectedObservableResult: 'changes', discriminativeExperimentIdea: 'compare' }] } }) }
  const population = await generateGeneration0Hypotheses({ gapDiscovery: result, problemGraph: input.problemGraph, claims: input.claims, evidence: input.evidence }, { gateway, route: { provider: 'test', model: 'test' }, now, candidateBudget: 2 })
  assert.equal(population.hypotheses.length, 0)
  assert.equal(population.rejected.length, 1)
  assert.match(population.rejected[0].reason, /model interpretation|unknown evidence/i)
})

test('gap IDs are deterministic and duplicate decisions are retained', () => {
  const a = discover({ withCoverage: false }).result
  const b = discover({ withCoverage: false }).result
  assert.deepEqual(a.gaps.map(gap => gap.gapId), b.gaps.map(gap => gap.gapId))
  const duplicateInput = state({ withCoverage: false })
  duplicateInput.explicitLimitations = ['A separately stated limitation', 'A separately stated limitation']
  const result = discoverResearchGaps({ ...duplicateInput, now })
  assert.ok(result.duplicates.length > 0)
})

test('Generation-0 hypotheses include falsification and expected test fields', async () => {
  const { input, result } = discover({ withCoverage: false })
  const population = await generateGeneration0Hypotheses({ gapDiscovery: result, problemGraph: input.problemGraph, claims: input.claims, evidence: input.evidence }, { now, candidateBudget: 4 })
  assert.ok(population.hypotheses.length > 0)
  for (const hypothesis of population.hypotheses) {
    assert.equal(hypothesis.generation, 0)
    assert.equal(hypothesis.status, 'candidate')
    assert.equal(hypothesis.epistemicStatus, 'PROVISIONAL_UNVERIFIED')
    assert.equal(hypothesis.noveltyStatus, 'UNVERIFIED')
    assert.ok(hypothesis.falsificationConditions.length)
    assert.ok(hypothesis.expectedObservableResult)
    assert.ok(hypothesis.discriminativeExperimentIdea)
    assert.equal(Object.hasOwn(hypothesis, 'noveltyEvidence'), false)
    assert.equal(Object.hasOwn(hypothesis, 'noveltyEstimate'), false)
    assert.ok(hypothesis.originatingGapIds.every(id => result.gaps.find(gap => gap.gapId === id)?.eligibility.eligible))
  }
})

test('incomplete input completeness is carried into the population', async () => {
  const { input, result } = discover({ withCoverage: true })
  const population = await generateGeneration0Hypotheses({ gapDiscovery: result, problemGraph: input.problemGraph, claims: input.claims, evidence: input.evidence }, { now })
  assert.equal(population.inputCompleteness.scientificallyComplete, false)
  assert.ok(population.limitations.length > 0)
})

test('invalid structured model output fails closed and records an auditable attempt', async () => {
  const { input, result } = discover({ withCoverage: false })
  const gateway = { structured: async () => ({ ok: true, value: { wrong: [] }, diagnostic: { status: 'SUCCEEDED' } }) }
  const population = await generateGeneration0Hypotheses({ gapDiscovery: result, problemGraph: input.problemGraph, claims: input.claims, evidence: input.evidence }, { gateway, route: { provider: 'test', model: 'test' }, now })
  assert.equal(population.hypotheses.length, 0)
  assert.equal(population.modelAttempts.length, 1)
  assert.equal(population.modelAttempts[0].ok, false)
  assert.ok(population.rejected.length)
})

test('dedupe uses scientific signature instead of statement alone', async () => {
  const { input, result } = discover({ withCoverage: false })
  const gaps = result.gaps.filter(gap => gap.eligibility.eligible).slice(0, 2)
  const gateway = { structured: async () => ({ ok: true, value: { hypotheses: gaps.map(gap => ({ originatingGapIds: [gap.gapId], statement: 'same reader-facing statement', motivation: 'motivation', proposedMechanism: `mechanism-${gap.gapId}`, expectedMechanism: 'expected', falsificationConditions: ['fails if unchanged'], expectedObservableResult: 'changes', discriminativeExperimentIdea: 'compare' })) } }) }
  const population = await generateGeneration0Hypotheses({ gapDiscovery: result, problemGraph: input.problemGraph, claims: input.claims, evidence: input.evidence }, { gateway, route: { provider: 'test', model: 'test' }, now, candidateBudget: 10 })
  assert.equal(population.hypotheses.length, gaps.length)
  assert.equal(population.duplicates.length, 0)
})

test('M4A checkpoint and domain events reference the accepted population', async () => {
  const input = state({ withCoverage: false })
  const artifacts = await buildM4AArtifacts({ ...input, runId: deterministicId('run', 'm4a'), budget, now })
  assert.ok(artifacts.events.some(event => event.type === 'hypothesis.created'))
  assert.equal(artifacts.events.at(-1).type, 'checkpoint.created')
  assert.deepEqual(artifacts.checkpoint.populationIds, artifacts.generation0.hypotheses.map(hypothesis => hypothesis.hypothesisId))
})

test('M4A generation is deterministic and idempotent across resume', async () => {
  const input = state({ withCoverage: false })
  const request = { ...input, runId: deterministicId('run', 'm4a-resume'), budget, now, startingSequence: 7 }
  const first = await buildM4AArtifacts(request)
  const resumed = await buildM4AArtifacts(request)
  assert.deepEqual(resumed, first)
  assert.deepEqual(resumed.generation0.hypotheses.map(hypothesis => hypothesis.hypothesisId), first.generation0.hypotheses.map(hypothesis => hypothesis.hypothesisId))
  assert.deepEqual(resumed.checkpoint.populationIds, first.checkpoint.populationIds)
})

test('generation validator rejects hypotheses with no eligible originating gap', () => {
  const { result } = discover({ withCoverage: true })
  const coverage = result.gaps.find(gap => gap.coverageState === 'COVERAGE_ONLY')
  assert.throws(() => validateGeneration0Hypothesis({ generation: 0, hypothesisId: 'hypothesis_fake', parentIds: [], statement: 's', motivation: 'm', method: 'm', assumptions: [], evidenceFor: [], evidenceAgainst: [], priorArtReportIds: [], criticismIds: [], experimentIds: [], resultEvidenceIds: [], mutationEdgeIds: [], dimensions: {}, status: 'candidate', createdAt: now, updatedAt: now, originatingGapIds: [coverage.gapId], sourceProblemNodeIds: [], sourceClaimIds: [], sourceEvidenceIds: [], proposedMechanism: 'm', expectedMechanism: 'e', falsificationConditions: ['f'], expectedObservableResult: 'o', discriminativeExperimentIdea: 'd', generationOperator: 'NEW_OBJECTIVE', epistemicStatus: 'PROVISIONAL_UNVERIFIED', noveltyStatus: 'UNVERIFIED', uncertainty: { level: 1, reasons: ['coverage'] }, inputCompleteness: result.completeness }, { gaps: new Map(result.gaps.map(gap => [gap.gapId, gap])) }), /coverage-only|eligible research gap/)
})
