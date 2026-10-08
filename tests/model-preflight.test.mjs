import assert from 'node:assert/strict'
import test from 'node:test'
import { buildPreflightRequest, preflightModel, redactSecrets, serializePreflight } from '../src/adapters/model-preflight.ts'

const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const streamResponse = (text = '{"ok":true}', status = 200) => new Response(`event: response.output_text.delta\ndata: ${JSON.stringify({ delta: text })}\n\nevent: response.completed\ndata: ${JSON.stringify({ usage: { total_tokens: 2 } })}\n\n`, { status, headers: { 'content-type': 'text/event-stream' } })
const providerStream = (eventType, data, status = 200, extraHeaders = {}) => new Response(`event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`, { status, headers: { 'content-type': 'text/event-stream', ...extraHeaders } })
const noDelay = async () => {}

test('preflightModel() and preflightModel({}) safely resolve environment-only configuration', async () => {
  const original = { url: process.env.EVORESEARCH_MODEL_BASE_URL, key: process.env.EVORESEARCH_MODEL_API_KEY, model: process.env.EVORESEARCH_MODEL, mode: process.env.EVORESEARCH_MODEL_STRUCTURED_OUTPUT_MODE }
  process.env.EVORESEARCH_MODEL_BASE_URL = 'https://env.example///'; process.env.EVORESEARCH_MODEL_API_KEY = 'secret'; process.env.EVORESEARCH_MODEL = 'env-model'; process.env.EVORESEARCH_MODEL_STRUCTURED_OUTPUT_MODE = 'prompt_json'
  const fetchImpl = async (_url, init) => { const requestBody = JSON.parse(init.body); assert.equal(requestBody.stream, true); return streamResponse() }
  const first = await preflightModel({ fetchImpl }); const second = await preflightModel({ fetchImpl })
  assert.equal(first.endpoint, 'https://env.example/responses'); assert.equal(first.structuredOutputMode, 'prompt_json'); assert.equal(first.structuredOutputSupported, true); assert.equal(second.error, undefined)
  for (const [name, value] of Object.entries({ EVORESEARCH_MODEL_BASE_URL: original.url, EVORESEARCH_MODEL_API_KEY: original.key, EVORESEARCH_MODEL: original.model, EVORESEARCH_MODEL_STRUCTURED_OUTPUT_MODE: original.mode })) { if (value === undefined) delete process.env[name]; else process.env[name] = value }
})

test('empty options and explicit options override environment', async () => {
  const result = await preflightModel({ baseUrl: 'https://option.example/', apiKey: 'option-secret', model: 'option-model', structuredOutputMode: 'prompt_json', fetchImpl: async (url, init) => { assert.equal(url, 'https://option.example/responses'); assert.equal(init.headers.authorization, 'Bearer option-secret'); return streamResponse() } })
  assert.equal(result.baseUrl, 'https://option.example'); assert.equal(result.model, 'option-model'); assert.equal(result.structuredOutputSupported, true); assert.equal(JSON.stringify(result).includes('option-secret'), false)
})

test('missing base URL, API key, and model return typed configuration failures', async () => { const result = await preflightModel({ baseUrl: '', apiKey: '', model: '' }); assert.equal(result.errorCategory, 'CONFIGURATION'); assert.match(result.error, /EVORESEARCH_MODEL_BASE_URL/); assert.equal(result.reachable, false) })

test('prompt_json does not send native schema fields and parses minimal JSON locally', () => { const request = buildPreflightRequest('m', 'prompt_json'); assert.equal('text' in request, false); assert.match(JSON.stringify(request), /ok/) })

test('disabled streaming keeps a bounded non-stream compatibility path', async () => {
  let sentBody
  const result = await preflightModel({ baseUrl: 'https://option.example', apiKey: 'key', model: 'm', streaming: 'disabled', fetchImpl: async (_url, init) => { sentBody = JSON.parse(init.body); return response({ output_text: '{"ok":true}' }) } })
  assert.equal(sentBody.stream, false)
  assert.equal(result.structuredOutputSupported, true)
})

test('non-2xx diagnostics include status, endpoint, response keys/body, but never secrets', async () => { const result = await preflightModel({ baseUrl: 'https://x/', apiKey: 'secret-key', model: 'm', fetchImpl: async () => response({ error: 'bad', echoed: 'secret-key' }, 401) }); assert.equal(result.errorCategory, 'AUTHENTICATION'); assert.equal(result.responseStatus, 401); assert.equal(result.endpoint, 'https://x/responses'); assert.deepEqual(result.responseKeys, ['error', 'echoed']); assert.equal(JSON.stringify(result).includes('secret-key'), false) })

test('secret redaction is deterministic', () => { assert.equal(redactSecrets('Bearer abc abc', 'abc'), 'Bearer [REDACTED] [REDACTED]') })

test('HTTP 429 retries once, honors bounded Retry-After, then succeeds', async () => {
  let calls = 0; const delays = []
  const result = await preflightModel({ baseUrl: 'https://x', apiKey: 'key', model: 'm', delayImpl: async milliseconds => delays.push(milliseconds), fetchImpl: async () => ++calls === 1 ? new Response('busy', { status: 429, headers: { 'retry-after': '9' } }) : streamResponse() })
  assert.equal(calls, 2); assert.equal(result.structuredOutputSupported, true); assert.equal(result.attemptCount, 2); assert.equal(result.attempts[0].errorCategory, 'RATE_LIMIT'); assert.equal(result.attempts[0].retryable, true); assert.equal(result.attempts[0].retryPerformed, true); assert.deepEqual(delays, [1000])
})

test('HTTP 429 retries once and records final failure without a third attempt', async () => {
  let calls = 0
  const result = await preflightModel({ baseUrl: 'https://x', apiKey: 'key', model: 'm', delayImpl: noDelay, fetchImpl: async () => { calls++; return new Response('busy', { status: 429 }) } })
  assert.equal(calls, 2); assert.equal(result.errorCategory, 'RATE_LIMIT'); assert.equal(result.retryable, true); assert.equal(result.attemptCount, 2); assert.equal(result.attempts[1].retryPerformed, false)
})

test('HTTP 500 retries once and preserves SERVER_ERROR classification', async () => {
  let calls = 0
  const result = await preflightModel({ baseUrl: 'https://x', apiKey: 'key', model: 'm', delayImpl: noDelay, fetchImpl: async () => ++calls === 1 ? new Response('busy', { status: 500 }) : streamResponse() })
  assert.equal(calls, 2); assert.equal(result.attempts[0].errorCategory, 'SERVER_ERROR'); assert.equal(result.attempts[0].retryable, true); assert.equal(result.structuredOutputSupported, true)
})

test('HTTP authentication failures are non-retryable', async () => {
  for (const status of [401, 403]) {
    let calls = 0
    const result = await preflightModel({ baseUrl: 'https://x', apiKey: 'key', model: 'm', delayImpl: noDelay, fetchImpl: async () => { calls++; return new Response('denied', { status }) } })
    assert.equal(calls, 1); assert.equal(result.errorCategory, 'AUTHENTICATION'); assert.equal(result.retryable, false); assert.equal(result.attempts[0].retryPerformed, false)
  }
})

test('HTTP 200 SSE error with provider 429 retries and preserves structured diagnostics', async () => {
  let calls = 0
  const result = await preflightModel({ baseUrl: 'https://x', apiKey: 'key', model: 'm', delayImpl: noDelay, fetchImpl: async () => ++calls === 1 ? providerStream('error', { status: 429, code: 'rate_limit_exceeded', message: 'slow down', response_id: 'resp_1', request_id: 'req_1' }) : streamResponse() })
  const first = result.attempts[0]
  assert.equal(calls, 2); assert.equal(result.structuredOutputSupported, true); assert.equal(first.responseStatus, 200); assert.equal(first.errorCategory, 'RATE_LIMIT'); assert.equal(first.providerStatus, 429); assert.equal(first.providerErrorCode, 'rate_limit_exceeded'); assert.equal(first.providerErrorEventType, 'error'); assert.equal(first.responseId, 'resp_1'); assert.equal(first.requestId, 'req_1'); assert.equal(first.terminalObserved, false); assert.deepEqual(first.streamEventTypes, ['error'])
})

test('HTTP 200 response.failed with provider 5xx retries as SERVER_ERROR', async () => {
  let calls = 0
  const result = await preflightModel({ baseUrl: 'https://x', apiKey: 'key', model: 'm', delayImpl: noDelay, fetchImpl: async () => ++calls === 1 ? providerStream('response.failed', { status: 503, code: 'server_error', message: 'overloaded' }) : streamResponse() })
  assert.equal(calls, 2); assert.equal(result.attempts[0].errorCategory, 'SERVER_ERROR'); assert.equal(result.attempts[0].providerStatus, 503); assert.equal(result.attempts[0].retryable, true); assert.equal(result.structuredOutputSupported, true)
})

test('provider errors fail preflight even when partial output looks structurally valid', async () => {
  const result = await preflightModel({ baseUrl: 'https://x', apiKey: 'key', model: 'm', delayImpl: noDelay, fetchImpl: async () => new Response('event: response.output_text.delta\ndata: {"delta":"{\\"ok\\":true}"}\n\nevent: response.failed\ndata: {"status":503,"code":"server_error","message":"overloaded"}\n\n', { status: 200, headers: { 'content-type': 'text/event-stream' } }) })
  assert.equal(result.responseSucceeded, false); assert.equal(result.errorCategory, 'SERVER_ERROR'); assert.equal(result.structuredOutputSupported, true); assert.equal(result.retryable, true)
})

test('SSE provider errors without trusted status or code fail closed without retry', async () => {
  let calls = 0
  const result = await preflightModel({ baseUrl: 'https://x', apiKey: 'key', model: 'm', delayImpl: noDelay, fetchImpl: async () => { calls++; return providerStream('response.failed', { message: 'provider failed' }) } })
  assert.equal(calls, 1); assert.equal(result.errorCategory, 'INVALID_RESPONSE'); assert.equal(result.retryable, false); assert.equal(result.attempts[0].retryPerformed, false)
})

test('malformed SSE is INVALID_RESPONSE and non-retryable', async () => {
  let calls = 0
  const result = await preflightModel({ baseUrl: 'https://x', apiKey: 'key', model: 'm', delayImpl: noDelay, fetchImpl: async () => { calls++; return new Response('event: response.failed\ndata: {bad\n\n', { status: 200, headers: { 'content-type': 'text/event-stream' } }) } })
  assert.equal(calls, 1); assert.equal(result.errorCategory, 'INVALID_RESPONSE'); assert.equal(result.retryable, false); assert.equal(result.attempts[0].errorCategory, 'INVALID_RESPONSE')
})

test('successful preflight performs no retry', async () => {
  let calls = 0
  const result = await preflightModel({ baseUrl: 'https://x', apiKey: 'key', model: 'm', delayImpl: noDelay, fetchImpl: async () => { calls++; return streamResponse() } })
  assert.equal(calls, 1); assert.equal(result.attemptCount, 1); assert.equal(result.attempts[0].retryPerformed, false); assert.equal(result.retryable, false)
})

test('preflight diagnostics bound provider messages and exclude secrets and authorization', async () => {
  const secret = 'secret-key'; const longMessage = `${'x'.repeat(5000)}-${secret}`
  const result = await preflightModel({ baseUrl: 'https://x', apiKey: secret, model: 'm', delayImpl: noDelay, fetchImpl: async () => providerStream('error', { status: 500, code: 'server_error', message: longMessage }) })
  const artifact = serializePreflight(result, '2026-09-29T00:00:00.000Z', 'FAILED'); const serialized = JSON.stringify(artifact)
  assert.equal(result.providerErrorMessage.length, 2048); assert.equal(serialized.includes(secret), false); assert.equal(serialized.includes('authorization'), false); assert.equal(serialized.includes(longMessage), false)
})
