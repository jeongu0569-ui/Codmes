export class ChatRuntime {
  constructor({ hermesCompat }) {
    this.compat = hermesCompat;
  }

  async connect() {
    if (!this.compat) return;
    await this.compat.connect();
  }

  async createSession(params) {
    if (!this.compat) {
      return { sessionId: "local-sess", runtimeSessionId: "local-sess" };
    }
    return await this.compat.createSession(params);
  }

  async resumeSession(sessionId) {
    if (!this.compat) return sessionId;
    return await this.compat.resumeSession(sessionId);
  }

  async submitPrompt(params) {
    if (!this.compat) {
      return { ok: true, sessionId: params.sessionId, runtimeSessionId: "local-sess" };
    }
    return await this.compat.submitPrompt(params);
  }

  async respondToApproval(params) {
    if (!this.compat) return { ok: true, choice: "once" };
    return await this.compat.respondToApproval(params);
  }

  async setAccessMode(sessionId, accessMode) {
    if (!this.compat) return;
    await this.compat.setAccessMode(sessionId, accessMode);
  }

  async setReasoning(sessionId, reasoningEffort) {
    if (!this.compat) return;
    await this.compat.setReasoning(sessionId, reasoningEffort);
  }

  close() {
    if (this.compat) this.compat.close();
  }
}
