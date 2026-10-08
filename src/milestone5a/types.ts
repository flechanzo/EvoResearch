import type {
  ArtifactManifest,
  Checkpoint,
  Claim,
  DocumentLocator,
  DocumentSection,
  DomainEvent,
  Evidence,
  ExtractedDocument,
  ModelGateway,
  ModelResponseDiagnostic,
  ModelRoute,
  PaperReaderContext,
  PaperReaderItem,
  PaperReaderOutput,
  ProblemExtractorOutput,
  ResearchProblemGraph,
  Timestamp,
} from '../domain/index.ts'
import type { RunId } from '../domain/ids.ts'
import type { EvidenceId } from '../domain/ids.ts'

export interface M5APaperRepresentation {
  readonly sections: readonly DocumentSection[]
  readonly problems: readonly PaperReaderItem[]
  readonly methods: readonly PaperReaderItem[]
  readonly assumptions: readonly PaperReaderItem[]
  readonly limitations: readonly PaperReaderItem[]
  readonly openQuestions: readonly PaperReaderItem[]
  readonly evidenceLocators: readonly { readonly itemId: string; readonly locators: readonly DocumentLocator[] }[]
}

export interface M5AModelAttempt {
  readonly role: 'PaperReader' | 'ProblemExtractor'
  readonly attemptId: string
  readonly status: 'SUCCEEDED' | 'FAILED'
  readonly error?: string
  readonly failureKind?: 'TRANSPORT' | 'SERIALIZATION' | 'SCHEMA'
  readonly diagnostic?: ModelResponseDiagnostic
}

export interface M5AInput {
  readonly artifact: ArtifactManifest
  readonly document: ExtractedDocument
  readonly gateway?: ModelGateway
  readonly route?: ModelRoute
  readonly runId?: RunId
  readonly now: Timestamp
  readonly paperReaderContext?: PaperReaderContext
  readonly evidenceIds?: readonly EvidenceId[]
  readonly maxSerializationRetries?: number
  readonly skillVersions?: { readonly paperReader?: string; readonly problemExtractor?: string }
}

export interface M5AArtifacts {
  readonly schemaVersion: 'm5a.model-adapter.v1'
  readonly runId: RunId
  readonly generatedAt: Timestamp
  readonly artifact: ArtifactManifest
  readonly paperRepresentation: M5APaperRepresentation
  readonly paperReader: PaperReaderOutput
  readonly problemExtractor: ProblemExtractorOutput
  readonly problemGraph: ResearchProblemGraph
  readonly claims: readonly Claim[]
  readonly evidence: readonly Evidence[]
  readonly attempts: readonly M5AModelAttempt[]
  readonly events: readonly DomainEvent[]
  readonly checkpoint: Checkpoint
}

export interface M5AFailure {
  readonly ok: false
  readonly runId: RunId
  readonly failedRole: 'PaperReader' | 'ProblemExtractor' | 'PROBLEM_GRAPH'
  readonly error: string
  readonly attempts: readonly M5AModelAttempt[]
}

export interface M5ASuccess {
  readonly ok: true
  readonly value: M5AArtifacts
}

export type M5AResult = M5ASuccess | M5AFailure

export interface OfflineMockResponseMap {
  readonly PaperReader?: unknown | ((request: unknown) => unknown | Promise<unknown>)
  readonly ProblemExtractor?: unknown | ((request: unknown) => unknown | Promise<unknown>)
}
