import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import {
  BUILTIN_PROVIDERS,
  readCredentials,
  readRuntimeConfig
} from "./config-store.mjs";

const OPENAI_COMPATIBLE_DEFAULTS = {
  "openai-api": "https://api.openai.com/v1",
  openrouter: "https://openrouter.ai/api/v1",
  lmstudio: "http://127.0.0.1:1234/v1",
  deepseek: "https://api.deepseek.com/v1",
  xai: "https://api.x.ai/v1",
  "ollama-cloud": "https://ollama.com/v1",
  custom: ""
};

export class OpenAICompatibleRuntimeAdapter extends EventEmitter {
  constructor({ workspaceRoot, env = process.env, fetchImpl = globalThis.fetch } = {}) {
    super();
    this.name = "ai-workspace-openai-compatible";
    this.workspaceRoot = workspaceRoot;
    this.env = env;
    this.fetch = fetchImpl;
    this.sessions = new Map();
  }

  async connect() {
    if (!this.fetch) {
      throw Object.assign(new Error("This Node runtime does not provide fetch()."), { status: 500 });
    }
    return { ok: true };
  }

  async createSession(params = {}) {
    const sessionId = params.sessionId || `session-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID()}`;
    this.sessions.set(sessionId, {
      id: sessionId,
      createdAt: new Date().toISOString(),
      provider: params.provider || "",
      model: params.model || "",
      accessMode: params.accessMode || "",
      reasoningEffort: params.reasoningEffort || ""
    });
    return {
      ok: true,
      sessionId,
      runtimeSessionId: sessionId,
      source: "ai-workspace"
    };
  }

  async resumeSession(sessionId) {
    if (!this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, {
        id: sessionId,
        resumedAt: new Date().toISOString()
      });
    }
    return sessionId;
  }

  async submitPrompt(params = {}) {
    const selection = await this.resolveModelSelection(params);
    const messages = buildMessages(params);
    let reply = "";

    this.emit("event", {
      type: "turn.start",
      sessionId: params.sessionId,
      taskId: params.taskId,
      provider: selection.provider.id,
      model: selection.model
    });

    const headers = {
      "content-type": "application/json",
      accept: "text/event-stream, application/json",
      ...selection.extraHeaders
    };
    if (selection.apiKey) headers.authorization = `Bearer ${selection.apiKey}`;

    const response = await this.fetch(`${selection.baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: selection.model,
        messages,
        stream: true,
        ...reasoningOptions(params.reasoningEffort)
      })
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw Object.assign(
        new Error(`Model request failed: ${response.status} ${text.slice(0, 500)}`),
        { status: 502 }
      );
    }

    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const json = await response.json();
      reply = extractNonStreamingText(json);
      if (reply) {
        this.emit("event", {
          type: "message.delta",
          sessionId: params.sessionId,
          taskId: params.taskId,
          text: reply
        });
      }
    } else {
      for await (const chunk of parseOpenAIStream(response)) {
        if (!chunk.text) continue;
        reply += chunk.text;
        this.emit("event", {
          type: "message.delta",
          sessionId: params.sessionId,
          taskId: params.taskId,
          text: chunk.text
        });
      }
    }

    this.emit("event", {
      type: "turn.complete",
      sessionId: params.sessionId,
      taskId: params.taskId,
      text: reply
    });

    return {
      ok: true,
      sessionId: params.sessionId,
      runtimeSessionId: params.sessionId,
      reply,
      provider: selection.provider.id,
      model: selection.model
    };
  }

  async respondToApproval(params = {}) {
    return {
      ok: true,
      sessionId: params.sessionId,
      choice: params.approved === false ? "deny" : "once"
    };
  }

  async setAccessMode(sessionId, accessMode) {
    const session = this.sessions.get(sessionId) || { id: sessionId };
    session.accessMode = accessMode;
    this.sessions.set(sessionId, session);
  }

  async setReasoning(sessionId, reasoningEffort) {
    const session = this.sessions.get(sessionId) || { id: sessionId };
    session.reasoningEffort = reasoningEffort;
    this.sessions.set(sessionId, session);
  }

  close() {}

  async resolveModelSelection(params = {}) {
    const config = await readRuntimeConfig(this.workspaceRoot);
    const providerId = params.provider || config.defaultModel?.provider || "";
    const model = params.model || config.defaultModel?.model || "";
    if (!providerId || !model) {
      throw Object.assign(
        new Error("No default model is configured. Run `aiw model set-default <provider> <model>`."),
        { status: 503, setupRequired: true }
      );
    }

    const provider = BUILTIN_PROVIDERS.find((item) => item.id === providerId);
    if (!provider) {
      throw Object.assign(new Error(`Unknown provider: ${providerId}`), { status: 400 });
    }

    const baseUrl = await this.resolveBaseUrl(provider);
    if (!baseUrl) {
      throw Object.assign(
        new Error(`Provider '${providerId}' needs a base URL. Store ${provider.baseUrlEnv || "baseUrl"} with aiw auth set or set the matching environment variable.`),
        { status: 503, setupRequired: true }
      );
    }

    const apiKey = await this.resolveApiKey(provider);
    if (provider.authType === "api_key" && !apiKey && provider.id !== "lmstudio") {
      throw Object.assign(
        new Error(`Provider '${providerId}' needs an API key. Run aiw auth set ${providerId} <KEY_NAME> <VALUE>.`),
        { status: 503, setupRequired: true }
      );
    }

    return {
      provider,
      model,
      baseUrl: trimTrailingSlash(baseUrl),
      apiKey,
      extraHeaders: provider.id === "openrouter" ? {
        "HTTP-Referer": "http://localhost",
        "X-Title": "AI Workspace"
      } : {}
    };
  }

  async resolveBaseUrl(provider) {
    const credentials = await readCredentials(this.workspaceRoot);
    const values = credentials.providers?.[provider.id]?.values || {};
    const baseKey = provider.baseUrlEnv || "";
    return values.baseUrl
      || values.BASE_URL
      || (baseKey ? values[baseKey] : "")
      || (baseKey ? this.env[baseKey] : "")
      || provider.defaultBaseUrl
      || OPENAI_COMPATIBLE_DEFAULTS[provider.id]
      || "";
  }

  async resolveApiKey(provider) {
    const credentials = await readCredentials(this.workspaceRoot);
    const values = credentials.providers?.[provider.id]?.values || {};
    for (const key of provider.env || []) {
      if (values[key]) return values[key];
      if (this.env[key]) return this.env[key];
    }
    return values.apiKey || values.API_KEY || values.token || values.TOKEN || "";
  }
}

function buildMessages(params) {
  const messages = [];
  const system = buildSystemMessage(params);
  if (system) messages.push({ role: "system", content: system });
  for (const item of params.history || []) {
    if ((item.role === "user" || item.role === "assistant") && item.content) {
      messages.push({ role: item.role, content: String(item.content) });
    }
  }
  messages.push({
    role: "user",
    content: params.prompt || params.message || ""
  });
  return messages;
}

function buildSystemMessage(params) {
  const context = params.context?.workspaceContext || params.context || {};
  const parts = [
    "You are AI Workspace's built-in assistant.",
    "Answer in the same language as the user's latest message.",
    "Use provided workspace context when relevant, but do not expose it as raw metadata."
  ];

  const workspace = context.workspace || {};
  if (workspace.scopeType || workspace.scopePath || workspace.activePath) {
    parts.push(`Workspace scope: ${workspace.scopeType || "none"}`);
    if (workspace.scopePath) parts.push(`Scope path: ${workspace.scopePath}`);
    if (workspace.activePath) parts.push(`Active path: ${workspace.activePath}`);
    if (workspace.ragRecommended) {
      parts.push("Search may be needed for broader folder/workspace questions.");
    }
  }

  if (Array.isArray(context.inlineBlocks) && context.inlineBlocks.length) {
    parts.push("Inline workspace context:");
    for (const block of context.inlineBlocks) {
      parts.push(`--- ${block.title || block.kind || "Context"}${block.path ? `: ${block.path}` : ""} ---`);
      parts.push(String(block.content || ""));
    }
  }

  if (Array.isArray(context.fileList) && context.fileList.length) {
    parts.push("Workspace file list:");
    for (const item of context.fileList.slice(0, 200)) {
      parts.push(`- ${item.path} (${item.kind})`);
    }
  }

  if (Array.isArray(context.resources) && context.resources.length) {
    parts.push("Linked resources:");
    for (const item of context.resources.slice(0, 100)) {
      parts.push(`- ${item.path} (${item.kind})`);
    }
  }

  return parts.join("\n");
}

function reasoningOptions(value) {
  const effort = String(value || "").toLowerCase();
  if (!effort || effort === "medium" || effort === "med") return {};
  if (effort === "fast" || effort === "low") return { reasoning_effort: "low" };
  if (effort === "deep" || effort === "high") return { reasoning_effort: "high" };
  return { reasoning_effort: effort };
}

async function* parseOpenAIStream(response) {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const rawChunk of response.body) {
    buffer += decoder.decode(rawChunk, { stream: true });
    let boundary;
    while ((boundary = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      for (const line of frame.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const data = trimmed.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        try {
          const json = JSON.parse(data);
          const text = json.choices?.[0]?.delta?.content
            || json.choices?.[0]?.message?.content
            || json.output_text
            || "";
          if (text) yield { text, raw: json };
        } catch {}
      }
    }
  }
}

function extractNonStreamingText(json) {
  return json.choices?.[0]?.message?.content
    || json.choices?.[0]?.delta?.content
    || json.output_text
    || "";
}

function trimTrailingSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}
