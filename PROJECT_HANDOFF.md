# EvoResearch project handoff

Audit basis: repository contents, source implementations, tests, saved artifacts under `evaluation/` and `outputs/`, and the DSH inspection recorded in `docs/architecture_audit.md`. No planned capability is treated as implemented unless source, tests, or a saved run support it. The audit was made on 2026-10-07 (Asia/Shanghai). API keys and other secret values are intentionally omitted.

## 1. Current project status

EvoResearch currently runs a guarded M3.5C pipeline over three local PDFs: artifact ingestion, PDF extraction, model-assisted paper reading, problem extraction, problem-graph construction, retrieval-need and query planning, OpenAlex retrieval, deterministic source selection, bounded evidence extraction, evidence-graph construction, evaluation, and report rendering. This path has completed with real PDFs, a configured model endpoint, and live OpenAlex calls. The strongest saved run is complete at the pipeline level but reports `scientificallyComplete: false` because evidence work was deferred and the evidence graph is sparse.

The repository also contains deterministic M4A/M4B/M4C/M4D modules and an M5A canary. M4A discovers research gaps and can seed Generation-0 candidates; M4B mutates hypotheses from caller-supplied reviews; M4C evaluates caller-supplied vectors and computes a deterministic Pareto frontier; M4D composes those pieces in a synthetic fixture. This iteration adds an explicit opt-in Generation-0 extension after `EVALUATE` in the M3.5C coordinator and routes the saved-run importer through the shared `runGeneration0Extension` boundary. M5A remains a separate operator-run canary over a saved M1–M3 run and retains its historical live result: accepted zero hypotheses because GapDiscovery and Generation-0 each exhausted a structural retry (four role calls in the ledger) before the canary stopped by design.

The repository cannot yet produce the Phase-1 result promised in `PROJECT_SPEC.md`: two or three evidence-backed surviving directions with prior-art dossiers, falsification conditions, feasibility review, mutation genealogy, and a discriminative experiment. It has no active prior-art hunter, falsifier, feasibility critic, reviewer orchestration, experiment planner/executor, sandbox gateway, DSH session/storage integration, or resumable live coordinator.

**CURRENT_PHASE:** M3.5C live M1–M3 validation, with an explicit opt-in post-EVALUATE Generation-0 extension, an imported-run wrapper, and offline M4 contracts.

**LAST_CONFIRMED_WORKING_STAGE:** `REPORT` in real M3.5C runs. The 2026-10-07 run `run-2026-10-07T04-02-02-377Z-b76b7a32` completed all 13 M3.5C stages; the 05:05 run completed the same stages with an explicit stop-after-REPORT boundary.

**CURRENTLY_IN_PROGRESS:** No active persisted run is marked in progress. The codebase is at the boundary between evidence construction and live hypothesis seeding; the backlog still lists most Phase-1 integration work as incomplete.

**NEXT_LOGICAL_STAGE:** Add DSH adapters/session-storage durability and complete source verification around the new Generation-0 boundary. Keep prior-art, falsification, feasibility, review, mutation, selection, and experiment execution after that boundary.

**MAIN_BLOCKER:** The active runtime has no DSH adapter/session boundary or general all-stage RunStore and no complete evidence coverage. The M3.5C report is therefore not a Phase-1 hypothesis report; the observed historical M5A contract failure remains preserved, while the patched Generation-0 boundary is only offline-tested.

## 2. Actual pipeline

The exercised M3.5C pipeline is:

```text
3 local PDF artifacts + optional question + corpus cutoff
  ↓
INGEST: manifest and SHA-256 artifact identity
  ↓
EXTRACT: FastPdfReader, then PyMuPDF fallback and quality gate
  ↓
PAPER_READ: bounded context → ResponsesModelGateway → validated reader items
  ↓
PROBLEM_EXTRACT: validated graph nodes/edges per paper
  ↓
PROBLEM_GRAPH: deterministic graph and provenance validation
  ↓
RETRIEVAL_NEEDS: deterministic needs from graph nodes
  ↓
QUERY_PLAN: bounded deterministic OpenAlex queries
  ↓
LITERATURE_SEARCH: OpenAlex HTTP retrieval, cutoff filtering, coverage records
  ↓
SOURCE_SELECT: deterministic query-local ranking and provenance checks
  ↓
EVIDENCE_EXTRACT: bounded model calls for selected sources
  ↓
EVIDENCE_GRAPH: claims, evidence, links, and relation checks
  ↓
EVALUATE: persisted coverage/evidence summary
  ↓
REPORT: limitations and stage artifacts
```

The status labels below mean: `IMPLEMENTED` is present in source; `TESTED` means exercised by a test; `REAL_DATA_VALIDATED` means a saved run used the three real local PDFs; `END_TO_END_VALIDATED` would require a scientifically complete Phase-1 direction report and is not true for this repository.

| Stage | Implementation status | Test status | Real-data status | Inputs | Outputs | Dependencies and evidence |
|---|---|---|---|---|---|---|
| Ingest | IMPLEMENTED | TESTED | REAL_DATA_VALIDATED | Local bytes, paper ID, filename, media type | `ArtifactManifest`, hash, `ingest.json` | `src/domain/extraction.ts:30-36`; run artifacts show three manifests |
| PDF extraction | IMPLEMENTED | TESTED | REAL_DATA_VALIDATED | PDF bytes and local path | pages, sections, spans, locators, extraction provenance | `src/adapters/pdf.ts`; PyMuPDF 1.28.2 / Python 3.11.7 passed all three PDFs in b76b7a32 |
| Extraction quality gate | IMPLEMENTED | TESTED | REAL_DATA_VALIDATED | `ExtractedDocument` | PASS/WARN/FAIL metrics | `src/evaluation/harness.ts`; all three saved reports are PASS |
| Paper reading | IMPLEMENTED | TESTED | REAL_DATA_VALIDATED | Bounded document context | typed reader items, direct/model interpretation labels | `src/domain/extraction.ts:240-258`; saved counts 15/13/11 in b76b7a32 |
| Problem extraction | IMPLEMENTED | TESTED | REAL_DATA_VALIDATED | Reader output and trusted evidence IDs | typed nodes/edges | `runProblemExtractor`; real runs persisted per-paper outputs |
| Problem graph | IMPLEMENTED | TESTED | REAL_DATA_VALIDATED | Nodes, edges, evidence | `problem-graph.json` | `buildProblemGraph`; b76b7a32 has 45 graph claim nodes in evaluation |
| Retrieval needs | IMPLEMENTED | TESTED | REAL_DATA_VALIDATED | Problem graph | 12 needs in b76b7a32 | `deriveRetrievalNeeds` |
| Query planning | IMPLEMENTED | TESTED | REAL_DATA_VALIDATED | Needs, provider, limit | 12 bounded queries | `planQueries` |
| Literature retrieval | IMPLEMENTED | TESTED | REAL_DATA_VALIDATED | OpenAlex query and cutoff | records, memberships, coverage | `OpenAlexProvider`; b76b7a32 made 12 calls, 198 results examined, one NO_RESULTS |
| Source selection | IMPLEMENTED | TESTED | REAL_DATA_VALIDATED | Query-local membership | selected records with coverage/provenance | deterministic token/identifier/date scoring |
| Evidence model/extraction | IMPLEMENTED | TESTED | REAL_DATA_VALIDATED | Selected source metadata/abstract and claim | validated extraction outputs and materialized evidence | b76b7a32 selected 53 paths, planned six operations; only three evidence items materialized |
| Evidence graph | IMPLEMENTED | TESTED | REAL_DATA_VALIDATED | Claims, evidence, links | graph JSON | b76b7a32 has three evidence nodes/links and QUALIFIES×2, SUPPORTS×1 |
| Provenance/citations | IMPLEMENTED | TESTED | REAL_DATA_VALIDATED | Artifact locators, query paths, source IDs | provenance-bearing records | invalid count was 0 in saved report, but quote substring checking and full source hashes are incomplete |
| Evaluation | IMPLEMENTED | TESTED | REAL_DATA_VALIDATED | Persisted stage artifacts | evidence completeness, retrieval and leakage summary | current live EVALUATE is a thin persisted summary; see risks |
| Report | IMPLEMENTED | TESTED | REAL_DATA_VALIDATED | Stage artifacts and evaluation | `report.md`, snapshot | b76b7a32 and 13a71169 reached REPORT; report explicitly states scientific incompleteness |
| Phase-1 hypotheses and directions | DESIGNED | OFFLINE_TESTED only | Not reached | M4A/M4B/M4C contracts | Generation-0/evolution artifacts in isolated modules | no active live stage; no END_TO_END_VALIDATED run |

There is no general checkpoint/resume boundary between the original M3.5C stages. The opt-in post-`EVALUATE` extension now persists a validated checkpoint and ordered events, and its saved artifacts can be verified with a zero-call replay check; this does not make the complete M3.5C path resumable.

## 3. Milestone status

Only the requested status vocabulary is used below.

| Milestone | Status | Evidence |
|---|---|---|
| DSH integration | BLOCKED | `docs/dsh_integration.md` and `docs/architecture_audit.md` define seams, but `rg 'ctx\\.' src` finds no DSH usage; current model/web/storage effects are local adapters. |
| Paper ingestion / parsing | REAL_DATA_TESTED | `src/domain/extraction.ts`, `src/adapters/pdf.ts`; three PDFs passed PyMuPDF extraction in b76b7a32. |
| Paper understanding | REAL_DATA_TESTED | `runPaperReader` and saved reader JSON; three real papers produced 39 reader items in b76b7a32. |
| Research Problem Graph | REAL_DATA_TESTED | `buildProblemGraph`; saved graph/evaluation artifacts. |
| Retrieval Needs | REAL_DATA_TESTED | `deriveRetrievalNeeds`; 12 needs in b76b7a32. |
| Query Planning | REAL_DATA_TESTED | `planQueries`; 12 OpenAlex queries in b76b7a32. |
| Literature Retrieval | REAL_DATA_TESTED | `OpenAlexProvider`; 11 COMPLETE and one NO_RESULTS query in b76b7a32. |
| Evidence Model | REAL_DATA_TESTED | EvidenceExtractor calls and evidence plan completed six operations; coverage remained incomplete. |
| Evidence Graph | REAL_DATA_TESTED | `EvidenceGraph`; three links in b76b7a32. |
| Provenance / citations | REAL_DATA_TESTED | Saved provenance audits report zero invalid records; source quote verification remains incomplete. |
| Hypothesis Generation | OFFLINE_TESTED | M4A/M5A tests cover deterministic/model boundaries; the M3.5C path now has an explicit opt-in Generation-0 boundary, but no successful live candidate run is claimed. |
| Prior-Art Search | NOT_STARTED | No active implementation or real run artifact. |
| Novelty Attack | NOT_STARTED | No active implementation or real run artifact. |
| Falsification | NOT_STARTED | No active role/coordinator; only M4A schema fields for falsification conditions. |
| Feasibility Critic | NOT_STARTED | No active role/coordinator. |
| Reviewer / adversarial review | NOT_STARTED | M4B accepts caller-supplied reviews; no reviewer orchestration. |
| Hypothesis Mutation | OFFLINE_TESTED | M4B deterministic mutation tests; not wired to live data. |
| Hypothesis Genealogy | OFFLINE_TESTED | M4B/M4D parent-child and checkpoint tests; no active live genealogy. |
| Pareto Selection | OFFLINE_TESTED | Core nine-dimension Pareto and M4C eight-dimension selection tests; no live evaluations. |
| Evolution Engine | OFFLINE_TESTED | M4D synthetic lifecycle fixture and replay tests only. |
| Research Budget Allocation | DESIGNED | RunBudget bounds model/retrieval operations; adaptive research allocation is absent. |
| Experiment Planning | NOT_STARTED | `ExperimentDesign` schema exists; no planner produces directions. |
| Simulation / Experiment Execution | NOT_STARTED | No ExperimentGateway or sandbox invocation. |
| Result Analysis | NOT_STARTED | No experiment result ingestion path. |
| Checkpoint / Resume | OFFLINE_TESTED | M4A–M5A checkpoints and zero-call artifact replay are tested; the original M3.5C stages still have no general resume. |
| Evaluation Framework | REAL_DATA_TESTED | `src/evaluation/*` and saved evaluation reports; live evaluation is incomplete and partly placeholder. |
| Temporal Discovery Benchmark | DESIGNED | Cutoff filtering and leakage metrics exist; no benchmark harness or temporal corpus protocol is complete. |
| Ablations | NOT_STARTED | No ablation runner or saved ablation report. |
| UI / observability | NOT_STARTED | JSON artifacts and reports only; no UI, DSH telemetry, or session projection. |

## 4. Important source files

| Path | Purpose and important symbols | Current status | Dependencies / known problems |
|---|---|---|---|
| `src/coordinator/live-validation.ts` | Active 13-stage `runLiveCase`, dry-run, stage persistence, budgets, `OpenAlexProvider` construction | IMPLEMENTED; real-data exercised | Hardcodes provider and local HTTP model path; no DSH, injection, or resume; EVALUATE is thin |
| `src/coordinator/scientific-validation.ts` | Stage names and generic coordinator contract | IMPLEMENTED; unit tested | Generic contract is not the durable run store |
| `src/domain/types.ts` | Canonical Paper, Claim, Evidence, graph, Hypothesis, Review, MutationEdge, ExperimentDesign, budget, Event, Checkpoint types | IMPLEMENTED; parser tests | A separate M4C vector schema duplicates evaluation dimensions |
| `src/domain/validation.ts` | Runtime `parse*` validators and invariants | IMPLEMENTED; heavily tested | Event append order and checkpoint state recomputation are not enforced |
| `src/domain/extraction.ts` | Artifact manifest, deterministic parser, PaperReader/ProblemExtractor contracts and runners | IMPLEMENTED; real-data and unit tested | Model output is validated after transport; no DSH adapter |
| `src/domain/ids.ts` | Branded IDs, canonical JSON, SHA-256 and deterministic IDs | IMPLEMENTED; tested | Runtime brand checks are non-empty string checks; paper manifest backlog item remains unchecked |
| `src/domain/pareto.ts` | Deterministic nine-dimension frontier | IMPLEMENTED; offline tested | No active evaluator supplies live vectors |
| `src/domain/run-budget.ts` | Global/role/retrieval budget ledger | IMPLEMENTED; real run controls | It is an operation budget, not adaptive scientific resource allocation |
| `src/literature/literature.ts` | LiteratureRecord, needs, queries, OpenAlex provider, coverage, membership, source selection, EvidenceGraph | IMPLEMENTED; real OpenAlex run | No source content hash/final URL/HTTP status on normalized records; provider is hardcoded in live coordinator |
| `src/literature/source-scoring.ts` | Pure query token and candidate scoring | IMPLEMENTED; offline tested | Heuristic relevance only; no learned or scientific prior-art assessment |
| `src/evidence/evidence-extractor.ts` | EvidenceExtractor input/output validation, retry, materialization | IMPLEMENTED; real run | Model quote/locator is not checked against source text as a substring/resolvable locator |
| `src/evaluation/evidence-completeness.ts` | Deterministic completeness assessment | IMPLEMENTED; tested | Current live report does not call all evaluation helpers; NO_RESULTS policy needs review |
| `src/evaluation/harness.ts` | Extraction, provenance, retrieval, temporal, conflict, snapshot metrics | IMPLEMENTED; unit tested | Only a subset is reflected in active EVALUATE output |
| `src/adapters/responses-model.ts` | Direct `/responses` streaming gateway, retries and attempt ledger | IMPLEMENTED; fakes and real runs | Uses `fetch` and environment variables, not DSH `ctx.llm`; native schema request permits additional properties |
| `src/adapters/model-preflight.ts` | Model reachability and bounded diagnostics | IMPLEMENTED; real M5A preflight | Credentials are configured only in operator environment; current checkout has no `.env` |
| `src/adapters/pdf.ts` | Fast and PyMuPDF fallback adapters | IMPLEMENTED; real-data tested | Spawns local Python directly; it is a paper parser, not sandboxed generated experiment execution |
| `src/adapters/python-runtime.ts` | Python/PyMuPDF runtime selection and preflight | IMPLEMENTED; current preflight passed with existing `.venv` when launched outside sandbox | No dependency installation; interpreter is local environment state |
| `src/ports/model.ts`, `src/ports/artifacts.ts`, `src/ports/generation0-run-store.ts` | Current model/artifact ports plus the narrow Generation-0 RunStore | IMPLEMENTED but incomplete | No LiteratureGateway, general all-stage RunStore, DSH session, or sandbox port exists |
| `src/milestone4a/*` | Gap discovery, Generation-0 candidate validation, deterministic artifacts/checkpoint | OFFLINE_TESTED; shared extension consumes it | Closed request contracts and provenance validators are used by the opt-in coordinator; no live scientific success is claimed |
| `src/milestone4b/*` | Caller-supplied criticism-driven mutation and genealogy | OFFLINE_TESTED | No critic/falsifier/reviewer role calls; generic text append can be scientifically weak |
| `src/milestone4c/*` | Caller-supplied complete eight-dimension evaluation and Pareto state machine | OFFLINE_TESTED | Evaluation vectors are not produced or provenance-checked by in-repo roles |
| `src/milestone4d/*` | Deterministic M4A→M4B→M4C fixture lifecycle | OFFLINE_TESTED | Synthetic hand-authored evidence/reviews/vectors; not a scientific run |
| `src/milestone5a/*` | Bounded projection and live/dry-run Generation-0 canary, checkpoint/replay artifacts | REAL_DATA_TESTED at canary boundary; no accepted hypothesis | Uses local Responses gateway, not DSH; current run identity, Markdown report, ordered events, and checkpoint hashes are fixed; historical artifacts remain unchanged |
| `.agents/skills/*` | Six local skill documents: paper reader, problem extractor, literature researcher, evidence extractor, hypothesis generator, gap discovery | DESIGNED/local files | Not registered through DSH `ctx.skills`; several Phase-1 roles are absent |
| `scripts/pdf/extract_pymupdf.py` | PyMuPDF sidecar and runtime preflight | REAL_DATA_VALIDATED | External Python package must exist; no install performed |
| `evaluation/real-paper/cases/first-three/*` | Three local PDFs, case manifest, annotations, saved run outputs | REAL_DATA_VALIDATED | PDFs are local evaluation inputs; provenance and licensing remain operator responsibilities |

## 5. Domain model status

The primary schemas are in `src/domain/types.ts`; validation is hand-written in `src/domain/validation.ts`. Most records are persisted as stage JSON files by the coordinators. There is no general durable `RunStore`, database, DSH session log, or append-only event store in the active path.

| Record | Definition and important fields | Persistence / validation / use |
|---|---|---|
| Paper | `Paper` and `PaperArtifact`: IDs, title/authors/year, artifact IDs, source metadata and hashes | `parsePaper`/`parsePaperArtifact`; ingestion uses `ArtifactManifest` and JSON stage output. Active as input manifest; no canonical paper database |
| Claim | `claimId`, statement, kind, provenance | `parseClaim`; active in `claims.json` and evidence graph. Active claim records are generated for graph/open-question paths |
| Evidence | `evidenceId`, kind, claim, polarity, provenance, confidence, limitations | `parseEvidence`; active in `evidence.json` and `EvidenceGraph`. Search records themselves are not all evidence |
| ResearchProblem | problem ID, statement, evidence IDs and provenance | `parseResearchProblem`; graph input is primarily `ResearchGraphNode` records. Active through graph extraction |
| ResearchGraph | problems, typed nodes, typed edges, evidence references | `parseResearchProblemGraph` and `buildProblemGraph`; active `problem-graph.json` |
| Hypothesis | generation, parents, statement/method/assumptions, evidence, prior art, criticisms, experiments, nine dimensions, score provenance, status | `parseHypothesis`; active in M4A–M4D/M5A isolated artifacts only; absent from M3.5C real run |
| Criticism | role, severity, target, claims/evidence, failure conditions | `parseCriticism`; M4B caller-supplied fixture/test data only |
| Mutation | `MutationEdge`: parent/child, reason, critic, evidence IDs, mutation type, timestamp | `parseMutationEdge`; M4B/M4D offline genealogy only |
| Genealogy | No separate canonical `Genealogy` type; represented by `parentHypothesisIds`, mutation edges, events and M4 projections | Offline M4B/M4D persistence; no active live genealogy |
| Experiment | `ExperimentDesign`: variables, baselines, observations, cost, stopping/safety fields | `parseExperimentDesign`; schema only; no planner, executor, or results |
| Evaluation | Core `ScientificDimension` records and separate M4C eight-dimension evaluation vector | `parseScientificDimension`; M4C caller-provided evaluations; active report evaluates evidence coverage rather than hypotheses |
| Event | typed `DomainEvent` envelope with sequence/type/payload | `parseDomainEvent`; M4A–M5A isolated artifact events. Active M3.5C writes stage files, not event log |
| Checkpoint | checkpoint ID/run ID/sequence/state hash/population IDs/budget/time | `parseCheckpoint`; M4A–M5A and M4D use it. Active M3.5C has `run-snapshot.json`, not a validated replay checkpoint |

Duplicated/legacy boundaries include the core nine scientific dimensions versus M4C's eight dimensions, the minimal core `SearchCoverage` versus the richer literature coverage type, and the M5A `generation-reasoning.ts` compatibility export. `PROJECT_STATUS.md` and older handoff files describe an earlier state and are stale about the existence of M4/M5A code; source and saved artifacts above are the current evidence.

## 6. DSH integration status

DSH remains an upstream repository at `D:\deepseek-harness`. `docs/architecture_audit.md` records the inspected DSH services: `ctx.llm`, `ctx.skills`, `ctx.tools`, `ctx.web`, `ctx.subagents`, `ctx.sessions`, `ctx.storage`, `ctx.fs`, `ctx.shell`, `ctx.subprocess`, and `ctx.sandbox`. `docs/dsh_integration.md` describes the intended adapters and failure contracts.

The current EvoResearch source does not import or call those DSH contexts. Model calls are made by `ResponsesModelGateway` through `fetch`; literature calls use `OpenAlexProvider` through `fetch`; run state is local JSON; local skills are files under `.agents/skills`; there are no DSH plugins, DSH tools, DSH subagents, DSH sessions, DSH storage providers, or DSH event consumers in this repository. There is no experiment sandbox gateway.

The DSH checkout was inspected read-only. Its working tree had no tracked modifications at audit time, and there is no evidence that EvoResearch modified DSH core. The primary incompatibility risk is therefore missing integration, rather than an upstream fork: provider selection, session durability, storage transactions, sandbox enforcement, and telemetry still need adapters before the system can satisfy the architecture contract.

## 7. Real execution history

Commands are not stored in the run JSON. The command forms below are the repository entrypoints documented in `evaluation/real-paper/README.md` and `examples/evaluation/live-validation.mjs`; where the exact historical invocation is not persisted it is labeled as inferred.

### Real data runs

**RUN_ID:** `run-2026-10-07T04-02-02-377Z-b76b7a32`

**DATE:** 2026-10-07 (run timestamps are UTC in artifacts)

**COMMAND:** Inferred from the entrypoint: `node examples/evaluation/live-validation.mjs --live evaluation/real-paper/cases/first-three/case.json`

**INPUT:** Three local PDFs in `evaluation/real-paper/cases/first-three/papers/`: Gaussian Shading++, Gaussian Shading, and TAG-WM; cutoff `2026-09-29`; no optional research question.

**STAGES_COMPLETED:** All 13 M3.5C stages through REPORT.

**STAGE_FAILED_OR_STOPPED:** None; pipeline status `COMPLETE`, scientific completeness `false`.

**OUTPUT:** PyMuPDF PASS for 18/17/10 pages and 101,117/71,180/41,946 characters; 39 paper-reader items; 12 retrieval needs and queries; 11 COMPLETE and one NO_RESULTS retrieval; 198 results examined; 53 selected source paths; six evidence operations completed and 47 deferred; three evidence items, three graph links, and an INCOMPLETE evidence assessment; zero recorded temporal leaks.

**ARTIFACT_LOCATION:** `evaluation/real-paper/cases/first-three/outputs/run-2026-10-07T04-02-02-377Z-b76b7a32/`

**RESULT:** Most advanced complete M3.5C real-data run. It did not produce hypotheses, prior-art dossiers, falsification reviews, Pareto selection, experiments, or final research directions.

**IMPORTANT_OBSERVATIONS:** The run used a real model stream and live OpenAlex retrieval, but `scientificallyComplete` remained false because 47 evidence operations were deferred. The saved report describes evidence limitations rather than treating missing coverage as novelty.

**RUN_ID:** `run-2026-10-07T05-05-33-234Z-13a71169`

**DATE:** 2026-10-07

**COMMAND:** Inferred: `node examples/evaluation/live-validation.mjs --live --stop-after REPORT evaluation/real-paper/cases/first-three/case.json`

**INPUT:** Same three PDFs and cutoff.

**STAGES_COMPLETED:** All 13 stages, with explicit stop-after-REPORT boundary.

**STAGE_FAILED_OR_STOPPED:** `STOPPED_AS_REQUESTED` after REPORT; scientific completeness `false`.

**OUTPUT:** 13 model calls, 12 retrieval needs, 235 results examined, 60 selected paths, six planned/completed evidence operations and 54 deferred, one evidence item, one CONTRADICTS graph link, INCOMPLETE assessment.

**ARTIFACT_LOCATION:** `evaluation/real-paper/cases/first-three/outputs/run-2026-10-07T05-05-33-234Z-13a71169/`

**RESULT:** Most advanced stop-boundary run and the source run for the M5A canary.

**IMPORTANT_OBSERVATIONS:** M5A replayed 40 seed evidence records from saved M3 reader outputs without re-extracting or independently verifying source text.

Earlier real M3.5C history establishes progressive boundaries: 2026-09-29 runs stopped or failed at PAPER_READ through LITERATURE_SEARCH; 2026-10-03 runs reached SOURCE_SELECT, EVIDENCE_EXTRACT, EVIDENCE_GRAPH, EVALUATE, and one complete REPORT run; 2026-10-04 produced another complete but scientifically incomplete run. The output tree contains 43 run directories, including incomplete directories without `run-snapshot.json`.

**RUN_ID:** M5A output directory `outputs/run-2026-10-07T13-10-33-032Z-d5d6606d`; checkpoint/report run ID `run-2026-10-07T13-10-33-032Z-917efd67`.

**DATE:** 2026-10-07.

**COMMAND:** Inferred: `node examples/evaluation/m5a-gap-generation.mjs --live --input-run evaluation/real-paper/cases/first-three/outputs/run-2026-10-07T05-05-33-234Z-13a71169`.

**INPUT:** Saved M3.5C source run above, bounded M5A projection, model preflight.

**STAGES_COMPLETED:** MODEL_PREFLIGHT, GAP_DISCOVERY, GENERATION_0; then M5A_STOP.

**STAGE_FAILED_OR_STOPPED:** Generation-0 completed its stage boundary but accepted zero hypotheses. Two structural attempts failed closed on unsupported fields; the canary stopped after Generation-0 by design.

**OUTPUT:** 25 accepted deterministic gaps, one rejected gap, 25 validated gap records, zero accepted Generation-0 hypotheses, one rejected hypothesis result, one successful model preflight, and a checkpoint with an empty population.

**ARTIFACT_LOCATION:** `outputs/run-2026-10-07T13-10-33-032Z-d5d6606d/`

**RESULT:** Real model canary validated the preflight and gap boundary only. It did not validate Generation-0 materialization, prior art, falsification, mutation, Pareto, experiments, or a direction report.

**IMPORTANT_OBSERVATIONS:** The output directory suffix and checkpoint/report run ID differ because two random IDs were generated. `events.json` is empty although a checkpoint exists. `report.md` is a JSON-encoded string with escaped newlines rather than plain Markdown. These are handoff-relevant artifact defects.

### Mock, demo, and unit runs

The historical handoff count was 210 tests; the current tree has 217 tests using fakes, deterministic fixtures, synthetic graph/evidence, temporary files, the Generation-0 RunStore, and source-integrity checks. M4D is an explicit one-case deterministic lifecycle fixture with hand-authored criticism and evaluation vectors. M5A `runM5AVerticalSlice` defaults to `OfflineMockModelGateway`; its replay tests verify persisted artifacts without another model call. The evidence-plan fixture and `scripts/compare-evidence-plan.mjs` are scheduling regressions, not scientific evidence. No test is a live end-to-end OpenAlex plus real-model acceptance test.

## 8. Test status

**TEST_COMMAND:** `npm test`

**TOTAL:** 217

**PASSED:** 217

**FAILED:** 0

**SKIPPED:** 0

**KNOWN_FLAKY_TESTS:** None identified in the completed run. Tests use local fakes/fixtures and do not establish provider availability.

**TYPECHECK_STATUS:** `npm run typecheck` passed. `scripts/typecheck.mjs` locates TypeScript in the project or the DSH installation and runs `tsc --noEmit -p tsconfig.json`.

**BUILD_STATUS:** No repository build script is defined. `package.json` has `test` and `typecheck` only; build status is NOT_STARTED rather than inferred from typecheck.

There is no lint script. Important untested or not-active capabilities include DSH plugin registration, DSH session/storage replay, active M3.5C checkpoint resume, injected literature/model providers, prior-art/falsifier/feasibility/reviewer roles, quote-to-source verification, experiment sandbox refusal, host-execution prevention, live M5A Generation-0 success, and Phase-1 final direction completeness.

## 9. External dependencies

| Dependency | Implemented? | Configured in current checkout? | Tested / observed | Environment variables and blockers |
|---|---|---|---|---|
| OpenAI-compatible LLM endpoint | Yes, direct Responses HTTP adapter | No current `.env`; historical runs were configured | Fakes plus real M3.5C/M5A streams | `EVORESEARCH_MODEL_BASE_URL`, `EVORESEARCH_MODEL_API_KEY`, `EVORESEARCH_MODEL`, optional `EVORESEARCH_MODEL_PROVIDER`, `EVORESEARCH_MODEL_STRUCTURED_OUTPUT_MODE`, `EVORESEARCH_MODEL_STREAMING`; current config resolver reports required values missing |
| OpenAlex | Yes, `OpenAlexProvider` | No separate credential required in code | Live real-data retrieval and tests | No required variable; network/provider availability is external; provider is hardcoded in active coordinator |
| Semantic Scholar | No | No | No | No adapter |
| Crossref | No | No | No | No adapter |
| arXiv | No | No | No | No adapter |
| Generic web search/fetch | No DSH adapter | No | No | `ctx.web` is design-only |
| PDF parsing | Yes, deterministic parser plus PyMuPDF sidecar | Existing project `.venv` has PyMuPDF | Current preflight and three real PDFs passed | `EVORESEARCH_PYTHON` optional; PyMuPDF/runtime must already exist |
| Relational/document database | No | No | JSON files only | No database configuration |
| Vector storage | No | No | No | No vector dependency |
| Graph storage | No separate backend | No | In-memory/domain graph plus JSON serialization | No graph database configuration |
| Python runtime | Yes through preflight/subprocess | Yes in existing `.venv` | Python 3.11.7 and PyMuPDF 1.28.2 observed | `EVORESEARCH_PYTHON` optional |
| Docker / DSH sandbox | No experiment integration | No | No sandbox execution test in active path | No sandbox variable; generated code is not accepted for execution |
| Experiment execution | No | No | No | No `ExperimentGateway`; Phase 1 should fail closed |

## 10. Research contribution status

| Contribution | Classification | Evidence |
|---|---|---|
| Research Problem Graph | B. PARTIALLY IMPLEMENTED | Typed graph, deterministic construction, references, and real M3 graph artifacts exist; graph is not connected to a complete evolutionary loop |
| Evidence Graph | B. PARTIALLY IMPLEMENTED | EvidenceGraph and provenance validation work and appear in real runs; current runs have sparse/incomplete evidence and source quote verification gaps |
| Evidence-grounded reasoning | B. PARTIALLY IMPLEMENTED | PaperReader/EvidenceExtractor receive bounded evidence and preserve IDs; no complete hypothesis reasoning or independent source verification |
| Prior-Art Falsification | E. NOT STARTED | No prior-art dossier, falsifier role, or live stage |
| Adversarial Hypothesis Evolution | D. DESIGN ONLY | M4B deterministic mutation contract exists, but reviews are caller-supplied and no live role orchestration exists |
| Scientific Idea Genealogy | B. PARTIALLY IMPLEMENTED | Parent/child/mutation/checkpoint schemas and offline M4 tests exist; no active live genealogy |
| Pareto Scientific Search | B. PARTIALLY IMPLEMENTED | Deterministic core/M4C frontier and explanations are tested; live evaluations are not produced |
| Adaptive Research Budget | C. ENGINEERING INFRASTRUCTURE ONLY | RunBudget bounds calls and deferred evidence operations; no adaptive scientific allocation policy |
| Temporal Discovery Benchmark | D. DESIGN ONLY | Cutoff filtering/leakage metrics exist; no benchmark corpus/split automation |

These classifications describe implementation evidence, not research novelty or publication quality. No saved run supports a claim of verified novelty.

## 11. Current repository tree

Generated outputs, nested historical run contents, `.venv`, caches, and large PDFs are omitted.

```text
EvoResearch/
├── AGENTS.md
├── PROJECT_SPEC.md
├── PROJECT_STATUS.md
├── TASKS.md
├── package.json
├── tsconfig.json
├── .env.example
├── .agents/skills/
│   ├── paper-reader/SKILL.md
│   ├── problem-extractor/SKILL.md
│   ├── evidence-extractor/SKILL.md
│   ├── literature-researcher/SKILL.md
│   ├── hypothesis-generator/SKILL.md
│   └── gap-discovery/SKILL.md
├── docs/
│   ├── architecture_audit.md
│   ├── dsh_integration.md
│   ├── phase1_plan.md
│   ├── system_design.md
│   ├── research_evaluation.md
│   ├── m35c_wiring.md
│   └── milestone2.md, milestone3*.md, milestone4*.md, milestone5a.md
├── src/
│   ├── domain/ (ids, types, validation, extraction, pareto, run-budget)
│   ├── adapters/ (responses-model, model-preflight, pdf, python-runtime)
│   ├── coordinator/ (context, scientific-validation, live-validation)
│   ├── literature/ (literature, source-scoring)
│   ├── evidence/ (evidence-extractor)
│   ├── evaluation/ (harness, completeness, index)
│   ├── milestone4a/ ... milestone4d/
│   ├── milestone5a/
│   ├── ports/
│   └── config/
├── tests/ (217 Node tests and fixtures)
├── examples/ (milestone demos and evaluation entrypoints)
├── scripts/ (typecheck, PDF sidecar, replay/comparison helpers)
├── evaluation/real-paper/ (case manifest, annotations, saved outputs)
├── evaluation/relevance/ (source-selection regression artifacts)
├── outputs/ (M5A canary artifact)
└── handoff/ (older handoff notes)
```

## 12. Git status

**Current branch:** `master`.

**Latest commit:** None. `git log` reports that the current repository has no commits.

**Recent important commits:** None available in this repository. The upstream DSH checkout separately reports commit `477b4f4` (`2026-09-24`, DSH 0.1.7-rc.2); this is upstream context, not EvoResearch history.

**Uncommitted changes:** The entire current EvoResearch tree is untracked from Git's perspective, including `.agents/`, source, tests, docs, evaluation artifacts, `AGENTS.md`, `PROJECT_SPEC.md`, `PROJECT_STATUS.md`, `TASKS.md`, `package.json`, `tsconfig.json`, `.env.example`, `EvoResearch-Handoff.zip`, and this handoff document. There are no tracked modifications to compare.

**New/untracked important files:** All files listed above are untracked. The most important reviewable artifacts are `src/`, `tests/`, `docs/`, `evaluation/real-paper/`, `outputs/run-2026-10-07T13-10-33-032Z-d5d6606d/`, and `PROJECT_HANDOFF.md`.

## 13. Technical debt and risks

| Rank | Issue | Evidence and consequence |
|---|---|---|
| CRITICAL | No DSH integration or general all-stage RunStore/session | `rg 'ctx\\.' src` finds no DSH use; the active M3.5C path still uses local JSON and direct HTTP. Generation-0 now has a scoped file RunStore and replay boundary, but the intended DSH runtime boundary and all-stage durable session are still absent. |
| CRITICAL | Phase-1 scientific loop is absent from active runtime | M3.5C stops at REPORT; no prior-art, falsifier, feasibility, reviewer, mutation, Pareto, experiment, or direction stage. |
| CRITICAL | Experiment sandbox boundary is absent | No ExperimentGateway or `ctx.sandbox`; generated experiment code cannot be safely executed or even represented as an enforced refusal path. |
| HIGH | Active M3.5C has no resume/checkpoint/replay | Failures persist partial files but restart from scratch; no event sequence or deterministic checkpoint restoration. |
| HIGH | Live EVALUATE writes placeholder facts | `live-validation.ts:348` hardcodes temporal leakage zero, conflicts empty, failures empty, and only item counts for understanding; a report can appear clean without running all audits. |
| HIGH | Evidence provenance can be model-invented | `materializeEvidence` accepts model quote/locator without checking quote substring or locator resolution against supplied source text. |
| HIGH | Literature provenance is incomplete | Normalized records lack source-content hash, final URL, HTTP status, and raw response/artifact provenance; unselected results cannot be independently replayed. |
| HIGH | M5A live canary contract failed closed | Observed canary had two structured-output failures and zero accepted Generation-0 hypotheses; no real Generation-0 success is recorded. |
| HIGH | Historical M5A run identity and event artifacts were inconsistent | The preserved historical output directory ID differs from its checkpoint/report ID and `events.json` is empty while checkpoint sequence is 1; the patched canary uses one ID and ordered events, but the historical run remains unreplayable. |
| HIGH | Historical M5A stage state overstated Generation-0 success | The preserved historical `stage-state.json` marks GENERATION_0 `SUCCEEDED` although `generation-0.json` has zero hypotheses; the patched path reports model failure or blocked downstream explicitly. |
| HIGH | Provider coupling | `new OpenAlexProvider()` and direct Responses HTTP are constructed inside coordinator/adapters; no injected LiteratureGateway/DSH route. |
| HIGH | Ingest/extract byte identity is not immutable | Active extraction ingests and hashes a path, then rereads the path for extraction without comparing the reread bytes to the manifest hash or copying immutable bytes. A file change between steps could break provenance. |
| MEDIUM | Duplicate schema dimensions | Core Hypothesis has nine dimensions; M4C has eight; core and active literature coverage shapes also differ. Adapters can silently drift. |
| MEDIUM | M4B/C rely on caller-trusted scientific judgments | Reviews, criticisms, evidence references, and evaluation vectors are supplied externally; no in-repo role produces or independently checks them. |
| MEDIUM | M4C uncertainty semantics are incomplete | Pareto comparison uses per-dimension uncertainty tolerances; record-level evaluation confidence/uncertainty is stored but does not affect dominance. |
| MEDIUM | Offline M4D report is not a Phase-1 direction dossier | Its explainability projection omits closest prior art, risks, falsification conditions, and discriminative experiment fields. |
| MEDIUM | Paper manifest backlog remains incomplete | Deterministic artifact hashing exists, but the Phase-0 manifest acceptance item is still unchecked and no durable artifact registry exists. |
| MEDIUM | Checkpoint validation is shallow | `parseCheckpoint` validates shape/hash format but does not recompute state; event append order/uniqueness is not enforced. |
| MEDIUM | Runtime IDs are only nominally validated | JSON parsers accept arbitrary non-empty strings for branded IDs; they do not require deterministic namespace/format derivation. |
| MEDIUM | OpenAlex failed-fetch accounting is inaccurate | Search catch path records `failedFetchCount: 0` despite a failed request; diagnostics/status carry some failure information but the count is misleading. |
| MEDIUM | Historical token usage is unavailable | Real run snapshots report `inputTokens`, `outputTokens`, and `totalTokens` as 0 after live calls; this is missing provider usage metadata, not evidence of zero usage. |
| MEDIUM | NO_RESULTS completeness policy needs review | Current completeness summary can omit NO_RESULTS from incompleteness reasons; a run with no results could be treated as complete under some conditions. |
| LOW | Historical M5A report serialization defect | The preserved historical report is a JSON-escaped string; patched canary persistence writes UTF-8 Markdown and regression tests assert the first byte is `#`. |
| LOW | Repository has no commits or build/lint script | Handoff/review provenance is weak; only test and typecheck are defined. |

## 14. Next five tasks

### 1. Integrate a durable Phase-1 coordinator boundary after M3.5C — implemented as an opt-in Generation-0 boundary; full durable RunStore remains open

**TASK:** Add a real stage coordinator that consumes the accepted M3.5C state and invokes M4A GapDiscovery/Generation-0 through ports.

**OBJECTIVE:** Produce a single run identity, validated source artifact IDs, explicit stage events, and a checkpoint after evidence evaluation.

**WHY NOW:** M5A proves the next conceptual boundary but is isolated, and the current live path ends before hypotheses.

**FILES INVOLVED:** `src/coordinator/live-validation.ts`, `src/milestone4a/coordinator.ts`, `src/milestone4a/hypothesis-generator.ts`, `src/milestone5a/canary.ts`, `src/domain/types.ts`, `src/domain/extraction.ts`, `docs/m35c_wiring.md`.

**DEPENDENCIES:** A provider-independent ModelGateway/LiteratureGateway seam and a durable run/output identity policy.

**ACCEPTANCE CRITERIA:** M3.5C can call GapDiscovery with non-empty artifact/source IDs; every stage emits a validated event; one run ID names directory, checkpoint, snapshot, and report; failed generation leaves no accepted hypothesis; completeness limitations propagate.

**TESTS REQUIRED:** Integration fixture from saved M3 run, malformed/dangling M4A output, run identity consistency, event sequence, checkpoint restore without repeated model calls.

### 2. Replace direct providers with DSH adapters and injected ports

**TASK:** Implement adapters for `ctx.llm`, `ctx.web`, `ctx.skills`, `ctx.sessions`, and `ctx.storage` without modifying DSH core.

**OBJECTIVE:** Keep domain logic vendor-independent and make provider attempts, skills, calls, and checkpoints durable.

**WHY NOW:** Direct `fetch` and local JSON are the main architecture blocker and prevent real replay.

**FILES INVOLVED:** `src/adapters/responses-model.ts`, `src/literature/literature.ts`, `src/ports/model.ts`, new literature/run-store ports, `docs/dsh_integration.md`, `docs/architecture_audit.md`.

**DEPENDENCIES:** Inspect and use the upstream seams already recorded in `docs/architecture_audit.md`.

**ACCEPTANCE CRITERIA:** No domain service constructs a provider; adapter records provider/model/skill route, inputs, outputs, errors, and correlation IDs; DSH absence fails closed; no DSH files change.

**TESTS REQUIRED:** Fake DSH context adapter tests, provider failure/retry tests, durable event/replay test, secret-redaction test, and a live smoke test kept separate from offline tests.

### 3. Close source provenance and evaluation gaps

**TASK:** Make evidence quotes/locators resolve against retrieved source content and make active EVALUATE call the complete deterministic harness.

**OBJECTIVE:** Ensure evidence is source-backed and reports cannot claim zero conflicts/leaks/failures from placeholder fields.

**WHY NOW:** The current run has clean-looking invalid/leakage counts while the implementation does not perform all corresponding checks.

**FILES INVOLVED:** `src/evidence/evidence-extractor.ts`, `src/literature/literature.ts`, `src/evaluation/harness.ts`, `src/evaluation/evidence-completeness.ts`, `src/coordinator/live-validation.ts`.

**DEPENDENCIES:** Literature adapter must retain source text/hash, final URL, status, retrieval time, and locator material.

**ACCEPTANCE CRITERIA:** Invented quotes and unresolvable locators fail closed; source hashes are persisted; active EVALUATE reports actual temporal/conflict/provenance/failure metrics; NO_RESULTS and deferred work cannot imply completeness.

**TESTS REQUIRED:** Quote-substring and locator tests, missing source/hash tests, conflict/leakage fixtures, NO_RESULTS completeness test, and real-run report assertions.

### 4. Implement role-backed prior-art, falsification, feasibility, review, mutation, and selection

**TASK:** Wire bounded role contracts after Generation-0 and replace caller-supplied M4B/M4C judgments with validated evidence-bearing outputs.

**OBJECTIVE:** Advance competing candidates through criticism and deterministic Pareto selection while preserving rejected alternatives and genealogy.

**WHY NOW:** These are the scientific mechanisms that separate the current evidence pipeline from the Phase-1 mission.

**FILES INVOLVED:** `src/milestone4b/*`, `src/milestone4c/*`, `src/milestone4d/*`, new role contracts/skills, `src/domain/types.ts`, `docs/phase1_plan.md`.

**DEPENDENCIES:** Tasks 1–3; prior-art retrieval and provenance must be complete enough to support criticism.

**ACCEPTANCE CRITERIA:** Each review references claims/evidence and skill/model route; prior-art no-hit remains coverage evidence; mutation edges are immutable and evidence-backed; Pareto outputs explain every dominated candidate; a shortfall is explicit if fewer than 2–3 directions survive.

**TESTS REQUIRED:** Competing-review fixture, prior-art no-hit/closest-art fixture, invalid parent/evidence tests, Pareto ties/dominated reasons, genealogy replay, and a bounded live canary separated from unit tests.

### 5. Add fail-closed experiment planning and evaluation boundary

**TASK:** Implement direction-level experiment designs and an ExperimentGateway that refuses execution unless DSH sandbox enforcement is available.

**OBJECTIVE:** Give each surviving direction a discriminative experiment, risks, stopping criteria, and reproducible execution record without host execution.

**WHY NOW:** Experiment planning is required in every Phase-1 final direction, while execution safety is a non-negotiable repository rule.

**FILES INVOLVED:** `src/domain/types.ts`, new experiment port/adapter, `src/coordinator`, `docs/dsh_integration.md`, `docs/phase1_plan.md`.

**DEPENDENCIES:** DSH `ctx.sandbox`/`ctx.shell` adapter and validated direction report from Task 4.

**ACCEPTANCE CRITERIA:** Phase 1 can render an experiment design per direction; generated code is never run on the host; missing/untrusted sandbox returns a typed refusal with no subprocess; accepted executions persist input/code hashes, policy, outputs, exit state, and result evidence.

**TESTS REQUIRED:** Sandbox unavailable refusal, host-execution prevention, artifact/hash persistence, negative-result evidence, replay, and final direction completeness checks.

## 15. Final handoff summary

**PROJECT_STATUS_ONE_SENTENCE:** EvoResearch is a real-data-tested M3.5C evidence-construction pipeline with an opt-in, offline-tested Generation-0 extension and deterministic evolutionary contracts; it has not reached the Phase-1 surviving-direction loop.

**CURRENT_FRONTIER:** The opt-in boundary after evidence evaluation and through GapDiscovery/Generation-0 validation; DSH durability and later scientific roles remain outside it.

**MOST_ADVANCED_REAL_RUN:** `evaluation/real-paper/cases/first-three/outputs/run-2026-10-07T04-02-02-377Z-b76b7a32/`, all 13 M3.5C stages through REPORT, scientifically incomplete; the separate M5A canary reached Generation-0 validation with zero accepted hypotheses.

**CURRENT_RESEARCH_CONTRIBUTION:** Provenance-aware problem/evidence graph construction, cutoff-filtered OpenAlex retrieval, bounded structured extraction, deterministic coverage accounting, and offline contracts for gap discovery, genealogy, mutation, and Pareto selection.

**BIGGEST_ENGINEERING_GAP:** No DSH adapter/session/storage boundary or active resumable run store.

**BIGGEST_SCIENTIFIC_VALIDITY_GAP:** No evidence-complete prior-art/falsification/feasibility loop that produces and tests competing hypotheses; source quote verification is also incomplete.

**NEXT_TASK_TO_EXECUTE:** Add DSH adapters/session-storage durability and close source-text verification around the integrated Generation-0 boundary.

## 16. Generation-0 接入补充审计（2026-10-08，Asia/Shanghai）

本轮完成的是第 14 节任务 1 的 Generation-0 范围：`src/coordinator/generation0-extension.ts` 是唯一共享服务；`src/coordinator/live-validation.ts` 在显式 `--generation-0` 后于 `EVALUATE` 调用它；`src/milestone5a/canary.ts` 从已保存 M3.5C 状态导入后复用同一服务。`FileGeneration0RunStore` 为 EVALUATE、GAP_DISCOVERY、GENERATION_0 提供原子边界记录和 fail-closed 的 `INTERRUPTED/UNKNOWN` pending marker。默认调用仍为原 13 个阶段，`--stop-after REPORT` 的语义未改变。没有实现后续对抗角色、Generation-1、实验或完整 Phase 1。

历史 canary 的根因已按保存产物核实且没有改写历史目录：`outputs/run-2026-10-07T13-10-33-032Z-d5d6606d/gap-discovery.json` 与 `model-attempts.json` 记录两次 GapDiscovery `unsupported gap kind`；同一 ledger 记录 HypothesisGenerator 的 `unsupported gapId` 与 `unsupported hypothesisId`。`src/milestone4a/gap-discovery.ts` 的 deterministic baseline 生成了 25 条 gap，故历史输出的 25 条 accepted gaps 不是模型生成。旧 canary 在模型失败后仍计算 Generation-0，旧 `stage-state.json` 将零候选标为成功，输出目录 ID 与 checkpoint/report 中的 run ID 不同，且 `events.json` 为空；这些是历史缺陷证据，不被本轮修正为成功运行。

本轮修复了 GapDiscovery 与 Generation-0 的 envelope、字段、枚举、引用和未知字段边界；每个角色最多一次结构重试，失败响应仍保留安全诊断和哈希，非法结果不会进入 accepted state。新输入验证 problem graph、claims、evidence、evidence-graph link；导入器从 `ingest.json` 传递真实 `artifactId`，并把 `sourceRunId` 单独作为 lineage。`source-integrity.ts` 会核对 ingest 文件身份和可用的保存 abstract quote；没有保存原文的 PaperReader seed 明确为未核验，不进入 direct scientific evidence qualification。coverage-only gap、未核验/摘要证据和全局不完整性继续限制 provisional 候选，不能升级为 novelty 或科学有效性。

新扩展只生成一次 run ID，统一用于输出目录、snapshot、stage-state、events、checkpoint 和 report；checkpoint 的 state hash 对应已保存 gap/population state。事件包含阶段开始/完成/失败、模型尝试、候选创建和 checkpoint，序号连续并经 domain validator 检查。`replayM5AExtensionArtifacts()` 在不调用模型、检索、解析器或 preflight 的条件下核对 source file hashes、run identity、state hash、checkpoint 和事件序列；篡改或缺失会 fail-closed。

验证结果（本轮无网络、无真实 Responses/OpenAlex 调用）：

- `npm test`：217/217 PASS。
- `npm run typecheck`：PASS。
- `node examples/evaluation/m5a-gap-generation.mjs --dry-run --input-run evaluation/real-paper/cases/first-three/outputs/run-2026-10-07T05-05-33-234Z-13a71169`：只做本地导入与预算检查，不调用模型或 OpenAlex；配置状态按命令输出记录。
- 同一 dry-run 输出 `preflight=1`、`gapDiscovery=2`、`generation0=2`、`total=5`、`openAlex=0`、`candidateGapBudget=3`、`hypothesisBudget=3`，并报告 `modelCalls=0/openAlexCalls=0/networkCalls=0`。
- `node examples/evaluation/live-validation.mjs --dry-run --generation-0 evaluation/real-paper/cases/first-three/case.json`：只做本地接线检查；不构造网络 provider、不运行 preflight。
- 离线 replay 命令：`node --input-type=module -e "import { replayM5AExtensionArtifacts } from './src/milestone5a/canary.ts'; console.log(replayM5AExtensionArtifacts(process.argv[1]))" <saved-extension-directory>`（把 `<saved-extension-directory>` 替换为本轮生成的扩展目录）。
- 本轮离线导入目录 `outputs/replay-proof-latest/run-2026-10-08T01-45-00-000Z-78b0ddf4` 已验证：`checkpointSequence=15`、`eventCount=15`、`modelCalls=0`、`searchCalls=0`；目录同时包含 `generation0-evaluate.json`、`generation0-gap_discovery.json`、`generation0-generation_0.json` 和 `generation0-manifest.json`。

状态保持为：`OFFLINE_INTEGRATION: PASS`；`SAVED_RUN_INPUT: READY` 仅指保存的 M3.5C 状态可被本地读取/验证，不能解释为证据完整；`LIVE_CONFIGURATION: MISSING` 以当前进程配置检查为准；`LIVE_AFTER_PATCH: NOT_RUN`；`PHASE_1_COMPLETE: false`。当前仓库在本审计基线下没有可比较的 Git commit；本轮未执行 clean/reset/删除未跟踪文件，也未修改 `D:\deepseek-harness` 或历史 run。

**补充后的最终状态：** `CURRENT_FRONTIER` 已从“尚未接入”推进到“EVALUATE 后的 opt-in GapDiscovery/Generation-0 边界”；DSH adapter/session/storage、全量来源文本核验、prior-art/falsification/feasibility/review、Pareto、实验与完整 Phase-1 direction report 仍未完成。
