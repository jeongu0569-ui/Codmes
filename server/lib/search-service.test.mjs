import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { searchStatus, searchWorkspace } from "./search-service.mjs";

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

test("reports fallback search status", async () => {
  const status = searchStatus("/tmp/workspace");
  assert.equal(status.provider, "workspace-scan");
  assert.equal(status.available, true);
  assert.equal(status.indexed, false);
  assert.ok(status.searchableExtensions.includes(".md"));
  assert.ok(status.searchableExtensions.includes(".pdf"));
});

test("searches extracted PDF text and caches it", async () => {
  const root = await fixtureWorkspace();
  await fs.mkdir(path.join(root, "Documents"), { recursive: true });
  await fs.writeFile(
    path.join(root, "Documents", "manual.pdf"),
    "%PDF-1.4\n1 0 obj << /Type /Page >> endobj\nBT (semantic workspace manual) Tj ET\n%%EOF",
    "latin1"
  );

  const result = await searchWorkspace(root, {
    query: "semantic workspace",
    scopePath: "Documents"
  });
  assert.equal(result.resultCount, 1);
  assert.equal(result.results[0].path, "Documents/manual.pdf");
  assert.match(result.results[0].snippet, /semantic workspace/i);

  const cacheEntries = await fs.readdir(path.join(root, ".ai-workspace", "index", "pdf-text"));
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
