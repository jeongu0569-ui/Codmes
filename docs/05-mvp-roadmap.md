# MVP Roadmap

## Phase 0: Direction Reset

Status: done.

- Product name is Codmes.
- `codmes` remains the user-facing CLI.
- Codmes owns runtime state.
- External server wrapper language is removed from the target architecture.
- Local reference runtime code remains a migration source, not the product
  boundary.

## Phase 1: Workspace Server

Status: done for MVP, in progress for polish.

- Initialize workspace root.
- Create `Notes/`, `Code/`, `Documents/`, `Attachments/`.
- Add path-safe REST APIs.
- Add file/folder create, move, copy, upload, delete.
- Add metadata and `.codmes` state root.
- Add render/search/context services.
- Add small and chunked upload APIs.
- Add PDF metadata and first-pass PDF text extraction cache.

Still improving:

- upload manager UX and retry behavior.
- richer PDF thumbnails and annotation data.
- filesystem watcher-backed refresh instead of periodic polling in clients.

## Phase 2: Runtime Ownership

Status: in progress.

- `codmes model` uses Codmes-owned model config: done.
- `codmes provider list` uses Codmes provider registry: done.
- `codmes auth` writes Codmes credential config: done.
- `/api/providers`, `/api/models`, `/api/auth`, `/api/model/default`: done.
- OpenAI-compatible runtime execution: done.
- OpenAI Codex `/responses` transport with OAuth credential handling and refresh path: done.
- Ollama Local provider setup and model discovery: done.
- `/api/sessions` returns Codmes sessions: done.
- `/api/live` emits `runtime.event`: done.
- Model output streams as `message.delta`: done.
- Assistant replies persist in `.codmes/sessions`: done.
- MCP stdio JSON-RPC client and tool execution path: done.
- MCP approval-required propagation, approval inbox item, and resume path: done.

Remaining:

- Polish provider/model/auth module boundaries in `server/lib/runtime/*`.
- Add first-class browser OAuth start/status/callback APIs for account providers.
- Improve provider GUI parity with the desktop reference app.
- Harden Codex/OAuth manual diagnostics without forcing live external API calls in tests.

## Phase 3: Code Runtime

Status: in progress.

- Code project inspect: done.
- Related file search: done.
- Proposed patch creation: done.
- Approval inbox: done.
- Patch apply after approval: done.
- Check command execution with approval: done.
- Git status/diff capture: done.
- Task memory accumulation: done.
- Code-surface tool calls route through `CodeAgentRuntime`: done.
- Approval-required MCP tool calls propagate to task/approval state and resume only the approved pending tool: done.

Remaining:

- Rich diff viewer.
- Automatic LLM-authored patch generation through the Codmes runtime.
- Failure-log-based repair loop.
- Stronger sandbox policy.

## Phase 3.5: Runtime Recall And Tool Modes

Status: in progress.

- Surface-based tool modes: done.
- Same-turn safe tool discovery: done.
- Fuzzy conversation search/read: done.
- Calendar `last_week` and rolling `last_7_days` time ranges: done.
- Session summaries with topics/decisions/entities/preferences/source ids: done.
- Long-term user/project/folder/session memory extraction: first pass done.
- Prompt assembly with summary + recent messages + relevant memory: done.
- General `[Chat]` overflow archive policy, latest 30 visible: done.

Remaining:

- Stronger semantic memory ranking.
- Richer folder/project conversation management UI.
- Better use of built-in Codmes Search results for broad workspace recall.

## Phase 4: Apple Client

Status: in progress.

- Xcode project structure: done.
- macOS/iOS targets: done for buildable MVP.
- Chat shell: done for MVP, in progress for UI polish.
- Notes/Code tree: done for MVP.
- Markdown/code rendering with server Shiki fallback/native fallback: done for MVP.
- Session/model menus: done for MVP.
- Approval/task controls: done for MVP.
- Keychain token storage: done.
- Provider grouping in Apple settings (`Accounts`, `API Keys`, `Local`): done for MVP.

Remaining:

- Rename remaining internal legacy Swift symbols where safe.
- Improve Notes/PDF/Code editor surfaces.
- Add right-side global chat panel polish.
- Add upload manager progress and retry UX.
- Add richer provider OAuth GUI flows.
- Add native Apple Pencil/PDF annotation UX: first iOS/iPadOS PDFKit ink input,
  server sync, text boxes, image attachments, object move/resize, text edit,
  long-press delete, selected-object inspector, object duplicate,
  one-step/to-front/to-back layer ordering, and flattened PDF export/share are
  done for the first iOS/iPadOS pass.

## Phase 5: Notes/PDF/Search

Status: in progress.

- Markdown reading mode and edit mode: first pass done.
- PDF metadata and text extraction cache: first pass done.
- Workspace metadata search: done.
- Codmes Search integration path and fallback: done.
- External search/RAG direction documented: done.

Done for first pass:

- PDF annotation and Apple Pencil storage/sync for iOS/iPadOS page ink through
  document-folder state files such as
  `Notes/.codmes/annotations/mypage.codmes.json`.
- Platform-neutral ink storage uses normalized `inkStrokes`. Legacy
  `inkDataBase64` can still be read for older Apple state.
- iOS/iPadOS PDF annotation objects for text boxes and image attachments.
- Text/image annotation objects can be moved, resized with pinch, edited or
  deleted, and indexed through the Codmes Search annotation path.
- iOS/iPadOS PDF page-range export, Codmes state export for selected pages,
  and insertion of PDF pages plus optional Codmes state after the current page.
- Server-side binary PDF replacement API refreshes the search index after a
  merged PDF is saved.
- macOS PDF preview renders shared `inkStrokes`, and the first macOS edit
  adapter saves mouse/trackpad pen strokes, erases strokes, and selects/moves
  or deletes text/image annotation objects through the same platform-neutral
  annotation state.
- macOS text/image annotation objects can be resized with a corner handle and
  edited through the inspector. Text objects expose text and font-size editing;
  all objects expose normalized frame controls and delete.
- iOS/iPadOS and macOS expose a shared pen color picker. macOS renders
  platform-neutral ink strokes with their stored colors and shows text object
  content instead of internal preview ids.
- iOS/iPadOS renders macOS-created `inkStrokes` through a platform-neutral
  preview layer, so macOS pen input is visible on mobile clients.
- iOS/iPadOS text boxes now use a placement flow: choose the text tool, tap a
  page location, edit immediately, then tap once to select or tap the selected
  object again to edit. Selected text/image objects expose an inline delete
  affordance.

Remaining:

- Server-side thumbnails and page previews.
- Richer GoodNotes-style object/layer controls, shape tools, page thumbnails,
  PDF standard annotation round-trip, and export quality hardening for unusual
  page sizes.
- Further macOS inspector polish, plus Windows and Android/Galaxy Tab stroke
  render/edit adapters using the shared `inkStrokes` format.
- Page-level PDF cache so inserted/replaced pages can be OCRed and indexed
  without reprocessing the whole PDF.
- Search/index status UI.
- More polished Codmes Search setup/status UX.
