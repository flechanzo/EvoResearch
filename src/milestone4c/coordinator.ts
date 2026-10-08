import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { canonicalJson, contentHash, deterministicId } from '../domain/ids.ts'
import { parseCheckpoint, ValidationError } from '../domain/validation.ts'
import type { Checkpoint } from '../domain/types.ts'
import { selectParetoFrontier } from './pareto.ts'
import type { M4CArtifacts, M4CInput } from './types.ts'

export function buildM4CArtifacts(input: M4CInput): M4CArtifacts {
  if (!input.runId) throw new ValidationError('runId is required to build durable M4C artifacts', '$.runId', 'INVALID_M4C_RECORD')
  if (input.previousCheckpoint) {
    parseCheckpoint(input.previousCheckpoint)
    if (input.previousCheckpoint.runId !== input.runId) throw new ValidationError('previous checkpoint runId must match the M4C run', '$.previousCheckpoint.runId', 'INVALID_CHECKPOINT')
    for (const hypothesis of input.hypotheses) if (!input.previousCheckpoint.populationIds.includes(hypothesis.hypothesisId as never)) throw new ValidationError('all M4C hypotheses must be present in the previous checkpoint population', '$.hypotheses', 'INVALID_CHECKPOINT')
  }
  const selection = selectParetoFrontier(input)
  const stateHash = contentHash(canonicalJson({ schemaVersion: selection.schemaVersion, generatedAt: selection.generatedAt, population: selection.population, evaluations: selection.evaluations, frontierHypothesisIds: selection.frontierHypothesisIds, dominatedHypothesisIds: selection.dominatedHypothesisIds, selectedHypothesisIds: selection.selectedHypothesisIds, dominanceReasons: selection.dominanceReasons, states: selection.states }))
  const previous = input.previousCheckpoint
  const sequence = (previous?.sequence ?? input.startingSequence ?? 0) + 1
  const budget = input.budget ?? previous?.budget ?? { limits: { maxModelCalls: 0, maxSearchCalls: 0, maxCandidates: 0, maxMutations: 0, maxTokens: 0 }, usage: { maxModelCalls: 0, maxSearchCalls: 0, maxCandidates: 0, maxMutations: 0, maxTokens: 0 } }
  const checkpoint: Checkpoint = { checkpointId: deterministicId('checkpoint', { runId: input.runId, sequence, stateHash }), runId: input.runId, sequence, stateHash, populationIds: selection.population.map(hypothesis => hypothesis.hypothesisId), budget, createdAt: input.now }
  return { selection, checkpoint }
}

export const buildEvaluationSelectionArtifacts = buildM4CArtifacts

export function persistM4CArtifacts(outputDirectory: string, artifacts: M4CArtifacts): void {
  mkdirSync(outputDirectory, { recursive: true })
  writeFileSync(resolve(outputDirectory, 'evaluation-records.json'), JSON.stringify(artifacts.selection.evaluations, null, 2), 'utf8')
  writeFileSync(resolve(outputDirectory, 'pareto-selection.json'), JSON.stringify(artifacts.selection, null, 2), 'utf8')
  writeFileSync(resolve(outputDirectory, 'checkpoint.json'), JSON.stringify(artifacts.checkpoint, null, 2), 'utf8')
}
