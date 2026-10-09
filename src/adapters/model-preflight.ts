import { buildResponsesEndpoint, consumeResponsesStream, normalizeBaseUrl, parseJsonText, parseStreamingMode, type ProviderErrorDiagnostic, type StreamErrorCategory, type StreamingMode, type StructuredOutputMode } from './responses-model.ts'
import { env } from 'node:process'

export const PREFLIGHT_MAX_ATTEMPTS = 2
export const PREFLIGHT_DEFAULT_RETRY_DELAY_MS = 50
export const PREFLIGHT_MAX_RETRY_DELAY_MS = 1000
export const PREFLIGHT_ERROR_MESSAGE_LIMIT = 2048
export type ModelPreflightErrorCategory = 'CONFIGURATION' | 'NETWORK_ERROR' | 'TIMEOUT' | 'HTTP_ERROR' | 'AUTHENTICATION' | 'RATE_LIMIT' | 'SERVER_ERROR' | 'INVALID_RESPONSE' | 'STRUCTURED_OUTPUT_UNSUPPORTED'

export interface ModelPreflightOptions {
  readonly baseUrl?: string
  readonly apiKey?: string
  readonly model?: string
  readonly structuredOutputMode?: StructuredOutputMode
  readonly mode?: StructuredOutputMode
  readonly fetchImpl?: typeof fetch
  readonly streaming?: StreamingMode
  readonly delayImpl?: (milliseconds: number) => Promise<void>
  /** Caller-owned physical request budget; the adapter never exceeds two. */
  readonly maxAttempts?: number
}
export interface ModelPreflightAttempt {
  readonly attemptIndex: number
  readonly transportSucceeded: boolean
  readonly responseStatus?: number
  readonly contentType?: string
  readonly streamEventCount?: number
  readonly streamEventTypes?: readonly string[]
  readonly terminalObserved?: boolean
  readonly providerStatus?: number
  readonly providerErrorCode?: string
  readonly providerErrorMessage?: string
  readonly providerErrorEventType?: string
  readonly responseId?: string
  readonly requestId?: string
  readonly outputTextPresent: boolean
  readonly errorCategory?: ModelPreflightErrorCategory
  readonly error?: string
  readonly retryable: boolean
  readonly retryPerformed: boolean
  readonly retryDelayMs?: number
}
export interface ModelPreflightResult {
  readonly baseUrl: string
  readonly model: string
  readonly apiKeyConfigured: boolean
  readonly endpoint: string
  readonly reachable: boolean
  readonly responseSucceeded: boolean
  readonly normalizedText: boolean
  readonly structuredOutputMode: StructuredOutputMode
  readonly streaming: StreamingMode
  readonly structuredOutputSupported: boolean
  readonly responseStatus?: number
  readonly outputTextPresent?: boolean
  readonly responseKeys?: readonly string[]
  readonly errorCategory?: ModelPreflightErrorCategory
  readonly error?: string
  readonly errorBody?: string
  readonly contentType?: string
  readonly streamEventCount?: number
  readonly streamEventTypes?: readonly string[]
  readonly terminalObserved?: boolean
  readonly providerStatus?: number
  readonly providerErrorCode?: string
  readonly providerErrorMessage?: string
  readonly providerErrorEventType?: string
  readonly responseId?: string
  readonly requestId?: string
  readonly retryable: boolean
  readonly attemptCount: number
  readonly attempts: readonly ModelPreflightAttempt[]
}

type AttemptOutcome = {
  readonly result: Omit<ModelPreflightResult, 'attemptCount' | 'attempts'>
  readonly attempt: Omit<ModelPreflightAttempt, 'retryPerformed' | 'retryDelayMs'>
  readonly retryAfterMs?: number
}

export async function preflightModel(options: ModelPreflightOptions = {}): Promise<ModelPreflightResult> {
  const maxAttempts = options.maxAttempts ?? PREFLIGHT_MAX_ATTEMPTS
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > PREFLIGHT_MAX_ATTEMPTS) throw new RangeError(`maxAttempts must be an integer in [1, ${PREFLIGHT_MAX_ATTEMPTS}]`)
  const configuredBaseUrl = normalizeBaseUrl(options.baseUrl ?? env.EVORESEARCH_MODEL_BASE_URL ?? '')
  const baseUrl = sanitizeEndpoint(configuredBaseUrl)
  const apiKey = options.apiKey ?? env.EVORESEARCH_MODEL_API_KEY ?? ''
  const model = options.model ?? env.EVORESEARCH_MODEL ?? ''
  const structuredOutputMode = options.structuredOutputMode ?? options.mode ?? (env.EVORESEARCH_MODEL_STRUCTURED_OUTPUT_MODE as StructuredOutputMode | undefined) ?? 'prompt_json'
  const streaming = options.streaming ?? parseStreamingMode(env.EVORESEARCH_MODEL_STREAMING) ?? 'required'
  const endpoint = buildResponsesEndpoint(baseUrl)
  const missing = [!baseUrl ? 'EVORESEARCH_MODEL_BASE_URL' : '', !apiKey ? 'EVORESEARCH_MODEL_API_KEY' : '', !model ? 'EVORESEARCH_MODEL' : ''].filter(Boolean)
  if (missing.length) return { baseUrl, model, apiKeyConfigured: Boolean(apiKey), endpoint, reachable: false, responseSucceeded: false, normalizedText: false, structuredOutputMode, streaming, structuredOutputSupported: false, errorCategory: 'CONFIGURATION', error: `Missing configuration: ${missing.join(', ')}`, retryable: false, attemptCount: 0, attempts: [] }

  const attempts: ModelPreflightAttempt[] = []
  const delayImpl = options.delayImpl ?? delay
  for (let attemptIndex = 1; attemptIndex <= maxAttempts; attemptIndex++) {
    const outcome = await executeAttempt({ baseUrl, endpoint, apiKey, model, structuredOutputMode, streaming, fetchImpl: options.fetchImpl ?? fetch, attemptIndex })
    const retryPerformed = outcome.attempt.retryable && attemptIndex < maxAttempts
    const retryDelayMs = retryPerformed ? outcome.retryAfterMs ?? PREFLIGHT_DEFAULT_RETRY_DELAY_MS : undefined
    const attempt = { ...outcome.attempt, retryPerformed, retryDelayMs }
    attempts.push(attempt)
    const result: ModelPreflightResult = { ...outcome.result, attemptCount: attempts.length, attempts: [...attempts], retryable: outcome.attempt.retryable }
    if (!retryPerformed) return result
    await delayImpl(retryDelayMs ?? PREFLIGHT_DEFAULT_RETRY_DELAY_MS)
  }
  throw new Error('preflight retry loop exhausted unexpectedly')
}

async function executeAttempt(input: { readonly baseUrl: string; readonly endpoint: string; readonly apiKey: string; readonly model: string; readonly structuredOutputMode: StructuredOutputMode; readonly streaming: StreamingMode; readonly fetchImpl: typeof fetch; readonly attemptIndex: number }): Promise<AttemptOutcome> {
  const { baseUrl, endpoint, apiKey, model, structuredOutputMode, streaming, fetchImpl, attemptIndex } = input
  const common = { baseUrl, model, apiKeyConfigured: true, endpoint, structuredOutputMode, streaming }
  try {
    const response = await fetchImpl(endpoint, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` }, body: JSON.stringify(buildPreflightRequest(model, structuredOutputMode, streaming !== 'disabled')) })
    const contentType = response.headers.get('content-type') ?? undefined
    const retryAfterMs = parseRetryAfter(response.headers.get('retry-after'))
    if (!response.ok) {
      const body = redactSecrets(await readBoundedBody(response, 2000), apiKey)
      let keys: readonly string[] | undefined
      try { const parsedBody = JSON.parse(body) as Record<string, unknown>; keys = Object.keys(parsedBody).slice(0, 100) } catch { /* bounded diagnostic body is still useful */ }
      const category = classifyHttpStatus(response.status)
      const error = `Responses HTTP ${response.status}`
      return {
        result: { ...common, reachable: true, responseSucceeded: false, normalizedText: false, structuredOutputSupported: false, responseStatus: response.status, responseKeys: keys, contentType, errorCategory: category, error, errorBody: body, retryable: category === 'RATE_LIMIT' || category === 'SERVER_ERROR' },
        attempt: { attemptIndex, transportSucceeded: true, responseStatus: response.status, contentType, outputTextPresent: false, errorCategory: category, error, retryable: category === 'RATE_LIMIT' || category === 'SERVER_ERROR' },
        retryAfterMs,
      }
    }
    if (streaming !== 'disabled' && !contentType?.toLowerCase().includes('text/event-stream')) {
      const error = 'Expected text/event-stream response'
      return {
        result: { ...common, reachable: true, responseSucceeded: true, normalizedText: false, structuredOutputSupported: false, responseStatus: response.status, contentType, errorCategory: 'INVALID_RESPONSE', error, errorBody: redactSecrets(await readBoundedBody(response, 2000), apiKey), retryable: false },
        attempt: { attemptIndex, transportSucceeded: true, responseStatus: response.status, contentType, outputTextPresent: false, errorCategory: 'INVALID_RESPONSE', error, retryable: false },
      }
    }

    const stream = streaming !== 'disabled' ? await consumeResponsesStream(response) : undefined
    const raw = streaming === 'disabled' ? redactSecrets(await readBoundedBody(response, 2000), apiKey) : undefined
    const parsed = streaming === 'disabled' ? parseEnvelope(raw ?? '') : undefined
    const outputText = stream?.text ?? parsed?.text ?? ''
    const outputTextPresent = Boolean(outputText)
    const normalizedText = outputTextPresent
    const parsedJson = outputText ? parseJsonText(outputText) : undefined
    const structuredOutputSupported = parsedJson?.ok === true
    const provider = stream?.providerError
    const providerStatus = provider?.status
    const providerErrorCode = provider?.code === undefined ? undefined : redactSecrets(provider.code, apiKey).slice(0, 256)
    const providerErrorMessage = provider?.message === undefined ? undefined : boundMessage(redactSecrets(provider.message, apiKey))
    const providerErrorEventType = provider?.eventType === undefined ? undefined : redactSecrets(provider.eventType, apiKey).slice(0, 256)
    const responseId = stream?.responseId ?? provider?.responseId
    const requestId = stream?.requestId ?? provider?.requestId
    const streamCategory = stream?.error ? mapStreamCategory(stream.errorCategory) : undefined
    const error = stream?.error ?? parsed?.error
    const safeError = error === undefined ? undefined : boundMessage(redactSecrets(error, apiKey))
    const retryable = stream?.retryable === true && (streamCategory === 'RATE_LIMIT' || streamCategory === 'SERVER_ERROR')
    const attempt: Omit<ModelPreflightAttempt, 'retryPerformed' | 'retryDelayMs'> = { attemptIndex, transportSucceeded: true, responseStatus: response.status, contentType, streamEventCount: stream?.events, streamEventTypes: stream?.eventTypes, terminalObserved: stream?.terminalObserved, providerStatus, providerErrorCode, providerErrorMessage, providerErrorEventType, responseId: responseId === undefined ? undefined : redactSecrets(responseId, apiKey).slice(0, 256), requestId: requestId === undefined ? undefined : redactSecrets(requestId, apiKey).slice(0, 256), outputTextPresent, errorCategory: streamCategory ?? (parsed && !parsed.valid ? 'INVALID_RESPONSE' : !structuredOutputSupported ? 'STRUCTURED_OUTPUT_UNSUPPORTED' : undefined), error: safeError, retryable }
    const result: Omit<ModelPreflightResult, 'attemptCount' | 'attempts'> = { ...common, reachable: true, responseSucceeded: !streamCategory, normalizedText, structuredOutputSupported, responseStatus: response.status, outputTextPresent, responseKeys: parsed?.keys, contentType, streamEventCount: stream?.events, streamEventTypes: stream?.eventTypes, terminalObserved: stream?.terminalObserved, providerStatus, providerErrorCode, providerErrorMessage, providerErrorEventType, responseId: responseId === undefined ? undefined : redactSecrets(responseId, apiKey).slice(0, 256), requestId: requestId === undefined ? undefined : redactSecrets(requestId, apiKey).slice(0, 256), errorCategory: streamCategory ?? (parsed && !parsed.valid ? 'INVALID_RESPONSE' : !structuredOutputSupported ? 'STRUCTURED_OUTPUT_UNSUPPORTED' : undefined), error: safeError ?? (!structuredOutputSupported ? `Configured ${structuredOutputMode} preflight did not produce {"ok":true}` : undefined), errorBody: streaming === 'disabled' ? raw : undefined, retryable }
    return { result, attempt, retryAfterMs: retryable ? retryAfterMs : undefined }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'preflight request failed'
    const category: ModelPreflightErrorCategory = error instanceof DOMException && error.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK_ERROR'
    return { result: { ...common, reachable: false, responseSucceeded: false, normalizedText: false, structuredOutputSupported: false, errorCategory: category, error: boundMessage(redactSecrets(message, apiKey)), retryable: false }, attempt: { attemptIndex, transportSucceeded: false, outputTextPresent: false, errorCategory: category, error: boundMessage(redactSecrets(message, apiKey)), retryable: false } }
  }
}

export function buildPreflightRequest(model: string, mode: StructuredOutputMode, stream = true): Record<string, unknown> {
  const input = [{ role: 'user', content: [{ type: 'input_text', text: 'Return exactly this JSON object and no other content: {"ok":true}' }] }]
  const request: Record<string, unknown> = { model, stream, input }
  if (mode === 'native_json_schema') request.text = { format: { type: 'json_schema', name: 'preflight', strict: true, schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false } } }
  else if (mode === 'json_object') request.text = { format: { type: 'json_object' } }
  return request
}

export function serializePreflight(result: ModelPreflightResult, timestamp = new Date().toISOString(), status: 'SUCCEEDED' | 'FAILED' = result.errorCategory ? 'FAILED' : 'SUCCEEDED'): Record<string, unknown> {
  const attempts = result.attempts ?? []
  const attemptCount = result.attemptCount ?? attempts.length
  return {
    status,
    timestamp,
    endpoint: sanitizeEndpoint(result.endpoint),
    model: result.model,
    structuredOutputMode: result.structuredOutputMode,
    streaming: result.streaming,
    attemptCount,
    attempts,
    final: {
      reachable: result.reachable,
      transportSucceeded: result.reachable,
      responseSucceeded: result.responseSucceeded && !result.errorCategory,
      responseStatus: result.responseStatus,
      contentType: result.contentType,
      streamEventCount: result.streamEventCount,
      streamEventTypes: result.streamEventTypes,
      terminalObserved: result.terminalObserved,
      outputTextPresent: result.outputTextPresent ?? result.normalizedText,
      providerStatus: result.providerStatus,
      providerErrorCode: result.providerErrorCode,
      providerErrorMessage: result.providerErrorMessage,
      providerErrorEventType: result.providerErrorEventType,
      responseId: result.responseId,
      requestId: result.requestId,
      errorCategory: result.errorCategory,
      error: boundMessage(result.error),
      retryable: result.retryable,
      structuredOutputSupported: result.structuredOutputSupported,
    },
  }
}

export function sanitizeEndpoint(value: string): string {
  try {
    const url = new URL(value)
    url.username = ''
    url.password = ''
    url.search = ''
    url.hash = ''
    return url.toString().replace(/\/$/, '')
  } catch {
    const withoutQuery = value.split(/[?#]/, 1)[0].replace(/\/+$/, '')
    const scheme = withoutQuery.indexOf('://')
    return scheme >= 0
      ? `${withoutQuery.slice(0, scheme + 3)}${withoutQuery.slice(scheme + 3).replace(/^[^/]*@/u, '')}`
      : withoutQuery
  }
}
export function parseRetryAfter(value: string | null | undefined, now = Date.now()): number | undefined {
  if (!value) return undefined
  const seconds = Number(value.trim())
  const milliseconds = Number.isFinite(seconds) && seconds >= 0 ? Math.ceil(seconds * 1000) : Date.parse(value) - now
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return undefined
  return Math.min(PREFLIGHT_MAX_RETRY_DELAY_MS, Math.ceil(milliseconds))
}
export function redactSecrets(value: string, secret: string): string { return secret ? value.split(secret).join('[REDACTED]') : value }

function classifyHttpStatus(status: number): ModelPreflightErrorCategory {
  if (status === 401 || status === 403) return 'AUTHENTICATION'
  if (status === 429) return 'RATE_LIMIT'
  if (status >= 500 && status <= 599) return 'SERVER_ERROR'
  return 'HTTP_ERROR'
}
function mapStreamCategory(category: StreamErrorCategory | undefined): ModelPreflightErrorCategory {
  if (category === 'RATE_LIMIT') return 'RATE_LIMIT'
  if (category === 'SERVER_ERROR') return 'SERVER_ERROR'
  if (category === 'AUTHENTICATION') return 'AUTHENTICATION'
  if (category === 'CONFIGURATION') return 'CONFIGURATION'
  if (category === 'TIMEOUT') return 'TIMEOUT'
  if (category === 'NETWORK_ERROR') return 'NETWORK_ERROR'
  return 'INVALID_RESPONSE'
}
function boundMessage(value: string | undefined): string | undefined { return value === undefined ? undefined : value.slice(0, PREFLIGHT_ERROR_MESSAGE_LIMIT) }
function parseEnvelope(raw: string): { readonly valid: boolean; readonly text: string; readonly keys: readonly string[]; readonly error?: string } {
  try { const envelope = JSON.parse(raw) as Record<string, unknown>; const text = typeof envelope.output_text === 'string' ? envelope.output_text : collect(envelope.output); return { valid: Boolean(text), text, keys: Object.keys(envelope).slice(0, 100), error: text ? undefined : 'Responses response contained no output text' } } catch (error) { return { valid: false, text: '', keys: [], error: error instanceof Error ? `Invalid JSON response: ${error.message}` : 'Invalid JSON response' } }
}
function collect(value: unknown): string { if (Array.isArray(value)) return value.map(collect).filter(Boolean).join('\n'); if (!value || typeof value !== 'object') return ''; const record = value as Record<string, unknown>; return typeof record.text === 'string' ? record.text : collect(record.content) || collect(record.output) }
function delay(milliseconds: number) { return new Promise(resolve => setTimeout(resolve, milliseconds)) }
async function readBoundedBody(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return ''
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let total = 0
  try {
    while (total <= maxBytes) {
      const next = await reader.read(); if (next.done) break
      const remaining = maxBytes - total; const chunk = next.value.slice(0, Math.max(0, remaining)); chunks.push(chunk); total += chunk.byteLength
      if (chunk.byteLength < next.value.byteLength || total >= maxBytes) { await reader.cancel(); break }
    }
  } finally { reader.releaseLock() }
  const bytes = new Uint8Array(total); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  return new TextDecoder().decode(bytes)
}
