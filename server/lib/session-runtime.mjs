import fs from "node:fs/promises";
import path from "node:path";

export class SessionRuntime {
  constructor({ hermesCompat, stateStore }) {
    this.compat = hermesCompat;
    this.stateStore = stateStore;
  }

  async listSessions(limit = 200) {
    let workspaceSessions = [];
    if (this.stateStore) {
      try {
        workspaceSessions = await this.stateStore.listWorkspaceSessions();
      } catch {}
    }

    let compatSessions = [];
    if (this.compat) {
      try {
        const result = await this.compat.fetchHermesJson(`/api/sessions?limit=${limit}`);
        const list = Array.isArray(result?.sessions) ? result.sessions
          : Array.isArray(result?.items) ? result.items
            : Array.isArray(result?.data) ? result.data
              : Array.isArray(result) ? result
                : [];
        compatSessions = list.map(s => ({
          id: s.id,
          title: s.title || `Legacy Session ${s.id}`,
          model: s.model || "unknown",
          preview: s.preview || "",
          updatedAt: s.updatedAt || new Date().toISOString(),
          source: "hermes-compat",
          runtime: "hermes-live",
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

    for (const s of compatSessions) {
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
    if (this.compat) {
      try {
        const result = await this.compat.fetchHermesJson(`/api/sessions/${encodeURIComponent(sessionId)}/messages`);
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
    if (this.compat) {
      try {
        return await this.compat.fetchHermesJson(`/api/sessions/${encodeURIComponent(sessionId)}`, {
          method: "DELETE"
        });
      } catch {}
    }
    return { ok: true };
  }
}
