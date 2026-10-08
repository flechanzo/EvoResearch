import { readFileSync } from 'node:fs'
import { extractDocument, ingestArtifact, validatePaperReaderOutput, buildProblemGraph, ProblemGraphIndex, deterministicId } from '../../src/domain/index.ts'

const bytes = readFileSync(new URL('./paper.txt', import.meta.url))
const paperId = deterministicId('paper', 'milestone2-demo')
const manifest = ingestArtifact(bytes, { paperId, originalFilename: 'paper.txt', mediaType: 'text/plain', ingestionTimestamp: '2026-09-28T00:00:00.000Z' })
const document = extractDocument(manifest, bytes)
const limitationSpan = document.spans.find(span => span.text.includes('fails'))
const reader = validatePaperReaderOutput({ artifactId: manifest.artifactId, schemaVersion: 'm2.3', items: [{ itemId: 'L1', type: 'limitation', statement: 'The method fails on noisy input.', confidence: 0.95, uncertainty: 0.05, locators: [limitationSpan.locator], interpretation: 'DIRECT_EVIDENCE' }, { itemId: 'I1', type: 'problem', statement: 'Generalization to Dataset C is an open question.', confidence: 0.7, uncertainty: 0.3, locators: [], interpretation: 'MODEL_INTERPRETATION' }] }, document)
const evidence = reader.items.map((item, index) => ({ evidenceId: `evidence_${index}`, kind: item.interpretation === 'DIRECT_EVIDENCE' ? 'quote' : 'interpretation', claim: item.statement, polarity: 'MOTIVATE', provenance: { sourceType: item.interpretation === 'DIRECT_EVIDENCE' ? 'artifact' : 'model', sourceId: manifest.artifactId, locator: item.locators[0] ? JSON.stringify(item.locators[0]) : undefined, contentHash: manifest.sha256 }, claimIds: [], limitations: [], confidence: item.confidence, createdAt: manifest.ingestionTimestamp }))
const graph = buildProblemGraph({ nodes: [{ nodeId: 'node_limitation', type: 'limitation', label: reader.items[0].statement, evidenceIds: [evidence[0].evidenceId] }, { nodeId: 'node_question', type: 'open-question', label: reader.items[1].statement, evidenceIds: [evidence[1].evidenceId] }], edges: [] }, evidence)
const index = new ProblemGraphIndex(graph, evidence)
console.log(JSON.stringify({ manifest, document, reader, provenanceReport: index.getLimitations().map(node => ({ label: node.label, evidence: index.getEvidenceForNode(node.nodeId).map(item => ({ evidenceId: item.evidenceId, artifactId: item.provenance.sourceId, locator: item.provenance.locator })) })) }, null, 2))
