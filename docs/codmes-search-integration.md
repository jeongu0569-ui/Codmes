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
state under `.codmes/index/search.json`, with workspace scan as the fallback
when no index exists yet. PDF files with a text layer are extracted into the
server PDF text cache before indexing. Search configuration is exposed through:

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

Embedding settings are already persisted and copied into the index metadata.
The current index still ranks by filename/text chunk matching; actual vector
generation and vector similarity search are the next Search Runtime layer.

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
