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

`docsearch-mcp` should be treated as a server-side index/search capability, not
as a client plugin detail.

## Hermes Session Associations

```text
workspace_sessions
- hermes_session_id
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

The app should not duplicate Hermes messages. Hermes remains the source of truth
for conversation history while Hermes is the active adapter.

## Workspace Agent State

The newer agent-engine state root is:

```text
.ai-workspace/
├── sessions/
├── tasks/
├── memory/
├── decisions/
├── tool-logs/
├── diffs/
└── index/
```

This folder belongs to the Workspace Server, not to Hermes. It is designed so
Hermes-style chat and Codex-style code work can share one workspace-owned state
layer.

Current implemented files:

```text
.ai-workspace/sessions/events.jsonl
.ai-workspace/tasks/events.jsonl
.ai-workspace/tasks/task-<timestamp>-<uuid>.json
.ai-workspace/tool-logs/live-events.jsonl
.ai-workspace/tool-logs/tool-events.jsonl
```

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
```

This is intentionally small. It does not yet replace Hermes conversation
history. It records the Workspace Server's own view of the work so future code
agent loops can attach diffs, test results, shell output, approvals, and
decision logs to the same task id.

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
```

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

The task status becomes `checked` when all commands pass and `check_failed`
when any command exits non-zero.

When a code patch is proposed, the task also stores:

```text
patch_proposals[]
- id
- status: proposed | applied
- approved
- created_at
- applied_at
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

When an approved patch is applied, the task stores:

```text
files_changed[]
git.status
git.diff_stat
git.diff_ref
```

The task status becomes `patch_proposed` after a proposal and `patched` after
the approved proposal is applied. Check execution can then move it to `checked`
or `check_failed`.
