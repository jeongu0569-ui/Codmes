# Undo And Redo

This document explains the current Notes undo/redo behavior and its storage
boundary.

## User Behavior

The PDF toolbar exposes:

- Undo: `arrow.uturn.backward`
- Redo: `arrow.uturn.forward`

Users can undo or redo annotation edits such as:

- Pen strokes.
- Eraser changes.
- Shape creation and shape adjustment.
- Lasso move/delete/color changes.
- Text/image object edits.
- PDF annotation state changes that flow through `commitAnnotationDocument(...)`.

## Stack Size

The current limit is 80 undo snapshots.

When a new undo snapshot would exceed 80 entries, the oldest snapshot is
removed:

```swift
if undoStack.count > 80 {
    undoStack.removeFirst(undoStack.count - 80)
}
```

This is a balance between user convenience and memory use. The current
implementation stores full `PDFAnnotationDocument` snapshots, not tiny command
diffs.

## Where The History Lives

Undo/redo history is client memory only:

- `undoStack` is SwiftUI `@State`.
- `redoStack` is SwiftUI `@State`.
- The stacks are reset when annotations are loaded for a file.
- The stacks disappear when the PDF view/app is closed.

The server does not store undo or redo history.

The server only stores the resulting current annotation document after an edit,
undo, or redo.

## Commit Flow

All normal annotation edits call:

```swift
commitAnnotationDocument(_ document: PDFAnnotationDocument, registerUndo: Bool = true)
```

The method:

1. Syncs legacy fields into the element model with `syncNoteElementsFromLegacy()`.
2. Compares the current document and next document by JSON encoding.
3. Pushes the current document into `undoStack` when there is a real change.
4. Trims `undoStack` to 80 entries.
5. Clears `redoStack`.
6. Updates local `annotations`.
7. Schedules a save to the server.

Undo calls:

```swift
undoAnnotationChange()
```

It:

1. Pops the previous document from `undoStack`.
2. Pushes the current document into `redoStack`.
3. Clears current selection state.
4. Commits the previous document with `registerUndo: false`.
5. Saves the restored current result to the server through the normal save path.

Redo calls:

```swift
redoAnnotationChange()
```

It:

1. Pops the next document from `redoStack`.
2. Pushes the current document into `undoStack`.
3. Clears current selection state.
4. Commits the next document with `registerUndo: false`.
5. Saves the restored current result to the server through the normal save path.

## Why It Is Client-Side

This design keeps the server simple:

- The server remains the source of truth for the current `.codmes` annotation
  JSON.
- The client can offer fast local undo/redo while the PDF view is open.
- Search/RAG only needs the latest saved annotation state.

The tradeoff is that undo history is not available after closing/reopening the
PDF.

## Future Upgrade

For heavier documents, full-document snapshots can use more memory than ideal.
A production upgrade would replace snapshots with command-level history:

- Add stroke.
- Remove stroke.
- Split stroke.
- Move lasso selection.
- Resize shape.
- Recolor selection.
- Edit text object.

That would reduce memory use and make server-persisted history easier later.
