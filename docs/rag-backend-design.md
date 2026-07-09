# RAG Backend Design

AI Workspace treats RAG as a server-owned capability. Clients should not upload large folders or PDFs into a chat prompt. They should send the user's scope and intent, then the server decides whether to inline small context or query an index.

## Goals

- Keep Notes, Documents, PDFs, and Code searchable from one workspace root.
- Support a local scan fallback now and semantic vector search later.
- Let runtime prompts receive compact search/chunk context instead of raw folder dumps.
- Keep docsearch MCP as an official external backend option while AI Workspace grows native indexing.

## Chunk Schema

Implemented skeleton: `server/lib/rag/vector-provider.mjs`.

```json
{
  "schemaVersion": 1,
  "id": "chunk-...",
  "path": "Documents/manual.pdf",
  "kind": "pdf",
  "text": "Extracted text chunk",
  "start": 0,
  "end": 1200,
  "page": 3,
  "metadata": {},
  "createdAt": "2026-07-09T00:00:00.000Z"
}
```

## Provider Interfaces

- `EmbeddingProvider.embedTexts(texts)`
- `VectorIndexProvider.upsertChunks(chunks)`
- `VectorIndexProvider.deleteByPath(path)`
- `VectorIndexProvider.query(request)`

The current implementation is an interface skeleton. Concrete providers can be backed by sqlite-vec, LanceDB, Qdrant, Chroma, or docsearch-compatible local stores.

## Runtime Context Injection

The OpenAI-compatible runtime accepts structured context fields:

- `context.workspaceContext.searchResults`
- `context.workspaceContext.ragChunks`

These are rendered into the system/context message as compact “Search results context” and “RAG chunk context” sections. This keeps chat history cleaner than pasting entire folder contents.

## Query Flow

1. Client sends a user request and workspace scope.
2. Context router marks broad scopes with `ragRecommended`.
3. Runtime/model can call `workspace_search` or a configured MCP/docsearch tool.
4. Search results or chunks are attached to `workspaceContext.searchResults` / `ragChunks`.
5. Model answers using only the compact retrieved context.

## PDF Text

First pass implemented:

- PDF metadata appears under `GET /api/file/metadata`.
- Text-layer extraction utility caches text under `.ai-workspace/index/pdf-text/`.
- Workspace scan search can search extracted PDF text.

Planned:

- More robust PDF parsing for compressed streams.
- OCR for scanned PDFs.
- Per-page chunking and page-level citation metadata.

