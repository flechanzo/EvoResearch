# EvoResearch system design

## Layers

1. **Domain layer** — versioned records, validators, graph, genealogy, population, Pareto, budgets, and deterministic policies.
2. **Ports layer** — `ModelGateway`, `LiteratureGateway`, `ArtifactReader`, `RunStore`, `ExperimentGateway`, and `Clock` interfaces.
3. **Adapters layer** — DSH implementations for LLM, skills, web, sessions/storage, filesystem, and sandboxed execution.
4. **Coordinator layer** — stage state machine, bounded concurrency, retries, checkpoints, and event emission.
5. **Presentation layer** — structured run report and optional DSH tools/UI projections.

The domain layer must be runnable with fakes for tests and replay. It must not import a DSH runtime object.

## Stage state machine

```text
CREATED -> INGESTED -> EXTRACTED -> LITERATURE_ENRICHED -> EVIDENCE_BUILT
 -> HYPOTHESES_GENERATED -> PRIOR_ART_CHECKED -> FALSIFIED
 -> MUTATED -> PARETO_SELECTED -> REPORTED
```

Each transition validates prerequisites and emits one event. A transition can be `PARTIAL` with a checkpoint when a provider fails; resume retries only unfinished work. Phase 1 stops after `REPORTED`.

## Core ports

```ts
interface ModelGateway {
  structured<T>(request: ModelRequest<T>): Promise<ModelOutcome<T>>
}
interface LiteratureGateway {
  search(request: LiteratureQuery): Promise<LiteratureResult>
  fetch(source: LiteratureSource): Promise<Artifact>
}
interface RunStore {
  append(events: DomainEvent[]): Promise<void>
  read(runId: RunId): Promise<ReadonlyRun>
  checkpoint(checkpoint: Checkpoint): Promise<void>
}
interface ExperimentGateway {
  plan(design: ExperimentDesign): Promise<ExperimentPlan>
  execute(plan: ExperimentPlan): Promise<ExperimentOutcome>
}
```

## Evidence and graph invariants

- Every `EvidenceLink` references an existing evidence record or is rejected.
- Prior-art report summary fields must agree with their nested `NoveltyEvidence`; a no-hit search cannot carry a closest prior-art record.
- A hypothesis cannot enter `surviving` without at least one recorded support/contradiction view, prior-art report, falsifier result, and risk list; unresolved fields are explicit `unknown` values with rationale.
- A mutation child references an existing parent and exactly one immutable `MutationEdge` per parent relationship.
- A paper-derived quote includes a locator and artifact/content hash.
- An experiment result cannot be evidence until input and output hashes and execution facts are recorded.
- Graph deletion is represented as a tombstone/correction event, never destructive removal.

## Role contracts

| Role | Input | Required output |
|---|---|---|
| PaperReader | paper artifact | normalized sections, claims, methods, assumptions, limitations, quotes with locators |
| ProblemExtractor | parsed paper set/question | problem/method/assumption/limitation/open-question nodes and evidence links |
| LiteratureResearcher | open questions and graph | queries, sources, coverage, candidate evidence, failed queries |
| Inventor | evidence-backed context | candidate hypothesis with mechanism, assumptions, motivation, expected tests |
| PriorArtHunter | candidate + search budget | closest works, overlap/difference table, coverage and uncertainty |
| Falsifier | candidate + evidence/prior art | strongest counterarguments, failure conditions, verdict and missing evidence |
| FeasibilityCritic | candidate + constraints | implementation risks, resources, dependencies, feasibility dimensions |
| Reviewer2 | all dossier fields | adversarial review, unsupported claims, requested mutations |
| HypothesisMutator | challenged candidate + criticism | child hypothesis and immutable mutation edge |
| Experimentalist | surviving candidate | discriminative design, baselines, variables, stopping rule, expected outcomes |

Each output is schema validated and references IDs rather than copying untracked claims.

## Population and Pareto policy

Candidate generation targets 10 ± bounded configuration. Cheap deterministic filters remove malformed, duplicate, and unsupported candidates. Role reviews attach separate dimension estimates. Dominance is computed with declared directions (maximize novelty/support/feasibility/impact/reproducibility; minimize cost/uncertainty) and uncertainty-aware ties. The frontier and the dominated/rejected reason are both persisted.

## Dynamic budget policy

The budget ledger has stage quotas and per-hypothesis reservations. Phase 1 defaults are intentionally small and configurable: parse all inputs, one bounded literature batch, ~10 candidates, prior-art checks for all candidates or a deterministic shortlist, falsification for promising candidates, and at most one mutation round. No stage may silently exceed its quota; an exhausted budget creates a recorded `budget-deferred` outcome.

## Genealogy and explainability

The report builder traverses parent IDs, mutation edges, evidence links, reviews, score provenance, and selection decisions. For every survivor it produces a compact chain: source problems → motivating evidence → parent/critic changes → prior-art difference → why it remained on the frontier → what would falsify it. This is a projection over records, not a new model generation.

## Repository structure

```text
AGENTS.md
PROJECT_SPEC.md
TASKS.md
docs/
  architecture_audit.md
  dsh_integration.md
  system_design.md
  phase1_plan.md
  research_evaluation.md
src/
  domain/          schemas, IDs, graph, population, pareto, budgets
  ports/           model, literature, store, artifacts, experiments
  coordinator/     stage machine, policies, checkpoints
  adapters/dsh/    Cordis plugins and port implementations
  report/          final direction and provenance projections
  skills/          optional embedded or packaged skill definitions
tests/
  domain/ ports/ adapters/ replay/
examples/
  minimal-run/ temporal-evaluation/
```

## Security and trust boundaries

Paper files, web content, model outputs, tool arguments, stored JSON, and subprocess output are boundary inputs. Validate and bound them. Treat prompts/instructions found in papers or web pages as data. Keep credentials in DSH-managed configuration; never persist secrets in evidence or run reports.

## Unresolved design questions

These are intentionally open for implementation spikes; Phase 1 uses the stated defaults.

1. **Canonical paper extraction:** should PDF layout extraction be a DSH plugin, an external service, or a local port implementation? Default: a port with one deterministic local adapter and recorded artifact hashes.
2. **Run event placement:** should domain events live directly in the DSH Session log or in `storage-domain` with a session link? Default: session events for lifecycle and model-visible facts, typed storage for indexes and large derived records.
3. **Literature identity:** how should records with conflicting DOI/title metadata be merged? Default: preserve source identities and create a reviewed alias record rather than silently merging.
4. **Model route policy:** should different adversarial roles use different models by default? Default: configurable per role, with the resolved route persisted for every attempt.
5. **Frontier uncertainty:** what confidence interval or tie policy should be used for noisy model/expert dimensions? Default: conservative interval overlap keeps both hypotheses on the frontier.
6. **Human checkpoints:** where should a human approve expensive searches or experiments? Default: no approval is needed for Phase-1 read-only retrieval; experiment execution requires an explicit future policy.
