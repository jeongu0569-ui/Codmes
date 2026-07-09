import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { OpenAICompatibleRuntime } from "./openai-compatible-runtime.mjs";
import { setCredentialValue, setDefaultModel, writeRuntimeConfig } from "./config-store.mjs";

test("OpenAI-compatible runtime streams chat completions from AI Workspace config", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "aiw-openai-runtime-"));
  await setDefaultModel(root, "custom", "demo-model");
  await setCredentialValue(root, "custom", "AIW_CUSTOM_BASE_URL", "http://model.test/v1");
  await setCredentialValue(root, "custom", "AIW_CUSTOM_API_KEY", "test-key");

  let request = null;
  const runtime = new OpenAICompatibleRuntime({
    workspaceRoot: root,
    fetchImpl: async (url, options) => {
      request = { url, options, body: JSON.parse(options.body) };
      return {
        ok: true,
        headers: { get: () => "text/event-stream" },
        body: streamChunks([
          'data: {"choices":[{"delta":{"content":"안녕"}}]}\n\n',
          'data: {"choices":[{"delta":{"content":"하세요"}}]}\n\n',
          'data: [DONE]\n\n'
        ])
      };
    }
  });

  const events = [];
  runtime.on("event", (event) => events.push(event));

  const result = await runtime.submitPrompt({
    sessionId: "session-1",
    message: "소개해줘",
    history: [
      { role: "user", content: "이전 질문" },
      { role: "assistant", content: "이전 답변" }
    ],
    context: {
      workspaceContext: {
        workspace: { scopeType: "current", activePath: "Notes/a.md" },
        inlineBlocks: [{ title: "Current resource", path: "Notes/a.md", content: "# Alpha" }]
      }
    }
  });

  assert.equal(result.reply, "안녕하세요");
  assert.equal(request.url, "http://model.test/v1/chat/completions");
  assert.equal(request.options.headers.authorization, "Bearer test-key");
  assert.equal(request.body.model, "demo-model");
  assert.equal(request.body.messages[0].role, "system");
  assert.match(request.body.messages[0].content, /Notes\/a\.md/);
  assert.deepEqual(request.body.messages.slice(-3).map((m) => m.role), ["user", "assistant", "user"]);
  assert.deepEqual(events.map((event) => event.type), ["turn.start", "message.delta", "message.delta", "turn.complete"]);
});

test("OpenAI-compatible runtime reports setup when no model is selected", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "aiw-openai-runtime-missing-"));
  const runtime = new OpenAICompatibleRuntime({ workspaceRoot: root });
  await assert.rejects(
    () => runtime.submitPrompt({ sessionId: "session-1", message: "hello" }),
    /No default model is configured/
  );
});

test("OpenAI-compatible runtime executes workspace search tool calls", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "aiw-openai-runtime-tools-"));
  await fs.mkdir(path.join(root, "Notes"), { recursive: true });
  await fs.writeFile(path.join(root, "Notes", "git.md"), "# Git\n\ngit pull brings remote changes.", "utf8");
  await setDefaultModel(root, "custom", "demo-model");
  await setCredentialValue(root, "custom", "AIW_CUSTOM_BASE_URL", "http://model.test/v1");
  await setCredentialValue(root, "custom", "AIW_CUSTOM_API_KEY", "test-key");

  const requests = [];
  const runtime = new OpenAICompatibleRuntime({
    workspaceRoot: root,
    fetchImpl: async (_url, options) => {
      requests.push(JSON.parse(options.body));
      if (requests.length === 1) {
        return {
          ok: true,
          headers: { get: () => "text/event-stream" },
          body: streamChunks([
            'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_search","type":"function","function":{"name":"workspace_search","arguments":"{\\"query\\":\\"git pull\\",\\"scopePath\\":\\"Notes\\"}"}}]}}]}\n\n',
            'data: [DONE]\n\n'
          ])
        };
      }
      return {
        ok: true,
        headers: { get: () => "text/event-stream" },
        body: streamChunks([
          'data: {"choices":[{"delta":{"content":"git pull 설명을 찾았어요."}}]}\n\n',
          'data: [DONE]\n\n'
        ])
      };
    }
  });

  const events = [];
  runtime.on("event", (event) => events.push(event));

  const result = await runtime.submitPrompt({
    sessionId: "session-1",
    message: "git pull 관련 노트 있어?"
  });

  assert.equal(result.reply, "git pull 설명을 찾았어요.");
  assert.equal(result.toolRounds, 1);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].tools.length, 3);
  const toolMessage = requests[1].messages.find((message) => message.role === "tool");
  assert.equal(toolMessage.name, "workspace_search");
  assert.match(toolMessage.content, /Notes\/git\.md/);
  assert.deepEqual(events.map((event) => event.type), [
    "turn.start",
    "tool.start",
    "tool.complete",
    "message.delta",
    "turn.complete"
  ]);
});

async function* streamChunks(chunks) {
  for (const chunk of chunks) yield Buffer.from(chunk, "utf8");
}

test("OpenAI-compatible runtime executes fallback provider chain on error", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "aiw-openai-runtime-fallback-"));
  await setDefaultModel(root, "openai-api", "gpt-5.5");
  await setCredentialValue(root, "openai-api", "AIW_OPENAI_API_KEY", "primary-key");
  await setCredentialValue(root, "lmstudio", "AIW_LM_API_KEY", "fallback-key");

  await writeRuntimeConfig(root, {
    defaultModel: { provider: "openai-api", model: "gpt-5.5" },
    fallbackChain: ["lmstudio:local-model"]
  });

  const calls = [];
  const runtime = new OpenAICompatibleRuntime({
    workspaceRoot: root,
    fetchImpl: async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body) });
      if (calls.length === 1) {
        return {
          ok: false,
          status: 429,
          text: async () => "Rate limit exceeded"
        };
      }
      return {
        ok: true,
        headers: { get: () => "text/event-stream" },
        body: streamChunks([
          'data: {"choices":[{"delta":{"content":"성공"}}]}\n\n',
          'data: [DONE]\n\n'
        ])
      };
    }
  });

  const events = [];
  runtime.on("event", (event) => events.push(event));

  const result = await runtime.submitPrompt({
    sessionId: "session-fallback",
    message: "테스트"
  });

  assert.equal(result.reply, "성공");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].body.model, "gpt-5.5");
  assert.equal(calls[1].body.model, "local-model");
  assert.ok(events.some(e => e.type === "fallback.attempt"));
});

test("OpenAI-compatible runtime filters tools using disabledTools config", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "aiw-openai-runtime-tools-filter-"));
  await setDefaultModel(root, "openai-api", "gpt-5.5");
  await setCredentialValue(root, "openai-api", "AIW_OPENAI_API_KEY", "test-key");

  await writeRuntimeConfig(root, {
    defaultModel: { provider: "openai-api", model: "gpt-5.5" },
    disabledTools: ["workspace_search"]
  });

  let sentTools = null;
  const runtime = new OpenAICompatibleRuntime({
    workspaceRoot: root,
    fetchImpl: async (url, options) => {
      const body = JSON.parse(options.body);
      sentTools = body.tools;
      return {
        ok: true,
        headers: { get: () => "text/event-stream" },
        body: streamChunks([
          'data: {"choices":[{"delta":{"content":"필터 완료"}}]}\n\n',
          'data: [DONE]\n\n'
        ])
      };
    }
  });

  await runtime.submitPrompt({ sessionId: "session-1", message: "안녕" });
  assert.ok(sentTools);
  assert.equal(sentTools.some(t => t.function.name === "workspace_search"), false);
  assert.equal(sentTools.some(t => t.function.name === "workspace_read_file"), true);
});

test("OpenAI-compatible runtime exposes MCP tools and stub-executes them", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "aiw-openai-runtime-mcp-"));
  await setDefaultModel(root, "openai-api", "gpt-5.5");
  await setCredentialValue(root, "openai-api", "AIW_OPENAI_API_KEY", "test-key");

  await writeRuntimeConfig(root, {
    defaultModel: { provider: "openai-api", model: "gpt-5.5" },
    mcpServers: [
      { name: "calculator", command: "node", args: ["calc.js"], enabled: true }
    ]
  });

  let sentTools = null;
  const runtime = new OpenAICompatibleRuntime({
    workspaceRoot: root,
    fetchImpl: async (url, options) => {
      const body = JSON.parse(options.body);
      sentTools = body.tools;
      return {
        ok: true,
        headers: { get: () => "text/event-stream" },
        body: streamChunks([
          'data: {"choices":[{"delta":{"content":"mcp tool found"}}]}\n\n',
          'data: [DONE]\n\n'
        ])
      };
    }
  });

  await runtime.submitPrompt({ sessionId: "session-1", message: "계산해줘" });
  assert.ok(sentTools);
  assert.equal(sentTools.some(t => t.function.name === "mcp_calculator_tool"), true);

  const execResult = await runtime.executeToolCall({
    id: "call_mcp",
    name: "mcp_calculator_tool",
    arguments: '{"a":1}'
  }, { sessionId: "session-1" });

  assert.equal(execResult.ok, true);
  assert.match(execResult.output, /Executed MCP command: node calc.js/);
});

test("SessionRuntime rename, export, and prune", async () => {
  const { SessionRuntime } = await import("../session-runtime.mjs");
  const { WorkspaceAgentStateStore } = await import("../agent-engine.mjs");

  const root = await fs.mkdtemp(path.join(os.tmpdir(), "aiw-sessions-test-"));
  const stateStore = new WorkspaceAgentStateStore(root);
  await stateStore.ensure();

  const sessionRuntime = new SessionRuntime({ stateStore });

  const sessionId = "sess-123";
  const sessionObj = {
    id: sessionId,
    title: "Old Title",
    model: "demo-model",
    preview: "",
    updatedAt: new Date().toISOString(),
    messages: [
      { role: "user", content: "안녕", createdAt: new Date().toISOString() },
      { role: "assistant", content: "반가워", createdAt: new Date().toISOString() }
    ]
  };
  await stateStore.writeSession(sessionObj);

  const renameRes = await sessionRuntime.renameSession(sessionId, "New Title");
  assert.equal(renameRes.ok, true);
  const updated = await stateStore.readSession(sessionId);
  assert.equal(updated.title, "New Title");

  const exportRes = await sessionRuntime.exportSession(sessionId);
  assert.equal(exportRes.ok, true);
  assert.match(exportRes.markdown, /# Session: New Title/);
  assert.match(exportRes.markdown, /## USER\n안녕/);

  const emptySessionId = "sess-empty";
  await stateStore.writeSession({
    id: emptySessionId,
    title: "Empty Session",
    updatedAt: new Date().toISOString(),
    messages: []
  });

  const pruneRes = await sessionRuntime.pruneSessions();
  assert.equal(pruneRes.ok, true);
  assert.equal(pruneRes.pruned, 1);

  const emptySession = await stateStore.readSession(emptySessionId);
  assert.equal(emptySession, null);
});
