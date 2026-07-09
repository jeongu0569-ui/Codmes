# API Contract

Base URL during local development:

```text
http://127.0.0.1:8787
```

## Auth

`GET /api/health` is public. When `AIW_SERVER_TOKEN` is set, all other HTTP
endpoints require one of:

```text
Authorization: Bearer <token>
x-aiw-token: <token>
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

Current search provider is `workspace-scan`. It supports content search,
filename hits, scope filtering, `kind`/`kinds`, modified date filters, and
first-pass PDF text extraction through `.ai-workspace/index/pdf-text/`.

Native RAG design is tracked in `docs/rag-backend-design.md`. docsearch MCP
integration is tracked in `docs/docsearch-mcp-integration.md`.

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
keys under `.ai-workspace/config`.

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

`aiw model`, `aiw provider`, and `aiw auth` own local runtime config under
`.ai-workspace/config`. HTTP model listing is implemented through `/api/models`.
Provider/auth mutation endpoints are not yet exposed as HTTP endpoints.

Status: partial, CLI-first.

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

The response includes runtime, MCP, skills, security, index, and search summary.
It also includes an audit summary when `.ai-workspace/audit/audit.jsonl`
exists.

## Known Gaps

- OAuth provider flow is not complete.
- Native vector/RAG storage is still interface-only. Current server search is a
  text/PDF scan fallback, and docsearch MCP is the recommended external semantic
  search path.
- Audit log exists for security policy decisions. More runtime subsystems should
  write explicit approved/rejected records as they become first-class actions.
