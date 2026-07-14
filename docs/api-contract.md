# API Contract

Base URL during local development:

```text
http://127.0.0.1:8787
```

## Auth

`GET /api/health` is public. When `CODMES_SERVER_TOKEN` is set, all other HTTP
endpoints require one of:

```text
Authorization: Bearer <token>
x-codmes-token: <token>
?token=<token>
```

`WS /api/live` accepts `?token=<token>`.

Error response:

```json
{
  "ok": false,
  "error": "Unauthorized."
}
```

## Health

| Method | Path | Status | Auth | Client |
|---|---|---:|---|---|
| GET | `/api/health` | implemented | public | Apple diagnostics |

Response includes `authRequired`.

## Workspace

| Method | Path | Status | Auth | Client |
|---|---|---:|---|---|
| GET | `/api/workspace` | implemented | token when configured | Apple startup |
| GET | `/api/tree?root=notes&path=...` | implemented | token when configured | Apple Notes |
| GET | `/api/tree?root=code&path=...` | implemented | token when configured | Apple Code |

All file paths are workspace-relative. Absolute paths and traversal are
rejected by `path-utils`.

## Files

| Method | Path | Status | Auth | Client |
|---|---|---:|---|---|
| GET | `/api/file?path=...` | implemented | token when configured | Apple preview/edit |
| PUT | `/api/file?path=...` | implemented | token when configured | Apple save |
| POST | `/api/file` | implemented | token when configured | Apple create file |
| POST | `/api/folder` | implemented | token when configured | Apple create folder |
| PATCH | `/api/file/move` | implemented | token when configured | Apple move/rename |
| POST | `/api/file/copy` | implemented | token when configured | Apple copy |
| DELETE | `/api/file?path=...` | implemented | token when configured | Apple delete |
| GET | `/api/file/metadata?path=...` | implemented | token when configured | available |
| GET | `/api/file/annotations?path=...` | implemented | token when configured | Apple PDF annotations |
| PUT | `/api/file/annotations?path=...` | implemented | token when configured | Apple PDF annotations |

## Raw Files And Uploads

| Method | Path | Status | Auth | Client |
|---|---|---:|---|---|
| GET | `/api/raw?path=...` | implemented | token when configured | Apple PDF/image |
| POST | `/api/file/upload` | implemented | token when configured | Apple small upload |
| POST | `/api/file/upload/start` | implemented | token when configured | Apple chunked upload |
| POST | `/api/file/upload/chunk` | implemented | token when configured | Apple chunked upload |
| POST | `/api/file/upload/complete` | implemented | token when configured | Apple chunked upload |
| POST | `/api/file/upload/cancel` | implemented | token when configured | Apple chunked upload |

## Context

| Method | Path | Status | Auth | Client |
|---|---|---:|---|---|
| POST | `/api/context` | implemented | token when configured | runtime context |

The server resolves context requests for `none`, `current`, `note`, `folder`,
`pdf`, `linked`, and `workspace` style scopes.

## Search And Index

| Method | Path | Status | Auth | Client |
|---|---|---:|---|---|
| GET | `/api/search/status` | implemented | token when configured | Apple Search |
| POST | `/api/search` | implemented | token when configured | Apple Search |
| GET | `/api/index/status` | implemented | token when configured | available |
| POST | `/api/index/rebuild` | implemented | token when configured | available |

Current search provider is `codmes-search-index` after the first rebuild, with
`workspace-scan` as the secondary search path when no index exists. It supports content
search, filename hits, scope filtering, `kind`/`kinds`, modified date filters,
and first-pass PDF/Office/HWP/Excel/image/ZIP extraction through
`.codmes/index/documents/`.

Codmes Search ownership and incremental indexing are tracked in
`docs/notes/codmes-search-integration.md`.

## Provider, Auth, And Models

| Method | Path | Status | Auth | Client |
|---|---|---:|---|---|
| GET | `/api/providers` | implemented | token when configured | settings |
| GET | `/api/models` | implemented | token when configured | model picker |
| GET | `/api/auth` | implemented | token when configured | settings |
| POST | `/api/auth/:provider` | implemented | token when configured | settings |
| DELETE | `/api/auth/:provider/:key` | implemented | token when configured | settings |
| GET | `/api/model/default` | implemented | token when configured | settings |
| POST | `/api/model/default` | implemented | token when configured | settings |
| POST | `/api/providers/custom` | implemented | token when configured | settings |
| DELETE | `/api/providers/custom/:id` | implemented | token when configured | settings |

`POST /api/auth/:provider` accepts easy client-facing keys such as `apiKey`,
`token`, and `baseUrl`; the server maps them to the provider registry storage
keys under `.codmes/config`.

## Sessions

| Method | Path | Status | Auth | Client |
|---|---|---:|---|---|
| GET | `/api/models` | implemented | token when configured | Apple model picker |
| GET | `/api/workspace/models` | implemented | token when configured | alias |
| GET | `/api/sessions` | implemented | token when configured | Apple session menu |
| POST | `/api/sessions` | implemented | token when configured | live/session UI |
| GET | `/api/sessions/:id/messages` | implemented | token when configured | Apple history |
| DELETE | `/api/sessions/:id` | implemented | token when configured | Apple history |
| POST | `/api/sessions/:id/rename` | implemented | token when configured | available |
| GET | `/api/sessions/:id/export` | implemented | token when configured | available |
| POST | `/api/sessions/prune` | implemented | token when configured | available |

`/api/workspace/sessions` and `/api/workspace/sessions/:id/messages` are also
available as workspace-owned aliases.

## Live WebSocket

| Method | Path | Status | Auth | Client |
|---|---|---:|---|---|
| WS | `/api/live?token=...` | implemented | token when configured | Apple chat |

Supported commands include:

```text
connect
session.create
session.resume
prompt.submit
approval.respond
approval.inbox.list
approval.inbox.show
approval.inbox.respond
task.resume
task.cancel
config.accessMode
config.reasoning
code.task.create
code.checks.run
code.patch.propose
code.patch.apply
code.patch.reject
```

## Tasks And Approvals

| Method | Path | Status | Auth | Client |
|---|---|---:|---|---|
| GET | `/api/agent/tasks` | implemented | token when configured | Apple Code Agent |
| GET | `/api/agent/tasks/:id` | implemented | token when configured | Apple Code Agent |
| POST | `/api/agent/tasks/:id/resume` | implemented | token when configured | CLI/API |
| POST | `/api/agent/tasks/:id/cancel` | implemented | token when configured | CLI/API |
| GET | `/api/agent/approvals` | implemented | token when configured | Apple approvals |
| GET | `/api/agent/approvals/:id` | implemented | token when configured | Apple approvals |
| POST | `/api/agent/approvals/:id/respond` | implemented | token when configured | Apple approvals |

Runtime tasks can pause with `status=approval_required`. The server stores
`approvalIds[]` and `pendingState`; clients should approve/reject/cancel through
the server instead of reconstructing tool calls.

## Tool Modes, Discovery, Conversations, And Memory

| Method | Path | Status | Auth | Client |
|---|---|---:|---|---|
| GET | `/api/tool-modes` | implemented | token when configured | Apple settings |
| POST | `/api/tool-modes/:surface` | implemented | token when configured | Apple settings |
| GET | `/api/tools/available` | implemented | token when configured | Apple settings/runtime |
| POST | `/api/tools/discover` | implemented | token when configured | runtime |
| POST | `/api/conversations/search` | implemented | token when configured | runtime/search |
| GET | `/api/conversations/search?query=...` | implemented | token when configured | runtime/search |
| POST | `/api/conversations/read` | implemented | token when configured | runtime/search |
| GET | `/api/conversation-folders` | implemented | token when configured | Apple sessions |
| POST | `/api/conversation-folders` | implemented | token when configured | Apple sessions |
| PATCH | `/api/conversation-folders/:id` | implemented | token when configured | Apple sessions |
| DELETE | `/api/conversation-folders/:id` | implemented | token when configured | Apple sessions |
| POST | `/api/sessions/:id/move-to-folder` | implemented | token when configured | Apple sessions |
| POST | `/api/sessions/:id/archive` | implemented | token when configured | Apple sessions |
| POST | `/api/sessions/:id/unarchive` | implemented | token when configured | Apple sessions |
| POST | `/api/sessions/archive-expired` | implemented | token when configured | maintenance |
| POST | `/api/sessions/:id/summarize` | implemented | token when configured | runtime |
| GET | `/api/memory/search` | implemented | token when configured | runtime/search |
| GET | `/api/memory/settings` | implemented | token when configured | settings/runtime |
| POST | `/api/memory/settings` | implemented | token when configured | settings/runtime |
| GET | `/api/memory/candidates` | implemented | token when configured | settings/runtime |
| POST | `/api/memory/candidates/:id/approve` | implemented | token when configured | settings/runtime |
| POST | `/api/memory/candidates/:id/reject` | implemented | token when configured | settings/runtime |
| POST | `/api/memory` | implemented | token when configured | settings/runtime |
| GET | `/api/memory/:id` | implemented | token when configured | settings/runtime |
| PATCH | `/api/memory/:id` | implemented | token when configured | settings/runtime |
| DELETE | `/api/memory/:id` | implemented | token when configured | settings/runtime |
| POST | `/api/memory/extract-from-session` | implemented | token when configured | runtime |

Tool modes are surface-scoped:

```text
chat  -> conversation_search, conversation_read, memory_search, tool_discovery
notes -> workspace/Codmes Search/read-note/file-metadata tools plus conversation/memory tools
code  -> CodeAgentRuntime search/read/git/patch/check tools plus conversation/memory tools
```

Surface registry endpoints:

| Method | Path | Status | Auth | Client |
|---|---|---:|---|---|
| GET | `/api/surfaces` | implemented | token when configured | settings/navigation |
| POST | `/api/surfaces/:surface` | implemented | token when configured | settings/plugins |

`chat` is the default always-on surface. Built-in surfaces such as `notes` and
`code` can be hidden with `enabled: false`; plugin surfaces can be added with a
title, icon, prompt hint, and tool-mode fields.

`tool_discovery` can temporarily expand safe tools for the current turn. It
does not auto-enable approval-gated tools such as `apply_patch`,
`run_checks`, or `run_git_command`.

Core recall tools are always present in surface modes:
`tool_discovery`, `conversation_search`, `conversation_read`, and
`memory_search`. Surface-level custom modes cannot remove these. The global
runtime `disabledTools` config can still block them when an administrator needs
to disable recall or discovery globally.

Temporary tool expansion is turn-only. It is not stored in session JSON, user
tool-mode overrides, or global runtime config. Runtime events include
`tool.discovery.request`, `tool.discovery.result`,
`tool.expansion.applied`, and `tool.expansion.blocked`.

Conversation search supports fuzzy keyword recall and time ranges:
`today`, `yesterday`, `this_week`, `last_week`, `last_7_days`, and ISO date
ranges. `last_week` means the previous calendar Monday-Sunday in the server's
Asia/Seoul default time basis, while `last_7_days` is rolling.

General unscoped `[Chat]` sessions are count-managed rather than date-managed:
the server keeps the latest 30 visible general chats and archives older
overflow. Sessions attached to a project, folder, pin, active code task, or
pending approval are exempt.

Conversation search hides archived sessions by default. Pass
`includeArchived=true` to search archived general-chat overflow or manually
archived sessions. Search results include `archived`, `archivedAt`, and
`archiveReason`.

Memory extraction defaults:

```json
{
  "autoSaveProjectMemory": true,
  "autoSaveFolderMemory": true,
  "autoSaveSessionSummaryMemory": true,
  "autoSaveUserMemory": false,
  "memoryReviewRequired": true
}
```

Project/folder/session-summary memories can be saved automatically. User-global
memories and sensitive-looking memories go through the candidate inbox unless a
local setting explicitly allows automatic user memory saves.

## Code Tasks

| Method | Path | Status | Auth | Client |
|---|---|---:|---|---|
| POST | `/api/agent/code-task` | implemented | token when configured | Apple Code Agent |
| POST | `/api/agent/code-task/:id/patches` | implemented | token when configured | CLI/API |
| POST | `/api/agent/code-task/:id/patches/generate` | implemented | token when configured | available |
| POST | `/api/agent/code-task/:id/patches/:proposalId/apply` | implemented | token when configured | Apple Code Agent |
| POST | `/api/agent/code-task/:id/patches/:proposalId/reject` | implemented | token when configured | Apple Code Agent |
| POST | `/api/agent/code-task/:id/checks` | implemented | token when configured | Apple Code Agent |
| POST | `/api/agent/code-task/:id/git` | implemented | token when configured | available |

## Render

| Method | Path | Status | Auth | Client |
|---|---|---:|---|---|
| POST | `/api/render/markdown` | implemented | token when configured | Apple rich Markdown |
| POST | `/api/render/code` | implemented | token when configured | Apple code preview |

The server uses `marked` and `shiki`.

## Models, Providers, Auth

`codmes model`, `codmes provider`, and `codmes auth` own local runtime config under
`.codmes/config`. The same store is now exposed through HTTP so the Apple
client can configure runtime access without shell commands.

| Method | Path | Status | Auth | Client |
|---|---|---:|---|---|
| GET | `/api/providers` | implemented | token when configured | Apple settings |
| GET | `/api/models` | implemented | token when configured | Apple chat/settings |
| GET | `/api/auth` | implemented | token when configured | Apple settings |
| POST | `/api/auth/:provider` | implemented | token when configured | Apple settings |
| DELETE | `/api/auth/:provider/:key` | implemented | token when configured | Apple settings |
| GET | `/api/model/default` | implemented | token when configured | Apple settings |
| POST | `/api/model/default` | implemented | token when configured | Apple settings |
| POST | `/api/providers/custom` | implemented | token when configured | Apple settings |
| DELETE | `/api/providers/custom/:id` | implemented | token when configured | Apple settings |

## Skills

| Method | Path | Status | Auth | Client |
|---|---|---:|---|---|
| GET | `/api/skills` | implemented | token when configured | available |
| GET | `/api/skills/:name` | implemented | token when configured | available |
| POST | `/api/skills/:name/enable` | implemented | token when configured | available |
| POST | `/api/skills/:name/disable` | implemented | token when configured | available |

## Security

| Method | Path | Status | Auth | Client |
|---|---|---:|---|---|
| GET | `/api/security` | implemented | token when configured | available |
| POST | `/api/security` | implemented | token when configured | available |

The security API reads/writes approval mode, shell policy, allowed commands,
denied commands, and require-approval categories.

## MCP

| Method | Path | Status | Auth | Client |
|---|---|---:|---|---|
| GET | `/api/mcp` | implemented | token when configured | available |
| POST | `/api/mcp` | implemented | token when configured | available |
| DELETE | `/api/mcp/:name` | implemented | token when configured | available |
| POST | `/api/mcp/:name/enable` | implemented | token when configured | available |
| POST | `/api/mcp/:name/disable` | implemented | token when configured | available |

MCP process execution still happens inside the runtime, not in the client.

## Doctor

| Method | Path | Status | Auth | Client |
|---|---|---:|---|---|
| GET | `/api/doctor` | implemented | token when configured | available |

The response includes runtime, MCP, skills, security, index, search summary,
document-ingest diagnostics, and audit summary when `.codmes/audit/audit.jsonl`
exists. Document diagnostics report the Python worker, bootstrap requirements
file, and installed Python libraries such as PyMuPDF4LLM/PyMuPDF/MarkItDown. Codmes Core
does not require native OCR or office-conversion binaries such as `tesseract`,
`pdftoppm`, Java-based ODL, LibreOffice, or `soffice`. Paid cloud OCR providers
are not part of the default dependency path.

## Known Gaps

- OAuth provider flow is not complete.
- Built-in search is a server-owned text/document chunk index with workspace
  scan. PDF Markdown/table and text extraction uses bootstrap Python libraries where possible.
  Scanned PDF/image extraction is limited to MarkItDown's default local/free
  converter path until Codmes owns a stronger free/local OCR provider. Native
  vector embeddings are planned as a later Codmes Search Runtime layer.
- Audit log exists for security policy decisions. More runtime subsystems should
  write explicit approved/rejected records as they become first-class actions.
