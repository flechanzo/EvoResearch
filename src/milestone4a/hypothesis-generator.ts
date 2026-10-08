import { deterministicId } from '../domain/ids.ts'
import type { Hypothesis, Evidence } from '../domain/types.ts'
import type { ModelRequest } from '../domain/extraction.ts'
import { ValidationError } from '../domain/validation.ts'
import type {
  Generation0Hypothesis, Generation0Population, GenerationOperator, GapDiscoveryResult, HypothesisGenerationInput,
  HypothesisGeneratorCandidate, HypothesisGeneratorOutput, HypothesisGeneratorOptions, HypothesisGenerationRejection,
  HypothesisDuplicateDecision, M4AModelAttempt, ResearchGap,
} from './types.ts'
import { validateGeneration0Hypothesis, validateResearchGap } from './validation.ts'

function sorted(values: Iterable<string>): string[] { return [...new Set([...values].filter(Boolean))].sort((a, b) => a.localeCompare(b)) }
function text(value: unknown): string { return typeof value === 'string' ? value.trim() : '' }
function strings(value: unknown, field: string): readonly string[] { if (value === undefined) return []; if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || !item.trim())) throw new ValidationError(`${field} must be a string array`, `$.${field}`, 'INVALID_MODEL_OUTPUT'); return value.map(item => item.trim()) }
function normalize(value: string): string { return value.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim() }
function directEvidence(item: Evidence & Record<string, unknown>): boolean { return item.sourceTextVerified !== false && item.modelInterpretation !== true && item.evidenceLevel !== 'MODEL_INTERPRETATION' && !(item.kind === 'interpretation' && item.provenance.sourceType === 'model') }

/**
 * Keep the model transport contract closed.  The materializer deliberately
 * derives hypothesisId and all later-stage identifiers, so accepting an
 * arbitrary extra field here would allow a model to smuggle an unvalidated
 * identity or status into the scientific state.  Runtime model gateways use
 * this same parser, therefore malformed wrappers fail before provenance or
 * domain materialization.
 */
const MODEL_CANDIDATE_FIELDS = new Set([
  'candidateId', 'originatingGapIds', 'sourceProblemNodeIds', 'sourceClaimIds',
  'sourceEvidenceIds', 'statement', 'motivation', 'proposedMechanism',
  'expectedMechanism', 'assumptions', 'evidenceFor', 'evidenceAgainst',
  'falsificationConditions', 'expectedObservableResult',
  'discriminativeExperimentIdea', 'generationOperator',
])

function operatorForGap(gap: ResearchGap): GenerationOperator {
  switch (gap.kind) {
    case 'UNTESTED_ASSUMPTION': return 'REMOVE_ASSUMPTION'
    case 'METHOD_INCOMPATIBILITY': return 'TRANSFER_MECHANISM'
    case 'UNEXPLAINED_FAILURE': return 'EXPLAIN_FAILURE'
    case 'CONTRADICTORY_EVIDENCE': return 'NEW_EVALUATION'
    case 'MISSING_COMPARISON': return 'NEW_EVALUATION'
    case 'UNRESOLVED_MECHANISM': return 'NEW_REPRESENTATION'
    case 'OPEN_QUESTION': return 'NEW_OBJECTIVE'
    case 'KNOWN_LIMITATION': return 'REPLACE_COMPONENT'
    default: return 'NEW_OBJECTIVE'
  }
}

function deterministicCandidate(gap: ResearchGap): HypothesisGeneratorCandidate {
  const operator = operatorForGap(gap)
  const proposedMechanism = `Test a bounded intervention that addresses the ${gap.kind.toLowerCase().replaceAll('_', ' ')}: ${gap.statement}`
  return {
    originatingGapIds: [gap.gapId],
    sourceProblemNodeIds: gap.sourceProblemNodeIds,
    sourceClaimIds: gap.sourceClaimIds,
    sourceEvidenceIds: gap.sourceEvidenceIds,
    statement: `A testable intervention can address the following research gap: ${gap.statement}`,
    motivation: gap.rationale,
    proposedMechanism,
    expectedMechanism: `If the intervention addresses the gap, the observed failure or unresolved behavior should change in the direction predicted by the stated mechanism.` ,
    assumptions: [],
    evidenceFor: gap.supportingEvidenceIds,
    evidenceAgainst: gap.contradictingEvidenceIds,
    falsificationConditions: [`Reject the hypothesis if the proposed intervention does not change the gap-linked observable under the preregistered comparison.`],
    expectedObservableResult: `The gap-linked observable changes relative to the stated baseline while the comparison remains valid.`,
    discriminativeExperimentIdea: `Compare the proposed intervention with the current method on the gap-linked case, preserving the same data, metric, and cutoff.`,
    generationOperator: operator,
  }
}

function candidateSignature(candidate: HypothesisGeneratorCandidate): string {
  return normalize(JSON.stringify({ gaps: sorted(candidate.originatingGapIds), mechanism: normalize(candidate.proposedMechanism), observable: normalize(candidate.expectedObservableResult), experiment: normalize(candidate.discriminativeExperimentIdea) }))
}

function candidateId(candidate: HypothesisGeneratorCandidate, index: number): string {
  return candidate.candidateId ?? deterministicId('hypothesis_candidate', { signature: candidateSignature(candidate), index }) as string
}

function modelRequest(input: HypothesisGenerationInput, eligible: readonly ResearchGap[], options: HypothesisGeneratorOptions): ModelRequest<HypothesisGeneratorOutput> {
  const route = options.route
  if (!route) throw new ValidationError('route is required when a ModelGateway is supplied', '$.route', 'INVALID_MODEL_ROUTE')
  const attemptId = deterministicId('attempt', { role: 'HypothesisGenerator', gapIds: eligible.map(gap => gap.gapId), skillVersion: options.skillVersion ?? 'hypothesis-generator@1', serializationRetry: options.previousValidationErrors?.length ? 1 : 0 }) as string
  return {
    role: 'HypothesisGenerator', stage: 'HYPOTHESIS_GENERATE', route, skillVersion: options.skillVersion ?? 'hypothesis-generator@1', inputArtifactIds: (options.inputArtifactIds ?? []) as never, inputEvidenceIds: sorted(eligible.flatMap(gap => gap.sourceEvidenceIds)) as never, schemaVersion: 'm4a.1', attemptId,
    input: {
      generation: 0,
      gaps: eligible.map(gap => ({ gapId: gap.gapId, kind: gap.kind, statement: gap.statement, sourceProblemNodeIds: gap.sourceProblemNodeIds, sourceClaimIds: gap.sourceClaimIds, sourceEvidenceIds: gap.sourceEvidenceIds, supportingEvidenceIds: gap.supportingEvidenceIds, contradictingEvidenceIds: gap.contradictingEvidenceIds, uncertainty: gap.uncertainty })),
      contract: {
        envelope: 'object with exactly one property: hypotheses',
        hypotheses: 'array of candidate objects; an empty array is valid',
        fields: {
          candidateId: 'optional non-empty string (caller identity only; do not use as hypothesisId)',
          originatingGapIds: 'non-empty string[]; only supplied eligible gap IDs',
          sourceProblemNodeIds: 'optional string[]; only supplied problem node IDs',
          sourceClaimIds: 'optional string[]; only supplied claim IDs',
          sourceEvidenceIds: 'optional string[]; only supplied direct evidence IDs',
          statement: 'required non-empty string', motivation: 'required non-empty string',
          proposedMechanism: 'required non-empty string', expectedMechanism: 'required non-empty string',
          assumptions: 'optional string[]', evidenceFor: 'optional direct evidence ID[]', evidenceAgainst: 'optional direct evidence ID[]',
          falsificationConditions: 'required non-empty string[]', expectedObservableResult: 'required non-empty string',
          discriminativeExperimentIdea: 'required non-empty string',
          generationOperator: 'optional enum: REMOVE_ASSUMPTION | COMBINE_METHODS | TRANSFER_MECHANISM | REPLACE_COMPONENT | RELAX_CONSTRAINT | EXPLAIN_FAILURE | NEW_OBJECTIVE | NEW_REPRESENTATION | NEW_EVALUATION | CROSS_DOMAIN_TRANSFER',
        },
        additionalProperties: false,
        forbiddenFields: ['hypothesisId', 'gapId', 'claimIds', 'evidenceIds', 'status', 'noveltyStatus', 'noveltyEvidence', 'noveltyEstimate', 'parentIds', 'priorArtReportIds', 'criticismIds', 'experimentIds', 'resultEvidenceIds', 'mutationEdgeIds'],
        semantics: 'Generation 0 is provisional and novelty-unverified; do not assert novelty, truth, falsity, support, survival, or completeness.',
      },
      ...(options.previousValidationErrors?.length ? { serializationRetry: { validationErrors: [...options.previousValidationErrors], instruction: 'Return corrected JSON only. Keep the same scientific context, gaps, IDs, and candidate meaning; change formatting/schema only.' } } : {}),
      problemNodeCount: input.problemGraph.nodes.length,
    },
    outputSchema: 'HypothesisGeneratorOutput',
  }
}

function parseModelOutput(value: unknown): HypothesisGeneratorCandidate[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ValidationError('model output must be an object', '$', 'INVALID_MODEL_OUTPUT')
  const hypotheses = (value as { hypotheses?: unknown }).hypotheses
  if (!Array.isArray(hypotheses)) throw new ValidationError('model output must contain hypotheses[]', '$.hypotheses', 'INVALID_MODEL_OUTPUT')
  return hypotheses.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new ValidationError('candidate must be an object', `$.hypotheses[${index}]`, 'INVALID_MODEL_OUTPUT')
    const candidate = item as Record<string, unknown>
    const unknownField = Object.keys(candidate).find(key => !MODEL_CANDIDATE_FIELDS.has(key))
    if (unknownField) throw new ValidationError(`unsupported field ${unknownField}`, `$.hypotheses[${index}].${unknownField}`, 'INVALID_MODEL_OUTPUT')
    const originatingGapIds = strings(candidate.originatingGapIds, `hypotheses[${index}].originatingGapIds`)
    const sourceProblemNodeIds = strings(candidate.sourceProblemNodeIds, `hypotheses[${index}].sourceProblemNodeIds`)
    const sourceClaimIds = strings(candidate.sourceClaimIds, `hypotheses[${index}].sourceClaimIds`)
    const sourceEvidenceIds = strings(candidate.sourceEvidenceIds, `hypotheses[${index}].sourceEvidenceIds`)
    const evidenceFor = strings(candidate.evidenceFor, `hypotheses[${index}].evidenceFor`)
    const evidenceAgainst = strings(candidate.evidenceAgainst, `hypotheses[${index}].evidenceAgainst`)
    const statement = text(candidate.statement); const motivation = text(candidate.motivation); const proposedMechanism = text(candidate.proposedMechanism); const expectedMechanism = text(candidate.expectedMechanism); const expectedObservableResult = text(candidate.expectedObservableResult); const discriminativeExperimentIdea = text(candidate.discriminativeExperimentIdea)
    const falsificationConditions = strings(candidate.falsificationConditions, `hypotheses[${index}].falsificationConditions`)
    for (const [key, value] of Object.entries({ statement, motivation, proposedMechanism, expectedMechanism, expectedObservableResult, discriminativeExperimentIdea })) if (!value) throw new ValidationError(`${key} is required`, `$.hypotheses[${index}].${key}`, 'INVALID_MODEL_OUTPUT')
    if (!falsificationConditions.length) throw new ValidationError('falsificationConditions cannot be empty', `$.hypotheses[${index}].falsificationConditions`, 'INVALID_MODEL_OUTPUT')
    return { candidateId: text(candidate.candidateId) || undefined, originatingGapIds, sourceProblemNodeIds, sourceClaimIds, sourceEvidenceIds, statement, motivation, proposedMechanism, expectedMechanism, assumptions: strings(candidate.assumptions, `hypotheses[${index}].assumptions`), evidenceFor, evidenceAgainst, falsificationConditions, expectedObservableResult, discriminativeExperimentIdea, generationOperator: candidate.generationOperator as GenerationOperator | undefined }
  })
}

function materialize(candidate: HypothesisGeneratorCandidate, gapsById: ReadonlyMap<string, ResearchGap>, inputCompleteness: GapDiscoveryResult['completeness'], now: string, knownProblemNodeIds: ReadonlySet<string>, knownClaimIds: ReadonlySet<string>, directEvidenceIds: ReadonlySet<string>): Generation0Hypothesis {
  const gaps = candidate.originatingGapIds.map(id => gapsById.get(id)).filter((gap): gap is ResearchGap => Boolean(gap))
  if (!gaps.length) throw new ValidationError('candidate references no known gap', '$.originatingGapIds', 'INVALID_PROVENANCE')
  if (gaps.some(gap => !gap.eligibility.eligible || gap.coverageState === 'COVERAGE_ONLY')) throw new ValidationError('coverage-only gap cannot seed a hypothesis', '$.originatingGapIds', 'COVERAGE_NOT_GENERATIVE')
  const sourceProblemNodeIds = sorted(candidate.sourceProblemNodeIds?.length ? candidate.sourceProblemNodeIds : gaps.flatMap(gap => gap.sourceProblemNodeIds))
  const sourceClaimIds = sorted(candidate.sourceClaimIds?.length ? candidate.sourceClaimIds : gaps.flatMap(gap => gap.sourceClaimIds))
  const sourceEvidenceIds = sorted(candidate.sourceEvidenceIds?.length ? candidate.sourceEvidenceIds : gaps.flatMap(gap => gap.sourceEvidenceIds))
  if (sourceProblemNodeIds.some(id => !knownProblemNodeIds.has(id))) throw new ValidationError('candidate contains unknown problem node ID', '$.sourceProblemNodeIds', 'INVALID_PROVENANCE')
  if (sourceClaimIds.some(id => !knownClaimIds.has(id))) throw new ValidationError('candidate contains unknown claim ID', '$.sourceClaimIds', 'INVALID_PROVENANCE')
  if (sourceEvidenceIds.some(id => !directEvidenceIds.has(id))) throw new ValidationError('candidate attempts to use model interpretation or unknown evidence as source evidence', '$.sourceEvidenceIds', 'INVALID_PROVENANCE')
  const gapEvidence = new Set(gaps.flatMap(gap => gap.sourceEvidenceIds)); if (sourceEvidenceIds.some(id => !gapEvidence.has(id))) throw new ValidationError('candidate source evidence is outside originating gap provenance', '$.sourceEvidenceIds', 'INVALID_PROVENANCE')
  const evidenceFor = sorted(candidate.evidenceFor?.length ? candidate.evidenceFor : gaps.flatMap(gap => gap.supportingEvidenceIds)); const evidenceAgainst = sorted(candidate.evidenceAgainst?.length ? candidate.evidenceAgainst : gaps.flatMap(gap => gap.contradictingEvidenceIds))
  if (evidenceFor.some(id => !sourceEvidenceIds.includes(id)) || evidenceAgainst.some(id => !sourceEvidenceIds.includes(id))) throw new ValidationError('evidence references must be source evidence', '$.evidenceFor', 'INVALID_PROVENANCE')
  const generationOperator = candidate.generationOperator ?? operatorForGap(gaps[0])
  const signature = candidateSignature({ ...candidate, originatingGapIds: sorted(candidate.originatingGapIds), proposedMechanism: candidate.proposedMechanism, expectedObservableResult: candidate.expectedObservableResult, discriminativeExperimentIdea: candidate.discriminativeExperimentIdea })
  const hypothesisId = deterministicId('hypothesis', { generation: 0, signature }) as never
  const base: Hypothesis = { hypothesisId, generation: 0 as const, parentIds: [], statement: candidate.statement, motivation: candidate.motivation, method: candidate.proposedMechanism, assumptions: [...(candidate.assumptions ?? [])], evidenceFor: evidenceFor as never, evidenceAgainst: evidenceAgainst as never, priorArtReportIds: [], criticismIds: [], experimentIds: [], resultEvidenceIds: [], mutationEdgeIds: [], dimensions: {}, status: 'candidate', createdAt: now, updatedAt: now }
  const hypothesis = { ...base, generation: 0 as const, originatingGapIds: sorted(candidate.originatingGapIds), sourceProblemNodeIds, sourceClaimIds, sourceEvidenceIds, proposedMechanism: candidate.proposedMechanism, expectedMechanism: candidate.expectedMechanism, falsificationConditions: candidate.falsificationConditions, expectedObservableResult: candidate.expectedObservableResult, discriminativeExperimentIdea: candidate.discriminativeExperimentIdea, generationOperator, epistemicStatus: 'PROVISIONAL_UNVERIFIED' as const, noveltyStatus: 'UNVERIFIED' as const, uncertainty: { level: Math.max(...gaps.map(gap => gap.uncertainty.level)), reasons: sorted(gaps.flatMap(gap => gap.uncertainty.reasons)) }, inputCompleteness } satisfies Generation0Hypothesis
  validateGeneration0Hypothesis(hypothesis, { gaps: gapsById, problemNodeIds: knownProblemNodeIds, claimIds: knownClaimIds, evidenceIds: directEvidenceIds, directEvidenceIds })
  return hypothesis
}

export async function generateGeneration0Hypotheses(input: HypothesisGenerationInput, options: HypothesisGeneratorOptions = {}): Promise<Generation0Population> {
  const now = options.now ?? input.gapDiscovery.generatedAt
  const candidateBudget = Math.max(0, Math.floor(options.candidateBudget ?? input.gapDiscovery.gaps.length))
  const skillVersion = options.skillVersion ?? (options.gateway ? 'hypothesis-generator@1' : 'hypothesis-generator@deterministic-1')
  const gapsById = new Map(input.gapDiscovery.gaps.map(gap => [gap.gapId, gap]))
  const evidence = input.evidence ?? []
  const knownEvidenceIds = new Set(evidence.length ? evidence.map(item => item.evidenceId) : input.gapDiscovery.inputSummary.evidenceIds)
  const persistedDirectEvidenceIds = input.gapDiscovery.gaps.flatMap(gap => gap.sourceEvidenceIds.filter(id => !gap.interpretationEvidenceIds.includes(id)))
  const directEvidenceIds = new Set(evidence.length ? evidence.filter(directEvidence).map(item => item.evidenceId) : persistedDirectEvidenceIds)
  const knownProblemNodeIds = new Set(input.problemGraph.nodes.map(node => node.nodeId))
  const knownClaimIds = new Set(input.claims?.map(claim => claim.claimId) ?? input.gapDiscovery.inputSummary.claimIds)
  // Validate the persisted gap artifact before selecting candidates or making a
  // model request. A caller must not be able to turn an ungrounded/malformed
  // record into a Generation-0 hypothesis by setting eligibility=true.
  for (const gap of input.gapDiscovery.gaps) validateResearchGap(gap, { problemNodeIds: knownProblemNodeIds, claimIds: knownClaimIds, evidenceIds: knownEvidenceIds, directEvidenceIds })
  const eligible = input.gapDiscovery.gaps.filter(gap => gap.eligibility.eligible && gap.coverageState !== 'COVERAGE_ONLY').sort((a, b) => a.gapId.localeCompare(b.gapId)).slice(0, candidateBudget)
  const rejected: HypothesisGenerationRejection[] = []
  const duplicates: HypothesisDuplicateDecision[] = []
  const modelAttempts: M4AModelAttempt[] = []
  let candidates: HypothesisGeneratorCandidate[]
  if (options.gateway) {
    const request = modelRequest(input, eligible, options)
    const result = await options.gateway.structured<HypothesisGeneratorOutput>(request)
    if (!result.ok) {
      modelAttempts.push({ attemptId: request.attemptId, ok: false, validationErrors: [result.error], diagnostic: result.diagnostic, request })
      return { schemaVersion: 'm4a.generation-0.v1', generation: 0, generatedAt: now, hypotheses: [], candidateBudget, skillVersion, inputCompleteness: input.gapDiscovery.completeness, inputSummary: { problemNodeIds: input.problemGraph.nodes.map(node => node.nodeId).sort(), claimIds: (input.claims ?? []).map(claim => claim.claimId).sort(), evidenceIds: evidence.map(item => item.evidenceId).sort() }, limitations: [...input.gapDiscovery.limitations, 'HypothesisGenerator model output was unavailable; generation failed closed.'], rejected: [{ originatingGapIds: [], reason: result.error }], duplicates: [], modelAttempts, provenance: [] }
    }
    try { candidates = parseModelOutput(result.value); modelAttempts.push({ attemptId: request.attemptId, ok: true, validationErrors: [], diagnostic: result.diagnostic, request }) } catch (error) { const message = error instanceof Error ? error.message : 'invalid model output'; modelAttempts.push({ attemptId: request.attemptId, ok: false, validationErrors: [message], diagnostic: result.diagnostic, request }); return { schemaVersion: 'm4a.generation-0.v1', generation: 0, generatedAt: now, hypotheses: [], candidateBudget, skillVersion, inputCompleteness: input.gapDiscovery.completeness, inputSummary: { problemNodeIds: input.problemGraph.nodes.map(node => node.nodeId).sort(), claimIds: (input.claims ?? []).map(claim => claim.claimId).sort(), evidenceIds: evidence.map(item => item.evidenceId).sort() }, limitations: [...input.gapDiscovery.limitations, 'HypothesisGenerator model output failed structural validation; generation failed closed.'], rejected: [{ originatingGapIds: [], reason: message }], duplicates: [], modelAttempts, provenance: [] } }
  } else {
    candidates = eligible.map(gap => deterministicCandidate(gap))
  }
  const hypotheses: Generation0Hypothesis[] = []
  const seen = new Map<string, Generation0Hypothesis>()
  for (const [index, candidate] of candidates.slice(0, candidateBudget).entries()) {
    const id = candidateId(candidate, index)
    try {
      const hypothesis = materialize(candidate, gapsById, input.gapDiscovery.completeness, now, knownProblemNodeIds, knownClaimIds, directEvidenceIds)
      const signature = candidateSignature(candidate)
      const previous = seen.get(signature)
      if (previous) { duplicates.push({ keptHypothesisId: previous.hypothesisId, duplicateSignature: signature, rejectedCandidateId: id, reason: 'normalized gap, mechanism, and expected test signature already accepted' }); continue }
      seen.set(signature, hypothesis); hypotheses.push(hypothesis)
    } catch (error) { rejected.push({ candidateId: id, originatingGapIds: candidate.originatingGapIds, reason: error instanceof Error ? error.message : 'candidate rejected' }) }
  }
  return { schemaVersion: 'm4a.generation-0.v1', generation: 0, generatedAt: now, hypotheses: hypotheses.sort((a, b) => a.hypothesisId.localeCompare(b.hypothesisId)), candidateBudget, skillVersion, inputCompleteness: input.gapDiscovery.completeness, inputSummary: { problemNodeIds: input.problemGraph.nodes.map(node => node.nodeId).sort(), claimIds: (input.claims ?? []).map(claim => claim.claimId).sort(), evidenceIds: evidence.map(item => item.evidenceId).sort() }, limitations: input.gapDiscovery.limitations, rejected, duplicates, modelAttempts, provenance: hypotheses.map(hypothesis => ({ hypothesisId: hypothesis.hypothesisId, gapIds: hypothesis.originatingGapIds, problemNodeIds: hypothesis.sourceProblemNodeIds, claimIds: hypothesis.sourceClaimIds, evidenceIds: hypothesis.sourceEvidenceIds })) }
}
