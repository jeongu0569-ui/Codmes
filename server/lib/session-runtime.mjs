import fs from "node:fs/promises";
import path from "node:path";

export class SessionRuntime {
  constructor({ runtimeAdapter, stateStore }) {
    this.adapter = runtimeAdapter;
    this.stateStore = stateStore;
  }

  async listSessions(limit = 200) {
    let workspaceSessions = [];
    if (this.stateStore) {
      try {
        workspaceSessions = await this.stateStore.listWorkspaceSessions();
      } catch {}
    }

    let adapterSessions = [];
    if (typeof this.adapter?.fetchJson === "function") {
      try {
        const result = await this.adapter.fetchJson(`/api/sessions?limit=${limit}`);
        const list = Array.isArray(result?.sessions) ? result.sessions
          : Array.isArray(result?.items) ? result.items
            : Array.isArray(result?.data) ? result.data
              : Array.isArray(result) ? result
                : [];
        adapterSessions = list.map(s => ({
          id: s.id,
          title: s.title || `Legacy Session ${s.id}`,
          model: s.model || "unknown",
          preview: s.preview || "",
          updatedAt: s.updatedAt || new Date().toISOString(),
          source: "runtime-adapter",
          runtime: "external",
          isActive: s.isActive || false
        }));
      } catch (err) {
        // Gracefully ignore error and return fallback
      }
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

    for (const s of adapterSessions) {
      if (s.id && !seen.has(s.id)) {
        seen.add(s.id);
        merged.push(s);
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
    if (typeof this.adapter?.fetchJson === "function") {
      try {
        const result = await this.adapter.fetchJson(`/api/sessions/${encodeURIComponent(sessionId)}/messages`);
        return result;
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
    if (typeof this.adapter?.fetchJson === "function") {
      try {
        return await this.adapter.fetchJson(`/api/sessions/${encodeURIComponent(sessionId)}`, {
          method: "DELETE"
        });
      } catch {}
    }
    return { ok: true };
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
            createdAt: new Date().toISOString()
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
