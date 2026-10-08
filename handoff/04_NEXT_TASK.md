# Next task: PaperReader failure observability and contract debugging

The smallest next engineering task is to determine exactly where the real PaperReader response diverges from the current contract. The goal is accurate evidence and replayable diagnostics, **not** making the live case pass by weakening validation.

## Scope

- Trace `runLiveCase → runPaperReader → ModelGateway.structured → SSE reconstruction/JSON normalization → validatePaperReaderOutput` with a fake/recorded response fixture.
- Preserve every failed model attempt safely: attempt identity, request metadata, route, stream event types, terminal status, normalized-text hash and bounded preview, parse status, schema path/error, and retry number.
- Confirm that bounded reconstructed output and response metadata survive coordinator failure and that the attempt ledger is written before the stage exception escapes.
- Verify the serialization retry budget and input invariance, including the `BudgetedGateway` wrapper and `onSerializationRetry` callback.
- Reproduce and explain why a failed run can have no `paper-reader` validated file; add offline regression coverage for failed-attempt artifacts and ledger persistence.
- Investigate the historical `outputs/outputs` path against current `canonicalOutputRoot` behavior without changing scientific pipeline semantics.

## Suggested concrete files

Start with `src/domain/extraction.ts`, `src/adapters/responses-model.ts`, `src/coordinator/live-validation.ts`, `src/coordinator/context.ts`, `tests/paper-reader-debug.test.mjs`, `tests/responses-model.test.mjs`, and `tests/live-validation.test.mjs`. Keep `docs/paper_reader_contract.md` synchronized with verified behavior if the contract or diagnostics change.

## Non-goals

- No Milestone 4.
- No hypothesis generation, mutation, Pareto evolution, or autonomous experiment execution.
- No unrelated retrieval redesign and no DSH replacement.
- No alternate agent framework.
- No weakening of PaperReader validation or fabricated schema values.
- No full expensive live run, real model request, or OpenAlex network request.
