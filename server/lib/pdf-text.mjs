import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

export function pdfTextCacheDirectory(workspaceRoot) {
  return path.join(workspaceRoot, ".ai-workspace", "index", "pdf-text");
}

export function pdfTextCachePath(workspaceRoot, relativePath, stat) {
  const stamp = stat ? `${stat.size}:${stat.mtimeMs}` : "";
  const key = crypto
    .createHash("sha256")
    .update(`${String(relativePath || "").replace(/\\/g, "/")}\n${stamp}`)
    .digest("hex");
  return path.join(pdfTextCacheDirectory(workspaceRoot), `${key}.txt`);
}

export async function getPdfTextMetadata(workspaceRoot, absolutePath, relativePath, stat = null) {
  const fileStat = stat || await fs.stat(absolutePath);
  const cachePath = pdfTextCachePath(workspaceRoot, relativePath, fileStat);
  let cached = false;
  let textLength = 0;
  try {
    const cacheStat = await fs.stat(cachePath);
    cached = true;
    textLength = cacheStat.size;
  } catch {}
  const pageCount = await estimatePdfPageCount(absolutePath).catch(() => null);
  return {
    type: "pdf",
    pageCount,
    textCached: cached,
    textLength,
    textCachePath: path.relative(workspaceRoot, cachePath).replace(/\\/g, "/"),
    ocr: "planned"
  };
}

export async function extractAndCachePdfText(workspaceRoot, absolutePath, relativePath, stat = null) {
  const fileStat = stat || await fs.stat(absolutePath);
  const cachePath = pdfTextCachePath(workspaceRoot, relativePath, fileStat);
  try {
    return await fs.readFile(cachePath, "utf8");
  } catch {}
  const text = await extractPdfText(absolutePath);
  await fs.mkdir(path.dirname(cachePath), { recursive: true });
  await fs.writeFile(cachePath, text, "utf8");
  return text;
}

export async function extractPdfText(absolutePath) {
  const data = await fs.readFile(absolutePath);
  const raw = data.toString("latin1");
  const pieces = [];
  const regex = /\((?:\\.|[^\\)])*\)/g;
  for (const match of raw.matchAll(regex)) {
    const value = decodePdfLiteralString(match[0].slice(1, -1));
    if (looksLikeText(value)) pieces.push(value);
  }
  return pieces.join("\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

async function estimatePdfPageCount(absolutePath) {
  const data = await fs.readFile(absolutePath);
  const raw = data.toString("latin1");
  const matches = raw.match(/\/Type\s*\/Page\b/g);
  return matches ? matches.length : null;
}

function decodePdfLiteralString(value) {
  return value
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\b/g, "\b")
    .replace(/\\f/g, "\f")
    .replace(/\\\(/g, "(")
    .replace(/\\\)/g, ")")
    .replace(/\\\\/g, "\\")
    .replace(/\\([0-7]{1,3})/g, (_match, octal) => String.fromCharCode(Number.parseInt(octal, 8)));
}

function looksLikeText(value) {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  if (normalized.length < 2) return false;
  const printable = [...normalized].filter((char) => {
    const code = char.codePointAt(0);
    return code === 10 || code === 13 || code === 9 || (code >= 32 && code !== 127);
  }).length;
  return printable / normalized.length > 0.8;
}

