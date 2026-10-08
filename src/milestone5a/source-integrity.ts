import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { canonicalJson, contentHash } from '../domain/ids.ts'
import type { ArtifactManifest, Evidence } from '../domain/index.ts'

export interface M5AArtifactIntegrity {
  readonly artifactId: string
  readonly path?: string
  readonly exists: boolean
  readonly byteSizeMatches: boolean
  readonly hashMatches: boolean
}

export interface M5AEvidenceIntegrity {
  readonly evidenceId: string
  readonly sourceTextVerified: boolean
  readonly reason: string
  readonly literatureId?: string
}

export interface M5ASourceIntegrityResult {
  readonly sourceFiles: Readonly<Record<string, string>>
  readonly artifactChecks: readonly M5AArtifactIntegrity[]
  readonly evidenceChecks: readonly M5AEvidenceIntegrity[]
  readonly eligibleScientificEvidenceIds: readonly string[]
  readonly limitations: readonly string[]
}

function json(path: string): any { return JSON.parse(readFileSync(path, 'utf8')) }
function fileHash(value: unknown): string { return contentHash(canonicalJson(value)) }

/**
 * Verify identities and the source material that is actually persisted in an
 * imported M3.5C run. This intentionally reads PDF bytes only for manifest
 * identity; it never parses a PDF or calls a provider. Abstract evidence can
 * be checked against the saved literature abstract. PaperReader seed records
 * have no saved source text and therefore remain unverified.
 */
export function inspectM5ASourceRun(directory: string): M5ASourceIntegrityResult {
  const root = resolve(directory)
  const sourceFiles: Record<string, string> = {}
  const addJson = (name: string): any | undefined => {
    const path = resolve(root, name)
    if (!existsSync(path)) return undefined
    const value = json(path); sourceFiles[name] = fileHash(value); return value
  }
  const ingest = (addJson('ingest.json') ?? []) as ArtifactManifest[]
  const evidence = (addJson('evidence.json') ?? []) as (Evidence & Record<string, unknown>)[]
  const literature = (addJson('literature-records.json') ?? []) as Record<string, unknown>[]
  for (const name of ['problem-graph.json', 'claims.json', 'evidence-graph.json', 'evaluation-report.json', 'evidence-plan.json', 'run-snapshot.json', 'stage-state.json']) addJson(name)
  const artifactChecks = ingest.map(manifest => {
    const path = manifest.localPath && resolve(manifest.localPath)
    const exists = Boolean(path && existsSync(path))
    if (!exists) return { artifactId: String(manifest.artifactId), path, exists: false, byteSizeMatches: false, hashMatches: false }
    const bytes = readFileSync(path!)
    return { artifactId: String(manifest.artifactId), path, exists: true, byteSizeMatches: bytes.byteLength === manifest.byteSize, hashMatches: contentHash(new TextDecoder('latin1').decode(bytes)) === manifest.sha256 }
  })
  const literatureById = new Map(literature.map(item => [String(item.literatureId), item]))
  const evidenceChecks = evidence.map(item => {
    const provenance = item.provenance as unknown as Record<string, unknown> | undefined
    const literatureId = typeof item.literatureId === 'string' ? item.literatureId : undefined
    const record = literatureId ? literatureById.get(literatureId) : undefined
    const quotedText = typeof provenance?.quotedText === 'string' ? provenance.quotedText : ''
    const abstract = typeof record?.abstract === 'string' ? record.abstract : ''
    const verified = item.modelInterpretation !== true && item.evidenceLevel === 'ABSTRACT_EVIDENCE' && Boolean(quotedText && abstract.includes(quotedText) && provenance?.contentHash === contentHash(abstract))
    return { evidenceId: String(item.evidenceId), literatureId, sourceTextVerified: verified, reason: verified ? 'saved literature abstract contains the quote and matches its persisted content hash' : literatureId ? 'saved source text did not independently verify this evidence' : 'no persisted source text is available for this PaperReader record' }
  })
  const limitations: string[] = []
  if (artifactChecks.some(item => !item.exists || !item.byteSizeMatches || !item.hashMatches)) limitations.push('One or more ingest artifact identities could not be verified against the saved local bytes.')
  if (evidenceChecks.some(item => !item.sourceTextVerified)) limitations.push('Unverified PaperReader seed evidence remains provenance-labeled but is excluded from direct scientific evidence qualification.')
  return { sourceFiles, artifactChecks, evidenceChecks, eligibleScientificEvidenceIds: evidenceChecks.filter(item => item.sourceTextVerified).map(item => item.evidenceId).sort(), limitations }
}
