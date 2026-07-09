# docsearch MCP Integration Guide

AI Workspace currently has a dependency-free search fallback named `workspace-scan`. For semantic search, docsearch MCP should be treated as a server-side search capability, not an Apple-client feature.

## Recommended Role

```text
AI Workspace Server
  -> workspace/context router
  -> runtime tool registry
  -> docsearch MCP server
  -> search results/chunks
  -> runtime context injection
```

The client sends scope and user intent. The server/runtime decides when to search.

## Configure MCP

Use the server MCP management API or the matching CLI wrapper when available.

```bash
aiw mcp add docsearch --command docsearch-mcp --args "serve"
aiw mcp enable docsearch
aiw doctor
```

Equivalent HTTP shape:

```http
POST /api/mcp
{
  "name": "docsearch",
  "command": "docsearch-mcp",
  "args": ["serve"],
  "enabled": true
}
```

## Runtime Behavior

When a folder, workspace, PDF, or broad notes request is detected, the context router can mark:

```json
{
  "ragRecommended": true,
  "ragSearchProvider": "docsearch-mcp",
  "ragSearchScopePath": "Notes"
}
```

The model can then call the search tool instead of receiving a huge prompt.

## Native RAG Path

The native path starts with:

- chunk schema in `server/lib/rag/vector-provider.mjs`
- PDF text cache in `.ai-workspace/index/pdf-text/`
- runtime injection fields: `searchResults` and `ragChunks`

docsearch MCP remains useful while native vector storage is being implemented.

