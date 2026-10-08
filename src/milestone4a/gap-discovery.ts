import { deterministicId } from '../domain/ids.ts'
import type { Claim, Evidence, ResearchGraphNode, ResearchProblemGraph } from '../domain/types.ts'
import { ValidationError } from '../domain/validation.ts'
import type {
  CoverageGapKind, GapDiscoveryInput, GapDiscoveryRejection, GapDuplicateDecision, GapEpistemicStatus,
  GapGenerationEligibility, GapKind, GapUncertainty, ResearchGap, ResearchGapKind, GapDiscoveryResult,
} from './types.ts'

const RESEARCH_KIND_BY_NODE: Readonly<Record<string, ResearchGapKind>> = {
  'open-question': 'OPEN_QUESTION',
  limitation: 'KNOWN_LIMITATION',
  assumption: 'UNTESTED_ASSUMPTION',
  'failure-case': 'UNEXPLAINED_FAILURE',
}

interface CandidateGap {
  readonly kind: GapKind
  readonly statement: string
  readonly coverageState: 'SCIENTIFIC' | 'COVERAGE_ONLY'
  readonly sourceProblemNodeIds: readonly string[]
  readonly sourceClaimIds: readonly string[]
  readonly sourceEvidenceIds: readonly string[]
  readonly interpretationEvidenceIds: readonly string[]
  readonly supportingEvidenceIds: readonly string[]
  readonly contradictingEvidenceIds: readonly string[]
  readonly originatingLimitations: readonly string[]
  readonly originatingOpenQuestions: readonly string[]
  readonly originatingAssumptions: readonly string[]
  readonly originatingFailureCases: readonly string[]
  readonly epistemicStatus: GapEpistemicStatus
  readonly rationale: string
  readonly uncertainty: GapUncertainty
}

function text(value: unknown): string { return typeof value === 'string' ? value.trim() : '' }
function sorted(values: Iterable<string>): string[] { return [...new Set([...values].filter(Boolean))].sort((a, b) => a.localeCompare(b)) }
function normalize(value: string): string { return value.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim() }
function asNumber(value: unknown): number { return typeof value === 'number' && Number.isFinite(value) ? value : 0 }
function countOrLength(value: unknown): number { return Array.isArray(value) ? value.length : asNumber(value) }

function evidenceIsModelInterpretation(evidence: Evidence & Record<string, unknown>): boolean {
  return evidence.sourceTextVerified === false || evidence.modelInterpretation === true || evidence.evidenceLevel === 'MODEL_INTERPRETATION' || (evidence.kind === 'interpretation' && evidence.provenance.sourceType === 'model')
}

function graphEvidence(input: GapDiscoveryInput): readonly (Evidence & Record<string, unknown>)[] {
  return input.evidenceGraph?.evidence ?? input.evidence ?? []
}

function graphClaims(input: GapDiscoveryInput): readonly Claim[] { return input.evidenceGraph?.claims ?? input.claims ?? [] }

function problemOrigins(graph: ResearchProblemGraph, nodeId: string): string[] {
  const related = new Set<string>([nodeId])
  for (const edge of graph.edges) {
    if (edge.from === nodeId) related.add(edge.to)
    if (edge.to === nodeId) related.add(edge.from)
  }
  return sorted(related)
}

function makeCandidateFromNode(node: ResearchGraphNode, graph: ResearchProblemGraph, evidenceById: ReadonlyMap<string, Evidence & Record<string, unknown>>, claimsById: ReadonlyMap<string, Claim>): CandidateGap | undefined {
  const kind = RESEARCH_KIND_BY_NODE[node.type]
  if (!kind || !text(node.label)) return undefined
  const evidence = node.evidenceIds.map(id => evidenceById.get(id)).filter((item): item is Evidence & Record<string, unknown> => item !== undefined)
  const sourceEvidenceIds = sorted(evidence.filter(item => !evidenceIsModelInterpretation(item)).map(item => item.evidenceId))
  const interpretationEvidenceIds = sorted(evidence.filter(item => evidenceIsModelInterpretation(item)).map(item => item.evidenceId))
  const sourceClaimIds = sorted(evidence.filter(item => !evidenceIsModelInterpretation(item)).flatMap(item => item.claimIds).filter(id => claimsById.has(id)))
  const supportingEvidenceIds = sorted(evidence.filter(item => !evidenceIsModelInterpretation(item) && item.polarity === 'SUPPORT').map(item => item.evidenceId))
  const contradictingEvidenceIds = sorted(evidence.filter(item => !evidenceIsModelInterpretation(item) && (item.polarity === 'CONTRADICT' || item.polarity === 'WEAKEN')).map(item => item.evidenceId))
  return {
    kind,
    statement: node.label,
    coverageState: 'SCIENTIFIC',
    sourceProblemNodeIds: problemOrigins(graph, node.nodeId),
    sourceClaimIds,
    sourceEvidenceIds,
    interpretationEvidenceIds,
    supportingEvidenceIds,
    contradictingEvidenceIds,
    originatingLimitations: node.type === 'limitation' ? [node.nodeId] : [],
    originatingOpenQuestions: node.type === 'open-question' ? [node.nodeId] : [],
    originatingAssumptions: node.type === 'assumption' ? [node.nodeId] : [],
    originatingFailureCases: node.type === 'failure-case' ? [node.nodeId] : [],
    epistemicStatus: interpretationEvidenceIds.length && sourceEvidenceIds.length === 0 ? 'MODEL_INTERPRETATION' : 'OBSERVED',
    rationale: `derived from structured ResearchProblemGraph ${node.type} node ${node.nodeId}`,
    uncertainty: { level: interpretationEvidenceIds.length && sourceEvidenceIds.length === 0 ? 0.8 : 0.45, reasons: interpretationEvidenceIds.length ? ['model interpretation is not source evidence'] : ['scientific gap is represented in the problem graph'] },
  }
}

function makeExplicitCandidate(kind: ResearchGapKind, statement: string, graph: ResearchProblemGraph, input: GapDiscoveryInput): CandidateGap | undefined {
  const normalized = normalize(statement)
  if (!normalized) return undefined
  const matching = graph.nodes.filter(node => normalize(node.label) === normalized)
  const sourceProblemNodeIds = sorted(matching.flatMap(node => problemOrigins(graph, node.nodeId)))
  const origins = {
    originatingLimitations: kind === 'KNOWN_LIMITATION' ? matching.map(node => node.nodeId) : [],
    originatingOpenQuestions: kind === 'OPEN_QUESTION' ? matching.map(node => node.nodeId) : [],
    originatingAssumptions: kind === 'UNTESTED_ASSUMPTION' ? matching.map(node => node.nodeId) : [],
    originatingFailureCases: kind === 'UNEXPLAINED_FAILURE' ? matching.map(node => node.nodeId) : [],
  }
  return {
    kind,
    statement,
    coverageState: 'SCIENTIFIC',
    sourceProblemNodeIds,
    sourceClaimIds: [],
    sourceEvidenceIds: [],
    interpretationEvidenceIds: [],
    supportingEvidenceIds: [],
    contradictingEvidenceIds: [],
    ...origins,
    epistemicStatus: matching.length ? 'OBSERVED' : 'UNRESOLVED',
    rationale: matching.length ? 'explicit structured limitation/open question/assumption/failure case' : 'explicit input requires follow-up provenance',
    uncertainty: matching.length ? { level: 0.5, reasons: ['explicit graph statement'] } : { level: 0.85, reasons: ['explicit statement has no graph node provenance'] },
  }
}

function makeCoverageCandidate(kind: CoverageGapKind, statement: string, sourceEvidenceIds: readonly string[] = []): CandidateGap {
  return {
    kind,
    statement,
    coverageState: 'COVERAGE_ONLY',
    sourceProblemNodeIds: [],
    sourceClaimIds: [],
    sourceEvidenceIds: [...sourceEvidenceIds].sort(),
    interpretationEvidenceIds: [],
    supportingEvidenceIds: [],
    contradictingEvidenceIds: [],
    originatingLimitations: [],
    originatingOpenQuestions: [],
    originatingAssumptions: [],
    originatingFailureCases: [],
    epistemicStatus: 'UNRESOLVED',
    rationale: 'evidence or retrieval coverage state requires follow-up; it is not a scientific conclusion',
    uncertainty: { level: 1, reasons: ['coverage state is incomplete'] },
  }
}

function completenessCount(completeness: GapDiscoveryInput['completeness'], key: 'deferredOperations' | 'failedOperations'): number {
  return countOrLength((completeness as Record<string, unknown>)[key])
}

function retrievalCount(completeness: GapDiscoveryInput['completeness'], key: 'FAILED' | 'NO_RESULTS' | 'PARTIAL'): number {
  const coverage = (completeness as { retrievalCoverage?: Readonly<Record<string, unknown>> }).retrievalCoverage
  return asNumber(coverage?.[key])
}

function coverageCandidates(input: GapDiscoveryInput, evidence: readonly (Evidence & Record<string, unknown>)[]): CandidateGap[] {
  const result: CandidateGap[] = []
  const completeness = input.completeness as Record<string, unknown>
  const reasons = Array.isArray(completeness.reasons) ? completeness.reasons.filter((item): item is string => typeof item === 'string') : []
  const incomplete = completeness.scientificallyComplete === false || completeness.exhaustive === false || completeness.status === 'INCOMPLETE' || completenessCount(input.completeness, 'deferredOperations') > 0 || completenessCount(input.completeness, 'failedOperations') > 0 || asNumber(completeness.unexecutedPlannedOperations) > 0
  if (incomplete) result.push(makeCoverageCandidate('INCOMPLETE_EVIDENCE_COVERAGE', 'Evidence coverage is incomplete; scientific conclusions remain bounded by the unexamined or unsuccessful operations.'))
  if (completeness.budgetExhausted === true || reasons.includes('BUDGET_EXHAUSTED') || asNumber(completeness.budgetExhaustedOperations) > 0) result.push(makeCoverageCandidate('BUDGET_EXHAUSTION', 'A configured budget prevented some evidence work from being examined; this is a coverage limitation.'))
  if (completenessCount(input.completeness, 'deferredOperations') > 0) result.push(makeCoverageCandidate('DEFERRED_EVIDENCE_WORK', 'Some planned evidence operations were deferred and remain unexamined.'))
  if (retrievalCount(input.completeness, 'FAILED') > 0 || reasons.includes('FAILED_RETRIEVAL')) result.push(makeCoverageCandidate('FAILED_RETRIEVAL', 'One or more retrieval operations failed; this records a coverage limitation rather than absence of literature.'))
  if (retrievalCount(input.completeness, 'NO_RESULTS') > 0 || reasons.includes('NO_RESULTS_RETRIEVAL') || asNumber(completeness.noResultsRetrieval) > 0) result.push(makeCoverageCandidate('NO_RESULTS_RETRIEVAL', 'One or more retrieval operations returned NO_RESULTS; this is a search outcome, not negative evidence.'))
  const abstractIds = evidence.filter(item => item.evidenceLevel === 'ABSTRACT_EVIDENCE').map(item => item.evidenceId)
  if (abstractIds.length) result.push(makeCoverageCandidate('ABSTRACT_ONLY_EVIDENCE', 'Accepted evidence is abstract-level only and does not establish full-text, experiment, equation-level, or quantitative verification.', abstractIds))
  const quantitativeLimitations = evidence.flatMap(item => item.limitations).filter(item => /quantitative|equation|experiment|full[- ]text/i.test(item))
  if (quantitativeLimitations.length || abstractIds.length) result.push(makeCoverageCandidate('MISSING_QUANTITATIVE_EVIDENCE', 'Quantitative or full-text verification remains unavailable in the accepted evidence.', abstractIds))
  return result
}

function edgeCandidates(graph: ResearchProblemGraph, evidenceById: ReadonlyMap<string, Evidence & Record<string, unknown>>, claimsById: ReadonlyMap<string, Claim>): CandidateGap[] {
  const result: CandidateGap[] = []
  for (const edge of graph.edges) {
    const relation = edge.relation.toUpperCase()
    let kind: ResearchGapKind | undefined
    if (relation === 'CONTRADICTS') kind = 'CONTRADICTORY_EVIDENCE'
    else if (relation === 'LIMITED_BY') kind = 'METHOD_INCOMPATIBILITY'
    else if (relation === 'FAILS_WHEN') kind = 'UNEXPLAINED_FAILURE'
    else if (relation === 'LEAVES_OPEN') kind = 'OPEN_QUESTION'
    if (!kind) continue
    const evidence = edge.evidenceIds.map(id => evidenceById.get(id)).filter((item): item is Evidence & Record<string, unknown> => item !== undefined)
    const direct = evidence.filter(item => !evidenceIsModelInterpretation(item))
    const interpretations = evidence.filter(item => evidenceIsModelInterpretation(item))
    const sourceClaimIds = sorted(direct.flatMap(item => item.claimIds).filter(id => claimsById.has(id)))
    result.push({
      kind,
      statement: `Structured graph edge ${edge.from} ${edge.relation} ${edge.to} requires resolution.`,
      coverageState: 'SCIENTIFIC',
      sourceProblemNodeIds: sorted([edge.from, edge.to]),
      sourceClaimIds,
      sourceEvidenceIds: sorted(direct.map(item => item.evidenceId)),
      interpretationEvidenceIds: sorted(interpretations.map(item => item.evidenceId)),
      supportingEvidenceIds: sorted(direct.filter(item => item.polarity === 'SUPPORT').map(item => item.evidenceId)),
      contradictingEvidenceIds: sorted(direct.filter(item => item.polarity === 'CONTRADICT' || item.polarity === 'WEAKEN').map(item => item.evidenceId)),
      originatingLimitations: [], originatingOpenQuestions: kind === 'OPEN_QUESTION' ? [edge.to] : [], originatingAssumptions: [], originatingFailureCases: kind === 'UNEXPLAINED_FAILURE' ? [edge.to] : [],
      epistemicStatus: interpretations.length && direct.length === 0 ? 'MODEL_INTERPRETATION' : 'OBSERVED',
      rationale: `derived from ResearchProblemGraph edge ${edge.edgeId} (${edge.relation})`,
      uncertainty: { level: interpretations.length && direct.length === 0 ? 0.8 : 0.55, reasons: ['edge relation requires scientific follow-up'] },
    })
  }
  return result
}

function claimConflictCandidates(graph: ResearchProblemGraph, input: GapDiscoveryInput, evidenceById: ReadonlyMap<string, Evidence & Record<string, unknown>>, claimsById: ReadonlyMap<string, Claim>): CandidateGap[] {
  const byClaim = new Map<string, { readonly support: string[]; readonly contradict: string[] }>()
  for (const link of input.evidenceGraph?.links ?? []) {
    if (!link.claimId || !link.evidenceId || !claimsById.has(link.claimId)) continue
    const relation = link.relation?.toUpperCase()
    if (relation !== 'SUPPORTS' && relation !== 'CONTRADICTS') continue
    const row = byClaim.get(link.claimId) ?? { support: [], contradict: [] }
    if (relation === 'SUPPORTS') row.support.push(link.evidenceId)
    else row.contradict.push(link.evidenceId)
    byClaim.set(link.claimId, row)
  }
  const result: CandidateGap[] = []
  for (const [claimId, row] of byClaim) {
    if (!row.support.length || !row.contradict.length) continue
    const allEvidence = sorted([...row.support, ...row.contradict]).map(id => evidenceById.get(id)).filter((item): item is Evidence & Record<string, unknown> => item !== undefined)
    const direct = allEvidence.filter(item => !evidenceIsModelInterpretation(item))
    const interpretations = allEvidence.filter(item => evidenceIsModelInterpretation(item))
    const sourceProblemNodeIds = sorted(graph.nodes.filter(node => node.evidenceIds.some(id => row.support.includes(id) || row.contradict.includes(id))).map(node => node.nodeId))
    result.push({ kind: 'CONTRADICTORY_EVIDENCE', statement: claimsById.get(claimId)?.statement ?? `Claim ${claimId} has conflicting evidence.`, coverageState: 'SCIENTIFIC', sourceProblemNodeIds, sourceClaimIds: [claimId], sourceEvidenceIds: sorted(direct.map(item => item.evidenceId)), interpretationEvidenceIds: sorted(interpretations.map(item => item.evidenceId)), supportingEvidenceIds: sorted(direct.filter(item => row.support.includes(item.evidenceId)).map(item => item.evidenceId)), contradictingEvidenceIds: sorted(direct.filter(item => row.contradict.includes(item.evidenceId)).map(item => item.evidenceId)), originatingLimitations: [], originatingOpenQuestions: [], originatingAssumptions: [], originatingFailureCases: [], epistemicStatus: interpretations.length && direct.length === 0 ? 'MODEL_INTERPRETATION' : 'OBSERVED', rationale: `claim ${claimId} has both supporting and contradicting structured evidence`, uncertainty: { level: 0.6, reasons: ['supporting and contradicting evidence require adjudication'] } })
  }
  return result
}

function candidateSignature(candidate: CandidateGap): string {
  return normalize(JSON.stringify({ kind: candidate.kind, statement: normalize(candidate.statement), sourceProblemNodeIds: sorted(candidate.sourceProblemNodeIds), sourceClaimIds: sorted(candidate.sourceClaimIds), sourceEvidenceIds: sorted(candidate.sourceEvidenceIds) }))
}

function toGap(candidate: CandidateGap): ResearchGap {
  const sourceIds = sorted([...candidate.sourceProblemNodeIds, ...candidate.sourceClaimIds, ...candidate.sourceEvidenceIds])
  const gapId = deterministicId('research_gap', { kind: candidate.kind, statement: normalize(candidate.statement), sourceIds }) as string
  const hasIndependentProvenance = candidate.sourceProblemNodeIds.length > 0 || candidate.sourceClaimIds.length > 0 || candidate.sourceEvidenceIds.length > 0
  const eligibility: GapGenerationEligibility = candidate.coverageState === 'COVERAGE_ONLY'
    ? { eligible: false, code: 'COVERAGE_FOLLOWUP_REQUIRED', reason: 'coverage limitations require follow-up and cannot seed a hypothesis alone' }
    : hasIndependentProvenance
      ? { eligible: true, code: 'ELIGIBLE_RESEARCH_GAP', reason: 'structured scientific gap has an independent graph statement and provenance chain' }
      : { eligible: false, code: 'MIXED_RESEARCH_COMPONENT_REQUIRED', reason: 'scientific interpretation has no independent graph, claim, or direct evidence provenance' }
  return { gapId, kind: candidate.kind, statement: candidate.statement, coverageState: candidate.coverageState, epistemicStatus: candidate.epistemicStatus, sourceProblemNodeIds: sorted(candidate.sourceProblemNodeIds), sourceClaimIds: sorted(candidate.sourceClaimIds), sourceEvidenceIds: sorted(candidate.sourceEvidenceIds), interpretationEvidenceIds: sorted(candidate.interpretationEvidenceIds), supportingEvidenceIds: sorted(candidate.supportingEvidenceIds), contradictingEvidenceIds: sorted(candidate.contradictingEvidenceIds), originatingLimitations: sorted(candidate.originatingLimitations), originatingOpenQuestions: sorted(candidate.originatingOpenQuestions), originatingAssumptions: sorted(candidate.originatingAssumptions), originatingFailureCases: sorted(candidate.originatingFailureCases), eligibility, uncertainty: candidate.uncertainty, rationale: candidate.rationale }
}

export function discoverResearchGaps(input: GapDiscoveryInput): GapDiscoveryResult {
  if (!input.problemGraph || !Array.isArray(input.problemGraph.nodes) || !Array.isArray(input.problemGraph.edges)) throw new ValidationError('problemGraph is required', '$.problemGraph', 'INVALID_GAP_INPUT')
  const evidence = graphEvidence(input)
  const claims = graphClaims(input)
  const evidenceById = new Map<string, Evidence & Record<string, unknown>>(evidence.map(item => [item.evidenceId as string, item]))
  const claimsById = new Map<string, Claim>(claims.map(item => [item.claimId as string, item]))
  const graphNodeIds = new Set(input.problemGraph.nodes.map(node => node.nodeId))
  for (const node of input.problemGraph.nodes) for (const evidenceId of node.evidenceIds) if (!evidenceById.has(evidenceId)) throw new ValidationError(`node ${node.nodeId} references unknown evidence ${evidenceId}`, '$.problemGraph.nodes.evidenceIds', 'INVALID_PROVENANCE')
  for (const edge of input.problemGraph.edges) {
    if (!graphNodeIds.has(edge.from) || !graphNodeIds.has(edge.to)) throw new ValidationError(`edge ${edge.edgeId} references an unknown graph node`, '$.problemGraph.edges', 'INVALID_GRAPH_REFERENCE')
    for (const evidenceId of edge.evidenceIds) if (!evidenceById.has(evidenceId)) throw new ValidationError(`edge ${edge.edgeId} references unknown evidence ${evidenceId}`, '$.problemGraph.edges.evidenceIds', 'INVALID_PROVENANCE')
  }
  if (claims.length) for (const item of evidence) for (const claimId of item.claimIds) if (!claimsById.has(claimId)) throw new ValidationError(`evidence ${item.evidenceId} references unknown claim ${claimId}`, '$.evidence.claimIds', 'INVALID_PROVENANCE')
  for (const link of input.evidenceGraph?.links ?? []) if (link.evidenceId && !evidenceById.has(link.evidenceId)) throw new ValidationError(`evidence link references unknown evidence ${link.evidenceId}`, '$.evidenceGraph.links', 'INVALID_PROVENANCE')
  const candidates: CandidateGap[] = []
  for (const node of input.problemGraph.nodes) {
    const candidate = makeCandidateFromNode(node, input.problemGraph, evidenceById, claimsById)
    if (candidate) candidates.push(candidate)
  }
  candidates.push(...edgeCandidates(input.problemGraph, evidenceById, claimsById))
  candidates.push(...claimConflictCandidates(input.problemGraph, input, evidenceById, claimsById))
  for (const [kind, values] of [['KNOWN_LIMITATION', input.explicitLimitations ?? []], ['OPEN_QUESTION', input.explicitOpenQuestions ?? []], ['UNTESTED_ASSUMPTION', input.explicitAssumptions ?? []], ['UNEXPLAINED_FAILURE', input.explicitFailureCases ?? []]] as const) for (const statement of values) {
    const candidate = makeExplicitCandidate(kind, statement, input.problemGraph, input)
    if (candidate) candidates.push(candidate)
  }
  candidates.push(...coverageCandidates(input, evidence))
  const gaps: ResearchGap[] = []
  const rejected: GapDiscoveryRejection[] = []
  const duplicates: GapDuplicateDecision[] = []
  const seen = new Map<string, ResearchGap>()
  for (const candidate of candidates.sort((a, b) => candidateSignature(a).localeCompare(candidateSignature(b)))) {
    const statement = text(candidate.statement)
    if (!statement) { rejected.push({ signature: candidateSignature(candidate), reason: 'gap statement is empty', source: candidate.kind }); continue }
    const signature = candidateSignature(candidate)
    const gap = toGap(candidate)
    const previous = seen.get(signature)
    if (previous) { duplicates.push({ keptGapId: previous.gapId, duplicateSignature: signature, rejectedStatement: gap.statement, reason: 'same normalized scientific/coverage signature and provenance' }); continue }
    seen.set(signature, gap)
    gaps.push(gap)
  }
  const limitations = gaps.filter(gap => gap.coverageState !== 'SCIENTIFIC').map(gap => gap.statement)
  return { schemaVersion: 'm4a.gap-discovery.v1', generatedAt: input.now, gaps: gaps.sort((a, b) => a.gapId.localeCompare(b.gapId)), rejected, duplicates, completeness: input.completeness, limitations, sourceIds: sorted(gaps.flatMap(gap => [...gap.sourceProblemNodeIds, ...gap.sourceClaimIds, ...gap.sourceEvidenceIds, ...gap.interpretationEvidenceIds])), inputSummary: { problemNodeIds: sorted(input.problemGraph.nodes.map(node => node.nodeId)), edgeIds: sorted(input.problemGraph.edges.map(edge => edge.edgeId)), claimIds: sorted(claims.map(claim => claim.claimId)), evidenceIds: sorted(evidence.map(item => item.evidenceId)) } }
}
