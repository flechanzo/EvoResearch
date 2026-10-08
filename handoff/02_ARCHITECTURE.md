# Current architecture from the source snapshot

## 1. Mission and boundary

EvoResearch is intended to produce competing, evidence-grounded scientific directions with explicit provenance, disagreement, falsification conditions, experiments, and genealogy. The current implementation is the M1–M3/M3.5C validation slice plus M3.6 PDF extraction. It does not implement the full autonomous scientist or M4 evolution loop.

## 2. Layers and domain model

`src/domain/` owns branded/deterministic IDs (`ids.ts`), schemas and validators (`types.ts`, `validation.ts`), extraction contracts (`extraction.ts`), graph/evidence records, Pareto functions (`pareto.ts`), and run budgets (`run-budget.ts`). `src/ports/` defines model and artifact boundaries. Domain code accepts typed ports and fakes; it does not import DSH runtime objects.

Claims, evidence, graph nodes/edges, literature records, reviews, mutations, checkpoints, and budgets carry IDs and provenance. Validators reject missing links, invalid locators, unsupported relations, and inconsistent projections. `Evidence` distinguishes source-backed observations/quotes from model interpretations.

## 3. Artifact and extraction architecture

`src/ports/artifacts.ts` defines the artifact boundary. `ingestArtifact` records media metadata and a deterministic SHA-256. `extractDocument` is the lightweight text/Markdown/PDF text-stream parser. `src/adapters/pdf.ts:extractWithFallback` tries `FastPdfReader` and then `PyMuPDFReader`, assesses quality, and accepts only a passing document. `PyMuPDFReader` invokes `scripts/pdf/extract_pymupdf.py` through an argument array with `shell: false`, timeout, and bounded output. The Python runtime is discovered and preflighted in `src/adapters/python-runtime.ts`.

## 4. PaperReader and ProblemExtractor

`src/coordinator/context.ts:boundDocumentContext` preserves document locators while bounding characters/chunks. `src/domain/extraction.ts:runPaperReader` sends bounded pages/spans or chunks through `ModelGateway`, uses schema version `m2.3`, and calls `validatePaperReaderOutput`. The expected envelope is an object with `artifactId`, `schemaVersion`, and `items`; each item has `itemId`, supported type, statement, confidence/uncertainty in `[0,1]`, locators, and `DIRECT_EVIDENCE` or `MODEL_INTERPRETATION`. Direct evidence must reference an existing span.

On a validation failure, `runPaperReader` records errors through `onAttempt`; if the failure looks serializational/schema-related and the one-retry budget is available, it appends a `serializationRetry` instruction containing prior validation errors and calls the gateway again. `runProblemExtractor` validates a nodes/edges envelope. `buildProblemGraph` (`src/domain/extraction.ts`) normalizes IDs and rejects unknown nodes, unsupported relations, and missing evidence.

## 5. Retrieval, identity, and evidence

`src/literature/literature.ts` contains deterministic retrieval-needs/query planning, DOI and literature identity normalization, `OpenAlexProvider`, coverage outcomes, and source selection. OpenAlex requests use bounded page size, timeout, a user-agent, and one retry; failures and no-results are coverage outcomes, never novelty proofs. `EvidenceExtractor` (`src/evidence/evidence-extractor.ts`) receives a bounded source snapshot as untrusted data, validates evidence levels, retries format failures once, and `materializeEvidence` stores source/model provenance. `EvidenceGraph` preserves support, contradiction, qualification, and motivation links.

## 6. Evaluation harness

`src/evaluation/harness.ts` and `src/evaluation/index.ts` provide extraction quality gates, annotation comparison, provenance audits, temporal leakage checks, retrieval/conflict metrics, and report helpers. Tests use fake provider responses. The real-paper case definition is under `evaluation/real-paper/cases/first-three/`.

## 7. ScientificValidationCoordinator and live entrypoint

`src/coordinator/scientific-validation.ts:ScientificValidationCoordinator` is a generic ordered stage runner that creates a run directory and persists `config.json`, `run-snapshot.json`, per-stage JSON, and `stage-state.json` until the first failure. `src/coordinator/live-validation.ts:runLiveCase` is the concrete M1–M3/M3.5C entrypoint. It creates one unique run directory below a canonical `outputs` root, initializes stage folders/files, runs model preflight, gates extraction, executes the pipeline, persists attempts and snapshots, and marks intentional stop-after stages.

The live pipeline is:

```text
INGEST -> EXTRACT -> PAPER_READ -> PROBLEM_EXTRACT -> PROBLEM_GRAPH
  -> RETRIEVAL_NEEDS -> QUERY_PLAN -> LITERATURE_SEARCH -> SOURCE_SELECT
  -> EVIDENCE_EXTRACT -> EVIDENCE_GRAPH -> EVALUATE -> REPORT
```

`RunBudget` (`src/domain/run-budget.ts`) bounds total/role model calls, serialization retries, retrieval needs, queries, examined results, and selected sources. The live gateway is wrapped by `BudgetedGateway`, which spends a model-call budget before each call and accumulates token usage.

## 8. ResponsesModelGateway

`src/adapters/responses-model.ts:ResponsesModelGateway` normalizes the base URL, reads environment configuration, sends `/responses` requests, supports `native_json_schema`, `json_object`, and `prompt_json`, and records an in-memory attempt ledger with route, skill/schema versions, timestamps, usage, hashes, stream event types, parse status, and untrusted output status. `consumeResponsesStream` bounds duration/bytes/events/output and reconstructs text; `parseResponsesJson` handles non-stream envelopes; `parseJsonText` removes one surrounding JSON Markdown fence and then calls `JSON.parse`.

## 9. Persistence and failure semantics

The live coordinator writes `ingest.json`, `extraction-report.json`, `paper-reader/`, `problem-extractor/`, graph/retrieval/evidence JSON, `stage-state.json`, `run-snapshot.json`, `config.json`, `report.md`, and `model-attempts.json`. `persistPaperReaderAttempt` writes bounded failed-attempt metadata, reconstructed output preview, parsed output when parse succeeded, and validation errors under `paper-reader/failed-attempts/<paperId>/attempt-<n>/`; validated paper-reader JSON is written only after the complete contract succeeds. A stage failure stops the run and writes a failed snapshot; a requested stop marks later stages `INTENTIONALLY_NOT_RUN`.

## 10. Provenance invariants and DSH seam

External paper/web/model data is untrusted. Locators and hashes must resolve to the supplied artifact; model interpretations retain model provenance. DSH is upstream and unmodified. The intended DSH seams are `ctx.llm`, `ctx.skills`, `ctx.web`, `ctx.sessions`, `ctx.storage`, `ctx.shell`, and `ctx.sandbox`; the current repository uses replaceable ports/adapters and does not add another agent framework.

## 11. Future M4 boundary

M4 is deliberately outside this handoff. Do not design or implement hypothesis generation, prior-art evolution, mutation, Pareto survival scheduling, autonomous experiments, or a DSH replacement as part of the blocker task.
