import assert from 'node:assert/strict'
import test from 'node:test'
import { ingestArtifact, extractDocument, validatePaperReaderOutput } from '../src/domain/index.ts'
import { assessExtraction, compareAnnotations, auditProvenance, evaluateRetrieval, knownPaperRecall, auditTemporalLeakage, evaluateConflicts, createRunSnapshot } from '../src/evaluation/index.ts'
import { EvidenceGraph, makeCoverage } from '../src/literature/index.ts'

const now = '2026-09-28T00:00:00.000Z'

test('extraction quality gate passes, warns, and fails closed', () => {
  const bytes = new TextEncoder().encode('A small paper.')
  const manifest = ingestArtifact(bytes, { paperId: 'p', originalFilename: 'p.txt', mediaType: 'text/plain', ingestionTimestamp: now })
  const document = extractDocument(manifest, bytes)
  assert.equal(assessExtraction(document).status, 'PASS')
  assert.equal(assessExtraction({ ...document, extractionWarnings: ['warning'] }).status, 'WARN')
  assert.equal(assessExtraction({ ...document, pages: [{ page: 1, text: '' }], spans: [], sections: [] }).status, 'FAIL')
})

test('partial gold matching distinguishes exact, possible, and no match', () => {
  const annotations = [{ annotationId: 'a1', type: 'problem', statement: 'A hard problem' }, { annotationId: 'a2', type: 'method', statement: 'A method' }]
  const predicted = [{ itemId: 'i1', type: 'problem', statement: 'A hard problem', confidence: 1, uncertainty: 0, locators: [], interpretation: 'MODEL_INTERPRETATION' }, { itemId: 'i2', type: 'method', statement: 'A different method', confidence: 1, uncertainty: 0, locators: [], interpretation: 'MODEL_INTERPRETATION' }]
  const metrics = compareAnnotations(annotations, predicted, (annotation, item) => annotation.type === item.type && item.statement.includes('different'))
  assert.deepEqual(metrics.matches.map(item => item.state), ['MATCH', 'POSSIBLE_MATCH'])
})

test('provenance audit detects invalid locators and interpretation confusion', () => {
  const bytes = new TextEncoder().encode('Text')
  const manifest = ingestArtifact(bytes, { paperId: 'p', originalFilename: 'p.txt', mediaType: 'text/plain', ingestionTimestamp: now })
  const document = extractDocument(manifest, bytes)
  const items = [{ itemId: 'i', type: 'claim', statement: 'claim', confidence: 1, uncertainty: 0, locators: [{ ...document.spans[0].locator, spanIndex: 99 }], interpretation: 'DIRECT_EVIDENCE' }, { itemId: 'j', type: 'claim', statement: 'interpretation', confidence: 1, uncertainty: 0, locators: [document.spans[0].locator], interpretation: 'MODEL_INTERPRETATION' }]
  const audit = auditProvenance(items, document)
  assert.equal(audit.invalidLocatorCount, 1)
  assert.equal(audit.interpretationPresentedAsEvidenceCount, 1)
})

test('retrieval, temporal leakage, conflict, and snapshot metrics are reproducible', () => {
  const old = { literatureId: 'old', title: 'Old', authors: [], year: 2020, urls: [], providerRecords: {}, retrievedAt: now }
  const future = { literatureId: 'future', title: 'Future', authors: [], year: 2025, urls: [], providerRecords: {}, retrievedAt: now }
  const coverage = makeCoverage({ queryId: 'q', provider: 'fake', query: 'topic', filters: {}, corpusCutoff: '2022-01-01', requestedLimit: 5, returnedCount: 2, examinedCount: 2, acceptedCount: 1, duplicateCount: 0, futureExcludedCount: 1, failedFetchCount: 0, timestamp: now, status: 'COMPLETE', diagnostics: [] })
  const retrieval = evaluateRetrieval({ needId: 'n', originNodeIds: [], goal: 'topic', concepts: ['topic'], constraints: [], priority: 1, reason: 'test' }, [old, future], [old], [coverage], [{ literatureId: 'old', label: 'RELEVANT' }])
  assert.equal(retrieval.precisionAt5, 0.5)
  assert.equal(knownPaperRecall([old], ['old']).foundTop5, 1)
  assert.equal(auditTemporalLeakage('2022-01-01', [old, future], [], [future]).leaks.length, 2)
  const graph = new EvidenceGraph(); graph.addClaim({ claimId: 'c', statement: 'claim', claimType: 'result', scope: 'x', uncertainty: 0 }); const evidence = { evidenceId: 'e', kind: 'abstract', claim: 'claim', polarity: 'SUPPORT', provenance: { sourceType: 'url', sourceId: 's', locator: 'a', contentHash: 'a'.repeat(64) }, claimIds: [], limitations: [], confidence: 1, createdAt: now, literatureId: 'old', evidenceLevel: 'ABSTRACT_EVIDENCE', modelInterpretation: false }; graph.addEvidence(evidence); graph.addEvidence({ ...evidence, evidenceId: 'e2', polarity: 'CONTRADICT' }); graph.linkEvidenceToClaim({ evidenceId: 'e', claimId: 'c', relation: 'SUPPORTS' }); graph.linkEvidenceToClaim({ evidenceId: 'e2', claimId: 'c', relation: 'CONTRADICTS' }); assert.equal(evaluateConflicts(graph, ['c']).queryableConflicts, 1)
  const snapshot = createRunSnapshot({ codeVersion: 'test', configuration: {}, skillVersions: ['x@1'], corpusCutoff: '2022-01-01', provider: 'fake', inputArtifacts: [new TextEncoder().encode('a')], timestamp: now }); assert.equal(snapshot.inputArtifactHashes.length, 1)
})
