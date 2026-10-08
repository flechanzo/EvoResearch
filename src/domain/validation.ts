import { isContentHash } from './ids.ts'
import type {
  BudgetLedger, Claim, Criticism, DomainEvent, Evidence, EvidenceLink, ExperimentDesign,
  Hypothesis, MutationEdge, NoveltyEvidence, Paper, PaperArtifact, PriorArtReport,
  PriorArtReference, ResearchProblem, ResearchProblemGraph, Review, ScientificDimension, Uncertainty, Checkpoint,
} from './types.ts'

export class ValidationError extends Error {
  readonly code: string
  readonly path: string

  constructor(message: string, path = '$', code = 'INVALID_DOMAIN_RECORD') {
    super(`${path}: ${message}`)
    this.name = 'ValidationError'
    this.code = code
    this.path = path
  }
}

export function assertValid<T>(value: T, validator: (value: T) => void): T {
  validator(value)
  return value
}

export function parsePaper(value: unknown): Paper {
  const paper = record(value, '$') as Paper
  string(paper.paperId, '$.paperId'); string(paper.title, '$.title')
  strings(paper.authors, '$.authors'); const identifiers = record(paper.identifiers, '$.identifiers'); Object.entries(identifiers).forEach(([key, identifier]) => { string(key, '$.identifiers'); string(identifier, `$.identifiers.${key}`) }); strings(paper.sourceUrls, '$.sourceUrls'); ids(paper.artifactIds, '$.artifactIds')
  optionalInt(paper.publicationYear, '$.publicationYear', 0, 3000); optionalTime(paper.retrievedAt, '$.retrievedAt')
  return paper
}

export function parsePaperArtifact(value: unknown): PaperArtifact {
  const artifact = record(value, '$') as PaperArtifact
  string(artifact.artifactId, '$.artifactId'); string(artifact.paperId, '$.paperId'); oneOf(artifact.kind, ['pdf', 'text', 'html', 'other'], '$.kind'); hash(artifact.contentHash, '$.contentHash'); integer(artifact.byteLength, '$.byteLength', 0); string(artifact.createdAt, '$.createdAt'); optionalString(artifact.uri, '$.uri'); time(artifact.createdAt, '$.createdAt')
  return artifact
}

export function parseClaim(value: unknown): Claim {
  const claim = record(value, '$') as Claim
  string(claim.claimId, '$.claimId'); string(claim.statement, '$.statement'); oneOf(claim.kind, ['observation', 'interpretation', 'result', 'method', 'limitation', 'open-question'], '$.kind'); provenance(claim.provenance, '$.provenance'); optionalString(claim.paperId, '$.paperId'); optionalString(claim.artifactId, '$.artifactId')
  return claim
}

export function parseEvidence(value: unknown): Evidence {
  const evidence = record(value, '$') as Evidence
  string(evidence.evidenceId, '$.evidenceId'); oneOf(evidence.kind, ['quote', 'observation', 'table', 'result', 'tool-result', 'interpretation'], '$.kind'); string(evidence.claim, '$.claim'); oneOf(evidence.polarity, ['SUPPORT', 'CONTRADICT', 'WEAKEN', 'MOTIVATE'], '$.polarity'); provenance(evidence.provenance, '$.provenance'); ids(evidence.claimIds, '$.claimIds'); strings(evidence.limitations, '$.limitations'); finiteNumber(evidence.confidence, '$.confidence', 0, 1); time(evidence.createdAt, '$.createdAt')
  return evidence
}

export function parseEvidenceLink(value: unknown, evidenceIds?: ReadonlySet<string>): EvidenceLink {
  const link = record(value, '$') as EvidenceLink
  string(link.evidenceLinkId, '$.evidenceLinkId'); string(link.evidenceId, '$.evidenceId'); string(link.targetId, '$.targetId'); string(link.rationale, '$.rationale'); oneOf(link.targetType, ['problem', 'hypothesis', 'graph-edge', 'claim'], '$.targetType'); oneOf(link.relation, ['SUPPORT', 'CONTRADICT', 'WEAKEN', 'MOTIVATE'], '$.relation'); if (evidenceIds && !evidenceIds.has(link.evidenceId)) fail('evidenceId does not reference an existing evidence record', '$.evidenceId', 'INVALID_PROVENANCE')
  return link
}

export function parseResearchProblem(value: unknown, evidenceIds?: ReadonlySet<string>): ResearchProblem {
  const problem = record(value, '$') as ResearchProblem
  string(problem.problemId, '$.problemId'); string(problem.statement, '$.statement'); ids(problem.evidenceIds, '$.evidenceIds'); ids(problem.methodIds, '$.methodIds'); ids(problem.assumptionIds, '$.assumptionIds'); ids(problem.limitationIds, '$.limitationIds'); ids(problem.failureCaseIds, '$.failureCaseIds'); ids(problem.openQuestionIds, '$.openQuestionIds'); evidenceRefs(problem.evidenceIds, evidenceIds, '$.evidenceIds')
  return problem
}

export function parseResearchProblemGraph(value: unknown, evidenceIds?: ReadonlySet<string>): ResearchProblemGraph {
  const graph = record(value, '$') as ResearchProblemGraph
  array(graph.problems, '$.problems'); array(graph.nodes, '$.nodes'); array(graph.edges, '$.edges')
  const idsSeen = new Set<string>()
  graph.problems.forEach((problem, i) => { parseResearchProblem(problem, evidenceIds); addUnique(idsSeen, problem.problemId, `$.problems[${i}].problemId`) })
  graph.nodes.forEach((node, i) => { record(node, `$.nodes[${i}]`); string(node.nodeId, `$.nodes[${i}].nodeId`); string(node.label, `$.nodes[${i}].label`); oneOf(node.type, ['paper', 'problem', 'method', 'assumption', 'dataset', 'metric', 'limitation', 'failure-case', 'open-question', 'claim'], `$.nodes[${i}].type`); ids(node.evidenceIds, `$.nodes[${i}].evidenceIds`); addUnique(idsSeen, node.nodeId, `$.nodes[${i}].nodeId`); evidenceRefs(node.evidenceIds, evidenceIds, `$.nodes[${i}].evidenceIds`) })
  graph.edges.forEach((edge, i) => { record(edge, `$.edges[${i}]`); string(edge.edgeId, `$.edges[${i}].edgeId`); string(edge.from, `$.edges[${i}].from`); string(edge.to, `$.edges[${i}].to`); string(edge.relation, `$.edges[${i}].relation`); ids(edge.evidenceIds, `$.edges[${i}].evidenceIds`); if (!idsSeen.has(edge.from)) fail('edge.from does not reference a graph node', `$.edges[${i}].from`, 'INVALID_GRAPH_REFERENCE'); if (!idsSeen.has(edge.to)) fail('edge.to does not reference a graph node', `$.edges[${i}].to`, 'INVALID_GRAPH_REFERENCE'); evidenceRefs(edge.evidenceIds, evidenceIds, `$.edges[${i}].evidenceIds`) })
  return graph
}

export function parseNoveltyEvidence(value: unknown): NoveltyEvidence {
  const novelty = record(value, '$') as NoveltyEvidence
  array(novelty.closestPriorArt, '$.closestPriorArt'); novelty.closestPriorArt.forEach((reference, i) => parsePriorArtReference(reference, `$.closestPriorArt[${i}]`)); strings(novelty.overlapDimensions, '$.overlapDimensions'); strings(novelty.differenceDimensions, '$.differenceDimensions'); array(novelty.searchQueries, '$.searchQueries'); searchCoverage(novelty.searchCoverage, '$.searchCoverage'); if (!sameQueries(novelty.searchQueries, novelty.searchCoverage.queries)) fail('searchQueries must match searchCoverage.queries', '$.searchQueries'); strings(novelty.unresolvedOverlap, '$.unresolvedOverlap'); uncertainty(novelty.uncertainty, '$.uncertainty'); oneOf(novelty.assessment, ['unresolved', 'possible-difference', 'overlap-found', 'insufficient-search'], '$.assessment')
  if (hasTrueFlag(value, 'verifiedNovelty') || hasStringFlag(value, 'novelty', 'true')) fail('verified novelty is not a valid domain fact', '$', 'NOVELTY_NOT_VERIFIABLE')
  if ((!novelty.searchCoverage.completed || novelty.searchCoverage.sourcesFound === 0) && novelty.assessment === 'possible-difference') fail('a failed or no-hit search cannot imply a novelty conclusion', '$.assessment', 'NOVELTY_NOT_VERIFIABLE')
  return novelty
}

export function parsePriorArtReport(value: unknown): PriorArtReport {
  const report = record(value, '$') as PriorArtReport
  string(report.priorArtReportId, '$.priorArtReportId'); string(report.hypothesisId, '$.hypothesisId'); parseNoveltyEvidence(report.noveltyEvidence); array(report.closestPriorArt, '$.closestPriorArt'); report.closestPriorArt.forEach((reference, i) => parsePriorArtReference(reference, `$.closestPriorArt[${i}]`)); strings(report.overlapDimensions, '$.overlapDimensions'); strings(report.differenceDimensions, '$.differenceDimensions'); searchCoverage(report.searchCoverage, '$.searchCoverage'); uncertainty(report.uncertainty, '$.uncertainty'); time(report.createdAt, '$.createdAt')
  if (JSON.stringify(report.closestPriorArt) !== JSON.stringify(report.noveltyEvidence.closestPriorArt)) fail('closestPriorArt must match noveltyEvidence.closestPriorArt', '$.closestPriorArt', 'INCONSISTENT_RECORD')
  if (JSON.stringify(report.overlapDimensions) !== JSON.stringify(report.noveltyEvidence.overlapDimensions)) fail('overlapDimensions must match noveltyEvidence.overlapDimensions', '$.overlapDimensions', 'INCONSISTENT_RECORD')
  if (JSON.stringify(report.differenceDimensions) !== JSON.stringify(report.noveltyEvidence.differenceDimensions)) fail('differenceDimensions must match noveltyEvidence.differenceDimensions', '$.differenceDimensions', 'INCONSISTENT_RECORD')
  if (JSON.stringify(report.searchCoverage) !== JSON.stringify(report.noveltyEvidence.searchCoverage)) fail('searchCoverage must match noveltyEvidence.searchCoverage', '$.searchCoverage', 'INCONSISTENT_RECORD')
  if (report.searchCoverage.sourcesFound === 0 && report.closestPriorArt.length > 0) fail('no-hit search cannot contain closest prior art', '$.closestPriorArt', 'INCONSISTENT_RECORD')
  return report
}

export function parseHypothesis(value: unknown, knownEvidenceIds?: ReadonlySet<string>): Hypothesis {
  const hypothesis = record(value, '$') as Hypothesis
  string(hypothesis.hypothesisId, '$.hypothesisId'); integer(hypothesis.generation, '$.generation', 0); ids(hypothesis.parentIds, '$.parentIds'); string(hypothesis.statement, '$.statement'); string(hypothesis.motivation, '$.motivation'); string(hypothesis.method, '$.method'); strings(hypothesis.assumptions, '$.assumptions'); ids(hypothesis.evidenceFor, '$.evidenceFor'); ids(hypothesis.evidenceAgainst, '$.evidenceAgainst'); ids(hypothesis.priorArtReportIds, '$.priorArtReportIds'); ids(hypothesis.criticismIds, '$.criticismIds'); ids(hypothesis.experimentIds, '$.experimentIds'); ids(hypothesis.resultEvidenceIds, '$.resultEvidenceIds'); ids(hypothesis.mutationEdgeIds, '$.mutationEdgeIds'); const dimensions = record(hypothesis.dimensions, '$.dimensions'); Object.entries(dimensions).forEach(([name, dimension]) => { const parsed = parseScientificDimension(dimension, `$.dimensions.${name}`); if (parsed.name !== name) fail('dimension key must match dimension.name', `$.dimensions.${name}`, 'INVALID_DIMENSION') }); oneOf(hypothesis.status, ['candidate', 'challenged', 'mutated', 'surviving', 'rejected', 'tested', 'superseded'], '$.status'); time(hypothesis.createdAt, '$.createdAt'); time(hypothesis.updatedAt, '$.updatedAt'); evidenceRefs([...hypothesis.evidenceFor, ...hypothesis.evidenceAgainst, ...hypothesis.resultEvidenceIds], knownEvidenceIds, '$.evidence*'); if (hypothesis.noveltyEvidence !== undefined) parseNoveltyEvidence(hypothesis.noveltyEvidence); if (hypothesis.noveltyEstimate !== undefined) { finiteNumber(hypothesis.noveltyEstimate.value, '$.noveltyEstimate.value', 0, 1); string(hypothesis.noveltyEstimate.rationale, '$.noveltyEstimate.rationale'); oneOf(hypothesis.noveltyEstimate.evaluator, ['model-estimate', 'human'], '$.noveltyEstimate.evaluator') }
  return hypothesis
}

export function parseMutationEdge(value: unknown, knownHypothesisIds?: ReadonlySet<string>): MutationEdge {
  const edge = record(value, '$') as MutationEdge
  string(edge.mutationEdgeId, '$.mutationEdgeId'); string(edge.parentHypothesisId, '$.parentHypothesisId'); string(edge.childHypothesisId, '$.childHypothesisId'); oneOf(edge.mutationType, ['REMOVE_ASSUMPTION', 'REPLACE_COMPONENT', 'COMBINE_MECHANISM', 'NARROW_SCOPE', 'GENERALIZE_SCOPE', 'CHANGE_OBJECTIVE', 'CHANGE_REPRESENTATION', 'ADD_CONSTRAINT', 'REMOVE_CONSTRAINT', 'ADDRESS_COUNTEREXAMPLE', 'INCORPORATE_PRIOR_ART', 'CHANGE_EVALUATION'], '$.mutationType'); string(edge.reason, '$.reason'); string(edge.criticReviewId, '$.criticReviewId'); ids(edge.evidenceIds, '$.evidenceIds'); strings(edge.changedFields, '$.changedFields'); time(edge.timestamp, '$.timestamp'); if (edge.parentHypothesisId === edge.childHypothesisId) fail('parent and child hypothesis IDs must differ', '$.childHypothesisId', 'INVALID_MUTATION_PARENT'); if (knownHypothesisIds && (!knownHypothesisIds.has(edge.parentHypothesisId) || !knownHypothesisIds.has(edge.childHypothesisId))) fail('mutation parent and child must reference existing hypotheses', '$', 'INVALID_MUTATION_PARENT')
  return edge
}

export function parseCriticism(value: unknown, knownEvidenceIds?: ReadonlySet<string>): Criticism {
  const criticism = record(value, '$') as Criticism
  string(criticism.criticismId, '$.criticismId'); string(criticism.hypothesisId, '$.hypothesisId'); string(criticism.reviewerRole, '$.reviewerRole'); optionalString(criticism.reviewId, '$.reviewId'); string(criticism.statement, '$.statement'); oneOf(criticism.severity, ['low', 'medium', 'high', 'fatal'], '$.severity'); ids(criticism.evidenceIds, '$.evidenceIds'); evidenceRefs(criticism.evidenceIds, knownEvidenceIds, '$.evidenceIds'); time(criticism.createdAt, '$.createdAt')
  return criticism
}

export function parseReview(value: unknown, knownEvidenceIds?: ReadonlySet<string>): Review {
  const review = record(value, '$') as Review
  string(review.reviewId, '$.reviewId'); string(review.hypothesisId, '$.hypothesisId'); string(review.role, '$.role'); string(review.summary, '$.summary'); ids(review.criticismIds, '$.criticismIds'); ids(review.evidenceIds, '$.evidenceIds'); evidenceRefs(review.evidenceIds, knownEvidenceIds, '$.evidenceIds'); array(review.dimensions, '$.dimensions'); const dimensionNames = new Set<string>(); review.dimensions.forEach((dimension, i) => { const parsed = parseScientificDimension(dimension, `$.dimensions[${i}]`); if (dimensionNames.has(parsed.name)) fail('review dimensions must be unique', `$.dimensions[${i}].name`, 'DUPLICATE_DIMENSION'); dimensionNames.add(parsed.name) }); time(review.createdAt, '$.createdAt')
  return review
}

export function parseExperimentDesign(value: unknown, knownEvidenceIds?: ReadonlySet<string>): ExperimentDesign {
  const experiment = record(value, '$') as ExperimentDesign
  string(experiment.experimentDesignId, '$.experimentDesignId'); string(experiment.hypothesisId, '$.hypothesisId'); string(experiment.objective, '$.objective'); strings(experiment.variables, '$.variables'); strings(experiment.baselines, '$.baselines'); strings(experiment.datasets, '$.datasets'); strings(experiment.metrics, '$.metrics'); strings(experiment.expectedOutcomes, '$.expectedOutcomes'); strings(experiment.falsificationConditions, '$.falsificationConditions'); string(experiment.discriminativeRationale, '$.discriminativeRationale'); finiteNumber(experiment.estimatedCost, '$.estimatedCost', 0); ids(experiment.evidenceIds, '$.evidenceIds'); evidenceRefs(experiment.evidenceIds, knownEvidenceIds, '$.evidenceIds'); time(experiment.createdAt, '$.createdAt')
  return experiment
}

export function parseScientificDimension(value: unknown, path = '$'): ScientificDimension {
  const dimension = record(value, path) as ScientificDimension
  oneOf(dimension.name, ['novelty', 'prior_art_distance', 'empirical_support', 'theoretical_consistency', 'feasibility', 'expected_impact', 'experimental_cost', 'uncertainty', 'reproducibility'], `${path}.name`); finiteNumber(dimension.value, `${path}.value`, 0, 1); oneOf(dimension.direction, ['maximize', 'minimize'], `${path}.direction`); finiteNumber(dimension.uncertainty, `${path}.uncertainty`, 0, 1); ids(dimension.evidenceIds, `${path}.evidenceIds`); oneOf(dimension.evaluator, ['deterministic', 'model-estimate', 'human'], `${path}.evaluator`); time(dimension.assessedAt, `${path}.assessedAt`)
  return dimension
}

export function parseUncertainty(value: unknown): Uncertainty {
  const result = record(value, '$') as Uncertainty
  finiteNumber(result.level, '$.level', 0, 1); strings(result.reasons, '$.reasons'); return result
}

export function parseBudgetLedger(value: unknown): BudgetLedger {
  const ledger = record(value, '$') as BudgetLedger
  budget(ledger.limits, '$.limits'); budget(ledger.usage, '$.usage'); const keys = ['maxModelCalls', 'maxSearchCalls', 'maxCandidates', 'maxMutations', 'maxTokens'] as const; for (const key of keys) if (ledger.usage[key] > ledger.limits[key]) fail('usage cannot exceed limit', `$.usage.${key}`, 'BUDGET_EXCEEDED'); return ledger
}

export function spendBudget(ledger: BudgetLedger, kind: keyof BudgetLedger['usage'], amount: number): BudgetLedger {
  integer(amount, '$.amount', 1); const next = { ...ledger.usage, [kind]: ledger.usage[kind] + amount }; if (next[kind] > ledger.limits[kind]) fail(`spending ${amount} exceeds budget`, `$.usage.${kind}`, 'BUDGET_EXCEEDED'); return { limits: ledger.limits, usage: next }
}

export function parseDomainEvent(value: unknown): DomainEvent {
  const event = record(value, '$') as DomainEvent
  string(event.eventId, '$.eventId'); string(event.runId, '$.runId'); integer(event.sequence, '$.sequence', 0); oneOf(event.type, ['run.created', 'paper.ingested', 'evidence.added', 'hypothesis.created', 'review.created', 'hypothesis.mutated', 'frontier.selected', 'checkpoint.created', 'stage.started', 'stage.completed', 'stage.failed', 'model.attempt'], '$.type'); time(event.occurredAt, '$.occurredAt'); record(event.payload, '$.payload'); return event
}

export function parseCheckpoint(value: unknown): Checkpoint {
  const checkpoint = record(value, '$') as Checkpoint
  string(checkpoint.checkpointId, '$.checkpointId'); string(checkpoint.runId, '$.runId'); integer(checkpoint.sequence, '$.sequence', 0); hash(checkpoint.stateHash, '$.stateHash'); ids(checkpoint.populationIds, '$.populationIds'); parseBudgetLedger(checkpoint.budget); optionalTime(checkpoint.corpusCutoff, '$.corpusCutoff'); time(checkpoint.createdAt, '$.createdAt'); return checkpoint
}

function provenance(value: unknown, path: string): void {
  const item = record(value, path) as { sourceType?: unknown; sourceId?: unknown; contentHash?: unknown; retrievedAt?: unknown; quotedText?: unknown; locator?: unknown; provider?: unknown; query?: unknown }
  oneOf(item.sourceType, ['paper', 'artifact', 'claim', 'url', 'tool', 'model', 'human', 'experiment'], `${path}.sourceType`); string(item.sourceId, `${path}.sourceId`); optionalString(item.quotedText, `${path}.quotedText`); optionalString(item.contentHash, `${path}.contentHash`); if (item.contentHash !== undefined) hash(item.contentHash, `${path}.contentHash`); optionalTime(item.retrievedAt, `${path}.retrievedAt`)
  optionalString(item.locator, `${path}.locator`); optionalString(item.provider, `${path}.provider`); optionalString(item.query, `${path}.query`)
  if ((item.sourceType === 'paper' || item.sourceType === 'artifact') && item.quotedText !== undefined && (item.locator === undefined || item.contentHash === undefined)) fail('paper or artifact quotations require locator and contentHash', path, 'INVALID_PROVENANCE')
}

function parsePriorArtReference(value: unknown, path: string): PriorArtReference { const reference = record(value, path) as PriorArtReference; string(reference.sourceId, `${path}.sourceId`); string(reference.title, `${path}.title`); optionalString(reference.url, `${path}.url`); strings(reference.overlapDimensions, `${path}.overlapDimensions`); strings(reference.differenceDimensions, `${path}.differenceDimensions`); provenance(reference.provenance, `${path}.provenance`); return reference }
function searchCoverage(value: unknown, path: string): void { const coverage = record(value, path) as { queries?: unknown; sourcesConsidered?: unknown; sourcesFound?: unknown; corpusDescription?: unknown; completed?: unknown }; array(coverage.queries, `${path}.queries`); coverage.queries.forEach((query, i) => { const q = record(query, `${path}.queries[${i}]`) as { query?: unknown; provider?: unknown; resultCount?: unknown; executedAt?: unknown }; string(q.query, `${path}.queries[${i}].query`); string(q.provider, `${path}.queries[${i}].provider`); integer(q.resultCount, `${path}.queries[${i}].resultCount`, 0); time(q.executedAt, `${path}.queries[${i}].executedAt`) }); integer(coverage.sourcesConsidered, `${path}.sourcesConsidered`, 0); integer(coverage.sourcesFound, `${path}.sourcesFound`, 0); if (coverage.sourcesFound > coverage.sourcesConsidered) fail('sourcesFound cannot exceed sourcesConsidered', `${path}.sourcesFound`); string(coverage.corpusDescription, `${path}.corpusDescription`); if (typeof coverage.completed !== 'boolean') fail('expected boolean', `${path}.completed`) }
function sameQueries(a: readonly unknown[], b: readonly unknown[]): boolean { return JSON.stringify(a) === JSON.stringify(b) }
function uncertainty(value: unknown, path: string): void { const result = record(value, path) as Uncertainty; finiteNumber(result.level, `${path}.level`, 0, 1); strings(result.reasons, `${path}.reasons`) }
function budget(value: unknown, path: string): void { const limits = record(value, path) as Record<string, unknown>; for (const key of ['maxModelCalls', 'maxSearchCalls', 'maxCandidates', 'maxMutations', 'maxTokens']) integer(limits[key], `${path}.${key}`, 0) }
function evidenceRefs(values: readonly string[], evidenceIds: ReadonlySet<string> | undefined, path: string): void { if (!evidenceIds) return; values.forEach((id, i) => { if (!evidenceIds.has(id)) fail('evidence reference does not exist', `${path}[${i}]`, 'INVALID_PROVENANCE') }) }
function addUnique(seen: Set<string>, id: string, path: string): void { if (seen.has(id)) fail('duplicate graph node ID', path, 'DUPLICATE_ID'); seen.add(id) }
function hasTrueFlag(value: unknown, key: string): boolean { return record(value, '$')[key] === true }
function hasStringFlag(value: unknown, key: string, expected: string): boolean { return record(value, '$')[key] === expected }
function record(value: unknown, path: string): Record<string, any> { if (value === null || typeof value !== 'object' || Array.isArray(value)) fail('expected object', path); return value as Record<string, any> }
function array(value: unknown, path: string): asserts value is readonly unknown[] { if (!Array.isArray(value)) fail('expected array', path) }
function strings(value: unknown, path: string): asserts value is readonly string[] { array(value, path); value.forEach((item, i) => string(item, `${path}[${i}]`)) }
function ids(value: unknown, path: string): asserts value is readonly string[] { strings(value, path); if (new Set(value).size !== value.length) fail('IDs must be unique', path, 'DUPLICATE_ID') }
function string(value: unknown, path: string): asserts value is string { if (typeof value !== 'string' || value.trim() === '') fail('expected non-empty string', path) }
function optionalString(value: unknown, path: string): void { if (value !== undefined) string(value, path) }
function integer(value: unknown, path: string, min: number, max = Number.MAX_SAFE_INTEGER): asserts value is number { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) fail(`expected integer in [${min}, ${max}]`, path) }
function optionalInt(value: unknown, path: string, min: number, max: number): void { if (value !== undefined) integer(value, path, min, max) }
function finiteNumber(value: unknown, path: string, min = -Infinity, max = Infinity): asserts value is number { if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) fail(`expected finite number in [${min}, ${max}]`, path) }
function oneOf(value: unknown, options: readonly string[], path: string): void { if (typeof value !== 'string' || !options.includes(value)) fail(`expected one of ${options.join(', ')}`, path) }
function time(value: unknown, path: string): void { string(value, path); if (Number.isNaN(Date.parse(value))) fail('expected ISO timestamp', path) }
function optionalTime(value: unknown, path: string): void { if (value !== undefined) time(value, path) }
function hash(value: unknown, path: string): void { string(value, path); if (!isContentHash(value)) fail('expected lowercase SHA-256 hex', path) }
function fail(message: string, path: string, code = 'INVALID_DOMAIN_RECORD'): never { throw new ValidationError(message, path, code) }
