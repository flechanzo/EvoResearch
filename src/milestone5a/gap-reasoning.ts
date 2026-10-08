import { canonicalJson, deterministicId } from '../domain/ids.ts'
import type { ModelGateway, ModelRequest, ModelResponseDiagnostic, ModelRoute } from '../domain/extraction.ts'
import type { Evidence, Timestamp } from '../domain/types.ts'
import { ValidationError } from '../domain/validation.ts'
import { discoverResearchGaps } from '../milestone4a/gap-discovery.ts'
import { validateResearchGap } from '../milestone4a/validation.ts'
import type {
  GapDiscoveryInput, GapDiscoveryResult, GapKind, GapCoverageState, GapEpistemicStatus, ResearchGap, ResearchGapKind, CoverageGapKind,
} from '../milestone4a/types.ts'
import { projectM5AInput, type M5AProjectionLimits, type M5AScientificInputProjection } from './projection.ts'

const RESEARCH_KINDS: readonly ResearchGapKind[] = ['OPEN_QUESTION', 'KNOWN_LIMITATION', 'UNTESTED_ASSUMPTION', 'CONTRADICTORY_EVIDENCE', 'UNEXPLAINED_FAILURE', 'METHOD_INCOMPATIBILITY', 'MISSING_COMPARISON', 'UNRESOLVED_MECHANISM']
const COVERAGE_KINDS: readonly CoverageGapKind[] = ['INCOMPLETE_EVIDENCE_COVERAGE', 'DEFERRED_EVIDENCE_WORK', 'FAILED_RETRIEVAL', 'NO_RESULTS_RETRIEVAL', 'ABSTRACT_ONLY_EVIDENCE', 'MISSING_QUANTITATIVE_EVIDENCE', 'BUDGET_EXHAUSTION']

export interface M5AGapReasoningOptions {
  readonly gateway?: ModelGateway
  readonly route?: ModelRoute
  readonly skillVersion?: string
  readonly maxSerializationRetries?: number
  readonly projectionLimits?: M5AProjectionLimits
  readonly candidateBudget?: number
  readonly now?: Timestamp
  readonly inputArtifactIds?: readonly string[]
}

export interface M5AGapReasoningAttempt {
  readonly attemptNumber: number
  readonly attemptId: string
  readonly status: 'SUCCEEDED' | 'FAILED'
  readonly failureKind?: 'TRANSPORT' | 'SERIALIZATION' | 'SCHEMA'
  readonly validationErrors: readonly string[]
  readonly request: ModelRequest<unknown>
  readonly diagnostic?: ModelResponseDiagnostic
}

export interface M5AGapReasoningRejection {
  readonly statement?: string
  readonly reason: string
  readonly validationCode?: string
}

export interface M5AGapReasoningResult {
  readonly schemaVersion: 'm5a.gap-reasoning.v1'
  readonly gapDiscovery: GapDiscoveryResult
  readonly baseline: GapDiscoveryResult
  readonly modelGaps: readonly ResearchGap[]
  readonly rejected: readonly M5AGapReasoningRejection[]
  readonly projection: M5AScientificInputProjection
  readonly attempts: readonly M5AGapReasoningAttempt[]
  readonly modelAttempted: boolean
  readonly limitations: readonly string[]
}

interface RawGapEnvelope { readonly gaps?: unknown }

// Gap IDs and epistemic/eligibility fields are derived after validation.  A
// model may describe a gap, but it cannot authoritatively assign its identity
// or promote a coverage record into a generative scientific gap.
const MODEL_GAP_FIELDS = new Set([
  'kind', 'coverageState', 'statement', 'sourceProblemNodeIds', 'sourceClaimIds',
  'sourceEvidenceIds', 'interpretationEvidenceIds', 'supportingEvidenceIds',
  'contradictingEvidenceIds', 'originatingLimitations', 'originatingOpenQuestions',
  'originatingAssumptions', 'originatingFailureCases', 'uncertainty', 'rationale',
  // Accepted as an advisory field for compatibility with the published M5A
  // envelope; canonicalGap recomputes this from source text and provenance.
  'epistemicStatus',
])

function text(value: unknown): string { return typeof value === 'string' ? value.trim() : '' }
function unsupportedScientificLanguage(value: string): boolean { return /\b(verified|proven|true|false|novel|novelty|no literature|absence of literature|no evidence|falsified)\b/i.test(value) }
function strings(value: unknown, path: string, required = false): string[] {
  if (value === undefined && !required) return []
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || !item.trim())) throw new ValidationError('expected string array', path, 'INVALID_MODEL_OUTPUT')
  return [...new Set(value.map(item => (item as string).trim()))].sort((a, b) => a.localeCompare(b))
}
function normalize(value: string): string { return value.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim() }
function object(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ValidationError('expected object', path, 'INVALID_MODEL_OUTPUT')
  return value as Record<string, unknown>
}
function rejectUnknownFields(value: Record<string, unknown>, allowed: ReadonlySet<string>, path: string): void {
  const unknown = Object.keys(value).find(key => !allowed.has(key))
  if (unknown) throw new ValidationError(`unsupported field ${unknown}`, `${path}.${unknown}`, 'INVALID_MODEL_OUTPUT')
}
function finite(value: unknown, path: string, fallback = 0.8): number {
  if (value === undefined) return fallback
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) throw new ValidationError('expected number in [0,1]', path, 'INVALID_MODEL_OUTPUT')
  return value
}
function evidenceIsModelInterpretation(evidence: Evidence & Record<string, unknown>): boolean {
  return evidence.sourceTextVerified === false || evidence.modelInterpretation === true || evidence.evidenceLevel === 'MODEL_INTERPRETATION' || (evidence.kind === 'interpretation' && evidence.provenance.sourceType === 'model')
}
function sorted(values: Iterable<string>): string[] { return [...new Set([...values].filter(Boolean))].sort((a, b) => a.localeCompare(b)) }
function gapSignature(gap: ResearchGap): string { return normalize(JSON.stringify({ kind: gap.kind, statement: normalize(gap.statement), sourceProblemNodeIds: sorted(gap.sourceProblemNodeIds), sourceClaimIds: sorted(gap.sourceClaimIds), sourceEvidenceIds: sorted(gap.sourceEvidenceIds) })) }

function sourceTextMatches(input: GapDiscoveryInput, statement: string, evidenceById: ReadonlyMap<string, Evidence & Record<string, unknown>>): boolean {
  const target = normalize(statement)
  if (!target) return false
  const texts = [
    ...input.problemGraph.nodes.map(node => node.label),
    ...(input.evidenceGraph?.claims ?? input.claims ?? []).filter(claim => claim.provenance.sourceType !== 'model').map(claim => claim.statement),
    ...evidenceFromInput(input).filter(item => !evidenceIsModelInterpretation(item)).map(item => item.claim),
    ...(input.explicitLimitations ?? []), ...(input.explicitOpenQuestions ?? []), ...(input.explicitAssumptions ?? []), ...(input.explicitFailureCases ?? []),
  ]
  return texts.some(value => normalize(value) === target) || [...evidenceById.values()].filter(item => !evidenceIsModelInterpretation(item)).some(item => normalize(item.claim) === target)
}

function evidenceFromInput(input: GapDiscoveryInput): readonly (Evidence & Record<string, unknown>)[] {
  return (input.evidenceGraph?.evidence ?? input.evidence ?? []) as readonly (Evidence & Record<string, unknown>)[]
}

/** Restrict validation and source matching to the exact bounded context sent to
 * the model. References into omitted upstream records fail closed. */
function boundedInput(input: GapDiscoveryInput, projection: M5AScientificInputProjection): GapDiscoveryInput {
  return {
    ...input,
    problemGraph: projection.problemGraph,
    claims: projection.claims,
    evidence: projection.evidence,
    evidenceGraph: { claims: projection.claims, evidence: projection.evidence, links: projection.evidenceLinks as never },
    explicitLimitations: projection.explicitLimitations,
    explicitOpenQuestions: projection.explicitOpenQuestions,
    explicitAssumptions: projection.explicitAssumptions,
    explicitFailureCases: projection.explicitFailureCases,
  }
}

function hasCoverageEvidence(ids: readonly string[], evidenceById: ReadonlyMap<string, Evidence & Record<string, unknown>>): boolean {
  return ids.some(id => {
    const evidence = evidenceById.get(id)
    if (!evidence) return false
    const status = evidence.provenance.provenancePath?.searchCoverageStatus
    // Abstract-level evidence remains scientific evidence with a stated
    // verification boundary. Only explicit coverage/retrieval wording makes
    // an item a coverage observation; the evidence level alone is not enough.
    return evidenceIsModelInterpretation(evidence) || status === 'FAILED' || status === 'NO_RESULTS' || status === 'PARTIAL' || evidence.limitations.some(item => /coverage|abstract[- ]only|full[- ]text unavailable|quantitative|deferred|failed|no[_ -]?results/i.test(item))
  })
}

function coverageKindFor(input: GapDiscoveryInput, baseline: GapDiscoveryResult, statement: string, sourceIds: readonly string[]): CoverageGapKind {
  const target = normalize(statement)
  const matched = baseline.gaps.find(gap => COVERAGE_KINDS.includes(gap.kind as CoverageGapKind) && (normalize(gap.statement) === target || gap.sourceEvidenceIds.some(id => sourceIds.includes(id)) || gap.interpretationEvidenceIds.some(id => sourceIds.includes(id))))
  if (matched) return matched.kind as CoverageGapKind
  const lower = target
  if (/no[_ -]?results|no results/.test(lower)) return 'NO_RESULTS_RETRIEVAL'
  if (/failed retrieval|retrieval failed|provider failure/.test(lower)) return 'FAILED_RETRIEVAL'
  if (/deferred|unexamined/.test(lower)) return 'DEFERRED_EVIDENCE_WORK'
  if (/abstract[- ]only|abstract[- ]level/.test(lower)) return 'ABSTRACT_ONLY_EVIDENCE'
  if (/quantitative|equation|full[- ]text|experiment verification/.test(lower)) return 'MISSING_QUANTITATIVE_EVIDENCE'
  if (/budget/.test(lower)) return 'BUDGET_EXHAUSTION'
  return 'INCOMPLETE_EVIDENCE_COVERAGE'
}

function directEvidenceIds(input: GapDiscoveryInput): Set<string> {
  return new Set(evidenceFromInput(input).filter(item => !evidenceIsModelInterpretation(item)).map(item => item.evidenceId))
}

function graphNodeIds(input: GapDiscoveryInput): Set<string> { return new Set(input.problemGraph.nodes.map(node => node.nodeId)) }
function claimIds(input: GapDiscoveryInput): Set<string> { return new Set((input.evidenceGraph?.claims ?? input.claims ?? []).map(claim => claim.claimId)) }
function evidenceIds(input: GapDiscoveryInput): Set<string> { return new Set(evidenceFromInput(input).map(item => item.evidenceId)) }

function validateOriginRefs(raw: Record<string, unknown>, input: GapDiscoveryInput): { readonly limitations: string[]; readonly openQuestions: string[]; readonly assumptions: string[]; readonly failureCases: string[] } {
  const nodes = new Map(input.problemGraph.nodes.map(node => [node.nodeId, node]))
  const check = (field: string, type: string): string[] => {
    const values = strings(raw[field], `$.gaps[].${field}`)
    values.forEach(id => {
      const node = nodes.get(id as never)
      if (!node) throw new ValidationError(`origin reference ${id} does not resolve to a graph node in the bounded provenance context`, `$.gaps[].${field}`, 'INVALID_PROVENANCE')
      if (node.type !== type) throw new ValidationError(`origin reference ${id} does not resolve to a ${type} node`, `$.gaps[].${field}`, 'INVALID_PROVENANCE')
    })
    return values
  }
  return { limitations: check('originatingLimitations', 'limitation'), openQuestions: check('originatingOpenQuestions', 'open-question'), assumptions: check('originatingAssumptions', 'assumption'), failureCases: check('originatingFailureCases', 'failure-case') }
}

function canonicalGap(raw: unknown, input: GapDiscoveryInput, baseline: GapDiscoveryResult): ResearchGap {
  const item = object(raw, '$.gaps[]')
  rejectUnknownFields(item, MODEL_GAP_FIELDS, '$.gaps[]')
  const kindText = text(item.kind)
  if (![...RESEARCH_KINDS, ...COVERAGE_KINDS].includes(kindText as GapKind)) throw new ValidationError('unsupported gap kind', '$.gaps[].kind', 'INVALID_MODEL_OUTPUT')
  const statement = text(item.statement)
  if (!statement) throw new ValidationError('gap statement is required', '$.gaps[].statement', 'INVALID_MODEL_OUTPUT')
  if (unsupportedScientificLanguage(statement)) throw new ValidationError('gap statement contains unsupported truth, novelty, falsity, or absence language', '$.gaps[].statement', 'UNSUPPORTED_SCIENTIFIC_CONCLUSION')
  if (item.epistemicStatus !== undefined && !['OBSERVED', 'MODEL_INTERPRETATION', 'UNRESOLVED'].includes(text(item.epistemicStatus))) throw new ValidationError('unsupported epistemicStatus', '$.gaps[].epistemicStatus', 'INVALID_MODEL_OUTPUT')
  const rawRationale = text(item.rationale)
  if (rawRationale && unsupportedScientificLanguage(rawRationale)) throw new ValidationError('gap rationale contains unsupported truth, novelty, falsity, or absence language', '$.gaps[].rationale', 'UNSUPPORTED_SCIENTIFIC_CONCLUSION')
  const sourceProblemNodeIds = strings(item.sourceProblemNodeIds, '$.gaps[].sourceProblemNodeIds')
  const sourceClaimIds = strings(item.sourceClaimIds, '$.gaps[].sourceClaimIds')
  const rawSourceEvidenceIds = strings(item.sourceEvidenceIds, '$.gaps[].sourceEvidenceIds')
  const interpretationEvidenceIds = strings(item.interpretationEvidenceIds, '$.gaps[].interpretationEvidenceIds')
  const supportingEvidenceIds = strings(item.supportingEvidenceIds, '$.gaps[].supportingEvidenceIds')
  const contradictingEvidenceIds = strings(item.contradictingEvidenceIds, '$.gaps[].contradictingEvidenceIds')
  const origins = validateOriginRefs(item, input)
  const knownNodes = graphNodeIds(input); const knownClaims = claimIds(input); const knownEvidence = evidenceIds(input); const directIds = directEvidenceIds(input)
  sourceProblemNodeIds.forEach(id => { if (!knownNodes.has(id)) throw new ValidationError(`unknown problem node ID ${id}`, '$.gaps[].sourceProblemNodeIds', 'INVALID_PROVENANCE') })
  sourceClaimIds.forEach(id => { if (!knownClaims.has(id)) throw new ValidationError(`unknown claim ID ${id}`, '$.gaps[].sourceClaimIds', 'INVALID_PROVENANCE') })
  ;[...rawSourceEvidenceIds, ...interpretationEvidenceIds, ...supportingEvidenceIds, ...contradictingEvidenceIds].forEach(id => { if (!knownEvidence.has(id)) throw new ValidationError(`unknown evidence ID ${id}`, '$.gaps[].sourceEvidenceIds', 'INVALID_PROVENANCE') })
  rawSourceEvidenceIds.forEach(id => { if (!directIds.has(id)) throw new ValidationError(`model interpretation evidence ${id} cannot be source evidence`, '$.gaps[].sourceEvidenceIds', 'INVALID_PROVENANCE') })
  ;[...supportingEvidenceIds, ...contradictingEvidenceIds].forEach(id => { if (!directIds.has(id)) throw new ValidationError(`model interpretation evidence ${id} cannot support a scientific gap`, '$.gaps[].supportingEvidenceIds', 'INVALID_PROVENANCE') })
  const evidenceById = new Map(evidenceFromInput(input).map(evidence => [evidence.evidenceId, evidence]))
  const coverageReference = hasCoverageEvidence([...rawSourceEvidenceIds, ...interpretationEvidenceIds, ...supportingEvidenceIds, ...contradictingEvidenceIds], evidenceById)
  const scientificClaims = new Set((input.evidenceGraph?.claims ?? input.claims ?? []).filter(claim => claim.provenance.sourceType !== 'model').map(claim => claim.claimId as string))
  const scientificNodes = new Set(input.problemGraph.nodes.filter(node => node.evidenceIds.length === 0 || node.evidenceIds.some(id => directIds.has(id as string))).map(node => node.nodeId as string))
  const scientificReference = sourceProblemNodeIds.some(id => scientificNodes.has(id)) || sourceClaimIds.some(id => scientificClaims.has(id)) || rawSourceEvidenceIds.some(id => !hasCoverageEvidence([id], evidenceById))
  // Coverage is a policy boundary.  Do not silently default an omitted or
  // misspelled state to SCIENTIFIC, because that would let a model bypass the
  // coverage-only generation firewall.
  const coverageStateText = text(item.coverageState)
  if (!['SCIENTIFIC', 'COVERAGE_ONLY', 'MIXED'].includes(coverageStateText)) {
    throw new ValidationError('coverageState must be SCIENTIFIC, COVERAGE_ONLY, or MIXED', '$.gaps[].coverageState', 'INVALID_GAP_STATE')
  }
  const requestedCoverageState = coverageStateText as GapCoverageState
  const requestedCoverageKind = COVERAGE_KINDS.includes(kindText as CoverageGapKind)
  // Coverage taxonomy is authoritative even when a model labels the record
  // MIXED or SCIENTIFIC; coverage-only records cannot be promoted by wording.
  let coverageState: GapCoverageState = requestedCoverageKind ? 'COVERAGE_ONLY' : requestedCoverageState === 'MIXED' ? 'MIXED' : requestedCoverageState === 'COVERAGE_ONLY' ? 'COVERAGE_ONLY' : 'SCIENTIFIC'
  let canonicalKind: GapKind = kindText as GapKind
  const coverageWording = /incomplete coverage|coverage.{0,30}incomplete|coverage limitation|deferred|no[_ -]?results|failed retrieval|abstract[- ]only|full[- ]text unavailable|missing quantitative|budget exhaustion/i.test(statement)
  // Explicit coverage language is itself a coverage boundary.  Even if the
  // model attaches a scientific node, it cannot promote that limitation into
  // a generative scientific gap; the deterministic baseline already preserves
  // the source-backed scientific record separately.
  if (coverageState === 'COVERAGE_ONLY' || coverageWording || (coverageReference && !scientificReference)) {
    coverageState = 'COVERAGE_ONLY'
    canonicalKind = coverageKindFor(input, baseline, statement, [...rawSourceEvidenceIds, ...interpretationEvidenceIds])
  }
  if (coverageState === 'MIXED' && !scientificReference) throw new ValidationError('mixed gap requires independent scientific provenance', '$.gaps[]', 'INVALID_PROVENANCE')
  if (coverageState === 'SCIENTIFIC' && !scientificReference) throw new ValidationError('scientific gap requires independent scientific provenance', '$.gaps[]', 'INVALID_PROVENANCE')
  const exactSource = sourceTextMatches(input, statement, evidenceById)
  const epistemicStatus: GapEpistemicStatus = exactSource ? 'OBSERVED' : 'MODEL_INTERPRETATION'
  const sourceIds = sorted([...sourceProblemNodeIds, ...sourceClaimIds, ...rawSourceEvidenceIds])
  const gapId = deterministicId('research_gap', { kind: canonicalKind, statement: normalize(statement), sourceIds }) as string
  const candidate: ResearchGap = {
    gapId, kind: canonicalKind, statement, coverageState, epistemicStatus,
    sourceProblemNodeIds: sourceProblemNodeIds.sort(), sourceClaimIds: sourceClaimIds.sort(), sourceEvidenceIds: rawSourceEvidenceIds.sort(), interpretationEvidenceIds: interpretationEvidenceIds.sort(), supportingEvidenceIds: supportingEvidenceIds.sort(), contradictingEvidenceIds: contradictingEvidenceIds.sort(),
    originatingLimitations: origins.limitations, originatingOpenQuestions: origins.openQuestions, originatingAssumptions: origins.assumptions, originatingFailureCases: origins.failureCases,
    eligibility: coverageState === 'COVERAGE_ONLY' ? { eligible: false, code: 'COVERAGE_FOLLOWUP_REQUIRED', reason: 'coverage limitations require follow-up and cannot seed a hypothesis alone' } : scientificReference ? { eligible: true, code: 'ELIGIBLE_RESEARCH_GAP', reason: 'model-synthesized gap has independent scientific provenance' } : { eligible: false, code: 'MIXED_RESEARCH_COMPONENT_REQUIRED', reason: 'scientific interpretation has no independent provenance' },
    uncertainty: { level: finite((item.uncertainty as Record<string, unknown> | undefined)?.level, '$.gaps[].uncertainty.level', exactSource ? 0.55 : 0.8), reasons: strings((item.uncertainty as Record<string, unknown> | undefined)?.reasons, '$.gaps[].uncertainty.reasons') },
    rationale: exactSource ? `source-grounded gap normalized from explicit scientific content: ${statement}` : `model interpretation synthesized from bounded scientific context: ${statement}`,
  }
  validateResearchGap(candidate, { problemNodeIds: knownNodes, claimIds: knownClaims, evidenceIds: knownEvidence, directEvidenceIds: directIds })
  return candidate
}

function modelRequest(projection: M5AScientificInputProjection, options: M5AGapReasoningOptions, attemptNumber: number): ModelRequest<unknown> {
  if (!options.route) throw new ValidationError('route is required when GapDiscovery model reasoning is enabled', '$.route', 'INVALID_MODEL_ROUTE')
  const skillVersion = options.skillVersion ?? 'gap-discovery@1'
  return {
    role: 'GapDiscovery', stage: 'GAP_DISCOVERY', route: options.route, skillVersion,
    inputArtifactIds: (options.inputArtifactIds ?? [projection.projectionId]) as never, inputEvidenceIds: projection.includedEvidenceIds as never, schemaVersion: 'm5a.1', attemptId: deterministicId('attempt', { role: 'GapDiscovery', projectionId: projection.projectionId, skillVersion, attemptNumber }) as string,
    input: {
      projection,
      contract: {
        envelope: 'object with exactly one property: gaps',
        gaps: 'array of gap objects; an empty array is valid',
        fields: {
          kind: 'required enum: OPEN_QUESTION | KNOWN_LIMITATION | UNTESTED_ASSUMPTION | CONTRADICTORY_EVIDENCE | UNEXPLAINED_FAILURE | METHOD_INCOMPATIBILITY | MISSING_COMPARISON | UNRESOLVED_MECHANISM | INCOMPLETE_EVIDENCE_COVERAGE | DEFERRED_EVIDENCE_WORK | FAILED_RETRIEVAL | NO_RESULTS_RETRIEVAL | ABSTRACT_ONLY_EVIDENCE | MISSING_QUANTITATIVE_EVIDENCE | BUDGET_EXHAUSTION',
          coverageState: 'required enum: SCIENTIFIC | COVERAGE_ONLY | MIXED',
          statement: 'required non-empty string', rationale: 'optional non-empty string',
          sourceProblemNodeIds: 'optional string[]; only IDs in the supplied projection',
          sourceClaimIds: 'optional string[]; only IDs in the supplied projection',
          sourceEvidenceIds: 'optional direct evidence ID[]; only IDs in the supplied projection',
          interpretationEvidenceIds: 'optional model-interpretation evidence ID[]; only IDs in the supplied projection',
          supportingEvidenceIds: 'optional direct evidence ID[]', contradictingEvidenceIds: 'optional direct evidence ID[]',
          originatingLimitations: 'optional limitation-node ID[]', originatingOpenQuestions: 'optional open-question-node ID[]',
          originatingAssumptions: 'optional assumption-node ID[]', originatingFailureCases: 'optional failure-case-node ID[]',
          uncertainty: 'optional object { level: number in [0,1], reasons: string[] }',
          epistemicStatus: 'optional advisory enum OBSERVED | MODEL_INTERPRETATION | UNRESOLVED; recomputed from bounded source content',
        },
        additionalProperties: false,
        forbiddenFields: ['gapId', 'gapType', 'eligibility', 'sourceIds', 'claimIds', 'evidenceIds'],
        semantics: 'Coverage-only gaps are never eligible for Generation 0. Do not claim novelty, truth, falsity, absence, support, or completeness; do not invent IDs.',
      },
    }, outputSchema: 'ResearchGapOutput',
  }
}

function parseEnvelope(value: unknown): readonly unknown[] {
  const envelope = object(value, '$') as RawGapEnvelope
  rejectUnknownFields(envelope as unknown as Record<string, unknown>, new Set(['gaps']), '$')
  if (!Array.isArray(envelope.gaps)) throw new ValidationError('model output must contain gaps[]', '$.gaps', 'INVALID_MODEL_OUTPUT')
  return envelope.gaps
}

function mergedDiscovery(baseline: GapDiscoveryResult, modelGaps: readonly ResearchGap[], rejected: readonly M5AGapReasoningRejection[], projection: M5AScientificInputProjection): GapDiscoveryResult {
  const byId = new Map<string, ResearchGap>(baseline.gaps.map(gap => [gap.gapId, gap]))
  const duplicates = [...baseline.duplicates]
  for (const gap of modelGaps) {
    const existing = byId.get(gap.gapId)
    if (existing) duplicates.push({ keptGapId: existing.gapId, duplicateSignature: gapSignature(gap), rejectedStatement: gap.statement, reason: 'model gap duplicates an accepted deterministic gap' })
    else byId.set(gap.gapId, gap)
  }
  const gaps = [...byId.values()].sort((a, b) => a.gapId.localeCompare(b.gapId))
  return { ...baseline, gaps, rejected: [...baseline.rejected, ...rejected.map(item => ({ signature: normalize(item.statement ?? item.reason), reason: item.reason, source: 'GapDiscovery:model' }))], duplicates, limitations: [...new Set([...baseline.limitations, ...projection.limitations])].sort(), sourceIds: sorted(gaps.flatMap(gap => [...gap.sourceProblemNodeIds, ...gap.sourceClaimIds, ...gap.sourceEvidenceIds, ...gap.interpretationEvidenceIds])) }
}

export async function runModelGapDiscovery(input: GapDiscoveryInput, options: M5AGapReasoningOptions = {}): Promise<M5AGapReasoningResult> {
  const now = options.now ?? input.now
  const baseline = discoverResearchGaps({ ...input, now })
  const projection = projectM5AInput(input, baseline.gaps, options.projectionLimits)
  const attempts: M5AGapReasoningAttempt[] = []
  const rejected: M5AGapReasoningRejection[] = []
  if (!options.gateway) return { schemaVersion: 'm5a.gap-reasoning.v1', gapDiscovery: baseline, baseline, modelGaps: [], rejected, projection, attempts, modelAttempted: false, limitations: [...projection.limitations] }
  const retries = Math.max(0, Math.min(options.maxSerializationRetries ?? 1, 1))
  let priorErrors: string[] = []
  const accepted: ResearchGap[] = []
  for (let attemptNumber = 1; attemptNumber <= retries + 1; attemptNumber++) {
    const baseRequest = modelRequest(projection, options, attemptNumber)
    const request = attemptNumber === 1 ? baseRequest : { ...baseRequest, input: { ...(baseRequest.input as Record<string, unknown>), serializationRetry: { validationErrors: priorErrors, instruction: 'Return corrected JSON only. Preserve the same scientific context and IDs; do not change scientific content.' } } }
    const result = await options.gateway.structured<unknown>(request)
    if (!result.ok) {
      const errors = [result.error]
      const serialization = result.diagnostic?.parseStatus === 'failure' || result.diagnostic?.schemaValidationStatus === 'failure'
      const record: M5AGapReasoningAttempt = { attemptNumber, attemptId: request.attemptId, status: 'FAILED', failureKind: serialization ? 'SERIALIZATION' : 'TRANSPORT', validationErrors: errors, request, diagnostic: result.diagnostic }
      attempts.push(record)
      options.gateway.annotateAttempt?.(request.attemptId, { schemaValidationStatus: 'failure', status: 'FAILED', validationErrors: errors, error: result.error })
      if (serialization && attemptNumber <= retries) { priorErrors = errors; continue }
      rejected.push({ reason: result.error })
      break
    }
    try {
      const rawGaps = parseEnvelope(result.value)
      const modelGaps = rawGaps.map(item => canonicalGap(item, boundedInput(input, projection), baseline))
      const diagnostic = result.diagnostic ? { ...result.diagnostic, schemaValidationStatus: 'success' as const, status: 'SUCCEEDED' as const } : undefined
      attempts.push({ attemptNumber, attemptId: request.attemptId, status: 'SUCCEEDED', validationErrors: [], request, diagnostic })
      options.gateway.annotateAttempt?.(request.attemptId, { schemaValidationStatus: 'success', status: 'SUCCEEDED' })
      accepted.push(...modelGaps)
      break
    } catch (error) {
      const message = error instanceof Error ? error.message : 'invalid GapDiscovery model output'
      priorErrors = [message]
      const diagnostic = result.diagnostic ? { ...result.diagnostic, schemaValidationStatus: 'failure' as const, status: 'FAILED' as const, validationErrors: priorErrors } : undefined
      attempts.push({ attemptNumber, attemptId: request.attemptId, status: 'FAILED', failureKind: 'SCHEMA', validationErrors: priorErrors, request, diagnostic })
      options.gateway.annotateAttempt?.(request.attemptId, { schemaValidationStatus: 'failure', status: 'FAILED', validationErrors: priorErrors, error: message })
      // Only malformed/structurally invalid JSON is retryable. Provenance,
      // coverage, and unsupported-science failures terminate this model call.
      // A missing/unknown coverage state is a semantic contract violation,
      // even though it uses the model-output diagnostic code for compatibility;
      // do not spend a retry trying to guess a scientific boundary.
      const retryable = !(error instanceof ValidationError) || (error.code === 'INVALID_MODEL_OUTPUT' && !error.path.endsWith('.coverageState'))
      if (retryable && attemptNumber <= retries) continue
      rejected.push({ reason: message, validationCode: error instanceof ValidationError ? error.code : undefined })
      break
    }
  }
  const gapDiscovery = mergedDiscovery(baseline, accepted, rejected, projection)
  return { schemaVersion: 'm5a.gap-reasoning.v1', gapDiscovery, baseline, modelGaps: accepted, rejected, projection, attempts, modelAttempted: true, limitations: [...new Set([...projection.limitations, ...(rejected.length ? ['One or more model gap outputs were rejected; accepted gaps remain bounded by deterministic validation.'] : [])])].sort() }
}

export const runM5AGapReasoning = runModelGapDiscovery
export const buildM5AGapReasoning = runModelGapDiscovery

/** Compatibility names for callers that refer to the transport envelope directly. */
export type GapDiscoveryModelOutput = { readonly gaps: readonly unknown[] }
export type M5AGapDiscoveryAttempt = M5AGapReasoningAttempt

