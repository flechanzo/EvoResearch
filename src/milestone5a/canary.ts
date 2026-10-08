import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { canonicalJson, contentHash, deterministicId } from '../domain/ids.ts'
import type { ArtifactManifest, Claim, Evidence, ModelGateway, ModelRequest, ModelResponseDiagnostic, ModelRoute, ResearchProblemGraph, Checkpoint, BudgetLedger, DomainEvent } from '../domain/index.ts'
import { ValidationError, parseResearchProblemGraph, parseClaim, parseEvidence, parseCheckpoint, parseDomainEvent } from '../domain/index.ts'
import { preflightModel, serializePreflight, type ModelPreflightResult } from '../adapters/model-preflight.ts'
import { ResponsesModelGateway } from '../adapters/responses-model.ts'
import { resolveModelConfiguration, safeModelConfigurationSnapshot, configurationDiagnostics, type ResolvedModelConfiguration, type SafeModelConfigurationSnapshot } from '../config/model-config.ts'
import { discoverResearchGaps } from '../milestone4a/gap-discovery.ts'
import { generateGeneration0Hypotheses } from '../milestone4a/hypothesis-generator.ts'
import type { GapDiscoveryInput, GapDiscoveryResult, Generation0Population, M4ACompleteness, ResearchGap, HypothesisGenerationInput } from '../milestone4a/types.ts'
import { validateResearchGap, validateGeneration0Population } from '../milestone4a/validation.ts'
import { runModelGapDiscovery, type M5AGapReasoningAttempt } from './gap-reasoning.ts'
import { projectM5AInput, type M5AScientificInputProjection } from './projection.ts'
import { runGeneration0Extension } from '../coordinator/generation0-extension.ts'
import { planM5ACanaryCalls, type M5ACanaryCallPlan } from './canary-budget.ts'
import { FileGeneration0RunStore } from '../adapters/generation0-run-store.ts'
import { inspectM5ASourceRun, type M5ASourceIntegrityResult } from './source-integrity.ts'

export interface M5ASourceState {
  readonly sourceRunId: string
  /** Artifact identities carried by the imported M3.5C ingest manifest. */
  readonly inputArtifactIds?: readonly string[]
  readonly sourceDirectory?: string
  readonly problemGraph: ResearchProblemGraph
  readonly claims: readonly Claim[]
  readonly evidence: readonly (Evidence & Record<string, unknown>)[]
  readonly evidenceGraph?: { readonly claims?: readonly Claim[]; readonly evidence?: readonly (Evidence & Record<string, unknown>)[]; readonly links?: readonly Record<string, unknown>[] }
  readonly completeness: M4ACompleteness
  readonly inputStateHash?: string
  readonly sourceFiles?: Readonly<Record<string, string>>
  readonly limitations?: readonly string[]
  readonly normalization?: readonly Record<string, unknown>[]
  readonly sourceIntegrity?: M5ASourceIntegrityResult
}

export interface M5ACanaryOptions {
  readonly mode?: 'dry-run' | 'live'
  readonly inputRun?: string
  readonly source?: M5ASourceState
  readonly outputRoot?: string
  readonly projectRoot?: string
  readonly gateway?: ModelGateway
  readonly preflight?: ModelPreflightResult
  readonly preflightImpl?: (options: Parameters<typeof preflightModel>[0]) => Promise<ModelPreflightResult>
  readonly now?: string
  readonly maxGapCalls?: number
  readonly maxPreflightCalls?: number
  readonly maxHypothesisCalls?: number
  readonly maxTotalModelCalls?: number
  readonly candidateGapBudget?: number
  readonly hypothesisBudget?: number
  readonly maxSerializationRetries?: number
  readonly route?: ModelRoute
}

export interface M5ACanaryReport {
  readonly sourceRunId: string
  readonly runId: string
  readonly status: 'COMPLETE' | 'FAILED' | 'STOPPED'
  readonly scientificallyComplete: boolean
  readonly limitations: readonly string[]
  readonly gapCount: number
  readonly eligibleGapCount: number
  readonly hypothesisCount: number
  readonly reportPath?: string
}

export interface M5ACanaryResult {
  readonly ok: boolean
  readonly mode: 'dry-run' | 'live'
  readonly runId?: string
  readonly sourceRunId: string
  readonly outputDirectory: string
  readonly dryRun?: M5ADryRun
  readonly report?: M5ACanaryReport
  readonly config: SafeModelConfigurationSnapshot
  readonly preflight?: ReturnType<typeof serializePreflight>
  readonly errors: readonly string[]
}

export interface M5ADryRun {
  readonly modelCalls: 0
  readonly openAlexCalls: 0
  readonly networkCalls: 0
  readonly inputAvailable: boolean
  readonly inputStateHash?: string
  readonly scientificallyComplete?: boolean
  readonly candidateGapCount: number
  readonly eligibleGapUpperBound: number
  readonly expectedModelCallUpperBound: number
  readonly callPlan: M5ACanaryCallPlan
  readonly budgetPlanAccepted: boolean
  readonly localInputReady: boolean
  readonly liveConfigurationReady: boolean
  readonly outputDirectory: string
  readonly activeGates: readonly string[]
  readonly limitations: readonly string[]
}

export interface M5AReplayResult {
  readonly ok: true
  readonly runId: string
  readonly sourceRunId: string
  readonly checkpointSequence: number
  readonly stateHash: string
  readonly eventCount: number
  readonly modelCalls: 0
  readonly searchCalls: 0
}

function json(path: string): any { return JSON.parse(readFileSync(path, 'utf8')) }
function fileHash(value: unknown): string { return contentHash(canonicalJson(value)) }
function sorted(values: Iterable<string>): string[] { return [...new Set(values)].sort((a, b) => a.localeCompare(b)) }
function nowIso(): string { return new Date().toISOString() }
function completenessLimitations(value: M4ACompleteness): readonly string[] {
  const item = value as Record<string, unknown>
  const result = [...(Array.isArray(item.limitations) ? item.limitations.filter((entry): entry is string => typeof entry === 'string') : []), ...(Array.isArray(item.reasons) ? item.reasons.filter((entry): entry is string => typeof entry === 'string') : [])]
  for (const key of ['relevanceWarnings', 'sourceRelevanceWarnings', 'qualityWarnings']) {
    const warnings = item[key]
    if (Array.isArray(warnings)) for (const warning of warnings) if (typeof warning === 'string' && warning.trim()) result.push(`Source relevance quality limitation: ${warning.trim()}`)
  }
  const count = (key: string): number => {
    const value = item[key]
    return Array.isArray(value) ? value.length : typeof value === 'number' && Number.isFinite(value) ? value : 0
  }
  if (count('emptyEvidenceOperations') > 0) result.push('Some evidence operations completed successfully with empty extraction; this is not negative evidence and does not establish absence.')
  const coverage = item.retrievalCoverage as Record<string, unknown> | undefined
  if (typeof coverage?.NO_RESULTS === 'number' && coverage.NO_RESULTS > 0) result.push('One or more retrieval operations returned NO_RESULTS; this is a search outcome, not negative evidence or absence of literature.')
  if (typeof coverage?.FAILED === 'number' && coverage.FAILED > 0) result.push('One or more retrieval operations failed; the failed retrieval is a coverage limitation, not negative evidence.')
  if (count('deferredOperations') > 0) result.push('Some planned evidence operations were deferred and remain unexamined.')
  return sorted(result)
}
function sourcePaths(directory: string): string[] { const files = ['problem-graph.json', 'claims.json', 'evidence.json', 'evidence-graph.json', 'evaluation-report.json', 'evidence-plan.json', 'run-snapshot.json', 'stage-state.json', 'ingest.json', 'literature-records.json', 'source-selection.json']; const readerDir = resolve(directory, 'paper-reader'); if (existsSync(readerDir)) files.push(...readdirSync(readerDir).filter(name => name.endsWith('.json')).map(name => `paper-reader/${name}`)); return files.filter(name => existsSync(resolve(directory, name))).sort() }

function makeSeedRecords(directory: string, graph: ResearchProblemGraph, existingClaims: Claim[], existingEvidence: (Evidence & Record<string, unknown>)[]): { claims: Claim[]; evidence: (Evidence & Record<string, unknown>)[]; graph: ResearchProblemGraph; limitations: string[]; normalization: Record<string, unknown>[] } {
  const evidence = [...existingEvidence]; const known = new Set(evidence.map(item => item.evidenceId)); const referenced = new Set([...graph.nodes, ...graph.edges].flatMap(item => item.evidenceIds)); const normalization: Record<string, unknown>[] = []
  const ingest = existsSync(resolve(directory, 'ingest.json')) ? json(resolve(directory, 'ingest.json')) as ArtifactManifest[] : []
  const snapshot = existsSync(resolve(directory, 'run-snapshot.json')) ? json(resolve(directory, 'run-snapshot.json')) : {}
  const readerDir = resolve(directory, 'paper-reader')
  if (existsSync(readerDir)) for (const name of readdirSync(readerDir).filter(name => name.endsWith('.json')).sort()) {
    const reader = json(resolve(readerDir, name)); const manifest = ingest.find(item => item.artifactId === reader.artifactId); if (!manifest) throw new ValidationError('paper reader artifact has no persisted ingest manifest', `$.paperReader.${name}`, 'INVALID_PROVENANCE')
    if (!Array.isArray(reader.items)) throw new ValidationError('paper reader items are missing', `$.paperReader.${name}`, 'INVALID_PROVENANCE')
    for (const item of reader.items) {
      const claimId = deterministicId('claim', { paperId: manifest.paperId, itemId: item.itemId }); const evidenceId = deterministicId('evidence', { paperId: manifest.paperId, itemId: item.itemId }) as never
      if (!referenced.has(evidenceId) || known.has(evidenceId)) continue
      const claim = existingClaims.find(entry => entry.claimId === claimId)
      if (!claim || claim.statement !== item.statement || claim.artifactId !== reader.artifactId) throw new ValidationError('seed evidence has no matching persisted claim', `$.paperReader.${name}`, 'INVALID_PROVENANCE')
      const direct = item.interpretation === 'DIRECT_EVIDENCE'
      if (!direct && item.interpretation !== 'MODEL_INTERPRETATION') throw new ValidationError('invalid paper-reader interpretation', '$.paperReader.interpretation', 'INVALID_PROVENANCE')
      if (direct && (!Array.isArray(item.locators) || !item.locators.length || item.locators.some((locator: any) => locator.artifactId !== reader.artifactId) || claim.provenance.sourceType !== 'artifact' || claim.provenance.locator !== JSON.stringify(item.locators[0]))) throw new ValidationError('seed evidence locator does not match accepted claim', '$.paperReader.locators', 'INVALID_PROVENANCE')
      const restored: Evidence & Record<string, unknown> = { evidenceId, kind: direct ? 'quote' : 'interpretation', claim: item.statement, polarity: 'MOTIVATE', provenance: claim.provenance, claimIds: [claim.claimId], limitations: ['Seed paper statement with persisted locator; the source text was not re-extracted during M5A.'], confidence: item.confidence, createdAt: snapshot.completedAt ?? manifest.ingestionTimestamp, evidenceLevel: direct ? 'FULL_TEXT_EVIDENCE' : 'MODEL_INTERPRETATION', modelInterpretation: !direct, sourceTextVerified: false }
      parseEvidence(restored); evidence.push(restored); known.add(evidenceId)
      normalization.push({ evidenceId, claimId, sourceFile: `paper-reader/${name}`, artifactId: reader.artifactId, rule: 'replay-existing-M3-readerEvidence', polarityPolicy: 'MOTIVATE', sourceTextReverified: false })
    }
  }
  parseResearchProblemGraph(graph, known)
  return { claims: existingClaims, evidence, graph, normalization, limitations: normalization.length ? [`${normalization.length} seed evidence records were replayed from accepted PaperReader records using the existing M3 IDs, recorded confidence and locators. Source text was not re-extracted or independently verified in M5A.`] : [] }
}

export function loadM5ASourceRun(directory: string): M5ASourceState {
  const root = resolve(directory); if (!existsSync(root)) throw new ValidationError(`source run directory does not exist: ${root}`, '$.inputRun', 'INPUT_STATE_UNAVAILABLE')
  const rawGraph = json(resolve(root, 'problem-graph.json')) as ResearchProblemGraph
  const persistedClaims = (json(resolve(root, 'claims.json')) as Record<string, unknown>[]).map(item => { const readerKinds: Record<string, Claim['kind']> = { claim: 'observation', problem: 'observation', assumption: 'interpretation', dataset: 'observation', metric: 'result', 'failure-case': 'limitation' }; const kind = readerKinds[String(item.kind)] ?? item.kind; return parseClaim({ ...item, kind }) })
  const sourceIntegrity = inspectM5ASourceRun(root)
  const integrityById = new Map(sourceIntegrity.evidenceChecks.map(item => [item.evidenceId, item]))
  const persistedEvidence = (json(resolve(root, 'evidence.json')) as unknown[]).map(item => { const parsed = parseEvidence(item) as Evidence & Record<string, unknown>; const integrity = integrityById.get(String(parsed.evidenceId)); return { ...parsed, ...(integrity ? { sourceTextVerified: integrity.sourceTextVerified } : {}) } })
  const graphSnapshot = existsSync(resolve(root, 'evidence-graph.json')) ? json(resolve(root, 'evidence-graph.json')) : undefined
  const seeded = makeSeedRecords(root, rawGraph, persistedClaims, persistedEvidence)
  const snapshot = existsSync(resolve(root, 'run-snapshot.json')) ? json(resolve(root, 'run-snapshot.json')) : {}
  const evaluation = existsSync(resolve(root, 'evaluation-report.json')) ? json(resolve(root, 'evaluation-report.json')) : {}
  const plan = existsSync(resolve(root, 'evidence-plan.json')) ? json(resolve(root, 'evidence-plan.json')) : {}
  const assessment = evaluation.evidenceAssessment ?? {}
  const completeness: M4ACompleteness = {
    ...assessment,
    status: assessment.status ?? (snapshot.scientificallyComplete === false ? 'INCOMPLETE' : 'EXHAUSTIVE'),
    exhaustive: assessment.exhaustive ?? snapshot.scientificallyComplete === true,
    scientificallyComplete: snapshot.scientificallyComplete ?? assessment.scientificallyComplete,
    deferredOperations: assessment.deferredOperations ?? plan.deferredOperations?.length ?? snapshot.evidencePlan?.deferredOperations ?? 0,
    unexecutedPlannedOperations: assessment.unexecutedPlannedOperations ?? 0,
    emptyEvidenceOperations: assessment.emptyEvidenceOperations ?? 0,
    retrievalCoverage: assessment.retrievalCoverage,
    evidenceItems: assessment.evidenceItems ?? seeded.evidence.length,
    limitations: assessment.reasons ?? [],
  }
  const values: Record<string, unknown> = {}; for (const name of sourcePaths(root)) values[name] = json(resolve(root, name))
  const inputArtifactIds = (values['ingest.json'] as unknown[] | undefined)?.flatMap(item => item && typeof item === 'object' && typeof (item as Record<string, unknown>).artifactId === 'string' ? [(item as Record<string, unknown>).artifactId as string] : []) ?? []
  return { sourceRunId: String(snapshot.runId ?? root.split(/[\\/]/).pop() ?? root), inputArtifactIds, sourceDirectory: root, problemGraph: seeded.graph, claims: seeded.claims, evidence: seeded.evidence, evidenceGraph: { ...graphSnapshot, claims: seeded.claims, evidence: seeded.evidence }, completeness: { ...completeness, limitations: [...(completeness as { limitations?: readonly string[] }).limitations ?? [], ...seeded.limitations] } as M4ACompleteness, normalization: seeded.normalization, limitations: [...seeded.limitations, ...sourceIntegrity.limitations], sourceIntegrity, inputStateHash: fileHash(values), sourceFiles: Object.fromEntries(Object.entries(values).map(([name, value]) => [name, fileHash(value)])) }
}

/**
 * Verify a persisted M5A extension without invoking a model, search provider,
 * parser, or preflight. The check is deliberately fail-closed: identity,
 * source-file hashes, state hash, checkpoint, and event sequence must all
 * agree before the artifact is considered replayable.
 */
export function replayM5AExtensionArtifacts(directory: string): M5AReplayResult {
  const root = resolve(directory)
  const required = ['run-snapshot.json', 'input-state.json', 'state.json', 'checkpoint.json', 'events.json']
  for (const name of required) if (!existsSync(resolve(root, name))) throw new ValidationError(`replay artifact is missing ${name}`, `$.${name}`, 'REPLAY_INPUT_UNAVAILABLE')
  const snapshot = json(resolve(root, 'run-snapshot.json')) as Record<string, unknown>
  const inputState = json(resolve(root, 'input-state.json')) as Record<string, unknown>
  const state = json(resolve(root, 'state.json'))
  const checkpoint = parseCheckpoint(json(resolve(root, 'checkpoint.json')))
  const events = (json(resolve(root, 'events.json')) as unknown[]).map(parseDomainEvent)
  const runId = typeof snapshot.runId === 'string' ? snapshot.runId : ''
  const sourceRunId = typeof snapshot.sourceRunId === 'string' ? snapshot.sourceRunId : typeof inputState.sourceRunId === 'string' ? inputState.sourceRunId : ''
  if (!runId || checkpoint.runId !== runId || events.some(event => event.runId !== runId)) throw new ValidationError('replay run identity does not agree across snapshot, checkpoint, and events', '$.runId', 'REPLAY_IDENTITY_MISMATCH')
  if (!sourceRunId || inputState.sourceRunId !== sourceRunId) throw new ValidationError('replay sourceRunId does not agree across snapshot and input state', '$.sourceRunId', 'REPLAY_IDENTITY_MISMATCH')
  const sourceFiles = inputState.sourceFiles
  if (!sourceFiles || typeof sourceFiles !== 'object' || Array.isArray(sourceFiles)) throw new ValidationError('replay input state has no source file hashes', '$.sourceFiles', 'REPLAY_PROVENANCE_MISSING')
  const sourceDirectory = typeof inputState.sourceDirectory === 'string' ? inputState.sourceDirectory : ''
  if (sourceDirectory && !existsSync(sourceDirectory)) throw new ValidationError('replay source directory is missing', '$.sourceDirectory', 'REPLAY_PROVENANCE_MISSING')
  if (!sourceDirectory && Object.keys(sourceFiles as Record<string, unknown>).length > 0) throw new ValidationError('replay input state has source hashes but no source directory', '$.sourceDirectory', 'REPLAY_PROVENANCE_MISSING')
  if (sourceDirectory) {
    const values: Record<string, unknown> = {}
    for (const name of Object.keys(sourceFiles as Record<string, unknown>).sort()) {
      const path = resolve(sourceDirectory, name)
      if (!existsSync(path)) throw new ValidationError(`replay source file is missing: ${name}`, `$.sourceFiles.${name}`, 'REPLAY_PROVENANCE_MISSING')
      const value = json(path); values[name] = value
      if ((sourceFiles as Record<string, unknown>)[name] !== fileHash(value)) throw new ValidationError(`replay source file hash mismatch: ${name}`, `$.sourceFiles.${name}`, 'REPLAY_HASH_MISMATCH')
    }
    if (typeof inputState.inputStateHash === 'string' && inputState.inputStateHash !== fileHash(values)) throw new ValidationError('replay input state hash mismatch', '$.inputStateHash', 'REPLAY_HASH_MISMATCH')
    const integrity = inspectM5ASourceRun(sourceDirectory)
    if (integrity.artifactChecks.some(item => !item.exists || !item.byteSizeMatches || !item.hashMatches)) throw new ValidationError('replay source artifact bytes do not match ingest manifests', '$.sourceDirectory', 'REPLAY_HASH_MISMATCH')
  }
  const stateHash = fileHash(state)
  if (stateHash !== checkpoint.stateHash || snapshot.stateHash !== checkpoint.stateHash) throw new ValidationError('replay state hash does not match checkpoint and snapshot', '$.stateHash', 'REPLAY_HASH_MISMATCH')
  if (events.length !== checkpoint.sequence || events.some((event, index) => event.sequence !== index + 1)) throw new ValidationError('replay events are not a contiguous sequence ending at the checkpoint', '$.events', 'REPLAY_EVENT_SEQUENCE_MISMATCH')
  const last = events.at(-1)
  if (!last || last.type !== 'checkpoint.created' || last.payload.checkpointId !== checkpoint.checkpointId || last.payload.stateHash !== checkpoint.stateHash) throw new ValidationError('replay checkpoint event does not identify the committed checkpoint', '$.events[-1]', 'REPLAY_CHECKPOINT_MISMATCH')
  return { ok: true, runId, sourceRunId, checkpointSequence: checkpoint.sequence, stateHash: checkpoint.stateHash, eventCount: events.length, modelCalls: 0, searchCalls: 0 }
}

function emptyPopulation(now: string, input: GapDiscoveryResult, candidateBudget: number, limitations: readonly string[]): Generation0Population { return { schemaVersion: 'm4a.generation-0.v1', generation: 0, generatedAt: now, hypotheses: [], candidateBudget, skillVersion: 'hypothesis-generator@m5a', inputCompleteness: input.completeness, inputSummary: input.inputSummary, limitations: [...limitations], rejected: [], duplicates: [], modelAttempts: [], provenance: [] } }

class GenerationGateway implements ModelGateway {
  readonly calls: ModelRequest<unknown>[] = []
  readonly diagnostics: { readonly request: ModelRequest<unknown>; readonly result: unknown }[] = []
  private attemptNumber = 0
  private previousErrors: readonly string[] = []
  private readonly inner: ModelGateway
  private readonly projection: M5AScientificInputProjection
  private readonly maxCalls: number
  private readonly inputArtifactIds: readonly string[]
  private readonly knownGapIds: ReadonlySet<string>
  private readonly directEvidenceIds: ReadonlySet<string>
  private readonly knownClaimIds: ReadonlySet<string>
  private readonly knownProblemIds: ReadonlySet<string>
  constructor(inner: ModelGateway, projection: M5AScientificInputProjection, maxCalls: number, inputArtifactIds: readonly string[], knownGapIds: ReadonlySet<string>, directEvidenceIds: ReadonlySet<string>, knownClaimIds: ReadonlySet<string>, knownProblemIds: ReadonlySet<string>) { this.inner = inner; this.projection = projection; this.maxCalls = maxCalls; this.inputArtifactIds = inputArtifactIds; this.knownGapIds = knownGapIds; this.directEvidenceIds = directEvidenceIds; this.knownClaimIds = knownClaimIds; this.knownProblemIds = knownProblemIds }
  annotateAttempt(id: string, patch: Parameters<NonNullable<ModelGateway['annotateAttempt']>>[1]) { this.inner.annotateAttempt?.(id, patch) }
  async structured<T>(request: ModelRequest<T>) {
    this.attemptNumber += 1
    if (this.attemptNumber > this.maxCalls) return { ok: false as const, error: 'BUDGET_EXHAUSTED: HypothesisGenerator model-call budget exhausted' }
    const attemptId = deterministicId('attempt', { role: 'HypothesisGenerator', projectionId: this.projection.projectionId, attemptNumber: this.attemptNumber }) as string
    const boundedInput = this.attemptNumber === 1 ? { ...(request.input as Record<string, unknown>), projection: this.projection, projectionId: this.projection.projectionId } : { ...(request.input as Record<string, unknown>), projection: this.projection, projectionId: this.projection.projectionId, serializationRetry: { expectedSchema: request.outputSchema, validationErrors: this.previousErrors, instruction: 'Return corrected JSON only. Keep the same scientific candidate content and references.' } }
    const rewritten = { ...request, attemptId, inputArtifactIds: this.inputArtifactIds as never, inputEvidenceIds: this.projection.includedEvidenceIds as never, input: boundedInput }
    this.calls.push(rewritten)
    const result = await this.inner.structured<T>(rewritten)
    this.diagnostics.push({ request: rewritten, result })
    if (result.ok) {
      const validationError = validateHypothesisTransport(result.value, this.knownGapIds, this.directEvidenceIds, this.knownClaimIds, this.knownProblemIds)
      if (validationError) {
        this.previousErrors = [validationError]
        this.inner.annotateAttempt?.(attemptId, { status: 'FAILED', schemaValidationStatus: 'failure', validationErrors: [validationError], error: validationError })
        const diagnostic = result.diagnostic ? { ...result.diagnostic, parseStatus: 'failure' as const, schemaValidationStatus: 'failure' as const, status: 'FAILED' as const, validationErrors: [validationError] } : undefined
        return { ok: false as const, error: validationError, usage: result.usage, diagnostic }
      }
    }
    return result
  }
  setPreviousErrors(errors: readonly string[]) { this.previousErrors = errors }
}

class M5ALimitedGateway implements ModelGateway {
  readonly calls: ModelRequest<unknown>[] = []
  private total = 0
  private readonly roleCounts = new Map<string, number>()
  private readonly inner: ModelGateway
  private readonly maxTotal: number
  private readonly maxGap: number
  private readonly maxHypothesis: number
  constructor(inner: ModelGateway, maxTotal: number, maxGap: number, maxHypothesis: number) { this.inner = inner; this.maxTotal = maxTotal; this.maxGap = maxGap; this.maxHypothesis = maxHypothesis }
  annotateAttempt(id: string, patch: Parameters<NonNullable<ModelGateway['annotateAttempt']>>[1]) { this.inner.annotateAttempt?.(id, patch) }
  async structured<T>(request: ModelRequest<T>) {
    const roleCount = this.roleCounts.get(request.role) ?? 0
    const roleLimit = request.role === 'GapDiscovery' ? this.maxGap : request.role === 'HypothesisGenerator' ? this.maxHypothesis : this.maxTotal
    if (this.total >= this.maxTotal || roleCount >= roleLimit) return { ok: false as const, error: `BUDGET_EXHAUSTED: ${request.role} model-call budget exhausted` }
    this.total += 1; this.roleCounts.set(request.role, roleCount + 1); this.calls.push(request as ModelRequest<unknown>); return this.inner.structured(request)
  }
}

function validateHypothesisTransport(value: unknown, knownGapIds: ReadonlySet<string>, directEvidenceIds: ReadonlySet<string>, knownClaimIds: ReadonlySet<string>, knownProblemIds: ReadonlySet<string>): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !Array.isArray((value as Record<string, unknown>).hypotheses)) return 'model output must contain hypotheses[]'
  const allowed = new Set(['candidateId', 'originatingGapIds', 'sourceProblemNodeIds', 'sourceClaimIds', 'sourceEvidenceIds', 'statement', 'motivation', 'proposedMechanism', 'expectedMechanism', 'assumptions', 'evidenceFor', 'evidenceAgainst', 'falsificationConditions', 'expectedObservableResult', 'discriminativeExperimentIdea', 'generationOperator'])
  for (const [index, item] of ((value as { hypotheses: unknown[] }).hypotheses).entries()) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return `hypotheses[${index}] must be an object`
    const record = item as Record<string, unknown>; const unknown = Object.keys(record).find(key => !allowed.has(key)); if (unknown) return `hypotheses[${index}] contains unsupported field ${unknown}`
    for (const field of ['statement', 'motivation', 'proposedMechanism', 'expectedMechanism', 'expectedObservableResult', 'discriminativeExperimentIdea'] as const) if (typeof record[field] !== 'string' || !(record[field] as string).trim()) return `hypotheses[${index}].${field} is required`
    if ([record.statement, record.motivation, record.proposedMechanism, record.expectedMechanism].some(item => typeof item === 'string' && /\b(novel|novelty|proven|true|supported|survived|verified|falsified|absence of literature|no literature)\b/i.test(item))) return `hypotheses[${index}] contains unsupported epistemic or novelty assertion`
    const refs = (field: string) => Array.isArray(record[field]) && (record[field] as unknown[]).every(item => typeof item === 'string') ? (record[field] as string[]) : []
    if (!refs('originatingGapIds').length || refs('originatingGapIds').some(id => !knownGapIds.has(id))) return `hypotheses[${index}] has invalid originatingGapIds`
    if (refs('sourceEvidenceIds').some(id => !directEvidenceIds.has(id))) return `hypotheses[${index}] has invalid sourceEvidenceIds`
    if (refs('sourceClaimIds').some(id => !knownClaimIds.has(id))) return `hypotheses[${index}] has invalid sourceClaimIds`
    if (refs('sourceProblemNodeIds').some(id => !knownProblemIds.has(id))) return `hypotheses[${index}] has invalid sourceProblemNodeIds`
  }
  return undefined
}

async function generateM5APopulation(input: GapDiscoveryResult, source: M5ASourceState, projection: M5AScientificInputProjection, options: M5ACanaryOptions, gateway: ModelGateway | undefined, route: ModelRoute, now: string): Promise<{ population: Generation0Population; attempts: readonly unknown[]; calls: number }> {
  const eligible = input.gaps.filter(gap => gap.eligibility.eligible && gap.coverageState !== 'COVERAGE_ONLY').sort((a, b) => a.gapId.localeCompare(b.gapId)).slice(0, options.candidateGapBudget ?? 3)
  const candidateBudget = Math.max(0, Math.min(options.hypothesisBudget ?? 3, eligible.length || (options.hypothesisBudget ?? 3)))
  if (!eligible.length) return { population: emptyPopulation(now, input, candidateBudget, ['No eligible scientific gaps were accepted; coverage-only gaps remain non-generative.']), attempts: [], calls: 0 }
  const inputGeneration: HypothesisGenerationInput = { gapDiscovery: { ...input, gaps: eligible }, problemGraph: source.problemGraph, claims: source.claims, evidence: source.evidence }
  const inputArtifactIds = source.inputArtifactIds?.length ? [...source.inputArtifactIds] : []
  if (!gateway) return { population: await generateGeneration0Hypotheses(inputGeneration, { now, candidateBudget, inputArtifactIds }), attempts: [], calls: 0 }
  const retryGateway = new GenerationGateway(gateway, projection, options.maxHypothesisCalls ?? 2, inputArtifactIds, new Set(eligible.map(gap => gap.gapId)), new Set(source.evidence.filter(item => item.sourceTextVerified !== false && item.evidenceLevel !== 'MODEL_INTERPRETATION' && item.modelInterpretation !== true).map(item => item.evidenceId)), new Set(source.claims.map(item => item.claimId)), new Set(source.problemGraph.nodes.map(item => item.nodeId)))
  let population = await generateGeneration0Hypotheses(inputGeneration, { gateway: retryGateway, route, skillVersion: 'hypothesis-generator@m5a', now, candidateBudget, inputArtifactIds })
  let historicalAttempts = [...population.modelAttempts]
  let attempts = 1
  while (population.modelAttempts.at(-1) && (() => { const item = population.modelAttempts.at(-1)!; const diagnostic = item.diagnostic as ModelResponseDiagnostic | undefined; return !item.ok && (diagnostic?.parseStatus === 'failure' || diagnostic?.schemaValidationStatus === 'failure') })() && attempts < Math.min(options.maxHypothesisCalls ?? 2, 1 + (options.maxSerializationRetries ?? 1))) {
    retryGateway.setPreviousErrors(population.modelAttempts.flatMap(item => item.validationErrors)); population = await generateGeneration0Hypotheses(inputGeneration, { gateway: retryGateway, route, skillVersion: 'hypothesis-generator@m5a', now, candidateBudget, inputArtifactIds }); historicalAttempts = [...historicalAttempts, ...population.modelAttempts]; population = { ...population, modelAttempts: historicalAttempts }; attempts += 1
  }
  const context = { gaps: new Map(eligible.map(gap => [gap.gapId, gap])), problemNodeIds: new Set(source.problemGraph.nodes.map(node => node.nodeId)), claimIds: new Set(source.claims.map(claim => claim.claimId)), evidenceIds: new Set(source.evidence.map(item => item.evidenceId)), directEvidenceIds: new Set(source.evidence.filter(item => item.sourceTextVerified !== false && item.evidenceLevel !== 'MODEL_INTERPRETATION' && item.modelInterpretation !== true).map(item => item.evidenceId)) }
  validateGeneration0Population(population, context)
  return { population, attempts: retryGateway.calls, calls: attempts }
}

export function renderM5AReport(input: { readonly source: M5ASourceState; readonly result: { readonly gapDiscovery: GapDiscoveryResult; readonly population: Generation0Population; readonly projection: M5AScientificInputProjection; readonly limitations: readonly string[]; readonly deterministicGapCount?: number; readonly modelGapCount?: number; readonly modelCallCount?: number; readonly serializationRetryCount?: number; readonly checkpointSequence?: number; readonly eventCount?: number; readonly stopReason?: string }; readonly runId: string }): string {
  const { source, result, runId } = input; const completeness = source.completeness; const evidenceQualityLimitations = source.evidence.flatMap(item => item.limitations.filter(value => typeof value === 'string' && value.trim()).map(value => `Evidence quality limitation: ${value.trim()}`)); const limitations = sorted([...result.limitations, ...completenessLimitations(completeness), ...(result.projection.limitations ?? []), ...(source.limitations ?? []), ...evidenceQualityLimitations])
  const deterministicGapCount = result.deterministicGapCount ?? result.gapDiscovery.gaps.length; const modelGapCount = result.modelGapCount ?? 0
  const lines = [`# EvoResearch M5A canary`, ``, `- Run: ${runId}`, `- Input run: ${source.sourceRunId}`, `- Scientific completeness: ${completeness.scientificallyComplete === true ? 'true' : 'false'} (propagated; not upgraded)`, `- Projection: ${result.projection.projectionId}`, `- Deterministic gap count: ${deterministicGapCount}`, `- Model-generated gap count: ${modelGapCount}`, ``, `## Accepted research gaps`, ``]
  if (!result.gapDiscovery.gaps.length) lines.push('No research gaps were accepted.')
  for (const gap of result.gapDiscovery.gaps) lines.push(`- **${gap.gapId}** — ${gap.kind} (${gap.coverageState}); eligibility=${gap.eligibility.eligible ? 'eligible' : 'ineligible'}; uncertainty=${gap.uncertainty.level}; provenance: problems=[${gap.sourceProblemNodeIds.join(', ')}], claims=[${gap.sourceClaimIds.join(', ')}], direct evidence=[${gap.sourceEvidenceIds.join(', ')}], interpretation=[${gap.interpretationEvidenceIds.join(', ')}]. ${gap.statement}`)
  lines.push('', '## Rejected gaps', '')
  if (!result.gapDiscovery.rejected.length) lines.push('No gaps were rejected after validation.')
  for (const rejection of result.gapDiscovery.rejected) lines.push(`- signature=${rejection.signature}; source=${rejection.source}; reason=${rejection.reason}`)
  lines.push('', '## Generation-0 proposals', '')
  if (!result.population.hypotheses.length) lines.push('No Generation-0 proposals were accepted.')
  for (const h of result.population.hypotheses) lines.push(`- **${h.hypothesisId}** — gap=${h.originatingGapIds.join(', ')}; operator=${h.generationOperator}; status=PROVISIONAL_UNVERIFIED / candidate; statement=${h.statement}; mechanism=${h.proposedMechanism}; assumptions=${h.assumptions.join('; ') || 'none'}; evidence for=[${h.evidenceFor.join(', ')}]; evidence against=[${h.evidenceAgainst.join(', ')}]; falsification=${h.falsificationConditions.join('; ')}; proposed test=${h.discriminativeExperimentIdea}; provenance problems=[${h.sourceProblemNodeIds.join(', ')}], claims=[${h.sourceClaimIds.join(', ')}], direct evidence=[${h.sourceEvidenceIds.join(', ')}].`)
  lines.push('', '## Rejected Generation-0 candidates', '')
  if (!result.population.rejected.length) lines.push('No Generation-0 candidates were rejected after validation.')
  for (const rejection of result.population.rejected) lines.push(`- candidate=${rejection.candidateId ?? 'unknown'}; gaps=[${rejection.originatingGapIds.join(', ')}]; reason=${rejection.reason}`)
  lines.push('', '## Run accounting', '', `- Model calls: ${result.modelCallCount ?? 'unknown'}`, `- Structural serialization retries: ${result.serializationRetryCount ?? 'unknown'}`, '- Provider token usage: unavailable (the provider did not return trusted usage for this report).', `- Checkpoint sequence: ${result.checkpointSequence ?? 'unknown'}`, `- Event count: ${result.eventCount ?? 'unknown'}`, `- Stop reason: ${result.stopReason ?? 'M5A stops after Generation-0 persistence.'}`, '', '## Limitations and boundaries', '', ...limitations.map(item => `- ${item}`), '', '**NOVELTY HAS NOT BEEN VERIFIED.**', '**PRIOR-ART ATTACK HAS NOT RUN.**', '**FALSIFICATION HAS NOT RUN.**', '**PARETO SELECTION HAS NOT RUN ON THIS LIVE POPULATION.**', '', 'Coverage limitations are not scientific absence, novelty, truth, falsity, support, or completeness claims.')
  return `${lines.join('\n')}\n`
}

function runIdentity(root: string, now: string): { readonly runId: string; readonly outputDirectory: string } { const runId = `run-${now.replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`; return { runId, outputDirectory: resolve(root, runId) } }
function safeDiagnostic(value: unknown): unknown { try { return JSON.parse(JSON.stringify(value, (_key, item) => typeof item === 'string' && /bearer\s|api[_-]?key|authorization/i.test(item) ? '[REDACTED]' : item)) } catch { return { error: 'diagnostic serialization failed' } } }
function persist(directory: string, values: Readonly<Record<string, unknown>>): void { mkdirSync(directory, { recursive: true }); for (const [name, value] of Object.entries(values)) { const target = resolve(directory, name); mkdirSync(resolve(target, '..'), { recursive: true }); if (name.toLowerCase().endsWith('.md')) { if (typeof value !== 'string') throw new TypeError(`${name} must be Markdown text`); writeFileSync(target, value, 'utf8') } else writeFileSync(target, JSON.stringify(value, null, 2), 'utf8') } }
function lifecycleEvent(runId: string, sequence: number, type: DomainEvent['type'], occurredAt: string, payload: Readonly<Record<string, unknown>>): DomainEvent { return { eventId: deterministicId('event', { runId, sequence, type, payload }) as never, runId: runId as never, sequence, type, occurredAt, payload } }

export function dryRunM5A(options: Omit<M5ACanaryOptions, 'mode'> = {}): M5ACanaryResult {
  const config = resolveModelConfiguration({ projectRoot: options.projectRoot }); const source = options.source ?? (options.inputRun ? loadM5ASourceRun(options.inputRun) : undefined); const now = options.now ?? nowIso(); const outputDirectory = runIdentity(options.outputRoot ?? resolve(options.projectRoot ?? '.', 'outputs'), now).outputDirectory
  const callPlan = planM5ACanaryCalls(options)
  const deterministic = source ? discoverResearchGaps({ problemGraph: source.problemGraph, claims: source.claims, evidence: source.evidence, evidenceGraph: source.evidenceGraph, completeness: source.completeness, now }) : undefined
  const eligible = deterministic?.gaps.filter(gap => gap.eligibility.eligible).length ?? 0
  const localErrors = [...(!source ? ['input scientific state is unavailable'] : []), ...callPlan.errors]
  const dryRun: M5ADryRun = { modelCalls: 0, openAlexCalls: 0, networkCalls: 0, inputAvailable: Boolean(source), inputStateHash: source?.inputStateHash, scientificallyComplete: source?.completeness.scientificallyComplete, candidateGapCount: deterministic?.gaps.length ?? 0, eligibleGapUpperBound: Math.min(callPlan.candidateGapBudget, eligible), expectedModelCallUpperBound: callPlan.total, callPlan, budgetPlanAccepted: callPlan.errors.length === 0, localInputReady: Boolean(source), liveConfigurationReady: config.ready, outputDirectory, activeGates: ['preflight-before-live', 'max 5 physical model calls', 'OpenAlex calls = 0', 'ResearchGap validation', 'coverage-only firewall', 'MIXED independent provenance', 'Generation-0 validation', 'novelty unverified', 'immutable source run'], limitations: source ? sorted([...(deterministic?.limitations ?? []), ...completenessLimitations(source.completeness)]) : ['No persisted input run was supplied.'] }
  return { ok: Boolean(source) && localErrors.length === 0, mode: 'dry-run', sourceRunId: source?.sourceRunId ?? '', outputDirectory, dryRun, config: safeModelConfigurationSnapshot(config), errors: [...localErrors, ...configurationDiagnostics(config)] }
}

export async function runM5ACanary(options: M5ACanaryOptions): Promise<M5ACanaryResult> {
  const mode = options.mode ?? 'dry-run'; if (mode === 'dry-run') return dryRunM5A(options)
  const callPlan = planM5ACanaryCalls(options)
  const config = resolveModelConfiguration({ projectRoot: options.projectRoot }); const source = options.source ?? (options.inputRun ? loadM5ASourceRun(options.inputRun) : undefined); const errors: string[] = [...callPlan.errors]
  if (!source) errors.push('input scientific state is unavailable'); if (!config.ready) errors.push(...configurationDiagnostics(config)); if (config.structuredOutputMode !== 'prompt_json') errors.push('M5A requires prompt_json structured output'); if (config.streaming !== 'required') errors.push('M5A requires streaming=required'); if (errors.length) return { ok: false, mode, sourceRunId: source?.sourceRunId ?? '', outputDirectory: '', config: safeModelConfigurationSnapshot(config), errors }
  if (!source) return { ok: false, mode, sourceRunId: '', outputDirectory: '', config: safeModelConfigurationSnapshot(config), errors }
  const now = options.now ?? nowIso(); const identity = runIdentity(options.outputRoot ?? resolve(options.projectRoot ?? '.', 'outputs'), now); const runId = identity.runId; const outputDirectory = identity.outputDirectory; const route = options.route ?? { provider: config.provider, model: config.model }
  const preflight = options.preflight ?? await (options.preflightImpl ?? preflightModel)({ baseUrl: config.baseUrl, apiKey: config.apiKey, model: config.model, structuredOutputMode: 'prompt_json', streaming: 'required', maxAttempts: callPlan.preflight })
  if ((preflight.attemptCount ?? preflight.attempts?.length ?? 0) > callPlan.preflight) errors.push(`CANARY_PREFLIGHT_BUDGET_EXCEEDED: ${preflight.attemptCount} attempts exceed planned ${callPlan.preflight}`)
  if (!preflight.responseSucceeded || !preflight.structuredOutputSupported) {
    const safePreflight = serializePreflight(preflight)
    const reason = 'MODEL_PREFLIGHT_FAILED: live execution stopped before GapDiscovery'
    const events = [lifecycleEvent(runId, 1, 'run.created', now, { sourceRunId: source.sourceRunId }), lifecycleEvent(runId, 2, 'stage.started', now, { stage: 'MODEL_PREFLIGHT' }), ...(preflight.attempts ?? []).map((attempt, index) => lifecycleEvent(runId, index + 3, 'model.attempt', now, { stage: 'MODEL_PREFLIGHT', role: 'MODEL_PREFLIGHT', attemptIndex: attempt.attemptIndex, status: attempt.transportSucceeded ? 'SUCCEEDED' : 'FAILED' })), lifecycleEvent(runId, (preflight.attempts?.length ?? 0) + 3, 'stage.failed', now, { stage: 'MODEL_PREFLIGHT', error: reason })]
    persist(outputDirectory, { 'input-state.json': { sourceRunId: source.sourceRunId, inputArtifactIds: source.inputArtifactIds ?? [], sourceDirectory: source.sourceDirectory, inputStateHash: source.inputStateHash, sourceFiles: source.sourceFiles, completeness: source.completeness, normalization: source.normalization ?? [], limitations: [...(source.limitations ?? []), ...completenessLimitations(source.completeness)] }, 'config.json': safeModelConfigurationSnapshot(config), 'model-preflight.json': safePreflight, 'stage-state.json': [{ stage: 'MODEL_PREFLIGHT', status: 'FAILED', error: reason }], 'events.json': events })
    return { ok: false, mode, runId, sourceRunId: source.sourceRunId, outputDirectory, config: safeModelConfigurationSnapshot(config), preflight: safePreflight, errors: [reason] }
  }
  const gateway = options.gateway ?? new ResponsesModelGateway({ baseUrl: config.baseUrl, apiKey: config.apiKey, model: config.model, structuredOutputMode: 'prompt_json', streaming: 'required', maxRetries: 0 })
  const preflightCalls = Math.max(1, preflight.attemptCount ?? preflight.attempts?.length ?? 1)
  const boundedGateway = new M5ALimitedGateway(gateway, Math.max(0, callPlan.limit - preflightCalls), callPlan.gapDiscovery, callPlan.generation0)
  const input: GapDiscoveryInput = { problemGraph: source.problemGraph, claims: source.claims, evidence: source.evidence, evidenceGraph: source.evidenceGraph, completeness: source.completeness, now }
  const inputArtifactIds = source.inputArtifactIds?.length ? [...source.inputArtifactIds] : []
  const gapResult = await runModelGapDiscovery(input, { gateway: boundedGateway, route, now, candidateBudget: options.candidateGapBudget ?? 3, maxSerializationRetries: options.maxSerializationRetries ?? 1, inputArtifactIds })
  const projection = gapResult.projection; const gapModelFailed = gapResult.modelAttempted && gapResult.attempts.length > 0 && !gapResult.attempts.some(item => item.status === 'SUCCEEDED'); const generation = gapModelFailed ? { population: emptyPopulation(now, gapResult.gapDiscovery, options.hypothesisBudget ?? 3, ['GapDiscovery model contract failed; Generation-0 was blocked.']), attempts: [], calls: 0 } : await generateM5APopulation(gapResult.gapDiscovery, source, projection, options, boundedGateway, route, now)
  const initialEvents: DomainEvent[] = []
  const appendInitial = (type: DomainEvent['type'], payload: Readonly<Record<string, unknown>>) => initialEvents.push(lifecycleEvent(runId, initialEvents.length + 1, type, now, payload))
  appendInitial('run.created', { sourceRunId: source.sourceRunId, sourceInputStateHash: source.inputStateHash })
  appendInitial('stage.started', { stage: 'MODEL_PREFLIGHT' })
  for (const [index, attempt] of (preflight.attempts ?? []).entries()) appendInitial('model.attempt', { stage: 'MODEL_PREFLIGHT', role: 'MODEL_PREFLIGHT', attemptIndex: attempt.attemptIndex ?? index + 1, status: attempt.transportSucceeded ? 'SUCCEEDED' : 'FAILED' })
  appendInitial('stage.completed', { stage: 'MODEL_PREFLIGHT' })
  const stateForHash = { gapDiscovery: gapResult.gapDiscovery, generation0: generation.population }
  const extensionStore = new FileGeneration0RunStore(outputDirectory)
  const sharedExtension = await runGeneration0Extension({ runId, sourceRunId: source.sourceRunId, problemGraph: source.problemGraph, claims: source.claims, evidence: source.evidence, evidenceGraph: source.evidenceGraph, completeness: source.completeness, now, inputArtifactIds, gapReasoningResult: gapResult, generation0Result: generation.population, candidateBudget: options.hypothesisBudget ?? 3, initialEvents, stateForHash, store: extensionStore, configuration: safeModelConfigurationSnapshot(config), budget: { limits: { maxModelCalls: callPlan.limit, maxSearchCalls: 0, maxCandidates: callPlan.hypothesisBudget, maxMutations: 0, maxTokens: 0 }, usage: { maxModelCalls: preflightCalls, maxSearchCalls: 0, maxCandidates: 0, maxMutations: 0, maxTokens: 0 } } }, { requireGapModelSuccess: true, allowUnverifiedEvidence: true, store: extensionStore })
  const sharedPopulation = sharedExtension.generation0
  const limitations = sorted([...gapResult.limitations, ...sharedExtension.limitations, ...sharedPopulation.limitations, ...completenessLimitations(source.completeness), ...(source.limitations ?? [])])
  const state = stateForHash
  const generationContractFailed = sharedExtension.status === 'GENERATION_FAILED'
  const noEligibleGaps = gapResult.gapDiscovery.gaps.every(gap => !gap.eligibility.eligible || gap.coverageState === 'COVERAGE_ONLY')
  const gapStatus = gapModelFailed ? 'FAILED' : 'SUCCEEDED'; const generationStatus = gapModelFailed ? 'BLOCKED' : noEligibleGaps ? 'SKIPPED_NO_ELIGIBLE_GAPS' : generationContractFailed ? 'FAILED' : 'SUCCEEDED'
  const checkpoint = sharedExtension.checkpoint
  const events = sharedExtension.events
  const modelAttemptCount = preflightCalls + gapResult.attempts.length + generation.population.modelAttempts.length
  const retryCount = Math.max(0, preflightCalls - 1) + Math.max(0, gapResult.attempts.length - 1) + Math.max(0, generation.population.modelAttempts.length - 1)
  const stopReason = generationStatus === 'SUCCEEDED' ? 'Generation-0 boundary completed; canary stops before later roles.' : generationStatus === 'SKIPPED_NO_ELIGIBLE_GAPS' ? 'No eligible scientific gaps; Generation-0 skipped.' : generationStatus === 'BLOCKED' ? 'GapDiscovery contract failed; Generation-0 blocked.' : 'Generation-0 contract failed; no accepted hypotheses.'
  const report = renderM5AReport({ source, result: { gapDiscovery: gapResult.gapDiscovery, population: sharedPopulation, projection, limitations, deterministicGapCount: gapResult.baseline.gaps.length, modelGapCount: gapResult.modelGaps.length, modelCallCount: modelAttemptCount, serializationRetryCount: retryCount, checkpointSequence: checkpoint.sequence, eventCount: events.length, stopReason }, runId })
  const failed = gapModelFailed || generationContractFailed
  const stageState = [{ stage: 'MODEL_PREFLIGHT', status: 'SUCCEEDED' }, { stage: 'GAP_DISCOVERY', status: gapStatus, ...(gapModelFailed ? { error: 'GapDiscovery model contract failed' } : {}) }, { stage: 'GENERATION_0', status: generationStatus, acceptedHypothesisCount: generation.population.hypotheses.length, ...(generationContractFailed ? { error: 'HypothesisGenerator model contract failed' } : gapModelFailed ? { error: 'blocked by GapDiscovery failure' } : noEligibleGaps ? { reason: 'no eligible scientific gaps' } : {}) }, { stage: 'M5A_STOP', status: 'STOPPED' }]
  persist(outputDirectory, { 'input-state.json': { sourceRunId: source.sourceRunId, inputArtifactIds: source.inputArtifactIds ?? [], sourceDirectory: source.sourceDirectory, inputStateHash: source.inputStateHash, sourceFiles: source.sourceFiles, completeness: source.completeness, normalization: source.normalization ?? [], limitations: [...(source.limitations ?? []), ...completenessLimitations(source.completeness)] }, 'config.json': safeModelConfigurationSnapshot(config), 'model-preflight.json': serializePreflight(preflight), 'run-snapshot.json': { runId, sourceRunId: source.sourceRunId, status: failed ? 'FAILED' : 'STOPPED', scientificallyComplete: source.completeness.scientificallyComplete === true, checkpointSequence: checkpoint.sequence, stateHash: checkpoint.stateHash }, 'state.json': state, 'stage-state.json': stageState, 'input-projection.json': projection, 'gap-discovery.json': { ...gapResult.gapDiscovery, deterministicGapCount: gapResult.baseline.gaps.length, modelGapCount: gapResult.modelGaps.length }, 'gap-validation.json': gapResult.gapDiscovery.gaps.map(gap => ({ gapId: gap.gapId, valid: true, eligibility: gap.eligibility })), 'generation-0.json': sharedPopulation, 'hypothesis-validation.json': sharedPopulation.hypotheses.map(hypothesis => ({ hypothesisId: hypothesis.hypothesisId, valid: true, status: hypothesis.status, noveltyStatus: hypothesis.noveltyStatus })), 'model-attempts.json': safeDiagnostic([...(gateway as unknown as { attempts?: unknown[] }).attempts ?? [], ...gapResult.attempts, ...generation.attempts]), 'events.json': events, 'checkpoint.json': checkpoint, 'usage.json': checkpoint.budget.usage, 'report.md': report })
  return { ok: true, mode, runId, sourceRunId: source.sourceRunId, outputDirectory, config: safeModelConfigurationSnapshot(config), preflight: serializePreflight(preflight), report: { sourceRunId: source.sourceRunId, runId, status: failed ? 'FAILED' : 'STOPPED', scientificallyComplete: source.completeness.scientificallyComplete === true, limitations, gapCount: gapResult.gapDiscovery.gaps.length, eligibleGapCount: gapResult.gapDiscovery.gaps.filter(gap => gap.eligibility.eligible).length, hypothesisCount: generation.population.hypotheses.length, reportPath: resolve(outputDirectory, 'report.md') }, errors: failed ? ['Generation-0 extension did not produce an accepted model result'] : [] }
}

export const runM5ACanaryCommand = runM5ACanary
export const loadM5AInput = loadM5ASourceRun

