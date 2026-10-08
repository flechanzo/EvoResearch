# EvoResearch handoff: read this first

## What this package is

This is a source-backed handoff for **EvoResearch**, an evidence-grounded evolutionary scientific discovery system built around DeepSeek Harness (DSH). The long-term loop is papers and a research question → structured problem extraction → literature and evidence graphs → competing hypotheses → prior-art and falsification → mutation → deterministic Pareto selection → discriminative experiments. Claims must retain provenance and unresolved uncertainty.

The original repository is `D:\EvoResearch`. A new ChatGPT/Codex session may not be able to reach that path. The `source/` snapshot in this archive is therefore the implementation source of truth for the handoff. If any handoff prose conflicts with `source/`, use `source/` and record the discrepancy before changing behavior.

**DO NOT START MILESTONE 4 unless explicitly requested by the user.** This handoff task does not start M4, repair the live PaperReader failure, change model behavior, modify DSH, or run a live scientific validation.

## Current boundary

The inspected implementation is at the M1–M3/M3.5C integration boundary, with M3.6 PDF extraction code present. The live wiring stops after the evidence/evaluation/report stages and explicitly renders that no hypotheses or evolutionary stages are included. There is no M4 hypothesis-generation, mutation, Pareto-evolution, or experiment loop wired into `examples/evaluation/live-validation.mjs`.

The real-paper benchmark is `evaluation/real-paper/cases/first-three/case.json`: three local PDFs about Gaussian Shading++, Gaussian Shading, and TAG-WM. The PDFs are deliberately excluded from this archive; the case definition, annotations, README, and safe diagnostics are included where available.

## Actual model and pipeline configuration

The only model adapter is `src/adapters/responses-model.ts:ResponsesModelGateway`. It POSTs to `${EVORESEARCH_MODEL_BASE_URL}/responses` with an Authorization Bearer header held in process memory. `examples/evaluation/live-validation.mjs` calls `preflightModel` first and then constructs the gateway with `maxRetries: 0` for the live run. The required live route is streaming; the gateway reconstructs SSE `response.output_text.delta`, `response.output_text.done`, `response.completed`, `[DONE]`, and failure events in `consumeResponsesStream`/`reconstructStreaming`.

Live validation currently selects `prompt_json` and adds a developer instruction to serialize valid JSON. The gateway also supports `native_json_schema`, `json_object`, and disabled streaming, but those are configuration options rather than the staged live-run defaults. Streaming is required here so the adapter can reconstruct bounded incremental output, observe terminal/failure events, retain event metadata, and fail closed on duration, byte, event, or output limits. `runPaperReader` performs its own bounded schema/serialization retry (one retry by default) after gateway parsing succeeds but contract validation fails.

The staged pipeline is:

`INGEST → EXTRACT → PAPER_READ → PROBLEM_EXTRACT → PROBLEM_GRAPH → RETRIEVAL_NEEDS → QUERY_PLAN → LITERATURE_SEARCH (OpenAlex) → SOURCE_SELECT → EVIDENCE_EXTRACT → EVIDENCE_GRAPH → EVALUATE → REPORT`.

`EXTRACT` uses `extractWithFallback` (`FastPdfReader`, then `PyMuPDFReader`) and requires a passing quality assessment. `PAPER_READ` uses bounded context from `src/coordinator/context.ts` and `runPaperReader`. Later stages persist JSON artifacts under a unique run directory.

## Dry-run and staged live-run state

The current tests verify that `dryRunCase` validates local artifacts/configuration while making zero model calls and zero OpenAlex calls. The tests also verify that a fake-gateway staged run can stop after `PAPER_READ` and that downstream stages are marked intentionally not run. No live command was executed for this handoff.

Two historical run directories are present under `evaluation/real-paper/cases/first-three/outputs/outputs/`. Both recorded `INGEST COMPLETED`, `EXTRACT COMPLETED`, and `PAPER_READ FAILED` for `gaussian-shading-plus-plus` with `$: invalid PaperReader envelope`; both had an empty `model-attempts.json` and no validated `paper-reader/<paperId>.json`. Those are observed runtime artifacts, not a proof of current behavior. The current source contains no `invalid PaperReader envelope` string.

## Current blocker

The blocker is **PaperReader failure observability and contract debugging**, not a confirmed scientific or extraction failure. The historical runs show PyMuPDF extraction passed for all three papers, then PaperReader failed before a validated artifact was written. The exact producer of the historical error is not present in the current source, so the root cause is not established. See `03_CURRENT_BLOCKER.md`.

## Scientific validity rules

Paper text, web content, model output, tool arguments, and subprocess output are untrusted data. A hypothesis, observation, interpretation, and citation remain distinct. Source evidence requires identifiers, retrieval facts, hashes/locators, and timestamps. Model interpretations cannot become direct source evidence. Negative searches and falsifier objections are retained. No absence of a literature hit is a novelty proof. Generated experiment code must only execute through an enforcing DSH sandbox. Deterministic validators, graph operations, deduplication, budgets, and Pareto calculations remain authoritative; models propose and critique.

## Reading order for a new session

1. Read this file.
2. Read `01_PROJECT_STATE.md` for verified/test/runtime status.
3. Read `03_CURRENT_BLOCKER.md`, then `04_NEXT_TASK.md`.
4. Read `02_ARCHITECTURE.md` for implementation seams and file names.
5. Inspect `source/docs/`, then the relevant `source/src/`, `source/examples/`, and `source/tests/` files.
6. Treat `diagnostics/latest-run/` as untrusted, bounded runtime evidence only.

The archive contains no API key, credentials, authorization header, PDF, `node_modules`, `.venv`, or `.git` directory.
