import crypto from "node:crypto";
import { EventEmitter } from "node:events";

export class HermesLiveClient extends EventEmitter {
  constructor(config) {
    super();
    this.config = config;
    this.socket = null;
    this.nextId = 0;
    this.pending = new Map();
    this.runtimeSessions = new Map();
  }

  async fetchHermesJson(endpoint, options = {}) {
    const baseUrl = trimTrailingSlash(this.config.hermesServerUrl);
    const username = this.config.dashboardUsername || this.config.username || "";
    const password = this.config.dashboardPassword || this.config.password || "";
    if (!username || !password) return {};

    const jar = {};
    const providers = await fetchDashboardJson(baseUrl, "/api/auth/providers", jar);
    const provider = this.config.dashboardProvider
      || providers.providers?.find((item) => item.supports_password)?.name
      || providers.providers?.[0]?.name;
    if (!provider) throw new Error("Hermes dashboard has no password login provider.");
    
    await fetchDashboardJson(baseUrl, "/auth/password-login", jar, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider, username, password, next: "/" })
    });

    const headers = {
      accept: "application/json",
      ...(options.body ? { "content-type": "application/json" } : {}),
      cookie: cookieHeader(jar)
    };

    const response = await fetch(baseUrl + endpoint, {
      method: options.method || "GET",
      body: options.body,
      headers
    });
    const text = await response.text();
    if (!response.ok) {
      throw Object.assign(new Error(`Hermes request failed: ${response.status} ${text}`), { status: 502 });
    }
    return text ? JSON.parse(text) : {};
  }

  async connect() {
    if (this.socket?.readyState === WebSocket.OPEN) return;
    const wsUrl = await dashboardTicketWsUrl(this.config);
    await new Promise((resolve, reject) => {
      const socket = new WebSocket(wsUrl);
      const timer = setTimeout(() => {
        try {
          socket.close();
        } catch {}
        reject(new Error("Hermes live WebSocket connection timed out."));
      }, 15000);
      socket.addEventListener("open", () => {
        clearTimeout(timer);
        this.socket = socket;
        resolve();
      });
      socket.addEventListener("error", () => {
        clearTimeout(timer);
        reject(new Error("Hermes live WebSocket connection failed."));
      });
      socket.addEventListener("close", () => {
        this.rejectAll(new Error("Hermes live WebSocket closed."));
        if (this.socket === socket) this.socket = null;
        this.emit("close");
      });
      socket.addEventListener("message", (event) => this.handleMessage(event.data));
    });
  }

  async request(method, params = {}, timeoutMs = 120000) {
    await this.connect();
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      throw new Error("Hermes live WebSocket is not connected.");
    }
    const id = `workspace-${++this.nextId}`;
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Hermes request timed out: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        socket.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  async createSession(params = {}) {
    const result = await this.request("session.create", {
      cols: 96,
      ...pickDefined({
        provider: params.provider,
        model: params.model,
        reasoning_effort: params.reasoningEffort
      })
    });
    const runtimeSessionId = String(result?.session_id || "");
    const storedSessionId = String(result?.stored_session_id || runtimeSessionId);
    if (runtimeSessionId && storedSessionId) {
      this.runtimeSessions.set(storedSessionId, runtimeSessionId);
    }
    if (params.accessMode) {
      await this.setAccessMode(runtimeSessionId || storedSessionId, params.accessMode);
    }
    return {
      sessionId: storedSessionId,
      runtimeSessionId,
      source: "hermes-live"
    };
  }

  async resumeSession(sessionId) {
    const known = this.runtimeSessions.get(sessionId);
    if (known) return known;
    const result = await this.request("session.resume", { session_id: sessionId });
    const runtimeSessionId = String(result?.session_id || sessionId);
    this.runtimeSessions.set(sessionId, runtimeSessionId);
    return runtimeSessionId;
  }

  async submitPrompt(params = {}) {
    const sessionId = requireString(params.sessionId, "sessionId");
    const runtimeSessionId = await this.resumeSession(sessionId);
    const text = buildPromptText(params);
    await this.request("prompt.submit", {
      session_id: runtimeSessionId,
      text
    });
    return { ok: true, sessionId, runtimeSessionId };
  }

  async respondToApproval(params = {}) {
    const sessionId = requireString(params.sessionId, "sessionId");
    const runtimeSessionId = await this.resumeSession(sessionId);
    const choice = params.approved === false || params.choice === "deny" ? "deny" : "once";
    await this.request("approval.respond", {
      session_id: runtimeSessionId,
      choice
    });
    return { ok: true, sessionId, runtimeSessionId, choice };
  }

  async setAccessMode(sessionId, accessMode) {
    if (!sessionId) return;
    await this.request("config.set", {
      session_id: sessionId,
      key: "yolo",
      value: accessMode === "full" ? "1" : "0",
      scope: "session"
    });
  }

  async setReasoning(sessionId, effort) {
    if (!sessionId || !effort) return;
    await this.request("config.set", {
      session_id: sessionId,
      key: "reasoning",
      value: effort,
      scope: "session"
    });
  }

  close() {
    try {
      this.socket?.close();
    } catch {}
    this.socket = null;
    this.rejectAll(new Error("Hermes live client closed."));
  }

  handleMessage(raw) {
    let message;
    try {
      message = JSON.parse(typeof raw === "string" ? raw : String(raw));
    } catch {
      return;
    }
    if (message.id !== undefined && message.id !== null) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(message.id);
      if (message.error) {
        pending.reject(new Error(message.error.message || "Hermes live RPC failed."));
      } else {
        pending.resolve(message.result);
      }
      return;
    }
    if (message.method === "event" && message.params?.type) {
      this.emit("event", normalizeHermesEvent(message.params));
    }
  }

  rejectAll(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}

export async function dashboardTicketWsUrl(config) {
  const baseUrl = trimTrailingSlash(config.hermesServerUrl);
  const username = config.dashboardUsername || "";
  const password = config.dashboardPassword || "";
  if (!username || !password) {
    throw new Error("Hermes dashboard username/password are required for live WebSocket.");
  }
  const jar = {};
  const providers = await fetchDashboardJson(baseUrl, "/api/auth/providers", jar);
  const provider = config.dashboardProvider
    || providers.providers?.find((item) => item.supports_password)?.name
    || providers.providers?.[0]?.name;
  if (!provider) throw new Error("Hermes dashboard has no password login provider.");
  await fetchDashboardJson(baseUrl, "/auth/password-login", jar, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      provider,
      username,
      password,
      next: "/"
    })
  });
  const ticketResponse = await fetchDashboardJson(baseUrl, "/api/auth/ws-ticket", jar, {
    method: "POST"
  });
  const ticket = String(ticketResponse?.ticket || "");
  if (!ticket) throw new Error("Hermes dashboard did not return a WebSocket ticket.");
  const url = new URL("/api/ws", baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("ticket", ticket);
  return url.toString();
}

async function fetchDashboardJson(baseUrl, endpoint, jar, options = {}) {
  const headers = { ...(options.headers || {}) };
  const cookie = cookieHeader(jar);
  if (cookie) headers.cookie = cookie;
  const response = await fetch(baseUrl + endpoint, { ...options, headers });
  absorbSetCookie(jar, response.headers);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Hermes dashboard request failed: ${response.status} ${text}`);
  }
  return text ? JSON.parse(text) : {};
}

function normalizeHermesEvent(event) {
  const payload = event.payload || {};
  const text = payloadText(payload);
  return {
    type: event.type,
    sessionId: event.session_id || event.sessionId || "",
    payload,
    text,
    raw: event
  };
}

function payloadText(payload) {
  for (const key of [
    "text",
    "delta",
    "content",
    "output_text",
    "rendered",
    "message",
    "preview",
    "summary",
    "description",
    "command",
    "name",
    "status"
  ]) {
    if (typeof payload?.[key] === "string" && payload[key]) return payload[key];
  }
  if (Array.isArray(payload?.content)) {
    const text = payload.content
      .map((item) => item?.text || item?.content || item?.delta || "")
      .filter(Boolean)
      .join("");
    if (text) return text;
  }
  if (payload && typeof payload === "object" && Object.keys(payload).length) {
    return JSON.stringify(payload);
  }
  return "";
}

function buildPromptText(params) {
  const message = requireString(params.message, "message");
  const context = params.context;
  if (!context || Object.keys(context).length === 0) return message;
  const renderedContext = renderContext(context);
  return [
    "[Workspace context]",
    renderedContext,
    "",
    "[User message]",
    message
  ].join("\n");
}

function renderContext(context) {
  const workspaceContext = context.workspaceContext;
  if (!workspaceContext) return JSON.stringify(context, null, 2);
  const workspace = workspaceContext.workspace || {};
  const lines = [
    `Scope type: ${workspace.scopeType || "none"}`,
    `Scope path: ${workspace.scopePath || "(workspace root)"}`,
    workspace.activePath ? `Active path: ${workspace.activePath}` : "",
    workspace.ragRecommended ? "RAG search recommended: yes" : "RAG search recommended: no",
    workspace.ragSearchProvider ? `Preferred search provider: ${workspace.ragSearchProvider}` : "",
    workspace.ragSearchScopeType ? `Search scope type: ${workspace.ragSearchScopeType}` : "",
    workspace.ragSearchScopePath ? `Search scope path: ${workspace.ragSearchScopePath}` : ""
  ].filter(Boolean);
  if (workspaceContext.fileList?.length) {
    lines.push("", "[Workspace file list]");
    for (const file of workspaceContext.fileList.slice(0, 200)) {
      lines.push(`- ${file.path} (${file.kind})`);
    }
    if (workspaceContext.fileList.length > 200) {
      lines.push(`- ... ${workspaceContext.fileList.length - 200} more files omitted`);
    }
  }
  if (workspaceContext.resources?.length) {
    lines.push("", "[Linked resources]");
    for (const resource of workspaceContext.resources.slice(0, 100)) {
      lines.push(`- ${resource.path} (${resource.kind})${resource.ragRecommended ? " [search]" : ""}`);
    }
  }
  if (workspaceContext.inlineBlocks?.length) {
    for (const block of workspaceContext.inlineBlocks) {
      lines.push("", `[${block.title || block.kind}]`);
      if (block.path) lines.push(`Path: ${block.path}`);
      if (block.truncated) lines.push("Truncated: true");
      lines.push(String(block.content || ""));
    }
  }
  return lines.join("\n");
}

function requireString(value, name) {
  const text = String(value || "").trim();
  if (!text) throw new Error(`Missing ${name}.`);
  return text;
}

function pickDefined(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== ""));
}

function absorbSetCookie(jar, headers) {
  const values = headers.getSetCookie ? headers.getSetCookie() : headers.get("set-cookie") ? [headers.get("set-cookie")] : [];
  for (const value of values) {
    const first = String(value).split(";")[0];
    const index = first.indexOf("=");
    if (index > 0) jar[first.slice(0, index).trim()] = first.slice(index + 1).trim();
  }
}

function cookieHeader(jar) {
  return Object.entries(jar).map(([key, value]) => `${key}=${value}`).join("; ");
}

function trimTrailingSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

export function acceptWebSocket(req, socket) {
  const key = req.headers["sec-websocket-key"];
  if (!key) throw new Error("Missing Sec-WebSocket-Key.");
  const accept = crypto
    .createHash("sha1")
    .update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
    .digest("base64");
  socket.write([
    "HTTP/1.1 101 Switching Protocols",
    "Upgrade: websocket",
    "Connection: Upgrade",
    `Sec-WebSocket-Accept: ${accept}`,
    "",
    ""
  ].join("\r\n"));
}

export function encodeWebSocketFrame(value) {
  const payload = Buffer.from(typeof value === "string" ? value : JSON.stringify(value), "utf8");
  const header = [];
  header.push(0x81);
  if (payload.length < 126) {
    header.push(payload.length);
  } else if (payload.length < 65536) {
    header.push(126, (payload.length >> 8) & 0xff, payload.length & 0xff);
  } else {
    header.push(127, 0, 0, 0, 0, (payload.length >> 24) & 0xff, (payload.length >> 16) & 0xff, (payload.length >> 8) & 0xff, payload.length & 0xff);
  }
  return Buffer.concat([Buffer.from(header), payload]);
}

export function createFrameDecoder(onMessage, onClose) {
  let buffer = Buffer.alloc(0);
  return function decode(chunk) {
    buffer = Buffer.concat([buffer, chunk]);
    for (;;) {
      if (buffer.length < 2) return;
      const first = buffer[0];
      const second = buffer[1];
      const opcode = first & 0x0f;
      const masked = Boolean(second & 0x80);
      let length = second & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (buffer.length < offset + 2) return;
        length = buffer.readUInt16BE(offset);
        offset += 2;
      } else if (length === 127) {
        if (buffer.length < offset + 8) return;
        const high = buffer.readUInt32BE(offset);
        const low = buffer.readUInt32BE(offset + 4);
        if (high !== 0) throw new Error("WebSocket frame is too large.");
        length = low;
        offset += 8;
      }
      let mask = null;
      if (masked) offset += 4;
      if (buffer.length < offset + length) return;
      if (masked) mask = buffer.subarray(offset - 4, offset);
      const payload = Buffer.from(buffer.subarray(offset, offset + length));
      buffer = buffer.subarray(offset + length);
      if (masked) {
        for (let i = 0; i < payload.length; i += 1) payload[i] ^= mask[i % 4];
      }
      if (opcode === 0x8) {
        onClose?.();
        return;
      }
      if (opcode === 0x1) onMessage(payload.toString("utf8"));
    }
  };
}
