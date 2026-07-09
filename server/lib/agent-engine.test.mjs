import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { WorkspaceAgentEngine, WorkspaceAgentStateStore } from "./agent-engine.mjs";

test("workspace agent engine resolves context and records task state", async () => {
  const root = await fixtureWorkspace();
  const adapter = new FakeAgentAdapter();
  const engine = new WorkspaceAgentEngine({ workspaceRoot: root }, adapter);

  const session = await engine.createSession({
    provider: "local",
    model: "test-model",
    accessMode: "confirm",
    reasoningEffort: "medium"
  });
  assert.equal(session.sessionId, "stored-1");
  assert.equal(session.engine, "workspace-agent");
  assert.equal(session.adapter, "fake-agent");

  const result = await engine.submitPrompt({
    sessionId: session.sessionId,
    message: "이 노트 설명해줘",
    contextRequest: {
      scopeType: "note",
      scopePath: "Notes/a.md",
      activePath: "Notes/a.md"
    }
  });

  assert.equal(result.ok, true);
  assert.match(result.taskId, /^task-/);
  assert.equal(adapter.lastPrompt.sessionId, "stored-1");
  assert.equal(adapter.lastPrompt.context.workspaceContext.inlineBlocks[0].path, "Notes/a.md");
  assert.match(adapter.lastPrompt.context.workspaceContext.inlineBlocks[0].content, /Alpha note/);

  const task = JSON.parse(await fs.readFile(
    path.join(root, ".ai-workspace", "tasks", `${result.taskId}.json`),
    "utf8"
  ));
  assert.equal(task.status, "submitted");
  assert.equal(task.sessionId, "stored-1");
  assert.equal(task.model, undefined);

  const events = await fs.readFile(path.join(root, ".ai-workspace", "sessions", "events.jsonl"), "utf8");
  assert.match(events, /session.create/);
});

test("workspace agent engine records live tool events under workspace state", async () => {
  const root = await fixtureWorkspace();
  const adapter = new FakeAgentAdapter();
  const engine = new WorkspaceAgentEngine({ workspaceRoot: root }, adapter);

  adapter.emit("event", {
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

class FakeAgentAdapter extends EventEmitter {
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

async function fixtureWorkspace() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-engine-"));
  await fs.mkdir(path.join(root, "Notes"), { recursive: true });
  await fs.writeFile(path.join(root, "Notes", "a.md"), "# Alpha note\n\nHello.", "utf8");
  return root;
}
