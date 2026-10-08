# Phase 1 vertical slice

## Goal

Support one reproducible run from 3–10 papers and an optional research question to 2–3 evidence-backed surviving research directions. Phase 1 uses bounded model calls and literature retrieval, but does not run arbitrary generated experiments.

## Inputs and configuration

- 3–10 local paper artifacts or stable URLs, each hashed and identified.
- Optional research question.
- Model routes per role, skill versions, literature provider, stage budgets, corpus cutoff (required for temporal mode), and persistence location.
- Sandbox policy is recorded even though execution is disabled; no experiment command is accepted in this slice.

## Pipeline

1. **Ingest and parse.** Validate file type/size, hash artifacts, extract text and basic metadata, and preserve page/section locators. Reject unreadable papers with a recorded diagnostic.
2. **Problem extraction.** Run PaperReader/ProblemExtractor roles per paper or small batches. Validate structured outputs and build the problem graph with evidence links.
3. **Literature enrichment.** Derive bounded queries from open questions and limitations. Search via DSH `ctx.web`; fetch selected sources; record misses, duplicates, provider, timestamps, and source hashes.
4. **Evidence context.** Normalize claims and conflicts into the evidence graph. Build a bounded context view containing only referenced evidence and explicit uncertainty.
5. **Hypothesis generation.** Ask the Inventor role for approximately 10 candidates. Deduplicate by normalized mechanism/problem/expected test, preserving alternate candidates and motivations.
6. **Prior-art search.** Run PriorArtHunter for each candidate or deterministic shortlist. Require closest works and a difference table; a no-hit result is coverage evidence, not a novelty proof.
7. **Falsification and feasibility.** Run Falsifier and FeasibilityCritic, plus Reviewer2 for promising candidates. Store support, contradiction, risks, failure conditions, and dimension estimates independently.
8. **Mutation.** For challenged candidates, create bounded child hypotheses with `MutationEdge` reason, critic, evidence, type, and timestamp. Validate parent references and retain the parent status.
9. **Pareto selection.** Compute the frontier deterministically from recorded dimensions and uncertainty policy. Select 2–3 survivors if available; if fewer survive, report the shortfall and reasons.
10. **Direction report.** Build the explainable dossier and checkpoint final state. Do not generate a claim of verified novelty.

## Checkpoints and recovery

Checkpoint after ingestion, extraction, literature, generation, review, mutation, and selection. A resumed run replays events and skips completed item IDs. Provider/model failure is recorded per attempt; retry policy is bounded and never overwrites the failed attempt.

## Phase 1 acceptance criteria

- [ ] A run accepts 3–10 papers and an optional question with immutable hashes and metadata.
- [ ] Parser/extractor output validates against schemas and produces graph nodes for problems, methods, assumptions, limitations, failure cases, and open questions.
- [ ] Every graph claim has at least one provenance-bearing evidence record or is explicitly marked model interpretation.
- [ ] Literature retrieval records query, provider, URL/identifier, retrieval time, content hash, locator, and failed searches.
- [ ] The run produces approximately 10 candidate hypotheses with IDs, generation, motivation, method, assumptions, evidence for/against, and status.
- [ ] Prior-art dossiers identify closest retrieved work and remaining difference/uncertainty for each reviewed candidate.
- [ ] Falsifier output records counterarguments and concrete falsification conditions; mutation edges preserve reason, critic, evidence, type, and timestamp.
- [ ] Pareto frontier calculation is deterministic, separately dimensioned, and explains dominated/rejected candidates.
- [ ] 2–3 final directions (or an explicit shortfall) each contain all required report fields: hypothesis, motivation, supporting/contradicting evidence, closest prior art, remaining novelty hypothesis, risks, falsification conditions, discriminative experiment, genealogy.
- [ ] A checkpoint can be restored to produce the same domain state and final report without new model calls for completed stages.
- [ ] Tests cover malformed model JSON, missing provenance, duplicate evidence, invalid mutation parent, Pareto ties, provider failure, and checkpoint replay.
- [ ] No generated experiment code runs on the host; Phase 1 rejects execution requests.

## Explicit exclusions

No autonomous multi-generation experiment loop, no claim that novelty is proven, no broad crawler, no learned quality score, no host execution, no new agent framework, and no modification of DSH.
