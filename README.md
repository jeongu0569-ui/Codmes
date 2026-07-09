# AI Workspace

AI Workspace is a server-centered workspace app for chat, notes, PDFs, search, and code tasks.

**Architecture Note**: AI Workspace directly absorbs the Hermes core runtime natively. It is not an adapter or bridge structure connecting to an external Hermes server. Instead, it natively implements the same robust model/provider/auth/session/tool/mcp/approval/runtime systems directly inside AI Workspace, overlaid by the workspace, notes, search, and code project layers.

## Product Shape

```text
AI Workspace Client
  - Chat
  - Notes
  - Code
  - Search

AI Workspace Server
  - Chat/session runtime
  - Model/provider/auth runtime config
  - Tool and approval state
  - Workspace file tree
  - Markdown/PDF/attachment metadata
  - Safe relative-path file API
  - Search/index status
  - Code task runtime
```

## Current MVP

This repository currently contains the first server-centered scaffold:

- workspace root discovery
- `Notes/`, `Code/`, `Documents/`, and `Attachments/` folder initialization
- safe folder tree API
- markdown/text file read and write API
- file/folder create, move, copy, upload, and delete API
- AI Workspace model/provider/auth config store under `.ai-workspace/config`
- first OpenAI-compatible model execution backend owned by AI Workspace
- read-only Workspace tool calling for search, file reads, and folder tree listing
- AI Workspace session store under `.ai-workspace/sessions`
- live WebSocket endpoint at `WS /api/live`
- workspace context router for note/folder/PDF/workspace scopes
- fallback workspace text search API
- code task inspect/propose/apply/check/git loop
- approval inbox API
- macOS/iOS SwiftUI client shell
- architecture, API, data model, and roadmap docs

The first Apple client lives in `client/apple`.

## Run The Server

```bash
export AIW_WORKSPACE_ROOT="$HOME/AIWorkspace"
export AIW_HOST="127.0.0.1"
export AIW_PORT="8787"

aiw serve
```

or:

```bash
npm start
```

Then open:

```text
http://127.0.0.1:8787/api/workspace
```

If `AIW_WORKSPACE_ROOT` does not exist, the server creates:

```text
AIWorkspace/
├── Notes/
├── Code/
├── Documents/
├── Attachments/
└── .ai-workspace/
```

## CLI

`aiw` is the user-facing command:

```bash
aiw serve
aiw status
aiw provider list
aiw model list
aiw model set-default openai-api gpt-5.4-mini
aiw auth list
aiw auth set openai-api OPENAI_API_KEY sk-...
aiw auth set custom AIW_CUSTOM_BASE_URL http://127.0.0.1:1234/v1
aiw auth set custom AIW_CUSTOM_API_KEY local-dev-key
aiw tasks list
aiw code create Code/demo-app "change the greeting"
aiw approvals list
aiw index search "architecture"
```

`ai-workspace` is the long-form alias for `aiw`.

## Useful Endpoints

```text
GET  /api/workspace
GET  /api/tree?root=notes
GET  /api/tree?root=code
GET  /api/file?path=Notes/example.md
PUT  /api/file?path=Notes/example.md
POST /api/file
POST /api/folder
PATCH /api/file/move
POST /api/file/copy
DELETE /api/file?path=Notes/example.md
POST /api/context
GET  /api/search/status
POST /api/search

GET  /api/models
GET  /api/sessions
POST /api/sessions
GET  /api/sessions/:id/messages
DELETE /api/sessions/:id
WS   /api/live
```

Client requests use workspace-relative paths only. Absolute paths and `..`
path traversal are rejected by the server.

The live endpoint accepts JSON commands such as `session.create`,
`prompt.submit`, and `approval.respond`, then forwards runtime events back to
the client.

## Documentation

- [Product goal](docs/01-product-goal.md)
- [Architecture](docs/02-architecture.md)
- [API design](docs/03-api-design.md)
- [Data model](docs/04-data-model.md)
- [MVP roadmap](docs/05-mvp-roadmap.md)
- [Runtime migration note](docs/06-runtime-migration.md)
- [Apple client](docs/07-apple-client.md)
- [Run commands](docs/08-run-commands.md)

## Run The Apple Client

```bash
cd client/apple
swift run AIWorkspace
```

Current client shell:

- sidebar with Chat, Notes, Code, Search
- server URL setting
- workspace status
- recursive Notes and Code folder navigation
- text/markdown/code editing and save through `PUT /api/file`
- PDF and image preview through `GET /api/raw`
- search form backed by `POST /api/search`
- Chat view backed by `WS /api/live`
- model picker and session menu backed by AI Workspace APIs
- chat context picker for current file, current folder, or workspace
- approval and denial buttons for approval requests
- grouped, collapsible thinking/tool activity rows
- iOS-ready conditional SwiftUI source groundwork

## Migration Note

The initial prototype referenced runtime behavior from an existing local
Hermes installation. The project is moving those runtime responsibilities into
AI Workspace itself. Hermes remains useful as a source of implementation ideas
and migration reference, but AI Workspace should not require a separate Hermes
server to run.
