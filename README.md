# AI Workspace on Hermes

Server-centered AI workspace powered by Hermes.

The goal is not to force Hermes into Obsidian. The goal is to build a new
workspace where Hermes is the central AI engine and the client apps provide a
ChatGPT-like chat UI, an Obsidian/GoodNotes-like notes and PDF space, and a
Codex-like code workspace.

## Product Shape

```text
AI Workspace Client
  - Hermes Chat Home
  - Notes
  - Code

Workspace Server
  - Workspace file tree
  - Markdown/PDF/attachment metadata
  - Safe relative-path file API
  - Search/index status
  - Hermes session proxy

Hermes Server
  - Sessions
  - Models
  - Streaming events
  - Tools and approvals
  - MCP/docsearch
```

## First MVP

This repository currently contains the first server-side scaffold:

- workspace root discovery
- `Notes/` and `Code/` folder initialization
- safe folder tree API
- markdown/text file read and write API
- file/folder create, move, and delete API
- basic Hermes model/session proxy endpoints
- live Hermes WebSocket bridge at `WS /api/live`
- workspace context router for note/folder/PDF/workspace scopes
- fallback workspace text search API
- macOS SwiftUI client shell with live Hermes chat wiring
- architecture, API, data model, and roadmap docs

The first macOS SwiftUI client shell lives in `client/apple`.

## Run The Server

```bash
export HERMES_WORKSPACE_ROOT="$HOME/HermesWorkspace"
export HERMES_SERVER_URL="http://127.0.0.1:9119"
export HERMES_DASHBOARD_USERNAME="your-user"
export HERMES_DASHBOARD_PASSWORD="your-password"

npm start
```

Then open:

```text
http://127.0.0.1:8787/api/workspace
```

If `HERMES_WORKSPACE_ROOT` does not exist, the server creates:

```text
HermesWorkspace/
├── Notes/
├── Code/
└── .hermes-workspace/
```

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
DELETE /api/file?path=Notes/example.md
POST /api/context
GET  /api/search/status
POST /api/search

GET  /api/hermes/models
GET  /api/hermes/sessions
POST /api/hermes/sessions
WS   /api/live
```

Client requests use workspace-relative paths only. Absolute paths and `..`
path traversal are rejected by the server.

The live endpoint accepts JSON commands such as `session.create`,
`prompt.submit`, and `approval.respond`, then forwards Hermes live events back
to the client.

## Documentation

- [Product goal](docs/01-product-goal.md)
- [Architecture](docs/02-architecture.md)
- [API design](docs/03-api-design.md)
- [Data model](docs/04-data-model.md)
- [MVP roadmap](docs/05-mvp-roadmap.md)
- [Hermes integration notes](docs/06-hermes-integration.md)
- [Apple client](docs/07-apple-client.md)
- [Run commands](docs/08-run-commands.md)

## Run The macOS Client Shell

The first client is a Swift Package so it can build without a full Xcode project.

```bash
cd client/apple
swift run AIWorkspace
```

Current client shell:

- sidebar with Chat, Notes, Code, Search
- server URL setting
- workspace status
- recursive Notes and Code folder navigation
- text/markdown file preview
- markdown/text/code editing and save through `PUT /api/file`
- PDF and image preview through `GET /api/raw`
- search form backed by `POST /api/search`
- Chat view backed by `WS /api/live`
- Hermes model picker and session resume menu
- live Hermes session creation and message submit
- chat context picker for current file, current folder, or workspace
- approval and denial buttons for Hermes approval requests
- grouped, collapsible thinking/tool activity rows
- iOS-ready conditional SwiftUI source groundwork
