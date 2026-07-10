# Architecture

## Current Shape

```text
Apple Client / Web clients / CLI
  -> Codmes Server
      -> WorkspaceAgentEngine
          -> ChatRuntime
          -> ModelRuntime
          -> SessionRuntime
          -> LLMRuntime
          -> CodeAgentRuntime
          -> WorkspaceAgentStateStore
      -> Workspace file APIs
      -> Render/search/context services
```

Codmes owns the server and runtime state. The Hermes core runtime (config, auth, model, provider, sessions, tools, approvals, live socket) is natively absorbed into Codmes. It is not an adapter or bridge structure connecting to an external Hermes server.

## Runtime Modules

Current runtime files:

```text
server/lib/agent-engine.mjs
server/lib/chat-runtime.mjs
server/lib/model-runtime.mjs
server/lib/session-runtime.mjs
server/lib/llm-runtime.mjs
server/lib/code-agent-runtime.mjs
server/lib/runtime/config-store.mjs
```

Planned runtime layout:

```text
server/lib/runtime/
  session.mjs
  model.mjs
  provider.mjs
  auth.mjs
  stream.mjs
  tools.mjs
  approvals.mjs
  mcp.mjs
  sandbox.mjs
```

`config-store.mjs` is the first step. It stores runtime configuration under
`.codmes/config` and exposes provider, model, and credential commands for
`codmes`.

## Workspace State

The workspace root is a normal server-side folder:

```text
Codmes/
├── Notes/
├── Code/
├── Documents/
├── Attachments/
└── .codmes/
```

Runtime state lives under:

```text
.codmes/
├── config/
│   ├── config.yaml
│   └── auth.json
├── sessions/
├── conversation-index/
├── conversation-folders/
├── tool-modes/
├── tasks/
├── memory/
├── approvals/
├── decisions/
├── tool-logs/
├── diffs/
└── index/
```

## Path Rule

Clients only send workspace-relative paths:

```text
Notes/Work/meeting.md
Code/project-a/src/main.ts
Documents/os-book.pdf
```

The server rejects absolute paths and traversal:

```text
/Users/user/Desktop/secret.txt
../../etc/passwd
C:/Users/user/secret.txt
```

## Public API Rule

Clients should talk to Codmes APIs only:

```text
GET  /api/models
GET  /api/sessions
POST /api/sessions
GET  /api/sessions/:id/messages
WS   /api/live
```

The Apple client should not know about any external server URL or dashboard
credential. It only needs the Codmes Server URL.

## Code Runtime

Code work is handled through the server:

```text
inspect
  -> proposed patch
  -> approval
  -> apply
  -> checks
  -> git diff/status
  -> task memory update
```

The client never runs a local shell on iOS. Shell/check/git commands are
server-side operations with scope limits, approval, timeout, and logs.

## Migration Reference

The local reference implementation remains useful for provider catalog,
credential, streaming, tool, approval, MCP, and sandbox ideas. Those ideas
should be ported into Codmes-owned modules instead of being kept behind an
external server dependency.

## Current Native Runtime Backend

The runtime backend is an OpenAI-compatible native engine under `server/lib/runtime/openai-compatible-runtime.mjs`. It resolves the selected provider/model from `.codmes/config/config.yaml`, streams chat completions into Codmes live events, and lets the session runtime persist only the visible user/assistant messages.

Assistant replies are persisted from the same streaming events that power the live UI. The engine buffers `message.delta` events by session/task and writes a single assistant message to `.codmes/sessions` on `turn.complete`, with a non-streaming result fallback for models that only return final text.

The native runtime exposes surface-filtered tools:

- Chat surface: `conversation_search`, `conversation_read`, `memory_search`, `tool_discovery`.
- Notes surface: `workspace_search`, `docsearch_search`, `read_note_file`, `read_file_metadata`.
- Code surface: `search_project`, `read_project_file`, `inspect_git`, `get_git_diff`, `propose_patch`, `apply_patch`, `run_checks`, `run_git_command`.

Surfaces are intended to behave like lightweight client plugins. `chat` is the
default always-on surface. Built-in surfaces such as `notes` and `code` can be
hidden by a client setting for users who do not need them, and future plugin
surfaces can register their own title, icon, prompt hint, and tool mode. A
university-specific surface such as `kongju-university` should therefore be a
new surface entry plus tool-mode/plugin configuration, not a hard-coded app tab.

Plugin surface manifests are loaded from:

```text
<Workspace>/.codmes/plugins/<plugin-id>/surface.json
```

The manifest can define `id`, `title`, `description`, `prompt`, `icon`, and
ordering metadata. The `prompt` is injected as a surface-specific runtime hint,
while actual tool access remains controlled by the surface/tool-mode registry.

When the right-side/global chat panel is opened while the user is in another
surface, the chat request should carry that surface id. The server then applies
the matching prompt policy and tool mode:

- `chat`: general conversation, recall, memory, and tool discovery.
- `notes`: note/document/PDF text search, file metadata, and docsearch MCP when configured.
- `code`: code planning, project inspection, patch proposals, checks, git tools, and approvals.

The dedicated Code Agent panel has been removed from the client direction. Code
agent behavior belongs to the chat loop when the active surface is `code`.

The core recall set (`tool_discovery`, `conversation_search`,
`conversation_read`, `memory_search`) is mandatory for all surfaces. Surface
custom modes cannot remove these tools. The global/admin runtime
`disabledTools` list remains the one place that can block them.

Default Chat also has a conservative pre-model surface router. It preserves
explicit client/user surface selection, but can route obvious code-file context
to `code` and document/PDF/folder context to `notes`. The planned richer version
is a hybrid router: quick local rules for obvious cases, then a small classifier
model for ambiguous prompts.

Code-surface tools route through `CodeAgentRuntime`. Mutating or command-running
tools are approval-gated by the tool mode and approval inbox.

When a code-surface chat begins without an explicit `codeTaskId`, the agent
engine creates a lightweight current code task, stores it on the session, and
passes it to tool execution. Code tools can then use the current task id when
the model omits `taskId`.

`tool_discovery` can expand safe tools for the current turn only. This lets a
plain chat discover note search when the user asks a broad workspace question
without permanently enabling every tool in every chat.

Discovery emits `tool.discovery.request`, `tool.discovery.result`,
`tool.expansion.applied`, and `tool.expansion.blocked`. Expansion is never
persisted to session JSON or user tool-mode settings. Approval-gated or
dangerous tools can be discovered but are not automatically expanded.

`docsearch_search` first tries a configured docsearch-style MCP server with a
search/query tool. When no suitable MCP server is configured or the call fails,
the runtime returns a normalized `workspace-search-fallback` result instead.

Tool calls are executed by Codmes itself, emitted as `tool.start`, `tool.complete`, or `tool.error` live events, then passed back to the model as tool results before the final assistant message is streamed.

Prompt assembly uses compact context:

```text
system/runtime instructions
session summary
relevant long-term memory
recent visible user/assistant messages
current user message
```

The runtime does not paste the entire historical transcript into every request.
Session summaries and extracted memory are stored under `.codmes` and
updated as sessions are written.

MCP tool calls that need user approval no longer block the runtime stream while
the server polls for a decision. The runtime now creates an approval request,
marks the owning task as `approval_required`, stores a compact `pendingState`,
and returns control to the client. Approval resumes the saved task state through
the Workspace Agent Engine; rejection or cancellation resolves the task without
executing the pending MCP tool call.

Unscoped general `[Chat]` sessions are kept to the latest 30 visible sidebar
items. Older overflow is archived, while project/folder/pinned/pending-approval
sessions stay visible.
