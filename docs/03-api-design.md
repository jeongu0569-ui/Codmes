# API Design

Base URL during local development:

```text
http://127.0.0.1:8787
```

## Workspace

### `GET /api/health`

Returns service health.

### `GET /api/workspace`

Returns configured workspace root, top-level roots, and Hermes connection
status. It also reports the active workspace agent engine capabilities:

```json
{
  "agent": {
    "engine": "workspace-agent",
    "statePath": ".ai-workspace",
    "adapters": ["hermes-live"],
    "runtimes": ["code-agent"],
    "taskEndpoint": "/api/agent/tasks",
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

### `GET /api/raw?path=Documents/a.pdf`

Streams a raw file. This is useful for PDFs and images.

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

## Context Router

### `POST /api/context`

Builds a Hermes-ready workspace context object from a client mention/scope
request.

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

Side effects:

```text
.ai-workspace/tasks/task-....json
.ai-workspace/tool-logs/tool-events.jsonl
.ai-workspace/decisions/events.jsonl
.ai-workspace/diffs/task-...-patch-....diff
```

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
  "approved": true
}
```

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

## Hermes Proxy

### `GET /api/hermes/models`

Proxies Hermes model options.

Current target:

```text
GET {HERMES_SERVER_URL}/api/model/options
```

### `GET /api/hermes/sessions`

Returns normalized Hermes sessions for client menus.

Current target:

```text
GET {HERMES_SERVER_URL}/api/sessions?limit=200
```

Hermes may return raw session rows where `title` is empty and the generated
session id is the only stable value. The Workspace Server filters archived or
empty zero-message sessions and returns a compact shape:

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

### `GET /api/hermes/sessions/:id/messages`

Returns normalized saved messages for a Hermes session.

Current target:

```text
GET {HERMES_SERVER_URL}/api/sessions/:id/messages
```

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

### `DELETE /api/hermes/sessions/:id`

Deletes a Hermes session through the dashboard API.

Current target:

```text
DELETE {HERMES_SERVER_URL}/api/sessions/:id
```

The Apple client disables deletion for the currently active live session and
shows a confirmation dialog before calling this endpoint.

### `POST /api/hermes/sessions`

Creates a Hermes session through the REST endpoint when available.

Live WebSocket session creation will be added separately because it needs a
stateful `/api/ws` bridge.

## Live API

The client can connect to:

```text
WS /api/live
```

The Workspace Server then connects to Hermes:

```text
POST /api/auth/ws-ticket
WS   /api/ws?ticket=...
```

Internally this WebSocket is now routed through:

```text
WorkspaceAgentEngine
  -> HermesAgentAdapter
  -> HermesLiveClient
```

The client protocol remains stable while the server gains an engine boundary.
That boundary is where future local/Codex-style code agent runtimes can be
added without changing the Apple app's live WebSocket API.

Client-friendly messages should stay close to Hermes event names:

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

Create a Hermes session:

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
{ "kind": "hermes.event", "engine": "workspace-agent", "adapter": "hermes-live", "type": "message.delta", "text": "..." }
{ "kind": "error", "id": "3", "error": "..." }
```

The event kind is still named `hermes.event` for client compatibility. New
server work should treat `engine` and `adapter` as the more durable boundary.
