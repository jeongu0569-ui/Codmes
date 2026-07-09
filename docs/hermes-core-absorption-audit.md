# Hermes Core Absorption Audit

This document audits the absorption state of the Hermes core runtime inside AI Workspace, mapping implemented features, gaps, and implementation checklists.

## Feature Mapping Status

| Feature Area | Hermes Core Spec / Requirement | AI Workspace Implementation State | Status |
| :--- | :--- | :--- | :--- |
| **`config.yaml` 구조** | Storing model default selection & custom provider endpoint definitions. | Preserves nested structures and parses/writes in standard YAML format. | `implemented` |
| **`auth.json` 구조** | Storing multi-credential lists inside `credential_pool`. | Reads/writes credentials inside `$AIW_WORKSPACE_ROOT/.ai-workspace/config/auth.json`. | `implemented` |
| **Provider Registry** | Canonical provider identifiers with their models and credential mappings. | Defined inside `config-store.mjs` `BUILTIN_PROVIDERS` listing. | `implemented` |
| **Model Selection** | Extracting selected provider/model configurations. | Resolved from current default configuration or prompt arguments. | `implemented` |
| **Default Model 관리** | Scriptable and interactive default model selection. | Supported via `aiw model set-default` and interactive `aiw model`. | `implemented` |
| **Fallback Provider Chain** | Multi-provider fallback chain if defaults are missing. | Supports `fallback_chain` in config.yaml; loops over fallback targets on errors. | `implemented` |
| **Auth Flows** | Dynamic credential pool additions, list checks, and deletions. | Supported via `aiw auth set`, `aiw auth list`, and `aiw auth remove`. | `implemented` |
| **Session Lifecycle** | Create, resume, list, browse, rename, export, prune, and delete. | Fully supported in both CLI (`rename`, `export`, `prune`, `delete`) and TUI browser. | `implemented` |
| **Tool Registry** | Common core tools configuration and executor. | Workspace search, file reader, and directory tree lister are native. | `implemented` |
| **Tools Toggle** | Toggling specific tool activations. | Filters tools using `disabled_tools` list in config.yaml. Toggleable via CLI `aiw tools`. | `implemented` |
| **MCP Server Registry** | Managing Model Context Protocol servers. | Supports `mcp_servers` configuration. Commands `aiw mcp list/add/remove/enable/disable`. | `implemented` |
| **Skills / Plugins** | Custom bundle plugins and active skill injection. | Built-in guide skill is supported, but arbitrary plugin loading is absent. | `missing` |
| **Approvals & Security** | Safe action approval queues, hooks, and execution rules. | Task approval queue for code patches and git operations is native. | `partially implemented` |
| **Doctor & Diagnostics** | Diagnostic tests, status outputs, and tracing logs. | Fully supported via `aiw doctor` inspecting all configurations and connections. | `implemented` |
| **Prompt Assembly** | Assembling system instructions, file lists, and guidelines. | Dynamic context router joins files, folders, RAG guidelines, and memory. | `implemented` |
| **Websocket & Live API** | Real-time WebSocket connection upgrades and JSON-RPC stream. | Live socket broker upgraded via `websocket-utils.mjs`. | `implemented` |
| **Runtime Event Stream** | Standard turn/token streaming events (`message.delta`, `turn.complete`). | Emits rich token streaming events correctly. | `implemented` |
| **Memory & Rule Injections** | Injection of rules, `.agents`, `AGENTS.md`, and memory guidelines. | Memory directory structure exists, project-scoped memory rule injection is supported. | `partially implemented` |

---

## Implementation Checklists

### Phase 1: Core Lifecycle & Diagnostics (Completed)
- [x] Implement Fallback Provider Chain with recursive retry and `fallback.attempt` events.
- [x] Implement Session extensions: list, rename, export (markdown), prune (empty logs), and delete.
- [x] Add prune, rename, and export to TUI session browser.
- [x] Add Tools Toggle (`aiw tools list/enable/disable`) storing choices in config.yaml.
- [x] Add MCP Server Registry (`aiw mcp list/add/remove/enable/disable`) with registry configuration and stub execution.
- [x] Implement `aiw doctor` showing comprehensive workspace, config, auth, and network diagnostics.

### Phase 2: Skills & Security (Planned)
- [ ] Add generic approval hooks schema to config.yaml.
- [ ] Implement skill loading path configurations.
