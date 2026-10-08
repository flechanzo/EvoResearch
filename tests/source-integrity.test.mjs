import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import test from 'node:test'
import { ingestArtifact } from '../src/domain/extraction.ts'
import { contentHash, deterministicId } from '../src/domain/ids.ts'
import { inspectM5ASourceRun } from '../src/milestone5a/source-integrity.ts'

test('saved abstract evidence is verified while unpersisted reader text is excluded', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'evoresearch-source-integrity-'))
  try {
    const bytes = new TextEncoder().encode('local source')
    const paperPath = resolve(root, 'paper.txt'); writeFileSync(paperPath, bytes)
    const manifest = ingestArtifact(bytes, { paperId: 'paper_fixture', originalFilename: 'paper.txt', mediaType: 'text/plain', ingestionTimestamp: '2026-10-10T00:00:00.000Z', localPath: paperPath })
    const literatureId = deterministicId('literature', 'source-integrity-fixture')
    const evidenceId = deterministicId('evidence', 'source-integrity-fixture')
    const claimId = deterministicId('claim', 'source-integrity-fixture')
    const abstract = 'The saved abstract contains this exact sentence.'
    writeFileSync(resolve(root, 'ingest.json'), JSON.stringify([manifest]))
    writeFileSync(resolve(root, 'evidence.json'), JSON.stringify([{ evidenceId, kind: 'quote', claim: 'claim', polarity: 'SUPPORT', provenance: { sourceType: 'url', sourceId: literatureId, locator: 'Abstract', quotedText: 'The saved abstract contains this exact sentence.', contentHash: contentHash(abstract) }, claimIds: [claimId], limitations: [], confidence: 0.8, createdAt: '2026-10-10T00:00:00.000Z', literatureId, evidenceLevel: 'ABSTRACT_EVIDENCE', modelInterpretation: false }]))
    writeFileSync(resolve(root, 'literature-records.json'), JSON.stringify([{ literatureId, abstract }]))
    const result = inspectM5ASourceRun(root)
    assert.equal(result.artifactChecks[0].hashMatches, true)
    assert.deepEqual(result.eligibleScientificEvidenceIds, [evidenceId])
    assert.equal(result.evidenceChecks[0].sourceTextVerified, true)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
