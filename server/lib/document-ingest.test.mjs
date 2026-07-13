import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  extractAndCacheDocument,
  getDocumentIngestMetadata,
  isDocumentIngestFile
} from "./document-ingest.mjs";

const execFileAsync = promisify(execFile);

test("document ingest extracts and caches PDF text through the worker", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "document-ingest-"));
  await fs.mkdir(path.join(root, "Documents"), { recursive: true });
  const pdfPath = path.join(root, "Documents", "manual.pdf");
  await createMinimalPdf(pdfPath, "codmes document ingest marker");

  assert.equal(isDocumentIngestFile("Documents/manual.pdf"), true);

  const first = await extractAndCacheDocument(root, pdfPath, "Documents/manual.pdf");
  assert.equal(first.kind, "pdf");
  assert.match(first.text, /codmes document ingest marker/i);
  assert.ok(first.blocks.length >= 1);
  assert.equal(first.blocks[0].source, "pdf-text");

  const metadata = await getDocumentIngestMetadata(root, pdfPath, "Documents/manual.pdf");
  assert.equal(metadata.cached, true);
  assert.equal(metadata.blockCount, 1);
  assert.ok(metadata.textLength > 0);

  const second = await extractAndCacheDocument(root, pdfPath, "Documents/manual.pdf");
  assert.deepEqual(second.text, first.text);
});

test("document ingest extracts DOCX text without LibreOffice through OpenXML", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "document-ingest-docx-"));
  await fs.mkdir(path.join(root, "Documents"), { recursive: true });
  const docxPath = path.join(root, "Documents", "sample.docx");
  await createMinimalDocx(docxPath, "codmes openxml marker");

  const result = await extractAndCacheDocument(root, docxPath, "Documents/sample.docx");
  assert.equal(result.kind, "document");
  assert.match(result.text, /codmes openxml marker/i);
  assert.equal(result.blocks[0].source, "openxml");
});

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

async function createMinimalDocx(filePath, text) {
  const script = `
import zipfile, sys
path, text = sys.argv[1], sys.argv[2]
xml = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body><w:p><w:r><w:t>''' + text + '''</w:t></w:r></w:p></w:body>
</w:document>'''
with zipfile.ZipFile(path, "w") as z:
    z.writestr("[Content_Types].xml", '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>')
    z.writestr("word/document.xml", xml)
`;
  await execFileAsync("python3", ["-c", script, filePath, text]);
}
