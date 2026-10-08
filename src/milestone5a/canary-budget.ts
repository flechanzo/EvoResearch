import { PREFLIGHT_MAX_ATTEMPTS } from '../adapters/model-preflight.ts'

export interface M5ACanaryBudgetOptions {
  readonly maxPreflightCalls?: number
  readonly maxGapCalls?: number
  readonly maxHypothesisCalls?: number
  readonly maxTotalModelCalls?: number
  readonly candidateGapBudget?: number
  readonly hypothesisBudget?: number
  readonly maxSerializationRetries?: number
}

export interface M5ACanaryCallPlan {
  readonly preflight: number
  readonly gapDiscovery: number
  readonly generation0: number
  readonly total: number
  readonly limit: number
  readonly openAlex: 0
  readonly candidateGapBudget: number
  readonly hypothesisBudget: number
  readonly serializationRetriesPerRole: number
  readonly errors: readonly string[]
}

/** Reserve every physical request, including preflight and structural retries. */
export function planM5ACanaryCalls(options: M5ACanaryBudgetOptions = {}): M5ACanaryCallPlan {
  const errors: string[] = []
  const bounded = (name: keyof M5ACanaryBudgetOptions, fallback: number, minimum: number, maximum: number): number => {
    const value = options[name] ?? fallback
    if (!Number.isInteger(value) || value < minimum || value > maximum) errors.push(`INVALID_CANARY_BUDGET: ${name} must be an integer in [${minimum}, ${maximum}]`)
    return value
  }
  const preflight = bounded('maxPreflightCalls', 1, 1, PREFLIGHT_MAX_ATTEMPTS)
  const gapLimit = bounded('maxGapCalls', 2, 1, 2)
  const generationLimit = bounded('maxHypothesisCalls', 2, 1, 2)
  const limit = bounded('maxTotalModelCalls', 5, 1, 5)
  const candidateGapBudget = bounded('candidateGapBudget', 3, 1, 3)
  const hypothesisBudget = bounded('hypothesisBudget', 3, 1, 3)
  const serializationRetriesPerRole = bounded('maxSerializationRetries', 1, 0, 1)
  const gapDiscovery = Math.min(gapLimit, 1 + serializationRetriesPerRole)
  const generation0 = Math.min(generationLimit, 1 + serializationRetriesPerRole)
  const total = preflight + gapDiscovery + generation0
  if (!errors.length && total > limit) errors.push(`CANARY_PLAN_EXCEEDS_BUDGET: preflight(${preflight}) + GapDiscovery(${gapDiscovery}) + Generation-0(${generation0}) = ${total} exceeds maxTotalModelCalls(${limit}); reduce preflight or role retry allowances.`)
  return { preflight, gapDiscovery, generation0, total, limit, openAlex: 0, candidateGapBudget, hypothesisBudget, serializationRetriesPerRole, errors }
}
