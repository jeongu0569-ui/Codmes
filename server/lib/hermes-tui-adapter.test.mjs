import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { startHermesTuiAdapter } from "./hermes-tui-adapter.mjs";
import { readRuntimeConfig, setCredentialValue, setDefaultModel } from "./runtime/config-store.mjs";

test("Hermes TUI adapter exposes Codmes sessions, model picker data, and slash commands", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codmes-hermes-tui-adapter-"));
  await setDefaultModel(root, "ollama-local", "gemma4:e2b-mlx");
  await setCredentialValue(root, "openai-api", "CODMES_OPENAI_API_KEY", "test-key");

  const adapter = await startHermesTuiAdapter({ workspaceRoot: root });
  const socket = new WebSocket(adapter.url);
  const pending = new Map();
  let nextId = 1;

  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    message.error ? reject(new Error(message.error.message)) : resolve(message.result);
  };

  const rpc = (method, params = {}) => {
    const id = nextId++;
    socket.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      setTimeout(() => reject(new Error(`Timed out waiting for ${method}`)), 5000).unref?.();
    });
  };

  try {
    await new Promise((resolve, reject) => {
      socket.onopen = resolve;
      socket.onerror = reject;
    });

    const models = await rpc("model.options");
    assert.equal(models.model, "gemma4:e2b-mlx");
    assert.ok(models.providers.some((provider) => provider.slug === "ollama-local"));
    assert.ok(models.providers.some((provider) => provider.slug === "openai-api" && provider.authenticated));

    const created = await rpc("session.create");
    assert.ok(created.session_id);
    const toolCount = Object.values(created.info.tools || {}).reduce((sum, items) => sum + items.length, 0);
    assert.ok(toolCount > 0);

    const listed = await rpc("session.list");
    assert.ok(listed.sessions.some((session) => session.id === created.session_id));

    const help = await rpc("slash.exec", { command: "help", session_id: created.session_id });
    assert.match(help.output, /\/model/);
    assert.match(help.output, /\/approvals/);

    const changed = await rpc("config.set", {
      key: "model",
      value: "gpt-5.5 --provider openai-api --tui-session",
      session_id: created.session_id
    });
    assert.equal(changed.value, "gpt-5.5 --provider openai-api");
    const config = await readRuntimeConfig(root);
    assert.equal(config.defaultModel.provider, "openai-api");
    assert.equal(config.defaultModel.model, "gpt-5.5");
  } finally {
    socket.close();
    adapter.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
