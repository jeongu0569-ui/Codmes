import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileKind, resolveWorkspacePath } from "./path-utils.mjs";
import { getPdfTextMetadata } from "./pdf-text.mjs";

const MAX_HASH_BYTES = 20 * 1024 * 1024;

export function indexPath(workspaceRoot) {
  return path.join(workspaceRoot, ".ai-workspace", "index", "files.json");
}

export async function readIndex(workspaceRoot) {
  try {
    return JSON.parse(await fs.readFile(indexPath(workspaceRoot), "utf8"));
  } catch {
    return {
      schemaVersion: 1,
      provider: "workspace-file-index",
      builtAt: null,
      itemCount: 0,
      items: []
    };
  }
}

export async function buildIndex(workspaceRoot) {
  const items = [];
  await visitWorkspace(workspaceRoot, workspaceRoot, items);
  const index = {
    schemaVersion: 1,
    provider: "workspace-file-index",
    builtAt: new Date().toISOString(),
    itemCount: items.length,
    items
  };
  const filePath = indexPath(workspaceRoot);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(index, null, 2) + "\n", "utf8");
  return index;
}

export async function updateIndex(workspaceRoot, changedPaths = []) {
  if (!Array.isArray(changedPaths) || changedPaths.length === 0) {
    return await buildIndex(workspaceRoot);
  }
  const current = await readIndex(workspaceRoot);
  const itemsByPath = new Map((current.items || []).map((item) => [item.path, item]));
  for (const changedPath of changedPaths) {
    const metadata = await readFileMetadata(workspaceRoot, changedPath).catch(() => null);
    if (metadata) {
      itemsByPath.set(metadata.path, metadata);
    } else {
      itemsByPath.delete(String(changedPath || "").replace(/\\/g, "/"));
    }
  }
  const next = {
    ...current,
    builtAt: new Date().toISOString(),
    itemCount: itemsByPath.size,
    items: Array.from(itemsByPath.values()).sort((a, b) => a.path.localeCompare(b.path))
  };
  const filePath = indexPath(workspaceRoot);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(next, null, 2) + "\n", "utf8");
  return next;
}

export async function readFileMetadata(workspaceRoot, requestPath) {
  const resolved = resolveWorkspacePath(workspaceRoot, requestPath || "");
  const stat = await fs.stat(resolved.absolutePath);
  return await metadataForPath(workspaceRoot, resolved.absolutePath, stat);
}

async function visitWorkspace(workspaceRoot, absolutePath, items) {
  const stat = await fs.stat(absolutePath);
  if (stat.isDirectory()) {
    const relative = path.relative(workspaceRoot, absolutePath).replace(/\\/g, "/");
    if (relative === ".ai-workspace" || relative.startsWith(".ai-workspace/")) return;
    const entries = await fs.readdir(absolutePath, { withFileTypes: true });
    entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (entry.name === ".DS_Store") continue;
      await visitWorkspace(workspaceRoot, path.join(absolutePath, entry.name), items);
    }
    return;
  }
  items.push(await metadataForPath(workspaceRoot, absolutePath, stat));
}

async function metadataForPath(workspaceRoot, absolutePath, stat) {
  const relativePath = path.relative(workspaceRoot, absolutePath).replace(/\\/g, "/");
  const kind = fileKind(relativePath);
  const metadata = {
    path: relativePath,
    kind,
    extension: path.extname(relativePath).toLowerCase(),
    size: stat.size,
    modifiedAt: stat.mtime.toISOString(),
    hash: stat.size <= MAX_HASH_BYTES ? await sha256File(absolutePath) : null,
    indexedAt: new Date().toISOString(),
    indexStatus: "indexed"
  };
  if (kind === "pdf") {
    metadata.pdf = await getPdfTextMetadata(workspaceRoot, absolutePath, relativePath, stat).catch((error) => ({
      type: "pdf",
      textCached: false,
      textLength: 0,
      error: error?.message || "PDF metadata unavailable.",
      ocr: "planned"
    }));
  }
  return metadata;
}

async function sha256File(filePath) {
  const data = await fs.readFile(filePath);
  return `sha256-${crypto.createHash("sha256").update(data).digest("hex")}`;
}
