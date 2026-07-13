import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  readCodexOAuthLogin,
  startCodexOAuthLogin
} from "./codex-oauth.mjs";
import {
  ensureRuntimeConfig,
  listProviderCredentialEntries
} from "./config-store.mjs";

test("Codex OAuth login polls device flow and stores a new active credential", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codmes-codex-oauth-"));
  await ensureRuntimeConfig(root);
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith("/api/accounts/deviceauth/usercode")) {
      return jsonResponse(200, {
        user_code: "ABCD-EFGH",
        device_auth_id: "device-1",
        interval: 3
      });
    }
    if (url.endsWith("/api/accounts/deviceauth/token")) {
      return jsonResponse(200, {
        authorization_code: "auth-code",
        code_verifier: "verifier"
      });
    }
    if (url.endsWith("/oauth/token")) {
      return jsonResponse(200, {
        access_token: fakeJwt({ email: "codex@example.com", exp: 1893456000 }),
        refresh_token: "refresh-token",
        id_token: fakeJwt({ email: "joengu0569@gmail.com" })
      });
    }
    return jsonResponse(404, {});
  };

  const session = await startCodexOAuthLogin({
    workspaceRoot: root,
    fetchImpl,
    pollDelayMs: 1
  });
  assert.equal(session.status, "pending");
  assert.equal(session.userCode, "ABCD-EFGH");
  assert.equal(session.verificationUrl, "https://auth.openai.com/codex/device");

  let finalSession = session;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
    finalSession = readCodexOAuthLogin(session.id);
    if (finalSession.status === "approved") break;
  }

  assert.equal(finalSession.status, "approved");
  assert.equal(finalSession.credential.email, "joengu0569@gmail.com");
  const entries = await listProviderCredentialEntries(root, "openai-codex");
  assert.equal(entries.length, 1);
  assert.equal(entries[0].active, true);
  assert.equal(entries[0].email, "joengu0569@gmail.com");
  assert.equal(calls.some((call) => call.url.endsWith("/oauth/token")), true);
});

function jsonResponse(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return payload;
    }
  };
}

function fakeJwt(payload) {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.signature`;
}
