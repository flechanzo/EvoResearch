# EvoResearch implementation tasks

Tasks are ordered. Checkboxes may be split into smaller commits, but an item is complete only when its acceptance criteria are met.

## Phase 0 — foundations and contracts

- [x] Add package metadata, TypeScript configuration, and a minimal test runner without adding an agent framework.
  - Acceptance: clean install/build instructions are documented; no DSH files change.
- [x] Implement branded IDs, schema versioning, boundary validators, and domain event envelope.
  - Acceptance: malformed IDs, versions, timestamps, and unknown event variants fail with actionable errors.
- [ ] Implement paper/artifact manifest and deterministic hashing.
  - Acceptance: identical bytes produce identical IDs; metadata and retrieval facts are retained.
- [x] Implement graph, evidence, hypothesis, review, mutation, experiment, budget, event, and checkpoint schemas.
  - Acceptance: all invariants in `docs/system_design.md` have focused tests.
- [x] Implement deterministic Pareto frontier calculation as a pure domain function.
  - Acceptance: separate dimensions, uncertainty, deterministic ordering, ties, and dominated reasons are test-covered.

## Phase 1 — vertical slice

- [ ] Implement paper text/metadata ingestion port and a deterministic parser adapter.
  - Acceptance: 3–10 fixtures produce normalized sections and locators; unreadable input is recorded, not silently skipped.
- [ ] Add DSH model gateway adapter with structured-output validation and attempt logging.
  - Acceptance: provider/model/skill route and failed attempts are persisted; invalid JSON never becomes a claim.
- [ ] Add project skills for paper reading, problem extraction, literature research, invention, prior-art hunting, falsification, feasibility, review, mutation, and experimental design.
  - Acceptance: each skill has versioned metadata and a schema-constrained output contract.
- [ ] Add DSH web/literature adapter and citation normalizer.
  - Acceptance: queries, source IDs/URLs, retrieval times, hashes, locators, misses, and provider errors are stored.
- [ ] Implement problem/evidence graph construction and provenance traversal.
  - Acceptance: missing links and unsupported final claims are rejected; conflict edges are preserved.
- [ ] Implement hypothesis population, deduplication, reviews, mutation genealogy, and statuses.
  - Acceptance: parent/child invariants and mutation edge fields are enforced.
- [ ] Implement deterministic Pareto frontier and bounded budget ledger.
  - Acceptance: separate dimensions, directions, uncertainty, ties, and dominated reasons are test-covered.
- [ ] Implement stage coordinator, checkpoints, resume, and final direction report.
  - Acceptance: a fixture run restores and reproduces the final report without repeating completed calls.
- [ ] Add Phase-1 integration fixtures and acceptance tests.
  - Acceptance: the checklist in `docs/phase1_plan.md` passes, including explicit shortfall reporting.

## Phase 2 — stronger evidence and safe experiments

- [ ] Add PDF extraction backends and human correction/import path with immutable revisions.
- [ ] Add multiple literature providers, deduplication confidence, and coverage diagnostics.
- [ ] Add sandboxed experiment planner/executor using DSH `ctx.shell`/`ctx.sandbox`; keep host execution impossible.
- [ ] Add result ingestion, negative-result evidence, replication metadata, and resource budgets.
- [ ] Add richer DSH session projections and observability dashboards.

Acceptance: an experiment either runs under an enforcing policy with a complete artifact record or fails closed; negative and partial results remain replayable.

## Phase 3 — evolutionary research loop

- [ ] Add multi-generation population scheduling and adaptive compute allocation.
- [ ] Add role subagent orchestration with explicit disagreement and capacity limits.
- [ ] Add experiment-driven evidence updates, mutation from results, and frontier history.
- [ ] Add temporal evaluation harness and corpus snapshots.

Acceptance: a run can advance generations with bounded budgets, explain every mutation and selection, and run a cutoff-audited temporal benchmark.

## Cross-cutting quality gates

- [ ] No new dependency duplicates DSH capability seams.
- [ ] No citation or evidence record lacks provenance fields required by the schema.
- [ ] No generated code executes outside a DSH sandbox adapter.
- [ ] Domain tests run without network or model credentials; adapter tests use fakes and recorded fixtures.
- [ ] Documentation and schemas are updated together; DSH remains unmodified.
