import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import {
  BUILTIN_PROVIDERS,
  listRuntimeModels,
  readCredentials,
  readRuntimeConfig
} from "./config-store.mjs";
import {
  executeWorkspaceTool,
  WORKSPACE_TOOL_DEFINITIONS
} from "./workspace-tools.mjs";

const OPENAI_COMPATIBLE_DEFAULTS = {
  "openai-api": "https://api.openai.com/v1",
  openrouter: "https://openrouter.ai/api/v1",
  lmstudio: "http://127.0.0.1:1234/v1",
  deepseek: "https://api.deepseek.com/v1",
  xai: "https://api.x.ai/v1",
  "ollama-cloud": "https://ollama.com/v1",
  custom: ""
};

export class OpenAICompatibleRuntime extends EventEmitter {
  constructor({ workspaceRoot, env = process.env, fetchImpl = globalThis.fetch } = {}) {
    super();
    this.name = "ai-workspace-openai-compatible";
    this.workspaceRoot = workspaceRoot;
    this.env = env;
    this.fetch = fetchImpl;
    this.sessions = new Map();
    this.mcpClients = new Map();
  }

  async connect() {
    if (!this.fetch) {
      throw Object.assign(new Error("This Node runtime does not provide fetch()."), { status: 500 });
    }
    return { ok: true };
  }

  async listModels() {
    return {
      models: await listRuntimeModels(this.workspaceRoot)
    };
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
    let activeParams = { ...params };
    let attempts = 0;
    let lastError = null;

    // Get fallback chain from config
    let chain = [];
    try {
      const config = await readRuntimeConfig(this.workspaceRoot);
      chain = config.fallbackChain || [];
    } catch {}

    for (;;) {
      let selection;
      try {
        selection = await this.resolveModelSelection(activeParams);
        const systemPrompt = await this.buildSystemPrompt(activeParams);
        const messages = buildMessages(activeParams, systemPrompt);

        this.emit("event", {
          type: "turn.start",
          sessionId: params.sessionId,
          taskId: params.taskId,
          provider: selection.provider.id,
          model: selection.model
        });

        const result = await this.runChatLoop(selection, messages, activeParams);

        this.emit("event", {
          type: "turn.complete",
          sessionId: params.sessionId,
          taskId: params.taskId,
          text: result.reply
        });

        return {
          ok: true,
          sessionId: params.sessionId,
          runtimeSessionId: params.sessionId,
          reply: result.reply,
          provider: selection.provider.id,
          model: selection.model,
          toolRounds: result.toolRounds
        };
      } catch (error) {
        lastError = error;
        // Try fallback chain
        if (attempts < chain.length) {
          const nextTarget = chain[attempts];
          attempts += 1;
          const colonIdx = nextTarget.indexOf(":");
          if (colonIdx !== -1) {
            const nextProvider = nextTarget.slice(0, colonIdx).trim();
            const nextModel = nextTarget.slice(colonIdx + 1).trim();

            this.emit("event", {
              type: "fallback.attempt",
              sessionId: params.sessionId,
              taskId: params.taskId,
              fromProvider: selection ? selection.provider.id : params.provider,
              fromModel: selection ? selection.model : params.model,
              toProvider: nextProvider,
              toModel: nextModel,
              error: error.message,
              condition: classifyError(error)
            });

            activeParams.provider = nextProvider;
            activeParams.model = nextModel;
            continue;
          }
        }
        throw error;
      }
    }
  }

  async runChatLoop(selection, messages, params) {
    let reply = "";
    let toolRounds = 0;
    const maxToolRounds = clampNumber(params.maxToolRounds, 0, 6, 3);

    for (let round = 0; round <= maxToolRounds; round += 1) {
      const result = await this.requestChatCompletion(selection, messages, params);
      reply += result.text;
      if (!result.toolCalls.length) {
        return { reply, toolRounds };
      }

      toolRounds += 1;
      messages.push({
        role: "assistant",
        content: result.text || null,
        tool_calls: result.toolCalls.map((call) => ({
          id: call.id,
          type: "function",
          function: {
            name: call.name,
            arguments: call.arguments
          }
        }))
      });

      for (const call of result.toolCalls) {
        const toolResult = await this.executeToolCall(call, params);
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          name: call.name,
          content: JSON.stringify(toolResult)
        });
      }
    }

    throw Object.assign(new Error("Tool call loop exceeded the maximum number of rounds."), { status: 502 });
  }

  async requestChatCompletion(selection, messages, params) {
    let text = "";
    const toolCalls = [];
    const headers = {
      "content-type": "application/json",
      accept: "text/event-stream, application/json",
      ...selection.extraHeaders
    };
    if (selection.apiKey) headers.authorization = `Bearer ${selection.apiKey}`;

    // Read toggles & MCP servers to merge active tools
    const config = await readRuntimeConfig(this.workspaceRoot);
    const disabledTools = new Set(config.disabledTools || []);
    const activeTools = [...WORKSPACE_TOOL_DEFINITIONS];

    if (config.mcpServers) {
      const enabledMcpNames = new Set(
        config.mcpServers
          .filter((mcp) => mcp.enabled !== false)
          .map((mcp) => mcp.name)
      );
      // Stop any running MCP clients that were disabled or removed
      for (const [name, client] of this.mcpClients.entries()) {
        if (!enabledMcpNames.has(name)) {
          try {
            client.stop();
          } catch {}
        }
      }

      for (const mcp of config.mcpServers) {
        if (mcp.enabled !== false) {
          try {
            const client = await this.getOrStartMcpClient(mcp);
            const mcpTools = await client.listTools();
            for (const tool of mcpTools) {
              activeTools.push({
                type: "function",
                function: {
                  name: `mcp_${mcp.name}_${tool.name}`,
                  description: tool.description || "",
                  parameters: tool.inputSchema || { type: "object", properties: {} }
                }
              });
            }
          } catch (err) {
            this.emit("event", {
              type: "mcp.error",
              sessionId: params.sessionId,
              taskId: params.taskId,
              serverName: mcp.name,
              error: err.message
            });
          }
        }
      }
    }

    const filteredTools = activeTools.filter((t) => !disabledTools.has(t.function.name));

    const response = await this.fetch(`${selection.baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: selection.model,
        messages,
        stream: true,
        tools: filteredTools.length > 0 ? filteredTools : undefined,
        tool_choice: filteredTools.length > 0 ? "auto" : undefined,
        ...reasoningOptions(params.reasoningEffort)
      })
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw Object.assign(
        new Error(`Model request failed: ${response.status} ${text.slice(0, 500)}`),
        { status: response.status }
      );
    }

    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const json = await response.json();
      text = extractNonStreamingText(json);
      if (text) {
        this.emit("event", {
          type: "message.delta",
          sessionId: params.sessionId,
          taskId: params.taskId,
          text
        });
      }
      toolCalls.push(...extractNonStreamingToolCalls(json));
    } else {
      for await (const chunk of parseOpenAIStream(response)) {
        if (chunk.text) {
          text += chunk.text;
          this.emit("event", {
            type: "message.delta",
            sessionId: params.sessionId,
            taskId: params.taskId,
            text: chunk.text
          });
        }
        if (chunk.toolCallDelta) mergeToolCallDelta(toolCalls, chunk.toolCallDelta);
      }
    }
    return {
      text,
      toolCalls: normalizeToolCalls(toolCalls)
    };
  }

  async executeToolCall(call, params) {
    // Check if tool is disabled
    const config = await readRuntimeConfig(this.workspaceRoot);
    const disabledTools = new Set(config.disabledTools || []);
    if (disabledTools.has(call.name)) {
      const errorMsg = `Tool '${call.name}' is currently disabled in config.`;
      this.emit("event", {
        type: "tool.error",
        sessionId: params.sessionId,
        taskId: params.taskId,
        toolCallId: call.id,
        toolName: call.name,
        text: errorMsg,
        error: errorMsg
      });
      return { ok: false, error: errorMsg };
    }

    // Check if it is MCP tool execution
    if (call.name.startsWith("mcp_")) {
      const parts = call.name.split("_");
      const mcpName = parts[1];
      const originalToolName = parts.slice(2).join("_");

      const mcp = config.mcpServers?.find((s) => s.name === mcpName);
      if (!mcp) {
        const client = this.mcpClients.get(mcpName);
        if (client) {
          try { client.stop(); } catch {}
        }
        const errorMsg = `MCP server '${mcpName}' not found.`;
        return { ok: false, error: errorMsg };
      }
      if (mcp.enabled === false) {
        const client = this.mcpClients.get(mcpName);
        if (client) {
          try { client.stop(); } catch {}
        }
        const errorMsg = `MCP server '${mcpName}' is disabled.`;
        return { ok: false, error: errorMsg };
      }

      this.emit("event", {
        type: "tool.start",
        sessionId: params.sessionId,
        taskId: params.taskId,
        toolCallId: call.id,
        toolName: call.name,
        text: call.name
      });

      try {
        const client = await this.getOrStartMcpClient(mcp);
        let argsObj = call.arguments;
        if (typeof argsObj === "string") {
          try {
            argsObj = JSON.parse(argsObj);
          } catch {
            argsObj = {};
          }
        }

        // Fetch tool metadata from client to check if it's dangerous
        const toolMeta = (client.tools || []).find(t => t.name === originalToolName) || { name: originalToolName };
        const dangerous = isDangerousMcpTool(toolMeta);

        // Security Policy Check
        const { checkAction } = await import("./security-policy.mjs");
        const policyCheck = await checkAction(this.workspaceRoot, {
          type: "mcp.tool.call",
          serverName: mcpName,
          toolName: originalToolName,
          arguments: argsObj,
          dangerous
        });

        if (policyCheck.status === "deny") {
          throw new Error(`Security block: ${policyCheck.reason}`);
        }

        if (policyCheck.status === "approve" && params.approved !== true) {
          const pendingState = {
            type: "mcp.tool.call",
            sessionId: params.sessionId,
            taskId: params.taskId,
            toolCall: call,
            serverName: mcpName,
            toolName: originalToolName,
            arguments: argsObj,
            reason: policyCheck.reason
          };

          this.emit("event", {
            type: "approval.required",
            sessionId: params.sessionId,
            taskId: params.taskId,
            category: "mcp.tool.call",
            summary: `Execute MCP tool '${originalToolName}' on server '${mcpName}'`,
            reason: policyCheck.reason,
            pendingState
          });
          throw Object.assign(
            new Error(`Approval required for MCP tool '${originalToolName}' on server '${mcpName}'.`),
            {
              status: 409,
              approvalRequired: true,
              category: "mcp.tool.call",
              summary: `Execute MCP tool '${originalToolName}' on server '${mcpName}'`,
              reason: policyCheck.reason,
              pendingState
            }
          );
        }

        const mcpResult = await client.callTool(originalToolName, argsObj);
        const output = mcpResult.content || mcpResult;

        this.emit("event", {
          type: "tool.complete",
          sessionId: params.sessionId,
          taskId: params.taskId,
          toolCallId: call.id,
          toolName: call.name,
          text: call.name,
          result: { ok: true, output }
        });
        return { ok: true, output };
      } catch (error) {
        if (error?.approvalRequired) {
          throw error;
        }
        const errorMsg = error?.message || "MCP tool execution failed.";
        this.emit("event", {
          type: "tool.error",
          sessionId: params.sessionId,
          taskId: params.taskId,
          toolCallId: call.id,
          toolName: call.name,
          text: errorMsg,
          error: errorMsg
        });
        this.emit("event", {
          type: "mcp.error",
          sessionId: params.sessionId,
          taskId: params.taskId,
          serverName: mcpName,
          error: errorMsg
        });
        return { ok: false, error: errorMsg };
      }
    }

    this.emit("event", {
      type: "tool.start",
      sessionId: params.sessionId,
      taskId: params.taskId,
      toolCallId: call.id,
      toolName: call.name,
      text: call.name
    });
    try {
      const result = await executeWorkspaceTool(this.workspaceRoot, call.name, call.arguments);
      this.emit("event", {
        type: "tool.complete",
        sessionId: params.sessionId,
        taskId: params.taskId,
        toolCallId: call.id,
        toolName: call.name,
        text: call.name,
        result
      });
      return result;
    } catch (error) {
      const result = {
        ok: false,
        error: error?.message || "Tool execution failed."
      };
      this.emit("event", {
        type: "tool.error",
        sessionId: params.sessionId,
        taskId: params.taskId,
        toolCallId: call.id,
        toolName: call.name,
        text: result.error,
        error: result.error
      });
      return result;
    }
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

  async resumePendingState(pendingState = {}, params = {}) {
    if (pendingState.type !== "mcp.tool.call") {
      throw Object.assign(new Error(`Unsupported pending state: ${pendingState.type || "(none)"}`), { status: 400 });
    }
    const result = await this.executeToolCall(pendingState.toolCall, {
      sessionId: pendingState.sessionId || params.sessionId,
      taskId: pendingState.taskId || params.taskId,
      approved: true
    });
    return {
      ok: result?.ok !== false,
      status: result?.ok === false ? "failed" : "completed",
      type: pendingState.type,
      result
    };
  }

  async getOrStartMcpClient(mcpConfig) {
    const { checkAction } = await import("./security-policy.mjs");
    const check = await checkAction(this.workspaceRoot, { type: "mcp.server.start", serverName: mcpConfig.name });
    if (check.status === "deny") {
      throw new Error(`Security block: Starting MCP server '${mcpConfig.name}' is blocked.`);
    }

    let client = this.mcpClients.get(mcpConfig.name);
    if (!client) {
      const { McpClient } = await import("./mcp-client.mjs");
      client = new McpClient(mcpConfig.name, mcpConfig.command, mcpConfig.args || [], {
        workspaceRoot: this.workspaceRoot
      });
      this.mcpClients.set(mcpConfig.name, client);
    }
    if (client.status !== "running") {
      await client.start();
    }
    return client;
  }

  close() {
    for (const client of this.mcpClients.values()) {
      try {
        client.stop();
      } catch {}
    }
    this.mcpClients.clear();
  }

  async buildSystemPrompt(params) {
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

    if (Array.isArray(context.searchResults) && context.searchResults.length) {
      parts.push("Search results context:");
      for (const result of context.searchResults.slice(0, 12)) {
        parts.push(`--- Search result: ${result.path || "(unknown)"}${result.kind ? ` (${result.kind})` : ""} ---`);
        parts.push(String(result.snippet || result.text || "").slice(0, 2000));
      }
    }

    if (Array.isArray(context.ragChunks) && context.ragChunks.length) {
      parts.push("RAG chunk context:");
      for (const chunk of context.ragChunks.slice(0, 12)) {
        const page = chunk.page !== undefined && chunk.page !== null ? ` page ${chunk.page}` : "";
        parts.push(`--- Chunk: ${chunk.path || "(unknown)"}${page} ---`);
        parts.push(String(chunk.text || "").slice(0, 2000));
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

    try {
      const { listSkills } = await import("./skill-registry.mjs");
      const skills = await listSkills(this.workspaceRoot);
      const userPrompt = String(params.prompt || params.message || "").toLowerCase();
      const historyText = (params.history || [])
        .map((h) => String(h.content || ""))
        .join(" ")
        .toLowerCase();
      const fullTextContext = `${userPrompt} ${historyText}`;

      const taskType = params.taskId ? "code" : "chat";

      for (const skill of skills) {
        if (skill.config.enabled === false) continue;

        if (Array.isArray(skill.config.taskTypes) && skill.config.taskTypes.length > 0) {
          if (!skill.config.taskTypes.includes(taskType)) continue;
        }

        if (Array.isArray(skill.config.triggers) && skill.config.triggers.length > 0) {
          const matched = skill.config.triggers.some((trigger) =>
            fullTextContext.includes(String(trigger).toLowerCase())
          );
          if (!matched) continue;
        }

        parts.push(`\n--- Skill: ${skill.name} ---`);
        parts.push(skill.skillMd);
      }
    } catch (err) {
      // ignore
    }

    return parts.join("\n");
  }

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

function buildMessages(params, systemPrompt) {
  const messages = [];
  const system = systemPrompt || buildSystemMessage(params);
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

  if (Array.isArray(context.searchResults) && context.searchResults.length) {
    parts.push("Search results context:");
    for (const result of context.searchResults.slice(0, 12)) {
      parts.push(`--- Search result: ${result.path || "(unknown)"}${result.kind ? ` (${result.kind})` : ""} ---`);
      parts.push(String(result.snippet || result.text || "").slice(0, 2000));
    }
  }

  if (Array.isArray(context.ragChunks) && context.ragChunks.length) {
    parts.push("RAG chunk context:");
    for (const chunk of context.ragChunks.slice(0, 12)) {
      const page = chunk.page !== undefined && chunk.page !== null ? ` page ${chunk.page}` : "";
      parts.push(`--- Chunk: ${chunk.path || "(unknown)"}${page} ---`);
      parts.push(String(chunk.text || "").slice(0, 2000));
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
          const toolCalls = json.choices?.[0]?.delta?.tool_calls || [];
          if (text || toolCalls.length) {
            yield {
              text,
              toolCallDelta: toolCalls.length ? toolCalls : null,
              raw: json
            };
          }
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

function extractNonStreamingToolCalls(json) {
  const calls = json.choices?.[0]?.message?.tool_calls || [];
  return calls.map((call, index) => ({
    id: call.id || `call_${index}`,
    name: call.function?.name || "",
    arguments: call.function?.arguments || "{}"
  })).filter((call) => call.name);
}

function mergeToolCallDelta(toolCalls, deltas) {
  for (const delta of deltas || []) {
    const index = Number.isInteger(delta.index) ? delta.index : toolCalls.length;
    if (!toolCalls[index]) {
      toolCalls[index] = {
        id: "",
        name: "",
        arguments: ""
      };
    }
    const target = toolCalls[index];
    if (delta.id) target.id += delta.id;
    if (delta.function?.name) target.name += delta.function.name;
    if (delta.function?.arguments) target.arguments += delta.function.arguments;
  }
}

function normalizeToolCalls(toolCalls) {
  return toolCalls
    .filter(Boolean)
    .map((call, index) => ({
      id: call.id || `call_${index}`,
      name: call.name || "",
      arguments: call.arguments || "{}"
    }))
    .filter((call) => call.name);
}

function clampNumber(value, min, max, fallback) {
  const number = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function trimTrailingSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

export function classifyError(error) {
  const msg = String(error?.message || "").toLowerCase();
  const status = error?.status;

  if (status === 429 || msg.includes("rate limit") || msg.includes("too many requests")) {
    return "rate_limit";
  }
  if (
    status === 401 ||
    status === 403 ||
    msg.includes("api key") ||
    msg.includes("unauthorized") ||
    msg.includes("credential") ||
    msg.includes("auth") ||
    error?.setupRequired
  ) {
    return "auth_error";
  }
  if (
    msg.includes("fetch failed") ||
    msg.includes("enotfound") ||
    msg.includes("econnrefused") ||
    msg.includes("network") ||
    status === 502 ||
    status === 504
  ) {
    return "network_error";
  }
  if (status === 404 || msg.includes("model not found") || msg.includes("unknown model") || msg.includes("model unavailable")) {
    return "model_unavailable";
  }
  if (status === 503 || msg.includes("provider unavailable") || msg.includes("unknown provider")) {
    return "provider_unavailable";
  }
  if (status >= 500) {
    return "provider_unavailable";
  }
  return "unknown_error";
}

export function isDangerousMcpTool(tool) {
  const name = String(tool.name).toLowerCase();
  const desc = String(tool.description || "").toLowerCase();
  const dangerousKeywords = [
    "write", "delete", "remove", "destroy", "bash", "shell", "run", "execute",
    "git", "push", "patch", "modify", "install", "download", "fetch", "http",
    "curl", "wget", "rm", "kill", "stop"
  ];
  return dangerousKeywords.some((kw) => name.includes(kw) || desc.includes(kw));
}
