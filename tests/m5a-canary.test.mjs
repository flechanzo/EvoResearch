import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import test from 'node:test'

import { canonicalJson, contentHash, deterministicId } from '../src/domain/ids.ts'
import { replayM5AExtensionArtifacts, runM5ACanary } from '../src/milestone5a/canary.ts'

const now = '2026-10-10T00:00:00.000Z'
const claimId = deterministicId('claim', 'm5a-canary-claim')
const evidenceId = deterministicId('evidence', 'm5a-canary-evidence')
const envValues = {
  EVORESEARCH_MODEL_BASE_URL: 'https://offline.invalid/v1',
  EVORESEARCH_MODEL_API_KEY: 'offline-test-key',
  EVORESEARCH_MODEL: 'offline-test-model',
  EVORESEARCH_MODEL_STRUCTURED_OUTPUT_MODE: 'prompt_json',
  EVORESEARCH_MODEL_STREAMING: 'required',
}

function source({ abstract = false } = {}) {
  return {
    sourceRunId: 'accepted-scientific-fixture',
    inputStateHash: 'a'.repeat(64),
    sourceFiles: {},
    problemGraph: { problems: [], nodes: ['Boundary behavior is unresolved.', 'Transfer behavior is unresolved.', 'Operating range is unresolved.'].map((label, index) => ({ nodeId: deterministicId('graph_node', `m5a-canary-node-${index}`), type: 'limitation', label, evidenceIds: [evidenceId] })), edges: [] },
    claims: [{ claimId, statement: 'Boundary behavior is unresolved.', kind: 'limitation', provenance: { sourceType: 'paper', sourceId: 'paper_offline_fixture', locator: 'Section 4' } }],
    evidence: [{ evidenceId, kind: 'quote', claim: 'Boundary behavior is unresolved.', polarity: 'WEAKEN', provenance: { sourceType: 'paper', sourceId: 'paper_offline_fixture', locator: abstract ? 'Abstract' : 'Section 4', quotedText: 'Boundary behavior is unresolved.' }, claimIds: [claimId], limitations: abstract ? ['Abstract only; full-text and quantitative verification are unavailable.'] : [], confidence: 0.7, createdAt: now, evidenceLevel: abstract ? 'ABSTRACT_EVIDENCE' : 'FULL_TEXT_EVIDENCE', modelInterpretation: false }],
    completeness: { status: 'INCOMPLETE', exhaustive: false, scientificallyComplete: false, deferredOperations: 2, emptyEvidenceOperations: 1, retrievalCoverage: { COMPLETE: 1, FAILED: 1, NO_RESULTS: 1, PARTIAL: 0 }, limitations: ['DEFERRED_OPERATIONS'] },
  }
}

function preflight({ failed = false } = {}) {
  return { baseUrl: envValues.EVORESEARCH_MODEL_BASE_URL, model: envValues.EVORESEARCH_MODEL, apiKeyConfigured: true, endpoint: `${envValues.EVORESEARCH_MODEL_BASE_URL}/responses`, reachable: !failed, responseSucceeded: !failed, normalizedText: !failed, structuredOutputMode: 'prompt_json', streaming: 'required', structuredOutputSupported: !failed, retryable: false, attemptCount: 1, attempts: [{ attemptIndex: 1, transportSucceeded: !failed, outputTextPresent: !failed, retryable: false, retryPerformed: false }], ...(failed ? { errorCategory: 'NETWORK_ERROR', error: 'offline preflight failure' } : {}) }
}

function candidate(request, overrides = {}) {
  const gap = request.input.gaps.find(item => item.sourceEvidenceIds.length) ?? request.input.gaps[0]
  return { candidateId: 'offline-proposal', originatingGapIds: [gap.gapId], sourceProblemNodeIds: gap.sourceProblemNodeIds, sourceClaimIds: gap.sourceClaimIds, sourceEvidenceIds: gap.sourceEvidenceIds, statement: 'A bounded component change may alter the gap-linked behavior.', motivation: 'The source documents an unresolved boundary.', proposedMechanism: 'Replace one component while holding the baseline conditions fixed.', expectedMechanism: 'The measured boundary behavior may change if the component is causal.', assumptions: ['The baseline conditions can be reproduced.'], evidenceFor: [], evidenceAgainst: gap.contradictingEvidenceIds, falsificationConditions: ['Reject if the observable does not change under the controlled comparison.'], expectedObservableResult: 'A measurable difference from the fixed baseline.', discriminativeExperimentIdea: 'Compare the component change against the baseline under identical inputs.', generationOperator: 'REPLACE_COMPONENT', ...overrides }
}

function fakeGateway(output = request => ({ hypotheses: [candidate(request)] })) {
  const calls = []; const attempts = []
  return {
    calls, attempts,
    async structured(request) {
      calls.push(request)
      const diagnostic = { attemptId: request.attemptId, parseStatus: 'success', schemaValidationStatus: 'not-attempted', normalizedTextPresent: true, status: 'SUCCEEDED', outputTrust: 'UNTRUSTED / UNVALIDATED' }
      attempts.push({ ...diagnostic, role: request.role, stage: request.stage, route: request.route, schemaVersion: request.schemaVersion, skillVersion: request.skillVersion, inputArtifactIds: request.inputArtifactIds, inputEvidenceIds: request.inputEvidenceIds })
      const value = request.role === 'GapDiscovery' ? { gaps: [] } : await output(request)
      return { ok: true, value, diagnostic }
    },
    annotateAttempt(attemptId, patch) { const index = attempts.findIndex(item => item.attemptId === attemptId); if (index >= 0) attempts[index] = { ...attempts[index], ...patch } },
  }
}

async function fixture(run) {
  const root = mkdtempSync(resolve(tmpdir(), 'evoresearch-m5a-canary-'))
  const original = Object.fromEntries(Object.keys(envValues).map(key => [key, process.env[key]]))
  for (const [key, value] of Object.entries(envValues)) process.env[key] = value
  try { return await run({ root, options: { source: source(), projectRoot: root, outputRoot: resolve(root, 'outputs'), now } }) } finally {
    for (const [key, value] of Object.entries(original)) { if (value === undefined) delete process.env[key]; else process.env[key] = value }
    rmSync(root, { recursive: true, force: true })
  }
}

function read(directory, name) { return JSON.parse(readFileSync(resolve(directory, name), 'utf8')) }

test('M5A defaults to dry-run and calls neither preflight, model, nor network', async () => {
  await fixture(async ({ options }) => {
    let preflightCalls = 0; const gateway = fakeGateway()
    const result = await runM5ACanary({ ...options, gateway, preflightImpl: async () => { preflightCalls += 1; throw new Error('dry-run must not preflight') } })
    assert.equal(result.mode, 'dry-run')
    assert.equal(result.dryRun.modelCalls, 0)
    assert.equal(result.dryRun.openAlexCalls, 0)
    assert.equal(result.dryRun.networkCalls, 0)
    assert.equal(preflightCalls, 0)
    assert.equal(gateway.calls.length, 0)
    assert.equal(existsSync(result.outputDirectory), false)
  })
})

test('explicit M5A live mode fails preflight before any scientific model call', async () => {
  await fixture(async ({ options }) => {
    let preflightCalls = 0; const gateway = fakeGateway()
    const result = await runM5ACanary({ ...options, mode: 'live', gateway, preflightImpl: async () => { preflightCalls += 1; return preflight({ failed: true }) } })
    assert.equal(result.ok, false)
    assert.equal(preflightCalls, 1)
    assert.equal(gateway.calls.length, 0)
    assert.match(result.errors.join(' '), /PREFLIGHT/)
    assert.equal(result.preflight.status, 'FAILED')
  })
})

for (const [name, output, reason] of [
  ['malformed output', () => ({ wrongEnvelope: true }), /hypotheses/],
  ['verified novelty', request => ({ hypotheses: [candidate(request, { noveltyStatus: 'VERIFIED_NOVEL' })] }), /unsupported|novelty/],
  ['survived status', request => ({ hypotheses: [candidate(request, { status: 'survived' })] }), /unsupported|status/],
  ['unsupported novelty statement', request => ({ hypotheses: [candidate(request, { statement: 'This idea appears novel.' })] }), /novelty|epistemic|unsupported/],
  ['unknown evidence', request => ({ hypotheses: [candidate(request, { sourceEvidenceIds: ['evidence_nonexistent'] })] }), /evidence|provenance/i],
]) {
  test(`M5A rejects ${name} before Generation-0 materialization`, async () => {
    await fixture(async ({ options }) => {
      const gateway = fakeGateway(output)
      const result = await runM5ACanary({ ...options, mode: 'live', gateway, preflight: preflight(), maxSerializationRetries: 0 })
      const population = read(result.outputDirectory, 'generation-0.json')
      assert.equal(population.hypotheses.length, 0)
      assert.ok(population.modelAttempts.some(item => !item.ok))
      assert.match(JSON.stringify(population.rejected), reason)
      assert.ok(gateway.attempts.some(item => item.role === 'HypothesisGenerator' && item.status === 'FAILED' && item.outputTrust === 'UNTRUSTED / UNVALIDATED'))
    })
  })
}

test('M5A serialization retry keeps the scientific task and distinct auditable attempt IDs', async () => {
  await fixture(async ({ options }) => {
    let generationCalls = 0
    const gateway = fakeGateway(request => { generationCalls += 1; return generationCalls === 1 ? { wrongEnvelope: true } : { hypotheses: [candidate(request)] } })
    const result = await runM5ACanary({ ...options, mode: 'live', gateway, preflight: preflight(), maxSerializationRetries: 1 })
    const requests = gateway.calls.filter(item => item.role === 'HypothesisGenerator')
    assert.equal(requests.length, 2)
    assert.notEqual(requests[0].attemptId, requests[1].attemptId)
    assert.deepEqual(requests[0].input.gaps, requests[1].input.gaps)
    assert.deepEqual(requests[0].input.projection, requests[1].input.projection)
    assert.deepEqual(requests[0].inputEvidenceIds, requests[1].inputEvidenceIds)
    assert.match(requests[1].input.serializationRetry.instruction, /same scientific|same.*content|keep.*content/i)
    assert.equal(read(result.outputDirectory, 'generation-0.json').hypotheses.length, 1)
    assert.deepEqual(gateway.attempts.filter(item => item.role === 'HypothesisGenerator').map(item => item.status), ['FAILED', 'SUCCEEDED'])
  })
})

test('M5A preserves abstract-only evidence and incomplete input in population and report', async () => {
  await fixture(async ({ options }) => {
    const acceptedSource = source({ abstract: true }); const frozen = JSON.stringify(acceptedSource)
    const result = await runM5ACanary({ ...options, source: acceptedSource, mode: 'live', gateway: fakeGateway(), preflight: preflight() })
    const population = read(result.outputDirectory, 'generation-0.json')
    const projection = read(result.outputDirectory, 'input-projection.json')
    assert.equal(population.inputCompleteness.scientificallyComplete, false)
    assert.equal(population.inputCompleteness.deferredOperations, 2)
    assert.equal(projection.evidence[0].evidenceLevel, 'ABSTRACT_EVIDENCE')
    assert.ok(population.hypotheses.every(item => item.status === 'candidate' && item.epistemicStatus === 'PROVISIONAL_UNVERIFIED' && item.noveltyStatus === 'UNVERIFIED' && item.inputCompleteness.scientificallyComplete === false))
    const report = readFileSync(resolve(result.outputDirectory, 'report.md'), 'utf8')
    assert.match(report, /abstract.level only|abstract.only/i)
    assert.match(report, /full.text|quantitative/i)
    assert.match(report, /Scientific completeness: false/)
    assert.match(report, /NOVELTY HAS NOT BEEN VERIFIED/)
    assert.match(report, /PRIOR-ART ATTACK HAS NOT RUN/)
    assert.match(report, /FALSIFICATION HAS NOT RUN/)
    assert.match(report, /PARETO SELECTION HAS NOT RUN/)
    assert.equal(JSON.stringify(acceptedSource), frozen)
  })
})

test('M5A report exposes empty extraction and source relevance as quality limitations', async () => {
  await fixture(async ({ options }) => {
    const acceptedSource = source()
    acceptedSource.evidence[0].limitations = ['SOURCE_RELEVANCE_WARNING: selected source is only indirectly related.']
    acceptedSource.completeness = { ...acceptedSource.completeness, emptyEvidenceOperations: 1, relevanceWarnings: ['retrieved source relevance was not independently verified'] }
    const result = await runM5ACanary({ ...options, source: acceptedSource, mode: 'live', gateway: fakeGateway(), preflight: preflight() })
    const report = readFileSync(resolve(result.outputDirectory, 'report.md'), 'utf8')
    assert.match(report, /empty extraction/i)
    assert.match(report, /SOURCE_RELEVANCE_WARNING|relevance/i)
    assert.match(report, /quality limitation/i)
    assert.match(report, /not .*absence of literature/i)
  })
})

test('M5A hypothesis IDs and duplicate decisions are deterministic over identical input', async () => {
  await fixture(async ({ root, options }) => {
    const duplicateOutput = request => ({ hypotheses: [candidate(request, { candidateId: 'first' }), candidate(request, { candidateId: 'second' })] })
    const first = await runM5ACanary({ ...options, outputRoot: resolve(root, 'first'), mode: 'live', gateway: fakeGateway(duplicateOutput), preflight: preflight() })
    const second = await runM5ACanary({ ...options, outputRoot: resolve(root, 'second'), mode: 'live', gateway: fakeGateway(duplicateOutput), preflight: preflight() })
    const a = read(first.outputDirectory, 'generation-0.json'); const b = read(second.outputDirectory, 'generation-0.json')
    assert.equal(a.hypotheses.length, 1)
    assert.equal(a.duplicates.length, 1)
    assert.deepEqual(a.hypotheses.map(item => item.hypothesisId), b.hypotheses.map(item => item.hypothesisId))
    assert.deepEqual(a.duplicates, b.duplicates)
    assert.deepEqual(a.provenance, b.provenance)
  })
})

test('M5A persistence uses one run identity, emits ordered lifecycle events, and writes Markdown', async () => {
  await fixture(async ({ options }) => {
    const result = await runM5ACanary({ ...options, mode: 'live', gateway: fakeGateway(), preflight: preflight() })
    assert.equal(result.ok, true)
    assert.equal(result.runId, result.outputDirectory.split(/[\\/]/).at(-1))
    const snapshot = read(result.outputDirectory, 'run-snapshot.json')
    const checkpoint = read(result.outputDirectory, 'checkpoint.json')
    const state = read(result.outputDirectory, 'state.json')
    const events = read(result.outputDirectory, 'events.json')
    const gapDiscovery = read(result.outputDirectory, 'gap-discovery.json')
    assert.equal(snapshot.runId, result.runId)
    assert.equal(checkpoint.runId, result.runId)
    assert.equal(snapshot.stateHash, checkpoint.stateHash)
    assert.equal(contentHash(canonicalJson(state)), checkpoint.stateHash)
    assert.deepEqual(events.map(item => item.sequence), events.map((_, index) => index + 1))
    assert.equal(new Set(events.map(item => item.eventId)).size, events.length)
    assert.equal(events.at(-1).type, 'checkpoint.created')
    assert.equal(events.at(-1).sequence, checkpoint.sequence)
    assert.ok(events.some(item => item.type === 'stage.started' && item.payload.stage === 'GAP_DISCOVERY'))
    assert.ok(events.some(item => item.type === 'model.attempt' && item.payload.role === 'GapDiscovery'))
    const report = readFileSync(resolve(result.outputDirectory, 'report.md'), 'utf8')
    assert.match(report, /^# EvoResearch M5A canary\n/)
    assert.match(report, /Deterministic gap count:/)
    assert.match(report, /Model-generated gap count:/)
    assert.match(report, /Execution mode: live \(injected boundary\)/)
    assert.match(report, /Gateway: injected ModelGateway/)
    assert.match(report, /Recorded model calls \(including preflight\): 3/)
    assert.match(report, /This execution real HTTP requests: unknown \(injected gateway or preflight\)/)
    assert.equal(gapDiscovery.modelEnvelopeVersion, 'm5a.gap-proposal.v2')
    assert.equal(gapDiscovery.canonicalGapSchemaVersion, 'm4a.gap-discovery.v1')
    assert.deepEqual(gapDiscovery.materialization, { status: 'SUCCEEDED', acceptedGapCount: 0, rejectedReasons: [] })
    assert.match(report, /Model envelope version: m5a\.gap-proposal\.v2/)
    assert.match(report, /Canonical gap schema version: m4a\.gap-discovery\.v1/)
    assert.match(report, /Gap materialization status: SUCCEEDED/)
    assert.doesNotMatch(report, /^\"# EvoResearch/)
    const stageState = read(result.outputDirectory, 'stage-state.json')
    assert.equal(stageState.find(item => item.stage === 'GENERATION_0').status, 'SUCCEEDED')
  })
})

test('M5A persisted extension replays with zero model and search calls and rejects state tampering', async () => {
  await fixture(async ({ options }) => {
    const result = await runM5ACanary({ ...options, mode: 'live', gateway: fakeGateway(), preflight: preflight() })
    const reportPath = resolve(result.outputDirectory, 'report.md')
    const reportBeforeReplay = readFileSync(reportPath, 'utf8')
    const replay = replayM5AExtensionArtifacts(result.outputDirectory)
    assert.equal(replay.runId, result.runId)
    assert.equal(replay.sourceRunId, result.sourceRunId)
    assert.equal(replay.modelCalls, 0)
    assert.equal(replay.searchCalls, 0)
    assert.equal(readFileSync(reportPath, 'utf8'), reportBeforeReplay)
    const statePath = resolve(result.outputDirectory, 'state.json')
    const original = readFileSync(statePath, 'utf8')
    const tampered = JSON.parse(original)
    tampered.limitations = [...(tampered.limitations ?? []), 'tampered']
    writeFileSync(statePath, JSON.stringify(tampered))
    assert.throws(() => replayM5AExtensionArtifacts(result.outputDirectory), /state hash does not match/i)
    writeFileSync(statePath, original)
  })
})

test('M5A GapDiscovery contract failure blocks Generation-0 and is reported as failure', async () => {
  await fixture(async ({ options }) => {
    const calls = []
    const gateway = {
      calls,
      attempts: [],
      async structured(request) {
        calls.push(request)
        return { ok: true, value: { wrongEnvelope: true }, diagnostic: { attemptId: request.attemptId, parseStatus: 'success', schemaValidationStatus: 'not-attempted', normalizedTextPresent: true, status: 'SUCCEEDED', outputTrust: 'UNTRUSTED / UNVALIDATED' } }
      },
      annotateAttempt() {},
    }
    const result = await runM5ACanary({ ...options, mode: 'live', gateway, preflight: preflight(), maxSerializationRetries: 1 })
    assert.equal(result.ok, true)
    assert.equal(result.report.status, 'FAILED')
    assert.equal(result.report.hypothesisCount, 0)
    assert.equal(calls.filter(item => item.role === 'HypothesisGenerator').length, 0)
    const population = read(result.outputDirectory, 'generation-0.json')
    assert.equal(population.hypotheses.length, 0)
    const gapDiscovery = read(result.outputDirectory, 'gap-discovery.json')
    assert.equal(gapDiscovery.modelEnvelopeVersion, 'm5a.gap-proposal.v2')
    assert.equal(gapDiscovery.canonicalGapSchemaVersion, 'm4a.gap-discovery.v1')
    assert.equal(gapDiscovery.materialization.status, 'FAILED')
    assert.equal(gapDiscovery.materialization.acceptedGapCount, 0)
    assert.ok(gapDiscovery.materialization.rejectedReasons.length > 0)
    assert.match(population.limitations.join(' '), /GapDiscovery model contract failed/i)
    const stages = read(result.outputDirectory, 'stage-state.json')
    assert.equal(stages.find(item => item.stage === 'GAP_DISCOVERY').status, 'FAILED')
    assert.equal(stages.find(item => item.stage === 'GENERATION_0').status, 'BLOCKED')
    assert.match(result.errors.join(' '), /GAP_DISCOVERY_FAILED/i)
    assert.match(result.errors.join(' '), /GENERATION_0_BLOCKED_BY_UPSTREAM/i)
    const snapshot = read(result.outputDirectory, 'run-snapshot.json')
    assert.equal(snapshot.failedStage, 'GAP_DISCOVERY')
    const events = read(result.outputDirectory, 'events.json')
    assert.ok(events.some(item => item.type === 'stage.failed' && item.payload.stage === 'GAP_DISCOVERY'))
    assert.equal(events.some(item => item.payload.stage === 'GENERATION_0' && item.type === 'stage.started'), false)
    assert.equal(events.some(item => item.payload.stage === 'GENERATION_0' && item.type === 'stage.failed'), false)
    assert.equal(events.some(item => item.payload.role === 'HypothesisGenerator'), false)
    assert.equal(events.at(-1).payload.status, 'BLOCKED_BY_UPSTREAM')
    assert.equal(events.at(-1).type, 'checkpoint.created')
    const replay = replayM5AExtensionArtifacts(result.outputDirectory)
    assert.equal(replay.modelCalls, 0)
    assert.equal(replay.searchCalls, 0)
  })
})

test('M5A keeps a Generation-0 stream timeout distinct from GapDiscovery failure and does not retry it', async () => {
  await fixture(async ({ options }) => {
    const calls = []
    const attempts = []
    const gateway = {
      calls,
      attempts,
      async structured(request) {
        calls.push(request)
        if (request.role === 'GapDiscovery') {
          const diagnostic = { attemptId: request.attemptId, parseStatus: 'success', schemaValidationStatus: 'not-attempted', normalizedTextPresent: true, status: 'SUCCEEDED', outputTrust: 'UNTRUSTED / UNVALIDATED' }
          attempts.push({ ...diagnostic, role: request.role, stage: request.stage, route: request.route })
          return { ok: true, value: { gaps: [] }, diagnostic }
        }
        const diagnostic = { attemptId: request.attemptId, parseStatus: 'not-attempted', schemaValidationStatus: 'not-attempted', normalizedTextPresent: false, status: 'FAILED', outputTrust: 'UNTRUSTED / UNVALIDATED', errorCategory: 'TIMEOUT', error: 'Responses stream idle timed out', timeoutKind: 'idle', streamEventCount: 0, streamOutputCharacters: 0 }
        attempts.push({ ...diagnostic, role: request.role, stage: request.stage, route: request.route })
        return { ok: false, error: diagnostic.error, diagnostic }
      },
      annotateAttempt() {},
    }
    const result = await runM5ACanary({ ...options, mode: 'live', gateway, preflight: preflight(), maxSerializationRetries: 1 })
    assert.equal(result.ok, true)
    assert.equal(calls.filter(item => item.role === 'GapDiscovery').length, 1)
    assert.equal(calls.filter(item => item.role === 'HypothesisGenerator').length, 1)
    assert.equal(result.report.status, 'FAILED')
    assert.equal(result.report.hypothesisCount, 0)
    assert.match(result.errors.join(' '), /GENERATION_0_FAILED/i)
    assert.doesNotMatch(result.errors.join(' '), /GAP_DISCOVERY_FAILED/i)
    const stages = read(result.outputDirectory, 'stage-state.json')
    assert.equal(stages.find(item => item.stage === 'GAP_DISCOVERY').status, 'SUCCEEDED')
    assert.equal(stages.find(item => item.stage === 'GENERATION_0').status, 'FAILED')
    const population = read(result.outputDirectory, 'generation-0.json')
    assert.equal(population.modelAttempts.length, 1)
    assert.match(population.modelAttempts[0].validationErrors.join(' '), /timed out/i)
    assert.equal(population.modelAttempts[0].diagnostic.errorCategory, 'TIMEOUT')
    const report = readFileSync(resolve(result.outputDirectory, 'report.md'), 'utf8')
    assert.match(report, /GENERATION_0_FAILED/i)
    assert.doesNotMatch(report, /GAP_DISCOVERY_FAILED/i)
    const events = read(result.outputDirectory, 'events.json')
    assert.ok(events.some(item => item.type === 'stage.failed' && item.payload.stage === 'GENERATION_0'))
    assert.equal(events.at(-1).type, 'checkpoint.created')
    const checkpoint = read(result.outputDirectory, 'checkpoint.json')
    assert.equal(events.at(-1).payload.checkpointId, checkpoint.checkpointId)
    const snapshot = read(result.outputDirectory, 'run-snapshot.json')
    assert.equal(snapshot.failedStage, 'GENERATION_0')
    assert.match(snapshot.error, /GENERATION_0_FAILED/i)
  })
})

test('M5A scientific roles reuse ModelGateway and contain no direct HTTP transport', () => {
  const root = resolve(import.meta.dirname, '..')
  for (const path of ['src/milestone5a/gap-reasoning.ts', 'src/milestone4a/hypothesis-generator.ts']) {
    const code = readFileSync(resolve(root, path), 'utf8')
    assert.doesNotMatch(code, /\bfetch\s*\(|\/responses|\/chat\/completions|node:https|node:http/)
    assert.match(code, /gateway\.structured|gateway\?\.structured|options\.gateway\.structured/)
  }
  const coordinator = readFileSync(resolve(root, 'src/milestone5a/canary.ts'), 'utf8')
  assert.match(coordinator, /new ResponsesModelGateway/)
  assert.doesNotMatch(coordinator, /\bfetch\s*\(|\/chat\/completions|node:https|node:http/)
})

