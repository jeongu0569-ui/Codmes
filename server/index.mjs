import fs from "node:fs/promises";
import { constants as fsConstants, createReadStream } from "node:fs";
import http from "node:http";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  WORKSPACE_DIRS,
  fileKind,
  joinWorkspacePath,
  resolveWorkspacePath,
  rootPathFromKey
} from "./lib/path-utils.mjs";
import {
  acceptWebSocket,
  createFrameDecoder,
  encodeWebSocketFrame
} from "./lib/websocket-utils.mjs";
import {
  createWorkspaceAgentEngine,
  ensureAgentWorkspaceState
} from "./lib/agent-engine.mjs";
import { buildWorkspaceContext } from "./lib/context-router.mjs";
import { buildIndex, readFileMetadata, readIndex } from "./lib/file-index.mjs";
import { renderCodeDocument, renderMarkdownDocument } from "./lib/render-service.mjs";
import { searchStatus, searchWorkspace } from "./lib/search-service.mjs";
import { readAuditSummary } from "./lib/runtime/audit-log.mjs";
import {
  BUILTIN_PROVIDERS,
  listCredentialStatus,
  listProviderRegistry,
  readCredentials,
  readRuntimeConfig,
  removeCredentialValue,
  setCredentialValue,
  setDefaultModel,
  writeRuntimeConfig
} from "./lib/runtime/config-store.mjs";
import { readSecurityConfig, writeSecurityConfig } from "./lib/runtime/security-policy.mjs";
import { enableSkill, listSkills, readSkill } from "./lib/runtime/skill-registry.mjs";

const DEFAULT_PORT = Number.parseInt(process.env.AIW_PORT || process.env.PORT || "8787", 10);
const WORKSPACE_HOST = process.env.AIW_HOST || process.env.WORKSPACE_HOST || process.env.HOST || "127.0.0.1";
const DEFAULT_WORKSPACE_ROOT = path.join(process.env.HOME || process.cwd(), "AIWorkspace");
const WORKSPACE_ROOT = path.resolve(process.env.AIW_WORKSPACE_ROOT || DEFAULT_WORKSPACE_ROOT);
const SERVER_TOKEN = process.env.AIW_SERVER_TOKEN || "";

const TEXT_FILE_LIMIT = 5 * 1024 * 1024;

async function main() {
  await ensureWorkspace();
  const server = http.createServer(handleRequest);
  server.on("upgrade", handleUpgrade);
  server.listen(DEFAULT_PORT, WORKSPACE_HOST, () => {
    console.log(`[workspace] listening on http://${WORKSPACE_HOST}:${DEFAULT_PORT}`);
    console.log(`[workspace] root ${WORKSPACE_ROOT}`);
  });
}

function handleUpgrade(req, socket) {
  const url = new URL(req.url || "/", "http://localhost");
  if (url.pathname !== "/api/live") {
    socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
    socket.destroy();
    return;
  }
  if (!isAuthorized(req, url)) {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
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
  const engine = createAgentEngine();
  let closed = false;
  const send = (value) => {
    if (closed || socket.destroyed) return;
    socket.write(encodeWebSocketFrame(value));
  };
  const close = () => {
    if (closed) return;
    closed = true;
    engine.close();
    try {
      socket.end();
    } catch {}
  };
  engine.on("event", (event) => send({ kind: "runtime.event", ...event }));
  engine.on("close", () => send({ kind: "runtime.close" }));
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
      const result = await handleLiveCommand(engine, message);
      send({ kind: "result", id: message.id ?? null, result });
    } catch (error) {
      send({ kind: "error", id: message.id ?? null, error: error?.message || "Live command failed." });
    }
  }, close);
  socket.on("data", decode);
  send({ kind: "ready", service: "ai-workspace-live" });
}

function createAgentEngine() {
  return createWorkspaceAgentEngine({
    workspaceRoot: WORKSPACE_ROOT
  });
}

function isPublicRequest(req, url) {
  return req.method === "GET" && url.pathname === "/api/health";
}

function isAuthorized(req, url) {
  if (!SERVER_TOKEN) return true;
  const authorization = String(req.headers.authorization || "");
  const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  const queryToken = url.searchParams.get("token") || "";
  const headerToken = String(req.headers["x-aiw-token"] || "").trim();
  return bearer === SERVER_TOKEN || queryToken === SERVER_TOKEN || headerToken === SERVER_TOKEN;
}

async function handleLiveCommand(engine, message) {
  const command = String(message.command || message.type || "");
  const params = message.params || {};
  if (command === "connect") {
    await engine.connect();
    return { ok: true };
  }
  if (command === "session.create") {
    return await engine.createSession(params);
  }
  if (command === "session.resume") {
    const runtimeSessionId = await engine.resumeSession(String(params.sessionId || ""));
    return { ok: true, runtimeSessionId };
  }
  if (command === "prompt.submit") {
    return await engine.submitPrompt(params);
  }
  if (command === "approval.respond") {
    return await engine.respondToApproval(params);
  }
  if (command === "approval.inbox.list") {
    return await engine.listApprovals(params);
  }
  if (command === "approval.inbox.show") {
    return await engine.readApproval(String(params.approvalId || params.id || ""));
  }
  if (command === "approval.inbox.respond") {
    return await engine.respondToWorkspaceApproval(String(params.approvalId || params.id || ""), params);
  }
  if (command === "task.resume") {
    return await engine.resumeTask(String(params.taskId || params.id || ""), params);
  }
  if (command === "task.cancel") {
    return await engine.cancelTask(String(params.taskId || params.id || ""), params);
  }
  if (command === "config.accessMode") {
    await engine.setAccessMode(String(params.sessionId || ""), params.accessMode);
    return { ok: true };
  }
  if (command === "config.reasoning") {
    await engine.setReasoning(String(params.sessionId || ""), params.reasoningEffort);
    return { ok: true };
  }
  if (command === "code.task.create" || command === "code.inspect") {
    return await engine.inspectCodeTask(params);
  }
  if (command === "code.checks.run") {
    return await engine.runCodeTaskChecks(String(params.taskId || ""), params);
  }
  if (command === "code.patch.propose") {
    return await engine.proposeCodeTaskPatch(String(params.taskId || ""), params);
  }
  if (command === "code.patch.apply") {
    return await engine.applyCodeTaskPatch(String(params.taskId || ""), params);
  }
  if (command === "code.patch.reject") {
    return await engine.rejectCodeTaskPatch(String(params.taskId || ""), params);
  }
  throw Object.assign(new Error(`Unknown live command: ${command}`), { status: 400 });
}

async function ensureWorkspace() {
  await fs.mkdir(WORKSPACE_ROOT, { recursive: true });
  await ensureAgentWorkspaceState(WORKSPACE_ROOT);
  await fs.mkdir(path.join(WORKSPACE_ROOT, WORKSPACE_DIRS.notes), { recursive: true });
  await fs.mkdir(path.join(WORKSPACE_ROOT, WORKSPACE_DIRS.code), { recursive: true });
  await fs.mkdir(path.join(WORKSPACE_ROOT, WORKSPACE_DIRS.documents), { recursive: true });
  await fs.mkdir(path.join(WORKSPACE_ROOT, WORKSPACE_DIRS.attachments), { recursive: true });
  await writeJsonIfMissing(path.join(WORKSPACE_ROOT, ".ai-workspace", "metadata.json"), {
    schemaVersion: 1,
    workspaceRoot: WORKSPACE_ROOT,
    createdAt: new Date().toISOString(),
    files: {},
    indexes: {}
  });
  try {
    const { archiveOverflowGeneralSessions } = await import("./lib/runtime/session-archive.mjs");
    await archiveOverflowGeneralSessions(WORKSPACE_ROOT, { limit: 30 });
  } catch {}
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
    if (!isPublicRequest(req, url) && !isAuthorized(req, url)) {
      return sendJson(res, { ok: false, error: "Unauthorized." }, 401);
    }

    if (req.method === "GET" && url.pathname === "/api/health") {
      return sendJson(res, {
        ok: true,
        service: "ai-workspace",
        authRequired: Boolean(SERVER_TOKEN)
      });
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
    if (req.method === "POST" && url.pathname === "/api/file/copy") {
      return sendJson(res, await copyPath(req), 201);
    }
    if (req.method === "POST" && url.pathname === "/api/file/upload") {
      return sendJson(res, await uploadFile(req), 201);
    }
    if (req.method === "POST" && url.pathname === "/api/file/upload/start") {
      return sendJson(res, await startChunkedUpload(req), 201);
    }
    if (req.method === "POST" && url.pathname === "/api/file/upload/chunk") {
      return sendJson(res, await appendUploadChunk(req));
    }
    if (req.method === "POST" && url.pathname === "/api/file/upload/complete") {
      return sendJson(res, await completeChunkedUpload(req), 201);
    }
    if (req.method === "POST" && url.pathname === "/api/file/upload/cancel") {
      return sendJson(res, await cancelChunkedUpload(req));
    }
    if (req.method === "DELETE" && url.pathname === "/api/file") {
      return sendJson(res, await deletePath(url));
    }
    if (req.method === "GET" && url.pathname === "/api/file/metadata") {
      return sendJson(res, await fileMetadata(url));
    }
    if (req.method === "POST" && url.pathname === "/api/context") {
      return sendJson(res, await resolveContext(req));
    }
    if (req.method === "GET" && url.pathname === "/api/index/status") {
      return sendJson(res, await indexStatus());
    }
    if (req.method === "POST" && url.pathname === "/api/index/rebuild") {
      return sendJson(res, await rebuildIndex());
    }
    if (req.method === "GET" && url.pathname === "/api/search/status") {
      return sendJson(res, searchStatus(WORKSPACE_ROOT));
    }
    if (req.method === "POST" && url.pathname === "/api/search") {
      return sendJson(res, await runSearch(req));
    }
    if (req.method === "GET" && url.pathname === "/api/skills") {
      return sendJson(res, await skillsList());
    }
    const skillMatch = url.pathname.match(/^\/api\/skills\/([^/]+)$/);
    if (skillMatch && req.method === "GET") {
      return sendJson(res, await skillDetail(skillMatch[1]));
    }
    const skillEnableMatch = url.pathname.match(/^\/api\/skills\/([^/]+)\/enable$/);
    if (skillEnableMatch && req.method === "POST") {
      return sendJson(res, await setSkillEnabled(skillEnableMatch[1], true));
    }
    const skillDisableMatch = url.pathname.match(/^\/api\/skills\/([^/]+)\/disable$/);
    if (skillDisableMatch && req.method === "POST") {
      return sendJson(res, await setSkillEnabled(skillDisableMatch[1], false));
    }
    if (req.method === "GET" && url.pathname === "/api/security") {
      return sendJson(res, await readSecurityConfig(WORKSPACE_ROOT));
    }
    if (req.method === "POST" && url.pathname === "/api/security") {
      return sendJson(res, await updateSecurity(req));
    }
    if (req.method === "GET" && url.pathname === "/api/mcp") {
      return sendJson(res, await listMcpServers());
    }
    if (req.method === "POST" && url.pathname === "/api/mcp") {
      return sendJson(res, await addMcpServer(req), 201);
    }
    const mcpEnableMatch = url.pathname.match(/^\/api\/mcp\/([^/]+)\/enable$/);
    if (mcpEnableMatch && req.method === "POST") {
      return sendJson(res, await setMcpEnabled(mcpEnableMatch[1], true));
    }
    const mcpDisableMatch = url.pathname.match(/^\/api\/mcp\/([^/]+)\/disable$/);
    if (mcpDisableMatch && req.method === "POST") {
      return sendJson(res, await setMcpEnabled(mcpDisableMatch[1], false));
    }
    const mcpDeleteMatch = url.pathname.match(/^\/api\/mcp\/([^/]+)$/);
    if (mcpDeleteMatch && req.method === "DELETE") {
      return sendJson(res, await removeMcpServer(mcpDeleteMatch[1]));
    }
    if (req.method === "GET" && url.pathname === "/api/doctor") {
      return sendJson(res, await doctorStatus());
    }
    if (req.method === "GET" && url.pathname === "/api/providers") {
      return sendJson(res, await listRuntimeProviders());
    }
    if (req.method === "POST" && url.pathname === "/api/providers/custom") {
      return sendJson(res, await createCustomProvider(req), 201);
    }
    const customProviderDeleteMatch = url.pathname.match(/^\/api\/providers\/custom\/([^/]+)$/);
    if (customProviderDeleteMatch && req.method === "DELETE") {
      return sendJson(res, await deleteCustomProvider(customProviderDeleteMatch[1]));
    }
    const providerModelsMatch = url.pathname.match(/^\/api\/providers\/([^/]+)\/models$/);
    if (providerModelsMatch && req.method === "GET") {
      return sendJson(res, await discoverProviderModels(providerModelsMatch[1]));
    }
    if (req.method === "GET" && url.pathname === "/api/auth") {
      return sendJson(res, await listRuntimeAuth());
    }
    const authProviderMatch = url.pathname.match(/^\/api\/auth\/([^/]+)$/);
    if (authProviderMatch && req.method === "POST") {
      return sendJson(res, await updateProviderAuth(authProviderMatch[1], req));
    }
    const authDeleteMatch = url.pathname.match(/^\/api\/auth\/([^/]+)\/([^/]+)$/);
    if (authDeleteMatch && req.method === "DELETE") {
      return sendJson(res, await deleteProviderAuth(authDeleteMatch[1], authDeleteMatch[2]));
    }
    if (req.method === "GET" && url.pathname === "/api/model/default") {
      return sendJson(res, await readDefaultModel());
    }
    if (req.method === "POST" && url.pathname === "/api/model/default") {
      return sendJson(res, await updateDefaultModel(req));
    }
    if (req.method === "GET" && url.pathname === "/api/agent/tasks") {
      return sendJson(res, await listAgentTasks(url));
    }
    const taskMatch = url.pathname.match(/^\/api\/agent\/tasks\/([^/]+)$/);
    if (taskMatch && req.method === "GET") {
      return sendJson(res, await readAgentTask(taskMatch[1]));
    }
    const taskResumeMatch = url.pathname.match(/^\/api\/agent\/tasks\/([^/]+)\/resume$/);
    if (taskResumeMatch && req.method === "POST") {
      return sendJson(res, await resumeAgentTask(taskResumeMatch[1], req));
    }
    const taskCancelMatch = url.pathname.match(/^\/api\/agent\/tasks\/([^/]+)\/cancel$/);
    if (taskCancelMatch && req.method === "POST") {
      return sendJson(res, await cancelAgentTask(taskCancelMatch[1], req));
    }
    if (req.method === "GET" && url.pathname === "/api/agent/approvals") {
      return sendJson(res, await listAgentApprovals(url));
    }
    const approvalMatch = url.pathname.match(/^\/api\/agent\/approvals\/([^/]+)$/);
    if (approvalMatch && req.method === "GET") {
      return sendJson(res, await readAgentApproval(approvalMatch[1]));
    }
    const approvalRespondMatch = url.pathname.match(/^\/api\/agent\/approvals\/([^/]+)\/respond$/);
    if (approvalRespondMatch && req.method === "POST") {
      return sendJson(res, await respondToAgentApproval(approvalRespondMatch[1], req));
    }
    if (req.method === "POST" && url.pathname === "/api/agent/code-task") {
      return sendJson(res, await createCodeTask(req), 201);
    }
    const codeChecksMatch = url.pathname.match(/^\/api\/agent\/code-task\/([^/]+)\/checks$/);
    if (codeChecksMatch && req.method === "POST") {
      return sendJson(res, await runCodeTaskChecks(codeChecksMatch[1], req));
    }
    const codeGitMatch = url.pathname.match(/^\/api\/agent\/code-task\/([^/]+)\/git$/);
    if (codeGitMatch && req.method === "POST") {
      return sendJson(res, await runCodeTaskGit(codeGitMatch[1], req));
    }
    const codePatchProposeMatch = url.pathname.match(/^\/api\/agent\/code-task\/([^/]+)\/patches$/);
    if (codePatchProposeMatch && req.method === "POST") {
      return sendJson(res, await proposeCodeTaskPatch(codePatchProposeMatch[1], req), 201);
    }
    const codePatchGenerateMatch = url.pathname.match(/^\/api\/agent\/code-task\/([^/]+)\/patches\/generate$/);
    if (codePatchGenerateMatch && req.method === "POST") {
      return sendJson(res, await generateCodeTaskPatch(codePatchGenerateMatch[1], req), 201);
    }
    const codePatchApplyMatch = url.pathname.match(/^\/api\/agent\/code-task\/([^/]+)\/patches\/([^/]+)\/apply$/);
    if (codePatchApplyMatch && req.method === "POST") {
      return sendJson(res, await applyCodeTaskPatch(codePatchApplyMatch[1], codePatchApplyMatch[2], req));
    }
    const codePatchRejectMatch = url.pathname.match(/^\/api\/agent\/code-task\/([^/]+)\/patches\/([^/]+)\/reject$/);
    if (codePatchRejectMatch && req.method === "POST") {
      return sendJson(res, await rejectCodeTaskPatch(codePatchRejectMatch[1], codePatchRejectMatch[2], req));
    }
    if (req.method === "POST" && url.pathname === "/api/render/markdown") {
      return sendJson(res, await renderMarkdown(req));
    }
    if (req.method === "POST" && url.pathname === "/api/render/code") {
      return sendJson(res, await renderCode(req));
    }
    // --- Tool Mode & Surface Routes ---
    if (req.method === "GET" && url.pathname === "/api/tool-modes") {
      const { loadToolModes } = await import("./lib/runtime/tool-mode-registry.mjs");
      return sendJson(res, await loadToolModes(WORKSPACE_ROOT));
    }
    const toolModeSurfaceMatch = url.pathname.match(/^\/api\/tool-modes\/([^/]+)$/);
    if (req.method === "POST" && toolModeSurfaceMatch) {
      const surface = decodeURIComponent(toolModeSurfaceMatch[1]);
      const body = await readJsonBody(req);
      const { saveToolModeOverride } = await import("./lib/runtime/tool-mode-registry.mjs");
      return sendJson(res, await saveToolModeOverride(WORKSPACE_ROOT, surface, body));
    }

    // --- Tool Discovery Routes ---
    if (req.method === "GET" && url.pathname === "/api/tools/available") {
      const { TOOL_REGISTRY } = await import("./lib/runtime/tool-discovery.mjs");
      return sendJson(res, { availableTools: TOOL_REGISTRY });
    }
    if (req.method === "POST" && url.pathname === "/api/tools/discover") {
      const body = await readJsonBody(req);
      const { executeToolDiscovery } = await import("./lib/runtime/tool-discovery.mjs");
      return sendJson(res, await executeToolDiscovery(WORKSPACE_ROOT, body.surface || "chat", body));
    }

    // --- Conversation Search & Read Routes ---
    if (req.method === "GET" && url.pathname === "/api/conversations/search") {
      const { executeConversationSearch } = await import("./lib/runtime/conversation-tools.mjs");
      return sendJson(res, await executeConversationSearch(WORKSPACE_ROOT, {
        query: url.searchParams.get("query") || "",
        timeRange: url.searchParams.get("timeRange") || "",
        scope: url.searchParams.get("scope") || "",
        folderId: url.searchParams.get("folderId") || "",
        projectId: url.searchParams.get("projectId") || "",
        includeArchived: url.searchParams.get("includeArchived") === "true",
        maxResults: parseInt(url.searchParams.get("maxResults") || "10", 10)
      }));
    }
    if (req.method === "POST" && url.pathname === "/api/conversations/search") {
      const body = await readJsonBody(req);
      const { executeConversationSearch } = await import("./lib/runtime/conversation-tools.mjs");
      return sendJson(res, await executeConversationSearch(WORKSPACE_ROOT, body));
    }
    if (req.method === "POST" && url.pathname === "/api/conversations/read") {
      const body = await readJsonBody(req);
      const { executeConversationRead } = await import("./lib/runtime/conversation-tools.mjs");
      return sendJson(res, await executeConversationRead(WORKSPACE_ROOT, body));
    }
    const convMsgMatch = url.pathname.match(/^\/api\/conversations\/([^/]+)\/messages$/);
    if (req.method === "GET" && convMsgMatch) {
      const sessionId = decodeURIComponent(convMsgMatch[1]);
      const engine = createAgentEngine();
      try {
        return sendJson(res, normalizeSessionMessagesResponse(await engine.getSessionMessages(sessionId)));
      } finally {
        engine.close();
      }
    }

    // --- Conversation Folders Routes ---
    if (req.method === "GET" && url.pathname === "/api/conversation-folders") {
      const { listFolders } = await import("./lib/runtime/conversation-folders.mjs");
      return sendJson(res, await listFolders(WORKSPACE_ROOT));
    }
    if (req.method === "POST" && url.pathname === "/api/conversation-folders") {
      const body = await readJsonBody(req);
      const { createFolder } = await import("./lib/runtime/conversation-folders.mjs");
      return sendJson(res, await createFolder(WORKSPACE_ROOT, body), 201);
    }
    const folderMatch = url.pathname.match(/^\/api\/conversation-folders\/([^/]+)$/);
    if (folderMatch) {
      const folderId = decodeURIComponent(folderMatch[1]);
      if (req.method === "PATCH") {
        const body = await readJsonBody(req);
        const { updateFolder } = await import("./lib/runtime/conversation-folders.mjs");
        return sendJson(res, await updateFolder(WORKSPACE_ROOT, folderId, body));
      }
      if (req.method === "DELETE") {
        const { deleteFolder } = await import("./lib/runtime/conversation-folders.mjs");
        return sendJson(res, await deleteFolder(WORKSPACE_ROOT, folderId));
      }
    }

    // --- Session Folder Move & Manual Archive/Unarchive ---
    const sessionMoveMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/move-to-folder$/);
    if (req.method === "POST" && sessionMoveMatch) {
      const sessionId = decodeURIComponent(sessionMoveMatch[1]);
      const body = await readJsonBody(req);
      const { moveSessionToFolder } = await import("./lib/runtime/conversation-folders.mjs");
      return sendJson(res, await moveSessionToFolder(WORKSPACE_ROOT, sessionId, body.folderId));
    }
    const sessionArchiveMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/archive$/);
    if (req.method === "POST" && sessionArchiveMatch) {
      const sessionId = decodeURIComponent(sessionArchiveMatch[1]);
      const { archiveSession } = await import("./lib/runtime/session-archive.mjs");
      return sendJson(res, await archiveSession(WORKSPACE_ROOT, sessionId));
    }
    const sessionUnarchiveMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/unarchive$/);
    if (req.method === "POST" && sessionUnarchiveMatch) {
      const sessionId = decodeURIComponent(sessionUnarchiveMatch[1]);
      const { unarchiveSession } = await import("./lib/runtime/session-archive.mjs");
      return sendJson(res, await unarchiveSession(WORKSPACE_ROOT, sessionId));
    }
    if (req.method === "GET" && url.pathname === "/api/conversation-archive") {
      const { listArchivedSessions } = await import("./lib/runtime/session-archive.mjs");
      return sendJson(res, await listArchivedSessions(WORKSPACE_ROOT));
    }
    if (req.method === "POST" && url.pathname === "/api/sessions/archive-expired") {
      const body = await readJsonBody(req).catch(() => ({}));
      const { archiveOverflowGeneralSessions } = await import("./lib/runtime/session-archive.mjs");
      return sendJson(res, await archiveOverflowGeneralSessions(WORKSPACE_ROOT, {
        limit: body.limit || 30
      }));
    }
    const sessionSummarizeMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/summarize$/);
    if (req.method === "POST" && sessionSummarizeMatch) {
      return sendJson(res, await summarizeSession(sessionSummarizeMatch[1]));
    }

    // --- Long-Term Memory Search & CRUD ---
    if (req.method === "GET" && url.pathname === "/api/memory/search") {
      const query = url.searchParams.get("query") || "";
      const currentFolderId = url.searchParams.get("currentFolderId") || "";
      const currentProjectId = url.searchParams.get("currentProjectId") || "";
      const timeRange = url.searchParams.get("timeRange") || "";
      const maxResults = parseInt(url.searchParams.get("maxResults") || "10", 10);
      const { searchMemory } = await import("./lib/runtime/memory-retrieval.mjs");
      return sendJson(res, await searchMemory(WORKSPACE_ROOT, query, { currentFolderId, currentProjectId, timeRange, maxResults }));
    }
    if (req.method === "GET" && url.pathname === "/api/memory/settings") {
      const { readMemorySettings } = await import("./lib/runtime/memory-retrieval.mjs");
      return sendJson(res, await readMemorySettings(WORKSPACE_ROOT));
    }
    if (req.method === "POST" && url.pathname === "/api/memory/settings") {
      const body = await readJsonBody(req);
      const { writeMemorySettings } = await import("./lib/runtime/memory-retrieval.mjs");
      return sendJson(res, await writeMemorySettings(WORKSPACE_ROOT, body));
    }
    if (req.method === "GET" && url.pathname === "/api/memory/candidates") {
      const { listMemoryCandidates } = await import("./lib/runtime/memory-retrieval.mjs");
      return sendJson(res, { candidates: await listMemoryCandidates(WORKSPACE_ROOT) });
    }
    const memoryCandidateApproveMatch = url.pathname.match(/^\/api\/memory\/candidates\/([^/]+)\/approve$/);
    if (memoryCandidateApproveMatch && req.method === "POST") {
      const body = await readJsonBody(req).catch(() => ({}));
      const { approveMemoryCandidate } = await import("./lib/runtime/memory-retrieval.mjs");
      return sendJson(res, await approveMemoryCandidate(WORKSPACE_ROOT, decodeURIComponent(memoryCandidateApproveMatch[1]), body));
    }
    const memoryCandidateRejectMatch = url.pathname.match(/^\/api\/memory\/candidates\/([^/]+)\/reject$/);
    if (memoryCandidateRejectMatch && req.method === "POST") {
      const body = await readJsonBody(req).catch(() => ({}));
      const { rejectMemoryCandidate } = await import("./lib/runtime/memory-retrieval.mjs");
      return sendJson(res, await rejectMemoryCandidate(WORKSPACE_ROOT, decodeURIComponent(memoryCandidateRejectMatch[1]), body.reason || "Rejected by user."));
    }
    if (req.method === "POST" && url.pathname === "/api/memory") {
      const body = await readJsonBody(req);
      const memories = await getUserMemories();
      const newMemory = {
        id: body.id || `memory-${randomUUID()}`,
        content: body.content || "",
        createdAt: new Date().toISOString(),
        pinned: Boolean(body.pinned),
        sourceSessionIds: body.sourceSessionIds || []
      };
      memories.push(newMemory);
      await saveUserMemories(memories);
      return sendJson(res, newMemory, 201);
    }
    if (req.method === "POST" && url.pathname === "/api/memory/extract-from-session") {
      const body = await readJsonBody(req);
      return sendJson(res, await extractMemoryFromSession(body.sessionId));
    }
    const memoryMatch = url.pathname.match(/^\/api\/memory\/([^/]+)$/);
    if (memoryMatch) {
      const memoryId = decodeURIComponent(memoryMatch[1]);
      if (req.method === "GET") {
        const { readMemoryById } = await import("./lib/runtime/memory-retrieval.mjs");
        const memory = await readMemoryById(WORKSPACE_ROOT, memoryId);
        if (!memory) return sendJson(res, { ok: false, error: "Memory not found." }, 404);
        return sendJson(res, memory);
      }
      if (req.method === "PATCH") {
        const body = await readJsonBody(req);
        const memories = await getUserMemories();
        const idx = memories.findIndex(m => m.id === memoryId);
        if (idx === -1) {
          return sendJson(res, { ok: false, error: "Memory not found." }, 404);
        }
        memories[idx] = {
          ...memories[idx],
          ...body,
          updatedAt: new Date().toISOString()
        };
        await saveUserMemories(memories);
        return sendJson(res, memories[idx]);
      }
      if (req.method === "DELETE") {
        const memories = await getUserMemories();
        const deletedMemory = memories.find(m => m.id === memoryId);
        const filtered = memories.filter(m => m.id !== memoryId);
        await saveUserMemories(filtered);
        if (deletedMemory) {
          const { recordDeletedMemoryTombstone } = await import("./lib/runtime/memory-retrieval.mjs");
          await recordDeletedMemoryTombstone(WORKSPACE_ROOT, deletedMemory, "user_deleted");
        }
        return sendJson(res, { ok: true });
      }
    }

    // --- Workspace-owned session routes (no Hermes required) ---
    const wsSessionsPath = "/api/workspace/sessions";
    if (url.pathname === wsSessionsPath) {
      const engine = createAgentEngine();
      try {
        if (req.method === "GET") {
          return sendJson(res, normalizeSessionsResponse(await engine.listSessions(200)));
        }
        if (req.method === "POST") {
          const body = await readJsonBody(req);
          return sendJson(res, await engine.createSession(body), 201);
        }
      } finally {
        engine.close();
      }
    }
    const wsSessionMsgMatch = url.pathname.match(/^\/api\/workspace\/sessions\/([^/]+)\/messages$/);
    if (wsSessionMsgMatch) {
      const engine = createAgentEngine();
      try {
        if (req.method === "GET") {
          const sessionId = decodeURIComponent(wsSessionMsgMatch[1]);
          return sendJson(res, normalizeSessionMessagesResponse(
            await engine.getSessionMessages(sessionId)
          ));
        }
      } finally {
        engine.close();
      }
    }
    const wsSessionSingleMatch = url.pathname.match(/^\/api\/workspace\/sessions\/([^/]+)$/);
    if (wsSessionSingleMatch) {
      const engine = createAgentEngine();
      try {
        if (req.method === "DELETE") {
          const sessionId = decodeURIComponent(wsSessionSingleMatch[1]);
          return sendJson(res, await engine.deleteSession(sessionId));
        }
      } finally {
        engine.close();
      }
    }
    // --- AI Workspace runtime routes ---
    if (
      url.pathname === "/api/models"
      || url.pathname === "/api/workspace/models"
      || url.pathname === "/api/sessions"
      || url.pathname.startsWith("/api/sessions/")
    ) {
      return handleRuntimeProxy(req, res, url);
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
    runtime: {
      status: "ok",
      owner: "ai-workspace",
      configPath: ".ai-workspace/config"
    },
    chatRuntime: {
      status: "ok",
      reason: ""
    },
    agent: {
      engine: "workspace-agent",
      statePath: ".ai-workspace",
      runtimes: ["ai-workspace-runtime", "chat", "models", "sessions", "code-agent"],
      taskEndpoint: "/api/agent/tasks",
      approvalEndpoint: "/api/agent/approvals",
      codeTaskEndpoint: "/api/agent/code-task",
      codePatchEndpoint: "/api/agent/code-task/:id/patches",
      codePatchRejectEndpoint: "/api/agent/code-task/:id/patches/:proposalId/reject",
      codeChecksEndpoint: "/api/agent/code-task/:id/checks",
      codeGitEndpoint: "/api/agent/code-task/:id/git"
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
    .filter((entry) => !(relativePath === "" && entry.name === ".ai-workspace"))
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

async function copyPath(req) {
  const body = await readJsonBody(req);
  if (!body.from || !body.to) throw Object.assign(new Error("Missing from or to path."), { status: 400 });
  const from = resolveWorkspacePath(WORKSPACE_ROOT, body.from);
  const to = resolveWorkspacePath(WORKSPACE_ROOT, body.to);
  await fs.mkdir(path.dirname(to.absolutePath), { recursive: true });
  await fs.cp(from.absolutePath, to.absolutePath, {
    recursive: true,
    errorOnExist: true,
    force: false
  });
  return { ok: true, from: from.relativePath, to: to.relativePath };
}

async function uploadFile(req) {
  const body = await readJsonBody(req);
  if (!body.path) throw Object.assign(new Error("Missing file path."), { status: 400 });
  if (typeof body.dataBase64 !== "string") {
    throw Object.assign(new Error("Missing file data."), { status: 400 });
  }
  const { relativePath, absolutePath } = resolveWorkspacePath(WORKSPACE_ROOT, body.path);
  await assertPathAvailable(absolutePath);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, Buffer.from(body.dataBase64, "base64"), { flag: "wx" });
  return { ok: true, path: relativePath };
}

async function startChunkedUpload(req) {
  const body = await readJsonBody(req);
  if (!body.path) throw Object.assign(new Error("Missing file path."), { status: 400 });
  const size = Number(body.size);
  if (!Number.isSafeInteger(size) || size < 0) {
    throw Object.assign(new Error("Missing or invalid file size."), { status: 400 });
  }
  const { relativePath, absolutePath } = resolveWorkspacePath(WORKSPACE_ROOT, body.path);
  await assertPathAvailable(absolutePath);
  await fs.mkdir(uploadTempDir(), { recursive: true });
  const uploadId = randomUUID();
  const tempPath = uploadTempPath(uploadId);
  const metaPath = uploadMetaPath(uploadId);
  await fs.writeFile(tempPath, Buffer.alloc(0), { flag: "wx" });
  await fs.writeFile(metaPath, JSON.stringify({
    uploadId,
    path: relativePath,
    size,
    received: 0,
    createdAt: new Date().toISOString()
  }, null, 2) + "\n", { flag: "wx" });
  return { ok: true, uploadId, path: relativePath, received: 0 };
}

async function appendUploadChunk(req) {
  const body = await readJsonBody(req);
  const uploadId = requireUploadId(body.uploadId);
  const offset = Number(body.offset);
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw Object.assign(new Error("Missing or invalid chunk offset."), { status: 400 });
  }
  if (typeof body.dataBase64 !== "string") {
    throw Object.assign(new Error("Missing chunk data."), { status: 400 });
  }
  const meta = await readUploadMeta(uploadId);
  const buffer = Buffer.from(body.dataBase64, "base64");
  if (offset !== meta.received) {
    throw Object.assign(new Error(`Unexpected chunk offset. Expected ${meta.received}.`), { status: 409 });
  }
  if (offset + buffer.length > meta.size) {
    throw Object.assign(new Error("Chunk exceeds declared upload size."), { status: 400 });
  }
  const handle = await fs.open(uploadTempPath(uploadId), "r+");
  try {
    await handle.write(buffer, 0, buffer.length, offset);
  } finally {
    await handle.close();
  }
  meta.received = offset + buffer.length;
  await writeUploadMeta(uploadId, meta);
  return { ok: true, uploadId, received: meta.received, size: meta.size };
}

async function completeChunkedUpload(req) {
  const body = await readJsonBody(req);
  const uploadId = requireUploadId(body.uploadId);
  const meta = await readUploadMeta(uploadId);
  if (meta.received !== meta.size) {
    throw Object.assign(new Error(`Upload incomplete. Received ${meta.received} of ${meta.size} bytes.`), { status: 400 });
  }
  const { relativePath, absolutePath } = resolveWorkspacePath(WORKSPACE_ROOT, meta.path);
  await assertPathAvailable(absolutePath);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.copyFile(uploadTempPath(uploadId), absolutePath, fsConstants.COPYFILE_EXCL);
  await cleanupUpload(uploadId);
  return { ok: true, uploadId, path: relativePath };
}

async function cancelChunkedUpload(req) {
  const body = await readJsonBody(req);
  const uploadId = requireUploadId(body.uploadId);
  await cleanupUpload(uploadId);
  return { ok: true, uploadId };
}

async function deletePath(url) {
  const filePath = requireQuery(url, "path");
  const { relativePath, absolutePath } = resolveWorkspacePath(WORKSPACE_ROOT, filePath);
  await fs.rm(absolutePath, { recursive: true, force: false });
  return { ok: true, path: relativePath };
}

async function fileMetadata(url) {
  const filePath = requireQuery(url, "path");
  return await readFileMetadata(WORKSPACE_ROOT, filePath);
}

async function resolveContext(req) {
  const body = await readJsonBody(req);
  return await buildWorkspaceContext(WORKSPACE_ROOT, body);
}

async function indexStatus() {
  const index = await readIndex(WORKSPACE_ROOT);
  return {
    provider: index.provider,
    builtAt: index.builtAt,
    itemCount: index.itemCount || 0,
    indexPath: ".ai-workspace/index/files.json"
  };
}

async function rebuildIndex() {
  const index = await buildIndex(WORKSPACE_ROOT);
  return {
    ok: true,
    provider: index.provider,
    builtAt: index.builtAt,
    itemCount: index.itemCount
  };
}

async function runSearch(req) {
  const body = await readJsonBody(req);
  return await searchWorkspace(WORKSPACE_ROOT, body);
}

async function skillsList() {
  const skills = await listSkills(WORKSPACE_ROOT);
  return {
    skills: skills.map((skill) => ({
      name: skill.name,
      enabled: Boolean(skill.config?.enabled),
      triggers: skill.config?.triggers || [],
      taskTypes: skill.config?.taskTypes || []
    }))
  };
}

async function skillDetail(name) {
  return await readSkill(WORKSPACE_ROOT, decodeURIComponent(name));
}

async function setSkillEnabled(name, enabled) {
  await assertSkillExists(name);
  const skill = await enableSkill(WORKSPACE_ROOT, decodeURIComponent(name), enabled);
  return {
    ok: true,
    name: skill.name,
    enabled: Boolean(skill.config?.enabled)
  };
}

async function assertSkillExists(name) {
  const decoded = decodeURIComponent(name);
  const skills = await listSkills(WORKSPACE_ROOT);
  if (!skills.some((skill) => skill.name === decoded)) {
    throw Object.assign(new Error(`Skill not found: ${decoded}`), { status: 404 });
  }
}

async function updateSecurity(req) {
  const body = await readJsonBody(req);
  const current = await readSecurityConfig(WORKSPACE_ROOT);
  const next = {
    approvalMode: body.approvalMode ?? current.approvalMode,
    allowShell: body.allowShell ?? current.allowShell,
    allowedCommands: Array.isArray(body.allowedCommands) ? body.allowedCommands : current.allowedCommands,
    deniedCommands: Array.isArray(body.deniedCommands) ? body.deniedCommands : current.deniedCommands,
    requireApproval: Array.isArray(body.requireApproval) ? body.requireApproval : current.requireApproval
  };
  await writeSecurityConfig(WORKSPACE_ROOT, next);
  return { ok: true, security: next };
}

async function listMcpServers() {
  const config = await readRuntimeConfig(WORKSPACE_ROOT);
  return { servers: config.mcpServers || [] };
}

async function addMcpServer(req) {
  const body = await readJsonBody(req);
  const name = safeMcpName(body.name);
  const command = String(body.command || "").trim();
  if (!command) throw Object.assign(new Error("Missing MCP command."), { status: 400 });
  const config = await readRuntimeConfig(WORKSPACE_ROOT);
  const servers = config.mcpServers || [];
  if (servers.some((server) => server.name === name)) {
    throw Object.assign(new Error(`MCP server already exists: ${name}`), { status: 409 });
  }
  servers.push({
    name,
    command,
    args: Array.isArray(body.args) ? body.args.map(String) : [],
    enabled: body.enabled !== false
  });
  await writeRuntimeConfig(WORKSPACE_ROOT, { ...config, mcpServers: servers });
  return { ok: true, server: servers.at(-1) };
}

async function setMcpEnabled(name, enabled) {
  const target = safeMcpName(decodeURIComponent(name));
  const config = await readRuntimeConfig(WORKSPACE_ROOT);
  const servers = config.mcpServers || [];
  const server = servers.find((item) => item.name === target);
  if (!server) throw Object.assign(new Error(`MCP server not found: ${target}`), { status: 404 });
  server.enabled = enabled;
  await writeRuntimeConfig(WORKSPACE_ROOT, { ...config, mcpServers: servers });
  return { ok: true, server };
}

async function removeMcpServer(name) {
  const target = safeMcpName(decodeURIComponent(name));
  const config = await readRuntimeConfig(WORKSPACE_ROOT);
  const servers = config.mcpServers || [];
  const next = servers.filter((item) => item.name !== target);
  if (next.length === servers.length) {
    throw Object.assign(new Error(`MCP server not found: ${target}`), { status: 404 });
  }
  await writeRuntimeConfig(WORKSPACE_ROOT, { ...config, mcpServers: next });
  return { ok: true, removed: target };
}

async function doctorStatus() {
  const [config, security, skills, index, audit] = await Promise.all([
    readRuntimeConfig(WORKSPACE_ROOT),
    readSecurityConfig(WORKSPACE_ROOT),
    listSkills(WORKSPACE_ROOT),
    readIndex(WORKSPACE_ROOT),
    readAuditSummary(WORKSPACE_ROOT)
  ]);
  return {
    ok: true,
    service: "ai-workspace",
    workspaceRoot: WORKSPACE_ROOT,
    authRequired: Boolean(SERVER_TOKEN),
    runtime: {
      defaultModel: config.defaultModel,
      fallbackChain: config.fallbackChain || [],
      disabledTools: config.disabledTools || []
    },
    mcp: {
      count: (config.mcpServers || []).length,
      enabledCount: (config.mcpServers || []).filter((server) => server.enabled !== false).length
    },
    skills: {
      count: skills.length,
      enabledCount: skills.filter((skill) => skill.config?.enabled).length
    },
    security,
    index: {
      builtAt: index.builtAt,
      itemCount: index.itemCount || 0
    },
    audit,
    search: searchStatus(WORKSPACE_ROOT)
  };
}

async function listRuntimeProviders() {
  const [providers, credentials, config] = await Promise.all([
    Promise.resolve(listProviderRegistry()),
    listCredentialStatus(WORKSPACE_ROOT),
    readRuntimeConfig(WORKSPACE_ROOT)
  ]);
  const credentialMap = new Map(credentials.map((item) => [item.provider, item]));
  return {
    providers: providers.map((provider) => ({
      ...provider,
      configured: Boolean(credentialMap.get(provider.id)?.configured),
      storedKeys: credentialMap.get(provider.id)?.storedKeys || [],
      envKeys: credentialMap.get(provider.id)?.envKeys || [],
      isDefault: config.defaultModel?.provider === provider.id
    }))
  };
}

async function discoverProviderModels(providerParam) {
  const providerId = decodeURIComponent(providerParam);
  const provider = BUILTIN_PROVIDERS.find((item) => item.id === providerId);
  if (!provider) {
    throw Object.assign(new Error(`Unknown provider: ${providerId}`), { status: 404 });
  }

  if (providerId === "ollama-local") {
    const credentials = await readCredentials(WORKSPACE_ROOT);
    const values = credentials.providers?.[providerId]?.values || {};
    const configuredUrl = values.baseUrl || values.BASE_URL || values.OLLAMA_HOST || process.env.OLLAMA_HOST || provider.defaultBaseUrl;
    const host = String(configuredUrl || "http://127.0.0.1:11434")
      .replace(/\/v1\/?$/, "")
      .replace(/\/$/, "");
    let response;
    try {
      response = await fetch(`${host}/api/tags`, { signal: AbortSignal.timeout(5000) });
    } catch (error) {
      throw Object.assign(new Error(`Could not connect to Ollama at ${host}: ${error.message}`), { status: 502 });
    }
    if (!response.ok) {
      throw Object.assign(new Error(`Ollama model discovery failed: ${response.status}`), { status: 502 });
    }
    const payload = await response.json();
    const models = (payload.models || [])
      .filter((item) => {
        const capabilities = Array.isArray(item.capabilities) ? item.capabilities : [];
        return capabilities.length === 0 || capabilities.some((capability) => ["completion", "tools", "thinking"].includes(capability));
      })
      .map((item) => item.model || item.name)
      .filter(Boolean);
    return { provider: providerId, source: "ollama", baseUrl: `${host}/v1`, models };
  }

  return {
    provider: providerId,
    source: "registry",
    baseUrl: provider.defaultBaseUrl || null,
    models: provider.models || []
  };
}

async function listRuntimeAuth() {
  return {
    providers: await listCredentialStatus(WORKSPACE_ROOT)
  };
}

async function readDefaultModel() {
  const config = await readRuntimeConfig(WORKSPACE_ROOT);
  return {
    defaultModel: config.defaultModel || null
  };
}

async function updateDefaultModel(req) {
  const body = await readJsonBody(req);
  const provider = String(body.provider || "").trim();
  const model = String(body.model || body.name || "").trim();
  if (!provider || !model) {
    throw Object.assign(new Error("provider and model are required."), { status: 400 });
  }
  const config = await readRuntimeConfig(WORKSPACE_ROOT);
  const defaultModel = {
    provider,
    model,
    id: `${provider}:${model}`,
    baseUrl: body.baseUrl === undefined ? config.defaultModel?.baseUrl : String(body.baseUrl || ""),
    apiMode: body.apiMode === undefined ? config.defaultModel?.apiMode : String(body.apiMode || "")
  };
  await writeRuntimeConfig(WORKSPACE_ROOT, { ...config, defaultModel });
  return { ok: true, defaultModel };
}

async function updateProviderAuth(providerParam, req) {
  const providerId = decodeURIComponent(providerParam);
  const body = await readJsonBody(req);
  const provider = BUILTIN_PROVIDERS.find((item) => item.id === providerId);
  if (!provider) {
    throw Object.assign(new Error(`Unknown provider: ${providerId}`), { status: 400 });
  }

  const rawValues = body.values && typeof body.values === "object" ? body.values : body;
  const entries = [];
  for (const [rawKey, rawValue] of Object.entries(rawValues || {})) {
    if (["values", "provider"].includes(rawKey)) continue;
    if (rawValue === undefined || rawValue === null) continue;
    const value = String(rawValue);
    if (!value && body.removeEmpty === true) continue;
    entries.push([providerCredentialKey(provider, rawKey), value]);
  }

  if (entries.length === 0 && body.key) {
    entries.push([providerCredentialKey(provider, body.key), String(body.value || "")]);
  }
  if (entries.length === 0) {
    throw Object.assign(new Error("No credential values provided."), { status: 400 });
  }

  const stored = [];
  for (const [key, value] of entries) {
    stored.push(await setCredentialValue(WORKSPACE_ROOT, providerId, key, value));
  }
  return { ok: true, provider: providerId, stored };
}

async function deleteProviderAuth(providerParam, keyParam) {
  const providerId = decodeURIComponent(providerParam);
  const provider = BUILTIN_PROVIDERS.find((item) => item.id === providerId);
  if (!provider) {
    throw Object.assign(new Error(`Unknown provider: ${providerId}`), { status: 400 });
  }
  const key = providerCredentialKey(provider, decodeURIComponent(keyParam));
  return await removeCredentialValue(WORKSPACE_ROOT, providerId, key);
}

async function createCustomProvider(req) {
  const body = await readJsonBody(req);
  const id = String(body.id || "custom").trim();
  if (id !== "custom") {
    throw Object.assign(new Error("This preview build supports the built-in custom provider id only."), { status: 400 });
  }
  const stored = [];
  if (body.baseUrl) {
    stored.push(await setCredentialValue(WORKSPACE_ROOT, "custom", "AIW_CUSTOM_BASE_URL", String(body.baseUrl)));
  }
  if (body.apiKey || body.token) {
    stored.push(await setCredentialValue(WORKSPACE_ROOT, "custom", "AIW_CUSTOM_API_KEY", String(body.apiKey || body.token)));
  }
  if (body.model) {
    await setDefaultModel(WORKSPACE_ROOT, "custom", String(body.model));
  }
  return { ok: true, provider: { id: "custom", name: body.name || "Custom OpenAI-compatible" }, stored };
}

async function deleteCustomProvider(idParam) {
  const id = decodeURIComponent(idParam);
  if (id !== "custom") {
    throw Object.assign(new Error("This preview build supports the built-in custom provider id only."), { status: 404 });
  }
  return await removeCredentialValue(WORKSPACE_ROOT, "custom");
}

function providerCredentialKey(provider, rawKey) {
  const key = String(rawKey || "").trim();
  const normalized = key.toLowerCase();
  if (provider.id === "custom") {
    if (["baseurl", "base_url", "url", "endpoint"].includes(normalized)) return "AIW_CUSTOM_BASE_URL";
    if (["apikey", "api_key", "token", "access_token", "key"].includes(normalized)) return "AIW_CUSTOM_API_KEY";
  }
  if (["baseurl", "base_url", "url", "endpoint"].includes(normalized) && provider.baseUrlEnv) {
    return provider.baseUrlEnv;
  }
  if (["apikey", "api_key", "token", "access_token", "key"].includes(normalized)) {
    return provider.env?.[0] || key;
  }
  return key;
}

function safeMcpName(value) {
  const name = String(value || "").trim();
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    throw Object.assign(new Error("MCP server name must contain only letters, numbers, dashes, and underscores."), { status: 400 });
  }
  return name;
}

async function createCodeTask(req) {
  const body = await readJsonBody(req);
  const engine = createAgentEngine();
  try {
    return await engine.inspectCodeTask(body);
  } finally {
    engine.close();
  }
}

async function listAgentTasks(url) {
  const engine = createAgentEngine();
  try {
    return await engine.listTasks({
      type: url.searchParams.get("type") || "",
      limit: url.searchParams.get("limit") || ""
    });
  } finally {
    engine.close();
  }
}

async function readAgentTask(taskId) {
  const engine = createAgentEngine();
  try {
    return await engine.readTask(decodeURIComponent(taskId));
  } finally {
    engine.close();
  }
}

async function resumeAgentTask(taskId, req) {
  const body = await readJsonBody(req);
  const engine = createAgentEngine();
  try {
    return await engine.resumeTask(decodeURIComponent(taskId), body);
  } finally {
    engine.close();
  }
}

async function cancelAgentTask(taskId, req) {
  const body = await readJsonBody(req);
  const engine = createAgentEngine();
  try {
    return await engine.cancelTask(decodeURIComponent(taskId), body);
  } finally {
    engine.close();
  }
}

async function listAgentApprovals(url) {
  const engine = createAgentEngine();
  try {
    return await engine.listApprovals({
      status: url.searchParams.get("status") || "",
      category: url.searchParams.get("category") || "",
      taskId: url.searchParams.get("taskId") || "",
      limit: url.searchParams.get("limit") || ""
    });
  } finally {
    engine.close();
  }
}

async function readAgentApproval(approvalId) {
  const engine = createAgentEngine();
  try {
    return await engine.readApproval(decodeURIComponent(approvalId));
  } finally {
    engine.close();
  }
}

async function respondToAgentApproval(approvalId, req) {
  const body = await readJsonBody(req);
  const engine = createAgentEngine();
  try {
    return await engine.respondToWorkspaceApproval(decodeURIComponent(approvalId), body);
  } finally {
    engine.close();
  }
}

async function runCodeTaskChecks(taskId, req) {
  const body = await readJsonBody(req);
  const engine = createAgentEngine();
  try {
    return await engine.runCodeTaskChecks(decodeURIComponent(taskId), body);
  } finally {
    engine.close();
  }
}

async function runCodeTaskGit(taskId, req) {
  const body = await readJsonBody(req);
  const engine = createAgentEngine();
  try {
    return await engine.runCodeTaskGit(decodeURIComponent(taskId), body);
  } finally {
    engine.close();
  }
}

async function proposeCodeTaskPatch(taskId, req) {
  const body = await readJsonBody(req);
  const engine = createAgentEngine();
  try {
    return await engine.proposeCodeTaskPatch(decodeURIComponent(taskId), body);
  } finally {
    engine.close();
  }
}

async function generateCodeTaskPatch(taskId, req) {
  const body = await readJsonBody(req);
  const engine = createAgentEngine();
  try {
    return await engine.generateCodeTaskPatch(decodeURIComponent(taskId), body);
  } finally {
    engine.close();
  }
}

async function applyCodeTaskPatch(taskId, proposalId, req) {
  const body = await readJsonBody(req);
  const engine = createAgentEngine();
  try {
    return await engine.applyCodeTaskPatch(decodeURIComponent(taskId), {
      ...body,
      proposalId: decodeURIComponent(proposalId)
    });
  } finally {
    engine.close();
  }
}

async function rejectCodeTaskPatch(taskId, proposalId, req) {
  const body = await readJsonBody(req);
  const engine = createAgentEngine();
  try {
    return await engine.rejectCodeTaskPatch(decodeURIComponent(taskId), {
      ...body,
      proposalId: decodeURIComponent(proposalId)
    });
  } finally {
    engine.close();
  }
}

async function summarizeSession(sessionIdParam) {
  const sessionId = decodeURIComponent(sessionIdParam);
  const filePath = path.join(WORKSPACE_ROOT, ".ai-workspace", "sessions", `${sessionId}.json`);
  const session = JSON.parse(await fs.readFile(filePath, "utf8"));
  const { buildSessionSummary } = await import("./lib/session-runtime.mjs");
  const summary = buildSessionSummary(session);
  session.summary = summary;
  session.updatedAt = new Date().toISOString();
  await fs.writeFile(filePath, JSON.stringify(session, null, 2), "utf8");
  const { indexSession } = await import("./lib/runtime/conversation-index.mjs");
  await indexSession(WORKSPACE_ROOT, session);
  return { ok: true, sessionId, summary };
}

async function extractMemoryFromSession(sessionIdParam) {
  const sessionId = String(sessionIdParam || "").trim();
  if (!sessionId) throw Object.assign(new Error("sessionId is required."), { status: 400 });
  const filePath = path.join(WORKSPACE_ROOT, ".ai-workspace", "sessions", `${sessionId}.json`);
  const session = JSON.parse(await fs.readFile(filePath, "utf8"));
  const { updateMemoryFromSession } = await import("./lib/runtime/memory-retrieval.mjs");
  return await updateMemoryFromSession(WORKSPACE_ROOT, session);
}

async function renderMarkdown(req) {
  const body = await readJsonBody(req);
  const html = await renderMarkdownDocument(body.markdown || body.content || "", {
    theme: body.theme || "github-dark"
  });
  return { html };
}

async function renderCode(req) {
  const body = await readJsonBody(req);
  const html = await renderCodeDocument(body.code || body.content || "", {
    language: body.language || "",
    theme: body.theme || "github-dark"
  });
  return { html };
}

async function handleRuntimeProxy(req, res, url) {
  const engine = createAgentEngine();
  try {
    const isModels = url.pathname === "/api/models" || url.pathname === "/api/workspace/models";
    const isSessionsGet = url.pathname === "/api/sessions" && req.method === "GET";
    const isSessionsPost = url.pathname === "/api/sessions" && req.method === "POST";
    const isSessionsPrune = url.pathname === "/api/sessions/prune" && req.method === "POST";
    
    const messagesMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/messages$/);
    const sessionMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)$/);
    const renameMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/rename$/);
    const exportMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/export$/);

    if (isModels && req.method === "GET") {
      return sendJson(res, await engine.listModels());
    }
    if (isSessionsGet) {
      return sendJson(res, normalizeSessionsResponse(await engine.listSessions(200)));
    }
    if (isSessionsPrune) {
      return sendJson(res, await engine.pruneSessions());
    }
    if (messagesMatch && req.method === "GET") {
      const sessionId = decodeURIComponent(messagesMatch[1]);
      return sendJson(res, normalizeSessionMessagesResponse(
        await engine.getSessionMessages(sessionId)
      ));
    }
    if (sessionMatch && req.method === "DELETE") {
      const sessionId = decodeURIComponent(sessionMatch[1]);
      return sendJson(res, await engine.deleteSession(sessionId));
    }
    if (renameMatch && req.method === "POST") {
      const sessionId = decodeURIComponent(renameMatch[1]);
      const body = await readJsonBody(req);
      return sendJson(res, await engine.renameSession(sessionId, body.title));
    }
    if (exportMatch && req.method === "GET") {
      const sessionId = decodeURIComponent(exportMatch[1]);
      return sendJson(res, await engine.exportSession(sessionId));
    }
    if (isSessionsPost) {
      const body = await readJsonBody(req);
      return sendJson(res, await engine.createSession(body), 201);
    }
    throw Object.assign(new Error("Unknown AI Workspace runtime endpoint."), { status: 404 });
  } finally {
    engine.close();
  }
}

function normalizeSessionsResponse(value) {
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
    seen.add(id);
    sessions.push({
      id,
      title,
      model: stringField(item.model),
      preview,
      projectId: stringField(item.project_id, item.projectId, item.project?.id, item.workspace_id, item.workspaceId, item.scope_id, item.scopeId),
      projectTitle: stringField(item.project_title, item.projectTitle, item.project?.title, item.project?.name, item.workspace_title, item.workspaceTitle, item.workspace?.title, item.workspace?.name, item.cwd, item.git_repo_root, item.gitRepoRoot),
      updatedAt: stringField(item.updated_at, item.updatedAt, item.modified_at, item.modifiedAt, item.last_active, item.lastActive),
      isActive: Boolean(item.is_active ?? item.isActive)
    });
  }
  return { sessions };
}

function normalizeSessionMessagesResponse(value) {
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

function uploadTempDir() {
  return path.join(WORKSPACE_ROOT, ".ai-workspace", "uploads");
}

function requireUploadId(value) {
  const uploadId = String(value || "");
  if (!/^[0-9a-f-]{36}$/i.test(uploadId)) {
    throw Object.assign(new Error("Missing or invalid upload id."), { status: 400 });
  }
  return uploadId;
}

function uploadTempPath(uploadId) {
  return path.join(uploadTempDir(), `${uploadId}.part`);
}

function uploadMetaPath(uploadId) {
  return path.join(uploadTempDir(), `${uploadId}.json`);
}

async function readUploadMeta(uploadId) {
  try {
    return JSON.parse(await fs.readFile(uploadMetaPath(uploadId), "utf8"));
  } catch {
    throw Object.assign(new Error("Upload session not found."), { status: 404 });
  }
}

async function writeUploadMeta(uploadId, meta) {
  await fs.writeFile(uploadMetaPath(uploadId), JSON.stringify(meta, null, 2) + "\n", "utf8");
}

async function cleanupUpload(uploadId) {
  await fs.rm(uploadTempPath(uploadId), { force: true });
  await fs.rm(uploadMetaPath(uploadId), { force: true });
}

async function assertPathAvailable(absolutePath) {
  try {
    await fs.access(absolutePath);
  } catch {
    return;
  }
  throw Object.assign(new Error("A file or folder already exists at that path."), { status: 409 });
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
  const status = Number.isInteger(error?.status) ? error.status
    : error?.code === "EEXIST" ? 409
      : 500;
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

async function getUserMemories() {
  const filePath = path.join(WORKSPACE_ROOT, ".ai-workspace", "memory", "user", "memories.jsonl");
  try {
    const data = await fs.readFile(filePath, "utf8");
    return data.split("\n").filter(Boolean).map(JSON.parse);
  } catch {
    return [];
  }
}

async function saveUserMemories(list) {
  const dir = path.join(WORKSPACE_ROOT, ".ai-workspace", "memory", "user");
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, "memories.jsonl");
  await fs.writeFile(filePath, list.map(m => JSON.stringify(m)).join("\n") + "\n", "utf8");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
