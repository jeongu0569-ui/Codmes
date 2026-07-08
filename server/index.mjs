import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  WORKSPACE_DIRS,
  fileKind,
  joinWorkspacePath,
  resolveWorkspacePath,
  rootPathFromKey
} from "./lib/path-utils.mjs";
import {
  HermesLiveClient,
  acceptWebSocket,
  createFrameDecoder,
  encodeWebSocketFrame
} from "./lib/hermes-live.mjs";
import { buildWorkspaceContext } from "./lib/context-router.mjs";
import { searchStatus, searchWorkspace } from "./lib/search-service.mjs";

const DEFAULT_PORT = Number.parseInt(process.env.PORT || "8787", 10);
const WORKSPACE_HOST = process.env.WORKSPACE_HOST || process.env.HOST || "127.0.0.1";
const DEFAULT_WORKSPACE_ROOT = path.join(process.env.HOME || process.cwd(), "HermesWorkspace");
const WORKSPACE_ROOT = path.resolve(process.env.HERMES_WORKSPACE_ROOT || DEFAULT_WORKSPACE_ROOT);
const HERMES_SERVER_URL = trimTrailingSlash(process.env.HERMES_SERVER_URL || "http://127.0.0.1:9119");
const HERMES_DASHBOARD_USERNAME = process.env.HERMES_DASHBOARD_USERNAME || "";
const HERMES_DASHBOARD_PASSWORD = process.env.HERMES_DASHBOARD_PASSWORD || "";
const HERMES_DASHBOARD_PROVIDER = process.env.HERMES_DASHBOARD_PROVIDER || "";

const TEXT_FILE_LIMIT = 5 * 1024 * 1024;

async function main() {
  await ensureWorkspace();
  const server = http.createServer(handleRequest);
  server.on("upgrade", handleUpgrade);
  server.listen(DEFAULT_PORT, WORKSPACE_HOST, () => {
    console.log(`[workspace] listening on http://${WORKSPACE_HOST}:${DEFAULT_PORT}`);
    console.log(`[workspace] root ${WORKSPACE_ROOT}`);
    console.log(`[workspace] hermes ${HERMES_SERVER_URL}`);
  });
}

function handleUpgrade(req, socket) {
  const url = new URL(req.url || "/", "http://localhost");
  if (url.pathname !== "/api/live") {
    socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
    socket.destroy();
    return;
  }
  try {
    acceptWebSocket(req, socket);
    startLiveBridge(socket);
  } catch (error) {
    socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
    socket.destroy(error);
  }
}

function startLiveBridge(socket) {
  const hermes = new HermesLiveClient({
    hermesServerUrl: HERMES_SERVER_URL,
    dashboardUsername: HERMES_DASHBOARD_USERNAME,
    dashboardPassword: HERMES_DASHBOARD_PASSWORD,
    dashboardProvider: HERMES_DASHBOARD_PROVIDER
  });
  let closed = false;
  const send = (value) => {
    if (closed || socket.destroyed) return;
    socket.write(encodeWebSocketFrame(value));
  };
  const close = () => {
    if (closed) return;
    closed = true;
    hermes.close();
    try {
      socket.end();
    } catch {}
  };
  hermes.on("event", (event) => send({ kind: "hermes.event", ...event }));
  hermes.on("close", () => send({ kind: "hermes.close" }));
  socket.on("error", close);
  socket.on("close", close);
  const decode = createFrameDecoder(async (text) => {
    let message;
    try {
      message = JSON.parse(text);
    } catch {
      send({ kind: "error", error: "Client message must be JSON." });
      return;
    }
    try {
      const result = await handleLiveCommand(hermes, message);
      send({ kind: "result", id: message.id ?? null, result });
    } catch (error) {
      send({ kind: "error", id: message.id ?? null, error: error?.message || "Live command failed." });
    }
  }, close);
  socket.on("data", decode);
  send({ kind: "ready", service: "ai-workspace-live" });
}

async function handleLiveCommand(hermes, message) {
  const command = String(message.command || message.type || "");
  const params = message.params || {};
  if (command === "connect") {
    await hermes.connect();
    return { ok: true };
  }
  if (command === "session.create") {
    return await hermes.createSession(params);
  }
  if (command === "session.resume") {
    const runtimeSessionId = await hermes.resumeSession(String(params.sessionId || ""));
    return { ok: true, runtimeSessionId };
  }
  if (command === "prompt.submit") {
    if (params.contextRequest) {
      params.context = {
        ...(params.context || {}),
        workspaceContext: await buildWorkspaceContext(WORKSPACE_ROOT, params.contextRequest)
      };
    }
    return await hermes.submitPrompt(params);
  }
  if (command === "approval.respond") {
    return await hermes.respondToApproval(params);
  }
  if (command === "config.accessMode") {
    await hermes.setAccessMode(String(params.sessionId || ""), params.accessMode);
    return { ok: true };
  }
  if (command === "config.reasoning") {
    await hermes.setReasoning(String(params.sessionId || ""), params.reasoningEffort);
    return { ok: true };
  }
  throw Object.assign(new Error(`Unknown live command: ${command}`), { status: 400 });
}

async function ensureWorkspace() {
  await fs.mkdir(WORKSPACE_ROOT, { recursive: true });
  await fs.mkdir(path.join(WORKSPACE_ROOT, ".hermes-workspace"), { recursive: true });
  await fs.mkdir(path.join(WORKSPACE_ROOT, WORKSPACE_DIRS.notes), { recursive: true });
  await fs.mkdir(path.join(WORKSPACE_ROOT, WORKSPACE_DIRS.code), { recursive: true });
  await fs.mkdir(path.join(WORKSPACE_ROOT, WORKSPACE_DIRS.documents), { recursive: true });
  await fs.mkdir(path.join(WORKSPACE_ROOT, WORKSPACE_DIRS.attachments), { recursive: true });
  await writeJsonIfMissing(path.join(WORKSPACE_ROOT, ".hermes-workspace", "metadata.json"), {
    schemaVersion: 1,
    workspaceRoot: WORKSPACE_ROOT,
    createdAt: new Date().toISOString(),
    files: {},
    indexes: {}
  });
}

async function writeJsonIfMissing(filePath, value) {
  try {
    await fs.access(filePath);
  } catch {
    await fs.writeFile(filePath, JSON.stringify(value, null, 2) + "\n", "utf8");
  }
}

async function handleRequest(req, res) {
  try {
    const url = new URL(req.url || "/", "http://localhost");
    if (req.method === "OPTIONS") return sendNoContent(res);
    setCors(res);

    if (req.method === "GET" && url.pathname === "/api/health") {
      return sendJson(res, { ok: true, service: "ai-workspace-on-hermes" });
    }
    if (req.method === "GET" && url.pathname === "/api/workspace") {
      return sendJson(res, await workspaceInfo());
    }
    if (req.method === "GET" && url.pathname === "/api/tree") {
      return sendJson(res, await readTree(url));
    }
    if (req.method === "GET" && url.pathname === "/api/file") {
      return sendJson(res, await readTextFile(url));
    }
    if (req.method === "GET" && url.pathname === "/api/raw") {
      return streamRawFile(res, url);
    }
    if (req.method === "PUT" && url.pathname === "/api/file") {
      return sendJson(res, await writeTextFile(req, url));
    }
    if (req.method === "POST" && url.pathname === "/api/file") {
      return sendJson(res, await createFile(req), 201);
    }
    if (req.method === "POST" && url.pathname === "/api/folder") {
      return sendJson(res, await createFolder(req), 201);
    }
    if (req.method === "PATCH" && url.pathname === "/api/file/move") {
      return sendJson(res, await movePath(req));
    }
    if (req.method === "DELETE" && url.pathname === "/api/file") {
      return sendJson(res, await deletePath(url));
    }
    if (req.method === "POST" && url.pathname === "/api/context") {
      return sendJson(res, await resolveContext(req));
    }
    if (req.method === "GET" && url.pathname === "/api/search/status") {
      return sendJson(res, searchStatus(WORKSPACE_ROOT));
    }
    if (req.method === "POST" && url.pathname === "/api/search") {
      return sendJson(res, await runSearch(req));
    }
    if (url.pathname.startsWith("/api/hermes/")) {
      return handleHermesProxy(req, res, url);
    }

    throw Object.assign(new Error("Not found."), { status: 404 });
  } catch (error) {
    sendError(res, error);
  }
}

async function workspaceInfo() {
  return {
    rootName: path.basename(WORKSPACE_ROOT),
    workspaceRoot: WORKSPACE_ROOT,
    roots: Object.entries(WORKSPACE_DIRS).map(([id, folder]) => ({
      id,
      name: folder,
      path: folder
    })),
    hermes: {
      serverUrl: HERMES_SERVER_URL,
      dashboardLoginConfigured: Boolean(HERMES_DASHBOARD_USERNAME && HERMES_DASHBOARD_PASSWORD)
    },
    search: searchStatus(WORKSPACE_ROOT)
  };
}

async function readTree(url) {
  const rootPath = rootPathFromKey(url.searchParams.get("root"));
  const nestedPath = url.searchParams.get("path") || "";
  const relativePath = joinWorkspacePath(rootPath, nestedPath);
  const { absolutePath } = resolveWorkspacePath(WORKSPACE_ROOT, relativePath);
  const entries = await fs.readdir(absolutePath, { withFileTypes: true });
  const children = await Promise.all(entries
    .filter((entry) => !entry.name.startsWith(".DS_Store"))
    .filter((entry) => !(relativePath === "" && entry.name === ".hermes-workspace"))
    .map(async (entry) => {
      const childRelativePath = joinWorkspacePath(relativePath, entry.name);
      const childAbsolutePath = path.join(absolutePath, entry.name);
      const stat = await fs.stat(childAbsolutePath);
      return {
        name: entry.name,
        path: childRelativePath,
        kind: fileKind(entry.name, entry.isDirectory()),
        isDirectory: entry.isDirectory(),
        size: stat.size,
        modifiedAt: stat.mtime.toISOString()
      };
    }));
  children.sort((a, b) => Number(b.isDirectory) - Number(a.isDirectory) || a.name.localeCompare(b.name));
  return { path: relativePath, children };
}

async function readTextFile(url) {
  const filePath = requireQuery(url, "path");
  const { relativePath, absolutePath } = resolveWorkspacePath(WORKSPACE_ROOT, filePath);
  const stat = await fs.stat(absolutePath);
  if (stat.isDirectory()) throw Object.assign(new Error("Cannot read a folder as a file."), { status: 400 });
  if (stat.size > TEXT_FILE_LIMIT) {
    throw Object.assign(new Error("File is too large for text read. Use /api/raw or search/index APIs."), { status: 413 });
  }
  const content = await fs.readFile(absolutePath, "utf8");
  return {
    path: relativePath,
    name: path.basename(relativePath),
    kind: fileKind(relativePath),
    size: stat.size,
    modifiedAt: stat.mtime.toISOString(),
    content
  };
}

async function streamRawFile(res, url) {
  const filePath = requireQuery(url, "path");
  const { absolutePath } = resolveWorkspacePath(WORKSPACE_ROOT, filePath);
  const stat = await fs.stat(absolutePath);
  if (stat.isDirectory()) throw Object.assign(new Error("Cannot stream a folder."), { status: 400 });
  res.writeHead(200, {
    "content-length": String(stat.size),
    "content-type": contentTypeForPath(filePath)
  });
  createReadStream(absolutePath).pipe(res);
}

async function writeTextFile(req, url) {
  const filePath = requireQuery(url, "path");
  const body = await readJsonBody(req);
  const content = typeof body.content === "string" ? body.content : "";
  const { relativePath, absolutePath } = resolveWorkspacePath(WORKSPACE_ROOT, filePath);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, content, "utf8");
  return { ok: true, path: relativePath };
}

async function createFile(req) {
  const body = await readJsonBody(req);
  const filePath = body.path;
  if (!filePath) throw Object.assign(new Error("Missing file path."), { status: 400 });
  const { relativePath, absolutePath } = resolveWorkspacePath(WORKSPACE_ROOT, filePath);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, typeof body.content === "string" ? body.content : "", { flag: "wx" });
  return { ok: true, path: relativePath };
}

async function createFolder(req) {
  const body = await readJsonBody(req);
  if (!body.path) throw Object.assign(new Error("Missing folder path."), { status: 400 });
  const { relativePath, absolutePath } = resolveWorkspacePath(WORKSPACE_ROOT, body.path);
  await fs.mkdir(absolutePath, { recursive: true });
  return { ok: true, path: relativePath };
}

async function movePath(req) {
  const body = await readJsonBody(req);
  if (!body.from || !body.to) throw Object.assign(new Error("Missing from or to path."), { status: 400 });
  const from = resolveWorkspacePath(WORKSPACE_ROOT, body.from);
  const to = resolveWorkspacePath(WORKSPACE_ROOT, body.to);
  await fs.mkdir(path.dirname(to.absolutePath), { recursive: true });
  await fs.rename(from.absolutePath, to.absolutePath);
  return { ok: true, from: from.relativePath, to: to.relativePath };
}

async function deletePath(url) {
  const filePath = requireQuery(url, "path");
  const { relativePath, absolutePath } = resolveWorkspacePath(WORKSPACE_ROOT, filePath);
  await fs.rm(absolutePath, { recursive: true, force: false });
  return { ok: true, path: relativePath };
}

async function resolveContext(req) {
  const body = await readJsonBody(req);
  return await buildWorkspaceContext(WORKSPACE_ROOT, body);
}

async function runSearch(req) {
  const body = await readJsonBody(req);
  return await searchWorkspace(WORKSPACE_ROOT, body);
}

async function handleHermesProxy(req, res, url) {
  if (url.pathname === "/api/hermes/models" && req.method === "GET") {
    return sendJson(res, await hermesJson("/api/model/options"));
  }
  if (url.pathname === "/api/hermes/sessions" && req.method === "GET") {
    return sendJson(res, normalizeHermesSessionsResponse(await hermesJson("/api/sessions?limit=200")));
  }
  const messagesMatch = url.pathname.match(/^\/api\/hermes\/sessions\/([^/]+)\/messages$/);
  if (messagesMatch && req.method === "GET") {
    const sessionId = decodeURIComponent(messagesMatch[1]);
    return sendJson(res, normalizeHermesSessionMessagesResponse(
      await hermesJson(`/api/sessions/${encodeURIComponent(sessionId)}/messages`)
    ));
  }
  const sessionMatch = url.pathname.match(/^\/api\/hermes\/sessions\/([^/]+)$/);
  if (sessionMatch && req.method === "DELETE") {
    const sessionId = decodeURIComponent(sessionMatch[1]);
    return sendJson(res, await hermesJson(`/api/sessions/${encodeURIComponent(sessionId)}`, {
      method: "DELETE"
    }));
  }
  if (url.pathname === "/api/hermes/sessions" && req.method === "POST") {
    const body = await readJsonBody(req);
    return sendJson(res, await hermesJson("/api/sessions", {
      method: "POST",
      body: JSON.stringify(body)
    }), 201);
  }
  throw Object.assign(new Error("Unknown Hermes proxy endpoint."), { status: 404 });
}

function normalizeHermesSessionsResponse(value) {
  const source = Array.isArray(value?.sessions) ? value.sessions
    : Array.isArray(value?.items) ? value.items
      : Array.isArray(value?.data) ? value.data
        : Array.isArray(value) ? value
          : [];
  const seen = new Set();
  const sessions = [];
  for (const item of source) {
    if (!item || typeof item !== "object" || item.archived) continue;
    const id = stringField(item.id, item.session_id, item.sessionId, item.stored_session_id, item.storedSessionId);
    if (!id || seen.has(id)) continue;
    const preview = stringField(item.preview);
    const messageCount = Number(item.message_count ?? item.messageCount ?? 0);
    const explicitTitle = stringField(item.display_name, item.displayName, item.title, item.name, item.summary);
    const title = explicitTitle || preview
      || fallbackSessionTitle(item.model, id);
    if (messageCount <= 0) continue;
    seen.add(id);
    sessions.push({
      id,
      title,
      model: stringField(item.model),
      preview,
      updatedAt: stringField(item.updated_at, item.updatedAt, item.modified_at, item.modifiedAt, item.last_active, item.lastActive),
      isActive: Boolean(item.is_active ?? item.isActive)
    });
  }
  return { sessions };
}

function normalizeHermesSessionMessagesResponse(value) {
  const source = Array.isArray(value?.messages) ? value.messages
    : Array.isArray(value?.items) ? value.items
      : Array.isArray(value?.data) ? value.data
        : Array.isArray(value) ? value
          : [];
  const messages = [];
  for (const item of source) {
    if (!item || typeof item !== "object") continue;
    const role = stringField(item.role, item.type);
    const content = stringField(item.content, item.text, item.message, item.rendered);
    if (!role || !content) continue;
    messages.push({
      id: stringField(item.id, item.message_id, item.messageId) || `${messages.length}`,
      role,
      content,
      timestamp: stringField(item.timestamp, item.created_at, item.createdAt),
      toolName: stringField(item.tool_name, item.toolName, item.name),
      finishReason: stringField(item.finish_reason, item.finishReason),
      reasoning: stringField(item.reasoning, item.reasoning_content, item.reasoningContent)
    });
  }
  return {
    sessionId: stringField(value?.session_id, value?.sessionId),
    messages
  };
}

function fallbackSessionTitle(model, id) {
  if (model) return `Chat with ${model}`;
  const date = generatedSessionDate(id);
  return date ? `Chat ${date}` : "Untitled chat";
}

function generatedSessionDate(value) {
  const match = String(value || "").match(/^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})_/);
  return match ? `${match[1]}-${match[2]}-${match[3]} ${match[4]}:${match[5]}` : "";
}

function stringField(...values) {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    const text = String(value).trim();
    if (text && text !== "<null>") return text;
  }
  return "";
}

async function hermesJson(endpoint, options = {}) {
  const cookie = await hermesDashboardCookie();
  const headers = {
    accept: "application/json",
    ...(options.body ? { "content-type": "application/json" } : {}),
    ...(cookie ? { cookie } : {})
  };
  const response = await fetch(HERMES_SERVER_URL + endpoint, { ...options, headers });
  const text = await response.text();
  if (!response.ok) {
    throw Object.assign(new Error(`Hermes request failed: ${response.status} ${text}`), { status: 502 });
  }
  return text ? JSON.parse(text) : {};
}

let dashboardCookieCache = null;

async function hermesDashboardCookie() {
  if (!HERMES_DASHBOARD_USERNAME || !HERMES_DASHBOARD_PASSWORD) return "";
  if (dashboardCookieCache) return dashboardCookieCache;
  const providers = await fetchJsonWithCookies("/api/auth/providers", {});
  const provider = HERMES_DASHBOARD_PROVIDER
    || providers.providers?.find((item) => item.supports_password)?.name
    || providers.providers?.[0]?.name;
  if (!provider) throw Object.assign(new Error("Hermes dashboard has no auth provider."), { status: 502 });
  const jar = {};
  await fetchJsonWithCookies("/auth/password-login", jar, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      provider,
      username: HERMES_DASHBOARD_USERNAME,
      password: HERMES_DASHBOARD_PASSWORD,
      next: "/"
    })
  });
  dashboardCookieCache = cookieHeader(jar);
  return dashboardCookieCache;
}

async function fetchJsonWithCookies(endpoint, jar, options = {}) {
  const headers = { ...(options.headers || {}) };
  const cookie = cookieHeader(jar);
  if (cookie) headers.cookie = cookie;
  const response = await fetch(HERMES_SERVER_URL + endpoint, { ...options, headers });
  absorbSetCookie(jar, response.headers);
  const text = await response.text();
  if (!response.ok) {
    throw Object.assign(new Error(`Hermes dashboard request failed: ${response.status} ${text}`), { status: 502 });
  }
  return text ? JSON.parse(text) : {};
}

function absorbSetCookie(jar, headers) {
  const values = headers.getSetCookie ? headers.getSetCookie() : headers.get("set-cookie") ? [headers.get("set-cookie")] : [];
  for (const value of values) {
    const first = String(value).split(";")[0];
    const index = first.indexOf("=");
    if (index > 0) jar[first.slice(0, index).trim()] = first.slice(index + 1).trim();
  }
}

function cookieHeader(jar) {
  return Object.entries(jar).map(([key, value]) => `${key}=${value}`).join("; ");
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw Object.assign(new Error("Request body must be JSON."), { status: 400 });
  }
}

function requireQuery(url, key) {
  const value = url.searchParams.get(key);
  if (!value) throw Object.assign(new Error(`Missing query parameter: ${key}`), { status: 400 });
  return value;
}

function sendJson(res, value, status = 200) {
  const body = JSON.stringify(value, null, 2) + "\n";
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body)
  });
  res.end(body);
}

function sendNoContent(res) {
  setCors(res);
  res.writeHead(204);
  res.end();
}

function sendError(res, error) {
  setCors(res);
  const status = Number.isInteger(error?.status) ? error.status : 500;
  sendJson(res, {
    error: error?.message || "Internal server error"
  }, status);
}

function setCors(res) {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type, authorization");
}

function contentTypeForPath(filePath) {
  const lower = String(filePath).toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  if (lower.endsWith(".md")) return "text/markdown; charset=utf-8";
  return "application/octet-stream";
}

function trimTrailingSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
