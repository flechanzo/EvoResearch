import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { contentHash, deterministicId } from '../domain/ids.ts'
import type { Checkpoint, DomainEvent } from '../domain/types.ts'
import { discoverResearchGaps } from './gap-discovery.ts'
import { generateGeneration0Hypotheses } from './hypothesis-generator.ts'
import type { M4AArtifacts, M4AOrchestrationInput } from './types.ts'

/**
 * Runs the isolated M4A boundary. It consumes already persisted structured state
 * and never adds a live validation stage or performs retrieval/model work unless
 * the caller explicitly supplies a ModelGateway.
 */
export async function buildM4AArtifacts(input: M4AOrchestrationInput, options: Parameters<typeof generateGeneration0Hypotheses>[1] = {}): Promise<M4AArtifacts> {
  const gapDiscovery = discoverResearchGaps({ ...input, completeness: input.completeness, now: input.now })
  const generation0 = await generateGeneration0Hypotheses({ gapDiscovery, problemGraph: input.problemGraph, claims: input.claims, evidence: input.evidence }, { ...options, now: input.now, candidateBudget: options.candidateBudget ?? input.budget.limits.maxCandidates })
  const baseSequence = input.startingSequence ?? 0
  const events: DomainEvent[] = generation0.hypotheses.map((hypothesis, index) => {
    const sequence = baseSequence + index + 1
    return { eventId: deterministicId('event', { runId: input.runId, sequence, type: 'hypothesis.created', hypothesisId: hypothesis.hypothesisId }), runId: input.runId, sequence, type: 'hypothesis.created', occurredAt: input.now, payload: { stage: 'M4A_GENERATION_0', hypothesisId: hypothesis.hypothesisId, generation: 0, originatingGapIds: hypothesis.originatingGapIds, epistemicStatus: hypothesis.epistemicStatus, noveltyStatus: hypothesis.noveltyStatus } }
  })
  const checkpointSequence = baseSequence + events.length + 1
  const stateHash = contentHash(JSON.stringify({ gapDiscovery, generation0 }))
  const checkpoint: Checkpoint = { checkpointId: deterministicId('checkpoint', { runId: input.runId, sequence: checkpointSequence, stateHash }), runId: input.runId, sequence: checkpointSequence, stateHash, populationIds: generation0.hypotheses.map(hypothesis => hypothesis.hypothesisId), budget: { limits: input.budget.limits, usage: { ...input.budget.usage, maxCandidates: input.budget.usage.maxCandidates + generation0.hypotheses.length } }, createdAt: input.now }
  events.push({ eventId: deterministicId('event', { runId: input.runId, sequence: checkpointSequence, type: 'checkpoint.created', checkpointId: checkpoint.checkpointId }), runId: input.runId, sequence: checkpointSequence, type: 'checkpoint.created', occurredAt: input.now, payload: { stage: 'M4A_GENERATION_0', checkpointId: checkpoint.checkpointId, gapArtifact: 'gap-discovery.json', populationArtifact: 'hypotheses-generation-0.json', gapIds: gapDiscovery.gaps.map(gap => gap.gapId), populationIds: checkpoint.populationIds } })
  return { gapDiscovery, generation0, events, checkpoint }
}

/** Persist only inspectable M4A artifacts. Event delivery remains with the caller's existing event store. */
export function persistM4AArtifacts(outputDirectory: string, artifacts: M4AArtifacts, appendEvents?: (events: readonly DomainEvent[]) => void): void {
  mkdirSync(outputDirectory, { recursive: true })
  writeFileSync(resolve(outputDirectory, 'gap-discovery.json'), JSON.stringify(artifacts.gapDiscovery, null, 2), 'utf8')
  writeFileSync(resolve(outputDirectory, 'hypotheses-generation-0.json'), JSON.stringify(artifacts.generation0, null, 2), 'utf8')
  writeFileSync(resolve(outputDirectory, 'checkpoint.json'), JSON.stringify(artifacts.checkpoint, null, 2), 'utf8')
  appendEvents?.(artifacts.events)
}
