import fs from "node:fs/promises";
import { EventEmitter } from "node:events";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { HermesLiveClient } from "./hermes-live.mjs";
import { buildWorkspaceContext } from "./context-router.mjs";
import { CodeAgentRuntime } from "./code-agent-runtime.mjs";

export function createWorkspaceAgentEngine(config) {
  return new WorkspaceAgentEngine(config, new HermesAgentAdapter(config.hermes));
}

export async function ensureAgentWorkspaceState(workspaceRoot) {
  await new WorkspaceAgentStateStore(workspaceRoot).ensure();
}

export class WorkspaceAgentEngine extends EventEmitter {
  constructor(config, adapter) {
    super();
    this.config = config;
    this.adapter = adapter;
    this.state = new WorkspaceAgentStateStore(config.workspaceRoot);
    this.codeRuntime = new CodeAgentRuntime({
      workspaceRoot: config.workspaceRoot,
      stateStore: this.state
    });
    this.eventWrites = new Set();

    this.adapter.on("event", (event) => {
      const enriched = {
        engine: "workspace-agent",
        adapter: this.adapter.name,
        ...event
      };
      this.trackEventWrite(this.state.recordAgentEvent(enriched));
      this.emit("event", enriched);
    });
    this.adapter.on("close", () => this.emit("close"));
  }

  async connect() {
    await this.state.ensure();
    await this.adapter.connect();
    await this.state.recordSessionEvent({
      type: "engine.connect",
      adapter: this.adapter.name
    });
  }

  async createSession(params = {}) {
    await this.state.ensure();
    const result = await this.adapter.createSession(params);
    await this.state.recordSessionEvent({
      type: "session.create",
      adapter: this.adapter.name,
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
      adapter: this.adapter.name
    };
  }

  async resumeSession(sessionId) {
    await this.state.ensure();
    const runtimeSessionId = await this.adapter.resumeSession(sessionId);
    await this.state.recordSessionEvent({
      type: "session.resume",
      adapter: this.adapter.name,
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
      adapter: this.adapter.name,
      sessionId: params.sessionId,
      message: params.message,
      contextRequest: params.contextRequest,
      provider: params.provider,
      model: params.model,
      accessMode: params.accessMode,
      reasoningEffort: params.reasoningEffort
    });
    try {
      const result = await this.adapter.submitPrompt({
        ...params,
        context,
        taskId: task.id
      });
      await this.state.finishTask(task.id, {
        status: "submitted",
        result
      });
      return {
        ...result,
        taskId: task.id,
        engine: "workspace-agent",
        adapter: this.adapter.name
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
    const result = await this.adapter.respondToApproval(params);
    await this.state.recordSessionEvent({
      type: "approval.respond",
      adapter: this.adapter.name,
      sessionId: params.sessionId,
      approved: params.approved !== false,
      choice: result.choice
    });
    return {
      ...result,
      engine: "workspace-agent",
      adapter: this.adapter.name
    };
  }

  async setAccessMode(sessionId, accessMode) {
    await this.state.ensure();
    await this.adapter.setAccessMode(sessionId, accessMode);
    await this.state.recordSessionEvent({
      type: "config.accessMode",
      adapter: this.adapter.name,
      sessionId,
      accessMode
    });
  }

  async setReasoning(sessionId, reasoningEffort) {
    await this.state.ensure();
    await this.adapter.setReasoning(sessionId, reasoningEffort);
    await this.state.recordSessionEvent({
      type: "config.reasoning",
      adapter: this.adapter.name,
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

  async proposeCodeTaskPatch(taskId, params = {}) {
    const result = await this.codeRuntime.proposePatch(taskId, params);
    if (result.approvalRequest) {
      this.emit("event", {
        engine: "workspace-agent",
        adapter: "code-agent",
        ...result.approvalRequest
      });
    }
    return result;
  }

  async applyCodeTaskPatch(taskId, params = {}) {
    return await this.codeRuntime.applyPatch(taskId, params);
  }

  async listTasks(params = {}) {
    return await this.state.listTasks(params);
  }

  async readTask(taskId) {
    return await this.state.readTask(taskId);
  }

  async flush() {
    await Promise.allSettled([...this.eventWrites]);
  }

  close() {
    this.adapter.close();
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

export class HermesAgentAdapter extends EventEmitter {
  constructor(config) {
    super();
    this.name = "hermes-live";
    this.client = new HermesLiveClient(config);
    this.client.on("event", (event) => this.emit("event", event));
    this.client.on("close", () => this.emit("close"));
  }

  async connect() {
    return await this.client.connect();
  }

  async createSession(params) {
    return await this.client.createSession(params);
  }

  async resumeSession(sessionId) {
    return await this.client.resumeSession(sessionId);
  }

  async submitPrompt(params) {
    return await this.client.submitPrompt(params);
  }

  async respondToApproval(params) {
    return await this.client.respondToApproval(params);
  }

  async setAccessMode(sessionId, accessMode) {
    return await this.client.setAccessMode(sessionId, accessMode);
  }

  async setReasoning(sessionId, reasoningEffort) {
    return await this.client.setReasoning(sessionId, reasoningEffort);
  }

  close() {
    this.client.close();
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
      adapter: task.adapter
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

  taskPath(taskId) {
    return path.join(this.root, "tasks", `${taskId}.json`);
  }

  async appendJsonl(relativePath, value) {
    await fs.appendFile(
      path.join(this.root, relativePath),
      JSON.stringify(value) + "\n",
      "utf8"
    );
  }
}

function definedFields(value) {
  return Object.fromEntries(
    Object.entries(value || {}).filter(([, item]) => item !== undefined && item !== null && item !== "")
  );
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
    adapter: task.adapter,
    sessionId: task.sessionId,
    scopePath: task.scopePath,
    message: task.message,
    summary: task.plan?.summary || task.result?.summary || task.error || ""
  };
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(number)));
}
