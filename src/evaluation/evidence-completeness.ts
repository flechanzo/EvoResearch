import type { CoverageStatus } from '../domain/types.ts'

export type EvidenceAssessmentStatus = 'EXHAUSTIVE' | 'INCOMPLETE'
export type EvidenceAssessmentReason = 'DEFERRED_OPERATIONS' | 'FAILED_OPERATIONS' | 'UNEXECUTED_PLANNED_OPERATIONS' | 'FAILED_RETRIEVAL' | 'PARTIAL_RETRIEVAL' | 'EVIDENCE_PLAN_FAILED' | 'EVIDENCE_PLAN_NOT_COMPLETED'

export interface EvidenceAssessmentInput {
  readonly selectedOperationIds: readonly string[]
  readonly plannedOperationIds: readonly string[]
  readonly completedOperationIds: readonly string[]
  readonly failedOperationIds: readonly string[]
  readonly deferredOperationIds: readonly string[]
  readonly emptyEvidenceOperationIds: readonly string[]
  readonly planStatus: 'PLANNED' | 'COMPLETED' | 'FAILED'
  readonly retrievalStatuses: readonly CoverageStatus[]
  readonly evidenceItemCount: number
  readonly graphClaimCount: number
  readonly graphEvidenceCount: number
  readonly graphLinkCount: number
  readonly graphRelations?: readonly string[]
}

export interface EvidenceAssessmentSummary {
  readonly status: EvidenceAssessmentStatus
  readonly exhaustive: boolean
  readonly selectedProvenancePaths: number
  readonly plannedOperations: number
  readonly completedOperations: number
  readonly failedOperations: number
  readonly deferredOperations: number
  readonly unexecutedPlannedOperations: number
  readonly emptyEvidenceOperations: number
  readonly evidenceItems: number
  readonly graphClaimNodes: number
  readonly graphEvidenceNodes: number
  readonly graphLinks: number
  readonly graphRelationCounts: Readonly<Record<string, number>>
  readonly retrievalCoverage: Readonly<Record<CoverageStatus, number>>
  readonly reasons: readonly EvidenceAssessmentReason[]
  readonly scientificallyComplete: boolean
  readonly authoritativeArtifacts: Readonly<{ readonly evidencePlan: string; readonly evidence: string; readonly evidenceGraph: string; readonly searchCoverage: string }>
}

const COVERAGE_STATUSES: readonly CoverageStatus[] = ['COMPLETE', 'NO_RESULTS', 'FAILED', 'PARTIAL']

function countRelations(relations: readonly string[]): Readonly<Record<string, number>> {
  const counts: Record<string, number> = {}
  for (const relation of relations) counts[relation] = (counts[relation] ?? 0) + 1
  return counts
}

export function summarizeEvidenceAssessment(input: EvidenceAssessmentInput): EvidenceAssessmentSummary {
  const retrievalCoverage = Object.fromEntries(COVERAGE_STATUSES.map(status => [status, input.retrievalStatuses.filter(value => value === status).length])) as Record<CoverageStatus, number>
  const completed = new Set(input.completedOperationIds)
  const failed = new Set(input.failedOperationIds)
  const deferred = new Set(input.deferredOperationIds)
  const selected = new Set(input.selectedOperationIds)
  const planned = new Set(input.plannedOperationIds)
  const unexecutedPlannedOperations = [...planned].filter(operationId => !completed.has(operationId) && !failed.has(operationId)).length
  const reasons: EvidenceAssessmentReason[] = []
  if (deferred.size > 0) reasons.push('DEFERRED_OPERATIONS')
  if (failed.size > 0) reasons.push('FAILED_OPERATIONS')
  if (unexecutedPlannedOperations > 0) reasons.push('UNEXECUTED_PLANNED_OPERATIONS')
  if (retrievalCoverage.FAILED > 0) reasons.push('FAILED_RETRIEVAL')
  if (retrievalCoverage.PARTIAL > 0) reasons.push('PARTIAL_RETRIEVAL')
  if (input.planStatus === 'FAILED') reasons.push('EVIDENCE_PLAN_FAILED')
  if (input.planStatus === 'PLANNED') reasons.push('EVIDENCE_PLAN_NOT_COMPLETED')
  const exhaustive = reasons.length === 0
  return {
    status: exhaustive ? 'EXHAUSTIVE' : 'INCOMPLETE',
    exhaustive,
    selectedProvenancePaths: selected.size,
    plannedOperations: planned.size,
    completedOperations: completed.size,
    failedOperations: failed.size,
    deferredOperations: deferred.size,
    unexecutedPlannedOperations,
    emptyEvidenceOperations: new Set(input.emptyEvidenceOperationIds).size,
    evidenceItems: input.evidenceItemCount,
    graphClaimNodes: input.graphClaimCount,
    graphEvidenceNodes: input.graphEvidenceCount,
    graphLinks: input.graphLinkCount,
    graphRelationCounts: countRelations(input.graphRelations ?? []),
    retrievalCoverage,
    reasons,
    scientificallyComplete: exhaustive,
    authoritativeArtifacts: { evidencePlan: 'evidence-plan.json', evidence: 'evidence.json', evidenceGraph: 'evidence-graph.json', searchCoverage: 'search-coverage.json' },
  }
}
