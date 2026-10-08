import { canonicalJson, deterministicId } from '../domain/ids.ts'
import type { Claim, Evidence, ResearchGraphEdge, ResearchGraphNode, ResearchProblemGraph } from '../domain/types.ts'
import type { GapDiscoveryInput, M4ACompleteness, ResearchGap } from '../milestone4a/types.ts'
import { ValidationError } from '../domain/validation.ts'

/** Deterministic bounds for model-visible M4A context. */
export interface M5AProjectionLimits {
  readonly maxProblemNodes?: number
  readonly maxEdges?: number
  readonly maxClaims?: number
  readonly maxEvidence?: number
  readonly maxEvidenceLinks?: number
  readonly maxGaps?: number
  readonly maxCharacters?: number
}

export interface M5AOmittedCounts {
  readonly problemNodes: number
  readonly edges: number
  readonly claims: number
  readonly evidence: number
  readonly evidenceLinks: number
  readonly gaps: number
  readonly explicitLimitations?: number
  readonly explicitOpenQuestions?: number
  readonly explicitAssumptions?: number
  readonly explicitFailureCases?: number
  readonly completenessDetails?: number
}

export interface M5AProjectionTruncation {
  readonly truncated: boolean
  readonly reasons: readonly string[]
  readonly maxCharacters?: number
  readonly estimatedCharacters: number
}

export interface M5AScientificInputProjection {
  readonly schemaVersion: 'm5a.input-projection.v1'
  readonly projectionId: string
  readonly includedProblemNodeIds: readonly string[]
  readonly includedClaimIds: readonly string[]
  readonly includedEvidenceIds: readonly string[]
  readonly includedGapIds: readonly string[]
  readonly omittedCounts: M5AOmittedCounts
  readonly truncation: M5AProjectionTruncation
  readonly limitations: readonly string[]
  readonly problemGraph: {
    readonly problems: ResearchProblemGraph['problems']
    readonly nodes: readonly ResearchGraphNode[]
    readonly edges: readonly ResearchGraphEdge[]
  }
  readonly claims: readonly Claim[]
  readonly evidence: readonly (Evidence & Record<string, unknown>)[]
  readonly evidenceLinks: readonly Record<string, unknown>[]
  readonly gaps: readonly ResearchGap[]
  readonly completeness: M4ACompleteness
  readonly explicitLimitations: readonly string[]
  readonly explicitOpenQuestions: readonly string[]
  readonly explicitAssumptions: readonly string[]
  readonly explicitFailureCases: readonly string[]
}

function asLimit(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback
  if (!Number.isFinite(value)) return fallback
  return Math.max(0, Math.floor(value))
}

function sortedById<T, K extends keyof T>(values: readonly T[], key: K): T[] {
  return [...values].sort((a, b) => String(a[key]).localeCompare(String(b[key])))
}

function evidenceFromInput(input: GapDiscoveryInput): readonly (Evidence & Record<string, unknown>)[] {
  return (input.evidenceGraph?.evidence ?? input.evidence ?? []) as readonly (Evidence & Record<string, unknown>)[]
}

function claimsFromInput(input: GapDiscoveryInput): readonly Claim[] {
  return input.evidenceGraph?.claims ?? input.claims ?? []
}

function linksFromInput(input: GapDiscoveryInput): readonly Record<string, unknown>[] {
  return (input.evidenceGraph?.links ?? []) as readonly Record<string, unknown>[]
}

function boundedCompleteness(value: M4ACompleteness): M4ACompleteness {
  const copy: Record<string, unknown> = { ...(value as Record<string, unknown>) }
  for (const key of ['deferredOperations', 'failedOperations', 'limitations', 'reasons']) {
    const item = copy[key]
    if (Array.isArray(item)) copy[key] = item.slice(0, 16).map(value => typeof value === 'string' ? value.slice(0, 512) : value)
  }
  return copy as M4ACompleteness
}

function referencesForNodes(nodes: readonly ResearchGraphNode[], edges: readonly ResearchGraphEdge[]): Set<string> {
  const ids = new Set<string>()
  nodes.forEach(node => node.evidenceIds.forEach(id => ids.add(id)))
  edges.forEach(edge => edge.evidenceIds.forEach(id => ids.add(id)))
  return ids
}

function projectWithLimits(input: GapDiscoveryInput, gaps: readonly ResearchGap[], limits: Required<M5AProjectionLimits>): {
  nodes: ResearchGraphNode[]
  edges: ResearchGraphEdge[]
  claims: Claim[]
  evidence: (Evidence & Record<string, unknown>)[]
  links: Record<string, unknown>[]
  selectedGaps: ResearchGap[]
  omitted: M5AOmittedCounts
  limitations: string[]
} {
  const allNodes = sortedById(input.problemGraph.nodes, 'nodeId')
  const nodes = allNodes.slice(0, limits.maxProblemNodes)
  const nodeIds = new Set(nodes.map(node => node.nodeId))
  const allEdges = sortedById(input.problemGraph.edges, 'edgeId')
  const eligibleEdges = allEdges.filter(edge => nodeIds.has(edge.from as never) && nodeIds.has(edge.to as never))
  const edges = eligibleEdges.slice(0, limits.maxEdges)
  const allGaps = [...gaps].sort((a, b) => a.gapId.localeCompare(b.gapId))
  const candidateGaps = allGaps.slice(0, limits.maxGaps)

  const allEvidence = sortedById(evidenceFromInput(input), 'evidenceId')
  const referencedEvidenceIds = referencesForNodes(nodes, edges)
  candidateGaps.forEach(gap => [...gap.sourceEvidenceIds, ...gap.interpretationEvidenceIds, ...gap.supportingEvidenceIds, ...gap.contradictingEvidenceIds].forEach(id => referencedEvidenceIds.add(id)))
  const coverageEvidence = allEvidence.filter(item => item.evidenceLevel === 'ABSTRACT_EVIDENCE' || item.evidenceLevel === 'MODEL_INTERPRETATION' || item.modelInterpretation === true || item.limitations.some(limit => /abstract|full[- ]text|quantitative|deferred|failed|no[_ -]?results|coverage/i.test(limit)))
  const relevantEvidence = referencedEvidenceIds.size
    ? allEvidence.filter(item => referencedEvidenceIds.has(item.evidenceId) || coverageEvidence.some(coverage => coverage.evidenceId === item.evidenceId))
    : allEvidence
  const evidence = relevantEvidence.slice(0, limits.maxEvidence)
  const evidenceIds = new Set(evidence.map(item => item.evidenceId))

  const allClaims = sortedById(claimsFromInput(input), 'claimId')
  const referencedClaimIds = new Set<string>(evidence.flatMap(item => item.claimIds.map(id => id as string)))
  candidateGaps.forEach(gap => gap.sourceClaimIds.forEach(id => referencedClaimIds.add(id)))
  const relevantClaims = referencedClaimIds.size
    ? allClaims.filter(item => referencedClaimIds.has(item.claimId))
    : allClaims
  const claims = relevantClaims.slice(0, limits.maxClaims)
  const claimIds = new Set(claims.map(item => item.claimId))

  const allLinks = linksFromInput(input).slice().sort((a, b) => String(a.evidenceLinkId ?? `${a.claimId ?? ''}:${a.evidenceId ?? ''}`).localeCompare(String(b.evidenceLinkId ?? `${b.claimId ?? ''}:${b.evidenceId ?? ''}`)))
  const relevantLinks = allLinks.filter(link => {
    const evidenceId = typeof link.evidenceId === 'string' ? link.evidenceId : undefined
    const claimId = typeof link.claimId === 'string' ? link.claimId : undefined
    return (!evidenceId || evidenceIds.has(evidenceId as never)) && (!claimId || claimIds.has(claimId as never))
  })
  const links = relevantLinks.slice(0, limits.maxEvidenceLinks)

  const selectedGaps = candidateGaps.filter(gap => gap.sourceProblemNodeIds.every(id => nodeIds.has(id as never)) && gap.sourceClaimIds.every(id => claimIds.has(id as never)) && [...gap.sourceEvidenceIds, ...gap.interpretationEvidenceIds, ...gap.supportingEvidenceIds, ...gap.contradictingEvidenceIds].every(id => evidenceIds.has(id as never)) && [...gap.originatingLimitations, ...gap.originatingOpenQuestions, ...gap.originatingAssumptions, ...gap.originatingFailureCases].every(id => nodeIds.has(id as never)))
  const omitted: M5AOmittedCounts = {
    problemNodes: allNodes.length - nodes.length,
    edges: allEdges.length - edges.length,
    claims: allClaims.length - claims.length,
    evidence: allEvidence.length - evidence.length,
    evidenceLinks: allLinks.length - links.length,
    gaps: allGaps.length - selectedGaps.length,
  }
  const limitations: string[] = []
  if (omitted.problemNodes) limitations.push(`${omitted.problemNodes} problem graph nodes omitted by the projection bound.`)
  if (omitted.edges) limitations.push(`${omitted.edges} problem graph edges omitted by the projection bound.`)
  if (omitted.claims) limitations.push(`${omitted.claims} claims omitted by the projection bound.`)
  if (omitted.evidence) limitations.push(`${omitted.evidence} evidence records omitted by the projection bound.`)
  if (omitted.evidenceLinks) limitations.push(`${omitted.evidenceLinks} evidence links omitted by the projection bound.`)
  if (omitted.gaps) limitations.push(`${omitted.gaps} candidate gaps omitted by the projection bound.`)
  if (candidateGaps.length !== selectedGaps.length) limitations.push(`${candidateGaps.length - selectedGaps.length} candidate gaps omitted because their source records were outside the projection.`)
  return { nodes, edges, claims, evidence, links, selectedGaps, omitted, limitations }
}

/**
 * Character trimming can remove a record that another retained record points
 * at.  Close the projection after every trim so the model never receives a
 * graph with dangling evidence, claim, edge, or gap references.
 */
function closeProjection(candidate: {
  readonly nodes: readonly ResearchGraphNode[]
  readonly edges: readonly ResearchGraphEdge[]
  readonly claims: readonly Claim[]
  readonly evidence: readonly (Evidence & Record<string, unknown>)[]
  readonly links: readonly Record<string, unknown>[]
  readonly selectedGaps: readonly ResearchGap[]
}): {
  readonly nodes: ResearchGraphNode[]
  readonly edges: ResearchGraphEdge[]
  readonly claims: Claim[]
  readonly evidence: (Evidence & Record<string, unknown>)[]
  readonly links: Record<string, unknown>[]
  readonly selectedGaps: ResearchGap[]
} {
  let nodes = [...candidate.nodes]
  let edges = [...candidate.edges]
  let claims = [...candidate.claims]
  let evidence = [...candidate.evidence]
  let links = [...candidate.links]
  let selectedGaps = [...candidate.selectedGaps]
  for (let pass = 0; pass < 8; pass += 1) {
    const claimIds = new Set(claims.map(item => item.claimId as string))
    const nextEvidence = evidence.filter(item => item.claimIds.every(id => claimIds.has(id as string)))
    const evidenceIds = new Set(nextEvidence.map(item => item.evidenceId as string))
    const nextNodes = nodes.filter(node => node.evidenceIds.every(id => evidenceIds.has(id as string)))
    const nodeIds = new Set(nextNodes.map(node => node.nodeId as string))
    const nextEdges = edges.filter(edge => nodeIds.has(edge.from) && nodeIds.has(edge.to) && edge.evidenceIds.every(id => evidenceIds.has(id as string)))
    const nextLinks = links.filter(link => {
      const evidenceId = typeof link.evidenceId === 'string' ? link.evidenceId : undefined
      const claimId = typeof link.claimId === 'string' ? link.claimId : undefined
      return (!evidenceId || evidenceIds.has(evidenceId)) && (!claimId || claimIds.has(claimId))
    })
    const nextGaps = selectedGaps.filter(gap => gap.sourceProblemNodeIds.every(id => nodeIds.has(id)) && gap.sourceClaimIds.every(id => claimIds.has(id)) && [...gap.sourceEvidenceIds, ...gap.interpretationEvidenceIds, ...gap.supportingEvidenceIds, ...gap.contradictingEvidenceIds].every(id => evidenceIds.has(id)) && [...gap.originatingLimitations, ...gap.originatingOpenQuestions, ...gap.originatingAssumptions, ...gap.originatingFailureCases].every(id => nodeIds.has(id)))
    const stable = nextNodes.length === nodes.length && nextEdges.length === edges.length && nextEvidence.length === evidence.length && nextLinks.length === links.length && nextGaps.length === selectedGaps.length
    nodes = nextNodes
    edges = nextEdges
    evidence = nextEvidence
    links = nextLinks
    selectedGaps = nextGaps
    if (stable) break
  }
  return { nodes, edges, claims, evidence, links, selectedGaps }
}

/**
 * Build a deterministic scientific context projection. Selection is by stable
 * domain IDs, and omission is explicit in both counts and limitations.
 */
export function projectM5AInput(input: GapDiscoveryInput, gaps: readonly ResearchGap[] = [], requestedLimits: M5AProjectionLimits = {}): M5AScientificInputProjection {
  const limits: Required<M5AProjectionLimits> = {
    maxProblemNodes: asLimit(requestedLimits.maxProblemNodes, 32),
    maxEdges: asLimit(requestedLimits.maxEdges, 64),
    maxClaims: asLimit(requestedLimits.maxClaims, 64),
    maxEvidence: asLimit(requestedLimits.maxEvidence, 96),
    maxEvidenceLinks: asLimit(requestedLimits.maxEvidenceLinks, 128),
    maxGaps: asLimit(requestedLimits.maxGaps, 32),
    // The limit applies to the complete serialized request context, including
    // audit metadata and completeness limitations.
    maxCharacters: asLimit(requestedLimits.maxCharacters, 48_000),
  }
  const boundedInputCompleteness = boundedCompleteness(input.completeness)
  const completenessDetailsOmitted = ['deferredOperations', 'failedOperations', 'limitations', 'reasons'].reduce((total, key) => {
    const source = (input.completeness as Record<string, unknown>)[key]
    const bounded = (boundedInputCompleteness as Record<string, unknown>)[key]
    return total + (Array.isArray(source) && Array.isArray(bounded) ? Math.max(0, source.length - bounded.length) : 0)
  }, 0)
  let explicit = {
    limitations: [...(input.explicitLimitations ?? [])], openQuestions: [...(input.explicitOpenQuestions ?? [])], assumptions: [...(input.explicitAssumptions ?? [])], failureCases: [...(input.explicitFailureCases ?? [])],
  }
  let projected = projectWithLimits({ ...input, completeness: boundedInputCompleteness }, gaps, limits)
  const reasons = [...projected.limitations]
  const estimate = (candidate: typeof projected): number => canonicalJson({ problemGraph: { nodes: candidate.nodes, edges: candidate.edges }, claims: candidate.claims, evidence: candidate.evidence, evidenceLinks: candidate.links, gaps: candidate.selectedGaps, completeness: boundedInputCompleteness, explicit }).length
  let estimatedCharacters = estimate(projected)

  // A character bound is an additional deterministic guard. Drop records from
  // the end of stable ID order until the serialized context is within budget.
  // Referential integrity is rechecked by the downstream full-state validator;
  // omitted references remain visible through omittedCounts/limitations.
  if (limits.maxCharacters > 0 && estimatedCharacters > limits.maxCharacters) {
    reasons.push(`Scientific context exceeded the ${limits.maxCharacters}-character projection bound.`)
    while (estimatedCharacters > limits.maxCharacters && (projected.links.length || projected.selectedGaps.length || projected.claims.length || projected.evidence.length || projected.edges.length || projected.nodes.length)) {
      if (projected.links.length) projected = { ...projected, links: projected.links.slice(0, -1) }
      else if (projected.selectedGaps.length) projected = { ...projected, selectedGaps: projected.selectedGaps.slice(0, -1) }
      else if (projected.claims.length) projected = { ...projected, claims: projected.claims.slice(0, -1) }
      else if (projected.evidence.length) projected = { ...projected, evidence: projected.evidence.slice(0, -1) }
      else if (projected.edges.length) projected = { ...projected, edges: projected.edges.slice(0, -1) }
      else projected = { ...projected, nodes: projected.nodes.slice(0, -1) }
      estimatedCharacters = estimate(projected)
    }
  }
  const build = (): M5AScientificInputProjection => {
    const closed = closeProjection(projected)
    const omitted: M5AOmittedCounts = {
      problemNodes: input.problemGraph.nodes.length - closed.nodes.length,
      edges: input.problemGraph.edges.length - closed.edges.length,
      claims: claimsFromInput(input).length - closed.claims.length,
      evidence: evidenceFromInput(input).length - closed.evidence.length,
      evidenceLinks: linksFromInput(input).length - closed.links.length,
      gaps: gaps.length - closed.selectedGaps.length,
      explicitLimitations: (input.explicitLimitations?.length ?? 0) - explicit.limitations.length,
      explicitOpenQuestions: (input.explicitOpenQuestions?.length ?? 0) - explicit.openQuestions.length,
      explicitAssumptions: (input.explicitAssumptions?.length ?? 0) - explicit.assumptions.length,
      explicitFailureCases: (input.explicitFailureCases?.length ?? 0) - explicit.failureCases.length,
      completenessDetails: completenessDetailsOmitted,
    }
    const includedProblemNodeIds = closed.nodes.map(node => node.nodeId).sort()
    const includedClaimIds = closed.claims.map(claim => claim.claimId).sort()
    const includedEvidenceIds = closed.evidence.map(item => item.evidenceId).sort()
    const includedGapIds = closed.selectedGaps.map(gap => gap.gapId).sort()
    const limitations = [...new Set([...reasons, ...(((boundedInputCompleteness as Record<string, unknown>).limitations as readonly unknown[] | undefined)?.filter((item): item is string => typeof item === 'string') ?? [])])].sort()
    // Include complete content in the identity. IDs alone are insufficient:
    // persisted records can be amended while retaining their identifiers.
    const scientificContent = { problemGraph: { nodes: closed.nodes, edges: closed.edges }, claims: closed.claims, evidence: closed.evidence, evidenceLinks: closed.links, gaps: closed.selectedGaps, completeness: boundedInputCompleteness, explicitLimitations: explicit.limitations, explicitOpenQuestions: explicit.openQuestions, explicitAssumptions: explicit.assumptions, explicitFailureCases: explicit.failureCases }
    const truncation: M5AProjectionTruncation = {
      truncated: Object.values(omitted).some(value => value > 0) || reasons.length > 0,
      reasons: [...new Set(reasons)].sort(), maxCharacters: limits.maxCharacters, estimatedCharacters,
    }
    const identity = { schemaVersion: 'm5a.input-projection.v1', includedProblemNodeIds, includedClaimIds, includedEvidenceIds, includedGapIds, scientificContent, omittedCounts: omitted, truncation, limits }
    const projectionId = deterministicId('m5a_projection', identity)
    return { schemaVersion: 'm5a.input-projection.v1', projectionId, includedProblemNodeIds, includedClaimIds, includedEvidenceIds, includedGapIds, omittedCounts: omitted, truncation,
      limitations, problemGraph: { problems: input.problemGraph.problems, nodes: closed.nodes, edges: closed.edges }, claims: closed.claims, evidence: closed.evidence, evidenceLinks: closed.links, gaps: closed.selectedGaps,
      completeness: boundedInputCompleteness, explicitLimitations: explicit.limitations, explicitOpenQuestions: explicit.openQuestions, explicitAssumptions: explicit.assumptions, explicitFailureCases: explicit.failureCases }
  }
  let result = build()
  // Re-check the complete projection, not the body-only estimate above. This
  // removes records deterministically until metadata is included in the bound.
  while (limits.maxCharacters > 0 && canonicalJson(result).length > limits.maxCharacters && (projected.links.length || projected.selectedGaps.length || projected.claims.length || projected.evidence.length || projected.edges.length || projected.nodes.length || explicit.limitations.length || explicit.openQuestions.length || explicit.assumptions.length || explicit.failureCases.length)) {
    reasons.push(`Scientific context exceeded the ${limits.maxCharacters}-character projection bound.`)
    if (projected.links.length) projected = { ...projected, links: projected.links.slice(0, -1) }
    else if (projected.selectedGaps.length) projected = { ...projected, selectedGaps: projected.selectedGaps.slice(0, -1) }
    else if (projected.claims.length) projected = { ...projected, claims: projected.claims.slice(0, -1) }
    else if (projected.evidence.length) projected = { ...projected, evidence: projected.evidence.slice(0, -1) }
    else if (projected.edges.length) projected = { ...projected, edges: projected.edges.slice(0, -1) }
    else if (projected.nodes.length) projected = { ...projected, nodes: projected.nodes.slice(0, -1) }
    else if (explicit.limitations.length) explicit = { ...explicit, limitations: explicit.limitations.slice(0, -1) }
    else if (explicit.openQuestions.length) explicit = { ...explicit, openQuestions: explicit.openQuestions.slice(0, -1) }
    else if (explicit.assumptions.length) explicit = { ...explicit, assumptions: explicit.assumptions.slice(0, -1) }
    else explicit = { ...explicit, failureCases: explicit.failureCases.slice(0, -1) }
    result = build()
  }
  if (limits.maxCharacters > 0 && canonicalJson(result).length > limits.maxCharacters) throw new ValidationError('projection bound is too small for mandatory audit metadata', '$.projectionLimits.maxCharacters', 'INVALID_PROJECTION_BOUND')
  return result
}

export const projectGapDiscoveryInput = projectM5AInput
export const buildM5AProjection = projectM5AInput

