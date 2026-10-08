# Milestone 3.6 PDF extraction

PDF extraction now uses a replaceable `DocumentExtractionAdapter` boundary. `FastPdfReader` retains the original lightweight parser. `PyMuPDFReader` invokes `scripts/pdf/extract_pymupdf.py` with an argument array, no shell interpolation, bounded timeout, and bounded JSON output.

Install the optional robust adapter dependency in the active Python environment with:

```powershell
python -m pip install PyMuPDF
```

The sidecar emits page geometry, blocks, lines, spans, bounding boxes, font metadata, original order, and deterministic normalized order. Two-column pages are ordered left column then right column when geometry supports that classification. The TypeScript layer creates stable artifact/page/block/line/span locators and records adapter, parser, Python, artifact-hash, timestamp, quality, and extracted-document hash provenance.

The extraction-only command tries `FastPdfReader`, evaluates its quality, then tries `PyMuPDFReader` on WARN/FAIL. It accepts only a PASS result and otherwise fails closed. No PaperReader, ProblemExtractor, retrieval, or model call is involved.
