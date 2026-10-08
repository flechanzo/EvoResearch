# Gap discovery

Use this skill only after the caller supplies structured `ResearchProblemGraph`, `EvidenceGraph`, and EVALUATE completeness state.

1. Separate scientific gaps (`OPEN_QUESTION`, `KNOWN_LIMITATION`, `UNTESTED_ASSUMPTION`, `CONTRADICTORY_EVIDENCE`, `UNEXPLAINED_FAILURE`, `METHOD_INCOMPATIBILITY`, `MISSING_COMPARISON`, `UNRESOLVED_MECHANISM`) from coverage gaps (`INCOMPLETE_EVIDENCE_COVERAGE`, `DEFERRED_EVIDENCE_WORK`, `FAILED_RETRIEVAL`, `NO_RESULTS_RETRIEVAL`, `ABSTRACT_ONLY_EVIDENCE`, `MISSING_QUANTITATIVE_EVIDENCE`).
2. Treat deferred work, failed or empty retrieval, abstract-only records, missing full text, and missing quantitative verification as coverage limitations. They do not establish novelty, falsity, truth, absence of literature, or negative evidence.
3. Preserve graph, claim, and direct evidence identifiers. A model interpretation is labeled as interpretation and cannot be copied into source evidence.
4. Mark a scientific gap eligible only when its scientific component has an independent structured provenance chain. Coverage-only gaps require follow-up and cannot seed a hypothesis by themselves.
5. Emit deterministic gap IDs and retain duplicate/rejection reasons. Do not infer novelty or scientific completeness.
