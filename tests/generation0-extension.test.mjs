import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import test from 'node:test'

import { FileGeneration0RunStore } from '../src/adapters/generation0-run-store.ts'
import { runGeneration0Extension } from '../src/coordinator/generation0-extension.ts'
import { deterministicId } from '../src/domain/ids.ts'

const now = '2026-10-10T00:00:00.000Z'
const claimId = deterministicId('claim', 'generation0-store-claim')
const evidenceId = deterministicId('evidence', 'generation0-store-evidence')
const nodeId = deterministicId('graph_node', 'generation0-store-node')

function input(store) {
  return {
    runId: 'run_generation0_store_fixture', sourceRunId: 'source_m35c_fixture', store,
    problemGraph: { problems: [], nodes: [{ nodeId, type: 'limitation', label: 'The baseline fails at a bounded boundary.', evidenceIds: [evidenceId] }], edges: [] },
    claims: [{ claimId, statement: 'The baseline fails at a bounded boundary.', kind: 'limitation', provenance: { sourceType: 'paper', sourceId: 'fixture-paper' } }],
    evidence: [{ evidenceId, kind: 'observation', claim: 'The baseline fails at a bounded boundary.', polarity: 'WEAKEN', provenance: { sourceType: 'paper', sourceId: 'fixture-paper' }, claimIds: [claimId], limitations: [], confidence: 0.8, createdAt: now }],
    completeness: { status: 'INCOMPLETE', exhaustive: false, scientificallyComplete: false, deferredOperations: 0, retrievalCoverage: { COMPLETE: 1, FAILED: 0, NO_RESULTS: 0, PARTIAL: 0 } }, now,
  }
}

test('Generation-0 RunStore commits three boundaries and fully replays without calls', async () => {
  const root = mkdtempSync(resolve(tmpdir(), 'evoresearch-generation0-store-'))
  try {
    const store = new FileGeneration0RunStore(root)
    const first = await runGeneration0Extension(input(store), { configuration: { schemaVersion: 'fixture-v1' } })
    assert.equal(first.status, 'COMPLETE')
    assert.deepEqual(Object.keys(first.boundaryCheckpoints).sort(), ['EVALUATE', 'GAP_DISCOVERY', 'GENERATION_0'])
    assert.equal(first.events.at(-1).type, 'checkpoint.created')
    const calls = []
    const replay = await runGeneration0Extension({ ...input(store), gateway: { structured: async request => { calls.push(request); throw new Error('replay must not invoke model') } } }, { configuration: { schemaVersion: 'fixture-v1' } })
    assert.equal(replay.replayed, true)
    assert.equal(calls.length, 0)
    assert.deepEqual(replay.events, first.events)
    const generationPath = resolve(root, 'generation0-generation_0.json')
    const generation = JSON.parse(readFileSync(generationPath, 'utf8'))
    generation.state.tampered = true
    writeFileSync(generationPath, JSON.stringify(generation))
    await assert.rejects(() => runGeneration0Extension(input(store), { configuration: { schemaVersion: 'fixture-v1' } }), /RUNSTORE_HASH_MISMATCH|RUNSTORE_MANIFEST_MISMATCH/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('RunStore fail-closes when an external attempt is left unknown', async () => {
  const root = mkdtempSync(resolve(tmpdir(), 'evoresearch-generation0-pending-'))
  try {
    const store = new FileGeneration0RunStore(root)
    store.open({ runId: 'run_generation0_pending', sourceRunId: 'source_fixture', config: { schemaVersion: 'fixture-v1' } })
    store.beginAttempt({ attemptId: 'attempt_pending', role: 'GapDiscovery', startedAt: now })
    await assert.rejects(() => runGeneration0Extension({ ...input(store), runId: 'run_generation0_pending', sourceRunId: 'source_fixture' }, { configuration: { schemaVersion: 'fixture-v1' } }), /INTERRUPTED\/UNKNOWN/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

