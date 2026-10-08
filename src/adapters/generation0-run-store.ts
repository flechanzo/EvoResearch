import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { canonicalJson, contentHash } from '../domain/ids.ts'
import { parseCheckpoint, parseDomainEvent } from '../domain/validation.ts'
import type { Checkpoint, DomainEvent } from '../domain/types.ts'
import type { Generation0AttemptMarker, Generation0Boundary, Generation0BoundaryRecord, Generation0RunStore } from '../ports/generation0-run-store.ts'

interface Manifest {
  readonly schemaVersion: 'generation0.run.v1'
  readonly runId: string
  readonly sourceRunId?: string
  readonly configHash?: string
  readonly corpusCutoff?: string
  readonly boundaries: Partial<Record<Generation0Boundary, { readonly file: string; readonly stateHash: string; readonly checkpointId: string; readonly sequence: number }>>
}

function json(path: string): unknown { return JSON.parse(readFileSync(path, 'utf8')) }
function hashState(state: unknown): string { return contentHash(canonicalJson(state)) }
function assertTime(value: string | undefined, path: string): void { if (value !== undefined && (typeof value !== 'string' || Number.isNaN(Date.parse(value)))) throw new Error(`${path} must be an ISO timestamp`) }
function assertSequence(events: readonly DomainEvent[], checkpoint: Checkpoint, runId: string): void {
  if (events.length !== checkpoint.sequence || events.some((event, index) => event.sequence !== index + 1 || event.runId !== runId)) throw new Error('RUNSTORE_EVENT_SEQUENCE_MISMATCH: events must be contiguous through checkpoint')
  if (new Set(events.map(event => event.eventId)).size !== events.length) throw new Error('RUNSTORE_EVENT_ID_MISMATCH: event IDs must be unique')
  if (events.some((event, index) => index > 0 && event.sequence <= events[index - 1].sequence)) throw new Error('RUNSTORE_EVENT_SEQUENCE_MISMATCH: events are not ordered')
  const last = events.at(-1)
  if (!last || last.type !== 'checkpoint.created' || last.payload.checkpointId !== checkpoint.checkpointId || last.payload.stateHash !== checkpoint.stateHash) throw new Error('RUNSTORE_CHECKPOINT_MISMATCH: final event must commit checkpoint')
}
function assertRecord(record: Generation0BoundaryRecord): void {
  if (record.schemaVersion !== 'generation0.boundary.v1') throw new Error('RUNSTORE_SCHEMA_MISMATCH: unsupported boundary schema')
  if (!record.runId || !record.boundary) throw new Error('RUNSTORE_IDENTITY_MISSING: runId and boundary are required')
  assertTime(record.corpusCutoff, '$.corpusCutoff'); assertTime(record.committedAt, '$.committedAt')
  if (hashState(record.state) !== record.stateHash || record.checkpoint.stateHash !== record.stateHash) throw new Error('RUNSTORE_HASH_MISMATCH: state does not match checkpoint')
  parseCheckpoint(record.checkpoint)
  if (record.checkpoint.runId !== record.runId) throw new Error('RUNSTORE_IDENTITY_MISMATCH: checkpoint runId differs from boundary')
  const events = record.events.map(parseDomainEvent)
  assertSequence(events, record.checkpoint, record.runId)
}

/** Small filesystem adapter for Generation-0 only. Each boundary file is written
 * through a temp file and renamed before manifest.json is replaced as the commit. */
export class FileGeneration0RunStore implements Generation0RunStore {
  private readonly root: string
  private readonly manifestPath: string
  private readonly pendingPath: string
  constructor(directory: string) { this.root = resolve(directory); this.manifestPath = resolve(this.root, 'generation0-manifest.json'); this.pendingPath = resolve(this.root, 'generation0-attempt.pending.json') }
  private readManifest(): Manifest | undefined { return existsSync(this.manifestPath) ? json(this.manifestPath) as Manifest : undefined }
  private atomic(path: string, value: unknown): void { mkdirSync(this.root, { recursive: true }); const temp = `${path}.${randomUUID()}.tmp`; writeFileSync(temp, JSON.stringify(value, null, 2), 'utf8'); renameSync(temp, path) }
  open(context: { readonly runId: string; readonly sourceRunId?: string; readonly config?: unknown; readonly corpusCutoff?: string }): void {
    if (!context.runId) throw new Error('RUNSTORE_IDENTITY_MISSING: runId is required')
    assertTime(context.corpusCutoff, '$.corpusCutoff')
    const configHash = context.config === undefined ? undefined : hashState(context.config)
    const prior = this.readManifest()
    if (prior) {
      if (prior.schemaVersion !== 'generation0.run.v1' || prior.runId !== context.runId || prior.sourceRunId !== context.sourceRunId || prior.configHash !== configHash || prior.corpusCutoff !== context.corpusCutoff) throw new Error('RUNSTORE_IDENTITY_MISMATCH: immutable run metadata changed')
    } else this.atomic(this.manifestPath, { schemaVersion: 'generation0.run.v1', runId: context.runId, ...(context.sourceRunId ? { sourceRunId: context.sourceRunId } : {}), ...(configHash ? { configHash } : {}), ...(context.corpusCutoff ? { corpusCutoff: context.corpusCutoff } : {}), boundaries: {} } satisfies Manifest)
    this.assertResumable()
  }
  read(boundary: Generation0Boundary): Generation0BoundaryRecord | undefined {
    const manifest = this.readManifest(); const pointer = manifest?.boundaries?.[boundary]
    if (!pointer) return undefined
    const expectedFile = `generation0-${boundary.toLowerCase()}.json`
    if (pointer.file !== expectedFile) throw new Error('RUNSTORE_MANIFEST_MISMATCH: boundary file pointer is invalid')
    const record = json(resolve(this.root, pointer.file)) as Generation0BoundaryRecord
    if (record.runId !== manifest.runId || record.sourceRunId !== manifest.sourceRunId || record.configHash !== manifest.configHash || record.corpusCutoff !== manifest.corpusCutoff || record.boundary !== boundary || record.stateHash !== pointer.stateHash || record.checkpoint.checkpointId !== pointer.checkpointId || record.checkpoint.sequence !== pointer.sequence) throw new Error('RUNSTORE_MANIFEST_MISMATCH: boundary pointer does not match record')
    assertRecord(record); return record
  }
  commit(record: Generation0BoundaryRecord): void {
    assertRecord(record)
    const manifest = this.readManifest(); if (!manifest || manifest.runId !== record.runId) throw new Error('RUNSTORE_IDENTITY_MISMATCH: store is not opened for run')
    if (manifest.sourceRunId !== record.sourceRunId) throw new Error('RUNSTORE_IDENTITY_MISMATCH: sourceRunId changed')
    if (manifest.configHash !== record.configHash || manifest.corpusCutoff !== record.corpusCutoff) throw new Error('RUNSTORE_IDENTITY_MISMATCH: config or corpus cutoff changed')
    const prior = manifest.boundaries?.[record.boundary]
    if (prior && (prior.stateHash !== record.stateHash || prior.checkpointId !== record.checkpoint.checkpointId || prior.sequence !== record.checkpoint.sequence)) throw new Error('RUNSTORE_BOUNDARY_IMMUTABLE: committed boundary cannot be replaced')
    const file = `generation0-${record.boundary.toLowerCase()}.json`; this.atomic(resolve(this.root, file), record)
    const next: Manifest = { ...manifest, boundaries: { ...manifest.boundaries, [record.boundary]: { file, stateHash: record.stateHash, checkpointId: record.checkpoint.checkpointId, sequence: record.checkpoint.sequence } } }
    // Manifest is intentionally replaced last; a crash before this point leaves
    // an unreferenced boundary file that cannot be mistaken for a commit.
    this.atomic(this.manifestPath, next)
    // A result is replay-safe only after the manifest commit is visible. If the
    // process dies before this unlink, assertResumable() reports UNKNOWN and
    // prevents an external call from being repeated silently.
    if (existsSync(this.pendingPath)) unlinkSync(this.pendingPath)
  }
  beginAttempt(marker: Generation0AttemptMarker): void { this.assertResumable(); this.atomic(this.pendingPath, marker) }
  completeAttempt(attemptId: string): void { if (!existsSync(this.pendingPath)) return; const marker = json(this.pendingPath) as Generation0AttemptMarker; if (marker.attemptId !== attemptId) throw new Error('RUNSTORE_ATTEMPT_MISMATCH: pending attempt differs'); unlinkSync(this.pendingPath) }
  assertResumable(): void { if (existsSync(this.pendingPath)) throw new Error('INTERRUPTED/UNKNOWN: external Generation-0 attempt was not durably committed; replay is fail-closed') }
}

