# Notes Shape Recognition Datasets

Codmes shape recognition should be tuned with external vector stroke data first, then validated against automatic in-app diagnostics.

## Public Sources

- Google Quick, Draw! dataset
  - Source: <https://github.com/googlecreativelab/quickdraw-dataset>
  - Dataset card mirror: <https://huggingface.co/datasets/google/quickdraw>
  - Vector strokes across hundreds of drawing classes.
  - Useful classes for Codmes: `circle`, `square`, `triangle`, `line`.
  - Good for rough robustness testing, but not stylus-note specific.
  - The dataset is large enough for later ML training, but Codmes currently uses
    it as a replay/evaluation corpus for the geometric recognizer.
  - Fetch small JSONL samples with:

```bash
python3 scripts/fetch_quickdraw_shape_samples.py --per-class 80
```

- PaleoSketch / ShortStraw research
  - PaleoSketch paper reference: <https://www.semanticscholar.org/paper/PaleoSketch%3A-accurate-primitive-sketch-recognition-Paulson-Hammond/545d3d4bc14f99ce37e21ed83e23804c2cc78532>
  - Useful as algorithm references for primitive recognition and corner detection.
  - The papers describe shape sets and recognition features, but the original stroke corpus is not as directly consumable as Quick, Draw!.

## Replay Gate

Recognizer changes must be checked with the replay gate before committing:

```bash
scripts/evaluate_shape_recognition.sh \
  --corpus docs/notes/shape-recognition-quickdraw-samples.jsonl \
  --min-accuracy 0.70 \
  --max-wrong 16
```

The gate reports:

- `correct`: selected shape exactly matches `expectedKind`.
- `none`: recognizer refused to snap. This is usually better than a wrong snap.
- `wrong`: recognizer snapped to the wrong non-none shape. This is the main number to push down for production feel.
- Per-kind confusion rows, such as `triangle: rectangle=2 triangle=17`.

For local tuning, include mismatch details:

```bash
scripts/evaluate_shape_recognition.sh --show-mismatches
```

For broader manual checks, generate a larger temporary corpus:

```bash
python3 scripts/fetch_quickdraw_shape_samples.py \
  --per-class 100 \
  --output /tmp/codmes-shape-quickdraw-400.jsonl

scripts/evaluate_shape_recognition.sh \
  --corpus /tmp/codmes-shape-quickdraw-400.jsonl \
  --min-accuracy 0.0 \
  --max-wrong 9999
```

As of the `Improve PDF shape recognition confidence` pass, the 80-sample smoke
corpus is suitable for blocking obvious regressions, while a 400-sample
QuickDraw corpus still exposes production gaps. The main known confusions are:

- `triangle -> rectangle`
- `line -> triangle`
- `circle -> ellipse`

## In-App Diagnostics

The app also appends automatic hold-recognition attempts to:

```text
~/Library/Application Support/Codmes/Diagnostics/shape-recognition-samples.jsonl
```

Users do not need to inspect this file. It exists so failed real-world strokes can be replayed during recognizer tuning without relying on screenshots or verbal descriptions.

When a real stroke has a known intended label, copy the record into a local
JSONL corpus and fill `expectedKind` with one of:

- `line`
- `polyline`
- `triangle`
- `rectangle`
- `circle`
- `ellipse`

Then replay it with the same evaluator:

```bash
scripts/evaluate_shape_recognition.sh --corpus path/to/local-user-shapes.jsonl --show-mismatches
```

## JSONL Record Shape

Each line contains:

- `expectedKind`: desired label when known from an external corpus.
- `selectedKind`: recognizer output, or `unknown` before replay.
- `rawPoints`: original stroke points.
- `fittedPoints`: snapped output points when available.
- `scores`: recognizer candidate scores when available.

## Current Policy

Codmes should prefer `none` over a confident-looking but wrong snap. GoodNotes
and Apple Notes feel reliable partly because ambiguous strokes are not forced
into a bad shape. The recognizer should therefore optimize in this order:

1. Reduce `wrong` snaps.
2. Preserve obvious `correct` snaps.
3. Recover more `none` cases only after the first two metrics are stable.
