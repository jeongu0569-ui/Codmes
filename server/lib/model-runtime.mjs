export class ModelRuntime {
  constructor({ hermesCompat }) {
    this.compat = hermesCompat;
  }

  async listModels() {
    if (!this.compat) return { models: [] };
    const result = await this.compat.fetchHermesJson("/api/model/options");
    return result;
  }
}
