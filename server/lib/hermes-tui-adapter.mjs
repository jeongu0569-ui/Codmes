import http from "node:http";

import { createWorkspaceAgentEngine } from "./agent-engine.mjs";
import { acceptWebSocket, createFrameDecoder, encodeWebSocketFrame } from "./websocket-utils.mjs";
import { listSkills } from "./runtime/skill-registry.mjs";
import { TOOL_REGISTRY } from "./runtime/tool-discovery.mjs";
import { WORKSPACE_TOOL_DEFINITIONS } from "./runtime/workspace-tools.mjs";
import {
  listCredentialStatus,
  listProviderRegistry,
  listRuntimeModels,
  readRuntimeConfig,
  removeCredentialValue,
  setCredentialValue,
  setDefaultModel
} from "./runtime/config-store.mjs";

export async function startHermesTuiAdapter({ workspaceRoot }) {
  const engine = createWorkspaceAgentEngine({ workspaceRoot });
  const sessions = new Map();
  const pendingApprovals = new Map();
  let activeSessionId = "";

  await engine.connect();

  async function getConfig() {
    return await readRuntimeConfig(workspaceRoot).catch(() => ({}));
  }

  const server = http.createServer((req, res) => {
    res.writeHead(404);
    res.end("Not found");
  });

  const sockets = new Set();
  const broadcast = (event) => {
    for (const socket of sockets) {
      sendEvent(socket, event);
    }
  };

  engine.on("event", (event) => {
    const sessionId = event.sessionId || activeSessionId;
    if (!sessionId) return;
    if (event.type === "approval.request" && event.approvalId) {
      pendingApprovals.set(sessionId, event.approvalId);
    }
    const mapped = mapCodmesEventToHermesTui(event, sessionId);
    for (const item of mapped) broadcast(item);
  });

  server.on("upgrade", (req, socket) => {
    try {
      acceptWebSocket(req, socket);
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
      socket.on("error", () => sockets.delete(socket));
      sendEvent(socket, {
        type: "gateway.ready",
        payload: {
          skin: codmesSkin()
        }
      });

      const decode = createFrameDecoder(async (text) => {
        let message;
        try {
          message = JSON.parse(text);
        } catch {
          sendError(socket, null, "Invalid JSON-RPC frame.");
          return;
        }
        if (!message?.id || !message.method) return;
        try {
          const result = await handleRpc(message.method, message.params || {});
          sendResult(socket, message.id, result);
        } catch (error) {
          sendError(socket, message.id, error?.message || "Request failed.");
        }
      }, () => {
        sockets.delete(socket);
        socket.destroy();
      });
      socket.on("data", decode);
    } catch (error) {
      socket.destroy(error);
    }
  });

  async function handleRpc(method, params) {
    const config = await getConfig();
    if (method === "setup.status") {
      return {
        provider_configured: Boolean(config.defaultModel?.provider && config.defaultModel?.model)
      };
    }
    if (method === "config.get") {
      return configValue(params);
    }
    if (method === "config.set") {
      if (String(params.key || "") === "model") {
        const next = parseModelSelection(params.value);
        if (!next.model) return { value: "" };
        const provider = next.provider || config.defaultModel?.provider || "";
        if (!provider) return { value: next.model, warning: "provider missing; use /model picker to select a provider" };
        await setDefaultModel(workspaceRoot, provider, next.model);
        const label = `${next.model} --provider ${provider}`;
        broadcast({
          type: "session.info",
          session_id: String(params.session_id || activeSessionId || ""),
          payload: await sessionInfo(await getConfig(), workspaceRoot)
        });
        return { value: label };
      }
      return { value: params.value };
    }
    if (method === "session.create") {
      const session = await engine.createSession({
        provider: config.defaultModel?.provider,
        model: config.defaultModel?.model,
        title: `Codmes Chat ${new Date().toLocaleString()}`
      });
      activeSessionId = session.sessionId;
      const info = await sessionInfo(config, workspaceRoot);
      sessions.set(activeSessionId, {
        id: activeSessionId,
        info,
        started_at: Date.now() / 1000,
        title: session.title || "Codmes Chat",
        messages: []
      });
      broadcast({ type: "session.info", session_id: activeSessionId, payload: info });
      return { session_id: activeSessionId, info };
    }
    if (method === "session.resume" || method === "session.activate") {
      const id = String(params.session_id || activeSessionId || "");
      if (id) activeSessionId = id;
      const entry = sessions.get(activeSessionId) || await runtimeSessionEntry(engine, activeSessionId, config, workspaceRoot);
      if (entry) sessions.set(activeSessionId, entry);
      return {
        session_id: activeSessionId,
        info: entry?.info || await sessionInfo(config, workspaceRoot),
        messages: entry?.messages || [],
        message_count: entry?.messages?.length || 0,
        running: false,
        status: "idle"
      };
    }
    if (method === "session.active_list") {
      return {
        sessions: await activeSessionRows(engine, sessions, activeSessionId, config)
      };
    }
    if (method === "session.list") {
      return {
        sessions: await historySessionRows(engine, sessions)
      };
    }
    if (method === "session.delete") {
      const id = String(params.session_id || "");
      sessions.delete(id);
      if (id) await engine.deleteSession(id);
      return { deleted: id };
    }
    if (method === "session.title") {
      const id = String(params.session_id || activeSessionId || "");
      const title = String(params.title || "").trim();
      if (!id) return {};
      if (!title) {
        const entry = await runtimeSessionEntry(engine, id, config, workspaceRoot);
        return { title: entry?.title || "" };
      }
      await engine.renameSession(id, title);
      const existing = sessions.get(id);
      if (existing) existing.title = title;
      return { title };
    }
    if (method === "session.most_recent") {
      const rows = await historySessionRows(engine, sessions);
      const row = rows[0];
      return row ? { session_id: row.id, title: row.title, started_at: row.started_at, source: row.source || "workspace" } : {};
    }
    if (method === "session.usage") return sessionUsage();
    if (method === "session.interrupt") return { ok: true };
    if (method === "input.detect_drop") return { matched: false };
    if (method === "complete.slash") return slashCompletion(params);
    if (method === "complete.path") return { items: [], replace_from: 0 };
    if (method === "commands.catalog") return commandsCatalog();
    if (method === "model.options") return await modelOptions(workspaceRoot, config);
    if (method === "model.save_key") return await saveModelKey(workspaceRoot, params);
    if (method === "model.disconnect") return await disconnectModel(workspaceRoot, params);
    if (method === "prompt.submit") {
      const sessionId = String(params.session_id || activeSessionId || "");
      const text = String(params.text || "");
      if (!sessionId) throw new Error("session not ready");
      sessions.get(sessionId)?.messages.push({ role: "user", text });
      queueMicrotask(() => {
        engine.submitPrompt({
          sessionId,
          message: text,
          provider: config.defaultModel?.provider,
          model: config.defaultModel?.model,
          wait: true
        }).then((result) => {
          sessions.get(sessionId)?.messages.push({ role: "assistant", text: result.reply || "" });
        }).catch((error) => {
          broadcast({
            type: "error",
            session_id: sessionId,
            payload: { message: error?.message || "prompt failed" }
          });
          broadcast({
            type: "status.update",
            session_id: sessionId,
            payload: { text: "ready", kind: "idle" }
          });
        });
      });
      return { ok: true };
    }
    if (method === "approval.respond") {
      return await respondToTuiApproval(engine, pendingApprovals, params);
    }
    if (method === "slash.exec") return await runSlashCommand(engine, sessions, params, config, workspaceRoot);
    if (method === "command.dispatch") return { type: "exec", output: "" };
    if (method === "logs.tail") return { lines: [] };
    return {};
  }

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    url: `ws://127.0.0.1:${port}`,
    close() {
      for (const socket of sockets) socket.destroy();
      engine.close();
      server.close();
    }
  };
}

function sendEvent(socket, event) {
  sendFrame(socket, { jsonrpc: "2.0", method: "event", params: event });
}

function sendResult(socket, id, result) {
  sendFrame(socket, { jsonrpc: "2.0", id, result });
}

function sendError(socket, id, message) {
  sendFrame(socket, { jsonrpc: "2.0", id, error: { message } });
}

function sendFrame(socket, value) {
  if (!socket.destroyed) socket.write(encodeWebSocketFrame(value));
}

async function sessionInfo(config, workspaceRoot) {
  return {
    cwd: workspaceRoot || process.cwd(),
    model: config.defaultModel?.model || "no-model",
    profile_name: "codmes",
    reasoning_effort: "medium",
    skills: await sessionSkills(workspaceRoot),
    tools: sessionTools(),
    usage: sessionUsage(),
    version: "Codmes"
  };
}

async function sessionSkills(workspaceRoot) {
  const skills = await listSkills(workspaceRoot).catch(() => []);
  const enabled = skills
    .filter((skill) => skill.config?.enabled)
    .map((skill) => skill.name)
    .filter(Boolean);
  return enabled.length ? { enabled } : {};
}

function sessionTools() {
  const groups = {};
  for (const tool of TOOL_REGISTRY) {
    const group = tool.group || "tools";
    if (!groups[group]) groups[group] = [];
    if (!groups[group].includes(tool.name)) groups[group].push(tool.name);
  }
  const definedNames = new Set(WORKSPACE_TOOL_DEFINITIONS.map((tool) => tool.function?.name).filter(Boolean));
  for (const name of definedNames) {
    if (Object.values(groups).some((items) => items.includes(name))) continue;
    if (!groups.workspace_tools) groups.workspace_tools = [];
    groups.workspace_tools.push(name);
  }
  groups.discovery = ["tool_discovery"];
  return groups;
}

function sessionUsage() {
  return {
    calls: 0,
    context_max: 1_000_000,
    context_percent: 0,
    context_used: 0,
    input: 0,
    output: 0,
    total: 0
  };
}

function configValue(params) {
  const key = String(params.key || "");
  if (key === "full") {
    return {
      config: {
        display: {
          busy_input_mode: "queue",
          details_mode: "collapsed",
          mouse_tracking: "all",
          sections: {
            thinking: "collapsed",
            tools: "collapsed",
            activity: "collapsed"
          },
          show_reasoning: true,
          streaming: true,
          tui_statusbar: "bottom"
        },
        paste_collapse_threshold: 5,
        paste_collapse_char_threshold: 2000,
        voice: {
          record_key: "ctrl+r"
        }
      }
    };
  }
  if (key === "mtime") return { mtime: Date.now() / 1000 };
  return { value: "" };
}

function parseModelSelection(value) {
  const parts = String(value || "").trim().split(/\s+/).filter(Boolean);
  const modelParts = [];
  let provider = "";
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    if (part === "--provider") {
      provider = parts[index + 1] || "";
      index += 1;
      continue;
    }
    if (part === "--global" || part === "--tui-session") continue;
    modelParts.push(part);
  }
  return {
    model: modelParts.join(" ").trim(),
    provider
  };
}

async function modelOptions(workspaceRoot, config) {
  const [registry, statuses, runtimeModels] = await Promise.all([
    Promise.resolve(listProviderRegistry()),
    listCredentialStatus(workspaceRoot).catch(() => []),
    listRuntimeModels(workspaceRoot).catch(() => [])
  ]);
  const statusByProvider = new Map(statuses.map((status) => [status.provider, status]));
  const runtimeModelsByProvider = new Map();
  for (const row of runtimeModels) {
    if (!row.provider || !row.model) continue;
    const list = runtimeModelsByProvider.get(row.provider) || [];
    if (!list.includes(row.model)) list.push(row.model);
    runtimeModelsByProvider.set(row.provider, list);
  }
  const currentProvider = config.defaultModel?.provider || "";
  const currentModel = config.defaultModel?.model || "";
  return {
    providers: registry.map((provider) => {
      const status = statusByProvider.get(provider.id) || {};
      const models = Array.from(new Set([
        ...(runtimeModelsByProvider.get(provider.id) || []),
        ...(provider.models || [])
      ])).filter(Boolean);
      return {
        slug: provider.id,
        name: provider.name,
        auth_type: provider.authType,
        authenticated: Boolean(status.configured),
        is_current: provider.id === currentProvider,
        key_env: provider.env?.[0] || provider.baseUrlEnv || "",
        models,
        total_models: models.length,
        warning: status.configured ? "" : provider.authType === "none" ? "" : credentialWarning(provider)
      };
    }),
    current_provider: currentProvider,
    current_model: currentModel,
    model: currentModel,
    provider: currentProvider
  };
}

async function saveModelKey(workspaceRoot, params) {
  const slug = String(params.slug || "");
  const provider = listProviderRegistry().find((item) => item.id === slug);
  if (!provider) throw new Error(`Unknown provider: ${slug}`);
  const key = provider.env?.[0] || "CODMES_API_KEY";
  await setCredentialValue(workspaceRoot, slug, key, String(params.api_key || ""));
  const config = await readRuntimeConfig(workspaceRoot).catch(() => ({}));
  const options = await modelOptions(workspaceRoot, config);
  return { provider: options.providers.find((item) => item.slug === slug) };
}

async function disconnectModel(workspaceRoot, params) {
  const slug = String(params.slug || "");
  await removeCredentialValue(workspaceRoot, slug);
  return { disconnected: true };
}

function credentialWarning(provider) {
  if (provider.authType === "api_key") return provider.env?.[0] ? `paste ${provider.env[0]} to activate` : "API key required";
  if (provider.authType?.startsWith("oauth")) return "run `codmes model` to connect this account";
  if (provider.authType === "external_process") return "external provider setup required";
  return "not configured";
}

async function runtimeSessionEntry(engine, sessionId, config, workspaceRoot) {
  if (!sessionId) return null;
  const [listed, messages] = await Promise.all([
    engine.listSessions(500).catch(() => ({ sessions: [] })),
    engine.getSessionMessages(sessionId).catch(() => ({ messages: [] }))
  ]);
  const meta = (listed.sessions || []).find((session) => session.id === sessionId) || {};
  const mappedMessages = (messages.messages || []).map((message) => ({
    role: message.role === "assistant" || message.role === "user" || message.role === "tool" ? message.role : "system",
    text: message.content || message.text || ""
  })).filter((message) => message.text);
  return {
    id: sessionId,
    info: await sessionInfo(config, workspaceRoot),
    started_at: toEpochSeconds(meta.createdAt || meta.startedAt || meta.updatedAt),
    title: meta.title || sessionTitleFromMessages(mappedMessages) || sessionId,
    messages: mappedMessages,
    source: meta.source || "workspace",
    model: meta.model || config.defaultModel?.model || "",
    preview: meta.preview || mappedMessages.at(-1)?.text || ""
  };
}

async function activeSessionRows(engine, memorySessions, activeSessionId, config) {
  const history = await historySessionRows(engine, memorySessions);
  const byId = new Map(history.map((session) => [session.id, session]));
  for (const session of memorySessions.values()) {
    byId.set(session.id, normalizeSessionRow(session, config, activeSessionId));
  }
  if (activeSessionId && !byId.has(activeSessionId)) {
    byId.set(activeSessionId, {
      id: activeSessionId,
      current: true,
      last_active: Date.now() / 1000,
      message_count: 0,
      model: config.defaultModel?.model || "",
      preview: "",
      started_at: Date.now() / 1000,
      status: "idle",
      title: activeSessionId
    });
  }
  return Array.from(byId.values()).map((session) => ({
    ...session,
    current: session.id === activeSessionId,
    last_active: session.last_active || session.started_at,
    model: session.model || config.defaultModel?.model || "",
    status: session.status || "idle"
  }));
}

async function historySessionRows(engine, memorySessions) {
  const listed = await engine.listSessions(200).catch(() => ({ sessions: [] }));
  const rows = (listed.sessions || []).map((session) => ({
    id: session.id,
    message_count: Array.isArray(session.messages) ? session.messages.length : Number(session.messageCount || session.message_count || 0),
    preview: session.preview || session.summary || session.message || "",
    source: session.source || "workspace",
    started_at: toEpochSeconds(session.createdAt || session.startedAt || session.updatedAt),
    title: session.title || session.name || session.id
  }));
  const byId = new Map(rows.map((session) => [session.id, session]));
  for (const session of memorySessions.values()) {
    byId.set(session.id, {
      ...byId.get(session.id),
      id: session.id,
      message_count: session.messages?.length || byId.get(session.id)?.message_count || 0,
      preview: session.messages?.at(-1)?.text || byId.get(session.id)?.preview || "",
      source: "live",
      started_at: session.started_at || byId.get(session.id)?.started_at || Date.now() / 1000,
      title: session.title || byId.get(session.id)?.title || session.id
    });
  }
  return Array.from(byId.values()).sort((a, b) => (b.started_at || 0) - (a.started_at || 0));
}

function normalizeSessionRow(session, config, activeSessionId) {
  return {
    id: session.id,
    current: session.id === activeSessionId,
    last_active: session.started_at,
    message_count: session.messages?.length || 0,
    model: session.model || config.defaultModel?.model || "",
    preview: session.messages?.at(-1)?.text || session.preview || "",
    started_at: session.started_at || Date.now() / 1000,
    status: "idle",
    title: session.title || session.id
  };
}

function sessionTitleFromMessages(messages) {
  const firstUser = messages.find((message) => message.role === "user")?.text || "";
  return firstUser.slice(0, 50);
}

function toEpochSeconds(value) {
  if (!value) return Date.now() / 1000;
  if (typeof value === "number") return value > 10_000_000_000 ? value / 1000 : value;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed / 1000 : Date.now() / 1000;
}

function commandsCatalog() {
  const pairs = [
    ["/help", "show Codmes TUI commands"],
    ["/status", "show runtime, model, task, and approval status"],
    ["/sessions", "browse and resume saved sessions"],
    ["/model", "open the Codmes model picker"],
    ["/approvals", "show pending approval requests"],
    ["/tasks", "show recent runtime tasks"],
    ["/tools", "show available Codmes tools"],
    ["/clear", "clear the visible transcript"],
    ["/title", "show or set the current session title"]
  ];
  const canon = {};
  for (const [name] of pairs) canon[name] = name;
  canon["/session"] = "/sessions";
  canon["/resume"] = "/sessions";
  canon["/switch"] = "/sessions";
  return {
    canon,
    categories: [
      { name: "Codmes", commands: pairs.map(([name]) => name) }
    ],
    pairs,
    skill_count: 0,
    sub: {}
  };
}

function slashCompletion(params) {
  const raw = String(params.text || params.query || params.prefix || "");
  const prefix = raw.startsWith("/") ? raw : `/${raw}`;
  const items = commandsCatalog().pairs
    .filter(([name]) => name.startsWith(prefix))
    .map(([name, meta]) => ({ display: name, text: name, meta }));
  return { items, replace_from: 0 };
}

async function runSlashCommand(engine, memorySessions, params, config, workspaceRoot) {
  const commandLine = String(params.command || "").trim();
  const [nameRaw, ...rest] = commandLine.split(/\s+/);
  const name = (nameRaw || "help").toLowerCase();
  const arg = rest.join(" ").trim();
  if (name === "help") {
    return {
      output: commandsCatalog().pairs.map(([cmd, help]) => `${cmd.padEnd(12)} ${help}`).join("\n")
    };
  }
  if (name === "status") {
    const [tasks, approvals] = await Promise.all([
      engine.listTasks({ limit: 5 }).catch(() => ({ tasks: [] })),
      engine.listApprovals({ status: "pending", limit: 10 }).catch(() => ({ approvals: [] }))
    ]);
    return {
      output: [
        `Runtime: Codmes Runtime`,
        `Workspace: ${workspaceRoot}`,
        `Model: ${config.defaultModel?.provider || "(none)"}/${config.defaultModel?.model || "(none)"}`,
        `Recent tasks: ${tasks.tasks?.length || 0}`,
        `Pending approvals: ${approvals.approvals?.length || 0}`
      ].join("\n")
    };
  }
  if (name === "approvals") {
    const approvals = await engine.listApprovals({ status: "pending", limit: 20 }).catch(() => ({ approvals: [] }));
    if (!approvals.approvals?.length) return { output: "No pending approvals." };
    return {
      output: approvals.approvals.map((approval) => [
        approval.id,
        approval.category || "approval",
        approval.summary || approval.reason || "",
        approval.taskId ? `task=${approval.taskId}` : ""
      ].filter(Boolean).join(" · ")).join("\n")
    };
  }
  if (name === "tasks") {
    const tasks = await engine.listTasks({ limit: 20 }).catch(() => ({ tasks: [] }));
    if (!tasks.tasks?.length) return { output: "No recent tasks." };
    return {
      output: tasks.tasks.map((task) => [
        task.id,
        task.status || "unknown",
        task.type || "task",
        task.summary || task.message || ""
      ].filter(Boolean).join(" · ")).join("\n")
    };
  }
  if (name === "tools") {
    return {
      output: [
        "workspace_search",
        "docsearch_search",
        "workspace_read_file",
        "read_note_file",
        "workspace_list_tree",
        "search_project",
        "read_project_file",
        "inspect_git",
        "get_git_diff",
        "propose_patch",
        "apply_patch",
        "run_checks",
        "run_git_command"
      ].join("\n")
    };
  }
  if (name === "sessions" || name === "session" || name === "resume" || name === "switch") {
    const rows = await historySessionRows(engine, memorySessions);
    if (!rows.length) return { output: "No saved sessions yet." };
    return {
      output: rows.slice(0, 30).map((session) => `${session.title || session.id} · ${session.message_count} messages · ${session.id}`).join("\n")
    };
  }
  if (name === "model") {
    return {
      output: `Current model: ${config.defaultModel?.model || "(none)"}\nProvider: ${config.defaultModel?.provider || "(none)"}\nRun /model without arguments to open the picker.`
    };
  }
  if (name === "clear") return { output: "Use Ctrl+L or the TUI clear command to redraw the transcript." };
  if (name === "title") {
    const sessionId = String(params.session_id || "");
    if (!sessionId) return { output: "No active session." };
    if (!arg) {
      const entry = await runtimeSessionEntry(engine, sessionId, config, workspaceRoot);
      return { output: entry?.title || sessionId };
    }
    await engine.renameSession(sessionId, arg);
    return { output: `session title set: ${arg}` };
  }
  return { output: `Unknown command: /${commandLine}\nTry /help.` };
}

async function respondToTuiApproval(engine, pendingApprovals, params) {
  const sessionId = String(params.session_id || "");
  const approvalId = String(params.approval_id || params.request_id || pendingApprovals.get(sessionId) || "");
  const choice = String(params.choice || "");
  const approved = choice !== "deny" && choice !== "reject" && choice !== "rejected";
  if (!approvalId) {
    return { ok: false, error: "No pending approval for this session.", choice };
  }
  const result = await engine.respondToWorkspaceApproval(approvalId, {
    approved,
    reason: approved ? `Approved from Codmes TUI (${choice || "allow_once"}).` : "Rejected from Codmes TUI."
  });
  pendingApprovals.delete(sessionId);
  return { ok: result.ok !== false, choice, approval_id: approvalId, result };
}

function codmesSkin() {
  return {
    banner_logo: "Codmes",
    banner_hero: "Codmes",
    branding: {
      agent_name: "Codmes",
      prompt_symbol: "❯",
      welcome: "Welcome to Codmes. Type your message or /help for commands.",
      help_header: "Codmes commands"
    },
    colors: {
      banner_accent: "#DAA520",
      banner_border: "#CC9B1F",
      banner_dim: "#CC9B1F",
      banner_text: "#FFF8DC",
      banner_title: "#FFD700",
      prompt: "#FFF8DC",
      session_border: "#CC9B1F",
      session_label: "#CC9B1F",
      ui_accent: "#DAA520",
      ui_border: "#CC9B1F",
      ui_error: "#ef5350",
      ui_label: "#DAA520",
      ui_ok: "#4caf50",
      ui_primary: "#FFD700",
      ui_text: "#FFF8DC",
      ui_warn: "#ffa726"
    }
  };
}

function mapCodmesEventToHermesTui(event, sessionId) {
  const type = String(event.type || "");
  if (type === "turn.start") {
    return [
      {
        type: "message.start",
        session_id: sessionId
      },
      {
        type: "status.update",
        session_id: sessionId,
        payload: { text: "running…", kind: "running" }
      },
      {
        type: "thinking.delta",
        session_id: sessionId,
        payload: { text: "thinking…" }
      }
    ];
  }
  if (type === "reasoning.delta" || type === "thinking.delta") {
    return [{
      type: "reasoning.delta",
      session_id: sessionId,
      payload: { text: event.text || "" }
    }];
  }
  if (type === "message.delta" || type === "assistant.delta" || type === "assistant.message.delta") {
    return [{
      type: "message.delta",
      session_id: sessionId,
      payload: { text: event.text || "", rendered: event.text || "" }
    }];
  }
  if (type.startsWith("tool.")) {
    const toolId = event.toolCallId || event.toolId || event.id || `${type}-${Date.now()}`;
    const name = event.toolName || event.name || type;
    if (type === "tool.start") {
      return [{
        type: "tool.start",
        session_id: sessionId,
        payload: {
          tool_id: String(toolId),
          name: String(name),
          args_text: stringifyCompact(event.arguments || event.args || event.input || ""),
          context: event.summary || event.text || ""
        }
      }];
    }
    if (type === "tool.complete" || type === "tool.error") {
      const result = event.result || {};
      return [{
        type: "tool.complete",
        session_id: sessionId,
        payload: {
          tool_id: String(toolId),
          name: String(name),
          error: event.error || result.error || "",
          result_text: stringifyCompact(result.output ?? result.result ?? event.text ?? ""),
          summary: event.summary || result.summary || event.text || (event.error ? "failed" : "done")
        }
      }];
    }
    return [{
      type: "tool.progress",
      session_id: sessionId,
      payload: {
        name: event.toolName || event.summary || type,
        preview: event.summary || ""
      }
    }];
  }
  if (type === "approval.request" || type === "approval.required") {
    return [{
      type: "approval.request",
      session_id: sessionId,
      payload: {
        allow_permanent: false,
        command: event.summary || event.category || "approval required",
        description: event.reason || event.summary || "Codmes needs approval before continuing."
      }
    }];
  }
  if (type === "turn.complete") {
    return [
      {
        type: "message.complete",
        session_id: sessionId,
        payload: { text: event.text || "", rendered: event.text || "", usage: sessionUsage() }
      },
      {
        type: "status.update",
        session_id: sessionId,
        payload: { text: "ready", kind: "idle" }
      }
    ];
  }
  return [];
}

function stringifyCompact(value) {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "string") return value.length > 2000 ? `${value.slice(0, 2000)}…` : value;
  try {
    const text = JSON.stringify(value, null, 2);
    return text.length > 2000 ? `${text.slice(0, 2000)}…` : text;
  } catch {
    return String(value);
  }
}
