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
