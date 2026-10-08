import { parseHypothesis, ValidationError } from '../domain/validation.ts'
import type { Evidence, ResearchProblemGraph } from '../domain/types.ts'
import type { Generation0Hypothesis, ResearchGap } from './types.ts'

export interface GapValidationContext {
  readonly problemNodeIds?: ReadonlySet<string>
  readonly claimIds?: ReadonlySet<string>
  readonly evidenceIds?: ReadonlySet<string>
  readonly directEvidenceIds?: ReadonlySet<string>
}

export interface Generation0ValidationContext extends GapValidationContext {
  readonly gaps: ReadonlyMap<string, ResearchGap>
  readonly problemGraph?: ResearchProblemGraph
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ValidationError('expected object', path, 'INVALID_GAP_RECORD')
  return value as Record<string, unknown>
}
function string(value: unknown, path: string): asserts value is string { if (typeof value !== 'string' || !value.trim()) throw new ValidationError('expected non-empty string', path, 'INVALID_GAP_RECORD') }
function strings(value: unknown, path: string): asserts value is readonly string[] { if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || !item.trim())) throw new ValidationError('expected string array', path, 'INVALID_GAP_RECORD') }
function oneOf<T extends string>(value: unknown, values: readonly T[], path: string): asserts value is T { if (typeof value !== 'string' || !values.includes(value as T)) throw new ValidationError(`expected one of ${values.join(', ')}`, path, 'INVALID_GAP_RECORD') }
function finite(value: unknown, path: string): asserts value is number { if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) throw new ValidationError('expected number in [0,1]', path, 'INVALID_GAP_RECORD') }
function refs(values: readonly string[], known: ReadonlySet<string> | undefined, path: string): void { if (known && values.some(value => !known.has(value))) throw new ValidationError('reference does not resolve to an accepted record', path, 'INVALID_PROVENANCE') }

const RESEARCH_GAP_KINDS = ['OPEN_QUESTION', 'KNOWN_LIMITATION', 'UNTESTED_ASSUMPTION', 'CONTRADICTORY_EVIDENCE', 'UNEXPLAINED_FAILURE', 'METHOD_INCOMPATIBILITY', 'MISSING_COMPARISON', 'UNRESOLVED_MECHANISM'] as const
const COVERAGE_GAP_KINDS = ['INCOMPLETE_EVIDENCE_COVERAGE', 'DEFERRED_EVIDENCE_WORK', 'FAILED_RETRIEVAL', 'NO_RESULTS_RETRIEVAL', 'ABSTRACT_ONLY_EVIDENCE', 'MISSING_QUANTITATIVE_EVIDENCE', 'BUDGET_EXHAUSTION'] as const
const GAP_KINDS = [...RESEARCH_GAP_KINDS, ...COVERAGE_GAP_KINDS] as const

export function validateResearchGap(value: unknown, context: GapValidationContext = {}): ResearchGap {
  const gap = object(value, '$') as unknown as ResearchGap
  string(gap.gapId, '$.gapId'); oneOf(gap.kind, GAP_KINDS, '$.kind'); string(gap.statement, '$.statement'); oneOf(gap.coverageState, ['SCIENTIFIC', 'COVERAGE_ONLY', 'MIXED'], '$.coverageState'); oneOf(gap.epistemicStatus, ['OBSERVED', 'MODEL_INTERPRETATION', 'UNRESOLVED'], '$.epistemicStatus')
  strings(gap.sourceProblemNodeIds, '$.sourceProblemNodeIds'); strings(gap.sourceClaimIds, '$.sourceClaimIds'); strings(gap.sourceEvidenceIds, '$.sourceEvidenceIds'); strings(gap.interpretationEvidenceIds, '$.interpretationEvidenceIds'); strings(gap.supportingEvidenceIds, '$.supportingEvidenceIds'); strings(gap.contradictingEvidenceIds, '$.contradictingEvidenceIds'); strings(gap.originatingLimitations, '$.originatingLimitations'); strings(gap.originatingOpenQuestions, '$.originatingOpenQuestions'); strings(gap.originatingAssumptions, '$.originatingAssumptions'); strings(gap.originatingFailureCases, '$.originatingFailureCases'); string(gap.rationale, '$.rationale')
  refs(gap.sourceProblemNodeIds, context.problemNodeIds, '$.sourceProblemNodeIds'); refs(gap.sourceClaimIds, context.claimIds, '$.sourceClaimIds'); refs(gap.sourceEvidenceIds, context.evidenceIds, '$.sourceEvidenceIds'); refs(gap.interpretationEvidenceIds, context.evidenceIds, '$.interpretationEvidenceIds'); refs([...gap.supportingEvidenceIds, ...gap.contradictingEvidenceIds], context.evidenceIds, '$.supportingEvidenceIds'); if (context.directEvidenceIds) refs([...gap.sourceEvidenceIds, ...gap.supportingEvidenceIds, ...gap.contradictingEvidenceIds], context.directEvidenceIds, '$.sourceEvidenceIds')
  if (gap.sourceEvidenceIds.some(id => gap.interpretationEvidenceIds.includes(id))) throw new ValidationError('source evidence and model interpretation evidence must remain disjoint', '$.sourceEvidenceIds', 'INVALID_PROVENANCE')
  if (!gap.eligibility || typeof gap.eligibility !== 'object') throw new ValidationError('eligibility is required', '$.eligibility', 'INVALID_GAP_RECORD')
  const eligibility = gap.eligibility as ResearchGap['eligibility']; if (typeof eligibility.eligible !== 'boolean') throw new ValidationError('eligibility.eligible must be boolean', '$.eligibility.eligible', 'INVALID_GAP_RECORD'); oneOf(eligibility.code, ['ELIGIBLE_RESEARCH_GAP', 'COVERAGE_FOLLOWUP_REQUIRED', 'MIXED_RESEARCH_COMPONENT_REQUIRED'], '$.eligibility.code'); string(eligibility.reason, '$.eligibility.reason')
  const isResearchKind = (RESEARCH_GAP_KINDS as readonly string[]).includes(gap.kind)
  const isCoverageKind = (COVERAGE_GAP_KINDS as readonly string[]).includes(gap.kind)
  if (gap.coverageState === 'COVERAGE_ONLY' && !isCoverageKind) throw new ValidationError('coverage-only gap must use a coverage gap kind', '$.kind', 'INVALID_GAP_RECORD')
  if ((gap.coverageState === 'SCIENTIFIC' || gap.coverageState === 'MIXED') && !isResearchKind) throw new ValidationError('scientific or mixed gap must use a research gap kind', '$.kind', 'INVALID_GAP_RECORD')
  if (gap.coverageState === 'COVERAGE_ONLY' && (eligibility.eligible || eligibility.code !== 'COVERAGE_FOLLOWUP_REQUIRED')) throw new ValidationError('coverage-only gap cannot seed a hypothesis', '$.eligibility', 'COVERAGE_NOT_GENERATIVE')
  if (isResearchKind && (eligibility.eligible ? eligibility.code !== 'ELIGIBLE_RESEARCH_GAP' : eligibility.code === 'ELIGIBLE_RESEARCH_GAP')) throw new ValidationError('research gap eligibility code does not match eligibility', '$.eligibility.code', 'INVALID_GAP_RECORD')
  const hasIndependentScientificProvenance = gap.sourceProblemNodeIds.length > 0 || gap.sourceClaimIds.length > 0 || gap.sourceEvidenceIds.length > 0
  if (gap.coverageState === 'MIXED' && !hasIndependentScientificProvenance) throw new ValidationError('mixed gap requires independent scientific graph, claim, or direct evidence provenance', '$', 'INVALID_PROVENANCE')
  if ((gap.coverageState === 'SCIENTIFIC' || gap.coverageState === 'MIXED') && eligibility.eligible && !hasIndependentScientificProvenance) throw new ValidationError('eligible research gap requires independent graph, claim, or direct evidence provenance', '$.eligibility', 'INVALID_PROVENANCE')
  if (!gap.uncertainty || typeof gap.uncertainty !== 'object') throw new ValidationError('uncertainty is required', '$.uncertainty', 'INVALID_GAP_RECORD')
  finite(gap.uncertainty.level, '$.uncertainty.level'); strings(gap.uncertainty.reasons, '$.uncertainty.reasons')
  return gap
}

export function validateGeneration0Hypothesis(value: unknown, context: Generation0ValidationContext): Generation0Hypothesis {
  const hypothesis = object(value, '$') as unknown as Generation0Hypothesis
  parseHypothesis(hypothesis, context.evidenceIds)
  if (hypothesis.generation !== 0) throw new ValidationError('Generation-0 hypothesis must have generation 0', '$.generation', 'INVALID_GENERATION')
  if (hypothesis.status !== 'candidate') throw new ValidationError('Generation-0 hypothesis must remain a candidate', '$.status', 'INVALID_GENERATION_STATUS')
  if (hypothesis.parentIds.length || hypothesis.priorArtReportIds.length || hypothesis.criticismIds.length || hypothesis.experimentIds.length || hypothesis.resultEvidenceIds.length || hypothesis.mutationEdgeIds.length) throw new ValidationError('Generation-0 hypothesis cannot claim later-stage artifacts', '$', 'INVALID_GENERATION_ARTIFACT')
  if (hypothesis.noveltyEvidence !== undefined || hypothesis.noveltyEstimate !== undefined) throw new ValidationError('Generation-0 hypothesis cannot contain novelty assessment', '$', 'NOVELTY_NOT_VERIFIABLE')
  if (hypothesis.epistemicStatus !== 'PROVISIONAL_UNVERIFIED' || hypothesis.noveltyStatus !== 'UNVERIFIED') throw new ValidationError('Generation-0 hypothesis must be provisional and novelty-unverified', '$', 'INVALID_GENERATION_STATUS')
  strings(hypothesis.originatingGapIds, '$.originatingGapIds'); strings(hypothesis.sourceProblemNodeIds, '$.sourceProblemNodeIds'); strings(hypothesis.sourceClaimIds, '$.sourceClaimIds'); strings(hypothesis.sourceEvidenceIds, '$.sourceEvidenceIds'); string(hypothesis.proposedMechanism, '$.proposedMechanism'); string(hypothesis.expectedMechanism, '$.expectedMechanism'); strings(hypothesis.falsificationConditions, '$.falsificationConditions'); if (!hypothesis.falsificationConditions.length) throw new ValidationError('falsificationConditions cannot be empty', '$.falsificationConditions', 'INVALID_GENERATION_CONTRACT'); string(hypothesis.expectedObservableResult, '$.expectedObservableResult'); string(hypothesis.discriminativeExperimentIdea, '$.discriminativeExperimentIdea'); oneOf(hypothesis.generationOperator, ['REMOVE_ASSUMPTION', 'COMBINE_METHODS', 'TRANSFER_MECHANISM', 'REPLACE_COMPONENT', 'RELAX_CONSTRAINT', 'EXPLAIN_FAILURE', 'NEW_OBJECTIVE', 'NEW_REPRESENTATION', 'NEW_EVALUATION', 'CROSS_DOMAIN_TRANSFER'], '$.generationOperator')
  refs(hypothesis.originatingGapIds, new Set(context.gaps.keys()), '$.originatingGapIds'); refs(hypothesis.sourceProblemNodeIds, context.problemNodeIds, '$.sourceProblemNodeIds'); refs(hypothesis.sourceClaimIds, context.claimIds, '$.sourceClaimIds'); refs(hypothesis.sourceEvidenceIds, context.directEvidenceIds ?? context.evidenceIds, '$.sourceEvidenceIds');
  const gaps = hypothesis.originatingGapIds.map(id => context.gaps.get(id)).filter((gap): gap is ResearchGap => Boolean(gap)); if (!gaps.length || gaps.every(gap => !gap.eligibility.eligible || gap.coverageState === 'COVERAGE_ONLY')) throw new ValidationError('hypothesis must originate from an eligible research gap', '$.originatingGapIds', 'COVERAGE_NOT_GENERATIVE')
  const gapEvidence = new Set(gaps.flatMap(gap => gap.sourceEvidenceIds)); if (hypothesis.sourceEvidenceIds.some(id => !gapEvidence.has(id))) throw new ValidationError('hypothesis evidence must remain on its originating provenance path', '$.sourceEvidenceIds', 'INVALID_PROVENANCE')
  if (hypothesis.evidenceFor.some(id => !hypothesis.sourceEvidenceIds.includes(id)) || hypothesis.evidenceAgainst.some(id => !hypothesis.sourceEvidenceIds.includes(id))) throw new ValidationError('evidenceFor/evidenceAgainst must use direct source evidence only', '$.evidenceFor', 'INVALID_PROVENANCE')
  return hypothesis
}

export function validateGeneration0Population(population: { readonly hypotheses: readonly Generation0Hypothesis[]; readonly generation: number; readonly inputCompleteness: unknown }, context: Generation0ValidationContext): void {
  if (population.generation !== 0) throw new ValidationError('population generation must be 0', '$.generation', 'INVALID_GENERATION')
  population.hypotheses.forEach(hypothesis => validateGeneration0Hypothesis(hypothesis, context))
}

