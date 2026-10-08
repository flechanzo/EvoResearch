# Project state

This file separates evidence classes deliberately. “Verified from code” means the behavior is visible in the source snapshot. “Verified from test” means a local test passed. “Observed from runtime artifact” means it was read from an existing output directory. “Documented but not verified” comes only from design prose. “Unknown” must not be promoted to a claim.

## Milestones

| Area | Status | Evidence class and details |
|---|---|---|
| M1 domain/contracts and M1–M3 wiring | Present in current source | **VERIFIED FROM CODE/TEST**: domain IDs, schemas, provenance validation, graph/evidence operations, Pareto/budget helpers, live stage wiring, and tests exist. The repository has no Git commit history, so there is no commit-backed release marker. |
| M2 extraction/PaperReader | Implemented as a boundary | **VERIFIED FROM CODE/TEST**: `src/domain/extraction.ts`, `runPaperReader`, `validatePaperReaderOutput`, bounded context, and contract/debug tests. Fast parser plus replaceable PyMuPDF adapter are present. |
| M3 literature/evidence | Implemented as adapters and deterministic services | **VERIFIED FROM CODE/TEST**: `OpenAlexProvider`, identity normalization, query planning, coverage, `EvidenceExtractor`, and `EvidenceGraph`; tests use fakes and do not require network. |
| M3.5B / M3.5C | Live validation wiring is present | **VERIFIED FROM CODE/TEST**: Responses gateway, preflight, staged coordinator, persistence, dry-run, stop-after, retrieval/evidence/evaluation/report stages. **DOCUMENTED BUT NOT VERIFIED**: successful end-to-end live completion. |
| M3.6 | PDF/PyMuPDF fallback is present | **VERIFIED FROM CODE/TEST**: sidecar boundary, runtime preflight, quality gate, bounded subprocess invocation. **OBSERVED FROM RUNTIME ARTIFACT**: three benchmark PDFs extracted with PyMuPDF PASS in historical runs. |
| M4 | Not started | **VERIFIED FROM CODE**: no hypothesis/evolution/experiment loop is wired into the current live entrypoint. **REQUIRED BOUNDARY**: do not start without explicit request. |

## Validation and runtime status

- **npm test:** **VERIFIED FROM TEST** at handoff inspection: 60 tests passed, 0 failed, 0 skipped (`npm test`).
- **Typecheck:** **VERIFIED FROM TEST** at handoff inspection: `npm run typecheck` exited 0.
- **Python/PyMuPDF:** **VERIFIED FROM CODE/TEST**: runtime resolution prefers `.venv/Scripts/python.exe` on Windows and the preflight reports package/interpreter facts. **OBSERVED FROM RUNTIME ARTIFACT**: historical extraction used `D:\EvoResearch\.venv\Scripts\python.exe`, Python 3.11.7, PyMuPDF 1.28.2, and sidecar `m3.6.1-runtime`.
- **Real-paper extraction:** **OBSERVED FROM RUNTIME ARTIFACT**: all three case papers had PyMuPDF quality `PASS` in both historical runs. The PDFs themselves are excluded from this archive, so a new session cannot independently reproduce that observation from the package alone.
- **Model preflight:** **VERIFIED FROM CODE/TEST**: preflight requires base URL, API key, and model and exercises a bounded Responses request. **OBSERVED FROM RUNTIME ARTIFACT**: the two historical staged runs recorded HTTP 200 and `text/event-stream` preflight metadata. No credential value is retained.
- **Dry-run:** **VERIFIED FROM TEST**: zero model calls and zero OpenAlex calls, local artifact validation, and stop-after planning.
- **Staged live-run:** **OBSERVED FROM RUNTIME ARTIFACT**: two historical runs stopped at `PAPER_READ` with `$: invalid PaperReader envelope`. **NOT RUN FOR THIS HANDOFF**.

## Current blocker and secondary issues

The blocker is the historical PaperReader failure and missing observability. Current source does not contain the historical error string, while current callbacks appear designed to persist attempts. This is a source/runtime discrepancy; **ROOT CAUSE NOT YET ESTABLISHED**.

Known secondary issues:

- The repository has no Git commits (`git rev-parse HEAD` and `git log` report no commits); `git status --short` therefore lists the project as untracked. This is a repository-state fact, not a pipeline failure.
- Historical outputs are nested under `evaluation/real-paper/cases/first-three/outputs/outputs/`. Current `canonicalOutputRoot`/`plannedDirectory` logic avoids adding a second `outputs` component when the supplied root already ends in `outputs`; whether the historical nesting came from an older caller or older source is not proven.
- The current `ScientificValidationCoordinator` writes generic stage files at the root, while the live coordinator has stage-specific persistence. They are separate coordinators and should not be conflated.
- The live `REPORT` stage writes `model-attempts.json` from the gateway attempt array; a failure path persists attempts in the catch block. Historical empty ledgers need contract-level debugging rather than assumption.

## Not yet verified

- A real model response that passes the current PaperReader contract.
- A successful end-to-end live run through OpenAlex and evidence/report stages.
- Whether the historical error was produced by an older gateway, an older validator, or an external wrapper.
- Whether the historical empty attempt ledger reflects the exact current source or a prior source snapshot.
- Clean checkpoint/replay of a full Phase-1 final-direction report; the current live wiring intentionally stops before hypothesis evolution.
