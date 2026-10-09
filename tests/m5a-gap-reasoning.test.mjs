import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { canonicalJson, deterministicId } from '../src/domain/ids.ts'
import { projectM5AInput } from '../src/milestone5a/projection.ts'
import { runModelGapDiscovery, validateLegacyGapDiscoveryOutput } from '../src/milestone5a/gap-reasoning.ts'

const now = '2026-10-10T00:00:00.000Z'
const nodeId = deterministicId('graph_node', 'm5a-node')
const secondNodeId = deterministicId('graph_node', 'm5a-node-2')
const claimId = deterministicId('claim', 'm5a-claim')
const evidenceId = deterministicId('evidence', 'm5a-direct')
const abstractEvidenceId = deterministicId('evidence', 'm5a-abstract')
const interpretationEvidenceId = deterministicId('evidence', 'm5a-interpretation')

function evidence(overrides = {}) {
  return {
    evidenceId,
    kind: 'observation',
    claim: 'The baseline fails at the boundary.',
    polarity: 'WEAKEN',
    provenance: { sourceType: 'paper', sourceId: 'paper_m5a' },
    claimIds: [claimId],
    limitations: [],
    confidence: 0.8,
    createdAt: now,
    ...overrides,
  }
}

function interpretationEvidence() {
  return evidence({ evidenceId: interpretationEvidenceId, kind: 'interpretation', evidenceLevel: 'MODEL_INTERPRETATION', modelInterpretation: true, sourceTextVerified: false, limitations: ['model interpretation fixture'] })
}

function input(overrides = {}) {
  return {
    problemGraph: {
      problems: [],
      nodes: [
        { nodeId, type: 'limitation', label: 'The baseline fails at the boundary.', evidenceIds: [evidenceId] },
        { nodeId: secondNodeId, type: 'open-question', label: 'Transfer remains untested.', evidenceIds: [] },
      ],
      edges: [{ edgeId: deterministicId('graph_edge', 'm5a-edge'), from: nodeId, to: secondNodeId, relation: 'LEAVES_OPEN', evidenceIds: [evidenceId] }],
    },
    claims: [{ claimId, statement: 'The baseline fails at the boundary.', kind: 'limitation', provenance: { sourceType: 'paper', sourceId: 'paper_m5a' } }],
    evidence: [evidence()],
    completeness: { status: 'INCOMPLETE', exhaustive: false, scientificallyComplete: false, deferredOperations: ['deferred-1'], retrievalCoverage: { COMPLETE: 1, FAILED: 0, NO_RESULTS: 0, PARTIAL: 0 } },
    now,
    ...overrides,
  }
}

function diagnostic(attemptId) {
  return { attemptId, normalizedTextPresent: true, parseStatus: 'success', schemaValidationStatus: 'not-attempted', status: 'SUCCEEDED', outputTrust: 'UNTRUSTED / UNVALIDATED' }
}

function modelGap(overrides = {}) {
  return {
    kind: 'KNOWN_LIMITATION',
    statement: 'The baseline fails at the boundary.',
    coverageState: 'SCIENTIFIC',
    sourceProblemIds: [nodeId],
    sourceClaimIds: [claimId],
    evidenceReferences: [{ evidenceId, relation: 'CONTRADICTS' }],
    uncertainty: { level: 0.5, reasons: ['bounded fixture'] },
    rationale: 'model synthesis',
    ...overrides,
  }
}

test('bounded M5A projection is deterministic and records omitted scientific state', () => {
  const state = input()
  const first = projectM5AInput(state, [], { maxProblemNodes: 1, maxEdges: 1, maxClaims: 0, maxEvidence: 0, maxGaps: 0 })
  const second = projectM5AInput(state, [], { maxProblemNodes: 1, maxEdges: 1, maxClaims: 0, maxEvidence: 0, maxGaps: 0 })
  assert.deepEqual(second, first)
  assert.equal(first.includedProblemNodeIds.length, 1)
  assert.equal(first.omittedCounts.problemNodes, 1)
  assert.equal(first.omittedCounts.claims, 1)
  assert.equal(first.omittedCounts.evidence, 1)
  assert.equal(first.truncation.truncated, true)
  assert.ok(first.limitations.length > 0)
})

test('GapDiscovery retries structural output with the same projection and distinct attempts', async () => {
  const state = input()
  const requests = []
  const gateway = {
    structured: async request => {
      requests.push(request)
      return requests.length === 1
        ? { ok: true, value: { invalid: true }, diagnostic: diagnostic(request.attemptId) }
        : { ok: true, value: { gaps: [modelGap()] }, diagnostic: diagnostic(request.attemptId) }
    },
    annotateAttempt() {},
  }
  const result = await runModelGapDiscovery(state, { gateway, route: { provider: 'offline', model: 'mock' }, maxSerializationRetries: 1 })
  assert.equal(result.modelGaps.length, 1)
  assert.deepEqual(result.attempts.map(attempt => attempt.status), ['FAILED', 'SUCCEEDED'])
  assert.notEqual(requests[0].attemptId, requests[1].attemptId)
  assert.equal(requests[0].input.projection.projectionId, requests[1].input.projection.projectionId)
  assert.deepEqual(requests[0].input.projection.includedEvidenceIds, requests[1].input.projection.includedEvidenceIds)
})

test('explicit legacy validation rejects the historical provenance error and accepts its corrected field mapping', () => {
  const state = input({ evidence: [evidence(), interpretationEvidence()] })
  const fixture = name => JSON.parse(readFileSync(resolve('tests', 'fixtures', 'm5a-gap-discovery', name), 'utf8'))
  const replaceIds = value => JSON.parse(JSON.stringify(value).replaceAll('fixture-problem-node', nodeId).replaceAll('fixture-claim', claimId).replaceAll('fixture-model-interpretation-evidence', interpretationEvidenceId))
  assert.throws(() => validateLegacyGapDiscoveryOutput(replaceIds(fixture('failed-attempt-1.json')), state), /cannot be source evidence/i)
  const gaps = validateLegacyGapDiscoveryOutput(replaceIds(fixture('corrected-attempt-2.json')), state)
  assert.equal(gaps.length, 1)
  assert.deepEqual(gaps[0].sourceEvidenceIds, [])
  assert.deepEqual(gaps[0].interpretationEvidenceIds, [interpretationEvidenceId])
})

test('RUN B bounded rationale is accepted while unbounded epistemic claims remain rejected', async () => {
  const state = input()
  const bounded = JSON.parse(readFileSync(resolve('tests', 'fixtures', 'm5a-gap-discovery', 'run-b-bounded-rationale.json'), 'utf8'))
  const replaceIds = value => JSON.parse(JSON.stringify(value).replaceAll('fixture-problem-node', nodeId).replaceAll('fixture-claim', claimId).replaceAll('fixture-direct-evidence', evidenceId))
  const accepted = validateLegacyGapDiscoveryOutput(replaceIds(bounded), state)
  assert.equal(accepted.length, 1)

  for (const rationale of [
    'This method is novel.',
    'No prior work exists for this method.',
    'This proves the mechanism is true.',
    'The claim is false.',
    'Nobody has studied this mechanism.',
  ]) {
    const rejected = await runModelGapDiscovery(input(), { gateway: { structured: async request => ({ ok: true, value: { gaps: [modelGap({ rationale })] }, diagnostic: diagnostic(request.attemptId) }), annotateAttempt() {} }, route: { provider: 'offline', model: 'fixture' }, maxSerializationRetries: 0 })
    assert.deepEqual(rejected.modelGaps, [], rationale)
    assert.equal(rejected.rejected[0].validationCode, 'UNSUPPORTED_SCIENTIFIC_CONCLUSION', rationale)
  }
})

test('RUN B exact rejected rationale text is preserved in the new envelope contract', async () => {
  const state = input()
  const rejectedFixture = JSON.parse(readFileSync(resolve('tests', 'fixtures', 'm5a-gap-discovery', 'run-b-rejected-rationale.json'), 'utf8'))
  const replaceIds = value => JSON.parse(JSON.stringify(value).replaceAll('fixture-problem-node', nodeId).replaceAll('fixture-claim', claimId).replaceAll('fixture-direct-evidence', evidenceId))
  const historical = replaceIds(rejectedFixture).gaps[0]
  const envelope = { gaps: [modelGap({ statement: historical.statement, rationale: historical.rationale, uncertainty: historical.uncertainty })] }
  const result = await runModelGapDiscovery(state, { gateway: { structured: async request => ({ ok: true, value: envelope, diagnostic: diagnostic(request.attemptId) }), annotateAttempt() {} }, route: { provider: 'offline', model: 'fixture' }, maxSerializationRetries: 0 })
  assert.match(rejectedFixture.gaps[0].rationale, /no evidence/)
  assert.equal(/\bno evidence\b/i.test(rejectedFixture.gaps[0].rationale), true)
  assert.equal(result.modelGaps.length, 1)
})

test('dangling model evidence, claim, and problem references fail closed without accepted gaps', async () => {
  const state = input()
  const gateway = { structured: async request => ({ ok: true, value: { gaps: [modelGap({ evidenceReferences: [{ evidenceId: 'missing-evidence', relation: 'CONTRADICTS' }] })] }, diagnostic: diagnostic(request.attemptId) }), annotateAttempt() {} }
  const result = await runModelGapDiscovery(state, { gateway, route: { provider: 'offline', model: 'mock' }, maxSerializationRetries: 0 })
  assert.deepEqual(result.modelGaps, [])
  assert.equal(result.attempts[0].status, 'FAILED')
  assert.match(result.rejected[0].reason, /evidence|provenance|origin|graph node|problem node/i)

  const claimGateway = { structured: async request => ({ ok: true, value: { gaps: [modelGap({ sourceClaimIds: ['missing-claim'] })] }, diagnostic: diagnostic(request.attemptId) }), annotateAttempt() {} }
  const claimResult = await runModelGapDiscovery(state, { gateway: claimGateway, route: { provider: 'offline', model: 'mock' }, maxSerializationRetries: 0 })
  assert.deepEqual(claimResult.modelGaps, [])
  assert.match(claimResult.rejected[0].reason, /claim|provenance/i)

  const nodeGateway = { structured: async request => ({ ok: true, value: { gaps: [modelGap({ sourceProblemIds: ['missing-node'] })] }, diagnostic: diagnostic(request.attemptId) }), annotateAttempt() {} }
  const nodeResult = await runModelGapDiscovery(state, { gateway: nodeGateway, route: { provider: 'offline', model: 'mock' }, maxSerializationRetries: 0 })
  assert.deepEqual(nodeResult.modelGaps, [])
  assert.match(nodeResult.rejected[0].reason, /problem (?:node|ID)|provenance/i)
})

test('coverage-only model output cannot be renamed into a scientific gap', async () => {
  const state = input()
  const gateway = { structured: async request => ({ ok: true, value: { gaps: [modelGap({ kind: 'INCOMPLETE_EVIDENCE_COVERAGE', coverageState: 'SCIENTIFIC', sourceProblemIds: [], sourceClaimIds: [], evidenceReferences: [], statement: 'Evidence coverage is incomplete.' })] }, diagnostic: diagnostic(request.attemptId) }), annotateAttempt() {} }
  const result = await runModelGapDiscovery(state, { gateway, route: { provider: 'offline', model: 'mock' }, maxSerializationRetries: 0 })
  assert.equal(result.modelGaps.length, 1, JSON.stringify(result.rejected))
  assert.equal(result.modelGaps[0].coverageState, 'COVERAGE_ONLY')
  assert.equal(result.modelGaps[0].eligibility.eligible, false)
  assert.equal(result.modelGaps[0].eligibility.code, 'COVERAGE_FOLLOWUP_REQUIRED')
})

test('coverage wording without scientific provenance is canonicalized as coverage-only', async () => {
  const state = input()
  const gateway = { structured: async request => ({ ok: true, value: { gaps: [modelGap({ kind: 'KNOWN_LIMITATION', coverageState: 'SCIENTIFIC', sourceProblemIds: [], sourceClaimIds: [], evidenceReferences: [], statement: 'Evidence coverage is incomplete.' })] }, diagnostic: diagnostic(request.attemptId) }), annotateAttempt() {} }
  const result = await runModelGapDiscovery(state, { gateway, route: { provider: 'offline', model: 'mock' }, maxSerializationRetries: 0 })
  assert.equal(result.modelGaps.length, 1)
  assert.equal(result.modelGaps[0].coverageState, 'COVERAGE_ONLY')
  assert.equal(result.modelGaps[0].eligibility.eligible, false)
})

test('MIXED model gap with interpretation-only provenance is rejected without retry', async () => {
  const state = input({ evidence: [evidence(), interpretationEvidence()] })
  const requests = []
  const gateway = { structured: async request => { requests.push(request); return { ok: true, value: { gaps: [modelGap({ kind: 'KNOWN_LIMITATION', coverageState: 'MIXED', sourceProblemIds: [], sourceClaimIds: [], evidenceReferences: [{ evidenceId: interpretationEvidenceId, relation: 'QUALIFIES' }], statement: 'The mechanism remains unresolved in the supplied evidence.' })] }, diagnostic: diagnostic(request.attemptId) } }, annotateAttempt() {} }
  const result = await runModelGapDiscovery(state, { gateway, route: { provider: 'offline', model: 'mock' }, maxSerializationRetries: 1 })
  assert.deepEqual(result.modelGaps, [])
  assert.match(result.rejected[0].reason, /mixed|provenance/i)
  assert.equal(requests.length, 1)
})

test('independently grounded MIXED model gap remains eligible while preserving interpretation evidence', async () => {
  const state = input({ evidence: [evidence(), interpretationEvidence()] })
  const gateway = { structured: async request => ({ ok: true, value: { gaps: [modelGap({ coverageState: 'MIXED', statement: 'A synthesized boundary gap.', evidenceReferences: [{ evidenceId, relation: 'CONTRADICTS' }, { evidenceId: interpretationEvidenceId, relation: 'QUALIFIES' }], rationale: 'mixed source and coverage context' })] }, diagnostic: diagnostic(request.attemptId) }), annotateAttempt() {} }
  const result = await runModelGapDiscovery(state, { gateway, route: { provider: 'offline', model: 'mock' }, maxSerializationRetries: 0 })
  assert.equal(result.modelGaps.length, 1)
  assert.equal(result.modelGaps[0].coverageState, 'MIXED')
  assert.equal(result.modelGaps[0].eligibility.eligible, true)
  assert.equal(result.modelGaps[0].epistemicStatus, 'MODEL_INTERPRETATION')
  assert.deepEqual(result.modelGaps[0].interpretationEvidenceIds, [interpretationEvidenceId])
})

test('projection hard-bounds the complete serialized context and hashes scientific content', () => {
  const huge = 'scientific limitation '.repeat(900)
  const bounded = projectM5AInput(input({ explicitLimitations: [huge, huge] }), [], { maxCharacters: 5000 })
  assert.ok(canonicalJson(bounded).length <= 5000)
  const changed = projectM5AInput(input({ evidence: [evidence({ claim: 'A changed source claim.' })] }), [])
  const original = projectM5AInput(input(), [])
  assert.notEqual(changed.projectionId, original.projectionId)
})

test('model references outside the bounded projection are rejected', async () => {
  const state = input()
  const calls = []
  const gateway = { structured: async request => { calls.push(request); return { ok: true, value: { gaps: [modelGap()] }, diagnostic: diagnostic(request.attemptId) } }, annotateAttempt() {} }
  const result = await runModelGapDiscovery(state, { gateway, route: { provider: 'offline', model: 'mock' }, maxSerializationRetries: 1, projectionLimits: { maxEvidence: 0 } })
  assert.deepEqual(result.modelGaps, [])
  assert.equal(calls.length, 1)
  assert.match(result.rejected[0].reason, /evidence|provenance|origin|graph node|problem node/i)
  const includedEvidence = new Set(result.projection.includedEvidenceIds)
  for (const gap of result.projection.gaps) {
    assert.ok([...gap.sourceEvidenceIds, ...gap.interpretationEvidenceIds, ...gap.supportingEvidenceIds, ...gap.contradictingEvidenceIds].every(id => includedEvidence.has(id)))
  }
})

test('abstract evidence remains scientific evidence unless coverage wording says otherwise', async () => {
  const state = input({ evidence: [evidence(), evidence({ evidenceId: abstractEvidenceId, evidenceLevel: 'ABSTRACT_EVIDENCE' })] })
  const gateway = { structured: async request => ({ ok: true, value: { gaps: [modelGap({ sourceProblemIds: [], sourceClaimIds: [], evidenceReferences: [{ evidenceId: abstractEvidenceId, relation: 'MOTIVATES' }], statement: 'An abstract-level source leaves a mechanism unresolved.' })] }, diagnostic: diagnostic(request.attemptId) }), annotateAttempt() {} }
  const result = await runModelGapDiscovery(state, { gateway, route: { provider: 'offline', model: 'mock' }, maxSerializationRetries: 0 })
  assert.equal(result.modelGaps.length, 1)
  assert.equal(result.modelGaps[0].coverageState, 'SCIENTIFIC')
  assert.equal(result.modelGaps[0].eligibility.eligible, true)
})

test('novelty and absence assertions fail closed without a semantic retry', async () => {
  for (const statement of ['This method is novel.', 'No literature exists for this method.']) {
    const calls = []
    const gateway = { structured: async request => { calls.push(request); return { ok: true, value: { gaps: [modelGap({ statement })] }, diagnostic: diagnostic(request.attemptId) } }, annotateAttempt() {} }
    const result = await runModelGapDiscovery(input(), { gateway, route: { provider: 'offline', model: 'mock' }, maxSerializationRetries: 1 })
    assert.deepEqual(result.modelGaps, [])
    assert.equal(calls.length, 1)
    assert.equal(result.rejected[0].validationCode, 'UNSUPPORTED_SCIENTIFIC_CONCLUSION')
  }
})

test('missing or unknown coverage state fails closed without defaulting to scientific', async () => {
  for (const coverageState of [undefined, 'UNKNOWN']) {
    const calls = []
    const gap = modelGap(coverageState === undefined ? { coverageState: undefined } : { coverageState })
    const gateway = { structured: async request => { calls.push(request); return { ok: true, value: { gaps: [gap] }, diagnostic: diagnostic(request.attemptId) } }, annotateAttempt() {} }
    const result = await runModelGapDiscovery(input(), { gateway, route: { provider: 'offline', model: 'mock' }, maxSerializationRetries: 1 })
    assert.deepEqual(result.modelGaps, [])
    assert.equal(calls.length, 1)
    assert.equal(result.rejected[0].validationCode, 'INVALID_GAP_STATE')
  }
})

test('the default v2 envelope rejects app-owned role arrays and exposes authoritative role groups', async () => {
  const requests = []
  const gateway = { structured: async request => { requests.push(request); return { ok: true, value: { gaps: [modelGap({ sourceEvidenceIds: [evidenceId] })] }, diagnostic: diagnostic(request.attemptId) } }, annotateAttempt() {} }
  const result = await runModelGapDiscovery(input(), { gateway, route: { provider: 'offline', model: 'fixture' }, maxSerializationRetries: 0 })
  assert.deepEqual(result.modelGaps, [])
  assert.match(result.rejected[0].reason, /sourceEvidenceIds|unsupported field/i)
  assert.deepEqual(requests[0].input.evidenceByAuthoritativeRole.directSourceEvidenceIds, [evidenceId])
  assert.deepEqual(requests[0].input.evidenceByAuthoritativeRole.modelInterpretationEvidenceIds, [])
  assert.equal(requests[0].schemaVersion, 'm5a.gap-proposal.v2')
})

test('both minimized historical IDs fail the explicit legacy source-role invariant while v2 rejects the old shape', async () => {
  const ids = ['evidence_0aef6af33b733efa6f20e5bf', 'evidence_04ab12c45e4132475600fcc0']
  const historicalState = input({ evidence: [evidence(), ...ids.map(id => evidence({ evidenceId: id, sourceTextVerified: false, evidenceLevel: 'FULL_TEXT_EVIDENCE', modelInterpretation: false }))] })
  for (const id of ids) {
    const old = { gaps: [{ kind: 'KNOWN_LIMITATION', statement: 'The baseline fails at the boundary.', coverageState: 'SCIENTIFIC', sourceProblemNodeIds: [nodeId], sourceClaimIds: [claimId], sourceEvidenceIds: [id], interpretationEvidenceIds: [], supportingEvidenceIds: [], contradictingEvidenceIds: [], originatingLimitations: [nodeId], originatingOpenQuestions: [], originatingAssumptions: [], originatingFailureCases: [], uncertainty: { level: 0.5, reasons: ['fixture'] }, rationale: 'bounded fixture' }] }
    assert.throws(() => validateLegacyGapDiscoveryOutput(old, historicalState), /cannot be source evidence/i)
    const result = await runModelGapDiscovery(historicalState, { gateway: { structured: async request => ({ ok: true, value: old, diagnostic: diagnostic(request.attemptId) }), annotateAttempt() {} }, route: { provider: 'offline', model: 'fixture' }, maxSerializationRetries: 0 })
    assert.deepEqual(result.modelGaps, [])
    assert.match(result.rejected[0].reason, /unsupported field|sourceEvidenceIds/i)
  }
})

test('v2 materialization deduplicates identical references and rejects contradictory relations', async () => {
  const duplicate = await runModelGapDiscovery(input(), { gateway: { structured: async request => ({ ok: true, value: { gaps: [modelGap({ evidenceReferences: [{ evidenceId, relation: 'SUPPORTS' }, { evidenceId, relation: 'SUPPORTS' }] })] }, diagnostic: diagnostic(request.attemptId) }), annotateAttempt() {} }, route: { provider: 'offline', model: 'fixture' }, maxSerializationRetries: 0 })
  assert.equal(duplicate.modelGaps.length, 1)
  assert.deepEqual(duplicate.modelGaps[0].sourceEvidenceIds, [evidenceId])
  assert.deepEqual(duplicate.modelGaps[0].supportingEvidenceIds, [evidenceId])
  const conflict = await runModelGapDiscovery(input(), { gateway: { structured: async request => ({ ok: true, value: { gaps: [modelGap({ evidenceReferences: [{ evidenceId, relation: 'SUPPORTS' }, { evidenceId, relation: 'CONTRADICTS' }] })] }, diagnostic: diagnostic(request.attemptId) }), annotateAttempt() {} }, route: { provider: 'offline', model: 'fixture' }, maxSerializationRetries: 0 })
  assert.deepEqual(conflict.modelGaps, [])
  assert.match(conflict.rejected[0].reason, /contradictory|relation/i)
})

test('v2 rejects unsupported relations and model epistemic/application fields', async () => {
  for (const proposal of [
    modelGap({ evidenceReferences: [{ evidenceId, relation: 'MAKES_UP' }] }),
    modelGap({ epistemicStatus: 'OBSERVED' }),
    modelGap({ gapId: 'application-owned' }),
  ]) {
    const result = await runModelGapDiscovery(input(), { gateway: { structured: async request => ({ ok: true, value: { gaps: [proposal] }, diagnostic: diagnostic(request.attemptId) }), annotateAttempt() {} }, route: { provider: 'offline', model: 'fixture' }, maxSerializationRetries: 0 })
    assert.deepEqual(result.modelGaps, [])
    assert.match(result.rejected[0].reason, /unsupported|field|relation/i)
  }
})

