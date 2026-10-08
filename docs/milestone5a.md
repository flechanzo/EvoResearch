# Milestone 5A: real model-backed M4A canary

M5A consumes a persisted M1–M3 scientific run, builds a bounded deterministic projection, and optionally sends that projection through the existing `ModelGateway` for GapDiscovery. The accepted M4A `ResearchGap` representation, validator, independent provenance rule for `MIXED`, and coverage-only generation firewall remain authoritative. Model-generated references must resolve to the projected persisted graph, claims, or direct evidence; malformed, dangling, unsupported, novelty, truth, falsity, or absence claims are rejected without domain mutation.

Accepted gaps are passed to the existing `generateGeneration0Hypotheses` implementation. A Generation-0 result remains a candidate proposal with `PROVISIONAL_UNVERIFIED` epistemic status and `UNVERIFIED` novelty status. It cannot imply support, truth, feasibility, novelty, survival, or completeness. Hypothesis and gap requests carry the real artifact IDs parsed from the source run's `ingest.json` when available; `sourceRunId` remains a separate lineage field. A single structural retry is permitted with the same scientific context and a distinct auditable attempt ID.

The runtime uses the existing `ResponsesModelGateway` and `/responses` streaming transport. `resolveModelConfiguration` gives process environment values precedence over a project `.env`; persisted snapshots contain only safe configuration metadata. Live execution requires `--live` and a successful existing model preflight. Dry-run performs no model, OpenAlex, or network calls.

The default canary call plan is deterministic and fail-closed: one preflight attempt, at most two GapDiscovery calls, and at most two Generation-0 calls, for five physical model calls total; one structural serialization retry is available within each role's allowance. OpenAlex calls are fixed at zero, and the candidate gap and hypothesis budgets are both three. The plan is reported by dry-run before any live call.

The persisted canary directory contains `input-state.json`, `config.json`, `model-preflight.json`, `run-snapshot.json`, `state.json`, `stage-state.json`, `input-projection.json`, `gap-discovery.json`, `gap-validation.json`, `generation-0.json`, `hypothesis-validation.json`, `model-attempts.json`, `events.json`, `checkpoint.json`, `usage.json`, and UTF-8 Markdown `report.md`. The shared file RunStore additionally commits `generation0-manifest.json` and the EVALUATE/GAP_DISCOVERY/GENERATION_0 boundary records atomically; an unfinished provider marker is `INTERRUPTED/UNKNOWN` and blocks silent retry. A single `runId` is used for the output directory, snapshot, checkpoint, events, and report; the checkpoint state hash is recomputable from `state.json`. Lifecycle events are ordered and include stage/model-attempt outcomes plus the checkpoint boundary. A failed GapDiscovery contract blocks Generation-0 and is reported as failed, while a valid empty response remains a completed run with zero accepted hypotheses. `replayM5AExtensionArtifacts()` verifies source-file hashes, run identity, state hash, checkpoint, and contiguous events with zero model/search calls. The source run is never modified. `source-integrity.ts` verifies ingest artifact bytes and saved abstract quotes where the persisted abstract and content hash are available; PaperReader seed text without persisted source text is marked unverified and excluded from direct scientific evidence qualification. Replacement evidence is never fabricated.

Run the offline boundary with:

```text
node examples/evaluation/m5a-gap-generation.mjs --dry-run --input-run evaluation/real-paper/cases/first-three/outputs/<accepted-run>
```

The operator may run the live canary manually after configuration and preflight are ready:

```text
node examples/evaluation/m5a-gap-generation.mjs --live --input-run evaluation/real-paper/cases/first-three/outputs/<accepted-run>
```

The canary stops after persisted Generation-0. Prior-art attack, falsification, critics, mutation, Pareto selection, experiments, and Generation-1 are outside M5A.
