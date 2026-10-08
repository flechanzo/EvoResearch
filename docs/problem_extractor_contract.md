# ProblemExtractor contract

`runProblemExtractor` receives the validated `PaperReaderOutput` under
`paperReaderOutput` and asks for this envelope:

```json
{
  "nodes": [
    { "nodeId": "string", "type": "problem", "label": "string", "evidenceIds": [] }
  ],
  "edges": [
    { "edgeId": "string", "from": "nodeId", "to": "nodeId", "relation": "USES", "evidenceIds": [] }
  ]
}
```

Node types and edge relations are closed sets defined by the domain. Empty
arrays are valid. Evidence IDs must be supplied by the input context; the
extractor must not invent provenance. In the live coordinator,
`availableEvidenceIds` contains deterministic, paper-local evidence IDs
derived from the validated PaperReader output, and `evidenceReferences` maps
each PaperReader `itemId` to its trusted evidence ID. PaperReader `itemId`
values are a separate identity domain and must never be used as graph evidence
IDs.
Structural validation rejects any evidence reference outside that paper-local
set. The graph normalizer also fails closed on unresolved references; it never
silently filters provenance. `buildProblemGraph` performs the final complete
evidence set check.

One serialization retry is allowed. The retry carries the same validated
PaperReader input plus the exact structural error and contract. Invalid output
is never persisted as a ProblemExtractor result.
