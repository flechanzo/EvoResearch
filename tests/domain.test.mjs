import assert from 'node:assert/strict'
import test from 'node:test'
import {
  deterministicId, contentHash, parseEvidence, parseNoveltyEvidence, parseMutationEdge,
  parseBudgetLedger, parseResearchProblem, parseResearchProblemGraph, parseCheckpoint, paretoFrontier, spendBudget, ValidationError,
  parsePriorArtReport, parseReview,
  ingestArtifact, extractDocument, validatePaperReaderOutput, buildProblemGraph, ProblemGraphIndex,
  runPaperReader,
} from '../src/domain/index.ts'

const now = '2026-09-28T00:00:00.000Z'
const hash = contentHash('paper')
const evidence = {
  evidenceId: 'evidence_a', kind: 'quote', claim: 'A claim', polarity: 'SUPPORT',
  provenance: { sourceType: 'artifact', sourceId: 'artifact_a', contentHash: hash, locator: 'p.1' },
  claimIds: ['claim_a'], limitations: [], confidence: 0.8, createdAt: now,
}

test('deterministic IDs and hashes are stable and canonical', () => {
  assert.equal(contentHash('paper'), contentHash('paper'))
  assert.equal(deterministicId('paper', { b: 2, a: 1 }), deterministicId('paper', { a: 1, b: 2 }))
  assert.notEqual(deterministicId('paper', { a: 1 }), deterministicId('paper', { a: 2 }))
})

test('evidence provenance is required and validated', () => {
  assert.doesNotThrow(() => parseEvidence(evidence))
  assert.throws(() => parseEvidence({ ...evidence, provenance: { sourceType: 'artifact' } }), ValidationError)
  assert.throws(() => parseEvidence({ ...evidence, provenance: { ...evidence.provenance, contentHash: 'bad' } }), ValidationError)
})

test('graph rejects references to unknown nodes', () => {
  const graph = {
    problems: [], nodes: [{ nodeId: 'node_a', type: 'problem', label: 'P', evidenceIds: [] }],
    edges: [{ edgeId: 'edge_a', from: 'node_a', to: 'missing', relation: 'relates', evidenceIds: [] }],
  }
  assert.throws(() => parseResearchProblemGraph(graph), /edge.to does not reference/)
})

test('problem records and checkpoints validate their references and hashes', () => {
  assert.doesNotThrow(() => parseResearchProblem({ problemId: 'problem_a', statement: 'P', evidenceIds: ['evidence_a'], methodIds: [], assumptionIds: [], limitationIds: [], failureCaseIds: [], openQuestionIds: [] }, new Set(['evidence_a'])))
  assert.throws(() => parseResearchProblem({ problemId: 'problem_a', statement: 'P', evidenceIds: ['missing'], methodIds: [], assumptionIds: [], limitationIds: [], failureCaseIds: [], openQuestionIds: [] }, new Set(['evidence_a'])), /evidence reference does not exist/)
  assert.doesNotThrow(() => parseCheckpoint({ checkpointId: 'checkpoint_a', runId: 'run_a', sequence: 2, stateHash: hash, populationIds: ['h_a'], budget: { limits: { maxModelCalls: 2, maxSearchCalls: 1, maxCandidates: 10, maxMutations: 1, maxTokens: 100 }, usage: { maxModelCalls: 1, maxSearchCalls: 0, maxCandidates: 1, maxMutations: 0, maxTokens: 5 } }, createdAt: now }))
  assert.throws(() => parseCheckpoint({ checkpointId: 'checkpoint_a', runId: 'run_a', sequence: 2, stateHash: 'bad', populationIds: [], budget: { limits: { maxModelCalls: 1, maxSearchCalls: 1, maxCandidates: 1, maxMutations: 1, maxTokens: 1 }, usage: { maxModelCalls: 0, maxSearchCalls: 0, maxCandidates: 0, maxMutations: 0, maxTokens: 0 } }, createdAt: now }), /SHA-256/)
})

test('mutation rejects invalid parent/child relationships', () => {
  const edge = { mutationEdgeId: 'mutation_a', parentHypothesisId: 'h_parent', childHypothesisId: 'h_child', mutationType: 'NARROW_SCOPE', reason: 'Scope was too broad', criticReviewId: 'review_a', evidenceIds: [], changedFields: ['statement'], timestamp: now }
  assert.doesNotThrow(() => parseMutationEdge(edge, new Set(['h_parent', 'h_child'])))
  assert.throws(() => parseMutationEdge(edge, new Set(['h_other'])), /existing hypotheses/)
  assert.throws(() => parseMutationEdge({ ...edge, childHypothesisId: 'h_parent' }), /must differ/)
})

test('no-hit novelty evidence cannot be represented as verified novelty', () => {
  const base = { closestPriorArt: [], overlapDimensions: [], differenceDimensions: [], searchQueries: [], searchCoverage: { queries: [], sourcesConsidered: 0, sourcesFound: 0, corpusDescription: 'frozen', completed: true }, unresolvedOverlap: ['coverage is limited'], uncertainty: { level: 1, reasons: ['no hits'] }, assessment: 'unresolved' }
  assert.doesNotThrow(() => parseNoveltyEvidence(base))
  assert.throws(() => parseNoveltyEvidence({ ...base, assessment: 'possible-difference' }), /no-hit search/)
  assert.throws(() => parseNoveltyEvidence({ ...base, verifiedNovelty: true }), /verified novelty/)
})

function hypothesis(id, values) {
  const dimensions = Object.fromEntries(Object.entries(values).map(([name, value]) => [name, { name, value, direction: name === 'experimental_cost' || name === 'uncertainty' ? 'minimize' : 'maximize', uncertainty: 0, evidenceIds: [], evaluator: 'deterministic', assessedAt: now }]))
  return { hypothesisId: id, dimensions }
}

test('Pareto frontier is deterministic for ties', () => {
  const a = hypothesis('h_a', { feasibility: 0.8, expected_impact: 0.8 })
  const b = hypothesis('h_b', { feasibility: 0.8, expected_impact: 0.8 })
  const c = hypothesis('h_c', { feasibility: 0.5, expected_impact: 0.5 })
  const result = paretoFrontier([c, b, a])
  assert.deepEqual(result.frontier.map(item => item.hypothesisId), ['h_a', 'h_b'])
  assert.deepEqual(result.dominated.map(item => item.hypothesisId), ['h_c'])
  assert.deepEqual(result.dominance.h_c, ['h_a', 'h_b'])
})

test('budget ledger enforces deterministic limits', () => {
  const ledger = parseBudgetLedger({ limits: { maxModelCalls: 2, maxSearchCalls: 1, maxCandidates: 10, maxMutations: 1, maxTokens: 100 }, usage: { maxModelCalls: 0, maxSearchCalls: 0, maxCandidates: 0, maxMutations: 0, maxTokens: 0 } })
  const used = spendBudget(ledger, 'maxModelCalls', 2)
  assert.equal(used.usage.maxModelCalls, 2)
  assert.throws(() => spendBudget(used, 'maxModelCalls', 1), /exceeds budget/)
})

test('compound records reject inconsistent prior-art projections and duplicate review dimensions', () => {
  const noveltyEvidence = { closestPriorArt: [], overlapDimensions: [], differenceDimensions: ['mechanism'], searchQueries: [], searchCoverage: { queries: [], sourcesConsidered: 0, sourcesFound: 0, corpusDescription: 'frozen', completed: true }, unresolvedOverlap: ['coverage is limited'], uncertainty: { level: 1, reasons: ['no hits'] }, assessment: 'unresolved' }
  const report = { priorArtReportId: 'prior_a', hypothesisId: 'h_a', noveltyEvidence, closestPriorArt: [], overlapDimensions: [], differenceDimensions: ['mechanism'], searchCoverage: noveltyEvidence.searchCoverage, uncertainty: noveltyEvidence.uncertainty, createdAt: now }
  assert.doesNotThrow(() => parsePriorArtReport(report))
  assert.throws(() => parsePriorArtReport({ ...report, differenceDimensions: ['different projection'] }), /differenceDimensions/)
  const dimension = { name: 'feasibility', value: 0.5, direction: 'maximize', uncertainty: 0, evidenceIds: [], evaluator: 'human', assessedAt: now }
  assert.throws(() => parseReview({ reviewId: 'review_a', hypothesisId: 'h_a', role: 'Reviewer2', summary: 'review', criticismIds: [], evidenceIds: [], dimensions: [dimension, dimension], createdAt: now }), /unique/)
})

test('Milestone 2 extraction, bounded interpretation, and graph provenance are deterministic', () => {
  const bytes = new TextEncoder().encode('# Limitations\nFails on noisy inputs.\n')
  const manifest = ingestArtifact(bytes, { paperId: 'paper_demo', originalFilename: 'demo.md', mediaType: 'text/markdown', ingestionTimestamp: now })
  assert.equal(manifest.sha256, contentHash(new TextDecoder('latin1').decode(bytes)))
  const document = extractDocument(manifest, bytes)
  assert.equal(document.spans[0].locator.page, 1)
  assert.equal(document.spans[0].locator.spanIndex, 0)
  assert.throws(() => ingestArtifact(bytes, { paperId: 'paper_demo', originalFilename: 'demo.bin', mediaType: 'application/octet-stream', ingestionTimestamp: now }), /UNSUPPORTED_MEDIA_TYPE/)
  const direct = { artifactId: manifest.artifactId, schemaVersion: 'm2.3', items: [{ itemId: 'l1', type: 'limitation', statement: 'Fails on noisy inputs.', confidence: 0.9, uncertainty: 0.1, locators: [document.spans[1].locator], interpretation: 'DIRECT_EVIDENCE' }] }
  assert.doesNotThrow(() => validatePaperReaderOutput(direct, document))
  assert.throws(() => validatePaperReaderOutput({ ...direct, items: [{ ...direct.items[0], locators: [{ ...document.spans[1].locator, spanIndex: 99 }] }] }, document), /locator does not exist/)
  const interpreted = validatePaperReaderOutput({ ...direct, items: [{ ...direct.items[0], itemId: 'i1', locators: [], interpretation: 'MODEL_INTERPRETATION' }] }, document)
  const evidence = [{ evidenceId: 'e1', kind: 'quote', claim: 'Fails on noisy inputs.', polarity: 'SUPPORT', provenance: { sourceType: 'artifact', sourceId: manifest.artifactId, locator: JSON.stringify(document.spans[1].locator), contentHash: manifest.sha256 }, claimIds: [], limitations: [], confidence: 0.9, createdAt: now }]
  const graph = buildProblemGraph({ nodes: [{ nodeId: 'n1', type: 'limitation', label: interpreted.items[0].statement, evidenceIds: ['e1'] }], edges: [] }, evidence)
  const index = new ProblemGraphIndex(graph, evidence)
  assert.equal(index.getLimitations().length, 1)
  assert.equal(index.getEvidenceForNode('n1')[0].provenance.sourceId, manifest.artifactId)
  assert.throws(() => buildProblemGraph({ nodes: [{ nodeId: 'n2', type: 'problem', label: 'missing', evidenceIds: ['missing'] }], edges: [] }, evidence), /missing evidence/)
})

test('PaperReader model boundary records malformed output as a failed attempt', async () => {
  const bytes = new TextEncoder().encode('A paper sentence.')
  const manifest = ingestArtifact(bytes, { paperId: 'paper_model', originalFilename: 'paper.txt', mediaType: 'text/plain', ingestionTimestamp: now })
  const document = extractDocument(manifest, bytes)
  const gateway = { structured: async () => ({ ok: true, value: { artifactId: manifest.artifactId, schemaVersion: 'm2.3', items: [{ itemId: 'bad', type: 'claim', statement: 'invented', confidence: 0.5, uncertainty: 0.5, locators: [{ ...document.spans[0].locator, spanIndex: 50 }], interpretation: 'DIRECT_EVIDENCE' }] } }) }
  const result = await runPaperReader(gateway, document, { provider: 'fake', model: 'fake-model' })
  assert.equal(result.ok, false)
  if (!result.ok) assert.match(result.error, /locator does not exist/)
})
