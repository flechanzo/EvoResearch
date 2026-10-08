import assert from 'node:assert/strict'
import test from 'node:test'
import { ResponsesModelGateway, buildResponsesRequest, consumeResponsesStream, normalizeBaseUrl, parseJsonText, parseResponsesJson, parseSseEvents, reconstructStreaming } from '../src/adapters/responses-model.ts'

const request = { role: 'PaperReader', stage: 'PAPER_READ', route: { provider: 'openai-compatible', model: 'configured' }, skillVersion: 'paper-reader@1', inputArtifactIds: ['artifact_1'], inputEvidenceIds: [], schemaVersion: 'm2.3', attemptId: 'attempt_1', input: { text: 'untrusted paper' }, outputSchema: 'PaperReaderOutput' }
test('Responses URL normalization and request construction use Responses semantics', () => { assert.equal(normalizeBaseUrl('https://model.example///'), 'https://model.example'); const body = buildResponsesRequest('model-x', request, 'native_json_schema'); assert.deepEqual(body.model, 'model-x'); assert.ok(JSON.stringify(body).includes('json_schema')); assert.ok(JSON.stringify(body).includes('untrusted paper')) })
test('Responses parser handles output_text and structured content items', () => { assert.deepEqual(parseResponsesJson(JSON.stringify({ output_text: '{"ok":true}', usage: { totalTokens: 2 } })).value, { ok: true }); assert.deepEqual(parseResponsesJson(JSON.stringify({ output: [{ content: [{ type: 'output_text', text: '{"ok":false}' }] }] })).value, { ok: false }) })
test('gateway records attempts, retries bounded server errors, and never logs API key', async () => { let calls = 0; const gateway = new ResponsesModelGateway({ baseUrl: 'https://model.example/', apiKey: 'secret-key', model: 'm', streaming: 'required', maxRetries: 1, fetchImpl: async (_url, init) => { calls++; assert.equal(init.headers.authorization, 'Bearer secret-key'); if (calls === 1) return new Response('busy', { status: 500 }); return stream(sse([{ type: 'response.output_text.delta', data: { delta: '{"ok":true}' } }, { type: 'response.completed', data: {} }])) } }); const result = await gateway.structured(request); assert.equal(result.ok, true); assert.equal(calls, 2); assert.equal(gateway.attempts.length, 2); assert.equal(JSON.stringify(gateway.attempts).includes('secret-key'), false) })
test('configuration and malformed responses fail with recorded categories', async () => { const gateway = new ResponsesModelGateway({ baseUrl: '', apiKey: '', model: '', streaming: 'required', now: () => '2026-01-01T00:00:00Z' }); const result = await gateway.structured(request); assert.equal(result.ok, false); assert.equal(gateway.attempts[0].errorCategory, 'INVALID_RESPONSE'); const malformed = new ResponsesModelGateway({ baseUrl: 'https://x', apiKey: 'k', model: 'm', streaming: 'required', fetchImpl: async () => new Response('event: response.output_text.delta\ndata: {bad\n\n', { status: 200, headers: { 'content-type': 'text/event-stream' } }) }); const parsed = await malformed.structured(request); assert.equal(parsed.ok, false); assert.equal(malformed.attempts[0].errorCategory, 'INVALID_RESPONSE') })

const sse = (events, ending = '\n') => events.map(({ type, data }) => `event: ${type}${ending}data: ${typeof data === 'string' ? data : JSON.stringify(data)}${ending}${ending}`).join('')
const stream = (body) => new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })

test('streaming request sets stream true and reconstructs deltas with terminal usage', async () => {
  const body = buildResponsesRequest('m', request, 'prompt_json', true)
  assert.equal(body.stream, true)
  const result = await consumeResponsesStream(stream(sse([
    { type: 'response.output_text.delta', data: { delta: '{"ok"' } },
    { type: 'response.output_text.delta', data: { delta: ':true}' } },
    { type: 'response.completed', data: { usage: { input_tokens: 3, output_tokens: 2, total_tokens: 5 } } }
  ])))
  assert.equal(result.text, '{"ok":true}')
  assert.equal(result.terminalObserved, true)
  assert.deepEqual(result.usage, { inputTokens: 3, outputTokens: 2, totalTokens: 5 })
  assert.deepEqual(parseJsonText(result.text).value, { ok: true })
})

test('SSE parser accepts CRLF, comments, unknown events, and DONE', () => {
  const parsed = parseSseEvents(`: keepalive\r\nevent: response.output_text.delta\r\ndata: {"delta":"a"}\r\n\r\nevent: provider.unknown\r\ndata: {"ignored":true}\r\n\r\ndata: [DONE]\r\n\r\n`)
  assert.deepEqual(parsed.events.map(event => event.eventType), ['response.output_text.delta', 'provider.unknown', '[DONE]'])
  assert.equal(reconstructStreaming(parsed.events).text, 'a')
})

test('stream failures, malformed events, and premature close fail closed', async () => {
  const failed = await consumeResponsesStream(stream(sse([{ type: 'response.failed', data: { message: 'provider failed' } }])))
  assert.match(failed.error, /provider failed/)
  const malformed = await consumeResponsesStream(stream('event: response.output_text.delta\ndata: {bad\n\n'))
  assert.equal(malformed.errorCategory, 'INVALID_RESPONSE')
  const premature = await consumeResponsesStream(stream(sse([{ type: 'response.output_text.delta', data: { delta: 'partial' } }])))
  assert.match(premature.error, /terminal/)
})

test('SSE overload provider errors classify as server failures without a generic live retry', async () => {
  let calls = 0
  const gateway = new ResponsesModelGateway({ baseUrl: 'https://model.example', apiKey: 'key', model: 'm', streaming: 'required', maxRetries: 0, fetchImpl: async () => { calls++; return stream(sse([{ type: 'error', data: { code: 'server_is_overloaded', message: 'Our servers are currently overloaded. Please try again later.' } }])) } })
  const result = await gateway.structured(request)
  assert.equal(result.ok, false)
  assert.equal(calls, 1)
  assert.equal(gateway.attempts[0].errorCategory, 'SERVER_ERROR')
  assert.equal(gateway.attempts[0].providerErrorCode, 'server_is_overloaded')
  assert.equal(gateway.attempts[0].retryable, true)
})

test('stream bounds enforce bytes, events, output, and duration', async () => {
  const bytes = await consumeResponsesStream(stream(sse([{ type: 'response.output_text.delta', data: { delta: 'x' } }, { type: 'response.completed', data: {} }])), { maxBytes: 8 })
  assert.match(bytes.error, /byte limit/)
  const events = await consumeResponsesStream(stream(sse([{ type: 'provider.unknown', data: {} }, { type: 'response.completed', data: {} }])), { maxEvents: 1 })
  assert.match(events.error, /event limit/)
  const output = await consumeResponsesStream(stream(sse([{ type: 'response.output_text.delta', data: { delta: 'abcd' } }, { type: 'response.completed', data: {} }])), { maxOutputCharacters: 3 })
  assert.match(output.error, /character limit/)
  const hanging = new ReadableStream({ async pull() { await new Promise(() => {}) } })
  const timeout = await consumeResponsesStream(new Response(hanging, { headers: { 'content-type': 'text/event-stream' } }), { maxDurationMs: 10 }, 10)
  assert.equal(timeout.errorCategory, 'TIMEOUT')
})

test('gateway uses required streaming and records event metadata', async () => {
  let sentBody
  const gateway = new ResponsesModelGateway({ baseUrl: 'https://model.example', apiKey: 'k', model: 'm', streaming: 'required', fetchImpl: async (_url, init) => { sentBody = JSON.parse(init.body); return stream(sse([{ type: 'response.output_text.delta', data: { delta: '{"ok":true}' } }, { type: 'response.completed', data: { usage: { total_tokens: 1 } } }])) } })
  const result = await gateway.structured(request)
  assert.equal(result.ok, true)
  assert.equal(sentBody.stream, true)
  assert.equal(gateway.attempts[0].terminalObserved, true)
  assert.deepEqual(gateway.attempts[0].streamEventTypes, ['response.output_text.delta', 'response.completed'])
})
