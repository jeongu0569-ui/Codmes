# Codmes Search Integration

Codmes Search is a built-in server feature. The assistant sees one official
tool, `codmes_search`.

## Current Path

```text
User question
  -> Codmes Runtime
  -> codmes_search tool
  -> Codmes workspace search
  -> file/note/code/PDF extracted text/conversation results
```

The current implementation uses a native Codmes chunk index backed by JSON
state under `.codmes/index/search.json`, with workspace scan as the secondary
when no index exists yet. Search configuration is exposed through:

```text
GET  /api/search/config
POST /api/search/config
GET  /api/search/status
POST /api/search
```

Search settings are stored in:

```text
<Workspace>/.codmes/config/search.env
```

The important settings are:

- `FILE_ROOTS`: workspace-relative indexing roots, such as `Notes,Documents,Code`.
- `EMBEDDINGS_PROVIDER`: selected embedding provider, such as `ollama`, `openai`, or `lmstudio`.
- `OPENAI_BASE_URL`: OpenAI-compatible embedding endpoint.
- `OPENAI_EMBED_MODEL`: selected embedding model.
- `OPENAI_EMBED_DIM`: expected embedding dimension.
- `VLM_PROVIDER`: selected provider for PDF image OCR / scanned-page vision extraction.
- `VLM_MODEL`: selected VLM model.
- `VLM_BASE_URL`: optional OpenAI-compatible VLM endpoint.

Embedding settings are already persisted and copied into the index metadata.
The current index still ranks by filename/text chunk matching; actual vector
generation and vector similarity search are the next Search Runtime layer.
Apple clients expose these values in `Settings > Search` with model pickers
that reuse the configured Codmes runtime providers.

## Incremental Indexing

`codmes index rebuild` or `POST /api/index/rebuild` creates the full native
index. While `codmes serve` is running, Codmes starts file watchers for the
configured roots and debounces changes into partial updates:

```text
file create/update/delete
  -> configured root watcher
  -> changed workspace-relative path
  -> updateSearchIndex(...)
  -> rewrite only affected index items/chunks
```

This keeps normal note/code edits from requiring a full rebuild. If the
platform cannot provide recursive file watching for a root, Codmes logs the
watcher failure and users can still run a manual rebuild.

## Document Extraction

Codmes includes a server-side document ingestion worker inspired by the KNU AI
Assistant attachment pipeline. Node owns scheduling, caching, and indexing; the
Python worker extracts text from one file and returns normalized JSON.

```text
server/lib/document-ingest.mjs
server/workers/document-ingest/extract_document.py
```

Supported first-pass inputs:

- PDF Markdown/table extraction through PyMuPDF4LLM installed by `npm run runtime:bootstrap`
- PDF text layers and page block coordinates through PyMuPDF
- scanned PDF/image text is a separate VLM/OCR extractor layer driven by the Search VLM setting
- HWPX XML text
- DOCX/PPTX/XLSX/XLS through Python libraries installed by bootstrap where possible
- HWP/DOC/PPT/ODT/ODP through MarkItDown or explicit internal extractors where possible
- ZIP files containing supported document/image formats

Codmes Core intentionally does not require native OCR or office-conversion
binaries such as `tesseract`, `pdftoppm`, Java-based ODL, LibreOffice, or
`soffice`. Scanned PDF/image text extraction is limited to what MarkItDown's
default local/free converters can extract. Paid cloud OCR providers are not
part of the default Codmes dependency path.

This mirrors the KNU assistant's format-specific extractor idea without copying
its heaviest runtime dependencies:

```text
KNU:    ODL PDF markdown -> pdf2image + VLM -> LibreOffice/HWP conversion paths
Codmes: PyMuPDF4LLM markdown -> PyMuPDF coordinates -> MarkItDown/internal extractors
```

Extraction cache:

```text
<Workspace>/.codmes/index/documents/*.json
```

The worker returns blocks with:

```json
{
  "path": "Documents/example.pdf",
  "kind": "pdf",
  "source": "pdf-text",
  "page": 3,
  "text": "extracted text",
  "bbox": null
}
```

`page` and `bbox` are already part of the schema so the PDF viewer can open a
search result at the matching page and highlight text-layer blocks. The Apple
client now has the first server-owned PDF annotation layer in place: iOS/iPadOS
page ink is stored through `GET/PUT /api/file/annotations`, and text-layer PDF
search results can jump to the matching page. Selectable OCR overlays are
planned after Codmes owns a free/local OCR path that can return stable text
coordinates for scanned images.

## Direction

Codmes should own indexing, query, status, and future semantic search inside
the server. MCP remains available for unrelated external tools, but document
search is not modeled as a required MCP dependency.

Planned Search Runtime layers:

- indexing roots
- include/exclude globs
- file watcher
- extracted PDF text cache
- chunk schema
- embedding provider abstraction
- optional local SQLite/FTS store
- optional local vector store
- query API
- runtime context injection

## Client UX

Apple clients configure Search from `Settings > Search`, not from the MCP
settings page. The MCP settings page is only for optional external tools.

## LLM Tool

The runtime exposes:

```text
codmes_search
```

Use it for broad note, document, PDF, code, and conversation searches.
