import { canonicalJson, contentHash, deterministicId } from '../domain/ids.ts'
import { parseCheckpoint, parseClaim, parseDomainEvent, parseEvidence, parseResearchProblemGraph } from '../domain/validation.ts'
import type { BudgetLedger, Checkpoint, Claim, DomainEvent, Evidence, ModelGateway, ModelRoute, ResearchProblemGraph, RunId, Timestamp } from '../domain/index.ts'
import type { GapDiscoveryInput, GapDiscoveryResult, Generation0Population, HypothesisGenerationInput, M4ACompleteness } from '../milestone4a/types.ts'
import { generateGeneration0Hypotheses } from '../milestone4a/hypothesis-generator.ts'
import { runModelGapDiscovery, type M5AGapReasoningAttempt, type M5AGapReasoningOptions, type M5AGapReasoningResult } from '../milestone5a/gap-reasoning.ts'
import type { Generation0Boundary, Generation0BoundaryRecord, Generation0RunStore } from '../ports/generation0-run-store.ts'

/** Input shared by the live M3.5C extension and the saved-run importer. */
export interface Generation0ExtensionInput {
  readonly runId: RunId | string
  readonly sourceRunId?: string
  readonly problemGraph: ResearchProblemGraph
  readonly claims: readonly Claim[]
  readonly evidence: readonly (Evidence & Record<string, unknown>)[]
  readonly evidenceGraph?: GapDiscoveryInput['evidenceGraph']
  readonly completeness: M4ACompleteness
  readonly now: Timestamp
  readonly inputArtifactIds?: readonly string[]
  readonly budget?: BudgetLedger
  readonly startingSequence?: number
  readonly candidateBudget?: number
  readonly gapReasoning?: Omit<M5AGapReasoningOptions, 'gateway' | 'route' | 'now' | 'inputArtifactIds'>
  readonly gateway?: ModelGateway
  readonly route?: ModelRoute
  /** Stop Generation-0 when an explicitly requested GapDiscovery model call fails. */
  readonly requireGapModelSuccess?: boolean
  /** Precomputed result used by the imported-run wrapper to avoid repeating GapDiscovery. */
  readonly gapReasoningResult?: M5AGapReasoningResult
  /** Optional bounded gateway used only for Generation-0 after a precomputed gap result. */
  readonly generationGateway?: ModelGateway
  /** Precomputed population from a legacy/import adapter; no model call is made. */
  readonly generation0Result?: Generation0Population
  /** Optional complete state projection used when adapting a legacy canary. */
  readonly stateForHash?: unknown
  /** Events already committed by the caller (for example run/preflight). */
  readonly initialEvents?: readonly DomainEvent[]
  readonly corpusCutoff?: Timestamp
  readonly configuration?: unknown
  readonly store?: Generation0RunStore
}

/** Optional call-site overrides used by the live coordinator and importer. */
export interface Generation0ExtensionOptions {
  readonly gateway?: ModelGateway
  readonly route?: ModelRoute
  readonly candidateBudget?: number
  readonly maxSerializationRetries?: number
  readonly requireGapModelSuccess?: boolean
  /** Imported legacy snapshots may lack source hashes; preserve the gap but mark it unverified upstream. */
  readonly allowUnverifiedEvidence?: boolean
  readonly store?: Generation0RunStore
  /** Build the bounded Generation-0 gateway after GapDiscovery projection exists. */
  readonly generationGatewayFactory?: (gapReasoning: M5AGapReasoningResult) => ModelGateway | undefined
  readonly configuration?: unknown
  readonly corpusCutoff?: Timestamp
}

export type Generation0ExtensionStatus = 'COMPLETE' | 'COMPLETE_EMPTY' | 'NO_ELIGIBLE_GAPS' | 'GAP_MODEL_FAILED' | 'GENERATION_FAILED'

export interface Generation0ExtensionResult {
  readonly status: Generation0ExtensionStatus
  readonly runId: RunId | string
  readonly sourceRunId?: string
  readonly gapReasoning: M5AGapReasoningResult
  readonly gapDiscovery: GapDiscoveryResult
  readonly generation0: Generation0Population
  readonly events: readonly DomainEvent[]
  readonly checkpoint: Checkpoint
  readonly stateHash: string
  readonly acceptedHypothesisCount: number
  readonly limitations: readonly string[]
  readonly boundaryCheckpoints?: Readonly<Partial<Record<Generation0Boundary, Checkpoint>>>
  readonly replayed?: boolean
}

function defaultBudget(candidateBudget: number): BudgetLedger {
  return { limits: { maxModelCalls: 5, maxSearchCalls: 0, maxCandidates: Math.max(0, candidateBudget), maxMutations: 0, maxTokens: 0 }, usage: { maxModelCalls: 0, maxSearchCalls: 0, maxCandidates: 0, maxMutations: 0, maxTokens: 0 } }
}

function withPopulationStatus(population: Generation0Population, status: Generation0ExtensionStatus, reason?: string): Generation0Population {
  return { ...population, generationStatus: status, acceptedHypothesisCount: population.hypotheses.length, ...(reason ? { failureReason: reason } : {}) } as Generation0Population
}

function emptyPopulation(now: Timestamp, gaps: GapDiscoveryResult, candidateBudget: number, limitations: readonly string[], status: Generation0ExtensionStatus, reason?: string): Generation0Population {
  return withPopulationStatus({ schemaVersion: 'm4a.generation-0.v1', generation: 0, generatedAt: now, hypotheses: [], candidateBudget, skillVersion: 'hypothesis-generator@extension', inputCompleteness: gaps.completeness, inputSummary: gaps.inputSummary, limitations: [...gaps.limitations, ...limitations], rejected: [], duplicates: [], modelAttempts: [], provenance: [] }, status, reason)
}

function validateInput(input: Generation0ExtensionInput, options: Generation0ExtensionOptions = {}): void {
  const evidenceIds = new Set<string>(input.evidence.map(item => item.evidenceId))
  parseResearchProblemGraph(input.problemGraph, evidenceIds)
  for (const claim of input.claims) parseClaim(claim)
  for (const evidence of input.evidence) {
    try { parseEvidence(evidence) } catch (error) {
      if (!(options.allowUnverifiedEvidence && error instanceof Error && /paper or artifact quotations require locator and contentHash/i.test(error.message))) throw error
    }
  }
  const claimIds = new Set<string>(input.claims.map(claim => claim.claimId))
  for (const evidence of input.evidence) for (const claimId of evidence.claimIds) if (!claimIds.has(claimId as string)) throw new Error(`INVALID_PROVENANCE: evidence ${evidence.evidenceId} references unknown claim ${claimId}`)
  for (const link of input.evidenceGraph?.links ?? []) {
    if (link.evidenceId && !evidenceIds.has(link.evidenceId as string)) throw new Error(`INVALID_PROVENANCE: evidence link references unknown evidence ${link.evidenceId}`)
    if (link.claimId && !claimIds.has(link.claimId as string)) throw new Error(`INVALID_PROVENANCE: evidence link references unknown claim ${link.claimId}`)
  }
  if (!input.runId || typeof input.runId !== 'string') throw new Error('INVALID_RUN_ID: runId is required')
  if (!input.now || Number.isNaN(Date.parse(input.now))) throw new Error('INVALID_TIMESTAMP: now is required')
}

function makeEvents(input: Generation0ExtensionInput, gap: GapDiscoveryResult, population: Generation0Population, checkpoint: Checkpoint, attempts: readonly M5AGapReasoningAttempt[]): DomainEvent[] {
  const sequenceBase = input.startingSequence ?? 0
  const events: DomainEvent[] = []
  const append = (type: DomainEvent['type'], payload: Readonly<Record<string, unknown>>) => {
    const sequence = sequenceBase + events.length + 1
    events.push({ eventId: deterministicId('event', { runId: input.runId, sequence, type, payload }), runId: input.runId as RunId, sequence, type, occurredAt: input.now, payload })
  }
  append('stage.started', { stage: 'GAP_DISCOVERY' })
  for (const attempt of attempts) append('model.attempt', { stage: 'GAP_DISCOVERY', role: 'GapDiscovery', attemptId: attempt.attemptId, status: attempt.status, validationErrors: attempt.validationErrors })
  append(attempts.some(attempt => attempt.status === 'SUCCEEDED') || !attempts.length ? 'stage.completed' : 'stage.failed', { stage: 'GAP_DISCOVERY', gapCount: gap.gaps.length })
  const generationStatus = (population as Generation0Population & { generationStatus?: string }).generationStatus ?? 'COMPLETE'
  if (generationStatus !== 'GAP_MODEL_FAILED') {
    append('stage.started', { stage: 'GENERATION_0' })
    for (const attempt of population.modelAttempts) append('model.attempt', { stage: 'GENERATION_0', role: 'HypothesisGenerator', attemptId: attempt.attemptId, status: attempt.ok ? 'SUCCEEDED' : 'FAILED', validationErrors: attempt.validationErrors })
    append(generationStatus === 'COMPLETE' || generationStatus === 'COMPLETE_EMPTY' ? 'stage.completed' : 'stage.failed', { stage: 'GENERATION_0', status: generationStatus, acceptedHypothesisCount: population.hypotheses.length })
    for (const hypothesis of population.hypotheses) append('hypothesis.created', { stage: 'GENERATION_0', hypothesisId: hypothesis.hypothesisId, generation: 0, status: hypothesis.status, noveltyStatus: hypothesis.noveltyStatus })
  }
  const checkpointStatus = generationStatus === 'GAP_MODEL_FAILED' ? 'BLOCKED_BY_UPSTREAM' : generationStatus
  append('checkpoint.created', { stage: 'GENERATION_0', checkpointId: checkpoint.checkpointId, gapIds: gap.gaps.map(item => item.gapId), populationIds: checkpoint.populationIds, status: checkpointStatus })
  for (const event of events) parseDomainEvent(event)
  return events
}

function validateEventPrefix(events: readonly DomainEvent[], runId: string): void {
  const ids = new Set<string>()
  for (const [index, event] of events.entries()) {
    parseDomainEvent(event)
    if (event.runId !== runId || event.sequence !== index + 1) throw new Error('RUNSTORE_EVENT_SEQUENCE_MISMATCH: initial events must be contiguous for this run')
    if (ids.has(event.eventId)) throw new Error('RUNSTORE_EVENT_ID_MISMATCH: initial event IDs must be unique')
    ids.add(event.eventId)
  }
}

function appendEvent(events: DomainEvent[], input: Generation0ExtensionInput, type: DomainEvent['type'], payload: Readonly<Record<string, unknown>>): void {
  const sequence = events.length + 1
  const event = { eventId: deterministicId('event', { runId: input.runId, sequence, type, payload }) as DomainEvent['eventId'], runId: input.runId as RunId, sequence, type, occurredAt: input.now, payload }
  parseDomainEvent(event)
  events.push(event)
}

function boundaryRecord(input: Generation0ExtensionInput, boundary: Generation0Boundary, state: unknown, value: unknown, events: DomainEvent[], budget: BudgetLedger, populationIds: readonly string[] = []): Generation0BoundaryRecord {
  const stateHash = contentHash(canonicalJson(state))
  const sequence = events.length + 1
  const checkpoint: Checkpoint = { checkpointId: deterministicId('checkpoint', { runId: input.runId, boundary, sequence, stateHash }), runId: input.runId as RunId, sequence, stateHash, populationIds: populationIds as never, budget, createdAt: input.now }
  const boundaryStatus = boundary === 'GENERATION_0' && (value as { generation0?: { generationStatus?: string } } | undefined)?.generation0?.generationStatus === 'GAP_MODEL_FAILED'
    ? 'BLOCKED_BY_UPSTREAM'
    : undefined
  appendEvent(events, input, 'checkpoint.created', { stage: boundary, boundary, checkpointId: checkpoint.checkpointId, stateHash, ...(boundaryStatus ? { status: boundaryStatus } : {}) })
  return { schemaVersion: 'generation0.boundary.v1', boundary, runId: String(input.runId), ...(input.sourceRunId ? { sourceRunId: input.sourceRunId } : {}), ...(input.configuration === undefined ? {} : { configHash: contentHash(canonicalJson(input.configuration)) }), ...(input.corpusCutoff ? { corpusCutoff: input.corpusCutoff } : {}), stateHash, state, value, checkpoint, events: [...events], committedAt: input.now }
}

function pendingGateway(gateway: ModelGateway | undefined, store: Generation0RunStore | undefined, role: 'GapDiscovery' | 'HypothesisGenerator'): ModelGateway | undefined {
  if (!gateway || !store) return gateway
  return {
    async structured<T>(request: Parameters<ModelGateway['structured']>[0]) {
      store.beginAttempt({ attemptId: request.attemptId, role, startedAt: new Date().toISOString() })
      try { return await gateway.structured<T>(request) } catch (error) { throw error }
    },
    annotateAttempt: (attemptId, patch) => gateway.annotateAttempt?.(attemptId, patch),
  }
}

/**
 * Shared, bounded Generation-0 extension.  It validates imported state before
 * invoking either role, records deterministic gaps separately from model gaps,
 * and emits a checkpoint even for a valid empty/blocked result.
 */
export async function runGeneration0Extension(input: Generation0ExtensionInput, options: Generation0ExtensionOptions = {}): Promise<Generation0ExtensionResult> {
  validateInput(input, options)
  const store = options.store ?? input.store
  const route = options.route ?? input.route
  const candidateBudget = Math.max(0, Math.floor(options.candidateBudget ?? input.candidateBudget ?? input.budget?.limits.maxCandidates ?? 3))
  const sourceRunId = input.sourceRunId ?? String(input.runId)
  const config = options.configuration ?? input.configuration
  const corpusCutoff = options.corpusCutoff ?? input.corpusCutoff
  const recordInput = { ...input, sourceRunId, configuration: config, corpusCutoff }
  store?.open({ runId: String(input.runId), sourceRunId, config, corpusCutoff })
  store?.assertResumable()
  const initialEvents = [...(input.initialEvents ?? [])]
  validateEventPrefix(initialEvents, String(input.runId))
  if (input.startingSequence !== undefined && input.startingSequence !== initialEvents.length) throw new Error('RUNSTORE_EVENT_SEQUENCE_MISMATCH: startingSequence must equal initial event count')
  const budget = input.budget ?? defaultBudget(candidateBudget)
  const boundaryCheckpoints: Partial<Record<Generation0Boundary, Checkpoint>> = {}

  // A committed Generation-0 boundary is authoritative. Resume returns it
  // directly and never asks either scientific role to repeat an external call.
  const committedGeneration = store?.read('GENERATION_0')
  if (committedGeneration) {
    const value = committedGeneration.value as { gapReasoning?: M5AGapReasoningResult; generation0?: Generation0Population; gapDiscovery?: GapDiscoveryResult }
    if (!value?.gapReasoning || !value.generation0) throw new Error('RUNSTORE_BOUNDARY_VALUE_MISSING: Generation-0 result is incomplete')
    const generation0 = value.generation0
    const limitations = [...new Set([...(value.gapReasoning.limitations ?? []), ...(generation0.limitations ?? []), ...(options.allowUnverifiedEvidence ? ['Legacy source evidence was accepted without content-hash revalidation; it remains unverified.'] : [])])].sort()
    const status = ((generation0 as Generation0Population & { generationStatus?: Generation0ExtensionStatus }).generationStatus ?? (generation0.hypotheses.length ? 'COMPLETE' : 'COMPLETE_EMPTY')) as Generation0ExtensionStatus
    boundaryCheckpoints.GENERATION_0 = committedGeneration.checkpoint
    return { status, runId: input.runId, sourceRunId, gapReasoning: value.gapReasoning, gapDiscovery: value.gapDiscovery ?? value.gapReasoning.gapDiscovery, generation0, events: committedGeneration.events, checkpoint: committedGeneration.checkpoint, stateHash: committedGeneration.stateHash, acceptedHypothesisCount: generation0.hypotheses.length, limitations, boundaryCheckpoints, replayed: true }
  }

  let events = initialEvents
  const evaluateRecord = store?.read('EVALUATE')
  if (evaluateRecord) {
    events = [...evaluateRecord.events]; boundaryCheckpoints.EVALUATE = evaluateRecord.checkpoint
  } else if (store) {
    appendEvent(events, input, 'stage.started', { stage: 'EVALUATE', boundary: 'EVALUATE' })
    appendEvent(events, input, 'stage.completed', { stage: 'EVALUATE', boundary: 'EVALUATE' })
    const evaluationState = { problemGraph: input.problemGraph, claims: input.claims, evidence: input.evidence, evidenceGraph: input.evidenceGraph, completeness: input.completeness }
    const evaluationRecord = boundaryRecord(recordInput, 'EVALUATE', evaluationState, { boundary: 'EVALUATE' }, events, budget)
    store.commit(evaluationRecord); events = [...evaluationRecord.events]; boundaryCheckpoints.EVALUATE = evaluationRecord.checkpoint
  }

  const baseInput: GapDiscoveryInput = { problemGraph: input.problemGraph, claims: input.claims, evidence: input.evidence, evidenceGraph: input.evidenceGraph, completeness: input.completeness, now: input.now }
  const committedGap = store?.read('GAP_DISCOVERY')
  let gapReasoning: M5AGapReasoningResult
  if (committedGap) {
    const value = committedGap.value as { gapReasoning?: M5AGapReasoningResult }
    if (!value?.gapReasoning) throw new Error('RUNSTORE_BOUNDARY_VALUE_MISSING: GapDiscovery result is incomplete')
    gapReasoning = value.gapReasoning; events = [...committedGap.events]; boundaryCheckpoints.GAP_DISCOVERY = committedGap.checkpoint
  } else {
    const gateway = pendingGateway(options.gateway ?? input.gateway, store, 'GapDiscovery')
    // Artifact IDs are provenance inputs, not run identifiers.  Preserve an
    // empty list for synthetic or legacy callers that cannot provide them;
    // real live/imported paths supply the IDs parsed from ingest.json.
    gapReasoning = input.gapReasoningResult ?? await runModelGapDiscovery(baseInput, { ...(input.gapReasoning ?? {}), gateway, route, now: input.now, maxSerializationRetries: options.maxSerializationRetries ?? input.gapReasoning?.maxSerializationRetries, inputArtifactIds: input.inputArtifactIds ?? [] })
    if (store) {
      appendEvent(events, input, 'stage.started', { stage: 'GAP_DISCOVERY' })
      for (const attempt of gapReasoning.attempts) appendEvent(events, input, 'model.attempt', { stage: 'GAP_DISCOVERY', role: 'GapDiscovery', attemptId: attempt.attemptId, status: attempt.status, validationErrors: attempt.validationErrors })
      const lastAttempt = gapReasoning.attempts.at(-1)
      appendEvent(events, input, lastAttempt?.status === 'FAILED' ? 'stage.failed' : 'stage.completed', { stage: 'GAP_DISCOVERY', gapCount: gapReasoning.gapDiscovery.gaps.length })
      const gapState = { problemGraph: input.problemGraph, claims: input.claims, evidence: input.evidence, gapReasoning }
      const gapRecord = boundaryRecord(recordInput, 'GAP_DISCOVERY', gapState, { gapReasoning, gapDiscovery: gapReasoning.gapDiscovery }, events, budget)
      store.commit(gapRecord); events = [...gapRecord.events]; boundaryCheckpoints.GAP_DISCOVERY = gapRecord.checkpoint
    }
  }

  const lastGapAttempt = gapReasoning.attempts.at(-1)
  const gapFailed = Boolean(gapReasoning.modelAttempted && gapReasoning.modelGaps.length === 0 && lastGapAttempt?.status === 'FAILED')
  const eligibleCount = gapReasoning.gapDiscovery.gaps.filter(gap => gap.eligibility.eligible && gap.coverageState !== 'COVERAGE_ONLY').length
  let generation0: Generation0Population
  let status: Generation0ExtensionStatus
  if (gapFailed && (options.requireGapModelSuccess ?? input.requireGapModelSuccess) !== false) {
    generation0 = emptyPopulation(input.now, gapReasoning.gapDiscovery, candidateBudget, ['GapDiscovery model contract failed; Generation-0 was skipped.'], 'GAP_MODEL_FAILED', gapReasoning.rejected.map(item => item.reason).join('; '))
    status = 'GAP_MODEL_FAILED'
  } else if (!eligibleCount) {
    generation0 = emptyPopulation(input.now, gapReasoning.gapDiscovery, candidateBudget, ['No eligible scientific gap was accepted; Generation-0 has no candidates.'], 'NO_ELIGIBLE_GAPS')
    status = 'NO_ELIGIBLE_GAPS'
  } else {
    const generationInput: HypothesisGenerationInput = { gapDiscovery: gapReasoning.gapDiscovery, problemGraph: input.problemGraph, claims: input.claims, evidence: input.evidence }
    try {
      const generationGateway = input.generationGateway ?? options.generationGatewayFactory?.(gapReasoning) ?? options.gateway ?? input.gateway
      const guardedGenerationGateway = pendingGateway(generationGateway, store, 'HypothesisGenerator')
      const generationOptions = { gateway: guardedGenerationGateway, route, now: input.now, candidateBudget, inputArtifactIds: input.inputArtifactIds ?? [] }
      let generated = input.generation0Result ?? await generateGeneration0Hypotheses(generationInput, generationOptions)
      const maxRetries = Math.max(0, Math.min(options.maxSerializationRetries ?? input.gapReasoning?.maxSerializationRetries ?? 1, 1))
      let retryCount = 0
      while (!input.generation0Result && guardedGenerationGateway && retryCount < maxRetries) {
        const failed = generated.modelAttempts.find(attempt => !attempt.ok)
        const diagnostic = failed?.diagnostic as { parseStatus?: string; schemaValidationStatus?: string } | undefined
        if (!failed || (diagnostic?.parseStatus !== 'failure' && diagnostic?.schemaValidationStatus !== 'failure')) break
        retryCount += 1
        const retry = await generateGeneration0Hypotheses(generationInput, { ...generationOptions, previousValidationErrors: generated.modelAttempts.flatMap(attempt => attempt.validationErrors) })
        generated = { ...retry, modelAttempts: [...generated.modelAttempts, ...retry.modelAttempts], limitations: [...new Set([...generated.limitations, ...retry.limitations])] }
      }
      const latestAttempt = generated.modelAttempts.at(-1)
      const failedAttempt = latestAttempt && !latestAttempt.ok ? latestAttempt : undefined
      const precomputedStatus = (generated as Generation0Population & { generationStatus?: string }).generationStatus
      if (failedAttempt || precomputedStatus === 'GENERATION_FAILED') {
        const reason = failedAttempt?.validationErrors.join('; ') || (generated as Generation0Population & { failureReason?: string }).failureReason || 'HypothesisGenerator model contract failed'
        generation0 = withPopulationStatus(generated, 'GENERATION_FAILED', reason); status = 'GENERATION_FAILED'
      } else {
        generation0 = withPopulationStatus(generated, 'COMPLETE'); status = generation0.hypotheses.length ? 'COMPLETE' : 'COMPLETE_EMPTY'
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Generation-0 contract failed'
      generation0 = emptyPopulation(input.now, gapReasoning.gapDiscovery, candidateBudget, ['Generation-0 model contract failed; no hypotheses were accepted.'], 'GENERATION_FAILED', reason); status = 'GENERATION_FAILED'
    }
  }

  const state = input.stateForHash ?? { gapDiscovery: gapReasoning.gapDiscovery, generation0 }
  const stateHash = contentHash(canonicalJson(state))
  const modelCalls = gapReasoning.attempts.length + generation0.modelAttempts.length
  const usage = { ...budget.usage, maxModelCalls: Math.min(budget.limits.maxModelCalls, budget.usage.maxModelCalls + modelCalls), maxCandidates: Math.min(budget.limits.maxCandidates, budget.usage.maxCandidates + generation0.hypotheses.length) }
  const finalBudget = { limits: budget.limits, usage }
  if (store) {
    if (status !== 'GAP_MODEL_FAILED') {
      appendEvent(events, input, 'stage.started', { stage: 'GENERATION_0' })
      for (const attempt of generation0.modelAttempts) appendEvent(events, input, 'model.attempt', { stage: 'GENERATION_0', role: 'HypothesisGenerator', attemptId: attempt.attemptId, status: attempt.ok ? 'SUCCEEDED' : 'FAILED', validationErrors: attempt.validationErrors })
      appendEvent(events, input, status === 'GENERATION_FAILED' ? 'stage.failed' : 'stage.completed', { stage: 'GENERATION_0', status, acceptedHypothesisCount: generation0.hypotheses.length })
      for (const hypothesis of generation0.hypotheses) appendEvent(events, input, 'hypothesis.created', { stage: 'GENERATION_0', hypothesisId: hypothesis.hypothesisId, generation: 0 })
    }
    const finalRecord = boundaryRecord(recordInput, 'GENERATION_0', state, { gapReasoning, gapDiscovery: gapReasoning.gapDiscovery, generation0 }, events, { limits: finalBudget.limits, usage: finalBudget.usage }, generation0.hypotheses.map(item => item.hypothesisId))
    store.commit(finalRecord); events = [...finalRecord.events]; boundaryCheckpoints.GENERATION_0 = finalRecord.checkpoint
    const limitations = [...new Set([...gapReasoning.limitations, ...generation0.limitations, ...(options.allowUnverifiedEvidence ? ['Legacy source evidence was accepted without content-hash revalidation; it remains unverified.'] : [])])].sort()
    return { status, runId: input.runId, sourceRunId, gapReasoning, gapDiscovery: gapReasoning.gapDiscovery, generation0, events, checkpoint: finalRecord.checkpoint, stateHash: finalRecord.stateHash, acceptedHypothesisCount: generation0.hypotheses.length, limitations, boundaryCheckpoints }
  }
  const sequenceBase = initialEvents.length
  const generationStatus = (generation0 as Generation0Population & { generationStatus?: string }).generationStatus ?? status
  const generationEvents = generationStatus === 'GAP_MODEL_FAILED' ? 0 : 2 + generation0.modelAttempts.length + generation0.hypotheses.length
  const sequence = sequenceBase + 2 + gapReasoning.attempts.length + generationEvents + 1
  const checkpoint: Checkpoint = { checkpointId: deterministicId('checkpoint', { runId: input.runId, sequence, stateHash }), runId: input.runId as RunId, sequence, stateHash, populationIds: generation0.hypotheses.map(item => item.hypothesisId), budget: { limits: finalBudget.limits, usage: finalBudget.usage }, createdAt: input.now }
  parseCheckpoint(checkpoint)
  const extensionEvents = makeEvents({ ...input, startingSequence: sequenceBase }, gapReasoning.gapDiscovery, generation0, checkpoint, gapReasoning.attempts)
  const finalEvents = [...initialEvents, ...extensionEvents]
  const limitations = [...new Set([...gapReasoning.limitations, ...generation0.limitations, ...(options.allowUnverifiedEvidence ? ['Legacy source evidence was accepted without content-hash revalidation; it remains unverified.'] : [])])].sort()
  return { status, runId: input.runId, sourceRunId, gapReasoning, gapDiscovery: gapReasoning.gapDiscovery, generation0, events: finalEvents, checkpoint, stateHash, acceptedHypothesisCount: generation0.hypotheses.length, limitations, boundaryCheckpoints }
}


