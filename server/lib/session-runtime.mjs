import fs from "node:fs/promises";
import path from "node:path";

export class SessionRuntime {
  constructor({ runtime, stateStore }) {
    this.runtime = runtime;
    this.stateStore = stateStore;
  }

  async listSessions(limit = 200) {
    let workspaceSessions = [];
    if (this.stateStore) {
      try {
        workspaceSessions = await this.stateStore.listWorkspaceSessions();
      } catch {}
    }

    const seen = new Set();
    const merged = [];

    for (const s of workspaceSessions) {
      if (s.id && !seen.has(s.id)) {
        seen.add(s.id);
        merged.push({
          ...s,
          source: "workspace",
          runtime: "chat-runtime"
        });
      }
    }

    return {
      sessions: merged.slice(0, limit)
    };
  }

  async getSessionMessages(sessionId) {
    if (this.stateStore) {
      try {
        const session = await this.stateStore.readSession(sessionId);
        if (session && Array.isArray(session.messages)) {
          return {
            sessionId,
            messages: session.messages.map((m, idx) => ({
              id: String(idx + 1),
              role: m.role,
              content: m.content,
              timestamp: String(Math.floor(new Date(m.createdAt || 0).getTime() / 1000)),
              toolName: "",
              finishReason: "stop"
            }))
          };
        }
      } catch {}
    }
    return { sessionId, messages: [] };
  }

  async deleteSession(sessionId) {
    if (this.stateStore) {
      try {
        const filePath = path.join(this.stateStore.root, "sessions", `${sessionId}.json`);
        await fs.unlink(filePath).catch(() => {});
      } catch {}
    }
    return { ok: true };
  }

  async renameSession(sessionId, newTitle) {
    if (this.stateStore) {
      try {
        const session = await this.stateStore.readSession(sessionId);
        if (session) {
          session.title = newTitle;
          session.updatedAt = new Date().toISOString();
          await this.stateStore.writeSession(session);
          return { ok: true };
        }
      } catch {}
    }
    return { ok: false, error: "Session not found." };
  }

  async exportSession(sessionId) {
    if (this.stateStore) {
      try {
        const session = await this.stateStore.readSession(sessionId);
        if (session) {
          const lines = [
            `# Session: ${session.title || sessionId}`,
            `Model: ${session.model || "unknown"}`,
            `Updated: ${session.updatedAt}`,
            ""
          ];
          for (const m of session.messages || []) {
            lines.push(`## ${m.role.toUpperCase()}`);
            lines.push(m.content || "");
            lines.push("");
          }
          return { ok: true, markdown: lines.join("\n") };
        }
      } catch {}
    }
    return { ok: false, error: "Session not found." };
  }

  async pruneSessions() {
    if (this.stateStore) {
      try {
        const sessions = await this.stateStore.listWorkspaceSessions();
        let count = 0;
        for (const s of sessions) {
          const session = await this.stateStore.readSession(s.id);
          if (!session || !session.messages || session.messages.length === 0) {
            await this.deleteSession(s.id);
            count++;
          }
        }
        return { ok: true, pruned: count };
      } catch {}
    }
    return { ok: false, pruned: 0 };
  }

  async appendSessionMessage(sessionId, message) {
    if (this.stateStore) {
      try {
        const session = await this.stateStore.readSession(sessionId);
        if (session) {
          session.messages = session.messages || [];
          session.messages.push({
            role: message.role,
            content: message.content,
            createdAt: new Date().toISOString(),
            ...definedFields({
              taskId: message.taskId,
              source: message.source,
              toolName: message.toolName,
              finishReason: message.finishReason
            })
          });
          session.updatedAt = new Date().toISOString();
          if (message.content) {
            session.preview = message.content.slice(0, 60);
          }
          await this.stateStore.writeSession(session);
        }
      } catch {}
    }
  }
}

function definedFields(value) {
  return Object.fromEntries(
    Object.entries(value || {}).filter(([, item]) => item !== undefined && item !== null && item !== "")
  );
}
