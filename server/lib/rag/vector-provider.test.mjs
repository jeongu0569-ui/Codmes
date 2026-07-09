import test from "node:test";
import assert from "node:assert/strict";
import { createDocumentChunk, VectorIndexProvider } from "./vector-provider.mjs";

test("createDocumentChunk normalizes document chunk schema", () => {
  const chunk = createDocumentChunk({
    workspaceRoot: "/tmp/workspace",
    path: "Documents/manual.pdf",
    kind: "pdf",
    page: 2,
    text: "AI Workspace chunk text",
    metadata: { title: "Manual" }
  });

  assert.equal(chunk.schemaVersion, 1);
  assert.match(chunk.id, /^chunk-[a-f0-9]{24}$/);
  assert.equal(chunk.path, "Documents/manual.pdf");
  assert.equal(chunk.kind, "pdf");
  assert.equal(chunk.page, 2);
  assert.equal(chunk.metadata.title, "Manual");
});

test("VectorIndexProvider skeleton requires concrete implementation", async () => {
  const provider = new VectorIndexProvider({ workspaceRoot: "/tmp/workspace" });
  await assert.rejects(() => provider.query({ query: "hello" }), /not implemented/);
});

