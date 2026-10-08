import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { planEvidenceOperations } from '../src/coordinator/live-validation.ts'
import { RunBudget } from '../src/domain/run-budget.ts'

export const fixture = JSON.parse(readFileSync(new URL('../tests/fixtures/evidence-plan/first-fresh-source-selection.json', import.meta.url), 'utf8'))
const identity = (selection, record) => `${selection.retrievalNeedId}:${selection.queryId}:${record.literatureId}`

export function compareEvidencePlan() {
  const budget = new RunBudget()
  const current = planEvidenceOperations(fixture.selections, budget.limits, budget.usage)
  const all = [...current.plannedOperations, ...current.deferredOperations]
    .sort((left, right) => left.operationId.localeCompare(right.operationId))
  const diagnostics = new Map(fixture.selections.flatMap(selection => selection.records.map((record, index) => [identity(selection, record), { title: record.title, sourceSelectionRank: index + 1 }])))
  function summarize(policy, operations) {
    const perNeed = {}, rankDistribution = {}
    const planned = operations.slice(0, current.maxPlannedOperations)
    for (const operation of planned) {
      perNeed[operation.retrievalNeedId] = (perNeed[operation.retrievalNeedId] ?? 0) + 1
      const rank = diagnostics.get(operation.operationId).sourceSelectionRank
      rankDistribution[rank] = (rankDistribution[rank] ?? 0) + 1
    }
    return { policy, plannedOperationCount: planned.length, deferredOperationCount: operations.length - planned.length,
      distinctRetrievalNeeds: Object.keys(perNeed).length, operationsPerNeed: perNeed, plannedRankDistribution: rankDistribution,
      incompleteCoverage: operations.length > planned.length,
      plannedOperations: planned.map(operation => ({ ...operation, ...diagnostics.get(operation.operationId) })) }
  }
  return { referenceRunId: fixture.referenceRunId, candidateOperations: all.length,
    maxEvidenceExtractorModelCalls: current.maxEvidenceExtractorModelCalls, reservedModelCallsPerOperation: current.reservedModelCallsPerOperation,
    old: summarize('OLD_OPERATION_ID_ORDER', all),
    new: summarize('NEW_RANK_FIRST_NEED_ROUND_ROBIN', [...current.plannedOperations, ...current.deferredOperations]) }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  console.log(JSON.stringify(compareEvidencePlan(), null, 2))
}
