import { ValidationError } from './validation.ts'

export interface RunBudgetLimits {
  readonly maxTotalModelCalls: number
  readonly maxPaperReaderModelCalls: number
  readonly maxProblemExtractorModelCalls: number
  readonly maxEvidenceExtractorModelCalls: number
  readonly maxSerializationRetriesPerOperation: number
  readonly maxRetrievalNeeds: number
  readonly maxQueriesPerRetrievalNeed: number
  readonly maxResultsExaminedPerQuery: number
  readonly maxSelectedSourcesPerRetrievalNeed: number
}

export interface RunBudgetUsage {
  readonly totalModelCalls: number
  readonly paperReaderModelCalls: number
  readonly problemExtractorModelCalls: number
  readonly evidenceExtractorModelCalls: number
  readonly serializationRetries: number
  readonly retrievalNeeds: number
  readonly queries: number
  readonly resultsExamined: number
  readonly selectedSources: number
}

export const DEFAULT_RUN_BUDGET: RunBudgetLimits = {
  maxTotalModelCalls: 30,
  maxPaperReaderModelCalls: 9,
  maxProblemExtractorModelCalls: 6,
  maxEvidenceExtractorModelCalls: 12,
  maxSerializationRetriesPerOperation: 1,
  maxRetrievalNeeds: 12,
  maxQueriesPerRetrievalNeed: 3,
  maxResultsExaminedPerQuery: 20,
  maxSelectedSourcesPerRetrievalNeed: 5,
}

export class BudgetExhaustedError extends Error {
  readonly code = 'BUDGET_EXHAUSTED'
  readonly resource: keyof RunBudgetUsage
  readonly limit: number
  readonly requested: number
  constructor(resource: keyof RunBudgetUsage, limit: number, requested: number) {
    super(`BUDGET_EXHAUSTED: ${resource} would exceed ${limit}`)
    this.resource = resource; this.limit = limit; this.requested = requested
    this.name = 'BudgetExhaustedError'
  }
}

export class RunBudget {
  readonly limits: RunBudgetLimits
  private current: RunBudgetUsage = { totalModelCalls: 0, paperReaderModelCalls: 0, problemExtractorModelCalls: 0, evidenceExtractorModelCalls: 0, serializationRetries: 0, retrievalNeeds: 0, queries: 0, resultsExamined: 0, selectedSources: 0 }
  private readonly serializationByOperation = new Map<string, number>()
  constructor(limits: Partial<RunBudgetLimits> = {}) {
    this.limits = { ...DEFAULT_RUN_BUDGET, ...limits }
    for (const [key, value] of Object.entries(this.limits)) if (!Number.isInteger(value) || value < 0) throw new ValidationError(`budget ${key} must be a non-negative integer`, `$.${key}`)
  }
  get usage(): RunBudgetUsage { return { ...this.current } }
  private spend(resource: keyof RunBudgetUsage, limit: number, amount: number) { if (!Number.isInteger(amount) || amount < 0) throw new ValidationError(`budget increment for ${resource} must be a non-negative integer`, `$.${resource}`); const next = this.current[resource] + amount; if (next > limit) throw new BudgetExhaustedError(resource, limit, amount); this.current = { ...this.current, [resource]: next } }
  modelCall(role: string) { const roleKey = role === 'PaperReader' ? 'paperReaderModelCalls' : role === 'ProblemExtractor' ? 'problemExtractorModelCalls' : role === 'EvidenceExtractor' ? 'evidenceExtractorModelCalls' : undefined; const roleLimit = roleKey === 'paperReaderModelCalls' ? this.limits.maxPaperReaderModelCalls : roleKey === 'problemExtractorModelCalls' ? this.limits.maxProblemExtractorModelCalls : roleKey === 'evidenceExtractorModelCalls' ? this.limits.maxEvidenceExtractorModelCalls : Number.MAX_SAFE_INTEGER; if (this.current.totalModelCalls + 1 > this.limits.maxTotalModelCalls || (roleKey && this.current[roleKey] + 1 > roleLimit)) throw new BudgetExhaustedError(roleKey ?? 'totalModelCalls', roleKey ? roleLimit : this.limits.maxTotalModelCalls, 1); this.current = { ...this.current, totalModelCalls: this.current.totalModelCalls + 1, ...(roleKey ? { [roleKey]: this.current[roleKey] + 1 } : {}) } }
  serializationRetry(operation = 'default') { const used = this.serializationByOperation.get(operation) ?? 0; if (used + 1 > this.limits.maxSerializationRetriesPerOperation) throw new BudgetExhaustedError('serializationRetries', this.limits.maxSerializationRetriesPerOperation, 1); this.serializationByOperation.set(operation, used + 1); this.current = { ...this.current, serializationRetries: this.current.serializationRetries + 1 } }
  retrievalNeed(amount = 1) { this.spend('retrievalNeeds', this.limits.maxRetrievalNeeds, amount) }
  query(amount = 1) { this.spend('queries', Number.MAX_SAFE_INTEGER, amount) }
  resultsExamined(amount: number) { this.spend('resultsExamined', Number.MAX_SAFE_INTEGER, amount) }
  selectedSources(amount: number) { this.spend('selectedSources', Number.MAX_SAFE_INTEGER, amount) }
  assertQueryCountForNeed(count: number) { if (count > this.limits.maxQueriesPerRetrievalNeed) throw new BudgetExhaustedError('queries', this.limits.maxQueriesPerRetrievalNeed, count) }
  assertResultsPerQuery(count: number) { if (count > this.limits.maxResultsExaminedPerQuery) throw new BudgetExhaustedError('resultsExamined', this.limits.maxResultsExaminedPerQuery, count) }
  assertSelectedSourcesPerNeed(count: number) { if (count > this.limits.maxSelectedSourcesPerRetrievalNeed) throw new BudgetExhaustedError('selectedSources', this.limits.maxSelectedSourcesPerRetrievalNeed, count) }
}
