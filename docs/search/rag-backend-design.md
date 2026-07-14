# Codmes Search And RAG Design

Codmes treats broad document search as a server-owned runtime feature, not as a
client-side prompt attachment trick. Clients should not upload large folders or
PDFs into a chat prompt. They should send the user's scope and intent, then the
server decides whether to inline small context, search the native Codmes index,
or use workspace scan before answering.

## Goals

- Keep Notes, Documents, PDFs, and Code searchable from one workspace root.
- Support a native chunk index with local text/PDF workspace scan.
- Let runtime prompts receive compact search context instead of raw folder dumps.
- Keep embedding provider/model and PDF image OCR VLM provider/model selection server-owned and configurable.
- Avoid duplicating OCR and indexing logic inside Apple clients.

## Scope Decisions

- PDF Markdown/table extraction uses PyMuPDF4LLM from the Codmes bootstrap
  environment. PDF page/block coordinates still use PyMuPDF.
- Scanned PDF/image text extraction uses a page-rendering VLM/OCR extractor
  layer. The chosen VLM provider/model is stored in Search settings. Codmes
  renders text-poor PDF pages to images and sends each page to the VLM with
  temperature `0` and thinking/reasoning disabled where supported. Codmes should
  not require tesseract, pdftoppm, Java-based ODL, LibreOffice, soffice, or paid
  cloud OCR providers for the default search path.
- No built-in embedding model runner.
- Native vector storage is planned but not complete.
- Text-layer PDFs, Office/HWP/Excel/PPT extraction output, Markdown, code, and text documents are searchable through the built-in chunk index.
- External tools may still exist for unrelated capabilities, but document search is no longer a required MCP dependency.

## Runtime Context Injection

The OpenAI-compatible runtime accepts structured context fields:

- `context.workspaceContext.searchResults`

These are rendered into the system/context message as compact “Search results context” sections. This keeps chat history cleaner than pasting entire folder contents.

## Query Flow

1. Client sends a user request and workspace scope.
2. Context router marks broad scopes with `ragRecommended`.
3. Runtime/model can call `workspace_search` or `codmes_search`.
4. Search results are attached to `workspaceContext.searchResults`.
5. Model answers using only the compact retrieved context.

## PDF Text

First pass implemented:

- PDF metadata appears under `GET /api/file/metadata`.
- Text-layer PDF and Office extraction utility caches text under `.codmes/index/documents/`.
- Codmes Search can index and search extracted PDF, image, Office, HWP, spreadsheet, and ZIP text.

Planned:

- More robust PDF parsing for compressed streams.
- VLM-assisted extraction for scanned PDF pages and image files, modeled after
  the KNU assistant, using the provider/model selected in Settings > Search:
  first-pass page/image OCR blocks are implemented; stable bbox overlays remain
  planned.
- PDF viewer page navigation and search result highlight.
- Selectable transparent text overlay in the Apple PDF viewer after stable OCR
  bbox extraction is implemented.
- Better UI for search/index status, watched roots, embedding model selection,
  and VLM OCR model selection.
