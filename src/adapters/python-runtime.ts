import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { env } from 'node:process'
import { spawnSync } from 'node:child_process'

export const PROJECT_ROOT = fileURLToPath(new URL('../../', import.meta.url))
export const PDF_SIDECAR = resolve(PROJECT_ROOT, 'scripts/pdf/extract_pymupdf.py')
type Runner = typeof spawnSync
export interface RuntimeOptions {
  readonly projectRoot?: string
  readonly environment?: Readonly<Record<string, string | undefined>>
  readonly pythonExecutable?: string
  readonly exists?: (path: string) => boolean
  readonly runner?: Runner
}

/** A configured runtime must execute successfully; never hide configuration errors. */
export function resolvePythonExecutable(options: RuntimeOptions = {}): string {
  const environment = options.environment ?? env
  const runner = options.runner ?? spawnSync
  const exists = options.exists ?? existsSync
  const root = options.projectRoot ?? PROJECT_ROOT
  const probe = (executable: string) => runner(executable, ['-c', 'import sys; print(sys.executable)'], {
    encoding: 'utf8', timeout: 10000, maxBuffer: 65536, shell: false,
  })
  const explicit = environment.EVORESEARCH_PYTHON ?? options.pythonExecutable
  if (explicit !== undefined) {
    if (!explicit.trim()) throw new Error('Invalid explicit Python executable: empty configuration')
    const result = probe(explicit)
    if (result.error || result.status !== 0) throw new Error(`Invalid explicit Python executable ${explicit}: ${result.error?.message ?? String(result.stderr)}`)
    return explicit
  }
  for (const candidate of [resolve(root, '.venv/Scripts/python.exe'), resolve(root, '.venv/bin/python')]) {
    if (exists(candidate)) return candidate
  }
  const python3 = probe('python3')
  if (!python3.error && python3.status === 0) return 'python3'
  return 'python'
}

export interface PythonPreflight {
  readonly selectedExecutable: string
  readonly sysExecutable: string
  readonly pythonVersion: string
  readonly pymupdfAvailable: boolean
  readonly pymupdfVersion?: string
  readonly sidecarVersion: string
  readonly importName?: string
  readonly error?: string
}

export function preflightPyMuPDF(options: RuntimeOptions & { readonly sidecarPath?: string } = {}): PythonPreflight {
  const selectedExecutable = resolvePythonExecutable(options)
  const result = (options.runner ?? spawnSync)(selectedExecutable, [options.sidecarPath ?? PDF_SIDECAR, '--preflight'], {
    encoding: 'utf8', timeout: 10000, maxBuffer: 65536, shell: false,
  })
  if (result.error) throw new Error(`Python preflight subprocess failed: ${result.error.message}`)
  let data: any
  try { data = JSON.parse(String(result.stdout)) } catch { throw new Error('Python preflight returned malformed JSON') }
  if (typeof data.sysExecutable !== 'string' || typeof data.pythonVersion !== 'string' || typeof data.sidecarVersion !== 'string' || typeof data.pymupdfAvailable !== 'boolean' || (data.pymupdfAvailable && (result.status !== 0 || typeof data.pymupdfVersion !== 'string'))) throw new Error('Invalid Python preflight response')
  return { ...data, selectedExecutable }
}
