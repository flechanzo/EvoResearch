# EvoResearch and DSH integration

## Integration shape

```text
DSH profile/bundle
  ├─ model adapters (ctx.llm)
  ├─ skill registry/providers (ctx.skills)
  ├─ web search/fetch (ctx.web)
  ├─ tools and guarded execution (ctx.tools)
  ├─ optional role subagents (ctx.subagents)
  ├─ session event log/projections (ctx.sessions)
  ├─ storage/filesystem (ctx.storage, ctx.fs)
  └─ shell/subprocess/sandbox (ctx.shell, ctx.subprocess, ctx.sandbox)
          │ adapters and event consumers
EvoResearch domain services
  ├─ ingestion and paper parser
  ├─ problem/evidence graph
  ├─ hypothesis population and genealogy
  ├─ prior-art and falsification coordinator
  ├─ Pareto/budget policy
  ├─ experiment planner/executor boundary
  └─ checkpoint, replay, and evaluation
```

## Reuse versus implement

### Reuse directly

- Cordis plugin lifecycle, configuration validation, effects, and profile composition.
- `ctx.llm` adapters and streaming/replay vocabulary; do not create a second model client abstraction below the EvoResearch port.
- `ctx.skills` and filesystem skill providers for portable role instructions in `.agents/skills/`.
- `ctx.web` plus `dsh-tool-web` for literature discovery and page retrieval; provider selection and errors remain DSH-owned.
- `ctx.subagents` for bounded, intentionally independent roles. Use one-shot children for isolated reviews and continuable children only when a durable conversation is justified.
- `ctx.sessions` for append-only run facts and replay; use session projections for current run/population views.
- DSH storage providers for indexes/artifacts when their durability and transaction guarantees meet the EvoResearch store contract.
- `ctx.fs`, `ctx.shell`, `ctx.subprocess`, and `ctx.sandbox` for all file and process effects.

### Implement in EvoResearch

- Domain schemas and validation for papers, claims, evidence, graph nodes/edges, hypotheses, scores, reviews, mutations, experiments, budgets, and evaluation splits.
- Deterministic paper artifact hashing and metadata normalization.
- Problem graph and evidence graph operations, conflict representation, provenance traversal, and genealogy queries.
- Role orchestration policy, population lifecycle, mutation operators, Pareto dominance/frontier, progressive budget filters, and checkpoint protocol.
- Citation/prior-art normalization and search coverage reports.
- Scientific validity checks, temporal leakage audit, and final direction rendering.
- A replaceable `ModelGateway`, `LiteratureGateway`, `ExperimentGateway`, and `RunStore` interface with DSH adapters.

## Proposed DSH contributions

1. `evoresearch-domain`: pure schemas and deterministic services; no Cordis dependency where avoidable.
2. `evoresearch-runtime`: run coordinator that consumes a model gateway, literature gateway, and store.
3. `evoresearch-skills`: embedded/project skill registrations for paper reading, extraction, prior-art hunting, falsification, mutation, and review.
4. `evoresearch-tools`: narrow model-facing tools that call the runtime and return structured, provenance-bearing results.
5. `evoresearch-experiment-sandbox`: optional provider/consumer that turns an experiment design into a validated sandbox call; disabled in Phase 1.

These can initially live as folders/packages in this repository. They should be mountable in a DSH profile through a patch and should not alter DSH core packages.

## Model and role routing

The coordinator asks the provider-independent `ModelGateway.structured(request)` port with a role, structured output schema, bounded context, and context evidence IDs. The existing Responses adapter selects the configured provider/model and records the resolved route and streamed response diagnostics. Structured output is validated at the boundary; invalid output is a failed attempt with diagnostics, not silently repaired into a scientific claim. M5A reuses this seam for the bounded GapDiscovery and Generation-0 canary.

Role prompts are skills or templates, not one giant prompt. A role receives a bounded evidence view and must return claim IDs, uncertainties, and proposed next actions. Disagreement is represented as separate review records.

## Sessions, storage, and checkpointing

The run coordinator emits domain events into the DSH session log (or a RunStore that is linked from a session). Events include input ingestion, extraction, retrieval, evidence addition, hypothesis creation, review, mutation, score update, selection, and checkpoint. A checkpoint contains the last applied event sequence, population IDs, budget ledger, and configuration hash. Resume reconstructs deterministic state from the checkpoint plus subsequent events.

Use DSH durable session IDs for runtime identity. Use EvoResearch branded IDs for domain records and never overload a raw string across boundaries.

## Web and citation policy

The literature adapter calls `ctx.web.search` and `ctx.web.fetch`, captures provider, query, URL, final URL, status, retrieval time, and content hash, and stores quoted spans or structured extraction locators. Web text is external/untrusted data. A search miss is recorded as coverage information, never converted into `novel = true`.

## Sandboxed experiments

The experiment gateway accepts only a validated design and generated artifact hashes. It resolves a per-call DSH sandbox policy, calls `ctx.sandbox.confine` through a shell/subprocess adapter, and records enforcement, output hashes, exit state, and resource limits. If a runner is unavailable, the gateway returns a typed refusal. `danger-full-access` requires an explicit deployment policy and is not a Phase-1 default.

## Failure and observability contract

Every external call has a correlation ID, role/stage, input IDs, provider/model, start/end timestamps, token/cost metadata when available, and a typed outcome. Transient provider failures may be retried under a bounded policy; scientific outputs are never duplicated without recording attempt identity. Partial progress is checkpointed at stage boundaries.
