import fs from "node:fs/promises";
import path from "node:path";
import { fileKind, resolveWorkspacePath } from "./path-utils.mjs";
import { extractAndCachePdfText } from "./pdf-text.mjs";

const DEFAULT_MAX_RESULTS = 20;
const DEFAULT_MAX_SCAN_FILES = 1000;
const DEFAULT_MAX_FILE_BYTES = 2 * 1024 * 1024;

const SEARCHABLE_KINDS = new Set(["markdown", "code", "file", "pdf"]);
const SEARCHABLE_EXTENSIONS = new Set([
  ".md",
  ".markdown",
  ".txt",
  ".json",
  ".yaml",
  ".yml",
  ".toml",
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".py",
  ".swift",
  ".go",
  ".rs",
  ".java",
  ".c",
  ".cc",
  ".cpp",
  ".h",
  ".hpp",
  ".html",
  ".css",
  ".sh",
  ".ps1",
  ".pdf"
]);

export function searchStatus(workspaceRoot) {
  return {
    provider: process.env.DOCSEARCH_PROVIDER || "workspace-scan",
    workspaceRoot,
    available: true,
    indexed: false,
    realtimeIndexing: false,
    description: "Dependency-free text scan fallback. Replace with docsearch-mcp/vector index later.",
    searchableExtensions: Array.from(SEARCHABLE_EXTENSIONS).sort()
  };
}

export async function searchWorkspace(workspaceRoot, request = {}) {
  const query = String(request.query || "").trim();
  if (!query) throw Object.assign(new Error("Missing search query."), { status: 400 });
  const scopePath = resolveWorkspacePath(workspaceRoot, request.scopePath || "").relativePath;
  const maxResults = clampNumber(request.maxResults, 1, 100, DEFAULT_MAX_RESULTS);
  const maxScanFiles = clampNumber(request.maxScanFiles, 10, 5000, DEFAULT_MAX_SCAN_FILES);
  const candidates = filterCandidates(
    await listSearchableFiles(workspaceRoot, scopePath, { maxScanFiles }),
    request
  );
  const results = [];
  for (const file of candidates) {
    if (results.length >= maxResults) break;
    const hit = await searchFile(workspaceRoot, file, query);
    if (hit) results.push(hit);
  }
  return {
    provider: "workspace-scan",
    query,
    scopePath,
    totalCandidates: candidates.length,
    resultCount: results.length,
    results
  };
}

async function listSearchableFiles(workspaceRoot, relativePath, options) {
  const resolved = resolveWorkspacePath(workspaceRoot, relativePath);
  const results = [];
  async function visit(absolutePath) {
    if (results.length >= options.maxScanFiles) return;
    const stat = await fs.stat(absolutePath);
    if (stat.isDirectory()) {
      const entries = await fs.readdir(absolutePath, { withFileTypes: true });
      entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
      for (const entry of entries) {
        if (entry.name === ".DS_Store" || entry.name === ".hermes-workspace") continue;
        await visit(path.join(absolutePath, entry.name));
        if (results.length >= options.maxScanFiles) return;
      }
      return;
    }
    if (stat.size > DEFAULT_MAX_FILE_BYTES) return;
    const rel = path.relative(workspaceRoot, absolutePath).replace(/\\/g, "/");
    if (!isSearchableTextFile(rel)) return;
    results.push({
      path: rel,
      absolutePath,
      kind: fileKind(rel),
      size: stat.size,
      modifiedAt: stat.mtime.toISOString()
    });
  }
  await visit(resolved.absolutePath);
  return results;
}

async function searchFile(workspaceRoot, file, query) {
  const needle = query.toLocaleLowerCase();
  const filenameIndex = file.path.toLocaleLowerCase().indexOf(needle);
  if (filenameIndex >= 0) {
    return {
      path: file.path,
      kind: file.kind,
      size: file.size,
      modifiedAt: file.modifiedAt,
      score: 1.25,
      snippet: file.path
    };
  }
  let text;
  try {
    if (file.kind === "pdf") {
      text = await extractAndCachePdfText(workspaceRoot, file.absolutePath, file.path);
    } else {
      text = await fs.readFile(file.absolutePath, "utf8");
    }
  } catch {
    return null;
  }
  if (!text) return null;
  const haystack = text.toLocaleLowerCase();
  const index = haystack.indexOf(needle);
  if (index < 0) return null;
  return {
    path: file.path,
    kind: file.kind,
    size: file.size,
    modifiedAt: file.modifiedAt,
    score: scoreHit(text, query, index),
    snippet: snippet(text, index, query.length)
  };
}

function filterCandidates(candidates, request) {
  const kinds = new Set(
    []
      .concat(request.kind || [])
      .concat(request.kinds || [])
      .filter(Boolean)
      .map((item) => String(item).toLowerCase())
  );
  const modifiedAfter = parseDate(request.modifiedAfter);
  const modifiedBefore = parseDate(request.modifiedBefore);
  return candidates.filter((file) => {
    if (kinds.size > 0 && !kinds.has(String(file.kind).toLowerCase())) return false;
    const modifiedAt = Date.parse(file.modifiedAt);
    if (modifiedAfter && modifiedAt < modifiedAfter.getTime()) return false;
    if (modifiedBefore && modifiedAt > modifiedBefore.getTime()) return false;
    return true;
  });
}

function parseDate(value) {
  if (!value) return null;
  const time = Date.parse(String(value));
  return Number.isFinite(time) ? new Date(time) : null;
}

function isSearchableTextFile(relativePath) {
  const ext = path.extname(relativePath).toLowerCase();
  if (SEARCHABLE_EXTENSIONS.has(ext)) return true;
  return SEARCHABLE_KINDS.has(fileKind(relativePath));
}

function snippet(text, index, length) {
  const radius = 140;
  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, index + length + radius);
  const prefix = start > 0 ? "... " : "";
  const suffix = end < text.length ? " ..." : "";
  return prefix + text.slice(start, end).replace(/\s+/g, " ").trim() + suffix;
}

function scoreHit(text, query, index) {
  const basenameBoost = index < 200 ? 0.1 : 0;
  const lengthPenalty = Math.min(0.4, text.length / 100000);
  return Number((1 + basenameBoost - lengthPenalty + Math.min(0.5, query.length / 100)).toFixed(4));
}

function clampNumber(value, min, max, fallback) {
  const number = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}
