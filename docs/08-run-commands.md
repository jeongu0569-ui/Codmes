# Run Commands

## Server

```bash
cd /Users/user/Desktop/AI-Workspace-on-hermes

AIW_WORKSPACE_ROOT="$HOME/AIWorkspace" \
AIW_HOST="127.0.0.1" \
AIW_PORT="8787" \
aiw serve
```

Optional bearer-token protection:

```bash
AIW_WORKSPACE_ROOT="$HOME/AIWorkspace" \
AIW_HOST="0.0.0.0" \
AIW_PORT="8787" \
AIW_SERVER_TOKEN="choose-a-long-local-token" \
aiw serve
```

When `AIW_SERVER_TOKEN` is set, the Apple client must store the same token in
Settings. CLI commands also read `AIW_SERVER_TOKEN` and send it as
`Authorization: Bearer <token>`.

Equivalent development command:

```bash
AIW_WORKSPACE_ROOT="$HOME/AIWorkspace" npm start
```

For iPhone/iPad testing over Tailscale or LAN:

```bash
AIW_WORKSPACE_ROOT="$HOME/AIWorkspace" \
AIW_HOST="0.0.0.0" \
AIW_PORT="8787" \
aiw serve
```

Then connect the app to:

```text
http://<server-ip-or-tailscale-ip>:8787
```

## Status

```bash
aiw status
aiw status --json
curl http://127.0.0.1:8787/api/workspace
```

## Index

```bash
aiw index status
aiw index rebuild
aiw index search "architecture" --scope Notes --limit 10
```

Current index state is stored at:

```text
<workspace>/.ai-workspace/index/files.json
```

Expected runtime fields:

```json
{
  "runtime": {
    "status": "ok",
    "owner": "ai-workspace",
    "configPath": ".ai-workspace/config"
  }
}
```

## Models / Providers / Auth

```bash
npm run runtime:bootstrap
aiw model
aiw provider list
aiw model list
aiw model set-default openai-api gpt-5.4-mini
aiw auth list
aiw auth set openai-api OPENAI_API_KEY sk-...
```

Credential config is stored under:

```text
<workspace>/.ai-workspace/config/auth.json
```

Runtime config is stored under:

```text
<workspace>/.ai-workspace/config/config.yaml
```

Environment variables with the `AIW_` prefix are also detected where relevant:

```bash
export AIW_OPENAI_API_KEY="sk-..."
export AIW_OLLAMA_BASE_URL="http://127.0.0.1:11434"
export AIW_LMSTUDIO_BASE_URL="http://127.0.0.1:1234/v1"
```


### First Model Execution Backend

AI Workspace owns a first OpenAI-compatible execution backend. Configure a
provider/model pair, then `WS /api/live` can stream `message.delta` events
without starting a separate AI runtime server.

OpenAI API example:

```bash
aiw model set-default openai-api gpt-5.4-mini
aiw auth set openai-api OPENAI_API_KEY sk-...
```

LM Studio example:

```bash
aiw model set-default lmstudio local-model
aiw auth set lmstudio LM_BASE_URL http://127.0.0.1:1234/v1
```

Custom OpenAI-compatible endpoint example:

```bash
aiw model set-default custom my-model
aiw auth set custom AIW_CUSTOM_BASE_URL http://127.0.0.1:1234/v1
aiw auth set custom AIW_CUSTOM_API_KEY local-dev-key
```

Local Ollama shortcut:

```bash
aiw ollama
aiw ollama --model gemma4:e2b-mlx
```

The interactive route is `aiw model` -> `Ollama` -> `Ollama Local`. It stores
the dedicated `ollama-local` provider rather than disguising the server as a
generic custom endpoint. The Apple Settings screen uses the same provider and
model APIs.

The literal `ollama launch aiw` integration must be added by Ollama upstream;
the local `aiw ollama` command performs the equivalent AI Workspace setup.

When the selected model supports OpenAI-compatible tool calls, AI Workspace
filters tools by surface:

```text
chat:
  conversation_search
  conversation_read
  memory_search
  tool_discovery

notes:
  workspace_search
  docsearch_search
  read_note_file
  read_file_metadata

code:
  search_project
  read_project_file
  inspect_git
  get_git_diff
  propose_patch
  apply_patch        (approval-gated)
  run_checks         (approval-gated)
  run_git_command    (approval-gated)
```

These tools run inside the Workspace Server, so the client can show
`tool.start` / `tool.complete` activity without handing raw filesystem access
to the model provider. `tool_discovery` can temporarily add safe tools to the
current turn, but it does not auto-enable approval-gated tools.

## Workspace APIs

```bash
curl http://127.0.0.1:8787/api/tree?root=notes
curl http://127.0.0.1:8787/api/models
curl http://127.0.0.1:8787/api/sessions
curl http://127.0.0.1:8787/api/doctor
curl http://127.0.0.1:8787/api/tool-modes
curl http://127.0.0.1:8787/api/tools/available
```

Create a session:

```bash
curl -X POST http://127.0.0.1:8787/api/sessions \
  -H 'content-type: application/json' \
  -d '{"title":"Test session","model":"gpt-5.4-mini"}'
```

## Code Tasks

```bash
aiw code create Code/demo-app "change the greeting"
aiw code list
aiw approvals list
```

General task resume/cancel commands:

```bash
aiw tasks list
aiw tasks show <taskId>
aiw tasks resume <taskId>
aiw tasks cancel <taskId> --reason "No longer needed"
```

Runtime work that needs approval, such as a policy-gated MCP tool call, is
stored as `approval_required` instead of blocking the server while it waits.
After approval, `aiw tasks resume <taskId>` or
`POST /api/agent/approvals/:id/respond` can continue the saved pending state.

General `[Chat]` sessions that are not attached to a folder or project are
kept as a rolling visible set. The latest 30 remain in the sidebar; older
overflow is archived. Pinned sessions and sessions with pending approvals are
not auto-archived.

Conversation search/read examples:

```bash
curl -X POST http://127.0.0.1:8787/api/conversations/search \
  -H 'content-type: application/json' \
  -d '{"query":"저번주에 들었던 음악","timeRange":"last_week"}'

curl -X POST http://127.0.0.1:8787/api/conversations/read \
  -H 'content-type: application/json' \
  -d '{"sessionId":"session-...","messageIds":["1"],"includeSurroundingMessages":true}'
```

Memory search/extraction examples:

```bash
curl 'http://127.0.0.1:8787/api/memory/search?query=dark%20mode&maxResults=5'

curl -X POST http://127.0.0.1:8787/api/memory/extract-from-session \
  -H 'content-type: application/json' \
  -d '{"sessionId":"session-..."}'
```

Manual patch proposal:

```bash
aiw code patch <taskId> \
  --path src/index.js \
  --find "return 'hello';" \
  --replace "return 'hello workspace';"
```

Apply after approval:

```bash
aiw code apply <taskId> <proposalId> --check --command "npm test"
```

## Apple Client

```bash
cd /Users/user/Desktop/AI-Workspace-on-hermes/client/apple
swift run AIWorkspace
```

In the app settings, set the server URL to:

```text
http://127.0.0.1:8787
```

For iPhone/iPad, use the Mac server's LAN or Tailscale address.

## Logs

For a background server:

```bash
cd /Users/user/Desktop/AI-Workspace-on-hermes

AIW_WORKSPACE_ROOT="$HOME/AIWorkspace" \
AIW_HOST="0.0.0.0" \
AIW_PORT="8787" \
node server/index.mjs > /tmp/ai-workspace.log 2>&1 &

echo $! > /tmp/ai-workspace.pid
tail -f /tmp/ai-workspace.log
```

Stop it:

```bash
kill "$(cat /tmp/ai-workspace.pid)"
```
