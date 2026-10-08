import type { Checkpoint, DomainEvent } from '../domain/types.ts'

/** The three durable boundaries owned by the Generation-0 extension. */
export type Generation0Boundary = 'EVALUATE' | 'GAP_DISCOVERY' | 'GENERATION_0'

export interface Generation0AttemptMarker {
  readonly attemptId: string
  readonly role: 'GapDiscovery' | 'HypothesisGenerator'
  readonly startedAt: string
}

export interface Generation0BoundaryRecord {
  readonly schemaVersion: 'generation0.boundary.v1'
  readonly boundary: Generation0Boundary
  readonly runId: string
  readonly sourceRunId?: string
  readonly configHash?: string
  readonly corpusCutoff?: string
  readonly stateHash: string
  readonly state: unknown
  readonly value: unknown
  readonly checkpoint: Checkpoint
  readonly events: readonly DomainEvent[]
  readonly committedAt: string
}

export interface Generation0RunStore {
  /** Validate or initialize immutable run identity/config/cutoff metadata. */
  open(context: { readonly runId: string; readonly sourceRunId?: string; readonly config?: unknown; readonly corpusCutoff?: string }): void
  /** Return a committed boundary after revalidating its hashes and event position. */
  read(boundary: Generation0Boundary): Generation0BoundaryRecord | undefined
  /** Write one fully validated boundary and make the manifest visible last. */
  commit(record: Generation0BoundaryRecord): void
  /** Leave an explicit marker before an external model call. */
  beginAttempt(marker: Generation0AttemptMarker): void
  /** Remove the marker only after the call result has been durably observed. */
  completeAttempt(attemptId: string): void
  /** Throw when an unfinished external call makes replay unsafe. */
  assertResumable(): void
}

