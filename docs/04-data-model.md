# Data Model

The first scaffold uses a JSON metadata file so the repository stays dependency
free. The intended production shape is SQLite first, then Postgres if multi-user
deployment needs it.

## Files

```text
files
- id
- relative_path
- kind
- size
- checksum
- created_at
- modified_at
- indexed_at
- index_status
```

The real file content stays on disk. The DB exists to track metadata that the
filesystem alone cannot represent reliably.

## Tags

```text
tags
- id
- name

file_tags
- file_id
- tag_id
```

Tags should be server metadata, not only YAML frontmatter. Frontmatter can be
imported/exported later.

## Links

```text
links
- from_file_id
- to_file_id
- link_type
```

Link types:

```text
markdown-link
pdf-link
attachment-link
code-reference
external-url
```

## Search Index State

```text
index_jobs
- id
- relative_path
- provider
- status
- started_at
- finished_at
- error

index_entries
- file_id
- provider
- indexed_at
- checksum
- chunk_count
```

Codmes Search state belongs to the server. Clients can configure roots and
embedding model settings, but they do not own the index files directly.

## Session Associations

```text
workspace_sessions
- session_id
- area
- scope_type
- scope_path
- last_opened_at
```

Areas:

```text
chat
notes
code
```

Codmes stores session rows and message history under `.codmes`.
External provider/runtime integrations may add their own runtime ids, but the
workspace session id is the app's source of truth.

## Workspace Agent State

The newer agent-engine state root is:

```text
.codmes/
├── sessions/
├── tasks/
├── memory/
├── approvals/
├── decisions/
├── tool-logs/
├── diffs/
└── index/
```

This folder belongs to Codmes Server. Chat, notes, search, approvals, and
code work share one workspace-owned state layer.

Current implemented files:

```text
.codmes/sessions/events.jsonl
.codmes/sessions/<sessionId>.json
.codmes/approvals/events.jsonl
.codmes/approvals/approval-<timestamp>-<uuid>.json
.codmes/tasks/events.jsonl
.codmes/tasks/task-<timestamp>-<uuid>.json
.codmes/tool-logs/live-events.jsonl
.codmes/tool-logs/tool-events.jsonl
.codmes/index/files.json
.codmes/conversation-index/sessions.jsonl
.codmes/conversation-index/summaries.jsonl
.codmes/conversation-index/messages.jsonl
.codmes/conversation-folders/folders.json
.codmes/tool-modes/user-overrides.json
.codmes/memory/user/memories.jsonl
.codmes/memory/projects/project-<id>.jsonl
.codmes/memory/folders/folder-<id>.json
.codmes/memory/sessions/session-summaries.jsonl
.codmes/memory/settings.json
.codmes/memory/candidates.jsonl
.codmes/memory/deleted-memory-hashes.jsonl
.codmes/audit/audit.jsonl
```

Model, provider, and auth config is stored under `.codmes/config`.
Credential storage is still an MVP file store and should later move to an
encrypted/keychain-backed store.

## Workspace-Owned Sessions

Workspace sessions are saved under `.codmes/sessions/<sessionId>.json` so that session history remains active and persistent across chat engines:

```json
{
  "id": "session-uuid",
  "title": "Code task discussion",
  "model": "anthropic/claude-3-5-sonnet",
  "preview": "",
  "updatedAt": "2026-07-09T02:00:00Z",
  "source": "workspace",
  "runtime": "chat-runtime",
  "isActive": true,
  "kind": "general",
  "surface": "chat",
  "folderId": null,
  "projectId": null,
  "visibleInSidebar": true,
  "archivedAt": null,
  "summary": {
    "content": "주제: Codmes, RAG\n결정: ...",
    "topics": ["Codmes", "RAG"],
    "entities": ["Codmes"],
    "decisions": ["..."],
    "preferences": ["..."],
    "sourceMessageIds": ["1", "2"],
    "coveredMessageIds": ["1", "2"],
    "updatedAt": "2026-07-09T02:00:00Z"
  }
}
```

The session summary is generated from visible user/assistant messages. It is
not a placeholder title. Prompt assembly uses the summary plus recent visible
messages and relevant memory instead of pasting all historical turns.

General unscoped `[Chat]` sessions use count-based sidebar retention. The
latest 30 visible general sessions remain visible; older overflow is archived.
Folder, project, pinned, active-code-task, and pending-approval sessions are
exempt from this overflow rule.

Task records currently store:

```text
id
type
status
created_at / updated_at
adapter
session_id
message
context_request
provider / model
access_mode
reasoning_effort
result or error
scope_path
inspection
search
git.diff_ref
plan
decision_ref
checks
patch_proposals
proposed_changes
files_changed
task_memory
```

General runtime task statuses are:

```text
queued
running
approval_required
completed
failed
cancelled
```

Code task flows can still use more specific code-runtime statuses such as
`patch_proposed`, `patched`, `checked`, or `check_failed`. Those statuses are
owned by `CodeAgentRuntime`. The general `approval_required` status is used
when an in-flight runtime operation, such as an MCP tool call, must pause for a
user decision.

Approval-gated runtime tasks also store:

```text
approval_ids[]
pending_state
```

`pending_state` is server-owned resume data. It is not a client command. The
client can show that a task has pending state, approve/reject the related
approval request, resume the task through the server, or cancel the task.

Approval records currently store:

```text
id
type: approval.request
status: pending | approved | rejected
category: code.patch.apply | code.checks.run | ...
task_id
proposal_id
scope_path
summary
diff_ref
commands[]
created_at
updated_at
responded_at
approved
reason
response
payload.pending_state
```

The approval inbox is workspace-owned. Code patch/check approvals can be listed,
resumed, approved, or rejected even if the chat stream is no longer visible.
MCP tool-call approvals use the same inbox. Approving one resumes the stored
task state; rejecting one records the decision and fails the waiting task.

## Tool Modes And Discovery State

Tool mode overrides live under:

```text
.codmes/tool-modes/user-overrides.json
```

Default modes are code-defined and surface-scoped:

```text
chat  -> conversation/memory/discovery tools
notes -> workspace/Codmes Search/read-note/file-metadata tools
code  -> CodeAgentRuntime search/read/git/patch/check tools
```

`tool_discovery` returns safe `expandedToolsForThisTurn` values. This expansion
is per-turn runtime state and is not persisted as a user setting. Approval
tools stay gated by `requiresApproval`.

## Conversation Index And Memory

Conversation search index files:

```text
.codmes/conversation-index/sessions.jsonl
.codmes/conversation-index/summaries.jsonl
.codmes/conversation-index/messages.jsonl
```

The index is derived from `.codmes/sessions/*.json`. It can be rebuilt
from session files and should not become the sole source of conversation data.

Long-term memory files:

```text
.codmes/memory/user/memories.jsonl
.codmes/memory/projects/project-<id>.jsonl
.codmes/memory/folders/folder-<id>.json
.codmes/memory/sessions/session-summaries.jsonl
```

Memory rows use this common shape:

```json
{
  "id": "memory-...",
  "type": "user_memory",
  "content": "사용자는 다크 모드 UI를 좋아한다.",
  "contentHash": "hash-of-normalized-content",
  "projectId": "project-alpha",
  "folderId": "folder-notes",
  "sourceSessionIds": ["session-..."],
  "sourceMessageIds": ["1", "2"],
  "tags": ["Codmes"],
  "createdAt": "2026-07-09T02:00:00Z",
  "updatedAt": "2026-07-09T02:00:00Z",
  "pinned": false
}
```

Memory rows are upserted by `id`, then `contentHash`, then very close normalized
content. When duplicates are merged, source session/message ids and tags are
accumulated and `updatedAt` is refreshed.

Default memory settings are:

```json
{
  "autoSaveProjectMemory": true,
  "autoSaveFolderMemory": true,
  "autoSaveSessionSummaryMemory": true,
  "autoSaveUserMemory": false,
  "memoryReviewRequired": true
}
```

Project, folder, and session-summary memory can be saved automatically.
User-global memory is a candidate by default so the user can approve, reject,
or edit it before it becomes durable memory. Sensitive-looking memory also goes
to review.

Deleted memories write tombstones:

```json
{
  "id": "deleted-memory-...",
  "memoryId": "memory-...",
  "contentHash": "hash-of-normalized-content",
  "reason": "user_deleted",
  "deletedAt": "2026-07-09T02:00:00Z"
}
```

The extraction pipeline checks tombstones so a deleted/edited memory is not
immediately regenerated from the same session summary.

Memory extraction currently uses deterministic heuristics from session summary
and recent user/assistant messages. The store is intentionally simple so a
future embedding-backed memory ranker can replace only the retrieval layer.

Security audit records currently store:

```text
id
actionType
status: allowed | denied | approval_required | approved | rejected
reason
createdAt
sessionId
taskId
command
path
serverName
toolName
```

The first implementation writes audit rows from the security policy evaluator
for denied, approval-required, and risky write/execute action checks.

This records Codmes Server's own view of the work so code agent loops can
attach diffs, test results, shell output, approvals, and decision logs to the
same task id.

The current code inspect task already adds:

```text
scope_path
inspection.file_count
inspection.files
inspection.package
inspection.markers
inspection.suggested_check_commands
search.results
git.status
git.diff_stat
git.diff_ref
plan.steps
decision_ref
task_memory
```

`task_memory` is the compact, loop-friendly summary of the task. The detailed
records stay in `inspection`, `search`, `patch_proposals`, `checks`, and the
JSONL logs, while `task_memory` gives the next agent step a stable place to
look.

```text
task_memory
- read_files[]
- proposed_files[]
- changed_files[]
- commands[]
- check_results[]
- failure_logs[]
- next_steps[]
- notes[]
```

The Code Runtime updates this memory after inspect, patch proposal, patch
apply, and check execution. It is intentionally bounded so task records do not
grow without limit.

When code checks are executed, the task also stores:

```text
checks[]
- id
- approved
- started_at
- finished_at
- scope_path
- commands
- all_passed
- results[]
  - command
  - ok
  - exit_code
  - duration_ms
  - stdout
  - stderr
```

When git commands are executed, the task also stores:

```text
gitRuns[]
- command
- ok
- exit_code
- stdout
- stderr
- duration_ms
- started_at
- finished_at
```

The task status becomes `checked` when all commands pass and `check_failed`
when any command exits non-zero.

When a code patch is proposed, the task also stores:

```text
patch_proposals[]
- id
- status: proposed | applied | rejected
- approved
- created_at
- applied_at
- rejected_at
- rejection_reason
- scope_path
- summary
- diff_ref
- changes[]
  - operation: write | create | replace | delete
  - path
  - existed
  - old_hash
  - new_hash
  - old_size
  - new_size
  - content

proposed_changes[]
- operation
- path
- existed
- old_hash
- new_hash
- old_size
- new_size
```

`patch_proposals[].changes[].content` is kept so the server can apply the
approved proposal later without trusting the client to resend the same patch.
The client-facing response omits `content` and only returns metadata plus the
diff artifact reference.

When a proposed patch is rejected, the proposal stores `rejected_at` and
`rejection_reason`, the task records a `code.patch.rejected` decision, and no
workspace file is modified.

When an approved patch is applied, the task stores:

```text
files_changed[]
git.status
git.diff_stat
git.diff_ref
```

The task status becomes `patch_proposed` after a proposal, `patch_rejected`
after a denied proposal, and `patched` after the approved proposal is applied.
Check execution can then move it to `checked` or `check_failed`. When
`runChecksAfterApply` and `checksApproved` are both supplied to the apply
endpoint, the transition can happen in one orchestration step:
`patch_proposed -> patched -> checked` or
`patch_proposed -> patched -> check_failed`.
