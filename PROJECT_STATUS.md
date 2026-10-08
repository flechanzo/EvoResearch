You are taking over an existing EvoResearch repository.

Your task is NOT to implement new features.

Your task is to produce an accurate engineering and research progress report.

You must inspect the actual repository state, git history if available, source code, tests, docs, configs, and generated artifacts.

Do NOT rely on previous conversation memory.
Do NOT assume that planned features are completed.
Only report what is verifiably present in the repository.

==================================================
PROJECT STATUS AUDIT
==================================================

Generate a complete status report for EvoResearch.

The report must answer:

1. What is this project currently building?

Summarize the current scientific goal and system architecture.

Describe whether the current system is:

- paper understanding system
- research problem discovery system
- evidence-grounded hypothesis generation system
- evolutionary scientific discovery system

Explain the current maturity level.

==================================================
2. CURRENT ARCHITECTURE MAP
==================================================

Inspect the repository and draw the actual pipeline.

Format:

INPUT
 ↓
Stage 1
 ↓
Stage 2
 ↓
...
 ↓
OUTPUT

For every stage report:

- stage name
- source directory/files
- implemented?
- tested?
- live validated?
- blocked?
- dependencies

Do not describe planned architecture unless code exists.

==================================================
3. MILESTONE STATUS TABLE
==================================================

Create a table:

| Milestone | Goal | Status | Evidence |
|-----------|------|--------|----------|

Include at least:

M1
M2
M3
M3.5
M3.6
Problem Graph
Retrieval Needs
Query Plan
Literature Search
Evidence Graph
M4A
M4B
Hypothesis Evolution
Simulation/Experiment

For each:

Status must be one of:

- NOT_STARTED
- DESIGNED
- IMPLEMENTED
- OFFLINE_TESTED
- REAL_DATA_TESTED
- LIVE_VALIDATED
- BLOCKED

Explain why.

==================================================
4. REAL EXECUTION HISTORY
==================================================

Find actual executed experiments/runs.

Inspect:

- output directories
- logs
- snapshots
- checkpoints
- evaluation results

Report:

For every important run:

- run id
- date if available
- command executed
- stages completed
- stages stopped
- success/failure reason

Separate:

REAL RUN

from

DEMO / MOCK / UNIT TEST

==================================================
5. CURRENT FRONTIER
==================================================

Answer:

"What is the furthest point that the system has actually reached?"

Give exactly:

LAST_CONFIRMED_COMPLETED_STAGE:

NEXT_LOGICAL_STAGE:

BLOCKING_ISSUE:

Do not confuse implemented code with validated pipeline.

==================================================
6. CODE QUALITY AUDIT
==================================================

Inspect:

- duplicated modules
- duplicated domain models
- unfinished TODOs
- placeholder implementations
- mocked outputs
- hardcoded assumptions
- missing validation

Especially check:

- Evidence model
- Hypothesis model
- Research Problem Graph
- Event system
- Checkpoint system
- ID generation
- Provenance tracking

Report risks.

==================================================
7. DATA AND TOOL DEPENDENCY STATUS
==================================================

List external dependencies:

- LLM providers
- APIs
- search engines
- databases
- PDF tools
- Python dependencies
- Docker requirements

For each:

available?
configured?
tested?

==================================================
8. TEST STATUS
==================================================

Run or inspect:

npm test

npm run typecheck

Report:

- passing tests
- failing tests
- skipped tests
- missing tests

Do not modify code.

==================================================
9. RESEARCH CONTRIBUTION STATUS
==================================================

From the current implementation, identify which parts could potentially become research contributions.

Classify:

Already implemented contribution

Potential future contribution

Only idea/design

Focus on:

- Research Problem Graph
- Evidence Graph
- Adversarial hypothesis evolution
- Prior-art attack
- Falsification
- Pareto selection
- Scientific idea genealogy
- Adaptive research budget

==================================================
10. NEXT DEVELOPMENT PLAN
==================================================

Based ONLY on the current repository state, recommend the next 5 engineering steps.

For each:

- objective
- why now
- files involved
- acceptance criteria

Do not propose large rewrites.

==================================================
FINAL SUMMARY
==================================================

End with:

A.

ONE SENTENCE PROJECT STATUS

B.

CURRENT DEVELOPMENT FRONTIER

C.

TOP 3 RISKS

D.

NEXT COMMAND I SHOULD RUN

==================================================

Important:

Do not write code.

Do not modify files.

Do not install dependencies.

Only inspect and report.
