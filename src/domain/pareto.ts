import type { Hypothesis, ScientificDimension, ScientificDimensionName } from './types.ts'

export interface ParetoResult {
  readonly frontier: readonly Hypothesis[]
  readonly dominated: readonly Hypothesis[]
  readonly dominance: Readonly<Record<string, readonly string[]>>
}

const DIMENSION_ORDER: readonly ScientificDimensionName[] = ['novelty', 'prior_art_distance', 'empirical_support', 'theoretical_consistency', 'feasibility', 'expected_impact', 'experimental_cost', 'uncertainty', 'reproducibility']

export function paretoFrontier(hypotheses: readonly Hypothesis[]): ParetoResult {
  const sorted = [...hypotheses].sort((a, b) => a.hypothesisId.localeCompare(b.hypothesisId))
  const dominatedBy = new Map<string, string[]>()
  const frontier: Hypothesis[] = []
  const dominated: Hypothesis[] = []
  for (const candidate of sorted) {
    const dominators = sorted.filter(other => other.hypothesisId !== candidate.hypothesisId && dominates(other, candidate)).map(other => other.hypothesisId)
    dominators.sort()
    dominatedBy.set(candidate.hypothesisId, dominators)
    if (dominators.length === 0) frontier.push(candidate)
    else dominated.push(candidate)
  }
  return { frontier, dominated, dominance: Object.fromEntries([...dominatedBy.entries()].map(([id, values]) => [id, values])) }
}

export function dominates(left: Hypothesis, right: Hypothesis): boolean {
  let strictlyBetter = false
  for (const name of DIMENSION_ORDER) {
    const a = left.dimensions[name]
    const b = right.dimensions[name]
    if (!a || !b) continue
    const tolerance = Math.max(a.uncertainty, b.uncertainty)
    const comparison = compare(a, b, tolerance)
    if (comparison < 0) return false
    if (comparison > 0) strictlyBetter = true
  }
  return strictlyBetter
}

function compare(a: ScientificDimension, b: ScientificDimension, tolerance: number): number {
  const delta = a.direction === 'minimize' ? b.value - a.value : a.value - b.value
  if (delta > tolerance) return 1
  if (delta < -tolerance) return -1
  return 0
}
