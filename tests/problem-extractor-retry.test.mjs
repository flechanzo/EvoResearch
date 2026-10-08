import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { contentHash, runProblemExtractor } from '../src/domain/index.ts'
import { ResponsesModelGateway } from '../src/adapters/responses-model.ts'
import { runLiveCase } from '../src/coordinator/live-validation.ts'

// Synthetic immutable syntax regression; no historical run is read or modified.
const malformed = readFileSync(new URL('./fixtures/problem-extractor/missing-edge-id.txt', import.meta.url), 'utf8')
const valid = { nodes: [{ nodeId: 'problem', type: 'problem', label: 'A deployment problem', evidenceIds: [] }], edges: [] }
const validText = JSON.stringify(valid)
const schemaInvalidText = JSON.stringify({ nodes: [], edges: [{ from: 'problem' }] })
const reader = { artifactId: 'artifact_problem_retry', schemaVersion: 'm2.3', items: [] }
const route = { provider: 'fake', model: 'fake' }

function streamText(text) {
  const events = [
    ['response.output_text.delta', { delta: text }],
    ['response.completed', { response: { status: 'completed' } }],
  ]
  return new Response(events.map(([type, data]) => `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`).join(''), {
    status: 200, headers: { 'content-type': 'text/event-stream' },
  })
}

function cannedGateway(respond) {
  const requests = []
  const gateway = new ResponsesModelGateway({
    baseUrl: 'https://offline.invalid', apiKey: 'offline-fake', model: 'fake',
    streaming: 'required', structuredOutputMode: 'prompt_json', maxRetries: 0,
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body)
      assert.equal(body.stream, true)
      assert.equal(Object.hasOwn(body, 'text'), false)
      const request = JSON.parse(body.input.find(message => message.role === 'user').content[0].text)
      requests.push(request)
      return respond(request, requests.length)
    },
  })
  return { gateway, requests }
}

function sequence(texts) {
  return cannedGateway((_request, call) => {
    assert.ok(call <= texts.length, 'no unexpected extra model invocation')
    return streamText(texts[call - 1])
  })
}

test('ProblemExtractor retries the forensic JSON syntax shape and accepts only a valid second attempt', async () => {
  assert.throws(() => JSON.parse(malformed), /Expected ':' after property name/)
  const { gateway, requests } = sequence([malformed, validText])
  const retries = []
  const result = await runProblemExtractor(gateway, reader, route, 'problem-extractor@1', {
    maxSerializationRetries: 1, onSerializationRetry: (attempt, errors) => retries.push({ attempt, errors }),
  })
  assert.equal(result.ok, true)
  assert.deepEqual(result.value, valid)
  assert.equal(requests.length, 2)
  assert.equal(retries.length, 1)
  const [first, second] = gateway.attempts
  assert.notEqual(first.attemptId, second.attemptId)
  assert.equal(result.request.attemptId, second.attemptId)
  assert.equal(first.terminalObserved, true)
  assert.equal(first.status, 'FAILED')
  assert.equal(first.parseStatus, 'failure')
  assert.equal(first.schemaValidationStatus, 'not-attempted')
  assert.equal(first.errorCategory, 'INVALID_RESPONSE')
  assert.equal(first.retryable, true)
  assert.equal(first.normalizedTextPreview, malformed)
  assert.equal(first.normalizedTextHash, contentHash(malformed))
  assert.equal(first.rawResponseHash, first.normalizedTextHash)
  assert.equal(second.terminalObserved, true)
  assert.equal(second.parseStatus, 'success')
  assert.equal(second.schemaValidationStatus, 'success')
  assert.equal(second.status, 'SUCCEEDED')
  assert.equal(second.normalizedTextHash, contentHash(validText))
  assert.match(retries[0].errors[0], /^invalid model JSON:/)
  assert.equal(retries[0].attempt, 1)
  const { serializationRetry, ...retryBaseInput } = requests[1].data
  assert.deepEqual(retryBaseInput, requests[0].data)
  assert.deepEqual(serializationRetry.validationErrors, retries[0].errors)
  assert.deepEqual(requests[1].data.paperReaderOutput, reader)
})

for (const [label, secondText, failureKind, parseStatus, schemaStatus] of [
  ['parse-invalid', malformed, 'SERIALIZATION', 'failure', 'not-attempted'],
  ['schema-invalid', schemaInvalidText, 'SCHEMA', 'success', 'failure'],
]) {
  test(`ProblemExtractor parse-invalid then ${label} exhausts the one shared serialization retry`, async () => {
    const { gateway, requests } = sequence([malformed, secondText])
    let retries = 0
    const result = await runProblemExtractor(gateway, reader, route, 'problem-extractor@1', {
      maxSerializationRetries: 1, onSerializationRetry: () => { retries++ },
    })
    assert.equal(result.ok, false)
    assert.equal(result.failureKind, failureKind)
    assert.equal(Object.hasOwn(result, 'value'), false)
    assert.equal(requests.length, 2)
    assert.equal(retries, 1)
    assert.equal(gateway.attempts.length, 2)
    assert.equal(gateway.attempts[0].schemaValidationStatus, 'not-attempted')
    assert.equal(gateway.attempts[1].parseStatus, parseStatus)
    assert.equal(gateway.attempts[1].schemaValidationStatus, schemaStatus)
    assert.equal(gateway.attempts[1].status, 'FAILED')
    assert.equal(gateway.attempts[1].retryable, false)
  })
}

test('ProblemExtractor schema-invalid then parse-invalid also shares the same retry limit', async () => {
  const { gateway, requests } = sequence([schemaInvalidText, malformed])
  const result = await runProblemExtractor(gateway, reader, route)
  assert.equal(result.ok, false)
  assert.equal(result.failureKind, 'SERIALIZATION')
  assert.equal(requests.length, 2)
  assert.equal(gateway.attempts[0].errorCategory, 'SCHEMA_VALIDATION_FAILURE')
  assert.equal(gateway.attempts[0].retryable, true)
  assert.equal(gateway.attempts[1].errorCategory, 'INVALID_RESPONSE')
  assert.equal(gateway.attempts[1].retryable, false)
})

test('ProblemExtractor valid initial JSON causes no retry', async () => {
  const { gateway, requests } = sequence([validText])
  const result = await runProblemExtractor(gateway, reader, route, 'problem-extractor@1', {
    onSerializationRetry: () => assert.fail('valid output must not retry'),
  })
  assert.equal(result.ok, true)
  assert.equal(requests.length, 1)
  assert.equal(gateway.attempts[0].schemaValidationStatus, 'success')
})

test('ProblemExtractor rejects malformed JSON without retry when allowance is zero', async () => {
  const { gateway, requests } = sequence([malformed])
  const result = await runProblemExtractor(gateway, reader, route, 'problem-extractor@1', {
    maxSerializationRetries: 0, onSerializationRetry: () => assert.fail('zero allowance must not retry'),
  })
  assert.equal(result.ok, false)
  assert.equal(result.failureKind, 'SERIALIZATION')
  assert.equal(requests.length, 1)
  assert.equal(gateway.attempts[0].retryable, false)
  assert.equal(gateway.attempts[0].schemaValidationStatus, 'not-attempted')
})

test('ProblemExtractor provider, network, and malformed-stream failures do not use serialization retries', async () => {
  const failures = [
    () => new Response('busy', { status: 503 }),
    () => new Response('rate limited', { status: 429 }),
    () => { throw new Error('offline simulated network error') },
    () => new Response('event: response.output_text.delta\ndata: {bad\n\n', { headers: { 'content-type': 'text/event-stream' } }),
    () => new Response('event: response.failed\ndata: {"error":{"code":"server_error","message":"invalid model JSON in provider message"}}\n\n', { headers: { 'content-type': 'text/event-stream' } }),
  ]
  for (const fail of failures) {
    const { gateway, requests } = cannedGateway(fail)
    const result = await runProblemExtractor(gateway, reader, route, 'problem-extractor@1', {
      onSerializationRetry: () => assert.fail('provider failure must not use serialization retry'),
    })
    assert.equal(result.ok, false)
    assert.equal(result.failureKind, 'TRANSPORT')
    assert.equal(requests.length, 1)
    assert.equal(gateway.attempts[0].parseStatus, 'not-attempted')
    assert.equal(gateway.attempts[0].schemaValidationStatus, 'not-attempted')
  }
})

// Exercise the production BudgetedGateway and persistence with injected, canned
// responses and preflight. Stop at PROBLEM_EXTRACT; no downstream stage is run.
async function coordinatorCase(t, retryText, budget, stopAfter = 'PROBLEM_EXTRACT') {
  const root = mkdtempSync(join(tmpdir(), 'evoresearch-problem-retry-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, 'papers'))
  const papers = ['first', 'second', 'tag-wm']
  for (const paper of papers) writeFileSync(join(root, 'papers', `${paper}.pdf`), `(A local ${paper} paper.) Tj`)
  writeFileSync(join(root, 'case.json'), JSON.stringify({
    caseId: 'offline-problem-retry', title: 'Offline retry regression', researchArea: 'watermarking',
    paperArtifacts: papers.map(paper => ({ paperId: paper, path: `papers/${paper}.pdf`, mediaType: 'application/pdf' })),
  }))
  const problemCalls = new Map()
  let finalArtifactId
  const { gateway, requests } = cannedGateway(request => {
    if (request.role === 'PaperReader') {
      finalArtifactId = request.data.chunks[0].locators[0].artifactId
      return streamText(JSON.stringify({ artifactId: finalArtifactId, schemaVersion: 'm2.3', items: [] }))
    }
    assert.equal(request.role, 'ProblemExtractor')
    const artifactId = request.data.paperReaderOutput.artifactId
    const calls = (problemCalls.get(artifactId) ?? 0) + 1
    problemCalls.set(artifactId, calls)
    return streamText(artifactId === finalArtifactId ? (calls === 1 ? malformed : retryText) : validText)
  })
  const result = await runLiveCase(join(root, 'case.json'), {
    outputRoot: join(root, 'outputs'), stopAfter, gateway, budget,
    preflightImpl: async () => ({ baseUrl: 'https://offline.invalid', endpoint: 'https://offline.invalid/responses', model: 'fake', apiKeyConfigured: true, responseSucceeded: true, normalizedText: true, structuredOutputSupported: true, attemptCount: 1 }),
  })
  const read = name => JSON.parse(readFileSync(join(result.outputDirectory, name), 'utf8'))
  return { result, read, requests, ledger: read('model-attempts.json'), snapshot: read('run-snapshot.json'), finalArtifactId }
}

function assertDownstreamEmpty(run) {
  for (const name of ['problem-graph.json', 'retrieval-needs.json', 'source-selection.json', 'claims.json', 'evidence.json']) {
    assert.deepEqual(run.read(name), [])
  }
  assert.deepEqual(run.read('evidence-plan.json'), { status: 'NOT_PLANNED' })
}

test('offline coordinator retry counts each actual call once and persists both attempts before the stop boundary', async t => {
  const run = await coordinatorCase(t, validText, { maxProblemExtractorModelCalls: 4, maxTotalModelCalls: 7 })
  assert.equal(run.result.status, 'STOPPED_AS_REQUESTED')
  assert.equal(run.result.stopAfter, 'PROBLEM_EXTRACT')
  assert.equal(run.result.stages.find(stage => stage.stage === 'PROBLEM_EXTRACT').status, 'COMPLETED')
  assert.ok(run.result.stages.filter(stage => ['PROBLEM_GRAPH', 'RETRIEVAL_NEEDS', 'EVIDENCE_EXTRACT'].includes(stage.stage)).every(stage => stage.status === 'INTENTIONALLY_NOT_RUN'))
  assert.equal(run.requests.length, 7)
  assert.equal(run.snapshot.usage.totalModelCalls, 7)
  assert.equal(run.snapshot.usage.paperReaderModelCalls, 3)
  assert.equal(run.snapshot.usage.problemExtractorModelCalls, 4)
  assert.equal(run.snapshot.usage.serializationRetries, 1)
  assert.equal(run.ledger.length, 7)
  const attempts = run.ledger.filter(attempt => attempt.role === 'ProblemExtractor' && attempt.inputArtifactIds[0] === run.finalArtifactId)
  assert.equal(attempts.length, 2)
  assert.notEqual(attempts[0].attemptId, attempts[1].attemptId)
  assert.equal(attempts[0].parseStatus, 'failure')
  assert.equal(attempts[0].schemaValidationStatus, 'not-attempted')
  assert.equal(attempts[0].status, 'FAILED')
  assert.equal(attempts[0].retryable, true)
  assert.equal(attempts[0].rawResponseHash, contentHash(malformed))
  assert.equal(attempts[0].normalizedTextHash, contentHash(malformed))
  assert.equal(attempts[1].parseStatus, 'success')
  assert.equal(attempts[1].schemaValidationStatus, 'success')
  assert.equal(attempts[1].status, 'SUCCEEDED')
  assert.deepEqual(run.read('problem-extractor/tag-wm.json'), valid)
  assertDownstreamEmpty(run)
})

test('successful retry leaves the normal ProblemGraph boundary eligible', async t => {
  const run = await coordinatorCase(t, validText, { maxProblemExtractorModelCalls: 4, maxTotalModelCalls: 7 }, 'PROBLEM_GRAPH')
  assert.equal(run.result.status, 'STOPPED_AS_REQUESTED')
  assert.equal(run.result.stages.find(stage => stage.stage === 'PROBLEM_EXTRACT').status, 'COMPLETED')
  assert.equal(run.result.stages.find(stage => stage.stage === 'PROBLEM_GRAPH').status, 'COMPLETED')
  assert.equal(run.read('problem-graph.json').nodes.length, 3)
  assert.equal(run.read('problem-graph.json').edges.length, 0)
  assert.equal(run.result.stages.find(stage => stage.stage === 'RETRIEVAL_NEEDS').status, 'INTENTIONALLY_NOT_RUN')
})

for (const [label, retryText] of [['parse', malformed], ['schema', schemaInvalidText]]) {
  test(`offline coordinator exhausted ${label} retry preserves partial paper audits and blocks the aggregate`, async t => {
    const run = await coordinatorCase(t, retryText)
    assert.equal(run.result.status, 'FAILED')
    assert.equal(run.result.failedStage, 'PROBLEM_EXTRACT')
    assert.equal(run.snapshot.scientificallyComplete, false)
    assert.equal(run.snapshot.usage.totalModelCalls, 7)
    assert.equal(run.snapshot.usage.problemExtractorModelCalls, 4)
    assert.equal(run.snapshot.usage.serializationRetries, 1)
    assert.equal(run.requests.length, 7)
    assert.equal(run.ledger.length, 7)
    assert.ok(run.read('stage-state.json').every(stage => ['INGEST', 'EXTRACT', 'PAPER_READ', 'PROBLEM_EXTRACT'].includes(stage.stage)))
    assert.deepEqual(run.read('problem-extractor/first.json'), valid)
    assert.deepEqual(run.read('problem-extractor/second.json'), valid)
    assert.equal(existsSync(join(run.result.outputDirectory, 'problem-extractor/tag-wm.json')), false)
    assertDownstreamEmpty(run)
  })
}

for (const [label, budget] of [
  ['role', { maxProblemExtractorModelCalls: 3 }],
  ['global', { maxTotalModelCalls: 6 }],
]) {
  test(`offline coordinator ${label} budget refuses retry before any extra model invocation`, async t => {
    const run = await coordinatorCase(t, validText, budget)
    assert.equal(run.result.status, 'FAILED')
    assert.equal(run.result.failedStage, 'PROBLEM_EXTRACT')
    assert.match(run.snapshot.error, /^BUDGET_EXHAUSTED:/)
    assert.equal(run.read('stage-state.json').at(-1).status, 'BUDGET_EXHAUSTED')
    assert.equal(run.requests.length, 6)
    assert.equal(run.ledger.length, 6)
    assert.equal(run.snapshot.usage.totalModelCalls, 6)
    assert.equal(run.snapshot.usage.problemExtractorModelCalls, 3)
    assert.equal(existsSync(join(run.result.outputDirectory, 'problem-extractor/tag-wm.json')), false)
    assertDownstreamEmpty(run)
  })
}
