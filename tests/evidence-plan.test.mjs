import assert from 'node:assert/strict'
import test from 'node:test'
import { planEvidenceOperations, orderEvidenceOperationsByNeedRank } from '../src/coordinator/live-validation.ts'
import { RunBudget } from '../src/domain/run-budget.ts'
import { summarizeEvidenceAssessment } from '../src/evaluation/index.ts'
import { EvidenceGraph } from '../src/literature/index.ts'
import { compareEvidencePlan, fixture } from '../scripts/compare-evidence-plan.mjs'

const budget = new RunBudget()
const selection = (need, ids, query = `query_${need}`, status = 'COMPLETE') => ({
  originProblemNodeIds: [`node_${need}`], retrievalNeedId: need, queryId: query,
  searchCoverageId: `coverage_${query}`, searchCoverageStatus: status,
  records: ids.map(literatureId => ({ literatureId })),
})
const plan = (selections, slots, overrides = {}, usage = budget.usage) => planEvidenceOperations(selections,
  { ...budget.limits, maxEvidenceExtractorModelCalls: slots * 2, ...overrides }, usage)
const ids = result => result.plannedOperations.map(operation => operation.operationId)

test('budget smaller than need count covers stable first choices before any second choice', () => {
  const input = [selection('need_c', ['z', 'a']), selection('need_a', ['z', 'a', 'b', 'c', 'd']), selection('need_b', ['z', 'a'])]
  const result = plan(input, 2)
  assert.deepEqual(ids(result), ['need_a:query_need_a:z', 'need_b:query_need_b:z'])
  assert.deepEqual(ids(plan([...input].reverse(), 2)), ids(result))
  assert.equal(result.deferredOperations.length, 7)
  assert.equal(result.incompleteCoverage, true)
  assert.ok(result.deferredOperations.some(operation => operation.retrievalNeedId === 'need_c'))
})

test('low operation IDs cannot promote rank four or five over another need first choice', () => {
  const result = plan([selection('need_a', ['z', 'y', 'x', 'a', 'b']), selection('need_b', ['z'])], 3)
  assert.deepEqual(ids(result), ['need_a:query_need_a:z', 'need_b:query_need_b:z', 'need_a:query_need_a:y'])
  assert.deepEqual(result.deferredOperations.map(operation => operation.literatureId), ['x', 'a', 'b'])
})

test('sufficient budget retains every path and authoritative order within each need', () => {
  const input = [selection('need_b', ['c']), selection('need_a', ['z', 'a', 'm'])]
  const before = JSON.stringify(input)
  const result = plan(input, 4)
  assert.deepEqual(ids(result), ['need_a:query_need_a:z', 'need_b:query_need_b:c', 'need_a:query_need_a:a', 'need_a:query_need_a:m'])
  assert.equal(result.deferredOperations.length, 0)
  assert.equal(result.incompleteCoverage, false)
  assert.equal(JSON.stringify(input), before)
  assert.deepEqual(orderEvidenceOperationsByNeedRank([...result.plannedOperations]), result.plannedOperations)
})

test('multiple queries preserve persisted within-need sequence and shared literature paths', () => {
  const result = plan([selection('need_a', ['shared', 'first'], 'query_z'), selection('need_b', ['shared'], 'query_b'), selection('need_a', ['shared', 'last'], 'query_a')], 5)
  assert.deepEqual(ids(result), ['need_a:query_z:shared', 'need_b:query_b:shared', 'need_a:query_z:first', 'need_a:query_a:shared', 'need_a:query_a:last'])
  assert.equal(new Set(ids(result)).size, 5)
  assert.equal(result.plannedOperations.filter(operation => operation.literatureId === 'shared').length, 3)
})

test('role and global remaining calls still reserve exactly the configured retries', () => {
  const input = [selection('need_a', ['a', 'b', 'c', 'd', 'e']), selection('need_b', ['a', 'b', 'c', 'd', 'e'])]
  const result = planEvidenceOperations(input, budget.limits, budget.usage)
  assert.equal(result.maxEvidenceExtractorModelCalls, 12)
  assert.equal(result.maxSerializationRetriesPerOperation, 1)
  assert.equal(result.reservedModelCallsPerOperation, 2)
  assert.equal(result.maxPlannedOperations, 6)
  assert.equal(result.plannedOperations.length, 6)
  assert.equal(result.deferredOperations.length, 4)
  assert.equal(plan(input, 6, {}, { ...budget.usage, evidenceExtractorModelCalls: 9 }).plannedOperations.length, 1)
  assert.equal(plan(input, 6, {}, { ...budget.usage, totalModelCalls: 27 }).plannedOperations.length, 1)
  assert.equal(plan(input, 6, {}, { ...budget.usage, evidenceExtractorModelCalls: 12 }).plannedOperations.length, 0)
  assert.equal(plan(input, 6, { maxSerializationRetriesPerOperation: 0 }).plannedOperations.length, 10)
})

test('deferred operations retain query-local provenance and coverage counts', () => {
  const input = [selection('need_b', ['shared', 'next'], 'query_b', 'PARTIAL'), selection('need_a', ['first'], 'query_a')]
  const result = plan(input, 1)
  assert.deepEqual(result.deferredOperations, input[0].records.map(record => ({
    operationId: `need_b:query_b:${record.literatureId}`, originProblemNodeIds: ['node_need_b'],
    retrievalNeedId: 'need_b', queryId: 'query_b', searchCoverageId: 'coverage_query_b', searchCoverageStatus: 'PARTIAL', literatureId: record.literatureId,
  })))
  assert.deepEqual(result.coverage.map(row => [row.selectedCount, row.plannedCount, row.deferredCount]), [[2, 0, 2], [1, 1, 0]])
  assert.deepEqual(result.execution, { completedOperationIds: [], failedOperationIds: [], emptyEvidenceOperationIds: [] })
})

test('empty NO_RESULTS and FAILED selections contribute no work and retain coverage status', () => {
  const result = plan([selection('need_a', [], 'query_a', 'NO_RESULTS'), selection('need_b', [], 'query_b', 'FAILED'), selection('need_c', ['first'])], 2)
  assert.deepEqual(ids(result), ['need_c:query_need_c:first'])
  assert.deepEqual(result.coverage.map(row => [row.searchCoverageStatus, row.selectedCount]), [['NO_RESULTS', 0], ['FAILED', 0], ['COMPLETE', 1]])
})

test('exact forensic fixture replaces ID starvation with six first-ranked distinct needs', () => {
  const replay = compareEvidencePlan()
  assert.equal(replay.referenceRunId, 'run-2026-10-04T05-14-44-337Z-66422045')
  assert.equal(replay.candidateOperations, 44)
  assert.equal(replay.old.plannedOperationCount, 6)
  assert.equal(replay.old.distinctRetrievalNeeds, 2)
  assert.deepEqual(Object.values(replay.old.operationsPerNeed), [2, 4])
  assert.deepEqual(replay.old.plannedRankDistribution, { 1: 2, 2: 2, 4: 1, 5: 1 })
  assert.equal(replay.new.distinctRetrievalNeeds, 6)
  assert.deepEqual(Object.values(replay.new.operationsPerNeed), [1, 1, 1, 1, 1, 1])
  assert.deepEqual(replay.new.plannedRankDistribution, { 1: 6 })
  for (const policy of [replay.old, replay.new]) {
    assert.equal(policy.plannedOperationCount, 6)
    assert.equal(policy.deferredOperationCount, 38)
    assert.equal(policy.incompleteCoverage, true)
  }
  assert.deepEqual(replay.new.plannedOperations.map(operation => operation.literatureId), [
    'literature_e77db958066dbeb71e115af0', 'literature_07dfd89ad2e5737ebd3fc756',
    'literature_68d01b6472a9647c868f2e47', 'literature_c3488af04b1c3a35d919e87d',
    'literature_b0e1fe3056cc91472053f13b', 'literature_7fcaba986ab3eab835297ea1',
  ])
  const result = planEvidenceOperations(fixture.selections, budget.limits, budget.usage)
  assert.equal(new Set([...result.plannedOperations, ...result.deferredOperations].map(operation => operation.operationId)).size, 44)
})

test('successful zero-item targets remain unsupported and distinct from deferred work', () => {
  const result = plan([selection('need_a', ['first', 'deferred'])], 1)
  const executedId = result.plannedOperations[0].operationId
  const summary = summarizeEvidenceAssessment({ selectedOperationIds: [...result.plannedOperations, ...result.deferredOperations].map(operation => operation.operationId),
    plannedOperationIds: [executedId], completedOperationIds: [executedId], emptyEvidenceOperationIds: [executedId],
    failedOperationIds: [], deferredOperationIds: result.deferredOperations.map(operation => operation.operationId), planStatus: 'COMPLETED',
    retrievalStatuses: ['COMPLETE'], evidenceItemCount: 0, graphClaimCount: 1, graphEvidenceCount: 0, graphLinkCount: 0, graphRelations: [] })
  assert.equal(summary.completedOperations, 1)
  assert.equal(summary.emptyEvidenceOperations, 1)
  assert.equal(summary.deferredOperations, 1)
  assert.equal(summary.failedOperations, 0)
  assert.equal(summary.scientificallyComplete, false)
  assert.deepEqual(summary.graphRelationCounts, {})
  const graph = new EvidenceGraph()
  graph.addClaim({ claimId: 'claim_target', statement: 'Retrieval goal', claimType: 'open-question', scope: 'test', uncertainty: 0.5 })
  assert.deepEqual(graph.getSupportingEvidence('claim_target'), [])
  assert.deepEqual(graph.getSourcesForClaim('claim_target'), [])
})
