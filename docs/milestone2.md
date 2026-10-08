# Milestone 2 implementation

The extraction boundary is dependency-free. Plain text and Markdown preserve form-feed pages and headings. PDFs use a deliberately small deterministic text-stream reader that extracts literal `Tj` strings and preserves page boundaries when `/Type /Page` markers are present. This keeps the domain portable and avoids coupling it to a PDF framework; richer layout extraction can be added behind `ArtifactReader` later.

`ExtractedDocument` contains pages, sections, spans, stable artifact/page/section/span/range locators, parser metadata, and warnings. `runPaperReader` sends only bounded pages and spans through the `ModelGateway`, validates the structured response, and returns a failed attempt for malformed output. `buildProblemGraph` sorts nodes and edges deterministically and rejects unknown nodes, unsupported relations, and missing evidence.
