import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildResponsesEndpoint } from '../../src/adapters/responses-model.ts'
import { configurationDiagnostics, MODEL_CONFIGURATION_KEYS, resolveModelConfiguration, safeModelConfigurationSnapshot } from '../../src/config/model-config.ts'

const projectRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const configuration = resolveModelConfiguration({ projectRoot })
const snapshot = safeModelConfigurationSnapshot(configuration)
const endpoint = configuration.invalid.includes('EVORESEARCH_MODEL_BASE_URL') || !configuration.baseUrl
  ? ''
  : buildResponsesEndpoint(configuration.baseUrl)
const configurationStatus = Object.fromEntries(MODEL_CONFIGURATION_KEYS.map(key => [key, {
  status: configuration.sources[key] === 'missing' ? 'missing' : 'configured',
  source: configuration.sources[key],
}]))
const report = {
  status: configuration.ready ? 'CONFIG_READY' : 'CONFIG_INVALID',
  executionMode: 'configuration-check',
  network: 'NOT_ATTEMPTED',
  cwd: process.cwd(),
  projectRoot,
  dotenvPath: configuration.dotenvPath,
  dotenvLoaded: configuration.dotenvLoaded,
  configuration: configurationStatus,
  model: snapshot.model,
  endpoint,
  streaming: snapshot.streaming,
  structuredOutputMode: snapshot.structuredOutputMode,
  gateway: 'ResponsesModelGateway',
  errors: configurationDiagnostics(configuration),
}

console.log(JSON.stringify(report, null, 2))
if (!configuration.ready) process.exitCode = 1
