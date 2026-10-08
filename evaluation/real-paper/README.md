# Real-paper validation harness

Place three licensed or locally owned PDFs under `evaluation/real-paper/cases/first-three/papers/` and edit `case.json`. Do not commit copyrighted PDFs; add the local paths to `.git/info/exclude` or an appropriate ignore rule.

Run extraction-only quality validation with:

```powershell
node examples/evaluation/extraction-only.mjs evaluation/real-paper/cases/first-three/case.json
```

Run the deterministic fixture-backed M3 evaluation with:

```powershell
node examples/evaluation/run.mjs evaluation/real-paper/cases/first-three/case.json
```

Human annotations belong in `ground_truth/annotations.json`; model outputs belong in `outputs/`. The harness keeps those datasets separate. Reports are written under `outputs/` and include extraction quality, provenance, retrieval, conflict, temporal leakage, and failure analysis.
