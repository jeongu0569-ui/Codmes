import { spawn } from "node:child_process";
import readline from "node:readline";
import path from "node:path";
import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import os from "node:os";

export function validateCommand(command) {
  if (!command || typeof command !== "string") {
    throw new Error("MCP command must be a non-empty string.");
  }
  const dangerousChars = /[;&|`$\n\r()<>]/;
  if (dangerousChars.test(command)) {
    throw new Error(`MCP command '${command}' contains illegal characters.`);
  }
}

export async function executableExists(command) {
  try {
    validateCommand(command);
  } catch {
    return false;
  }

  if (command.includes(path.sep) || (os.platform() === "win32" && command.includes("/"))) {
    try {
      await fs.access(command, fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }

  const pathEnv = process.env.PATH || "";
  const pathDirs = pathEnv.split(os.platform() === "win32" ? ";" : ":");
  const extensions = os.platform() === "win32" ? [".exe", ".cmd", ".bat", ".ps1", ""] : [""];

  for (const dir of pathDirs) {
    for (const ext of extensions) {
      const fullPath = path.join(dir, command + ext);
      try {
        await fs.access(fullPath, fs.constants.X_OK);
        return true;
      } catch {
        // Continue
      }
    }
  }
  return false;
}

export class McpClient {
  constructor(name, command, args = [], { workspaceRoot, idleTimeoutMs = 60000, logger = console } = {}) {
    this.name = name;
    this.command = command;
    this.args = args;
    this.workspaceRoot = workspaceRoot;
    this.idleTimeoutMs = idleTimeoutMs;
    this.logger = logger;
    this.child = null;
    this.rl = null;
    this.stderrStream = null;
    this.pendingRequests = new Map();
    this.requestId = 0;
    this.status = "stopped"; // stopped, starting, running, error
    this.tools = [];
    this.idleTimer = null;
  }

  resetIdleTimer() {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    if (this.status === "running" && this.pendingRequests.size === 0 && this.idleTimeoutMs > 0) {
      this.idleTimer = setTimeout(() => {
        if (this.logger) {
          this.logger.log(`[MCP:${this.name}] Idle timeout reached. Stopping server.`);
        }
        this.stop();
      }, this.idleTimeoutMs);
    }
  }

  async start() {
    if (this.status === "running" || this.status === "starting") {
      return;
    }
    this.status = "starting";

    // Validate command security
    validateCommand(this.command);

    // Setup stderr file redirect if workspaceRoot is available
    if (this.workspaceRoot) {
      try {
        const logDir = path.join(this.workspaceRoot, ".ai-workspace", "tool-logs");
        await fs.mkdir(logDir, { recursive: true });
        const logPath = path.join(logDir, `mcp-${this.name}.stderr.log`);
        this.stderrStream = createWriteStream(logPath, { flags: "a" });
      } catch (err) {
        if (this.logger) {
          this.logger.error(`[MCP:${this.name}] Failed to open stderr log file: ${err.message}`);
        }
      }
    }

    try {
      this.child = spawn(this.command, this.args || [], {
        env: { ...process.env },
        stdio: ["pipe", "pipe", "pipe"]
      });
    } catch (err) {
      this.status = "error";
      if (this.stderrStream) {
        this.stderrStream.end();
        this.stderrStream = null;
      }
      throw new Error(`Failed to spawn MCP server '${this.name}': ${err.message}`);
    }

    this.child.on("error", (err) => {
      this.status = "error";
      this.rejectAllPending(err);
    });

    this.rl = readline.createInterface({
      input: this.child.stdout,
      terminal: false
    });

    this.rl.on("line", (line) => {
      this.handleLine(line);
    });

    this.child.stderr.on("data", (chunk) => {
      const msg = chunk.toString().trim();
      if (this.stderrStream) {
        this.stderrStream.write(chunk);
      }
      if (msg && this.logger) {
        this.logger.error(`[MCP:${this.name}] stderr: ${msg}`);
      }
    });

    this.child.on("exit", (code, signal) => {
      this.status = "stopped";
      this.rejectAllPending(new Error(`MCP server '${this.name}' exited with code ${code}, signal ${signal}`));
    });

    // Run initialize protocol handshake
    try {
      await this.sendRequest("initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "ai-workspace-client", version: "1.0.0" }
      });
      this.status = "running";
      this.sendNotification("notifications/initialized");
      this.resetIdleTimer();
    } catch (err) {
      this.status = "error";
      this.stop();
      throw err;
    }
  }

  async listTools() {
    if (this.status !== "running") {
      await this.start();
    }
    const result = await this.sendRequest("tools/list", {});
    this.tools = result.tools || [];
    return this.tools;
  }

  async callTool(name, argumentsObj) {
    if (this.status !== "running") {
      await this.start();
    }
    const result = await this.sendRequest("tools/call", {
      name,
      arguments: argumentsObj
    });
    return result;
  }

  sendRequest(method, params = {}, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      if (this.idleTimer) {
        clearTimeout(this.idleTimer);
        this.idleTimer = null;
      }
      if (!this.child || !this.child.stdin || this.child.stdin.destroyed) {
        return reject(new Error(`MCP server '${this.name}' is not running.`));
      }
      const id = ++this.requestId;
      const msg = {
        jsonrpc: "2.0",
        id,
        method,
        params
      };

      let timer = null;
      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          this.pendingRequests.delete(id);
          reject(Object.assign(new Error(`MCP request ${method} (id: ${id}) timed out after ${timeoutMs}ms`), { code: "TIMEOUT" }));
          this.resetIdleTimer();
        }, timeoutMs);
      }

      this.pendingRequests.set(id, { resolve, reject, timer });
      try {
        this.child.stdin.write(JSON.stringify(msg) + "\n");
      } catch (err) {
        if (timer) clearTimeout(timer);
        this.pendingRequests.delete(id);
        reject(err);
        this.resetIdleTimer();
      }
    });
  }

  sendNotification(method, params = {}) {
    if (!this.child || !this.child.stdin || this.child.stdin.destroyed) {
      return;
    }
    const msg = {
      jsonrpc: "2.0",
      method,
      params
    };
    try {
      this.child.stdin.write(JSON.stringify(msg) + "\n");
    } catch (err) {
      if (this.logger) {
        this.logger.error(`Failed to send notification ${method}: ${err.message}`);
      }
    }
  }

  handleLine(line) {
    if (!line.trim()) return;
    try {
      const msg = JSON.parse(line);
      if (msg.id !== undefined && msg.id !== null) {
        const pending = this.pendingRequests.get(msg.id);
        if (pending) {
          this.pendingRequests.delete(msg.id);
          if (pending.timer) clearTimeout(pending.timer);
          if (msg.error) {
            pending.reject(Object.assign(new Error(msg.error.message || "MCP error"), { code: msg.error.code }));
          } else {
            pending.resolve(msg.result);
          }
          this.resetIdleTimer();
        }
      }
    } catch (err) {
      if (this.logger) {
        this.logger.error(`[MCP:${this.name}] Failed to parse line as JSON: ${line}`);
      }
    }
  }

  rejectAllPending(error) {
    for (const [id, pending] of this.pendingRequests.entries()) {
      if (pending.timer) clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pendingRequests.clear();
  }

  stop() {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    this.rejectAllPending(new Error(`MCP server '${this.name}' stopped.`));
    if (this.rl) {
      try {
        this.rl.close();
      } catch {}
      this.rl = null;
    }
    if (this.stderrStream) {
      try {
        this.stderrStream.end();
      } catch {}
      this.stderrStream = null;
    }
    if (this.child) {
      try {
        this.child.kill();
      } catch {}
      this.child = null;
    }
    this.status = "stopped";
  }
}
