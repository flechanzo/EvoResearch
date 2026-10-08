import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { ingestArtifact, extractDocument } from '../../src/domain/index.ts'
import { assessExtraction } from '../../src/evaluation/index.ts'
const casePath = resolve(process.argv[2]); const spec = JSON.parse(readFileSync(casePath, 'utf8')); const root = dirname(casePath); const results = []
for (const artifact of spec.paperArtifacts) { const bytes = readFileSync(resolve(root, artifact.path)); const manifest = ingestArtifact(bytes, { paperId: artifact.paperId, originalFilename: artifact.path.split(/[\\/]/).pop(), mediaType: artifact.mediaType, ingestionTimestamp: new Date().toISOString() }); const document = extractDocument(manifest, bytes); const quality = assessExtraction(document); results.push({ paperId: artifact.paperId, manifest, quality, downstreamBlocked: quality.status === 'FAIL' }) }
console.log(JSON.stringify({ caseId: spec.caseId, corpusCutoff: spec.corpusCutoff || undefined, results }, null, 2))
