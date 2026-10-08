# Milestone 3 implementation

Academic retrieval is isolated behind `AcademicSearchProvider`. `OpenAlexProvider` uses the structured Works API with bounded page size, a timeout, one bounded retry, a user-agent, a provider-side `to_publication_date` filter, and an authoritative local corpus-cutoff gate. Live search requires an explicit `YYYY-MM-DD` cutoff; records with missing or malformed publication dates are excluded under the persisted `EXCLUDE_FROM_CUTOFF_CORPUS` policy. Generic DSH web search remains a separate future fallback; no DSH core files are changed.

`LiteratureRecord` preserves DOI, OpenAlex, arXiv, URL, provider identities, and publication-date status. Records without a deterministic shared identifier remain separate. Retrieval needs and queries are deterministic and bounded. `SearchCoverage` records filters, limits, retry/timeout policy, empty, partial, failed, duplicate, future-excluded, unknown-date, and accepted outcomes without any novelty implication.

`EvidenceGraph` stores claims separately from literature evidence and preserves SUPPORTS, CONTRADICTS, QUALIFIES, and MOTIVATES links. Evidence levels distinguish metadata, abstract, full text, and model interpretation.
