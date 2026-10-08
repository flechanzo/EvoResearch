# EvoResearch project specification

## Mission

EvoResearch is an autonomous scientific research system built on DeepSeek Harness (DSH). Its purpose is **evidence-grounded evolutionary scientific discovery**: transform papers and a research question into competing, provenance-backed hypotheses; challenge them with literature and adversarial reasoning; mutate challenged ideas; select a Pareto frontier; and design discriminative experiments. It must explain why each surviving direction exists and what would falsify it.

The intended loop is:

```text
papers + question
  -> problem extraction -> literature research -> evidence graph
  -> hypothesis population -> prior-art search -> novelty falsification
  -> feasibility analysis -> adversarial review -> mutation
  -> Pareto selection -> experiment design -> sandboxed experiment
  -> evidence update -> next generation
```

This is a population-and-evidence system, not a papers-to-LLM-to-ideas pipeline.

## Non-negotiable principles

- DSH remains an upstream runtime; EvoResearch does not fork or modify it.
- Scientific claims retain provenance to a paper, dataset, experiment, tool result, or explicitly marked model interpretation.
- Models propose and critique; deterministic code validates records, deduplicates evidence, computes graph relations, applies budgets, and calculates Pareto dominance.
- No LLM novelty score is ground truth. Novelty is a documented hypothesis supported by search coverage, closest prior art, and remaining difference.
- Multiple hypotheses remain alive until an explicit filter or experiment removes them.
- Generated code runs only through an enforcing DSH sandbox.
- All state is checkpointable and replayable with provider/model/configuration metadata.

## Domain model

The canonical store is a versioned research run containing immutable inputs and append-only events. A relational or document backend may implement it, but the logical records below are stable.

### Research context

```text
ResearchRun {
  run_id, schema_version, created_at, updated_at,
  research_question?, corpus_cutoff?, input_papers[],
  configuration, model_routes, skill_versions, status,
  current_generation, checkpoints[], audit_log[]
}
```

`input_papers` stores stable paper identifiers (DOI/arXiv/URL when available), title, authors, publication year, source URL, local artifact hash, retrieval timestamp, and corpus inclusion reason. A cutoff is mandatory for temporal evaluation runs.

### Research problem graph

Nodes are typed `paper`, `problem`, `method`, `assumption`, `dataset`, `metric`, `limitation`, `failure_case`, or `open_question`. Edges are typed and carry `evidence_ids`, confidence, and provenance. Graph facts are never silently overwritten; a correction creates a new fact/version.

### Evidence graph

```text
Evidence {
  evidence_id, kind: observation | quote | table | result | tool_result | interpretation,
  claim, polarity: SUPPORT | CONTRADICT | WEAKEN | MOTIVATE,
  source: { paper_id?, url?, doi?, artifact_hash?, tool?, query?, retrieved_at?,
            locator?, quoted_text?, checksum? },
  extraction_method: parser | model | human | experiment,
  confidence, limitations[], created_at
}
EvidenceLink { evidence_id, target_type: problem | hypothesis | edge, target_id, relation, rationale }
```

External content is stored with a trust label and never treated as instructions.

### Hypothesis population

```text
Hypothesis {
  hypothesis_id, generation, parent_ids[], statement, motivation,
  proposed_method, assumptions[], evidence_for[], evidence_against[],
  prior_art[], criticisms[], experiments[], results[], mutation_history[],
  scores: { novelty, prior_art_distance, empirical_support,
            theoretical_consistency, feasibility, expected_impact,
            experimental_cost, uncertainty, reproducibility },
  score_provenance[], status: candidate | challenged | mutated | surviving |
         rejected | tested | superseded,
  created_at, updated_at
}
```

Every score has a scale definition, evaluator, evidence references, timestamp, and uncertainty. Scores are incomparable across scales until normalized by a declared policy.

### Mutation genealogy

```text
MutationEdge {
  edge_id, parent_id, child_id, reason, critic_role,
  evidence_ids[], mutation_type, timestamp
}
```

Mutation types include assumption relaxation, scope narrowing, mechanism replacement, measurement change, dataset shift, control addition, and decomposition. Rejected alternatives remain in the run log.

### Reviews, experiments, and budgets

Reviews identify role, prompt/skill version, model route, claims examined, criticisms, and evidence. Experiment designs specify variables, baselines, expected observations, discriminative power, stopping criteria, compute/data cost, and safety constraints. Execution records input hashes, sandbox policy, command/tool invocations, outputs, exit status, and result evidence. A budget ledger records allocation, consumption, and rationale per stage and hypothesis.

## DSH boundary

EvoResearch supplies domain services and DSH plugins/adapters. It reuses DSH's plugin composition, model adapter registry, skill registry, web/search seam, subagent providers, append-only sessions, storage providers, shell and sandbox seams, structured tool execution, and lifecycle/telemetry. See `docs/dsh_integration.md`.

## Phase 1 outcome

Given 3–10 papers and an optional question, Phase 1 parses and extracts structured research context, retrieves related literature, builds an evidence-backed context, generates about 10 candidates, searches prior art, runs a falsifier, mutates challenged hypotheses, and returns 2–3 surviving directions. Each direction must include hypothesis, motivation, supporting and contradicting evidence, closest prior art, remaining novelty hypothesis, risks, falsification conditions, a discriminative experiment, and genealogy. Phase 1 does not execute arbitrary generated experiments or claim verified novelty.

## Deferred capabilities

The following are designed but not required for the first slice: large adaptive populations, expensive experiment scheduling, live external collaboration, full temporal benchmark automation, learned ranking, broad dataset execution, and autonomous publication.
