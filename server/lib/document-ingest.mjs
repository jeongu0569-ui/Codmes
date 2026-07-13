import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const DOCUMENT_EXTENSIONS = new Set([
  ".pdf",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".bmp",
  ".tif",
  ".tiff",
  ".heic",
  ".doc",
  ".docx",
  ".ppt",
  ".pptx",
  ".hwp",
  ".hwpx",
  ".odt",
  ".odp",
  ".xlsx",
  ".xls",
  ".zip"
]);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const WORKER_PATH = path.resolve(__dirname, "..", "workers", "document-ingest", "extract_document.py");

export function isDocumentIngestFile(relativePath) {
  return DOCUMENT_EXTENSIONS.has(path.extname(String(relativePath || "")).toLowerCase());
}

export function documentIngestCacheDirectory(workspaceRoot) {
  return path.join(workspaceRoot, ".codmes", "index", "documents");
}

export function documentIngestCachePath(workspaceRoot, relativePath, stat) {
  const stamp = stat ? `${stat.size}:${stat.mtimeMs}` : "";
  const key = crypto
    .createHash("sha256")
    .update(`${String(relativePath || "").replace(/\\/g, "/")}\n${stamp}`)
    .digest("hex");
  return path.join(documentIngestCacheDirectory(workspaceRoot), `${key}.json`);
}

export async function getDocumentIngestMetadata(workspaceRoot, absolutePath, relativePath, stat = null) {
  const fileStat = stat || await fs.stat(absolutePath);
  const cachePath = documentIngestCachePath(workspaceRoot, relativePath, fileStat);
  let cached = false;
  let textLength = 0;
  let blockCount = 0;
  let warnings = [];
  try {
    const cachedJson = JSON.parse(await fs.readFile(cachePath, "utf8"));
    cached = true;
    textLength = String(cachedJson.text || "").length;
    blockCount = Array.isArray(cachedJson.blocks) ? cachedJson.blocks.length : 0;
    warnings = Array.isArray(cachedJson.warnings) ? cachedJson.warnings : [];
  } catch {}
  return {
    type: "document-ingest",
    cached,
    textLength,
    blockCount,
    warnings,
    cachePath: path.relative(workspaceRoot, cachePath).replace(/\\/g, "/"),
    supported: isDocumentIngestFile(relativePath)
  };
}

export async function extractAndCacheDocumentText(workspaceRoot, absolutePath, relativePath, stat = null) {
  const result = await extractAndCacheDocument(workspaceRoot, absolutePath, relativePath, stat);
  return String(result.text || "");
}

export async function extractAndCacheDocument(workspaceRoot, absolutePath, relativePath, stat = null) {
  const fileStat = stat || await fs.stat(absolutePath);
  const cachePath = documentIngestCachePath(workspaceRoot, relativePath, fileStat);
  try {
    return JSON.parse(await fs.readFile(cachePath, "utf8"));
  } catch {}

  const result = await runDocumentWorker({ absolutePath, relativePath });
  const normalized = normalizeWorkerResult(result, relativePath);
  await fs.mkdir(path.dirname(cachePath), { recursive: true });
  await fs.writeFile(cachePath, JSON.stringify(normalized, null, 2) + "\n", "utf8");
  return normalized;
}

async function runDocumentWorker({ absolutePath, relativePath }) {
  const python = await documentWorkerPython();
  const stdout = [];
  const stderr = [];
  const child = spawn(python, [
    WORKER_PATH,
    "--input",
    absolutePath,
    "--relative",
    relativePath
  ], {
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env
  });
  child.stdout.on("data", (chunk) => stdout.push(chunk));
  child.stderr.on("data", (chunk) => stderr.push(chunk));
  const code = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });
  const out = Buffer.concat(stdout).toString("utf8").trim();
  const err = Buffer.concat(stderr).toString("utf8").trim();
  if (code !== 0 && !out) {
    throw Object.assign(new Error(`Document worker failed: ${err || `exit ${code}`}`), { status: 500 });
  }
  try {
    return JSON.parse(out || "{}");
  } catch (error) {
    throw Object.assign(new Error(`Document worker returned invalid JSON: ${error.message}${err ? `; stderr=${err}` : ""}`), { status: 500 });
  }
}

async function documentWorkerPython() {
  if (process.env.CODMES_PYTHON) return process.env.CODMES_PYTHON;
  if (process.env.PYTHON) return process.env.PYTHON;
  const bundled = path.join(REPO_ROOT, ".codmes-runtime", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
  try {
    await fs.access(bundled);
    return bundled;
  } catch {
    return "python3";
  }
}

function normalizeWorkerResult(result = {}, relativePath) {
  const blocks = Array.isArray(result.blocks)
    ? result.blocks.map((block, index) => ({
      id: block.id || `block-${index + 1}`,
      path: String(block.path || relativePath),
      kind: String(block.kind || result.kind || "file"),
      source: String(block.source || "document"),
      page: Number.isFinite(Number(block.page)) ? Number(block.page) : null,
      text: String(block.text || ""),
      bbox: block.bbox || null,
      confidence: block.confidence ?? null,
      metadata: block.metadata && typeof block.metadata === "object" ? block.metadata : {}
    })).filter((block) => block.text.trim())
    : [];
  return {
    schemaVersion: 1,
    path: String(result.path || relativePath),
    kind: String(result.kind || "file"),
    text: String(result.text || blocks.map((block) => block.text).join("\n\n")).trim(),
    blocks,
    warnings: Array.isArray(result.warnings) ? result.warnings.map(String) : [],
    extractor: String(result.extractor || "codmes-document-worker")
  };
}
