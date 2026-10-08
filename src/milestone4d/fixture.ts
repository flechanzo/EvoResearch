import { deterministicId } from '../domain/ids.ts'
import type { BudgetLedger, Claim, Evidence, ResearchProblemGraph } from '../domain/types.ts'
import { discoverResearchGaps } from '../milestone4a/gap-discovery.ts'
import type { EvaluationRequest } from '../milestone4c/types.ts'
import type { M4DLifecycleInput } from './types.ts'

const now = '2026-10-09T00:00:00.000Z'
const runId = deterministicId('run', 'm4d-deterministic-fixture') as never
const paperId = deterministicId('paper', 'm4d-fixture') as never
const problemNodeId = deterministicId('graph_node', 'm4d-problem') as never
const limitationNodeId = deterministicId('graph_node', 'm4d-limitation') as never
const claimId = deterministicId('claim', 'm4d-claim') as never
const evidenceId = deterministicId('evidence', 'm4d-evidence') as never

function budget(): BudgetLedger {
  return { limits: { maxModelCalls: 0, maxSearchCalls: 0, maxCandidates: 4, maxMutations: 2, maxTokens: 0 }, usage: { maxModelCalls: 0, maxSearchCalls: 0, maxCandidates: 0, maxMutations: 0, maxTokens: 0 } }
}

function evidence(): Evidence & Record<string, unknown> {
  return { evidenceId, kind: 'observation', claim: 'The baseline fails on a bounded boundary case.', polarity: 'WEAKEN', provenance: { sourceType: 'paper', sourceId: paperId, locator: 'p1:limitation', quotedText: 'The baseline fails on a bounded boundary case.', contentHash: 'a'.repeat(64) }, claimIds: [claimId], limitations: [], confidence: 0.9, createdAt: now }
}

function problemGraph(): ResearchProblemGraph {
  return { problems: [{ problemId: deterministicId('problem', 'm4d-problem') as never, statement: 'Improve bounded boundary behavior.', evidenceIds: [evidenceId], methodIds: [], assumptionIds: [], limitationIds: [limitationNodeId], failureCaseIds: [], openQuestionIds: [] }], nodes: [{ nodeId: problemNodeId, type: 'problem', label: 'Boundary behavior', evidenceIds: [evidenceId] }, { nodeId: limitationNodeId, type: 'limitation', label: 'Baseline fails on boundary case', evidenceIds: [evidenceId] }], edges: [{ edgeId: deterministicId('graph_edge', 'm4d-edge') as never, from: problemNodeId, to: limitationNodeId, relation: 'HAS_LIMITATION', evidenceIds: [evidenceId] }] }
}

function claims(): Claim[] {
  return [{ claimId, paperId, statement: 'The baseline fails on a bounded boundary case.', kind: 'limitation', provenance: { sourceType: 'paper', sourceId: paperId, locator: 'p1:limitation', quotedText: 'The baseline fails on a bounded boundary case.', contentHash: 'a'.repeat(64) }, artifactId: undefined }]
}

export function createDeterministicM4DFixture(): M4DLifecycleInput {
  const direct = evidence()
  const m4aBase = { runId, problemGraph: problemGraph(), evidenceGraph: { claims: claims(), evidence: [direct], links: [{ evidenceId, claimId, relation: 'SUPPORTS', targetType: 'claim' }] }, claims: claims(), evidence: [direct], completeness: { status: 'EXHAUSTIVE' as const, exhaustive: true, scientificallyComplete: true, evidenceItems: 1 }, explicitLimitations: ['The baseline fails on a bounded boundary case.'], now, budget: budget() }
  return {
    m4a: { ...m4aBase, gapDiscovery: discoverResearchGaps(m4aBase) },
    reviewFor: hypothesis => ({ reviewId: deterministicId('review', { stage: 'm4d', hypothesisId: hypothesis.hypothesisId }) as never, hypothesisId: hypothesis.hypothesisId, role: 'DeterministicReviewer', summary: 'The boundary case remains inadequately addressed.', criticismIds: [deterministicId('criticism', { stage: 'm4d', hypothesisId: hypothesis.hypothesisId }) as never], evidenceIds: [evidenceId], dimensions: [], createdAt: now }),
    criticismFor: (hypothesis, review) => ({ criticismId: review.criticismIds[0], hypothesisId: hypothesis.hypothesisId, reviewId: review.reviewId, reviewerRole: review.role, statement: 'The mechanism does not explain the boundary failure.', severity: 'high', evidenceIds: [evidenceId], createdAt: now }),
    evaluationFor: (hypothesis, evidenceItems): EvaluationRequest => {
      const mutated = hypothesis.parentIds.length > 0
      const values = mutated ? { evidenceSupport: 0.85, feasibility: 0.8, expectedImpact: 0.8, reproducibility: 0.85, noveltyPotential: 0.75, uncertainty: 0.2, experimentalCost: 0.3, priorArtOverlap: 0.2 } : { evidenceSupport: 0.45, feasibility: 0.5, expectedImpact: 0.5, reproducibility: 0.55, noveltyPotential: 0.4, uncertainty: 0.7, experimentalCost: 0.7, priorArtOverlap: 0.7 }
      return { hypothesis, evaluator: 'deterministic-fixture-evaluator', evaluationDimensions: values, evidenceReferences: evidenceItems.map(item => item.evidenceId), uncertainty: { level: mutated ? 0.2 : 0.7, reasons: [mutated ? 'bounded mutation review' : 'generation-0 provisional hypothesis'] }, timestamp: now, confidence: mutated ? 0.8 : 0.4, rationale: mutated ? 'Externally supplied fixture evaluation after criticism.' : 'Externally supplied fixture evaluation before mutation.' }
    },
  }
}

export const M4D_FIXTURE_TIMESTAMP = now
