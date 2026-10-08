import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdirSync, readFileSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { boundDocumentContext } from '../src/coordinator/context.ts'
import { ScientificValidationCoordinator, VALIDATION_STAGES } from '../src/coordinator/scientific-validation.ts'

const root = resolve('.tmp-validation-tests')
test('bounded context preserves locators and reports omitted spans', () => { const document = { artifactId: 'a', parser: 'pymupdf', parserVersion: '1', pages: [{ page: 1, text: 'x' }], sections: [], spans: [{ locator: { artifactId: 'a', page: 1, spanIndex: 0, start: 0, end: 100, section: 'Abstract' }, text: 'a'.repeat(100) }, { locator: { artifactId: 'a', page: 1, spanIndex: 1, start: 0, end: 100, section: 'Method' }, text: 'b'.repeat(100) }], extractionWarnings: [] }; const bounded = boundDocumentContext(document, 120); assert.ok(bounded.chunks[0].locators.length); assert.equal(bounded.omittedSpanCount, 1) })
test('coordinator executes inspectable stages in order and persists partial failure', async () => { rmSync(root, { recursive: true, force: true }); mkdirSync(root, { recursive: true }); const order = []; const coordinator = new ScientificValidationCoordinator({ outputRoot: root, caseId: 'case', skillVersions: [] }, () => '2026-01-01T00:00:00.000Z'); const result = await coordinator.run(Object.fromEntries(VALIDATION_STAGES.map(stage => [stage, async () => { order.push(stage); if (stage === 'PROBLEM_GRAPH') throw new Error('graph failed'); return { stage } }]))); assert.deepEqual(order, VALIDATION_STAGES.slice(0, 5)); assert.equal(result.failedStage, 'PROBLEM_GRAPH'); assert.ok(readFileSync(resolve(result.outputDirectory, 'ingest.json'), 'utf8').includes('INGEST')); assert.ok(readFileSync(resolve(result.outputDirectory, 'stage-state.json'), 'utf8').includes('FAILED')) })
