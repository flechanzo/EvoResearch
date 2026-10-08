import assert from 'node:assert/strict'
import test from 'node:test'

import { deterministicId } from '../src/domain/ids.ts'
import { extractDocument, ingestArtifact } from '../src/domain/extraction.ts'
import { createOfflineMockModelGateway } from '../src/milestone5a/offline-mock.ts'
import { replayM5AArtifacts, runM5AVerticalSlice } from '../src/milestone5a/adapter.ts'

const now = '2026-10-10T00:00:00.000Z'

function fixture(responses = {}) {
  const bytes = new TextEncoder().encode('# Abstract\nA method addresses the boundary failure.\n# Method\nA bounded method.\n')
  const artifact = ingestArtifact(bytes, { paperId: 'paper_m5a', originalFilename: 'paper.txt', mediaType: 'text/plain', ingestionTimestamp: now })
  const document = extractDocument(artifact, bytes)
  const gateway = createOfflineMockModelGateway(responses)
  return { artifact, document, gateway, input: { artifact, document, gateway, route: { provider: 'offline', model: 'mock' }, now, maxSerializationRetries: 0 } }
}

function validResponses(document, { unsupportedEvidence = false } = {}) {
  const locator = document.spans[0].locator
  const evidenceId = deterministicId('evidence', { artifactId: document.artifactId, itemId: 'item-problem' })
  return {
    PaperReader: { artifactId: document.artifactId, schemaVersion: 'm2.3', items: [
      { itemId: 'item-problem', type: 'problem', statement: 'A boundary failure is observed.', confidence: 0.9, uncertainty: 0.1, locators: [locator], interpretation: 'DIRECT_EVIDENCE' },
      { itemId: 'item-interpretation', type: 'open-question', statement: 'The mechanism remains unresolved.', confidence: 0.6, uncertainty: 0.4, locators: [], interpretation: 'MODEL_INTERPRETATION' },
    ] },
    ProblemExtractor: { nodes: [{ nodeId: 'problem', type: 'problem', label: 'Boundary failure', evidenceIds: [unsupportedEvidence ? 'evidence_foreign' : evidenceId] }, { nodeId: 'method', type: 'method', label: 'Bounded method', evidenceIds: [] }], edges: [{ edgeId: 'edge', from: 'problem', to: 'method', relation: 'PROPOSES', evidenceIds: [unsupportedEvidence ? 'evidence_foreign' : evidenceId] }] },
  }
}

test('malformed model JSON is rejected as a failed PaperReader attempt without artifacts', async () => {
  const { input, gateway } = fixture({ PaperReader: '{not-json' })
  const result = await runM5AVerticalSlice(input)
  assert.equal(result.ok, false)
  if (!result.ok) { assert.equal(result.failedRole, 'PaperReader'); assert.ok(result.attempts.some(attempt => attempt.status === 'FAILED')); assert.equal('value' in result, false) }
  assert.equal(gateway.calls.length, 1)
})

test('direct evidence without a canonical locator is rejected', async () => {
  const first = fixture()
  const response = { schemaVersion: 'm2.3', items: [{ itemId: 'item', type: 'claim', statement: 'Unsupported direct claim.', confidence: 0.8, uncertainty: 0.2, locators: [], interpretation: 'DIRECT_EVIDENCE' }] }
  const gateway = createOfflineMockModelGateway({ PaperReader: response })
  const result = await runM5AVerticalSlice({ ...first.input, gateway })
  assert.equal(result.ok, false)
  if (!result.ok) assert.match(result.error, /locator/i)
  assert.equal(gateway.calls.length, 1)
})

test('unsupported graph evidence references are rejected before graph mutation', async () => {
  const first = fixture()
  const gateway = createOfflineMockModelGateway(validResponses(first.document, { unsupportedEvidence: true }))
  const result = await runM5AVerticalSlice({ ...first.input, gateway })
  assert.equal(result.ok, false)
  if (!result.ok) { assert.equal(result.failedRole, 'ProblemExtractor'); assert.match(result.error, /evidence reference|does not exist|missing evidence/i); assert.equal('value' in result, false) }
  assert.equal(gateway.calls.length, 2)
})

test('valid model-backed extraction is accepted with explicit interpretation provenance', async () => {
  const first = fixture()
  const responses = validResponses(first.document)
  const gateway = createOfflineMockModelGateway(responses)
  const run = await runM5AVerticalSlice({ ...first.input, gateway })
  assert.equal(run.ok, true)
  if (run.ok) {
    assert.equal(run.value.problemGraph.nodes.length, 2)
    assert.ok(run.value.paperRepresentation.sections.length > 0)
    assert.equal(run.value.paperRepresentation.problems.length, 1)
    assert.equal(run.value.paperRepresentation.openQuestions.length, 1)
    const interpretation = run.value.evidence.find(item => item.modelInterpretation === true)
    assert.equal(interpretation.evidenceLevel, 'MODEL_INTERPRETATION')
    assert.equal(interpretation.provenance.sourceType, 'model')
    assert.equal(run.value.checkpoint.budget.usage.maxModelCalls, 2)
    assert.equal(run.value.events.length, 1)
    assert.equal(gateway.calls[0].role, 'PaperReader')
    assert.equal(gateway.calls[0].outputSchema, 'PaperReaderOutput')
    assert.ok(gateway.calls[0].input.chunks)
    assert.equal(gateway.calls[1].role, 'ProblemExtractor')
    assert.deepEqual(gateway.calls[1].inputEvidenceIds, run.value.evidence.map(item => item.evidenceId))
  }
})

test('replay validates persisted outputs without another model call', async () => {
  const first = fixture()
  const gateway = createOfflineMockModelGateway(validResponses(first.document))
  const run = await runM5AVerticalSlice({ ...first.input, gateway })
  assert.equal(run.ok, true)
  if (run.ok) {
    const calls = gateway.calls.length
    const replay = replayM5AArtifacts(run.value, first.document)
    assert.deepEqual(replay, run.value)
    assert.equal(gateway.calls.length, calls)
  }
})

