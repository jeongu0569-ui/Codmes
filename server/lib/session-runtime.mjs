export class SessionRuntime {
  constructor({ hermesCompat }) {
    this.compat = hermesCompat;
  }

  async listSessions(limit = 200) {
    if (!this.compat) return { sessions: [] };
    const result = await this.compat.fetchHermesJson(`/api/sessions?limit=${limit}`);
    return result;
  }

  async getSessionMessages(sessionId) {
    if (!this.compat) return { messages: [] };
    const result = await this.compat.fetchHermesJson(`/api/sessions/${encodeURIComponent(sessionId)}/messages`);
    return result;
  }

  async deleteSession(sessionId) {
    if (!this.compat) return { ok: true };
    const result = await this.compat.fetchHermesJson(`/api/sessions/${encodeURIComponent(sessionId)}`, {
      method: "DELETE"
    });
    return result;
  }
}
