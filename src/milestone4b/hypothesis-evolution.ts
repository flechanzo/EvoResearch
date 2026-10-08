import { deterministicId } from '../domain/ids.ts'
import type { Criticism, Evidence, MutationEdge, MutationType, Review } from '../domain/types.ts'
import { ValidationError } from '../domain/validation.ts'
import type { EvolvableHypothesis, HypothesisEvolutionInput, HypothesisEvolutionOptions, HypothesisEvolutionResult, M4BMutation, M4BMutationEdge, MutationProposal } from './types.ts'
import { validateEvolutionInputs, validateMutationProposal, validateMutationChild, validateMutationEdgeStrict } from './validation.ts'

function sorted(values: Iterable<string>): string[] { return [...new Set([...values].filter(Boolean))].sort((a, b) => a.localeCompare(b)) }
function text(value: unknown): string { return typeof value === 'string' ? value.trim() : '' }
function severityRank(value: Criticism['severity']): number { return value === 'fatal' ? 4 : value === 'high' ? 3 : value === 'medium' ? 2 : 1 }
function operatorForCriticism(criticisms: readonly Criticism[]): MutationType {
  const highest = [...criticisms].sort((a, b) => severityRank(b.severity) - severityRank(a.severity) || a.criticismId.localeCompare(b.criticismId))[0]
  return highest && severityRank(highest.severity) >= 3 ? 'ADDRESS_COUNTEREXAMPLE' : highest && highest.severity === 'medium' ? 'NARROW_SCOPE' : 'ADD_CONSTRAINT'
}

function proposalSignature(proposal: MutationProposal): string {
  return JSON.stringify({ parentHypothesisId: proposal.parentHypothesisId, criticReviewId: proposal.criticReviewId, criticismIds: sorted(proposal.criticismIds), mutationType: proposal.mutationType, reason: text(proposal.reason), evidenceIds: sorted(proposal.evidenceIds), changedFields: sorted(proposal.changedFields), statement: text(proposal.statement), motivation: text(proposal.motivation), method: text(proposal.method), assumptions: proposal.assumptions ?? [], evidenceFor: proposal.evidenceFor ?? [], evidenceAgainst: proposal.evidenceAgainst ?? [] })
}

function deriveProposals(input: HypothesisEvolutionInput, context: ReturnType<typeof validateEvolutionInputs>): MutationProposal[] {
  const proposals: MutationProposal[] = []
  for (const review of [...context.reviews.values()].sort((a, b) => a.reviewId.localeCompare(b.reviewId))) {
    const criticismIds = sorted(review.criticismIds.filter(id => {
      const criticism = context.criticisms.get(id)
      return criticism?.hypothesisId === review.hypothesisId && criticism.reviewId === review.reviewId
    }))
    if (!criticismIds.length) continue
    const criticisms = criticismIds.map(id => context.criticisms.get(id)).filter((value): value is Criticism => Boolean(value))
    const evidenceIds = sorted([...review.evidenceIds, ...criticisms.flatMap(criticism => criticism.evidenceIds)])
    if (!evidenceIds.length) continue
    const reason = `Address review ${review.reviewId}: ${text(review.summary)}${criticisms.length ? ` Criticisms: ${criticisms.map(criticism => text(criticism.statement)).join(' | ')}` : ''}`
    proposals.push({ parentHypothesisId: review.hypothesisId, criticReviewId: review.reviewId, criticismIds, mutationType: operatorForCriticism(criticisms), reason, evidenceIds, changedFields: ['statement', 'method'] })
  }
  return proposals.sort((a, b) => proposalSignature(a).localeCompare(proposalSignature(b)))
}

function mutate(parent: EvolvableHypothesis, proposal: MutationProposal, now: string): { child: EvolvableHypothesis; edge: M4BMutationEdge } {
  const normalizedEvidence = sorted(proposal.evidenceIds)
  const normalizedCriticismIds = sorted(proposal.criticismIds)
  const changedFields = sorted(proposal.changedFields)
  const patchText = `[${proposal.mutationType}] ${text(proposal.reason)}`
  const statement = proposal.statement?.trim() || (changedFields.includes('statement') ? `${parent.statement} ${patchText}` : parent.statement)
  const motivation = proposal.motivation?.trim() || (changedFields.includes('motivation') ? `${parent.motivation} Mutation retained because it addresses ${proposal.criticReviewId}.` : parent.motivation)
  const method = proposal.method?.trim() || (changedFields.includes('method') ? `${parent.method} Apply a bounded change to address: ${text(proposal.reason)}` : parent.method)
  const assumptions = proposal.assumptions ? [...proposal.assumptions] : [...parent.assumptions]
  const evidenceFor = sorted(proposal.evidenceFor ?? parent.evidenceFor)
  const evidenceAgainst = sorted(proposal.evidenceAgainst ?? parent.evidenceAgainst)
  const childSignature = { parentHypothesisId: parent.hypothesisId, criticReviewId: proposal.criticReviewId, criticismIds: normalizedCriticismIds, mutationType: proposal.mutationType, reason: text(proposal.reason), evidenceIds: normalizedEvidence, changedFields, statement, motivation, method, assumptions, evidenceFor, evidenceAgainst }
  const childHypothesisId = deterministicId('hypothesis', { generation: parent.generation + 1, mutation: childSignature }) as never
  const mutationEdgeId = deterministicId('mutation', { parentHypothesisId: parent.hypothesisId, childHypothesisId, criticReviewId: proposal.criticReviewId, criticismIds: normalizedCriticismIds, mutationType: proposal.mutationType, evidenceIds: normalizedEvidence, changedFields }) as never
  const { dimensions: _parentDimensions, noveltyEvidence: _parentNoveltyEvidence, noveltyEstimate: _parentNoveltyEstimate, experimentIds: _parentExperimentIds, resultEvidenceIds: _parentResultEvidenceIds, ...genealogy } = parent
  const child: EvolvableHypothesis = {
    ...genealogy,
    hypothesisId: childHypothesisId,
    generation: parent.generation + 1,
    parentIds: [parent.hypothesisId],
    statement,
    motivation,
    method,
    assumptions,
    evidenceFor: evidenceFor as never,
    evidenceAgainst: evidenceAgainst as never,
    dimensions: {},
    experimentIds: [],
    resultEvidenceIds: [],
    criticismIds: sorted([...parent.criticismIds, ...normalizedCriticismIds]) as never,
    mutationEdgeIds: [mutationEdgeId] as never,
    status: 'mutated',
    reevaluationRequired: true,
    createdAt: now,
    updatedAt: now,
  }
  const edge: M4BMutationEdge = { mutationEdgeId, parentHypothesisId: parent.hypothesisId, childHypothesisId, mutationType: proposal.mutationType, reason: text(proposal.reason), criticReviewId: proposal.criticReviewId as never, criticismIds: normalizedCriticismIds, evidenceIds: normalizedEvidence as never, changedFields, timestamp: now }
  return { child, edge }
}

export function evolveHypotheses(input: HypothesisEvolutionInput, options: HypothesisEvolutionOptions = {}): HypothesisEvolutionResult {
  const context = validateEvolutionInputs(input)
  const proposals = (input.mutationProposals ? [...input.mutationProposals] : deriveProposals(input, context)).sort((a, b) => proposalSignature(a).localeCompare(proposalSignature(b)))
  const configuredRemaining = input.budget ? input.budget.limits.maxMutations - input.budget.usage.maxMutations : proposals.length
  if (configuredRemaining < 0) throw new ValidationError('mutation budget usage exceeds its limit', '$.budget.usage.maxMutations', 'BUDGET_EXCEEDED')
  const budget = Math.max(0, Math.min(Math.floor(options.mutationBudget ?? configuredRemaining), configuredRemaining))
  const rejected: { parentHypothesisId?: string; criticReviewId?: string; criticismIds: readonly string[]; reason: string }[] = []
  const existing = [...(input.existingMutations ?? [])].sort((a, b) => a.edge.mutationEdgeId.localeCompare(b.edge.mutationEdgeId))
  const seenEdges = new Set<string>()
  for (const mutation of existing) {
    if (seenEdges.has(mutation.edge.mutationEdgeId)) throw new ValidationError('duplicate mutation edge ID', '$.existingMutations', 'DUPLICATE_ID')
    const parent = context.hypotheses.get(mutation.edge.parentHypothesisId)
    if (!parent) throw new ValidationError('existing mutation parent hypothesis does not exist', '$.existingMutations', 'INVALID_MUTATION_PARENT')
    const child = context.hypotheses.get(mutation.edge.childHypothesisId)
    if (!child) throw new ValidationError('existing mutation child hypothesis does not exist', '$.existingMutations', 'INVALID_MUTATION_PARENT')
    validateMutationEdgeStrict(mutation.edge, mutation.criticismIds, context)
    validateMutationChild(child, parent, mutation.edge, mutation.criticismIds, context)
    seenEdges.add(mutation.edge.mutationEdgeId)
  }
  const accepted: M4BMutation[] = [...existing]
  const fresh: M4BMutation[] = []
  const children: EvolvableHypothesis[] = []
  const seenChildren = new Set<string>()
  for (const hypothesis of context.hypotheses.values()) seenChildren.add(hypothesis.hypothesisId)
  for (const proposal of proposals.slice(0, budget)) {
    const validated = validateMutationProposal(proposal, context)
    const parent = context.hypotheses.get(validated.parentHypothesisId)
    if (!parent) throw new ValidationError('mutation parent hypothesis does not exist', '$.parentHypothesisId', 'INVALID_MUTATION_PARENT')
    const { child, edge } = mutate(parent, validated, input.now)
    if (seenChildren.has(child.hypothesisId)) continue
    validateMutationEdgeStrict(edge, validated.criticismIds, context)
    validateMutationChild(child, parent, edge, validated.criticismIds, context)
    seenChildren.add(child.hypothesisId)
    const mutation = { edge, criticismIds: sorted(validated.criticismIds) }
    accepted.push(mutation)
    fresh.push(mutation)
    children.push(child)
  }
  const parents = [...context.hypotheses.values()].sort((a, b) => a.hypothesisId.localeCompare(b.hypothesisId))
  const hypotheses = [...parents, ...children].sort((a, b) => a.hypothesisId.localeCompare(b.hypothesisId))
  const mutationEdges = accepted.map(mutation => mutation.edge).sort((a, b) => a.mutationEdgeId.localeCompare(b.mutationEdgeId))
  const allChildren = hypotheses.filter(hypothesis => hypothesis.parentIds.length > 0).sort((a, b) => a.hypothesisId.localeCompare(b.hypothesisId))
  const newMutationEdges = fresh.map(mutation => mutation.edge).sort((a, b) => a.mutationEdgeId.localeCompare(b.mutationEdgeId))
  return {
    schemaVersion: 'm4b.hypothesis-evolution.v1', generatedAt: input.now, generation: hypotheses.length ? Math.max(...hypotheses.map(hypothesis => hypothesis.generation)) : 0, hypotheses, children: allChildren, mutations: accepted.sort((a, b) => a.edge.mutationEdgeId.localeCompare(b.edge.mutationEdgeId)), mutationEdges, newMutations: fresh.sort((a, b) => a.edge.mutationEdgeId.localeCompare(b.edge.mutationEdgeId)), newMutationEdges, rejected, provenance: accepted.map(mutation => ({ childHypothesisId: mutation.edge.childHypothesisId, parentHypothesisId: mutation.edge.parentHypothesisId, criticReviewId: mutation.edge.criticReviewId, criticismIds: mutation.criticismIds, evidenceIds: mutation.edge.evidenceIds, mutationEdgeId: mutation.edge.mutationEdgeId })).sort((a, b) => a.childHypothesisId.localeCompare(b.childHypothesisId)),
  }
}

export const generateMutations = evolveHypotheses
export const runHypothesisEvolution = evolveHypotheses

