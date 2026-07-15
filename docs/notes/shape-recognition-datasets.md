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

  - Use `--skip-per-class` to create held-out replay sets that do not overlap
    with an exported exemplar bank:

```bash
python3 scripts/fetch_quickdraw_shape_samples.py \
  --per-class 100 \
  --skip-per-class 200 \
  --output /tmp/codmes-shape-quickdraw-heldout-after-800.jsonl
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
  --strategy geometric \
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

The evaluator also supports an exemplar strategy:

```bash
scripts/evaluate_shape_recognition.sh \
  --corpus /tmp/codmes-shape-quickdraw-400.jsonl \
  --strategy exemplar \
  --min-accuracy 0.90 \
  --max-wrong 40
```

`exemplar` uses normalized stroke paths and leave-one-out nearest-neighbor
matching. This validates the sample-backed path independently from the app's
geometric fit logic.

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

After adding the exemplar evaluator, the same 400-sample temporary corpus
reaches:

```text
strategy=exemplar
total=400 correct=361 none=0 wrong=39 accuracy=0.9025
```

This shows that 90% is reachable with sample-backed recognition. The remaining
work was to export a compact exemplar/model bank and call it from the Notes
canvas runtime alongside the geometric recognizer.

## Runtime Exemplar Bank

The app now includes a generated compact exemplar bank:

```text
client/apple/Sources/Codmes/PDFShapeExemplarBank.swift
```

Regenerate it from an external replay corpus with:

```bash
python3 scripts/fetch_quickdraw_shape_samples.py \
  --per-class 200 \
  --output /tmp/codmes-shape-quickdraw-800.jsonl

python3 scripts/export_shape_exemplar_bank.py \
  --input /tmp/codmes-shape-bank-1200.jsonl \
  --output client/apple/Sources/Codmes/PDFShapeExemplarBank.swift
```

The exporter normalizes each stroke to 64 points, rotates by indicative angle,
scales into a unit box, and stores quantized `Float` coordinates. At runtime,
`PDFShapeRecognizer` compares the current hold-completion stroke against this
bank. A close exemplar match decides the intended primitive shape; the
geometric recognizer still provides the fitted points for line, rectangle,
triangle, and circle output.

Current replay checks:

```text
80-sample smoke corpus
strategy=geometric
total=80 correct=80 none=0 wrong=0 accuracy=1.0000

400-sample held-out corpus after the exported 800-bank source window
strategy=geometric
total=400 correct=360 none=3 wrong=37 accuracy=0.9000
```

This 90% held-out result is a replay metric, not a guarantee that all real user
stylus shapes will classify correctly. Real in-app failures should still be
copied from diagnostics into a local replay corpus and used to grow or rebalance
the bank.

## Ellipse And Polyline Augments

Quick, Draw! provides useful public vectors for `circle`, `square`, `triangle`,
and `line`, but it does not directly cover note-taking gestures such as thin
ellipses or Korean-style bent strokes like `ㄱ`, `ㄴ`, and `ㄹ`. Codmes therefore
adds synthetic note-shape augments:

```bash
python3 scripts/generate_shape_augments.py \
  --ellipse-count 180 \
  --polyline-count 220 \
  --output /tmp/codmes-shape-augments.jsonl

cat /tmp/codmes-shape-quickdraw-800.jsonl \
  /tmp/codmes-shape-augments.jsonl \
  > /tmp/codmes-shape-bank-1200.jsonl
```

The generated classes are:

- `ellipse`: elongated closed strokes so thin ovals do not collapse into rectangle/circle.
- `polyline`: open bent strokes and step strokes so `ㄱ`, `ㄴ`, `ㄹ`, and zigzags do not collapse into line/circle.

Current mixed held-out check, using a different synthetic seed:

```text
strategy=geometric
total=600 correct=548 none=3 wrong=49 accuracy=0.9133
ellipse: ellipse=90
polyline: polyline=109 rectangle=1
```

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
