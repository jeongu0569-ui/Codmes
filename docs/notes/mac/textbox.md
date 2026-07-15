# macOS Text Boxes

This document explains the macOS text box implementation for Codmes Notes.
The shared object model is documented in `docs/notes/pdf-annotations.md`, and
the user-facing behavior is summarized in `docs/notes/README.md`.

## Scope

macOS uses the same editable `PDFAnnotationObject` model as iOS, but the live UI
is AppKit-based:

- `PDFKit` renders the PDF.
- `MacAnnotatedPDFKitView` bridges SwiftUI into AppKit.
- `CodmesMacPDFView` owns PDF-level input routing.
- `MacPDFPageAnnotationOverlay` renders per-page overlay objects.
- `MacPDFTextView` is an inline `NSTextView` for text boxes.

The goal is to match the iOS text box behavior while using AppKit-native views.

## Creation

When write mode is active and the text tool is selected, clicking a PDF page
creates a draft text object at that page position:

1. `CodmesMacPDFView.mouseDown` handles the click.
2. `makeTextObject` creates a `PDFAnnotationObject` through
   `CodmesNoteCanvasModel.makeTextObject`.
3. The object is saved through `onObjectChanged`.
4. The object is selected through `onObjectSelected`.
5. `onObjectEditRequested` increments the text edit request counter.
6. The overlay coordinator focuses the matching `MacPDFTextView`.

Draft text boxes use `metadata.draft=true`. Empty drafts are not deleted while
the user is still editing, because a user may clear text and type again.

## Empty Text Behavior

macOS follows the same rule as iOS:

- If a new text box is empty and editing ends, the object is discarded.
- If an existing text box is edited down to empty, it remains during editing.
- When editing ends while the text is still empty, the object is deleted.

Two paths enforce this:

- `Coordinator.textDidEndEditing` deletes an empty `MacPDFTextView` object when
  AppKit ends editing.
- `CodmesMacPDFView.discardEmptyTextObjectIfNeeded` consumes the first outside
  click for an empty selected text object, deletes it, and prevents the same
  click from creating a new text object.

For non-empty text, `consumeTextEditingBlurClickIfNeeded` consumes the first
outside blank click while the text tool is active. This makes the click behave
as "finish editing / clear selection" rather than immediately creating a new
box. The next click can create a new text box.

## Selection And Editing

Text boxes are normal selectable note objects:

- Clicking an existing text box selects it.
- Double-clicking a text box requests inline editing.
- The lasso options bar can request text editing.
- Clicking blank space clears selection and hides handles.

The selection state is still represented with `PDFLassoSelectionSummary` when a
text object is selected, so options such as delete, color, and font size share
the same path as other note objects.

## Resizing

macOS shows left and right resize handles for the selected text box. The visual
handles are AppKit subviews, but the reliable hit test happens in
`CodmesMacPDFView`:

1. `mouseDown` checks `textResizeHandleHit` before normal object movement.
2. If a handle is hit, `activeObjectInteraction` becomes `.resize(.left)` or
   `.resize(.right)`.
3. `mouseDragged` calls `updateActiveObjectDrag`.
4. `CodmesNoteCanvasModel.resizedObject` updates the normalized `bbox` width.
5. `textObjectWithMeasuredHeight` recomputes height from the wrapped text.
6. The changed object is saved through `onObjectChanged`.

This PDFView-level routing avoids the common AppKit conflict where `NSTextView`
or PDF scrolling receives the drag before the handle does.

## Moving

Dragging a selected text object moves the object rather than scrolling the PDF:

1. `mouseDown` stores the selected object, start box, and start point.
2. `mouseDragged` computes normalized page deltas.
3. `CodmesNoteCanvasModel.movedObject` updates the `bbox`.
4. `onObjectChanged` persists the new position.

Text resize handles are hidden or recreated by overlay refreshes, so stale
handle positions do not remain after move or resize.

## Shared Boundary

macOS does not store AppKit-specific text state. Live AppKit views are derived
from the shared object data:

- `text` stores content.
- `bbox` stores normalized page position and size.
- `metadata.fontSize` stores text size.
- `metadata.color` stores text color.
- `metadata.draft` marks new empty text boxes.
- `metadata.manualWidth` marks boxes whose width was manually resized.

This keeps the same `.codmes` annotation state readable by iOS and future
Windows or Android clients.
