import { createHash } from 'node:crypto'

export type Brand<T, Name extends string> = T & { readonly __brand: Name }

export type PaperId = Brand<string, 'PaperId'>
export type ArtifactId = Brand<string, 'ArtifactId'>
export type ClaimId = Brand<string, 'ClaimId'>
export type EvidenceId = Brand<string, 'EvidenceId'>
export type EvidenceLinkId = Brand<string, 'EvidenceLinkId'>
export type ProblemId = Brand<string, 'ProblemId'>
export type GraphNodeId = Brand<string, 'GraphNodeId'>
export type GraphEdgeId = Brand<string, 'GraphEdgeId'>
export type HypothesisId = Brand<string, 'HypothesisId'>
export type CriticismId = Brand<string, 'CriticismId'>
export type PriorArtReportId = Brand<string, 'PriorArtReportId'>
export type MutationEdgeId = Brand<string, 'MutationEdgeId'>
export type ReviewId = Brand<string, 'ReviewId'>
export type ExperimentDesignId = Brand<string, 'ExperimentDesignId'>
export type RunId = Brand<string, 'RunId'>
export type DomainEventId = Brand<string, 'DomainEventId'>
export type CheckpointId = Brand<string, 'CheckpointId'>

export type DomainId =
  | PaperId | ArtifactId | ClaimId | EvidenceId | EvidenceLinkId | ProblemId
  | GraphNodeId | GraphEdgeId | HypothesisId | CriticismId | PriorArtReportId
  | MutationEdgeId | ReviewId | ExperimentDesignId | RunId | DomainEventId | CheckpointId

const HASH_PATTERN = /^[a-f0-9]{64}$/
const ID_PATTERN = /^[a-z][a-z0-9_]*_[a-f0-9]{24}$/

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortJson(value))
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson)
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return Object.fromEntries(Object.keys(record).sort().map(key => [key, sortJson(record[key])]))
  }
  return value
}

export function contentHash(value: string): string {
  return sha256Hex(value)
}

export function deterministicId<T extends DomainId>(namespace: string, value: unknown): T {
  const safeNamespace = namespace.toLowerCase().replace(/[^a-z0-9_]/g, '_')
  return `${safeNamespace}_${sha256Hex(canonicalJson(value)).slice(0, 24)}` as T
}

export function isContentHash(value: string): boolean {
  return HASH_PATTERN.test(value)
}

export function isDeterministicId(value: string): boolean {
  return ID_PATTERN.test(value)
}
