# Milestone 3.5B live validation coordinator

This milestone adds integration seams without executing the live run. `ScientificValidationCoordinator` exposes inspectable stages from ingestion through reporting, creates a unique run directory, persists configuration/snapshot/stage state, and stops on the first failure while preserving completed artifacts.

`ResponsesModelGateway` is the only model adapter. It calls `/responses`, never Chat Completions, normalizes response envelopes, supports `native_json_schema`, `json_object`, and `prompt_json` modes, bounds retries, redacts keys from attempt records, and records usage/status/error categories. Retrieved scientific content is sent as user data while the adapter’s developer instruction remains separate.

Preflight command:

```powershell
node examples/evaluation/model-preflight.mjs
```

Required environment variables are `EVORESEARCH_MODEL_BASE_URL`, `EVORESEARCH_MODEL_API_KEY`, and `EVORESEARCH_MODEL`. Optional `EVORESEARCH_MODEL_STRUCTURED_OUTPUT_MODE` selects a structured-output mode. The expensive live run is intentionally not invoked in this milestone.

Preflight diagnostics are persisted by the live validation runner as `model-preflight.json`. Its maximum is two attempts: only trusted rate-limit and server-error classifications retry, while authentication, configuration, malformed, and unclassified provider failures remain non-retryable. These attempts are accounted for separately from scientific model-call budgets.
