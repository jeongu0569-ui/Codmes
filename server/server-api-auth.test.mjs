import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

test("workspace server protects APIs with AIW_SERVER_TOKEN and exposes management APIs", async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "aiw-server-api-"));
  const port = 18000 + Math.floor(Math.random() * 10000);
  const token = "test-token";
  const server = spawn(process.execPath, ["server/index.mjs"], {
    cwd: path.resolve("."),
    env: {
      ...process.env,
      NODE_ENV: "test",
      AIW_HOST: "127.0.0.1",
      AIW_PORT: String(port),
      AIW_WORKSPACE_ROOT: workspaceRoot,
      AIW_SERVER_TOKEN: token
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
    assert.equal(workspace.runtime.owner, "ai-workspace");

    await fs.writeFile(path.join(workspaceRoot, "Notes", "auth-note.md"), "# Token Test\n", "utf8");
    const rebuilt = await fetchJson(`${baseUrl}/api/index/rebuild`, { token, method: "POST" });
    assert.equal(rebuilt.ok, true);
    assert.equal(rebuilt.itemCount, 1);

    const metadata = await fetchJson(`${baseUrl}/api/file/metadata?path=Notes/auth-note.md`, { token });
    assert.equal(metadata.path, "Notes/auth-note.md");
    assert.equal(metadata.kind, "markdown");

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
      body: { name: "test_mcp", command: "node", args: ["server.js"] }
    });
    assert.equal(addedMcp.server.name, "test_mcp");
    const disabled = await fetchJson(`${baseUrl}/api/mcp/test_mcp/disable`, { token, method: "POST" });
    assert.equal(disabled.server.enabled, false);
    const removed = await fetchJson(`${baseUrl}/api/mcp/test_mcp`, { token, method: "DELETE" });
    assert.equal(removed.removed, "test_mcp");

    const doctor = await fetchJson(`${baseUrl}/api/doctor`, { token });
    assert.equal(doctor.ok, true);
    assert.equal(doctor.authRequired, true);
    assert.equal(doctor.audit.path, ".ai-workspace/audit/audit.jsonl");

    const providers = await fetchJson(`${baseUrl}/api/providers`, { token });
    assert.ok(providers.providers.some((provider) => provider.id === "custom"));

    const storedAuth = await fetchJson(`${baseUrl}/api/auth/custom`, {
      token,
      method: "POST",
      body: {
        baseUrl: "http://127.0.0.1:9999/v1",
        apiKey: "local-test-key"
      }
    });
    assert.equal(storedAuth.ok, true);
    assert.equal(storedAuth.provider, "custom");

    const authStatus = await fetchJson(`${baseUrl}/api/auth`, { token });
    const customAuth = authStatus.providers.find((provider) => provider.provider === "custom");
    assert.equal(customAuth.configured, true);

    const defaultModel = await fetchJson(`${baseUrl}/api/model/default`, {
      token,
      method: "POST",
      body: { provider: "custom", model: "demo-model" }
    });
    assert.equal(defaultModel.defaultModel.provider, "custom");
    assert.equal(defaultModel.defaultModel.model, "demo-model");

    const readDefault = await fetchJson(`${baseUrl}/api/model/default`, { token });
    assert.equal(readDefault.defaultModel.id, "custom:demo-model");

    const models = await fetchJson(`${baseUrl}/api/models`, { token });
    assert.ok(models.models.some((model) => model.id === "custom:demo-model"));

    const removedAuth = await fetchJson(`${baseUrl}/api/auth/custom/apiKey`, {
      token,
      method: "DELETE"
    });
    assert.equal(removedAuth.removed, true);
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
