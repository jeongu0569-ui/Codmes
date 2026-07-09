import { ChatBackend } from "./chat-backend.mjs";

export class WorkspaceChatBackend extends ChatBackend {
  constructor({ stateStore, authRuntime, providerRuntime }) {
    super();
    this.stateStore = stateStore;
    this.authRuntime = authRuntime;
    this.providerRuntime = providerRuntime;
  }

  async connect() {
    return;
  }

  async createSession(params = {}) {
    const sessionId = `ws-sess-${Math.random().toString(36).substring(2, 9)}`;
    const sessionObj = {
      id: sessionId,
      title: params.title || `Session ${new Date().toLocaleDateString()}`,
      model: params.model || "gpt-4",
      preview: "",
      updatedAt: new Date().toISOString(),
      source: "workspace",
      runtime: "chat-runtime",
      isActive: true,
      messages: []
    };
    if (this.stateStore) {
      await this.stateStore.writeSession(sessionObj);
    }
    return {
      sessionId,
      runtimeSessionId: sessionId
    };
  }

  async resumeSession(sessionId) {
    return sessionId;
  }

  async submitPrompt(params) {
    const config = await this.stateStore.readConfig();
    const providerId = params.provider || config.model?.provider;
    if (!providerId) {
      throw Object.assign(new Error("Provider config is missing. Setup default provider first."), { status: 400, setupRequired: true });
    }

    const model = params.model || config.model?.default;
    if (!model) {
      throw Object.assign(new Error("Default model is not configured. Setup default model first."), { status: 400, setupRequired: true });
    }

    const providers = config.providers || {};
    const provider = providers[providerId];
    if (!provider) {
      throw Object.assign(new Error(`Provider '${providerId}' is not configured.`), { status: 400, setupRequired: true });
    }

    if (provider.type && provider.type !== "openai-compatible") {
      throw Object.assign(new Error(`Unsupported provider type: ${provider.type}. Only 'openai-compatible' is currently supported.`), { status: 400 });
    }

    const baseUrl = provider.baseUrl;
    if (!baseUrl) {
      throw Object.assign(new Error(`Provider '${providerId}' base URL is not configured.`), { status: 400 });
    }

    const apiKey = await this.authRuntime.getApiKeyForProvider(providerId) || "";
    const apiKeyRequired = provider.apiKeyRequired !== false;

    if (apiKeyRequired && !apiKey) {
      throw Object.assign(new Error(`Provider '${providerId}' requires an API key. Setup auth credentials first.`), { status: 400, setupRequired: true });
    }

    let sessionId = params.sessionId;
    if (!sessionId) {
      const sessRes = await this.createSession(params);
      sessionId = sessRes.sessionId;
    }

    let existingMessages = [];
    if (this.stateStore && typeof this.stateStore.readSession === "function") {
      const session = await this.stateStore.readSession(sessionId);
      if (session && Array.isArray(session.messages)) {
        existingMessages = session.messages.map(m => ({
          role: m.role,
          content: m.content
        }));
      }
    }

    const messages = [...existingMessages];
    if (params.prompt || params.message) {
      messages.push({ role: "user", content: params.prompt || params.message });
    }

    const reqBody = {
      model,
      messages,
      temperature: params.temperature || 0.2
    };

    const headers = {
      "Content-Type": "application/json"
    };
    if (apiKey) {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }

    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(reqBody)
    });

    if (!res.ok) {
      const errText = await res.text();
      throw Object.assign(new Error(`LLM provider error: ${res.status} ${errText}`), { status: res.status });
    }

    const data = await res.json();
    const reply = data?.choices?.[0]?.message?.content || "";

    if (this.stateStore && typeof this.stateStore.readSession === "function" && typeof this.stateStore.writeSession === "function") {
      const session = await this.stateStore.readSession(sessionId);
      if (session) {
        session.messages = session.messages || [];
        if (params.prompt || params.message) {
          session.messages.push({
            role: "user",
            content: params.prompt || params.message,
            createdAt: new Date().toISOString()
          });
        }
        session.messages.push({
          role: "assistant",
          content: reply,
          createdAt: new Date().toISOString()
        });
        session.updatedAt = new Date().toISOString();
        session.preview = reply.slice(0, 60);
        await this.stateStore.writeSession(session);
      }
    }

    return {
      ok: true,
      sessionId,
      reply,
      messages: [
        ...messages,
        { role: "assistant", content: reply }
      ]
    };
  }

  close() {
    return;
  }
}
