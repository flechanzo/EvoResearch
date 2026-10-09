import { preflightModel } from '../../src/adapters/model-preflight.ts'
import { configurationDiagnostics, resolveModelConfiguration, safeModelConfigurationSnapshot } from '../../src/config/model-config.ts'
import { buildResponsesEndpoint } from '../../src/adapters/responses-model.ts'

const configuration = resolveModelConfiguration()
const safeConfiguration = safeModelConfigurationSnapshot(configuration)
const errors = configurationDiagnostics(configuration)
console.log(`MODEL PREFLIGHT CONFIGURATION: ${configuration.ready ? 'READY' : 'INVALID'}`)
console.log(`EVORESEARCH_MODEL_BASE_URL: ${safeConfiguration.baseUrlConfigured ? 'configured' : 'missing'}`)
console.log(`EVORESEARCH_MODEL_API_KEY: ${safeConfiguration.apiKeyConfigured ? 'configured' : 'missing'}`)
console.log(`EVORESEARCH_MODEL: ${safeConfiguration.modelConfigured ? 'configured' : 'missing'}`)
console.log(`structured output mode: ${safeConfiguration.structuredOutputMode}`)
if (!configuration.ready) {
  console.log('MODEL PREFLIGHT: NOT_RUN')
  console.log(JSON.stringify({ executionMode: 'preflight', network: 'NOT_ATTEMPTED', configuration: safeConfiguration, endpoint: '', gateway: 'ResponsesModelGateway', errors }, null, 2))
  process.exitCode = 1
} else {
  const result = await preflightModel({ baseUrl: configuration.baseUrl, apiKey: configuration.apiKey, model: configuration.model, structuredOutputMode: configuration.structuredOutputMode, streaming: configuration.streaming })
  console.log(`MODEL PREFLIGHT: ${result.responseSucceeded && result.normalizedText && result.structuredOutputSupported ? 'PASS' : 'FAIL'}`)
  console.log(JSON.stringify({ executionMode: 'preflight', network: 'ATTEMPTED', configuration: safeConfiguration, endpoint: buildResponsesEndpoint(configuration.baseUrl), gateway: 'ResponsesModelGateway', errors, result: { ...result, apiKeyConfigured: result.apiKeyConfigured } }, null, 2))
  if (!result.reachable || !result.responseSucceeded || !result.normalizedText || !result.structuredOutputSupported) process.exitCode = 1
}
