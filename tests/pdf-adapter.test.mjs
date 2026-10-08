import assert from 'node:assert/strict'
import test from 'node:test'
import { ingestArtifact, extractDocument } from '../src/domain/index.ts'
import { FastPdfReader, PyMuPDFReader, extractWithFallback } from '../src/adapters/pdf.ts'

const now = '2026-09-28T00:00:00.000Z'

test('fallback records fast failure and accepts a robust adapter only after quality passes', () => {
  const bytes = new TextEncoder().encode('text')
  const manifest = ingestArtifact(bytes, { paperId: 'p', originalFilename: 'p.pdf', mediaType: 'application/pdf', ingestionTimestamp: now })
  const fast = new FastPdfReader()
  const robust = { name: 'fake-robust', version: '1', canHandle: () => true, extract: () => ({ artifactId: manifest.artifactId, parser: 'pymupdf', parserVersion: '1', pages: [{ page: 1, text: 'decoded text' }], sections: [], spans: [{ locator: { artifactId: manifest.artifactId, page: 1, spanIndex: 0, start: 0, end: 12 }, text: 'decoded text' }], extractionWarnings: [] }) }
  const result = extractWithFallback(manifest, bytes, { fast, robust })
  assert.equal(result.document.pages[0].text, 'decoded text')
  assert.equal(result.attempts.length, 2)
})

test('PyMuPDF subprocess failure is typed as a fallback attempt', () => {
  const bytes = new TextEncoder().encode('text')
  const manifest = ingestArtifact(bytes, { paperId: 'p', originalFilename: 'p.pdf', mediaType: 'application/pdf', ingestionTimestamp: now, localPath: 'missing.pdf' })
  const result = extractWithFallback(manifest, bytes, { fast: { name: 'empty-fast', version: '1', canHandle: () => true, extract: () => extractDocument(manifest, new Uint8Array()) }, robust: new PyMuPDFReader({ pythonExecutable: 'definitely-not-a-python-executable' }) })
  assert.equal(result.document, undefined)
  assert.match(result.attempts[1].error, /subprocess failed|spawn/i)
})

test('fast extraction locators resolve to stable source spans', () => {
  const bytes = new TextEncoder().encode('Heading\nText')
  const manifest = ingestArtifact(bytes, { paperId: 'p', originalFilename: 'p.txt', mediaType: 'text/plain', ingestionTimestamp: now })
  const document = extractDocument(manifest, bytes)
  const locator = document.spans[0].locator
  assert.equal(JSON.stringify(locator), JSON.stringify(document.spans.find(span => JSON.stringify(span.locator) === JSON.stringify(locator)).locator))
})
