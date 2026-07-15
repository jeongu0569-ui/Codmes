# Text Boxes

This document explains the Apple PDF text box implementation for Codmes Notes.
The user-facing summary lives in `docs/notes/README.md`.

## Goal

Text boxes should feel like native note objects on top of a PDF:

- Create text directly on the page.
- Edit existing text without opening a separate popup.
- Select text boxes with normal object selection behavior.
- Move text boxes without accidentally scrolling the PDF.
- Resize text box width with side handles.
- Wrap text vertically when the width becomes narrower.
- Keep the editable Codmes annotation state separate from PDF export.

## Data Model

Text boxes are stored as `PDFAnnotationObject` values in the editable Codmes
annotation document.

Important fields:

- `id`: stable object id used by the overlay view and selection state.
- `type`: text objects are detected with `type.lowercased().contains("text")`.
- `text`: editable text content.
- `bbox`: normalized PDF-page bounding box.
- `pageIndex`: zero-based page index.
- `metadata`: stores text options and editing flags.

Current metadata keys used by text boxes:

- `fontSize`: rendered text size.
- `color`: text color.
- `draft`: marks a newly-created empty text object.
- `manualWidth`: marks a box whose width was manually resized.

The current annotation state is synced through the normal annotation save path.
PDF export can later flatten the object into PDF content or convert it to PDF
annotations, but live editing is driven by the Codmes object model.

## Rendering

Apple PDF rendering is handled in
`client/apple/Sources/Codmes/PDFWorkspaceView.swift`.

`PDFKit` displays the source PDF. For each visible page, `PDFKit` asks the
coordinator for a page overlay view. Codmes uses `PDFPageAnnotationOverlay` as
that overlay.

Each text object is rendered as a `UITextView` inside the page overlay:

- The `UITextView` frame comes from the object's normalized `bbox`.
- Text content comes from `object.text`.
- Font size and color come from `object.metadata`.
- The background is clear so the PDF remains visible.
- The normal border is hidden after editing.
- Selection uses a subtle gray border so the text range remains visible.

The text view's own pan gesture is disabled. Movement and width resizing are
handled by PDF-level gestures instead, because `UITextView`, `PDFView`, and the
underlying scroll view otherwise compete for the same touch stream.

## Creation

When the text tool is active and the user taps the page, Codmes creates an
inline text object at that page position.

The new object starts as an editable draft:

- It receives focus immediately.
- The cursor blinks in place.
- The border is visible while editing.
- If the user leaves it empty and taps away or dismisses the keyboard, the draft
  is discarded.

Empty drafts are not deleted on every keystroke. This matters because deleting
the object as soon as the text reaches zero characters makes it impossible for a
user to clear the text and type new content.

## Selection And Editing

Text objects can be selected by tapping them, independent of the currently
active writing tool. This makes text boxes behave like note objects rather than
tool-specific controls.

Selection behavior:

- Single tap selects the object and shows the options bar.
- Double tap immediately enters content editing.
- The edit option in the selection bar also enters content editing.
- Tapping empty space clears the selection and hides borders or handles.

The lasso selection model is reused for text object selection. A selected text
box is represented as a lasso selection with one `objectId` and no stroke ids.
This keeps the options bar, delete action, text size action, and move behavior
consistent with other selectable note objects.

## Moving

Moving text boxes is handled by a PDF-level `objectMovePanGesture`.

Why PDF-level:

- `UITextView` wants to handle pan gestures for selection or scrolling.
- `PDFView` wants to handle pan gestures for page scrolling.
- A selected text box should move as an object, not edit text or scroll the PDF.

Move flow:

1. The gesture starts on a selected object.
2. PDF scrolling is locked for the duration of the move.
3. Text editing is ended and the text view becomes non-editable.
4. The text view frame moves live with the gesture.
5. The object's normalized `bbox` is updated when the gesture ends.
6. The updated object is saved through `onObjectChanged`.
7. PDF scrolling is restored.

Text resize handles are hidden while the object is moving. They are recreated
after the move ends, using the final text view frame. This avoids delayed handle
movement and stale handle positions during drag.

## Resizing

Text width resizing uses two side handles rendered by `PDFTextResizeHandleView`.

The handles are small visual grips with a larger transparent hit area. They are
shown only when a text object is selected and the object is not currently being
moved.

Actual resizing is handled by a PDF-level `textResizePanGesture`, not by a pan
gesture attached to the handle view itself. This is intentional:

- The handle view can be recreated during overlay updates.
- The text view can otherwise win the touch stream.
- The PDF scroll view can otherwise interpret the drag as scrolling.
- A PDF-level recognizer can route the gesture before object move or drawing
  gestures start.

Resize flow:

1. The gesture starts only if the touch begins on a text resize handle.
2. Codmes stores the active object id, page index, and handle edge.
3. PDF scrolling is locked.
4. The left or right edge adjusts the text view frame.
5. `manualWidth=true` is written into metadata.
6. `resizeTextObjectIfNeeded` recomputes height with `UITextView.sizeThatFits`.
7. The object's `bbox` is updated from the final frame.
8. The object is saved through `onObjectChanged`.
9. PDF scrolling is restored and overlays are refreshed.

When `manualWidth` is true, the stored width is preserved and the text wraps
within that width. When it is false, the box can auto-size from the text content.

## Gesture Routing

The coordinator's gesture delegate routes touch streams in this priority order:

1. Shape handles.
2. Text resize handles.
3. Selected object movement.
4. Object double tap for editing.
5. Selection clear or object tap.
6. Drawing, erasing, or lasso gestures.

Text resize handle touches are excluded from object movement, drawing, and
selection clearing. This prevents a handle drag from being interpreted as a text
box move or a PDF scroll.

## Known Boundaries

- Text style options currently include text size and color through the selection
  options. Background, border style, and richer typography are planned but not
  part of this implementation yet.
- Width resize is horizontal only. Height follows text wrapping and content
  measurement.
- Text boxes are editable Codmes objects during authoring. PDF-native text
  annotation conversion is an export concern, not the live editing model.
