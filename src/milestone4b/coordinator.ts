import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { canonicalJson, contentHash, deterministicId } from '../domain/ids.ts'
import { parseCheckpoint, parseDomainEvent, spendBudget, ValidationError } from '../domain/validation.ts'
import type { Checkpoint, DomainEvent } from '../domain/types.ts'
import { evolveHypotheses } from './hypothesis-evolution.ts'
import type { M4BArtifacts, HypothesisEvolutionInput, HypothesisEvolutionOptions } from './types.ts'

export function buildM4BArtifacts(input: HypothesisEvolutionInput, options: HypothesisEvolutionOptions = {}): M4BArtifacts {
  if (!input.runId) throw new ValidationError('runId is required to build durable M4B artifacts', '$.runId', 'INVALID_M4B_RECORD')
  const runId = input.runId
  const previous = input.previousCheckpoint
  if (previous) {
    parseCheckpoint(previous)
    if (previous.runId !== runId) throw new ValidationError('previous checkpoint runId must match the evolution run', '$.previousCheckpoint.runId', 'INVALID_CHECKPOINT')
    for (const hypothesis of input.hypotheses) if (!previous.populationIds.includes(hypothesis.hypothesisId as never)) throw new ValidationError('all M4B parents must be present in the previous checkpoint population', '$.hypotheses', 'INVALID_CHECKPOINT')
  }
  const effectiveBudget = input.budget ?? previous?.budget
  const effectiveInput = effectiveBudget ? { ...input, budget: effectiveBudget } : input
  const evolution = evolveHypotheses(effectiveInput, options)
  const accepted = evolution.newMutationEdges.length
  const budget = effectiveBudget ?? { limits: { maxModelCalls: 0, maxSearchCalls: 0, maxCandidates: 0, maxMutations: accepted, maxTokens: 0 }, usage: { maxModelCalls: 0, maxSearchCalls: 0, maxCandidates: 0, maxMutations: 0, maxTokens: 0 } }
  const nextBudget = accepted ? spendBudget(budget, 'maxMutations', accepted) : budget
  const baseSequence = previous?.sequence ?? input.startingSequence ?? 0
  const events: DomainEvent[] = evolution.newMutations.map((mutation, index) => {
    const sequence = baseSequence + index + 1
    return { eventId: deterministicId('event', { runId, sequence, type: 'hypothesis.mutated', mutationEdgeId: mutation.edge.mutationEdgeId }), runId, sequence, type: 'hypothesis.mutated', occurredAt: input.now, payload: { stage: 'M4B_EVOLUTION', parentHypothesisId: mutation.edge.parentHypothesisId, childHypothesisId: mutation.edge.childHypothesisId, mutationEdgeId: mutation.edge.mutationEdgeId, criticReviewId: mutation.edge.criticReviewId, criticismIds: mutation.criticismIds, evidenceIds: mutation.edge.evidenceIds, mutationType: mutation.edge.mutationType } }
  })
  const stateHash = contentHash(canonicalJson({ schemaVersion: evolution.schemaVersion, generatedAt: evolution.generatedAt, generation: evolution.generation, hypotheses: evolution.hypotheses, children: evolution.children, mutations: evolution.mutations, mutationEdges: evolution.mutationEdges, rejected: evolution.rejected, provenance: evolution.provenance }))
  const checkpointSequence = baseSequence + events.length + 1
  const checkpoint: Checkpoint = { checkpointId: deterministicId('checkpoint', { runId, sequence: checkpointSequence, stateHash }), runId, sequence: checkpointSequence, stateHash, populationIds: evolution.hypotheses.map(hypothesis => hypothesis.hypothesisId), budget: nextBudget, createdAt: input.now }
  const checkpointEvent: DomainEvent = { eventId: deterministicId('event', { runId, sequence: checkpointSequence, type: 'checkpoint.created', checkpointId: checkpoint.checkpointId }), runId, sequence: checkpointSequence, type: 'checkpoint.created', occurredAt: input.now, payload: { stage: 'M4B_EVOLUTION', checkpointId: checkpoint.checkpointId, populationIds: checkpoint.populationIds, mutationEdgeIds: evolution.mutationEdges.map(edge => edge.mutationEdgeId) } }
  events.push(checkpointEvent)
  events.forEach(event => parseDomainEvent(event))
  return { evolution, events, checkpoint }
}

export const buildHypothesisEvolutionArtifacts = buildM4BArtifacts

export function persistM4BArtifacts(outputDirectory: string, artifacts: M4BArtifacts, appendEvents?: (events: readonly DomainEvent[]) => void): void {
  mkdirSync(outputDirectory, { recursive: true })
  writeFileSync(resolve(outputDirectory, 'hypotheses-evolution.json'), JSON.stringify(artifacts.evolution, null, 2), 'utf8')
  writeFileSync(resolve(outputDirectory, 'mutation-edges.json'), JSON.stringify(artifacts.evolution.mutationEdges, null, 2), 'utf8')
  writeFileSync(resolve(outputDirectory, 'checkpoint.json'), JSON.stringify(artifacts.checkpoint, null, 2), 'utf8')
  appendEvents?.(artifacts.events)
}

