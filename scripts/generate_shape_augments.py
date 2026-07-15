#!/usr/bin/env python3
"""Generate synthetic note-style shape samples for recognizer augmentation."""

from __future__ import annotations

import argparse
import json
import math
import random
import time
from pathlib import Path


def jitter(value: float, amount: float, rng: random.Random) -> float:
    return value + rng.uniform(-amount, amount)


def rotate(point: tuple[float, float], angle: float) -> tuple[float, float]:
    x, y = point
    return (
        x * math.cos(angle) - y * math.sin(angle),
        x * math.sin(angle) + y * math.cos(angle),
    )


def transform(
    points: list[tuple[float, float]],
    *,
    scale: float,
    angle: float,
    offset: tuple[float, float],
    noise: float,
    rng: random.Random,
) -> list[dict[str, float]]:
    result: list[dict[str, float]] = []
    for x, y in points:
        rx, ry = rotate((x * scale, y * scale), angle)
        result.append({
            "x": jitter(rx + offset[0], noise, rng),
            "y": jitter(ry + offset[1], noise, rng),
        })
    return result


def ellipse_points(rng: random.Random, count: int = 80) -> list[tuple[float, float]]:
    rx = rng.uniform(0.75, 1.0)
    ry = rng.uniform(0.22, 0.58)
    if rng.random() < 0.35:
        rx, ry = ry, rx
    start = rng.uniform(-0.45, 0.45)
    sweep = math.tau * rng.uniform(0.92, 1.08)
    wobble = rng.uniform(0.015, 0.055)
    points: list[tuple[float, float]] = []
    for index in range(count):
        t = start + sweep * index / (count - 1)
        local_rx = rx * (1 + math.sin(t * 3.0) * wobble)
        local_ry = ry * (1 + math.cos(t * 2.0) * wobble)
        points.append((math.cos(t) * local_rx, math.sin(t) * local_ry))
    return points


def line_segment(a: tuple[float, float], b: tuple[float, float], steps: int) -> list[tuple[float, float]]:
    return [
        (
            a[0] + (b[0] - a[0]) * index / max(steps - 1, 1),
            a[1] + (b[1] - a[1]) * index / max(steps - 1, 1),
        )
        for index in range(steps)
    ]


def polyline_points(rng: random.Random) -> list[tuple[float, float]]:
    templates = [
        [(-0.9, -0.6), (-0.9, 0.55), (0.65, 0.55)],  # ㄴ
        [(-0.85, -0.55), (0.65, -0.55), (0.65, 0.6)],  # ㄱ
        [(-0.9, -0.6), (-0.9, 0.55), (-0.1, 0.55), (-0.1, -0.35), (0.8, -0.35)],  # ㄹ/step
        [(-0.9, -0.5), (-0.25, 0.55), (0.35, -0.45), (0.9, 0.5)],  # zigzag
        [(-0.8, 0.55), (-0.8, -0.55), (0.0, -0.55), (0.0, 0.45), (0.85, 0.45)],
    ]
    vertices = [(x + rng.uniform(-0.12, 0.12), y + rng.uniform(-0.12, 0.12)) for x, y in rng.choice(templates)]
    points: list[tuple[float, float]] = []
    for start, end in zip(vertices, vertices[1:]):
        segment = line_segment(start, end, rng.randint(14, 24))
        if points:
            segment = segment[1:]
        points.extend(segment)
    return points


def record(kind: str, points: list[dict[str, float]], index: int) -> dict:
    return {
        "id": f"synthetic-{kind}-{index:04d}",
        "createdAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "appVersion": "synthetic-augment-v1",
        "source": f"synthetic:{kind}",
        "expectedKind": kind,
        "selectedKind": "unknown",
        "reason": "synthetic-augment",
        "endpointGap": 0,
        "vertexCount": 0,
        "scores": [],
        "rawPoints": points,
        "fittedPoints": [],
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--ellipse-count", type=int, default=180)
    parser.add_argument("--polyline-count", type=int, default=220)
    parser.add_argument("--seed", type=int, default=1729)
    parser.add_argument("--output", default="/tmp/codmes-shape-augments.jsonl")
    args = parser.parse_args()

    rng = random.Random(args.seed)
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    written = 0
    with output.open("w", encoding="utf-8") as handle:
        for index in range(args.ellipse_count):
            points = transform(
                ellipse_points(rng, count=rng.randint(58, 96)),
                scale=rng.uniform(95, 145),
                angle=rng.uniform(-math.pi, math.pi),
                offset=(rng.uniform(90, 140), rng.uniform(90, 140)),
                noise=rng.uniform(0.8, 3.0),
                rng=rng,
            )
            handle.write(json.dumps(record("ellipse", points, index), sort_keys=True, separators=(",", ":")) + "\n")
            written += 1
        for index in range(args.polyline_count):
            points = transform(
                polyline_points(rng),
                scale=rng.uniform(75, 135),
                angle=rng.uniform(-math.pi, math.pi),
                offset=(rng.uniform(90, 150), rng.uniform(90, 150)),
                noise=rng.uniform(0.6, 2.4),
                rng=rng,
            )
            handle.write(json.dumps(record("polyline", points, index), sort_keys=True, separators=(",", ":")) + "\n")
            written += 1
    print(f"wrote {written} synthetic samples to {output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
