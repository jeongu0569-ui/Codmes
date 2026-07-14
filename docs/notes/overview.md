# Notes And PDF Overview

Codmes treats notes, PDFs, and Notes attachments as workspace resources owned by
the server. Clients display and edit them, while the server owns file access and
annotation state.

Search and RAG are not Notes-only features. This document only records the
Notes surface boundary; the common search runtime is documented separately under
`docs/search`.

## Workspace Structure

Default workspace root:

```text
Codmes/
├── Notes/
├── Attachments/
└── .codmes/
```

The user sees an Obsidian/VS Code-style tree. Internally, the server tracks
metadata, index state, sessions, tasks, approvals, and tool logs.

## Notes Surface Responsibilities

The Notes surface is responsible for:

- Listing and opening files under Notes-oriented workspace roots.
- Reading and editing Markdown/text notes.
- Opening PDFs through raw file serving and PDFKit on Apple clients.
- Loading and saving PDF annotation state through the annotation API.
- Letting the Notes chat read specific notes or call workspace search when the
  user asks a broad question.

The Notes surface is not responsible for owning the global search index,
embedding store, or OCR pipeline.

## Current File APIs

Implemented APIs used by Notes:

```text
GET  /api/tree?root=notes&path=...
GET  /api/file?path=Notes/example.md
PUT  /api/file?path=Notes/example.md
GET  /api/raw?path=Notes/mypage.pdf
GET  /api/file/metadata?path=Notes/mypage.pdf
GET  /api/file/annotations?path=Notes/mypage.pdf
PUT  /api/file/annotations?path=Notes/mypage.pdf
```

Search APIs are documented under `docs/search`.

## PDF Strategy

Codmes uses a GoodNotes-style structure with a portable annotation state file:

1. Serve PDFs as raw files for client preview.
2. Store file metadata in `.codmes/index/files.json`.
3. Store server-owned annotation layers in a hidden state folder inside the
   document folder, such as `Notes/.codmes/annotations/mypage.codmes.json`.
4. Render live iOS/iPadOS drawing through PDFKit ink input.
5. Save editable strokes and objects as portable Codmes annotation JSON.
6. Ask the server to refresh derived state after annotation saves or PDF merges.

Current annotation state:

```text
Notes/mypage.pdf
Notes/.codmes/annotations/mypage.codmes.json
```

PDF annotations should not be stored only inside a client-local app cache. They
should be workspace-owned so iPhone, iPad, Mac, and future clients can see the
same annotation state.

The current Apple implementation saves portable `inkStrokes` per PDF page and
stores text/image annotation objects with page-relative bbox metadata. It can
read older `inkDataBase64` state, but new clients should use `inkStrokes`.

For details, see [PDF Annotations](pdf-annotations.md) and
[PDF Ink Debug History](pdf-ink-debug-history.md).

## Notes Surface LLM Tools

The default Notes surface tool mode is defined in
`server/lib/runtime/tool-mode-registry.mjs`. It exposes read/search tools, not
code mutation tools:

- `codmes_search`: workspace-wide indexed search across notes, documents, PDFs,
  code, and conversation text.
- `workspace_search`: simple workspace text search path.
- `read_note_file`: read a specific note, Markdown file, document text, or small
  workspace file.
- `read_file_metadata`: read kind, size, hash, and document ingest metadata.
- `conversation_search`, `conversation_read`, `memory_search`: recall previous
  chat/session/memory context.
- `tool_discovery`: temporarily expand safe tools when the current turn needs a
  focused capability.

By default, Notes surface conversations do not expose Code surface mutation
tools such as `apply_patch`, `run_checks`, or `run_git_command`.

## Notes Chat Context Boundary

This section exists only to describe the Notes surface boundary. The actual
Search/RAG design lives under `docs/search`.

Notes does not push whole folders or large PDFs into chat prompts. For a known
small note, the model can use `read_note_file`. For broad questions, it can call
workspace-wide `codmes_search`.

PDF source text, text annotation objects, and image annotation OCR blocks can
enter search/RAG. Handwritten pen `inkStrokes` are stored and rendered, but
handwriting OCR over ink is not implemented yet.
