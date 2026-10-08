import assert from 'node:assert/strict'
import test from 'node:test'

import { deterministicId } from '../src/domain/ids.ts'
import { parseCheckpoint, parseDomainEvent, ValidationError } from '../src/domain/validation.ts'
import { discoverResearchGaps } from '../src/milestone4a/gap-discovery.ts'
import { generateGeneration0Hypotheses } from '../src/milestone4a/hypothesis-generator.ts'
import { validateResearchGap } from '../src/milestone4a/validation.ts'
import { evolveHypotheses } from '../src/milestone4b/hypothesis-evolution.ts'
import { validateM4CInputs } from '../src/milestone4c/validation.ts'
import { createDeterministicM4DFixture } from '../src/milestone4d/fixture.ts'
import { renderM4DReport, replayM4DLifecycle, restoreM4DCheckpoint, runM4DLifecycle } from '../src/milestone4d/lifecycle.ts'

test('M4D composes a provenance-preserving lifecycle and explainability projection', async () => {
  const fixture = createDeterministicM4DFixture()
  const artifacts = await runM4DLifecycle(fixture)

  assert.ok(artifacts.finalFrontierHypothesisIds.length > 0)
  assert.deepEqual(artifacts.finalFrontierHypothesisIds, artifacts.evaluation.selection.frontierHypothesisIds)
  assert.deepEqual(artifacts.genealogy.map(item => item.hypothesisId).sort(), artifacts.evaluation.selection.population.map(item => item.hypothesisId).sort())
  assert.deepEqual(artifacts.checkpoint.populationIds, artifacts.evaluation.selection.population.map(item => item.hypothesisId))
  assert.deepEqual(artifacts.audit, {
    gapProvenanceValidated: true,
    generation0ProvenanceValidated: true,
    mutationLineagePreserved: true,
    mutationCausalityPreserved: true,
    evaluationCoverageComplete: true,
    frontierDeterministic: true,
    populationPreserved: true,
  })

  for (const projection of artifacts.explainability) {
    assert.ok(projection.originatingProblem.length > 0)
    assert.ok(projection.evidenceChain.length > 0)
    assert.ok(projection.evaluation.evaluationDimensions.evidenceSupport)
    assert.ok(projection.pareto.rationale)
    assert.ok(projection.mutations.length > 0)
    assert.ok(projection.criticismsSurvived.length > 0)
  }
  assert.equal(artifacts.report, renderM4DReport(artifacts.explainability))
  assert.equal(artifacts.report.includes('novelty established'), false)
  assert.equal(artifacts.report.includes('absence of literature'), false)
  for (const event of artifacts.events) parseDomainEvent(event)
  parseCheckpoint(artifacts.checkpoint)
})

test('invalid gap provenance fails closed before Generation-0 materialization', async () => {
  const fixture = createDeterministicM4DFixture()
  const discovered = discoverResearchGaps(fixture.m4a)
  const accepted = discovered.gaps.find(gap => gap.eligibility.eligible && gap.coverageState !== 'COVERAGE_ONLY')
  assert.ok(accepted)
  const invalid = { ...accepted, sourceEvidenceIds: [deterministicId('evidence', 'missing-m4d')] }
  const context = {
    problemNodeIds: new Set(fixture.m4a.problemGraph.nodes.map(node => node.nodeId)),
    claimIds: new Set(fixture.m4a.claims.map(claim => claim.claimId)),
    evidenceIds: new Set(fixture.m4a.evidence.map(item => item.evidenceId)),
    directEvidenceIds: new Set(fixture.m4a.evidence.map(item => item.evidenceId)),
  }
  assert.throws(() => validateResearchGap(invalid, context), ValidationError)
  await assert.rejects(() => generateGeneration0Hypotheses({ gapDiscovery: { ...discovered, gaps: [invalid] }, problemGraph: fixture.m4a.problemGraph, claims: fixture.m4a.claims, evidence: fixture.m4a.evidence }, { now: fixture.m4a.now }), ValidationError)
})

test('mutation children retain parent lineage and require criticism plus evidence references', async () => {
  const fixture = createDeterministicM4DFixture()
  const artifacts = await runM4DLifecycle(fixture)
  const mutation = artifacts.mutation.evolution.mutations[0]
  const parent = artifacts.mutation.evolution.hypotheses.find(hypothesis => hypothesis.hypothesisId === mutation.edge.parentHypothesisId)
  const child = artifacts.mutation.evolution.hypotheses.find(hypothesis => hypothesis.hypothesisId === mutation.edge.childHypothesisId)
  assert.ok(parent && child)
  assert.deepEqual(child.parentIds, [parent.hypothesisId])
  assert.equal(child.generation, parent.generation + 1)
  assert.equal(child.reevaluationRequired, true)
  assert.ok(mutation.criticismIds.length > 0)
  assert.ok(mutation.edge.evidenceIds.length > 0)
  assert.ok(mutation.edge.changedFields.length > 0)

  const review = fixture.reviewFor(parent, fixture.m4a.evidence)
  const criticism = fixture.criticismFor(parent, review, fixture.m4a.evidence)
  assert.throws(() => evolveHypotheses({ hypotheses: [parent], reviews: [review], criticisms: [criticism], evidence: fixture.m4a.evidence, mutationProposals: [{ parentHypothesisId: parent.hypothesisId, criticReviewId: review.reviewId, criticismIds: [], mutationType: 'ADDRESS_COUNTEREXAMPLE', reason: 'missing causality', evidenceIds: [], changedFields: ['method'] }], now: fixture.m4a.now }), /criticism|evidence/i)
})

test('frontier selection fails closed when an evaluation is missing', async () => {
  const fixture = createDeterministicM4DFixture()
  const artifacts = await runM4DLifecycle(fixture)
  assert.throws(() => validateM4CInputs({ hypotheses: artifacts.evaluation.selection.population, evaluations: artifacts.evaluation.selection.evaluations.slice(0, -1) }), /evaluation/i)
})

test('checkpoint restore and replay preserve IDs, events, genealogy, frontier, and report', async () => {
  const fixture = createDeterministicM4DFixture()
  const first = await runM4DLifecycle(fixture)
  const restored = restoreM4DCheckpoint(first.checkpoint)
  const replay = await replayM4DLifecycle(fixture, restored)

  assert.deepEqual(replay, first)
  assert.deepEqual(replay.events.map(event => event.eventId), first.events.map(event => event.eventId))
  assert.deepEqual(replay.genealogy, first.genealogy)
  assert.deepEqual(replay.finalFrontierHypothesisIds, first.finalFrontierHypothesisIds)
  assert.equal(replay.report, first.report)
  assert.equal(replay.checkpoint.checkpointId, restored.checkpointId)
  assert.equal(replay.checkpoint.stateHash, restored.stateHash)
})

