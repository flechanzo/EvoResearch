import { contentHash, deterministicId } from './ids.ts'
import type { ArtifactId, EvidenceId, GraphEdgeId, GraphNodeId, PaperId } from './ids.ts'
import type { Evidence, ResearchGraphEdge, ResearchGraphNode, ResearchProblemGraph, ResearchNodeType } from './types.ts'
import { parseResearchProblemGraph, ValidationError } from './validation.ts'

export type SupportedMediaType = 'application/pdf' | 'text/plain' | 'text/markdown'

export interface ArtifactManifest {
  readonly artifactId: ArtifactId
  readonly paperId: PaperId
  readonly originalFilename: string
  readonly mediaType: SupportedMediaType
  readonly byteSize: number
  readonly sha256: string
  readonly ingestionTimestamp: string
  readonly parserVersion: string
  readonly localPath?: string
}

export interface ExtractionDiagnostic { readonly code: 'UNSUPPORTED_MEDIA_TYPE' | 'EMPTY_ARTIFACT' | 'PARSER_FAILURE'; readonly message: string }
export class ArtifactIngestionError extends Error { readonly diagnostic: ExtractionDiagnostic; constructor(diagnostic: ExtractionDiagnostic) { super(`${diagnostic.code}: ${diagnostic.message}`); this.name = 'ArtifactIngestionError'; this.diagnostic = diagnostic } }

export interface DocumentLocator { readonly artifactId: ArtifactId; readonly page: number; readonly section?: string; readonly spanIndex: number; readonly start: number; readonly end: number; readonly blockIndex?: number; readonly lineIndex?: number; readonly characterRange?: readonly [number, number] }
export interface DocumentSpan { readonly locator: DocumentLocator; readonly text: string; readonly blockIndex?: number; readonly lineIndex?: number; readonly originalOrder?: number; readonly normalizedOrder?: number }
export interface DocumentPage { readonly page: number; readonly text: string; readonly width?: number; readonly height?: number; readonly blocks?: readonly DocumentBlock[] }
export interface DocumentBlock { readonly blockIndex: number; readonly bbox: readonly [number, number, number, number]; readonly text: string; readonly originalOrder: number; readonly normalizedOrder: number; readonly lines?: readonly { readonly lineIndex: number; readonly text: string; readonly spans?: readonly { readonly spanIndex: number; readonly text: string; readonly bbox?: readonly [number, number, number, number]; readonly font?: string; readonly size?: number }[] }[] }
export interface DocumentSection { readonly title: string; readonly page: number; readonly spanIndexes: readonly number[] }
export interface ExtractedDocument { readonly artifactId: ArtifactId; readonly parser: 'plain-text' | 'pdf-text-stream' | 'pymupdf'; readonly parserVersion: string; readonly pages: readonly DocumentPage[]; readonly sections: readonly DocumentSection[]; readonly spans: readonly DocumentSpan[]; readonly extractionWarnings: readonly string[]; readonly extractionProvenance?: { readonly adapter: string; readonly adapterVersion: string; readonly pymupdfVersion?: string; readonly pythonVersion?: string; readonly selectedPythonExecutable?: string; readonly sysExecutable?: string; readonly sidecarVersion?: string; readonly artifactSha256: string; readonly extractedAt: string; readonly extractedDocumentHash: string } }

export function ingestArtifact(bytes: Uint8Array, metadata: { paperId: PaperId; originalFilename: string; mediaType: string; ingestionTimestamp: string; parserVersion?: string; localPath?: string }): ArtifactManifest {
  if (!['application/pdf', 'text/plain', 'text/markdown'].includes(metadata.mediaType)) throw new ArtifactIngestionError({ code: 'UNSUPPORTED_MEDIA_TYPE', message: `unsupported media type ${metadata.mediaType}` })
  if (bytes.byteLength === 0) throw new ArtifactIngestionError({ code: 'EMPTY_ARTIFACT', message: 'artifact is empty' })
  const mediaType = metadata.mediaType as SupportedMediaType
  const sha256 = contentHash(new TextDecoder('latin1').decode(bytes))
  return { artifactId: deterministicId('artifact', { paperId: metadata.paperId, sha256, filename: metadata.originalFilename }) as ArtifactId, paperId: metadata.paperId, originalFilename: metadata.originalFilename, mediaType, byteSize: bytes.byteLength, sha256, ingestionTimestamp: metadata.ingestionTimestamp, parserVersion: metadata.parserVersion ?? 'm2.1', localPath: metadata.localPath }
}

export function extractDocument(manifest: ArtifactManifest, bytes: Uint8Array): ExtractedDocument {
  if (bytes.byteLength !== manifest.byteSize || contentHash(new TextDecoder('latin1').decode(bytes)) !== manifest.sha256) throw new ArtifactIngestionError({ code: 'PARSER_FAILURE', message: 'artifact bytes do not match manifest' })
  try {
    const raw = new TextDecoder('latin1').decode(bytes)
    const pages = manifest.mediaType === 'application/pdf' ? extractPdfPages(raw) : raw.split(/\f/g).map((text, i) => ({ page: i + 1, text }))
    const spans: DocumentSpan[] = []; const sections: DocumentSection[] = []; let section = 'Document'
    pages.forEach(page => page.text.split(/\r?\n/).forEach(line => { const text = line.trim(); if (!text) return; if (/^(#{1,6})\s+/.test(text)) section = text.replace(/^#{1,6}\s+/, '').trim(); const spanIndex = spans.length; spans.push({ locator: { artifactId: manifest.artifactId, page: page.page, section, spanIndex, start: 0, end: text.length }, text }); const existing = sections.find(item => item.title === section && item.page === page.page); if (existing) (existing.spanIndexes as number[]).push(spanIndex); else sections.push({ title: section, page: page.page, spanIndexes: [spanIndex] }) }))
    return { artifactId: manifest.artifactId, parser: manifest.mediaType === 'application/pdf' ? 'pdf-text-stream' : 'plain-text', parserVersion: manifest.parserVersion, pages, sections, spans, extractionWarnings: manifest.mediaType === 'application/pdf' && pages.every(page => !page.text.trim()) ? ['PDF contained no extractable text streams'] : [] }
  } catch (error) { throw new ArtifactIngestionError({ code: 'PARSER_FAILURE', message: error instanceof Error ? error.message : 'unknown parser failure' }) }
}

function extractPdfPages(raw: string): DocumentPage[] {
  const chunks = raw.split(/\/Type\s*\/Page\b/).slice(1); if (!chunks.length) return [{ page: 1, text: decodePdfStrings(raw) }]
  return chunks.map((chunk, index) => ({ page: index + 1, text: decodePdfStrings(chunk) }))
}
function decodePdfStrings(value: string): string { return [...value.matchAll(/\(([^()]*)\)\s*T[Jj]/g)].map(match => match[1].replace(/\\([\\()])/g, '$1')).join(' ').replace(/\s+/g, ' ').trim() }

export type PaperReaderItemType = 'problem' | 'method' | 'assumption' | 'dataset' | 'metric' | 'limitation' | 'failure-case' | 'open-question' | 'claim'
export type InterpretationKind = 'DIRECT_EVIDENCE' | 'MODEL_INTERPRETATION'
const PAPER_READER_ITEM_TYPES: readonly PaperReaderItemType[] = ['problem', 'method', 'assumption', 'dataset', 'metric', 'limitation', 'failure-case', 'open-question', 'claim']
export interface PaperReaderItem { readonly itemId: string; readonly type: PaperReaderItemType; readonly statement: string; readonly confidence: number; readonly uncertainty: number; readonly locators: readonly DocumentLocator[]; readonly interpretation: InterpretationKind }
export interface PaperReaderOutput { readonly artifactId: ArtifactId; readonly items: readonly PaperReaderItem[]; readonly schemaVersion: string }
export interface ModelRoute { readonly provider: string; readonly model: string }
export interface ModelRequest<T> { readonly role: string; readonly stage?: string; readonly route: ModelRoute; readonly skillVersion: string; readonly inputArtifactIds: readonly ArtifactId[]; readonly inputEvidenceIds: readonly EvidenceId[]; readonly schemaVersion: string; readonly attemptId: string; readonly input: unknown; readonly outputSchema: string }
export interface ModelUsage { readonly inputTokens?: number; readonly outputTokens?: number; readonly totalTokens?: number }
export type ParseStatus = 'not-attempted' | 'success' | 'failure'
export type SchemaValidationStatus = 'not-attempted' | 'success' | 'failure'
export interface ModelResponseDiagnostic {
  readonly attemptId: string
  readonly model?: string
  readonly requestTimestamp?: string
  readonly responseTimestamp?: string
  readonly latencyMs?: number
  readonly usage?: ModelUsage
  readonly contentType?: string
  readonly streamEventTypes?: readonly string[]
  readonly terminalObserved?: boolean
  readonly normalizedTextPresent: boolean
  readonly normalizedTextHash?: string
  readonly normalizedTextPreview?: string
  readonly normalizedTextTruncated?: boolean
  readonly structuredOutputMode?: string
  readonly providerErrorEventType?: string
  readonly providerStatus?: number
  readonly providerErrorCode?: string
  readonly providerErrorMessage?: string
  readonly responseId?: string
  readonly requestId?: string
  readonly retryable?: boolean
  readonly parseStatus: ParseStatus
  readonly schemaValidationStatus: SchemaValidationStatus
  readonly validationErrors?: readonly string[]
  readonly trustedEnrichment?: readonly string[]
  readonly status: 'SUCCEEDED' | 'FAILED'
  readonly outputTrust: 'UNTRUSTED / UNVALIDATED'
}
export type ModelGatewayResult<T> = {
  readonly ok: true
  readonly value: T
  readonly usage?: ModelUsage
  readonly diagnostic?: ModelResponseDiagnostic
} | {
  readonly ok: false
  readonly error: string
  readonly usage?: ModelUsage
  readonly diagnostic?: ModelResponseDiagnostic
}
export interface ModelGateway {
  structured<T>(request: ModelRequest<T>): Promise<ModelGatewayResult<T>>
  annotateAttempt?(attemptId: string, patch: Partial<ModelResponseDiagnostic> & { readonly error?: string }): void
}

export type ModelAttempt<T> = { readonly ok: true; readonly value: T; readonly usage?: ModelUsage; readonly request: ModelRequest<T>; readonly diagnostic?: ModelResponseDiagnostic } | { readonly ok: false; readonly error: string; readonly request: ModelRequest<T>; readonly usage?: ModelUsage; readonly diagnostic?: ModelResponseDiagnostic; readonly failureKind?: 'TRANSPORT' | 'SERIALIZATION' | 'SCHEMA' }
export interface PaperReaderContext { readonly chunks: readonly { readonly chunkId: string; readonly section: string; readonly text: string; readonly locators: readonly DocumentLocator[]; readonly truncated: boolean }[]; readonly omittedSpanCount: number }
export interface PaperReaderAttemptReport { readonly attemptNumber: number; readonly request: ModelRequest<PaperReaderOutput>; readonly result: ModelGatewayResult<PaperReaderOutput>; readonly parsedOutput?: unknown; readonly validationErrors: readonly string[]; readonly trustedEnrichment?: readonly string[]; readonly diagnostic?: ModelResponseDiagnostic }
export interface PaperReaderRunOptions { readonly maxSerializationRetries?: number; readonly onAttempt?: (report: PaperReaderAttemptReport) => void | Promise<void>; readonly onSerializationRetry?: (attemptNumber: number, errors: readonly string[]) => void | Promise<void> }
const PAPER_READER_CONTRACT = 'PaperReader model result: {"artifactId": optional (if present it must equal the input artifact; application code owns this identity), "schemaVersion": string, "items": [{"itemId": string, "type": "problem"|"method"|"assumption"|"dataset"|"metric"|"limitation"|"failure-case"|"open-question"|"claim", "statement": string, "confidence": number in [0,1], "uncertainty": number in [0,1], "locators": [{"spanIndex": integer, optionally copied canonical locator fields}], "interpretation": "DIRECT_EVIDENCE"|"MODEL_INTERPRETATION"}]} . For source evidence, copy an existing spanIndex from the supplied context; do not invent page, section, start, end, block, line, or character-range fields.'
const PAPER_READER_LOCATOR_INSTRUCTIONS = 'Source provenance is selectable, not generative: choose a locator from the supplied chunk locators and copy its existing spanIndex exactly. You may return only the spanIndex; application code resolves it to the complete canonical locator. Do not infer or invent page, section, start, end, blockIndex, lineIndex, or characterRange values.'
export async function runPaperReader(gateway: ModelGateway, document: ExtractedDocument, route: ModelRoute, skillVersion = 'paper-reader@1', context?: PaperReaderContext, options: PaperReaderRunOptions = {}): Promise<ModelAttempt<PaperReaderOutput>> {
  const boundedInput = context ? { chunks: context.chunks, omittedSpanCount: context.omittedSpanCount } : { pages: document.pages, spans: document.spans }
  const paperReaderInput = { ...boundedInput, paperReaderContract: PAPER_READER_CONTRACT, locatorInstructions: PAPER_READER_LOCATOR_INSTRUCTIONS }
  const retries = Math.max(0, Math.min(options.maxSerializationRetries ?? 1, 1))
  let previousErrors: string[] = []
  for (let attemptNumber = 1; attemptNumber <= retries + 1; attemptNumber++) {
    const retryInput = attemptNumber === 1 ? paperReaderInput : { ...paperReaderInput, serializationRetry: { instruction: 'The previous response failed structural serialization/schema validation. Return corrected JSON only. Do not introduce new scientific evidence or change the interpretation task.', expectedContract: PAPER_READER_CONTRACT, validationErrors: previousErrors } }
    const request: ModelRequest<PaperReaderOutput> = { role: 'PaperReader', route, skillVersion, inputArtifactIds: [document.artifactId], inputEvidenceIds: [], schemaVersion: 'm2.3', attemptId: deterministicId('attempt', { role: 'PaperReader', artifactId: document.artifactId, skillVersion, attemptNumber }), input: retryInput, outputSchema: 'PaperReaderOutput' }
    const result = await gateway.structured<PaperReaderOutput>(request)
    if (!result.ok) {
      const errors = [result.error]
      previousErrors = errors
      const diagnostic = result.diagnostic
      const serializationFailure = diagnostic?.parseStatus === 'failure' || /invalid model JSON|malformed model output|PaperReader/i.test(result.error)
      await options.onAttempt?.({ attemptNumber, request, result, validationErrors: errors, diagnostic })
      if (attemptNumber <= retries && serializationFailure) { await options.onSerializationRetry?.(attemptNumber, errors); continue }
      return { ...result, request, failureKind: serializationFailure ? 'SERIALIZATION' : 'TRANSPORT' }
    }
    try {
      const trustedEnvelope = attachTrustedPaperReaderArtifactId(result.value, document.artifactId)
      const trustedEnrichment = trustedEnvelope === result.value ? [] : ['artifactId'] as const
      const resolvedEnvelope = resolvePaperReaderLocatorReferences(trustedEnvelope, document)
      const value = validatePaperReaderOutput(resolvedEnvelope, document)
      const diagnostic = result.diagnostic ? { ...result.diagnostic, schemaValidationStatus: 'success' as const, status: 'SUCCEEDED' as const, trustedEnrichment } : result.diagnostic
      gateway.annotateAttempt?.(request.attemptId, { schemaValidationStatus: 'success', status: 'SUCCEEDED', trustedEnrichment, outputTrust: 'UNTRUSTED / UNVALIDATED' })
      await options.onAttempt?.({ attemptNumber, request, result, parsedOutput: result.value, validationErrors: [], trustedEnrichment, diagnostic })
      return { ok: true, value, usage: result.usage, request, diagnostic }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'malformed model output'
      previousErrors = [message]
      const diagnostic = result.diagnostic ? { ...result.diagnostic, schemaValidationStatus: 'failure' as const, status: 'FAILED' as const, validationErrors: previousErrors } : result.diagnostic
      gateway.annotateAttempt?.(request.attemptId, { schemaValidationStatus: 'failure', status: 'FAILED', validationErrors: previousErrors, error: message })
      await options.onAttempt?.({ attemptNumber, request, result, parsedOutput: result.value, validationErrors: previousErrors, diagnostic })
      if (attemptNumber <= retries) { await options.onSerializationRetry?.(attemptNumber, previousErrors); continue }
      return { ok: false, error: message, usage: result.usage, request, diagnostic, failureKind: 'SCHEMA' }
    }
  }
  throw new Error('unreachable PaperReader retry state')
}

/**
 * Artifact identity is owned by ingestion/application state, not by the model.
 * Enrich only an otherwise envelope-shaped object; all semantic fields still
 * pass through the strict validator and a supplied identity is never changed.
 */
export function attachTrustedPaperReaderArtifactId(output: unknown, artifactId: ArtifactId): unknown {
  if (!output || typeof output !== 'object' || Array.isArray(output)) return output
  const value = output as Record<string, unknown>
  if (Object.prototype.hasOwnProperty.call(value, 'artifactId')) return output
  if (typeof value.schemaVersion === 'string' && Array.isArray(value.items)) return { artifactId, ...value }
  return output
}

const LOCATOR_FIELDS = ['artifactId', 'page', 'section', 'spanIndex', 'start', 'end', 'blockIndex', 'lineIndex', 'characterRange'] as const

/** Resolve model references through the existing canonical spanIndex only. */
export function resolvePaperReaderLocatorReferences(output: unknown, document: ExtractedDocument): unknown {
  if (!output || typeof output !== 'object' || Array.isArray(output)) return output
  const value = output as Record<string, unknown>
  if (!Array.isArray(value.items)) return output
  return {
    ...value,
    items: value.items.map((item, itemIndex) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return item
      const candidate = item as Record<string, unknown>
      if (!Array.isArray(candidate.locators)) return item
      return { ...candidate, locators: candidate.locators.map((locator, locatorIndex) => resolvePaperReaderLocator(locator, document, `$.items[${itemIndex}].locators[${locatorIndex}]`)) }
    }),
  }
}

function resolvePaperReaderLocator(locator: unknown, document: ExtractedDocument, path: string): unknown {
  if (!locator || typeof locator !== 'object' || Array.isArray(locator)) return locator
  const candidate = locator as Record<string, unknown>
  if (!Number.isSafeInteger(candidate.spanIndex)) return locator
  const canonical = document.spans.find(span => span.locator.spanIndex === candidate.spanIndex)?.locator
  if (!canonical) return locator
  for (const key of Object.keys(candidate)) {
    if (!(LOCATOR_FIELDS as readonly string[]).includes(key)) throw new ValidationError('unexpected locator property', `${path}.${key}`, 'INVALID_LOCATOR')
    if (JSON.stringify(candidate[key]) !== JSON.stringify(canonical[key as keyof DocumentLocator])) throw new ValidationError('locator field does not match canonical source locator', `${path}.${key}`, key === 'artifactId' ? 'INVALID_PROVENANCE' : 'INVALID_LOCATOR')
  }
  return canonical
}

export interface ProblemExtractorEvidenceReference { readonly itemId: string; readonly evidenceId: EvidenceId }
export interface ProblemExtractorRunOptions { readonly maxSerializationRetries?: number; readonly availableEvidenceIds?: readonly EvidenceId[]; readonly evidenceReferences?: readonly ProblemExtractorEvidenceReference[]; readonly onSerializationRetry?: (attemptNumber: number, errors: readonly string[]) => void | Promise<void> }
const PROBLEM_EXTRACTOR_NODE_TYPES: readonly string[] = ['paper', 'problem', 'method', 'assumption', 'dataset', 'metric', 'limitation', 'failure-case', 'open-question', 'claim']
const PROBLEM_EXTRACTOR_CONTRACT = 'ProblemExtractorOutput JSON object: {"nodes": [{"nodeId": non-empty string unique within nodes, "type": one of paper|problem|method|assumption|dataset|metric|limitation|failure-case|open-question|claim, "label": non-empty string, "evidenceIds": array of supplied evidence IDs}], "edges": [{"edgeId": non-empty string, "from": nodeId string, "to": nodeId string, "relation": one of STUDIES|PROPOSES|USES|ASSUMES|EVALUATED_ON|USES_METRIC|LIMITED_BY|FAILS_WHEN|LEAVES_OPEN|SUPPORTS|CONTRADICTS|MOTIVATES|DERIVED_FROM, "evidenceIds": array of supplied evidence IDs}]}. Empty nodes and edges arrays are allowed. Copy only evidence IDs listed in availableEvidenceIds and resolve PaperReader itemId values through the supplied evidenceReferences mapping; if none support an assertion, return an empty evidenceIds array. Do not use PaperReader itemIds as evidence IDs, do not return a PaperReaderOutput envelope, and do not invent provenance.'

export async function runProblemExtractor(gateway: ModelGateway, reader: PaperReaderOutput, route: ModelRoute, skillVersion = 'problem-extractor@1', options: ProblemExtractorRunOptions = {}): Promise<ModelAttempt<ProblemExtractorOutput>> {
  const maxRetries = Math.max(0, Math.min(options.maxSerializationRetries ?? 1, 1))
  const availableEvidenceIds = options.availableEvidenceIds === undefined ? undefined : new Set(options.availableEvidenceIds)
  const baseInput = { paperReaderOutput: reader, availableEvidenceIds: options.availableEvidenceIds ?? [], evidenceReferences: options.evidenceReferences ?? [], problemExtractorContract: PROBLEM_EXTRACTOR_CONTRACT, instructions: 'Extract graph nodes and edges from the validated PaperReaderOutput. Return only the ProblemExtractorOutput contract. Preserve provenance references by resolving PaperReader itemId values through evidenceReferences and copying the mapped evidenceId exactly; if no matching evidence ID is supplied, use an empty evidenceIds array.' }
  let previousErrors: string[] = []
  for (let attemptNumber = 1; attemptNumber <= maxRetries + 1; attemptNumber++) {
    const input = attemptNumber === 1 ? baseInput : { ...baseInput, serializationRetry: { instruction: 'The previous response failed structural serialization/schema validation. Return corrected JSON only. Do not add scientific content or invent provenance.', expectedContract: PROBLEM_EXTRACTOR_CONTRACT, validationErrors: previousErrors } }
    const request: ModelRequest<ProblemExtractorOutput> = { role: 'ProblemExtractor', stage: 'PROBLEM_EXTRACT', route, skillVersion, inputArtifactIds: [reader.artifactId], inputEvidenceIds: [...(options.availableEvidenceIds ?? [])], schemaVersion: 'm2.4', attemptId: deterministicId('attempt', { role: 'ProblemExtractor', artifactId: reader.artifactId, skillVersion, attemptNumber }), input, outputSchema: 'ProblemExtractorOutput' }
    const result = await gateway.structured<ProblemExtractorOutput>(request)
    if (!result.ok) {
      // Only a gateway-reported parse failure enters the serialization retry path.
      // Provider/transport failures return without consuming that allowance.
      const serializationFailure = result.diagnostic?.parseStatus === 'failure'
      if (serializationFailure) {
        previousErrors = [result.error]
        gateway.annotateAttempt?.(request.attemptId, { retryable: attemptNumber <= maxRetries })
        if (attemptNumber <= maxRetries) { await options.onSerializationRetry?.(attemptNumber, previousErrors); continue }
      }
      return { ...result, request, failureKind: serializationFailure ? 'SERIALIZATION' : 'TRANSPORT' }
    }
    try {
      const value = validateProblemExtractorOutput(result.value, availableEvidenceIds)
      gateway.annotateAttempt?.(request.attemptId, { schemaValidationStatus: 'success', status: 'SUCCEEDED', outputTrust: 'UNTRUSTED / UNVALIDATED' })
      return { ok: true, value, usage: result.usage, request }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'malformed ProblemExtractor output'
      previousErrors = [message]
      gateway.annotateAttempt?.(request.attemptId, { schemaValidationStatus: 'failure', status: 'FAILED', validationErrors: previousErrors, error: message, retryable: attemptNumber <= maxRetries })
      if (attemptNumber <= maxRetries) { await options.onSerializationRetry?.(attemptNumber, previousErrors); continue }
      return { ok: false, error: message, usage: result.usage, request, failureKind: 'SCHEMA' }
    }
  }
  throw new Error('unreachable ProblemExtractor retry state')
}

export function validatePaperReaderOutput(output: unknown, document: ExtractedDocument): PaperReaderOutput {
  if (Array.isArray(output)) throw new ValidationError('expected PaperReaderOutput, received array', '$', 'MALFORMED_MODEL_OUTPUT')
  if (!output || typeof output !== 'object') throw new ValidationError(`expected PaperReaderOutput, received ${describeValue(output)}`, '$', 'MALFORMED_MODEL_OUTPUT')
  const value = output as Partial<PaperReaderOutput>
  if (!Object.prototype.hasOwnProperty.call(value, 'artifactId')) throw new ValidationError('missing required property', '$.artifactId', 'MALFORMED_MODEL_OUTPUT')
  if (typeof value.artifactId !== 'string') throw new ValidationError(`expected string, received ${describeValue(value.artifactId)}`, '$.artifactId', 'MALFORMED_MODEL_OUTPUT')
  if (value.artifactId !== document.artifactId) throw new ValidationError('does not match input artifact', '$.artifactId', 'INVALID_PROVENANCE')
  if (!Object.prototype.hasOwnProperty.call(value, 'schemaVersion')) throw new ValidationError('missing required property', '$.schemaVersion', 'MALFORMED_MODEL_OUTPUT')
  if (typeof value.schemaVersion !== 'string') throw new ValidationError(`expected string, received ${describeValue(value.schemaVersion)}`, '$.schemaVersion', 'MALFORMED_MODEL_OUTPUT')
  if (!Object.prototype.hasOwnProperty.call(value, 'items')) throw new ValidationError('missing required property', '$.items', 'MALFORMED_MODEL_OUTPUT')
  if (!Array.isArray(value.items)) throw new ValidationError(`expected array, received ${describeValue(value.items)}`, '$.items', 'MALFORMED_MODEL_OUTPUT')
  const valid = new Set(document.spans.map(span => JSON.stringify(span.locator)))
  value.items.forEach((item, i) => { const path = `$.items[${i}]`; if (!item || typeof item !== 'object' || Array.isArray(item)) throw new ValidationError(`expected object, received ${describeValue(item)}`, path, 'MALFORMED_MODEL_OUTPUT'); const candidate = item as Partial<PaperReaderItem>; for (const field of ['itemId', 'type', 'statement', 'confidence', 'uncertainty', 'locators', 'interpretation'] as const) if (!Object.prototype.hasOwnProperty.call(candidate, field)) throw new ValidationError('missing required property', `${path}.${field}`, 'MALFORMED_MODEL_OUTPUT'); if (typeof candidate.itemId !== 'string') throw new ValidationError(`expected string, received ${describeValue(candidate.itemId)}`, `${path}.itemId`, 'MALFORMED_MODEL_OUTPUT'); if (typeof candidate.type !== 'string' || !PAPER_READER_ITEM_TYPES.includes(candidate.type as PaperReaderItemType)) throw new ValidationError('expected supported PaperReader item type', `${path}.type`, 'MALFORMED_MODEL_OUTPUT'); if (typeof candidate.statement !== 'string') throw new ValidationError(`expected string, received ${describeValue(candidate.statement)}`, `${path}.statement`, 'MALFORMED_MODEL_OUTPUT'); if (!Array.isArray(candidate.locators)) throw new ValidationError(`expected array, received ${describeValue(candidate.locators)}`, `${path}.locators`, 'MALFORMED_MODEL_OUTPUT'); if (!['DIRECT_EVIDENCE', 'MODEL_INTERPRETATION'].includes(candidate.interpretation as string)) throw new ValidationError('expected DIRECT_EVIDENCE or MODEL_INTERPRETATION', `${path}.interpretation`, 'MALFORMED_MODEL_OUTPUT'); if (candidate.interpretation === 'DIRECT_EVIDENCE' && candidate.locators.length === 0) throw new ValidationError('direct evidence requires a locator', `${path}.locators`, 'INVALID_PROVENANCE'); candidate.locators.forEach((locator: DocumentLocator, j: number) => { if (!locator || typeof locator !== 'object' || Array.isArray(locator)) throw new ValidationError('invalid locator', `${path}.locators[${j}]`, 'INVALID_LOCATOR'); if (!valid.has(JSON.stringify(locator))) throw new ValidationError('locator does not exist in extracted document', `${path}.locators[${j}]`, 'INVALID_LOCATOR'); if (locator.artifactId !== document.artifactId) throw new ValidationError('locator artifact mismatch', `${path}.locators[${j}]`, 'INVALID_PROVENANCE') }); if (typeof candidate.confidence !== 'number' || !Number.isFinite(candidate.confidence) || candidate.confidence < 0 || candidate.confidence > 1) throw new ValidationError('expected finite number in [0, 1]', `${path}.confidence`, 'MALFORMED_MODEL_OUTPUT'); if (typeof candidate.uncertainty !== 'number' || !Number.isFinite(candidate.uncertainty) || candidate.uncertainty < 0 || candidate.uncertainty > 1) throw new ValidationError('expected finite number in [0, 1]', `${path}.uncertainty`, 'MALFORMED_MODEL_OUTPUT') })
  return value as PaperReaderOutput
}

function describeValue(value: unknown): string { if (value === null) return 'null'; if (Array.isArray(value)) return 'array'; return typeof value }

export interface ProblemExtractorOutput { readonly nodes: readonly { readonly nodeId: GraphNodeId; readonly type: ResearchNodeType; readonly label: string; readonly evidenceIds: readonly EvidenceId[] }[]; readonly edges: readonly { readonly edgeId: GraphEdgeId; readonly from: string; readonly to: string; readonly relation: string; readonly evidenceIds: readonly EvidenceId[] }[] }
export const GRAPH_RELATIONS = ['STUDIES', 'PROPOSES', 'USES', 'ASSUMES', 'EVALUATED_ON', 'USES_METRIC', 'LIMITED_BY', 'FAILS_WHEN', 'LEAVES_OPEN', 'SUPPORTS', 'CONTRADICTS', 'MOTIVATES', 'DERIVED_FROM'] as const
export function validateProblemExtractorOutput(output: unknown, availableEvidenceIds?: ReadonlySet<string>): ProblemExtractorOutput {
  if (Array.isArray(output)) throw new ValidationError('expected ProblemExtractorOutput, received array', '$', 'MALFORMED_MODEL_OUTPUT')
  if (!output || typeof output !== 'object') throw new ValidationError(`expected ProblemExtractorOutput, received ${describeValue(output)}`, '$', 'MALFORMED_MODEL_OUTPUT')
  const value = output as Record<string, unknown>
  if (!Object.prototype.hasOwnProperty.call(value, 'nodes')) throw new ValidationError('missing required property', '$.nodes', 'MALFORMED_MODEL_OUTPUT')
  if (!Array.isArray(value.nodes)) throw new ValidationError(`expected array, received ${describeValue(value.nodes)}`, '$.nodes', 'MALFORMED_MODEL_OUTPUT')
  if (!Object.prototype.hasOwnProperty.call(value, 'edges')) throw new ValidationError('missing required property', '$.edges', 'MALFORMED_MODEL_OUTPUT')
  if (!Array.isArray(value.edges)) throw new ValidationError(`expected array, received ${describeValue(value.edges)}`, '$.edges', 'MALFORMED_MODEL_OUTPUT')
  const nodeIds = new Set<string>()
  value.nodes.forEach((node, index) => {
    const path = `$.nodes[${index}]`
    if (!node || typeof node !== 'object' || Array.isArray(node)) throw new ValidationError(`expected object, received ${describeValue(node)}`, path, 'MALFORMED_MODEL_OUTPUT')
    const item = node as Record<string, unknown>
    for (const field of ['nodeId', 'type', 'label', 'evidenceIds']) if (!Object.prototype.hasOwnProperty.call(item, field)) throw new ValidationError('missing required property', `${path}.${field}`, 'MALFORMED_MODEL_OUTPUT')
    requireNonEmptyString(item.nodeId, `${path}.nodeId`)
    if (nodeIds.has(item.nodeId)) throw new ValidationError('duplicate node ID', `${path}.nodeId`, 'DUPLICATE_ID')
    nodeIds.add(item.nodeId)
    if (typeof item.type !== 'string' || !PROBLEM_EXTRACTOR_NODE_TYPES.includes(item.type)) throw new ValidationError('expected supported graph node type', `${path}.type`, 'MALFORMED_MODEL_OUTPUT')
    requireNonEmptyString(item.label, `${path}.label`)
    validateStringIdArray(item.evidenceIds, `${path}.evidenceIds`, availableEvidenceIds)
  })
  value.edges.forEach((edge, index) => {
    const path = `$.edges[${index}]`
    if (!edge || typeof edge !== 'object' || Array.isArray(edge)) throw new ValidationError(`expected object, received ${describeValue(edge)}`, path, 'MALFORMED_MODEL_OUTPUT')
    const item = edge as Record<string, unknown>
    for (const field of ['edgeId', 'from', 'to', 'relation', 'evidenceIds']) if (!Object.prototype.hasOwnProperty.call(item, field)) throw new ValidationError('missing required property', `${path}.${field}`, 'MALFORMED_MODEL_OUTPUT')
    requireNonEmptyString(item.edgeId, `${path}.edgeId`)
    requireNonEmptyString(item.from, `${path}.from`)
    requireNonEmptyString(item.to, `${path}.to`)
    if (typeof item.relation !== 'string' || !GRAPH_RELATIONS.includes(item.relation as typeof GRAPH_RELATIONS[number])) throw new ValidationError('expected supported graph relation', `${path}.relation`, 'MALFORMED_MODEL_OUTPUT')
    validateStringIdArray(item.evidenceIds, `${path}.evidenceIds`, availableEvidenceIds)
  })
  return output as ProblemExtractorOutput
}

function requireNonEmptyString(value: unknown, path: string): asserts value is string { if (typeof value !== 'string' || value.trim() === '') throw new ValidationError('expected non-empty string', path, 'MALFORMED_MODEL_OUTPUT') }
function validateStringIdArray(value: unknown, path: string, availableIds?: ReadonlySet<string>): asserts value is readonly string[] { if (!Array.isArray(value)) throw new ValidationError(`expected array, received ${describeValue(value)}`, path, 'MALFORMED_MODEL_OUTPUT'); value.forEach((item, index) => { requireNonEmptyString(item, `${path}[${index}]`); if (availableIds && !availableIds.has(item)) throw new ValidationError('evidence reference does not exist', `${path}[${index}]`, 'INVALID_PROVENANCE') }); if (new Set(value).size !== value.length) throw new ValidationError('IDs must be unique', path, 'DUPLICATE_ID') }
export function buildProblemGraph(output: ProblemExtractorOutput, evidence: readonly Evidence[]): ResearchProblemGraph { const evidenceIds = new Set(evidence.map(item => item.evidenceId)); const nodes: ResearchGraphNode[] = [...output.nodes].sort((a, b) => a.nodeId.localeCompare(b.nodeId)); const nodeIds = new Set<string>(nodes.map(node => node.nodeId)); const edges: ResearchGraphEdge[] = [...output.edges].sort((a, b) => a.edgeId.localeCompare(b.edgeId)); edges.forEach(edge => { if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) throw new ValidationError('edge references unknown node', '$.edges', 'INVALID_GRAPH_REFERENCE'); if (!GRAPH_RELATIONS.includes(edge.relation as never)) throw new ValidationError('unsupported graph relation', '$.edges.relation'); edge.evidenceIds.forEach(id => { if (!evidenceIds.has(id)) throw new ValidationError('graph assertion references missing evidence', '$.edges.evidenceIds', 'INVALID_PROVENANCE') }) }); nodes.forEach(node => node.evidenceIds.forEach(id => { if (!evidenceIds.has(id)) throw new ValidationError('graph node references missing evidence', '$.nodes.evidenceIds', 'INVALID_PROVENANCE') })); return parseResearchProblemGraph({ problems: [], nodes, edges }, evidenceIds) }

export function validateEvidenceAgainstDocument(evidence: Evidence, manifest: ArtifactManifest, document: ExtractedDocument): Evidence {
  if (evidence.provenance.sourceType !== 'artifact' || evidence.provenance.sourceId !== manifest.artifactId) throw new ValidationError('evidence artifact mismatch', '$.provenance.sourceId', 'INVALID_PROVENANCE')
  if (!evidence.provenance.locator) throw new ValidationError('paper evidence requires a locator', '$.provenance.locator', 'INVALID_PROVENANCE')
  let locator: unknown; try { locator = JSON.parse(evidence.provenance.locator) } catch { throw new ValidationError('invalid evidence locator encoding', '$.provenance.locator', 'INVALID_LOCATOR') }
  if (!document.spans.some(span => JSON.stringify(span.locator) === JSON.stringify(locator))) throw new ValidationError('evidence locator does not exist', '$.provenance.locator', 'INVALID_LOCATOR')
  return evidence
}

export class ProblemGraphIndex { readonly graph: ResearchProblemGraph; readonly evidence: readonly Evidence[]; constructor(graph: ResearchProblemGraph, evidence: readonly Evidence[]) { this.graph = graph; this.evidence = evidence } getNode(id: string) { return this.graph.nodes.find(node => node.nodeId === id) } getOutgoingEdges(id: string) { return this.graph.edges.filter(edge => edge.from === id) } getIncomingEdges(id: string) { return this.graph.edges.filter(edge => edge.to === id) } getEvidenceForNode(id: string) { const node = this.getNode(id); return this.evidence.filter(item => node?.evidenceIds.includes(item.evidenceId)) } getEvidenceForEdge(id: string) { const edge = this.graph.edges.find(item => item.edgeId === id); return this.evidence.filter(item => edge?.evidenceIds.includes(item.evidenceId)) } getOpenQuestions() { return this.graph.nodes.filter(node => node.type === 'open-question') } getLimitations() { return this.graph.nodes.filter(node => node.type === 'limitation') } getAssumptions() { return this.graph.nodes.filter(node => node.type === 'assumption') } getMethods() { return this.graph.nodes.filter(node => node.type === 'method') } }
