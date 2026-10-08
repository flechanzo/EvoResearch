"""Emit structured PDF extraction JSON using PyMuPDF. Diagnostics stay in JSON; stdout is JSON only."""
import json
import platform
import sys
from importlib.metadata import distribution

SIDECAR_VERSION = 'm3.6.1-runtime'
sys.stdout.reconfigure(encoding='utf-8')
sys.stderr.reconfigure(encoding='utf-8')
runtime = {"sysExecutable": sys.executable, "pythonVersion": platform.python_version(),
           "pymupdfAvailable": False, "sidecarVersion": SIDECAR_VERSION}

try:
    try:
        import pymupdf as fitz
        runtime['importName'] = 'pymupdf'
    except ModuleNotFoundError as missing:
        if missing.name != 'pymupdf':
            raise
        # Only allow legacy fitz when the installed PyMuPDF distribution owns it.
        package = distribution('PyMuPDF')
        import fitz
        from pathlib import Path
        owned = {Path(package.locate_file(file)).resolve() for file in package.files or []}
        if Path(fitz.__file__).resolve() not in owned:
            raise ImportError('fitz is not owned by the PyMuPDF distribution')
        runtime['importName'] = 'fitz'
    if not callable(getattr(fitz, 'open', None)) or not hasattr(fitz, 'VersionBind'):
        raise ImportError('Imported module is not a compatible PyMuPDF installation')
    runtime.update(pymupdfAvailable=True, pymupdfVersion=fitz.VersionBind)
except Exception as exc:
    runtime['error'] = f'PyMuPDF unavailable: {exc}'
    print(json.dumps({"ok": False, **runtime}))
    raise SystemExit(2)

if sys.argv[1:] == ['--preflight']:
    print(json.dumps({"ok": True, **runtime}))
    raise SystemExit(0)

if len(sys.argv) != 2:
    print(json.dumps({"ok": False, "error": "usage: extract_pymupdf.py INPUT_PDF"}))
    raise SystemExit(2)

try:
    document = fitz.open(sys.argv[1])
    pages = []
    for page_number, page in enumerate(document, start=1):
        data = page.get_text("dict", sort=False)
        raw_blocks = [block for block in data.get("blocks", []) if block.get("type") == 0]
        page_width = page.rect.width
        left_blocks = [block for block in raw_blocks if block["bbox"][2] <= page_width * 0.55]
        right_blocks = [block for block in raw_blocks if block["bbox"][0] >= page_width * 0.45]
        two_columns = len(left_blocks) >= 2 and len(right_blocks) >= 2
        def reading_key(index):
            box = raw_blocks[index]["bbox"]
            column = 0 if box[2] <= page_width * 0.55 else (1 if box[0] >= page_width * 0.45 else 0)
            return (column, round(box[1], 1), round(box[0], 1)) if two_columns else (0, round(box[1], 1), round(box[0], 1))
        order = sorted(range(len(raw_blocks)), key=reading_key)
        normalized_order = {original: index for index, original in enumerate(order)}
        blocks = []
        for original_index, block in enumerate(raw_blocks):
            lines = []
            for line_index, line in enumerate(block.get("lines", [])):
                spans = [{"spanIndex": span_index, "text": span.get("text", ""), "bbox": span.get("bbox"), "font": span.get("font"), "size": span.get("size")} for span_index, span in enumerate(line.get("spans", []))]
                lines.append({"lineIndex": line_index, "text": "".join(span["text"] for span in spans), "spans": spans})
            blocks.append({"blockIndex": original_index, "bbox": block.get("bbox"), "text": "\n".join(line["text"] for line in lines), "originalOrder": original_index, "normalizedOrder": normalized_order[original_index], "lines": lines})
        ordered = sorted(blocks, key=lambda block: block["normalizedOrder"])
        pages.append({"page": page_number, "width": page.rect.width, "height": page.rect.height, "text": "\n".join(block["text"] for block in ordered), "blocks": ordered, "readingOrder": "two-column-left-right" if two_columns else "top-to-bottom-left-to-right"})
    print(json.dumps({"ok": True, "document": {"pages": pages, "warnings": [], **runtime}}, ensure_ascii=False))
except Exception as exc:
    print(json.dumps({"ok": False, "error": f"PDF extraction failed: {exc}"}))
    raise SystemExit(3)
