import { deriveRetrievalNeeds, planQueries, normalizeLiterature, makeCoverage, EvidenceGraph } from '../../src/literature/index.ts'

const graph = { problems: [], nodes: [{ nodeId: 'q1', type: 'open-question', label: 'Can robust training generalize?', evidenceIds: [] }], edges: [] }
const needs = deriveRetrievalNeeds(graph, '2022')
const queries = planQueries(needs, 'fake')
const literature = normalizeLiterature({ title: 'Robust Training', authors: ['A. Researcher'], year: 2020, abstract: 'Robust training improves generalization.', openAlexId: 'W1', provider: 'fake', providerId: 'W1', retrievedAt: '2026-09-28T00:00:00Z' })
const coverage = makeCoverage({ queryId: queries[0].queryId, provider: 'fake', query: queries[0].query, filters: {}, corpusCutoff: '2022', requestedLimit: 5, returnedCount: 1, examinedCount: 1, acceptedCount: 1, duplicateCount: 0, futureExcludedCount: 0, failedFetchCount: 0, timestamp: '2026-09-28T00:00:00Z', status: 'COMPLETE', diagnostics: [] })
const evidenceGraph = new EvidenceGraph()
evidenceGraph.addClaim({ claimId: 'claim_1', statement: 'Robust training improves generalization.', claimType: 'result', scope: 'abstract', uncertainty: 0.2 })
evidenceGraph.addEvidence({ evidenceId: 'evidence_1', kind: 'observation', claim: 'Robust training improves generalization.', polarity: 'SUPPORT', provenance: { sourceType: 'url', sourceId: literature.openAlexId, locator: 'abstract', contentHash: 'a'.repeat(64), retrievedAt: literature.retrievedAt }, claimIds: [], limitations: [], confidence: 0.8, createdAt: literature.retrievedAt, literatureId: literature.literatureId, evidenceLevel: 'ABSTRACT_EVIDENCE', modelInterpretation: false })
evidenceGraph.linkEvidenceToClaim({ evidenceId: 'evidence_1', claimId: 'claim_1', relation: 'SUPPORTS' })
console.log(JSON.stringify({ graph, needs, queries, coverage, literature, evidence: evidenceGraph.getEvidenceForClaim('claim_1'), claims: evidenceGraph.getClaimsForSource(literature.literatureId) }, null, 2))
