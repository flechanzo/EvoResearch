import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { deterministicId } from '../src/domain/index.ts'
import { RunBudget, BudgetExhaustedError } from '../src/domain/run-budget.ts'
import { EvidenceExtractor, materializeEvidence, validateEvidenceExtractorOutput } from '../src/evidence/index.ts'
import { EvidenceGraph } from '../src/literature/index.ts'
import { summarizeEvidenceAssessment } from '../src/evaluation/index.ts'
import { preflightModel } from '../src/adapters/model-preflight.ts'
import { dryRunCase, LIVE_WIRING, mapEvidencePolarityToClaimRelation, planEvidenceOperations, renderLiveReport, runLiveCase, validateStopAfter, validateWiring } from '../src/coordinator/live-validation.ts'

const now = '2026-09-28T00:00:00.000Z'
const record = { literatureId: 'literature_source', title: 'Source paper', authors: ['Author'], year: 2024, abstract: 'The source reports a measured result.', doi: '10.1000/example', urls: ['https://example.test/paper'], providerRecords: { openalex: 'https://openalex.org/W1' }, retrievedAt: now }
const provenance = { originProblemNodeIds: ['graph_node_test'], retrievalNeedId: 'retrieval_need_test', queryId: 'query_test', searchCoverageId: 'coverage_test', searchCoverageStatus: 'COMPLETE', corpusCutoff: '2026-09-29' }
const input = { claimId: deterministicId('claim', 'claim') , claim: 'The source reports a measured result.', source: { literature: { ...record, publicationDate: '2024-01-01', publicationDateStatus: 'KNOWN' }, provenance } }

test('EvidenceExtractor uses ModelGateway and preserves evidence levels', async () => {
  let request
  const gateway = { structured: async value => { request = value; return { ok: true, value: { claimId: input.claimId, literatureId: record.literatureId, items: [{ statement: 'The abstract reports a measured result.', relation: 'SUPPORTS', evidenceLevel: 'ABSTRACT_EVIDENCE', quotedText: 'The source reports a measured result.', locator: 'abstract', confidence: 0.8, modelInterpretation: false }] } } } }
  const result = await new EvidenceExtractor(gateway, { provider: 'fake', model: 'fake' }).extract(input)
  assert.equal(result.ok, true)
  assert.equal(request.input.untrustedSource.abstract, record.abstract)
  assert.equal(request.input.literatureId, record.literatureId)
  assert.match(request.input.evidenceExtractorContract, /"items"/)
  assert.match(request.input.instructions, /untrusted data/)
  if (result.ok) { assert.deepEqual(result.value.provenance, provenance); const evidence = materializeEvidence(result.value, input, result.request.attemptId); assert.equal(evidence[0].evidenceLevel, 'ABSTRACT_EVIDENCE'); assert.equal(evidence[0].modelInterpretation, false); assert.equal(evidence[0].provenance.quotedText, 'The source reports a measured result.'); assert.deepEqual(evidence[0].provenance.provenancePath, provenance) }
})

test('non-empty EvidenceExtractor output materializes into a provenance-preserving EvidenceGraph', async () => {
  const gateway = { structured: async () => ({ ok: true, value: { claimId: input.claimId, literatureId: record.literatureId, items: [
    { statement: 'The abstract supports the claim.', relation: 'SUPPORTS', evidenceLevel: 'ABSTRACT_EVIDENCE', quotedText: 'The source reports a measured result.', locator: 'abstract', confidence: 0.8, modelInterpretation: false },
    { statement: 'The abstract contradicts the claim.', relation: 'CONTRADICTS', evidenceLevel: 'ABSTRACT_EVIDENCE', quotedText: 'The source reports a measured result.', locator: 'abstract', confidence: 0.4, modelInterpretation: false },
    { statement: 'The model qualifies the claim.', relation: 'QUALIFIES', evidenceLevel: 'MODEL_INTERPRETATION', confidence: 0.5, modelInterpretation: true },
    { statement: 'The source is insufficient to assess the claim.', relation: 'INSUFFICIENT', evidenceLevel: 'ABSTRACT_EVIDENCE', confidence: 0.2, modelInterpretation: false },
  ] } }) }
  const result = await new EvidenceExtractor(gateway, { provider: 'fake', model: 'fake' }).extract(input)
  assert.equal(result.ok, true)
  if (!result.ok) return
  const evidence = materializeEvidence(result.value, input, 'attempt_nonempty', now)
  const graph = new EvidenceGraph()
  graph.addClaim({ claimId: input.claimId, statement: input.claim, claimType: 'result', scope: 'watermarking', uncertainty: 0.2 })
  for (const item of evidence) graph.addEvidence(item)
  for (const item of evidence) graph.linkEvidenceToClaim({ evidenceId: item.evidenceId, claimId: input.claimId, relation: mapEvidencePolarityToClaimRelation(item.polarity) })
  assert.equal(evidence.length, 4)
  assert.equal(graph.getEvidenceForClaim(input.claimId).length, 4)
  assert.equal(graph.getSupportingEvidence(input.claimId).length, 1)
  assert.equal(graph.getContradictingEvidence(input.claimId).length, 1)
  assert.equal(graph.getQualifyingEvidence(input.claimId).length, 1)
  assert.equal(evidence.filter(item => item.modelInterpretation).length, 1)
  assert.equal(mapEvidencePolarityToClaimRelation('MOTIVATE'), 'INSUFFICIENT')
  assert.ok(evidence.every(item => item.provenance.provenancePath && JSON.stringify(item.provenance.provenancePath) === JSON.stringify(provenance)))
})

function assessment(overrides = {}) {
  return summarizeEvidenceAssessment({ selectedOperationIds: ['op1'], plannedOperationIds: ['op1'], completedOperationIds: ['op1'], failedOperationIds: [], deferredOperationIds: [], emptyEvidenceOperationIds: [], planStatus: 'COMPLETED', retrievalStatuses: ['COMPLETE'], evidenceItemCount: 0, graphClaimCount: 1, graphEvidenceCount: 0, graphLinkCount: 0, ...overrides })
}

test('evidence assessment keeps empty extraction distinct from negative evidence', () => {
  const result = assessment({ emptyEvidenceOperationIds: ['op1'] })
  assert.equal(result.exhaustive, true)
  assert.equal(result.scientificallyComplete, true)
  assert.equal(result.completedOperations, 1)
  assert.equal(result.emptyEvidenceOperations, 1)
  assert.equal(result.evidenceItems, 0)
  assert.deepEqual(result.graphRelationCounts, {})
  assert.deepEqual(result.reasons, [])
})

test('evidence assessment preserves retrieval states and deferred or failed work', () => {
  const noResults = summarizeEvidenceAssessment({ selectedOperationIds: [], plannedOperationIds: [], completedOperationIds: [], failedOperationIds: [], deferredOperationIds: [], emptyEvidenceOperationIds: [], planStatus: 'COMPLETED', retrievalStatuses: ['NO_RESULTS'], evidenceItemCount: 0, graphClaimCount: 0, graphEvidenceCount: 0, graphLinkCount: 0 })
  assert.equal(noResults.exhaustive, true)
  assert.equal(noResults.retrievalCoverage.NO_RESULTS, 1)
  const failedRetrieval = assessment({ retrievalStatuses: ['FAILED'] })
  assert.equal(failedRetrieval.exhaustive, false)
  assert.deepEqual(failedRetrieval.reasons, ['FAILED_RETRIEVAL'])
  const partialRetrieval = assessment({ retrievalStatuses: ['PARTIAL'] })
  assert.equal(partialRetrieval.exhaustive, false)
  assert.deepEqual(partialRetrieval.reasons, ['PARTIAL_RETRIEVAL'])
  const deferred = assessment({ deferredOperationIds: ['op2'], selectedOperationIds: ['op1', 'op2'] })
  assert.equal(deferred.exhaustive, false)
  assert.equal(deferred.deferredOperations, 1)
  assert.deepEqual(deferred.reasons, ['DEFERRED_OPERATIONS'])
  const failed = assessment({ failedOperationIds: ['op1'], completedOperationIds: [], emptyEvidenceOperationIds: [] })
  assert.equal(failed.exhaustive, false)
  assert.deepEqual(failed.reasons, ['FAILED_OPERATIONS'])
  const unfinalized = assessment({ planStatus: 'PLANNED' })
  assert.equal(unfinalized.exhaustive, false)
  assert.deepEqual(unfinalized.reasons, ['EVIDENCE_PLAN_NOT_COMPLETED'])
  const allDeferred = assessment({ selectedOperationIds: ['op1', 'op2'], plannedOperationIds: [], completedOperationIds: [], deferredOperationIds: ['op1', 'op2'] })
  assert.equal(allDeferred.exhaustive, false)
  assert.equal(allDeferred.plannedOperations, 0)
  assert.equal(allDeferred.deferredOperations, 2)
  const mixture = assessment({ selectedOperationIds: ['op1', 'op2', 'op3'], plannedOperationIds: ['op1', 'op2'], completedOperationIds: ['op1'], failedOperationIds: ['op2'], deferredOperationIds: ['op3'] })
  assert.equal(mixture.exhaustive, false)
  assert.deepEqual(mixture.reasons, ['DEFERRED_OPERATIONS', 'FAILED_OPERATIONS'])
})

test('evidence assessment records non-empty graph relations without using item count for completeness', () => {
  const result = assessment({ evidenceItemCount: 4, graphEvidenceCount: 4, graphLinkCount: 4, graphRelations: ['SUPPORTS', 'CONTRADICTS', 'QUALIFIES', 'INSUFFICIENT'] })
  assert.equal(result.exhaustive, true)
  assert.deepEqual(result.graphRelationCounts, { SUPPORTS: 1, CONTRADICTS: 1, QUALIFIES: 1, INSUFFICIENT: 1 })
  assert.equal(result.evidenceItems, 4)
})

function liveReportFixture() {
  const query = { queryId: 'query_report', needId: 'need_report', query: 'quantum watermarking', provider: 'openalex', filters: {}, reason: 'report test', attempt: 1, corpusCutoff: '2026-09-29' }
  const unrelatedSource = { literatureId: 'literature_unrelated', title: 'A catalog of marine biology', authors: ['Author'], year: 2024, publicationDate: '2024-01-01', publicationDateStatus: 'KNOWN', abstract: 'Marine biology observations.', urls: ['https://example.test/unrelated'], providerRecords: { openalex: 'W-unrelated' }, retrievedAt: now }
  const selected = [{ originProblemNodeIds: ['node_report'], retrievalNeedId: 'need_report', queryId: query.queryId, searchCoverageId: 'coverage_report', searchCoverageStatus: 'COMPLETE', records: [unrelatedSource] }]
  const evaluation = assessment({ selectedOperationIds: ['op_report', 'op_deferred'], plannedOperationIds: ['op_report'], completedOperationIds: ['op_report'], failedOperationIds: [], deferredOperationIds: ['op_deferred'], emptyEvidenceOperationIds: ['op_report'], planStatus: 'COMPLETED', retrievalStatuses: ['NO_RESULTS', 'FAILED'], evidenceItemCount: 1 })
  return {
    caseId: 'report-semantics', researchArea: 'watermarking', budgets: {}, usage: {}, understanding: [], evidenceAssessment: evaluation,
    retrieval: [], selected, queries: [query], evidence: [{ evidenceId: 'evidence_abstract', evidenceLevel: 'ABSTRACT_EVIDENCE' }],
    evidencePlan: { deferredOperations: [{ operationId: 'op_deferred' }], execution: { completedOperationIds: ['op_report'], failedOperationIds: [], emptyEvidenceOperationIds: ['op_report'] }, incompleteCoverage: true },
    failures: [], modelCalls: 1, retryCount: 0, openAlexRequestCount: 2, retrievedRecordCount: 1, selectedSourceCount: 1,
  }
}

test('REPORT exposes semantic limitations without converting them into scientific conclusions', () => {
  const report = renderLiveReport(liveReportFixture())
  assert.match(report, /Evidence coverage is incomplete/)
  assert.match(report, /EvidenceExtractor operation\(s\) were deferred/)
  assert.match(report, /NO_RESULTS is a search outcome, not evidence of novelty, falsity, truth, negative evidence, or absence of literature/)
  assert.match(report, /empty extraction means no source-supported item was extracted.*not negative evidence/i)
  assert.match(report, /retrieval operation\(s\) FAILED.*do not show that relevant literature is absent/)
  assert.match(report, /abstract-level only \(ABSTRACT_EVIDENCE\).*full-text verification, experiment verification, equation-level verification, or quantitative verification/)
  assert.doesNotMatch(report, /NO_RESULTS[^\n]*(?:establishes|proves|shows) (?:novelty|falsity|truth|absence)/i)
  assert.doesNotMatch(report, /empty extraction is negative evidence/i)
})

test('REPORT renders source relevance warnings as quality limitations', () => {
  const report = renderLiveReport(liveReportFixture())
  assert.match(report, /Source relevance quality warnings/)
  assert.match(report, /no query-token overlap was found/)
  assert.match(report, /source-selection quality limitation/)
  assert.match(report, /not provenance defects or scientific conclusions/)
})

test('exact EVIDENCE_GRAPH canary replays as incomplete without treating empty outputs as negative evidence', () => {
  const root = resolve('evaluation/real-paper/cases/first-three/outputs/run-2026-10-03T10-49-54-232Z-e873924c')
  const read = name => JSON.parse(readFileSync(resolve(root, name), 'utf8'))
  const plan = read('evidence-plan.json')
  const coverage = read('search-coverage.json')
  const evidence = read('evidence.json')
  const graph = read('evidence-graph.json')
  const attempts = read('model-attempts.json').filter(item => item.role === 'EvidenceExtractor' && item.status === 'SUCCEEDED')
  const completed = attempts.map(item => JSON.parse(item.normalizedTextPreview).literatureId).map(literatureId => plan.plannedOperations.find(operation => operation.literatureId === literatureId)?.operationId).filter(Boolean)
  const result = summarizeEvidenceAssessment({ selectedOperationIds: [...plan.plannedOperations, ...plan.deferredOperations].map(item => item.operationId), plannedOperationIds: plan.plannedOperations.map(item => item.operationId), completedOperationIds: completed, failedOperationIds: [], deferredOperationIds: plan.deferredOperations.map(item => item.operationId), emptyEvidenceOperationIds: completed, planStatus: plan.status, retrievalStatuses: coverage.map(item => item.status), evidenceItemCount: evidence.length, graphClaimCount: graph.claims.length, graphEvidenceCount: graph.evidence.length, graphLinkCount: graph.links.length, graphRelations: graph.links.map(item => item.relation) })
  assert.equal(result.selectedProvenancePaths, 43)
  assert.equal(result.completedOperations, 6)
  assert.equal(result.deferredOperations, 37)
  assert.equal(result.exhaustive, false)
  assert.equal(result.scientificallyComplete, false)
  assert.deepEqual(result.retrievalCoverage, { COMPLETE: 10, NO_RESULTS: 2, FAILED: 0, PARTIAL: 0 })
  assert.equal(result.evidenceItems, 0)
  assert.equal(result.emptyEvidenceOperations, 6)
  assert.deepEqual(result.graphRelationCounts, {})
})

test('EvidenceExtractor rejects abstract/full-text level mismatches and unmarked interpretations', () => {
  assert.throws(() => validateEvidenceExtractorOutput({ claimId: input.claimId, literatureId: record.literatureId, items: [{ statement: 'x', relation: 'SUPPORTS', evidenceLevel: 'FULL_TEXT_EVIDENCE', confidence: 0.5 }] }, input), /full-text evidence requires/)
  assert.throws(() => validateEvidenceExtractorOutput({ claimId: input.claimId, literatureId: record.literatureId, items: [{ statement: 'x', relation: 'QUALIFIES', evidenceLevel: 'MODEL_INTERPRETATION', confidence: 0.5, modelInterpretation: false }] }, input), /explicitly marked/)
  assert.doesNotThrow(() => validateEvidenceExtractorOutput({ claimId: input.claimId, literatureId: record.literatureId, items: [{ statement: 'metadata only', relation: 'INSUFFICIENT', evidenceLevel: 'SOURCE_METADATA', confidence: 0.2, modelInterpretation: false }] }, { ...input, source: { literature: { ...input.source.literature, abstract: undefined }, provenance } }))
})

test('EvidenceExtractor reports precise envelope validation paths', () => {
  const valid = { claimId: input.claimId, literatureId: record.literatureId, items: [] }
  assert.throws(() => validateEvidenceExtractorOutput(null, input), /\$: expected EvidenceExtractorOutput object/)
  assert.throws(() => validateEvidenceExtractorOutput({ claimId: input.claimId, items: [] }, input), /\$\.literatureId: missing required property/)
  assert.throws(() => validateEvidenceExtractorOutput({ ...valid, literatureId: 'other' }, input), /\$\.literatureId: does not match trusted input/)
  assert.throws(() => validateEvidenceExtractorOutput({ ...valid, items: {} }, input), /\$\.items: expected array/)
  assert.throws(() => validateEvidenceExtractorOutput({ ...valid, claimId: 'other' }, input), /\$\.claimId: does not match trusted input/)
  assert.throws(() => validateEvidenceExtractorOutput({ ...valid, items: [{ statement: '', relation: 'SUPPORTS', evidenceLevel: 'ABSTRACT_EVIDENCE', confidence: 2 }] }, input), /\$\.items\[0\]: invalid evidence candidate fields/)
})

test('EvidenceExtractor format retry keeps the scientific input unchanged', async () => {
  let calls = 0; const gateway = { structured: async request => { calls++; if (calls === 1) return { ok: true, value: { bad: true } }; return { ok: true, value: { claimId: input.claimId, literatureId: record.literatureId, items: [] } } } }
  const result = await new EvidenceExtractor(gateway, { provider: 'fake', model: 'fake' }, 'evidence-extractor@1', 1).extract(input)
  assert.equal(result.ok, true); assert.equal(calls, 2); assert.equal(result.attempts[0].input.claim, result.attempts[1].input.claim); assert.deepEqual(result.attempts[1].input.serializationRetry.validationErrors, ['$.claimId: missing required property'])
})

test('EvidenceExtractor records schema failure and bounded retry exhaustion', async () => {
  const diagnostics = new Map(); let retries = 0
  const gateway = {
    structured: async request => { diagnostics.set(request.attemptId, request); return { ok: true, value: { claimId: input.claimId, literatureId: record.literatureId, items: {} }, diagnostic: { attemptId: request.attemptId, normalizedTextPresent: true, parseStatus: 'success', schemaValidationStatus: 'not-attempted', status: 'SUCCEEDED', outputTrust: 'UNTRUSTED / UNVALIDATED' } } },
    annotateAttempt: (attemptId, patch) => diagnostics.set(`${attemptId}:annotation`, patch),
  }
  const result = await new EvidenceExtractor(gateway, { provider: 'fake', model: 'fake' }, 'evidence-extractor@1', 1, undefined, () => { retries++ }).extract(input)
  assert.equal(result.ok, false); assert.equal(retries, 1); assert.match(result.error, /\$\.items: expected array/)
  const annotations = [...diagnostics.entries()].filter(([key]) => key.endsWith(':annotation')).map(([, value]) => value)
  assert.equal(annotations.length, 2); assert.equal(annotations[0].schemaValidationStatus, 'failure'); assert.equal(annotations[1].schemaValidationStatus, 'failure'); assert.equal(annotations[0].error, '$.items: expected array')
})

test('EvidenceExtractor retries malformed JSON but not provider failures', async () => {
  const diagnostic = (parseStatus) => ({ attemptId: 'attempt', normalizedTextPresent: false, parseStatus, schemaValidationStatus: 'not-attempted', status: 'FAILED', outputTrust: 'UNTRUSTED / UNVALIDATED' })
  let malformedCalls = 0
  const malformed = { structured: async () => { malformedCalls++; return { ok: false, error: 'invalid model JSON', diagnostic: diagnostic('failure') } } }
  const malformedResult = await new EvidenceExtractor(malformed, { provider: 'fake', model: 'fake' }, 'evidence-extractor@1', 1).extract(input)
  assert.equal(malformedResult.ok, false); assert.equal(malformedCalls, 2)
  let providerCalls = 0
  const provider = { structured: async () => { providerCalls++; return { ok: false, error: 'server is overloaded', diagnostic: diagnostic('not-attempted') } } }
  const providerResult = await new EvidenceExtractor(provider, { provider: 'fake', model: 'fake' }, 'evidence-extractor@1', 1).extract(input)
  assert.equal(providerResult.ok, false); assert.equal(providerCalls, 1)
})

test('EvidenceExtractor rejects failed retrieval provenance before model execution', async () => {
  let calls = 0
  const gateway = { structured: async () => { calls++; return { ok: true, value: {} } } }
  await assert.rejects(() => new EvidenceExtractor(gateway, { provider: 'fake', model: 'fake' }).extract({ ...input, source: { ...input.source, provenance: { ...provenance, searchCoverageStatus: 'FAILED' } } }), /retrieval failure or no-results/i)
  assert.equal(calls, 0)
})

test('evidence operation planning is deterministic and reserves serialization retries', () => {
  const selections = Array.from({ length: 2 }, (_, index) => ({ originProblemNodeIds: [`node_${index}`], retrievalNeedId: `need_${index}`, queryId: `query_${index}`, searchCoverageId: `coverage_${index}`, searchCoverageStatus: 'COMPLETE', records: Array.from({ length: 5 }, (_, sourceIndex) => ({ literatureId: `literature_${index}_${sourceIndex}` })) }))
  const limits = { maxTotalModelCalls: 30, maxPaperReaderModelCalls: 9, maxProblemExtractorModelCalls: 6, maxEvidenceExtractorModelCalls: 12, maxSerializationRetriesPerOperation: 1, maxRetrievalNeeds: 12, maxQueriesPerRetrievalNeed: 3, maxResultsExaminedPerQuery: 20, maxSelectedSourcesPerRetrievalNeed: 5 }
  const first = planEvidenceOperations(selections, limits, { totalModelCalls: 6, paperReaderModelCalls: 3, problemExtractorModelCalls: 3, evidenceExtractorModelCalls: 0, serializationRetries: 0, retrievalNeeds: 2, queries: 2, resultsExamined: 0, selectedSources: 10 })
  const second = planEvidenceOperations([...selections].reverse(), limits, { totalModelCalls: 6, paperReaderModelCalls: 3, problemExtractorModelCalls: 3, evidenceExtractorModelCalls: 0, serializationRetries: 0, retrievalNeeds: 2, queries: 2, resultsExamined: 0, selectedSources: 10 })
  assert.equal(first.operationUnit, 'ONE_SELECTED_SOURCE'); assert.equal(first.reservedModelCallsPerOperation, 2); assert.equal(first.maxPlannedOperations, 6); assert.equal(first.plannedOperations.length, 6); assert.equal(first.deferredOperations.length, 4); assert.equal(first.incompleteCoverage, true); assert.deepEqual(first.plannedOperations.map(item => item.operationId), second.plannedOperations.map(item => item.operationId))
})

test('RunBudget enforces global and role limits', () => {
  const budget = new RunBudget({ maxTotalModelCalls: 1, maxPaperReaderModelCalls: 1 })
  budget.modelCall('PaperReader'); assert.throws(() => budget.modelCall('PaperReader'), BudgetExhaustedError)
})

test('live wiring has a concrete handler for every M1-M3 stage', () => { assert.equal(LIVE_WIRING.length, 13); assert.equal(validateWiring().every(item => item.liveCapable), true); assert.equal(new Set(LIVE_WIRING.map(item => item.stage)).size, 13) })

test('stop-after PAPER_READ persists the boundary and skips downstream stages', async () => {
  const root = resolve('.tmp-stop-after-case'); const outputRoot = resolve(root, 'outputs'); rmSync(root, { recursive: true, force: true }); mkdirSync(resolve(root, 'papers'), { recursive: true }); const artifacts = ['gaussian-shading.pdf', 'gaussian-shading-plus-plus.pdf', 'tag-wm.pdf']; for (const name of artifacts) writeFileSync(resolve(root, 'papers', name), '(A paper.) Tj')
  writeFileSync(resolve(root, 'case.json'), JSON.stringify({ caseId: 'stop-after', title: 'Stop', researchArea: 'watermarking', paperArtifacts: artifacts.map((name, index) => ({ paperId: `p${index}`, path: `papers/${name}`, mediaType: 'application/pdf' })) }))
  const gateway = { structured: async request => ({ ok: true, value: { artifactId: request.inputArtifactIds[0], schemaVersion: 'm2.3', items: [] } }) }
  const result = await runLiveCase(resolve(root, 'case.json'), { outputRoot, stopAfter: 'PAPER_READ', gateway, preflightImpl: async () => ({ baseUrl: 'https://configured', model: 'fake', apiKeyConfigured: true, endpoint: 'https://configured/responses', reachable: true, responseSucceeded: true, normalizedText: true, structuredOutputMode: 'prompt_json', structuredOutputSupported: true }) })
  assert.equal(result.status, 'STOPPED_AS_REQUESTED'); assert.equal(result.scientificallyComplete, false); assert.equal(result.stopAfter, 'PAPER_READ'); assert.deepEqual(result.stages.slice(0, 3).map(item => [item.stage, item.status]), [['INGEST', 'COMPLETED'], ['EXTRACT', 'COMPLETED'], ['PAPER_READ', 'COMPLETED']]); assert.equal(result.stages.find(item => item.stage === 'PROBLEM_EXTRACT').status, 'INTENTIONALLY_NOT_RUN'); assert.equal(existsSync(resolve(result.outputDirectory, 'extraction-report.json')), true); assert.equal(existsSync(resolve(result.outputDirectory, 'paper-reader', 'p0.json')), true); assert.equal(result.outputDirectory.includes(`${resolve(root, 'outputs', 'outputs')}`), false); assert.equal(JSON.parse(readFileSync(resolve(result.outputDirectory, 'stage-state.json'), 'utf8')).find(item => item.stage === 'REPORT').status, 'INTENTIONALLY_NOT_RUN'); rmSync(root, { recursive: true, force: true })
})

test('stop-after REPORT completes report rendering before persisting the requested boundary', async () => {
  const root = resolve('.tmp-stop-after-report'); const outputRoot = resolve(root, 'outputs'); rmSync(root, { recursive: true, force: true }); mkdirSync(resolve(root, 'papers'), { recursive: true }); const artifacts = ['a.pdf', 'b.pdf', 'c.pdf']; for (const name of artifacts) writeFileSync(resolve(root, 'papers', name), '(A paper.) Tj')
  writeFileSync(resolve(root, 'case.json'), JSON.stringify({ caseId: 'stop-after-report', title: 'Stop report', researchArea: 'watermarking', corpusCutoff: '2026-09-29', paperArtifacts: artifacts.map((name, index) => ({ paperId: `p${index}`, path: `papers/${name}`, mediaType: 'application/pdf' })) }))
  const gateway = { structured: async request => request.role === 'PaperReader' ? { ok: true, value: { artifactId: request.inputArtifactIds[0], schemaVersion: 'm2.3', items: [] } } : { ok: true, value: { nodes: [], edges: [] } } }
  const result = await runLiveCase(resolve(root, 'case.json'), { outputRoot, stopAfter: 'REPORT', gateway, preflightImpl: async () => ({ baseUrl: 'https://configured', model: 'fake', apiKeyConfigured: true, endpoint: 'https://configured/responses', reachable: true, responseSucceeded: true, normalizedText: true, structuredOutputMode: 'prompt_json', structuredOutputSupported: true }) })
  assert.equal(result.status, 'STOPPED_AS_REQUESTED'); assert.equal(result.stopAfter, 'REPORT'); assert.equal(existsSync(resolve(result.outputDirectory, 'report.md')), true)
  const snapshot = JSON.parse(readFileSync(resolve(result.outputDirectory, 'run-snapshot.json'), 'utf8')); assert.equal(snapshot.status, 'STOPPED_AS_REQUESTED'); assert.equal(snapshot.stopAfter, 'REPORT')
  const state = JSON.parse(readFileSync(resolve(result.outputDirectory, 'stage-state.json'), 'utf8')); assert.equal(state.find(item => item.stage === 'REPORT').status, 'COMPLETED'); assert.equal(state.filter(item => item.status === 'INTENTIONALLY_NOT_RUN').length, 0)
  rmSync(root, { recursive: true, force: true })
})

test('stop-after validation rejects unknown stages before execution', () => { assert.throws(() => validateStopAfter('NOT_A_STAGE'), /INVALID_STOP_AFTER_STAGE/) })

test('live QUERY_PLAN carries the trusted cutoff into run provenance', async () => {
  const root = resolve('.tmp-cutoff-propagation'); const outputRoot = resolve(root, 'outputs'); rmSync(root, { recursive: true, force: true }); mkdirSync(resolve(root, 'papers'), { recursive: true }); const artifacts = ['a.pdf', 'b.pdf', 'c.pdf']; for (const name of artifacts) writeFileSync(resolve(root, 'papers', name), '(A paper.) Tj')
  writeFileSync(resolve(root, 'case.json'), JSON.stringify({ caseId: 'cutoff', title: 'Cutoff', researchArea: 'watermarking', corpusCutoff: '2026-09-29', paperArtifacts: artifacts.map((name, index) => ({ paperId: `p${index}`, path: `papers/${name}`, mediaType: 'application/pdf' })) }))
  const gateway = { structured: async request => request.role === 'PaperReader' ? { ok: true, value: { artifactId: request.inputArtifactIds[0], schemaVersion: 'm2.3', items: [] } } : { ok: true, value: { nodes: [{ nodeId: 'method', type: 'method', label: 'Watermark diffusion', evidenceIds: [] }], edges: [] } } }
  const result = await runLiveCase(resolve(root, 'case.json'), { outputRoot, stopAfter: 'QUERY_PLAN', gateway, preflightImpl: async () => ({ baseUrl: 'https://configured', model: 'fake', apiKeyConfigured: true, endpoint: 'https://configured/responses', reachable: true, responseSucceeded: true, normalizedText: true, structuredOutputMode: 'prompt_json', structuredOutputSupported: true }) })
  assert.equal(result.status, 'STOPPED_AS_REQUESTED')
  const snapshot = JSON.parse(readFileSync(resolve(result.outputDirectory, 'run-snapshot.json'), 'utf8'))
  assert.equal(snapshot.corpusCutoff, '2026-09-29')
  assert.equal(snapshot.literatureSearch.corpusCutoff, '2026-09-29')
  assert.equal(snapshot.literatureSearch.resultLimit, 20)
  const needs = JSON.parse(readFileSync(resolve(result.outputDirectory, 'retrieval-needs.json'), 'utf8'))
  const queries = JSON.parse(readFileSync(resolve(result.outputDirectory, 'literature-queries.json'), 'utf8'))
  assert.ok(needs.length > 0); assert.ok(needs.every(item => item.corpusCutoff === '2026-09-29')); assert.ok(queries.every(item => item.corpusCutoff === '2026-09-29'))
  rmSync(root, { recursive: true, force: true })
})

test('live literature search fails closed before provider construction when cutoff is absent', async () => {
  const root = resolve('.tmp-missing-cutoff'); const outputRoot = resolve(root, 'outputs'); rmSync(root, { recursive: true, force: true }); mkdirSync(resolve(root, 'papers'), { recursive: true }); const artifacts = ['a.pdf', 'b.pdf', 'c.pdf']; for (const name of artifacts) writeFileSync(resolve(root, 'papers', name), '(A paper.) Tj')
  writeFileSync(resolve(root, 'case.json'), JSON.stringify({ caseId: 'missing-cutoff', title: 'Missing cutoff', researchArea: 'watermarking', paperArtifacts: artifacts.map((name, index) => ({ paperId: `p${index}`, path: `papers/${name}`, mediaType: 'application/pdf' })) }))
  const gateway = { structured: async request => request.role === 'PaperReader' ? { ok: true, value: { artifactId: request.inputArtifactIds[0], schemaVersion: 'm2.3', items: [] } } : { ok: true, value: { nodes: [{ nodeId: 'method', type: 'method', label: 'Watermark diffusion', evidenceIds: [] }], edges: [] } } }
  const result = await runLiveCase(resolve(root, 'case.json'), { outputRoot, stopAfter: 'LITERATURE_SEARCH', gateway, preflightImpl: async () => ({ baseUrl: 'https://configured', model: 'fake', apiKeyConfigured: true, endpoint: 'https://configured/responses', reachable: true, responseSucceeded: true, normalizedText: true, structuredOutputMode: 'prompt_json', structuredOutputSupported: true }) })
  assert.equal(result.status, 'FAILED'); assert.equal(result.failedStage, 'LITERATURE_SEARCH'); assert.match(result.stages.find(item => item.stage === 'LITERATURE_SEARCH').error, /corpusCutoff/i)
  const snapshot = JSON.parse(readFileSync(resolve(result.outputDirectory, 'run-snapshot.json'), 'utf8')); assert.equal(Object.hasOwn(snapshot, 'corpusCutoff'), false); assert.match(snapshot.error, /corpusCutoff/i)
  rmSync(root, { recursive: true, force: true })
})

test('failed model preflight persists bounded diagnostics before any scientific stage', async () => {
  const root = resolve('.tmp-model-preflight-failure'); const outputRoot = resolve(root, 'outputs'); rmSync(root, { recursive: true, force: true }); mkdirSync(root, { recursive: true })
  writeFileSync(resolve(root, 'case.json'), JSON.stringify({ caseId: 'preflight-failure', title: 'Preflight failure', researchArea: 'watermarking', corpusCutoff: '2026-09-29', paperArtifacts: ['a.pdf', 'b.pdf', 'c.pdf'].map((path, index) => ({ paperId: `p${index}`, path, mediaType: 'application/pdf' })) }))
  let calls = 0
  const preflight = await preflightModel({ baseUrl: 'https://offline.example', apiKey: 'preflight-secret', model: 'offline', delayImpl: async () => {}, fetchImpl: async () => { calls++; return new Response('busy', { status: 429, headers: { 'content-type': 'application/json' } }) } })
  assert.equal(calls, 2)
  const result = await runLiveCase(resolve(root, 'case.json'), { outputRoot, preflightImpl: async () => preflight })
  assert.equal(result.status, 'FAILED'); assert.equal(result.failedStage, 'MODEL_PREFLIGHT'); assert.deepEqual(result.stages, [])
  const diagnostic = JSON.parse(readFileSync(resolve(result.outputDirectory, 'model-preflight.json'), 'utf8')); const snapshot = JSON.parse(readFileSync(resolve(result.outputDirectory, 'run-snapshot.json'), 'utf8')); const stageState = JSON.parse(readFileSync(resolve(result.outputDirectory, 'stage-state.json'), 'utf8'))
  assert.equal(diagnostic.status, 'FAILED'); assert.equal(diagnostic.attemptCount, 2); assert.equal(diagnostic.attempts[0].errorCategory, 'RATE_LIMIT'); assert.equal(diagnostic.attempts[1].retryPerformed, false); assert.equal(JSON.stringify(diagnostic).includes('preflight-secret'), false); assert.equal(snapshot.error.startsWith('MODEL_PREFLIGHT_FAILED:'), true); assert.deepEqual(snapshot.startedStages, []); assert.equal(snapshot.usage.totalModelCalls, 0); assert.deepEqual(stageState, [{ stage: 'MODEL_PREFLIGHT', status: 'FAILED', error: snapshot.error }]); rmSync(root, { recursive: true, force: true })
})

test('dry-run stop-after reports the planned boundary with zero network calls', () => {
  const root = resolve('.tmp-stop-dry-run'); rmSync(root, { recursive: true, force: true }); mkdirSync(resolve(root, 'papers'), { recursive: true }); const artifacts = ['a.pdf', 'b.pdf', 'c.pdf']; for (const name of artifacts) writeFileSync(resolve(root, 'papers', name), '(A paper.) Tj'); writeFileSync(resolve(root, 'case.json'), JSON.stringify({ caseId: 'dry-stop', title: 'Dry', researchArea: 'watermarking', paperArtifacts: artifacts.map((name, index) => ({ paperId: `p${index}`, path: `papers/${name}`, mediaType: 'application/pdf' })) })); const result = dryRunCase(resolve(root, 'case.json'), { stopAfter: 'PAPER_READ' }); assert.equal(result.zeroModelCalls, true); assert.equal(result.zeroOpenAlexCalls, true); assert.deepEqual(result.plannedStages, ['INGEST', 'EXTRACT', 'PAPER_READ']); assert.ok(result.intentionallyNotRunStages.includes('REPORT')); rmSync(root, { recursive: true, force: true })
})

test('Generation-0 remains opt-in in dry-run planning', () => {
  const root = resolve('.tmp-generation0-dry-run'); rmSync(root, { recursive: true, force: true }); mkdirSync(resolve(root, 'papers'), { recursive: true }); const artifacts = ['a.pdf', 'b.pdf', 'c.pdf']; for (const name of artifacts) writeFileSync(resolve(root, 'papers', name), '(A paper.) Tj'); writeFileSync(resolve(root, 'case.json'), JSON.stringify({ caseId: 'dry-generation0', title: 'Dry generation', researchArea: 'watermarking', corpusCutoff: '2026-09-29', paperArtifacts: artifacts.map((name, index) => ({ paperId: `p${index}`, path: `papers/${name}`, mediaType: 'application/pdf' })) }))
  const withoutOptIn = dryRunCase(resolve(root, 'case.json')); const withOptIn = dryRunCase(resolve(root, 'case.json'), { enableGeneration0: true })
  assert.equal(withoutOptIn.generation0OptIn, false); assert.equal(withoutOptIn.plannedStages.includes('GAP_DISCOVERY'), false)
  assert.equal(withOptIn.generation0OptIn, true); assert.deepEqual(withOptIn.plannedStages.slice(-2), ['GAP_DISCOVERY', 'GENERATION_0']); assert.equal(withOptIn.zeroModelCalls, true); assert.equal(withOptIn.zeroOpenAlexCalls, true)
  rmSync(root, { recursive: true, force: true })
})

test('dry-run validates local artifacts and reports zero network calls', () => {
  const root = resolve('.tmp-live-validation-case'); rmSync(root, { recursive: true, force: true }); mkdirSync(resolve(root, 'papers'), { recursive: true }); const artifacts = ['a.pdf', 'b.pdf', 'c.pdf']; for (const name of artifacts) writeFileSync(resolve(root, 'papers', name), '# Abstract\nA local paper.')
  writeFileSync(resolve(root, 'case.json'), JSON.stringify({ caseId: 'dry', title: 'Dry', researchArea: 'watermarking', paperArtifacts: artifacts.map((name, index) => ({ paperId: `p${index}`, path: `papers/${name}`, mediaType: 'application/pdf' })) }))
  const original = { base: process.env.EVORESEARCH_MODEL_BASE_URL, key: process.env.EVORESEARCH_MODEL_API_KEY, model: process.env.EVORESEARCH_MODEL }
  process.env.EVORESEARCH_MODEL_BASE_URL = 'https://configured.invalid'; process.env.EVORESEARCH_MODEL_API_KEY = 'configured'; process.env.EVORESEARCH_MODEL = 'configured'
  const result = dryRunCase(resolve(root, 'case.json')); assert.equal(result.zeroModelCalls, true); assert.equal(result.zeroOpenAlexCalls, true); assert.equal(result.academicProvider.networkCalls, 0); assert.equal(result.papers.length, 3)
  if (original.base === undefined) delete process.env.EVORESEARCH_MODEL_BASE_URL; else process.env.EVORESEARCH_MODEL_BASE_URL = original.base; if (original.key === undefined) delete process.env.EVORESEARCH_MODEL_API_KEY; else process.env.EVORESEARCH_MODEL_API_KEY = original.key; if (original.model === undefined) delete process.env.EVORESEARCH_MODEL; else process.env.EVORESEARCH_MODEL = original.model; rmSync(root, { recursive: true, force: true })
})

test('live configuration errors stop before preflight and cannot select a fallback endpoint', async () => {
  const root = resolve('.tmp-invalid-live-configuration'); const outputRoot = resolve(root, 'outputs'); rmSync(root, { recursive: true, force: true }); mkdirSync(root, { recursive: true })
  writeFileSync(resolve(root, 'case.json'), JSON.stringify({ caseId: 'invalid-config', title: 'Invalid config', researchArea: 'watermarking', paperArtifacts: ['a.pdf', 'b.pdf', 'c.pdf'].map((path, index) => ({ paperId: `p${index}`, path, mediaType: 'application/pdf' })) }))
  const keys = ['EVORESEARCH_MODEL_BASE_URL', 'EVORESEARCH_MODEL_API_KEY', 'EVORESEARCH_MODEL', 'EVORESEARCH_MODEL_STRUCTURED_OUTPUT_MODE', 'EVORESEARCH_MODEL_STREAMING']
  const original = Object.fromEntries(keys.map(key => [key, process.env[key]]))
  process.env.EVORESEARCH_MODEL_BASE_URL = 'ftp://invalid.example/v1'; process.env.EVORESEARCH_MODEL_API_KEY = 'synthetic-key'; process.env.EVORESEARCH_MODEL = 'synthetic-model'; process.env.EVORESEARCH_MODEL_STRUCTURED_OUTPUT_MODE = 'prompt_json'; process.env.EVORESEARCH_MODEL_STREAMING = 'required'
  try {
    const result = await runLiveCase(resolve(root, 'case.json'), { outputRoot })
    assert.equal(result.status, 'FAILED'); assert.equal(result.failedStage, 'MODEL_PREFLIGHT')
    const preflight = JSON.parse(readFileSync(resolve(result.outputDirectory, 'model-preflight.json'), 'utf8'))
    assert.equal(preflight.final.errorCategory, 'CONFIGURATION'); assert.match(preflight.final.error, /absolute http/); assert.equal(JSON.stringify(preflight).includes('synthetic-key'), false)
  } finally {
    for (const [key, value] of Object.entries(original)) { if (value === undefined) delete process.env[key]; else process.env[key] = value }
    rmSync(root, { recursive: true, force: true })
  }
})
