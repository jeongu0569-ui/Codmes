import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  ensureRuntimeConfig,
  readCredentials,
  readRuntimeConfig,
  runtimeConfigDir,
  setDefaultModel
} from "./config-store.mjs";

test("Hermes-compatible custom endpoint config is executable by AI Workspace", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "aiw-custom-model-"));
  await ensureRuntimeConfig(root);
  await fs.writeFile(path.join(runtimeConfigDir(root), "config.yaml"), `model:
  default: gemma4:e2b-mlx
  provider: custom
  base_url: http://127.0.0.1:11434/v1
  api_mode: chat_completions
custom_providers:
  - name: Ollama Local
    base_url: http://127.0.0.1:11434/v1
    model: gemma4:e2b-mlx
    api_mode: chat_completions
`);

  const config = await readRuntimeConfig(root);
  const credentials = await readCredentials(root);
  assert.equal(config.defaultModel.baseUrl, "http://127.0.0.1:11434/v1");
  assert.equal(config.defaultModel.apiMode, "chat_completions");
  assert.equal(credentials.providers.custom.values.baseUrl, "http://127.0.0.1:11434/v1");

  await setDefaultModel(root, "custom", "another-model");
  const updated = await fs.readFile(path.join(runtimeConfigDir(root), "config.yaml"), "utf8");
  assert.match(updated, /base_url: http:\/\/127\.0\.0\.1:11434\/v1/);
  assert.match(updated, /api_mode: chat_completions/);
  assert.match(updated, /model: gemma4:e2b-mlx/);
});
