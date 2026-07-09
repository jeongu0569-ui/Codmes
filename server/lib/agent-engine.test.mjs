import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { WorkspaceAgentEngine, WorkspaceAgentStateStore } from "./agent-engine.mjs";

test("workspace agent engine resolves context and records task state", async () => {
  const root = await fixtureWorkspace();
  const runtime = new FakeAgentRuntime();
  const engine = new WorkspaceAgentEngine({ workspaceRoot: root }, runtime);

  const session = await engine.createSession({
    provider: "local",
    model: "test-model",
    accessMode: "confirm",
    reasoningEffort: "medium"
  });
  assert.equal(session.sessionId, "stored-1");
  assert.equal(session.engine, "workspace-agent");

  const prompt = await engine.submitPrompt({
    sessionId: session.sessionId,
    message: "이 노트 설명해줘",
    contextRequest: {
      scopeType: "note",
      scopePath: "Notes/a.md",
      activePath: "Notes/a.md"
    }
  });
  assert.equal(prompt.ok, true);
  assert.equal(runtime.lastPrompt.context.workspaceContext.workspace.activePath, "Notes/a.md");
  assert.equal(runtime.lastPrompt.context.workspaceContext.inlineBlocks[0].path, "Notes/a.md");

  const taskDir = path.join(root, ".ai-workspace", "tasks");
  const allFiles = await fs.readdir(taskDir);
  const taskFiles = allFiles.filter(f => f.startsWith("task-") && f.endsWith(".json"));
  assert.equal(taskFiles.length > 0, true);
  const task = JSON.parse(await fs.readFile(path.join(taskDir, taskFiles[0]), "utf8"));
  assert.equal(task.sessionId, session.sessionId);
  assert.equal(task.status, "submitted");

  const events = await fs.readFile(path.join(root, ".ai-workspace", "sessions", "events.jsonl"), "utf8");
  assert.match(events, /session.create/);
});

test("workspace agent engine records live tool events under workspace state", async () => {
  const root = await fixtureWorkspace();
  const runtime = new FakeAgentRuntime();
  const engine = new WorkspaceAgentEngine({ workspaceRoot: root }, runtime);

  runtime.emit("event", {
    type: "tool.start",
    sessionId: "stored-1",
    text: "search_files"
  });
  await engine.flush();

  const allEvents = await fs.readFile(path.join(root, ".ai-workspace", "tool-logs", "live-events.jsonl"), "utf8");
  const toolEvents = await fs.readFile(path.join(root, ".ai-workspace", "tool-logs", "tool-events.jsonl"), "utf8");
  assert.match(allEvents, /workspace-agent/);
  assert.match(toolEvents, /tool.start/);
  assert.match(toolEvents, /search_files/);
});

test("workspace agent engine persists streamed assistant replies into sessions", async () => {
  const root = await fixtureWorkspace();
  const runtime = new StreamingAgentRuntime();
  const engine = new WorkspaceAgentEngine({ workspaceRoot: root }, runtime);

  const session = await engine.createSession({
    provider: "custom",
    model: "demo-model"
  });

  const first = await engine.submitPrompt({
    sessionId: session.sessionId,
    message: "안녕"
  });
  assert.equal(first.reply, "안녕하세요");

  const stored = await engine.getSessionMessages(session.sessionId);
  assert.deepEqual(stored.messages.map((message) => message.role), ["user", "assistant"]);
  assert.equal(stored.messages[0].content, "안녕");
  assert.equal(stored.messages[1].content, "안녕하세요");

  await engine.submitPrompt({
    sessionId: session.sessionId,
    message: "이전 답변 기억해?"
  });

  assert.deepEqual(runtime.lastPrompt.history.map((message) => message.role), ["user", "assistant"]);
  assert.deepEqual(runtime.lastPrompt.history.map((message) => message.content), ["안녕", "안녕하세요"]);
});

test("workspace agent state creates the unified state directory shape", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-state-"));
  await new WorkspaceAgentStateStore(root).ensure();
  for (const folder of ["sessions", "tasks", "memory", "approvals", "decisions", "tool-logs", "diffs", "index"]) {
    const stat = await fs.stat(path.join(root, ".ai-workspace", folder));
    assert.equal(stat.isDirectory(), true);
  }
});

test("workspace agent state lists task summaries", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-state-list-"));
  const state = new WorkspaceAgentStateStore(root);
  const codeTask = await state.startTask({
    type: "code",
    status: "started",
    message: "change renderer",
    scopePath: "Code/demo"
  });
  await state.finishTask(codeTask.id, {
    status: "inspected",
    plan: { summary: "Code task prepared." }
  });
  await state.startTask({
    type: "chat",
    message: "hello"
  });

  const listed = await state.listTasks({ type: "code" });
  assert.equal(listed.tasks.length, 1);
  assert.equal(listed.tasks[0].id, codeTask.id);
  assert.equal(listed.tasks[0].summary, "Code task prepared.");
  assert.equal(listed.tasks[0].scopePath, "Code/demo");
});

test("workspace agent state records and resolves approval inbox items", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-state-approvals-"));
  const state = new WorkspaceAgentStateStore(root);
  const approval = await state.recordApprovalRequest({
    category: "code.patch.apply",
    taskId: "task-1",
    proposalId: "patch-1",
    scopePath: "Code/demo",
    summary: "Apply patch"
  });

  assert.match(approval.id, /^approval-/);
  assert.equal(approval.status, "pending");

  const listed = await state.listApprovals({ status: "pending" });
  assert.equal(listed.approvals.length, 1);
  assert.equal(listed.approvals[0].id, approval.id);

  const resolved = await state.resolveApproval(approval.id, {
    approved: false,
    reason: "No thanks."
  });
  assert.equal(resolved.status, "rejected");
  assert.equal(resolved.reason, "No thanks.");

  const pending = await state.listApprovals({ status: "pending" });
  assert.equal(pending.approvals.length, 0);
});

class FakeAgentRuntime extends EventEmitter {
  constructor() {
    super();
    this.name = "fake-agent";
    this.lastPrompt = null;
  }

  async connect() {}

  async createSession() {
    return {
      sessionId: "stored-1",
      runtimeSessionId: "runtime-1",
      source: "fake"
    };
  }

  async resumeSession() {
    return "runtime-1";
  }

  async submitPrompt(params) {
    this.lastPrompt = params;
    return {
      ok: true,
      sessionId: params.sessionId,
      runtimeSessionId: "runtime-1"
    };
  }

  async respondToApproval(params) {
    return {
      ok: true,
      sessionId: params.sessionId,
      runtimeSessionId: "runtime-1",
      choice: params.approved === false ? "deny" : "once"
    };
  }

  async setAccessMode() {}

  async setReasoning() {}

  close() {}
}

class StreamingAgentRuntime extends EventEmitter {
  constructor() {
    super();
    this.name = "streaming-agent";
    this.lastPrompt = null;
    this.sessionId = "streamed-1";
  }

  async connect() {}

  async createSession() {
    return {
      sessionId: this.sessionId,
      runtimeSessionId: this.sessionId,
      source: "fake"
    };
  }

  async resumeSession() {
    return this.sessionId;
  }

  async submitPrompt(params) {
    this.lastPrompt = params;
    this.emit("event", {
      type: "message.delta",
      sessionId: params.sessionId,
      taskId: params.taskId,
      text: "안녕"
    });
    this.emit("event", {
      type: "message.delta",
      sessionId: params.sessionId,
      taskId: params.taskId,
      text: "하세요"
    });
    this.emit("event", {
      type: "turn.complete",
      sessionId: params.sessionId,
      taskId: params.taskId,
      text: "안녕하세요"
    });
    return {
      ok: true,
      sessionId: params.sessionId,
      runtimeSessionId: params.sessionId,
      reply: "안녕하세요"
    };
  }

  async respondToApproval() {
    return { ok: true };
  }

  async setAccessMode() {}

  async setReasoning() {}

  close() {}
}

async function fixtureWorkspace() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-engine-"));
  await fs.mkdir(path.join(root, "Notes"), { recursive: true });
  await fs.writeFile(path.join(root, "Notes", "a.md"), "# Alpha note\n\nHello.", "utf8");
  return root;
}
