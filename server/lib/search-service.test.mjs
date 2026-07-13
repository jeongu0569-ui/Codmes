import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  buildSearchIndex,
  readSearchIndex,
  searchStatus,
  searchWorkspace,
  updateSearchIndex
} from "./search-service.mjs";

const execFileAsync = promisify(execFile);

test("searches workspace text files within scope", async () => {
  const root = await fixtureWorkspace();
  const result = await searchWorkspace(root, {
    query: "scheduler",
    scopePath: "Notes",
    maxResults: 5
  });
  assert.equal(result.provider, "workspace-scan");
  assert.equal(result.resultCount, 1);
  assert.equal(result.results[0].path, "Notes/os.md");
  assert.match(result.results[0].snippet, /scheduler/i);
});

test("does not search outside the requested scope", async () => {
  const root = await fixtureWorkspace();
  const result = await searchWorkspace(root, {
    query: "scheduler",
    scopePath: "Code"
  });
  assert.equal(result.resultCount, 0);
});

test("search supports filename hits and kind filters", async () => {
  const root = await fixtureWorkspace();
  const filenameHit = await searchWorkspace(root, {
    query: "main",
    scopePath: "",
    kind: "code"
  });
  assert.equal(filenameHit.resultCount, 1);
  assert.equal(filenameHit.results[0].path, "Code/main.js");

  const filteredOut = await searchWorkspace(root, {
    query: "main",
    scopePath: "",
    kind: "markdown"
  });
  assert.equal(filteredOut.resultCount, 0);
});

test("reports secondary workspace scan search status", async () => {
  const status = searchStatus("/tmp/workspace");
  assert.equal(status.provider, "workspace-scan");
  assert.equal(status.available, true);
  assert.equal(status.indexed, false);
  assert.ok(status.searchableExtensions.includes(".md"));
  assert.ok(status.searchableExtensions.includes(".pdf"));
});

test("builds and searches the native Codmes search index", async () => {
  const root = await fixtureWorkspace();
  const index = await buildSearchIndex(root, {
    roots: ["Notes"],
    embeddingsProvider: "ollama",
    openaiBaseUrl: "http://127.0.0.1:11434/v1",
    openaiEmbedModel: "bge-m3",
    openaiEmbedDim: 1024
  });
  assert.equal(index.provider, "codmes-search-index");
  assert.equal(index.roots[0], "Notes");
  assert.equal(index.embeddings.provider, "ollama");
  assert.equal(index.embeddings.model, "bge-m3");
  assert.equal(index.embeddings.dimensions, 1024);
  assert.equal(index.itemCount, 1);
  assert.equal(index.chunkCount, 1);

  const status = searchStatus(root);
  assert.equal(status.provider, "codmes-search-index");
  assert.equal(status.indexed, true);
  assert.equal(status.itemCount, 1);

  const result = await searchWorkspace(root, {
    query: "scheduler",
    scopePath: "Notes",
    maxResults: 5
  });
  assert.equal(result.provider, "codmes-search-index");
  assert.equal(result.resultCount, 1);
  assert.equal(result.results[0].path, "Notes/os.md");
});

test("partially updates the native search index when files change", async () => {
  const root = await fixtureWorkspace();
  await buildSearchIndex(root, {
    roots: ["Notes"],
    embeddingsProvider: "ollama",
    openaiEmbedModel: "bge-m3"
  });

  await fs.writeFile(path.join(root, "Notes", "os.md"), "# OS\n\nA kernel tracks run queues.", "utf8");
  const updated = await updateSearchIndex(root, ["Notes/os.md"]);
  assert.equal(updated.provider, "codmes-search-index");
  assert.equal(updated.embeddings.provider, "ollama");
  assert.equal(updated.embeddings.model, "bge-m3");

  const oldTerm = await searchWorkspace(root, { query: "scheduler", scopePath: "Notes" });
  assert.equal(oldTerm.resultCount, 0);

  const newTerm = await searchWorkspace(root, { query: "run queues", scopePath: "Notes" });
  assert.equal(newTerm.provider, "codmes-search-index");
  assert.equal(newTerm.resultCount, 1);
  assert.equal(newTerm.results[0].path, "Notes/os.md");
});

test("partially removes deleted files from the native search index", async () => {
  const root = await fixtureWorkspace();
  await buildSearchIndex(root, { roots: ["Notes"] });

  await fs.rm(path.join(root, "Notes", "os.md"));
  await updateSearchIndex(root, ["Notes/os.md"]);

  const index = await readSearchIndex(root);
  assert.equal(index.itemCount, 0);
  assert.equal(index.chunkCount, 0);

  const result = await searchWorkspace(root, { query: "scheduler", scopePath: "Notes" });
  assert.equal(result.provider, "codmes-search-index");
  assert.equal(result.resultCount, 0);
});

test("full workspace indexing skips private Codmes config state", async () => {
  const root = await fixtureWorkspace();
  await fs.mkdir(path.join(root, ".codmes", "config"), { recursive: true });
  await fs.writeFile(path.join(root, ".codmes", "config", "auth.json"), "{\"secret\":\"leak-marker\"}", "utf8");

  await buildSearchIndex(root, { roots: [""] });
  const result = await searchWorkspace(root, { query: "leak-marker", scopePath: "" });
  assert.equal(result.provider, "codmes-search-index");
  assert.equal(result.resultCount, 0);
});

test("searches extracted PDF text and caches it", async () => {
  const root = await fixtureWorkspace();
  await fs.mkdir(path.join(root, "Documents"), { recursive: true });
  await createMinimalPdf(path.join(root, "Documents", "manual.pdf"), "semantic workspace manual");

  const result = await searchWorkspace(root, {
    query: "semantic workspace",
    scopePath: "Documents"
  });
  assert.equal(result.resultCount, 1);
  assert.equal(result.results[0].path, "Documents/manual.pdf");
  assert.match(result.results[0].snippet, /semantic workspace/i);

  const cacheEntries = await fs.readdir(path.join(root, ".codmes", "index", "documents"));
  assert.equal(cacheEntries.length, 1);
});

async function fixtureWorkspace() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "search-service-"));
  await fs.mkdir(path.join(root, "Notes"), { recursive: true });
  await fs.mkdir(path.join(root, "Code"), { recursive: true });
  await fs.writeFile(path.join(root, "Notes", "os.md"), "# OS\n\nA scheduler chooses a process.", "utf8");
  await fs.writeFile(path.join(root, "Code", "main.js"), "console.log('hello')", "utf8");
  return root;
}

async function createMinimalPdf(filePath, text) {
  const script = `
import fitz, sys
path, text = sys.argv[1], sys.argv[2]
doc = fitz.open()
page = doc.new_page()
page.insert_text((72, 72), text, fontsize=14)
doc.save(path)
`;
  await execFileAsync(process.env.CODMES_PYTHON || ".codmes-runtime/bin/python", ["-c", script, filePath, text]);
}
