# MVP Roadmap

## Phase 0: Planning

Status: started.

- Define product goal.
- Define server-centered workspace architecture.
- Define first API surface.
- Keep Hermes as the AI runtime.

## Phase 1: Workspace Server

Status: in progress.

- Initialize workspace root.
- Create `Notes/`, `Code/`, `Documents/`, `Attachments/`.
- Add path-safe REST APIs.
- Add basic Hermes models/sessions proxy.
- Add metadata placeholder.

Exit criteria:

- `npm run check` passes.
- Server can list `Notes` and `Code`.
- Server rejects absolute and traversal paths.
- Server can create/read/write/move/delete a markdown file.

## Phase 2: Hermes Live Bridge

Status: in progress.

- Dashboard username/password login. Done in server bridge.
- `/api/auth/ws-ticket` support. Done in server bridge.
- Workspace Server `/api/live` WebSocket. Done as a dependency-free MVP.
- Bridge Hermes events. Done at raw event level:
  - message
  - thinking/reasoning
  - tools
  - approvals
- macOS client groups thinking/tool events into collapsible activity rows.
- Client-friendly approval response command. Done.

Remaining:

- Add a real SwiftUI client consumer.
- Add integration tests against a running Hermes server when credentials are
  available.
- Decide whether production should keep raw Hermes event names or normalize them
  further.

## Phase 3: Apple Client MVP

Status: in progress.

- SwiftUI app shell. Done as `client/apple` Swift Package.
- Sidebar:
  - Chat
  - Notes
  - Code
- Notes file tree. Recursive Notes and Code folder navigation done in the macOS client.
- Markdown editor. Basic text/markdown/code editing and save done in the macOS client.
- Markdown/code read mode. Chat, Notes markdown previews, and Code file previews now share the same SwiftUI rendering layer. Markdown renders headings, bullets, tables, and fenced code cards. Code previews infer language from the file extension and use language-specific keyword profiles.
- PDF viewer through server raw file endpoint. Basic macOS PDFKit rendering and image raw preview done.
- Hermes chat view. Live `/api/live` wiring, model picker, session resume menu, context scope picker, and approval controls done in the macOS client.
- Search view. Done with `POST /api/search`.
- Apple client source now has iOS platform declaration and conditional layout/PDF preview wrappers.

Remaining:

- Full Xcode iOS app target, signing, and device packaging.
- Replace the built-in lightweight code highlighter with a real Swift syntax stack. Candidate directions: `CodeEditSourceEditor` for Code editing, Tree-sitter-backed highlighting, or a Swift package that can produce attributed code spans.
- Notes should default to read mode and only show raw Markdown in edit mode. The current implementation has this basic split, but still needs richer Markdown features such as links, images, checkboxes, backlinks, and embedded attachments.
- PDF should evolve from basic PDFKit viewing to a GoodNotes-like surface: read mode, annotation mode, PencilKit drawing, per-page annotation persistence, thumbnails, search, and fullscreen reading/writing modes.
- Code should evolve from source preview to VS Code-like project work: editor tabs, file create/move/delete, terminal panel, and Hermes tool/activity side panel.
- Add a global right AI panel for Notes and Code views. The full Chat tab remains the primary chat surface, but non-chat sections should be able to open a compact Hermes panel with current file/folder context.

## Phase 4: Notes Context Router

Status: in progress.

Mention types:

```text
@current
@selection
@note
@folder
@pdf
@tag
@linked
@workspace
```

Rule:

- small context inline
- large context as RAG/search metadata

Implemented:

- `POST /api/context`
- inline note/selection context
- folder file list with limited markdown snippets
- PDF metadata with `ragRecommended`
- live `prompt.submit` support through `contextRequest`

Remaining:

- Tag and backlink extraction from a real metadata DB.
- PDF page/chunk references from docsearch.
- Client mention picker UI.

## Phase 5: docsearch Integration

Status: in progress.

Implemented:

- `GET /api/search/status`
- `POST /api/search`
- dependency-free `workspace-scan` fallback for markdown/text/code files
- search status included in `/api/workspace`
- context router includes `searchEndpoint` and fallback provider metadata

Remaining:

- Watch workspace root.
- Index markdown, PDF, and selected text/code file types.
- Store persistent index status.
- Connect `docsearch-mcp` or a vector index behind the same API.
- Return PDF page/chunk references.

## Phase 6: Code Workspace

Status: planned.

- Project tree under `Code/`.
- File viewer/editor.
- Hermes coding session creation.
- Diff viewer.
- Approval UI.
- Git operation visibility.
