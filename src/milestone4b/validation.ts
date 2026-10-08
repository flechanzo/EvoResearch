import { parseCriticism, parseEvidence, parseHypothesis, parseMutationEdge, parseReview, ValidationError } from '../domain/validation.ts'
import type { Criticism, Evidence, Hypothesis, MutationEdge, Review } from '../domain/types.ts'
import type { EvolvableHypothesis, M4BMutationEdge, MutationProposal } from './types.ts'

const MUTABLE_HYPOTHESIS_FIELDS = new Set(['statement', 'motivation', 'method', 'assumptions', 'evidenceFor', 'evidenceAgainst'])

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ValidationError('expected object', path, 'INVALID_M4B_RECORD')
  return value as Record<string, unknown>
}

function string(value: unknown, path: string): asserts value is string {
  if (typeof value !== 'string' || !value.trim()) throw new ValidationError('expected non-empty string', path, 'INVALID_M4B_RECORD')
}

function strings(value: unknown, path: string, nonEmpty = false): asserts value is readonly string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || !item.trim())) throw new ValidationError('expected string array', path, 'INVALID_M4B_RECORD')
  if (nonEmpty && value.length === 0) throw new ValidationError('array cannot be empty', path, 'INVALID_M4B_PROVENANCE')
}

function unique(values: readonly string[], path: string): void {
  if (new Set(values).size !== values.length) throw new ValidationError('IDs must be unique', path, 'DUPLICATE_ID')
}

function refs(values: readonly string[], known: ReadonlySet<string>, path: string): void {
  values.forEach((value, index) => { if (!known.has(value)) throw new ValidationError('reference does not resolve to an accepted record', `${path}[${index}]`, 'INVALID_PROVENANCE') })
}

function directEvidence(item: Evidence & Record<string, unknown>): boolean {
  return item.modelInterpretation !== true && item.evidenceLevel !== 'MODEL_INTERPRETATION' && item.provenance.sourceType !== 'model'
}

export interface EvolutionValidationContext {
  readonly hypotheses: ReadonlyMap<string, EvolvableHypothesis>
  readonly reviews: ReadonlyMap<string, Review>
  readonly criticisms: ReadonlyMap<string, Criticism>
  readonly evidence: ReadonlyMap<string, Evidence & Record<string, unknown>>
  readonly directEvidenceIds: ReadonlySet<string>
}

export function validateM4AParent(parent: unknown, context: Pick<EvolutionValidationContext, 'evidence' | 'directEvidenceIds'>): EvolvableHypothesis {
  const value = record(parent, '$') as unknown as EvolvableHypothesis
  const knownEvidenceIds = new Set(context.evidence.keys())
  parseHypothesis(value, context.directEvidenceIds)
  for (const field of ['originatingGapIds', 'sourceProblemNodeIds', 'sourceClaimIds', 'sourceEvidenceIds'] as const) strings(value[field], `$.${field}`)
  strings(value.originatingGapIds, '$.originatingGapIds', true)
  refs(value.sourceEvidenceIds, knownEvidenceIds, '$.sourceEvidenceIds')
  refs(value.sourceEvidenceIds, context.directEvidenceIds, '$.sourceEvidenceIds')
  if (value.sourceEvidenceIds.some(id => !context.directEvidenceIds.has(id))) throw new ValidationError('M4A source evidence must remain direct evidence', '$.sourceEvidenceIds', 'INVALID_PROVENANCE')
  return value
}

export function validateEvolutionInputs(input: {
  readonly hypotheses: readonly EvolvableHypothesis[]
  readonly reviews: readonly Review[]
  readonly criticisms: readonly Criticism[]
  readonly evidence: readonly (Evidence & Record<string, unknown>)[]
}): EvolutionValidationContext {
  const evidence = new Map<string, Evidence & Record<string, unknown>>()
  for (const [index, item] of input.evidence.entries()) {
    record(item, `$.evidence[${index}]`)
    string(item.evidenceId, `$.evidence[${index}].evidenceId`)
    parseEvidence(item)
    if (evidence.has(item.evidenceId)) throw new ValidationError('duplicate evidence ID', `$.evidence[${index}].evidenceId`, 'DUPLICATE_ID')
    evidence.set(item.evidenceId, item)
  }
  const directEvidenceIds = new Set([...evidence.values()].filter(directEvidence).map(item => item.evidenceId))
  const hypotheses = new Map<string, EvolvableHypothesis>()
  for (const [index, parent] of input.hypotheses.entries()) {
    const value = validateM4AParent(parent, { evidence, directEvidenceIds })
    if (hypotheses.has(value.hypothesisId)) throw new ValidationError('duplicate hypothesis ID', `$.hypotheses[${index}].hypothesisId`, 'DUPLICATE_ID')
    hypotheses.set(value.hypothesisId, value)
  }
  const reviews = new Map<string, Review>()
  for (const [index, review] of input.reviews.entries()) {
    const value = parseReview(review, directEvidenceIds)
    unique(value.criticismIds, `$.reviews[${index}].criticismIds`)
    if (!hypotheses.has(value.hypothesisId)) throw new ValidationError('review must reference an existing parent hypothesis', `$.reviews[${index}].hypothesisId`, 'INVALID_MUTATION_PARENT')
    if (reviews.has(value.reviewId)) throw new ValidationError('duplicate review ID', `$.reviews[${index}].reviewId`, 'DUPLICATE_ID')
    reviews.set(value.reviewId, value)
  }
  const criticisms = new Map<string, Criticism>()
  for (const [index, criticism] of input.criticisms.entries()) {
    const value = parseCriticism(criticism, directEvidenceIds)
    if (!hypotheses.has(value.hypothesisId)) throw new ValidationError('criticism must reference an existing parent hypothesis', `$.criticisms[${index}].hypothesisId`, 'INVALID_MUTATION_PARENT')
    if (value.reviewId !== undefined && !reviews.has(value.reviewId)) throw new ValidationError('criticism reviewId must reference an existing review', `$.criticisms[${index}].reviewId`, 'INVALID_PROVENANCE')
    if (criticisms.has(value.criticismId)) throw new ValidationError('duplicate criticism ID', `$.criticisms[${index}].criticismId`, 'DUPLICATE_ID')
    criticisms.set(value.criticismId, value)
  }
  for (const review of reviews.values()) {
    for (const criticismId of review.criticismIds) {
      const criticism = criticisms.get(criticismId)
      if (!criticism) throw new ValidationError('review criticismIds must resolve to criticism records', '$.reviews.criticismIds', 'INVALID_PROVENANCE')
      if (criticism.hypothesisId !== review.hypothesisId || criticism.reviewId !== review.reviewId) throw new ValidationError('review and criticism must reference the same hypothesis and review', '$.reviews.criticismIds', 'INVALID_PROVENANCE')
    }
  }
  return { hypotheses, reviews, criticisms, evidence, directEvidenceIds }
}

export function validateMutationProposal(value: unknown, context: EvolutionValidationContext): MutationProposal {
  const proposal = record(value, '$') as unknown as MutationProposal
  string(proposal.parentHypothesisId, '$.parentHypothesisId'); string(proposal.criticReviewId, '$.criticReviewId'); strings(proposal.criticismIds, '$.criticismIds', true); strings(proposal.evidenceIds, '$.evidenceIds', true); strings(proposal.changedFields, '$.changedFields', true); string(proposal.reason, '$.reason')
  unique(proposal.criticismIds, '$.criticismIds'); unique(proposal.evidenceIds, '$.evidenceIds'); unique(proposal.changedFields, '$.changedFields')
  if (proposal.changedFields.some(field => !MUTABLE_HYPOTHESIS_FIELDS.has(field))) throw new ValidationError('mutation changedFields must name mutable hypothesis components', '$.changedFields', 'INVALID_MUTATION_CHANGE')
  if (!context.hypotheses.has(proposal.parentHypothesisId)) throw new ValidationError('mutation parent hypothesis does not exist', '$.parentHypothesisId', 'INVALID_MUTATION_PARENT')
  const review = context.reviews.get(proposal.criticReviewId)
  if (!review) throw new ValidationError('mutation must reference an existing review', '$.criticReviewId', 'INVALID_PROVENANCE')
  if (review.hypothesisId !== proposal.parentHypothesisId) throw new ValidationError('review does not criticize the mutation parent', '$.criticReviewId', 'INVALID_MUTATION_PARENT')
  const criticismIds = new Set<string>(review.criticismIds)
  for (const criticismId of proposal.criticismIds) {
    const criticism = context.criticisms.get(criticismId)
    if (!criticism || !criticismIds.has(criticismId) || criticism.hypothesisId !== proposal.parentHypothesisId || criticism.reviewId !== review.reviewId) throw new ValidationError('mutation criticism must be linked to its parent review and hypothesis', '$.criticismIds', 'INVALID_PROVENANCE')
  }
  const reviewEvidence = new Set<string>([...review.evidenceIds, ...proposal.criticismIds.flatMap(id => context.criticisms.get(id)?.evidenceIds ?? [])])
  refs(proposal.evidenceIds, context.directEvidenceIds, '$.evidenceIds')
  for (const evidenceId of proposal.evidenceIds) if (!reviewEvidence.has(evidenceId)) throw new ValidationError('mutation evidence must be present on the selected review or criticism', '$.evidenceIds', 'INVALID_PROVENANCE')
  parseMutationEdge({ mutationEdgeId: 'mutation_validation_placeholder', parentHypothesisId: proposal.parentHypothesisId, childHypothesisId: 'hypothesis_validation_placeholder', mutationType: proposal.mutationType, reason: proposal.reason, criticReviewId: proposal.criticReviewId, evidenceIds: proposal.evidenceIds, changedFields: proposal.changedFields, timestamp: '2026-01-01T00:00:00.000Z' })
  return proposal
}

export function validateMutationEdgeStrict(edge: M4BMutationEdge, criticismIds: readonly string[], context: EvolutionValidationContext): M4BMutationEdge {
  parseMutationEdge(edge, new Set([...context.hypotheses.keys(), edge.childHypothesisId]))
  if (!edge.evidenceIds.length) throw new ValidationError('mutation edge must reference at least one evidence ID', '$.evidenceIds', 'INVALID_PROVENANCE')
  strings(edge.criticismIds, '$.criticismIds', true)
  unique(edge.criticismIds, '$.criticismIds')
  unique(criticismIds, '$.criticismIds')
  unique(edge.changedFields, '$.changedFields')
  if (JSON.stringify([...edge.criticismIds].sort()) !== JSON.stringify([...criticismIds].sort())) throw new ValidationError('mutation edge criticism IDs must match its mutation record', '$.criticismIds', 'INVALID_PROVENANCE')
  refs(edge.evidenceIds, context.directEvidenceIds, '$.evidenceIds')
  const review = context.reviews.get(edge.criticReviewId)
  if (!review) throw new ValidationError('mutation edge must reference an existing review', '$.criticReviewId', 'INVALID_PROVENANCE')
  if (review.hypothesisId !== edge.parentHypothesisId) throw new ValidationError('mutation edge review must target its parent hypothesis', '$.criticReviewId', 'INVALID_MUTATION_PARENT')
  if (!criticismIds.length || criticismIds.some(id => !(review.criticismIds as readonly string[]).includes(id))) throw new ValidationError('mutation must retain at least one linked criticism', '$.criticismIds', 'INVALID_PROVENANCE')
  const linkedEvidence = new Set<string>(review.evidenceIds)
  for (const criticismId of criticismIds) {
    const criticism = context.criticisms.get(criticismId)
    if (!criticism || criticism.hypothesisId !== edge.parentHypothesisId || criticism.reviewId !== review.reviewId) throw new ValidationError('mutation criticism must resolve to the selected review and parent hypothesis', '$.criticismIds', 'INVALID_PROVENANCE')
    criticism.evidenceIds.forEach(evidenceId => linkedEvidence.add(evidenceId))
  }
  if (edge.evidenceIds.some(evidenceId => !linkedEvidence.has(evidenceId))) throw new ValidationError('mutation edge evidence must be present on the selected review or criticism', '$.evidenceIds', 'INVALID_PROVENANCE')
  return edge
}

export function validateMutationChild(child: EvolvableHypothesis, parent: EvolvableHypothesis, edge: MutationEdge, criticismIds: readonly string[], context: EvolutionValidationContext): EvolvableHypothesis {
  validateM4AParent(child, { evidence: context.evidence, directEvidenceIds: context.directEvidenceIds })
  if (child.generation !== parent.generation + 1) throw new ValidationError('mutation child generation must be parent generation plus one', '$.generation', 'INVALID_GENERATION')
  if (child.status !== 'mutated') throw new ValidationError('mutation child must have mutated status', '$.status', 'INVALID_GENERATION_STATUS')
  if (child.reevaluationRequired !== true) throw new ValidationError('mutation child must explicitly require reevaluation', '$.reevaluationRequired', 'INVALID_REEVALUATION_STATE')
  if (child.parentIds.length !== 1 || child.parentIds[0] !== parent.hypothesisId) throw new ValidationError('mutation child must reference exactly its immediate parent', '$.parentIds', 'INVALID_MUTATION_PARENT')
  if (!child.mutationEdgeIds.includes(edge.mutationEdgeId)) throw new ValidationError('mutation child must reference its immutable mutation edge', '$.mutationEdgeIds', 'INVALID_PROVENANCE')
  if (criticismIds.some(id => !(child.criticismIds as readonly string[]).includes(id))) throw new ValidationError('mutation child must retain its linked criticism IDs', '$.criticismIds', 'INVALID_PROVENANCE')
  for (const field of edge.changedFields) {
    if (!MUTABLE_HYPOTHESIS_FIELDS.has(field)) throw new ValidationError('mutation changedFields must name mutable hypothesis components', '$.changedFields', 'INVALID_MUTATION_CHANGE')
    const parentValue = (parent as Record<string, unknown>)[field]
    const childValue = (child as Record<string, unknown>)[field]
    if (JSON.stringify(parentValue) === JSON.stringify(childValue)) throw new ValidationError('mutation changedFields must describe an actual child change', `$.changedFields.${field}`, 'INVALID_MUTATION_CHANGE')
  }
  for (const field of ['originatingGapIds', 'sourceProblemNodeIds', 'sourceClaimIds', 'sourceEvidenceIds'] as const) if (JSON.stringify(child[field]) !== JSON.stringify(parent[field])) throw new ValidationError(`M4A ${field} provenance must be preserved on mutation`, `$.${field}`, 'INVALID_PROVENANCE')
  if (edge.parentHypothesisId !== parent.hypothesisId || edge.childHypothesisId !== child.hypothesisId) throw new ValidationError('mutation edge must point to the immutable parent and materialized child', '$', 'INVALID_MUTATION_PARENT')
  return child
}

