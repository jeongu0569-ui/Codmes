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
- Add native Apple Pencil/PDF annotation UX.

## Phase 5: Notes/PDF/Search

Status: in progress.

- Markdown reading mode and edit mode: first pass done.
- PDF metadata and text extraction cache: first pass done.
- Workspace metadata search: done.
- Codmes Search integration path and fallback: done.
- External search/RAG direction documented: done.

Remaining:

- PDF annotation and Apple Pencil storage/sync.
- Server-side thumbnails and page previews.
- Search/index status UI.
- More polished Codmes Search setup/status UX.
