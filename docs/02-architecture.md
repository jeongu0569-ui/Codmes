# Architecture

## High-Level Shape

```text
iOS / macOS Client
        │
        ▼
Workspace Server
        │
        ├── Filesystem workspace root
        ├── Metadata DB
        ├── Search/index state
        ├── Workspace Agent Engine
        ├── Hermes API proxy
        ├── Workspace context router
        └── Search API
        │
        ▼
Agent Adapters
        ├── Hermes adapter
        │   ├── Sessions
        │   ├── Models
        │   ├── Tools
        │   ├── Approvals
        │   └── MCP/docsearch
        └── Future local/Codex-style code runtime
```

The client should not talk directly to random filesystem paths. It talks to the
Workspace Server using workspace-relative paths.

## Why App → Workspace Server → Agent Engine

The Obsidian plugin connected directly to Hermes because the Vault already lived
inside Obsidian. The new app should put the Workspace Server in the middle.

Benefits:

- One place to enforce path safety.
- One place to map file IDs, relative paths, and metadata.
- One place to issue Hermes login and WebSocket tickets.
- One place to control mobile caching.
- One place to translate `@folder`, `@pdf`, and `@workspace` into RAG/search
  scope metadata.
- One place to own task logs, decisions, diffs, and memory even if the live
  model/tool backend changes later.

## Filesystem As Source Of Truth

Files remain visible as normal folders and files:

```text
HermesWorkspace/Notes/Work/meeting.md
HermesWorkspace/Documents/os-book.pdf
HermesWorkspace/Code/my-app/package.json
HermesWorkspace/.ai-workspace/tasks/task-....json
```

The metadata DB should not replace files. It augments them:

- stable file ID
- relative path
- type
- tags
- backlinks
- checksum
- indexed status
- thumbnail/cache paths
- Hermes session associations

## Path Rule

Clients only send relative paths:

```text
Notes/Work/meeting.md
Code/project-a/src/main.ts
Documents/os-book.pdf
```

The server rejects:

```text
/Users/user/Desktop/secret.txt
../../etc/passwd
C:/Users/user/secret.txt
```

This is the most important early invariant.

## Hermes Integration

The existing Hermes Connection plugin proved these useful flows:

```text
POST /api/auth/ws-ticket
WS   /api/ws
RPC  session.create
RPC  session.resume
RPC  prompt.submit
RPC  approval.respond
```

The Workspace Server exposes a client-friendly live endpoint that bridges those
Hermes events:

```text
message.delta
thinking.delta
reasoning.delta
tool.start
tool.progress
tool.complete
approval.request
message.complete
```

The first live bridge keeps Hermes dashboard cookies and WebSocket tickets on
the server side.

In the current server, `/api/live` no longer talks to `HermesLiveClient`
directly. It talks to a `WorkspaceAgentEngine`, which currently uses the
`HermesAgentAdapter` implementation. The client-facing event envelope still
uses `kind: "hermes.event"` for compatibility, but each event also passes
through the workspace-owned agent state layer first.

This is the first step toward the intended 1.5 architecture:

```text
Client
  -> Workspace Server
  -> WorkspaceAgentEngine
     -> HermesAgentAdapter today
     -> CodeAgentRuntime inspect loop today
     -> Codex-style patch/test runtime later
```

## Notes Context Router

Small context can be sent inline:

- selected text
- current markdown note
- one short note

Large context should be passed as search scope metadata:

- PDF
- folder
- tag
- linked resources
- whole workspace

Example metadata:

```json
{
  "workspace": {
    "scopeType": "folder",
    "scopePath": "Notes/Operating Systems",
    "ragRecommended": true,
    "ragSearchProvider": "docsearch-mcp"
  }
}
```

Hermes/docsearch should perform the actual search.

Implemented server API:

```text
POST /api/context
POST /api/search
GET  /api/search/status
```

The same context request shape can be sent inside live `prompt.submit` as
`contextRequest`, so clients do not need to duplicate folder/PDF/RAG routing
logic.

The first search implementation is `workspace-scan`, a dependency-free text scan
fallback. It is intentionally simple. The API boundary exists so `docsearch-mcp`
or a vector index can replace the internals without changing the client.

## Code Area

Code projects live under `Code/`, but should have stricter permission handling
than Notes.

Future modes:

```text
Safe: Hermes dangerous-command approval prompts stay on.
Full: Hermes yolo/full mode may bypass dangerous-command prompts.
```

The client should show diffs and approvals before users trust automated code
changes.

The code agent loop lives behind the same `WorkspaceAgentEngine` interface
instead of being bolted directly to the client. `CodeAgentRuntime` scans a
`Code/` project, searches relevant files, detects package/test commands,
records git status and diff output, and writes a task plan. It also supports
the first approved edit loop: proposed patches are stored as diff artifacts
without modifying files, and only an approved proposal can be applied. Approved
check commands can then run inside the code task scope.

A coding task is recorded under `.ai-workspace/tasks`, tool activity under
`.ai-workspace/tool-logs`, decisions under `.ai-workspace/decisions`, and
produced or captured diffs under `.ai-workspace/diffs`.

Future automatic code generation should extend this runtime rather than adding
a parallel code path.
