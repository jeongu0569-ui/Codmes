#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import readline from "node:readline";
import {
  listCredentialStatus,
  listProviderRegistry,
  listRuntimeModels,
  removeCredentialValue,
  setCredentialValue,
  setDefaultModel,
  readRuntimeConfig,
  ensureRuntimeConfig,
  writeRuntimeConfig
} from "../server/lib/runtime/config-store.mjs";
import { createModelTuiLaunch } from "../server/lib/runtime/model-config-tui.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const SERVER_ENTRY = path.join(REPO_ROOT, "server", "index.mjs");
const DEFAULT_SERVER_URL = "http://127.0.0.1:8787";
const DEFAULT_WORKSPACE_ROOT = path.join(os.homedir(), "AIWorkspace");

main(process.argv.slice(2)).catch((error) => {
  console.error(`aiw: ${error.message}`);
  process.exitCode = error.exitCode || 1;
});

async function main(argv) {
  const [command, ...args] = argv;
  if (!command) {
    if (process.stdin.isTTY) {
      const root = workspaceRoot({});
      await runChatInteractive(root);
      return;
    } else {
      printHelp();
      return;
    }
  }

  if (command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  switch (command) {
    case "serve":
      await runServe(args);
      return;
    case "status":
      await runStatus(args);
      return;
    case "tasks":
      await runTasks(args);
      return;
    case "model":
      await runModel(args);
      return;
    case "ollama":
      await runOllama(args);
      return;
    case "provider":
      await runProvider(args);
      return;
    case "auth":
      await runAuth(args);
      return;
    case "sessions":
    case "session":
      await runSessions(args);
      return;
    case "tools":
    case "tool":
      await runTools(args);
      return;
    case "mcp":
      await runMcp(args);
      return;
    case "skills":
    case "skill":
      await runSkills(args);
      return;
    case "security":
      await runSecurity(args);
      return;
    case "doctor":
      await runDoctor(args);
      return;
    case "config":
      await runConfig(args);
      return;
    case "approvals":
    case "approval":
      await runApprovals(args);
      return;
    case "code":
      await runCode(args);
      return;
    case "index":
      await runIndex(args);
      return;
    default:
      throw new Error(`Unknown command '${command}'. Run 'aiw help'.`);
  }
}

function printHelp() {
  console.log(`AI Workspace CLI

Usage:
  aiw                                                   (Interactive TUI Chat)
  aiw serve [--host 0.0.0.0] [--port 8787] [--root PATH]
  aiw status [--url URL] [--json]
  aiw model [list|set-default|show] [...]                (Interactive model picker if no subcommand)
  aiw ollama [--model NAME] [--url URL] [--serve]       (Configure local Ollama)
  aiw provider [list] [...]                             (Interactive provider manager if no subcommand)
  aiw auth [list|set|remove] [...]                      (Interactive auth manager if no subcommand)
  aiw sessions [list|rename|export|prune|delete]        (Interactive session browser if no subcommand)
  aiw tools [list|enable|disable] <name>
  aiw mcp [list|add|remove|enable|disable] <name> [...]
  aiw skills [list|show|enable|disable|add|remove] <name>
  aiw security [show|set-approval-mode|allow-command|deny-command|list] [...]
  aiw doctor [--deep]                                   (Diagnostics helper)
  aiw config [edit]                                     (User configuration manager)
  aiw approvals [list|show|approve|reject] [...]
  aiw tasks [list|show] [...]
  aiw code <list|create|show|patch|apply|reject|check> [...]
  aiw index <status|search> [...]

Quick start:
  aiw serve
  aiw model list
  aiw auth list

Aliases:
  ai-workspace is the long-form alias for aiw.

Environment:
  AIW_SERVER_URL          Workspace Server URL for API commands
  AIW_WORKSPACE_ROOT      Workspace root used by aiw serve/tasks
  AIW_HOST                Workspace Server bind host
  AIW_PORT                Workspace Server port
`);
}

async function runServe(args) {
  const options = parseOptions(args, { boolean: ["help"] });
  if (options.help) {
    console.log(`Usage:
  aiw serve [--host 0.0.0.0] [--port 8787] [--root PATH]

Options:
  --host VALUE       Bind host. Default: 127.0.0.1
  --port VALUE       Workspace Server port. Default: 8787
  --root PATH        Workspace root. Default: ~/AIWorkspace
`);
    return;
  }

  const env = { ...process.env };
  setEnvFromOption(env, options, ["host"], "AIW_HOST");
  setEnvFromOption(env, options, ["port"], "AIW_PORT");
  setEnvFromOption(env, options, ["root", "workspace-root"], "AIW_WORKSPACE_ROOT", expandHome);

  await runProcess(process.execPath, [SERVER_ENTRY], {
    cwd: REPO_ROOT,
    env,
    stdio: "inherit",
    resolveOnForwardedSignal: true
  });
}

async function runStatus(args) {
  const options = parseOptions(args, { boolean: ["help", "json"] });
  if (options.help) {
    console.log(`Usage:
  aiw status [--url URL] [--json]
`);
    return;
  }

  const baseUrl = workspaceUrl(options);
  const health = await requestJson(baseUrl, "/api/health");
  const workspace = await requestJson(baseUrl, "/api/workspace");
  if (options.json) {
    printJson({ url: baseUrl, health, workspace });
    return;
  }

  console.log(`Workspace Server: ${health.ok ? "ok" : "unknown"}`);
  console.log(`Workspace Root: ${workspace.workspaceRoot || "(unknown)"}`);
  console.log(`Code Runtime: ok`);
  console.log(`Approval Inbox: ok`);
  console.log(`Search Provider: ${workspace.search?.provider || "(unknown)"}`);
  console.log(`Chat Runtime: ${workspace.chatRuntime?.status || "unavailable"}`);
  console.log(`Runtime: ${workspace.runtime?.status || "unknown"}`);
}

async function runTasks(args) {
  const [subcommand = "list", ...rest] = args;
  if (subcommand === "help" || subcommand === "--help" || subcommand === "-h") {
    console.log(`Usage:
  aiw tasks [list] [--root PATH] [--type code] [--limit 20] [--json]
  aiw tasks show <taskId> [--root PATH] [--json]
  aiw tasks resume <taskId> [--url URL] [--json]
  aiw tasks cancel <taskId> [--url URL] [--reason TEXT] [--json]
`);
    return;
  }
  if (subcommand === "show") {
    await showTask(rest);
    return;
  }
  if (subcommand === "resume") {
    await resumeTask(rest);
    return;
  }
  if (subcommand === "cancel") {
    await cancelTask(rest);
    return;
  }
  if (subcommand !== "list") {
    await listTasks(args);
    return;
  }
  await listTasks(rest);
}

async function runApprovals(args) {
  const [subcommand = "list", ...rest] = args;
  if (subcommand === "help" || subcommand === "--help" || subcommand === "-h") {
    console.log(`Usage:
  aiw approvals [list] [--url URL] [--status pending] [--limit 20] [--json]
  aiw approvals show <approvalId> [--url URL] [--json]
  aiw approvals approve <approvalId> [--url URL] [--check]
  aiw approvals reject <approvalId> [--url URL] [--reason TEXT]
`);
    return;
  }
  if (subcommand === "show") {
    await approvalShow(rest);
    return;
  }
  if (subcommand === "approve") {
    await approvalRespond(rest, true);
    return;
  }
  if (subcommand === "reject" || subcommand === "deny") {
    await approvalRespond(rest, false);
    return;
  }
  if (subcommand !== "list") {
    await approvalList(args);
    return;
  }
  await approvalList(rest);
}

async function approvalList(args) {
  const options = parseOptions(args, { boolean: ["json"] });
  const params = new URLSearchParams();
  params.set("status", stringOption(options.status) || "pending");
  if (options.category) params.set("category", stringOption(options.category));
  if (options.task) params.set("taskId", stringOption(options.task));
  if (options.taskId) params.set("taskId", stringOption(options.taskId));
  params.set("limit", String(numberOption(options.limit, 20)));
  const result = await requestJson(workspaceUrl(options), `/api/agent/approvals?${params.toString()}`);
  if (options.json) {
    printJson(result);
    return;
  }
  printApprovalTable(result.approvals || []);
}

async function approvalShow(args) {
  const options = parseOptions(args, { boolean: ["json"] });
  const [approvalId] = options._;
  if (!approvalId) throw new Error("Usage: aiw approvals show <approvalId>");
  const result = await requestJson(workspaceUrl(options), `/api/agent/approvals/${encodeURIComponent(approvalId)}`);
  if (options.json) {
    printJson(result);
    return;
  }
  console.log(JSON.stringify(result, null, 2));
}

async function approvalRespond(args, approved) {
  const options = parseOptions(args, { boolean: ["json", "check"] });
  const [approvalId] = options._;
  if (!approvalId) throw new Error(`Usage: aiw approvals ${approved ? "approve" : "reject"} <approvalId>`);
  const result = await requestJson(workspaceUrl(options), `/api/agent/approvals/${encodeURIComponent(approvalId)}/respond`, {
    method: "POST",
    body: {
      approved,
      reason: stringOption(options.reason) || undefined,
      runChecksAfterApply: options.check === true,
      checksApproved: options.check === true
    }
  });
  if (options.json) {
    printJson(result);
    return;
  }
  console.log(`${approved ? "Approved" : "Rejected"} approval: ${approvalId}`);
  console.log(`Status: ${result.status}`);
  if (result.result?.status) console.log(`Result: ${result.result.status}`);
}

async function listTasks(args) {
  const options = parseOptions(args, { boolean: ["json"] });
  const root = workspaceRoot(options);
  const limit = numberOption(options.limit, 20);
  const typeFilter = stringOption(options.type);
  const tasks = await readTaskFiles(root);
  const filtered = tasks
    .filter((task) => !typeFilter || task.type === typeFilter)
    .sort((a, b) => String(b.updatedAt || b.createdAt || b.id).localeCompare(String(a.updatedAt || a.createdAt || a.id)))
    .slice(0, limit);

  if (options.json) {
    printJson({ workspaceRoot: root, tasks: filtered });
    return;
  }

  if (!filtered.length) {
    console.log(`No tasks found under ${path.join(root, ".ai-workspace", "tasks")}`);
    return;
  }
  printTaskTable(filtered);
}

async function showTask(args) {
  const options = parseOptions(args, { boolean: ["json"] });
  const [taskId] = options._;
  if (!taskId) throw new Error("Usage: aiw tasks show <taskId>");
  const root = workspaceRoot(options);
  const task = await readTask(root, taskId);
  if (options.json) {
    printJson(task);
    return;
  }
  console.log(JSON.stringify(task, null, 2));
}

async function resumeTask(args) {
  const options = parseOptions(args, { boolean: ["json"] });
  const [taskId] = options._;
  if (!taskId) throw new Error("Usage: aiw tasks resume <taskId>");
  const result = await requestJson(workspaceUrl(options), `/api/agent/tasks/${encodeURIComponent(taskId)}/resume`, {
    method: "POST",
    body: {}
  });
  if (options.json) {
    printJson(result);
    return;
  }
  console.log(`Resumed task: ${taskId}`);
  console.log(`Status: ${result.status}`);
}

async function cancelTask(args) {
  const options = parseOptions(args, { boolean: ["json"] });
  const [taskId] = options._;
  if (!taskId) throw new Error("Usage: aiw tasks cancel <taskId> [--reason TEXT]");
  const result = await requestJson(workspaceUrl(options), `/api/agent/tasks/${encodeURIComponent(taskId)}/cancel`, {
    method: "POST",
    body: {
      reason: stringOption(options.reason) || undefined
    }
  });
  if (options.json) {
    printJson(result);
    return;
  }
  console.log(`Cancelled task: ${taskId}`);
  console.log(`Status: ${result.status}`);
}

async function runCode(args) {
  const [subcommand, ...rest] = args;
  if (!subcommand || subcommand === "help" || subcommand === "--help" || subcommand === "-h") {
    console.log(`Usage:
  aiw code list [--url URL] [--limit 20]
  aiw code create <scopePath> <instruction...> [--url URL]
  aiw code show <taskId> [--url URL]
  aiw code patch <taskId> --path FILE --find OLD --replace NEW [--url URL]
  aiw code patch <taskId> --changes changes.json [--url URL]
  aiw code apply <taskId> <proposalId> [--check] [--command "npm test"] [--url URL]
  aiw code reject <taskId> <proposalId> [--reason TEXT] [--url URL]
  aiw code check <taskId> [--command "npm test"] [--url URL]
`);
    return;
  }

  switch (subcommand) {
    case "list":
      await codeList(rest);
      return;
    case "create":
      await codeCreate(rest);
      return;
    case "show":
      await codeShow(rest);
      return;
    case "patch":
      await codePatch(rest);
      return;
    case "apply":
      await codeApply(rest);
      return;
    case "reject":
      await codeReject(rest);
      return;
    case "check":
    case "checks":
      await codeCheck(rest);
      return;
    default:
      throw new Error(`Unknown code subcommand '${subcommand}'. Run 'aiw code help'.`);
  }
}

async function codeList(args) {
  const options = parseOptions(args, { boolean: ["json"] });
  const limit = numberOption(options.limit, 20);
  const result = await requestJson(workspaceUrl(options), `/api/agent/tasks?type=code&limit=${encodeURIComponent(String(limit))}`);
  if (options.json) {
    printJson(result);
    return;
  }
  printTaskTable(result.tasks || []);
}

async function codeCreate(args) {
  const options = parseOptions(args, { boolean: ["json"] });
  const [scopePath, ...instructionParts] = options._;
  const instruction = stringOption(options.instruction) || instructionParts.join(" ");
  if (!scopePath || !instruction) {
    throw new Error("Usage: aiw code create <scopePath> <instruction...>");
  }
  const result = await requestJson(workspaceUrl(options), "/api/agent/code-task", {
    method: "POST",
    body: {
      scopePath,
      instruction,
      maxFiles: numberOption(options["max-files"], undefined),
      maxSearchResults: numberOption(options["max-search-results"], undefined)
    }
  });
  if (options.json) {
    printJson(result);
    return;
  }
  console.log(`Created code task: ${result.taskId}`);
  console.log(`Status: ${result.status}`);
  console.log(`Scope: ${result.scopePath}`);
  if (result.summary) console.log(`Summary: ${result.summary}`);
}

async function codeShow(args) {
  const options = parseOptions(args, { boolean: ["json"] });
  const [taskId] = options._;
  if (!taskId) throw new Error("Usage: aiw code show <taskId>");
  const result = await requestJson(workspaceUrl(options), `/api/agent/tasks/${encodeURIComponent(taskId)}`);
  if (options.json) {
    printJson(result);
    return;
  }
  console.log(JSON.stringify(result, null, 2));
}

async function codePatch(args) {
  const options = parseOptions(args, { boolean: ["json"] });
  const [taskId] = options._;
  if (!taskId) throw new Error("Usage: aiw code patch <taskId> --path FILE --find OLD --replace NEW");
  const changes = await patchChangesFromOptions(options);
  const result = await requestJson(workspaceUrl(options), `/api/agent/code-task/${encodeURIComponent(taskId)}/patches`, {
    method: "POST",
    body: { changes }
  });
  if (options.json) {
    printJson(result);
    return;
  }
  console.log(`Proposed patch: ${result.proposal?.id || "(unknown)"}`);
  console.log(`Status: ${result.status}`);
  if (result.proposal?.summary) console.log(`Summary: ${result.proposal.summary}`);
  if (result.proposal?.diffRef) console.log(`Diff: ${result.proposal.diffRef}`);
}

async function codeApply(args) {
  const options = parseOptions(args, { boolean: ["json", "check"] });
  const [taskId, proposalId] = options._;
  if (!taskId || !proposalId) throw new Error("Usage: aiw code apply <taskId> <proposalId>");
  const commands = arrayOption(options.command);
  const result = await requestJson(workspaceUrl(options), `/api/agent/code-task/${encodeURIComponent(taskId)}/patches/${encodeURIComponent(proposalId)}/apply`, {
    method: "POST",
    body: {
      approved: true,
      runChecksAfterApply: options.check === true,
      checksApproved: options.check === true,
      commands: commands.length ? commands : undefined,
      allowCustomCommands: commands.length ? true : undefined
    }
  });
  if (options.json) {
    printJson(result);
    return;
  }
  console.log(`Applied patch: ${proposalId}`);
  console.log(`Status: ${result.status}`);
  if (Array.isArray(result.filesChanged) && result.filesChanged.length) {
    console.log(`Files: ${result.filesChanged.join(", ")}`);
  }
  if (result.checkRun) {
    console.log(`Checks: ${result.checkRun.allPassed ? "passed" : "failed"}`);
    for (const item of result.checkRun.results || []) {
      console.log(`- ${item.ok ? "ok" : "fail"} ${item.command} (${item.exitCode})`);
    }
  }
}

async function codeReject(args) {
  const options = parseOptions(args, { boolean: ["json"] });
  const [taskId, proposalId] = options._;
  if (!taskId || !proposalId) throw new Error("Usage: aiw code reject <taskId> <proposalId> [--reason TEXT]");
  const result = await requestJson(workspaceUrl(options), `/api/agent/code-task/${encodeURIComponent(taskId)}/patches/${encodeURIComponent(proposalId)}/reject`, {
    method: "POST",
    body: { reason: stringOption(options.reason) || "Rejected from aiw CLI." }
  });
  if (options.json) {
    printJson(result);
    return;
  }
  console.log(`Rejected patch: ${proposalId}`);
  console.log(`Status: ${result.status}`);
}

async function codeCheck(args) {
  const options = parseOptions(args, { boolean: ["json"] });
  const [taskId] = options._;
  if (!taskId) throw new Error("Usage: aiw code check <taskId> [--command \"npm test\"]");
  const commands = arrayOption(options.command);
  const body = { approved: true };
  if (commands.length) body.commands = commands;
  const result = await requestJson(workspaceUrl(options), `/api/agent/code-task/${encodeURIComponent(taskId)}/checks`, {
    method: "POST",
    body
  });
  if (options.json) {
    printJson(result);
    return;
  }
  console.log(`Checks: ${result.allPassed ? "passed" : "failed"}`);
  for (const item of result.results || []) {
    console.log(`- ${item.ok ? "ok" : "fail"} ${item.command} (${item.exitCode})`);
  }
}

async function runIndex(args) {
  const [subcommand = "status", ...rest] = args;
  if (subcommand.startsWith("-")) {
    await indexStatus(args);
    return;
  }
  if (subcommand === "help" || subcommand === "--help" || subcommand === "-h") {
    console.log(`Usage:
  aiw index [status] [--url URL] [--json]
  aiw index rebuild [--url URL] [--json]
  aiw index search <query...> [--scope PATH] [--limit 10] [--url URL]

Current MVP index backend is the Workspace Server file metadata index plus the
workspace scan search API. docsearch/vector index providers will attach behind
this command later.
`);
    return;
  }
  if (subcommand === "rebuild") {
    await indexRebuild(rest);
    return;
  }
  if (subcommand === "search") {
    await indexSearch(rest);
    return;
  }
  if (subcommand !== "status") {
    throw new Error(`Unknown index subcommand '${subcommand}'. Run 'aiw index help'.`);
  }
  await indexStatus(rest);
}

async function indexStatus(args) {
  const options = parseOptions(args, { boolean: ["json"] });
  const result = await requestJson(workspaceUrl(options), "/api/index/status");
  if (options.json) {
    printJson(result);
    return;
  }
  console.log(`Index provider: ${result.provider || "(unknown)"}`);
  console.log(`Built at: ${result.builtAt || "(not built)"}`);
  console.log(`Items: ${result.itemCount ?? 0}`);
}

async function indexRebuild(args) {
  const options = parseOptions(args, { boolean: ["json"] });
  const result = await requestJson(workspaceUrl(options), "/api/index/rebuild", {
    method: "POST"
  });
  if (options.json) {
    printJson(result);
    return;
  }
  console.log(`Index rebuilt: ${result.itemCount ?? 0} item(s)`);
  if (result.builtAt) console.log(`Built at: ${result.builtAt}`);
}

async function indexSearch(args) {
  const options = parseOptions(args, { boolean: ["json"] });
  const query = stringOption(options.query) || options._.join(" ");
  if (!query) throw new Error("Usage: aiw index search <query...>");
  const result = await requestJson(workspaceUrl(options), "/api/search", {
    method: "POST",
    body: {
      query,
      scopePath: stringOption(options.scope) || "",
      maxResults: numberOption(options.limit, 10)
    }
  });
  if (options.json) {
    printJson(result);
    return;
  }
  console.log(`Search: ${result.query}`);
  console.log(`Provider: ${result.provider}`);
  for (const item of result.results || []) {
    console.log(`- ${item.path}: ${item.snippet || ""}`);
  }
}

async function patchChangesFromOptions(options) {
  if (options.changes) {
    const file = expandHome(String(options.changes));
    const parsed = JSON.parse(await fs.readFile(file, "utf8"));
    if (!Array.isArray(parsed)) throw new Error("--changes must point to a JSON array.");
    return parsed;
  }
  const pathValue = stringOption(options.path) || stringOption(options.file);
  if (!pathValue) throw new Error("Patch requires --path FILE or --changes changes.json.");
  if (options.find !== undefined || options.replace !== undefined) {
    return [{
      path: pathValue,
      find: String(options.find ?? ""),
      replace: String(options.replace ?? "")
    }];
  }
  if (options.content !== undefined) {
    return [{
      path: pathValue,
      operation: stringOption(options.operation) || "write",
      content: String(options.content)
    }];
  }
  throw new Error("Patch requires --find/--replace, --content, or --changes.");
}

async function readTaskFiles(root) {
  const tasksDir = path.join(root, ".ai-workspace", "tasks");
  let entries = [];
  try {
    entries = await fs.readdir(tasksDir, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const tasks = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    try {
      const text = await fs.readFile(path.join(tasksDir, entry.name), "utf8");
      tasks.push(JSON.parse(text));
    } catch {
      // Ignore malformed task files in CLI list output.
    }
  }
  return tasks;
}

async function readTask(root, taskId) {
  const file = path.join(root, ".ai-workspace", "tasks", `${taskId}.json`);
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") throw new Error(`Task not found: ${taskId}`);
    throw error;
  }
}

function printTaskTable(tasks) {
  if (!tasks.length) {
    console.log("No tasks found.");
    return;
  }
  const rows = tasks.map((task) => ({
    id: task.id || "",
    type: task.type || "",
    status: task.status || "",
    scope: task.scopePath || task.scope_path || "",
    summary: task.message || task.instruction || task.summary || ""
  }));
  printTable(rows, [
    ["id", "ID", 34],
    ["type", "TYPE", 8],
    ["status", "STATUS", 16],
    ["scope", "SCOPE", 28],
    ["summary", "SUMMARY", 58]
  ]);
}

function printApprovalTable(approvals) {
  if (!approvals.length) {
    console.log("No approvals found.");
    return;
  }
  const rows = approvals.map((approval) => ({
    id: approval.id || "",
    status: approval.status || "",
    category: approval.category || "",
    scope: approval.scopePath || "",
    summary: approval.summary || approval.proposalId || approval.taskId || ""
  }));
  printTable(rows, [
    ["id", "ID", 34],
    ["status", "STATUS", 10],
    ["category", "CATEGORY", 18],
    ["scope", "SCOPE", 28],
    ["summary", "SUMMARY", 58]
  ]);
}

function printTable(rows, columns) {
  console.log(columns.map(([, label, width]) => pad(label, width)).join("  "));
  console.log(columns.map(([, , width]) => "-".repeat(width)).join("  "));
  for (const row of rows) {
    console.log(columns.map(([key, , width]) => pad(row[key], width)).join("  "));
  }
}

function pad(value, width) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (text.length > width) return `${text.slice(0, Math.max(0, width - 1))}…`;
  return text.padEnd(width, " ");
}

async function requestJson(baseUrl, pathname, options = {}) {
  const headers = {};
  if (options.body) headers["content-type"] = "application/json";
  const token = process.env.AIW_SERVER_TOKEN || process.env.AIW_AUTH_TOKEN || "";
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(`${trimTrailingSlash(baseUrl)}${pathname}`, {
    method: options.method || "GET",
    headers: Object.keys(headers).length ? headers : undefined,
    body: options.body ? JSON.stringify(removeUndefined(options.body)) : undefined
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`Expected JSON from ${pathname}, got: ${text.slice(0, 200)}`);
  }
  if (!response.ok) {
    throw new Error(json?.error || `${response.status} ${response.statusText}`);
  }
  return json;
}

function parseOptions(args, config = {}) {
  const booleans = new Set(config.boolean || []);
  const options = { _: [] };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") {
      options._.push(...args.slice(index + 1));
      break;
    }
    if (!arg.startsWith("--")) {
      options._.push(arg);
      continue;
    }
    const raw = arg.slice(2);
    const equals = raw.indexOf("=");
    const key = equals >= 0 ? raw.slice(0, equals) : raw;
    const valueFromEquals = equals >= 0 ? raw.slice(equals + 1) : undefined;
    if (booleans.has(key)) {
      options[key] = valueFromEquals === undefined ? true : valueFromEquals !== "false";
      continue;
    }
    const value = valueFromEquals !== undefined ? valueFromEquals : args[++index];
    if (value === undefined) throw new Error(`Missing value for --${key}`);
    if (options[key] === undefined) {
      options[key] = value;
    } else if (Array.isArray(options[key])) {
      options[key].push(value);
    } else {
      options[key] = [options[key], value];
    }
  }
  return options;
}

function workspaceUrl(options) {
  return trimTrailingSlash(stringOption(options.url) || process.env.AIW_SERVER_URL || process.env.WORKSPACE_SERVER_URL || DEFAULT_SERVER_URL);
}

function workspaceRoot(options) {
  return path.resolve(expandHome(
    stringOption(options.root)
    || stringOption(options["workspace-root"])
    || process.env.AIW_WORKSPACE_ROOT
    || DEFAULT_WORKSPACE_ROOT
  ));
}

function setEnvFromOption(env, options, names, envName, transform = (value) => value) {
  for (const name of names) {
    if (options[name] !== undefined) {
      env[envName] = transform(String(options[name]));
      return;
    }
  }
}

function stringOption(value) {
  if (Array.isArray(value)) return String(value[value.length - 1]);
  if (value === undefined || value === null || value === false) return "";
  return String(value);
}

function numberOption(value, fallback) {
  if (value === undefined || value === "") return fallback;
  const number = Number.parseInt(Array.isArray(value) ? value[value.length - 1] : value, 10);
  return Number.isFinite(number) ? number : fallback;
}

function arrayOption(value) {
  if (value === undefined) return [];
  return Array.isArray(value) ? value.map(String) : [String(value)];
}

function expandHome(value) {
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
  return value;
}

function trimTrailingSlash(value) {
  return String(value).replace(/\/+$/, "");
}

function removeUndefined(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}

async function runProcess(command, args, options) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: options.stdio || "inherit"
    });
    let forwardedSignal = "";
    const forwardSignal = (signal) => {
      forwardedSignal = signal;
      if (!child.killed) child.kill(signal);
    };
    process.once("SIGINT", forwardSignal);
    process.once("SIGTERM", forwardSignal);
    const cleanup = () => {
      process.off("SIGINT", forwardSignal);
      process.off("SIGTERM", forwardSignal);
    };
    child.on("error", (error) => {
      cleanup();
      if (error.code === "ENOENT" && options.notFoundMessage) {
        reject(new Error(options.notFoundMessage));
      } else {
        reject(error);
      }
    });
    child.on("exit", (code, signal) => {
      cleanup();
      if (forwardedSignal && options.resolveOnForwardedSignal) {
        resolve();
        return;
      }
      if (signal) {
        const error = new Error(`${command} exited with signal ${signal}`);
        error.exitCode = 1;
        reject(error);
        return;
      }
      if (code) {
        const error = new Error(`${command} exited with code ${code}`);
        error.exitCode = code;
        reject(error);
        return;
      }
      resolve();
    });
  });
}

async function runModel(args) {
  const options = parseOptions(args, { boolean: ["help", "json", "refresh"] });
  const root = workspaceRoot(options);

  if (options.help) {
    printModelHelp();
    return;
  }

  // If no subcommand is specified, open interactive mode
  if (options._.length === 0) {
    if (!process.stdin.isTTY) {
      throw new Error("Interactive mode requires a TTY terminal. Run 'aiw model list' or 'aiw model set-default'.");
    }
    await runModelInteractive(root, args);
    return;
  }

  const [subcommand, ...rest] = options._;

  if (subcommand === "help" || subcommand === "--help" || subcommand === "-h") {
    printModelHelp();
    return;
  }

  if (subcommand === "set-default") {
    const [provider, model] = rest;
    if (!provider || !model) throw new Error("Usage: aiw model set-default <provider> <model>");
    const result = await setDefaultModel(root, provider, model);
    if (options.json) {
      printJson(result);
      return;
    }
    console.log(`Default model: ${result.provider}/${result.model}`);
    return;
  }

  const models = await listRuntimeModels(root);
  if (options.json) {
    printJson({ workspaceRoot: root, models });
    return;
  }
  if (subcommand === "show") {
    const active = models.find((model) => model.isActive);
    console.log(active ? `Default model: ${active.provider}/${active.model}` : "Default model: not set");
    return;
  }
  if (subcommand !== "list") throw new Error(`Unknown model subcommand '${subcommand}'.`);
  printTable(models.map((model) => ({
    active: model.isActive ? "*" : "",
    provider: model.provider,
    model: model.model || model.name,
    source: model.source
  })), [
    ["active", "", 3],
    ["provider", "PROVIDER", 18],
    ["model", "MODEL", 30],
    ["source", "SOURCE", 12]
  ]);
}

function printModelHelp() {
  console.log(`Usage:
  aiw model [--root PATH] [--json]                      (Interactive selector)
  aiw model list [--root PATH] [--json]
  aiw model show [--root PATH] [--json]
  aiw model set-default <provider> <model> [--root PATH] [--json]
`);
}

async function runModelInteractive(root, args = []) {
  await ensureRuntimeConfig(root);
  const upstreamArgs = args.filter((arg) => arg === "--refresh");
  const launch = createModelTuiLaunch({
    repoRoot: REPO_ROOT,
    workspaceRoot: root,
    args: upstreamArgs
  });
  await runProcess(launch.command, launch.args, {
    cwd: launch.cwd,
    env: launch.env,
    stdio: "inherit",
    resolveOnForwardedSignal: true,
    notFoundMessage: "AI Workspace model configuration runtime was not found."
  });
}

async function runOllama(args) {
  const options = parseOptions(args, { boolean: ["help", "serve", "json"] });
  if (options.help) {
    console.log(`Usage:
  aiw ollama [--model NAME] [--url http://127.0.0.1:11434] [--root PATH]
  aiw ollama --model gemma4:e2b-mlx --serve

This is AI Workspace's equivalent of an Ollama launch integration. The literal
\`ollama launch aiw\` command requires AI Workspace support in Ollama itself.
`);
    return;
  }

  const root = workspaceRoot(options);
  const ollamaUrl = trimTrailingSlash(stringOption(options.url) || process.env.OLLAMA_HOST || "http://127.0.0.1:11434");
  const response = await fetch(`${ollamaUrl}/api/tags`);
  if (!response.ok) throw new Error(`Ollama model discovery failed: ${response.status} ${response.statusText}`);
  const payload = await response.json();
  const models = (payload.models || []).map((item) => item.model || item.name).filter(Boolean);
  if (!models.length) throw new Error("Ollama is running, but it has no installed models.");

  let model = stringOption(options.model);
  if (model && !models.includes(model)) {
    throw new Error(`Ollama model '${model}' is not installed. Available: ${models.join(", ")}`);
  }
  if (!model) {
    if (!process.stdin.isTTY) {
      throw new Error("Choose an Ollama model with --model when stdin is not a TTY.");
    }
    const index = await interactiveSelect("Select a local Ollama model:", models, 0);
    model = models[index];
  }

  await ensureRuntimeConfig(root);
  const openAiBaseUrl = `${ollamaUrl}/v1`;
  const config = await readRuntimeConfig(root);
  await writeRuntimeConfig(root, {
    ...config,
    defaultModel: {
      provider: "ollama-local",
      model,
      baseUrl: openAiBaseUrl,
      apiMode: "chat_completions"
    }
  });

  const result = { workspaceRoot: root, provider: "ollama-local", model, baseUrl: openAiBaseUrl };
  if (options.json) printJson(result);
  else {
    console.log(`Ollama model configured: ${model}`);
    console.log(`Endpoint: ${openAiBaseUrl}`);
  }

  if (options.serve) {
    await runServe(["--root", root]);
  }
}

async function interactiveSelect(title, items, defaultIndex = 0) {
  return new Promise((resolve) => {
    let cursor = defaultIndex;
    const stdout = process.stdout;
    const stdin = process.stdin;

    const wasRaw = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.resume();
    readline.emitKeypressEvents(stdin);

    const render = () => {
      stdout.write(`\r\x1b[36m? \x1b[1m\x1b[37m${title}\x1b[0m\n`);
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (i === cursor) {
          stdout.write(`\x1b[36m> ${item}\x1b[0m\n`);
        } else {
          stdout.write(`  ${item}\n`);
        }
      }
    };

    const cleanup = () => {
      stdout.write(`\x1b[${items.length + 1}A\x1b[0J`);
      stdin.removeListener("keypress", onKeyPress);
      if (stdin.isTTY) stdin.setRawMode(wasRaw);
      stdin.pause();
    };

    const onKeyPress = (str, key) => {
      if (key.ctrl && key.name === "c") {
        cleanup();
        process.exit(130);
      }
      if (key.name === "up" || key.name === "k") {
        cursor = (cursor - 1 + items.length) % items.length;
        stdout.write(`\x1b[${items.length + 1}A\x1b[0J`);
        render();
      } else if (key.name === "down" || key.name === "j") {
        cursor = (cursor + 1) % items.length;
        stdout.write(`\x1b[${items.length + 1}A\x1b[0J`);
        render();
      } else if (key.name === "return" || key.name === "enter") {
        cleanup();
        resolve(cursor);
      }
    };

    stdin.on("keypress", onKeyPress);
    render();
  });
}

async function runProvider(args) {
  const options = parseOptions(args, { boolean: ["help", "json"] });
  const root = workspaceRoot(options);

  if (options.help) {
    console.log(`Usage:
  aiw provider [list] [--json]
`);
    return;
  }

  // If no subcommand is specified, open interactive mode
  if (options._.length === 0) {
    if (!process.stdin.isTTY) {
      throw new Error("Interactive provider manager requires a TTY terminal.");
    }
    await runProviderInteractive(root);
    return;
  }

  const [subcommand] = options._;

  if (subcommand === "list") {
    const providers = listProviderRegistry();
    if (options.json) {
      printJson(providers);
      return;
    }
    if (!providers.length) {
      console.log("No providers are registered.");
      return;
    }
    const rows = providers.map((item) => ({
      provider: item.id,
      label: item.name || item.id,
      auth: item.authType || "",
      models: (item.models || []).join(", ")
    }));
    printTable(rows, [
      ["provider", "PROVIDER", 18],
      ["label", "LABEL", 28],
      ["auth", "AUTH", 18],
      ["models", "MODELS", 36]
    ]);
  } else {
    throw new Error(`Unknown provider subcommand '${subcommand}'.`);
  }
}

async function runAuth(args) {
  const options = parseOptions(args, { boolean: ["help", "json"] });
  const root = workspaceRoot(options);

  if (options.help) {
    console.log(`Usage:
  aiw auth [list] [--root PATH] [--json]
  aiw auth set <provider> <key> <value> [--root PATH] [--json]
  aiw auth remove <provider> [key] [--root PATH] [--json]
`);
    return;
  }

  if (options._.length === 0) {
    if (!process.stdin.isTTY) {
      throw new Error("Interactive auth manager requires a TTY terminal.");
    }
    await runAuthInteractive(root);
    return;
  }

  const [subcommand, ...rest] = options._;

  if (subcommand === "set") {
    const [provider, key, ...valueParts] = rest;
    const value = valueParts.join(" ") || stringOption(options.value);
    if (!provider || !key || !value) throw new Error("Usage: aiw auth set <provider> <key> <value>");
    const result = await setCredentialValue(root, provider, key, value);
    if (options.json) {
      printJson(result);
      return;
    }
    console.log(`Stored credential: ${result.provider}/${result.key}`);
    return;
  }

  if (subcommand === "remove" || subcommand === "delete") {
    const [provider, key = ""] = rest;
    if (!provider) throw new Error(`Usage: aiw auth ${subcommand} <provider> [key]`);
    const result = await removeCredentialValue(root, provider, key);
    if (options.json) {
      printJson(result);
      return;
    }
    console.log(result.removed ? `Removed credential: ${provider}${key ? `/${key}` : ""}` : `No stored credential for ${provider}`);
    return;
  }

  if (subcommand !== "list") throw new Error(`Unknown auth subcommand '${subcommand}'.`);
  const rows = await listCredentialStatus(root, process.env);
  if (options.json) {
    printJson({ workspaceRoot: root, credentials: rows });
    return;
  }
  printTable(rows.map((row) => ({
    provider: row.provider,
    auth: row.authType,
    configured: row.configured ? "yes" : "no",
    stored: row.storedKeys.join(", "),
    env: row.envKeys.join(", ")
  })), [
    ["provider", "PROVIDER", 18],
    ["auth", "AUTH", 12],
    ["configured", "CONFIGURED", 10],
    ["stored", "STORED KEYS", 24],
    ["env", "ENV", 32]
  ]);
}

async function runSessions(args) {
  const options = parseOptions(args, { boolean: ["help", "json"] });
  const [subcommand, ...subArgs] = options._;
  const root = workspaceRoot(options);

  if (options.help || subcommand === "help") {
    console.log(`Usage:
  aiw sessions [--root PATH]
  aiw sessions list [--root PATH] [--json]
  aiw sessions rename <id> <new_title> [--root PATH]
  aiw sessions export <id> [--root PATH]
  aiw sessions prune [--root PATH]
  aiw sessions delete <id> [--root PATH]
`);
    return;
  }

  const { createWorkspaceAgentEngine } = await import("../server/lib/agent-engine.mjs");
  const engine = createWorkspaceAgentEngine({ workspaceRoot: root });

  try {
    if (subcommand === "list") {
      const result = await engine.listSessions(100);
      if (options.json) {
        printJson(result);
      } else {
        console.log(`=== Sessions ===`);
        for (const s of result.sessions) {
          console.log(`- [${s.id}] "${s.title}" (Model: ${s.model}, Updated: ${s.updatedAt})`);
        }
      }
      return;
    }

    if (subcommand === "rename") {
      const [id, title] = subArgs;
      if (!id || !title) throw new Error("Usage: aiw sessions rename <id> <new_title>");
      const res = await engine.renameSession(id, title);
      console.log(res.ok ? `Renamed session '${id}' to "${title}".` : `Error: ${res.error}`);
      return;
    }

    if (subcommand === "export") {
      const [id] = subArgs;
      if (!id) throw new Error("Usage: aiw sessions export <id>");
      const res = await engine.exportSession(id);
      if (res.ok) {
        console.log(res.markdown);
      } else {
        console.log(`Error: ${res.error}`);
      }
      return;
    }

    if (subcommand === "prune") {
      const res = await engine.pruneSessions();
      console.log(`Pruned ${res.pruned} empty sessions.`);
      return;
    }

    if (subcommand === "delete") {
      const [id] = subArgs;
      if (!id) throw new Error("Usage: aiw sessions delete <id>");
      const res = await engine.deleteSession(id);
      console.log(res.ok ? `Deleted session '${id}'.` : `Error deleting session.`);
      return;
    }

    if (!process.stdin.isTTY) {
      throw new Error("Sessions browser requires a TTY terminal.");
    }
    await runSessionsInteractive(root);
  } finally {
    engine.close();
  }
}

async function runTools(args) {
  const options = parseOptions(args, { boolean: ["help"] });
  const [subcommand, name] = options._;
  const root = workspaceRoot(options);

  if (options.help || !subcommand) {
    console.log(`Usage:
  aiw tools list [--root PATH]
  aiw tools enable <name> [--root PATH]
  aiw tools disable <name> [--root PATH]
`);
    return;
  }

  const config = await readRuntimeConfig(root);
  const disabledTools = config.disabledTools || [];

  if (subcommand === "list") {
    console.log(`=== Tool Registry ===`);
    const builtins = ["workspace_search", "workspace_read_file", "workspace_list_tree"];
    for (const b of builtins) {
      const isDisabled = disabledTools.includes(b);
      const status = isDisabled ? "\x1b[31mdisabled\x1b[0m" : "\x1b[32menabled\x1b[0m";
      console.log(`- ${b} [${status}] (Built-in)`);
    }
    for (const mcp of config.mcpServers || []) {
      const status = mcp.enabled === false ? "\x1b[31mdisabled\x1b[0m" : "\x1b[32menabled\x1b[0m";
      console.log(`- mcp_${mcp.name}_tool [${status}] (MCP Server: ${mcp.name})`);
    }
    return;
  }

  if (subcommand === "disable") {
    if (!name) throw new Error("Usage: aiw tools disable <name>");
    if (!disabledTools.includes(name)) {
      disabledTools.push(name);
      await writeRuntimeConfig(root, { ...config, disabledTools });
    }
    console.log(`Disabled tool '${name}'.`);
    return;
  }

  if (subcommand === "enable") {
    if (!name) throw new Error("Usage: aiw tools enable <name>");
    const updated = disabledTools.filter(t => t !== name);
    await writeRuntimeConfig(root, { ...config, disabledTools: updated });
    console.log(`Enabled tool '${name}'.`);
    return;
  }

  throw new Error(`Unknown tools subcommand: ${subcommand}`);
}

async function runMcp(args) {
  const options = parseOptions(args, { boolean: ["help"] });
  const [subcommand, name, command, ...argsRest] = options._;
  const root = workspaceRoot(options);

  if (options.help || !subcommand) {
    console.log(`Usage:
  aiw mcp list [--root PATH]
  aiw mcp add <name> <command> [args...] [--root PATH]
  aiw mcp remove <name> [--root PATH]
  aiw mcp enable <name> [--root PATH]
  aiw mcp disable <name> [--root PATH]
`);
    return;
  }

  const config = await readRuntimeConfig(root);
  const mcpServers = config.mcpServers || [];

  if (subcommand === "list") {
    console.log(`=== MCP Servers ===`);
    if (mcpServers.length === 0) {
      console.log("(No registered MCP servers)");
    } else {
      for (const mcp of mcpServers) {
        const status = mcp.enabled !== false ? "\x1b[32menabled\x1b[0m" : "\x1b[31mdisabled\x1b[0m";
        console.log(`- ${mcp.name} [${status}] (${mcp.command} ${mcp.args?.join(" ") || ""})`);
      }
    }
    return;
  }

  if (subcommand === "add") {
    if (!name || !command) throw new Error("Usage: aiw mcp add <name> <command> [args...]");
    if (mcpServers.some(s => s.name === name)) {
      throw new Error(`MCP server with name '${name}' already exists.`);
    }
    mcpServers.push({
      name,
      command,
      args: argsRest,
      enabled: true
    });
    await writeRuntimeConfig(root, { ...config, mcpServers });
    console.log(`Registered MCP server '${name}'.`);
    return;
  }

  if (subcommand === "remove") {
    if (!name) throw new Error("Usage: aiw mcp remove <name>");
    const filtered = mcpServers.filter(s => s.name !== name);
    await writeRuntimeConfig(root, { ...config, mcpServers: filtered });
    console.log(`Removed MCP server '${name}'.`);
    return;
  }

  if (subcommand === "enable") {
    if (!name) throw new Error("Usage: aiw mcp enable <name>");
    const mcp = mcpServers.find(s => s.name === name);
    if (!mcp) throw new Error(`MCP server '${name}' not found.`);
    mcp.enabled = true;
    await writeRuntimeConfig(root, { ...config, mcpServers });
    console.log(`Enabled MCP server '${name}'.`);
    return;
  }

  if (subcommand === "disable") {
    if (!name) throw new Error("Usage: aiw mcp disable <name>");
    const mcp = mcpServers.find(s => s.name === name);
    if (!mcp) throw new Error(`MCP server '${name}' not found.`);
    mcp.enabled = false;
    await writeRuntimeConfig(root, { ...config, mcpServers });
    console.log(`Disabled MCP server '${name}'.`);
    return;
  }

  throw new Error(`Unknown mcp subcommand: ${subcommand}`);
}

async function runDoctor(args) {
  const options = parseOptions(args, { boolean: ["help", "deep"] });
  const root = workspaceRoot(options);

  console.log(`\x1b[36m=== AI Workspace Diagnostics (aiw doctor) ===\x1b[0m\n`);

  console.log(`1. Workspace Root:`);
  try {
    const stat = await fs.stat(root);
    if (stat.isDirectory()) {
      console.log(`   \x1b[32m[OK]\x1b[0m Root directory exists: ${root}`);
    } else {
      console.log(`   \x1b[31m[ERROR]\x1b[0m Path is not a directory: ${root}`);
    }
  } catch {
    console.log(`   \x1b[31m[ERROR]\x1b[0m Workspace root does not exist or is not readable.`);
  }

  console.log(`\n2. Configuration & Credentials Store:`);
  const configPath = path.join(root, ".ai-workspace", "config", "config.yaml");
  const authPath = path.join(root, ".ai-workspace", "config", "auth.json");
  let hasConfig = false;
  let hasAuth = false;

  try {
    await fs.access(configPath);
    console.log(`   \x1b[32m[OK]\x1b[0m config.yaml is accessible.`);
    hasConfig = true;
  } catch {
    console.log(`   \x1b[33m[WARNING]\x1b[0m config.yaml missing or inaccessible.`);
  }

  try {
    await fs.access(authPath);
    console.log(`   \x1b[32m[OK]\x1b[0m auth.json is accessible.`);
    hasAuth = true;
  } catch {
    console.log(`   \x1b[33m[WARNING]\x1b[0m auth.json missing or inaccessible.`);
  }

  console.log(`\n3. Default Model Configuration:`);
  let activeProvider = null;
  let activeModel = null;
  if (hasConfig) {
    try {
      const config = await readRuntimeConfig(root);
      if (config.defaultModel?.provider && config.defaultModel?.model) {
        activeProvider = config.defaultModel.provider;
        activeModel = config.defaultModel.model;
        console.log(`   \x1b[32m[OK]\x1b[0m Default provider: \x1b[36m${activeProvider}\x1b[0m`);
        console.log(`   \x1b[32m[OK]\x1b[0m Default model: \x1b[36m${activeModel}\x1b[0m`);
        if (config.fallbackChain?.length) {
          console.log(`   \x1b[32m[OK]\x1b[0m Fallback chain: ${config.fallbackChain.join(" -> ")}`);
        } else {
          console.log(`   [INFO] No fallback chain configured.`);
        }
      } else {
        console.log(`   \x1b[33m[WARNING]\x1b[0m No default model or provider selected.`);
      }
    } catch (err) {
      console.log(`   \x1b[31m[ERROR]\x1b[0m Failed to parse runtime config: ${err.message}`);
    }
  }

  console.log(`\n4. Active Credentials Status:`);
  try {
    const statuses = await listCredentialStatus(root);
    let configuredCount = 0;
    for (const stat of statuses) {
      if (stat.configured) {
        configuredCount++;
        console.log(`   - Provider \x1b[36m${stat.provider}\x1b[0m: \x1b[32mCONFIGURED\x1b[0m (Stored keys: ${stat.storedKeys.join(", ") || "none"}, Env: ${stat.envKeys.join(", ") || "none"})`);
      }
    }
    if (configuredCount === 0) {
      console.log(`   \x1b[33m[WARNING]\x1b[0m No credentials configured for any provider.`);
    }
  } catch (err) {
    console.log(`   \x1b[31m[ERROR]\x1b[0m Failed to retrieve credentials status: ${err.message}`);
  }

  console.log(`\n5. Runtime Tool Registry & Toggles:`);
  try {
    const config = await readRuntimeConfig(root);
    const disabled = new Set(config.disabledTools || []);
    const builtins = ["workspace_search", "workspace_read_file", "workspace_list_tree"];
    for (const b of builtins) {
      const status = disabled.has(b) ? "\x1b[31mDISABLED\x1b[0m" : "\x1b[32mACTIVE\x1b[0m";
      console.log(`   - Tool \x1b[36m${b}\x1b[0m: ${status}`);
    }
  } catch (err) {
    console.log(`   \x1b[31m[ERROR]\x1b[0m Failed to read tools config: ${err.message}`);
  }

  console.log(`\n6. Model Context Protocol (MCP) Servers:`);
  try {
    const config = await readRuntimeConfig(root);
    if (config.mcpServers?.length) {
      for (const mcp of config.mcpServers) {
        const { executableExists } = await import("../server/lib/runtime/mcp-client.mjs");
        const exists = await executableExists(mcp.command);
        const existsStr = exists ? "\x1b[32mfound\x1b[0m" : "\x1b[31mnot found\x1b[0m";
        const status = mcp.enabled !== false ? "\x1b[32mENABLED\x1b[0m" : "\x1b[31mDISABLED\x1b[0m";
        console.log(`   - MCP Server \x1b[36m${mcp.name}\x1b[0m: ${status} (Command: ${mcp.command} [${existsStr}])`);
      }
    } else {
      console.log(`   [INFO] No MCP servers registered.`);
    }
  } catch (err) {
    console.log(`   \x1b[31m[ERROR]\x1b[0m Failed to read MCP registry: ${err.message}`);
  }

  console.log(`\n7. Skills & Plugins:`);
  try {
    const { listSkills } = await import("../server/lib/runtime/skill-registry.mjs");
    const skills = await listSkills(root);
    console.log(`   - Total skills found: ${skills.length}`);
    for (const skill of skills) {
      const status = skill.config.enabled ? "\x1b[32mENABLED\x1b[0m" : "\x1b[31mDISABLED\x1b[0m";
      console.log(`   - Skill \x1b[36m${skill.name}\x1b[0m: ${status} (Triggers: ${skill.config.triggers?.join(", ") || "none"})`);
    }
  } catch (err) {
    console.log(`   \x1b[31m[ERROR]\x1b[0m Failed to parse skills: ${err.message}`);
  }

  console.log(`\n8. Hooks & Security Policy:`);
  try {
    const { readSecurityConfig } = await import("../server/lib/runtime/security-policy.mjs");
    const sec = await readSecurityConfig(root);
    console.log(`   - Approval Mode: \x1b[36m${sec.approvalMode}\x1b[0m`);
    console.log(`   - Allow Shell Commands: ${sec.allowShell ? "\x1b[32myes\x1b[0m" : "\x1b[31mno\x1b[0m"}`);
    if (sec.deniedCommands.length > 0) {
      console.log(`   - \x1b[33m[INFO]\x1b[0m ${sec.deniedCommands.length} denied command patterns configured.`);
    }
  } catch (err) {
    console.log(`   \x1b[31m[ERROR]\x1b[0m Failed to read security policy: ${err.message}`);
  }

  console.log(`\n9. Local Server Connection:`);
  const baseUrl = workspaceUrl(options);
  try {
    const health = await requestJson(baseUrl, "/api/health");
    if (health?.ok) {
      console.log(`   \x1b[32m[OK]\x1b[0m Successfully connected to server at: ${baseUrl}`);
    } else {
      console.log(`   \x1b[33m[WARNING]\x1b[0m Server returned non-ok health: ${JSON.stringify(health)}`);
    }
  } catch {
    console.log(`   \x1b[33m[WARNING]\x1b[0m Server at ${baseUrl} is not currently running.`);
  }

  if (options.deep) {
    console.log(`\n10. Deep MCP Verification (--deep):`);
    try {
      const config = await readRuntimeConfig(root);
      if (config.mcpServers?.length) {
        const { McpClient } = await import("../server/lib/runtime/mcp-client.mjs");
        for (const mcp of config.mcpServers) {
          if (mcp.enabled === false) {
            console.log(`   - MCP Server \x1b[36m${mcp.name}\x1b[0m is disabled, skipping deep verification.`);
            continue;
          }
          console.log(`   - Testing MCP Server \x1b[36m${mcp.name}\x1b[0m...`);
          const client = new McpClient(mcp.name, mcp.command, mcp.args || [], { workspaceRoot: root });
          try {
            await client.start();
            const toolsList = await client.listTools();
            console.log(`     \x1b[32m[OK]\x1b[0m Successfully initialized and listed ${toolsList.length} tools.`);
          } catch (err) {
            console.log(`     \x1b[31m[ERROR]\x1b[0m Deep verification failed: ${err.message}`);
          } finally {
            try { client.stop(); } catch {}
          }
        }
      } else {
        console.log(`   [INFO] No MCP servers registered.`);
      }
    } catch (err) {
      console.log(`   \x1b[31m[ERROR]\x1b[0m Deep verification error: ${err.message}`);
    }
  }

  console.log(`\n\x1b[36m=== Diagnostics Complete ===\x1b[0m\n`);
}

async function runConfig(args) {
  const options = parseOptions(args, { boolean: ["help", "json"] });
  const [subcommand] = options._;
  const root = workspaceRoot(options);
  const configPath = path.join(root, ".ai-workspace", "config", "config.yaml");

  if (options.help || subcommand === "help" || subcommand === "--help" || subcommand === "-h") {
    console.log(`Usage:
  aiw config [--root PATH]
  aiw config edit [--root PATH]
`);
    return;
  }

  if (subcommand === "edit") {
    const editor = process.env.EDITOR || "vi";
    try {
      await fs.access(configPath);
    } catch {
      await ensureRuntimeConfig(root);
    }
    await runProcess(editor, [configPath], {
      cwd: root,
      stdio: "inherit",
      resolveOnForwardedSignal: true
    });
    return;
  }

  try {
    const content = await fs.readFile(configPath, "utf8");
    console.log(`\x1b[36m=== Current Workspace Configuration ===\x1b[0m`);
    console.log(content);
  } catch (error) {
    console.log("No configuration file found. Run 'aiw model' to configure.");
  }
}

async function runChatInteractive(root) {
  const config = await readRuntimeConfig(root);
  if (!config.defaultModel?.provider || !config.defaultModel?.model) {
    console.log("No default model is configured.");
    console.log("Please run 'aiw model' to configure a default model first.");
    return;
  }

  const { createWorkspaceAgentEngine } = await import("../server/lib/agent-engine.mjs");
  const engine = createWorkspaceAgentEngine({ workspaceRoot: root });

  console.log(`\x1b[36mConnecting to AI Workspace runtime...\x1b[0m`);
  try {
    await engine.connect();
  } catch (error) {
    console.error(`Failed to connect to runtime: ${error.message}`);
    engine.close();
    return;
  }

  console.log(`\x1b[32mChat session started with ${config.defaultModel.provider}/${config.defaultModel.model}.\x1b[0m`);
  console.log(`Type your message and press Enter. Type 'exit' or 'quit' to end the session.\n`);

  const sessionResult = await engine.createSession({
    provider: config.defaultModel.provider,
    model: config.defaultModel.model,
    title: `CLI Chat ${new Date().toLocaleDateString()}`
  });
  const sessionId = sessionResult.sessionId;

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "\x1b[36mYou: \x1b[0m"
  });

  rl.prompt();

  const onEvent = (event) => {
    if (event.sessionId === sessionId && event.type === "message.delta" && event.text) {
      process.stdout.write(event.text);
    }
  };
  engine.on("event", onEvent);

  for await (const line of rl) {
    const input = line.trim();
    if (!input) {
      rl.prompt();
      continue;
    }
    if (input.toLowerCase() === "exit" || input.toLowerCase() === "quit") {
      break;
    }

    process.stdout.write("\x1b[33mAgent:\x1b[0m ");
    try {
      await engine.submitPrompt({
        sessionId,
        message: input,
        provider: config.defaultModel.provider,
        model: config.defaultModel.model,
        wait: true
      });
    } catch (error) {
      console.error(`\n\x1b[31mError: ${error.message}\x1b[0m`);
    }
    process.stdout.write("\n\n");
    rl.prompt();
  }

  rl.close();
  engine.off("event", onEvent);
  engine.close();
  console.log("\nChat session closed.");
}

async function runAuthInteractive(root) {
  const options = [
    "View credentials (auth list)",
    "Set a credential (auth set)",
    "Remove a credential (auth remove)",
    "Exit"
  ];
  for (;;) {
    const choice = await interactiveSelect("Authentication Manager", options);
    if (choice === 0) {
      await runAuth(["list", "--root", root]);
      console.log("\nPress Enter to continue...");
      await waitForEnter();
    } else if (choice === 1) {
      const providers = listProviderRegistry();
      const providerItems = providers.map((p) => `${p.name} (${p.id})`);
      const providerIndex = await interactiveSelect("Select a provider to authenticate:", providerItems);
      const selected = providers[providerIndex];

      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });

      if (selected.id === "custom") {
        rl.close();
        const customKeys = ["AIW_CUSTOM_BASE_URL", "AIW_CUSTOM_API_KEY"];
        const keyIndex = await interactiveSelect("Select credential key to set:", customKeys);
        const key = customKeys[keyIndex];

        const valRl = readline.createInterface({ input: process.stdin, output: process.stdout });
        const val = await new Promise((resolve) => {
          valRl.question(`Enter value for ${key}: `, (ans) => {
            valRl.close();
            resolve(ans.trim());
          });
        });
        if (val) {
          await setCredentialValue(root, "custom", key, val);
          console.log(`Stored credential: custom/${key}\n`);
        }
      } else {
        const key = selected.env?.[0] || "API_KEY";
        const val = await new Promise((resolve) => {
          rl.question(`Enter API Key / Token for ${selected.name} (${key}): `, (ans) => {
            rl.close();
            resolve(ans.trim());
          });
        });
        if (val) {
          await setCredentialValue(root, selected.id, key, val);
          console.log(`Stored credential: ${selected.id}/${key}\n`);
        }
      }
    } else if (choice === 2) {
      const providers = listProviderRegistry();
      const providerItems = providers.map((p) => `${p.name} (${p.id})`);
      const providerIndex = await interactiveSelect("Select a provider to remove credentials:", providerItems);
      const selected = providers[providerIndex];

      await removeCredentialValue(root, selected.id);
      console.log(`Removed credentials for ${selected.id}\n`);
    } else {
      break;
    }
  }
}

async function runProviderInteractive(root) {
  const options = [
    "List providers (provider list)",
    "Configure a custom provider",
    "Remove custom provider",
    "Exit"
  ];
  for (;;) {
    const choice = await interactiveSelect("Provider Manager", options);
    if (choice === 0) {
      await runProvider(["list"]);
      console.log("\nPress Enter to continue...");
      await waitForEnter();
    } else if (choice === 1) {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });
      const name = await new Promise((resolve) => {
        rl.question("Enter custom provider name (default: custom): ", (ans) => resolve(ans.trim() || "custom"));
      });
      const baseUrl = await new Promise((resolve) => {
        rl.question("Enter custom provider base URL: ", (ans) => resolve(ans.trim()));
      });
      const apiKey = await new Promise((resolve) => {
        rl.question("Enter custom provider API Key (optional): ", (ans) => resolve(ans.trim()));
      });
      rl.close();

      if (!baseUrl) {
        console.log("Base URL is required. Aborted.\n");
        continue;
      }

      await setCredentialValue(root, "custom", "AIW_CUSTOM_BASE_URL", baseUrl);
      if (apiKey) {
        await setCredentialValue(root, "custom", "AIW_CUSTOM_API_KEY", apiKey);
      }
      console.log(`Configured custom provider: ${name}\n`);
    } else if (choice === 2) {
      await removeCredentialValue(root, "custom");
      console.log("Removed custom provider configuration.\n");
    } else {
      break;
    }
  }
}

async function runSessionsInteractive(root) {
  const dirPath = path.join(root, ".ai-workspace", "sessions");
  for (;;) {
    let files = [];
    try {
      files = await fs.readdir(dirPath);
    } catch {}

    const sessionFiles = files.filter((f) => f.endsWith(".json"));
    const sessions = [];
    for (const file of sessionFiles) {
      try {
        const data = JSON.parse(await fs.readFile(path.join(dirPath, file), "utf8"));
        sessions.push(data);
      } catch {}
    }

    sessions.sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));

    const options = [
      "Create a new chat session",
      "Prune empty sessions",
      ...sessions.map((s) => `${s.title} (${s.model || "unknown"}) - ${new Date(s.updatedAt).toLocaleString()}`),
      "Exit"
    ];

    const choice = await interactiveSelect("Session Browser", options);
    if (choice === 0) {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const title = await new Promise((resolve) => {
        rl.question("Enter session title (optional): ", (ans) => {
          rl.close();
          resolve(ans.trim());
        });
      });
      const config = await readRuntimeConfig(root);
      const sessionId = `session-${new Date().toISOString().replace(/[:.]/g, "-")}-${crypto.randomUUID()}`;
      const sessionObj = {
        id: sessionId,
        title: title || `Session ${new Date().toLocaleDateString()}`,
        model: config.defaultModel?.model || "unknown",
        preview: "",
        updatedAt: new Date().toISOString(),
        source: "workspace",
        runtime: "chat-runtime",
        isActive: true,
        messages: []
      };
      await fs.mkdir(dirPath, { recursive: true });
      await fs.writeFile(path.join(dirPath, `${sessionId}.json`), JSON.stringify(sessionObj, null, 2) + "\n", "utf8");
      console.log(`Created new session: ${sessionObj.title}\n`);
    } else if (choice === 1) {
      let count = 0;
      for (const s of sessions) {
        if (!s.messages || s.messages.length === 0) {
          try {
            await fs.unlink(path.join(dirPath, `${s.id}.json`));
            count++;
          } catch {}
        }
      }
      console.log(`Pruned ${count} empty sessions.\n`);
      console.log("Press Enter to continue...");
      await waitForEnter();
    } else if (choice === options.length - 1) {
      break;
    } else {
      const selectedSession = sessions[choice - 2];
      const sessionOptions = [
        "View messages",
        "Rename session",
        "Export session",
        "Delete session",
        "Back to sessions list"
      ];
      const action = await interactiveSelect(selectedSession.title, sessionOptions);
      if (action === 0) {
        console.log(`\n=== Messages for: ${selectedSession.title} ===`);
        const messages = selectedSession.messages || [];
        if (messages.length === 0) {
          console.log("(No messages in this session yet)");
        } else {
          for (const msg of messages) {
            const roleLabel = msg.role === "user" ? "\x1b[36mYou\x1b[0m" : "\x1b[33mAgent\x1b[0m";
            console.log(`[${roleLabel}]: ${msg.content}`);
          }
        }
        console.log("\nPress Enter to continue...");
        await waitForEnter();
      } else if (action === 1) {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        const newTitle = await new Promise((resolve) => {
          rl.question("Enter new title: ", (ans) => {
            rl.close();
            resolve(ans.trim());
          });
        });
        if (newTitle) {
          selectedSession.title = newTitle;
          selectedSession.updatedAt = new Date().toISOString();
          await fs.writeFile(path.join(dirPath, `${selectedSession.id}.json`), JSON.stringify(selectedSession, null, 2) + "\n", "utf8");
          console.log(`Renamed to "${newTitle}".\n`);
        }
      } else if (action === 2) {
        const lines = [
          `# Session: ${selectedSession.title}`,
          `Model: ${selectedSession.model || "unknown"}`,
          `Updated: ${selectedSession.updatedAt}`,
          ""
        ];
        for (const m of selectedSession.messages || []) {
          lines.push(`## ${m.role.toUpperCase()}`);
          lines.push(m.content || "");
          lines.push("");
        }
        const exportPath = path.join(root, `session-export-${selectedSession.id}.md`);
        await fs.writeFile(exportPath, lines.join("\n"), "utf8");
        console.log(`Exported session to: ${exportPath}\n`);
        console.log("Press Enter to continue...");
        await waitForEnter();
      } else if (action === 3) {
        try {
          await fs.unlink(path.join(dirPath, `${selectedSession.id}.json`));
          console.log("Session deleted.\n");
        } catch (err) {
          console.log(`Failed to delete session: ${err.message}\n`);
        }
      }
    }
  }
}

function waitForEnter() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.on("line", () => {
      rl.close();
      resolve();
    });
  });
}

async function runSkills(args) {
  const options = parseOptions(args, { boolean: ["help"] });
  const [subcommand, name, argValue] = options._;
  const root = workspaceRoot(options);

  if (options.help || !subcommand) {
    console.log(`Usage:
  aiw skills list [--root PATH]
  aiw skills show <name> [--root PATH]
  aiw skills enable <name> [--root PATH]
  aiw skills disable <name> [--root PATH]
  aiw skills add <path> [--root PATH]
  aiw skills remove <name> [--root PATH]
`);
    return;
  }

  const { listSkills, readSkill, enableSkill, addSkill, removeSkill } = await import("../server/lib/runtime/skill-registry.mjs");

  if (subcommand === "list") {
    console.log("=== Workspace Skills ===");
    const list = await listSkills(root);
    if (list.length === 0) {
      console.log("(No registered skills)");
    } else {
      for (const skill of list) {
        const status = skill.config.enabled ? "\x1b[32menabled\x1b[0m" : "\x1b[31mdisabled\x1b[0m";
        console.log(`- ${skill.name} [${status}] (triggers: ${skill.config.triggers?.join(", ") || "none"})`);
      }
    }
    return;
  }

  if (subcommand === "show") {
    if (!name) throw new Error("Usage: aiw skills show <name>");
    const skill = await readSkill(root, name);
    console.log(`=== Skill: ${skill.name} ===`);
    console.log(`Status: ${skill.config.enabled ? "Enabled" : "Disabled"}`);
    console.log(`Triggers: ${skill.config.triggers?.join(", ") || "None"}`);
    console.log(`Task Types: ${skill.config.taskTypes?.join(", ") || "None"}`);
    console.log("\n--- Instructions (skill.md) ---");
    console.log(skill.skillMd || "(Empty)");
    return;
  }

  if (subcommand === "enable") {
    if (!name) throw new Error("Usage: aiw skills enable <name>");
    await enableSkill(root, name, true);
    console.log(`Enabled skill '${name}'.`);
    return;
  }

  if (subcommand === "disable") {
    if (!name) throw new Error("Usage: aiw skills disable <name>");
    await enableSkill(root, name, false);
    console.log(`Disabled skill '${name}'.`);
    return;
  }

  if (subcommand === "add") {
    const srcPath = name;
    if (!srcPath) throw new Error("Usage: aiw skills add <path>");
    const skill = await addSkill(root, srcPath);
    console.log(`Added skill '${skill.name}' from ${srcPath}.`);
    return;
  }

  if (subcommand === "remove") {
    if (!name) throw new Error("Usage: aiw skills remove <name>");
    await removeSkill(root, name);
    console.log(`Removed skill '${name}'.`);
    return;
  }

  throw new Error(`Unknown skills subcommand: ${subcommand}`);
}

async function runSecurity(args) {
  const options = parseOptions(args, { boolean: ["help"] });
  const [subcommand, arg1, ...argsRest] = options._;
  const root = workspaceRoot(options);

  if (options.help || !subcommand) {
    console.log(`Usage:
  aiw security show [--root PATH]
  aiw security set-approval-mode <suggest|auto|manual|off> [--root PATH]
  aiw security allow-command <command> [--root PATH]
  aiw security deny-command <command> [--root PATH]
  aiw security list [--root PATH]
`);
    return;
  }

  const { readSecurityConfig, writeSecurityConfig } = await import("../server/lib/runtime/security-policy.mjs");
  const config = await readSecurityConfig(root);

  if (subcommand === "show" || subcommand === "list") {
    console.log("=== Security Policy ===");
    console.log(`Approval Mode: \x1b[36m${config.approvalMode}\x1b[0m`);
    console.log(`Allow Shell: ${config.allowShell ? "\x1b[32myes\x1b[0m" : "\x1b[31mno\x1b[0m"}`);
    console.log("\nAllowed Commands:");
    if (config.allowedCommands.length === 0) {
      console.log("  (None)");
    } else {
      config.allowedCommands.forEach(cmd => console.log(`  - ${cmd}`));
    }
    console.log("\nDenied Commands:");
    if (config.deniedCommands.length === 0) {
      console.log("  (None)");
    } else {
      config.deniedCommands.forEach(cmd => console.log(`  - ${cmd}`));
    }
    console.log("\nRequire Approval Actions:");
    if (config.requireApproval.length === 0) {
      console.log("  (None)");
    } else {
      config.requireApproval.forEach(act => console.log(`  - ${act}`));
    }
    return;
  }

  if (subcommand === "set-approval-mode") {
    if (!arg1) throw new Error("Usage: aiw security set-approval-mode <suggest|auto|manual|off>");
    const validModes = ["suggest", "auto", "manual", "off"];
    if (!validModes.includes(arg1)) {
      throw new Error(`Invalid approval mode. Choose from: ${validModes.join(", ")}`);
    }
    config.approvalMode = arg1;
    await writeSecurityConfig(root, config);
    console.log(`Set approval mode to '${arg1}'.`);
    return;
  }

  if (subcommand === "allow-command") {
    const cmd = [arg1, ...argsRest].join(" ").trim();
    if (!cmd) throw new Error("Usage: aiw security allow-command <command>");
    if (!config.allowedCommands.includes(cmd)) {
      config.allowedCommands.push(cmd);
      await writeSecurityConfig(root, config);
    }
    console.log(`Allowed command: '${cmd}'`);
    return;
  }

  if (subcommand === "deny-command") {
    const cmd = [arg1, ...argsRest].join(" ").trim();
    if (!cmd) throw new Error("Usage: aiw security deny-command <command>");
    if (!config.deniedCommands.includes(cmd)) {
      config.deniedCommands.push(cmd);
      await writeSecurityConfig(root, config);
    }
    console.log(`Denied command: '${cmd}'`);
    return;
  }

  throw new Error(`Unknown security subcommand: ${subcommand}`);
}
