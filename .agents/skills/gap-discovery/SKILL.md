# Gap discovery

Use this skill only after the caller supplies structured `ResearchProblemGraph`, `EvidenceGraph`, and EVALUATE completeness state.

1. Separate scientific gaps (`OPEN_QUESTION`, `KNOWN_LIMITATION`, `UNTESTED_ASSUMPTION`, `CONTRADICTORY_EVIDENCE`, `UNEXPLAINED_FAILURE`, `METHOD_INCOMPATIBILITY`, `MISSING_COMPARISON`, `UNRESOLVED_MECHANISM`) from coverage gaps (`INCOMPLETE_EVIDENCE_COVERAGE`, `DEFERRED_EVIDENCE_WORK`, `FAILED_RETRIEVAL`, `NO_RESULTS_RETRIEVAL`, `ABSTRACT_ONLY_EVIDENCE`, `MISSING_QUANTITATIVE_EVIDENCE`).
2. Treat deferred work, failed or empty retrieval, abstract-only records, missing full text, and missing quantitative verification as coverage limitations. They do not establish novelty, falsity, truth, absence of literature, or negative evidence.
3. Preserve graph, claim, and direct evidence identifiers. A model interpretation is labeled as interpretation and cannot be copied into source evidence.
4. Mark a scientific gap eligible only when its scientific component has an independent structured provenance chain. Coverage-only gaps require follow-up and cannot seed a hypothesis by themselves.
5. Emit deterministic gap IDs and retain duplicate/rejection reasons. Do not infer novelty or scientific completeness.

The live GapDiscovery model envelope is `m5a.gap-proposal.v2`: the model may
return only `kind`, `statement`, bounded `rationale`, `coverageState`,
`sourceProblemIds`, `sourceClaimIds`, `evidenceReferences[{evidenceId,
relation}]`, and `uncertainty`. It must not return source-versus-interpretation
arrays, evidence level, epistemic status, application-owned gap IDs, novelty
state, or survival state. The application supplies role-grouped evidence IDs
for context and deterministically materializes canonical evidence arrays from
the persisted evidence records. Allowed relations are SUPPORTS, CONTRADICTS,
QUALIFIES, MOTIVATES, and INSUFFICIENT; unknown IDs and conflicting duplicate
relations fail closed. Historical artifacts can use the explicit legacy
adapter, but the hardened envelope is the live default.

Gap rationale contract: rationale text must stay relative to the supplied
projection/evidence, for example an untested relation or missing validation
in the available material. It must not assert verified novelty, global
absence of prior work, truth, falsity, proof, confirmed nonexistence, or
literature-wide completeness. A bounded phrase such as “the projection
provides no evidence of a dedicated validation” is allowed when it is tied to
the supplied context and does not promote a coverage limitation into a
scientific conclusion.
