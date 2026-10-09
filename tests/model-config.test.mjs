import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import test from 'node:test'
import { configurationDiagnostics, parseDotEnv, resolveModelConfiguration, safeModelConfigurationSnapshot } from '../src/config/model-config.ts'

function projectWithEnv(contents) {
  const root = mkdtempSync(resolve(tmpdir(), 'evoresearch-model-config-'))
  writeFileSync(resolve(root, '.env'), contents, 'utf8')
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

test('project-root .env supplies existing EvoResearch model variables', () => {
  const fixture = projectWithEnv([
    'EVORESEARCH_MODEL_BASE_URL=https://model.example/v1/',
    'EVORESEARCH_MODEL_API_KEY=file-secret',
    'EVORESEARCH_MODEL=gpt-file',
    'EVORESEARCH_MODEL_PROVIDER=openai-compatible',
    'EVORESEARCH_MODEL_STRUCTURED_OUTPUT_MODE=prompt_json',
    'EVORESEARCH_MODEL_STREAMING=required',
  ].join('\n'))
  try {
    const config = resolveModelConfiguration({ projectRoot: fixture.root, environment: {} })
    assert.equal(config.baseUrl, 'https://model.example/v1')
    assert.equal(config.apiKey, 'file-secret')
    assert.equal(config.model, 'gpt-file')
    assert.equal(config.provider, 'openai-compatible')
    assert.equal(config.structuredOutputMode, 'prompt_json')
    assert.equal(config.streaming, 'required')
    assert.equal(config.ready, true)
    assert.equal(config.sources.EVORESEARCH_MODEL_API_KEY, 'dotenv')
    assert.equal(config.dotenvLoaded, true)
  } finally { fixture.cleanup() }
})

test('process environment wins over project-root .env, including an explicit blank', () => {
  const fixture = projectWithEnv('EVORESEARCH_MODEL_API_KEY=file-secret\nEVORESEARCH_MODEL=gpt-file\nEVORESEARCH_MODEL_BASE_URL=https://file.example\n')
  try {
    const config = resolveModelConfiguration({ projectRoot: fixture.root, environment: { EVORESEARCH_MODEL_API_KEY: 'process-secret', EVORESEARCH_MODEL: 'gpt-process', EVORESEARCH_MODEL_BASE_URL: 'https://process.example/' } })
    assert.equal(config.apiKey, 'process-secret')
    assert.equal(config.model, 'gpt-process')
    assert.equal(config.baseUrl, 'https://process.example')
    assert.equal(config.sources.EVORESEARCH_MODEL_API_KEY, 'process')
    const blank = resolveModelConfiguration({ projectRoot: fixture.root, environment: { EVORESEARCH_MODEL_API_KEY: '' } })
    assert.equal(blank.apiKey, '')
    assert.equal(blank.sources.EVORESEARCH_MODEL_API_KEY, 'process')
    assert.equal(blank.missing.includes('EVORESEARCH_MODEL_API_KEY'), true)
  } finally { fixture.cleanup() }
})

test('safe snapshots and missing-key diagnostics never expose API key material', () => {
  const fixture = projectWithEnv('EVORESEARCH_MODEL_BASE_URL=https://model.example\nEVORESEARCH_MODEL_API_KEY=super-secret-key\n')
  try {
    const config = resolveModelConfiguration({ projectRoot: fixture.root, environment: {} })
    const snapshot = safeModelConfigurationSnapshot(config)
    const serialized = JSON.stringify(snapshot)
    assert.equal(snapshot.apiKeyConfigured, true)
    assert.equal(serialized.includes('super-secret-key'), false)
    assert.equal(Object.keys(config).includes('apiKey'), false)
    const missing = resolveModelConfiguration({ projectRoot: fixture.root, environment: { EVORESEARCH_MODEL_API_KEY: '' } })
    const diagnostics = configurationDiagnostics(missing).join('\n')
    assert.match(diagnostics, /EVORESEARCH_MODEL_API_KEY/)
    assert.equal(diagnostics.includes('super-secret-key'), false)
  } finally { fixture.cleanup() }
})

test('dotenv parser handles export, quotes, escaped characters, and comments without expansion', () => {
  const parsed = parseDotEnv('export EVORESEARCH_MODEL="gpt\\n6"\nEVORESEARCH_MODEL_PROVIDER=local # comment\nEVORESEARCH_MODEL_API_KEY=literal-$OTHER\n# ignored\n')
  assert.equal(parsed.EVORESEARCH_MODEL, 'gpt\n6')
  assert.equal(parsed.EVORESEARCH_MODEL_PROVIDER, 'local')
  assert.equal(parsed.EVORESEARCH_MODEL_API_KEY, 'literal-$OTHER')
})

test('invalid mode values fail closed with key-only diagnostics', () => {
  const config = resolveModelConfiguration({ environment: { EVORESEARCH_MODEL_BASE_URL: 'https://x', EVORESEARCH_MODEL_API_KEY: 'secret', EVORESEARCH_MODEL: 'm', EVORESEARCH_MODEL_STREAMING: 'sometimes', EVORESEARCH_MODEL_STRUCTURED_OUTPUT_MODE: 'xml' } })
  assert.equal(config.ready, false)
  assert.deepEqual(config.invalid.sort(), ['EVORESEARCH_MODEL_STREAMING', 'EVORESEARCH_MODEL_STRUCTURED_OUTPUT_MODE'])
  assert.deepEqual(configurationDiagnostics(config).sort(), ['Invalid configuration: EVORESEARCH_MODEL_STREAMING (must be required, preferred, or disabled)', 'Invalid configuration: EVORESEARCH_MODEL_STRUCTURED_OUTPUT_MODE (must be native_json_schema, json_object, or prompt_json)'])
})

test('invalid URLs and unresolved placeholders fail closed with safe diagnostics', () => {
  const config = resolveModelConfiguration({ environment: {
    EVORESEARCH_MODEL_BASE_URL: 'ftp://model.example/v1',
    EVORESEARCH_MODEL_API_KEY: '<set-locally>',
    EVORESEARCH_MODEL: '<your-model-id>',
    EVORESEARCH_MODEL_STRUCTURED_OUTPUT_MODE: 'prompt_json',
    EVORESEARCH_MODEL_STREAMING: 'required',
  } })
  assert.equal(config.ready, false)
  assert.deepEqual(config.invalid.sort(), ['EVORESEARCH_MODEL', 'EVORESEARCH_MODEL_API_KEY', 'EVORESEARCH_MODEL_BASE_URL'])
  const diagnostics = configurationDiagnostics(config).join('\n')
  assert.match(diagnostics, /EVORESEARCH_MODEL_BASE_URL.*absolute http/)
  assert.match(diagnostics, /EVORESEARCH_MODEL_API_KEY.*unresolved placeholder/)
  assert.match(diagnostics, /EVORESEARCH_MODEL.*unresolved placeholder/)
  assert.equal(diagnostics.includes('<set-locally>'), false)
})

test('environment-only configuration works without a dotenv file', () => {
  const config = resolveModelConfiguration({ projectRoot: 'C:/missing-evoresearch-project', environment: {
    EVORESEARCH_MODEL_BASE_URL: 'https://env.example/v1',
    EVORESEARCH_MODEL_API_KEY: 'synthetic-key',
    EVORESEARCH_MODEL: 'env-model',
    EVORESEARCH_MODEL_STRUCTURED_OUTPUT_MODE: 'prompt_json',
    EVORESEARCH_MODEL_STREAMING: 'required',
  }, exists: () => false })
  assert.equal(config.ready, true)
  assert.equal(config.dotenvLoaded, false)
  assert.equal(config.sources.EVORESEARCH_MODEL_BASE_URL, 'process')
  assert.equal(config.sources.EVORESEARCH_MODEL_API_KEY, 'process')
})

test('dotenv may hold non-sensitive routing values while the key stays in process environment', () => {
  const fixture = projectWithEnv([
    'EVORESEARCH_MODEL_BASE_URL=https://file.example/v1',
    'EVORESEARCH_MODEL=file-model',
    'EVORESEARCH_MODEL_STRUCTURED_OUTPUT_MODE=prompt_json',
    'EVORESEARCH_MODEL_STREAMING=required',
  ].join('\n'))
  try {
    const config = resolveModelConfiguration({ projectRoot: fixture.root, environment: { EVORESEARCH_MODEL_API_KEY: 'synthetic-process-key' } })
    assert.equal(config.ready, true)
    assert.equal(config.baseUrl, 'https://file.example/v1')
    assert.equal(config.model, 'file-model')
    assert.equal(config.sources.EVORESEARCH_MODEL_BASE_URL, 'dotenv')
    assert.equal(config.sources.EVORESEARCH_MODEL_API_KEY, 'process')
  } finally { fixture.cleanup() }
})
