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

test("OpenAI-compatible runtime exposes MCP tools and executes them via stdio JSON-RPC", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "aiw-openai-runtime-mcp-"));
  await setDefaultModel(root, "openai-api", "gpt-5.5");
  await setCredentialValue(root, "openai-api", "AIW_OPENAI_API_KEY", "test-key");

  const mockMcpScript = `
import readline from "readline";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

rl.on("line", (line) => {
  if (!line.trim()) return;
  try {
    const req = JSON.parse(line);
    if (req.method === "initialize") {
      process.stdout.write(JSON.stringify({
        jsonrpc: "2.0",
        id: req.id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "mock-calculator", version: "1.0.0" }
        }
      }) + "\\n");
    } else if (req.method === "tools/list") {
      process.stdout.write(JSON.stringify({
        jsonrpc: "2.0",
        id: req.id,
        result: {
          tools: [
            {
              name: "add",
              description: "Add two numbers",
              inputSchema: {
                type: "object",
                properties: {
                  a: { type: "number" },
                  b: { type: "number" }
                },
                required: ["a", "b"]
              }
            }
          ]
        }
      }) + "\\n");
    } else if (req.method === "tools/call") {
      const { a, b } = req.params.arguments || {};
      if (req.params.name === "add") {
        process.stdout.write(JSON.stringify({
          jsonrpc: "2.0",
          id: req.id,
          result: {
            content: [
              { type: "text", text: String((a || 0) + (b || 0)) }
            ]
          }
        }) + "\\n");
      } else {
        process.stdout.write(JSON.stringify({
          jsonrpc: "2.0",
          id: req.id,
          error: { code: -32601, message: "Method not found" }
        }) + "\\n");
      }
    }
  } catch (err) {}
});
`;
  const serverPath = path.join(root, "mock-server.mjs");
  await fs.writeFile(serverPath, mockMcpScript, "utf8");

  await writeRuntimeConfig(root, {
    defaultModel: { provider: "openai-api", model: "gpt-5.5" },
    mcpServers: [
      { name: "calculator", command: "node", args: [serverPath], enabled: true }
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
  assert.equal(sentTools.some(t => t.function.name === "mcp_calculator_add"), true);

  const execResult = await runtime.executeToolCall({
    id: "call_mcp",
    name: "mcp_calculator_add",
    arguments: '{"a":5,"b":10}'
  }, { sessionId: "session-1" });

  assert.equal(execResult.ok, true);
  assert.deepEqual(execResult.output, [{ type: "text", text: "15" }]);

  runtime.close();
});

test("McpClient server crash handling and timeout error", async () => {
  const { McpClient } = await import("./mcp-client.mjs");
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "aiw-mcp-crash-"));
  
  const timeoutServerScript = `
import readline from "readline";
const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });
rl.on("line", (line) => {
  const req = JSON.parse(line);
  if (req.method === "initialize") {
    process.stdout.write(JSON.stringify({
      jsonrpc: "2.0",
      id: req.id,
      result: { protocolVersion: "2024-11-05", capabilities: {}, serverInfo: { name: "timeout-server" } }
    }) + "\\n");
  }
});
`;
  const timeoutServerPath = path.join(root, "timeout-server.mjs");
  await fs.writeFile(timeoutServerPath, timeoutServerScript, "utf8");

  const client = new McpClient("timeout", "node", [timeoutServerPath]);
  await client.start();

  await assert.rejects(
    () => client.sendRequest("tools/list", {}, 100),
    /timed out/
  );

  client.stop();

  const crashServerScript = `
process.exit(1);
`;
  const crashServerPath = path.join(root, "crash-server.mjs");
  await fs.writeFile(crashServerPath, crashServerScript, "utf8");

  const crashClient = new McpClient("crash", "node", [crashServerPath]);
  await assert.rejects(
    () => crashClient.start(),
    /exited with code 1/
  );
  
  crashClient.stop();
});

test("OpenAI-compatible runtime fallback conditions separation", async () => {
  const { classifyError } = await import("./openai-compatible-runtime.mjs");

  assert.equal(classifyError({ status: 429 }), "rate_limit");
  assert.equal(classifyError(new Error("Rate limit exceeded")), "rate_limit");
  assert.equal(classifyError(new Error("Too many requests")), "rate_limit");

  assert.equal(classifyError({ status: 401 }), "auth_error");
  assert.equal(classifyError({ status: 403 }), "auth_error");
  assert.equal(classifyError(new Error("unauthorized access")), "auth_error");
  assert.equal(classifyError(new Error("needs an API key")), "auth_error");

  assert.equal(classifyError(new Error("fetch failed")), "network_error");
  assert.equal(classifyError(new Error("getaddrinfo ENOTFOUND")), "network_error");
  assert.equal(classifyError({ status: 504 }), "network_error");

  assert.equal(classifyError({ status: 503 }), "provider_unavailable");
  assert.equal(classifyError(new Error("Unknown provider: foo")), "provider_unavailable");

  assert.equal(classifyError({ status: 404 }), "model_unavailable");
  assert.equal(classifyError(new Error("Unknown model")), "model_unavailable");
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

test("OpenAI-compatible runtime fallback event condition mapping", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "aiw-openai-runtime-fallback-cond-"));
  await setDefaultModel(root, "openai-api", "gpt-5.5");
  await setCredentialValue(root, "openai-api", "AIW_OPENAI_API_KEY", "primary-key");
  await setCredentialValue(root, "lmstudio", "AIW_LM_API_KEY", "fallback-key");

  await writeRuntimeConfig(root, {
    defaultModel: { provider: "openai-api", model: "gpt-5.5" },
    fallbackChain: ["lmstudio:local-model"]
  });

  const conditions = [
    { status: 429, expected: "rate_limit" },
    { status: 401, expected: "auth_error" },
    { status: 504, expected: "network_error" },
    { status: 404, expected: "model_unavailable" },
    { status: 503, expected: "provider_unavailable" }
  ];

  for (const cond of conditions) {
    let fallbackEvent = null;
    const runtime = new OpenAICompatibleRuntime({
      workspaceRoot: root,
      fetchImpl: async () => {
        return {
          ok: false,
          status: cond.status,
          text: async () => "Mock Error"
        };
      }
    });

    runtime.on("event", (e) => {
      if (e.type === "fallback.attempt") {
        fallbackEvent = e;
      }
    });

    try {
      await runtime.submitPrompt({ sessionId: "session-fallback-cond", message: "테스트" });
    } catch {
      // fine
    }

    assert.ok(fallbackEvent, `Fallback event should be emitted for status ${cond.status}`);
    assert.equal(fallbackEvent.condition, cond.expected);
  }
});

test("McpClient lifecycle: initialize, list, call, idle-timeout, and logs", async () => {
  const { McpClient } = await import("./mcp-client.mjs");
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "aiw-mcp-lifecycle-"));

  const mockMcpScript = `
import readline from "readline";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

rl.on("line", (line) => {
  if (!line.trim()) return;
  const req = JSON.parse(line);
  if (req.method === "initialize") {
    process.stdout.write(JSON.stringify({
      jsonrpc: "2.0",
      id: req.id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "mock-lifecycle", version: "1.0.0" }
      }
    }) + "\\n");
  } else if (req.method === "tools/list") {
    process.stdout.write(JSON.stringify({
      jsonrpc: "2.0",
      id: req.id,
      result: {
        tools: [{ name: "test_tool", description: "A test tool" }]
      }
    }) + "\\n");
  } else if (req.method === "tools/call") {
    process.stderr.write("mcp log test\\n");
    process.stdout.write(JSON.stringify({
      jsonrpc: "2.0",
      id: req.id,
      result: { content: [{ type: "text", text: "hello " + req.params.arguments.val }] }
    }) + "\\n");
  }
});
`;

  const serverPath = path.join(root, "mock-server.mjs");
  await fs.writeFile(serverPath, mockMcpScript, "utf8");

  const client = new McpClient("lifecycle", "node", [serverPath], {
    workspaceRoot: root,
    idleTimeoutMs: 100
  });

  await client.start();
  assert.equal(client.status, "running");

  const tools = await client.listTools();
  assert.equal(tools.length, 1);
  assert.equal(tools[0].name, "test_tool");

  const res = await client.callTool("test_tool", { val: "world" });
  assert.deepEqual(res.content, [{ type: "text", text: "hello world" }]);

  const logFile = path.join(root, ".ai-workspace", "tool-logs", "mcp-lifecycle.stderr.log");
  const logContent = await fs.readFile(logFile, "utf8");
  assert.match(logContent, /mcp log test/);

  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(client.status, "stopped");

  const res2 = await client.callTool("test_tool", { val: "lazy" });
  assert.equal(client.status, "running");
  assert.deepEqual(res2.content, [{ type: "text", text: "hello lazy" }]);

  client.stop();
  assert.equal(client.status, "stopped");
});
