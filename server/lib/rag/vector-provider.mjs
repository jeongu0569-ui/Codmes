import crypto from "node:crypto";

export const CHUNK_SCHEMA_VERSION = 1;

export function createDocumentChunk({
  workspaceRoot = "",
  path,
  kind = "text",
  text,
  start = null,
  end = null,
  page = null,
  metadata = {}
} = {}) {
  const normalizedPath = String(path || "").replace(/\\/g, "/");
  const content = String(text || "");
  if (!normalizedPath) throw new Error("Chunk path is required.");
  if (!content.trim()) throw new Error("Chunk text is required.");
  const hashInput = [
    workspaceRoot,
    normalizedPath,
    kind,
    start ?? "",
    end ?? "",
    page ?? "",
    content
  ].join("\n");
  return {
    schemaVersion: CHUNK_SCHEMA_VERSION,
    id: `chunk-${crypto.createHash("sha256").update(hashInput).digest("hex").slice(0, 24)}`,
    path: normalizedPath,
    kind,
    text: content,
    start,
    end,
    page,
    metadata,
    createdAt: new Date().toISOString()
  };
}

export class VectorIndexProvider {
  constructor({ workspaceRoot } = {}) {
    this.workspaceRoot = workspaceRoot || "";
  }

  async upsertChunks(_chunks) {
    throw new Error("VectorIndexProvider.upsertChunks() is not implemented.");
  }

  async deleteByPath(_path) {
    throw new Error("VectorIndexProvider.deleteByPath() is not implemented.");
  }

  async query(_request) {
    throw new Error("VectorIndexProvider.query() is not implemented.");
  }
}

export class EmbeddingProvider {
  async embedTexts(_texts) {
    throw new Error("EmbeddingProvider.embedTexts() is not implemented.");
  }
}

