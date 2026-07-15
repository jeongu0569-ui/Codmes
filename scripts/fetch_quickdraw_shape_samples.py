#!/usr/bin/env python3
"""Fetch small vector samples from Google's Quick, Draw! dataset.

The output format matches Codmes shape-recognition JSONL samples closely enough
to reuse for offline recognizer tuning. It intentionally streams only a small
prefix per class so it does not download the full 50M drawing corpus.
"""

from __future__ import annotations

import argparse
import json
import time
import urllib.parse
import urllib.request
from pathlib import Path


QUICKDRAW_BASE = "https://storage.googleapis.com/quickdraw_dataset/full/simplified"
DEFAULT_CLASSES = {
    "circle": "circle",
    "square": "rectangle",
    "triangle": "triangle",
    "line": "line",
}


def iter_quickdraw_records(class_name: str):
    url = f"{QUICKDRAW_BASE}/{urllib.parse.quote(class_name)}.ndjson"
    with urllib.request.urlopen(url, timeout=60) as response:
        for raw_line in response:
            if raw_line.strip():
                yield json.loads(raw_line)


def flatten_strokes(drawing: list[list[list[int]]]) -> list[dict[str, float]]:
    points: list[dict[str, float]] = []
    for stroke in drawing:
        if len(stroke) < 2:
            continue
        xs, ys = stroke[0], stroke[1]
        for x, y in zip(xs, ys):
            points.append({"x": float(x), "y": float(y)})
    return points


def convert_record(record: dict, source_class: str, expected_kind: str, recognized_only: bool) -> dict | None:
    if recognized_only and not record.get("recognized", False):
        return None
    points = flatten_strokes(record.get("drawing", []))
    if len(points) < 8:
        return None
    return {
        "id": f"quickdraw-{source_class}-{record.get('key_id', int(time.time() * 1000))}",
        "createdAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "appVersion": "quickdraw-simplified",
        "source": f"quickdraw:{source_class}",
        "expectedKind": expected_kind,
        "selectedKind": "unknown",
        "reason": "external-corpus",
        "endpointGap": 0,
        "vertexCount": 0,
        "scores": [],
        "rawPoints": points,
        "fittedPoints": [],
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--per-class", type=int, default=80)
    parser.add_argument("--output", default="docs/notes/shape-recognition-quickdraw-samples.jsonl")
    parser.add_argument(
        "--include-unrecognized",
        action="store_true",
        help="include Quick, Draw! records that Google's game did not recognize",
    )
    args = parser.parse_args()

    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)

    written = 0
    with output.open("w", encoding="utf-8") as handle:
        for source_class, expected_kind in DEFAULT_CLASSES.items():
            count = 0
            for record in iter_quickdraw_records(source_class):
                converted = convert_record(
                    record,
                    source_class,
                    expected_kind,
                    recognized_only=not args.include_unrecognized,
                )
                if not converted:
                    continue
                handle.write(json.dumps(converted, sort_keys=True, separators=(",", ":")) + "\n")
                count += 1
                written += 1
                if count >= args.per_class:
                    break
            print(f"{source_class}: {count}")
    print(f"wrote {written} samples to {output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
