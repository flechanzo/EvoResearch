import assert from 'node:assert/strict'
import test from 'node:test'

import { canonicalJson, deterministicId } from '../src/domain/ids.ts'
import { projectM5AInput } from '../src/milestone5a/projection.ts'
import { runModelGapDiscovery } from '../src/milestone5a/gap-reasoning.ts'

const now = '2026-10-10T00:00:00.000Z'
const nodeId = deterministicId('graph_node', 'm5a-node')
const secondNodeId = deterministicId('graph_node', 'm5a-node-2')
const claimId = deterministicId('claim', 'm5a-claim')
const evidenceId = deterministicId('evidence', 'm5a-direct')
const abstractEvidenceId = deterministicId('evidence', 'm5a-abstract')

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
    sourceProblemNodeIds: [nodeId],
    sourceClaimIds: [claimId],
    sourceEvidenceIds: [evidenceId],
    interpretationEvidenceIds: [],
    supportingEvidenceIds: [],
    contradictingEvidenceIds: [evidenceId],
    originatingLimitations: [nodeId],
    originatingOpenQuestions: [],
    originatingAssumptions: [],
    originatingFailureCases: [],
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

test('dangling model evidence and origin references fail closed without accepted gaps', async () => {
  const state = input()
  const gateway = { structured: async request => ({ ok: true, value: { gaps: [modelGap({ sourceEvidenceIds: ['missing-evidence'] })] }, diagnostic: diagnostic(request.attemptId) }), annotateAttempt() {} }
  const result = await runModelGapDiscovery(state, { gateway, route: { provider: 'offline', model: 'mock' }, maxSerializationRetries: 0 })
  assert.deepEqual(result.modelGaps, [])
  assert.equal(result.attempts[0].status, 'FAILED')
  assert.match(result.rejected[0].reason, /evidence|provenance|origin|graph node/i)

  const originGateway = { structured: async request => ({ ok: true, value: { gaps: [modelGap({ originatingLimitations: ['missing-node'] })] }, diagnostic: diagnostic(request.attemptId) }), annotateAttempt() {} }
  const originResult = await runModelGapDiscovery(state, { gateway: originGateway, route: { provider: 'offline', model: 'mock' }, maxSerializationRetries: 0 })
  assert.deepEqual(originResult.modelGaps, [])
  assert.match(originResult.rejected[0].reason, /origin|graph node|provenance/i)
})

test('coverage-only model output cannot be renamed into a scientific gap', async () => {
  const state = input()
  const gateway = { structured: async request => ({ ok: true, value: { gaps: [{ ...modelGap(), kind: 'INCOMPLETE_EVIDENCE_COVERAGE', coverageState: 'SCIENTIFIC', sourceProblemNodeIds: [], sourceClaimIds: [], sourceEvidenceIds: [], interpretationEvidenceIds: [], supportingEvidenceIds: [], contradictingEvidenceIds: [], originatingLimitations: [], originatingOpenQuestions: [], originatingAssumptions: [], originatingFailureCases: [], statement: 'Evidence coverage is incomplete.' }] }, diagnostic: diagnostic(request.attemptId) }), annotateAttempt() {} }
  const result = await runModelGapDiscovery(state, { gateway, route: { provider: 'offline', model: 'mock' }, maxSerializationRetries: 0 })
  assert.equal(result.modelGaps.length, 1, JSON.stringify(result.rejected))
  assert.equal(result.modelGaps[0].coverageState, 'COVERAGE_ONLY')
  assert.equal(result.modelGaps[0].eligibility.eligible, false)
  assert.equal(result.modelGaps[0].eligibility.code, 'COVERAGE_FOLLOWUP_REQUIRED')
})

test('coverage wording without scientific provenance is canonicalized as coverage-only', async () => {
  const state = input()
  const gateway = { structured: async request => ({ ok: true, value: { gaps: [{ ...modelGap(), kind: 'KNOWN_LIMITATION', coverageState: 'SCIENTIFIC', sourceProblemNodeIds: [], sourceClaimIds: [], sourceEvidenceIds: [], interpretationEvidenceIds: [], supportingEvidenceIds: [], contradictingEvidenceIds: [], originatingLimitations: [], originatingOpenQuestions: [], originatingAssumptions: [], originatingFailureCases: [], statement: 'Evidence coverage is incomplete.' }] }, diagnostic: diagnostic(request.attemptId) }), annotateAttempt() {} }
  const result = await runModelGapDiscovery(state, { gateway, route: { provider: 'offline', model: 'mock' }, maxSerializationRetries: 0 })
  assert.equal(result.modelGaps.length, 1)
  assert.equal(result.modelGaps[0].coverageState, 'COVERAGE_ONLY')
  assert.equal(result.modelGaps[0].eligibility.eligible, false)
})

test('MIXED model gap without independent scientific provenance is rejected', async () => {
  const state = input()
  const gateway = { structured: async request => ({ ok: true, value: { gaps: [{ ...modelGap(), kind: 'KNOWN_LIMITATION', coverageState: 'MIXED', sourceProblemNodeIds: [], sourceClaimIds: [], sourceEvidenceIds: [], interpretationEvidenceIds: [], supportingEvidenceIds: [], contradictingEvidenceIds: [], originatingLimitations: [], originatingOpenQuestions: [], originatingAssumptions: [], originatingFailureCases: [], statement: 'The literature may not have examined this.' }] }, diagnostic: diagnostic(request.attemptId) }), annotateAttempt() {} }
  const result = await runModelGapDiscovery(state, { gateway, route: { provider: 'offline', model: 'mock' }, maxSerializationRetries: 0 })
  assert.deepEqual(result.modelGaps, [])
  assert.match(result.rejected[0].reason, /mixed|provenance/i)
})

test('independently grounded MIXED model gap remains eligible while preserving interpretation evidence', async () => {
  const state = input({ evidence: [evidence(), evidence({ evidenceId: abstractEvidenceId, evidenceLevel: 'ABSTRACT_EVIDENCE', limitations: ['full-text unavailable'] })] })
  const gateway = { structured: async request => ({ ok: true, value: { gaps: [modelGap({ coverageState: 'MIXED', statement: 'A synthesized boundary gap.', epistemicStatus: 'OBSERVED', interpretationEvidenceIds: [abstractEvidenceId], rationale: 'mixed source and coverage context' })] }, diagnostic: diagnostic(request.attemptId) }), annotateAttempt() {} }
  const result = await runModelGapDiscovery(state, { gateway, route: { provider: 'offline', model: 'mock' }, maxSerializationRetries: 0 })
  assert.equal(result.modelGaps.length, 1)
  assert.equal(result.modelGaps[0].coverageState, 'MIXED')
  assert.equal(result.modelGaps[0].eligibility.eligible, true)
  assert.equal(result.modelGaps[0].epistemicStatus, 'MODEL_INTERPRETATION')
  assert.deepEqual(result.modelGaps[0].interpretationEvidenceIds, [abstractEvidenceId])
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
  assert.match(result.rejected[0].reason, /evidence|provenance|origin|graph node/i)
  const includedEvidence = new Set(result.projection.includedEvidenceIds)
  for (const gap of result.projection.gaps) {
    assert.ok([...gap.sourceEvidenceIds, ...gap.interpretationEvidenceIds, ...gap.supportingEvidenceIds, ...gap.contradictingEvidenceIds].every(id => includedEvidence.has(id)))
  }
})

test('abstract evidence remains scientific evidence unless coverage wording says otherwise', async () => {
  const state = input({ evidence: [evidence(), evidence({ evidenceId: abstractEvidenceId, evidenceLevel: 'ABSTRACT_EVIDENCE' })] })
  const gateway = { structured: async request => ({ ok: true, value: { gaps: [modelGap({ sourceProblemNodeIds: [], sourceClaimIds: [], sourceEvidenceIds: [abstractEvidenceId], statement: 'An abstract-level source leaves a mechanism unresolved.' })] }, diagnostic: diagnostic(request.attemptId) }), annotateAttempt() {} }
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

