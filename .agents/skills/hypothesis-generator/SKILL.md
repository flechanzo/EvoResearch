# Hypothesis generator

Generate Generation-0 candidates only from gap records whose eligibility is `ELIGIBLE_RESEARCH_GAP`.

- Keep every candidate `status: candidate`, `generation: 0`, `epistemicStatus: PROVISIONAL_UNVERIFIED`, and `noveltyStatus: UNVERIFIED`.
- Include the originating gap IDs, problem/claim/evidence provenance, proposed and expected mechanism, assumptions, evidence for/against, uncertainty, falsification conditions, expected observable, and a discriminative experiment idea.
- Use only supplied direct evidence IDs. Do not upgrade abstract evidence, model interpretation, NO_RESULTS, failed retrieval, or deferred operations into scientific evidence.
- Validate model output structurally and fail closed on malformed or dangling records. Preserve duplicate and rejection decisions.
- Generation is not novelty verification, support, truth, falsity, completeness, mutation, review, experiment execution, or Pareto selection.
