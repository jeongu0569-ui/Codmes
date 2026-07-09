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
- AI Workspace CLI first pass. Done with `aiw` and `ai-workspace` package bins:
  - `aiw serve` starts the Workspace Server with friendly host/port/root/Hermes options.
  - `aiw status` checks Workspace/Hermes/search/agent status through the server API.
  - `aiw model`, `aiw provider`, and `aiw auth` manage configuration directly via the server's Unified Engine config storage.
  - `aiw tasks`, `aiw code`, and `aiw index` expose the current workspace task,
    code task, patch/check, and search APIs.
  - This is a transition layer. Final Unified Engine operation should keep
    `aiw` as the user-facing command while removing the need for a separate
    Hermes app/server/CLI in normal use.

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
- Workspace Agent Engine boundary. Done as the first 1.5-architecture step:
  `/api/live` now routes through `WorkspaceAgentEngine -> HermesAgentAdapter`
  instead of calling `HermesLiveClient` directly from `server/index.mjs`.
- Workspace-owned agent state. Done at the minimal event/task level under
  `.ai-workspace/sessions`, `.ai-workspace/tasks`, and
  `.ai-workspace/tool-logs`.
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
- Add a second adapter/runtime for Codex-style coding tasks behind the same
  `WorkspaceAgentEngine` interface.

## Phase 3: Apple Client MVP

Status: in progress.

- SwiftUI app shell. Done as `client/apple` Swift Package.
- Sidebar:
  - Chat
  - Notes
  - Code
- Notes file tree. Recursive Notes and Code folder navigation done in the macOS client.
- Notes/Code create actions. The Apple client can create a file or folder in the current server-managed folder through `POST /api/file` and `POST /api/folder`.
- Notes/Code rename/delete actions. The Apple client can rename via `PATCH /api/file/move` and delete via `DELETE /api/file`, with the server performing the filesystem operation inside the workspace root.
- Notes/Code move/copy actions. The Apple client can move via `PATCH /api/file/move` and copy via `POST /api/file/copy` with destination folders expressed relative to the selected Notes/Code root.
- Markdown editor. Basic text/markdown/code editing and save done in the macOS client.
- Markdown/code read mode. Chat, Notes markdown previews, and Code file previews now share the same SwiftUI rendering layer. Markdown renders headings, paragraphs, unordered and ordered lists, task checkboxes, quotes, horizontal rules, tables, and fenced code cards. Code previews infer language from the file extension and use language-specific keyword profiles across common app and systems languages.
- Server-rendered Markdown path. The Workspace Server exposes `POST /api/render/markdown` and uses `marked` plus `shiki` to produce HTML for the Apple client's `WKWebView`, with native SwiftUI rendering kept as fallback.
- PDF viewer through server raw file endpoint. Basic macOS PDFKit rendering and image raw preview done.
- Hermes chat view. Live `/api/live` wiring, model picker, session resume menu, context scope picker, and approval controls done in the macOS client.
- Search view. Done with `POST /api/search`.
- Apple client source now has iOS platform declaration and conditional layout/PDF preview wrappers.

Remaining:

- Full Xcode iOS app target, signing, and device packaging.
- Continue hardening the production renderer. The first WebView/Shiki path is server-rendered HTML; remaining work includes streamed-render throttling, link handling, light/dark theme switching, local asset bundling if offline mode is needed, and eventually a dedicated code editor surface such as `CodeEditSourceEditor` or Tree-sitter-backed editing.
- Notes should default to read mode and only show raw Markdown in edit mode. The current implementation has this basic split, but still needs richer Markdown features such as images, wiki links/backlinks, embedded attachments, callouts, and bidirectional note references.
- PDF should evolve from basic PDFKit viewing to a GoodNotes-like surface: read mode, annotation mode, PencilKit drawing, per-page annotation persistence, thumbnails, search, and fullscreen reading/writing modes.
- Code should evolve from source preview to VS Code-like project work: editor tabs, file create/move/delete, terminal panel, and Hermes tool/activity side panel. Terminal support must be designed as a server-side terminal bridge. macOS may later expose local-development conveniences, but iOS/iPadOS cannot spawn a local shell and should only control terminal sessions running on the Workspace/Hermes server.
- File operations should expand from menu-based create/rename/move/copy/delete to drag-and-drop, trash/undo, and conflict resolution.
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

Status: in progress.

- Project tree under `Code/`.
- File viewer/editor.
- Workspace Agent Engine coding-task creation.
- CodeAgentRuntime inspect loop. Done at the server level through
  `POST /api/agent/code-task` and live command `code.task.create`:
  - validates that scope is under `Code/`
  - scans project files while ignoring common build/cache folders
  - searches relevant files with the current workspace search provider
  - detects package markers and suggested check commands
  - collects git status/diff information
  - records task, decision, tool log, and diff artifacts under `.ai-workspace`
- Git operation visibility. First read-only status/diff capture is done.
- Diff artifacts. First captured git diff is written to `.ai-workspace/diffs`.
- Workspace task history API. Done with `GET /api/agent/tasks` and
  `GET /api/agent/tasks/:id`.
- Approved patch proposal/apply flow. Done at the server level:
  - `POST /api/agent/code-task/:id/patches` creates a proposed diff artifact
    and task record without modifying files.
  - `POST /api/agent/code-task/:id/patches/:proposalId/apply` requires
    `approved: true`, verifies that file hashes still match the proposal, then
    writes files and refreshes git diff/status.
  - `POST /api/agent/code-task/:id/patches/:proposalId/reject` records a
    rejected proposal and reason without modifying files.
- Approved check execution. Done with
  `POST /api/agent/code-task/:id/checks`; the server refuses to run shell
  commands unless the request includes `approved: true`.
- Post-patch check orchestration. Done at the server/API/CLI level:
  `POST /api/agent/code-task/:id/patches/:proposalId/apply` can receive
  `runChecksAfterApply: true` plus `checksApproved: true` and continue into
  the task's detected checks after the approved patch is written. Without
  check approval, it returns a check approval request instead of running shell
  commands.
- Dedicated approval inbox. First server/CLI pass done:
  - `.ai-workspace/approvals/approval-*.json` stores pending/resolved approval
    requests.
  - `GET /api/agent/approvals` and
    `POST /api/agent/approvals/:id/respond` expose approval management.
  - `aiw approvals` can list, approve, and reject workspace-owned approval
    requests.
- Check output persistence. Done: command stdout/stderr, exit codes, duration,
  and refreshed git diff refs are appended to the task record.
- Task memory accumulation. Done at the server level: code tasks now maintain a
  bounded `taskMemory` summary with read files, proposed files, changed files,
  executed commands, check summaries, failure logs, next steps, and notes.
- Apple client Code Agent panel. First pass done: the Code browser can create
  inspect tasks for the current Code folder, list/load recent code tasks, show
  task memory, show the latest proposed/git diff artifact, approve/apply an
  existing patch proposal, approve plus run checks, deny an unsafe proposal,
  and run approved checks through the Workspace Server.

Remaining:

- Rich diff viewer in the Apple client. A compact text diff view exists in the Code Agent panel, but side-by-side hunks and file grouping are still pending.
- Codex-style work loop:
  - inspect files. Done.
  - plan. Done.
  - patch. Done (including automatic LLM-authored patch generation).
  - shell/test. Done (including check execution and check logging).
  - collect diff. Done.
  - request approval. Done (both server-side approvals inbox and Apple client dedicated Approvals Inbox panel are fully integrated).
  - write task/decision/tool logs under `.ai-workspace`. Done.
