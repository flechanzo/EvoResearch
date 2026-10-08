# PaperReader contract and diagnostics

`runPaperReader` accepts one JSON object with this exact envelope:

```json
{
  "artifactId": "<input artifact ID>",
  "schemaVersion": "m2.3",
  "items": [
    {
      "itemId": "string",
      "type": "problem | method | assumption | dataset | metric | limitation | failure-case | open-question | claim",
      "statement": "string",
      "confidence": 0.0,
      "uncertainty": 0.0,
      "locators": [{ "artifactId": "...", "page": 1, "spanIndex": 0, "start": 0, "end": 10 }],
      "interpretation": "DIRECT_EVIDENCE | MODEL_INTERPRETATION"
    }
  ]
}
```

`artifactId` is an application-owned identity derived during ingestion. If the model returns an otherwise envelope-shaped object with `schemaVersion` and an `items` array but omits only `artifactId`, trusted code supplies the input artifact ID before validation. A supplied artifact ID must match the input document; it is never replaced. For source locators, the model should copy an existing `spanIndex` from the supplied context. Trusted code resolves that span index to the complete canonical `DocumentLocator`, after checking every optional locator field supplied by the model for exact equality. Direct evidence must contain at least one locator, and every locator must resolve to an extracted document span. Confidence and uncertainty are finite numbers in `[0, 1]`. Prompt-JSON parsing removes one surrounding Markdown JSON fence only. Wrappers, arrays, JSON strings, surrounding prose, unknown locator fields, altered locator fields, and schema mismatches remain failures.

Every attempt is recorded in `model-attempts.json`. When validation fails, the bounded diagnostic copy is written under `paper-reader/failed-attempts/<paperId>/attempt-<n>/` with metadata, the reconstructed output preview, parsed output when available, and validation errors. These files are marked `UNTRUSTED / UNVALIDATED`; validated PaperReader files are written only after the complete contract passes.
