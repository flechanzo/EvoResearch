# Milestone 4C: deterministic evaluation and Pareto selection

M4C accepts structured evaluation records for an M4A or M4B hypothesis population and applies no model judgment. Every record contains the complete eight-dimension evaluation vector, separate uncertainty and confidence, evidence references, evaluator, timestamp, and rationale. The dimensions remain independent: evidence support, feasibility, expected impact, reproducibility, and novelty potential are maximized; uncertainty, experimental cost, and prior-art overlap are minimized.

The Pareto service compares every complete vector with uncertainty-aware deterministic tolerances. Equal or within-tolerance candidates remain tied on the frontier. Every dominated candidate retains sorted dominator IDs, dimension-level explanations, and a reader-facing rationale. The population is never reduced or deleted.

Selection state is explicit and append-only: `CREATED → EVALUATED → FRONTIER → SELECTED → ARCHIVED`, with the mutually exclusive dominance branch `EVALUATED → DOMINATED → ARCHIVED`. M4C does not mark a hypothesis as scientifically surviving; it records selection state separately from the hypothesis and leaves future evaluation and experiment stages responsible for any later transition.

`buildM4CArtifacts` validates replay input, computes a content-addressed selection projection, and persists a compatible checkpoint. Replaying identical hypotheses, evaluations, timestamp, and selection policy produces identical evaluation IDs, frontier membership, explanations, states, and checkpoint state hash.
