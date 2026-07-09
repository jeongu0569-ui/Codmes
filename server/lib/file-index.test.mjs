import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readFileMetadata } from "./file-index.mjs";

test("readFileMetadata includes PDF metadata and text cache status", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "file-index-pdf-"));
  await fs.mkdir(path.join(root, "Documents"), { recursive: true });
  await fs.writeFile(
    path.join(root, "Documents", "manual.pdf"),
    "%PDF-1.4\n1 0 obj << /Type /Page >> endobj\nBT (workspace pdf text) Tj ET\n%%EOF",
    "latin1"
  );

  const metadata = await readFileMetadata(root, "Documents/manual.pdf");
  assert.equal(metadata.kind, "pdf");
  assert.equal(metadata.pdf.type, "pdf");
  assert.equal(metadata.pdf.pageCount, 1);
  assert.equal(metadata.pdf.textCached, false);
  assert.equal(metadata.pdf.ocr, "planned");
});

