import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  buildVlmOcrPrompt,
  callOllamaNativeVlm,
  callOpenAICompatibleVlm
} from "./vlm-runtime.mjs";

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
const DOCUMENT_INGEST_CACHE_VERSION = 2;

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
    .update(`v${DOCUMENT_INGEST_CACHE_VERSION}\n${String(relativePath || "").replace(/\\/g, "/")}\n${stamp}`)
    .digest("hex");
  return path.join(documentIngestCacheDirectory(workspaceRoot), `${key}.json`);
}

export function documentIngestMarkdownPath(workspaceRoot, relativePath, stat) {
  return documentIngestCachePath(workspaceRoot, relativePath, stat).replace(/\.json$/, ".md");
}

export function annotationsPathForDocument(workspaceRoot, relativePath) {
  const normalized = String(relativePath || "").replace(/\\/g, "/").replace(/^\/+/, "");
  const parsed = path.posix.parse(normalized);
  const stateName = `${parsed.name || "document"}.codmes.json`;
  return path.join(workspaceRoot, parsed.dir, ".codmes", "annotations", stateName);
}

export function contentScopedAnnotationsPathForDocument(workspaceRoot, relativePath) {
  const normalized = String(relativePath || "").replace(/\\/g, "/").replace(/^\/+/, "");
  const encoded = Buffer.from(normalized, "utf8").toString("base64url");
  const root = normalized.split("/").filter(Boolean)[0] || "";
  const stateRoot = ["Notes", "Documents", "Code", "Attachments"].includes(root)
    ? path.join(workspaceRoot, root, ".codmes")
    : path.join(workspaceRoot, ".codmes");
  return path.join(stateRoot, "annotations", `${encoded}.json`);
}

export function legacyAnnotationsPathForDocument(workspaceRoot, relativePath) {
  const encoded = Buffer.from(String(relativePath || "").replace(/\\/g, "/"), "utf8").toString("base64url");
  return path.join(workspaceRoot, ".codmes", "annotations", `${encoded}.json`);
}

export function annotationOcrCachePath(workspaceRoot, contentHash) {
  return path.join(workspaceRoot, ".codmes", "index", "annotation-ocr", `${String(contentHash || "").replace(/^sha256-/, "")}.json`);
}

export async function getDocumentIngestMetadata(workspaceRoot, absolutePath, relativePath, stat = null) {
  const fileStat = stat || await fs.stat(absolutePath);
  const cachePath = documentIngestCachePath(workspaceRoot, relativePath, fileStat);
  let cached = false;
  let textLength = 0;
  let blockCount = 0;
  let tableCount = 0;
  let warnings = [];
  try {
    const cachedJson = JSON.parse(await fs.readFile(cachePath, "utf8"));
    cached = true;
    textLength = String(cachedJson.text || "").length;
    blockCount = Array.isArray(cachedJson.blocks) ? cachedJson.blocks.length : 0;
    tableCount = Array.isArray(cachedJson.tables) ? cachedJson.tables.length : 0;
    warnings = Array.isArray(cachedJson.warnings) ? cachedJson.warnings : [];
  } catch {}
  return {
    type: "document-ingest",
    cached,
    textLength,
    blockCount,
    tableCount,
    warnings,
    cachePath: path.relative(workspaceRoot, cachePath).replace(/\\/g, "/"),
    markdownPath: path.relative(workspaceRoot, cachePath.replace(/\.json$/, ".md")).replace(/\\/g, "/"),
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
  const markdownPath = documentIngestMarkdownPath(workspaceRoot, relativePath, fileStat);
  try {
    const cached = JSON.parse(await fs.readFile(cachePath, "utf8"));
    await ensureDocumentMarkdown(markdownPath, cached);
    return cached;
  } catch {}

  const result = await runDocumentWorker({ absolutePath, relativePath });
  const normalized = await maybeEnhanceWithVlmOcr(
    workspaceRoot,
    absolutePath,
    relativePath,
    normalizeWorkerResult(result, relativePath)
  );
  await fs.mkdir(path.dirname(cachePath), { recursive: true });
  await fs.writeFile(cachePath, JSON.stringify(normalized, null, 2) + "\n", "utf8");
  await fs.writeFile(markdownPath, documentMarkdown(normalized), "utf8");
  return normalized;
}

async function ensureDocumentMarkdown(markdownPath, document) {
  try {
    await fs.access(markdownPath);
  } catch {
    await fs.writeFile(markdownPath, documentMarkdown(document), "utf8");
  }
}

function documentMarkdown(document = {}) {
  const markdown = String(document.markdown || document.text || "").trim();
  return markdown ? `${markdown}\n` : "";
}

export async function extractDocumentAnnotationBlocks(workspaceRoot, relativePath) {
  const config = await readVlmSearchConfig(workspaceRoot);
  const annotations = await readAnnotationsForDocument(workspaceRoot, relativePath);
  if (!annotations) return [];
  const blocks = [];
  const allObjects = collectAnnotationObjects(annotations);
  for (const object of allObjects) {
    const type = String(object.type || "").toLowerCase();
    if (type === "text" || type === "textbox" || type === "text-box") {
      const text = String(object.text || "").trim();
      if (text) {
        blocks.push(annotationBlock(relativePath, object, text, "annotation-text"));
      }
      continue;
    }
    if (!["image", "sticker", "photo", "attachment-image"].includes(type)) continue;
    const existingText = String(object.text || object.metadata?.ocrText || "").trim();
    if (existingText) {
      blocks.push(annotationBlock(relativePath, object, existingText, "annotation-image-ocr"));
      continue;
    }
    if (!config.enabled || !object.dataBase64) continue;
    try {
      const mime = object.metadata?.mime || object.metadata?.contentType || "image/png";
      const dataBase64 = String(object.dataBase64).replace(/^data:[^,]+,/, "");
      const contentHash = annotationImageContentHash(object, dataBase64);
      const ocr = await readOrCreateAnnotationImageOcr(workspaceRoot, config, {
        contentHash,
        mime,
        dataBase64
      });
      const text = ocr.text || "";
      if (text.trim()) {
        blocks.push(annotationBlock(relativePath, object, text.trim(), "annotation-image-ocr", {
          contentHash,
          provider: ocr.provider || config.provider,
          model: ocr.model || config.model,
          deterministic: true,
          temperature: 0,
          thinking: "off",
          cached: Boolean(ocr.cached)
        }));
      }
    } catch {
      // Annotation OCR is opportunistic. The main document text should remain searchable.
    }
  }
  return blocks;
}

async function readOrCreateAnnotationImageOcr(workspaceRoot, config, { contentHash, mime, dataBase64 }) {
  const cachePath = annotationOcrCachePath(workspaceRoot, contentHash);
  try {
    const cached = JSON.parse(await fs.readFile(cachePath, "utf8"));
    if (String(cached.text || "").trim()) {
      return { ...cached, cached: true };
    }
  } catch {}
  const text = await callConfiguredVlm(config, {
    prompt: buildVlmOcrPrompt({
      language: config.language || "auto",
      output: "markdown"
    }),
    imageBase64: dataBase64,
    imageUrl: `data:${mime};base64,${dataBase64}`
  });
  const result = {
    schemaVersion: 1,
    contentHash,
    text: String(text || "").trim(),
    provider: config.provider,
    model: config.model,
    mime,
    updatedAt: new Date().toISOString(),
    deterministic: true,
    temperature: 0,
    thinking: "off"
  };
  await fs.mkdir(path.dirname(cachePath), { recursive: true });
  await fs.writeFile(cachePath, JSON.stringify(result, null, 2) + "\n", "utf8");
  return { ...result, cached: false };
}

function annotationImageContentHash(object, dataBase64) {
  const existing = object.metadata?.contentHash || object.contentHash;
  if (existing) return String(existing);
  return `sha256-${crypto.createHash("sha256").update(String(dataBase64 || "")).digest("hex")}`;
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

async function maybeEnhanceWithVlmOcr(workspaceRoot, absolutePath, relativePath, document) {
  const config = await readVlmSearchConfig(workspaceRoot);
  if (!config.enabled) return document;
  if (!shouldRunVlmOcr(relativePath, document, config)) return document;

  const warnings = [...(document.warnings || [])];
  const vlmBlocks = [];
  try {
    const inputs = await buildVlmInputs(workspaceRoot, absolutePath, relativePath, config);
    const prompt = buildVlmOcrPrompt({
      language: config.language || "auto",
      output: "markdown"
    });
    for (const input of inputs) {
      const text = await callConfiguredVlm(config, {
        prompt,
        imageBase64: input.base64,
        imageUrl: input.dataUrl
      });
      if (!text.trim()) continue;
      vlmBlocks.push({
        id: `vlm-page-${input.page || 1}`,
        path: relativePath,
        kind: kindForRelativePath(relativePath),
        source: "vlm-ocr",
        page: input.page,
        text: text.trim(),
        bbox: null,
        confidence: null,
        metadata: {
          provider: config.provider,
          model: config.model,
          imageMime: input.mime,
          deterministic: true,
          temperature: 0,
          thinking: "off"
        }
      });
    }
  } catch (error) {
    warnings.push(`VLM OCR skipped: ${error.message}`);
  }

  if (!vlmBlocks.length) {
    return { ...document, warnings };
  }
  const existingText = String(document.text || "").trim();
  const vlmText = vlmBlocks.map((block) => block.text).join("\n\n").trim();
  return {
    ...document,
    text: [existingText, vlmText].filter(Boolean).join("\n\n").trim(),
    blocks: [...(document.blocks || []), ...vlmBlocks],
    warnings,
    extractor: `${document.extractor || "codmes-document-worker"}+vlm-ocr`
  };
}

async function readAnnotationsForDocument(workspaceRoot, relativePath) {
  const primaryPath = annotationsPathForDocument(workspaceRoot, relativePath);
  try {
    return JSON.parse(await fs.readFile(primaryPath, "utf8"));
  } catch (error) {
    if (error?.code !== "ENOENT") return null;
  }

  for (const legacyPath of [
    contentScopedAnnotationsPathForDocument(workspaceRoot, relativePath),
    legacyAnnotationsPathForDocument(workspaceRoot, relativePath)
  ]) {
    if (legacyPath === primaryPath) continue;
    try {
      const raw = await fs.readFile(legacyPath, "utf8");
      await fs.mkdir(path.dirname(primaryPath), { recursive: true });
      await fs.writeFile(primaryPath, raw, { flag: "wx" }).catch((error) => {
        if (error?.code !== "EEXIST") throw error;
      });
      return JSON.parse(raw);
    } catch (error) {
      if (error?.code !== "ENOENT") return null;
    }
  }
  return null;
}

function collectAnnotationObjects(annotations = {}) {
  const rootObjects = Array.isArray(annotations.objects) ? annotations.objects : [];
  const seenIds = new Set(rootObjects.map((object) => object?.id).filter(Boolean));
  const pageObjects = [];
  for (const page of Array.isArray(annotations.pages) ? annotations.pages : []) {
    for (const object of Array.isArray(page.objects) ? page.objects : []) {
      if (object?.id) seenIds.add(object.id);
      pageObjects.push({
        ...object,
        pageIndex: object.pageIndex ?? page.pageIndex
      });
    }
    for (const element of Array.isArray(page.elements) ? page.elements : []) {
      if (typeof element.text === "string" && element.text.trim() && !seenIds.has(element.id)) {
        if (element.id) seenIds.add(element.id);
        pageObjects.push({
          ...element,
          pageIndex: element.pageIndex ?? page.pageIndex,
          type: element.type || "text"
        });
      }
    }
  }
  const rootElements = [];
  for (const element of Array.isArray(annotations.elements) ? annotations.elements : []) {
    if (typeof element.text === "string" && element.text.trim() && !seenIds.has(element.id)) {
      if (element.id) seenIds.add(element.id);
      rootElements.push({
        ...element,
        type: element.type || "text"
      });
    }
  }
  return [...rootObjects, ...rootElements, ...pageObjects];
}

function annotationBlock(relativePath, object, text, source, metadata = {}) {
  return {
    id: object.id || `${source}-${Math.random().toString(36).slice(2)}`,
    path: relativePath,
    kind: "pdf",
    source,
    page: Number.isFinite(Number(object.pageIndex)) ? Number(object.pageIndex) + 1 : null,
    text: String(text || "").trim(),
    bbox: object.bbox || null,
    confidence: null,
    metadata: {
      annotationId: object.id || "",
      annotationType: object.type || "",
      ...(object.metadata || {}),
      ...metadata
    }
  };
}

function shouldRunVlmOcr(relativePath, document, config) {
  const kind = kindForRelativePath(relativePath);
  if (kind === "image") return true;
  if (kind !== "pdf") return false;
  const minTextChars = Number.parseInt(String(config.minTextChars || "80"), 10);
  return String(document.text || "").trim().length < Math.max(0, minTextChars);
}

async function buildVlmInputs(workspaceRoot, absolutePath, relativePath, config) {
  const kind = kindForRelativePath(relativePath);
  if (kind === "image") {
    const data = await fs.readFile(absolutePath);
    const mime = imageMimeForPath(relativePath);
    return [{
      page: null,
      mime,
      base64: data.toString("base64"),
      dataUrl: `data:${mime};base64,${data.toString("base64")}`
    }];
  }
  if (kind === "pdf") {
    return await renderPdfPageImagesForVlm(workspaceRoot, absolutePath, relativePath, config);
  }
  return [];
}

async function renderPdfPageImagesForVlm(workspaceRoot, absolutePath, relativePath, config) {
  const python = await documentWorkerPython();
  const maxPages = clampNumber(config.maxPages, 1, 200, 40);
  const dpi = clampNumber(config.dpi, 96, 240, 150);
  const renderDir = path.join(
    documentIngestCacheDirectory(workspaceRoot),
    "vlm-pages",
    crypto.createHash("sha256").update(`${relativePath}\n${absolutePath}`).digest("hex").slice(0, 16)
  );
  await fs.rm(renderDir, { recursive: true, force: true });
  await fs.mkdir(renderDir, { recursive: true });
  const script = `
import fitz, json, os, sys
pdf_path, out_dir, max_pages, dpi = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4])
doc = fitz.open(pdf_path)
items = []
matrix = fitz.Matrix(dpi / 72, dpi / 72)
for index, page in enumerate(doc, start=1):
    if index > max_pages:
        break
    pix = page.get_pixmap(matrix=matrix, alpha=False)
    out = os.path.join(out_dir, f"page-{index:04d}.png")
    pix.save(out)
    items.append({"page": index, "path": out, "width": pix.width, "height": pix.height})
doc.close()
print(json.dumps(items))
`;
  const stdout = [];
  const stderr = [];
  const child = spawn(python, ["-c", script, absolutePath, renderDir, String(maxPages), String(dpi)], {
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env
  });
  child.stdout.on("data", (chunk) => stdout.push(chunk));
  child.stderr.on("data", (chunk) => stderr.push(chunk));
  const code = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });
  if (code !== 0) {
    throw new Error(`PDF page rendering failed: ${Buffer.concat(stderr).toString("utf8").trim() || `exit ${code}`}`);
  }
  const items = JSON.parse(Buffer.concat(stdout).toString("utf8").trim() || "[]");
  const inputs = [];
  for (const item of items) {
    const data = await fs.readFile(item.path);
    const base64 = data.toString("base64");
    inputs.push({
      page: item.page,
      mime: "image/png",
      base64,
      dataUrl: `data:image/png;base64,${base64}`
    });
  }
  return inputs;
}

async function callConfiguredVlm(config, input) {
  const provider = String(config.provider || "").toLowerCase();
  if (provider.includes("ollama") && config.useOllamaNative) {
    return await callOllamaNativeVlm({
      baseUrl: config.baseUrl,
      model: config.model,
      prompt: input.prompt,
      imageBase64: input.imageBase64,
      maxTokens: config.maxTokens
    });
  }
  return await callOpenAICompatibleVlm({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    model: config.model,
    prompt: input.prompt,
    imageUrl: input.imageUrl,
    maxTokens: config.maxTokens
  });
}

async function readVlmSearchConfig(workspaceRoot) {
  const env = await readEnvFile(path.join(workspaceRoot, ".codmes", "config", "search.env"));
  const provider = env.VLM_PROVIDER || process.env.CODMES_VLM_PROVIDER || "";
  const model = env.VLM_MODEL || process.env.CODMES_VLM_MODEL || "";
  const baseUrl = env.VLM_BASE_URL || process.env.CODMES_VLM_BASE_URL || "";
  return {
    enabled: Boolean(model && baseUrl),
    provider,
    model,
    baseUrl,
    apiKey: env.VLM_API_KEY || process.env.CODMES_VLM_API_KEY || "",
    maxTokens: env.VLM_MAX_TOKENS || process.env.CODMES_VLM_MAX_TOKENS || "800",
    maxPages: env.VLM_MAX_PAGES || process.env.CODMES_VLM_MAX_PAGES || "40",
    dpi: env.VLM_RENDER_DPI || process.env.CODMES_VLM_RENDER_DPI || "150",
    minTextChars: env.VLM_MIN_TEXT_CHARS || process.env.CODMES_VLM_MIN_TEXT_CHARS || "80",
    language: env.VLM_LANGUAGE || process.env.CODMES_VLM_LANGUAGE || "auto",
    useOllamaNative: ["true", "1", "yes", "on"].includes(String(env.VLM_OLLAMA_NATIVE || process.env.CODMES_VLM_OLLAMA_NATIVE || "").toLowerCase())
  };
}

async function readEnvFile(filePath) {
  try {
    const content = await fs.readFile(filePath, "utf8");
    const result = {};
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const index = trimmed.indexOf("=");
      if (index === -1) continue;
      result[trimmed.slice(0, index)] = trimmed.slice(index + 1);
    }
    return result;
  } catch {
    return {};
  }
}

function kindForRelativePath(relativePath) {
  const ext = path.extname(String(relativePath || "").toLowerCase());
  if (ext === ".pdf") return "pdf";
  if ([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".tif", ".tiff", ".heic"].includes(ext)) return "image";
  if ([".xlsx", ".xls"].includes(ext)) return "spreadsheet";
  if ([".doc", ".docx", ".ppt", ".pptx", ".hwp", ".hwpx", ".odt", ".odp"].includes(ext)) return "document";
  return "file";
}

function imageMimeForPath(relativePath) {
  const ext = path.extname(String(relativePath || "").toLowerCase());
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  if (ext === ".bmp") return "image/bmp";
  if (ext === ".tif" || ext === ".tiff") return "image/tiff";
  return "image/png";
}

function clampNumber(value, min, max, fallback) {
  const number = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
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
  const tables = Array.isArray(result.tables)
    ? result.tables.map((table, index) => ({
      id: String(table.id || `table-${index + 1}`),
      path: String(table.path || relativePath),
      source: String(table.source || "document-table"),
      page: Number.isFinite(Number(table.page)) ? Number(table.page) : null,
      headers: Array.isArray(table.headers) ? table.headers.map((value) => String(value || "")) : [],
      rows: Array.isArray(table.rows)
        ? table.rows.map((row) => Array.isArray(row) ? row.map((value) => String(value || "")) : [])
        : [],
      markdown: String(table.markdown || ""),
      bbox: table.bbox || null,
      metadata: table.metadata && typeof table.metadata === "object" ? table.metadata : {}
    })).filter((table) => table.headers.length > 1 && table.rows.length > 0)
    : [];
  return {
    schemaVersion: DOCUMENT_INGEST_CACHE_VERSION,
    path: String(result.path || relativePath),
    kind: String(result.kind || "file"),
    text: String(result.text || blocks.map((block) => block.text).join("\n\n")).trim(),
    markdown: String(result.markdown || result.text || "").trim(),
    tables,
    blocks,
    warnings: Array.isArray(result.warnings) ? result.warnings.map(String) : [],
    extractor: String(result.extractor || "codmes-document-worker")
  };
}
