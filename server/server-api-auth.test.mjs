import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

test("workspace server protects APIs with CODMES_SERVER_TOKEN and exposes management APIs", async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codmes-server-api-"));
  const port = 18000 + Math.floor(Math.random() * 10000);
  const token = "test-token";
  const server = spawn(process.execPath, ["server/index.mjs"], {
    cwd: path.resolve("."),
    env: {
      ...process.env,
      NODE_ENV: "test",
      CODMES_HOST: "127.0.0.1",
      CODMES_PORT: String(port),
      CODMES_WORKSPACE_ROOT: workspaceRoot,
      CODMES_SERVER_TOKEN: token
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  try {
    const baseUrl = `http://127.0.0.1:${port}`;
    await waitForServer(`${baseUrl}/api/health`);

    const health = await fetchJson(`${baseUrl}/api/health`);
    assert.equal(health.ok, true);
    assert.equal(health.authRequired, true);

    const unauthorized = await fetch(`${baseUrl}/api/workspace`);
    assert.equal(unauthorized.status, 401);

    const workspace = await fetchJson(`${baseUrl}/api/workspace`, { token });
    assert.equal(workspace.runtime.owner, "codmes");

    await fs.writeFile(path.join(workspaceRoot, "Notes", "auth-note.md"), "# Token Test\n", "utf8");
    const rebuilt = await fetchJson(`${baseUrl}/api/index/rebuild`, { token, method: "POST" });
    assert.equal(rebuilt.ok, true);
    assert.equal(rebuilt.itemCount, 1);

    const metadata = await fetchJson(`${baseUrl}/api/file/metadata?path=Notes/auth-note.md`, { token });
    assert.equal(metadata.path, "Notes/auth-note.md");
    assert.equal(metadata.kind, "markdown");

    await fs.writeFile(path.join(workspaceRoot, "Documents", "sample.pdf"), "%PDF-1.4\n%%EOF", "utf8");
    const emptyAnnotations = await fetchJson(`${baseUrl}/api/file/annotations?path=Documents/sample.pdf`, { token });
    assert.equal(emptyAnnotations.documentPath, "Documents/sample.pdf");
    assert.equal(emptyAnnotations.pages.length, 0);
    const savedAnnotations = await fetchJson(`${baseUrl}/api/file/annotations?path=Documents/sample.pdf`, {
      token,
      method: "PUT",
      body: {
        schemaVersion: 1,
        pages: [
          {
            pageIndex: 0,
            inkDataBase64: "cGVuLWRhdGE=",
            objects: [
              { id: "highlight-1", type: "highlight", bbox: { x: 0.1, y: 0.2, width: 0.3, height: 0.04 } }
            ]
          }
        ]
      }
    });
    assert.equal(savedAnnotations.documentPath, "Documents/sample.pdf");
    assert.equal(savedAnnotations.pages[0].pageIndex, 0);
    const readAnnotations = await fetchJson(`${baseUrl}/api/file/annotations?path=Documents/sample.pdf`, { token });
    assert.equal(readAnnotations.pages[0].inkDataBase64, "cGVuLWRhdGE=");

    const security = await fetchJson(`${baseUrl}/api/security`, { token });
    assert.equal(security.approvalMode, "auto");
    const updatedSecurity = await fetchJson(`${baseUrl}/api/security`, {
      token,
      method: "POST",
      body: { approvalMode: "manual", requireApproval: ["mcp.tool.call"] }
    });
    assert.equal(updatedSecurity.security.approvalMode, "manual");

    const addedMcp = await fetchJson(`${baseUrl}/api/mcp`, {
      token,
      method: "POST",
      body: { name: "test_mcp", command: "node", args: ["server.js"], scopePath: "Notes" }
    });
    assert.equal(addedMcp.server.name, "test_mcp");
    assert.equal(addedMcp.server.scopePath, "Notes");
    const upsertedMcp = await fetchJson(`${baseUrl}/api/mcp`, {
      token,
      method: "POST",
      body: { name: "test_mcp", command: "node", args: ["updated.js"], enabled: true, scopePath: "Code" }
    });
    assert.equal(upsertedMcp.created, false);
    assert.equal(upsertedMcp.server.scopePath, "Code");
    assert.deepEqual(upsertedMcp.server.args, ["updated.js"]);
    assert.equal(upsertedMcp.server.enabled, true);
    const updatedMcp = await fetchJson(`${baseUrl}/api/mcp/test_mcp`, {
      token,
      method: "POST",
      body: {
        command: "example-mcp",
        args: ["start", "--scope", "Notes"],
        enabled: true,
        env: { EXAMPLE_MCP_MODE: "demo" },
        scopePath: "Notes/Research"
      }
    });
    assert.equal(updatedMcp.server.command, "example-mcp");
    assert.equal(updatedMcp.server.scopePath, "Notes/Research");
    assert.equal(updatedMcp.server.env.EXAMPLE_MCP_MODE, "demo");
    assert.deepEqual(updatedMcp.server.args, ["start", "--scope", "Notes"]);
    const listedMcp = await fetchJson(`${baseUrl}/api/mcp`, { token });
    assert.equal(typeof listedMcp.servers.find((server) => server.name === "test_mcp").enabled, "boolean");
    const disabled = await fetchJson(`${baseUrl}/api/mcp/test_mcp/disable`, { token, method: "POST" });
    assert.equal(disabled.server.enabled, false);
    const removed = await fetchJson(`${baseUrl}/api/mcp/test_mcp`, { token, method: "DELETE" });
    assert.equal(removed.removed, "test_mcp");

    const searchConfig = await fetchJson(`${baseUrl}/api/search/config`, {
      token,
      method: "POST",
      body: {
        roots: ["Notes", "Code"],
        embeddingsProvider: "openai",
        openaiBaseUrl: "http://127.0.0.1:11434/v1",
        openaiApiKey: "ollama",
        openaiEmbedModel: "bge-m3",
        openaiEmbedDim: 1024,
        vlmProvider: "ollama-local",
        vlmModel: "gemma4:e2b-mlx",
        vlmBaseUrl: "http://127.0.0.1:11434/v1",
        vlmApiKey: "ollama"
      }
    });
    assert.equal(searchConfig.ok, true);
    assert.equal(searchConfig.openaiEmbedModel, "bge-m3");
    assert.equal(searchConfig.openaiApiKeyConfigured, true);
    assert.equal(searchConfig.vlmProvider, "ollama-local");
    assert.equal(searchConfig.vlmModel, "gemma4:e2b-mlx");
    assert.equal(searchConfig.vlmApiKeyConfigured, true);
    assert.equal(searchConfig.backend, "codmes");
    assert.match(searchConfig.configPath, /search\.env$/);

    const doctor = await fetchJson(`${baseUrl}/api/doctor`, { token });
    assert.equal(doctor.ok, true);
    assert.equal(doctor.authRequired, true);
    assert.equal(doctor.audit.path, ".codmes/audit/audit.jsonl");
    assert.equal(doctor.documentIngest.requirements, "server/workers/document-ingest/requirements.txt");
    assert.equal(typeof doctor.documentIngest.libraries.fitz, "boolean");
    assert.equal(Object.hasOwn(doctor.documentIngest, "binaries"), false);

    const providers = await fetchJson(`${baseUrl}/api/providers`, { token });
    assert.equal(providers.providers.some((provider) => provider.id === "custom"), false);
    assert.equal(providers.providers.some((provider) => provider.id === "openai-api"), false);
    assert.ok(providers.providers.some((provider) => provider.id === "openai-codex"));
    assert.ok(providers.providers.some((provider) => provider.id === "ollama-local"));

    const openAiModels = await fetchJson(`${baseUrl}/api/providers/openai-codex/models`, { token });
    assert.equal(openAiModels.provider, "openai-codex");
    assert.ok(openAiModels.models.includes("gpt-5.6-sol"));
    assert.ok(openAiModels.models.includes("gpt-5.6-terra"));
    assert.ok(openAiModels.models.includes("gpt-5.6-luna"));
    assert.ok(openAiModels.models.includes("gpt-5.4-mini"));

    const storedAuth = await fetchJson(`${baseUrl}/api/auth/ollama-local`, {
      token,
      method: "POST",
      body: {
        baseUrl: "http://127.0.0.1:11434"
      }
    });
    assert.equal(storedAuth.ok, true);
    assert.equal(storedAuth.provider, "ollama-local");

    const authStatus = await fetchJson(`${baseUrl}/api/auth`, { token });
    const ollamaAuth = authStatus.providers.find((provider) => provider.provider === "ollama-local");
    assert.equal(ollamaAuth.configured, true);

    const providerAuth = await fetchJson(`${baseUrl}/api/auth/ollama-local`, { token });
    assert.equal(providerAuth.provider, "ollama-local");
    assert.equal(providerAuth.credentials.length, 1);
    assert.equal(providerAuth.credentials[0].baseUrl, "http://127.0.0.1:11434");

    const defaultModel = await fetchJson(`${baseUrl}/api/model/default`, {
      token,
      method: "POST",
      body: { provider: "ollama-local", model: "demo-model" }
    });
    assert.equal(defaultModel.defaultModel.provider, "ollama-local");
    assert.equal(defaultModel.defaultModel.model, "demo-model");

    const readDefault = await fetchJson(`${baseUrl}/api/model/default`, { token });
    assert.equal(readDefault.defaultModel.id, "ollama-local:demo-model");

    const models = await fetchJson(`${baseUrl}/api/models`, { token });
    assert.ok(models.models.some((model) => model.id === "ollama-local:demo-model"));

    const removedAuth = await fetchJson(`${baseUrl}/api/auth/ollama-local`, {
      token,
      method: "DELETE"
    });
    assert.equal(removedAuth.removed, true);
    const providerAuthAfterDelete = await fetchJson(`${baseUrl}/api/auth/ollama-local`, { token });
    assert.equal(providerAuthAfterDelete.credentials.length, 0);
  } finally {
    server.kill("SIGTERM");
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

async function waitForServer(url) {
  let lastError;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw lastError || new Error(`Server did not become ready: ${url}`);
}

async function fetchJson(url, options = {}) {
  const headers = { accept: "application/json" };
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  if (options.body) headers["content-type"] = "application/json";
  const response = await fetch(url, {
    method: options.method || "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${text}`);
  }
  return text ? JSON.parse(text) : {};
}
