import type { ArtifactManifest, ExtractedDocument } from '../domain/extraction.ts'

export interface ArtifactReader {
  ingest(bytes: Uint8Array, metadata: { paperId: string; originalFilename: string; mediaType: string; ingestionTimestamp: string; parserVersion?: string }): ArtifactManifest
  extract(manifest: ArtifactManifest, bytes: Uint8Array): ExtractedDocument
}
