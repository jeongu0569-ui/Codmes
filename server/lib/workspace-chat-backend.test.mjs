import test from "node:test";
import assert from "node:assert/strict";
import { WorkspaceChatBackend } from "./workspace-chat-backend.mjs";
import { parseGitCommand } from "./code-agent-runtime.mjs";

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
