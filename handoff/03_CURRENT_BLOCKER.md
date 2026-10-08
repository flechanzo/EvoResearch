# Current blocker: PAPER_READ live failure observability

## Historical observation

The existing runtime artifacts record the command shape:

```text
node examples/evaluation/live-validation.mjs --live --stop-after PAPER_READ evaluation/real-paper/cases/first-three/case.json
```

In both inspected runs, `INGEST` and `EXTRACT` completed, then `PAPER_READ` failed for `gaussian-shading-plus-plus` with:

```text
PaperReader failed for gaussian-shading-plus-plus: $: invalid PaperReader envelope
```

The same runs record PyMuPDF extraction `PASS` for all three papers. Their `paper-reader/` directories contain no validated paper file, and `model-attempts.json` is `[]`.

## What the current source actually does

1. `runLiveCase` in `src/coordinator/live-validation.ts` runs `PAPER_READ` after `INGEST` and `EXTRACT`, passing a `BudgetedGateway`, the extracted document, `boundDocumentContext(document, 24000)`, `maxSerializationRetries: 1`, and `onAttempt: persistPaperReaderAttempt`.
2. `runPaperReader` in `src/domain/extraction.ts` creates a `ModelRequest` with role `PaperReader`, schema version `m2.3`, and output schema `PaperReaderOutput`.
3. `ResponsesModelGateway.structured` (`src/adapters/responses-model.ts`) sends `/responses`. With required streaming, `consumeResponsesStream` parses SSE and `reconstructStreaming` assembles text, then `parseJsonText` parses JSON. A gateway parse failure returns `ok: false`; a parsed JSON value returns `ok: true` without claiming schema validity.
4. `runPaperReader` calls `validatePaperReaderOutput`. It requires an object envelope with `artifactId`, `schemaVersion`, and array `items`. Each item is checked for supported type, string statement, finite confidence/uncertainty in `[0,1]`, valid interpretation, and locators that exist in the extracted document. Direct evidence needs at least one locator and artifact IDs must match.
5. On a schema/serialization exception, `runPaperReader` calls `gateway.annotateAttempt`, invokes `onAttempt`, and may call `onSerializationRetry` once. The retry keeps the bounded scientific input and adds only the prior validation errors plus a correction instruction.
6. `persistPaperReaderAttempt` in `src/coordinator/live-validation.ts` first persists the gateway attempt ledger, then ensures the report attempt is in `model-attempts.json`, and for failures writes `metadata.json`, bounded `reconstructed-output.txt` when available, `parsed-output.json` when parsing succeeded, and `validation-errors.json` under `paper-reader/failed-attempts/<paperId>/attempt-<n>/`. The normal `paper-reader/<paperId>.json` is written only after `result.ok`.

## Exact error location and root-cause status

The current source contains **no** `invalid PaperReader envelope` string. `rg` finds only `invalid EvidenceExtractor envelope` in `src/evidence/evidence-extractor.ts`; `validatePaperReaderOutput` emits messages such as `expected PaperReaderOutput...`, `missing required property`, or locator/type errors. Therefore the exact producer of the historical phrase cannot be located in the current source snapshot.

**ROOT CAUSE NOT YET ESTABLISHED.** The historical message likely came from a different source/runtime revision or an unshown wrapper, but that is an inference and must not be treated as fact. The empty attempt ledger is also inconsistent with the current callback path, which should persist a fallback attempt even if the gateway has no `attempts` property.

## Serialization retry

Serialization/schema retry is wired in current code: `runPaperReader` defaults to one retry and `runLiveCase` supplies the callback that spends the per-operation retry budget. `ResponsesModelGateway` itself is configured with `maxRetries: 0` in `runLiveCase`, so transport/server retry is not the live-run explanation. Existing tests verify context preservation and validation-error propagation across the PaperReader retry. Whether the historical run used this exact wiring is unknown.

## Why no validated artifact appears

This is expected whenever the complete PaperReader contract never passes: the coordinator writes `paper-reader/<paperId>.json` only after `runPaperReader` returns `ok: true`. Failed attempts should instead be written under `paper-reader/failed-attempts/...`. The historical absence of both validated output and persisted failed-attempt diagnostics is the observability defect to investigate, not evidence that validation should be weakened.

## `outputs/outputs` analysis

The current `canonicalOutputRoot` in `src/coordinator/live-validation.ts` leaves an input path ending in `outputs` unchanged and otherwise appends one `outputs` component. `plannedDirectory` then appends a single run directory. Current tests assert that a staged run does not produce `outputs/outputs`. The nested historical path remains in the workspace, but static inspection cannot prove whether it was created by an older implementation or an older caller; preserve it as runtime evidence and investigate before cleanup.
