# Notes Surface Documentation

This folder is the source of truth for the Codmes Notes surface: note files,
PDF viewing/annotation, attachments shown from Notes, and the Notes chat tool
mode.

## Start Here

- [Overview](overview.md): workspace structure, Notes surface responsibilities,
  and current implementation status.
- [Content Types And Attachments](content-types-and-attachments.md): how
  Markdown, PDF, images, and attached files appear inside the Notes surface.
- [PDF Annotations](pdf-annotations.md): `.codmes` annotation storage, ink,
  text/image objects, read/write modes, and platform behavior.
- [PDF Ink Debug History](pdf-ink-debug-history.md): why the pen did not appear,
  what was tried, and how the current visible ink path fixed it.

## Current Code Pointers

- Apple PDF UI: `client/apple/Sources/Codmes/PDFWorkspaceView.swift`
- Shared Apple models: `client/apple/Sources/Codmes/Models.swift`
- Annotation API: `server/index.mjs`
- Annotation path and document ingest: `server/lib/document-ingest.mjs`
- Notes surface tool mode: `server/lib/runtime/tool-mode-registry.mjs`
- LLM workspace tools: `server/lib/runtime/workspace-tools.mjs`

## Current Behavior Snapshot

Notes surface conversations expose read/search tools to the LLM, not code-edit
tools by default. The default Notes tool mode includes `codmes_search`,
`workspace_search`, `read_note_file`, `read_file_metadata`,
`conversation_search`, `conversation_read`, `memory_search`, and
`tool_discovery`.

PDF ink is not stored only in the PDF file and not only in an Apple local cache.
The editable state is stored as workspace-owned JSON next to the document:

```text
Notes/mypage.pdf
Notes/.codmes/annotations/mypage.codmes.json
```

The Apple client renders live drawing immediately, commits strokes as PDFKit
`.ink` annotations for visibility, and saves portable `inkStrokes` back through
`PUT /api/file/annotations`. The server refreshes the search index for the PDF
after annotation saves.

Notes chat can call workspace-wide search tools when a user asks about broader
context. In Notes-specific terms: PDF source text, text boxes, and image
annotation OCR can become searchable context; handwritten pen `inkStrokes` are
stored and rendered, but handwriting OCR over ink is not implemented yet. The
common search runtime is documented separately under `docs/search`.
