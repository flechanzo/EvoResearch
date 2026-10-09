import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { env as processEnv } from 'node:process'

/**
 * The names understood by the existing ResponsesModelGateway and preflight.
 * Keep this list in one place so entrypoints cannot accidentally invent a
 * second model configuration vocabulary.
 */
export const MODEL_CONFIGURATION_KEYS = [
  'EVORESEARCH_MODEL_BASE_URL',
  'EVORESEARCH_MODEL_API_KEY',
  'EVORESEARCH_MODEL',
  'EVORESEARCH_MODEL_PROVIDER',
  'EVORESEARCH_MODEL_STRUCTURED_OUTPUT_MODE',
  'EVORESEARCH_MODEL_STREAMING',
] as const

export type ModelConfigurationKey = typeof MODEL_CONFIGURATION_KEYS[number]
export type ConfigurationSource = 'process' | 'dotenv' | 'missing'
export type StructuredOutputMode = 'native_json_schema' | 'json_object' | 'prompt_json'
export type StreamingMode = 'required' | 'preferred' | 'disabled'

export const PROJECT_ROOT = fileURLToPath(new URL('../../', import.meta.url))

export interface ModelConfigurationEnvironment {
  readonly EVORESEARCH_MODEL_BASE_URL?: string
  readonly EVORESEARCH_MODEL_API_KEY?: string
  readonly EVORESEARCH_MODEL?: string
  readonly EVORESEARCH_MODEL_PROVIDER?: string
  readonly EVORESEARCH_MODEL_STRUCTURED_OUTPUT_MODE?: string
  readonly EVORESEARCH_MODEL_STREAMING?: string
}

/**
 * Runtime configuration. `apiKey` is intentionally available only to the
 * caller that constructs the existing gateway. Do not serialize this object;
 * use `safeModelConfigurationSnapshot` for reports and persistence.
 */
export interface ResolvedModelConfiguration {
  readonly baseUrl: string
  readonly apiKey: string
  readonly model: string
  readonly provider: string
  readonly structuredOutputMode: StructuredOutputMode
  readonly streaming: StreamingMode
  readonly dotenvPath: string
  readonly dotenvLoaded: boolean
  readonly sources: Readonly<Record<ModelConfigurationKey, ConfigurationSource>>
  readonly missing: readonly ModelConfigurationKey[]
  readonly invalid: readonly ModelConfigurationKey[]
  readonly invalidReasons: Readonly<Record<string, string>>
  readonly ready: boolean
}

/** A credential-free view suitable for diagnostics, reports, and snapshots. */
export interface SafeModelConfigurationSnapshot {
  readonly baseUrl: string
  readonly model: string
  readonly provider: string
  readonly structuredOutputMode: StructuredOutputMode
  readonly streaming: StreamingMode
  readonly baseUrlConfigured: boolean
  readonly apiKeyConfigured: boolean
  readonly modelConfigured: boolean
  readonly dotenvPath: string
  readonly dotenvLoaded: boolean
  readonly sources: Readonly<Record<ModelConfigurationKey, ConfigurationSource>>
  readonly missing: readonly ModelConfigurationKey[]
  readonly invalid: readonly ModelConfigurationKey[]
  readonly invalidReasons: Readonly<Record<string, string>>
  readonly ready: boolean
}

export interface ResolveModelConfigurationOptions {
  readonly projectRoot?: string
  readonly dotenvPath?: string
  readonly environment?: Readonly<Record<string, string | undefined>>
  readonly readFile?: (path: string) => string
  readonly exists?: (path: string) => boolean
}

/** Parse the small, deliberately non-expanding .env subset needed by M5A. */
export function parseDotEnv(content: string): Readonly<Record<string, string>> {
  const values: Record<string, string> = {}
  for (const rawLine of content.split(/\r?\n/u)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const assignment = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/u.exec(line)
    if (!assignment) continue
    const key = assignment[1]
    const rawValue = assignment[2].trim()
    values[key] = parseDotEnvValue(rawValue)
  }
  return values
}

function parseDotEnvValue(value: string): string {
  if (value.length >= 2 && value[0] === "'" && value[value.length - 1] === "'") return value.slice(1, -1)
  if (value.length >= 2 && value[0] === '"' && value[value.length - 1] === '"') {
    return value.slice(1, -1).replace(/\\([\\"nrt])/gu, (_match, escaped: string) => ({ n: '\n', r: '\r', t: '\t', '\\': '\\', '"': '"' }[escaped] ?? escaped))
  }
  // In an unquoted value, a comment starts only when preceded by whitespace.
  return value.replace(/\s+#.*$/u, '').trim()
}

/**
 * Resolve process values over a project-root .env file. Process values win
 * even when they are empty; an operator can therefore deliberately disable a
 * dotenv credential without the file silently taking over.
 */
export function resolveModelConfiguration(options: ResolveModelConfigurationOptions = {}): ResolvedModelConfiguration {
  const environment = options.environment ?? processEnv
  const root = options.projectRoot ?? PROJECT_ROOT
  const configuredDotenvPath = options.dotenvPath
  const dotenvPath = configuredDotenvPath
    ? (/^(?:[A-Za-z]:[\\/]|[\\/])/u.test(configuredDotenvPath) ? configuredDotenvPath : resolve(root, configuredDotenvPath))
    : resolve(root, '.env')
  const exists = options.exists ?? existsSync
  const readFile = options.readFile ?? ((path: string) => readFileSync(path, 'utf8'))
  const dotenvLoaded = exists(dotenvPath)
  const dotenv = dotenvLoaded ? parseDotEnv(readFile(dotenvPath)) : {}
  const sources = {} as Record<ModelConfigurationKey, ConfigurationSource>
  const values = {} as Record<ModelConfigurationKey, string | undefined>
  for (const key of MODEL_CONFIGURATION_KEYS) {
    if (Object.prototype.hasOwnProperty.call(environment, key)) {
      values[key] = environment[key]
      sources[key] = 'process'
    } else if (Object.prototype.hasOwnProperty.call(dotenv, key)) {
      values[key] = dotenv[key]
      sources[key] = 'dotenv'
    } else {
      values[key] = undefined
      sources[key] = 'missing'
    }
  }
  const baseUrl = normalizeBaseUrl(values.EVORESEARCH_MODEL_BASE_URL ?? '')
  const apiKey = values.EVORESEARCH_MODEL_API_KEY ?? ''
  const model = trim(values.EVORESEARCH_MODEL)
  const provider = trim(values.EVORESEARCH_MODEL_PROVIDER) || 'openai-compatible'
  const structuredOutputMode = parseStructuredOutputMode(values.EVORESEARCH_MODEL_STRUCTURED_OUTPUT_MODE) ?? 'prompt_json'
  const streaming = parseStreamingMode(values.EVORESEARCH_MODEL_STREAMING) ?? 'required'
  const missing = MODEL_CONFIGURATION_KEYS.filter(key => ['EVORESEARCH_MODEL_BASE_URL', 'EVORESEARCH_MODEL_API_KEY', 'EVORESEARCH_MODEL'].includes(key) && !trim(values[key]))
  const invalid: ModelConfigurationKey[] = []
  const invalidReasons: Record<string, string> = {}
  const markInvalid = (key: ModelConfigurationKey, reason: string): void => { if (!invalid.includes(key)) invalid.push(key); invalidReasons[key] = reason }
  const rawBaseUrl = trim(values.EVORESEARCH_MODEL_BASE_URL)
  if (rawBaseUrl && !isHttpUrl(rawBaseUrl)) markInvalid('EVORESEARCH_MODEL_BASE_URL', 'must be an absolute http:// or https:// URL')
  if (isPlaceholder(rawBaseUrl)) markInvalid('EVORESEARCH_MODEL_BASE_URL', 'contains an unresolved placeholder')
  const rawApiKey = trim(values.EVORESEARCH_MODEL_API_KEY)
  if (isPlaceholder(rawApiKey)) markInvalid('EVORESEARCH_MODEL_API_KEY', 'contains an unresolved placeholder')
  const rawModel = trim(values.EVORESEARCH_MODEL)
  if (isPlaceholder(rawModel)) markInvalid('EVORESEARCH_MODEL', 'contains an unresolved placeholder')
  if (values.EVORESEARCH_MODEL_STRUCTURED_OUTPUT_MODE !== undefined && parseStructuredOutputMode(values.EVORESEARCH_MODEL_STRUCTURED_OUTPUT_MODE) === undefined) markInvalid('EVORESEARCH_MODEL_STRUCTURED_OUTPUT_MODE', 'must be native_json_schema, json_object, or prompt_json')
  if (values.EVORESEARCH_MODEL_STREAMING !== undefined && parseStreamingMode(values.EVORESEARCH_MODEL_STREAMING) === undefined) markInvalid('EVORESEARCH_MODEL_STREAMING', 'must be required, preferred, or disabled')
  // Keep the credential available to the gateway caller while preventing
  // accidental inclusion in JSON snapshots, logs, or object spreads.
  const result = { baseUrl, apiKey, model, provider, structuredOutputMode, streaming, dotenvPath, dotenvLoaded, sources, missing, invalid, invalidReasons, ready: missing.length === 0 && invalid.length === 0 }
  Object.defineProperty(result, 'apiKey', { value: apiKey, enumerable: false, writable: false, configurable: false })
  return result
}

export function safeModelConfigurationSnapshot(config: ResolvedModelConfiguration): SafeModelConfigurationSnapshot {
  return { baseUrl: config.baseUrl, model: config.model, provider: config.provider, structuredOutputMode: config.structuredOutputMode, streaming: config.streaming, baseUrlConfigured: Boolean(config.baseUrl), apiKeyConfigured: Boolean(config.apiKey), modelConfigured: Boolean(config.model), dotenvPath: config.dotenvPath, dotenvLoaded: config.dotenvLoaded, sources: { ...config.sources }, missing: [...config.missing], invalid: [...config.invalid], invalidReasons: { ...config.invalidReasons }, ready: config.ready }
}

export function configurationDiagnostics(config: ResolvedModelConfiguration): string[] {
  return [...config.missing.map(key => `Missing configuration: ${key}`), ...config.invalid.map(key => `Invalid configuration: ${key}${config.invalidReasons[key] ? ` (${config.invalidReasons[key]})` : ''}`)]
}

// Short aliases keep entrypoint wiring readable while preserving one resolver
// and one .env grammar for the entire repository.
export const resolveModelConfig = resolveModelConfiguration
export const loadModelConfiguration = resolveModelConfiguration
export const loadDotEnv = parseDotEnv

function trim(value: string | undefined): string { return typeof value === 'string' ? value.trim() : '' }
function isPlaceholder(value: string): boolean { return /^<[^>]+>$/u.test(value) || /^\$\{[^}]+\}$/u.test(value) || /^(?:your|replace|change)[-_ ]?(?:value|key|token|url|model|endpoint|me)$/iu.test(value) || /^(?:changeme|change_me|todo|tbd)$/iu.test(value) }
function isHttpUrl(value: string): boolean {
  if (isPlaceholder(value)) return false
  try { const url = new URL(value); return (url.protocol === 'http:' || url.protocol === 'https:') && Boolean(url.hostname) } catch { return false }
}
function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim()
  try {
    const url = new URL(trimmed)
    url.username = ''
    url.password = ''
    url.search = ''
    url.hash = ''
    return url.toString().replace(/\/$/u, '')
  } catch {
    // Keep malformed URLs visible as configuration failures, but remove any
    // query/fragment material that could contain an accidental credential.
    return trimmed.split(/[?#]/u, 1)[0].replace(/\/+$/u, '')
  }
}
function parseStructuredOutputMode(value: string | undefined): StructuredOutputMode | undefined { return value === 'native_json_schema' || value === 'json_object' || value === 'prompt_json' ? value : undefined }
function parseStreamingMode(value: string | undefined): StreamingMode | undefined { return value === 'required' || value === 'preferred' || value === 'disabled' ? value : undefined }
