import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { extractDocument, ingestArtifact, runPaperReader, validatePaperReaderOutput } from '../src/domain/index.ts'
import { runLiveCase } from '../src/coordinator/live-validation.ts'
import { parseJsonText } from '../src/adapters/responses-model.ts'

const now = '2026-09-28T00:00:00.000Z'
function fixture() {
  const bytes = new TextEncoder().encode('# Abstract\nA paper sentence.\n')
  const manifest = ingestArtifact(bytes, { paperId: 'paper_debug', originalFilename: 'paper.txt', mediaType: 'text/plain', ingestionTimestamp: now })
  return { manifest, document: extractDocument(manifest, bytes) }
}
function validOutput(document) { return { artifactId: document.artifactId, schemaVersion: 'm2.3', items: [{ itemId: 'i1', type: 'claim', statement: 'A paper sentence.', confidence: 0.8, uncertainty: 0.1, locators: [document.spans[1].locator], interpretation: 'DIRECT_EVIDENCE' }] } }

test('PaperReader contract diagnostics identify malformed envelope and field types', () => {
  const { document } = fixture(); const valid = validOutput(document)
  assert.doesNotThrow(() => validatePaperReaderOutput(valid, document))
  assert.throws(() => validatePaperReaderOutput(JSON.stringify(valid), document), /expected PaperReaderOutput, received string/)
  assert.throws(() => validatePaperReaderOutput([], document), /expected PaperReaderOutput, received array/)
  assert.throws(() => validatePaperReaderOutput({ ...valid, items: {} }, document), /\$\.items: expected array, received object/)
  assert.throws(() => validatePaperReaderOutput({ paperReader: valid }, document), /\$\.artifactId: missing required property/)
  assert.throws(() => validatePaperReaderOutput({ ...valid, items: [{ ...valid.items[0], statement: 3 }] }, document), /\$\.items\[0\]\.statement: expected string/)
  assert.throws(() => validatePaperReaderOutput({ ...valid, items: [{ ...valid.items[0], locators: [{ ...valid.items[0].locators[0], spanIndex: 99 }] }] }, document), /invalid locator|locator does not exist/)
})

test('prompt_json normalization removes one Markdown JSON fence but rejects surrounding prose', () => {
  const { document } = fixture(); const valid = validOutput(document); let seen
  const gateway = { structured: async request => { seen = request; return { ok: true, value: valid } } }
  const fenced = parseJsonText(`\`\`\`json\n${JSON.stringify(valid)}\n\`\`\``); assert.equal(fenced.ok, true); assert.equal(parseJsonText(`before ${JSON.stringify(valid)}`).ok, false)
  return runPaperReader(gateway, document, { provider: 'fake', model: 'fake' }, 'paper-reader@1', undefined, { maxSerializationRetries: 0 }).then(result => { assert.equal(result.ok, true); assert.equal(seen.inputArtifactIds[0], document.artifactId); assert.match(seen.input.locatorInstructions, /existing spanIndex/); assert.match(seen.input.paperReaderContract, /spanIndex/) })
})

test('PaperReader serialization retry preserves context and records validation errors', async () => {
  const { document } = fixture(); const valid = validOutput(document); const requests = []; const reports = []
  const gateway = { structured: async request => { requests.push(request); return requests.length === 1 ? { ok: true, value: { artifactId: document.artifactId, schemaVersion: 'm2.3', items: {} } } : { ok: true, value: valid } } }
  const result = await runPaperReader(gateway, document, { provider: 'fake', model: 'fake' }, 'paper-reader@1', { chunks: [{ chunkId: 'c1', section: 'Abstract', text: 'A paper sentence.', locators: [document.spans[1].locator], truncated: false }], omittedSpanCount: 0 }, { maxSerializationRetries: 1, onAttempt: report => reports.push(report) })
  assert.equal(result.ok, true); assert.equal(requests.length, 2); assert.equal(reports.length, 2); assert.match(reports[0].validationErrors[0], /\$\.items/); assert.deepEqual(requests[0].input.chunks, requests[1].input.chunks); assert.equal(requests[1].input.serializationRetry.validationErrors[0], reports[0].validationErrors[0])
})

test('PaperReader attaches the trusted artifactId when the model omits only that identity field', async () => {
  const { document } = fixture(); const valid = validOutput(document); const modelOutput = { schemaVersion: valid.schemaVersion, items: valid.items }
  const gateway = { structured: async () => ({ ok: true, value: modelOutput }) }
  const result = await runPaperReader(gateway, document, { provider: 'fake', model: 'fake' }, 'paper-reader@1', undefined, { maxSerializationRetries: 0 })
  assert.equal(result.ok, true)
  if (result.ok) { assert.equal(result.value.artifactId, document.artifactId); assert.deepEqual(result.value.items[0].locators, valid.items[0].locators) }
})

test('PaperReader resolves an existing spanIndex to the exact canonical locator', async () => {
  const { document } = fixture(); const canonical = document.spans[1].locator; const valid = validOutput(document); let seen
  const gateway = { structured: async request => { seen = request; return { ok: true, value: { ...valid, items: [{ ...valid.items[0], locators: [{ spanIndex: canonical.spanIndex }] }] } } } }
  const context = { chunks: [{ chunkId: 'chunk-1', section: canonical.section ?? 'Document', text: document.spans[1].text, locators: [canonical], truncated: false }], omittedSpanCount: 0 }
  const result = await runPaperReader(gateway, document, { provider: 'fake', model: 'fake' }, 'paper-reader@1', context, { maxSerializationRetries: 0 })
  assert.equal(result.ok, true); assert.deepEqual(seen.input.chunks[0].locators[0], canonical); if (result.ok) assert.deepEqual(result.value.items[0].locators[0], canonical)
})

test('PaperReader rejects altered page, section, spanIndex, and cross-artifact locator references', async () => {
  const { document } = fixture(); const canonical = document.spans[1].locator; const valid = validOutput(document)
  for (const [field, value, pattern] of [['page', canonical.page + 1, /canonical source locator/], ['section', 'fabricated section', /canonical source locator/], ['spanIndex', 999, /locator does not exist/], ['artifactId', 'artifact_other', /canonical source locator|artifact mismatch/]]) {
    const gateway = { structured: async () => ({ ok: true, value: { ...valid, items: [{ ...valid.items[0], locators: [{ spanIndex: canonical.spanIndex, [field]: value }] }] } }) }
    const result = await runPaperReader(gateway, document, { provider: 'fake', model: 'fake' }, 'paper-reader@1', undefined, { maxSerializationRetries: 0 })
    assert.equal(result.ok, false); if (!result.ok) assert.match(result.error, pattern)
  }
})

test('PaperReader rejects a model-supplied artifactId substitution', async () => {
  const { document } = fixture(); const valid = validOutput(document)
  const gateway = { structured: async () => ({ ok: true, value: { ...valid, artifactId: 'artifact_attacker_substitution' } }) }
  const result = await runPaperReader(gateway, document, { provider: 'fake', model: 'fake' }, 'paper-reader@1', undefined, { maxSerializationRetries: 1 })
  assert.equal(result.ok, false); if (!result.ok) assert.match(result.error, /does not match input artifact/)
})

test('Trusted artifactId enrichment does not hide malformed semantic content', async () => {
  const { document } = fixture(); const valid = validOutput(document)
  const gateway = { structured: async () => ({ ok: true, value: { schemaVersion: valid.schemaVersion, items: [{ ...valid.items[0], confidence: 'high' }] } }) }
  const result = await runPaperReader(gateway, document, { provider: 'fake', model: 'fake' }, 'paper-reader@1', undefined, { maxSerializationRetries: 0 })
  assert.equal(result.ok, false); if (!result.ok) assert.match(result.error, /confidence: expected finite number/)
})

test('PaperReader retry failure stays closed and never persists invalid output', async () => {
  const { document } = fixture(); const root = resolve('.tmp-paper-reader-debug'); const outputRoot = resolve(root, 'outputs'); rmSync(root, { recursive: true, force: true }); mkdirSync(resolve(root, 'papers'), { recursive: true }); const artifacts = ['paper.pdf', 'paper2.pdf', 'paper3.pdf']; for (const name of artifacts) writeFileSync(resolve(root, 'papers', name), '(A paper sentence.) Tj'); writeFileSync(resolve(root, 'case.json'), JSON.stringify({ caseId: 'debug', title: 'Debug', researchArea: 'watermarking', paperArtifacts: artifacts.map((name, index) => ({ paperId: `paper${index}`, path: `papers/${name}`, mediaType: 'application/pdf' })) }))
  const gateway = { structured: async request => ({ ok: true, value: { artifactId: request.inputArtifactIds[0], schemaVersion: 'm2.3', items: {} } }) }
  const result = await runLiveCase(resolve(root, 'case.json'), { outputRoot, stopAfter: 'PAPER_READ', gateway, preflightImpl: async () => ({ baseUrl: 'https://configured', model: 'fake', apiKeyConfigured: true, endpoint: 'https://configured/responses', reachable: true, responseSucceeded: true, normalizedText: true, structuredOutputMode: 'prompt_json', structuredOutputSupported: true }) })
  assert.equal(result.status, 'FAILED'); assert.equal(existsSync(resolve(result.outputDirectory, 'paper-reader', 'paper0.json')), false); assert.equal(existsSync(resolve(result.outputDirectory, 'paper-reader', 'failed-attempts', 'paper0', 'attempt-1', 'validation-errors.json')), true); assert.equal(existsSync(resolve(result.outputDirectory, 'paper-reader', 'failed-attempts', 'paper0', 'attempt-2', 'validation-errors.json')), true); const ledger = JSON.parse(readFileSync(resolve(result.outputDirectory, 'model-attempts.json'), 'utf8')); assert.equal(ledger.length, 2)
  rmSync(root, { recursive: true, force: true })
})
