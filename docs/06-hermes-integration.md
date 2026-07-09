# Hermes Integration Notes

This project should reuse the lessons from the Obsidian Hermes Connection
plugin, but not its Obsidian-specific assumptions.

## Useful Hermes Connection Patterns

The plugin proved that the most useful Hermes path is the live WebSocket path:

```text
Dashboard login
→ POST /api/auth/ws-ticket
→ WS /api/ws?ticket=...
→ JSON-RPC session.create
→ JSON-RPC prompt.submit
→ live events
→ JSON-RPC approval.respond
```

Important event types:

```text
message.delta
thinking.delta
reasoning.delta
tool.start
tool.progress
tool.complete
approval.request
message.complete
turn.complete
```

## Implemented Workspace Live Bridge

The Workspace Server now exposes:

```text
WS /api/live
```

The client sends JSON commands such as:

```text
connect
session.create
session.resume
prompt.submit
approval.respond
config.accessMode
config.reasoning
```

The server logs in to the Hermes dashboard with the configured username and
password, requests `/api/auth/ws-ticket`, opens Hermes `/api/ws`, and forwards
Hermes events back to the app as `hermes.event` messages.

The bridge keeps the client app from needing to know Hermes dashboard cookies or
WebSocket tickets.

Internally, `/api/live` now routes through the Workspace Agent Engine:

```text
client WS /api/live
  -> WorkspaceAgentEngine
  -> ChatRuntime
  -> ChatBackend (Interface)
  -> HermesCompatChatBackend (Implementation)
  -> HermesLiveClient (compat)
  -> Hermes /api/ws
```

The server-side adapter layer was completely refactored. `HermesAgentAdapter` has been removed. Live connection, model lookup, and session history management are now handled by isolated runtime modules (`ChatRuntime`, `ModelRuntime`, and `SessionRuntime`) backed by the compatibility layer `hermes-compat.mjs`.

To isolate the legacy system, `ChatRuntime` defines a clean `ChatBackend` interface. Live requests are routed through `HermesCompatChatBackend`, ensuring that the core engine is decoupled from the specific communication protocol. If `HERMES_SERVER_URL` is omitted, the runtimes fall back to a local offline mode to keep core workspace operations active. Outgoing events still use
`kind: "hermes.event"` for Apple client compatibility, and carry
engine/adapter identity as well.

`config.accessMode` maps the client composer modes to Hermes session config:

```text
Safe -> config.set key=yolo value=0
Full -> config.set key=yolo value=1
```

`config.reasoning` maps the client composer reasoning menu to Hermes'
`config.set key=reasoning` RPC:

```text
Fast -> low
Med  -> medium
Deep -> high
```

This was verified against Hermes live WebSocket on 2026-07-08 with
`session.create`, `config.accessMode`, and `config.reasoning` returning
`{ ok: true }` through the Workspace bridge.

## Workspace-Owned Agent State

The Workspace Agent Engine writes its own minimal state under:

```text
.ai-workspace/
├── sessions/events.jsonl
├── approvals/events.jsonl
├── approvals/approval-<timestamp>-<uuid>.json
├── tasks/events.jsonl
├── tasks/task-<timestamp>-<uuid>.json
└── tool-logs/
    ├── live-events.jsonl
    └── tool-events.jsonl
```

This does not replace Hermes conversation history. Hermes still owns saved chat
messages while Hermes is the active adapter. The new state layer records the
Workspace Server's own view of work: submitted prompts, context requests,
session/config actions, and live tool events. Future code tasks can attach
patches, diffs, test output, approvals, and decisions to the same task id.

The first non-Hermes runtime is `CodeAgentRuntime`. It does not call Hermes and
does not replace Hermes model/provider/auth/session behavior. It starts a
workspace-owned code task, inspects a `Code/` project, searches relevant files,
records git status/diff output, and writes an initial plan under the same
`.ai-workspace` state tree.

It now also owns the first approved code-workflow primitives:

- propose a patch and store the diff/task metadata without touching files
- emit/return an `approval.request`-shaped record for future client UI
- apply a proposal only when `approved: true` is supplied and the target file
  hash still matches the proposal
- run approved verification commands and append stdout, stderr, exit code,
  duration, and refreshed git diff information to the same task

This proves that the Workspace Agent Engine can host more than the Hermes live
adapter while still leaving Hermes responsible for the general chat/model/MCP
layer.

## Unified Engine Direction

The current Hermes integration is transitional. It exists so the app can reuse
Hermes live chat, provider configuration, authentication, tools, and MCP while
the Workspace-owned engine grows.

The final product direction is:

```text
aiw serve
  -> Workspace Server
  -> Unified Engine
  -> model/provider/auth/session/tool/code/index runtimes
```

### Hermes Server Dependency Elimination Roadmap

To fully transition into a self-contained AI Workspace Unified Engine and eliminate the need for `HERMES_SERVER_URL` and Hermes Desktop processes, the following staged migration plan is established:

- **Stage 1 (Completed)**: Separate execution dependencies. Refactored `HermesAgentAdapter` out of the codebase and isolated live proxy routes into three clean modules: `ChatRuntime`, `ModelRuntime`, and `SessionRuntime`. The legacy live client was moved into a fallback compatibility layer (`hermes-compat.mjs`). Overrode `aiw model`, `aiw provider`, and `aiw auth` commands to read and write config parameters directly using Unified Engine configuration APIs without calling out to any external Hermes binary execution wrapper.
- **Stage 2 (Short-term)**: Adopt lightweight local LLM wrappers. Implement support for direct OpenAI/Anthropic SDK or locally hosted Ollama/Llama.cpp endpoints directly inside `ChatRuntime` and `ModelRuntime`, bypassing `HermesLiveClient` entirely if a specific model adapter is selected.
- **Stage 3 (Medium-term)**: Native SQLite state store integration. Replace proxy session histories with a direct Workspace-owned SQLite session database inside the `.ai-workspace` directory. This allows local chat threads and coding task memory to be queries across the same repository history without syncing with external servers.
- **Stage 4 (Long-term)**: Native MCP host engine internalization. Absorb MCP tool registration and stream orchestration directly inside the `ToolRuntime` and Unified Workspace Server. Once complete, `aiw serve` runs the workspace interface, coding loops, and LLM orchestration entirely in a single, lightweight Node process, requiring no external Hermes installation or network endpoint dependency whatsoever.

## Why Workspace Server Should Bridge Hermes

The client could connect directly to Hermes, but a server bridge is better:

- iPhone/macOS clients only need one workspace URL.
- Credentials stay server-side when desired.
- Workspace paths can be translated to safe relative metadata.
- Notes/PDF/code context routing can be applied before the prompt reaches
  Hermes.
- Future multi-user profile routing can live in one place.

## REST Fallback

Hermes REST endpoints are useful for:

```text
GET /api/model/options
GET /api/sessions
POST /api/sessions
```

But live chat should use `/api/live` when available because REST fallback may
not show full reasoning/tool/approval activity.

`GET /api/hermes/sessions` is intentionally normalized by the Workspace Server.
Hermes can return raw database rows where `title` is empty and the only stable
identifier is a generated id such as `20260707_...`. The Workspace API filters
archived or empty orphan sessions and returns client-friendly rows:

```json
{
  "sessions": [
    {
      "id": "20260707_...",
      "title": "Hermes AI Introduction",
      "model": "gemma4:e2b-mlx",
      "preview": "안녕",
      "updatedAt": "1783412528.4681878",
      "isActive": false
    }
  ]
}
```

This keeps Swift/iOS clients from showing raw generated ids as chat titles.

## Live Event Handling

Hermes live streams do not always finish with the same event name. In local
testing with `gemma4:e2b-mlx`, the stream ended with `message.complete` rather
than `turn.complete`. Clients should treat all of these as turn-ending signals:

```text
message.done
message.complete
message.completed
response.done
response.complete
response.completed
turn.complete
turn.completed
```

The Apple client renders only message delta events as assistant text and groups
thinking/reasoning/tool events into one collapsible activity row per user turn.
This avoids duplicated assistant text and prevents late tool/reasoning events
from appearing as separate chat rows after the answer.

## Context Metadata Shape

The app should send a `contextRequest` to the Workspace Server. The server
resolves paths, decides inline-vs-search policy, and sends a compact context
preface to Hermes live prompts.

Example:

```json
{
  "scopeType": "folder",
  "scopePath": "Notes/Work",
  "activePath": "Notes/Work/os.md",
  "maxInlineFiles": 3
}
```

Current Hermes live RPC compatibility note:

```text
prompt.submit { session_id, text }
```

The Hermes live endpoint currently follows the same shape used by the Hermes
TUI: the submitted payload is a single `text` field. There is not yet a
separate public live-RPC field for hidden prompt context versus visible user
message text. Because of that, Workspace context is still rendered into the
submitted text for the model.

To keep the Apple UI clean when a session is reloaded, the client strips the
stored `[Workspace context] ... [User message]` wrapper from user history rows
and displays only the actual user message. A cleaner long-term improvement is a
Hermes live RPC extension such as:

```json
{
  "session_id": "...",
  "display_text": "사용자가 실제로 입력한 문장",
  "text": "모델에 전달할 전체 프롬프트",
  "metadata": { "workspaceContext": "..." }
}
```

That change belongs in Hermes core or the live API layer, not just the Apple
client.

## RAG Principle

Do not attach everything.

Inline:

- selected text
- current short markdown note
- one short mentioned note

Search hint:

- folders
- PDFs
- tags
- linked resources
- whole workspace
- code projects

Hermes should use MCP/docsearch for broad questions.
