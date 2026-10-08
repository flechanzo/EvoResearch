import { canonicalJson, contentHash, deterministicId } from '../domain/ids.ts'
import { parseCheckpoint, parseDomainEvent, ValidationError } from '../domain/validation.ts'
import { validateGeneration0Hypothesis, validateResearchGap } from '../milestone4a/validation.ts'
import { buildM4AArtifacts } from '../milestone4a/coordinator.ts'
import { buildM4BArtifacts } from '../milestone4b/coordinator.ts'
import { buildM4CArtifacts } from '../milestone4c/coordinator.ts'
import { createEvaluationRecord } from '../milestone4c/evaluator.ts'
import type { M4CArtifacts } from '../milestone4c/types.ts'
import type { Generation0Hypothesis, ResearchGap } from '../milestone4a/types.ts'
import type { M4BMutation } from '../milestone4b/types.ts'
import type { M4DLifecycleArtifacts, M4DExplainabilityProjection, M4DLifecycleInput, M4DMutationExplanation, M4DCriticismExplanation } from './types.ts'
import type { Claim, DomainEvent, Evidence, Hypothesis, ResearchProblemGraph, Checkpoint } from '../domain/types.ts'

function directEvidenceIds(evidence: readonly Evidence[]): Set<string> {
  return new Set(evidence.filter(item => item.provenance.sourceType !== 'model' && (item as Evidence & Record<string, unknown>).modelInterpretation !== true).map(item => item.evidenceId))
}

function claimsForEvidence(evidence: Evidence, claims: readonly Claim[]): string[] {
  const known = new Set(claims.map(claim => claim.claimId))
  return [...evidence.claimIds].filter(id => known.has(id)).sort()
}

function evidenceChain(hypothesis: Hypothesis, evidence: readonly Evidence[], claims: readonly Claim[]): M4DExplainabilityProjection['evidenceChain'] {
  const ids = new Set<string>([...hypothesis.evidenceFor, ...hypothesis.evidenceAgainst, ...hypothesis.resultEvidenceIds, ...(hypothesis as Hypothesis & Record<string, unknown>).sourceEvidenceIds as string[] ?? []])
  return evidence.filter(item => ids.has(item.evidenceId)).sort((a, b) => a.evidenceId.localeCompare(b.evidenceId)).map(item => ({ evidenceId: item.evidenceId, claimIds: claimsForEvidence(item, claims), claim: item.claim, polarity: item.polarity, sourceId: item.provenance.sourceId }))
}

function mutationExplanations(hypothesisId: string, mutations: readonly M4BMutation[]): M4DMutationExplanation[] {
  return mutations.filter(mutation => mutation.edge.childHypothesisId === hypothesisId).sort((a, b) => a.edge.mutationEdgeId.localeCompare(b.edge.mutationEdgeId)).map(mutation => ({ mutationEdgeId: mutation.edge.mutationEdgeId, parentHypothesisId: mutation.edge.parentHypothesisId, childHypothesisId: mutation.edge.childHypothesisId, criticReviewId: mutation.edge.criticReviewId, criticismIds: [...mutation.criticismIds].sort(), evidenceIds: [...mutation.edge.evidenceIds].sort(), mutationType: mutation.edge.mutationType, changedFields: [...mutation.edge.changedFields].sort(), reason: mutation.edge.reason }))
}

function criticismExplanations(hypothesisId: string, criticismIds: readonly string[], criticisms: readonly import('../domain/types.ts').Criticism[]): M4DCriticismExplanation[] {
  const selected = new Set(criticismIds)
  return criticisms.filter(criticism => selected.has(criticism.criticismId)).sort((a, b) => a.criticismId.localeCompare(b.criticismId)).map(criticism => ({ criticismId: criticism.criticismId, reviewId: criticism.reviewId, statement: criticism.statement, severity: criticism.severity, evidenceIds: [...criticism.evidenceIds].sort() }))
}

function paretoExplanation(hypothesisId: string, selection: M4CArtifacts['selection'], evaluationDimensions: Readonly<Record<string, unknown>>): M4DExplainabilityProjection['pareto'] {
  const state = selection.states.find(item => item.hypothesisId === hypothesisId)
  const reason = selection.dominanceReasons.find(item => item.hypothesisId === hypothesisId)
  const selected = selection.selectedHypothesisIds.includes(hypothesisId)
  return { state: state?.state ?? 'UNKNOWN', rationale: reason?.rationale ?? (selected ? 'Selected because no recorded hypothesis dominates this Pareto candidate.' : 'No Pareto selection reason was recorded.'), dominatedBy: reason?.dominatedBy ?? [], dimensions: evaluationDimensions }
}

export function renderM4DReport(projections: readonly M4DExplainabilityProjection[]): string {
  return [...projections].sort((a, b) => a.hypothesisId.localeCompare(b.hypothesisId)).map(projection => [
    `Hypothesis: ${projection.hypothesisId}`,
    `Originating problem: ${projection.originatingProblem.map(problem => `${problem.nodeId} (${problem.label})`).join('; ') || 'unresolved'}`,
    `Evidence chain: ${projection.evidenceChain.map(item => `${item.evidenceId} [${item.polarity}]`).join('; ') || 'none recorded'}`,
    `Mutations: ${projection.mutations.map(mutation => `${mutation.mutationEdgeId} ${mutation.mutationType} changed ${mutation.changedFields.join(', ')}`).join('; ') || 'generation-0 hypothesis'}`,
    `Criticisms survived: ${projection.criticismsSurvived.map(criticism => `${criticism.criticismId} (${criticism.severity})`).join('; ') || 'none recorded'}`,
    `Evaluation dimensions: ${canonicalJson(projection.evaluation.evaluationDimensions)}`,
    `Pareto reason: ${projection.pareto.rationale}`,
  ].join('\n')).join('\n\n')
}

function validateComposition(input: M4DLifecycleInput, m4a: Awaited<ReturnType<typeof buildM4AArtifacts>>, parent: Generation0Hypothesis, gap: ResearchGap): void {
  const problemNodeIds = new Set(input.m4a.problemGraph.nodes.map(node => node.nodeId))
  const claimIds = new Set((input.m4a.claims ?? []).map(claim => claim.claimId))
  const evidenceIds = new Set((input.m4a.evidence ?? []).map(item => item.evidenceId))
  const directIds = directEvidenceIds(input.m4a.evidence ?? [])
  validateResearchGap(gap, { problemNodeIds, claimIds, evidenceIds, directEvidenceIds: directIds })
  validateGeneration0Hypothesis(parent, { gaps: new Map([[gap.gapId, gap]]), problemNodeIds, claimIds, evidenceIds, directEvidenceIds: directIds, problemGraph: input.m4a.problemGraph })
  if (!m4a.generation0.hypotheses.some(hypothesis => hypothesis.hypothesisId === parent.hypothesisId)) throw new ValidationError('validated generation-0 hypothesis is missing from the M4A population', '$.generation0', 'INVALID_PROVENANCE')
}

function finalCheckpoint(runId: string, sequence: number, stateHash: string, populationIds: Checkpoint['populationIds'], budget: Checkpoint['budget'], createdAt: string): Checkpoint {
  return { checkpointId: deterministicId('checkpoint', { runId, sequence, stateHash }), runId: runId as never, sequence, stateHash, populationIds, budget, createdAt }
}

export async function runM4DLifecycle(input: M4DLifecycleInput): Promise<M4DLifecycleArtifacts> {
  const m4a = await buildM4AArtifacts(input.m4a)
  const gap = m4a.gapDiscovery.gaps.find(item => item.eligibility.eligible && item.coverageState !== 'COVERAGE_ONLY')
  const parent = m4a.generation0.hypotheses[0]
  if (!gap || !parent) throw new ValidationError('M4A fixture did not produce an eligible gap and generation-0 hypothesis', '$.m4a', 'INVALID_PROVENANCE')
  validateComposition(input, m4a, parent, gap)
  const evidence = input.m4a.evidence ?? []
  const review = input.reviewFor(parent, evidence)
  const criticism = input.criticismFor(parent, review, evidence)
  const m4b = buildM4BArtifacts({ runId: input.m4a.runId, hypotheses: m4a.generation0.hypotheses as never, reviews: [review], criticisms: [criticism], evidence, now: input.m4a.now, previousCheckpoint: m4a.checkpoint, budget: m4a.checkpoint.budget })
  const evaluations = m4b.evolution.hypotheses.map(hypothesis => {
    const request = input.evaluationFor(hypothesis, evidence)
    if (request.hypothesis.hypothesisId !== hypothesis.hypothesisId) throw new ValidationError('evaluation factory returned a different hypothesis', '$.evaluation.hypothesisId', 'INVALID_PROVENANCE')
    return createEvaluationRecord(request)
  })
  const m4c = buildM4CArtifacts({ runId: input.m4a.runId, hypotheses: m4b.evolution.hypotheses, evaluations, now: input.m4a.now, selectionLimit: input.selectionLimit, previousCheckpoint: m4b.checkpoint, budget: m4b.checkpoint.budget })
  const selected = new Set(m4c.selection.selectedHypothesisIds)
  const nodes = new Map(input.m4a.problemGraph.nodes.map(node => [node.nodeId as string, node]))
  const criticisms = [criticism]
  const projections: M4DExplainabilityProjection[] = m4c.selection.population.filter(hypothesis => selected.has(hypothesis.hypothesisId)).sort((a, b) => a.hypothesisId.localeCompare(b.hypothesisId)).map(hypothesis => {
    const evaluation = m4c.selection.evaluations.find(item => item.hypothesisId === hypothesis.hypothesisId)!
    return { hypothesisId: hypothesis.hypothesisId, originatingProblem: [...new Set(((hypothesis as Hypothesis & Record<string, unknown>).sourceProblemNodeIds as string[] ?? []))].map(id => nodes.get(id)).filter((node): node is NonNullable<typeof node> => Boolean(node)).sort((a, b) => a.nodeId.localeCompare(b.nodeId)).map(node => ({ nodeId: node.nodeId, label: node.label })), evidenceChain: evidenceChain(hypothesis, evidence, input.m4a.claims ?? []), mutations: mutationExplanations(hypothesis.hypothesisId, m4b.evolution.mutations), criticismsSurvived: criticismExplanations(hypothesis.hypothesisId, hypothesis.criticismIds, criticisms), evaluation, pareto: paretoExplanation(hypothesis.hypothesisId, m4c.selection, evaluation.evaluationDimensions) }
  })
  const report = renderM4DReport(projections)
  const genealogy = m4c.selection.population.map(hypothesis => ({ hypothesisId: hypothesis.hypothesisId, parentIds: [...hypothesis.parentIds].sort(), mutationEdgeIds: [...hypothesis.mutationEdgeIds].sort() })).sort((a, b) => a.hypothesisId.localeCompare(b.hypothesisId))
  const stateHash = contentHash(canonicalJson({ schemaVersion: 'm4d.lifecycle.v1', runId: input.m4a.runId, gap, generation0: m4a.generation0, mutation: m4b.evolution, selection: m4c.selection, genealogy, projections, report }))
  const frontierEvent: DomainEvent = { eventId: deterministicId('event', { runId: input.m4a.runId, sequence: m4c.checkpoint.sequence, type: 'frontier.selected', frontierHypothesisIds: m4c.selection.frontierHypothesisIds }), runId: input.m4a.runId, sequence: m4c.checkpoint.sequence, type: 'frontier.selected', occurredAt: input.m4a.now, payload: { stage: 'M4D_LIFECYCLE_AUDIT', frontierHypothesisIds: m4c.selection.frontierHypothesisIds, selectedHypothesisIds: m4c.selection.selectedHypothesisIds, evaluationIds: m4c.selection.evaluations.map(evaluation => evaluation.evaluationId) } }
  const finalSequence = m4c.checkpoint.sequence + 1
  const checkpoint = finalCheckpoint(input.m4a.runId, finalSequence, stateHash, m4c.checkpoint.populationIds, m4c.checkpoint.budget, input.m4a.now)
  const events: DomainEvent[] = [...m4a.events, ...m4b.events, frontierEvent]
  const finalEvent: DomainEvent = { eventId: deterministicId('event', { runId: input.m4a.runId, sequence: finalSequence, type: 'checkpoint.created', checkpointId: checkpoint.checkpointId }), runId: input.m4a.runId, sequence: finalSequence, type: 'checkpoint.created', occurredAt: input.m4a.now, payload: { stage: 'M4D_LIFECYCLE_AUDIT', checkpointId: checkpoint.checkpointId, populationIds: checkpoint.populationIds, frontierHypothesisIds: m4c.selection.frontierHypothesisIds, selectedHypothesisIds: m4c.selection.selectedHypothesisIds, reportHash: contentHash(report) } }
  events.push(finalEvent)
  events.forEach(event => parseDomainEvent(event))
  const hypothesesById = new Map(m4b.evolution.hypotheses.map(hypothesis => [hypothesis.hypothesisId, hypothesis]))
  const mutationLineagePreserved = m4b.evolution.mutations.every(mutation => {
    const parent = hypothesesById.get(mutation.edge.parentHypothesisId)
    const child = hypothesesById.get(mutation.edge.childHypothesisId)
    return Boolean(parent && child && child.parentIds.length === 1 && child.parentIds[0] === parent.hypothesisId && child.generation === parent.generation + 1 && child.mutationEdgeIds.includes(mutation.edge.mutationEdgeId as never))
  })
  const mutationCausalityPreserved = m4b.evolution.mutations.every(mutation => mutation.criticismIds.length > 0 && JSON.stringify([...mutation.criticismIds].sort()) === JSON.stringify([...mutation.edge.criticismIds].sort()) && mutation.edge.evidenceIds.length > 0 && mutation.edge.criticReviewId.length > 0 && mutation.edge.changedFields.length > 0 && mutation.edge.reason.length > 0)
  const audit = { gapProvenanceValidated: true, generation0ProvenanceValidated: true, mutationLineagePreserved, mutationCausalityPreserved, evaluationCoverageComplete: m4c.selection.evaluations.length === m4c.selection.population.length, frontierDeterministic: m4c.selection.frontierHypothesisIds.every(id => !m4c.selection.dominatedHypothesisIds.includes(id)), populationPreserved: m4c.selection.population.length === m4b.evolution.hypotheses.length }
  return { schemaVersion: 'm4d.lifecycle.v1', runId: input.m4a.runId, generatedAt: input.m4a.now, validatedGap: gap, generation0: m4a.generation0.hypotheses, mutation: m4b, evaluation: m4c, finalFrontierHypothesisIds: m4c.selection.frontierHypothesisIds, genealogy, explainability: projections, report, events, checkpoint, audit }
}

/** Parse a persisted checkpoint without permitting callers to alter its durable identity. */
export function restoreM4DCheckpoint(checkpoint: Checkpoint): Checkpoint {
  return parseCheckpoint(checkpoint)
}

/** Deterministically replay a lifecycle from its persisted final checkpoint. */
export async function replayM4DLifecycle(input: M4DLifecycleInput, checkpoint: Checkpoint): Promise<M4DLifecycleArtifacts> {
  const restored = restoreM4DCheckpoint(checkpoint)
  if (restored.runId !== input.m4a.runId) throw new ValidationError('checkpoint runId must match the lifecycle run', '$.checkpoint.runId', 'INVALID_CHECKPOINT')
  const replayed = await runM4DLifecycle(input)
  if (replayed.checkpoint.checkpointId !== restored.checkpointId || replayed.checkpoint.stateHash !== restored.stateHash) throw new ValidationError('replayed lifecycle does not match the restored checkpoint', '$.checkpoint', 'CHECKPOINT_MISMATCH')
  return replayed
}

export const buildM4DArtifacts = runM4DLifecycle
