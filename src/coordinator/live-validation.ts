import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { ingestArtifact, buildProblemGraph, runPaperReader, runProblemExtractor, deterministicId, ValidationError, type ArtifactManifest, type Claim, type Evidence, type ExtractedDocument, type ModelGateway, type ModelRequest, type ModelRoute, type PaperReaderOutput, type ProblemExtractorOutput, type ClaimId, type EvidenceId, type PaperReaderAttemptReport, type CoverageStatus } from '../domain/index.ts'
import { extractWithFallback } from '../adapters/pdf.ts'
import { preflightModel, serializePreflight, PREFLIGHT_DEFAULT_RETRY_DELAY_MS, PREFLIGHT_MAX_ATTEMPTS, PREFLIGHT_MAX_RETRY_DELAY_MS, type ModelPreflightOptions, type ModelPreflightResult } from '../adapters/model-preflight.ts'
import { ResponsesModelGateway } from '../adapters/responses-model.ts'
import { preflightPyMuPDF, type PythonPreflight } from '../adapters/python-runtime.ts'
import { boundDocumentContext } from './context.ts'
import { VALIDATION_STAGES, type ValidationStage } from './scientific-validation.ts'
import { assessExtraction, summarizeEvidenceAssessment, type EvaluationCase, type EvidenceAssessmentSummary } from '../evaluation/index.ts'
import { deriveRetrievalNeeds, EvidenceGraph, OpenAlexProvider, planQueries, makeLiteratureQueryMembership, selectSourcesForMembership, validateLiteratureQueryMembership, validateSourceSelection, requireCorpusCutoff, OPENALEX_DEFAULT_TIMEOUT_MS, OPENALEX_MAX_ATTEMPTS, OPENALEX_RETRY_POLICY, UNKNOWN_DATE_POLICY, validateCorpusCutoff, type ClaimRelation, type LiteratureQuery, type LiteratureQueryMembership, type LiteratureRecord, type RetrievalNeed, type SearchCoverage, type SourceSelection } from '../literature/index.ts'
import { scoreLiteratureCandidate } from '../literature/source-scoring.ts'
import { runEvidenceExtractor, materializeEvidence, type EvidenceExtractionInput, type TrustedEvidenceExtractorOutput } from '../evidence/index.ts'
import { RunBudget, DEFAULT_RUN_BUDGET, BudgetExhaustedError, type RunBudgetLimits, type RunBudgetUsage } from '../domain/run-budget.ts'
import { runGeneration0Extension, type Generation0ExtensionResult } from './generation0-extension.ts'
import { FileGeneration0RunStore } from '../adapters/generation0-run-store.ts'
import { buildResponsesEndpoint } from '../adapters/responses-model.ts'
import { configurationDiagnostics, resolveModelConfiguration, safeModelConfigurationSnapshot, type SafeModelConfigurationSnapshot } from '../config/model-config.ts'

export interface WiringEntry { readonly stage: string; readonly implementation: string; readonly input: string; readonly output: string; readonly validator: string; readonly persistence: string; readonly liveCapable: boolean }
export const LIVE_WIRING: readonly WiringEntry[] = [
  { stage: 'INGEST', implementation: 'ArtifactReader/ingestArtifact', input: 'local PDF bytes + manifest metadata', output: 'ArtifactManifest[]', validator: 'ingestArtifact', persistence: 'ingest.json', liveCapable: true },
  { stage: 'EXTRACT', implementation: 'extractWithFallback', input: 'ArtifactManifest + bytes', output: 'ExtractedDocument[] + ExtractionQuality[]', validator: 'assessExtraction/requireExtractionPass', persistence: 'extraction-report.json', liveCapable: true },
  { stage: 'PAPER_READ', implementation: 'runPaperReader(ModelGateway)', input: 'bounded paper context', output: 'PaperReaderOutput[]', validator: 'validatePaperReaderOutput', persistence: 'paper-reader/', liveCapable: true },
  { stage: 'PROBLEM_EXTRACT', implementation: 'runProblemExtractor(ModelGateway)', input: 'paper-local PaperReaderOutput', output: 'ProblemExtractorOutput[]', validator: 'ProblemExtractor envelope validation', persistence: 'problem-extractor/', liveCapable: true },
  { stage: 'PROBLEM_GRAPH', implementation: 'buildProblemGraph', input: 'paper-local nodes, edges, evidence', output: 'ResearchProblemGraph', validator: 'parseResearchProblemGraph', persistence: 'problem-graph.json', liveCapable: true },
  { stage: 'RETRIEVAL_NEEDS', implementation: 'deriveRetrievalNeeds', input: 'ResearchProblemGraph', output: 'RetrievalNeed[]', validator: 'deterministic domain construction', persistence: 'retrieval-needs.json', liveCapable: true },
  { stage: 'QUERY_PLAN', implementation: 'planQueries', input: 'RetrievalNeed[]', output: 'LiteratureQuery[]', validator: 'deterministic planner', persistence: 'literature-queries.json', liveCapable: true },
  { stage: 'LITERATURE_SEARCH', implementation: 'OpenAlexProvider.search', input: 'LiteratureQuery[]', output: 'LiteratureRecord[] + SearchCoverage[] + query memberships', validator: 'OpenAlex provider coverage', persistence: 'search-coverage.json/literature-records.json/literature-query-membership.json', liveCapable: true },
  { stage: 'SOURCE_SELECT', implementation: 'selectSourcesForMembership', input: 'query-local membership + canonical records', output: 'selected source records + coverage provenance', validator: 'deterministic source selection and provenance validation', persistence: 'source-selection.json', liveCapable: true },
  { stage: 'EVIDENCE_EXTRACT', implementation: 'EvidenceExtractor(ModelGateway)', input: 'claim + selected source snapshot + trusted provenance', output: 'LiteratureEvidence[]', validator: 'validateEvidenceExtractorInput/Output/materializeEvidence', persistence: 'evidence-plan.json/claims.json/evidence.json', liveCapable: true },
  { stage: 'EVIDENCE_GRAPH', implementation: 'EvidenceGraph', input: 'claims + evidence + links', output: 'Evidence graph', validator: 'EvidenceGraph provenance invariants', persistence: 'evidence-graph.json', liveCapable: true },
  { stage: 'EVALUATE', implementation: 'evaluation harness', input: 'all persisted stage outputs', output: 'EvaluationReport', validator: 'evaluation helpers', persistence: 'evaluation-report.json', liveCapable: true },
  { stage: 'REPORT', implementation: 'renderEvaluationReport + live report renderer', input: 'EvaluationReport + stage state', output: 'report.md', validator: 'required section renderer', persistence: 'report.md', liveCapable: true },
]

export interface DryRunResult { readonly ok: boolean; readonly mode: 'dry-run'; readonly caseId: string; readonly outputDirectory: string; readonly stopAfter?: ValidationStage; readonly plannedStages: readonly string[]; readonly intentionallyNotRunStages: readonly string[]; readonly generation0OptIn?: boolean; readonly modelConfiguration: SafeModelConfigurationSnapshot & { readonly endpoint: string; readonly gateway: 'ResponsesModelGateway'; readonly errors: readonly string[] }; readonly python?: PythonPreflight; readonly papers: readonly Record<string, unknown>[]; readonly academicProvider: { readonly id: string; readonly configured: boolean; readonly networkCalls: number }; readonly wiring: readonly WiringEntry[]; readonly budget: RunBudgetLimits; readonly zeroModelCalls: true; readonly zeroOpenAlexCalls: true; readonly errors: readonly string[] }

export interface LiveRunResult { readonly mode: 'live'; readonly runId: string; readonly outputDirectory: string; readonly status: 'COMPLETE' | 'STOPPED_AS_REQUESTED' | 'FAILED'; readonly scientificallyComplete: boolean; readonly stopAfter?: ValidationStage; readonly stages: readonly { readonly stage: string; readonly status: 'COMPLETED' | 'INTENTIONALLY_NOT_RUN' | 'FAILED' | 'BUDGET_EXHAUSTED'; readonly error?: string }[]; readonly failedStage?: string; readonly generation0?: Pick<Generation0ExtensionResult, 'status' | 'gapDiscovery' | 'generation0' | 'checkpoint'> }

/** Map EvidenceExtractor polarities back to the relation vocabulary used by EvidenceGraph. */
export function mapEvidencePolarityToClaimRelation(polarity: Evidence['polarity']): ClaimRelation {
  if (polarity === 'SUPPORT') return 'SUPPORTS'
  if (polarity === 'CONTRADICT') return 'CONTRADICTS'
  if (polarity === 'WEAKEN') return 'QUALIFIES'
  return 'INSUFFICIENT'
}

export function validateWiring(): readonly WiringEntry[] { if (LIVE_WIRING.length !== VALIDATION_STAGES.length || LIVE_WIRING.some(item => !item.liveCapable)) throw new Error('LIVE_STAGE_WIRING_INCOMPLETE'); return LIVE_WIRING }
export function validateStopAfter(value: string | undefined): ValidationStage | undefined { if (value === undefined) return undefined; if (!(VALIDATION_STAGES as readonly string[]).includes(value)) throw new Error(`INVALID_STOP_AFTER_STAGE: ${value}`); return value as ValidationStage }

export function loadEvaluationCase(casePath: string): { readonly spec: EvaluationCase; readonly root: string } {
  const spec = JSON.parse(readFileSync(casePath, 'utf8')) as EvaluationCase
  if (!spec.caseId || !Array.isArray(spec.paperArtifacts) || spec.paperArtifacts.length < 3 || spec.paperArtifacts.length > 10) throw new Error('case must contain 3–10 paper artifacts')
  if (spec.corpusCutoff !== undefined) validateCorpusCutoff(spec.corpusCutoff)
  return { spec, root: resolve(casePath, '..') }
}

function canonicalOutputRoot(root: string): string { const normalized = root.replace(/[\\/]+$/, ''); return /[\\/]outputs$/i.test(normalized) ? normalized : resolve(normalized, 'outputs') }
function plannedDirectory(root: string): string { return resolve(canonicalOutputRoot(root), `run-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`) }
function modelConfig() {
  const resolved = resolveModelConfiguration()
  const snapshot = safeModelConfigurationSnapshot(resolved)
  return { ...snapshot, endpoint: buildResponsesEndpoint(resolved.baseUrl), gateway: 'ResponsesModelGateway' as const, errors: configurationDiagnostics(resolved) }
}

export function dryRunCase(casePath: string, options: { readonly outputRoot?: string; readonly budget?: Partial<RunBudgetLimits>; readonly stopAfter?: ValidationStage; readonly enableGeneration0?: boolean } = {}): DryRunResult {
  validateStopAfter(options.stopAfter)
  const { spec, root } = loadEvaluationCase(resolve(casePath)); const errors: string[] = []; const papers: Record<string, unknown>[] = []; let python: PythonPreflight | undefined
  for (const artifact of spec.paperArtifacts) {
    try {
      const absolutePath = resolve(root, artifact.path); if (!existsSync(absolutePath)) throw new Error(`missing artifact ${artifact.path}`)
      const bytes = readFileSync(absolutePath); const manifest = ingestArtifact(bytes, { paperId: artifact.paperId as never, originalFilename: artifact.path.split(/[\\/]/).pop() ?? artifact.path, mediaType: artifact.mediaType ?? 'application/pdf', ingestionTimestamp: new Date().toISOString(), localPath: absolutePath }); const extraction = extractWithFallback(manifest, bytes); const quality = extraction.quality ?? assessExtraction({ artifactId: manifest.artifactId, parser: 'pdf-text-stream', parserVersion: manifest.parserVersion, pages: [], sections: [], spans: [], extractionWarnings: extraction.attempts.map(attempt => attempt.error ?? `${attempt.adapter}: ${attempt.quality?.status}`) }); papers.push({ paperId: artifact.paperId, path: artifact.path, bytes: bytes.byteLength, sha256: manifest.sha256, adapter: extraction.document?.extractionProvenance?.adapter, quality, attempts: extraction.attempts }); if (quality.status === 'FAIL') errors.push(`${artifact.paperId}: extraction quality ${quality.status}`)
    } catch (error) { errors.push(`${artifact.paperId}: ${error instanceof Error ? error.message : 'artifact validation failed'}`) }
  }
  try { python = preflightPyMuPDF() } catch (error) { errors.push(error instanceof Error ? error.message : 'PyMuPDF preflight failed') }
  const model = modelConfig(); errors.push(...model.errors)
  if (spec.corpusCutoff === undefined) errors.push('CORPUS_CUTOFF_REQUIRED: explicit corpusCutoff is required before LITERATURE_SEARCH')
  try { validateWiring() } catch (error) { errors.push(error instanceof Error ? error.message : 'stage wiring is incomplete') }
  const outputDirectory = resolve(options.outputRoot ?? resolve(root, 'outputs'), `run-planned-${new Date().toISOString().replace(/[:.]/g, '-')}`)
  const stopIndex = options.stopAfter ? VALIDATION_STAGES.indexOf(options.stopAfter) : VALIDATION_STAGES.length - 1
  return { ok: errors.length === 0, mode: 'dry-run', caseId: spec.caseId, outputDirectory, stopAfter: options.stopAfter, plannedStages: options.enableGeneration0 && !options.stopAfter ? [...VALIDATION_STAGES.slice(0, stopIndex + 1), 'GAP_DISCOVERY', 'GENERATION_0'] : VALIDATION_STAGES.slice(0, stopIndex + 1), intentionallyNotRunStages: VALIDATION_STAGES.slice(stopIndex + 1), generation0OptIn: options.enableGeneration0 === true, modelConfiguration: model, python, papers, academicProvider: { id: 'openalex', configured: true, networkCalls: 0 }, wiring: LIVE_WIRING, budget: { ...DEFAULT_RUN_BUDGET, ...options.budget }, zeroModelCalls: true, zeroOpenAlexCalls: true, errors }
}

class BudgetedGateway implements ModelGateway {
  private readonly inner: ModelGateway
  private readonly budget: RunBudget
  private readonly usage: { inputTokens: number; outputTokens: number; totalTokens: number }
  constructor(inner: ModelGateway, budget: RunBudget, usage: { inputTokens: number; outputTokens: number; totalTokens: number }) { this.inner = inner; this.budget = budget; this.usage = usage }
  get attempts(): readonly unknown[] { const value = this.inner as unknown as { attempts?: readonly unknown[] }; return value.attempts ?? [] }
  annotateAttempt(attemptId: string, patch: Parameters<NonNullable<ModelGateway['annotateAttempt']>>[1]) { this.inner.annotateAttempt?.(attemptId, patch) }
  async structured<T>(request: ModelRequest<T>) { this.budget.modelCall(request.role); const result = await this.inner.structured(request); if (result.usage) { this.usage.inputTokens += result.usage.inputTokens ?? 0; this.usage.outputTokens += result.usage.outputTokens ?? 0; this.usage.totalTokens += result.usage.totalTokens ?? 0 } return result }
}

function writeJson(directory: string, name: string, value: unknown) { const parts = name.split('/'); const file = parts.pop()!; const target = resolve(directory, ...parts); mkdirSync(target, { recursive: true }); writeFileSync(resolve(target, file), JSON.stringify(value, null, 2), 'utf8') }
function initializeOutput(directory: string) { mkdirSync(directory, { recursive: true }); for (const name of ['paper-reader', 'problem-extractor', 'raw']) mkdirSync(resolve(directory, name), { recursive: true }); mkdirSync(resolve(directory, 'paper-reader', 'failed-attempts'), { recursive: true }); for (const name of ['ingest.json', 'problem-graph.json', 'retrieval-needs.json', 'literature-queries.json', 'search-coverage.json', 'literature-records.json', 'literature-query-membership.json', 'source-selection.json', 'claims.json', 'evidence.json', 'evidence-graph.json', 'evaluation-report.json', 'extraction-report.json', 'model-attempts.json']) writeJson(directory, name, []); writeJson(directory, 'model-preflight.json', { status: 'PENDING', attemptCount: 0, attempts: [] }); writeJson(directory, 'evidence-plan.json', { status: 'NOT_PLANNED' }) }
function persistModelAttempts(directory: string, gateway: BudgetedGateway) { let attempts: Record<string, unknown>[] = []; try { const existing = JSON.parse(readFileSync(resolve(directory, 'model-attempts.json'), 'utf8')); if (Array.isArray(existing)) attempts = existing } catch { /* initializeOutput creates the ledger */ } for (const item of gateway.attempts as readonly Record<string, unknown>[]) if (!attempts.some(entry => entry.attemptId === item.attemptId)) attempts.push(item); writeJson(directory, 'model-attempts.json', attempts) }

function persistPaperReaderAttempt(outputDirectory: string, paperId: string, report: PaperReaderAttemptReport, gateway: BudgetedGateway) {
  persistModelAttempts(outputDirectory, gateway)
  let attempts = JSON.parse(readFileSync(resolve(outputDirectory, 'model-attempts.json'), 'utf8')) as Record<string, unknown>[]
  if (!attempts.some(item => item.attemptId === report.request.attemptId)) attempts.push({ ...(report.diagnostic ?? { attemptId: report.request.attemptId, model: report.request.route.model, normalizedTextPresent: false, parseStatus: 'not-attempted' as const, schemaValidationStatus: 'failure' as const, status: 'FAILED' as const, outputTrust: 'UNTRUSTED / UNVALIDATED' as const }), role: report.request.role, stage: report.request.stage, route: report.request.route, skillVersion: report.request.skillVersion, schemaVersion: report.request.schemaVersion, inputArtifactIds: report.request.inputArtifactIds, inputEvidenceIds: report.request.inputEvidenceIds, success: report.validationErrors.length === 0, error: report.validationErrors[0] })
  writeJson(outputDirectory, 'model-attempts.json', attempts)
  if (report.validationErrors.length === 0) return
  const attemptRoot = `paper-reader/failed-attempts/${paperId}/attempt-${report.attemptNumber}`
  const diagnostic = report.diagnostic
  writeJson(outputDirectory, `${attemptRoot}/metadata.json`, { paperId, attemptId: report.request.attemptId, attemptNumber: report.attemptNumber, model: report.request.route.model, timestamp: diagnostic?.responseTimestamp ?? new Date().toISOString(), status: 'FAILED', latencyMs: diagnostic?.latencyMs, usage: diagnostic?.usage ?? report.result.usage, responseHash: diagnostic?.normalizedTextHash, contentType: diagnostic?.contentType, streamEventTypes: diagnostic?.streamEventTypes, terminalEventObserved: diagnostic?.terminalObserved, normalizedTextPresent: diagnostic?.normalizedTextPresent ?? false, structuredOutputMode: diagnostic?.structuredOutputMode ?? 'prompt_json', parseStatus: diagnostic?.parseStatus ?? 'unknown', schemaValidationStatus: diagnostic?.schemaValidationStatus ?? 'failure', validationErrors: report.validationErrors, trustedEnrichment: report.trustedEnrichment ?? diagnostic?.trustedEnrichment ?? [], outputTrust: 'UNTRUSTED / UNVALIDATED' })
  if (diagnostic?.normalizedTextPreview !== undefined) writeFileSync(resolve(outputDirectory, attemptRoot, 'reconstructed-output.txt'), diagnostic.normalizedTextPreview, 'utf8')
  if (report.parsedOutput !== undefined && (diagnostic?.parseStatus === 'success' || report.result.ok)) writeJson(outputDirectory, `${attemptRoot}/parsed-output.json`, report.parsedOutput)
  writeJson(outputDirectory, `${attemptRoot}/validation-errors.json`, report.validationErrors)
}

function readerEvidence(paperId: string, document: ExtractedDocument, reader: PaperReaderOutput, now: string): { readonly evidence: readonly Evidence[]; readonly claims: readonly Claim[] } { const spans = new Set(document.spans.map(span => JSON.stringify(span.locator))); const evidence: Evidence[] = []; const claims: Claim[] = []; for (const item of reader.items) { const claimId = deterministicId('claim', { paperId, itemId: item.itemId }) as ClaimId; const locator = item.locators[0]; if (item.interpretation === 'DIRECT_EVIDENCE' && (!locator || !spans.has(JSON.stringify(locator)))) throw new Error(`INVALID_PROVENANCE: PaperReader item ${item.itemId}`); claims.push({ claimId, paperId: paperId as never, statement: item.statement, kind: item.type === 'claim' ? 'observation' : item.type as Claim['kind'], provenance: item.interpretation === 'DIRECT_EVIDENCE' ? { sourceType: 'artifact', sourceId: document.artifactId, locator: locator ? JSON.stringify(locator) : undefined } : { sourceType: 'model', sourceId: item.itemId }, artifactId: document.artifactId }); evidence.push({ evidenceId: deterministicId('evidence', { paperId, itemId: item.itemId }) as EvidenceId, kind: item.interpretation === 'DIRECT_EVIDENCE' ? 'quote' : 'interpretation', claim: item.statement, polarity: 'MOTIVATE', provenance: claims[claims.length - 1].provenance, claimIds: [claimId], limitations: [], confidence: item.confidence, createdAt: now }) } return { evidence, claims } }

function reconstructEvidenceExecution(plan: Pick<EvidenceOperationPlan, 'plannedOperations'> & Partial<Pick<EvidenceOperationPlan, 'execution'>>, attempts: readonly Record<string, unknown>[]) {
  if (plan.execution) return plan.execution
  const completedOperationIds: string[] = []
  const emptyEvidenceOperationIds: string[] = []
  for (const attempt of attempts) {
    if (attempt.role !== 'EvidenceExtractor' || attempt.status !== 'SUCCEEDED' || typeof attempt.normalizedTextPreview !== 'string') continue
    try {
      const output = JSON.parse(attempt.normalizedTextPreview) as { claimId?: string; literatureId?: string; items?: unknown[] }
      const operation = plan.plannedOperations.find(candidate => candidate.literatureId === output.literatureId && deterministicId('claim', { needId: candidate.retrievalNeedId, queryId: candidate.queryId, literatureId: candidate.literatureId }) === output.claimId)
      if (!operation || completedOperationIds.includes(operation.operationId)) continue
      completedOperationIds.push(operation.operationId)
      if (Array.isArray(output.items) && output.items.length === 0) emptyEvidenceOperationIds.push(operation.operationId)
    } catch { /* historical diagnostics may contain no parseable output */ }
  }
  return { completedOperationIds, failedOperationIds: [], emptyEvidenceOperationIds }
}

function normalizeGraph(paperId: string, output: ProblemExtractorOutput, evidenceIds: ReadonlySet<string>): ProblemExtractorOutput { const assertEvidence = (id: string, path: string) => { if (!evidenceIds.has(id)) throw new ValidationError('evidence reference does not exist for paper', path, 'INVALID_PROVENANCE') }; const nodeMap = new Map<string, string>(); const nodes = output.nodes.map((node, index) => { const nodeId = deterministicId('graph_node', { paperId, source: node.nodeId, index }); nodeMap.set(node.nodeId, nodeId); node.evidenceIds.forEach((id, evidenceIndex) => assertEvidence(id, `$.nodes[${index}].evidenceIds[${evidenceIndex}]`)); return { ...node, nodeId: nodeId as never } }); const edges = output.edges.map((edge, index) => { edge.evidenceIds.forEach((id, evidenceIndex) => assertEvidence(id, `$.edges[${index}].evidenceIds[${evidenceIndex}]`)); return { ...edge, edgeId: deterministicId('graph_edge', { paperId, source: edge.edgeId, index }) as never, from: nodeMap.get(edge.from) ?? edge.from, to: nodeMap.get(edge.to) ?? edge.to } }); return { nodes, edges } }

export interface EvidenceOperation {
  readonly operationId: string
  readonly originProblemNodeIds: readonly string[]
  readonly retrievalNeedId: string
  readonly queryId: string
  readonly searchCoverageId: string
  readonly searchCoverageStatus: CoverageStatus
  readonly literatureId: string
}

export interface EvidenceOperationPlan {
  readonly status: 'PLANNED' | 'COMPLETED' | 'FAILED'
  readonly operationUnit: 'ONE_SELECTED_SOURCE'
  readonly maxEvidenceExtractorModelCalls: number
  readonly maxSerializationRetriesPerOperation: number
  readonly reservedModelCallsPerOperation: number
  readonly maxPlannedOperations: number
  readonly plannedOperations: readonly EvidenceOperation[]
  readonly deferredOperations: readonly EvidenceOperation[]
  readonly execution: {
    readonly completedOperationIds: readonly string[]
    readonly failedOperationIds: readonly string[]
    readonly emptyEvidenceOperationIds: readonly string[]
  }
  readonly incompleteCoverage: boolean
  readonly coverage: readonly { readonly retrievalNeedId: string; readonly queryId: string; readonly searchCoverageId: string; readonly searchCoverageStatus: CoverageStatus; readonly selectedCount: number; readonly plannedCount: number; readonly deferredCount: number }[]
}

/** Input order is the authoritative SourceSelection sequence within each need,
 * including its persisted query-path order. IDs break ties; they never rank sources. */
export function orderEvidenceOperationsByNeedRank(operations: readonly EvidenceOperation[]): EvidenceOperation[] {
  const nextRank = new Map<string, number>()
  return operations.map(operation => {
    const rank = nextRank.get(operation.retrievalNeedId) ?? 0
    nextRank.set(operation.retrievalNeedId, rank + 1)
    return { operation, rank }
  }).sort((left, right) => left.rank - right.rank
    || left.operation.retrievalNeedId.localeCompare(right.operation.retrievalNeedId)
    || left.operation.operationId.localeCompare(right.operation.operationId))
    .map(candidate => candidate.operation)
}

export function planEvidenceOperations(selections: readonly SourceSelection[], limits: RunBudgetLimits, usage: RunBudgetUsage): EvidenceOperationPlan {
  const operations = orderEvidenceOperationsByNeedRank(selections.flatMap(selection => selection.records.map(record => ({ operationId: `${selection.retrievalNeedId}:${selection.queryId}:${record.literatureId}`, originProblemNodeIds: [...selection.originProblemNodeIds], retrievalNeedId: selection.retrievalNeedId, queryId: selection.queryId, searchCoverageId: selection.searchCoverageId, searchCoverageStatus: selection.searchCoverageStatus, literatureId: record.literatureId }))))
  const reservedModelCallsPerOperation = 1 + Math.max(0, limits.maxSerializationRetriesPerOperation)
  const remainingRoleCalls = Math.max(0, limits.maxEvidenceExtractorModelCalls - usage.evidenceExtractorModelCalls)
  const remainingTotalCalls = Math.max(0, limits.maxTotalModelCalls - usage.totalModelCalls)
  const maxPlannedOperations = Math.floor(Math.min(remainingRoleCalls, remainingTotalCalls) / reservedModelCallsPerOperation)
  const plannedOperations = operations.slice(0, maxPlannedOperations)
  const deferredOperations = operations.slice(maxPlannedOperations)
  return { status: 'PLANNED', operationUnit: 'ONE_SELECTED_SOURCE', maxEvidenceExtractorModelCalls: limits.maxEvidenceExtractorModelCalls, maxSerializationRetriesPerOperation: limits.maxSerializationRetriesPerOperation, reservedModelCallsPerOperation, maxPlannedOperations, plannedOperations, deferredOperations, execution: { completedOperationIds: [], failedOperationIds: [], emptyEvidenceOperationIds: [] }, incompleteCoverage: deferredOperations.length > 0, coverage: selections.map(selection => { const plannedCount = plannedOperations.filter(operation => operation.retrievalNeedId === selection.retrievalNeedId && operation.queryId === selection.queryId).length; const deferredCount = selection.records.length - plannedCount; return { retrievalNeedId: selection.retrievalNeedId, queryId: selection.queryId, searchCoverageId: selection.searchCoverageId, searchCoverageStatus: selection.searchCoverageStatus, selectedCount: selection.records.length, plannedCount, deferredCount } }) }
}

export interface LiveReportRenderingInput {
  readonly caseId: string
  readonly researchArea: string
  readonly budgets: RunBudgetLimits
  readonly usage: RunBudgetUsage
  readonly understanding: unknown
  readonly evidenceAssessment: EvidenceAssessmentSummary
  readonly retrieval: readonly SearchCoverage[]
  readonly selected: readonly SourceSelection[]
  readonly queries: readonly LiteratureQuery[]
  readonly evidence: readonly unknown[]
  readonly evidencePlan: Pick<EvidenceOperationPlan, 'deferredOperations' | 'execution' | 'incompleteCoverage'>
  readonly failures: readonly unknown[]
  readonly modelCalls: number
  readonly retryCount: number
  readonly openAlexRequestCount: number
  readonly retrievedRecordCount: number
  readonly selectedSourceCount: number
}

interface ReportRelevanceWarning {
  readonly retrievalNeedId: string
  readonly queryId: string
  readonly literatureId: string
  readonly title: string
  readonly matchedTokens: readonly string[]
}

function reportRelevanceWarnings(selected: readonly SourceSelection[], queries: readonly LiteratureQuery[]): readonly ReportRelevanceWarning[] {
  const queriesById = new Map(queries.map(query => [query.queryId, query]))
  const warnings: ReportRelevanceWarning[] = []
  for (const selection of selected) {
    const query = queriesById.get(selection.queryId)
    if (!query) continue
    for (const record of selection.records) {
      const score = scoreLiteratureCandidate(record, query)
      if (score.normalizedQueryTokens.length > 0 && score.matchedTokens.length === 0) warnings.push({ retrievalNeedId: selection.retrievalNeedId, queryId: selection.queryId, literatureId: record.literatureId, title: record.title, matchedTokens: score.matchedTokens })
    }
  }
  return warnings
}

function reportEvidenceLimitations(input: LiveReportRenderingInput, relevanceWarnings: readonly ReportRelevanceWarning[]): string[] {
  const assessment = input.evidenceAssessment
  const retrievalCoverage = assessment.retrievalCoverage
  const lines = [
    '## Evidence limitations',
    '',
    'These statements describe retrieval and extraction state. They are limitations on what this run can establish, not scientific conclusions.',
  ]
  if (!assessment.exhaustive || input.evidencePlan.incompleteCoverage) lines.push('- Evidence coverage is incomplete. This is incomplete evidence coverage; the report does not claim exhaustive coverage or scientific completeness.')
  if (assessment.deferredOperations > 0 || input.evidencePlan.deferredOperations.length > 0) {
    const ids = input.evidencePlan.deferredOperations.map(operation => operation.operationId)
    lines.push(`- ${assessment.deferredOperations || ids.length} EvidenceExtractor operation(s) were deferred${ids.length ? ` (${ids.join(', ')})` : ''}. Deferred work is unresolved work, not evidence of absence.`)
  }
  if ((retrievalCoverage.NO_RESULTS ?? 0) > 0) lines.push(`- ${retrievalCoverage.NO_RESULTS} retrieval operation(s) returned NO_RESULTS. NO_RESULTS is a search outcome, not evidence of novelty, falsity, truth, negative evidence, or absence of literature.`)
  if (assessment.emptyEvidenceOperations > 0) lines.push(`- Successful-empty extraction occurred for ${assessment.emptyEvidenceOperations} operation(s). Empty extraction means no source-supported item was extracted from that operation; it is not negative evidence, falsity, novelty, or proof that no evidence exists.`)
  if ((retrievalCoverage.FAILED ?? 0) > 0) lines.push(`- ${retrievalCoverage.FAILED} retrieval operation(s) FAILED. Failed retrievals are coverage limitations and do not show that relevant literature is absent.`)
  if (assessment.failedOperations > 0) lines.push(`- ${assessment.failedOperations} EvidenceExtractor operation(s) FAILED. Failed extraction is unresolved work and is not negative evidence or a falsity finding.`)
  if (assessment.unexecutedPlannedOperations > 0) lines.push(`- ${assessment.unexecutedPlannedOperations} planned EvidenceExtractor operation(s) were not executed. Their claims remain unassessed.`)
  const abstractEvidenceCount = input.evidence.filter(item => typeof item === 'object' && item !== null && (item as { evidenceLevel?: unknown }).evidenceLevel === 'ABSTRACT_EVIDENCE').length
  if (abstractEvidenceCount > 0) lines.push(`- ${abstractEvidenceCount} accepted evidence item(s) are abstract-level only (ABSTRACT_EVIDENCE). They do not imply full-text verification, experiment verification, equation-level verification, or quantitative verification.`)
  if (relevanceWarnings.length > 0) lines.push(`- ${relevanceWarnings.length} selected source(s) have relevance warnings. These are source-selection quality limitations, not provenance defects or scientific conclusions.`)
  if (lines.length === 4) lines.push('- No material retrieval or extraction limitation was recorded by EVALUATE.')
  return lines
}

export function renderLiveReport(input: LiveReportRenderingInput): string {
  const relevanceWarnings = reportRelevanceWarnings(input.selected, input.queries)
  const warningLines = relevanceWarnings.length === 0
    ? ['No deterministic source relevance warnings were recorded.']
    : relevanceWarnings.map(warning => `- ${warning.literatureId} (${warning.title}) for query ${warning.queryId}: no query-token overlap was found; treat this as a source relevance quality limitation.`)
  return [
    '# Scientific Audit Report',
    '',
    '## Run configuration',
    '```json',
    JSON.stringify({ caseId: input.caseId, researchArea: input.researchArea, budgets: input.budgets, usage: input.usage }, null, 2),
    '```',
    '',
    '## Per-paper understanding',
    '```json',
    JSON.stringify(input.understanding, null, 2),
    '```',
    '',
    '## Cross-paper Problem Graph',
    'See `problem-graph.json`.',
    '',
    '## RetrievalNeeds and literature',
    'See `retrieval-needs.json`, `literature-queries.json`, `search-coverage.json`, and `source-selection.json`.',
    '',
    '## Evidence assessment',
    '```json',
    JSON.stringify(input.evidenceAssessment, null, 2),
    '```',
    '',
    ...reportEvidenceLimitations(input, relevanceWarnings),
    '',
    '## Source relevance quality warnings',
    ...warningLines,
    '',
    '## Evidence Graph',
    'See `evidence-graph.json` and `evidence.json`.',
    '',
    '## Warnings and failures',
    JSON.stringify(input.failures, null, 2),
    '',
    '## Usage summary',
    JSON.stringify({ ...input.usage, modelCalls: input.modelCalls, retryCount: input.retryCount, openAlexRequestCount: input.openAlexRequestCount, retrievedRecordCount: input.retrievedRecordCount, selectedSourceCount: input.selectedSourceCount }, null, 2),
    '',
    'No generated hypotheses or proposed novel methods are included in this M3.5C run.',
  ].join('\n')
}

export async function runLiveCase(casePath: string, options: { readonly outputRoot?: string; readonly budget?: Partial<RunBudgetLimits>; readonly stopAfter?: ValidationStage; readonly gateway?: ModelGateway; readonly preflightImpl?: (options: ModelPreflightOptions) => Promise<ModelPreflightResult>; readonly enableGeneration0?: boolean; readonly generation0?: boolean; readonly generation0CandidateBudget?: number } = {}): Promise<LiveRunResult> {
  validateStopAfter(options.stopAfter)
  const { spec, root } = loadEvaluationCase(resolve(casePath))
  const outputDirectory = plannedDirectory(options.outputRoot ?? resolve(root, 'outputs'))
  initializeOutput(outputDirectory)
  const runId = outputDirectory.split(/[\\/]/).pop()!
  const budget = new RunBudget(options.budget)
  const usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
  const modelConfiguration = resolveModelConfiguration()
  const route: ModelRoute = { provider: modelConfiguration.provider, model: modelConfiguration.model }
  const gateway = new BudgetedGateway(options.gateway ?? new ResponsesModelGateway({ baseUrl: modelConfiguration.baseUrl, apiKey: modelConfiguration.apiKey, model: route.model, structuredOutputMode: modelConfiguration.structuredOutputMode, streaming: modelConfiguration.streaming, maxRetries: 0 }), budget, usage)
  const stages: { stage: string; status: 'COMPLETED' | 'INTENTIONALLY_NOT_RUN' | 'FAILED' | 'BUDGET_EXHAUSTED'; error?: string }[] = []
  const cutoffProvenance = spec.corpusCutoff === undefined ? {} : { corpusCutoff: spec.corpusCutoff }
  const literatureSearch = { provider: 'openalex', ...cutoffProvenance, resultLimit: budget.limits.maxResultsExaminedPerQuery, pageSize: Math.min(budget.limits.maxResultsExaminedPerQuery, 50), timeoutMs: OPENALEX_DEFAULT_TIMEOUT_MS, maxAttempts: OPENALEX_MAX_ATTEMPTS, retryPolicy: OPENALEX_RETRY_POLICY, unknownDatePolicy: UNKNOWN_DATE_POLICY }
  const modelPreflightPolicy = { maxAttempts: PREFLIGHT_MAX_ATTEMPTS, retryableCategories: ['RATE_LIMIT', 'SERVER_ERROR'], defaultRetryDelayMs: PREFLIGHT_DEFAULT_RETRY_DELAY_MS, maxRetryAfterMs: PREFLIGHT_MAX_RETRY_DELAY_MS }
  const createdAt = new Date().toISOString()
  writeJson(outputDirectory, 'config.json', { caseId: spec.caseId, ...cutoffProvenance, modelConfiguration: safeModelConfigurationSnapshot(modelConfiguration), endpoint: buildResponsesEndpoint(modelConfiguration.baseUrl), modelRoute: route, modelIdentifier: route.model, streaming: modelConfiguration.streaming, structuredOutputMode: modelConfiguration.structuredOutputMode, provider: 'openalex', literatureSearch, modelPreflight: modelPreflightPolicy, budgets: budget.limits, createdAt })
  writeJson(outputDirectory, 'model-preflight.json', { status: 'PENDING', timestamp: createdAt, endpoint: buildResponsesEndpoint(modelConfiguration.baseUrl), model: route.model, structuredOutputMode: modelConfiguration.structuredOutputMode, streaming: modelConfiguration.streaming, attemptCount: 0, attempts: [] })
  const stage = async <T>(name: string, fn: () => Promise<T>): Promise<T> => { const startedAt = new Date().toISOString(); try { const value = await fn(); stages.push({ stage: name, status: 'COMPLETED' }); writeJson(outputDirectory, 'stage-state.json', stages); return value } catch (error) { const message = error instanceof Error ? error.message : 'stage failed'; stages.push({ stage: name, status: message.startsWith('BUDGET_EXHAUSTED') ? 'BUDGET_EXHAUSTED' : 'FAILED', error: message }); writeJson(outputDirectory, 'stage-state.json', stages); throw Object.assign(new Error(message), { stage: name, startedAt }) } }
  let preflightAttempts = 0
  let evidencePlan: EvidenceOperationPlan | undefined
  let evidenceAssessment: EvidenceAssessmentSummary | undefined
  const persistPreflightFailure = (message: string, preflight?: ModelPreflightResult): LiveRunResult => {
    if (preflight) { preflightAttempts = preflight.attemptCount; writeJson(outputDirectory, 'model-preflight.json', serializePreflight(preflight, new Date().toISOString(), 'FAILED')) }
    else writeJson(outputDirectory, 'model-preflight.json', { status: 'FAILED', timestamp: new Date().toISOString(), endpoint: buildResponsesEndpoint(modelConfiguration.baseUrl), model: route.model, structuredOutputMode: modelConfiguration.structuredOutputMode, streaming: modelConfiguration.streaming, attemptCount: 0, attempts: [], final: { errorCategory: message.startsWith('MODEL_CONFIGURATION_INVALID:') ? 'CONFIGURATION' : 'NETWORK_ERROR', error: message, retryable: false, structuredOutputSupported: false } })
    writeJson(outputDirectory, 'stage-state.json', [{ stage: 'MODEL_PREFLIGHT', status: 'FAILED', error: message }])
    writeJson(outputDirectory, 'run-snapshot.json', { runId, caseId: spec.caseId, status: 'FAILED', scientificallyComplete: false, failedStage: 'MODEL_PREFLIGHT', error: message, startedStages: [], preflightAttempts, ...cutoffProvenance, seedArtifacts: spec.paperArtifacts.map(item => ({ paperId: item.paperId, path: item.path })), modelConfiguration: safeModelConfigurationSnapshot(modelConfiguration), endpoint: buildResponsesEndpoint(modelConfiguration.baseUrl), modelRoute: route, modelIdentifier: route.model, streaming: modelConfiguration.streaming, structuredOutputMode: modelConfiguration.structuredOutputMode, provider: 'openalex', literatureSearch, modelPreflight: modelPreflightPolicy, budgets: budget.limits, usage: { ...usage, ...budget.usage }, completedAt: new Date().toISOString() })
    return { mode: 'live', runId, outputDirectory, status: 'FAILED', scientificallyComplete: false, stages: [], failedStage: 'MODEL_PREFLIGHT' }
  }
  const configurationErrors = configurationDiagnostics(modelConfiguration)
  if (configurationErrors.length && !options.preflightImpl) return persistPreflightFailure(`MODEL_CONFIGURATION_INVALID: ${configurationErrors.join('; ')}`)
  const stopResult = (completedStage: ValidationStage): LiveRunResult => { const index = VALIDATION_STAGES.indexOf(completedStage); for (const stageName of VALIDATION_STAGES.slice(index + 1)) stages.push({ stage: stageName, status: 'INTENTIONALLY_NOT_RUN' }); writeJson(outputDirectory, 'stage-state.json', stages); persistModelAttempts(outputDirectory, gateway); writeJson(outputDirectory, 'run-snapshot.json', { runId, caseId: spec.caseId, status: 'STOPPED_AS_REQUESTED', scientificallyComplete: false, stopAfter: completedStage, preflightAttempts, ...cutoffProvenance, modelConfiguration: safeModelConfigurationSnapshot(modelConfiguration), endpoint: buildResponsesEndpoint(modelConfiguration.baseUrl), modelRoute: route, modelIdentifier: route.model, streaming: modelConfiguration.streaming, structuredOutputMode: modelConfiguration.structuredOutputMode, provider: 'openalex', literatureSearch, modelPreflight: modelPreflightPolicy, evidencePlan: evidencePlan ? { artifact: 'evidence-plan.json', status: evidencePlan.status, plannedOperations: evidencePlan.plannedOperations.length, deferredOperations: evidencePlan.deferredOperations.length, incompleteCoverage: evidencePlan.incompleteCoverage } : undefined, budgets: budget.limits, usage: { ...usage, ...budget.usage }, completedAt: new Date().toISOString() }); return { mode: 'live', runId, outputDirectory, status: 'STOPPED_AS_REQUESTED', scientificallyComplete: false, stopAfter: completedStage, stages } }
  let preflight: ModelPreflightResult
  try {
    preflight = await (options.preflightImpl ?? preflightModel)({ baseUrl: modelConfiguration.baseUrl, apiKey: modelConfiguration.apiKey, model: route.model, structuredOutputMode: modelConfiguration.structuredOutputMode, streaming: modelConfiguration.streaming })
  } catch (error) {
    const message = `MODEL_PREFLIGHT_FAILED: ${error instanceof Error ? error.message : 'preflight request failed'}`
    return persistPreflightFailure(message)
  }
  preflightAttempts = preflight.attemptCount || ((preflight.attempts?.length ?? 0) || 1)
  writeJson(outputDirectory, 'model-preflight.json', serializePreflight(preflight, new Date().toISOString(), !preflight.responseSucceeded || preflight.errorCategory || !preflight.normalizedText || !preflight.structuredOutputSupported ? 'FAILED' : 'SUCCEEDED'))
  if (!preflight.responseSucceeded || preflight.errorCategory || !preflight.normalizedText || !preflight.structuredOutputSupported) return persistPreflightFailure(`MODEL_PREFLIGHT_FAILED: ${preflight.error ?? 'preflight did not pass'}`, preflight)
    writeJson(outputDirectory, 'run-snapshot.json', { runId, caseId: spec.caseId, ...cutoffProvenance, seedArtifacts: spec.paperArtifacts.map(item => ({ paperId: item.paperId, path: item.path })), modelConfiguration: safeModelConfigurationSnapshot(modelConfiguration), endpoint: buildResponsesEndpoint(modelConfiguration.baseUrl), modelRoute: route, modelIdentifier: route.model, streaming: modelConfiguration.streaming, structuredOutputMode: modelConfiguration.structuredOutputMode, provider: 'openalex', literatureSearch, modelPreflight: modelPreflightPolicy, evidencePlan: evidencePlan ? { artifact: 'evidence-plan.json', status: evidencePlan.status, plannedOperations: evidencePlan.plannedOperations.length, deferredOperations: evidencePlan.deferredOperations.length, incompleteCoverage: evidencePlan.incompleteCoverage } : undefined, budgets: budget.limits, preflight: { artifact: 'model-preflight.json', status: 'SUCCEEDED', attemptCount: preflightAttempts, responseStatus: preflight.responseStatus, contentType: preflight.contentType }, createdAt: new Date().toISOString() })
  try {
    const manifests = await stage('INGEST', async () => { const values: ArtifactManifest[] = []; for (const artifact of spec.paperArtifacts) { const path = resolve(root, artifact.path); const bytes = readFileSync(path); values.push(ingestArtifact(bytes, { paperId: artifact.paperId as never, originalFilename: artifact.path.split(/[\\/]/).pop() ?? artifact.path, mediaType: artifact.mediaType ?? 'application/pdf', ingestionTimestamp: new Date().toISOString(), localPath: path })) } writeJson(outputDirectory, 'ingest.json', values); return values }); if (options.stopAfter === 'INGEST') return stopResult('INGEST')
    const extracted = await stage('EXTRACT', async () => { const values: { manifest: ArtifactManifest; bytes: Uint8Array; document: ExtractedDocument }[] = []; for (const manifest of manifests) { const bytes = readFileSync(manifest.localPath!); const result = extractWithFallback(manifest, bytes); if (!result.document || !result.quality || result.quality.status === 'FAIL') throw new Error(`EXTRACTION_GATE_FAILED: ${manifest.paperId}`); values.push({ manifest, bytes, document: result.document }) } writeJson(outputDirectory, 'extraction-report.json', values.map(item => ({ paperId: item.manifest.paperId, provenance: item.document.extractionProvenance, quality: assessExtraction(item.document) }))); return values }); if (options.stopAfter === 'EXTRACT') return stopResult('EXTRACT')
    const readers = await stage('PAPER_READ', async () => { const values: { paperId: string; document: ExtractedDocument; reader: PaperReaderOutput; evidence: readonly Evidence[]; claims: readonly Claim[] }[] = []; for (const item of extracted) { const result = await runPaperReader(gateway, item.document, route, 'paper-reader@1', boundDocumentContext(item.document, 24000), { maxSerializationRetries: 1, onAttempt: report => persistPaperReaderAttempt(outputDirectory, item.manifest.paperId, report, gateway), onSerializationRetry: () => budget.serializationRetry(`PaperReader:${item.manifest.paperId}`) }); if (!result.ok) throw new Error(`PaperReader failed for ${item.manifest.paperId}: ${result.error}`); const local = readerEvidence(item.manifest.paperId, item.document, result.value, new Date().toISOString()); values.push({ paperId: item.manifest.paperId, document: item.document, reader: result.value, ...local }); writeJson(outputDirectory, `paper-reader/${item.manifest.paperId}.json`, result.value) } return values }); if (options.stopAfter === 'PAPER_READ') return stopResult('PAPER_READ')
    const extractedProblems = await stage('PROBLEM_EXTRACT', async () => { const values: { paperId: string; output: ProblemExtractorOutput }[] = []; for (const item of readers) { const availableEvidenceIds = item.evidence.map(entry => entry.evidenceId); const evidenceReferences = item.reader.items.map(readerItem => ({ itemId: readerItem.itemId, evidenceId: deterministicId('evidence', { paperId: item.paperId, itemId: readerItem.itemId }) as EvidenceId })); const result = await runProblemExtractor(gateway, item.reader, route, 'problem-extractor@1', { maxSerializationRetries: 1, availableEvidenceIds, evidenceReferences, onSerializationRetry: () => budget.serializationRetry(`ProblemExtractor:${item.paperId}`) }); if (!result.ok) throw new Error(`ProblemExtractor failed for ${item.paperId}: ${result.error}`); values.push({ paperId: item.paperId, output: result.value }); writeJson(outputDirectory, `problem-extractor/${item.paperId}.json`, result.value) } return values }); if (options.stopAfter === 'PROBLEM_EXTRACT') return stopResult('PROBLEM_EXTRACT')
    const graphBundle = await stage('PROBLEM_GRAPH', async () => { const evidence = readers.flatMap(item => item.evidence); const claims = readers.flatMap(item => item.claims); const evidenceByPaper = new Map(readers.map(item => [item.paperId, new Set(item.evidence.map(entry => entry.evidenceId))])); const graphs = extractedProblems.map(item => normalizeGraph(item.paperId, item.output, evidenceByPaper.get(item.paperId) ?? new Set())); const graph = buildProblemGraph({ nodes: graphs.flatMap(item => item.nodes), edges: graphs.flatMap(item => item.edges) }, evidence); writeJson(outputDirectory, 'problem-graph.json', graph); return { graph, evidence, claims } }); if (options.stopAfter === 'PROBLEM_GRAPH') return stopResult('PROBLEM_GRAPH')
    const needs = await stage('RETRIEVAL_NEEDS', async () => { const values = deriveRetrievalNeeds(graphBundle.graph, spec.corpusCutoff).slice(0, budget.limits.maxRetrievalNeeds); budget.retrievalNeed(values.length); writeJson(outputDirectory, 'retrieval-needs.json', values); return values }); if (options.stopAfter === 'RETRIEVAL_NEEDS') return stopResult('RETRIEVAL_NEEDS')
    const queries = await stage('QUERY_PLAN', async () => { const values = planQueries(needs, 'openalex', needs.length * budget.limits.maxQueriesPerRetrievalNeed); writeJson(outputDirectory, 'literature-queries.json', values); return values }); if (options.stopAfter === 'QUERY_PLAN') return stopResult('QUERY_PLAN')
    const search = await stage('LITERATURE_SEARCH', async () => { const cutoff = requireCorpusCutoff(spec.corpusCutoff); if (queries.some(query => query.corpusCutoff !== cutoff)) throw new ValidationError('literature queries do not carry the trusted run corpusCutoff', '$.literatureQueries.corpusCutoff', 'INVALID_CORPUS_CUTOFF'); const provider = new OpenAlexProvider(); const records: LiteratureRecord[] = []; const coverages: SearchCoverage[] = []; const memberships: LiteratureQueryMembership[] = []; for (const query of queries) { budget.query(); const result = await provider.search(query, { limit: budget.limits.maxResultsExaminedPerQuery }); budget.assertResultsPerQuery(result.coverage.examinedCount); budget.resultsExamined(result.coverage.examinedCount); records.push(...result.records); coverages.push(result.coverage); memberships.push(makeLiteratureQueryMembership(query, result.coverage, result.records)) } const unique = [...new Map(records.map(record => [record.literatureId, record])).values()]; const recordsById = new Map(unique.map(record => [record.literatureId, record])); memberships.forEach((membership, index) => validateLiteratureQueryMembership(membership, queries[index], coverages[index], recordsById)); writeJson(outputDirectory, 'literature-records.json', unique); writeJson(outputDirectory, 'search-coverage.json', coverages); writeJson(outputDirectory, 'literature-query-membership.json', memberships); return { records: unique, coverages, memberships } }); if (options.stopAfter === 'LITERATURE_SEARCH') return stopResult('LITERATURE_SEARCH')
    const selected = await stage('SOURCE_SELECT', async () => { const recordsById = new Map(search.records.map(record => [record.literatureId, record])); const coverageByQuery = new Map(search.coverages.map(coverage => [coverage.queryId, coverage])); const membershipByQuery = new Map(search.memberships.map(membership => [membership.queryId, membership])); const values = queries.map(query => { const need = needs.find(item => item.needId === query.needId); const coverage = coverageByQuery.get(query.queryId); const membership = membershipByQuery.get(query.queryId); if (!need || !coverage || !membership) throw new ValidationError('SOURCE_SELECT is missing query-local provenance', '$.sourceSelection', 'INVALID_PROVENANCE'); validateLiteratureQueryMembership(membership, query, coverage, recordsById); const records = selectSourcesForMembership(query, membership, recordsById, budget.limits.maxSelectedSourcesPerRetrievalNeed); const selection: SourceSelection = { originProblemNodeIds: need.originNodeIds, retrievalNeedId: need.needId, queryId: query.queryId, searchCoverageId: coverage.coverageId, searchCoverageStatus: coverage.status, records }; validateSourceSelection(selection, query, need, coverage, membership, recordsById); return selection }); values.forEach(value => { budget.assertSelectedSourcesPerNeed(value.records.length); budget.selectedSources(value.records.length) }); writeJson(outputDirectory, 'source-selection.json', values); return values }); if (options.stopAfter === 'SOURCE_SELECT') return stopResult('SOURCE_SELECT')
    evidencePlan = planEvidenceOperations(selected, budget.limits, budget.usage); writeJson(outputDirectory, 'evidence-plan.json', evidencePlan)
    const evidenceResults = await stage('EVIDENCE_EXTRACT', async () => { const outputs: TrustedEvidenceExtractorOutput[] = []; const allEvidence: unknown[] = []; const allClaims: Claim[] = [...graphBundle.claims]; const planned = new Set(evidencePlan?.plannedOperations.map(operation => operation.operationId) ?? []); const completedOperationIds: string[] = []; const failedOperationIds: string[] = []; const emptyEvidenceOperationIds: string[] = []; for (const selection of selected) { const need = needs.find(item => item.needId === selection.retrievalNeedId); if (!need) throw new ValidationError('EVIDENCE_EXTRACT is missing retrieval need provenance', '$.sourceSelection.retrievalNeedId', 'INVALID_PROVENANCE'); for (const source of selection.records) { const operationId = `${selection.retrievalNeedId}:${selection.queryId}:${source.literatureId}`; if (!planned.has(operationId)) continue; const claimId = deterministicId('claim', { needId: selection.retrievalNeedId, queryId: selection.queryId, literatureId: source.literatureId }) as never; const provenance = { originProblemNodeIds: selection.originProblemNodeIds, retrievalNeedId: selection.retrievalNeedId, queryId: selection.queryId, searchCoverageId: selection.searchCoverageId, searchCoverageStatus: selection.searchCoverageStatus, corpusCutoff: spec.corpusCutoff }; const input: EvidenceExtractionInput = { claimId, claim: need.goal, source: { literature: source, provenance } }; try { const result = await runEvidenceExtractor(gateway, input, route, { onSerializationRetry: operation => budget.serializationRetry(operation) }); if (!result.ok) throw new Error(`EvidenceExtractor failed for ${source.literatureId}: ${result.error}`); const materialized = materializeEvidence(result.value, input, result.request.attemptId); outputs.push(result.value); allEvidence.push(...materialized); allClaims.push({ claimId, statement: input.claim, kind: 'open-question', provenance: { sourceType: 'model', sourceId: result.request.attemptId, provenancePath: provenance } }); completedOperationIds.push(operationId); if (result.value.items.length === 0) emptyEvidenceOperationIds.push(operationId) } catch (error) { failedOperationIds.push(operationId); evidencePlan = { ...evidencePlan!, status: 'FAILED', execution: { completedOperationIds, failedOperationIds, emptyEvidenceOperationIds } }; writeJson(outputDirectory, 'evidence-plan.json', evidencePlan); throw error } } } writeJson(outputDirectory, 'claims.json', allClaims); writeJson(outputDirectory, 'evidence.json', allEvidence); evidencePlan = { ...evidencePlan!, status: 'COMPLETED', execution: { completedOperationIds, failedOperationIds, emptyEvidenceOperationIds } }; writeJson(outputDirectory, 'evidence-plan.json', evidencePlan); return { outputs, evidence: allEvidence } }); if (options.stopAfter === 'EVIDENCE_EXTRACT') return stopResult('EVIDENCE_EXTRACT')
    const evidenceGraph = await stage('EVIDENCE_GRAPH', async () => { const graph = new EvidenceGraph(); const claims = JSON.parse(readFileSync(resolve(outputDirectory, 'claims.json'), 'utf8')) as Claim[]; const evidence = JSON.parse(readFileSync(resolve(outputDirectory, 'evidence.json'), 'utf8')) as any[]; for (const claim of claims) graph.addClaim({ claimId: claim.claimId as never, statement: claim.statement, claimType: claim.kind, scope: spec.researchArea, uncertainty: 0.5 }); for (const item of evidence) { graph.addEvidence(item); graph.linkEvidenceToClaim({ evidenceId: item.evidenceId, claimId: item.claimIds[0], relation: mapEvidencePolarityToClaimRelation(item.polarity) }) } const serialized = { claims, evidence, links: evidence.map(item => ({ evidenceId: item.evidenceId, claimId: item.claimIds[0], relation: mapEvidencePolarityToClaimRelation(item.polarity) })) }; writeJson(outputDirectory, 'evidence-graph.json', serialized); return serialized }); if (options.stopAfter === 'EVIDENCE_GRAPH') return stopResult('EVIDENCE_GRAPH')
    const evaluation = await stage('EVALUATE', async () => { const persistedPlan = JSON.parse(readFileSync(resolve(outputDirectory, 'evidence-plan.json'), 'utf8')) as Partial<EvidenceOperationPlan>; const persistedEvidence = JSON.parse(readFileSync(resolve(outputDirectory, 'evidence.json'), 'utf8')) as readonly unknown[]; const persistedGraph = JSON.parse(readFileSync(resolve(outputDirectory, 'evidence-graph.json'), 'utf8')) as { readonly claims?: readonly unknown[]; readonly evidence?: readonly unknown[]; readonly links?: readonly { readonly relation?: string }[] }; const persistedCoverage = JSON.parse(readFileSync(resolve(outputDirectory, 'search-coverage.json'), 'utf8')) as readonly { readonly status: CoverageStatus }[]; const persistedAttempts = JSON.parse(readFileSync(resolve(outputDirectory, 'model-attempts.json'), 'utf8')) as readonly Record<string, unknown>[]; const plannedOperations = persistedPlan.plannedOperations ?? []; const deferredOperations = persistedPlan.deferredOperations ?? []; const execution = reconstructEvidenceExecution({ plannedOperations, execution: persistedPlan.execution }, persistedAttempts); evidenceAssessment = summarizeEvidenceAssessment({ selectedOperationIds: [...plannedOperations, ...deferredOperations].map(operation => operation.operationId), plannedOperationIds: plannedOperations.map(operation => operation.operationId), completedOperationIds: execution.completedOperationIds, failedOperationIds: execution.failedOperationIds, deferredOperationIds: deferredOperations.map(operation => operation.operationId), emptyEvidenceOperationIds: execution.emptyEvidenceOperationIds, planStatus: persistedPlan.status ?? 'FAILED', retrievalStatuses: persistedCoverage.map(coverage => coverage.status), evidenceItemCount: persistedEvidence.length, graphClaimCount: persistedGraph.claims?.length ?? 0, graphEvidenceCount: persistedGraph.evidence?.length ?? 0, graphLinkCount: persistedGraph.links?.length ?? 0, graphRelations: (persistedGraph.links ?? []).flatMap(link => typeof link.relation === 'string' ? [link.relation] : []) }); const report = { extraction: JSON.parse(readFileSync(resolve(outputDirectory, 'extraction-report.json'), 'utf8')), understanding: readers.map(item => ({ paperId: item.paperId, itemCount: item.reader.items.length })), provenance: { invalid: 0, modelInterpretations: readers.flatMap(item => item.reader.items).filter(item => item.interpretation === 'MODEL_INTERPRETATION').length }, retrieval: persistedCoverage, evidenceAssessment, temporalLeakage: { cutoff: spec.corpusCutoff, futureLiteratureCount: 0, futureEvidenceCount: 0, futureContextCount: 0, leaks: [] }, conflicts: [], failures: [] }; writeJson(outputDirectory, 'evaluation-report.json', report); return report }); if (options.stopAfter === 'EVALUATE') return stopResult('EVALUATE')
    let generation0Result: Generation0ExtensionResult | undefined
    if (options.enableGeneration0 === true || options.generation0 === true) {
      generation0Result = await stage('GAP_DISCOVERY', async () => {
        const generationStore = new FileGeneration0RunStore(outputDirectory)
        return runGeneration0Extension({ runId: runId as never, sourceRunId: runId, problemGraph: graphBundle.graph, claims: graphBundle.claims, evidence: graphBundle.evidence as (Evidence & Record<string, unknown>)[], evidenceGraph: JSON.parse(readFileSync(resolve(outputDirectory, 'evidence-graph.json'), 'utf8')), completeness: evidenceAssessment!, now: new Date().toISOString(), inputArtifactIds: manifests.map(item => item.artifactId), candidateBudget: Math.min(options.generation0CandidateBudget ?? 3, 3), gateway, route, requireGapModelSuccess: true, store: generationStore, configuration: { route, structuredOutputMode: modelConfiguration.structuredOutputMode, streaming: modelConfiguration.streaming }, corpusCutoff: spec.corpusCutoff as never }, { store: generationStore, requireGapModelSuccess: true })
      })
      writeJson(outputDirectory, 'gap-discovery.json', generation0Result.gapDiscovery)
      writeJson(outputDirectory, 'generation-0.json', generation0Result.generation0)
      writeJson(outputDirectory, 'generation0-extension.json', generation0Result)
      writeJson(outputDirectory, 'checkpoint.json', generation0Result.checkpoint)
      writeJson(outputDirectory, 'events.json', generation0Result.events)
      const gapStageIndex = stages.findIndex(item => item.stage === 'GAP_DISCOVERY')
      if (gapStageIndex >= 0 && generation0Result.status === 'GAP_MODEL_FAILED') stages[gapStageIndex] = { stage: 'GAP_DISCOVERY', status: 'FAILED', error: 'GapDiscovery model contract failed; Generation-0 blocked' }
      const generationCompleted = generation0Result.status === 'COMPLETE' || generation0Result.status === 'COMPLETE_EMPTY' || generation0Result.status === 'NO_ELIGIBLE_GAPS'
      stages.push({ stage: 'GENERATION_0', status: generationCompleted ? 'COMPLETED' : 'FAILED', error: generationCompleted ? undefined : generation0Result.status })
      writeJson(outputDirectory, 'stage-state.json', stages)
    }
    await stage('REPORT', async () => { const report = JSON.parse(readFileSync(resolve(outputDirectory, 'evaluation-report.json'), 'utf8')); const evidence = JSON.parse(readFileSync(resolve(outputDirectory, 'evidence.json'), 'utf8')) as readonly unknown[]; let text = renderLiveReport({ caseId: spec.caseId, researchArea: spec.researchArea, budgets: budget.limits, usage: budget.usage, understanding: report.understanding, evidenceAssessment: report.evidenceAssessment, retrieval: search.coverages, selected, queries, evidence, evidencePlan: evidencePlan!, failures: report.failures ?? [], modelCalls: budget.usage.totalModelCalls, retryCount: budget.usage.serializationRetries, openAlexRequestCount: budget.usage.queries, retrievedRecordCount: search.records.length, selectedSourceCount: budget.usage.selectedSources }); if (generation0Result) text += `\n## Generation-0 extension\n\n- Extension status: ${generation0Result.status}\n- Run ID: ${runId}\n- Source run ID: ${runId}\n- Deterministic gaps: ${generation0Result.gapReasoning.baseline.gaps.length}\n- Model-generated gaps accepted: ${generation0Result.gapReasoning.modelGaps.length}\n- Eligible gaps: ${generation0Result.gapDiscovery.gaps.filter(gap => gap.eligibility.eligible).length}\n- Accepted provisional hypotheses: ${generation0Result.generation0.hypotheses.length}\n- Novelty, prior-art attack, falsification, feasibility review, mutation, Pareto selection, and experiments were not run.\n`; writeFileSync(resolve(outputDirectory, 'report.md'), text, 'utf8'); writeJson(outputDirectory, 'model-attempts.json', gateway.attempts); return text })
    if (options.stopAfter === 'REPORT') return stopResult('REPORT')
    const scientificallyComplete = evidenceAssessment?.scientificallyComplete ?? false
    const generationFailed = generation0Result?.status === 'GAP_MODEL_FAILED' || generation0Result?.status === 'GENERATION_FAILED'
    writeJson(outputDirectory, 'run-snapshot.json', { runId, caseId: spec.caseId, status: generationFailed ? 'FAILED' : 'COMPLETE', scientificallyComplete, preflightAttempts, ...cutoffProvenance, modelConfiguration: safeModelConfigurationSnapshot(modelConfiguration), endpoint: buildResponsesEndpoint(modelConfiguration.baseUrl), modelRoute: route, modelIdentifier: route.model, streaming: modelConfiguration.streaming, structuredOutputMode: modelConfiguration.structuredOutputMode, provider: 'openalex', literatureSearch, modelPreflight: modelPreflightPolicy, evidencePlan: evidencePlan ? { artifact: 'evidence-plan.json', status: evidencePlan.status, plannedOperations: evidencePlan.plannedOperations.length, deferredOperations: evidencePlan.deferredOperations.length, incompleteCoverage: evidencePlan.incompleteCoverage } : undefined, generation0: generation0Result ? { artifact: 'generation0-extension.json', status: generation0Result.status, checkpoint: generation0Result.checkpoint.checkpointId } : undefined, budgets: budget.limits, usage: { ...usage, ...budget.usage }, completedAt: new Date().toISOString() }); return { mode: 'live', runId, outputDirectory, status: generationFailed ? 'FAILED' : 'COMPLETE', scientificallyComplete, stages, failedStage: generationFailed ? 'GENERATION_0' : undefined, generation0: generation0Result ? { status: generation0Result.status, gapDiscovery: generation0Result.gapDiscovery, generation0: generation0Result.generation0, checkpoint: generation0Result.checkpoint } : undefined }
  } catch (error) { const failedStage = (error as { stage?: string }).stage ?? stages[stages.length - 1]?.stage; if (evidencePlan && failedStage === 'EVIDENCE_EXTRACT') { evidencePlan = { ...evidencePlan, status: 'FAILED' }; writeJson(outputDirectory, 'evidence-plan.json', evidencePlan) } persistModelAttempts(outputDirectory, gateway); writeJson(outputDirectory, 'run-snapshot.json', { runId, caseId: spec.caseId, status: 'FAILED', scientificallyComplete: false, failedStage, error: error instanceof Error ? error.message : 'stage failed', preflightAttempts, ...cutoffProvenance, modelConfiguration: safeModelConfigurationSnapshot(modelConfiguration), endpoint: buildResponsesEndpoint(modelConfiguration.baseUrl), modelRoute: route, modelIdentifier: route.model, streaming: modelConfiguration.streaming, structuredOutputMode: modelConfiguration.structuredOutputMode, provider: 'openalex', literatureSearch, modelPreflight: modelPreflightPolicy, evidencePlan: evidencePlan ? { artifact: 'evidence-plan.json', status: evidencePlan.status, plannedOperations: evidencePlan.plannedOperations.length, deferredOperations: evidencePlan.deferredOperations.length, incompleteCoverage: evidencePlan.incompleteCoverage } : undefined, budgets: budget.limits, usage: { ...usage, ...budget.usage }, completedAt: new Date().toISOString() }); return { mode: 'live', runId, outputDirectory, status: 'FAILED', scientificallyComplete: false, stages, failedStage } }
}


