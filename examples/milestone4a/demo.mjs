import { deterministicId } from '../../src/domain/ids.ts'
import { discoverResearchGaps, generateGeneration0Hypotheses } from '../../src/milestone4a/index.ts'

const now = '2026-10-07T00:00:00.000Z'
const evidence = [{
  evidenceId: deterministicId('evidence', 'm4a-direct'), kind: 'observation', claim: 'The baseline fails on the boundary case', polarity: 'WEAKEN',
  provenance: { sourceType: 'paper', sourceId: 'paper_m4a' }, claimIds: [deterministicId('claim', 'm4a-claim')], limitations: [], confidence: 0.8, createdAt: now,
}]
const problemGraph = {
  problems: [],
  nodes: [
    { nodeId: deterministicId('graph_node', 'm4a-limit'), type: 'limitation', label: 'The baseline fails on a sparse boundary case', evidenceIds: [evidence[0].evidenceId] },
    { nodeId: deterministicId('graph_node', 'm4a-coverage'), type: 'open-question', label: 'Whether the method transfers to a new domain is unexamined', evidenceIds: [] },
  ],
  edges: [],
}
const completeness = { status: 'INCOMPLETE', exhaustive: false, scientificallyComplete: false, deferredOperations: ['deferred-1'], retrievalCoverage: { COMPLETE: 1, NO_RESULTS: 1, FAILED: 0, PARTIAL: 0 }, evidenceItems: 1 }
const gaps = discoverResearchGaps({ problemGraph, evidence, completeness, now })
const population = await generateGeneration0Hypotheses({ gapDiscovery: gaps, problemGraph, evidence, claims: [{ claimId: evidence[0].claimIds[0], statement: 'The baseline fails on the boundary case', kind: 'limitation', provenance: { sourceType: 'paper', sourceId: 'paper_m4a' } }] }, { candidateBudget: 4, now })
if (population.hypotheses.some(hypothesis => hypothesis.originatingGapIds.some(id => gaps.gaps.find(gap => gap.gapId === id)?.coverageState === 'COVERAGE_ONLY'))) throw new Error('coverage-only gap was seeded')
console.log(JSON.stringify({ gapKinds: gaps.gaps.map(gap => ({ kind: gap.kind, eligible: gap.eligibility.eligible })), generation0: population.hypotheses.map(hypothesis => ({ hypothesisId: hypothesis.hypothesisId, gapIds: hypothesis.originatingGapIds, status: hypothesis.status, noveltyStatus: hypothesis.noveltyStatus })) }, null, 2))
