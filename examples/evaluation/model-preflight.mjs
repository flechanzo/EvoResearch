import { preflightModel } from '../../src/adapters/model-preflight.ts'
const result = await preflightModel()
console.log(`MODEL PREFLIGHT: ${result.responseSucceeded && result.normalizedText && result.structuredOutputSupported ? 'PASS' : 'FAIL'}`)
console.log(`EVORESEARCH_MODEL_BASE_URL: ${result.baseUrl ? 'configured' : 'missing'}`)
console.log(`EVORESEARCH_MODEL_API_KEY: ${result.apiKeyConfigured ? 'configured' : 'missing'}`)
console.log(`EVORESEARCH_MODEL: ${result.model ? 'configured' : 'missing'}`)
console.log(`structured output mode: ${result.structuredOutputMode}`)
console.log(JSON.stringify({ ...result, apiKeyConfigured: result.apiKeyConfigured }, null, 2))
if (!result.reachable || !result.responseSucceeded || !result.normalizedText || !result.structuredOutputSupported) process.exitCode = 1
