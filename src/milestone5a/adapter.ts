import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { canonicalJson, contentHash, deterministicId } from '../domain/ids.ts'
import {
  buildProblemGraph,
  parseCheckpoint,
  parseClaim,
  parseDomainEvent,
  parseEvidence,
  runPaperReader,
  runProblemExtractor,
  validatePaperReaderOutput,
  validateProblemExtractorOutput,
  ValidationError,
  type ArtifactManifest,
  type Claim,
  type DocumentLocator,
  type Evidence,
  type ExtractedDocument,
  type ModelGateway,
  type ModelRequest,
  type ModelRoute,
  type PaperReaderItem,
  type PaperReaderOutput,
  type ProblemExtractorOutput,
  type ResearchProblemGraph,
} from '../domain/index.ts'
import { boundDocumentContext } from '../coordinator/context.ts'
import { OfflineMockModelGateway } from './offline-mock.ts'
import type { Checkpoint, DomainEvent, Timestamp } from '../domain/types.ts'
import type { EvidenceId, HypothesisId, RunId } from '../domain/ids.ts'
import type { M5AArtifacts, M5AFailure, M5AInput, M5AModelAttempt, M5APaperRepresentation, M5AResult } from './types.ts'

function asRunId(input: M5AInput): RunId {
  return input.runId ?? deterministicId('run', { milestone: 'M5A', artifactId: input.artifact.artifactId }) as RunId
}

function claimKind(item: PaperReaderItem): Claim['kind'] {
  if (item.type === 'method') return 'method'
  if (item.type === 'limitation') return 'limitation'
  if (item.type === 'open-question') return 'open-question'
  if (item.type === 'assumption') return 'interpretation'
  return item.type === 'claim' ? 'observation' : 'observation'
}

function itemSpan(item: PaperReaderItem, document: ExtractedDocument): ExtractedDocument['spans'][number] | undefined {
  const locator = item.locators[0]
  return locator ? document.spans.find(span => JSON.stringify(span.locator) === JSON.stringify(locator)) : undefined
}

function validateReaderSemantics(reader: PaperReaderOutput): void {
  const seen = new Set<string>()
  for (const [index, item] of reader.items.entries()) {
    if (!item.itemId.trim()) throw new ValidationError('itemId must be non-empty', `$.items[${index}].itemId`, 'MALFORMED_MODEL_OUTPUT')
    if (seen.has(item.itemId)) throw new ValidationError('duplicate item ID', `$.items[${index}].itemId`, 'DUPLICATE_ID')
    seen.add(item.itemId)
    if (!item.statement.trim()) throw new ValidationError('statement must be non-empty', `$.items[${index}].statement`, 'MALFORMED_MODEL_OUTPUT')
  }
}

function materializeReader(reader: PaperReaderOutput, document: ExtractedDocument, paperId: string, attemptId: string, now: string): { readonly claims: readonly Claim[]; readonly evidence: readonly Evidence[] } {
  validateReaderSemantics(reader)
  const claims: Claim[] = []
  const evidence: Evidence[] = []
  for (const item of reader.items) {
    const claimId = deterministicId('claim', { artifactId: document.artifactId, itemId: item.itemId }) as never
    const span = itemSpan(item, document)
    const modelInterpretation = item.interpretation === 'MODEL_INTERPRETATION'
    const provenance = modelInterpretation
      ? { sourceType: 'model' as const, sourceId: attemptId }
      : { sourceType: 'artifact' as const, sourceId: document.artifactId, locator: JSON.stringify(item.locators[0]), quotedText: span?.text, contentHash: span ? contentHash(span.text) : undefined }
    const claim = { claimId, paperId: paperId as never, artifactId: document.artifactId, statement: item.statement, kind: claimKind(item), provenance }
    parseClaim(claim)
    claims.push(claim)
    const record = {
      evidenceId: deterministicId('evidence', { artifactId: document.artifactId, itemId: item.itemId }) as EvidenceId,
      kind: modelInterpretation ? 'interpretation' : 'quote',
      claim: item.statement,
      polarity: 'MOTIVATE',
      provenance,
      claimIds: [claimId],
      limitations: modelInterpretation ? ['Model interpretation requires independent external support.'] : [],
      confidence: item.confidence,
      createdAt: now,
      evidenceLevel: modelInterpretation ? 'MODEL_INTERPRETATION' : 'FULL_TEXT_EVIDENCE',
      modelInterpretation,
    } as Evidence & Record<string, unknown>
    parseEvidence(record)
    evidence.push(record)
  }
  return { claims, evidence }
}

function paperRepresentation(document: ExtractedDocument, reader: PaperReaderOutput): M5APaperRepresentation {
  const of = (type: PaperReaderItem['type']) => reader.items.filter(item => item.type === type)
  return {
    sections: document.sections,
    problems: of('problem'),
    methods: of('method'),
    assumptions: of('assumption'),
    limitations: of('limitation'),
    openQuestions: of('open-question'),
    evidenceLocators: reader.items.map(item => ({ itemId: item.itemId, locators: item.locators })).sort((a, b) => a.itemId.localeCompare(b.itemId)),
  }
}

function normalizeGraph(artifactId: string, output: ProblemExtractorOutput): ProblemExtractorOutput {
  const nodeIds = new Map<string, string>()
  const nodes = output.nodes.map((node, index) => {
    const nodeId = deterministicId('graph_node', { artifactId, source: node.nodeId, index })
    nodeIds.set(node.nodeId, nodeId)
    return { ...node, nodeId: nodeId as never }
  })
  const edges = output.edges.map((edge, index) => ({ ...edge, edgeId: deterministicId('graph_edge', { artifactId, source: edge.edgeId, index }) as never, from: nodeIds.get(edge.from) ?? edge.from, to: nodeIds.get(edge.to) ?? edge.to }))
  return { nodes, edges }
}

function checkpoint(runId: RunId, stateHash: string, budget: Checkpoint['budget'], now: Timestamp): Checkpoint {
  return { checkpointId: deterministicId('checkpoint', { runId, sequence: 1, stateHash }), runId, sequence: 1, stateHash, populationIds: [] as HypothesisId[], budget, createdAt: now }
}

function attempt(role: M5AModelAttempt['role'], request: { readonly attemptId: string }, result: { readonly ok: boolean; readonly error?: string; readonly failureKind?: M5AModelAttempt['failureKind']; readonly diagnostic?: M5AModelAttempt['diagnostic'] }): M5AModelAttempt {
  return { role, attemptId: request.attemptId, status: result.ok ? 'SUCCEEDED' : 'FAILED', ...(result.error ? { error: result.error } : {}), ...(result.failureKind ? { failureKind: result.failureKind } : {}), ...(result.diagnostic ? { diagnostic: result.diagnostic } : {}) }
}

function failed(runId: RunId, role: M5AFailure['failedRole'], error: string, attempts: readonly M5AModelAttempt[]): M5AResult {
  return { ok: false, runId, failedRole: role, error, attempts }
}

export async function runM5AVerticalSlice(input: M5AInput): Promise<M5AResult> {
  const runId = asRunId(input)
  if (input.artifact.artifactId !== input.document.artifactId) throw new ValidationError('artifact and extracted document IDs must match', '$.document.artifactId', 'INVALID_PROVENANCE')
  const gateway = input.gateway ?? new OfflineMockModelGateway()
  const route = input.route ?? { provider: 'offline', model: 'offline' }
  const attempts: M5AModelAttempt[] = []
  const paperReader = await runPaperReader(gateway, input.document, route, input.skillVersions?.paperReader ?? 'paper-reader@1', input.paperReaderContext ?? boundDocumentContext(input.document), { maxSerializationRetries: input.maxSerializationRetries ?? 1, onAttempt: report => { const failureKind = report.validationErrors.length === 0 ? undefined : report.result.ok ? (report.result.diagnostic?.parseStatus === 'failure' ? 'SERIALIZATION' : 'SCHEMA') : (report.result.diagnostic?.parseStatus === 'failure' ? 'SERIALIZATION' : 'TRANSPORT'); attempts.push(attempt('PaperReader', report.request, { ok: report.validationErrors.length === 0, error: report.validationErrors[0], failureKind, diagnostic: report.diagnostic })) } })
  if (!paperReader.ok) return failed(runId, 'PaperReader', paperReader.error, attempts)
  const readerAttemptId = paperReader.request.attemptId
  let materialized: { readonly claims: readonly Claim[]; readonly evidence: readonly Evidence[] }
  try { materialized = materializeReader(paperReader.value, input.document, input.artifact.paperId, readerAttemptId, input.now) } catch (error) { const message = error instanceof Error ? error.message : 'PaperReader result failed semantic validation'; gateway.annotateAttempt?.(paperReader.request.attemptId, { schemaValidationStatus: 'failure', status: 'FAILED', validationErrors: [message], error: message }); const index = attempts.findIndex(item => item.attemptId === paperReader.request.attemptId); const updated = { role: 'PaperReader' as const, attemptId: paperReader.request.attemptId, status: 'FAILED' as const, error: message, failureKind: 'SCHEMA' as const, diagnostic: paperReader.diagnostic }; if (index >= 0) attempts.splice(index, 1, updated); else attempts.push(updated); return failed(runId, 'PaperReader', message, attempts) }
  const evidenceIds = [...new Set([...(input.evidenceIds ?? []), ...materialized.evidence.map(item => item.evidenceId)])] as EvidenceId[]
  const evidenceReferences = paperReader.value.items.map(item => ({ itemId: item.itemId, evidenceId: deterministicId('evidence', { artifactId: input.document.artifactId, itemId: item.itemId }) as EvidenceId }))
  const problemSkillVersion = input.skillVersions?.problemExtractor ?? 'problem-extractor@1'
  const problemExtractor = await runProblemExtractor(gateway, paperReader.value, route, problemSkillVersion, { maxSerializationRetries: input.maxSerializationRetries ?? 1, availableEvidenceIds: evidenceIds, evidenceReferences, onSerializationRetry: (attemptNumber, errors) => { attempts.push({ role: 'ProblemExtractor', attemptId: deterministicId('attempt', { role: 'ProblemExtractor', artifactId: input.document.artifactId, skillVersion: problemSkillVersion, attemptNumber }), status: 'FAILED', failureKind: 'SERIALIZATION', error: errors[0] }) } })
  if (!problemExtractor.ok) { attempts.push(attempt('ProblemExtractor', problemExtractor.request, problemExtractor)); return failed(runId, 'ProblemExtractor', problemExtractor.error, attempts) }
  attempts.push(attempt('ProblemExtractor', problemExtractor.request, problemExtractor))
  try {
    const normalized = normalizeGraph(input.document.artifactId, problemExtractor.value)
    const graph = buildProblemGraph(normalized, materialized.evidence)
    const state = { schemaVersion: 'm5a.model-adapter.v1', artifact: input.artifact, paperReader: paperReader.value, problemExtractor: problemExtractor.value, problemGraph: graph, claims: materialized.claims, evidence: materialized.evidence }
    const stateHash = contentHash(canonicalJson(state))
    const modelCalls = attempts.length
    const budget = { limits: { maxModelCalls: modelCalls, maxSearchCalls: 0, maxCandidates: 0, maxMutations: 0, maxTokens: 0 }, usage: { maxModelCalls: modelCalls, maxSearchCalls: 0, maxCandidates: 0, maxMutations: 0, maxTokens: 0 } }
    const finalCheckpoint = checkpoint(runId, stateHash, budget, input.now)
    const event: DomainEvent = { eventId: deterministicId('event', { runId, sequence: 1, type: 'checkpoint.created', checkpointId: finalCheckpoint.checkpointId }), runId, sequence: 1, type: 'checkpoint.created', occurredAt: input.now, payload: { stage: 'M5A_MODEL_ADAPTER', checkpointId: finalCheckpoint.checkpointId, artifactId: input.artifact.artifactId, problemNodeCount: graph.nodes.length, evidenceIds: materialized.evidence.map(item => item.evidenceId) } }
    parseDomainEvent(event)
    return { ok: true, value: { schemaVersion: 'm5a.model-adapter.v1', runId, generatedAt: input.now, artifact: input.artifact, paperRepresentation: paperRepresentation(input.document, paperReader.value), paperReader: paperReader.value, problemExtractor: problemExtractor.value, problemGraph: graph, claims: materialized.claims, evidence: materialized.evidence, attempts, events: [event], checkpoint: finalCheckpoint } }
  } catch (error) {
    return failed(runId, 'PROBLEM_GRAPH', error instanceof Error ? error.message : 'problem graph validation failed', [...attempts])
  }
}

export const runM5A = runM5AVerticalSlice
export const buildM5AArtifacts = runM5AVerticalSlice
export const runModelAdapterVerticalSlice = runM5AVerticalSlice
export const runPaperReaderAdapter = runPaperReader
export const runProblemExtractorAdapter = runProblemExtractor

export function replayM5AArtifacts(artifacts: M5AArtifacts, document: ExtractedDocument): M5AArtifacts {
  if (document.artifactId !== artifacts.artifact.artifactId) throw new ValidationError('replay document does not match M5A artifact', '$.document.artifactId', 'INVALID_PROVENANCE')
  validatePaperReaderOutput(artifacts.paperReader, document)
  const evidenceIds = new Set(artifacts.evidence.map(item => item.evidenceId))
  validateProblemExtractorOutput(artifacts.problemExtractor, evidenceIds)
  const materialized = materializeReader(artifacts.paperReader, document, artifacts.artifact.paperId, artifacts.attempts.find(item => item.role === 'PaperReader' && item.status === 'SUCCEEDED')?.attemptId ?? '', artifacts.generatedAt)
  const graph = buildProblemGraph(normalizeGraph(document.artifactId, artifacts.problemExtractor), materialized.evidence)
  const state = { schemaVersion: 'm5a.model-adapter.v1', artifact: artifacts.artifact, paperReader: artifacts.paperReader, problemExtractor: artifacts.problemExtractor, problemGraph: graph, claims: materialized.claims, evidence: materialized.evidence }
  const stateHash = contentHash(canonicalJson(state))
  parseCheckpoint(artifacts.checkpoint)
  const expected = checkpoint(artifacts.runId, stateHash, artifacts.checkpoint.budget, artifacts.generatedAt)
  if (expected.checkpointId !== artifacts.checkpoint.checkpointId || expected.stateHash !== artifacts.checkpoint.stateHash) throw new ValidationError('M5A replay does not match persisted checkpoint', '$.checkpoint', 'CHECKPOINT_MISMATCH')
  return artifacts
}

export const replayM5A = replayM5AArtifacts

export function persistM5AArtifacts(outputDirectory: string, artifacts: M5AArtifacts): void {
  mkdirSync(outputDirectory, { recursive: true })
  const files: Readonly<Record<string, unknown>> = {
    'paper-reader.json': artifacts.paperReader,
    'paper-representation.json': artifacts.paperRepresentation,
    'problem-extractor.json': artifacts.problemExtractor,
    'problem-graph.json': artifacts.problemGraph,
    'claims.json': artifacts.claims,
    'evidence.json': artifacts.evidence,
    'model-attempts.json': artifacts.attempts,
    'events.json': artifacts.events,
    'checkpoint.json': artifacts.checkpoint,
  }
  for (const [name, value] of Object.entries(files)) writeFileSync(resolve(outputDirectory, name), JSON.stringify(value, null, 2), 'utf8')
}

/** Adapter-facing request helper for callers that need to inspect the model boundary. */
export function modelBoundarySummary(request: ModelRequest<unknown>): { readonly role: string; readonly schemaVersion: string; readonly outputSchema: string; readonly inputArtifactIds: readonly string[]; readonly inputEvidenceIds: readonly string[] } {
  return { role: request.role, schemaVersion: request.schemaVersion, outputSchema: request.outputSchema, inputArtifactIds: [...request.inputArtifactIds], inputEvidenceIds: [...request.inputEvidenceIds] }
}
