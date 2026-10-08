import assert from 'node:assert/strict'
import test from 'node:test'
import { buildProblemGraph, runProblemExtractor, validateProblemExtractorOutput } from '../src/domain/index.ts'

const reader = { artifactId: 'artifact_problem_test', schemaVersion: 'm2.3', items: [] }
const valid = {
  nodes: [{ nodeId: 'node_problem', type: 'problem', label: 'A deployment problem', evidenceIds: [] }],
  edges: [],
}
const observedLiveShape = { artifactId: reader.artifactId, schemaVersion: 'm2.4', items: [{ itemId: 'problem-1', type: 'problem', statement: 'sanitized PaperReader item', confidence: 0.99, uncertainty: 0.01, locators: [], interpretation: 'DIRECT_EVIDENCE' }] }

test('ProblemExtractor accepts the exact nodes and edges envelope', () => {
  assert.deepEqual(validateProblemExtractorOutput(valid), valid)
})

test('the observed PaperReader-shaped live output fails with the precise missing nodes path', async () => {
  assert.throws(() => validateProblemExtractorOutput(observedLiveShape), /\$\.nodes: missing required property/)
  const annotations = []
  const result = await runProblemExtractor({ structured: async () => ({ ok: true, value: observedLiveShape }), annotateAttempt: (_attemptId, patch) => annotations.push(patch) }, reader, { provider: 'fake', model: 'fake' }, 'problem-extractor@1', { maxSerializationRetries: 0 })
  assert.equal(result.ok, false)
  if (!result.ok) assert.equal(result.error, '$.nodes: missing required property')
  assert.equal(annotations[0].schemaValidationStatus, 'failure')
  assert.deepEqual(annotations[0].validationErrors, ['$.nodes: missing required property'])
})

test('ProblemExtractor retries one structural failure with the same validated PaperReader input', async () => {
  const requests = []; const retries = []
  const gateway = { structured: async request => { requests.push(request); return requests.length === 1 ? { ok: true, value: observedLiveShape } : { ok: true, value: valid } } }
  const result = await runProblemExtractor(gateway, reader, { provider: 'fake', model: 'fake' }, 'problem-extractor@1', { maxSerializationRetries: 1, onSerializationRetry: (attempt, errors) => retries.push({ attempt, errors }) })
  assert.equal(result.ok, true)
  assert.equal(requests.length, 2)
  assert.deepEqual(requests[0].input.paperReaderOutput, reader)
  assert.deepEqual(requests[1].input.paperReaderOutput, reader)
  assert.equal(requests[1].input.serializationRetry.validationErrors[0], '$.nodes: missing required property')
  assert.equal(retries.length, 1)
})

test('irrecoverably malformed ProblemExtractor output remains closed and bounded', async () => {
  const requests = []
  const gateway = { structured: async request => { requests.push(request); return { ok: true, value: observedLiveShape } } }
  const result = await runProblemExtractor(gateway, reader, { provider: 'fake', model: 'fake' }, 'problem-extractor@1', { maxSerializationRetries: 1 })
  assert.equal(result.ok, false); assert.equal(requests.length, 2)
  if (!result.ok) assert.equal(result.error, '$.nodes: missing required property')
})

test('ProblemExtractor rejects missing node fields, invalid types, relations, and malformed edges', () => {
  assert.throws(() => validateProblemExtractorOutput({ nodes: [{ ...valid.nodes[0], label: undefined }], edges: [] }), /\$\.nodes\[0\]\.label: expected non-empty string/)
  assert.throws(() => validateProblemExtractorOutput({ nodes: [{ ...valid.nodes[0], type: 'invented' }], edges: [] }), /\$\.nodes\[0\]\.type: expected supported graph node type/)
  assert.throws(() => validateProblemExtractorOutput({ nodes: valid.nodes, edges: [{ edgeId: 'edge_1', from: 'node_problem', to: 'node_problem', relation: 'RELATES', evidenceIds: [] }] }), /\$\.edges\[0\]\.relation: expected supported graph relation/)
  assert.throws(() => validateProblemExtractorOutput({ nodes: valid.nodes, edges: [{ edgeId: 'edge_1', from: 'node_problem', to: 'node_problem', relation: 'USES', evidenceIds: 'evidence_1' }] }), /\$\.edges\[0\]\.evidenceIds: expected array, received string/)
})

test('dangling graph references remain rejected by ProblemGraph validation, not silently repaired', () => {
  const dangling = { nodes: valid.nodes, edges: [{ edgeId: 'edge_1', from: 'node_problem', to: 'missing_node', relation: 'USES', evidenceIds: [] }] }
  assert.doesNotThrow(() => validateProblemExtractorOutput(dangling))
  assert.throws(() => buildProblemGraph(dangling, []), /edge references unknown node/)
})

test('ProblemExtractor preserves supplied provenance IDs and does not synthesize them', async () => {
  const output = { nodes: [{ ...valid.nodes[0], evidenceIds: [] }], edges: [] }
  const result = await runProblemExtractor({ structured: async request => ({ ok: true, value: output }) }, reader, { provider: 'fake', model: 'fake' }, 'problem-extractor@1', { maxSerializationRetries: 0 })
  assert.equal(result.ok, true)
  if (result.ok) assert.deepEqual(result.value.nodes[0].evidenceIds, [])
})

test('ProblemExtractor accepts only supplied paper-local evidence IDs', async () => {
  const evidenceId = 'evidence_real'
  const output = { nodes: [{ ...valid.nodes[0], evidenceIds: [evidenceId] }], edges: [] }
  const requests = []
  const result = await runProblemExtractor({ structured: async request => { requests.push(request); return { ok: true, value: output } } }, reader, { provider: 'fake', model: 'fake' }, 'problem-extractor@1', { maxSerializationRetries: 0, availableEvidenceIds: [evidenceId], evidenceReferences: [{ itemId: 'problem-1', evidenceId }] })
  assert.equal(result.ok, true)
  assert.deepEqual(requests[0].input.availableEvidenceIds, [evidenceId])
  assert.deepEqual(requests[0].input.evidenceReferences, [{ itemId: 'problem-1', evidenceId }])
  assert.deepEqual(requests[0].inputEvidenceIds, [evidenceId])
})

test('ProblemExtractor rejects PaperReader item IDs used as graph evidence provenance', async () => {
  const output = { nodes: [{ ...valid.nodes[0], evidenceIds: ['problem-1'] }], edges: [] }
  const result = await runProblemExtractor({ structured: async () => ({ ok: true, value: output }) }, reader, { provider: 'fake', model: 'fake' }, 'problem-extractor@1', { maxSerializationRetries: 0, availableEvidenceIds: ['evidence_real'] })
  assert.equal(result.ok, false)
  if (!result.ok) {
    assert.equal(result.error, '$.nodes[0].evidenceIds[0]: evidence reference does not exist')
    assert.equal(result.failureKind, 'SCHEMA')
  }
})

test('trusted evidence IDs survive graph construction and foreign IDs fail closed', () => {
  const output = { nodes: [{ ...valid.nodes[0], evidenceIds: ['evidence_real'] }], edges: [] }
  assert.doesNotThrow(() => buildProblemGraph(output, [{ evidenceId: 'evidence_real' }]))
  assert.throws(() => buildProblemGraph(output, [{ evidenceId: 'evidence_other' }]), /graph node references missing evidence/)
})
