# Eraser And Shape Strokes

This document explains how the Notes eraser works with normal ink and
auto-completed shapes.

## User Behavior

The eraser is a partial eraser:

- Normal handwriting can be erased in pieces.
- Auto-completed shapes can also be erased in pieces.
- Once a shape is partially erased, it becomes normal pen ink.

That conversion is intentional. After a shape edge is partially removed, the
original shape handles no longer describe the edited geometry.

## Stored Stroke Shape

Normal ink uses:

```text
tool: "pen"
```

Auto-completed shapes use shape tools such as:

```text
tool: "shape:line"
tool: "shape:polyline"
tool: "shape:rectangle"
tool: "shape:triangle"
tool: "shape:circle"
tool: "shape:ellipse"
```

The shape handles are UI state derived from the stroke's tool and points. They
are not saved as independent objects.

## Eraser Flow

The Apple PDF view calls `eraseStroke(...)`, which:

1. Reads page strokes from the current annotation document.
2. Converts the eraser location into normalized page coordinates.
3. Computes a normalized threshold from page size and eraser width.
4. Calls `splitStrokes(...)`.
5. Saves the resulting stroke list through `onStrokesChanged(...)`.

`splitStroke(...)` does the actual split.

For normal pen ink:

1. Walk each stroke point.
2. Treat a point as erased when the point or adjacent segment is inside the
   eraser threshold.
3. Keep remaining contiguous point runs as new strokes.
4. Drop the stroke entirely if no segment remains.

For shape ink:

1. Detect the shape tool.
2. Densify the shape edge into more points using
   `asDensifiedPenStroke(maxSegmentLength:)`.
3. Change the tool to `pen`.
4. Run the same split logic as normal ink.
5. Save the remaining pieces as ordinary pen strokes.

## Why Shapes Are Densified

Shapes such as triangles and rectangles may have only a few control points. If
the eraser only tested those points, tapping the middle of an edge could miss
the shape or delete too much.

Densifying the shape turns each edge into many small points before splitting,
so partial erase can remove a local section of the edge.

## Persistence

Partial erase updates the same portable annotation state:

```text
PDFAnnotationPage.inkStrokes
CodmesNoteElement.stroke
```

The server does not need shape-specific eraser logic. It stores the resulting
stroke list after the client saves annotation JSON.
