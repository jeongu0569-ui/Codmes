# Architecture

## High-Level Shape

Current shape (`aiw serve` standalone, Hermes fallback optional):

```text
iOS / macOS Client
        │
        ▼
aiw serve (Workspace Server)
        │
        ├── Filesystem workspace root
        ├── .ai-workspace/ state store
        │   ├── tasks/, approvals/, decisions/
        │   ├── diffs/, tool-logs/, memory/
        │   └── sessions/<id>.json
        └── WorkspaceAgentEngine
            ├── ProviderRuntime   – provider list/add/remove
            ├── AuthRuntime       – credential list/add/remove
            ├── ModelRuntime      – model list, default selection
            ├── SessionRuntime    – local sessions + hermes-compat merge
            ├── ChatRuntime       – backend selection (WorkspaceChatBackend first)
            │     ├── WorkspaceChatBackend  (default: direct OpenAI-compatible)
            │     └── HermesCompatChatBackend (fallback if HERMES_SERVER_URL set)
            ├── LLMRuntime        – structured LLM calls (patch generation)
            └── CodeAgentRuntime  – task/patch/approval/git loop
```

Final target shape (reached, pending docsearch RAG integration):

```text
iOS / macOS Client
        │
        ▼
aiw serve
        │
        ├── Workspace Server
        ├── Unified Engine
        │   ├── Chat/session runtime
        │   ├── Model/provider/auth registry
        │   ├── Tool/MCP router
        │   ├── Notes/PDF context runtime
        │   └── CodeAgentRuntime
        ├── Filesystem workspace root
        ├── Search/index state
        ├── Task memory/log/diff store
        └── Approval/safety gate
```

`HERMES_SERVER_URL` is **optional**. When omitted the server runs in
standalone mode and `WorkspaceChatBackend` handles all chat using provider /
credential settings stored in `.ai-workspace/config.json`.

## Why App → Workspace Server → Agent Engine

The Obsidian plugin connected directly to Hermes because the Vault already lived
inside Obsidian. The new app puts the Workspace Server in the middle.

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
HermesWorkspace/.ai-workspace/sessions/<sessionId>.json
HermesWorkspace/.ai-workspace/config.json
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
- session associations

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

## hermes-compat Layer

`server/lib/hermes-compat.mjs` is a **legacy compatibility shim only**.
It connects to an external Hermes Server via WebSocket when
`HERMES_SERVER_URL` is defined. It is not used for standalone operation.

- `HermesCompatChatBackend` wraps `HermesLiveClient` with the `ChatBackend` interface.
- `WorkspaceChatBackend` is the primary backend used when no Hermes URL is set.
- `ChatRuntime` selects `WorkspaceChatBackend` by default; falls back to
  `HermesCompatChatBackend` only when `HERMES_SERVER_URL` is configured.

New workspace features must never be added to `hermes-compat.mjs`.

## Chat / Provider / Auth ownership

Provider and credential settings are stored in `.ai-workspace/config.json`:

```json
{
  "providers": [
    {
      "id": "openai",
      "type": "openai-compatible",
      "baseUrl": "https://api.openai.com/v1",
      "defaultModel": "gpt-4o"
    }
  ],
  "defaultProvider": "openai",
  "defaultModel": "gpt-4o"
}
```

API keys are stored separately in `.ai-workspace/credentials.json` and are
masked in API responses. `AuthRuntime` and `ProviderRuntime` own this state.
`WorkspaceChatBackend` reads these at request time.

## Session Persistence

`WorkspaceChatBackend` writes conversation history to
`.ai-workspace/sessions/<sessionId>.json`. Each call to `submitPrompt` reads
existing messages and appends new ones before calling the provider.

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

Code projects live under `Code/`. Permission handling is stricter than Notes.

The Code Agent safety policy:

```text
git status / add / commit / diff / log  – requires approved: true on the task
git push                                 – requires gitPushApproved: true (or dangerApproved: true)
git push --force / -f                    – requires dangerApproved: true only
shell metacharacters in git arguments   – blocked unconditionally
```

`CodeAgentRuntime` owns the full loop:

1. `inspectProject` – scan files, detect test/package commands, record git status
2. `proposePatch` – store LLM-authored or human diff artifact (no file writes yet)
3. `rejectPatch` – discard proposal without applying
4. `applyPatch` – write file changes only after `approved: true` decision
5. `runChecks` – execute test/lint commands inside the task scope
6. `runGitCommand` – execute safe git commands via `execFile` (no shell expansion)
7. `generateAutomaticPatch` – call `LLMRuntime.generateCodePatch` to produce a
   structured `{ summary, changes: [{ path, find, replace }] }` response

A coding task is recorded under `.ai-workspace/tasks`, approval requests under
`.ai-workspace/approvals`, tool activity under `.ai-workspace/tool-logs`,
decisions under `.ai-workspace/decisions`, and produced or captured diffs under
`.ai-workspace/diffs`.
