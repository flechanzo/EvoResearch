# Research evaluation and scientific validity

## Evaluation tracks

### Reproducible run evaluation

Given a fixed paper set, question, configuration, model/provider route, and random seed where supported, replay should reproduce the same validated domain state and deterministic selections. Model outputs are retained so a later audit can distinguish provider drift from coordinator bugs.

### Expert dossier evaluation

Blind domain experts score each final direction for problem relevance, novelty plausibility, mechanism clarity, evidence quality, falsifiability, feasibility, and experimental discrimination. Scores are separate dimensions with inter-rater disagreement retained. Reviewers must be shown citations and the genealogy, not only a prose summary.

### Temporal discovery evaluation

For cutoff year `T`, construct an allowlisted corpus containing only literature with publication date ≤ `T` plus explicitly documented metadata. Run EvoResearch with that corpus and freeze all retrieval APIs to the snapshot. Compare generated hypotheses with discoveries published in `T+1` through `T+3` using a preregistered matching rubric.

The evaluation must store:

- corpus manifest, source dates, hashes, and inclusion/exclusion reasons;
- every query and retrieved result, including results rejected by the cutoff filter;
- model/provider versions, prompts/skills, configuration, and timestamps;
- generated hypotheses and their creation evidence;
- post-cutoff discovery set and independent matching judgments.

Any source or metadata that was unavailable at `T` is leakage and invalidates that run. A later paper may be used only during scoring, never generation, critique, mutation, or selection.

## Matching future directions

Use multiple independent judges or a blinded rubric to classify whether a generated hypothesis anticipates a future discovery at the level of problem, mechanism, and testable consequence. Exact wording or citation overlap is not required. Report precision-like coverage, false anticipation, novelty plausibility, and calibration separately; do not collapse them into one success score.

## Scientific validity risks and controls

| Risk | Control |
|---|---|
| Citation fabrication | Require source IDs/locators and reject unsupported claims. |
| Novelty illusion from search failure | Record coverage and uncertainty; require closest prior art and difference analysis. |
| Popularity or recency bias | Preserve query logs, use multiple providers where possible, and audit ranking. |
| Prompt-induced consensus | Run adversarial roles independently and retain disagreement. |
| Leakage from future metadata | Manifest and cutoff validation at ingestion and retrieval boundaries. |
| LLM score anchoring | Deterministic Pareto selection over separately evidenced dimensions. |
| Hindsight bias in scoring | Blind judges to generation time and compare against preregistered criteria. |
| Unreproducible experiments | Hash inputs/code, record sandbox policy and environment, and retain outputs. |
| Dataset/metric gaming | Require baselines, negative controls, robustness checks, and failure conditions. |
| Survivorship bias | Persist rejected candidates and reasons; report population attrition. |
| Model/provider drift | Record routes and raw structured attempts; replay with pinned artifacts. |

## Reporting requirements

Every evaluation report states the corpus boundary, retrieval coverage, unsupported claims, uncertainty, population attrition, frontier policy, human-review protocol, and known leakage or missing-data limitations. A direction is a research lead, not a verified discovery, until independent experiments and expert review support it.

## Future experiment metrics

When sandboxed experiments are enabled, evaluate discriminative power, replication across seeds/datasets, effect-size uncertainty, compute/data cost, failure rate, and reproducibility. A negative result is valuable evidence and must update the hypothesis status and genealogy rather than disappear.
