# Notes Surface Documentation

This folder is the source of truth for the Codmes Notes surface: note files,
PDF annotation, attachments, search, and RAG behavior.

## Start Here

- [Overview](overview.md): workspace structure, Notes surface responsibilities,
  and current implementation status.
- [File Types And Attachments](file-types-and-attachments.md): how PDF, Markdown,
  Office, image, ZIP, and attachment files are classified and indexed.
- [PDF Annotations](pdf-annotations.md): `.codmes` annotation storage, ink,
  text/image objects, read/write modes, and platform behavior.
- [PDF Ink Debug History](pdf-ink-debug-history.md): why the pen did not appear,
  what was tried, and how the current visible ink path fixed it.
- [Codmes Search Integration](codmes-search-integration.md): built-in search API,
  extraction worker, OCR/VLM settings, and annotation OCR.
- [Codmes Search Explained](codmes-search-explained.md): beginner-friendly search
  and VLM walkthrough.
- [RAG Backend Design](rag-backend-design.md): server-side context routing and
  current RAG limitations.

## Current Code Pointers

- Apple PDF UI: `client/apple/Sources/Codmes/PDFWorkspaceView.swift`
- Shared Apple models: `client/apple/Sources/Codmes/Models.swift`
- Annotation API: `server/index.mjs`
- Annotation path and document ingest: `server/lib/document-ingest.mjs`
- Search runtime: `server/lib/search-service.mjs`
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

RAG uses the built-in Codmes Search index. Text-layer PDFs, Markdown, text,
Office/HWP/Excel/PPT files, images, and ZIP contents enter the document ingest
pipeline where supported. Scanned PDF/image OCR is available through the
configured VLM path. Handwritten ink OCR is not implemented yet; current
annotation indexing covers text objects and image annotations, not handwriting
recognition over pen strokes.
