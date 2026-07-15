# Notes

Codmes Notes is the workspace surface for Markdown notes, PDF reading, PDF
annotation, attachments, and note-aware chat.

This README is user-facing. Implementation details live in the linked docs.

## What Users Can Do

### Notes And Attachments

- Open and edit Markdown or text notes.
- Store PDFs, images, and other files in the workspace.
- Attach images to PDFs as movable note objects.
- Insert PDF pages into an existing PDF note.
- Export a PDF with annotations flattened into the file.
- Export a PDF together with its editable Codmes state.

### PDF Reading And Writing

- Use read mode for normal PDF scrolling and zooming.
- Use write mode for pen, eraser, lasso, text, and image editing.
- On iPad, Apple Pencil writes while finger touch can scroll.
- On iPhone, one finger writes in write mode and two fingers scroll or zoom.
- On Mac, mouse or trackpad input can draw, erase, and move objects.

### Pen And Eraser

- Draw live ink with selectable pen color and width.
- Use the eraser with selectable width.
- Erase parts of normal handwriting strokes.
- Erase parts of auto-completed shapes. After a shape is partially erased, it
  becomes normal pen ink because the original shape handles no longer describe
  the edited stroke.

### Shape Auto-Completion

- Draw a line, bent line, rectangle, triangle, circle, or ellipse.
- Hold briefly without lifting to auto-complete the shape.
- Resize completed shapes with handles.
- Ellipses keep their ellipse geometry while being adjusted.
- Shape recognition is backed by geometric recognition plus replay-tested
  exemplar data.

### Lasso And Selection

- Draw a dashed lasso around handwriting, shapes, text boxes, or images.
- Tap with the lasso tool to select nearby handwriting, shapes, text, or images
  without drawing a full lasso.
- Move selected content.
- Resize completed shapes with handles.
- Delete a selection.
- Change selected ink color.
- Change selected text size.
- Tap empty space or start another interaction to hide selection handles.

### Text Boxes

- Tap the text tool, then tap a PDF page to create an inline text box at that
  position.
- Type directly on the page instead of entering text in a separate popup.
- Leave a new text box empty and tap away or dismiss the keyboard to discard it.
- Tap an existing text box with any writing tool to select it.
- Double-tap a text box to edit its content immediately.
- Drag a selected text box to move it without scrolling the PDF.
- Use the left and right resize handles to change text box width. Text wraps
  onto more lines when the box becomes narrower.
- Text resize handles are hidden while the text box is moving and return at the
  final position after the move ends.

### Undo And Redo

- Undo and redo annotation edits from the PDF toolbar.
- The current implementation keeps up to 80 undo snapshots in client memory.
- Undo history is not saved to the server. The server stores the current
  annotation result after edits, undo, or redo.

### Notes Chat

- Notes chat can read specific notes when a user asks about a known file.
- Notes chat can search indexed notes, PDFs, documents, code, and conversation
  context when a user asks a broader question.
- PDF source text, text boxes, and OCR from attached PDF images can become
  searchable.
- Handwritten ink is saved and rendered, but handwriting OCR over ink is not
  implemented yet.

## Documentation Map

- [Overview](overview.md): Notes surface boundaries and workspace structure.
- [Content Types And Attachments](content-types-and-attachments.md): Markdown,
  PDF, image, and attachment behavior.
- [PDF Annotations](pdf-annotations.md): editable PDF annotation model and
  platform behavior.
- [Annotation Sync And RAG](annotation-sync-and-rag.md): annotation APIs,
  `.codmes` storage, indexing, OCR, RAG, and Notes LLM tools.
- [Eraser And Shape Strokes](eraser-and-shape-strokes.md): partial eraser
  behavior for handwriting and auto-completed shapes.
- [Undo And Redo](undo-redo.md): client-side undo/redo history, stack limit,
  and server persistence boundary.
- [Text Boxes](textbox.md): inline text box editing, selection, moving,
  resizing, wrapping, gesture routing, and persistence.
- [PDF Ink Debug History](pdf-ink-debug-history.md): why ink was invisible
  before and how the current visible ink path works.
- [Shape Recognition Datasets](shape-recognition-datasets.md): public datasets,
  replay gates, exemplar bank, and recognition tuning.

## Main Code Pointers

- Apple PDF UI: `client/apple/Sources/Codmes/PDFWorkspaceView.swift`
- Shared Apple models: `client/apple/Sources/Codmes/Models.swift`
- Apple API client: `client/apple/Sources/Codmes/WorkspaceAPI.swift`
- Annotation API: `server/index.mjs`
- Annotation path and document ingest: `server/lib/document-ingest.mjs`
- Notes tool mode: `server/lib/runtime/tool-mode-registry.mjs`
- Workspace/RAG tools: `server/lib/runtime/workspace-tools.mjs`
