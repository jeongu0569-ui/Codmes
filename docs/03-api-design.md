# API Design

Base URL during local development:

```text
http://127.0.0.1:8787
```

## Auth

`GET /api/health` is public. If the server is started with
`AIW_SERVER_TOKEN`, every other endpoint requires:

```text
Authorization: Bearer <token>
```

Raw-file URLs and WebSocket connections can also pass:

```text
?token=<token>
```

## Workspace

### `GET /api/health`

Returns service health.

### `GET /api/workspace`

Returns configured workspace root, top-level roots, runtime status, and active
workspace agent engine capabilities:

```json
{
  "agent": {
    "engine": "workspace-agent",
    "statePath": ".ai-workspace",
    "adapters": ["ai-workspace-runtime"],
    "runtimes": ["chat", "models", "sessions", "code-agent"],
    "taskEndpoint": "/api/agent/tasks",
    "approvalEndpoint": "/api/agent/approvals",
    "codeTaskEndpoint": "/api/agent/code-task",
    "codePatchEndpoint": "/api/agent/code-task/:id/patches",
    "codePatchRejectEndpoint": "/api/agent/code-task/:id/patches/:proposalId/reject",
    "codeChecksEndpoint": "/api/agent/code-task/:id/checks"
  }
}
```

### `GET /api/tree?root=notes`

Returns a folder tree listing for a root.

Supported root keys:

```text
workspace
notes
code
documents
attachments
```

Optional nested path:

```text
GET /api/tree?root=notes&path=Work
```

### `GET /api/file?path=Notes/Work/a.md`

Reads a text file. This is for markdown and small text/code files.

Large files should use `/api/raw` or future search/index APIs.

### `GET /api/file/metadata?path=Notes/Work/a.md`

Returns server-side file metadata, including kind, size, extension, modified
time, and hash when the file is small enough to hash cheaply.

For PDFs, the response also includes a `pdf` object with first-pass metadata:
page-count estimate, extracted-text cache status, cache path, text length, and
`ocr: "planned"`.

### `GET /api/raw?path=Documents/a.pdf`

Streams a raw file. This is useful for PDFs and images.

### Provider/Auth Settings

Apple and other clients can update runtime settings without shelling out to the
CLI:

```text
GET    /api/providers
GET    /api/models
GET    /api/auth
POST   /api/auth/:provider
DELETE /api/auth/:provider/:key
GET    /api/model/default
POST   /api/model/default
POST   /api/providers/custom
DELETE /api/providers/custom/:id
```

`POST /api/auth/:provider` accepts friendly keys like `apiKey`, `token`, and
`baseUrl`; the server maps them to the provider registry storage keys.

### `PUT /api/file?path=Notes/Work/a.md`

Writes a text file.

Body:

```json
{
  "content": "# Hello"
}
```

### `POST /api/file`

Creates a new file and fails if it already exists.

```json
{
  "path": "Notes/Work/new.md",
  "content": "# New"
}
```

### `POST /api/folder`

Creates a folder.

```json
{
  "path": "Notes/Work"
}
```

### `PATCH /api/file/move`

Moves or renames a file/folder.

```json
{
  "from": "Notes/Work/a.md",
  "to": "Notes/Work/b.md"
}
```

### `DELETE /api/file?path=Notes/Work/a.md`

Deletes a file or folder.

This endpoint exists for MVP development, but production UI should add undo or
trash semantics before exposing it casually.

### Runtime Config Boundary

AI Workspace owns model/provider/auth configuration under
`.ai-workspace/config`. CLI commands such as `aiw model`, `aiw provider list`,
and `aiw auth` operate on that AI Workspace-owned state.

## Context Router

### `POST /api/context`

Builds a workspace context object from a client mention/scope request.

Example for a single note:

```json
{
  "scopeType": "note",
  "scopePath": "Notes/Work/a.md"
}
```

Example for a folder:

```json
{
  "scopeType": "folder",
  "scopePath": "Notes/Operating Systems",
  "maxInlineFiles": 3
}
```

Example for a PDF:

```json
{
  "scopeType": "pdf",
  "scopePath": "Documents/os-book.pdf"
}
```

Supported scope types:

```text
none
selection
current
note
folder
pdf
tag
linked
workspace
```

Policy:

- `selection`, `current`, and short `note` context can include inline text.
- `folder`, `pdf`, `tag`, `linked`, and `workspace` recommend RAG/docsearch.
- All paths must be workspace-relative.

## Search

### `GET /api/search/status`

Returns the active search provider and indexing capability.

Current MVP provider:

```text
workspace-scan
```

This is a dependency-free fallback that scans text files in the workspace. It is
not a vector index and does not replace docsearch-mcp. It gives the client and
server a stable search API while the proper indexer is added.

### `POST /api/search`

Searches within a workspace-relative scope.

```json
{
  "query": "scheduler",
  "scopePath": "Notes/Operating Systems",
  "maxResults": 10
}
```

Response:

```json
{
  "provider": "workspace-scan",
  "query": "scheduler",
  "scopePath": "Notes/Operating Systems",
  "resultCount": 1,
  "results": [
    {
      "path": "Notes/Operating Systems/os.md",
      "kind": "markdown",
      "snippet": "... scheduler chooses a process ..."
    }
  ]
}
```

Future provider:

```text
docsearch-mcp / vector index
```

### `GET /api/index/status`

Returns the current metadata index summary from `.ai-workspace/index/files.json`.

### `POST /api/index/rebuild`

Rebuilds the current workspace file metadata index. This indexes file metadata,
not vector embeddings.

## Runtime Management

### Skills

```text
GET  /api/skills
GET  /api/skills/:name
POST /api/skills/:name/enable
POST /api/skills/:name/disable
```

### Security

```text
GET  /api/security
POST /api/security
```

The security endpoint reads and writes approval mode, shell policy, allow/deny
commands, and required approval categories.

### MCP

```text
GET    /api/mcp
POST   /api/mcp
DELETE /api/mcp/:name
POST   /api/mcp/:name/enable
POST   /api/mcp/:name/disable
```

### Doctor

```text
GET /api/doctor
```

Returns runtime, MCP, skills, security, index, and search summary.

## Workspace Agent

### `GET /api/agent/tasks`

Lists workspace-owned task summaries from `.ai-workspace/tasks`.

```text
GET /api/agent/tasks?type=code&limit=50
```

Response:

```json
{
  "tasks": [
    {
      "id": "task-...",
      "type": "code",
      "status": "checked",
      "scopePath": "Code/my-app",
      "message": "Change the greeting renderer",
      "summary": "Code task prepared for Code/my-app. ..."
    }
  ]
}
```

### `GET /api/agent/tasks/:id`

Returns the full task record from `.ai-workspace/tasks/:id.json`.

Task status values used by the general Workspace Agent path are:

```text
queued
running
approval_required
completed
failed
cancelled
```

When an MCP tool call needs approval, the task is stored as
`approval_required`. The task record includes `approvalIds[]` and a
`pendingState` object that the server can resume after approval. Clients should
show the approval inbox item instead of waiting on a long-polling tool call.

### `POST /api/agent/tasks/:id/resume`

Resumes a task that is waiting in `approval_required` state.

```json
{
  "approvalId": "approval-..."
}
```

The server replays the stored `pendingState` through the runtime with approval
already granted. If the task already finished, the response reports that it was
already resolved rather than running it again.

### `POST /api/agent/tasks/:id/cancel`

Cancels a queued, running, or `approval_required` task without executing its
pending state.

```json
{
  "reason": "User cancelled from the approval inbox."
}
```

### `GET /api/agent/approvals`

Lists workspace-owned approval inbox items from `.ai-workspace/approvals`.

```text
GET /api/agent/approvals?status=pending&limit=50
```

Response:

```json
{
  "approvals": [
    {
      "id": "approval-...",
      "status": "pending",
      "category": "code.patch.apply",
      "taskId": "task-...",
      "proposalId": "patch-...",
      "scopePath": "Code/my-app",
      "summary": "Proposed 1 change(s): replace Code/my-app/src/index.js",
      "diffRef": ".ai-workspace/diffs/task-...-patch-....diff"
    }
  ]
}
```

### `GET /api/agent/approvals/:id`

Returns the full approval record.

### `POST /api/agent/approvals/:id/respond`

Approves or rejects a workspace-owned approval request. For `code.patch.apply`,
approval applies the patch and rejection rejects the patch proposal. For
`code.checks.run`, approval runs the detected checks and rejection only records
the rejected decision. For `mcp.tool.call`, approval resumes the task's stored
`pendingState` and rejection fails that task without calling the MCP server.

Request:

```json
{
  "approved": true,
  "runChecksAfterApply": true,
  "checksApproved": true
}
```

Rejection:

```json
{
  "approved": false,
  "reason": "Needs a narrower patch."
}
```

### `POST /api/agent/code-task`

Starts the first Codex-style code task loop inside the Workspace Agent Engine.
This creates a workspace-owned code task. It reads the selected `Code/`
project, searches relevant text files, collects git status/diff information,
detects suggested check commands, creates a task record, writes tool/decision
logs, and returns an initial plan. It does not modify files by itself.

Request:

```json
{
  "scopePath": "Code/my-app",
  "instruction": "Change the greeting renderer",
  "maxFiles": 120,
  "maxSearchResults": 8
}
```

Response:

```json
{
  "ok": true,
  "engine": "workspace-agent",
  "runtime": "code-agent",
  "taskId": "task-...",
  "status": "inspected",
  "scopePath": "Code/my-app",
  "inspection": {
    "fileCount": 42,
    "suggestedCheckCommands": ["npm run test", "npm run build"]
  },
  "search": {
    "provider": "workspace-scan",
    "resultCount": 3
  },
  "git": {
    "isRepository": true,
    "status": "",
    "diffStat": "",
    "diffRef": ".ai-workspace/diffs/task-....diff"
  },
  "plan": {
    "summary": "Code task prepared for Code/my-app. ...",
    "steps": []
  },
  "taskMemory": {
    "readFiles": ["Code/my-app/src/index.js"],
    "proposedFiles": [],
    "changedFiles": [],
    "commands": [],
    "nextSteps": ["Use patch proposal APIs to create a diff first..."]
  }
}
```

Side effects under the workspace root:

```text
.ai-workspace/tasks/task-....json
.ai-workspace/tasks/events.jsonl
.ai-workspace/tool-logs/tool-events.jsonl
.ai-workspace/decisions/events.jsonl
.ai-workspace/diffs/task-....diff
```

The endpoint rejects scopes outside `Code/`.

### `POST /api/agent/code-task/:id/patches`

Creates a proposed patch for an existing code task. This endpoint writes a diff
artifact and updates the task record, but it does not change project files.

Safety rule:

```text
proposal only; no file writes happen here
```

Supported change forms:

```json
{
  "changes": [
    {
      "path": "src/index.js",
      "find": "return 'hello';",
      "replace": "return 'hello workspace';"
    },
    {
      "operation": "create",
      "path": "src/new-file.js",
      "content": "export const ready = true;\n"
    },
    {
      "operation": "write",
      "path": "README.md",
      "content": "# Updated README\n"
    },
    {
      "operation": "delete",
      "path": "src/old-file.js"
    }
  ]
}
```

Paths may be either project-relative, such as `src/index.js`, or full
workspace-relative paths under the task scope, such as
`Code/my-app/src/index.js`. Changes outside the original code task scope are
rejected.

Response:

```json
{
  "ok": true,
  "engine": "workspace-agent",
  "runtime": "code-agent",
  "taskId": "task-...",
  "status": "patch_proposed",
  "proposal": {
    "id": "patch-...",
    "status": "proposed",
    "summary": "Proposed 1 change(s): replace Code/my-app/src/index.js",
    "diffRef": ".ai-workspace/diffs/task-...-patch-....diff",
    "changes": [
      {
        "operation": "replace",
        "path": "Code/my-app/src/index.js",
        "oldHash": "...",
        "newHash": "..."
      }
    ]
  },
  "approvalRequired": true,
  "approvalRequest": {
    "type": "approval.request",
    "category": "code.patch.apply",
    "proposalId": "patch-..."
  }
}
```

.ai-workspace/tasks/task-....json
.ai-workspace/tool-logs/tool-events.jsonl
.ai-workspace/decisions/events.jsonl
.ai-workspace/diffs/task-...-patch-....diff

### `POST /api/agent/code-task/:id/patches/generate`

Invokes the configured model runtime to automatically generate a patch proposal for the code task. This streams response blocks, parses the resulting find/replace JSON changes, and proposes the patch (saving a diff artifact and queuing it for approval).

Response is identical to `POST /api/agent/code-task/:id/patches` on success.

### `POST /api/agent/code-task/:id/patches/:proposalId/apply`

Applies an approved patch proposal. This is the first file mutation step in the
Code Runtime.

Safety rules:

```text
approved: true is required
the proposal must still be in status=proposed
the target file content must match the proposal's oldHash
the target path must stay inside the original Code task scope
```

Request:

```json
{
  "approved": true,
  "runChecksAfterApply": false
}
```

Optional post-patch check orchestration:

```json
{
  "approved": true,
  "runChecksAfterApply": true,
  "checksApproved": true
}
```

`runChecksAfterApply` asks the runtime to continue into the task's detected
check commands immediately after writing the approved patch. Because shell/test
execution is a separate mutating capability, `checksApproved: true` is required
before any command runs. Without it, the patch can still be applied, but the
response includes a `checkApprovalRequest` instead of executing commands.

Response:

```json
{
  "ok": true,
  "engine": "workspace-agent",
  "runtime": "code-agent",
  "taskId": "task-...",
  "status": "patched",
  "proposalId": "patch-...",
  "filesChanged": ["Code/my-app/src/index.js"],
  "git": {
    "isRepository": true,
    "status": " M src/index.js",
    "diffRef": ".ai-workspace/diffs/task-...-after-patch-....diff"
  }
}
```

When checks are approved and requested, the response status reflects the check
result and includes `checkRun`:

```json
{
  "ok": true,
  "status": "checked",
  "proposalId": "patch-...",
  "filesChanged": ["Code/my-app/src/index.js"],
  "checkRun": {
    "allPassed": true,
    "commands": ["npm run test"]
  }
}
```

If the file changed after proposal creation, the endpoint returns a conflict and
does not write the patch. This avoids applying stale edits over user changes.

### `POST /api/agent/code-task/:id/patches/:proposalId/reject`

Rejects a proposed patch without modifying files. This records the user's
decision and leaves the task ready for a revised proposal.

Safety rules:

```text
the proposal must still be in status=proposed
no workspace files are written
```

Request:

```json
{
  "reason": "This changes the wrong file."
}
```

Response:

```json
{
  "ok": true,
  "engine": "workspace-agent",
  "runtime": "code-agent",
  "taskId": "task-...",
  "status": "patch_rejected",
  "proposalId": "patch-...",
  "taskMemory": {
    "nextSteps": [
      "Revise the patch proposal.",
      "Create a safer or more targeted patch before applying changes."
    ]
  }
}
```

Side effects are limited to Workspace Agent state:

```text
.ai-workspace/tasks/task-....json
.ai-workspace/tool-logs/tool-events.jsonl
.ai-workspace/decisions/events.jsonl
```

### `POST /api/agent/code-task/:id/checks`

Runs verification commands for an existing code task and appends the results to
the same task record. This is the first shell/test execution step in the
Codex-style loop.

Safety rule:

```text
approved: true is required
```

Without explicit approval the server returns an error and does not run a shell
command. If `commands` is omitted, the runtime uses the task's detected
`inspection.suggestedCheckCommands`.

Request using detected commands:

```json
{
  "approved": true,
  "timeoutMs": 60000
}
```

Request using custom commands:

```json
{
  "approved": true,
  "allowCustomCommands": true,
  "commands": ["npm run test", "npm run build"]
}
```

Response:

```json
{
  "ok": true,
  "engine": "workspace-agent",
  "runtime": "code-agent",
  "taskId": "task-...",
  "status": "checked",
  "checkRun": {
    "allPassed": true,
    "results": [
      {
        "command": "npm run test",
        "ok": true,
        "exitCode": 0,
        "stdout": "..."
      }
    ]
  }
}
```

The task is updated to `checked` when all commands pass and `check_failed` when
any command fails. The runtime also refreshes the task's git status/diff
artifact after running checks. The task's `taskMemory` also records executed
commands, compact check results, failure logs when present, and next steps.

### `POST /api/agent/code-task/:id/git`

Runs git operations (status, diff, add, commit, push) for an existing code task under the workspace root and appends execution records and logs to the task.

Safety rules (Strong Approval Policy):
- `approved: true` is strictly required.
- `git push` commands require explicit `gitPushApproved: true` or `dangerApproved: true`.
- `git push --force` or `-f` commands require explicit `dangerApproved: true` to bypass the block policy.

Request Body:

```json
{
  "approved": true,
  "command": "git commit -m 'Initial commit'"
}
```

Request Body for Git Push:

```json
{
  "approved": true,
  "gitPushApproved": true,
  "command": "git push origin main"
}
```

Response:

```json
{
  "ok": true,
  "engine": "workspace-agent",
  "runtime": "code-agent",
  "taskId": "task-...",
  "command": "git status",
  "result": {
    "ok": true,
    "exitCode": 0,
    "stdout": "..."
  }
}
```

## Runtime API

### `GET /api/models`

Returns AI Workspace model options from `.ai-workspace/config` and the built-in
provider registry.

### `GET /api/sessions`

Returns normalized AI Workspace sessions for client menus:

```json
{
  "sessions": [
    {
      "id": "20260707_...",
      "title": "Project planning",
      "model": "gpt-5.4-mini",
      "preview": "안녕",
      "updatedAt": "1783412528.4681878",
      "isActive": false
    }
  ]
}
```

### `GET /api/sessions/:id/messages`

Returns normalized saved messages for a session.

Response:

```json
{
  "sessionId": "20260707_...",
  "messages": [
    {
      "id": "756",
      "role": "user",
      "content": "안녕. 짧게 대답해줘.",
      "timestamp": "1783414076.431947",
      "toolName": "",
      "finishReason": ""
    },
    {
      "id": "757",
      "role": "assistant",
      "content": "안녕하세요.",
      "timestamp": "1783414086.3953931",
      "toolName": "",
      "finishReason": "stop"
    }
  ]
}
```

The Apple client uses this endpoint before `session.resume` so selecting an
existing session shows its previous user/assistant messages immediately.

### `DELETE /api/sessions/:id`

Deletes a saved AI Workspace session.

The Apple client disables deletion for the currently active live session and
shows a confirmation dialog before calling this endpoint.

### `POST /api/sessions`

Creates a saved AI Workspace session.

## Live API

The client can connect to:

```text
WS /api/live
```

Internally this WebSocket is routed through:

```text
WorkspaceAgentEngine
  -> ChatRuntime
  -> SessionRuntime
  -> ModelRuntime
  -> CodeAgentRuntime
```

The client protocol remains stable while the server gains an engine boundary.
That boundary is where future local/Codex-style code agent runtimes can be
added without changing the Apple app's live WebSocket API.

Client-friendly messages should stay close to runtime event names:

```json
{ "type": "message.delta", "sessionId": "...", "text": "..." }
{ "type": "thinking.delta", "sessionId": "...", "text": "..." }
{ "type": "tool.start", "sessionId": "...", "tool": "read_file" }
{ "type": "approval.request", "sessionId": "...", "approvalId": "..." }
```

### Client Commands

Client-to-server WebSocket messages are JSON:

```json
{ "id": "1", "command": "connect" }
```

Create a session:

```json
{
  "id": "2",
  "command": "session.create",
  "params": {
    "provider": "google-antigravity",
    "model": "claude-opus-4-6",
    "reasoningEffort": "medium",
    "accessMode": "confirm"
  }
}
```

Submit a prompt:

```json
{
  "id": "3",
  "command": "prompt.submit",
  "params": {
    "sessionId": "20260707_...",
    "message": "이 노트 요약해줘",
    "contextRequest": {
      "scopeType": "note",
      "scopePath": "Notes/Work/a.md"
    }
  }
}
```

Respond to an approval:

```json
{
  "id": "4",
  "command": "approval.respond",
  "params": {
    "sessionId": "20260707_...",
    "approved": true
  }
}
```

Run a Code Runtime command through the same live bridge:

```json
{
  "id": "5",
  "command": "code.task.create",
  "params": {
    "scopePath": "Code/my-app",
    "instruction": "Change the greeting renderer"
  }
}
```

Patch and check commands mirror the REST endpoints:

```json
{ "id": "6", "command": "code.patch.propose", "params": { "taskId": "task-...", "changes": [] } }
{ "id": "7", "command": "code.patch.apply", "params": { "taskId": "task-...", "proposalId": "patch-...", "approved": true } }
{ "id": "8", "command": "code.patch.reject", "params": { "taskId": "task-...", "proposalId": "patch-...", "reason": "Needs a narrower patch." } }
{ "id": "9", "command": "code.checks.run", "params": { "taskId": "task-...", "approved": true } }
```

Server responses use:

```json
{ "kind": "ready", "service": "ai-workspace-live" }
{ "kind": "result", "id": "3", "result": { "ok": true, "taskId": "task-..." } }
{ "kind": "runtime.event", "engine": "workspace-agent", "adapter": "ai-workspace-runtime", "type": "message.delta", "text": "..." }
{ "kind": "error", "id": "3", "error": "..." }
```

---

## Model / Provider / Auth Boundary

AI Workspace provider and credential APIs are owned by the runtime config store.
Do not add endpoints that bypass the runtime store:

```text
GET/POST /api/config
GET/POST /api/workspace/providers
PATCH/DELETE /api/workspace/providers/:id
GET/POST /api/workspace/credentials
DELETE /api/workspace/credentials/:id
POST /api/workspace/models/default
```

Use AI Workspace CLI commands:

```text
aiw model list
aiw model set-default <provider> <model>
aiw auth list
aiw auth set <provider> <key> <value>
aiw provider list
```

### `GET /api/models`

Returns the AI Workspace model list.

---

## LLM / Patch Generation API

### `POST /api/agent/code-task/:id/patch/auto`

Triggers LLM-authored automatic patch generation for a code task.

Body:

```json
{
  "instruction": "Change the greeting renderer"
}
```

Response (proposed patch stored as artifact):

```json
{
  "ok": true,
  "proposalId": "patch-...",
  "summary": "Updates greeting() to return 'auto-patched'.",
  "changes": [
    {
      "path": "Code/demo-app/src/index.js",
      "find": "return 'hello';",
      "replace": "return 'auto-patched';"
    }
  ]
}
```

The patch is stored under `.ai-workspace/diffs/` and requires explicit approval
before files are modified. Use `POST /api/agent/code-task/:id/patches/:proposalId/approve`
to approve and apply.

---

## Git Safety Policy

`POST /api/agent/code-task/:id/git`

Body:

```json
{ "command": "git status", "approved": true }
```

The following rules are enforced server-side regardless of input:

| Command class | Required flag |
| :--- | :--- |
| `git status`, `git add`, `git commit`, `git diff`, `git log` | `approved: true` |
| `git push` | `gitPushApproved: true` (or `dangerApproved: true`) |
| `git push --force` / `git push -f` | `dangerApproved: true` |
| Any argument containing `; & | > < \` $ ( )` | **Blocked unconditionally** |

Arguments are passed via `execFile` (no shell expansion). Shell metacharacters
in git argument tokens are rejected with a 400 error before execution.
