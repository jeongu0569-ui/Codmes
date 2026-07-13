import http from "node:http";

import { createWorkspaceAgentEngine } from "./agent-engine.mjs";
import { acceptWebSocket, createFrameDecoder, encodeWebSocketFrame } from "./websocket-utils.mjs";
import { readRuntimeConfig } from "./runtime/config-store.mjs";

export async function startHermesTuiAdapter({ workspaceRoot }) {
  const engine = createWorkspaceAgentEngine({ workspaceRoot });
  const config = await readRuntimeConfig(workspaceRoot).catch(() => ({}));
  const sessions = new Map();
  let activeSessionId = "";

  await engine.connect();

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
    if (method === "setup.status") {
      return {
        provider_configured: Boolean(config.defaultModel?.provider && config.defaultModel?.model)
      };
    }
    if (method === "config.get") {
      return configValue(params);
    }
    if (method === "config.set") {
      return { value: params.value };
    }
    if (method === "session.create") {
      const session = await engine.createSession({
        provider: config.defaultModel?.provider,
        model: config.defaultModel?.model,
        title: `Codmes TUI ${new Date().toLocaleDateString()}`
      });
      activeSessionId = session.sessionId;
      const info = sessionInfo(config);
      sessions.set(activeSessionId, {
        id: activeSessionId,
        info,
        started_at: Date.now() / 1000,
        title: "Codmes Chat",
        messages: []
      });
      broadcast({ type: "session.info", session_id: activeSessionId, payload: info });
      return { session_id: activeSessionId, info };
    }
    if (method === "session.resume" || method === "session.activate") {
      const id = String(params.session_id || activeSessionId || "");
      if (id) activeSessionId = id;
      const entry = sessions.get(activeSessionId);
      return {
        session_id: activeSessionId,
        info: entry?.info || sessionInfo(config),
        messages: entry?.messages || [],
        message_count: entry?.messages?.length || 0,
        running: false,
        status: "idle"
      };
    }
    if (method === "session.active_list") {
      return {
        sessions: Array.from(sessions.values()).map((session) => ({
          id: session.id,
          current: session.id === activeSessionId,
          last_active: session.started_at,
          message_count: session.messages.length,
          model: config.defaultModel?.model || "",
          preview: session.messages.at(-1)?.text || "",
          started_at: session.started_at,
          status: "idle",
          title: session.title
        }))
      };
    }
    if (method === "session.list") {
      return {
        sessions: Array.from(sessions.values()).map((session) => ({
          id: session.id,
          message_count: session.messages.length,
          preview: session.messages.at(-1)?.text || "",
          started_at: session.started_at,
          title: session.title
        }))
      };
    }
    if (method === "session.delete") {
      const id = String(params.session_id || "");
      sessions.delete(id);
      return { deleted: id };
    }
    if (method === "session.most_recent") return {};
    if (method === "session.usage") return sessionUsage();
    if (method === "session.interrupt") return { ok: true };
    if (method === "input.detect_drop") return { matched: false };
    if (method === "complete.slash") return { items: [], replace_from: 0 };
    if (method === "complete.path") return { items: [], replace_from: 0 };
    if (method === "commands.catalog") return { canon: {}, categories: [], pairs: [], skill_count: 0, sub: {} };
    if (method === "model.options") return modelOptions(config);
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
    if (method === "approval.respond") return { ok: true };
    if (method === "slash.exec") return { output: `Unknown command: ${params.command || ""}` };
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

function sessionInfo(config) {
  return {
    cwd: process.cwd(),
    model: config.defaultModel?.model || "no-model",
    profile_name: "codmes",
    reasoning_effort: "medium",
    skills: {},
    tools: {},
    usage: sessionUsage(),
    version: "Codmes"
  };
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
          details_mode: "expanded",
          mouse_tracking: "off",
          sections: {
            thinking: "expanded",
            tools: "expanded",
            activity: "collapsed"
          },
          show_reasoning: true,
          streaming: true,
          tui_statusbar: "top"
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

function modelOptions(config) {
  const provider = config.defaultModel?.provider || "";
  const model = config.defaultModel?.model || "";
  return {
    providers: [
      {
        slug: provider,
        name: provider || "Codmes",
        models: model ? [model] : [],
        configured: Boolean(provider && model)
      }
    ],
    current_provider: provider,
    current_model: model,
    model,
    provider
  };
}

function codmesSkin() {
  return {
    banner_logo: "Codmes",
    banner_hero: "Codmes",
    branding: {
      agent_name: "Codmes",
      prompt: "❯"
    },
    colors: {
      accent: "#a78bfa",
      muted: "#8a8a8a",
      ok: "#22c55e",
      warn: "#f59e0b",
      error: "#ef4444"
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
    return [{
      type: "tool.progress",
      session_id: sessionId,
      payload: {
        name: event.toolName || event.summary || type,
        preview: event.summary || ""
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
