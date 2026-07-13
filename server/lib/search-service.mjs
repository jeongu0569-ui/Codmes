import { existsSync, readFileSync, statSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileKind, resolveWorkspacePath } from "./path-utils.mjs";
import { extractAndCachePdfText } from "./pdf-text.mjs";

const DEFAULT_MAX_RESULTS = 20;
const DEFAULT_MAX_SCAN_FILES = 1000;
const DEFAULT_MAX_FILE_BYTES = 2 * 1024 * 1024;
const DEFAULT_CHUNK_CHARS = 1800;
const DEFAULT_CHUNK_OVERLAP = 220;

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
  const filePath = searchIndexPath(workspaceRoot);
  const hasIndex = existsSync(filePath);
  let builtAt = null;
  let itemCount = 0;
  let chunkCount = 0;
  let indexBytes = 0;
  if (hasIndex) {
    try {
      const stat = statSync(filePath);
      indexBytes = stat.size;
      const index = JSON.parse(requireTextSync(filePath));
      builtAt = index.builtAt || null;
      itemCount = Number(index.itemCount || 0);
      chunkCount = Number(index.chunkCount || 0);
    } catch {
      builtAt = null;
    }
  }
  return {
    provider: hasIndex ? "codmes-search-index" : "workspace-scan",
    workspaceRoot,
    available: true,
    indexed: hasIndex,
    realtimeIndexing: true,
    watchMode: "fs.watch-recursive-when-supported",
    description: hasIndex
      ? "Codmes built-in search index. Semantic ranking is planned inside Codmes Search Runtime."
      : "Codmes built-in scan search. Run codmes index rebuild to create the local search index.",
    partialIndexing: true,
    indexPath: path.relative(workspaceRoot, filePath).replace(/\\/g, "/"),
    builtAt,
    itemCount,
    chunkCount,
    indexBytes,
    searchableExtensions: Array.from(SEARCHABLE_EXTENSIONS).sort()
  };
}

export async function searchWorkspace(workspaceRoot, request = {}) {
  const query = String(request.query || "").trim();
  if (!query) throw Object.assign(new Error("Missing search query."), { status: 400 });
  const scopePath = resolveWorkspacePath(workspaceRoot, request.scopePath || "").relativePath;
  const maxResults = clampNumber(request.maxResults, 1, 100, DEFAULT_MAX_RESULTS);
  if (!request.forceScan) {
    const indexed = await searchBuiltIndex(workspaceRoot, { ...request, query, scopePath, maxResults });
    if (indexed) return indexed;
  }
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
    indexed: false,
    query,
    scopePath,
    totalCandidates: candidates.length,
    resultCount: results.length,
    results
  };
}

export function searchIndexPath(workspaceRoot) {
  return path.join(workspaceRoot, ".codmes", "index", "search.json");
}

export async function readSearchIndex(workspaceRoot) {
  try {
    return JSON.parse(await fs.readFile(searchIndexPath(workspaceRoot), "utf8"));
  } catch {
    return null;
  }
}

export async function buildSearchIndex(workspaceRoot, options = {}) {
  const roots = sanitizeRoots(options.roots || [""]);
  const maxScanFiles = clampNumber(options.maxScanFiles, 10, 20000, 10000);
  const filesByPath = new Map();
  for (const root of roots) {
    const files = await listSearchableFiles(workspaceRoot, root, { maxScanFiles });
    for (const file of files) filesByPath.set(file.path, file);
  }
  const files = Array.from(filesByPath.values()).sort((a, b) => a.path.localeCompare(b.path));
  const chunks = [];
  const items = [];
  for (const file of files) {
    const indexed = await indexFile(workspaceRoot, file, options).catch(() => null);
    if (!indexed) continue;
    items.push(indexed.item);
    chunks.push(...indexed.chunks);
  }
  const index = {
    schemaVersion: 1,
    provider: "codmes-search-index",
    builtAt: new Date().toISOString(),
    roots,
    embeddings: normalizeEmbeddingConfig(options.embeddings || options),
    itemCount: items.length,
    chunkCount: chunks.length,
    items,
    chunks
  };
  const filePath = searchIndexPath(workspaceRoot);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(index, null, 2) + "\n", "utf8");
  return index;
}

export async function updateSearchIndex(workspaceRoot, changedPaths = [], options = {}) {
  const current = await readSearchIndex(workspaceRoot);
  if (!current) return await buildSearchIndex(workspaceRoot, options);
  const itemByPath = new Map((current.items || []).map((item) => [item.path, item]));
  const chunksByPath = new Map();
  for (const chunk of current.chunks || []) {
    if (!chunksByPath.has(chunk.path)) chunksByPath.set(chunk.path, []);
    chunksByPath.get(chunk.path).push(chunk);
  }
  for (const changedPath of [].concat(changedPaths || [])) {
    const rel = String(changedPath || "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
    if (!rel || rel.startsWith(".codmes/")) continue;
    const resolved = resolveWorkspacePath(workspaceRoot, rel);
    const stat = await fs.stat(resolved.absolutePath).catch(() => null);
    if (!stat) {
      removeIndexedPath(itemByPath, chunksByPath, rel);
      continue;
    }
    if (stat.isDirectory()) {
      const files = await listSearchableFiles(workspaceRoot, rel, { maxScanFiles: 5000 });
      const livePaths = new Set(files.map((file) => file.path));
      for (const pathKey of Array.from(itemByPath.keys())) {
        if (pathKey.startsWith(`${rel}/`) && !livePaths.has(pathKey)) {
          itemByPath.delete(pathKey);
          chunksByPath.delete(pathKey);
        }
      }
      for (const file of files) {
        const next = await indexFile(workspaceRoot, file, options).catch(() => null);
        if (next) {
          itemByPath.set(next.item.path, next.item);
          chunksByPath.set(next.item.path, next.chunks);
        }
      }
      continue;
    }
    if (!isSearchableTextFile(rel) || stat.size > DEFAULT_MAX_FILE_BYTES) {
      itemByPath.delete(rel);
      chunksByPath.delete(rel);
      continue;
    }
    const next = await indexFile(workspaceRoot, {
      path: rel,
      absolutePath: resolved.absolutePath,
      kind: fileKind(rel),
      size: stat.size,
      modifiedAt: stat.mtime.toISOString()
    }, options).catch(() => null);
    if (next) {
      itemByPath.set(next.item.path, next.item);
      chunksByPath.set(next.item.path, next.chunks);
    }
  }
  const items = Array.from(itemByPath.values()).sort((a, b) => a.path.localeCompare(b.path));
  const chunks = items.flatMap((item) => chunksByPath.get(item.path) || []);
  const index = {
    ...current,
    provider: "codmes-search-index",
    builtAt: new Date().toISOString(),
    roots: sanitizeRoots(options.roots || current.roots || [""]),
    embeddings: normalizeEmbeddingConfig(
      options.embeddings || (hasEmbeddingOptions(options) ? options : current.embeddings)
    ),
    itemCount: items.length,
    chunkCount: chunks.length,
    items,
    chunks
  };
  const filePath = searchIndexPath(workspaceRoot);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(index, null, 2) + "\n", "utf8");
  return index;
}

async function searchBuiltIndex(workspaceRoot, request) {
  const index = await readSearchIndex(workspaceRoot);
  if (!index || !Array.isArray(index.chunks)) return null;
  const query = String(request.query || "").trim();
  const scopePath = String(request.scopePath || "").replace(/^\/+|\/+$/g, "");
  const maxResults = clampNumber(request.maxResults, 1, 100, DEFAULT_MAX_RESULTS);
  const chunks = index.chunks.filter((chunk) => inScope(chunk.path, scopePath));
  const kinds = requestedKinds(request);
  const scored = [];
  for (const chunk of chunks) {
    if (kinds.size > 0 && !kinds.has(String(chunk.kind).toLowerCase())) continue;
    const match = scoreIndexedChunk(chunk, query);
    if (match.score <= 0) continue;
    scored.push({
      path: chunk.path,
      kind: chunk.kind,
      score: match.score,
      snippet: match.snippet,
      chunkId: chunk.id,
      chunkIndex: chunk.chunkIndex
    });
  }
  const deduped = [];
  const seenPaths = new Set();
  for (const hit of scored.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))) {
    if (seenPaths.has(hit.path)) continue;
    seenPaths.add(hit.path);
    deduped.push(hit);
    if (deduped.length >= maxResults) break;
  }
  return {
    provider: "codmes-search-index",
    indexed: true,
    query,
    scopePath,
    builtAt: index.builtAt || null,
    totalCandidates: chunks.length,
    resultCount: deduped.length,
    results: deduped
  };
}

async function indexFile(workspaceRoot, file, options = {}) {
  const text = await readSearchableText(workspaceRoot, file).catch(() => "");
  const content = String(text || "");
  const item = {
    path: file.path,
    kind: file.kind,
    size: file.size,
    modifiedAt: file.modifiedAt,
    textLength: content.length,
    chunkCount: 0
  };
  const chunks = [];
  if (content) {
    const fileChunks = chunkText(content, {
      chunkChars: clampNumber(options.chunkChars, 400, 8000, DEFAULT_CHUNK_CHARS),
      overlap: clampNumber(options.chunkOverlap, 0, 2000, DEFAULT_CHUNK_OVERLAP)
    });
    item.chunkCount = fileChunks.length;
    fileChunks.forEach((chunk, index) => {
      chunks.push({
        id: stableChunkId(file.path, index, chunk.start, chunk.text),
        path: file.path,
        kind: file.kind,
        chunkIndex: index,
        start: chunk.start,
        end: chunk.end,
        text: chunk.text
      });
    });
  }
  return { item, chunks };
}

function removeIndexedPath(itemByPath, chunksByPath, rel) {
  for (const pathKey of Array.from(itemByPath.keys())) {
    if (pathKey === rel || pathKey.startsWith(`${rel}/`)) {
      itemByPath.delete(pathKey);
      chunksByPath.delete(pathKey);
    }
  }
}

function normalizeEmbeddingConfig(config = {}) {
  return {
    provider: String(config.embeddingsProvider || config.provider || "none"),
    baseUrl: String(config.openaiBaseUrl || config.baseUrl || ""),
    model: String(config.openaiEmbedModel || config.model || ""),
    dimensions: Number.parseInt(String(config.openaiEmbedDim || config.dimensions || "0"), 10) || null,
    mode: "configured-for-future-vector-index"
  };
}

function hasEmbeddingOptions(options = {}) {
  return Boolean(
    options.embeddingsProvider ||
    options.openaiBaseUrl ||
    options.openaiEmbedModel ||
    options.openaiEmbedDim ||
    options.provider ||
    options.baseUrl ||
    options.model ||
    options.dimensions
  );
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
        if (shouldSkipDirectoryEntry(workspaceRoot, absolutePath, entry.name)) continue;
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
  await visit(resolved.absolutePath).catch((error) => {
    if (error?.code !== "ENOENT") throw error;
  });
  return results;
}

function shouldSkipDirectoryEntry(workspaceRoot, parentAbsolutePath, entryName) {
  if (entryName === ".git" || entryName === "node_modules") return true;
  const parentRel = path.relative(workspaceRoot, parentAbsolutePath).replace(/\\/g, "/");
  if (!parentRel && entryName === ".codmes") return true;
  return false;
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
    text = await readSearchableText(workspaceRoot, file);
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
  const kinds = requestedKinds(request);
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

async function readSearchableText(workspaceRoot, file) {
  if (file.kind === "pdf") {
    return await extractAndCachePdfText(workspaceRoot, file.absolutePath, file.path);
  }
  return await fs.readFile(file.absolutePath, "utf8");
}

function requestedKinds(request) {
  return new Set(
    []
      .concat(request.kind || [])
      .concat(request.kinds || [])
      .filter(Boolean)
      .map((item) => String(item).toLowerCase())
  );
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

function chunkText(text, options) {
  const chunks = [];
  const chunkChars = options.chunkChars;
  const overlap = Math.min(options.overlap, Math.max(0, chunkChars - 1));
  let start = 0;
  while (start < text.length) {
    const hardEnd = Math.min(text.length, start + chunkChars);
    const end = findChunkEnd(text, start, hardEnd);
    const body = text.slice(start, end).replace(/\s+/g, " ").trim();
    if (body) chunks.push({ start, end, text: body });
    if (end >= text.length) break;
    start = Math.max(start + 1, end - overlap);
  }
  return chunks;
}

function findChunkEnd(text, start, hardEnd) {
  if (hardEnd >= text.length) return text.length;
  const window = text.slice(start, hardEnd);
  const breakpoints = ["\n\n", "\n", ". ", " "];
  for (const mark of breakpoints) {
    const index = window.lastIndexOf(mark);
    if (index > Math.floor(window.length * 0.55)) return start + index + mark.length;
  }
  return hardEnd;
}

function scoreIndexedChunk(chunk, query) {
  const text = String(chunk.text || "");
  const lowerText = text.toLocaleLowerCase();
  const lowerPath = String(chunk.path || "").toLocaleLowerCase();
  const phrase = query.toLocaleLowerCase();
  const terms = queryTerms(query);
  let score = 0;
  let index = lowerText.indexOf(phrase);
  if (index >= 0) score += 5 + Math.min(2, phrase.length / 12);
  if (lowerPath.includes(phrase)) score += 3;
  for (const term of terms) {
    if (lowerPath.includes(term)) score += 1.5;
    const termIndex = lowerText.indexOf(term);
    if (termIndex >= 0) {
      score += 1;
      if (index < 0) index = termIndex;
    }
  }
  if (terms.length > 1 && terms.every((term) => lowerText.includes(term) || lowerPath.includes(term))) {
    score += 2;
  }
  if (score <= 0) return { score: 0, snippet: "" };
  return {
    score: Number((score - Math.min(0.3, text.length / 20000)).toFixed(4)),
    snippet: snippet(text, Math.max(0, index), Math.max(phrase.length, terms[0]?.length || 1))
  };
}

function queryTerms(query) {
  return Array.from(new Set(String(query || "")
    .toLocaleLowerCase()
    .split(/[^\p{L}\p{N}_-]+/u)
    .map((term) => term.trim())
    .filter((term) => term.length >= 2)));
}

function inScope(filePath, scopePath) {
  if (!scopePath) return true;
  return filePath === scopePath || filePath.startsWith(`${scopePath}/`);
}

function sanitizeRoots(roots) {
  return []
    .concat(roots || [])
    .map((root) => String(root || "").trim().replace(/^\/+|\/+$/g, ""))
    .filter((root, index, array) => array.indexOf(root) === index);
}

function stableChunkId(...parts) {
  let hash = 0;
  const input = parts.join("\n");
  for (let index = 0; index < input.length; index += 1) {
    hash = Math.imul(31, hash) + input.charCodeAt(index) | 0;
  }
  return `chunk-${Math.abs(hash).toString(36)}`;
}

function requireTextSync(filePath) {
  return statSync(filePath).size > 10 * 1024 * 1024
    ? "{}"
    : readFileSync(filePath, "utf8");
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
