# DeepSeek Harness architecture audit

Audit date: 2026-09-28. Repository inspected read-only: `D:\deepseek-harness`.

## Findings

DSH is an all-plugin Cordis harness. Plugins contribute services, typed events, and reversible effects to a shared context. Profiles compose ordered bundles and patches; the supported launcher is `dsh --profile <name>`. There is no privileged application core that EvoResearch should patch. New behavior should mount beside existing services and use documented seams.

The inspected top-level rules are in `D:\deepseek-harness\AGENTS.md` and the system map is in `D:\deepseek-harness\docs\architecture.md`. Relevant package and subsystem references are linked below.

## Native abstractions observed

| Concern | DSH abstraction and observed behavior | EvoResearch implication |
|---|---|---|
| Plugins/configuration | Cordis plugins register services/effects; profiles and bundles are configured by YAML patches. Registration returns disposers. | Package EvoResearch adapters as plugins; keep tunables in config and fail loudly on missing required services. |
| Skills | `@deepseek-ai/dsh-skill` exposes `ctx.skills`, merges provider catalogs, validates names, supports on-demand loading and invocation policy. Local filesystem discovery is a separate provider. | Put reusable paper-reader, extractor, falsifier, and reviewer instructions in `.agents/skills/` or embedded skills; version and record the selected skill. |
| Tools | `ctx.tools` is the model-facing registry and guarded execution pipeline. Tool schemas and results are logged/model-visible. | Add narrow research tools (parse, evidence lookup, prior-art query, review, mutation, checkpoint) as consumers of domain services. |
| Models | `@deepseek-ai/dsh-llm` defines messages, adapters, streaming chunks, usage, finish reasons, and replay metadata. Providers register behind `ctx.llm`. | Define a model port at the EvoResearch boundary; route role-specific calls through DSH adapters and record provider/model/route. |
| Web/search | `ctx.web` selects registered search/fetch providers at call time, with explicit provider IDs or loud ambiguity/unavailable errors. `dsh-tool-web` exposes `web_search`/`web_fetch` and marks content untrusted. | Literature retrieval uses `ctx.web` through a citation-preserving adapter; never scrape directly or trust snippets as evidence. |
| Subagents | `ctx.subagents` is a named-provider registry. One-shot runs have capability checks and disposable handles; continuable children use durable sessions and inboxes. | Use role-specific subagents only when isolation/disagreement is useful. Keep population state in EvoResearch, not in ephemeral child memory. |
| Sessions | `ctx.sessions` owns append-only durable event logs; model-visible content must be reconstructable from events. Session projections provide typed derived state. | Store run lifecycle, calls, evidence additions, mutations, checkpoints, and decisions as EvoResearch events or a linked session projection. |
| Storage | DSH storage is a hub (`ctx.storage`) with named JSON/SQLite backends; `storage-domain` owns typed KV domains, versioned records, atomic queued writes, and `domain/changed`. Session persistence is a separate `SessionPersistence` seam. | Use `ctx.storageDomain` for typed run metadata/indexes where its versioning contract fits; define EvoResearch schemas and migrations independently and keep session events authoritative for replay. |
| Filesystem | `ctx.fs` is a capability provider with policy/events. | Read paper artifacts through the DSH filesystem seam or a validated ingestion adapter; retain hashes and paths. |
| Shell/process | `ctx.shell` abstracts foreground/background execution; `ctx.subprocess` owns process lifetime. | Experiments use a dedicated executor adapter, never host process APIs directly. |
| Sandboxing | `ctx.sandbox` wraps exact argv and fails closed when a confined mode is unavailable. Modes are file-effect policies only. | Require `workspace-write` or stricter policy for experiment runs; record enforcement and denial facts; never silently fall back to unconfined. |
| Logging/observability | Typed session/agent events and projections provide replayable facts. `session-telemetry` can capture ordered copies through a redaction waterfall; product telemetry is explicit and must exclude prompts, responses, files, and credentials. | Emit structured stage events and metrics; make every decision traceable to input/event IDs. Treat outbound telemetry as opt-in/redacted and keep the canonical run log authoritative. |
| Configuration | Cordis config schemas are validated at load; DSH rules prefer explicit resolve(request) steps and no hidden defaults. | Validate corpus, budgets, routes, sandbox policy, and provider IDs at run start. |

## Source references inspected

- `D:\deepseek-harness\docs\architecture.md`
- `D:\deepseek-harness\AGENTS.md`
- `packages/skill/skill/README.md` and `src/index.ts`
- `docs/subsystems/subagent.md` and `packages/subagent/subagent/src/types.ts`
- `docs/subsystems/session.md`
- `docs/subsystems/storage.md`
- `docs/subsystems/llm-streaming.md`
- `packages/web/web/src/index.ts` and `packages/web/tool-web/README.md`
- `packages/shell/shell/src/index.ts`
- `packages/sandbox/sandbox/src/index.ts` and `packages/shell/bash-sandbox/README.md`
- `packages/storage/storage-domain/README.md` and `docs/subsystems/session-telemetry.md`

## Architectural conclusions

EvoResearch should be a domain package plus a small set of DSH plugins, not a second agent runtime. Deterministic domain services own schemas, graph operations, provenance, population transitions, Pareto selection, budgets, and checkpoints. DSH owns model calls, skills, web/provider selection, child-agent lifecycle, durable session mechanics, filesystem/process capabilities, sandbox enforcement, and runtime configuration. An explicit adapter layer translates DSH messages/tool results into validated EvoResearch records.
