# PDF Ink Debug History

This records the Notes PDF pen bug because it was easy to regress: the UI looked
like it accepted pen input, but no visible ink appeared on the PDF.

## Original Symptom

- Pen and eraser options opened correctly on the second tap.
- Touch or Pencil gestures did not produce visible ink.
- Because no live stroke was visible, follow-up behavior such as erasing could
  not be verified reliably by the user.

## Why The Pen Was Invisible

The first approach leaned on `PDFPageOverlayViewProvider` and `PKCanvasView`.
That made sense because PencilKit gives Apple Pencil tools, eraser, and lasso
behavior, but it was unreliable inside the active `PDFView` hierarchy. Touches
were often captured by PDFKit scrolling/zoom recognizers before the page canvas
could draw. Toggling markup mode and changing overlay interaction flags did not
produce a dependable visible stroke path.

The practical issue was not only persistence. The drawing input path itself was
not trustworthy, so saving more data could not fix the user-visible bug.

## Current Fix

The current Apple implementation uses a direct PDFKit ink path:

1. A `UIPanGestureRecognizer` attached to the `PDFView` receives drawing input.
2. `PDFDrawingOverlayView` renders the in-progress stroke immediately while the
   finger or Pencil moves.
3. Finished view points are converted to normalized PDF page coordinates.
4. The stroke is added to the current `PDFPage` as a PDFKit `.ink` annotation so
   it is visible immediately.
5. The same stroke is saved as portable `CodmesInkStroke` data through
   `PUT /api/file/annotations`.

The important code paths are in
`client/apple/Sources/Codmes/PDFWorkspaceView.swift`:

- `handleDrawingPan(_:)`
- `PDFDrawingOverlayView`
- `makeStroke(from:page:)`
- `addInkPreview(_:to:contentsPrefix:)`
- `eraseStroke(at:page:)`
- `splitStroke(_:erasingAt:radius:)`
- `applyPDFScrollTouchPolicy()`
- `lockPDFScrollingForActiveDrawing()`

## Eraser Fix

The eraser no longer deletes the whole stroke whenever it hits one point. It
splits an existing stroke around the eraser radius and keeps the remaining
segments as new `CodmesInkStroke` values. This gives a partial eraser behavior
instead of object-level stroke deletion.

## Gesture Fixes

Read mode:

- PDFKit handles normal scroll and zoom.
- Pencil and finger are not reserved for drawing.

iPad write mode:

- Apple Pencil draws or erases when pen/eraser is selected.
- Finger pan remains available for scrolling.
- During an active Pencil stroke, PDF scrolling is locked so vertical writing
  does not become page scrolling.

iPhone write mode:

- One-finger touch draws or erases because there is no Apple Pencil-first input
  assumption.
- PDF pan requires two fingers.
- Pinch zoom remains a two-finger gesture.
- During an active touch stroke, PDF scrolling is locked so vertical writing
  does not become page scrolling.

macOS:

- Mouse/trackpad pen input writes portable `inkStrokes`.
- Delete removes selected text/image annotation objects.

## What Is Still Not Solved

- Handwriting OCR over pen strokes is not implemented.
- Lasso-style handwritten stroke selection is not a supported primary workflow
  in the current PDFKit ink path.
- Cross-platform Windows/Android render/edit adapters still need to consume the
  same `inkStrokes` model.

## Regression Checklist

When this area changes, verify:

- A pen stroke appears while moving, not only after lifting the input.
- The saved stroke reappears after closing and reopening the PDF.
- Eraser removes only the crossed part of a stroke.
- Read mode scrolls with normal touch/Pencil behavior.
- iPad write mode draws with Pencil and scrolls with finger.
- iPhone write mode draws with one finger and scrolls/zooms with two fingers.
- Vertical pen movement does not scroll the PDF while actively drawing.
