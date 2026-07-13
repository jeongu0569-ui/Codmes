import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  ensureRuntimeConfig,
  envAliases,
  listProviderCredentialEntries,
  listProviderRegistry,
  listCredentialStatus,
  providerEnvKeys,
  readCredentials,
  readRuntimeConfig,
  removeProviderCredentialEntry,
  runtimeConfigDir,
  selectProviderCredentialEntry,
  setCredentialValue,
  setDefaultModel
} from "./config-store.mjs";

test("provider registry only exposes usable user-facing providers", () => {
  const ids = listProviderRegistry().map((provider) => provider.id);
  assert.deepEqual(ids, ["openai-codex", "ollama-cloud", "ollama-local"]);
});

test("Hermes-compatible custom endpoint config is executable by Codmes", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codmes-custom-model-"));
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

test("OAuth providers count token-only credentials as configured", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codmes-oauth-status-"));
  await ensureRuntimeConfig(root);
  await setCredentialValue(root, "openai-codex", "access_token", "token-value");
  const status = await listCredentialStatus(root, {});
  const codex = status.find((item) => item.provider === "openai-codex");
  assert.equal(codex.configured, true);
});

test("provider credential entries are listed, selected, and removed without exposing tokens", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codmes-credential-pool-"));
  await ensureRuntimeConfig(root);
  const authPath = path.join(runtimeConfigDir(root), "auth.json");
  await fs.writeFile(authPath, JSON.stringify({
    version: 1,
    credential_pool: {
      "openai-codex": [
        {
          id: "first",
          label: "First Codex",
          auth_type: "oauth",
          access_token: fakeJwt({ email: "first@example.com", exp: 1893456000 }),
          refresh_token: "refresh-one"
        },
        {
          id: "second",
          label: "Second Codex",
          auth_type: "oauth",
          access_token: fakeJwt({
            "https://api.openai.com/auth": { chatgpt_account_id: "acct_second" },
            exp: 1893456001
          })
        }
      ]
    }
  }, null, 2) + "\n", "utf8");

  const entries = await listProviderCredentialEntries(root, "openai-codex");
  assert.equal(entries.length, 2);
  assert.equal(entries[0].active, true);
  assert.equal(entries[0].email, "first@example.com");
  assert.equal(entries[0].hasRefreshToken, true);
  assert.equal(entries[1].accountId, "acct_second");
  assert.equal(entries[0].access_token, undefined);
  assert.equal(entries[0].refresh_token, undefined);

  const selected = await selectProviderCredentialEntry(root, "openai-codex", "second");
  assert.equal(selected.id, "second");
  const reordered = await listProviderCredentialEntries(root, "openai-codex");
  assert.deepEqual(reordered.map((entry) => entry.id), ["second", "first"]);
  assert.equal(reordered[0].active, true);

  const removed = await removeProviderCredentialEntry(root, "openai-codex", "second");
  assert.equal(removed.removed, true);
  const remaining = await listProviderCredentialEntries(root, "openai-codex");
  assert.deepEqual(remaining.map((entry) => entry.id), ["first"]);
});

test("CODMES env aliases are preferred while AIW env aliases remain compatible", async () => {
  assert.deepEqual(envAliases("AIW_OPENAI_API_KEY"), ["CODMES_OPENAI_API_KEY", "AIW_OPENAI_API_KEY"]);
  assert.deepEqual(envAliases("CODMES_CUSTOM_API_KEY"), ["CODMES_CUSTOM_API_KEY", "AIW_CUSTOM_API_KEY"]);

  const keys = providerEnvKeys({ env: ["AIW_OPENAI_API_KEY", "OPENAI_API_KEY"] });
  assert.deepEqual(keys, ["CODMES_OPENAI_API_KEY", "AIW_OPENAI_API_KEY", "OPENAI_API_KEY"]);

  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codmes-env-status-"));
  await ensureRuntimeConfig(root);
  const status = await listCredentialStatus(root, {
    CODMES_OPENAI_API_KEY: "new-key",
    AIW_OPENAI_API_KEY: "legacy-key"
  });
  const openai = status.find((item) => item.provider === "openai-api");
  assert.equal(openai.configured, true);
  assert.ok(openai.envKeys.includes("CODMES_OPENAI_API_KEY"));
});

function fakeJwt(payload) {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.signature`;
}
