import test from "node:test";
import assert from "node:assert/strict";
import { WorkspaceChatBackend } from "./workspace-chat-backend.mjs";
import { parseGitCommand } from "./code-agent-runtime.mjs";
import { LLMRuntime, normalizePatchResponse } from "./llm-runtime.mjs";
import { ChatRuntime } from "./chat-runtime.mjs";

test("WorkspaceChatBackend submitPrompt calls openai compatible api", async () => {
  const mockStateStore = {
    readConfig: async () => ({
      model: { default: "qwen2.5-coder:latest", provider: "ollama" },
      providers: {
        ollama: { baseUrl: "http://127.0.0.1:11434/v1", apiKeyRequired: false }
      }
    })
  };

  const mockAuthRuntime = {
    getApiKeyForProvider: async () => null
  };

  const mockProviderRuntime = {};

  const backend = new WorkspaceChatBackend({
    stateStore: mockStateStore,
    authRuntime: mockAuthRuntime,
    providerRuntime: mockProviderRuntime
  });

  // fetch Mocking
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    assert.ok(url.includes("11434/v1/chat/completions"));
    const body = JSON.parse(init.body);
    assert.equal(body.model, "qwen2.5-coder:latest");
    assert.equal(body.messages[0].content, "hello");
    return {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "hi local response" } }]
      })
    };
  };

  try {
    const res = await backend.submitPrompt({
      prompt: "hello",
      sessionId: "test-sess"
    });
    assert.equal(res.ok, true);
    assert.equal(res.reply, "hi local response");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("WorkspaceChatBackend createSession records provider and model", async () => {
  const sessions = {};
  const mockStateStore = {
    writeSession: async (s) => { sessions[s.id] = s; },
    readSession: async (id) => sessions[id] || null
  };
  const backend = new WorkspaceChatBackend({
    stateStore: mockStateStore,
    authRuntime: { getApiKeyForProvider: async () => null },
    providerRuntime: {}
  });
  const { sessionId } = await backend.createSession({ provider: "ollama", model: "qwen2.5-coder:latest" });
  assert.match(sessionId, /^ws-sess-/);
  const stored = sessions[sessionId];
  assert.equal(stored.provider, "ollama");
  assert.equal(stored.model, "qwen2.5-coder:latest");
  assert.ok(stored.createdAt);
  assert.ok(stored.updatedAt);
  assert.deepEqual(stored.messages, []);
});

test("parseGitCommand preserves quotes and partitions tokens correctly", () => {
  const cmd = `git commit -m "initial project build"`;
  const tokens = parseGitCommand(cmd);
  assert.deepEqual(tokens, ["git", "commit", "-m", "initial project build"]);

  const cmd2 = `git status`;
  const tokens2 = parseGitCommand(cmd2);
  assert.deepEqual(tokens2, ["git", "status"]);

  const cmd3 = `git push origin 'feature/branch-name'`;
  const tokens3 = parseGitCommand(cmd3);
  assert.deepEqual(tokens3, ["git", "push", "origin", "feature/branch-name"]);
});

test("LLMRuntime.isAvailable() reflects chat runtime backend state", () => {
  // No hermesCompat, no stateStore → WorkspaceChatBackend is used but needs stateStore
  // With all deps → isAvailable should be true
  const mockState = {
    readConfig: async () => ({}),
    writeSession: async () => {},
    readSession: async () => null
  };
  const mockAuth = { getApiKeyForProvider: async () => null };
  const mockProvider = {};
  const chatRuntime = new ChatRuntime({
    hermesCompat: null,
    stateStore: mockState,
    authRuntime: mockAuth,
    providerRuntime: mockProvider
  });
  const llm = new LLMRuntime({ chatRuntime });
  assert.equal(llm.isAvailable(), true);

  // Without any backend → isAvailable should be false
  const emptyChat = new ChatRuntime({});
  const llmEmpty = new LLMRuntime({ chatRuntime: emptyChat });
  assert.equal(llmEmpty.isAvailable(), false);
});

test("normalizePatchResponse handles canonical, array, and write-op forms", () => {
  // canonical
  const canonical = JSON.stringify({
    summary: "Fix bug",
    changes: [{ path: "src/a.js", find: "old", replace: "new" }]
  });
  const r1 = normalizePatchResponse(canonical, "fix");
  assert.equal(r1.summary, "Fix bug");
  assert.equal(r1.changes[0].find, "old");
  assert.equal(r1.changes[0].replace, "new");

  // bare array with targetContent/replacementContent
  const arr = JSON.stringify([
    { path: "src/b.js", targetContent: "x", replacementContent: "y" }
  ]);
  const r2 = normalizePatchResponse(arr, "update");
  assert.equal(r2.changes[0].find, "x");
  assert.equal(r2.changes[0].replace, "y");

  // write-op form
  const writeOp = JSON.stringify({
    changes: [{ path: "src/c.js", operation: "write", content: "new file content" }]
  });
  const r3 = normalizePatchResponse(writeOp, "write");
  assert.equal(r3.changes[0].operation, "write");
  assert.equal(r3.changes[0].replace, "new file content");
  assert.equal(r3.changes[0].find, "");

  // markdown-wrapped JSON
  const wrapped = "```json\n" + canonical + "\n```";
  const r4 = normalizePatchResponse(wrapped, "fix");
  assert.equal(r4.summary, "Fix bug");
});
