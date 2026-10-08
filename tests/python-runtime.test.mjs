import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import test from 'node:test'
import { resolvePythonExecutable, preflightPyMuPDF } from '../src/adapters/python-runtime.ts'

const success = { status: 0, stdout: 'python', stderr: '' }
test('project-local Windows then POSIX virtual environment precedes PATH probes', () => {
  const root = resolve('runtime-fixture')
  const options = { projectRoot: root, environment: {}, runner: () => { throw new Error('unexpected PATH probe') } }
  assert.equal(resolvePythonExecutable({ ...options, exists: () => true }), resolve(root, '.venv/Scripts/python.exe'))
  assert.equal(resolvePythonExecutable({ ...options, exists: path => path.endsWith('/python') || path.endsWith('bin\\python') }), resolve(root, '.venv/bin/python'))
})
test('environment override precedes local runtime and injected executable option', () => {
  const calls = []
  assert.equal(resolvePythonExecutable({ environment: { EVORESEARCH_PYTHON: 'path with spaces/python' }, pythonExecutable: 'ignored', runner: (command, args, options) => { calls.push({ command, args, options }); return success } }), 'path with spaces/python')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].options.shell, false)
})
test('invalid explicit override fails immediately without fallback', () => {
  let probes = 0
  assert.throws(() => resolvePythonExecutable({ environment: { EVORESEARCH_PYTHON: 'missing' }, exists: () => true, runner: () => { probes++; return { ...success, status: 1 } } }), /Invalid explicit/)
  assert.equal(probes, 1)
  assert.throws(() => resolvePythonExecutable({ environment: { EVORESEARCH_PYTHON: '' } }), /empty configuration/)
})
test('PATH fallback probes python3 before selecting python', () => {
  assert.equal(resolvePythonExecutable({ environment: {}, exists: () => false, runner: () => success }), 'python3')
  assert.equal(resolvePythonExecutable({ environment: {}, exists: () => false, runner: () => ({ ...success, status: 1 }) }), 'python')
})
test('preflight reports missing PyMuPDF without trying another runtime', () => {
  const result = preflightPyMuPDF({ environment: {}, exists: () => true, runner: () => ({ status: 2, stderr: '', stdout: JSON.stringify({ sysExecutable: '/venv/python', pythonVersion: '3.11', pymupdfAvailable: false, sidecarVersion: 'test', error: 'PyMuPDF unavailable' }) }) })
  assert.equal(result.pymupdfAvailable, false)
  assert.match(result.error, /unavailable/)
})
test('successful preflight preserves actual interpreter and package versions', () => {
  const result = preflightPyMuPDF({ environment: {}, exists: () => true, runner: () => ({ ...success, stdout: JSON.stringify({ sysExecutable: '/venv/python', pythonVersion: '3.11.7', pymupdfAvailable: true, pymupdfVersion: '1.26.0', sidecarVersion: 'test', importName: 'pymupdf' }) }) })
  assert.equal(result.sysExecutable, '/venv/python')
  assert.equal(result.pymupdfVersion, '1.26.0')
  assert.equal(result.importName, 'pymupdf')
})
