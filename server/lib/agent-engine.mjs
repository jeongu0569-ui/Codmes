import fs from "node:fs/promises";
import { EventEmitter } from "node:events";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { buildWorkspaceContext } from "./context-router.mjs";
import { CodeAgentRuntime } from "./code-agent-runtime.mjs";
import { ChatRuntime } from "./chat-runtime.mjs";
import { ModelRuntime } from "./model-runtime.mjs";
import { SessionRuntime } from "./session-runtime.mjs";
import { LLMRuntime } from "./llm-runtime.mjs";
import { OpenAICompatibleRuntime } from "./runtime/openai-compatible-runtime.mjs";

export function createWorkspaceAgentEngine(config) {
  const runtime = config.runtime === undefined
    ? new OpenAICompatibleRuntime({ workspaceRoot: config.workspaceRoot })
    : config.runtime;
  return new WorkspaceAgentEngine(config, runtime || null);
}

export async function ensureAgentWorkspaceState(workspaceRoot) {
  await new WorkspaceAgentStateStore(workspaceRoot).ensure();
}

export class WorkspaceAgentEngine extends EventEmitter {
  constructor(config, runtime) {
    super();
    this.config = config;
    this.runtime = runtime;
    
    this.state = new WorkspaceAgentStateStore(config.workspaceRoot);
    this.chatRuntime = new ChatRuntime({
      runtime: runtime || null
    });
    this.modelRuntime = new ModelRuntime({ workspaceRoot: config.workspaceRoot });
    this.sessionRuntime = new SessionRuntime({ runtime, stateStore: this.state });
    this.llmRuntime = new LLMRuntime({ chatRuntime: this.chatRuntime });
    this.codeRuntime = new CodeAgentRuntime({
      workspaceRoot: config.workspaceRoot,
      stateStore: this.state,
      llmRuntime: this.llmRuntime
    });
    this.assistantTurnBuffers = new Map();
    this.persistedAssistantTurns = new Set();
    this.eventWrites = new Set();

    if (this.runtime) {
      this.runtime.on("event", (event) => {
        const enriched = {
          engine: "workspace-agent",
          runtime: this.runtimeName(),
          ...event
        };
        this.trackTranscriptEvent(enriched);
        this.trackEventWrite(this.state.recordAgentEvent(enriched));
        this.emit("event", enriched);
      });
      this.runtime.on("close", () => this.emit("close"));
      this.runtime.on("error", (error) => {
        const enriched = {
          engine: "workspace-agent",
          runtime: this.runtimeName(),
          type: "runtime.error",
          error: error?.message || "Runtime error.",
          text: error?.message || "Runtime error."
        };
        this.trackEventWrite(this.state.recordAgentEvent(enriched));
        this.emit("event", enriched);
      });
    }
  }

  async connect() {
    await this.state.ensure();
    if (this.chatRuntime.isAvailable()) {
      await this.chatRuntime.connect();
    }
    await this.state.recordSessionEvent({
      type: "engine.connect",
      runtime: this.runtimeName()
    });
  }

  async createSession(params = {}) {
    await this.state.ensure();
    const result = this.chatRuntime.isAvailable()
      ? await this.chatRuntime.createSession(params)
      : {
          sessionId: `session-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID()}`,
          runtimeSessionId: "",
          source: "ai-workspace"
        };
    const sessionObj = {
      id: result.sessionId,
      title: params.title || `Session ${new Date().toLocaleDateString()}`,
      model: params.model || this.config.model?.default || "unknown",
      preview: "",
      updatedAt: new Date().toISOString(),
      source: "workspace",
      runtime: "chat-runtime",
      isActive: true
    };
    await this.state.writeSession(sessionObj);

    await this.state.recordSessionEvent({
      type: "session.create",
      runtime: this.runtimeName(),
      sessionId: result.sessionId,
      runtimeSessionId: result.runtimeSessionId,
      provider: params.provider,
      model: params.model,
      accessMode: params.accessMode,
      reasoningEffort: params.reasoningEffort
    });
    return {
      ...result,
      engine: "workspace-agent",
      runtime: this.runtimeName()
    };
  }

  async resumeSession(sessionId) {
    await this.state.ensure();
    const runtimeSessionId = this.chatRuntime.isAvailable()
      ? await this.chatRuntime.resumeSession(sessionId)
      : sessionId;
    await this.state.recordSessionEvent({
      type: "session.resume",
      runtime: this.runtimeName(),
      sessionId,
      runtimeSessionId
    });
    return runtimeSessionId;
  }

  async submitPrompt(params = {}) {
    await this.state.ensure();
    const context = await this.resolveContext(params);
    const task = await this.state.startTask({
      type: params.taskType || "chat",
      runtime: this.runtimeName(),
      sessionId: params.sessionId,
      message: params.message,
      contextRequest: params.contextRequest,
      provider: params.provider,
      model: params.model,
      accessMode: params.accessMode,
      reasoningEffort: params.reasoningEffort
    });
    try {
      const priorSession = params.sessionId ? await this.state.readSession(params.sessionId) : null;
      const history = Array.isArray(priorSession?.messages) ? priorSession.messages : [];
      if (params.sessionId) {
        await this.sessionRuntime.appendSessionMessage(params.sessionId, {
          role: "user",
          content: params.prompt || params.message || "",
          taskId: task.id,
          source: "user"
        });
      }
      const result = await this.chatRuntime.submitPrompt({
        ...params,
        context,
        history,
        taskId: task.id
      }).catch((error) => {
        if (this.chatRuntime.isAvailable()) throw error;
        return workspaceRuntimeNotConfiguredReply(params);
      });
      await this.state.finishTask(task.id, {
        status: "submitted",
        result
      });

      if (params.sessionId && result.reply && !this.hasPersistedAssistantTurn(params.sessionId, task.id)) {
        await this.sessionRuntime.appendSessionMessage(params.sessionId, {
          role: "assistant",
          content: result.reply,
          taskId: task.id,
          source: "result"
        });
      }
      await this.flush();

      return {
        ...result,
        taskId: task.id,
        engine: "workspace-agent",
        runtime: this.runtimeName()
      };
    } catch (error) {
      await this.state.finishTask(task.id, {
        status: "failed",
        error: error?.message || "Prompt submit failed."
      });
      throw error;
    }
  }

  async respondToApproval(params = {}) {
    await this.state.ensure();
    const result = await this.chatRuntime.respondToApproval(params);
    await this.state.recordSessionEvent({
      type: "approval.respond",
      runtime: this.runtimeName(),
      sessionId: params.sessionId,
      approved: params.approved !== false,
      choice: result.choice
    });
    return {
      ...result,
      engine: "workspace-agent",
      runtime: this.runtimeName()
    };
  }

  async setAccessMode(sessionId, accessMode) {
    await this.state.ensure();
    await this.chatRuntime.setAccessMode(sessionId, accessMode);
    await this.state.recordSessionEvent({
      type: "config.accessMode",
      runtime: this.runtimeName(),
      sessionId,
      accessMode
    });
  }

  async setReasoning(sessionId, reasoningEffort) {
    await this.state.ensure();
    await this.chatRuntime.setReasoning(sessionId, reasoningEffort);
    await this.state.recordSessionEvent({
      type: "config.reasoning",
      runtime: this.runtimeName(),
      sessionId,
      reasoningEffort
    });
  }

  async inspectCodeTask(params = {}) {
    return await this.codeRuntime.inspectTask(params);
  }

  async runCodeTaskChecks(taskId, params = {}) {
    return await this.codeRuntime.runChecks(taskId, params);
  }

  async runCodeTaskGit(taskId, params = {}) {
    return await this.codeRuntime.runGitCommand(taskId, params);
  }

  async proposeCodeTaskPatch(taskId, params = {}) {
    const result = await this.codeRuntime.proposePatch(taskId, params);
    if (result.approvalRequest) {
      this.emit("event", {
        engine: "workspace-agent",
        runtime: "code-agent",
        ...result.approvalRequest
      });
    }
    return result;
  }

  async generateCodeTaskPatch(taskId, params = {}) {
    const result = await this.codeRuntime.generateAutomaticPatch(taskId, params);
    if (result.approvalRequest) {
      this.emit("event", {
        engine: "workspace-agent",
        runtime: "code-agent",
        ...result.approvalRequest
      });
    }
    return result;
  }

  async applyCodeTaskPatch(taskId, params = {}) {
    return await this.codeRuntime.applyPatch(taskId, params);
  }

  async rejectCodeTaskPatch(taskId, params = {}) {
    return await this.codeRuntime.rejectPatch(taskId, params);
  }

  async listModels() {
    return await this.modelRuntime.listModels();
  }

  async listSessions(limit) {
    return await this.sessionRuntime.listSessions(limit);
  }

  async getSessionMessages(sessionId) {
    return await this.sessionRuntime.getSessionMessages(sessionId);
  }

  async deleteSession(sessionId) {
    return await this.sessionRuntime.deleteSession(sessionId);
  }

  async listTasks(params = {}) {
    return await this.state.listTasks(params);
  }

  async readTask(taskId) {
    return await this.state.readTask(taskId);
  }

  async listApprovals(params = {}) {
    return await this.state.listApprovals(params);
  }

  async readApproval(approvalId) {
    return await this.state.readApproval(approvalId);
  }

  async respondToWorkspaceApproval(approvalId, params = {}) {
    await this.state.ensure();
    const approval = await this.state.readApproval(approvalId);
    const approved = params.approved !== false;
    if (approval.status && approval.status !== "pending") {
      return {
        ok: true,
        engine: "workspace-agent",
        status: approval.status,
        approval,
        alreadyResolved: true
      };
    }
    if (approval.category === "code.patch.apply" && approval.taskId && approval.proposalId) {
      if (approved) {
        const result = await this.applyCodeTaskPatch(approval.taskId, {
          proposalId: approval.proposalId,
          approved: true,
          approvalId: approval.id,
          runChecksAfterApply: params.runChecksAfterApply,
          checksApproved: params.checksApproved
        });
        return {
          ok: true,
          engine: "workspace-agent",
          status: "approved",
          approval: await this.state.readApproval(approval.id),
          result
        };
      }
      const result = await this.rejectCodeTaskPatch(approval.taskId, {
        proposalId: approval.proposalId,
        approvalId: approval.id,
        reason: params.reason || "Rejected from approval inbox."
      });
      return {
        ok: true,
        engine: "workspace-agent",
        status: "rejected",
        approval: await this.state.readApproval(approval.id),
        result
      };
    }
    if (approval.category === "code.checks.run" && approval.taskId) {
      if (approved) {
        const result = await this.runCodeTaskChecks(approval.taskId, {
          approved: true,
          approvalId: approval.id
        });
        return {
          ok: result.ok,
          engine: "workspace-agent",
          status: "approved",
          approval: await this.state.readApproval(approval.id),
          result
        };
      }
      const rejected = await this.state.resolveApproval(approval.id, {
        approved: false,
        reason: params.reason || "Rejected from approval inbox."
      });
      return {
        ok: true,
        engine: "workspace-agent",
        status: "rejected",
        approval: rejected
      };
    }
    const resolved = await this.state.resolveApproval(approval.id, {
      approved,
      reason: params.reason
    });
    return {
      ok: true,
      engine: "workspace-agent",
      status: resolved.status,
      approval: resolved
    };
  }

  async flush() {
    await Promise.allSettled([...this.eventWrites]);
  }

  runtimeName() {
    return this.runtime?.name || "ai-workspace-runtime";
  }

  close() {
    this.chatRuntime.close();
  }

  trackTranscriptEvent(event) {
    const sessionId = event.sessionId;
    if (!sessionId) return;
    const taskId = event.taskId || "";
    const key = assistantTurnKey(sessionId, taskId);
    const type = String(event.type || "");
    const text = event.text || event.payload?.text || "";

    if (isAssistantDeltaEvent(type)) {
      const current = this.assistantTurnBuffers.get(key) || {
        sessionId,
        taskId,
        content: ""
      };
      current.content += text;
      this.assistantTurnBuffers.set(key, current);
      return;
    }

    if (isAssistantCompleteEvent(type)) {
      const current = this.assistantTurnBuffers.get(key);
      const content = current?.content || text || "";
      this.assistantTurnBuffers.delete(key);
      if (!content || this.persistedAssistantTurns.has(key)) return;
      this.persistedAssistantTurns.add(key);
      this.trackEventWrite(this.sessionRuntime.appendSessionMessage(sessionId, {
        role: "assistant",
        content,
        taskId,
        source: "stream"
      }));
    }
  }

  hasPersistedAssistantTurn(sessionId, taskId) {
    return this.persistedAssistantTurns.has(assistantTurnKey(sessionId, taskId || ""));
  }

  async resolveContext(params) {
    if (!params.contextRequest) return params.context || {};
    return {
      ...(params.context || {}),
      workspaceContext: await buildWorkspaceContext(this.config.workspaceRoot, params.contextRequest)
    };
  }

  trackEventWrite(promise) {
    const tracked = Promise.resolve(promise)
      .catch(() => {})
      .finally(() => this.eventWrites.delete(tracked));
    this.eventWrites.add(tracked);
  }
}

export class WorkspaceAgentStateStore {
  constructor(workspaceRoot) {
    this.workspaceRoot = workspaceRoot;
    this.root = path.join(workspaceRoot, ".ai-workspace");
    this.ready = null;
  }

  async ensure() {
    if (!this.ready) {
      this.ready = Promise.all([
        fs.mkdir(path.join(this.root, "sessions"), { recursive: true }),
        fs.mkdir(path.join(this.root, "tasks"), { recursive: true }),
        fs.mkdir(path.join(this.root, "memory"), { recursive: true }),
        fs.mkdir(path.join(this.root, "approvals"), { recursive: true }),
        fs.mkdir(path.join(this.root, "decisions"), { recursive: true }),
        fs.mkdir(path.join(this.root, "tool-logs"), { recursive: true }),
        fs.mkdir(path.join(this.root, "diffs"), { recursive: true }),
        fs.mkdir(path.join(this.root, "index"), { recursive: true })
      ]);
    }
    await this.ready;
  }

  async startTask(input) {
    await this.ensure();
    const task = {
      id: `task-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID()}`,
      status: "started",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...definedFields(input)
    };
    await this.writeTask(task);
    await this.appendJsonl("tasks/events.jsonl", {
      type: "task.start",
      taskId: task.id,
      sessionId: task.sessionId,
      createdAt: task.createdAt,
      runtime: task.runtime
    });
    return task;
  }

  async finishTask(taskId, patch) {
    await this.ensure();
    const task = await this.readTask(taskId);
    const updated = {
      ...task,
      ...definedFields(patch),
      updatedAt: new Date().toISOString()
    };
    await this.writeTask(updated);
    await this.appendJsonl("tasks/events.jsonl", {
      type: "task.finish",
      taskId,
      status: updated.status,
      updatedAt: updated.updatedAt,
      error: updated.error
    });
    return updated;
  }

  async recordSessionEvent(event) {
    await this.ensure();
    await this.appendJsonl("sessions/events.jsonl", {
      at: new Date().toISOString(),
      ...definedFields(event)
    });
  }

  async writeSession(session) {
    await this.ensure();
    const filePath = path.join(this.root, "sessions", `${session.id}.json`);
    await fs.writeFile(filePath, JSON.stringify(session, null, 2), "utf8");
  }

  async readSession(sessionId) {
    await this.ensure();
    const filePath = path.join(this.root, "sessions", `${sessionId}.json`);
    try {
      const data = await fs.readFile(filePath, "utf8");
      return JSON.parse(data);
    } catch {
      return null;
    }
  }

  async listWorkspaceSessions() {
    await this.ensure();
    const dirPath = path.join(this.root, "sessions");
    try {
      const files = await fs.readdir(dirPath);
      const sessions = [];
      for (const file of files) {
        if (file.endsWith(".json")) {
          try {
            const data = await fs.readFile(path.join(dirPath, file), "utf8");
            sessions.push(JSON.parse(data));
          } catch {}
        }
      }
      return sessions.sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
    } catch {
      return [];
    }
  }

  async recordAgentEvent(event) {
    await this.ensure();
    const record = {
      at: new Date().toISOString(),
      ...definedFields(event)
    };
    await this.appendJsonl("tool-logs/live-events.jsonl", record);
    if (String(event.type || "").includes("tool") || event.type === "approval.request") {
      await this.appendJsonl("tool-logs/tool-events.jsonl", record);
    }
  }

  async recordToolLog(event) {
    await this.ensure();
    await this.appendJsonl("tool-logs/tool-events.jsonl", {
      at: new Date().toISOString(),
      ...definedFields(event)
    });
  }

  async recordDecision(value) {
    await this.ensure();
    const record = {
      at: new Date().toISOString(),
      ...definedFields(value)
    };
    await this.appendJsonl("decisions/events.jsonl", record);
    return { path: ".ai-workspace/decisions/events.jsonl", record };
  }

  async recordApprovalRequest(value) {
    await this.ensure();
    const now = new Date().toISOString();
    const id = value.approvalId || `approval-${now.replace(/[:.]/g, "-")}-${randomUUID()}`;
    const approval = {
      id,
      approvalId: id,
      type: "approval.request",
      status: "pending",
      createdAt: now,
      updatedAt: now,
      ...definedFields(value)
    };
    await this.writeApproval(approval);
    await this.appendJsonl("approvals/events.jsonl", {
      type: "approval.request.created",
      at: now,
      approvalId: approval.id,
      category: approval.category,
      taskId: approval.taskId,
      proposalId: approval.proposalId,
      scopePath: approval.scopePath
    });
    return approval;
  }

  async resolveApproval(approvalId, response = {}) {
    await this.ensure();
    const approval = await this.readApproval(approvalId);
    const approved = response.approved !== false;
    const status = approved ? "approved" : "rejected";
    if (approval.status && approval.status !== "pending") {
      if (approval.status === status) return { ...approval, alreadyResolved: true };
      throw Object.assign(new Error(`Approval is already ${approval.status}.`), { status: 409 });
    }
    const now = new Date().toISOString();
    const updated = {
      ...approval,
      status,
      approved,
      reason: response.reason || approval.reason,
      response: definedFields(response.response || {}),
      respondedAt: now,
      updatedAt: now
    };
    await this.writeApproval(updated);
    await this.appendJsonl("approvals/events.jsonl", {
      type: "approval.request.resolved",
      at: now,
      approvalId: updated.id,
      category: updated.category,
      taskId: updated.taskId,
      proposalId: updated.proposalId,
      status: updated.status,
      approved,
      reason: updated.reason
    });
    return updated;
  }

  async readApproval(approvalId) {
    const text = await fs.readFile(this.approvalPath(approvalId), "utf8");
    return JSON.parse(text);
  }

  async listApprovals(options = {}) {
    await this.ensure();
    const status = String(options.status || "").trim();
    const category = String(options.category || "").trim();
    const taskId = String(options.taskId || "").trim();
    const limit = clampNumber(options.limit, 1, 200, 50);
    let entries = [];
    try {
      entries = await fs.readdir(path.join(this.root, "approvals"), { withFileTypes: true });
    } catch {
      return { approvals: [] };
    }
    const approvals = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      try {
        const approval = JSON.parse(await fs.readFile(path.join(this.root, "approvals", entry.name), "utf8"));
        if (status && approval.status !== status) continue;
        if (category && approval.category !== category) continue;
        if (taskId && approval.taskId !== taskId) continue;
        approvals.push(summarizeApproval(approval));
      } catch {}
    }
    approvals.sort((a, b) => String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || "")));
    return { approvals: approvals.slice(0, limit) };
  }

  async writeDiff(taskId, content, label = "") {
    await this.ensure();
    const suffix = label ? `-${safeArtifactName(label)}` : "";
    const fileName = `${safeArtifactName(taskId)}${suffix}.diff`;
    const filePath = path.join(this.root, "diffs", fileName);
    await fs.writeFile(filePath, String(content || ""), "utf8");
    return `.ai-workspace/diffs/${fileName}`;
  }

  async readTask(taskId) {
    const text = await fs.readFile(this.taskPath(taskId), "utf8");
    return JSON.parse(text);
  }

  async listTasks(options = {}) {
    await this.ensure();
    const type = String(options.type || "").trim();
    const limit = clampNumber(options.limit, 1, 200, 50);
    let entries = [];
    try {
      entries = await fs.readdir(path.join(this.root, "tasks"), { withFileTypes: true });
    } catch {
      return { tasks: [] };
    }
    const tasks = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      try {
        const task = JSON.parse(await fs.readFile(path.join(this.root, "tasks", entry.name), "utf8"));
        if (type && task.type !== type) continue;
        tasks.push(summarizeTask(task));
      } catch {}
    }
    tasks.sort((a, b) => String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || "")));
    return { tasks: tasks.slice(0, limit) };
  }

  async writeTask(task) {
    await fs.writeFile(this.taskPath(task.id), JSON.stringify(task, null, 2) + "\n", "utf8");
  }

  async writeApproval(approval) {
    await fs.writeFile(this.approvalPath(approval.id), JSON.stringify(approval, null, 2) + "\n", "utf8");
  }

  taskPath(taskId) {
    return path.join(this.root, "tasks", `${taskId}.json`);
  }

  approvalPath(approvalId) {
    return path.join(this.root, "approvals", `${safeArtifactName(approvalId)}.json`);
  }

  async appendJsonl(relativePath, value) {
    await fs.appendFile(
      path.join(this.root, relativePath),
      JSON.stringify(value) + "\n",
      "utf8"
    );
  }

}

function assistantTurnKey(sessionId, taskId = "") {
  return `${sessionId}::${taskId || ""}`;
}

function isAssistantDeltaEvent(type) {
  return type === "message.delta" || type === "assistant.delta" || type === "assistant.message.delta";
}

function isAssistantCompleteEvent(type) {
  return type === "message.done"
    || type === "response.done"
    || type === "turn.complete"
    || type === "turn.completed"
    || type === "message.completed";
}

function definedFields(value) {
  return Object.fromEntries(
    Object.entries(value || {}).filter(([, item]) => item !== undefined && item !== null && item !== "")
  );
}

function workspaceRuntimeNotConfiguredReply(params = {}) {
  return {
    ok: true,
    sessionId: params.sessionId,
    runtimeSessionId: "",
    source: "ai-workspace",
    reply: [
      "AI Workspace runtime is running, but no model execution backend is configured yet.",
      "Configure a provider with `aiw auth` and select a model with `aiw model set-default`."
    ].join("\n")
  };
}

function safeArtifactName(value) {
  return String(value || "artifact").replace(/[^a-zA-Z0-9_.-]/g, "-");
}

function summarizeTask(task) {
  return {
    id: task.id,
    type: task.type,
    status: task.status,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    runtime: task.runtime,
    sessionId: task.sessionId,
    scopePath: task.scopePath,
    message: task.message,
    summary: task.plan?.summary || task.result?.summary || task.error || ""
  };
}

function summarizeApproval(approval) {
  return {
    id: approval.id,
    type: approval.type,
    status: approval.status,
    category: approval.category,
    createdAt: approval.createdAt,
    updatedAt: approval.updatedAt,
    respondedAt: approval.respondedAt,
    taskId: approval.taskId,
    proposalId: approval.proposalId,
    scopePath: approval.scopePath,
    summary: approval.summary,
    diffRef: approval.diffRef,
    commands: approval.commands,
    reason: approval.reason
  };
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(number)));
}
